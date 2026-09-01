import { ProteinStructure, ProteinRepresentation, BindingResidue } from '../models/protein-structure.model';

export interface ResidueSelection {
  chainId: string;
  residueNumber: number;
}

export interface MolecularViewerAdapter {
  /**
   * Initialize the viewer in the given container
   */
  initialize(container: HTMLElement): Promise<void>;

  /**
   * Load a protein structure
   */
  loadStructure(structure: ProteinStructure): Promise<void>;

  /**
   * Load structure from PDB data
   */
  loadPDB(pdbData: string): Promise<void>;

  /**
   * Clear the current structure
   */
  clear(): void;

  /**
   * Reset camera to default view
   */
  resetCamera(): void;

  /**
   * Zoom in
   */
  zoomIn(): void;

  /**
   * Zoom out
   */
  zoomOut(): void;

  /**
   * Center camera on a specific residue
   */
  centerOnResidue(chainId: string, residueNumber: number): void;

  /**
   * Select a residue
   */
  selectResidue(chainId: string, residueNumber: number): void;

  /**
   * Clear selection
   */
  clearSelection(): void;

  /**
   * Highlight binding residues
   */
  highlightResidues(residues: BindingResidue[]): void;

  /**
   * Set protein representation
   */
  setRepresentation(representation: ProteinRepresentation): void;

  /**
   * Toggle surface visibility
   */
  toggleSurface(visible: boolean): void;

  /**
   * Toggle binding site visibility
   */
  toggleBindingSite(visible: boolean): void;

  /**
   * Toggle prediction visualization
   */
  togglePredictions(visible: boolean): void;

  /**
   * Toggle residue labels
   */
  toggleLabels(visible: boolean): void;

  /**
   * Toggle ligand visibility
   */
  toggleLigands(visible: boolean): void;

  /**
   * Toggle metal ions visibility
   */
  toggleMetals(visible: boolean): void;

  /**
   * Focus on binding pocket
   */
  focusBindingPocket(residues: BindingResidue[]): void;

  /**
   * Color residues by confidence
   */
  colorByConfidence(residues: BindingResidue[]): void;

  /**
   * Set background color
   */
  setBackgroundColor(color: string): void;

  /**
   * Dispose and cleanup
   */
  dispose(): void;

  /**
   * Get current camera position (for saving state)
   */
  getCameraState(): any;

  /**
   * Restore camera position
   */
  setCameraState(state: any): void;

  /**
   * Handle resize event
   */
  handleResize(): void;
}
