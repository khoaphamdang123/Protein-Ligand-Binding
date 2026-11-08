import { ProteinRow } from '../models/explore.model';
import { bitsToBooleans, displayName, ligandsOf, matchesQuery, residueStatus, validLigand } from './explore';

const row = (over: Partial<ProteinRow> = {}): ProteinRow => ({
  id: 'P06956', split: 'TestSet300', length: 8, name: 'Integrase', nameSource: 'uniprot', nameNote: null,
  gene: 'xerC', organism: 'Escherichia coli', sequence: 'MSNLLTVH', ligands: { metal: 2, dna: 4 }, ...over,
});

describe('explore helpers', () => {
  it('reads residue bits', () => {
    expect(bitsToBooleans('0110')).toEqual([false, true, true, false]);
  });

  it('classifies every residue against the ground truth', () => {
    expect(residueStatus([true, true, false, false], [true, false, true, false])).toEqual(['TP', 'FN', 'FP', 'TN']);
  });

  it('offers only the ligand classes the protein has, in display order', () => {
    expect(ligandsOf(row({ ligands: { rna: 1, metal: 3 } }))).toEqual(['metal', 'rna']);
    expect(ligandsOf(row({ ligands: { small: 0, dna: 2 } }))).toEqual(['dna']);
  });

  it('keeps the ligand when available and falls back to the first one otherwise', () => {
    expect(validLigand(row(), 'dna')).toBe('dna');
    expect(validLigand(row(), 'rna')).toBe('metal');
    expect(validLigand(row(), null)).toBe('metal');
  });

  it('shows the sequence when no name was found', () => {
    expect(displayName(row())).toBe('Integrase');
    expect(displayName(row({ name: null }))).toBe('MSNLLTVH');
  });

  it('searches name, accession, gene, organism and sequence', () => {
    expect(matchesQuery(row(), '')).toBe(true);
    expect(matchesQuery(row(), 'integ')).toBe(true);
    expect(matchesQuery(row(), 'p06956')).toBe(true);
    expect(matchesQuery(row(), 'XERC')).toBe(true);
    expect(matchesQuery(row(), 'coli')).toBe(true);
    expect(matchesQuery(row(), 'nllt')).toBe(true);
    expect(matchesQuery(row(), 'nl')).toBe(false);   // too short to be a sequence fragment
    expect(matchesQuery(row(), 'kinase')).toBe(false);
  });
});
