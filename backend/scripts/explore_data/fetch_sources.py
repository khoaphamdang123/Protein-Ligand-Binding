"""Download the Explore page's raw inputs from Google Drive into <repo>/explore_sources and check sha256.

    backend/.venv/bin/python backend/scripts/explore_data/fetch_sources.py [--dest explore_sources]

Files already present with the right hash are skipped. Any hash mismatch is an error (nothing is trusted).
"""
import argparse
import hashlib
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import SOURCES  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
URL = "https://drive.usercontent.google.com/download"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=str(REPO / "explore_sources"))
    dest = Path(ap.parse_args().dest)
    client = httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60, read=300), headers={"User-Agent": "Mozilla/5.0"})
    bad = 0
    for rel, (fid, digest, size) in SOURCES.items():
        out = dest / rel
        if out.is_file() and out.stat().st_size == size and sha256(out) == digest:
            print(f"ok    {rel}")
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.name + ".part")
        for attempt in range(5):
            try:
                with client.stream("GET", URL, params={"id": fid, "export": "download", "confirm": "t"}) as r:
                    r.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in r.iter_bytes(1 << 16):
                            f.write(chunk)
                break
            except httpx.HTTPError as e:
                print(f"retry {rel}: {e}")
                time.sleep(2 ** attempt)
        if tmp.is_file() and sha256(tmp) == digest:
            tmp.replace(out)
            print(f"fetch {rel}")
        else:
            bad += 1
            print(f"FAIL  {rel}: sha256 mismatch or download failed", file=sys.stderr)
            tmp.unlink(missing_ok=True)
    print(f"{len(SOURCES) - bad}/{len(SOURCES)} files ok in {dest}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
