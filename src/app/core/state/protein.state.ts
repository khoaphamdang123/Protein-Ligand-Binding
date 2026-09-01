import { Injectable, signal, computed } from '@angular/core';
import { Protein, PredictionResult, BenchmarkMetrics } from '../models/protein.model';
import { DatasetType } from '../models/dataset.model';

@Injectable({
  providedIn: 'root'
})
export class ProteinStateService {
  // State signals
  readonly proteins = signal<Protein[]>([]);
  readonly selectedProtein = signal<Protein | null>(null);
  readonly selectedDataset = signal<DatasetType>('TestSet300');
  readonly predictions = signal<PredictionResult[]>([]);
  readonly selectedMethod = signal<string>('ESM-ORION');
  readonly metrics = signal<BenchmarkMetrics | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Computed values
  readonly filteredProteins = computed(() => {
    const dataset = this.selectedDataset();
    return this.proteins().slice(0, dataset === 'TestSet300' ? 300 : 46);
  });

  readonly selectedPrediction = computed(() => {
    const method = this.selectedMethod();
    return this.predictions().find(p => p.method === method) || null;
  });

  readonly proteinCount = computed(() => {
    return this.filteredProteins().length;
  });

  // Actions
  setProteins(proteins: Protein[]): void {
    this.proteins.set(proteins);
  }

  setSelectedProtein(protein: Protein | null): void {
    this.selectedProtein.set(protein);
  }

  setSelectedDataset(dataset: DatasetType): void {
    this.selectedDataset.set(dataset);
  }

  setPredictions(predictions: PredictionResult[]): void {
    this.predictions.set(predictions);
  }

  setSelectedMethod(method: string): void {
    this.selectedMethod.set(method);
  }

  setMetrics(metrics: BenchmarkMetrics | null): void {
    this.metrics.set(metrics);
  }

  setLoading(loading: boolean): void {
    this.loading.set(loading);
  }

  setError(error: string | null): void {
    this.error.set(error);
  }

  clearState(): void {
    this.proteins.set([]);
    this.selectedProtein.set(null);
    this.predictions.set([]);
    this.metrics.set(null);
    this.error.set(null);
  }
}
