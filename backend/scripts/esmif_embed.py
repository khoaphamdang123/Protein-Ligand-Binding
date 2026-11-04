"""ESM-IF1 encoder embedding (FOUNDATION_MODELS.md section 5). Runs in the separate .venv-esmif.

    .venv-esmif/Scripts/python.exe scripts/esmif_embed.py --pdb chainA.pdb --sequence MKT... --out emb.npy

Prints one JSON line with shape and timings. Output: float32 array (L, 512).

torch-scatter: fair-esm imports `scatter_add, scatter` from it, but only calls them in the
autoregressive (decoder) branch of GVPConvLayer; the encoder used here never does, and PyG's own
mean/sum aggregation uses torch's native scatter_add_. When the compiled torch-scatter cannot be
loaded (Windows Smart App Control blocks its DLL on this machine), a pure-PyTorch stand-in is
registered so the import succeeds; the encoder output is unaffected.
"""
import argparse
import json
import os
import sys
import time
import types
from pathlib import Path


def _ensure_torch_scatter() -> str:
    try:
        import torch_scatter  # noqa: F401
        return "torch_scatter"
    except (ImportError, OSError) as exc:
        reason = f"{type(exc).__name__}: {exc}"

    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import torch_geometric  # noqa: F401  (must see torch_scatter as unavailable before the stand-in exists)
    from torch_geometric.utils import scatter as pyg_scatter

    def scatter(src, index, dim=-1, out=None, dim_size=None, reduce="sum"):
        if out is not None:
            raise NotImplementedError("torch_scatter stand-in does not support `out`")
        return pyg_scatter(src, index, dim=dim, dim_size=dim_size, reduce=reduce)

    def scatter_add(src, index, dim=-1, out=None, dim_size=None):
        return scatter(src, index, dim=dim, out=out, dim_size=dim_size, reduce="sum")

    standin = types.ModuleType("torch_scatter")
    standin.scatter, standin.scatter_add = scatter, scatter_add
    sys.modules["torch_scatter"] = standin
    return f"pure-PyTorch stand-in ({reason})"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdb", required=True, type=Path, help="PDB normalised to chain A")
    parser.add_argument("--sequence", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--torch-home", type=Path, help="defaults to $TORCH_HOME")
    args = parser.parse_args()

    if args.torch_home:
        os.environ["TORCH_HOME"] = str(args.torch_home)

    scatter_mode = _ensure_torch_scatter()

    import numpy as np
    import torch
    import esm
    import esm.inverse_folding
    from esm.inverse_folding.util import CoordBatchConverter

    started = time.perf_counter()
    model, alphabet = esm.pretrained.esm_if1_gvp4_t16_142M_UR50()
    model = model.eval()  # fp32; the doc runs on CUDA, this machine has no NVIDIA GPU
    load_s = time.perf_counter() - started

    def get_encoder_output(model, alphabet, coords):  # fair-esm's version + the device fix used for the features
        device = next(model.parameters()).device
        coords, confidence, _, _, padding_mask = CoordBatchConverter(alphabet)([(coords, None, None)], device=device)
        enc = model.encoder.forward(coords, padding_mask, confidence, return_all_hiddens=False)
        return enc["encoder_out"][0][1:-1, 0]  # drop BOS/EOS

    started = time.perf_counter()
    structure = esm.inverse_folding.util.load_structure(str(args.pdb), "A")
    coords, pdb_seq = esm.inverse_folding.util.extract_coords_from_structure(structure)
    if pdb_seq != args.sequence:
        raise SystemExit("PDB chain A must match the sequence exactly")
    with torch.no_grad():
        embedding = get_encoder_output(model, alphabet, coords).cpu().numpy()  # float32 (L, 512)
    infer_s = time.perf_counter() - started

    np.save(args.out, embedding)
    print(json.dumps({
        "shape": list(embedding.shape),
        "dtype": str(embedding.dtype),
        "finite": bool(np.isfinite(embedding).all()),
        "load_s": round(load_s, 2),
        "infer_s": round(infer_s, 2),
        "torch": torch.__version__,
        "fair_esm": getattr(esm, "__version__", "?"),
        "torch_scatter": scatter_mode,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
