import { DatasetType } from './dataset.model';
import { PredictionMethod } from './method.model';
import { BindingType } from './prediction.model';

/**
 * A protein entry in the Explore browser.
 * Structures are ESMFold *predictions* (no experimental resolution), so we
 * carry pLDDT per residue instead of a resolution value.
 */
export interface ExploreProtein {
  id: string;
  uniprotId: string;
  pdbId: string;
  name: string;
  length: number;
  sequence: string;
  bindingType: BindingType;
  dataset: DatasetType;
  source: 'ESMFold';
}

export type ResidueStatus = 'TP' | 'TN' | 'FP' | 'FN';

export interface ExploreResidue {
  position: number; // 1-based
  aminoAcid: string;
  probability: number; // prediction score 0-1
  predicted: boolean; // probability >= threshold
  groundTruth: boolean; // experimental binding
  status: ResidueStatus;
  plddt: number; // 0-1
}

export interface ExploreMetrics {
  precision: number;
  recall: number;
  f1: number;
  mcc: number;
  accuracy: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

/**
 * Everything the viewer + sequence track need for one protein + method.
 * Mirror of the PredictResult shape (predict page) plus ground truth, so the
 * Explore page can reuse the same prediction-viewer / probability-track stack.
 */
export interface ExploreResult {
  protein: ExploreProtein;
  method: PredictionMethod;
  threshold: number;
  probability: number[];
  binding: boolean[]; // predicted (probability >= threshold)
  groundTruth: boolean[]; // experimental binding
  status: ResidueStatus[];
  plddt: number[];
  pdb: string;
  residues: ExploreResidue[];
  metrics: ExploreMetrics;
}

export type ExploreDatasetFilter = DatasetType | 'all';

export interface ExploreFilters {
  dataset: ExploreDatasetFilter;
  method: PredictionMethod;
  bindingType: BindingType | 'all';
  searchQuery: string;
}
