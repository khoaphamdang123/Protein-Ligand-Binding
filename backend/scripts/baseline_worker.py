#!/usr/bin/env python
"""Long-lived bindEmbed21DL + bindNode24 worker. Runs in backend/.venv-baselines (torch 2.2.2, torch-geometric 2.5.0,
numpy<2: the versions of the bindNode24 repository), on the CPU, and loads both models once.

Inference as in baselines_2124 (README_BASELINES.md, the runs behind frozen_predictions):
  bindEmbed21DL  ProtT5 (L, 1024) -> 5 checkpoints -> sigmoid -> mean. The published code rounds to 3 decimals; not here
                 (same as baselines_2124/repro). Inputs are zero-padded on the right, as its data loader does.
  bindNode24     ProtT5 + graph of Cα pairs closer than 17 Å (self-loops included) -> SAGEConv model, 5 folds -> sigmoid
                 -> mean. use_dssp = False: the DSSP features never reach the model.
Both answer (L, 3) in the order metal, nuclear, small.

Protocol (stdout is reserved for it):
    -> {"ready": true, "torch": "2.2.2", "bindEmbed21DL": 5, "bindNode24": 5, "load_s": 0.4}
    <- {"id": "abc", "embedding": "/tmp/t5.npy", "ca": "/tmp/ca.npy", "out": "/tmp/out.npz"}
    -> {"id": "abc", "ok": true, "seconds": 0.2}      (out.npz: bindEmbed21DL, bindNode24)
    -> {"id": "abc", "ok": false, "error": "..."}
Start-up failure: one line {"ready": false, "error": "..."} and exit code 1.

    .venv-baselines/bin/python scripts/baseline_worker.py --baselines-dir ../baselines_2124
"""
import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

# Keep stdout for the protocol: duplicate it, then point fd 1 (Python prints and C-level writes) at stderr.
_PROTO = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

STRUCTURE_CUTOFF = 17.0   # bindNode24 .ini: cutoff_structure
RIGHT_PADDING = 8         # more than the receptive field of the two convolutions (kernel 5)


def send(obj) -> None:
    _PROTO.write(json.dumps(obj) + "\n")
    _PROTO.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baselines-dir", required=True, help="the unpacked baselines_2124 folder")
    ap.add_argument("--threads", type=int, default=8)
    a = ap.parse_args()
    root = Path(a.baselines_dir)

    started = time.perf_counter()
    try:
        import numpy as np
        import torch
        import torch.nn.functional as F

        sys.path.insert(0, str(root / "bindEmbed21DL" / "src"))   # the checkpoints pickle architectures.CNN2Layers
        sys.path.insert(0, str(root / "bindNode24" / "src"))
        from machine_learning.Models import SAGEConvModel

        torch.set_num_threads(a.threads)
        bind21 = [torch.load(root / "bindEmbed21DL" / "trained_models" / f"checkpoint{k}.pt", map_location="cpu").eval()
                  for k in range(1, 6)]
        bind24 = []
        for path in sorted((root / "bindNode24" / "trained_model_dicts" / "bindNode24").glob("*.state_dict")):
            model = SAGEConvModel(in_channels=1024, feature_channels=128, additional_channels=20, out_channels=3,
                                  dropout=0.7, activation=F.leaky_relu, use_additional_channels=False)
            model.load_state_dict(torch.load(path, map_location="cpu"))
            bind24.append(model.eval())
        if len(bind21) != 5 or len(bind24) != 5:
            raise RuntimeError(f"expected 5 + 5 models, found {len(bind21)} + {len(bind24)}")
    except Exception as exc:
        send({"ready": False, "error": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()})
        return 1

    def run_bind21(embedding):
        x = torch.from_numpy(embedding.T[None]).float()
        x = F.pad(x, (0, RIGHT_PADDING))
        with torch.no_grad():
            runs = [torch.sigmoid(m(x)).numpy().astype(np.float64) for m in bind21]   # (3, L + padding)
        return (sum(runs) / len(runs))[:, :embedding.shape[0]].T

    def run_bind24(embedding, ca):
        distances = np.linalg.norm(ca[:, None, :] - ca[None, :, :], axis=-1)
        edges = torch.from_numpy(np.array((distances < STRUCTURE_CUTOFF).astype(int).nonzero())).long()
        x = torch.from_numpy(embedding).float()
        with torch.no_grad():
            runs = [torch.sigmoid(m(x, edges, edges, None, None)).numpy() for m in bind24]
        return sum(runs) / len(runs)

    send({"ready": True, "torch": torch.__version__, "numpy": np.__version__, "bindEmbed21DL": len(bind21),
          "bindNode24": len(bind24), "load_s": round(time.perf_counter() - started, 2)})

    for line in sys.stdin:
        if not line.strip():
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            t0 = time.perf_counter()
            embedding = np.load(req["embedding"]).astype(np.float32)
            ca = np.load(req["ca"]).astype(np.float64)
            if embedding.ndim != 2 or embedding.shape[1] != 1024 or ca.shape != (embedding.shape[0], 3):
                raise ValueError(f"bad input shapes: embedding {embedding.shape}, Cα {ca.shape}")
            tmp = req["out"] + ".tmp.npz"
            np.savez(tmp, bindEmbed21DL=run_bind21(embedding), bindNode24=run_bind24(embedding, ca))
            os.replace(tmp, req["out"])
            send({"id": req_id, "ok": True, "seconds": round(time.perf_counter() - t0, 3)})
        except Exception as exc:
            send({"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
            print(traceback.format_exc(), file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
