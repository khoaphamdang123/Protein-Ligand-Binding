#!/usr/bin/env python
"""Long-lived ESM-IF1 embedding worker. Runs in the ESM-IF environment (backend/.venv-esmif: python 3.10,
numpy<2, torch 2.4.1, fair-esm 2.0.0), loads the model once and answers one JSON request per line.

The computation is exactly adabind/scripts/esmif_embed.py (= ESMBind get_esm_if_embedding.py, commit 5d81fb5b,
with the device fix of get_encoder_output), see adabind/docs/FOUNDATION_MODELS.md section 5:
fp32, one protein per call, chain A of the exact-sequence normalised PDB, BOS/EOS dropped -> float32 (L, 512).

Protocol (stdout is reserved for it; everything else the libraries print goes to stderr):
    -> {"ready": true, "device": "cuda", "torch": "2.4.1", "fair_esm": "2.0.0", "load_s": 3.1}
    <- {"id": "abc", "pdb": "/tmp/q_chainA.pdb", "sequence": "MKT...", "out": "/tmp/q.ESMIF.npy"}
    -> {"id": "abc", "ok": true, "shape": [76, 512], "seconds": 0.2}
    -> {"id": "abc", "ok": false, "error": "..."}
Start-up failure: one line {"ready": false, "error": "..."} and exit code 1.

    .venv-esmif/bin/python scripts/esmif_worker.py --weights <foundation_models>/esm_if1/esm_if1_gvp4_t16_142M_UR50.pt
"""
import argparse
import json
import os
import sys
import time
import traceback

# Keep stdout for the protocol: duplicate it, then point fd 1 (Python prints and C-level writes) at stderr.
_PROTO = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr


def send(obj) -> None:
    _PROTO.write(json.dumps(obj) + "\n")
    _PROTO.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True, help="esm_if1_gvp4_t16_142M_UR50.pt")
    ap.add_argument("--device", default="", help="cuda | cpu (default: cuda when available)")
    a = ap.parse_args()

    import warnings

    # fair-esm 2.0.0 loads its (sha256-checked) checkpoint with torch.load(weights_only=False): harmless here.
    warnings.filterwarnings("ignore", message=r"You are using `torch.load` with `weights_only=False`",
                            category=FutureWarning)
    started = time.perf_counter()
    try:
        import numpy as np
        import torch
        import esm
        import esm.inverse_folding
        from esm.inverse_folding.util import CoordBatchConverter

        device = torch.device(a.device or ("cuda" if torch.cuda.is_available() else "cpu"))
        model, alphabet = esm.pretrained.load_model_and_alphabet_local(a.weights)
        model = model.eval().to(device)  # fp32
    except Exception as exc:
        send({"ready": False, "error": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()})
        return 1

    def get_encoder_output(coords):
        batch = [(coords, None, None)]
        coords, confidence, _, _, padding_mask = CoordBatchConverter(alphabet)(batch, device=device)
        encoder_out = model.encoder.forward(coords, padding_mask, confidence, return_all_hiddens=False)
        return encoder_out["encoder_out"][0][1:-1, 0]  # drop BOS / EOS

    send({"ready": True, "device": str(device), "torch": torch.__version__,
          "fair_esm": getattr(esm, "__version__", "?"), "numpy": np.__version__,
          "load_s": round(time.perf_counter() - started, 2)})

    for line in sys.stdin:
        if not line.strip():
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            t0 = time.perf_counter()
            structure = esm.inverse_folding.util.load_structure(req["pdb"], "A")
            coords, pdb_seq = esm.inverse_folding.util.extract_coords_from_structure(structure)
            if pdb_seq != req["sequence"]:
                raise ValueError(f"PDB chain A ({len(pdb_seq)} aa) does not match the sequence "
                                 f"({len(req['sequence'])} aa) exactly")
            with torch.no_grad():
                emb = get_encoder_output(coords).cpu().numpy()  # float32 (L, 512)
            if not np.isfinite(emb).all():
                raise ValueError("ESM-IF embedding contains NaN/inf")
            tmp = req["out"] + ".tmp.npy"
            np.save(tmp, emb)
            os.replace(tmp, req["out"])
            send({"id": req_id, "ok": True, "shape": list(emb.shape), "dtype": str(emb.dtype),
                  "seconds": round(time.perf_counter() - t0, 3)})
        except Exception as exc:
            send({"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
            print(traceback.format_exc(), file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
