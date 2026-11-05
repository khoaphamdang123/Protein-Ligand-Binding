#!/usr/bin/env bash
# Build the two Python environments of the BindSite backend (Linux).
#
#   bash backend/setup_env.sh [--cuda cu126|cpu] [--python python3.11] [--esmif-python python3.10] [--only main|esmif]
#
#   backend/.venv        FastAPI + pbind.Predictor (ESM-2, ProtT5, features, checkpoints)   numpy >= 2
#   backend/.venv-esmif  ESM-IF embedding worker only (fair-esm 2.0.0, torch 2.4.1)          numpy <  2
#
# The two numpy constraints conflict, hence two environments; the backend talks to ESM-IF through a
# long-lived worker process (scripts/esmif_worker.py) and .npy files.
# If no python3.10 is on PATH, the ESM-IF environment is created with conda (python=3.10).
set -euo pipefail

BACKEND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$BACKEND/.." && pwd)"
ADABIND="$REPO/adabind"
CUDA=cu126
PY=python3.11
EPY=python3.10
ONLY=all

while [ $# -gt 0 ]; do
  case "$1" in
    --cuda)         CUDA="$2"; shift 2 ;;
    --python)       PY="$2"; shift 2 ;;
    --esmif-python) EPY="$2"; shift 2 ;;
    --only)         ONLY="$2"; shift 2 ;;
    -h|--help)      sed -n '2,13p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

# ESM-IF env: torch 2.4.1 has no cu126 build; cu121 runs on any driver >= 525.
if [ "$CUDA" = cpu ]; then ECUDA=cpu; else ECUDA=cu121; fi

setup_main() {
  echo "=== backend/.venv (main: FastAPI + pbind) — torch $CUDA ==="
  [ -d "$ADABIND/pbind" ] || { echo "!! $ADABIND/pbind missing: unzip adabind_*.zip into $ADABIND"; exit 1; }
  "$PY" -m venv "$BACKEND/.venv"
  local pip="$BACKEND/.venv/bin/pip"
  "$pip" install -q --upgrade pip setuptools wheel
  if [ "$CUDA" = cu126 ]; then
    "$pip" install -q --index-url "https://download.pytorch.org/whl/cu126" "torch==2.14.1"
  else
    "$pip" install -q --index-url "https://download.pytorch.org/whl/$CUDA" torch
  fi
  "$pip" install -q -r "$BACKEND/requirements.txt"
  "$pip" install -q -e "$ADABIND"
  "$BACKEND/.venv/bin/python" - <<'PY'
import numpy, torch, transformers
from pbind.inference.predictor import TASKS
print(f"  OK  torch {torch.__version__} cuda={torch.cuda.is_available()} | numpy {numpy.__version__} | "
      f"transformers {transformers.__version__} | pbind tasks {', '.join(TASKS)}")
PY
}

setup_esmif() {
  echo "=== backend/.venv-esmif (ESM-IF only) — torch 2.4.1 $ECUDA ==="
  if command -v "$EPY" >/dev/null 2>&1; then
    "$EPY" -m venv "$BACKEND/.venv-esmif"
  elif command -v conda >/dev/null 2>&1; then
    echo "  $EPY not on PATH: creating a conda environment with python=3.10"
    conda create -y -q -p "$BACKEND/.venv-esmif" python=3.10 pip >/dev/null
  else
    echo "!! need python3.10 (or conda) for fair-esm 2.0.0 + torch 2.4.1"; exit 1
  fi
  local pip="$BACKEND/.venv-esmif/bin/python -m pip"
  $pip install -q --upgrade "pip<25" setuptools wheel
  $pip install -q --index-url "https://download.pytorch.org/whl/$ECUDA" "torch==2.4.1"
  $pip install -q -f "https://data.pyg.org/whl/torch-2.4.0+$ECUDA.html" "torch-scatter==2.1.2"
  $pip install -q -r "$BACKEND/requirements-esmif.txt"
  "$BACKEND/.venv-esmif/bin/python" - <<'PY'
import numpy, torch, esm, esm.inverse_folding, torch_scatter
assert numpy.__version__ < "2", numpy.__version__
print(f"  OK  torch {torch.__version__} cuda={torch.cuda.is_available()} | numpy {numpy.__version__} | "
      f"fair-esm {esm.__version__} | torch-scatter {torch_scatter.__version__}")
PY
}

case "$ONLY" in
  main)  setup_main ;;
  esmif) setup_esmif ;;
  all)   setup_main; setup_esmif ;;
  *)     echo "--only must be main or esmif"; exit 2 ;;
esac
echo "done."
