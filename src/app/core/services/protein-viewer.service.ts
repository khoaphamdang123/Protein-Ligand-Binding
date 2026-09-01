import { Injectable, signal, effect } from '@angular/core';
import { MolecularViewerAdapter } from '../adapters/molecular-viewer.adapter';
import { NGLViewerAdapter } from '../adapters/ngl-viewer.adapter';
import { ProteinStructure, ProteinRepresentation, BindingResidue, ViewerState } from '../models/protein-structure.model';
import { ProteinStructureService } from './protein-structure.service';
import { PredictionMethod } from '../models/method.model';

@Injectable({
  providedIn: 'root'
})
export class ProteinViewerService {
  private adapter: MolecularViewerAdapter | null = null;
  private currentStructure: ProteinStructure | null = null;
  private isStructureLoaded = signal<boolean>(false);
  
  // Viewer state signals
  viewerState = signal<ViewerState>({
    representation: 'cartoon',
    showBindingSite: true,
    showPredictions: true,
    showLigands: true,
    showMetals: true,
    showLabels: false,
    colorByConfidence: false,
    selectedChain: undefined
  });

  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  isInitialized = signal<boolean>(false);

  constructor(private structureService: ProteinStructureService) {
    // Synchronize viewer state changes with the 3D viewer
    effect(() => {
      // Only sync if viewer is initialized and structure is loaded
      if (!this.isInitialized() || !this.isStructureLoaded() || !this.adapter) {
        return;
      }

      const state = this.viewerState();

      // Sync binding site visibility
      this.adapter.toggleBindingSite(state.showBindingSite);

      // Sync predictions visibility
      this.adapter.togglePredictions(state.showPredictions);

      // Sync labels visibility
      this.adapter.toggleLabels(state.showLabels);

      // Sync ligands visibility
      this.adapter.toggleLigands(state.showLigands);

      // Sync metals visibility
      this.adapter.toggleMetals(state.showMetals);
    });
  }

  /**
   * Initialize the molecular viewer
   */
  async initialize(container: HTMLElement): Promise<void> {
    try {
      this.adapter = new NGLViewerAdapter();
      await this.adapter.initialize(container);
      this.isInitialized.set(true);
      this.error.set(null);
    } catch (err) {
      console.error('Failed to initialize viewer:', err);
      this.error.set('Failed to initialize molecular viewer');
      throw err;
    }
  }

  /**
   * Load protein structure
   */
  async loadProtein(proteinId: string, method: PredictionMethod): Promise<void> {
    if (!this.adapter) {
      throw new Error('Viewer not initialized');
    }

    console.log('Loading protein:', proteinId, 'with method:', method);
    this.isLoading.set(true);
    this.isStructureLoaded.set(false);
    this.error.set(null);

    try {
      // Load structure data
      const structure = await new Promise<ProteinStructure>((resolve, reject) => {
        this.structureService.getProteinStructure(proteinId).subscribe({
          next: (data) => {
            console.log('Structure loaded:', data);
            resolve(data);
          },
          error: (err) => {
            console.error('Failed to load structure:', err);
            reject(err);
          }
        });
      });
      
      if (!structure) {
        throw new Error('Structure not found');
      }

      // Load binding residues
      const bindingResidues = await new Promise<BindingResidue[]>((resolve, reject) => {
        this.structureService.getBindingResidues(proteinId, method).subscribe({
          next: (data) => {
            console.log('Binding residues loaded:', data);
            resolve(data);
          },
          error: (err) => {
            console.error('Failed to load binding residues:', err);
            reject(err);
          }
        });
      });
      
      structure.bindingResidues = bindingResidues || [];

      console.log('Loading structure into viewer...');
      // Load into viewer
      await this.adapter.loadStructure(structure);
      this.currentStructure = structure;

      console.log('Applying viewer state...');
      // Mark structure as loaded BEFORE applying state
      // This allows the effect to run
      this.isStructureLoaded.set(true);
      
      // Apply current viewer state
      this.applyViewerState();

      console.log('Protein loaded successfully');
      this.isLoading.set(false);
    } catch (err) {
      console.error('Failed to load protein:', err);
      this.error.set('Failed to load protein structure');
      this.isLoading.set(false);
      this.isStructureLoaded.set(false);
      throw err;
    }
  }

  /**
   * Update representation
   */
  setRepresentation(representation: ProteinRepresentation): void {
    if (!this.adapter) return;

    this.viewerState.update(state => ({
      ...state,
      representation
    }));

    this.adapter.setRepresentation(representation);
  }

  /**
   * Toggle binding site visibility
   */
  toggleBindingSite(visible?: boolean): void {
    if (!this.adapter) return;

    const newValue = visible ?? !this.viewerState().showBindingSite;
    
    this.viewerState.update(state => ({
      ...state,
      showBindingSite: newValue
    }));

    // Direct call for immediate update (effect will also trigger)
    if (this.isStructureLoaded()) {
      this.adapter.toggleBindingSite(newValue);
    }
  }

  /**
   * Toggle predictions visibility
   */
  togglePredictions(visible?: boolean): void {
    if (!this.adapter) return;

    const newValue = visible ?? !this.viewerState().showPredictions;
    
    this.viewerState.update(state => ({
      ...state,
      showPredictions: newValue
    }));

    // Direct call for immediate update (effect will also trigger)
    if (this.isStructureLoaded()) {
      this.adapter.togglePredictions(newValue);
    }
  }

  /**
   * Toggle surface visibility
   */
  toggleSurface(visible: boolean): void {
    if (!this.adapter) return;
    this.adapter.toggleSurface(visible);
  }

  /**
   * Toggle residue labels
   */
  toggleLabels(visible?: boolean): void {
    if (!this.adapter) return;

    const newValue = visible ?? !this.viewerState().showLabels;
    
    this.viewerState.update(state => ({
      ...state,
      showLabels: newValue
    }));

    // Direct call for immediate update (effect will also trigger)
    if (this.isStructureLoaded()) {
      this.adapter.toggleLabels(newValue);
    }
  }

  /**
   * Toggle ligand visibility
   */
  toggleLigands(visible?: boolean): void {
    if (!this.adapter) return;

    const newValue = visible ?? !this.viewerState().showLigands;
    
    this.viewerState.update(state => ({
      ...state,
      showLigands: newValue
    }));

    // Direct call for immediate update (effect will also trigger)
    if (this.isStructureLoaded()) {
      this.adapter.toggleLigands(newValue);
    }
  }

  /**
   * Toggle metal ions visibility
   */
  toggleMetals(visible?: boolean): void {
    if (!this.adapter) return;

    const newValue = visible ?? !this.viewerState().showMetals;
    
    this.viewerState.update(state => ({
      ...state,
      showMetals: newValue
    }));

    // Direct call for immediate update (effect will also trigger)
    if (this.isStructureLoaded()) {
      this.adapter.toggleMetals(newValue);
    }
  }

  /**
   * Select a residue
   */
  selectResidue(chainId: string, residueNumber: number): void {
    if (!this.adapter) return;
    this.adapter.selectResidue(chainId, residueNumber);
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    if (!this.adapter) return;
    this.adapter.clearSelection();
  }

  /**
   * Center camera on residue
   */
  centerOnResidue(chainId: string, residueNumber: number): void {
    if (!this.adapter) return;
    this.adapter.centerOnResidue(chainId, residueNumber);
  }

  /**
   * Reset camera to default view
   */
  resetCamera(): void {
    if (!this.adapter) return;
    this.adapter.resetCamera();
  }

  /**
   * Zoom in
   */
  zoomIn(): void {
    if (!this.adapter) return;
    this.adapter.zoomIn();
  }

  /**
   * Zoom out
   */
  zoomOut(): void {
    if (!this.adapter) return;
    this.adapter.zoomOut();
  }

  /**
   * Focus on binding pocket
   */
  focusBindingPocket(): void {
    if (!this.adapter || !this.currentStructure) return;
    
    const bindingResidues = this.currentStructure.bindingResidues.filter(r => r.groundTruth);
    if (bindingResidues.length > 0) {
      this.adapter.focusBindingPocket(bindingResidues);
    }
  }

  /**
   * Color residues by confidence
   */
  colorByConfidence(enable?: boolean): void {
    if (!this.adapter || !this.currentStructure) return;

    const newValue = enable ?? !this.viewerState().colorByConfidence;
    
    this.viewerState.update(state => ({
      ...state,
      colorByConfidence: newValue
    }));

    if (newValue) {
      this.adapter.colorByConfidence(this.currentStructure.bindingResidues);
    } else {
      // Reset to default coloring
      this.adapter.setRepresentation(this.viewerState().representation);
      this.applyViewerState();
    }
  }

  /**
   * Update binding residues (when method changes)
   */
  async updateBindingResidues(proteinId: string, method: PredictionMethod): Promise<void> {
    if (!this.adapter || !this.currentStructure) return;

    try {
      const bindingResidues = await this.structureService.getBindingResidues(proteinId, method).toPromise();
      
      if (bindingResidues) {
        this.currentStructure.bindingResidues = bindingResidues;
        this.adapter.highlightResidues(bindingResidues);
      }
    } catch (err) {
      console.error('Failed to update binding residues:', err);
    }
  }

  /**
   * Apply current viewer state to adapter
   */
  private applyViewerState(): void {
    if (!this.adapter || !this.currentStructure) return;

    const state = this.viewerState();

    // Apply representation
    this.adapter.setRepresentation(state.representation);

    // Apply visibility settings
    if (this.currentStructure.bindingResidues.length > 0) {
      this.adapter.highlightResidues(this.currentStructure.bindingResidues);
      
      // Apply binding site visibility
      this.adapter.toggleBindingSite(state.showBindingSite);
      
      // Apply predictions visibility
      this.adapter.togglePredictions(state.showPredictions);
      
      // Apply labels visibility
      this.adapter.toggleLabels(state.showLabels);
    }

    // Apply ligands visibility
    this.adapter.toggleLigands(state.showLigands);

    // Apply metals visibility
    this.adapter.toggleMetals(state.showMetals);
  }

  /**
   * Get current structure
   */
  getCurrentStructure(): ProteinStructure | null {
    return this.currentStructure;
  }

  /**
   * Clear viewer
   */
  clear(): void {
    if (this.adapter) {
      this.adapter.clear();
      this.currentStructure = null;
      this.isStructureLoaded.set(false);
    }
  }

  /**
   * Handle resize event
   */
  handleResize(): void {
    if (this.adapter) {
      this.adapter.handleResize();
    }
  }

  /**
   * Dispose viewer
   */
  dispose(): void {
    if (this.adapter) {
      this.adapter.dispose();
      this.adapter = null;
      this.currentStructure = null;
      this.isInitialized.set(false);
      this.isStructureLoaded.set(false);
    }
  }
}
