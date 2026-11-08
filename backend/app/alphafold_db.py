"""AlphaFold DB lookup by exact sequence, for bindNode24 in the compare mode of the Predict page.

bindNode24 was published on AlphaFold structures, so it gets the AlphaFold DB model of the sequence when there is one,
and the structure AdaBind used otherwise. AlphaFold DB only holds precomputed models: it answers for a sequence that
equals one of its entries exactly (one changed residue gives nothing), it never folds a new one.

Several entries can share a sequence. The pick is fixed: the entry of the protein's own UniProt accession when the
caller knows it (from a FASTA header), then UniProt-style ids (AF-<accession>-F<n>), then the oldest model, then the id.
On 40 TestSet300 proteins the own-accession entry was the closest to the AlphaFold files bindNode24 was scored on
(median Cα RMSD 0.79 Å; the best entry 0.77 Å; none identical: those files predate today's AlphaFold DB models).
Answers are cached on disk, "not found" too (for a week); network failures are not cached.
"""
import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from .errors import EsmFoldError
from .esmfold import validate_structure

log = logging.getLogger("bindsite.alphafold")

UNIPROT_STYLE = re.compile(r"^AF-[A-Z0-9]{6,10}-F\d+$")
ACCESSION = re.compile(r"^[A-Z0-9]{6,10}$")
NOT_FOUND_TTL_S = 7 * 24 * 3600


@dataclass
class AlphaFoldModel:
    pdb: str
    entry: str          # e.g. AF-Q9K943-F1
    version: str        # file version, e.g. v6
    created: str
    page: str           # AlphaFold DB page of the entry
    plddt: list[float]  # 0-1


class AlphaFoldDB:
    def __init__(self, base_url: str, cache_dir: Path, timeout: float = 20.0,
                 transport: httpx.BaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self.cache_dir = Path(cache_dir) / "alphafold"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._client = httpx.Client(timeout=timeout, transport=transport, follow_redirects=True,
                                    headers={"User-Agent": "bindsite-explorer"})

    def close(self) -> None:
        self._client.close()

    def lookup(self, sequence: str, accession: str | None = None) -> tuple[AlphaFoldModel | None, str | None]:
        """(model, None), or (None, why there is none). Never raises: the caller falls back to its own structure."""
        accession = accession.upper() if accession and ACCESSION.match(accession.upper()) else None
        key = hashlib.sha1(f"{sequence}|{accession or ''}".encode()).hexdigest()
        meta_file, pdb_file = self.cache_dir / f"{key}.json", self.cache_dir / f"{key}.pdb"
        if meta_file.exists():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if meta.get("found") and pdb_file.exists():
                try:
                    return self._model(pdb_file.read_text(encoding="utf-8"), sequence, meta), None
                except EsmFoldError:
                    log.warning("Cached AlphaFold DB file %s no longer matches; asking again", pdb_file.name)
            elif not meta.get("found") and time.time() - meta.get("time", 0) < NOT_FOUND_TTL_S:
                return None, meta["reason"]
        try:
            model, reason = self._ask(sequence, accession)
        except httpx.HTTPError as exc:
            log.warning("AlphaFold DB unreachable (%d aa): %s", len(sequence), exc)
            return None, f"AlphaFold DB could not be reached ({type(exc).__name__})"
        if model is None:
            self._write(meta_file, {"found": False, "reason": reason, "time": time.time()})
            return None, reason
        tmp = pdb_file.with_suffix(".tmp")
        tmp.write_text(model.pdb, encoding="utf-8")
        os.replace(tmp, pdb_file)
        self._write(meta_file, {"found": True, "entry": model.entry, "version": model.version, "created": model.created,
                                "page": model.page, "time": time.time()})
        return model, None

    def _ask(self, sequence: str, accession: str | None) -> tuple[AlphaFoldModel | None, str | None]:
        r = self._client.get(f"{self.base_url}/api/sequence/summary", params={"id": sequence, "type": "sequence"})
        if r.status_code == 404:
            return None, "not in AlphaFold DB"
        r.raise_for_status()
        candidates = [s["summary"] for s in r.json().get("structures", [])
                      if s.get("summary", {}).get("provider") == "AlphaFold DB"
                      and s["summary"].get("sequence_identity") == 1.0 and s["summary"].get("coverage") == 1.0]
        own = re.compile(rf"^AF-{accession}-F\d+$") if accession else None
        candidates.sort(key=lambda c: (not (own and own.match(c.get("model_identifier", ""))),
                                       not UNIPROT_STYLE.match(c.get("model_identifier", "")), c.get("created") or "",
                                       c.get("model_identifier", "")))
        for c in candidates:
            url = re.sub(r"\.(cif|bcif)$", ".pdb", c.get("model_url", ""))
            f = self._client.get(url)
            if f.status_code != 200:
                continue
            version = re.search(r"model_(v\d+)\.pdb$", url)
            meta = {"entry": c["model_identifier"], "version": version.group(1) if version else "",
                    "created": c.get("created") or "", "page": c.get("model_page_url") or ""}
            try:
                return self._model(f.text, sequence, meta), None
            except EsmFoldError as exc:
                log.warning("AlphaFold DB %s does not match the sequence: %s", c["model_identifier"], exc.message)
        return None, "AlphaFold DB has no PDB file that matches this sequence"

    @staticmethod
    def _model(pdb: str, sequence: str, meta: dict) -> AlphaFoldModel:
        plddt = validate_structure(pdb, sequence)  # chain A == sequence; pLDDT 0-100 -> 0-1
        return AlphaFoldModel(pdb=pdb, entry=meta["entry"], version=meta.get("version", ""),
                              created=meta.get("created", ""), page=meta.get("page", ""), plddt=plddt)

    @staticmethod
    def _write(path: Path, data: dict) -> None:
        tmp = path.with_suffix(".tmpjson")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, path)
