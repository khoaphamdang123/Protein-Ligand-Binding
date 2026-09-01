import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ConfusionMatrixData {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

@Component({
  selector: 'app-confusion-matrix',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="confusion-matrix-wrapper">
      <h3 class="matrix-title">Confusion Matrix</h3>
      <div class="matrix-container">
        <div class="matrix-grid">
          <!-- Header Row -->
          <div class="matrix-cell header top-left"></div>
          <div class="matrix-cell header top">Predicted Positive</div>
          <div class="matrix-cell header top">Predicted Negative</div>
          
          <!-- Row 1 -->
          <div class="matrix-cell header left">Actual Positive</div>
          <div class="matrix-cell value tp">
            <div class="cell-value">{{ data.truePositives }}</div>
            <div class="cell-label">True Positive</div>
          </div>
          <div class="matrix-cell value fn">
            <div class="cell-value">{{ data.falseNegatives }}</div>
            <div class="cell-label">False Negative</div>
          </div>
          
          <!-- Row 2 -->
          <div class="matrix-cell header left">Actual Negative</div>
          <div class="matrix-cell value fp">
            <div class="cell-value">{{ data.falsePositives }}</div>
            <div class="cell-label">False Positive</div>
          </div>
          <div class="matrix-cell value tn">
            <div class="cell-value">{{ data.trueNegatives }}</div>
            <div class="cell-label">True Negative</div>
          </div>
        </div>
      </div>

      <div class="matrix-summary">
        <div class="summary-item">
          <span class="summary-label">Total</span>
          <span class="summary-value">{{ total }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Accuracy</span>
          <span class="summary-value">{{ accuracy }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .confusion-matrix-wrapper {
      background-color: rgba(26, 35, 50, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .matrix-title {
      font-size: 1rem;
      font-weight: 600;
      color: #F8FAFC;
      margin: 0 0 1rem 0;
    }

    .matrix-container {
      display: flex;
      justify-content: center;
    }

    .matrix-grid {
      display: grid;
      grid-template-columns: auto 1fr 1fr;
      gap: 1px;
      background-color: rgba(148, 163, 184, 0.12);
      border-radius: 8px;
      overflow: hidden;
      min-width: 300px;
    }

    .matrix-cell {
      padding: 1rem;
      background-color: #1E293B;
      text-align: center;
      min-width: 100px;

      &.header {
        font-size: 0.75rem;
        font-weight: 600;
        color: #64748B;
        text-transform: uppercase;
        letter-spacing: 0.05em;

        &.top-left {
          background-color: #0F172A;
        }

        &.top {
          background-color: #0F172A;
        }

        &.left {
          background-color: #0F172A;
        }
      }

      &.value {
        background-color: #1E293B;
      }

      &.tp .cell-value { color: #10B981; }
      &.tn .cell-value { color: #10B981; }
      &.fp .cell-value { color: #EF4444; }
      &.fn .cell-value { color: #EF4444; }
    }

    .cell-value {
      font-size: 1.5rem;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      margin-bottom: 0.25rem;
    }

    .cell-label {
      font-size: 0.6875rem;
      color: #64748B;
    }

    .matrix-summary {
      display: flex;
      justify-content: center;
      gap: 2rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
    }

    .summary-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }

    .summary-label {
      font-size: 0.75rem;
      color: #64748B;
    }

    .summary-value {
      font-size: 1rem;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      color: #22D3EE;
    }
  `]
})
export class ConfusionMatrixComponent {
  @Input() data: ConfusionMatrixData = {
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0
  };

  get total(): number {
    return this.data.truePositives + this.data.falsePositives + 
           this.data.trueNegatives + this.data.falseNegatives;
  }

  get accuracy(): string {
    if (this.total === 0) return '0%';
    const acc = (this.data.truePositives + this.data.trueNegatives) / this.total;
    return `${(acc * 100).toFixed(1)}%`;
  }
}
