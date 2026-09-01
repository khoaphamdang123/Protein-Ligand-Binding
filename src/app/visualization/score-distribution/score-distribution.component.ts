import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective } from 'ngx-echarts';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'app-score-distribution',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  template: `
    <div class="distribution-wrapper">
      <h3 class="distribution-title">Score Distribution</h3>
      <div class="distribution-chart">
        <div echarts [options]="chartOption" class="chart"></div>
      </div>
    </div>
  `,
  styles: [`
    .distribution-wrapper {
      background-color: rgba(26, 35, 50, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .distribution-title {
      font-size: 1rem;
      font-weight: 600;
      color: #F8FAFC;
      margin: 0 0 1rem 0;
    }

    .distribution-chart {
      width: 100%;
      height: 250px;
    }

    .chart {
      width: 100%;
      height: 100%;
    }
  `]
})
export class ScoreDistributionComponent {
  @Input() title: string = 'Score Distribution';
  @Input() scores: number[] = [];

  get chartOption(): EChartsOption {
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B',
        borderColor: '#334155',
        textStyle: {
          color: '#F8FAFC'
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
        data: ['0-0.1', '0.1-0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0'],
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
        axisLine: {
          lineStyle: {
            color: '#334155'
          }
        },
        axisLabel: {
          color: '#94A3B8'
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
          name: 'Count',
          type: 'bar',
          data: this.getDistribution(),
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#EF4444' },
                { offset: 0.5, color: '#F59E0B' },
                { offset: 1, color: '#10B981' }
              ]
            },
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    };
  }

  private getDistribution(): number[] {
    const bins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    
    if (this.scores.length === 0) {
      return [10, 15, 25, 40, 60, 80, 95, 75, 45, 20];
    }

    this.scores.forEach(score => {
      const bin = Math.min(9, Math.floor(score * 10));
      bins[bin]++;
    });

    return bins;
  }
}
