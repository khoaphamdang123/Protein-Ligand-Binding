"""Look up a readable protein name for every TestSet300 / TestSetNew46 accession.

    backend/.venv/bin/python backend/scripts/explore_data/fetch_names.py

Order per accession:
  1. UniProtKB recommended name (else the submitted name)
  2. inactive entry that was merged / demerged -> name of the entry it now lives in
  3. UniParc (sequence archive) -> first protein name recorded for that accession
  4. nothing found -> no name (the page then shows the sequence instead)
Writes explore_sources/names/protein_names.json. Re-run only when the id lists change.
"""
import json
import sys
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[3]
CANON = REPO / "baselines_2124" / "canonical"
OUT = REPO / "explore_sources" / "names" / "protein_names.json"
API = "https://rest.uniprot.org"
client = httpx.Client(timeout=120, headers={"User-Agent": "bindsite-explorer/1.0 (protein name lookup)"})


def kb_name(entry: dict) -> str | None:
    pd = entry.get("proteinDescription") or {}
    if "recommendedName" in pd:
        return pd["recommendedName"]["fullName"]["value"]
    if pd.get("submissionNames"):
        return pd["submissionNames"][0]["fullName"]["value"]
    return None


def kb_record(entry: dict, source: str, note: str | None = None) -> dict:
    genes = entry.get("genes") or [{}]
    return {
        "name": kb_name(entry),
        "gene": (genes[0].get("geneName") or {}).get("value"),
        "organism": (entry.get("organism") or {}).get("scientificName"),
        "source": source,
        "note": note,
    }


def fetch_kb(accessions: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(accessions), 200):
        r = client.get(f"{API}/uniprotkb/accessions", params={
            "accessions": ",".join(accessions[i:i + 200]),
            "fields": "accession,protein_name,gene_primary,organism_name", "format": "json"})
        r.raise_for_status()
        for e in r.json()["results"]:
            out[e["primaryAccession"]] = e
    return out


def uniparc(acc: str) -> dict | None:
    r = client.get(f"{API}/uniparc/search", params={"query": acc, "fields": "upi,protein,organism", "format": "tsv", "size": 1})
    r.raise_for_status()
    rows = [l.split("\t") for l in r.text.strip().splitlines()[1:]]
    if not rows or len(rows[0]) < 2 or not rows[0][1].strip():
        return None
    upi, names = rows[0][0], rows[0][1]
    organism = rows[0][2].split(";")[0].strip() if len(rows[0]) > 2 else None
    return {"name": names.split(";")[0].strip(), "gene": None, "organism": organism,
            "source": "uniparc", "note": f"UniProtKB entry no longer active; name from UniParc {upi}"}


def main() -> int:
    ids = []
    for split in ("TestSet300", "TestSetNew46"):
        ids += [l.strip() for l in open(CANON / f"{split}_ids.txt") if l.strip()]
    kb = fetch_kb(ids)
    names = {}
    for acc in ids:
        if acc in kb and kb_name(kb[acc]):
            names[acc] = kb_record(kb[acc], "uniprot")
            continue
        entry = client.get(f"{API}/uniprotkb/{acc}", params={"format": "json"}).json()
        reason = entry.get("inactiveReason") or {}
        targets = reason.get("mergeDemergeTo") or []
        rec = None
        if targets:
            live = fetch_kb(targets)
            t = next((x for x in targets if x in live and kb_name(live[x])), None)
            if t:
                rec = kb_record(live[t], "uniprot-" + reason.get("inactiveReasonType", "moved").lower(),
                                f"{acc} was {reason.get('inactiveReasonType', 'moved').lower()} into {t}")
        rec = rec or uniparc(acc) or {"name": None, "gene": None, "organism": None, "source": "none",
                                      "note": f"no name found ({reason.get('inactiveReasonType', 'not in UniProtKB')})"}
        names[acc] = rec
        print(f"{acc}: {rec['source']} -> {rec['name']}  ({rec['note']})")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(names, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    by = {}
    for r in names.values():
        by[r["source"]] = by.get(r["source"], 0) + 1
    print(f"{len(names)} accessions -> {OUT}  {by}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
