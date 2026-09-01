import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';

interface Residue {
  position: number;
  aminoAcid: string;
  chainId: string;
  predictionScore?: number;
  isBinding: boolean;
}

@Component({
  selector: 'app-residue-viewer',
  standalone: true,
  imports: [CommonModule, BadgeComponent],
  template: `
    <div class="residue-viewer">
      <div class="residue-header">
        <h3>Binding Site Residues</h3>
        <app-badge variant="primary">{{ residues.length }} residues</app-badge>
      </div>

      <div class="residue-list">
        @for (residue of residues; track residue.position) {
          <div class="residue-item" [class.binding]="residue.isBinding">
            <div class="residue-identifier">
              <span class="amino-acid">{{ residue.aminoAcid }}</span>
              <span class="position">{{ residue.position + 1 }}</span>
            </div>
            <div class="residue-info">
              <span class="chain">Chain {{ residue.chainId }}</span>
              @if (residue.predictionScore !== undefined) {
                <div class="score-bar">
                  <div class="score-fill" [style.width.%]="residue.predictionScore * 100"></div>
                </div>
                <span class="score-value">{{ (residue.predictionScore * 100).toFixed(0) }}%</span>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .residue-viewer {
      background-color: #1E293B;
      border-radius: 8px;
      padding: 1rem;
    }

    .residue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);

      h3 {
        font-size: 0.875rem;
        font-weight: 600;
        color: #F8FAFC;
        margin: 0;
      }
    }

    .residue-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .residue-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.75rem;
      background-color: #0F172A;
      border-radius: 6px;
      transition: all 0.15s ease;

      &:hover {
        background-color: #1E293B;
      }

      &.binding {
        background-color: rgba(34, 211, 238, 0.1);
        border: 1px solid rgba(34, 211, 238, 0.2);

        .amino-acid {
          color: #22D3EE;
        }
      }
    }

    .residue-identifier {
      display: flex;
      align-items: baseline;
      gap: 0.25rem;
    }

    .amino-acid {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      font-weight: 600;
      color: #CBD5E1;
    }

    .position {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: #64748B;
    }

    .residue-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .chain {
      font-size: 0.6875rem;
      color: #64748B;
    }

    .score-bar {
      width: 40px;
      height: 4px;
      background-color: #334155;
      border-radius: 2px;
      overflow: hidden;
    }

    .score-fill {
      height: 100%;
      background: linear-gradient(90deg, #22D3EE, #38BDF8);
      border-radius: 2px;
    }

    .score-value {
      font-size: 0.6875rem;
      font-family: 'JetBrains Mono', monospace;
      color: #94A3B8;
    }
  `]
})
export class ResidueViewerComponent {
  @Input() residues: Residue[] = [];
}
