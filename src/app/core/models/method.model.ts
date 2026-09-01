export type PredictionMethod = 'ESM-ORION' | 'BindNode24' | 'bindEmbed21DL' | 'P2Rank';

export interface MethodInfo {
  id: PredictionMethod;
  name: string;
  description: string;
  year: number;
  paper?: string;
}

export const METHODS_INFO: MethodInfo[] = [
  {
    id: 'ESM-ORION',
    name: 'ESM-ORION',
    description: 'Transformer-based protein language model for binding site prediction',
    year: 2024,
    paper: 'https://arxiv.org/abs/...'
  },
  {
    id: 'BindNode24',
    name: 'BindNode24',
    description: 'Graph neural network approach for binding site prediction',
    year: 2024,
    paper: 'https://doi.org/...'
  },
  {
    id: 'bindEmbed21DL',
    name: 'bindEmbed21DL',
    description: 'Deep learning embedding-based binding site prediction',
    year: 2021,
    paper: 'https://doi.org/...'
  },
  {
    id: 'P2Rank',
    name: 'P2Rank',
    description: 'Machine learning based ligandability prediction',
    year: 2018,
    paper: 'https://doi.org/...'
  }
];
