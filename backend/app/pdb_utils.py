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


def superpose(pdb_text: str, mobile_ca, target_ca) -> tuple[str, float]:
    """Move every atom of `pdb_text` by the rigid motion that puts `mobile_ca` on `target_ca` (Kabsch, same residues in
    the same order). Distances inside the structure do not change. Returns (moved PDB text, Cα RMSD after the move)."""
    import numpy as np

    p, q = np.asarray(mobile_ca, float), np.asarray(target_ca, float)
    pc, qc = p.mean(0), q.mean(0)
    u, _, vt = np.linalg.svd((p - pc).T @ (q - qc))
    d = np.sign(np.linalg.det(u @ vt))
    rot = u @ np.diag([1.0, 1.0, d]) @ vt
    rmsd = float(np.sqrt((((p - pc) @ rot - (q - qc)) ** 2).sum(1).mean()))
    out = []
    for line in pdb_text.splitlines():
        if line.startswith(("ATOM", "HETATM")) and len(line) >= 54:
            xyz = (np.array([float(line[30:38]), float(line[38:46]), float(line[46:54])]) - pc) @ rot + qc
            line = f"{line[:30]}{xyz[0]:8.3f}{xyz[1]:8.3f}{xyz[2]:8.3f}{line[54:]}"
        out.append(line)
    return "\n".join(out) + "\n", rmsd
