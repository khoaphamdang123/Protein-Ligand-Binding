"""Real self-hosted ESMFold on the golden set (loads 8.4 GB: opt-in with BINDSITE_TEST_ESMFOLD=1)."""
import os

import pytest

from app.esmfold_local import LocalEsmFold, self_test

from .conftest import GOLDEN_DIR, WEIGHTS_DIR, requires_golden

pytestmark = [
    requires_golden,
    pytest.mark.skipif(os.environ.get("BINDSITE_TEST_ESMFOLD") != "1", reason="set BINDSITE_TEST_ESMFOLD=1"),
    pytest.mark.skipif(not (WEIGHTS_DIR / "esmfold_v1" / "pytorch_model.bin").exists(), reason="no esmfold_v1"),
]


def test_local_esmfold_reproduces_a_training_pdb():
    import torch

    local = LocalEsmFold(WEIGHTS_DIR / "esmfold_v1", device="cuda" if torch.cuda.is_available() else "cpu")
    result = self_test(local, GOLDEN_DIR)
    assert result["ok"], result["message"]
    assert torch.backends.cuda.matmul.allow_tf32 is False  # TF32 only inside the fold
