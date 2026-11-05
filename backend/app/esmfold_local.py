"""Self-hosted ESMFold v1 (foundation_models/esmfold_v1), the preferred structure source; the ESM Atlas API is the
fallback (app/esmfold.py).

Settings are exactly adabind/docs/FOUNDATION_MODELS.md section 2 (the code that folded the training PDBs):
transformers EsmForProteinFolding, the internal ESM-2 3B language model in fp16, trunk chunk size 64, TF32 matmul,
default number of recycles, no special tokens, B-factor = pLDDT on a 0-1 scale, chain A, residues 1..L.

Two deliberate differences in *how*, not *what*:
  * the language model is cast to fp16 on the CPU before the move to the GPU (the doc moves the fp32 model first),
    so loading peaks at ~8.5 GB of VRAM instead of ~14 GB; the weights and computation are identical;
  * TF32 is switched on only for the duration of a fold (under the GPU lock) and restored afterwards, because ESM-2,
    ProtT5 and the binding-site checkpoints run in the same process and were computed without TF32.
On CPU (BINDSITE_DEVICE_ESMFOLD=cpu) the language model stays fp32, like pbind does for ProtT5: fp16 is a GPU
setting and is very slow on CPU. Expect minutes per protein on CPU.
"""
import logging
import threading
import time
from pathlib import Path

from .gpu import GPU_LOCK

log = logging.getLogger("bindsite.esmfold.local")

MAX_TOKENS = 1024  # FOUNDATION_MODELS.md: ESMFold truncates at 1024 tokens


class LocalEsmFoldError(RuntimeError):
    pass


class LocalEsmFold:
    name = "local"

    def __init__(self, model_dir: Path, device: str = "cuda", chunk_size: int = 64):
        self.model_dir = Path(model_dir)
        self.device = device or "cuda"
        self.chunk_size = chunk_size
        self.info: dict = {}
        self.error: str | None = None
        self._model = self._tokenizer = None
        self._load_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> dict:
        with self._load_lock:
            if self._model is not None:
                return self.info
            if self.error:
                raise LocalEsmFoldError(self.error)
            try:
                return self._load()
            except Exception as exc:
                self.error = f"{type(exc).__name__}: {exc}"
                log.exception("Local ESMFold failed to load from %s", self.model_dir)
                raise LocalEsmFoldError(self.error) from exc

    def _load(self) -> dict:
        import torch
        import transformers
        from transformers import AutoTokenizer, EsmForProteinFolding

        if not (self.model_dir / "pytorch_model.bin").exists():
            raise FileNotFoundError(f"{self.model_dir}/pytorch_model.bin")
        started = time.perf_counter()
        tokenizer = AutoTokenizer.from_pretrained(str(self.model_dir))
        model = EsmForProteinFolding.from_pretrained(str(self.model_dir), low_cpu_mem_usage=True)
        on_gpu = str(self.device).startswith("cuda")
        if on_gpu:
            model.esm = model.esm.half()  # only the internal ESM-2 3B language model in fp16
        with GPU_LOCK:
            model = model.to(self.device)
            if on_gpu:
                torch.cuda.empty_cache()
        model.trunk.set_chunk_size(self.chunk_size)
        model.eval()
        self._tokenizer, self._model = tokenizer, model
        self.info = {"device": self.device, "transformers": transformers.__version__, "chunk_size": self.chunk_size,
                     "esm_dtype": str(next(model.esm.parameters()).dtype).replace("torch.", ""),
                     "load_s": round(time.perf_counter() - started, 1)}
        log.info("Local ESMFold loaded: %s", self.info)
        return self.info

    def fold(self, sequence: str) -> str:
        """PDB text (chain A, residues 1..L, B-factor = pLDDT 0-1). Raises on any failure: never a stale PDB."""
        import torch
        from transformers.models.esm.openfold_utils.feats import atom14_to_atom37
        from transformers.models.esm.openfold_utils.protein import Protein as OFProtein
        from transformers.models.esm.openfold_utils.protein import to_pdb

        if len(sequence) > MAX_TOKENS:
            raise LocalEsmFoldError(f"{len(sequence)} aa exceeds the {MAX_TOKENS}-token limit of ESMFold")
        self.load()
        tokenizer, model = self._tokenizer, self._model
        with GPU_LOCK:
            tf32 = torch.backends.cuda.matmul.allow_tf32
            torch.backends.cuda.matmul.allow_tf32 = True
            try:
                ids = tokenizer([sequence], return_tensors="pt", add_special_tokens=False, padding=True,
                                truncation=True, max_length=MAX_TOKENS)["input_ids"].to(self.device)
                with torch.no_grad():
                    out = model(ids)  # num_recycles: default (do not pass)
                pos = atom14_to_atom37(out["positions"][-1], out)
                out = {k: v.to("cpu").numpy() for k, v in out.items()}
                pos = pos.cpu().numpy()
            except torch.OutOfMemoryError as exc:
                raise LocalEsmFoldError(f"GPU out of memory folding {len(sequence)} aa") from exc
            finally:
                torch.backends.cuda.matmul.allow_tf32 = tf32
                if str(self.device).startswith("cuda"):
                    torch.cuda.empty_cache()  # give the memory back (the ESM-IF worker is another process)
        prot = OFProtein(aatype=out["aatype"][0], atom_positions=pos[0], atom_mask=out["atom37_atom_exists"][0],
                         residue_index=out["residue_index"][0] + 1, b_factors=out["plddt"][0],
                         chain_index=out["chain_index"][0] if "chain_index" in out else None)
        return to_pdb(prot)


# ---------------------------------------------------------------------------------------------- self-test
TOL_RMSD = 0.1     # FOUNDATION_MODELS.md section 7: Cα RMSD vs the training PDB
TOL_PLDDT = 0.015  # doc: 0.01; the PDB B-factor column has 2 decimals, so 0.01 steps are rounding


def ca_coords(pdb_text: str):
    import numpy as np

    xyz = {}
    for line in pdb_text.splitlines():
        if line.startswith("ENDMDL"):
            break
        if line.startswith("ATOM") and line[12:16].strip() == "CA" and line[21] == "A":
            xyz[(int(line[22:26]), line[26])] = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
    return np.array([xyz[k] for k in sorted(xyz)])


def kabsch_rmsd(p, q) -> float:
    import numpy as np

    p, q = p - p.mean(0), q - q.mean(0)
    u, _, vt = np.linalg.svd(p.T @ q)
    d = np.sign(np.linalg.det(u @ vt))
    r = u @ np.diag([1.0, 1.0, d]) @ vt
    return float(np.sqrt(((p @ r - q) ** 2).sum(1).mean()))


def self_test(local: LocalEsmFold, golden_dir: Path) -> dict:
    """Load the model and fold one confident golden protein; compare with the training PDB (doc section 7).

    Low-pLDDT regions are not stable between machines (the doc measured 2.1 Å through the API for pLDDT 0.44),
    so the protein with the highest mean pLDDT among the golden proteins of <= 200 aa is used.
    """
    import json

    import numpy as np

    from .pdb_utils import read_chain

    info = local.load()
    index = json.loads((golden_dir / "index.json").read_text())
    best = None
    for e in index["proteins"]:
        if e["length"] <= 200:
            ref = (golden_dir / f"{e['prot_id']}.pdb").read_text()
            mean = float(np.mean(read_chain(ref, "A").plddt))
            if best is None or mean > best[0]:
                best = (mean, e, ref)
    mean_ref, entry, ref = best
    started = time.perf_counter()
    pdb = local.fold(entry["sequence"])
    seconds = round(time.perf_counter() - started, 2)
    mine, theirs = read_chain(pdb, "A"), read_chain(ref, "A")
    if mine.sequence != entry["sequence"]:
        raise LocalEsmFoldError("folded chain A does not match the sequence")
    rmsd = kabsch_rmsd(ca_coords(pdb), ca_coords(ref))
    dplddt = float(np.abs(np.array(mine.plddt) - np.array(theirs.plddt)).max())
    details = {"protein": entry["prot_id"], "length": entry["length"], "mean_plddt": round(mean_ref, 3),
               "ca_rmsd_A": round(rmsd, 4), "max_abs_plddt_diff": round(dplddt, 4), "fold_s": seconds, **info}
    ok = rmsd <= TOL_RMSD and dplddt <= TOL_PLDDT
    message = (f"{entry['prot_id']} ({entry['length']} aa) folded in {seconds} s on {local.device}: Cα RMSD "
               f"{rmsd:.3f} Å, max |ΔpLDDT| {dplddt:.3f} vs training PDB")
    return {"ok": ok, "message": message, "details": details}
