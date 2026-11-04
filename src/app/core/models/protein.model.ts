export interface Protein {
  id: string;
  name: string;
  pdbId: string;
  sequence: string;
  length: number;
  resolution?: number;
  experimentalMethod?: string;
  organism?: string;
  description?: string;
}

export interface Residue {
  position: number;
  aminoAcid: string;
  chainId: string;
  isBinding: boolean;
  predictionScore?: number;
  experimentalBinding?: boolean;
}

export interface BindingSite {
  id: string;
  proteinId: string;
  residues: Residue[];
  ligandName?: string;
  confidence: number;
  method: string;
}

export interface PredictionResult {
  id: string;
  proteinId: string;
  method: string;
  bindingSites: BindingSite[];
  predictedResidues: number[];
  confidence: number;
  timestamp: string;
}



export interface BenchmarkMetrics {
  proteinId: string;
  method: string;
  precision: number;
  recall: number;
  f1Score: number;
  mcc: number; // Matthews Correlation Coefficient
  accuracy: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

export interface ComparisonData {
  protein: Protein;
  methods: {
    method: string;
    prediction: PredictionResult;
    metrics: BenchmarkMetrics;
  }[];
  groundTruth?: number[];
}
