import { Component, ElementRef, HostListener, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { LIGAND_CLASSES, LigandClass } from '../../core/models/prediction.model';
import { ProteinRow } from '../../core/models/explore.model';
import { displayName, ligandsOf, matchesQuery } from '../../core/utils/explore';
import { LIGAND_CLASS_COLORS } from '../../core/utils/prediction-colors';

const MAX_SHOWN = 150;

/** Search-as-you-type protein list. Each row: name (the sequence when no name is known), then accession and sequence. */
@Component({
  selector: 'app-protein-picker',
  standalone: true,
  template: `
    <div class="picker" [class.open]="open()">
      @if (open()) {
        <input #search class="field" type="text" role="combobox" aria-label="Search proteins" aria-expanded="true"
               aria-controls="protein-list" autocomplete="off" spellcheck="false"
               placeholder="Name, accession, gene, organism or sequence fragment"
               [value]="query()" (input)="onQuery($event)" (keydown)="onKey($event)" />
      } @else {
        <button type="button" class="field current" aria-haspopup="listbox" (click)="show()">
          @if (selected(); as p) {
            <span class="current-name" [class.seq]="!p.name">{{ name(p) }}</span>
            <span class="current-id">{{ p.id }}</span>
          } @else {
            <span class="current-name">Select a protein</span>
          }
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      }

      @if (open()) {
        <div class="drop">
          <div class="filters" role="group" aria-label="Filter by ligand">
            <button type="button" [class.active]="filter() === 'all'" (click)="filterChange.emit('all')">
              All <b>{{ total() }}</b>
            </button>
            @for (l of ligandClasses; track l.value) {
              <button type="button" [class.active]="filter() === l.value" [disabled]="!counts()[l.value]"
                      (click)="filterChange.emit(l.value)">
                {{ l.short }} <b>{{ counts()[l.value] ?? 0 }}</b>
              </button>
            }
          </div>
          <ul id="protein-list" class="list" role="listbox">
            @for (p of shown(); track p.id; let i = $index) {
              <li role="option" [attr.aria-selected]="p.id === selected()?.id" [attr.data-i]="i"
                  [class.active]="i === active()" [class.chosen]="p.id === selected()?.id"
                  (mouseenter)="active.set(i)" (mousedown)="choose(p, $event)">
                <div class="row-main">
                  <span class="row-name" [class.seq]="!p.name">{{ name(p) }}</span>
                  <span class="row-sub"><b>{{ p.id }}</b> {{ p.sequence }}</span>
                </div>
                <div class="row-side">
                  <span class="row-len">{{ p.length }} aa</span>
                  <span class="row-ligands">
                    @for (l of ligands(p); track l) {
                      <i [style.background]="colors[l]" [attr.title]="ligandLabel(l)"></i>
                    }
                  </span>
                </div>
              </li>
            } @empty {
              <li class="none">No protein matches.</li>
            }
          </ul>
          @if (matches().length > shown().length) {
            <p class="more">{{ matches().length - shown().length }} more: refine the search to see them.</p>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './protein-picker.component.scss',
})
export class ProteinPickerComponent {
  proteins = input.required<ProteinRow[]>();     // of the current dataset and ligand filter
  selected = input<ProteinRow | null>(null);
  filter = input<LigandClass | 'all'>('all');
  counts = input<Partial<Record<LigandClass, number>>>({});
  total = input(0);
  pick = output<string>();
  filterChange = output<LigandClass | 'all'>();

  readonly ligandClasses = LIGAND_CLASSES;
  readonly colors = LIGAND_CLASS_COLORS;

  @ViewChild('search') private searchInput?: ElementRef<HTMLInputElement>;
  private host = inject(ElementRef<HTMLElement>);

  open = signal(false);
  query = signal('');
  active = signal(0);
  matches = computed(() => this.proteins().filter(p => matchesQuery(p, this.query())));
  shown = computed(() => this.matches().slice(0, MAX_SHOWN));

  name = displayName;
  ligands = ligandsOf;

  ligandLabel(l: LigandClass): string {
    return LIGAND_CLASSES.find(c => c.value === l)?.label ?? l;
  }

  show(): void {
    this.query.set('');
    this.active.set(Math.max(0, this.matches().findIndex(p => p.id === this.selected()?.id)));
    this.open.set(true);
    setTimeout(() => {
      this.searchInput?.nativeElement.focus();
      this.scrollToActive();
    });
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
  }

  onKey(event: KeyboardEvent): void {
    const last = this.shown().length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.update(i => Math.max(0, Math.min(last, i + (event.key === 'ArrowDown' ? 1 : -1))));
      this.scrollToActive();
    } else if (event.key === 'Enter') {
      const p = this.shown()[this.active()];
      if (p) this.choose(p);
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  choose(protein: ProteinRow, event?: Event): void {
    event?.preventDefault();
    this.open.set(false);
    this.pick.emit(protein.id);
  }

  private scrollToActive(): void {
    const el = this.host.nativeElement as HTMLElement;
    el.querySelector?.(`[data-i="${this.active()}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentDown(event: MouseEvent): void {
    if (this.open() && !(this.host.nativeElement as HTMLElement).contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
