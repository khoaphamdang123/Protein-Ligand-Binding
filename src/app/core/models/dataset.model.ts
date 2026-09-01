export type DatasetType = 'TestSet300' | 'TestSet46';

export interface Dataset {
  id: string;
  name: string;
  description: string;
  type: DatasetType;
  proteinCount: number;
  totalBindingResidues: number;
  averageSequenceLength: number;
  evaluatedMethods: number;
  avgSequenceLength: number;
  avgBindingSites: number;
}

export interface DatasetStatistics {
  dataset: DatasetType;
  totalProteins: number;
  totalResidues: number;
  totalBindingResidues: number;
  bindingRatio: number;
  avgProteinLength: number;
  methodPerformance: {
    method: string;
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
  }[];
}
