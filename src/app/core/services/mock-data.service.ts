import { Injectable, signal } from '@angular/core';
import { Observable, of, delay } from 'rxjs';
import {
  Protein,
  PredictionResult,
  BenchmarkMetrics,
  BindingSite,
  Residue,
  ComparisonData,
} from '../models/protein.model';
import { Dataset, DatasetStatistics, DatasetType } from '../models/dataset.model';
import { PredictionMethod } from '../models/method.model';

@Injectable({
  providedIn: 'root',
})
export class MockDataService {
  private readonly aminoAcids = ['A', 'R', 'N', 'D', 'C', 'Q', 'E', 'G', 'H', 'I', 'L', 'K', 'M', 'F', 'P', 'S', 'T', 'W', 'Y', 'V'];

  proteins = signal<Protein[]>(this.generateMockProteins());
  selectedDataset = signal<DatasetType>('TestSet300');

  constructor() {}

  getProteins(dataset: DatasetType): Observable<Protein[]> {
    const filteredProteins = this.proteins().slice(0, dataset === 'TestSet300' ? 300 : 46);
    return of(filteredProteins).pipe(delay(300));
  }

  getProteinById(id: string): Observable<Protein | undefined> {
    const protein = this.proteins().find(p => p.id === id);
    return of(protein).pipe(delay(200));
  }

  getProteinsByDataset(datasetId: string): Observable<Protein[]> {
    const count = datasetId === 'testset300' ? 300 : 46;
    const filteredProteins = this.proteins().slice(0, count);
    return of(filteredProteins).pipe(delay(300));
  }

  getDatasets(): Observable<Dataset[]> {
    const datasets: Dataset[] = [
      {
        id: 'testset300',
        name: 'TestSet300',
        description: '300 protein structures for comprehensive benchmark analysis',
        type: 'TestSet300',
        proteinCount: 300,
        totalBindingResidues: 12450,
        averageSequenceLength: 342,
        avgSequenceLength: 342,
        evaluatedMethods: 4,
        avgBindingSites: 41.5
      },
      {
        id: 'testset46',
        name: 'TestSet46',
        description: '46 curated protein structures for validation',
        type: 'TestSet46',
        proteinCount: 46,
        totalBindingResidues: 1876,
        averageSequenceLength: 385,
        avgSequenceLength: 385,
        evaluatedMethods: 4,
        avgBindingSites: 40.8
      }
    ];
    return of(datasets).pipe(delay(200));
  }

  getPredictionResults(proteinId: string): Observable<PredictionResult[]> {
    const protein = this.proteins().find(p => p.id === proteinId);
    if (!protein) return of([]);

    const methods: PredictionMethod[] = ['ESM-ORION', 'BindNode24', 'bindEmbed21DL', 'P2Rank'];
    const results = methods.map(method => this.generatePredictionResult(protein, method));

    return of(results).pipe(delay(400));
  }

  getPredictions(): PredictionResult[] {
    const allPredictions: PredictionResult[] = [];
    const methods: PredictionMethod[] = ['ESM-ORION', 'BindNode24', 'bindEmbed21DL', 'P2Rank'];
    
    this.proteins().slice(0, 20).forEach(protein => {
      methods.forEach(method => {
        allPredictions.push(this.generatePredictionResult(protein, method));
      });
    });
    
    return allPredictions;
  }

  getBenchmarkMetrics(proteinId: string, method: PredictionMethod): Observable<BenchmarkMetrics> {
    return of(this.generateMockMetrics(proteinId, method)).pipe(delay(200));
  }

  getComparisonData(proteinId: string): Observable<ComparisonData> {
    const protein = this.proteins().find(p => p.id === proteinId)!;
    const methods: PredictionMethod[] = ['ESM-ORION', 'BindNode24', 'bindEmbed21DL', 'P2Rank'];

    const comparisonData: ComparisonData = {
      protein,
      methods: methods.map(method => ({
        method,
        prediction: this.generatePredictionResult(protein, method),
        metrics: this.generateMockMetrics(proteinId, method),
      })),
      groundTruth: this.generateGroundTruth(protein.length),
    };

    return of(comparisonData).pipe(delay(500));
  }

  getDatasetStatistics(dataset: DatasetType): Observable<DatasetStatistics> {
    const stats: DatasetStatistics = {
      dataset,
      totalProteins: dataset === 'TestSet300' ? 300 : 46,
      totalResidues: dataset === 'TestSet300' ? 95000 : 14500,
      totalBindingResidues: dataset === 'TestSet300' ? 8500 : 1300,
      bindingRatio: 0.089,
      avgProteinLength: dataset === 'TestSet300' ? 316 : 315,
      methodPerformance: [
        { method: 'ESM-ORION', avgPrecision: 0.78, avgRecall: 0.82, avgF1: 0.80 },
        { method: 'BindNode24', avgPrecision: 0.65, avgRecall: 0.71, avgF1: 0.68 },
        { method: 'bindEmbed21DL', avgPrecision: 0.71, avgRecall: 0.75, avgF1: 0.73 },
        { method: 'P2Rank', avgPrecision: 0.68, avgRecall: 0.73, avgF1: 0.70 },
      ],
    };

    return of(stats).pipe(delay(300));
  }

  private generateMockProteins(): Protein[] {
    const proteins: Protein[] = [];
    const methods = ['X-RAY DIFFRACTION', 'NMR', 'ELECTRON MICROSCOPY'];
    const organisms = ['Homo sapiens', 'Escherichia coli', 'Mus musculus', 'Saccharomyces cerevisiae'];

    for (let i = 0; i < 320; i++) {
      const length = Math.floor(Math.random() * 400) + 150;
      proteins.push({
        id: `PROT_${i.toString().padStart(4, '0')}`,
        name: `Protein ${i + 1}`,
        pdbId: this.generatePDBId(),
        sequence: this.generateRandomSequence(length),
        length,
        resolution: Math.random() * 2 + 1.5,
        experimentalMethod: methods[Math.floor(Math.random() * methods.length)],
        organism: organisms[Math.floor(Math.random() * organisms.length)],
        description: `Experimental protein structure for binding site prediction research`,
      });
    }

    return proteins;
  }

  private generatePDBId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  private generateRandomSequence(length: number): string {
    return Array.from({ length }, () => this.aminoAcids[Math.floor(Math.random() * this.aminoAcids.length)]).join('');
  }

  private generatePredictionResult(protein: Protein, method: PredictionMethod): PredictionResult {
    const bindingSiteCount = Math.floor(Math.random() * 3) + 1;
    const bindingSites: BindingSite[] = [];
    const allPredictedResidues: number[] = [];

    for (let i = 0; i < bindingSiteCount; i++) {
      const siteSize = Math.floor(Math.random() * 12) + 8;
      const startPos = Math.floor(Math.random() * (protein.length - siteSize));
      const residues: Residue[] = [];

      for (let j = 0; j < siteSize; j++) {
        const position = startPos + j;
        residues.push({
          position,
          aminoAcid: protein.sequence[position],
          chainId: 'A',
          isBinding: true,
          predictionScore: Math.random() * 0.3 + 0.7,
          experimentalBinding: Math.random() > 0.2,
        });
        allPredictedResidues.push(position);
      }

      bindingSites.push({
        id: `BS_${i}`,
        proteinId: protein.id,
        residues,
        ligandName: ['ATP', 'ADP', 'NAD', 'FAD', 'Heme'][Math.floor(Math.random() * 5)],
        confidence: Math.random() * 0.2 + 0.75,
        method,
      });
    }

    return {
      id: `PRED_${protein.id}_${method}`,
      proteinId: protein.id,
      method,
      bindingSites,
      predictedResidues: allPredictedResidues,
      confidence: Math.random() * 0.15 + 0.80,
      timestamp: new Date().toISOString(),
    };
  }

  private generateMockMetrics(proteinId: string, method: PredictionMethod): BenchmarkMetrics {
    const baseScores: Record<PredictionMethod, number> = {
      'ESM-ORION': 0.80,
      'BindNode24': 0.68,
      'bindEmbed21DL': 0.73,
      'P2Rank': 0.70,
    };

    const base = baseScores[method];
    const variance = (Math.random() - 0.5) * 0.15;
    
    const precision = Math.max(0, Math.min(1, base + variance));
    const recall = Math.max(0, Math.min(1, base + variance + (Math.random() - 0.5) * 0.1));
    const f1Score = (2 * precision * recall) / (precision + recall);

    const tp = Math.floor(Math.random() * 30) + 20;
    const fp = Math.floor(tp / precision) - tp;
    const fn = Math.floor(tp / recall) - tp;
    const tn = 200 - tp - fp - fn;

    return {
      proteinId,
      method,
      precision,
      recall,
      f1Score,
      mcc: (Math.random() - 0.5) * 0.4 + base - 0.1,
      accuracy: (tp + tn) / (tp + tn + fp + fn),
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
    };
  }

  private generateGroundTruth(proteinLength: number): number[] {
    const bindingCount = Math.floor(Math.random() * 25) + 15;
    const groundTruth: number[] = [];
    
    for (let i = 0; i < bindingCount; i++) {
      const pos = Math.floor(Math.random() * proteinLength);
      if (!groundTruth.includes(pos)) {
        groundTruth.push(pos);
      }
    }
    
    return groundTruth.sort((a, b) => a - b);
  }
}
