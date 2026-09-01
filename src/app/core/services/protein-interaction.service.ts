import { Injectable, signal, computed } from '@angular/core';

export type ResidueStatus = 'TP' | 'TN' | 'FP' | 'FN';

export interface ResidueInfo {
  position: number;
  aminoAcid: string;
  predictionScore: number;
  groundTruth: boolean;
  predicted: boolean;
  status: ResidueStatus;
}

export interface MetricsCalculation {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  mcc: number;
  accuracy: number;
}

@Injectable({
  providedIn: 'root'
})
export class ProteinInteractionService {
  // Selected residue state
  selectedResidue = signal<ResidueInfo | null>(null);
  
  // Hovered residue state
  hoveredResidue = signal<ResidueInfo | null>(null);
  
  // Prediction threshold
  predictionThreshold = signal<number>(0.5);
  
  // All residues data
  private residuesData = signal<ResidueInfo[]>([]);
  
  // Computed: residues with updated predictions based on threshold
  residuesWithPredictions = computed(() => {
    const threshold = this.predictionThreshold();
    return this.residuesData().map(residue => ({
      ...residue,
      predicted: residue.predictionScore >= threshold,
      status: this.calculateStatus(residue.predictionScore, residue.groundTruth, threshold)
    }));
  });
  
  // Computed: metrics based on current threshold
  metrics = computed(() => {
    const residues = this.residuesWithPredictions();
    return this.calculateMetrics(residues);
  });
  
  // Computed: binding residues count
  bindingResiduesCount = computed(() => {
    return this.residuesWithPredictions().filter(r => r.predicted).length;
  });
  
  // Computed: status counts
  statusCounts = computed(() => {
    const residues = this.residuesWithPredictions();
    return {
      tp: residues.filter(r => r.status === 'TP').length,
      tn: residues.filter(r => r.status === 'TN').length,
      fp: residues.filter(r => r.status === 'FP').length,
      fn: residues.filter(r => r.status === 'FN').length
    };
  });

  constructor() {}

  // Initialize residues data
  setResiduesData(residues: ResidueInfo[]): void {
    this.residuesData.set(residues);
  }

  // Select a residue
  selectResidue(residue: ResidueInfo | null): void {
    this.selectedResidue.set(residue);
  }

  // Select residue by position
  selectResidueByPosition(position: number): void {
    const residue = this.residuesWithPredictions().find(r => r.position === position);
    if (residue) {
      this.selectedResidue.set(residue);
    }
  }

  // Hover a residue
  hoverResidue(residue: ResidueInfo | null): void {
    this.hoveredResidue.set(residue);
  }

  // Set prediction threshold
  setThreshold(threshold: number): void {
    this.predictionThreshold.set(threshold);
    
    // Update selected residue if exists
    const selected = this.selectedResidue();
    if (selected) {
      const updated = this.residuesWithPredictions().find(r => r.position === selected.position);
      if (updated) {
        this.selectedResidue.set(updated);
      }
    }
  }

  // Calculate residue status
  private calculateStatus(score: number, groundTruth: boolean, threshold: number): ResidueStatus {
    const predicted = score >= threshold;
    
    if (predicted && groundTruth) return 'TP';
    if (!predicted && !groundTruth) return 'TN';
    if (predicted && !groundTruth) return 'FP';
    return 'FN'; // !predicted && groundTruth
  }

  // Calculate metrics
  calculateMetrics(residues: ResidueInfo[]): MetricsCalculation {
    const tp = residues.filter(r => r.status === 'TP').length;
    const tn = residues.filter(r => r.status === 'TN').length;
    const fp = residues.filter(r => r.status === 'FP').length;
    const fn = residues.filter(r => r.status === 'FN').length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    const total = tp + tn + fp + fn;
    const accuracy = total > 0 ? (tp + tn) / total : 0;
    
    // Matthews Correlation Coefficient
    const numerator = (tp * tn) - (fp * fn);
    const denominator = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
    const mcc = denominator > 0 ? numerator / denominator : 0;

    return { tp, tn, fp, fn, precision, recall, f1, mcc, accuracy };
  }

  // Get status color
  getStatusColor(status: ResidueStatus): string {
    const colors: Record<ResidueStatus, string> = {
      'TP': '#10B981', // Green
      'TN': '#64748B', // Gray
      'FP': '#F59E0B', // Orange
      'FN': '#EF4444'  // Red
    };
    return colors[status];
  }

  // Get status icon
  getStatusIcon(status: ResidueStatus): string {
    const icons: Record<ResidueStatus, string> = {
      'TP': 'check-circle',
      'TN': 'circle',
      'FP': 'alert-circle',
      'FN': 'x-circle'
    };
    return icons[status];
  }

  // Get status label
  getStatusLabel(status: ResidueStatus): string {
    const labels: Record<ResidueStatus, string> = {
      'TP': 'True Positive',
      'TN': 'True Negative',
      'FP': 'False Positive',
      'FN': 'False Negative'
    };
    return labels[status];
  }

  // Format score
  formatScore(score: number): string {
    return (score * 100).toFixed(1) + '%';
  }

  // Format metric
  formatMetric(value: number): string {
    return value.toFixed(3);
  }
}
