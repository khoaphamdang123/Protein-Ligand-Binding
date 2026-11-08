import { Component, DestroyRef, OnInit, QueryList, ViewChildren, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LIGAND_CLASSES, LigandClass } from '../../core/models/prediction.model';
import {
  DatasetId, ExploreIndex, ExploreMetrics, LoadedProtein, MODEL_IDS, ModelId, ProteinRow, ResidueStatus,
} from '../../core/models/explore.model';
import { ExploreDataService } from '../../core/services/explore-data.service';
import { bitsToBooleans, displayName, ligandsOf, residueStatus, validLigand } from '../../core/utils/explore';
import { LIGAND_CLASS_COLORS, LOW_PLDDT, STATUS_COLORS } from '../../core/utils/prediction-colors';
import {
  CameraLink, FocusMode, PredictionColorMode, PredictionViewerComponent,
} from '../../molecular/prediction-viewer/prediction-viewer.component';
import { CompareTrack, ResidueCompareComponent } from '../../molecular/residue-compare/residue-compare.component';
import { StructureLegendComponent } from '../../molecular/structure-legend/structure-legend.component';
import { ProteinPickerComponent } from './protein-picker.component';

interface ModelPanel {
  id: ModelId;
  label: string;
  threshold: number;
  proxy: boolean;              // scored with the nucleic-acid output (no DNA / RNA specific output)
  probability: number[];
  binding: boolean[];
  status: ResidueStatus[];
  metrics: ExploreMetrics | null;
}

/** What is on screen: a protein, loaded, with one of its ligand classes. Changes as one unit. */
interface Shown extends LoadedProtein {
  row: ProteinRow;
  ligand: LigandClass;
}

type ColorChoice = { value: PredictionColorMode; label: string };

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [DecimalPipe, RouterLink, PredictionViewerComponent, StructureLegendComponent, ProteinPickerComponent,
    ResidueCompareComponent],
  templateUrl: './explorer.component.html',
  styleUrl: './explorer.component.scss',
})
export class ExplorerComponent implements OnInit {
  private data = inject(ExploreDataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  @ViewChildren(PredictionViewerComponent) private viewers!: QueryList<PredictionViewerComponent>;

  readonly ligandClasses = LIGAND_CLASSES;
  readonly ligandColors = LIGAND_CLASS_COLORS;
  readonly statusColors = STATUS_COLORS;
  readonly lowPlddt = LOW_PLDDT;
  readonly modelIds = MODEL_IDS;
  readonly colorModes: ColorChoice[] = [
    { value: 'outcome', label: 'Outcome' },
    { value: 'probability', label: 'Probability' },
    { value: 'plddt', label: 'pLDDT' },
    { value: 'rainbow', label: 'N to C' },
  ];
  readonly cameraLink = new CameraLink();
  readonly name = displayName;

  index = signal<ExploreIndex | null>(null);
  failure = signal<string | null>(null);

  // Selection
  dataset = signal<DatasetId>('TestSet300');
  ligandFilter = signal<LigandClass | 'all'>('all');
  proteinId = signal<string | null>(null);
  shown = signal<Shown | null>(null);
  loadingProtein = signal(false);
  selectedIndex = signal<number | null>(null);
  hoverIndex = signal<number | null>(null);

  // View
  colorMode = signal<PredictionColorMode>('outcome');
  errorsOnly = signal(false);
  linked = signal(true);
  copied = signal(false);

  datasetProteins = computed(() => (this.index()?.proteins ?? []).filter(p => p.split === this.dataset()));

  /** How many proteins of the dataset have a site for each ligand class. */
  ligandCounts = computed(() => {
    const counts: Partial<Record<LigandClass, number>> = {};
    for (const p of this.datasetProteins()) {
      for (const l of ligandsOf(p)) counts[l] = (counts[l] ?? 0) + 1;
    }
    return counts;
  });

  listed = computed(() => {
    const filter = this.ligandFilter();
    const all = this.datasetProteins();
    return filter === 'all' ? all : all.filter(p => (p.ligands[filter] ?? 0) > 0);
  });

  selectedRow = computed(() => this.index()?.proteins.find(p => p.id === this.proteinId()) ?? null);
  position = computed(() => this.listed().findIndex(p => p.id === this.proteinId()));

  /** Only the ligand classes this protein has a site for. */
  ligandChoices = computed(() => {
    const row = this.selectedRow();
    if (!row) return [];
    const available = ligandsOf(row);
    return LIGAND_CLASSES.filter(l => available.includes(l.value)).map(l => ({ ...l, residues: row.ligands[l.value] ?? 0 }));
  });

  ligand = computed(() => this.shown()?.ligand ?? 'metal');
  /** Set while the page shows AdaBind's best protein of the test set, so that it is not read as a typical one. */
  featured = computed(() => {
    const s = this.shown();
    const best = s ? this.index()?.featured[s.row.split] : null;
    return best && best.protein === s?.doc.id && best.ligand === s.ligand ? best : null;
  });
  ligandLabel = computed(() => LIGAND_CLASSES.find(l => l.value === this.ligand())?.label ?? '');
  ligandColor = computed(() => LIGAND_CLASS_COLORS[this.ligand()]);

  truth = computed(() => {
    const s = this.shown();
    return s ? bitsToBooleans(s.doc.labels[s.ligand]) : [];
  });

  panels = computed<ModelPanel[]>(() => {
    const s = this.shown();
    const index = this.index();
    if (!s || !index) return [];
    const truth = this.truth();
    return MODEL_IDS.map(id => {
      const model = s.doc.models[id];
      const binding = bitsToBooleans(model.call[s.ligand]);
      return {
        id,
        label: index.models[id].label,
        threshold: index.models[id].thresholds[s.ligand],
        proxy: id !== 'adabind' && (s.ligand === 'dna' || s.ligand === 'rna'),
        probability: model.prob[s.ligand],
        binding,
        status: residueStatus(truth, binding),
        metrics: model.metrics[s.ligand] ?? null,
      };
    });
  });

  tracks = computed<CompareTrack[]>(() => this.panels().map(p => ({ id: p.id, label: p.label, status: p.status })));

  meanPlddt = computed(() => {
    const p = this.shown()?.doc.plddt ?? [];
    return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0;
  });

  /** Residues worth reading: every ground-truth residue and every residue a model calls binding. */
  residueRows = computed(() => {
    const s = this.shown();
    if (!s) return [];
    const truth = this.truth();
    const panels = this.panels();
    const rows = [];
    for (let i = 0; i < s.doc.sequence.length; i++) {
      if (truth[i] || panels.some(p => p.binding[i])) {
        rows.push({
          index: i + 1, aa: s.doc.sequence[i], plddt: s.doc.plddt[i], truth: truth[i],
          models: panels.map(p => ({ id: p.id, probability: p.probability[i], status: p.status[i] })),
        });
      }
    }
    return rows;
  });

  /** Readout of the residue under the pointer, else of the selected one. */
  readout = computed(() => {
    const s = this.shown();
    const position = this.hoverIndex() ?? this.selectedIndex();
    if (!s || !position) return null;
    const i = position - 1;
    return {
      position, aa: s.doc.sequence[i], plddt: s.doc.plddt[i], truth: this.truth()[i],
      models: this.panels().map(p => ({ label: p.label, probability: p.probability[i], status: p.status[i] })),
    };
  });

  benchmark = computed(() => {
    const index = this.index();
    if (!index) return null;
    const entry = index.summary[this.dataset()][this.ligand()];
    const models = MODEL_IDS.map(id => ({ id, label: index.models[id].label, m: entry.models[id] }));
    return { proteins: entry.n_proteins_with_site, residues: models[0].m.n_residues, positives: models[0].m.n_positive, models };
  });

  private loadToken = 0;

  ngOnInit(): void {
    const sub = this.data.index().subscribe({
      next: index => {
        this.index.set(index);
        this.restoreFromUrl(index);
      },
      error: () => this.failure.set('The comparison data could not be loaded (explore-data/index.json).'),
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private restoreFromUrl(index: ExploreIndex): void {
    const params = this.route.snapshot.queryParamMap;
    const color = params.get('color');
    if (this.colorModes.some(c => c.value === color)) {
      this.colorMode.set(color as PredictionColorMode);
    }
    const asked = index.proteins.find(p => p.id === params.get('protein'));
    const dataset = params.get('dataset');
    if (asked) {
      this.dataset.set(asked.split);
    } else if (index.datasets.some(d => d.id === dataset)) {
      this.dataset.set(dataset as DatasetId);
    }
    const best = index.featured[this.dataset()];
    const res = Number(params.get('res'));
    this.selectProtein(asked?.id ?? best.protein, asked ? params.get('ligand') as LigandClass | null : best.ligand,
      Number.isInteger(res) && res > 0 ? res : null);
  }

  // ---- Selection ----

  onDataset(event: Event): void {
    const dataset = (event.target as HTMLSelectElement).value as DatasetId;
    this.dataset.set(dataset);
    this.ligandFilter.set('all');
    if (this.selectedRow()?.split === dataset) {
      this.syncUrl();
      return;
    }
    const best = this.index()?.featured[dataset];
    if (best) this.selectProtein(best.protein, best.ligand);
  }

  onLigandFilter(filter: LigandClass | 'all'): void {
    this.ligandFilter.set(filter);
    if (filter === 'all') return;
    const current = this.selectedRow();
    if (current && (current.ligands[filter] ?? 0) > 0) {
      this.setLigand(filter);
    } else if (this.listed()[0]) {
      this.selectProtein(this.listed()[0].id, filter);
    }
  }

  async selectProtein(id: string, ligand: LigandClass | null = null, residue: number | null = null): Promise<void> {
    const row = this.index()?.proteins.find(p => p.id === id);
    if (!row) return;
    const wanted = ligand ?? (this.ligandFilter() === 'all' ? this.shown()?.ligand ?? null : this.ligandFilter() as LigandClass);
    const token = ++this.loadToken;
    this.proteinId.set(id);
    this.loadingProtein.set(true);
    this.failure.set(null);
    try {
      const loaded = await this.data.protein(id);
      if (token !== this.loadToken) return;
      this.selectedIndex.set(residue && residue <= row.length ? residue : null);
      this.hoverIndex.set(null);
      this.shown.set({ ...loaded, row, ligand: validLigand(row, wanted) });
      this.syncUrl();
    } catch {
      if (token === this.loadToken) this.failure.set(`The data of ${id} could not be loaded.`);
    } finally {
      if (token === this.loadToken) this.loadingProtein.set(false);
    }
  }

  setLigand(ligand: LigandClass): void {
    const s = this.shown();
    if (s && ligand !== s.ligand) {
      this.shown.set({ ...s, ligand });
      this.syncUrl();
    }
  }

  step(delta: number): void {
    const next = this.listed()[this.position() + delta];
    if (next) this.selectProtein(next.id);
  }

  private syncUrl(): void {
    const s = this.shown();
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        dataset: this.dataset(), protein: s?.doc.id ?? null, ligand: s?.ligand ?? null,
        res: this.selectedIndex(), color: this.colorMode() === 'outcome' ? null : this.colorMode(),
      },
    });
  }

  // ---- Residue selection, shared by the three viewers, the track and the table ----

  selectResidue(index: number): void {
    this.selectedIndex.set(this.selectedIndex() === index ? null : index);
    this.syncUrl();
  }

  // ---- Viewers ----

  setColorMode(mode: PredictionColorMode): void {
    this.colorMode.set(mode);
    this.syncUrl();
  }

  toggleLinked(): void {
    this.linked.update(v => !v);
    this.cameraLink.enabled = this.linked();
  }

  focus(mode: FocusMode): void {
    this.viewers.forEach(v => v.focusPocket(mode));
  }

  resetView(): void {
    this.viewers.forEach(v => v.resetView());
  }

  exportPng(model: number): void {
    const s = this.shown();
    if (s) {
      this.viewers.get(model)?.exportPng(2, `${s.doc.id}_${s.ligand}_${MODEL_IDS[model]}_${this.colorMode()}`);
    }
  }

  downloadPdb(): void {
    const s = this.shown();
    if (!s) return;
    const url = URL.createObjectURL(new Blob([s.pdb], { type: 'chemical/x-pdb' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${s.doc.id}_esmfold.pdb`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  copyLink(): void {
    navigator.clipboard?.writeText(location.href).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }, () => undefined);
  }
}
