import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MockDataService } from '../../core/services/mock-data.service';
import { PredictionMethod } from '../../core/models/method.model';
import * as echarts from 'echarts';

type EChartsOption = echarts.EChartsOption;

interface MethodMetrics {
  method: PredictionMethod;
  f1: number;
  mcc: number;
  precision: number;
  recall: number;
  accuracy?: number;
  specificity?: number;
}

@Component({
  selector: 'app-comparison',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comparison.component.html',
  styleUrl: './comparison.component.scss'
})
export class ComparisonComponent implements OnInit, AfterViewInit {
  @ViewChild('f1Chart') f1ChartRef!: ElementRef;
  @ViewChild('mccChart') mccChartRef!: ElementRef;
  @ViewChild('prChart') prChartRef!: ElementRef;
  @ViewChild('radarChart') radarChartRef!: ElementRef;
  @ViewChild('scatterChart') scatterChartRef!: ElementRef;

  private mockDataService = inject(MockDataService);

  // Available methods
  allMethods: PredictionMethod[] = ['ESM-ORION', 'BindNode24', 'bindEmbed21DL', 'P2Rank'];
  
  // Method colors
  methodColors: Record<PredictionMethod, string> = {
    'ESM-ORION': '#22D3EE',
    'BindNode24': '#38BDF8',
    'bindEmbed21DL': '#10B981',
    'P2Rank': '#F97316'
  };

  // UI State - Signals
  selectedDataset = signal<string>('testset300');
  selectedMethods = signal<Set<PredictionMethod>>(new Set(['ESM-ORION', 'BindNode24']));
  selectedMetrics = signal<Set<string>>(new Set(['f1', 'mcc', 'precision', 'recall']));

  constructor() {
    // Watch for state changes and update charts
    effect(() => {
      // Track signals
      this.selectedDataset();
      this.selectedMethods();
      this.selectedMetrics();
      
      // Update charts when ready
      if (this.f1Chart) {
        setTimeout(() => this.updateCharts(), 0);
      }
    });
  }

  // Mock metrics data
  private metricsData: Record<string, Record<PredictionMethod, MethodMetrics>> = {
    'testset300': {
      'ESM-ORION': { method: 'ESM-ORION', f1: 0.847, mcc: 0.782, precision: 0.891, recall: 0.806, accuracy: 0.923, specificity: 0.945 },
      'BindNode24': { method: 'BindNode24', f1: 0.723, mcc: 0.658, precision: 0.756, recall: 0.692, accuracy: 0.887, specificity: 0.921 },
      'bindEmbed21DL': { method: 'bindEmbed21DL', f1: 0.801, mcc: 0.734, precision: 0.823, recall: 0.780, accuracy: 0.905, specificity: 0.934 },
      'P2Rank': { method: 'P2Rank', f1: 0.778, mcc: 0.701, precision: 0.795, recall: 0.762, accuracy: 0.896, specificity: 0.925 }
    },
    'testset46': {
      'ESM-ORION': { method: 'ESM-ORION', f1: 0.823, mcc: 0.756, precision: 0.865, recall: 0.785, accuracy: 0.912, specificity: 0.938 },
      'BindNode24': { method: 'BindNode24', f1: 0.698, mcc: 0.625, precision: 0.732, recall: 0.667, accuracy: 0.875, specificity: 0.912 },
      'bindEmbed21DL': { method: 'bindEmbed21DL', f1: 0.779, mcc: 0.708, precision: 0.801, recall: 0.758, accuracy: 0.893, specificity: 0.926 },
      'P2Rank': { method: 'P2Rank', f1: 0.752, mcc: 0.678, precision: 0.771, recall: 0.734, accuracy: 0.883, specificity: 0.918 }
    }
  };

  // Computed: filtered metrics for selected methods
  filteredMetrics = computed(() => {
    const dataset = this.selectedDataset();
    const selected = this.selectedMethods();
    const datasetData = this.metricsData[dataset];
    
    return this.allMethods
      .filter(method => selected.has(method))
      .map(method => datasetData[method]);
  });

  // Computed: comparison table data
  comparisonTable = computed(() => this.filteredMetrics());

  // Computed: best method for each metric
  bestMethods = computed(() => {
    const metrics = this.filteredMetrics();
    if (metrics.length === 0) return {};

    const best: Record<string, { method: PredictionMethod; value: number }> = {};
    
    const metricKeys: (keyof MethodMetrics)[] = ['f1', 'mcc', 'precision', 'recall'];
    
    metricKeys.forEach(metric => {
      const sorted = [...metrics].sort((a, b) => {
        const aVal = a[metric] as number;
        const bVal = b[metric] as number;
        return bVal - aVal;
      });
      if (sorted.length > 0) {
        best[metric] = {
          method: sorted[0].method,
          value: sorted[0][metric] as number
        };
      }
    });

    return best;
  });

  // Computed: answers to key questions
  keyInsights = computed(() => {
    const best = this.bestMethods();
    return {
      highestF1: best['f1'] ? `${best['f1'].method} (${(best['f1'].value * 100).toFixed(1)}%)` : 'N/A',
      highestMCC: best['mcc'] ? `${best['mcc'].method} (${(best['mcc'].value * 100).toFixed(1)}%)` : 'N/A',
      highestPrecision: best['precision'] ? `${best['precision'].method} (${(best['precision'].value * 100).toFixed(1)}%)` : 'N/A',
      highestRecall: best['recall'] ? `${best['recall'].method} (${(best['recall'].value * 100).toFixed(1)}%)` : 'N/A'
    };
  });

  // Chart instances
  private f1Chart: echarts.ECharts | null = null;
  private mccChart: echarts.ECharts | null = null;
  private prChart: echarts.ECharts | null = null;
  private radarChart: echarts.ECharts | null = null;
  private scatterChart: echarts.ECharts | null = null;

  ngOnInit(): void {
    // Initialize with default selections
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initCharts();
      this.updateCharts();
    }, 100);
  }

  // Toggle method selection
  toggleMethod(method: PredictionMethod): void {
    const current = this.selectedMethods();
    const newSet = new Set(current);
    
    if (newSet.has(method)) {
      if (newSet.size > 1) { // Keep at least one method selected
        newSet.delete(method);
      }
    } else {
      newSet.add(method);
    }
    
    this.selectedMethods.set(newSet);
  }

  // Check if method is selected
  isMethodSelected(method: PredictionMethod): boolean {
    return this.selectedMethods().has(method);
  }

  // Set dataset
  setDataset(dataset: string): void {
    this.selectedDataset.set(dataset);
  }

  // Toggle metric selection
  toggleMetric(metric: string): void {
    const current = this.selectedMetrics();
    const newSet = new Set(current);
    
    if (newSet.has(metric)) {
      if (newSet.size > 1) { // Keep at least one metric selected
        newSet.delete(metric);
      }
    } else {
      newSet.add(metric);
    }
    
    this.selectedMetrics.set(newSet);
  }

  // Format metric value
  formatMetric(value: number, metric: string): string {
    if (metric === 'f1' || metric === 'precision' || metric === 'recall') {
      return (value * 100).toFixed(1) + '%';
    }
    return value.toFixed(3);
  }

  // Get color for method
  getMethodColor(method: PredictionMethod): string {
    return this.methodColors[method] || '#94A3B8';
  }

  // Initialize all charts
  initCharts(): void {
    if (this.f1ChartRef) this.f1Chart = echarts.init(this.f1ChartRef.nativeElement);
    if (this.mccChartRef) this.mccChart = echarts.init(this.mccChartRef.nativeElement);
    if (this.prChartRef) this.prChart = echarts.init(this.prChartRef.nativeElement);
    if (this.radarChartRef) this.radarChart = echarts.init(this.radarChartRef.nativeElement);
    if (this.scatterChartRef) this.scatterChart = echarts.init(this.scatterChartRef.nativeElement);

    window.addEventListener('resize', () => {
      this.f1Chart?.resize();
      this.mccChart?.resize();
      this.prChart?.resize();
      this.radarChart?.resize();
      this.scatterChart?.resize();
    });
  }

  // Update all charts
  updateCharts(): void {
    this.updateF1Chart();
    this.updateMCCChart();
    this.updatePRChart();
    this.updateRadarChart();
    this.updateScatterChart();
  }

  // F1 Bar Chart
  updateF1Chart(): void {
    if (!this.f1Chart) return;

    const metrics = this.filteredMetrics();
    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' },
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>F1 Score: ${(data.value * 100).toFixed(1)}%`;
        }
      },
      xAxis: {
        type: 'category',
        data: metrics.map(m => m.method),
        axisLabel: { color: '#94A3B8', fontSize: 12 },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        axisLabel: { 
          color: '#94A3B8',
          formatter: (value: number) => (value * 100).toFixed(0) + '%'
        },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: [{
        data: metrics.map(m => ({
          value: m.f1,
          itemStyle: { color: this.getMethodColor(m.method) }
        })),
        type: 'bar',
        barWidth: '50%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0]
        },
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => (params.value * 100).toFixed(1) + '%',
          color: '#F8FAFC'
        }
      }]
    };

    this.f1Chart.setOption(option, true);
  }

  // MCC Bar Chart
  updateMCCChart(): void {
    if (!this.mccChart) return;

    const metrics = this.filteredMetrics();
    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' },
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>MCC: ${data.value.toFixed(3)}`;
        }
      },
      xAxis: {
        type: 'category',
        data: metrics.map(m => m.method),
        axisLabel: { color: '#94A3B8', fontSize: 12 },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        axisLabel: { 
          color: '#94A3B8',
          formatter: (value: number) => value.toFixed(1)
        },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: [{
        data: metrics.map(m => ({
          value: m.mcc,
          itemStyle: { color: this.getMethodColor(m.method) }
        })),
        type: 'bar',
        barWidth: '50%',
        itemStyle: {
          borderRadius: [4, 4, 0, 0]
        },
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => params.value.toFixed(3),
          color: '#F8FAFC'
        }
      }]
    };

    this.mccChart.setOption(option, true);
  }

  // Precision vs Recall Chart
  updatePRChart(): void {
    if (!this.prChart) return;

    const metrics = this.filteredMetrics();
    const option: EChartsOption = {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' },
        formatter: (params: any) => {
          const method = metrics.find(m => m.method === params.name);
          if (method) {
            return `${params.name}<br/>Precision: ${(method.precision * 100).toFixed(1)}%<br/>Recall: ${(method.recall * 100).toFixed(1)}%`;
          }
          return '';
        }
      },
      legend: {
        data: metrics.map(m => m.method),
        bottom: 0,
        textStyle: { color: '#94A3B8' }
      },
      xAxis: {
        type: 'value',
        name: 'Precision',
        nameLocation: 'middle',
        nameGap: 30,
        min: 0,
        max: 1,
        axisLabel: { 
          color: '#94A3B8',
          formatter: (value: number) => (value * 100).toFixed(0) + '%'
        },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      yAxis: {
        type: 'value',
        name: 'Recall',
        nameLocation: 'middle',
        nameGap: 40,
        min: 0,
        max: 1,
        axisLabel: { 
          color: '#94A3B8',
          formatter: (value: number) => (value * 100).toFixed(0) + '%'
        },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: metrics.map(m => ({
        name: m.method,
        type: 'scatter',
        symbolSize: 20,
        data: [[m.precision, m.recall]],
        itemStyle: {
          color: this.getMethodColor(m.method),
          borderColor: '#0B1020',
          borderWidth: 2
        },
        label: {
          show: true,
          position: 'right',
          formatter: (params: any) => m.method,
          color: '#94A3B8',
          fontSize: 11
        }
      }))
    };

    this.prChart.setOption(option, true);
  }

  // Radar Chart
  updateRadarChart(): void {
    if (!this.radarChart) return;

    const metrics = this.filteredMetrics();
    const selectedMetrics = Array.from(this.selectedMetrics());
    
    const option: EChartsOption = {
      tooltip: {
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' }
      },
      legend: {
        data: metrics.map(m => m.method),
        bottom: 0,
        textStyle: { color: '#94A3B8' }
      },
      radar: {
        indicator: selectedMetrics.map(metric => ({
          name: metric.charAt(0).toUpperCase() + metric.slice(1),
          max: 1
        })),
        shape: 'polygon',
        splitNumber: 5,
        axisName: {
          color: '#94A3B8'
        },
        splitLine: {
          lineStyle: {
            color: '#334155'
          }
        },
        splitArea: {
          show: true,
          areaStyle: {
            color: ['#1E293B', '#0B1020']
          }
        },
        axisLine: {
          lineStyle: {
            color: '#334155'
          }
        }
      },
      series: [{
        type: 'radar',
        data: metrics.map(m => ({
          value: selectedMetrics.map(metric => m[metric as keyof MethodMetrics]),
          name: m.method,
          lineStyle: {
            color: this.getMethodColor(m.method),
            width: 2
          },
          areaStyle: {
            color: this.getMethodColor(m.method),
            opacity: 0.2
          },
          itemStyle: {
            color: this.getMethodColor(m.method)
          }
        }))
      }]
    };

    this.radarChart.setOption(option, true);
  }

  // Scatter Plot (F1 vs MCC)
  updateScatterChart(): void {
    if (!this.scatterChart) return;

    const metrics = this.filteredMetrics();
    const dataset = this.selectedDataset();
    
    // Add some variation for scatter effect
    const scatterData = metrics.map(m => ({
      method: m.method,
      value: [
        m.f1 + (Math.random() - 0.5) * 0.02,
        m.mcc + (Math.random() - 0.5) * 0.02
      ] as [number, number]
    }));

    const option: EChartsOption = {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' },
        formatter: (params: any) => {
          const data = params.data;
          return `${data.method}<br/>F1: ${(data.value[0] * 100).toFixed(1)}%<br/>MCC: ${(data.value[1] * 100).toFixed(1)}%`;
        }
      },
      xAxis: {
        type: 'value',
        name: 'F1 Score',
        nameLocation: 'middle',
        nameGap: 30,
        min: 0.6,
        max: 1,
        axisLabel: { 
          color: '#94A3B8',
          formatter: (value: number) => (value * 100).toFixed(0) + '%'
        },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      yAxis: {
        type: 'value',
        name: 'MCC',
        nameLocation: 'middle',
        nameGap: 40,
        min: 0.5,
        max: 1,
        axisLabel: { 
          color: '#94A3B8',
          formatter: (value: number) => value.toFixed(1)
        },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: [{
        type: 'scatter',
        symbolSize: 25,
        data: scatterData.map(d => ({
          value: d.value,
          method: d.method,
          itemStyle: {
            color: this.getMethodColor(d.method),
            borderColor: '#0B1020',
            borderWidth: 2,
            shadowBlur: 10,
            shadowColor: this.getMethodColor(d.method)
          }
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (params: any) => params.data.method,
          color: '#94A3B8',
          fontSize: 11
        }
      }]
    };

    this.scatterChart.setOption(option, true);
  }
}
