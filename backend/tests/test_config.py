"""Per-model device choice and the structure-source dependent length limit."""
import pytest

from app.config import API_MAX_LENGTH, DEVICE_KEYS, LOCAL_MAX_LENGTH, Settings

ENV = [f"BINDSITE_DEVICE_{k.upper()}" for k in DEVICE_KEYS] + ["BINDSITE_DEVICE", "BINDSITE_MAX_LENGTH",
                                                               "BINDSITE_ESMFOLD_LOCAL", "BINDSITE_WEIGHTS_DIR"]


@pytest.fixture
def env(monkeypatch, tmp_path):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("BINDSITE_WEIGHTS_DIR", str(tmp_path))
    return monkeypatch


def test_every_model_can_be_put_on_cpu_or_gpu(env):
    env.setenv("BINDSITE_DEVICE", "cuda")
    env.setenv("BINDSITE_DEVICE_ESMFOLD", "cpu")
    env.setenv("BINDSITE_DEVICE_PROTT5", "CPU")
    env.setenv("BINDSITE_DEVICE_MODELS", "cuda:0")
    assert Settings.from_env().all_devices() == {
        "esmfold": "cpu", "esm2": "cuda", "prott5": "cpu", "esmif": "cuda", "models": "cuda:0"}


def test_default_device_is_cuda_when_available(env):
    import torch

    want = "cuda" if torch.cuda.is_available() else "cpu"
    devices = Settings.from_env().all_devices()
    assert devices.pop("esmfold") == "cuda" and set(devices.values()) == {want}
    env.setenv("BINDSITE_DEVICE", "cpu")  # every model on the CPU; self-hosted ESMFold stays the GPU fallback
    devices = Settings.from_env().all_devices()
    assert devices.pop("esmfold") == "cuda" and set(devices.values()) == {"cpu"}


def test_bad_device_is_rejected(env):
    env.setenv("BINDSITE_DEVICE_ESM2", "tpu")
    with pytest.raises(ValueError, match="device for esm2 must be cpu, cuda or cuda:N"):
        Settings.from_env().device_for("esm2")


def test_length_limit_is_the_models_limit(env, tmp_path):
    # Beyond the API's 400 aa a structure must be precomputed, folded on a free GPU or uploaded.
    s = Settings.from_env()
    assert s.esmfold_local == "off" and s.max_length == LOCAL_MAX_LENGTH > API_MAX_LENGTH
    assert s.esmfold_files_dir == tmp_path / "esmfold_files" and s.esmfold_min_free_gb == 10
    (tmp_path / "esmfold_v1").mkdir()
    (tmp_path / "esmfold_v1" / "pytorch_model.bin").write_bytes(b"x")
    s = Settings.from_env()
    assert s.esmfold_local == "auto" and s.max_length == LOCAL_MAX_LENGTH
    env.setenv("BINDSITE_ESMFOLD_LOCAL", "off")
    assert Settings.from_env().esmfold_local == "off"
    env.setenv("BINDSITE_ESMFOLD_LOCAL", "maybe")
    with pytest.raises(ValueError, match="auto or off"):
        Settings.from_env()
