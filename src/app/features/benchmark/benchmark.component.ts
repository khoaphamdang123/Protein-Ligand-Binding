import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective } from 'ngx-echarts';
import { EChartsOption } from 'echarts';
import { MockDataService } from '../../core/services/mock-data.service';
import { DatasetStatistics } from '../../core/models/dataset.model';

@Component({
  selector: 'app-benchmark',
  imports: [CommonModule, NgxEchartsDirective],
  templateUrl: './benchmark.component.html',
  styleUrl: './benchmark.component.scss'
})
export class BenchmarkComponent implements OnInit {
  private mockDataService = inject(MockDataService);

  statistics = signal<DatasetStatistics | undefined>(undefined);
  loading = signal(true);
  selectedDataset = this.mockDataService.selectedDataset;

  performanceChartOption = signal<EChartsOption>({});

  rankedMethods = computed(() => {
    const stats = this.statistics();
    if (!stats) return [];

    return [...stats.methodPerformance]
      .sort((a, b) => b.avgF1 - a.avgF1);
  });

  ngOnInit(): void {
    this.loadStatistics();
  }

  loadStatistics(): void {
    this.loading.set(true);

    this.mockDataService.getDatasetStatistics(this.selectedDataset()).subscribe({
      next: (stats) => {
        this.statistics.set(stats);
        this.updateChart(stats);
        this.loading.set(false);
      }
    });
  }

  updateChart(stats: DatasetStatistics): void {
    const methods = stats.methodPerformance.map(m => m.method);
    const precision = stats.methodPerformance.map(m => (m.avgPrecision * 100).toFixed(1));
    const recall = stats.methodPerformance.map(m => (m.avgRecall * 100).toFixed(1));
    const f1 = stats.methodPerformance.map(m => (m.avgF1 * 100).toFixed(1));

    this.performanceChartOption.set({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        },
        backgroundColor: '#1E293B',
        borderColor: '#334155',
        textStyle: {
          color: '#F8FAFC'
        }
      },
      legend: {
        data: ['Precision', 'Recall', 'F1 Score'],
        textStyle: {
          color: '#CBD5E1'
        },
        top: 0
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '15%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: methods,
        axisLine: {
          lineStyle: {
            color: '#334155'
          }
        },
        axisLabel: {
          color: '#94A3B8',
          rotate: 0
        }
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisLine: {
          lineStyle: {
            color: '#334155'
          }
        },
        axisLabel: {
          color: '#94A3B8',
          formatter: '{value}%'
        },
        splitLine: {
          lineStyle: {
            color: '#334155',
            type: 'dashed'
          }
        }
      },
      series: [
        {
          name: 'Precision',
          type: 'bar',
          data: precision,
          itemStyle: {
            color: '#22D3EE',
            borderRadius: [4, 4, 0, 0]
          }
        },
        {
          name: 'Recall',
          type: 'bar',
          data: recall,
          itemStyle: {
            color: '#38BDF8',
            borderRadius: [4, 4, 0, 0]
          }
        },
        {
          name: 'F1 Score',
          type: 'bar',
          data: f1,
          itemStyle: {
            color: '#F97316',
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    });
  }

  getRankClass(index: number): string {
    if (index === 0) return 'gold';
    if (index === 1) return 'silver';
    if (index === 2) return 'bronze';
    return '';
  }
}
