import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective } from 'ngx-echarts';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'app-metric-chart',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  template: `
    <div class="chart-wrapper">
      <div class="chart-header">
        <h3 class="chart-title">{{ title }}</h3>
      </div>
      <div class="chart-container">
        <div echarts [options]="chartOption" class="chart"></div>
      </div>
    </div>
  `,
  styles: [`
    .chart-wrapper {
      background-color: rgba(26, 35, 50, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .chart-header {
      margin-bottom: 1rem;
    }

    .chart-title {
      font-size: 1rem;
      font-weight: 600;
      color: #F8FAFC;
      margin: 0;
    }

    .chart-container {
      width: 100%;
      height: 300px;
    }

    .chart {
      width: 100%;
      height: 100%;
    }
  `]
})
export class MetricChartComponent {
  @Input() title: string = 'Performance Metrics';
  @Input() data: { name: string; value: number }[] = [];

  get chartOption(): EChartsOption {
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
        },
        formatter: (params: any) => {
          const param = params[0];
          return `${param.name}<br/>${param.seriesName}: ${(param.value * 100).toFixed(1)}%`;
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: this.data.map(d => d.name),
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
        max: 1,
        axisLine: {
          lineStyle: {
            color: '#334155'
          }
        },
        axisLabel: {
          color: '#94A3B8',
          formatter: (value: number) => `${(value * 100).toFixed(0)}%`
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
          name: 'Score',
          type: 'bar',
          data: this.data.map(d => d.value),
          itemStyle: {
            color: '#22D3EE',
            borderRadius: [4, 4, 0, 0]
          },
          barWidth: '50%'
        }
      ]
    };
  }
}
