import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, input, output, signal } from '@angular/core';
import { ResidueStatus } from '../../core/models/explore.model';
import { STATUS_COLORS } from '../../core/utils/prediction-colors';

export interface CompareTrack {
  id: string;
  label: string;
  status: ResidueStatus[];
}

const CELL = 14;          // px per residue
const GAP = 5;            // px between blocks of ten
const LABEL_WIDTH = 116;  // px

interface Column { index: number; aa: string; truth: boolean; status: ResidueStatus[]; ruler: boolean }

/**
 * The sequence, its ground truth and every model's outcome, residue by residue. One column per residue, grouped in
 * tens and wrapped to the available width. Hover reports the residue, click selects it in all viewers.
 * On the Predict page there is no ground truth: the rows then show which residues each model called.
 */
@Component({
  selector: 'app-residue-compare',
  standalone: true,
  template: `
    <div class="wrap" #wrap (mouseover)="onOver($event)" (mouseleave)="residueHover.emit(null)" (click)="onClick($event)">
      @for (line of lines(); track line[0][0].index) {
        <div class="line">
          <div class="labels">
            <span class="ruler-gap"></span>
            <span>Sequence</span>
            @if (showTruth()) { <span class="truth-label" [style.color]="color()">Ground truth</span> }
            @for (t of tracks(); track t.id) { <span [class.lead]="$first">{{ t.label }}</span> }
          </div>
          <div class="blocks">
            @for (block of line; track block[0].index) {
              <div class="block">
                @for (c of block; track c.index) {
                  <button type="button" class="col" [class.selected]="c.index === selectedIndex()" [attr.data-index]="c.index"
                          [attr.aria-label]="c.aa + c.index">
                    <span class="num">{{ c.ruler ? c.index : '' }}</span>
                    <span class="aa" [class.site]="c.truth">{{ c.aa }}</span>
                    @if (showTruth()) { <span class="gt" [style.background]="c.truth ? color() : null"></span> }
                    @for (s of c.status; track $index) {
                      <span class="out" [style.background-color]="s === 'TN' ? null : (calledColor() ?? colors[s])"></span>
                    }
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './residue-compare.component.scss',
})
export class ResidueCompareComponent implements AfterViewInit, OnDestroy {
  sequence = input.required<string>();
  truth = input.required<boolean[]>();
  tracks = input.required<CompareTrack[]>();
  color = input('#22D3EE');
  /** Without ground truth: no truth row, and `truth` marks the residues to print in bold. */
  showTruth = input(true);
  /** Without ground truth there are no outcomes: every called residue takes this colour. */
  calledColor = input<string | null>(null);
  selectedIndex = input<number | null>(null);
  residueSelect = output<number>();
  residueHover = output<number | null>();

  readonly colors = STATUS_COLORS;

  @ViewChild('wrap', { static: true }) private wrap!: ElementRef<HTMLElement>;
  private observer?: ResizeObserver;
  private width = signal(1100);

  /** lines -> blocks of ten -> columns */
  lines = computed<Column[][][]>(() => {
    const seq = this.sequence();
    const truth = this.truth();
    const tracks = this.tracks();
    const blockWidth = 10 * CELL + GAP;
    const blocksPerLine = Math.max(1, Math.floor((this.width() - LABEL_WIDTH + GAP) / blockWidth));
    const blocks: Column[][] = [];
    for (let start = 0; start < seq.length; start += 10) {
      const block: Column[] = [];
      for (let i = start; i < Math.min(start + 10, seq.length); i++) {
        block.push({
          index: i + 1, aa: seq[i], truth: truth[i], status: tracks.map(t => t.status[i]),
          ruler: (i + 1) % 10 === 0,
        });
      }
      blocks.push(block);
    }
    const lines: Column[][][] = [];
    for (let i = 0; i < blocks.length; i += blocksPerLine) {
      lines.push(blocks.slice(i, i + blocksPerLine));
    }
    return lines;
  });

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width > 0 && width !== this.width()) this.width.set(width);
    });
    this.observer.observe(this.wrap.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private indexAt(event: Event): number | null {
    const el = (event.target as HTMLElement).closest?.('[data-index]');
    return el ? Number(el.getAttribute('data-index')) : null;
  }

  onOver(event: Event): void {
    const index = this.indexAt(event);
    if (index) this.residueHover.emit(index);
  }

  onClick(event: Event): void {
    const index = this.indexAt(event);
    if (index) this.residueSelect.emit(index);
  }
}
