import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Residue } from '../../core/models/protein.model';

interface SequenceBlock {
  position: number;
  aminoAcid: string;
  isBinding: boolean;
  predictionScore: number;
  isSelected: boolean;
}

@Component({
  selector: 'app-sequence-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sequence-viewer">
      <div class="sequence-controls">
        <button class="zoom-btn" (click)="zoomOut()" [disabled]="zoom <= 1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <span class="zoom-label">{{ zoom }}x</span>
        <button class="zoom-btn" (click)="zoomIn()" [disabled]="zoom >= 3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
      </div>

      <div class="sequence-scroll-container">
        <div class="sequence-content" [style.font-size.px]="12 * zoom">
          <!-- Position track -->
          <div class="sequence-track position-track">
            <div class="track-label">Position</div>
            <div class="track-content">
              @for (block of getVisibleBlocks(); track block.position) {
                <div 
                  class="sequence-cell position-cell"
                  [class.selected]="block.isSelected"
                >
                  @if (block.position % 10 === 0 || block.position === 1) {
                    <span class="position-marker">{{ block.position }}</span>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Amino acid track -->
          <div class="sequence-track aa-track">
            <div class="track-label">Sequence</div>
            <div class="track-content">
              @for (block of getVisibleBlocks(); track block.position) {
                <button
                  class="sequence-cell aa-cell"
                  [class.selected]="block.isSelected"
                  [class.binding]="block.isBinding"
                  [class.predicted]="block.predictionScore > 0.5"
                  [title]="'Position ' + block.position + ': ' + block.aminoAcid"
                  (click)="onResidueClick(block.position)"
                >
                  {{ block.aminoAcid }}
                </button>
              }
            </div>
          </div>

          <!-- Ground truth track -->
          <div class="sequence-track truth-track">
            <div class="track-label">Ground Truth</div>
            <div class="track-content">
              @for (block of getVisibleBlocks(); track block.position) {
                <div 
                  class="sequence-cell truth-cell"
                  [class.selected]="block.isSelected"
                  [class.binding]="block.isBinding"
                >
                  <span class="truth-indicator" *ngIf="block.isBinding">●</span>
                </div>
              }
            </div>
          </div>

          <!-- Prediction track -->
          <div class="sequence-track prediction-track">
            <div class="track-label">Prediction</div>
            <div class="track-content">
              @for (block of getVisibleBlocks(); track block.position) {
                <div 
                  class="sequence-cell prediction-cell"
                  [class.selected]="block.isSelected"
                  [class.predicted]="block.predictionScore > 0.5"
                >
                  <div 
                    class="prediction-bar"
                    [style.height.%]="block.predictionScore * 100"
                    [style.background-color]="getConfidenceColor(block.predictionScore)"
                  ></div>
                </div>
              }
            </div>
          </div>

          <!-- Confidence track -->
          <div class="sequence-track confidence-track">
            <div class="track-label">Confidence</div>
            <div class="track-content">
              @for (block of getVisibleBlocks(); track block.position) {
                <div 
                  class="sequence-cell confidence-cell"
                  [class.selected]="block.isSelected"
                >
                  @if (block.predictionScore > 0.5) {
                    <span class="confidence-value">{{ (block.predictionScore * 100).toFixed(0) }}%</span>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div class="sequence-legend">
        <div class="legend-item">
          <span class="legend-symbol binding">●</span>
          <span class="legend-label">Binding Site</span>
        </div>
        <div class="legend-item">
          <span class="legend-symbol predicted">▮</span>
          <span class="legend-label">Predicted</span>
        </div>
        <div class="legend-item">
          <span class="legend-symbol selected">□</span>
          <span class="legend-label">Selected</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .sequence-viewer {
      display: flex;
      flex-direction: column;
      height: 100%;
      background-color: var(--color-bg-primary);
    }

    .sequence-controls {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      background-color: var(--color-bg-secondary);
      border-bottom: 1px solid var(--color-border-primary);
    }

    .zoom-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      background: transparent;
      border: 1px solid var(--color-border-primary);
      border-radius: var(--radius-base);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);

      svg {
        width: 16px;
        height: 16px;
      }

      &:hover:not(:disabled) {
        color: var(--color-text-primary);
        background-color: var(--color-bg-hover);
        border-color: var(--color-primary);
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
    }

    .zoom-label {
      font-size: var(--font-size-sm);
      font-family: var(--font-mono);
      color: var(--color-text-secondary);
      min-width: 32px;
      text-align: center;
    }

    .sequence-scroll-container {
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .sequence-content {
      display: flex;
      flex-direction: column;
      min-width: max-content;
      padding: var(--space-4);
    }

    .sequence-track {
      display: flex;
      margin-bottom: var(--space-2);

      &:last-child {
        margin-bottom: 0;
      }
    }

    .track-label {
      width: 120px;
      flex-shrink: 0;
      padding: var(--space-2);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: var(--letter-spacing-wide);
      display: flex;
      align-items: center;
    }

    .track-content {
      display: flex;
      gap: 1px;
      flex: 1;
    }

    .sequence-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 32px;
      background-color: var(--color-bg-panel);
      border: 1px solid var(--color-border-primary);
      font-family: var(--font-mono);
      font-size: 0.85em;
      transition: all var(--transition-fast);

      &.selected {
        border-color: var(--color-warning);
        box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.2);
        z-index: 1;
      }
    }

    .position-cell {
      position: relative;
      background-color: var(--color-bg-secondary);
      color: var(--color-text-tertiary);
      font-size: 0.7em;
    }

    .position-marker {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      font-size: 10px;
      color: var(--color-text-tertiary);
    }

    .aa-cell {
      cursor: pointer;
      padding: 0;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);

      &:hover {
        background-color: var(--color-bg-hover);
        border-color: var(--color-primary);
        transform: translateY(-2px);
      }

      &.binding {
        background-color: rgba(34, 211, 238, 0.15);
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      &.predicted {
        background-color: rgba(52, 211, 153, 0.15);
        border-color: var(--color-success);
      }
    }

    .truth-cell {
      background-color: var(--color-bg-secondary);
      color: var(--color-primary);

      &.binding {
        background-color: rgba(34, 211, 238, 0.1);
      }
    }

    .truth-indicator {
      font-size: 1.2em;
    }

    .prediction-cell {
      background-color: var(--color-bg-secondary);
      position: relative;
      overflow: hidden;
    }

    .prediction-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      transition: all var(--transition-fast);
    }

    .confidence-cell {
      background-color: var(--color-bg-secondary);
      font-size: 0.7em;
      color: var(--color-text-tertiary);
    }

    .confidence-value {
      font-weight: var(--font-weight-semibold);
    }

    .sequence-legend {
      display: flex;
      align-items: center;
      gap: var(--space-6);
      padding: var(--space-3) var(--space-4);
      background-color: var(--color-bg-secondary);
      border-top: 1px solid var(--color-border-primary);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .legend-symbol {
      font-size: var(--font-size-base);
      
      &.binding {
        color: var(--color-primary);
      }

      &.predicted {
        color: var(--color-success);
      }

      &.selected {
        color: var(--color-warning);
      }
    }

    .legend-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
  `]
})
export class SequenceViewerComponent {
  @Input() residues: Residue[] = [];
  @Input() selectedPosition: number | null = null;
  @Output() residueClick = new EventEmitter<number>();

  zoom = 1;
  scrollPosition = 0;

  getVisibleBlocks(): SequenceBlock[] {
    return this.residues.map(residue => ({
      position: residue.position,
      aminoAcid: residue.aminoAcid,
      isBinding: residue.isBinding || residue.experimentalBinding || false,
      predictionScore: residue.predictionScore || 0,
      isSelected: residue.position === this.selectedPosition
    }));
  }

  getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'var(--color-success)';
    if (confidence >= 0.6) return 'var(--color-primary)';
    if (confidence >= 0.4) return 'var(--color-warning)';
    return 'var(--color-text-tertiary)';
  }

  zoomIn(): void {
    if (this.zoom < 3) {
      this.zoom += 0.5;
    }
  }

  zoomOut(): void {
    if (this.zoom > 1) {
      this.zoom -= 0.5;
    }
  }

  onResidueClick(position: number): void {
    this.residueClick.emit(position);
  }
}
