export interface ProteinStructure {
  proteinId: string;
  pdbId?: string;
  pdbData?: string;
  chains: ProteinChain[];
  residues: ProteinResidue[];
  bindingResidues: BindingResidue[];
  ligands?: Ligand[];
  metalIons?: MetalIon[];
}

export interface ProteinChain {
  id: string;
  length: number;
  sequence?: string;
}

export interface ProteinResidue {
  position: number;
  chainId: string;
  aminoAcid: string;
  residueNumber?: number;
}

export interface BindingResidue extends ProteinResidue {
  groundTruth: boolean;
  predicted: boolean;
  confidence: number;
  status: 'TP' | 'TN' | 'FP' | 'FN';
}

export interface Ligand {
  id: string;
  name: string;
  chainId?: string;
  residueNumber?: number;
}

export interface MetalIon {
  element: string;
  chainId?: string;
  residueNumber?: number;
  position?: number;
}

export type ProteinRepresentation = 
  | 'cartoon' 
  | 'surface' 
  | 'ball-stick' 
  | 'backbone'
  | 'ribbon';

export interface ViewerState {
  representation: ProteinRepresentation;
  showBindingSite: boolean;
  showPredictions: boolean;
  showLigands: boolean;
  showMetals: boolean;
  showLabels: boolean;
  colorByConfidence: boolean;
  selectedChain?: string;
}
