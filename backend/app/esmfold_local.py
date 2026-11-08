"""Self-hosted ESMFold v1 (foundation_models/esmfold_v1): the last automatic structure source, after the
precomputed structures and the ESM Atlas API (app/esmfold.py). It runs on the GPU and only when that GPU has room
(LocalFoldService): the GPU is shared with other work on this machine, and a model that cannot load must never
push another process out of memory.

Settings are exactly adabind/docs/FOUNDATION_MODELS.md section 2 (the code that folded the training PDBs):
transformers EsmForProteinFolding, the internal ESM-2 3B language model in fp16, trunk chunk size 64, TF32 matmul,
default number of recycles, no special tokens, B-factor = pLDDT on a 0-1 scale, chain A, residues 1..L.

Two deliberate differences in *how*, not *what*:
  * the language model is cast to fp16 on the CPU before the move to the GPU (the doc moves the fp32 model first),
    so loading peaks at ~8.5 GB of VRAM instead of ~14 GB; the weights and computation are identical;
  * TF32 is switched on only for the duration of a fold (under the GPU lock) and restored afterwards, because ESM-2,
    ProtT5 and the binding-site checkpoints run in the same process and were computed without TF32.
On CPU (BINDSITE_DEVICE_ESMFOLD=cpu) the language model stays fp32, like pbind does for ProtT5: fp16 is a GPU
setting and is very slow on CPU. Measured on this machine (EPYC 7742, 64 threads, shared with a training job):
load 4 s and ~20 GB of RAM; the golden 147-aa protein folds in 206 s with Cα RMSD 0.002 Å to the training PDB.
A CPU fold neither takes GPU_LOCK (predictions go on meanwhile) nor touches the TF32 switch (a GPU-wide setting
that other models on a GPU must not see); EsmFoldClient runs it in the background (app/esmfold.py).
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
        self._cpu_lock = threading.Lock()  # one CPU fold at a time (~20 GB each), without blocking the GPU lock

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def on_gpu(self) -> bool:
        return str(self.device).startswith("cuda")

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
        if self.on_gpu:
            model.esm = model.esm.half()  # only the internal ESM-2 3B language model in fp16
            with GPU_LOCK:
                model = model.to(self.device)
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
        with GPU_LOCK if self.on_gpu else self._cpu_lock:
            tf32 = torch.backends.cuda.matmul.allow_tf32
            if self.on_gpu:
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
                raise LocalEsmFoldError(f"{'GPU' if self.on_gpu else 'CPU'} out of memory folding "
                                        f"{len(sequence)} aa") from exc
            finally:
                if self.on_gpu:
                    torch.backends.cuda.matmul.allow_tf32 = tf32
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


# ---------------------------------------------------------------------------------------------- GPU gate
def gpu_free_gb(device: str) -> tuple[float, float] | None:
    """(free, total) GB of the GPU behind `device`, read with nvidia-smi so that no CUDA context is created here."""
    import subprocess

    index = device.split(":", 1)[1] if ":" in device else "0"
    try:
        out = subprocess.run(["nvidia-smi", f"--id={index}", "--query-gpu=memory.free,memory.total",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10, check=True)
        free, total = (float(x) / 1024 for x in out.stdout.strip().splitlines()[0].split(","))
        return free, total
    except Exception as exc:  # no driver / no nvidia-smi: unknown
        log.debug("nvidia-smi unavailable: %s", exc)
        return None


class LocalFoldService:
    """Self-hosted ESMFold, used only when it can run: on a GPU with at least `min_free_gb` free when it loads.

    ready() is cheap to call on every request. The first time the GPU has room the model is loaded and checked on
    one golden protein (Cα RMSD vs the training PDB); a model that fails that check is disabled for good. While the
    GPU is busy the service reports "unavailable" and is asked again on the next request.
    """

    def __init__(self, model: LocalEsmFold, golden_dir: Path | None = None, min_free_gb: float = 10.0,
                 explicit_cpu: bool = False):
        self.model = model
        self.golden_dir = Path(golden_dir) if golden_dir else None
        self.min_free_gb = min_free_gb
        self.explicit_cpu = explicit_cpu  # BINDSITE_DEVICE_ESMFOLD=cpu: the operator asked for CPU folding
        self.state = "idle"               # idle | loading | ready | unavailable | disabled
        self.message = f"not loaded yet ({model.device})"
        self.details: dict = {}
        self._lock = threading.Lock()

    @property
    def device(self) -> str:
        return self.model.device

    @property
    def background(self) -> bool:
        """CPU folding takes minutes: EsmFoldClient queues it instead of holding the request."""
        return not str(self.device).startswith("cuda")

    def can_queue(self) -> tuple[bool, str]:
        """Without waiting for a load in progress: may a CPU fold be queued? (ready() then runs in the job.)"""
        if self.state == "disabled":
            return False, self.message
        if not self.explicit_cpu:
            return False, "no GPU configured"
        return True, ""

    def status(self) -> dict:
        level = {"ready": "ok", "loading": "running", "disabled": "error"}.get(self.state, "warning")
        return {"status": level, "state": self.state, "message": self.message, "device": self.device}

    def _has_room(self) -> tuple[bool, str]:
        device = str(self.device)
        if not device.startswith("cuda"):
            return (True, "") if self.explicit_cpu else (False, "no GPU configured")
        import torch

        if not torch.cuda.is_available():
            return False, "no CUDA GPU on this machine"
        mem = gpu_free_gb(device)
        if mem is None:
            return True, ""  # cannot tell: try, an out-of-memory load is caught and reported
        free, total = mem
        if free < self.min_free_gb:
            return False, f"GPU busy: {free:.1f} of {total:.1f} GB free, ESMFold needs {self.min_free_gb:.0f} GB"
        return True, ""

    def ready(self) -> tuple[bool, str]:
        with self._lock:
            if self.state == "ready":
                return True, ""
            if self.state == "disabled":
                return False, self.message
            ok, why = self._has_room()
            if not ok:
                self.state, self.message = "unavailable", why
                return False, why
            self.state, self.message = "loading", f"loading on {self.device}"
            try:
                if self.golden_dir and (self.golden_dir / "index.json").exists():
                    result = self_test(self.model, self.golden_dir)
                    self.details = result["details"]
                    if not result["ok"]:
                        self.state = "disabled"
                        self.message = f"disabled: golden fold differs from the training PDB ({result['message']})"
                        log.error("Local ESMFold %s", self.message)
                        return False, self.message
                    self.message = result["message"]
                else:
                    self.model.load()
                    self.message = f"loaded on {self.device} (no golden set to check it)"
            except Exception as exc:
                log.exception("Local ESMFold could not start")
                self.state = "unavailable" if "out of memory" in str(exc).lower() else "disabled"
                self.message = f"could not load: {type(exc).__name__}: {exc}"
                return False, self.message
            self.state = "ready"
            log.info("Local ESMFold ready: %s", self.message)
            return True, ""

    def fold(self, sequence: str) -> str:
        return self.model.fold(sequence)
