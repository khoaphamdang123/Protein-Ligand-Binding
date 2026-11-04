import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe, PercentPipe } from '@angular/common';
import { DatasetType } from '../../core/models/dataset.model';
import { PredictionMethod } from '../../core/models/method.model';
import { BINDING_TYPES, BindingType } from '../../core/models/prediction.model';
import {
  ExploreFilters,
  ExploreProtein,
  ExploreResult,
} from '../../core/models/explore.model';
import { ExploreDataService } from '../../core/services/explore-data.service';
import {
  LIGAND_CLASS_COLORS,
  LOW_PLDDT,
  PLDDT_BANDS,
  STATUS_COLORS,
  STATUS_LABELS,
  probabilityGradientCss,
} from '../../core/utils/prediction-colors';
import {
  FocusMode,
  PredictionColorMode,
  PredictionViewerComponent,
} from '../../molecular/prediction-viewer/prediction-viewer.component';
import { ProbabilityTrackComponent } from '../../molecular/probability-track/probability-track.component';

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [CommonModule, DecimalPipe, PercentPipe, PredictionViewerComponent, ProbabilityTrackComponent],
  templateUrl: './explorer.component.html',
  styleUrl: './explorer.component.scss'
})
export class ExplorerComponent implements OnInit {
  private exploreData = inject(ExploreDataService);

  @ViewChild(PredictionViewerComponent) viewer?: PredictionViewerComponent;

  proteins = this.exploreData.proteins;

  readonly methods: PredictionMethod[] = ['AdaBind', 'bindEmbed21DL', 'bindNode24'];
  readonly bindingTypes = BINDING_TYPES;
  readonly plddtBands = PLDDT_BANDS;
  readonly lowPlddt = LOW_PLDDT;
  readonly statusColors = STATUS_COLORS;
  readonly statusLabels = STATUS_LABELS;
  readonly ligandClassColors = LIGAND_CLASS_COLORS;
  readonly probabilityGradient = probabilityGradientCss();
  readonly rainbowGradient = 'linear-gradient(90deg, #E53935, #FB8C00, #FDD835, #43A047, #00ACC1, #1E5AA8, #7E57C2)';
  readonly colorModes: { value: PredictionColorMode; label: string }[] = [
    { value: 'rainbow', label: 'Structure' },
    { value: 'probability', label: 'Confidence' },
    { value: 'plddt', label: 'pLDDT' },
    { value: 'chain', label: 'Chain' },
  ];

  filters = signal<ExploreFilters>({
    dataset: 'all',
    method: 'AdaBind',
    bindingType: 'all',
    searchQuery: '',
  });

  currentIndex = signal(0);
  result = signal<ExploreResult | null>(null);
  selectedIndex = signal<number | null>(null);

  // Viewer settings.
  colorMode = signal<PredictionColorMode>('rainbow');
  showGroundTruth = signal(true);
  showPredicted = signal(true);
  errorsOnly = signal(false);
  exportScale = signal(2);

  readonly datasetOptions: { value: ExploreFilters['dataset']; label: string }[] = [
    { value: 'all', label: 'All Datasets' },
    { value: 'TestSet300', label: 'TestSet300 (300)' },
    { value: 'TestSetNew46', label: 'TestSetNew46 (46)' },
  ];

  readonly bindingTypeOptions: { value: ExploreFilters['bindingType']; label: string }[] = [
    { value: 'all', label: 'All Types' },
    { value: 'metal', label: 'Metal ion' },
    { value: 'nuclear', label: 'Nucleic acid' },
    { value: 'small', label: 'Small molecule' },
  ];

  readonly filtered = computed<ExploreProtein[]>(() => {
    const f = this.filters();
    const q = f.searchQuery.trim().toLowerCase();
    return this.proteins().filter(p => {
      if (f.dataset !== 'all' && p.dataset !== f.dataset) return false;
      if (f.bindingType !== 'all' && p.bindingType !== f.bindingType) return false;
      if (q) {
        const hay = `${p.id} ${p.uniprotId} ${p.pdbId} ${p.name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  readonly currentProtein = computed<ExploreProtein | null>(() => {
    const list = this.filtered();
    const i = this.currentIndex();
    return list[i] ?? null;
  });

  readonly total = computed(() => this.filtered().length);

  readonly selectedResidue = computed(() => {
    const r = this.result();
    const i = this.selectedIndex();
    if (!r || !i) return null;
    const idx = i - 1;
    return {
      position: i,
      aa: r.protein.sequence[idx],
      probability: r.probability[idx],
      plddt: r.plddt[idx],
      predicted: r.binding[idx],
      groundTruth: r.groundTruth[idx],
      status: r.status[idx],
    };
  });

  readonly summary = computed(() => {
    const r = this.result();
    if (!r) return null;
    const p = r.plddt;
    const sorted = [...p].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const mean = p.reduce((a, b) => a + b, 0) / p.length;
    return {
      meanPlddt: mean,
      medianPlddt: median,
      nBinding: r.groundTruth.filter(Boolean).length,
      nPredicted: r.binding.filter(Boolean).length,
      length: r.protein.length,
    };
  });

  private pendingSelection: number | null = null;

  ngOnInit(): void {
    this.restoreFromQuery();
    this.reloadResult();
  }

  private restoreFromQuery(): void {
    const params = new URLSearchParams(window.location.search);
    const method = params.get('method');
    const type = params.get('type');
    const dataset = params.get('dataset');
    const color = params.get('color');
    if (method && (this.methods as string[]).includes(method)) {
      this.filters.update(f => ({ ...f, method: method as PredictionMethod }));
    }
    if (type && (this.bindingTypes.map(t => t.value) as string[]).includes(type)) {
      this.filters.update(f => ({ ...f, bindingType: type as BindingType }));
    }
    if (dataset === 'TestSet300' || dataset === 'TestSetNew46' || dataset === 'all') {
      this.filters.update(f => ({ ...f, dataset }));
    }
    if (color === 'rainbow' || color === 'probability' || color === 'plddt' || color === 'chain') {
      this.colorMode.set(color as PredictionColorMode);
    }
    const proteinId = params.get('protein');
    if (proteinId) {
      const idx = this.filtered().findIndex(p => p.id === proteinId);
      if (idx >= 0) {
        this.currentIndex.set(idx);
        const res = Number(params.get('res'));
        if (Number.isInteger(res) && res > 0) this.pendingSelection = res;
        return;
      }
    }
  }

  private reloadResult(): void {
    const protein = this.currentProtein();
    if (!protein) {
      this.result.set(null);
      return;
    }
    this.result.set(this.exploreData.getResult(protein, this.filters().method));
    const sel = this.pendingSelection;
    this.pendingSelection = null;
    this.selectedIndex.set(sel && sel <= protein.length ? sel : null);
  }

  // ---- Filters & navigation ----

  onSearch(event: Event): void {
    const q = (event.target as HTMLInputElement).value;
    this.filters.update(f => ({ ...f, searchQuery: q }));
    this.currentIndex.set(0);
    this.reloadResult();
  }

  clearSearch(): void {
    this.filters.update(f => ({ ...f, searchQuery: '' }));
    this.currentIndex.set(0);
    this.reloadResult();
  }

  onDatasetChange(event: Event): void {
    const dataset = (event.target as HTMLSelectElement).value as DatasetType | 'all';
    this.filters.update(f => ({ ...f, dataset }));
    this.currentIndex.set(0);
    this.reloadResult();
  }

  onMethodChange(event: Event): void {
    const method = (event.target as HTMLSelectElement).value as PredictionMethod;
    this.filters.update(f => ({ ...f, method }));
    this.reloadResult();
  }

  onBindingTypeChange(event: Event): void {
    const bindingType = (event.target as HTMLSelectElement).value as BindingType | 'all';
    this.filters.update(f => ({ ...f, bindingType }));
    this.currentIndex.set(0);
    this.reloadResult();
  }

  resetFilters(): void {
    this.filters.set({ dataset: 'all', method: this.filters().method, bindingType: 'all', searchQuery: '' });
    this.currentIndex.set(0);
    this.reloadResult();
  }

  onSelectProtein(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const idx = this.filtered().findIndex(p => p.id === id);
    if (idx >= 0) {
      this.currentIndex.set(idx);
      this.reloadResult();
    }
  }

  goTo(index: number): void {
    const max = this.total() - 1;
    const clamped = Math.max(0, Math.min(max, index));
    if (clamped === this.currentIndex()) return;
    this.currentIndex.set(clamped);
    this.reloadResult();
  }

  prev(): void {
    this.goTo(this.currentIndex() - 1);
  }

  next(): void {
    this.goTo(this.currentIndex() + 1);
  }

  // ---- Residue sync (3D <-> sequence) ----

  onResidueSelect(index: number): void {
    this.selectedIndex.set(this.selectedIndex() === index ? null : index);
  }

  onResidueHover(index: number | null): void {
    // Reserved for future sequence-hover highlighting; the 3D tooltip already shows detail.
  }

  // ---- Viewer actions ----

  focusPocket(mode: FocusMode): void {
    this.viewer?.focusPocket(mode);
  }

  async exportPng(scale: number): Promise<void> {
    const protein = this.currentProtein();
    if (!protein) return;
    await this.viewer?.exportPng(scale, `${protein.pdbId}_${this.filters().method}_${this.colorMode()}`);
  }

  setExportScale(event: Event): void {
    const v = Number((event.target as HTMLSelectElement).value);
    if ([1, 2, 4].includes(v)) this.exportScale.set(v);
  }

  downloadPdb(): void {
    const r = this.result();
    const protein = this.currentProtein();
    if (!r || !protein) return;
    const url = URL.createObjectURL(new Blob([r.pdb], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${protein.pdbId}_${protein.id}.pdb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  copyShareLink(): void {
    const protein = this.currentProtein();
    if (!protein) return;
    const params = new URLSearchParams();
    params.set('protein', protein.id);
    params.set('method', this.filters().method);
    params.set('color', this.colorMode());
    const res = this.selectedIndex();
    if (res) params.set('res', String(res));
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    navigator.clipboard?.writeText(url).then(
      () => this.flashCopied(),
      () => { /* clipboard unavailable */ }
    );
  }

  private copied = signal(false);
  private flashCopied(): void {
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
  readonly justCopied = this.copied.asReadonly();

  // ---- Display helpers ----

  ligandClassLabel(type: BindingType): string {
    return this.bindingTypes.find(t => t.value === type)?.label ?? type;
  }
}
