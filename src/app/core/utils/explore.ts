import { LigandClass, LIGAND_CLASSES } from '../models/prediction.model';
import { ProteinRow, ResidueStatus } from '../models/explore.model';

/** '0101' -> [false, true, false, true] */
export function bitsToBooleans(bits: string): boolean[] {
  return Array.from(bits, c => c === '1');
}

export function residueStatus(truth: boolean[], call: boolean[]): ResidueStatus[] {
  return truth.map((t, i) => (t ? (call[i] ? 'TP' : 'FN') : (call[i] ? 'FP' : 'TN')));
}

/** The ligand classes this protein really has a site for, in display order. */
export function ligandsOf(protein: ProteinRow): LigandClass[] {
  return LIGAND_CLASSES.map(l => l.value).filter(l => (protein.ligands[l] ?? 0) > 0);
}

/** Keep the requested ligand when the protein has it, else its first one. */
export function validLigand(protein: ProteinRow, wanted: LigandClass | null): LigandClass {
  const available = ligandsOf(protein);
  return wanted && available.includes(wanted) ? wanted : available[0];
}

/** The name to show: the protein name, or the sequence when no name could be found. */
export function displayName(protein: ProteinRow): string {
  return protein.name ?? protein.sequence;
}

const SEQUENCE_QUERY = /^[ACDEFGHIKLMNPQRSTVWY]{4,}$/;

/** Search by name, accession, gene or organism; a run of 4+ amino-acid letters also searches the sequence. */
export function matchesQuery(protein: ProteinRow, query: string): boolean {
  const q = query.trim();
  if (!q) {
    return true;
  }
  const lower = q.toLowerCase();
  const text = `${protein.name ?? ''} ${protein.id} ${protein.gene ?? ''} ${protein.organism ?? ''}`.toLowerCase();
  if (text.includes(lower)) {
    return true;
  }
  const upper = q.toUpperCase();
  return SEQUENCE_QUERY.test(upper) && protein.sequence.includes(upper);
}
