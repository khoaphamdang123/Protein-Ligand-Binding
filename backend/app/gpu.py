"""One lock for all GPU work of this process (local ESMFold, ESM-2, ProtT5, the checkpoints).

Requests are served from a thread pool; serialising GPU work keeps memory bounded on one GPU and lets local
ESMFold switch TF32 on for its own forward pass without affecting the other models.
"""
import threading

GPU_LOCK = threading.RLock()
