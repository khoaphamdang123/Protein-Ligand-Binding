import { Component, DestroyRef, OnInit, QueryList, ViewChildren, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import {
  ApiFailure,
  BaselineId,
  BindingType,
  CompareResult,
  DiagnosticsResponse,
  FoldingStatus,
  HealthResponse,
  LIGAND_CLASSES,
  LigandClass,
  PredictResult,
} from '../../core/models/prediction.model';
import { ExploreIndex } from '../../core/models/explore.model';
import { ExploreDataService } from '../../core/services/explore-data.service';
import { NOT_CONNECTED, PredictionApiService } from '../../core/services/prediction-api.service';
import { ErrorReporterService } from '../../core/services/error-reporter.service';
import { LIGAND_CLASS_COLORS, LOW_PLDDT } from '../../core/utils/prediction-colors';
import { CameraLink, PredictionColorMode, PredictionViewerComponent } from '../../molecular/prediction-viewer/prediction-viewer.component';
import { ProbabilityTrackComponent } from '../../molecular/probability-track/probability-track.component';
import { CompareTrack, ResidueCompareComponent } from '../../molecular/residue-compare/residue-compare.component';
import { StructureLegendComponent } from '../../molecular/structure-legend/structure-legend.component';
import { DiagnosticsPanelComponent } from './diagnostics-panel.component';
import { checkSequence, headerAccession } from './sequence-check';

/** While local ESMFold folds on the CPU (HTTP 202), the same request is sent again this often. */
export const FOLD_POLL_MS = 10_000;

/** Test-set proteins: their structures are precomputed, so these run without folding. */
const EXAMPLES: { name: string; ligand: LigandClass; sequence: string }[] = [
  { name: 'MntR', ligand: 'metal', sequence: '>Q9K943 HTH-type transcriptional regulator MntR\nMPTPSMEDYLERIYLLIEEKGYARVSDIAEALEVHPSSVTKMVQKLDKSDYLVYERYRGLILTAKGKKIGKRLVYRHDLLEDFLKMIGVDSDHIYEDVEGIEHHLSWDAIDRIGDLVQYFQEDPSRLNDLREVQKKNEE' },
  { name: 'PsbH', ligand: 'small', sequence: '>Q8DJ43 Photosystem II reaction center protein H\nMARRTWLGDILRPLNSEYGKVAPGWGTTPLMAVFMGLFLVFLLIILEIYNSTLILDGVNVSWKALG' },
  { name: 'Cre recombinase', ligand: 'dna', sequence: '>P06956 Recombinase cre\nMSNLLTVHQNLPALPVDATSDEVRKNLMDMFRDRQAFSEHTWKMLLSVCRSWAAWCKLNNRKWFPAEPEDVRDYLLYLQARGLAVKTIQQHLGQLNMLHRRSGLPRPSDSNAVSLVMRRIRKENVDAGERAKQALAFERTDFDQVRSLMENSDRCQDIRNLAFLGIAYNTLLRIAEIARIRVKDISRTDGGRMLIHIGRTKTLVSTAGVEKALSLGVTKLVERWISVSGVADDPNNYLFCRVRKNGVAAPSATSQLSTRALEGIFEATHRLIYGAKDDSGQRYLAWSGHSARVGAARDMARAGVSIPEIMQAGGWTNVNIVMNYIRNLDSETGAMVRLLEDGD' },
  { name: 'bL28', ligand: 'rna', sequence: '>D0CAL0 Large ribosomal subunit protein bL28\nMSKVCQVTGKRPVVGNNVSHANNKTKRRFEPNLHHHRFWLESEKRFVRLRLTTKGMRIIDKLGIEKVVADLRAQGQKI' },
];

const BASELINES: BaselineId[] = ['bindEmbed21DL', 'bindNode24'];
const STATUS_RETRY_MS = 5000;

const ERROR_TITLES: Record<string, string> = {
  SEQUENCE_INVALID: 'Invalid sequence',
  REQUEST_INVALID: 'Invalid request',
  SEQUENCE_TOO_LONG: 'Sequence too long',
  PDB_INVALID: 'Invalid PDB file',
  STRUCTURE_UNAVAILABLE: 'No structure available for this sequence',
  BASELINES_UNAVAILABLE: 'Comparison models not installed',
  BASELINES_FAILED: 'Comparison models failed',
  ESMFOLD_FAILED: 'Structure prediction failed',
  PREDICTOR_UNAVAILABLE: 'Model not available',
  PREDICTOR_FAILED: 'Model failed',
  INTERNAL_ERROR: 'Backend error',
  BACKEND_UNREACHABLE: 'Backend not running',
  PROXY_MISSING: 'Wrong AI server address',
  API_NOT_CONFIGURED: 'No AI server',
  CLIENT_TIMEOUT: 'Request timed out',
};

type SourceState = 'ok' | 'unknown' | 'off' | 'wait';

@Component({
  selector: 'app-predict',
  standalone: true,
  imports: [DecimalPipe, RouterLink, PredictionViewerComponent, ProbabilityTrackComponent, ResidueCompareComponent,
    StructureLegendComponent, DiagnosticsPanelComponent],
  templateUrl: './predict.component.html',
  styleUrl: './predict.component.scss'
})
export class PredictComponent implements OnInit {
  private api = inject(PredictionApiService);
  private reporter = inject(ErrorReporterService);
  private exploreData = inject(ExploreDataService);
  private destroyRef = inject(DestroyRef);

  @ViewChildren(PredictionViewerComponent) private viewers!: QueryList<PredictionViewerComponent>;

  readonly ligands = LIGAND_CLASSES;
  readonly examples = EXAMPLES;
  readonly lowPlddt = LOW_PLDDT;
  readonly colorModes: { value: PredictionColorMode; label: string }[] = [
    { value: 'probability', label: 'Probability' },
    { value: 'plddt', label: 'pLDDT' },
    { value: 'rainbow', label: 'N to C' },
  ];

  // Input
  inputMode = signal<'sequence' | 'pdb'>('sequence');
  sequenceInput = signal('');
  pdbInput = signal('');
  pdbFileName = signal<string | null>(null);
  bindingType = signal<LigandClass>('metal');

  // Backend status
  health = signal<HealthResponse | null>(null);
  healthError = signal<ApiFailure | null>(null);
  diagnostics = signal<DiagnosticsResponse | null>(null);
  showDiagnostics = signal(false);

  // Request / result
  loading = signal(false);
  elapsed = signal(0);
  result = signal<PredictResult | null>(null);
  error = signal<ApiFailure | null>(null);
  colorMode = signal<PredictionColorMode>('probability');
  selectedIndex = signal<number | null>(null);
  showSticks = signal(true);
  private benchmark = signal<ExploreIndex | null>(null);

  // Compare mode: the two other models on the same sequence and structure
  view = signal<'adabind' | 'compare'>('adabind');
  comparison = signal<CompareResult | null>(null);
  comparing = signal(false);
  compareError = signal<ApiFailure | null>(null);
  linked = signal(true);
  hoverIndex = signal<number | null>(null);
  readonly cameraLink = new CameraLink();

  minLength = computed(() => this.health()?.min_length ?? 30);
  maxLength = computed(() => this.health()?.max_length ?? 1000);
  apiLimit = computed(() => this.health()?.structure_sources?.esmatlas?.max_length ?? 400);
  check = computed(() => checkSequence(this.sequenceInput(), this.minLength(), this.maxLength()));
  pdbCheck = computed(() => {
    const pdb = this.pdbInput();
    if (!pdb.trim()) return { valid: false, error: '' };
    if (!pdb.includes('ATOM')) return { valid: false, error: 'No ATOM records found — not a valid PDB structure.' };
    return { valid: true, error: '' };
  });
  /** False on static hosting without an AI server (config.json): the page then sends no request at all. */
  readonly connected = this.api.connected;
  readonly notConnected = NOT_CONNECTED;

  canSubmit = computed(() => {
    if (this.loading() || !this.connected) return false;
    return this.inputMode() === 'pdb' ? this.pdbCheck().valid : (!!this.check().sequence && !this.check().error);
  });

  errorCount = computed(() => (this.diagnostics()?.recent_problems ?? []).filter(p => p.level === 'ERROR').length);
  starting = computed(() => {
    const h = this.health();
    return h?.self_test === 'running' || h?.esmfold_local === 'running';
  });
  /** The device of the prediction models; self-hosted ESMFold has its own place in the structure sources. */
  device = computed(() => {
    const devices = { ...this.health()?.devices };
    delete devices['esmfold'];
    const kinds = new Set(Object.values(devices).map(d => (d.startsWith('cuda') ? 'GPU' : 'CPU')));
    return kinds.size === 1 ? [...kinds][0] : kinds.size ? 'GPU + CPU' : null;
  });

  /** Where a structure comes from, in the order tried, with the state of each source. */
  sources = computed(() => {
    const s = this.health()?.structure_sources;
    if (!s) {
      return [];
    }
    const local = s.local;
    const cpu = local?.device === 'cpu';
    // unavailable on a GPU: "no CUDA GPU on this machine" / "no GPU configured", else busy or out of memory
    const localLabel = local?.state === 'off' ? 'ESMFold off'   // BINDSITE_ESMFOLD_LOCAL=off (e.g. Hugging Face)
      : cpu ? (local?.state === 'disabled' ? 'ESMFold CPU off' : local?.state === 'loading' ? 'ESMFold CPU loading' : 'ESMFold CPU')
      : local?.state === 'unavailable' ? (local.message?.startsWith('no ') ? 'no local GPU' : 'local GPU busy')
      : local?.state === 'loading' ? 'local GPU loading' : local?.state === 'ready' ? 'local GPU' : 'local GPU off';
    // a CPU model that is not loaded yet loads with the first fold: "unknown", not "off"
    const localState: SourceState = local?.state === 'ready' ? 'ok' : local?.state === 'loading' ? 'wait'
      : cpu && local?.state !== 'disabled' ? 'unknown' : 'off';
    return [
      { label: s.precomputed?.count ? `${s.precomputed.count.toLocaleString('en-US')} cached` : 'cache',
        state: (s.precomputed?.status === 'ok' ? 'ok' : s.precomputed?.status === 'running' ? 'wait' : 'off') as SourceState,
        title: s.precomputed?.message },
      { label: 'ESMFold API', state: (s.esmatlas?.status === 'error' ? 'off' : 'unknown') as SourceState, title: s.esmatlas?.message },
      { label: localLabel, state: localState, title: local?.message },
      { label: 'your PDB', state: 'unknown' as SourceState, title: 'Fold the sequence elsewhere and upload the structure' },
    ];
  });

  ligandLabel = computed(() => LIGAND_CLASSES.find(l => l.value === this.bindingType())?.label ?? '');
  ligandColor = computed(() => LIGAND_CLASS_COLORS[this.bindingType()]);
  resultLigand = computed(() => LIGAND_CLASSES.find(l => l.value === this.result()?.binding_type)?.label ?? '');
  resultColor = computed(() => LIGAND_CLASS_COLORS[(this.result()?.binding_type ?? 'metal') as LigandClass] ?? LIGAND_CLASS_COLORS.metal);

  /** AdaBind on the two test sets for the chosen ligand class (same checked numbers as Explore). */
  expected = computed(() => {
    const b = this.benchmark();
    if (!b) {
      return null;
    }
    const of = (set: 'TestSet300' | 'TestSetNew46') => b.summary[set]?.[this.bindingType()]?.models.adabind;
    const [first, second] = [of('TestSet300'), of('TestSetNew46')];
    return first && second ? { a: first, b: second } : null;
  });

  compareAvailable = computed(() => this.health()?.compare !== false);

  /** The two other models, for the result on screen. */
  baselinePanels = computed(() => {
    const r = this.result();
    const c = this.comparison();
    if (!r || !c || this.view() !== 'compare') {
      return [];
    }
    return BASELINES.map(id => {
      const m = c.models[id];
      const af = m.structure?.source === 'alphafold_db' ? m.structure : null;
      return {
        id, label: id, ...m,
        pdb: af?.pdb ?? r.structure.pdb,
        plddt: af?.plddt ?? r.structure.plddt,
        alphafold: af,
        proxy: r.binding_type !== 'nuclear' && m.output === 'nuclear',
        called: m.binding.filter(Boolean).length,
        shared: m.binding.filter((b, i) => b && r.binding[i]).length,
      };
    });
  });

  /** No ground truth here: each row shows which residues that model called. */
  compareTracks = computed<CompareTrack[]>(() => {
    const r = this.result();
    const panels = this.baselinePanels();
    if (!r || !panels.length) {
      return [];
    }
    const called = (b: boolean[]) => b.map((x): 'TP' | 'TN' => (x ? 'TP' : 'TN'));
    return [{ id: 'adabind', label: 'AdaBind', status: called(r.binding) },
      ...panels.map(p => ({ id: p.id, label: p.label, status: called(p.binding) }))];
  });

  anyCalled = computed(() => {
    const r = this.result();
    const panels = this.baselinePanels();
    return r ? r.binding.map((b, i) => b || panels.some(p => p.binding[i])) : [];
  });

  calledByAll = computed(() => {
    const r = this.result();
    const panels = this.baselinePanels();
    return r && panels.length ? r.binding.filter((b, i) => b && panels.every(p => p.binding[i])).length : 0;
  });

  /** The residue under the pointer, else the selected one, across the three models. */
  compareReadout = computed(() => {
    const r = this.result();
    const position = this.hoverIndex() ?? this.selectedIndex();
    if (!r || !position || !this.baselinePanels().length) {
      return null;
    }
    const i = position - 1;
    return {
      position, aa: r.sequence[i], plddt: r.structure.plddt[i],
      models: [{ label: 'AdaBind', probability: r.probability[i], called: r.binding[i] },
        ...this.baselinePanels().map(p => ({ label: p.label, probability: p.probability[i], called: p.binding[i] }))],
    };
  });

  summary = computed(() => {
    const r = this.result();
    if (!r) {
      return null;
    }
    const plddt = r.structure.plddt;
    return {
      nBinding: r.binding_residues.length,
      meanPlddt: plddt.reduce((a, b) => a + b, 0) / plddt.length,
      lowConfidence: plddt.filter(p => p < LOW_PLDDT).length,
      bindingInLowConfidence: r.binding_residues.filter(b => plddt[b.index - 1] < LOW_PLDDT).length,
    };
  });

  bindingRows = computed(() => {
    const r = this.result();
    if (!r) {
      return [];
    }
    return r.binding_residues
      .map(b => ({ ...b, plddt: r.structure.plddt[b.index - 1] }))
      .sort((a, b) => b.probability - a.probability);
  });

  selectedResidue = computed(() => {
    const r = this.result();
    const index = this.selectedIndex();
    if (!r || !index) {
      return null;
    }
    return {
      index,
      aa: r.sequence[index - 1],
      probability: r.probability[index - 1],
      plddt: r.structure.plddt[index - 1],
      binding: r.binding[index - 1],
    };
  });

  private request?: Subscription;
  private compareRequest?: Subscription;
  private accession: string | null = null;   // from the FASTA header of the request on screen
  private statusFailures = 0;
  private timer?: ReturnType<typeof setInterval>;
  private statusPoll?: ReturnType<typeof setTimeout>;
  private foldPoll?: ReturnType<typeof setTimeout>;
  /** Local ESMFold is folding this sequence on the CPU; the request is sent again every FOLD_POLL_MS. */
  folding = signal<FoldingStatus | null>(null);
  /** Seconds from Predict to the result when the structure was folded on the CPU meanwhile (else null). */
  waited = signal<number | null>(null);
  elapsedLabel = computed(() => {
    const s = this.elapsed();
    return s < 90 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  waitText = computed(() => {
    const f = this.folding();
    if (f?.stage === 'queued') {
      return `Waiting for ${f.ahead} other ESMFold run${f.ahead === 1 ? '' : 's'} on the CPU, then folding this sequence`;
    }
    if (f) {
      return `ESMFold is folding this ${f.length}-residue sequence on the CPU. This takes minutes; the result `
        + 'appears here. The fold goes on if you leave, and is kept for the next prediction.';
    }
    return this.inputMode() === 'pdb' ? 'Scoring residues' : 'Getting the structure, then scoring residues';
  });

  ngOnInit(): void {
    if (this.connected) {
      this.refreshStatus();
    }
    const benchmark = this.exploreData.index().subscribe({ next: i => this.benchmark.set(i), error: () => undefined });
    this.destroyRef.onDestroy(() => {
      benchmark.unsubscribe();
      this.request?.unsubscribe();
      this.compareRequest?.unsubscribe();
      this.stopTimer();
      clearTimeout(this.statusPoll);
      clearTimeout(this.foldPoll);
    });
  }

  refreshStatus(): void {
    if (!this.connected) {
      return;
    }
    this.api.health().subscribe({
      next: health => {
        this.statusFailures = 0;
        this.health.set(health);
        this.healthError.set(null);
        // Models are still loading (start-up self-test): check again shortly.
        clearTimeout(this.statusPoll);
        if (this.starting()) {
          this.statusPoll = setTimeout(() => this.refreshStatus(), 3000);
        }
      },
      error: (failure: ApiFailure) => {
        // One slow answer is not an outage (a restart, a stalled tunnel): keep the last status until the next check.
        this.statusFailures++;
        if (this.statusFailures > 1 || !this.health()) {
          this.health.set(null);
          this.healthError.set(failure);
        }
        clearTimeout(this.statusPoll);
        this.statusPoll = setTimeout(() => this.refreshStatus(), STATUS_RETRY_MS);
      }
    });
    this.api.diagnostics().subscribe({
      next: diagnostics => this.diagnostics.set(diagnostics),
      error: () => this.diagnostics.set(null)
    });
  }

  useExample(example: { ligand: LigandClass; sequence: string }): void {
    this.dropRunningRequest();   // its answer would be for the previous sequence
    this.inputMode.set('sequence');
    this.sequenceInput.set(example.sequence);
    this.bindingType.set(example.ligand);
    this.clearResult();
  }

  /** Another ligand: what is on screen no longer answers the question, so it goes, and the new answer is fetched. */
  chooseLigand(ligand: LigandClass): void {
    if (ligand === this.bindingType()) {
      return;
    }
    const rerun = !!this.result() || this.loading();
    this.bindingType.set(ligand);
    this.dropRunningRequest();
    this.clearResult();
    if (rerun) {
      this.predict();
    }
  }

  private dropRunningRequest(): void {
    this.request?.unsubscribe();
    if (this.loading()) {
      this.finish();
    }
  }

  private clearResult(): void {
    this.result.set(null);
    this.error.set(null);
    this.selectedIndex.set(null);
    this.hoverIndex.set(null);
    this.resetComparison();
  }

  onSequenceInput(event: Event): void {
    this.sequenceInput.set((event.target as HTMLTextAreaElement).value);
  }

  onPdbFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.pdbFileName.set(file.name);
    this.error.set(null);
    const reader = new FileReader();
    reader.onload = () => this.pdbInput.set(String(reader.result ?? ''));
    reader.onerror = () => {
      this.pdbInput.set('');
      this.pdbFileName.set(null);
    };
    reader.readAsText(file);
    // Allow re-selecting the same file.
    input.value = '';
  }

  clearPdb(): void {
    this.pdbInput.set('');
    this.pdbFileName.set(null);
  }

  predict(): void {
    if (this.loading()) {
      return;
    }
    const bindingType = this.bindingType();

    let send: () => Observable<PredictResult>;
    let length: number | undefined;
    if (this.inputMode() === 'pdb') {
      if (!this.pdbCheck().valid) return;
      this.accession = null;
      length = this.pdbInput().split('\n').filter(l => l.startsWith('ATOM')).length;
      const pdb = this.pdbInput();
      send = () => this.api.predictPdb({ pdb, binding_type: bindingType });
    } else {
      const { sequence, error } = this.check();
      if (!sequence || error) return;
      length = sequence.length;
      this.accession = headerAccession(this.sequenceInput());
      send = () => this.api.predict({ sequence, binding_type: bindingType });
    }

    this.request?.unsubscribe();
    this.error.set(null);
    this.waited.set(null);
    this.loading.set(true);
    this.startTimer();
    this.send(send, bindingType, length);
  }

  private send(send: () => Observable<PredictResult>, bindingType: BindingType, length: number | undefined): void {
    this.request = send().subscribe({
      next: result => {
        this.waited.set(this.folding() ? this.elapsed() : null);
        this.selectedIndex.set(null);
        this.hoverIndex.set(null);
        this.resetComparison();
        this.result.set(result);
        this.finish();
        if (this.view() === 'compare') {
          this.runComparison();
        }
      },
      error: (failure: ApiFailure) => {
        if (failure.code === 'STRUCTURE_FOLDING' && failure.folding) {
          // Not an error: folding on the CPU in the background. Ask again until the structure is there.
          this.folding.set(failure.folding);
          clearTimeout(this.foldPoll);
          this.foldPoll = setTimeout(() => this.send(send, bindingType, length), FOLD_POLL_MS);
          return;
        }
        this.error.set(failure);
        this.result.set(null);   // never leave another sequence's result under the error
        this.resetComparison();
        this.finish();
        if (!failure.requestId) {
          // Never reached the backend, so it is not in the backend log yet.
          this.reporter.report('error', `Prediction request failed: ${failure.code}: ${failure.message}`, 'predict',
            undefined, { status: failure.status, bindingType, length });
        }
      }
    });
  }

  cancel(): void {
    this.request?.unsubscribe();
    this.finish();
  }

  setView(view: 'adabind' | 'compare'): void {
    this.view.set(view);
    if (view === 'compare') {
      this.runComparison();
    }
  }

  runComparison(): void {
    const r = this.result();
    if (!r || this.comparison() || this.comparing()) {
      return;
    }
    this.comparing.set(true);
    this.compareError.set(null);
    // An uploaded structure is the user's choice: bindNode24 then runs on it too, not on an AlphaFold DB model.
    this.compareRequest = this.api.compare({
      sequence: r.sequence, pdb: r.structure.pdb, binding_type: r.binding_type, alphafold: r.structure.source !== 'upload',
      ...(this.accession ? { accession: this.accession } : {}),
    }).subscribe({
      next: comparison => {
        this.comparison.set(comparison);
        this.comparing.set(false);
      },
      error: (failure: ApiFailure) => {
        this.compareError.set(failure);
        this.comparing.set(false);
      }
    });
  }

  private resetComparison(): void {
    this.compareRequest?.unsubscribe();
    this.comparison.set(null);
    this.comparing.set(false);
    this.compareError.set(null);
  }

  toggleLinked(): void {
    this.linked.update(v => !v);
    this.cameraLink.enabled = this.linked();
  }

  selectResidue(index: number): void {
    this.selectedIndex.set(this.selectedIndex() === index ? null : index);
  }

  /** How the structure of this result was obtained. */
  structureLabel(r: PredictResult): string {
    switch (r.structure.source) {
      case 'precomputed': return 'ESMFold, cached';
      case 'esmatlas': return r.structure.cached ? 'ESMFold API, saved' : 'ESMFold API';
      case 'local': return r.structure.detail ? `Local ESMFold, ${r.structure.detail}`   // e.g. "CPU, 12 s"
        : r.structure.cached ? 'Local ESMFold, saved' : 'Local ESMFold';
      case 'upload': return 'Uploaded PDB';
    }
  }

  focusSite(): void {
    this.viewers.forEach(v => v.focusPocket('predicted'));
  }

  resetView(): void {
    this.viewers.forEach(v => v.resetView());
  }

  /** Viewer 0 is AdaBind, then the two other models. */
  exportPng(viewer = 0, model = 'adabind'): void {
    const r = this.result();
    if (r) {
      this.viewers.get(viewer)?.exportPng(2, `bindsite_${r.binding_type}_${r.length}aa_${model}_${this.colorMode()}`);
    }
  }

  downloadPdb(): void {
    const r = this.result();
    if (r) {
      this.save(new Blob([r.structure.pdb], { type: 'chemical/x-pdb' }), `bindsite_${r.length}aa.pdb`);
    }
  }

  errorTitle(failure: ApiFailure): string {
    return ERROR_TITLES[failure.code] ?? `Error ${failure.status || ''}`.trim();
  }

  canRetry(failure: ApiFailure): boolean {
    return failure.status === 0 || failure.status >= 500;
  }

  downloadJson(): void {
    const r = this.result();
    if (!r) {
      return;
    }
    this.save(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }), `bindsite_${r.binding_type}_${r.length}aa.json`);
  }

  private save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private finish(): void {
    this.loading.set(false);
    clearTimeout(this.foldPoll);
    this.folding.set(null);
    this.stopTimer();
    this.refreshStatus();
  }

  private startTimer(): void {
    this.stopTimer();
    const started = Date.now();
    this.elapsed.set(0);
    this.timer = setInterval(() => this.elapsed.set(Math.round((Date.now() - started) / 1000)), 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
