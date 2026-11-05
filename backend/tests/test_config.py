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
    assert set(Settings.from_env().all_devices().values()) == {want}
    env.setenv("BINDSITE_DEVICE", "cpu")
    assert set(Settings.from_env().all_devices().values()) == {"cpu"}


def test_bad_device_is_rejected(env):
    env.setenv("BINDSITE_DEVICE_ESM2", "tpu")
    with pytest.raises(ValueError, match="device for esm2 must be cpu, cuda or cuda:N"):
        Settings.from_env().device_for("esm2")


def test_length_limit_follows_the_structure_source(env, tmp_path):
    s = Settings.from_env()
    assert s.esmfold_local == "off" and s.max_length == API_MAX_LENGTH  # no esmfold_v1 -> API only
    (tmp_path / "esmfold_v1").mkdir()
    (tmp_path / "esmfold_v1" / "pytorch_model.bin").write_bytes(b"x")
    s = Settings.from_env()
    assert s.esmfold_local == "auto" and s.max_length == LOCAL_MAX_LENGTH
    env.setenv("BINDSITE_ESMFOLD_LOCAL", "off")
    assert Settings.from_env().max_length == API_MAX_LENGTH
    env.setenv("BINDSITE_ESMFOLD_LOCAL", "maybe")
    with pytest.raises(ValueError, match="auto or off"):
        Settings.from_env()
