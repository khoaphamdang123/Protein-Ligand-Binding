import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PredictResult } from '../../core/models/prediction.model';
import { PredictionViewerComponent } from '../../molecular/prediction-viewer/prediction-viewer.component';
import { PredictComponent } from './predict.component';

/** jsdom has no WebGL: stand-in for the NGL viewer with the same inputs. */
@Component({ selector: 'app-prediction-viewer', standalone: true, template: '' })
class ViewerStubComponent {
  @Input() pdb: string | null = null;
  @Input() sequence = '';
  @Input() probability: number[] = [];
  @Input() binding: boolean[] = [];
  @Input() plddt: number[] = [];
  @Input() colorMode = 'probability';
  @Input() selectedIndex: number | null = null;
  @Output() residueSelect = new EventEmitter<number>();
}

const SEQ = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQ';   // 40 aa
const HEALTH = { status: 'ok', model_version: '54ac716f765085042184814b0fb023c70f742520', max_length: 400, min_length: 30, predictor: 'mock', mock: true, profile: 'final' };

function result(): PredictResult {
  const probability = [...SEQ].map((_, i) => (i === 4 || i === 20 ? 0.95 : 0.1));
  return {
    sequence: SEQ, length: 40, binding_type: 'metal', profile: 'final', model_version: HEALTH.model_version,
    threshold: 0.9148463010787964, probability, binding: probability.map(p => p >= 0.9148463010787964),
    binding_residues: [{ index: 5, aa: 'V', probability: 0.95 }, { index: 21, aa: 'D', probability: 0.95 }],
    structure: { source: 'esmatlas', plddt: [...SEQ].map((_, i) => (i < 3 ? 0.5 : 0.9)), pdb: 'ATOM', cached: false },
    mock: true, timing: { esmfold_s: 7.5, predict_s: 0.1, total_s: 7.7 },
  };
}

describe('PredictComponent', () => {
  let fixture: ComponentFixture<PredictComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const flushStatus = () => {
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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

  it('shows backend and predictor status', () => {
    expect(el.textContent).toContain('Backend online');
    expect(el.textContent).toContain('MOCK (pbind not installed)');
    expect(el.textContent).toContain('model_version 54ac716f7650');
  });

  it('shows an offline backend', () => {
    fixture.componentInstance.refreshStatus();
    http.expectOne('/api/health').flush('', { status: 500, statusText: 'proxy error' });
    http.expectOne('/api/diagnostics').flush('', { status: 500, statusText: 'proxy error' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Backend offline');
    expect(el.textContent).toContain('Cannot reach the prediction backend');
  });

  it('validates the sequence before enabling Predict', () => {
    expect(predictButton().disabled).toBe(true);
    typeSequence('MKVXA');
    expect(el.querySelector('.invalid')?.textContent).toContain("'X' at 4");
    expect(predictButton().disabled).toBe(true);
    typeSequence(`>x\n${SEQ.toLowerCase()}`);
    expect(el.textContent).toContain('40 residues ✓');
    expect(predictButton().disabled).toBe(false);
  });

  it('sends the cleaned sequence and renders the result', () => {
    typeSequence(`>x\n${SEQ.toLowerCase()}`);
    (el.querySelectorAll('.type-option')[0] as HTMLButtonElement).click();
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
      { detail: 'ESMFold API returned HTTP 500: boom', code: 'ESMFOLD_FAILED', request_id: 'ab12' },
      { status: 502, statusText: 'Bad Gateway' }
    );
    flushStatus();
    const alert = el.querySelector('.alert-error')!.textContent!;
    expect(alert).toContain('Structure prediction (ESMFold API) failed');
    expect(alert).toContain('ESMFold API returned HTTP 500: boom');
    expect(alert).toContain('request ab12');
    expect(alert).toContain('Try again');
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
