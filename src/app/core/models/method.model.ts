export type PredictionMethod = 'AdaBind' | 'bindEmbed21DL' | 'bindNode24';

export interface MethodInfo {
  id: PredictionMethod;
  name: string;
  description: string;
  year: number;
  paper?: string;
}

export const METHODS_INFO: MethodInfo[] = [
  {
    id: 'AdaBind',
    name: 'AdaBind',
    description:
      'Ligand-class-specific multimodal representations coupling ESM-2 embeddings with coordination and pocket descriptors',
    year: 2026,
    paper: 'https://huggingface.co/spaces/Quangg/Protein-Ligand-Binding'
  },
  {
    id: 'bindEmbed21DL',
    name: 'bindEmbed21DL',
    description:
      'Per-residue ProtT5 embeddings combined with a shallow convolutional network',
    year: 2021,
    paper: 'https://doi.org/10.1038/s41598-021-03431-4'
  },
  {
    id: 'bindNode24',
    name: 'bindNode24',
    description:
      'Graph neural network incorporating structural proximity for binding-residue prediction',
    year: 2025,
    paper: 'https://doi.org/10.1016/j.csbj.2025.02.042'
  }
];
