import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { Observable, Subscription } from 'rxjs';
import {
  ApiFailure,
  BINDING_TYPES,
  BindingType,
  DiagnosticsResponse,
  HealthResponse,
  PredictResult,
} from '../../core/models/prediction.model';
import { PredictionApiService } from '../../core/services/prediction-api.service';
import { ErrorReporterService } from '../../core/services/error-reporter.service';
import { LOW_PLDDT, PLDDT_BANDS, probabilityGradientCss } from '../../core/utils/prediction-colors';
import { PredictionColorMode, PredictionViewerComponent } from '../../molecular/prediction-viewer/prediction-viewer.component';
import { ProbabilityTrackComponent } from '../../molecular/probability-track/probability-track.component';
import { DiagnosticsPanelComponent } from './diagnostics-panel.component';
import { checkSequence } from './sequence-check';

const EXAMPLES = [
  {
    name: 'Ubiquitin (76 aa)',
    sequence: '>sp|P0CG48|UBIQUITIN Homo sapiens\nMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG'
  },
  {
    name: 'Rubredoxin, Fe site (54 aa)',
    sequence: '>sp|P00268|RUBR_CLOPA Clostridium pasteurianum\nMKKYTCTVCGYIYNPEDGDPDDGVNPGTDFKDIPDDWVCPLCGVGKDQFEEVEE'
  },
];

const ERROR_TITLES: Record<string, string> = {
  SEQUENCE_INVALID: 'Invalid sequence',
  REQUEST_INVALID: 'Invalid request',
  SEQUENCE_TOO_LONG: 'Sequence too long',
  ESMFOLD_FAILED: 'Structure prediction (ESMFold API) failed',
  PREDICTOR_UNAVAILABLE: 'Model not available',
  PREDICTOR_FAILED: 'Model failed',
  INTERNAL_ERROR: 'Backend error',
  BACKEND_UNREACHABLE: 'Backend not running',
  PROXY_MISSING: 'Dev server needs a restart',
  CLIENT_TIMEOUT: 'Request timed out',
};

@Component({
  selector: 'app-predict',
  standalone: true,
  imports: [DecimalPipe, PercentPipe, PredictionViewerComponent, ProbabilityTrackComponent, DiagnosticsPanelComponent],
  templateUrl: './predict.component.html',
  styleUrl: './predict.component.scss'
})
export class PredictComponent implements OnInit {
  private api = inject(PredictionApiService);
  private reporter = inject(ErrorReporterService);
  private destroyRef = inject(DestroyRef);

  readonly bindingTypes = BINDING_TYPES;
  readonly examples = EXAMPLES;
  readonly plddtBands = PLDDT_BANDS;
  readonly probabilityGradient = probabilityGradientCss();
  readonly lowPlddt = LOW_PLDDT;

  // Input
  inputMode = signal<'sequence' | 'pdb'>('sequence');
  sequenceInput = signal('');
  pdbInput = signal('');
  pdbFileName = signal<string | null>(null);
  bindingType = signal<BindingType>('metal');

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

  minLength = computed(() => this.health()?.min_length ?? 30);
  maxLength = computed(() => this.health()?.max_length ?? 400);
  check = computed(() => checkSequence(this.sequenceInput(), this.minLength(), this.maxLength()));
  pdbCheck = computed(() => {
    const pdb = this.pdbInput();
    if (!pdb.trim()) return { valid: false, error: '' };
    if (!pdb.includes('ATOM')) return { valid: false, error: 'No ATOM records found — not a valid PDB structure.' };
    return { valid: true, error: '' };
  });
  canSubmit = computed(() => {
    if (this.loading()) return false;
    return this.inputMode() === 'pdb' ? this.pdbCheck().valid : (!!this.check().sequence && !this.check().error);
  });

  errorCount = computed(() => (this.diagnostics()?.recent_problems ?? []).filter(p => p.level === 'ERROR').length);

  summary = computed(() => {
    const r = this.result();
    if (!r) {
      return null;
    }
    const plddt = r.structure.plddt;
    return {
      nBinding: r.binding_residues.length,
      fraction: r.binding_residues.length / r.length,
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
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.refreshStatus();
    this.destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      this.stopTimer();
    });
  }

  refreshStatus(): void {
    this.api.health().subscribe({
      next: health => {
        this.health.set(health);
        this.healthError.set(null);
      },
      error: (failure: ApiFailure) => {
        this.health.set(null);
        this.healthError.set(failure);
      }
    });
    this.api.diagnostics().subscribe({
      next: diagnostics => this.diagnostics.set(diagnostics),
      error: () => this.diagnostics.set(null)
    });
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

    let request$: Observable<PredictResult>;
    let length: number | undefined;
    if (this.inputMode() === 'pdb') {
      if (!this.pdbCheck().valid) return;
      length = this.pdbInput().split('\n').filter(l => l.startsWith('ATOM')).length;
      request$ = this.api.predictPdb({ pdb: this.pdbInput(), binding_type: bindingType });
    } else {
      const { sequence, error } = this.check();
      if (!sequence || error) return;
      length = sequence.length;
      request$ = this.api.predict({ sequence, binding_type: bindingType });
    }

    this.request?.unsubscribe();
    this.error.set(null);
    this.loading.set(true);
    this.startTimer();

    this.request = request$.subscribe({
      next: result => {
        this.selectedIndex.set(null);
        this.result.set(result);
        this.finish();
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure);
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

  selectResidue(index: number): void {
    this.selectedIndex.set(this.selectedIndex() === index ? null : index);
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
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bindsite_${r.binding_type}_${r.length}aa.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private finish(): void {
    this.loading.set(false);
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
