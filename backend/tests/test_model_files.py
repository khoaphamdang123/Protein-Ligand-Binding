import hashlib
import json
import shutil

import pytest

from app import model_files

from .conftest import FINAL_MODEL_DIR, WEIGHTS_DIR

requires_models = pytest.mark.skipif(not (FINAL_MODEL_DIR / "manifest.json").exists(), reason="final_model not present")


@requires_models
def test_manifest_version_and_thresholds():
    manifest, version = model_files.load_manifest(FINAL_MODEL_DIR)
    assert version == hashlib.sha1((FINAL_MODEL_DIR / "manifest.json").read_bytes()).hexdigest()
    thresholds = model_files.thresholds(manifest, "final")
    # Integration guide section 1.
    assert thresholds["metal"] == pytest.approx(0.9148, abs=1e-4)
    assert thresholds["nuclear"] == pytest.approx(0.7079, abs=1e-4)
    assert thresholds["small"] == pytest.approx(0.4901, abs=1e-4)
    with pytest.raises(KeyError, match="profile 'nope'"):
        model_files.thresholds(manifest, "nope")


@requires_models
@pytest.mark.parametrize("profile,n_checkpoints", [("final", 80), ("lite", 25)])
def test_real_final_model_matches_manifest(profile, n_checkpoints):
    manifest, _ = model_files.load_manifest(FINAL_MODEL_DIR)
    result = model_files.verify_final_model(manifest, FINAL_MODEL_DIR, profile)
    assert result["missing"] == [] and result["mismatched"] == []
    checkpoints = sum(manifest["profiles"][profile][bt]["n_checkpoints"] for bt in ("metal", "nuclear", "small"))
    assert checkpoints == n_checkpoints  # guide sections 1 and 3.3


@requires_models
def test_corrupted_and_missing_checkpoints_are_reported(tmp_path):
    manifest, _ = model_files.load_manifest(FINAL_MODEL_DIR)
    copy = tmp_path / "final_model"
    shutil.copytree(FINAL_MODEL_DIR / "metal", copy / "metal")
    ckpt = copy / "metal" / "mlp_esmif" / "MLP__ESM__Atomic__Chem__MULTI2__ESMIF__fold1.pt"
    ckpt.write_bytes(ckpt.read_bytes() + b"x")
    (copy / "metal" / "mlp_esmif" / "MLP__ESM__Atomic__Chem__MULTI2__ESMIF__fold2.pt").unlink()

    result = model_files.verify_final_model(manifest, copy, "final")
    assert "metal/mlp_esmif/MLP__ESM__Atomic__Chem__MULTI2__ESMIF__fold1.pt" in result["mismatched"]
    assert "metal/mlp_esmif/MLP__ESM__Atomic__Chem__MULTI2__ESMIF__fold2.pt" in result["missing"]
    assert any(m.startswith("nuclear/") for m in result["missing"])  # not copied at all


def test_foundation_files_missing_or_wrong_size(tmp_path):
    (tmp_path / "esm2_t33_650M_UR50D").mkdir()
    (tmp_path / "esm2_t33_650M_UR50D" / "model.safetensors").write_bytes(b"too small")
    results = model_files.check_foundation_files(tmp_path, "final")
    assert set(results) == {"ESM-2 650M", "ProtT5-XL half", "ESM-IF1", "ESM-IF1 in TORCH_HOME"}
    assert "expected 2609506392" in results["ESM-2 650M"]["message"]
    assert all(r["status"] == "error" for r in results.values())
    assert set(model_files.check_foundation_files(tmp_path, "lite")) == {"ESM-2 650M"}


@pytest.mark.skipif(not (WEIGHTS_DIR / "esm2_t33_650M_UR50D").exists(), reason="weights not present")
def test_real_foundation_files_present():
    results = model_files.check_foundation_files(WEIGHTS_DIR, "final")
    assert {name: r["status"] for name, r in results.items()} == dict.fromkeys(results, "ok"), json.dumps(results)
