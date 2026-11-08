import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { PredictResult } from '../../core/models/prediction.model';
import { PredictionViewerComponent } from '../../molecular/prediction-viewer/prediction-viewer.component';
import { AppConfigService } from '../../core/services/app-config.service';
import { PredictComponent } from './predict.component';

/** jsdom has no WebGL: stand-in for the viewer with the same inputs. */
@Component({ selector: 'app-prediction-viewer', standalone: true, template: '' })
class ViewerStubComponent {
  @Input() pdb: string | null = null;
  @Input() sequence = '';
  @Input() probability: number[] = [];
  @Input() binding: boolean[] = [];
  @Input() plddt: number[] = [];
  @Input() colorMode = 'probability';
  @Input() selectedIndex: number | null = null;
  @Input() showPredicted = true;
  @Input() predictedColor: string | null = null;
  @Input() ligandClassLabel: string | null = null;
  @Input() cameraLink: unknown = null;
  @Output() residueSelect = new EventEmitter<number>();
  focusPocket(): void { /* no 3D in tests */ }
  resetView(): void { /* no 3D in tests */ }
}

const SEQ = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQ';   // 40 aa
const HEALTH = { status: 'ok', model_version: '54ac716f765085042184814b0fb023c70f742520', max_length: 1000, min_length: 30, predictor: 'mock', mock: true, profile: 'final' };
const scores = (precision: number, recall: number) => ({ models: { adabind: { precision, recall } } });
const BENCHMARK = {
  summary: {
    TestSet300: { metal: scores(0.66, 0.36), small: scores(0.47, 0.55), dna: scores(0.68, 0.2), rna: scores(0.68, 0.27) },
    TestSetNew46: { metal: scores(0.79, 0.64), small: scores(0.49, 0.5), dna: scores(0.29, 0.15), rna: scores(0.04, 0.21) },
  },
};

function result(): PredictResult {
  const probability = [...SEQ].map((_, i) => (i === 4 || i === 20 ? 0.95 : 0.1));
  return {
    sequence: SEQ, length: 40, binding_type: 'metal', profile: 'final', model_version: HEALTH.model_version,
    threshold: 0.9148463010787964, probability, binding: probability.map(p => p >= 0.9148463010787964),
    binding_residues: [{ index: 5, aa: 'V', probability: 0.95 }, { index: 21, aa: 'D', probability: 0.95 }],
    structure: { source: 'precomputed', detail: 'P0CG48.pdb', plddt: [...SEQ].map((_, i) => (i < 3 ? 0.5 : 0.9)), pdb: 'ATOM', cached: false },
    mock: true, timing: { esmfold_s: 7.5, predict_s: 0.1, total_s: 7.7 },
  };
}

describe('PredictComponent', () => {
  let fixture: ComponentFixture<PredictComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const flushStatus = () => {
    http.match('explore-data/index.json').forEach(r => r.flush(BENCHMARK));
    http.match('/api/health').forEach(r => r.flush(HEALTH));
    http.match('/api/diagnostics').forEach(r => r.flush({ status: 'ok', started: '', log_file: 'x', components: [], recent_problems: [], environment_report: null }));
    fixture.detectChanges();
  };
  const typeSequence = (value: string) => {
    const textarea = el.querySelector('#sequence') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const predictButton = () => el.querySelector('button.btn-primary') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PredictComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
      .overrideComponent(PredictComponent, {
        remove: { imports: [PredictionViewerComponent] },
        add: { imports: [ViewerStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(PredictComponent);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    fixture.detectChanges();
    flushStatus();
  });

  afterEach(() => http.verify());

  const refreshWith = (health: object) => {
    fixture.componentInstance.refreshStatus();
    http.expectOne('/api/health').flush({ ...HEALTH, ...health });
    http.expectOne('/api/diagnostics').flush({ status: 'ok', started: '', log_file: 'x', components: [], recent_problems: [], environment_report: null });
    fixture.detectChanges();
  };

  it('says when the mock predictor is running', () => {
    expect(el.querySelector('.status')?.textContent).toContain('Mock predictor');
  });

  it('offers the four ligand classes, without a nucleic-acid class', () => {
    const labels = [...el.querySelectorAll('.ligand')].map(e => e.textContent?.trim());
    expect(labels).toEqual(['Metal ion', 'Small molecule', 'DNA', 'RNA']);
  });

  it('shows the checked test-set numbers of the chosen ligand', () => {
    expect(el.querySelector('.expected')?.textContent).toContain('precision 66% and 79%');
    (el.querySelectorAll('.ligand')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.expected')?.textContent).toContain('DNA on test sets: precision 68% and 29%');
  });

  it('shows the structure sources in the order they are tried', () => {
    refreshWith({
      predictor: 'pbind', mock: false, self_test: 'ok', esmfold_local: 'warning',
      devices: { esmfold: 'cuda', esm2: 'cpu', prott5: 'cpu', esmif: 'cpu', models: 'cpu' },
      structure_sources: {
        precomputed: { status: 'ok', count: 4036, message: '' },
        esmatlas: { status: 'unknown', message: '', max_length: 400 },
        local: { status: 'warning', state: 'unavailable', message: 'GPU busy' },
      },
    });
    const status = el.querySelector('.status')!.textContent!;
    expect(status).toContain('Ready');
    expect(status).toContain('CPU');          // the prediction models, not the GPU fallback for folding
    expect([...el.querySelectorAll('.source')].map(e => e.textContent)).toEqual(
      ['4,036 cached', 'ESMFold API', 'local GPU busy', 'your PDB']);
  });

  it('says there is no local GPU rather than a busy one (Docker image, CPU-only machine)', () => {
    refreshWith({
      predictor: 'pbind', mock: false, self_test: 'ok', esmfold_local: 'warning',
      devices: { esmfold: 'cuda', esm2: 'cpu', prott5: 'cpu', esmif: 'cpu', models: 'cpu' },
      structure_sources: {
        precomputed: { status: 'ok', count: 4036, message: '' },
        esmatlas: { status: 'unknown', message: '', max_length: 400 },
        local: { status: 'warning', state: 'unavailable', message: 'no CUDA GPU on this machine' },
      },
    });
    expect([...el.querySelectorAll('.source')].map(e => e.textContent)).toContain('no local GPU');
  });

  const failStatus = () => {
    fixture.componentInstance.refreshStatus();
    http.expectOne('/api/health').flush('', { status: 500, statusText: 'proxy error' });
    http.expectOne('/api/diagnostics').flush('', { status: 500, statusText: 'proxy error' });
    fixture.detectChanges();
  };

  it('keeps the last status after one failed check, and reports the backend after two', () => {
    failStatus();
    expect(el.querySelector('.status')?.textContent).not.toContain('Backend offline');
    failStatus();
    expect(el.textContent).toContain('Backend offline');
    expect(el.textContent).toContain('Cannot reach the AI server');
  });

  it('checks again on its own after a failed check, and recovers', () => {
    vi.useFakeTimers();
    try {
      failStatus();
      failStatus();
      vi.advanceTimersByTime(5000);
      http.expectOne('/api/health').flush({ ...HEALTH, mock: false, predictor: 'pbind', self_test: 'ok' });
      http.expectOne('/api/diagnostics').flush('', { status: 500, statusText: 'x' });
      fixture.detectChanges();
      expect(el.querySelector('.state')?.textContent).toContain('Ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fills the sequence and the ligand from an example', () => {
    const buttons = [...el.querySelectorAll('.foot-end .text-btn')] as HTMLButtonElement[];
    expect(buttons.map(b => b.textContent)).toEqual(['MntR', 'PsbH', 'Cre recombinase', 'bL28']);
    buttons[3].click();
    fixture.detectChanges();
    expect((el.querySelector('#sequence') as HTMLTextAreaElement).value).toContain('D0CAL0');
    expect(el.querySelector('.ligand.active')?.textContent).toContain('RNA');
    expect(el.textContent).toContain('78 residues');
    expect(predictButton().disabled).toBe(false);
  });

  it('validates the sequence before enabling Predict', () => {
    expect(predictButton().disabled).toBe(true);
    typeSequence('MKVXA');
    expect(el.querySelector('.invalid')?.textContent).toContain("'X' at 4");
    expect(predictButton().disabled).toBe(true);
    typeSequence(`>x\n${SEQ.toLowerCase()}`);
    expect(el.querySelector('.valid')?.textContent).toContain('40 residues');
    expect(predictButton().disabled).toBe(false);
  });

  it('sends the cleaned sequence and renders the result', () => {
    typeSequence(`>x\n${SEQ.toLowerCase()}`);
    (el.querySelectorAll('.ligand')[0] as HTMLButtonElement).click();
    predictButton().click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Cancel');

    const req = http.expectOne('/api/predict');
    expect(req.request.body).toEqual({ sequence: SEQ, binding_type: 'metal' });
    req.flush(result());
    flushStatus();

    expect(el.textContent).toContain('Demo predictions.');
    const summary = el.querySelector('.summary')!.textContent!;
    expect(summary).toContain('2');
    expect(summary).toContain('0.9148');
    expect(summary).toContain('3 residues');      // pLDDT < 0.7
    expect(summary).toContain('ESMFold, cached');
    expect(summary).toContain('Metal ion binding residues');
    const rows = el.querySelectorAll('.residues-card tbody tr');
    expect(rows.length).toBe(2);
    (rows[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.selected-info')?.textContent).toContain('D21');
    expect(el.querySelectorAll('app-probability-track .cell').length).toBe(40);
  });

  it('shows backend errors with code and request id', () => {
    typeSequence(SEQ);
    predictButton().click();
    http.expectOne('/api/predict').flush(
      { detail: 'boom', code: 'ESMFOLD_FAILED', request_id: 'ab12' },
      { status: 502, statusText: 'Bad Gateway' }
    );
    flushStatus();
    const alert = el.querySelector('.alert-error')!.textContent!;
    expect(alert).toContain('Structure prediction failed');
    expect(alert).toContain('boom');
    expect(alert).toContain('request ab12');
    expect(alert).toContain('Try again');
  });

  it('offers the PDB upload when no structure source works, and drops the previous result', () => {
    typeSequence(SEQ);
    predictButton().click();
    http.expectOne('/api/predict').flush(result());
    flushStatus();
    expect(el.querySelector('.summary')).not.toBeNull();

    predictButton().click();
    http.expectOne('/api/predict').flush(
      { detail: 'No structure for this sequence: GPU busy.', code: 'STRUCTURE_UNAVAILABLE', request_id: 'cd34' },
      { status: 502, statusText: 'Bad Gateway' }
    );
    flushStatus();
    const alert = el.querySelector('.alert-error') as HTMLElement;
    expect(alert.textContent).toContain('No structure available for this sequence');
    expect(alert.textContent).not.toContain('Try again');
    expect(el.querySelector('.summary')).toBeNull();
    (alert.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.pdb-drop')).not.toBeNull();
  });

  describe('changing the ligand', () => {
    const predicted = () => {
      typeSequence(SEQ);
      predictButton().click();
      http.expectOne('/api/predict').flush(result());
      flushStatus();
    };
    const pick = (i: number) => {
      (el.querySelectorAll('.ligand')[i] as HTMLButtonElement).click();
      fixture.detectChanges();
    };

    it('only selects it while there is no result', () => {
      typeSequence(SEQ);
      pick(1);
      http.expectNone('/api/predict');
      expect(el.querySelector('.ligand.active')?.textContent).toContain('Small molecule');
    });

    it('removes the whole result at once and predicts the new ligand', () => {
      predicted();
      (el.querySelector('.residues-card tbody tr') as HTMLElement).click();
      fixture.detectChanges();
      expect(el.querySelector('.selected-info')).not.toBeNull();

      pick(1);
      expect(el.querySelector('.summary')).toBeNull();
      expect(el.querySelector('app-prediction-viewer')).toBeNull();
      expect(el.querySelector('.residues-card')).toBeNull();
      expect(el.textContent).toContain('Cancel');
      const req = http.expectOne('/api/predict');
      expect(req.request.body).toEqual({ sequence: SEQ, binding_type: 'small' });
      req.flush({ ...result(), binding_type: 'small' });
      flushStatus();
      expect(el.querySelector('.summary')?.textContent).toContain('Small molecule binding residues');
      expect(el.querySelector('.selected-info')).toBeNull();
    });

    it('does nothing when the same ligand is clicked again', () => {
      predicted();
      pick(0);
      http.expectNone('/api/predict');
      expect(el.querySelector('.summary')).not.toBeNull();
    });

    it('drops a running request and asks for the new ligand', () => {
      typeSequence(SEQ);
      predictButton().click();
      fixture.detectChanges();
      const first = http.expectOne('/api/predict');
      pick(2);
      expect(first.cancelled).toBe(true);
      const second = http.match('/api/predict').find(r => !r.cancelled)!;
      expect(second.request.body.binding_type).toBe('dna');
      second.flush({ ...result(), binding_type: 'dna' });
      flushStatus();
      expect(fixture.componentInstance.loading()).toBe(false);
      expect(el.querySelector('.summary')?.textContent).toContain('DNA binding residues');
    });

    it('an example picked during a prediction drops that request, so its answer never shows', () => {
      typeSequence(SEQ);
      predictButton().click();
      fixture.detectChanges();
      const running = http.expectOne('/api/predict');
      fixture.componentInstance.useExample({ ligand: 'rna', sequence: '>x\n' + SEQ });
      fixture.detectChanges();
      expect(running.cancelled).toBe(true);
      expect(fixture.componentInstance.loading()).toBe(false);
      expect(el.querySelector('.summary')).toBeNull();
      expect(el.querySelector('.ligand.active')?.textContent).toContain('RNA');
      http.expectNone('/api/predict');
      flushStatus();
    });

    it('clears an old error without predicting', () => {
      typeSequence(SEQ);
      predictButton().click();
      http.expectOne('/api/predict').flush({ detail: 'boom', code: 'ESMFOLD_FAILED', request_id: 'x' }, { status: 502, statusText: 'x' });
      flushStatus();
      expect(el.querySelector('.alert-error')).not.toBeNull();
      pick(1);
      http.expectNone('/api/predict');
      expect(el.querySelector('.alert-error')).toBeNull();
    });
  });

  describe('compare mode', () => {
    const modelResult = (called: number[]) => {
      const probability = [...SEQ].map((_, i) => (called.includes(i) ? 0.8 : 0.1));
      return { probability, binding: probability.map(p => p >= 0.5), threshold: 0.5, output: 'nuclear' };
    };
    const COMPARE = {
      sequence: SEQ, binding_type: 'dna', mock: false, timing: { prott5_s: 1, models_s: 0.1, total_s: 1.1 },
      models: {
        bindEmbed21DL: { ...modelResult([4, 7]), structure: { source: 'none' } },
        bindNode24: { ...modelResult([4]), structure: { source: 'same', reason: 'not in AlphaFold DB' } },
      },
    };
    const COMPARE_AF = {
      ...COMPARE,
      models: {
        ...COMPARE.models,
        bindNode24: {
          ...modelResult([4]),
          structure: { source: 'alphafold_db', entry: 'AF-P0CG48-F1', version: 'v6', page: 'https://alphafold.ebi.ac.uk/entry/AF-P0CG48-F1',
                       pdb: 'ATOM AF', plddt: [...SEQ].map(() => 0.8), rmsd: 1.23 },
        },
      },
    };
    const predicted = () => {
      typeSequence(SEQ);
      predictButton().click();
      http.expectOne('/api/predict').flush(result());
      flushStatus();
    };
    const compareButton = () => [...el.querySelectorAll('.view-bar button')][1] as HTMLButtonElement;

    beforeAll(() => {
      globalThis.ResizeObserver ??= class {
        observe(): void { /* nothing to measure */ }
        unobserve(): void { /* nothing to measure */ }
        disconnect(): void { /* nothing to measure */ }
      } as unknown as typeof ResizeObserver;
    });

    it('runs the two models only when asked, on the same sequence and structure', () => {
      predicted();
      http.expectNone('/api/compare');
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(1);

      compareButton().click();
      fixture.detectChanges();
      expect(el.querySelector('.view-bar')?.textContent).toContain('Running bindEmbed21DL and bindNode24');
      const req = http.expectOne('/api/compare');
      expect(req.request.body).toEqual({ sequence: SEQ, pdb: 'ATOM', binding_type: 'metal', alphafold: true });
      req.flush(COMPARE);
      fixture.detectChanges();

      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(3);
      expect([...el.querySelectorAll('.baselines h2')].map(e => e.textContent)).toEqual(['bindEmbed21DL', 'bindNode24']);
      expect(el.querySelector('.structure .wb-panel-head h2')?.textContent).toBe('AdaBind');
      const counts = el.querySelector('.baselines .counts')?.textContent?.replace(/\s+/g, ' ');
      expect(counts).toContain('2 residues called');
      expect(counts).toContain('1 also called by AdaBind');
      expect(el.querySelectorAll('app-residue-compare .gt').length).toBe(0);   // no ground truth here
      expect(el.querySelector('.readout')?.textContent).toContain('1 residues called by all three');
      const notes = [...el.querySelectorAll('.structure-note')].map(e => e.textContent?.replace(/\s+/g, ' ').trim());
      expect(notes).toEqual(['Sequence only: no structure used', 'Structure: the same as AdaBind (not in AlphaFold DB)']);
    });

    it('shows bindNode24 on its AlphaFold DB model, and names it', () => {
      predicted();
      compareButton().click();
      http.expectOne('/api/compare').flush(COMPARE_AF);
      fixture.detectChanges();
      const viewers = fixture.debugElement.queryAll(By.directive(ViewerStubComponent)).map(d => d.componentInstance as ViewerStubComponent);
      expect(viewers.map(v => v.pdb)).toEqual(['ATOM', 'ATOM', 'ATOM AF']);       // AdaBind, bindEmbed21DL, bindNode24
      expect(viewers[2].plddt[0]).toBe(0.8);
      const note = el.querySelectorAll('.structure-note')[1];
      expect(note.textContent).toContain('AlphaFold DB AF-P0CG48-F1 v6');
      expect(note.querySelector('a')?.getAttribute('href')).toBe('https://alphafold.ebi.ac.uk/entry/AF-P0CG48-F1');
    });

    it('sends the accession of the FASTA header, so that bindNode24 gets that protein\'s own entry', () => {
      typeSequence(`>sp|P0CG48|UBIQ_HUMAN\n${SEQ}`);
      predictButton().click();
      http.expectOne('/api/predict').flush(result());
      flushStatus();
      compareButton().click();
      expect(http.expectOne('/api/compare').request.body.accession).toBe('P0CG48');
    });

    it('never swaps an uploaded structure for an AlphaFold DB model', () => {
      fixture.componentInstance.result.set({ ...result(), structure: { ...result().structure, source: 'upload' } });
      fixture.componentInstance.setView('compare');
      expect(http.expectOne('/api/compare').request.body.alphafold).toBe(false);
    });

    it('does not run them twice, and goes back to AdaBind alone', () => {
      predicted();
      compareButton().click();
      http.expectOne('/api/compare').flush(COMPARE);
      fixture.detectChanges();
      (el.querySelectorAll('.view-bar button')[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(1);
      compareButton().click();
      fixture.detectChanges();
      http.expectNone('/api/compare');
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(3);
    });

    it('runs them again for a new prediction while the mode is on', () => {
      predicted();
      compareButton().click();
      http.expectOne('/api/compare').flush(COMPARE);
      fixture.detectChanges();
      predictButton().click();
      http.expectOne('/api/predict').flush(result());
      flushStatus();
      http.expectOne('/api/compare').flush(COMPARE);
      fixture.detectChanges();
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(3);
    });

    it('runs them again for a new ligand, after clearing the old comparison', () => {
      predicted();
      compareButton().click();
      http.expectOne('/api/compare').flush(COMPARE);
      fixture.detectChanges();
      (el.querySelectorAll('.ligand')[1] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(0);
      http.expectOne('/api/predict').flush({ ...result(), binding_type: 'small' });
      flushStatus();
      const req = http.expectOne('/api/compare');
      expect(req.request.body.binding_type).toBe('small');
      req.flush(COMPARE);
      fixture.detectChanges();
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(3);
    });

    it('shows a failure with a retry, and keeps the AdaBind result', () => {
      predicted();
      compareButton().click();
      http.expectOne('/api/compare').flush(
        { detail: 'not installed', code: 'BASELINES_UNAVAILABLE', request_id: 'x' }, { status: 503, statusText: 'x' });
      fixture.detectChanges();
      expect(el.querySelector('.alert-error')?.textContent).toContain('Comparison models not installed');
      expect(el.querySelector('.summary')).not.toBeNull();
      (el.querySelector('.alert-error button') as HTMLButtonElement).click();
      http.expectOne('/api/compare').flush(COMPARE);
      fixture.detectChanges();
      expect(el.querySelector('.alert-error')).toBeNull();
      expect(el.querySelectorAll('app-prediction-viewer').length).toBe(3);
    });

    it('is hidden when the models are not installed', () => {
      predicted();
      expect(el.querySelector('.view-bar')).not.toBeNull();
      refreshWith({ compare: false });
      expect(el.querySelector('.view-bar')).toBeNull();
    });
  });

  it('waits while ESMFold folds on the CPU, asks again, then shows the result', () => {
    vi.useFakeTimers();
    try {
      typeSequence(SEQ);
      predictButton().click();
      const folding = { length: 40, stage: 'folding', ahead: 0, device: 'cpu', waited_s: 3, folding_s: 3, fallback_reason: null };
      http.expectOne('/api/predict').flush(
        { detail: 'Local ESMFold on the CPU is folding it', code: 'STRUCTURE_FOLDING', request_id: 'f1', folding },
        { status: 202, statusText: 'Accepted' });
      fixture.detectChanges();
      expect(el.querySelector('.hint.working')?.textContent).toContain('ESMFold is folding this 40-residue sequence on the CPU');
      expect(el.querySelector('.error')).toBeNull();
      expect(fixture.componentInstance.loading()).toBe(true);

      vi.advanceTimersByTime(10_000);   // FOLD_POLL_MS: the same request again
      const again = http.expectOne('/api/predict');
      expect(again.request.body).toEqual({ sequence: SEQ, binding_type: 'metal' });
      again.flush(result());
      flushStatus();
      expect(fixture.componentInstance.loading()).toBe(false);
      expect(fixture.componentInstance.folding()).toBeNull();
      expect(el.querySelector('.summary')!.textContent).toContain('10 s with the fold');   // not the last request's time
    } finally {
      vi.useRealTimers();
    }
  });

  it('says how many CPU folds are ahead, and stops asking on cancel', () => {
    vi.useFakeTimers();
    try {
      typeSequence(SEQ);
      predictButton().click();
      const folding = { length: 40, stage: 'queued', ahead: 2, device: 'cpu', waited_s: 1, folding_s: 0, fallback_reason: null };
      http.expectOne('/api/predict').flush({ detail: 'queued', code: 'STRUCTURE_FOLDING', folding }, { status: 202, statusText: 'Accepted' });
      fixture.detectChanges();
      expect(el.querySelector('.hint.working')?.textContent).toContain('Waiting for 2 other ESMFold runs on the CPU');
      fixture.componentInstance.cancel();
      flushStatus();
      vi.advanceTimersByTime(11_000);   // past FOLD_POLL_MS: no request again
      http.expectNone('/api/predict');
      expect(fixture.componentInstance.loading()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says ESMFold is off when it is not set up', () => {
    refreshWith({
      predictor: 'pbind', mock: false, self_test: 'ok',
      structure_sources: {
        precomputed: { status: 'ok', count: 4036, message: '' },
        esmatlas: { status: 'unknown', message: '', max_length: 400 },
        local: { status: 'warning', state: 'off', message: 'not set up (BINDSITE_ESMFOLD_LOCAL=off)' },
      },
    });
    expect([...el.querySelectorAll('.source')].map(e => e.textContent)).toEqual(
      ['4,036 cached', 'ESMFold API', 'ESMFold off', 'your PDB']);
  });

  it('labels local ESMFold on the CPU', () => {
    refreshWith({
      predictor: 'pbind', mock: false, self_test: 'ok', esmfold_local: 'warning',
      devices: { esmfold: 'cpu', esm2: 'cpu', prott5: 'cpu', esmif: 'cpu', models: 'cpu' },
      structure_sources: {
        precomputed: { status: 'ok', count: 4036, message: '' },
        esmatlas: { status: 'unknown', message: '', max_length: 400 },
        local: { status: 'running', state: 'loading', message: 'loading on cpu', device: 'cpu' },
      },
    });
    expect([...el.querySelectorAll('.source')].map(e => e.textContent)).toContain('ESMFold CPU loading');
  });

  it('can cancel a running request', () => {
    typeSequence(SEQ);
    predictButton().click();
    const req = http.expectOne('/api/predict');
    fixture.componentInstance.cancel();
    flushStatus();
    expect(req.cancelled).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);
  });
});

describe('PredictComponent without an AI server (static hosting, config.json apiBaseUrl null)', () => {
  it('says so, keeps Predict off and sends no request', async () => {
    await TestBed.configureTestingModule({
      imports: [PredictComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
      .overrideComponent(PredictComponent, {
        remove: { imports: [PredictionViewerComponent] },
        add: { imports: [ViewerStubComponent] },
      })
      .compileComponents();
    TestBed.inject(AppConfigService).set({ apiBaseUrl: null });
    const fixture = TestBed.createComponent(PredictComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.match('explore-data/index.json').forEach(r => r.flush(BENCHMARK));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const textarea = el.querySelector('#sequence') as HTMLTextAreaElement;
    textarea.value = SEQ;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const status = el.querySelector('.status')!.textContent!;
    expect(status).toContain('No AI server');
    expect(status).toContain('Explore and Benchmarks work without it');
    expect(status).not.toContain('Refresh');
    expect((el.querySelector('button.btn-primary') as HTMLButtonElement).disabled).toBe(true);
    fixture.componentInstance.predict();       // even if called: nothing goes out
    fixture.componentInstance.refreshStatus();
    http.expectNone(() => true);
    http.verify();
  });
});
