import { Injectable, signal, computed } from '@angular/core';
import { Protein, Residue, PredictionResult } from '../models/protein.model';
import { DatasetType } from '../models/dataset.model';
import { PredictionMethod } from '../models/method.model';

export interface ExplorerFilters {
  dataset: DatasetType | 'all';
  method: PredictionMethod | 'all';
  bindingType: 'all' | 'metal' | 'nucleic-acid' | 'small-molecule' | 'other';
  searchQuery: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExplorerStateService {
  // Current protein and predictions
  private _currentProtein = signal<Protein | null>(null);
  private _currentPrediction = signal<PredictionResult | null>(null);
  private _selectedResidue = signal<Residue | null>(null);
  
  // Filters
  private _filters = signal<ExplorerFilters>({
    dataset: 'all',
    method: 'ESM-ORION',
    bindingType: 'all',
    searchQuery: ''
  });

  // Public read-only signals
  readonly currentProtein = this._currentProtein.asReadonly();
  readonly currentPrediction = this._currentPrediction.asReadonly();
  readonly selectedResidue = this._selectedResidue.asReadonly();
  readonly filters = this._filters.asReadonly();

  // Computed signals
  readonly sequence = computed(() => {
    const protein = this._currentProtein();
    return protein?.sequence || '';
  });

  readonly residues = computed(() => {
    const protein = this._currentProtein();
    const prediction = this._currentPrediction();
    
    if (!protein) return [];

    return protein.sequence.split('').map((aa, index) => {
      const position = index + 1;
      const predicted = prediction?.predictedResidues.includes(position) || false;
      
      return {
        position,
        aminoAcid: aa,
        chainId: 'A',
        isBinding: false, // Will be set from ground truth
        predictionScore: predicted ? 0.75 + Math.random() * 0.25 : Math.random() * 0.3,
        experimentalBinding: false
      } as Residue;
    });
  });

  readonly selectedResidueIndex = computed(() => {
    const selected = this._selectedResidue();
    return selected ? selected.position - 1 : null;
  });

  // Methods
  setCurrentProtein(protein: Protein | null): void {
    this._currentProtein.set(protein);
    this._selectedResidue.set(null);
  }

  setCurrentPrediction(prediction: PredictionResult | null): void {
    this._currentPrediction.set(prediction);
  }

  selectResidue(residue: Residue | null): void {
    this._selectedResidue.set(residue);
  }

  selectResidueByPosition(position: number): void {
    const residues = this.residues();
    const residue = residues.find(r => r.position === position);
    if (residue) {
      this._selectedResidue.set(residue);
    }
  }

  updateFilters(filters: Partial<ExplorerFilters>): void {
    this._filters.update(current => ({
      ...current,
      ...filters
    }));
  }

  resetFilters(): void {
    this._filters.set({
      dataset: 'all',
      method: 'ESM-ORION',
      bindingType: 'all',
      searchQuery: ''
    });
  }
}
