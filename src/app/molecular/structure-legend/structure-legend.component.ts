import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PLDDT_BANDS, STATUS_COLORS, probabilityGradientCss } from '../../core/utils/prediction-colors';
import { PredictionColorMode } from '../prediction-viewer/prediction-viewer.component';

/** What the colours of a 3D structure mean; shared by Explore and Predict. */
@Component({
  selector: 'app-structure-legend',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="legend">
      @switch (mode) {
        @case ('outcome') {
          <span class="item"><i [style.background]="status.TP"></i>True positive</span>
          <span class="item"><i [style.background]="status.FP"></i>False positive</span>
          <span class="item"><i [style.background]="status.FN"></i>False negative (missed)</span>
        }
        @case ('probability') {
          <span>0</span><span class="ramp" [style.background]="probabilityGradient"></span><span>1</span>
          <span class="muted">binding probability</span>
        }
        @case ('plddt') {
          @for (band of bands; track band.min) {
            <span class="item"><i [style.background]="band.color"></i>{{ band.label }}</span>
          }
        }
        @case ('rainbow') {
          <span>N</span><span class="ramp" [style.background]="rainbow"></span><span>C</span>
          <span class="muted">residue order</span>
        }
      }
      @if (mode !== 'outcome' && hasTruth) {
        <span class="sep"></span>
        <span class="item"><i [style.background]="status.TP"></i>TP</span>
        <span class="item"><i [style.background]="status.FP"></i>FP</span>
        <span class="item"><i [style.background]="status.FN"></i>FN</span>
        <span class="muted">sticks</span>
      }
      @if (!hasTruth && threshold !== null) {
        <span class="sep"></span>
        <span class="item"><i [style.background]="siteColor"></i>Called binding, p ≥ {{ threshold | number: '1.3-3' }}</span>
      }
    </div>
  `,
  styles: [`
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-3);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
    .item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    i { width: 10px; height: 10px; border-radius: 2px; flex: none; }
    .ramp { width: 110px; height: 8px; border-radius: 2px; }
    .sep { width: 1px; height: 12px; background: var(--color-border-primary); }
    .muted { color: var(--color-text-tertiary); }
  `],
})
export class StructureLegendComponent {
  @Input({ required: true }) mode!: PredictionColorMode;
  @Input() hasTruth = false;
  @Input() threshold: number | null = null;
  @Input() siteColor = '#22D3EE';

  readonly status = STATUS_COLORS;
  readonly bands = PLDDT_BANDS;
  readonly probabilityGradient = probabilityGradientCss();
  readonly rainbow = 'linear-gradient(90deg, #E53935, #FB8C00, #FDD835, #43A047, #00ACC1, #1E5AA8, #7E57C2)';
}
