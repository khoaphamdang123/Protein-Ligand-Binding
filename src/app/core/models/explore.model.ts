import { LigandClass } from './prediction.model';

/**
 * Static data of the Explore page: public/explore-data, built and checked against the published numbers by
 * backend/scripts/explore_data/build.py.
 */

export type ResidueStatus = 'TP' | 'TN' | 'FP' | 'FN';

export type DatasetId = 'TestSet300' | 'TestSetNew46';
export type ModelId = 'adabind' | 'bindEmbed21DL' | 'bindNode24';

/** Display order: the project's model first. */
export const MODEL_IDS: ModelId[] = ['adabind', 'bindEmbed21DL', 'bindNode24'];

export interface ExploreMetrics {
  AUPRC: number;
  AUROC: number;
  precision: number;
  recall: number;
  F1: number;
  MCC: number;
  TP: number;
  FP: number;
  TN: number;
  FN: number;
}

export interface DatasetMetrics extends ExploreMetrics {
  threshold: number;
  n_residues: number;
  n_positive: number;
}

/** One protein in the picker. `ligands` holds only the classes it has a site for, with the number of residues. */
export interface ProteinRow {
  id: string;
  split: DatasetId;
  length: number;
  name: string | null;       // null: no name found, the sequence is shown instead
  nameSource: string;
  nameNote: string | null;
  gene: string | null;
  organism: string | null;
  sequence: string;
  ligands: Partial<Record<LigandClass, number>>;
}

export interface ExploreIndex {
  generated: string;
  checks_passed: number;
  datasets: { id: DatasetId; label: string; proteins: number; description: string }[];
  ligands: Record<LigandClass, { label: string; baselineOutput: string }>;
  models: Record<ModelId, { label: string; thresholds: Record<LigandClass, number>; note: string }>;
  notes: { thresholds: string; dnaRna: string; labels: string; structure: string };
  summary: Record<DatasetId, Record<LigandClass, { n_proteins_with_site: number; models: Record<ModelId, DatasetMetrics> }>>;
  /** What each test set opens on: AdaBind's highest MCC, the larger site on ties. */
  featured: Record<DatasetId, { protein: string; ligand: LigandClass; MCC: number; TP: number; FP: number; FN: number }>;
  proteins: ProteinRow[];
}

/** One model on one protein: per ligand class, probabilities, calls ('0101...') and metrics (full precision). */
export interface ProteinModelData {
  prob: Record<LigandClass, number[]>;
  call: Record<LigandClass, string>;
  metrics: Partial<Record<LigandClass, ExploreMetrics>>;
}

export interface ProteinDoc {
  id: string;
  split: DatasetId;
  sequence: string;
  plddt: number[];
  labels: Record<LigandClass, string>;   // ground truth, '0101...'
  models: Record<ModelId, ProteinModelData>;
}

export interface LoadedProtein {
  doc: ProteinDoc;
  pdb: string;
}
