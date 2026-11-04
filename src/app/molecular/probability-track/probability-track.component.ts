import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, QueryList, SimpleChanges, ViewChild, ViewChildren
} from '@angular/core';
import { LOW_PLDDT, plddtColor, probabilityColor } from '../../core/utils/prediction-colors';
import { ResidueStatus } from '../../core/models/explore.model';

interface TrackCell {
  index: number;          // 1-based
  aa: string;
  probability: number;
  plddt: number;
  binding: boolean;
  predicted: boolean;
  status: ResidueStatus | null;
  color: string;
  plddtColor: string;
  title: string;
}

/**
 * Sequence wrapped in rows: each residue tinted by binding probability, binding residues
 * outlined, predicted residues marked, with a pLDDT bar underneath. Click a residue to
 * select it; the selected residue is scrolled into view.
 */
@Component({
  selector: 'app-probability-track',
  standalone: true,
  template: `
    <div class="track" role="list" #scroll>
      @for (row of rows; track row[0].index) {
        <div class="track-row">
          <span class="row-start">{{ row[0].index }}</span>
          <div class="row-cells">
            @for (cell of row; track cell.index) {
              <button
                type="button"
                class="cell"
                role="listitem"
                #cellRef
                [class.binding]="cell.binding"
                [class.predicted]="cell.predicted"
                [class.selected]="cell.index === selectedIndex"
                [class.tick]="cell.index % 10 === 0"
                [attr.data-index]="cell.index"
                [title]="cell.title"
                [attr.aria-label]="cell.title"
                (click)="residueSelect.emit(cell.index)"
              >
                <span class="aa" [style.background-color]="cell.color">{{ cell.aa }}</span>
                <span class="plddt" [style.background-color]="cell.plddtColor"></span>
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .track {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      overflow-x: auto;
      font-family: var(--font-mono);
    }
    .track-row { display: flex; align-items: flex-start; gap: var(--space-2); }
    .row-start {
      flex: 0 0 2.5rem;
      text-align: right;
      padding-top: 3px;
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }
    .row-cells { display: flex; }
    .cell {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 18px;
      padding: 1px;
      border: 1px solid transparent;
      border-radius: 3px;
      background: none;
      cursor: pointer;
      &.tick { margin-right: 4px; }
      &:hover { border-color: var(--color-text-secondary); }
      &.binding { border-color: var(--color-text-primary); }
      &.binding .aa { font-weight: var(--font-weight-bold); }
      &.predicted::before {
        content: '';
        position: absolute;
        top: -1px;
        left: 1px;
        right: 1px;
        height: 2px;
        border-radius: 1px;
        background: #34D399;
      }
      &.selected { border-color: #22D3EE; box-shadow: 0 0 0 1px #22D3EE; }
    }
    .aa {
      display: block;
      height: 18px;
      line-height: 18px;
      font-size: 11px;
      text-align: center;
      color: #0B1020;
      border-radius: 2px;
    }
    .plddt { display: block; height: 4px; margin-top: 2px; border-radius: 1px; }
  `]
})
export class ProbabilityTrackComponent implements OnChanges, AfterViewInit {
  @Input() sequence = '';
  @Input() probability: number[] = [];
  @Input() binding: boolean[] = [];
  @Input() plddt: number[] = [];
  @Input() predicted: boolean[] = [];
  @Input() status: ResidueStatus[] = [];
  @Input() selectedIndex: number | null = null;
  @Input() rowLength = 50;
  @Output() residueSelect = new EventEmitter<number>();

  @ViewChild('scroll') scrollEl!: ElementRef<HTMLElement>;
  @ViewChildren('cellRef') cellRefs!: QueryList<ElementRef<HTMLButtonElement>>;

  rows: TrackCell[][] = [];

  private lastSelected: number | null = null;

  ngOnChanges(changes?: SimpleChanges): void {
    const cells = [...this.sequence].map((aa, i): TrackCell => {
      const probability = this.probability[i] ?? 0;
      const plddt = this.plddt[i] ?? 0;
      const binding = this.binding[i] ?? false;
      const predicted = this.predicted[i] ?? false;
      const status = this.status[i] ?? null;
      const lowConfidence = plddt < LOW_PLDDT ? ' (low structure confidence)' : '';
      return {
        index: i + 1,
        aa,
        probability,
        plddt,
        binding,
        predicted,
        status,
        color: probabilityColor(probability),
        plddtColor: plddtColor(plddt),
        title: `${aa}${i + 1} · p = ${probability.toFixed(3)}${binding ? ' · BINDING' : ''}${predicted ? ' · predicted' : ''}${status ? ` · ${status}` : ''} · pLDDT ${plddt.toFixed(2)}${lowConfidence}`
      };
    });
    this.rows = [];
    for (let i = 0; i < cells.length; i += this.rowLength) {
      this.rows.push(cells.slice(i, i + this.rowLength));
    }

    if (changes?.['selectedIndex'] && this.selectedIndex !== this.lastSelected) {
      this.lastSelected = this.selectedIndex;
      setTimeout(() => this.scrollToSelected(), 0);
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.scrollToSelected(), 0);
  }

  private scrollToSelected(): void {
    if (!this.selectedIndex) return;
    const cell = this.cellRefs?.find(el => el.nativeElement.dataset['index'] === String(this.selectedIndex));
    if (cell?.nativeElement && typeof cell.nativeElement.scrollIntoView === 'function') {
      cell.nativeElement.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }
}
