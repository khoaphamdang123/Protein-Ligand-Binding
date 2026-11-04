"""Minimal PDB reading: residue sequence and per-residue pLDDT (B-factor of CA) of one chain."""
from dataclasses import dataclass

THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G",
    "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S",
    "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}


@dataclass
class ChainResidues:
    sequence: str          # one letter per residue, '?' for non-standard residue names
    plddt: list[float]     # B-factor of CA (or of the first atom if CA is missing)


def read_chain(pdb_text: str, chain_id: str = "A") -> ChainResidues:
    """Residues of `chain_id` in file order (first MODEL only, ATOM records only)."""
    order: list[tuple[str, str]] = []
    names: dict[tuple[str, str], str] = {}
    bfactors: dict[tuple[str, str], float] = {}

    for line in pdb_text.splitlines():
        if line.startswith("ENDMDL"):
            break
        if not line.startswith("ATOM") or len(line) < 66 or line[21] != chain_id:
            continue
        key = (line[22:26], line[26])  # residue number + insertion code
        atom_name = line[12:16].strip()
        bfactor = float(line[60:66])
        if key not in names:
            order.append(key)
            names[key] = line[17:20].strip()
            bfactors[key] = bfactor
        if atom_name == "CA":
            bfactors[key] = bfactor

    return ChainResidues(
        sequence="".join(THREE_TO_ONE.get(names[key], "?") for key in order),
        plddt=[bfactors[key] for key in order],
    )
