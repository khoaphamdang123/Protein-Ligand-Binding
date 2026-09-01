import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MockDataService } from '../../core/services/mock-data.service';
import { Protein, PredictionResult, Residue } from '../../core/models/protein.model';
import { PredictionMethod } from '../../core/models/method.model';
import { TabsComponent } from '../../shared/ui/tabs/tabs.component';
import { ProteinViewerComponent } from '../../molecular/protein-viewer/protein-viewer.component';
import { SequenceViewerComponent } from '../../molecular/sequence-viewer/sequence-viewer.component';
import { DataTableComponent, DataTableColumn } from '../../shared/ui/data-table/data-table.component';

type TabId = 'overview' | 'structure' | 'sequence' | 'prediction' | 'metrics' | 'comparison';

interface ResidueAnalysis extends Residue {
  groundTruth: boolean;
  predicted: boolean;
  score: number;
  status: 'TP' | 'TN' | 'FP' | 'FN';
}

@Component({
  selector: 'app-protein-detail',
  standalone: true,
  imports: [
    CommonModule,
    SequenceViewerComponent,
    DataTableComponent
  ],
  templateUrl: './protein-detail.component.html',
  styleUrl: './protein-detail.component.scss'
})
export class ProteinDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private mockDataService = inject(MockDataService);

  protein = signal<Protein | null>(null);
  prediction = signal<PredictionResult | null>(null);
  selectedMethod = signal<PredictionMethod>('ESM-ORION');
  activeTab = signal<TabId>('overview');
  selectedResidue = signal<Residue | null>(null);

  tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'structure', label: 'Structure' },
    { id: 'sequence', label: 'Sequence' },
    { id: 'prediction', label: 'Prediction' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'comparison', label: 'Comparison' }
  ];

  // Methods for comparison
  methods: PredictionMethod[] = ['ESM-ORION', 'BindNode24', 'bindEmbed21DL', 'P2Rank'];
  Math = Math;

  // Metrics
  metrics = {
    f1: 0.847,
    mcc: 0.782,
    precision: 0.891,
    recall: 0.806,
    accuracy: 0.923,
    specificity: 0.945
  };

  // Confusion matrix
  confusionMatrix = {
    tp: 142,
    tn: 1845,
    fp: 87,
    fn: 38
  };

  // Prediction table columns
  predictionColumns: DataTableColumn<ResidueAnalysis>[] = [
    {
      key: 'position',
      label: 'Position',
      sortable: true,
      width: '100px',
      align: 'center'
    },
    {
      key: 'aminoAcid',
      label: 'Residue',
      sortable: true,
      width: '100px',
      align: 'center',
      render: (row) => `<span class="residue-code">${row.aminoAcid}</span>`
    },
    {
      key: 'groundTruth',
      label: 'Ground Truth',
      sortable: true,
      width: '120px',
      align: 'center',
      render: (row) => row.groundTruth ? '<span class="badge-binding">Binding</span>' : '<span class="badge-non-binding">Non-binding</span>'
    },
    {
      key: 'predicted',
      label: 'Prediction',
      sortable: true,
      width: '120px',
      align: 'center',
      render: (row) => row.predicted ? '<span class="badge-predicted">Predicted</span>' : '<span class="badge-not-predicted">Not Predicted</span>'
    },
    {
      key: 'score',
      label: 'Score',
      sortable: true,
      width: '100px',
      align: 'right',
      render: (row) => `<span class="score-value">${row.score.toFixed(3)}</span>`
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '100px',
      align: 'center',
      render: (row) => `<span class="status-badge status-${row.status.toLowerCase()}">${row.status}</span>`
    }
  ];

  residueAnalysis: ResidueAnalysis[] = [];

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      const proteinId = params['id'];
      if (proteinId) {
        this.loadProtein(proteinId);
      }
    });
  }

  loadProtein(proteinId: string): void {
    this.mockDataService.getProteinById(proteinId).subscribe(protein => {
      if (protein) {
        this.protein.set(protein);
        this.loadPrediction(proteinId, this.selectedMethod());
      }
    });
  }

  loadPrediction(proteinId: string, method: PredictionMethod): void {
    this.mockDataService.getPredictionResults(proteinId).subscribe(results => {
      const prediction = results.find(r => r.method === method);
      if (prediction) {
        this.prediction.set(prediction);
        this.generateResidueAnalysis();
      }
    });
  }

  generateResidueAnalysis(): void {
    const protein = this.protein();
    const prediction = this.prediction();
    
    if (!protein || !prediction) return;

    // Generate mock binding sites (every 10th residue + some random)
    const bindingSites = new Set<number>();
    for (let i = 10; i <= protein.length; i += 10) {
      bindingSites.add(i);
    }
    // Add some random binding sites
    for (let i = 0; i < 15; i++) {
      bindingSites.add(Math.floor(Math.random() * protein.length) + 1);
    }

    this.residueAnalysis = protein.sequence.split('').map((aa, index) => {
      const position = index + 1;
      const groundTruth = bindingSites.has(position);
      const score = prediction.predictedResidues.includes(position) 
        ? 0.7 + Math.random() * 0.3 
        : Math.random() * 0.4;
      const predicted = score > 0.5;

      let status: 'TP' | 'TN' | 'FP' | 'FN';
      if (groundTruth && predicted) status = 'TP';
      else if (!groundTruth && !predicted) status = 'TN';
      else if (!groundTruth && predicted) status = 'FP';
      else status = 'FN';

      return {
        position,
        aminoAcid: aa,
        chainId: 'A',
        isBinding: groundTruth,
        predictionScore: score,
        experimentalBinding: groundTruth,
        groundTruth,
        predicted,
        score,
        status
      };
    });
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId as TabId);
  }

  onMethodChange(method: PredictionMethod): void {
    this.selectedMethod.set(method);
    const protein = this.protein();
    if (protein) {
      this.loadPrediction(protein.id, method);
    }
  }

  onResidueSelect(position: number): void {
    const residue = this.residueAnalysis.find(r => r.position === position);
    if (residue) {
      this.selectedResidue.set(residue);
    }
  }

  get residues(): Residue[] {
    return this.residueAnalysis;
  }

  get totalBindingResidues(): number {
    return this.residueAnalysis.filter(r => r.groundTruth).length;
  }

  get totalPredictedResidues(): number {
    return this.residueAnalysis.filter(r => r.predicted).length;
  }

  get predictionThreshold(): number {
    return 0.5;
  }

  // Score distribution data
  get scoreDistribution(): { range: string; count: number }[] {
    const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    return bins.slice(0, -1).map((min, i) => {
      const max = bins[i + 1];
      const count = this.residueAnalysis.filter(r => r.score >= min && r.score < max).length;
      return {
        range: `${(min * 100).toFixed(0)}-${(max * 100).toFixed(0)}%`,
        count
      };
    });
  }
}
