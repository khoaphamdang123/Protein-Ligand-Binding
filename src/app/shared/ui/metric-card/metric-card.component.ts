import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-label">{{ label }}</span>
        @if (trend) {
          <span class="metric-trend" [class.positive]="trend > 0" [class.negative]="trend < 0">
            {{ trend > 0 ? '+' : '' }}{{ trend }}%
          </span>
        }
      </div>
      <div class="metric-value" [class]="'metric-value-' + colorClass">
        {{ formattedValue }}
      </div>
      @if (showBar && value !== undefined) {
        <div class="metric-bar">
          <div 
            class="metric-bar-fill" 
            [class]="'bar-' + colorClass"
            [style.width.%]="Math.min(100, value * 100)"
          ></div>
        </div>
      }
      @if (subtitle) {
        <div class="metric-subtitle">{{ subtitle }}</div>
      }
    </div>
  `,
  styles: [`
    .metric-card {
      padding: 1rem;
      background-color: #1E293B;
      border: 1px solid rgba(148, 163, 184, 0.08);
      border-radius: 8px;
      text-align: center;
    }

    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .metric-label {
      font-size: 0.75rem;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 500;
    }

    .metric-trend {
      font-size: 0.75rem;
      font-weight: 600;

      &.positive { color: #10B981; }
      &.negative { color: #EF4444; }
    }

    .metric-value {
      font-size: 1.75rem;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      
      &-success { color: #10B981; }
      &-warning { color: #F59E0B; }
      &-error { color: #EF4444; }
      &-primary { color: #22D3EE; }
      &-neutral { color: #F8FAFC; }
    }

    .metric-bar {
      margin-top: 0.5rem;
      height: 4px;
      background-color: #334155;
      border-radius: 2px;
      overflow: hidden;
    }

    .metric-bar-fill {
      height: 100%;
      transition: width 0.5s ease;
      border-radius: 2px;

      &.bar-success { background-color: #10B981; }
      &.bar-warning { background-color: #F59E0B; }
      &.bar-error { background-color: #EF4444; }
      &.bar-primary { background-color: #22D3EE; }
    }

    .metric-subtitle {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: #64748B;
    }
  `]
})
export class MetricCardComponent {
  @Input() label: string = '';
  @Input() value?: number;
  @Input() formattedValue: string = '';
  @Input() colorClass: 'success' | 'warning' | 'error' | 'primary' | 'neutral' = 'neutral';
  @Input() showBar: boolean = false;
  @Input() trend?: number;
  @Input() subtitle?: string;
  
  Math = Math;
}
