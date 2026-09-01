import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective } from 'ngx-echarts';
import { EChartsOption } from 'echarts';

interface MethodMetrics {
  method: string;
  precision: number;
  recall: number;
  f1Score: number;
  color: string;
}

@Component({
  selector: 'app-metric-comparison',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  template: `
    <div class="comparison-wrapper">
      <h3 class="comparison-title">{{ title }}</h3>
      <div class="comparison-chart">
        <div echarts [options]="chartOption" class="chart"></div>
      </div>
    </div>
  `,
  styles: [`
    .comparison-wrapper {
      background-color: rgba(26, 35, 50, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .comparison-title {
      font-size: 1rem;
      font-weight: 600;
      color: #F8FAFC;
      margin: 0 0 1rem 0;
    }

    .comparison-chart {
      width: 100%;
      height: 350px;
    }

    .chart {
      width: 100%;
      height: 100%;
    }
  `]
})
export class MetricComparisonComponent {
  @Input() title: string = 'Method Comparison';
  @Input() metrics: MethodMetrics[] = [];

  get chartOption(): EChartsOption {
    const methods = this.metrics.map(m => m.method);
    const precision = this.metrics.map(m => (m.precision * 100).toFixed(1));
    const recall = this.metrics.map(m => (m.recall * 100).toFixed(1));
    const f1Score = this.metrics.map(m => (m.f1Score * 100).toFixed(1));

    return {
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
          color: '#94A3B8'
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
            color: '#22D3EE'
          }
        },
        {
          name: 'Recall',
          type: 'bar',
          data: recall,
          itemStyle: {
            color: '#38BDF8'
          }
        },
        {
          name: 'F1 Score',
          type: 'bar',
          data: f1Score,
          itemStyle: {
            color: '#F97316'
          }
        }
      ]
    };
  }
}
