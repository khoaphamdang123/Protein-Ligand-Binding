import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ExploreIndex, ModelId, ProteinDoc, ProteinRow } from '../../core/models/explore.model';
import { LigandClass } from '../../core/models/prediction.model';
import { PredictionViewerComponent } from '../../molecular/prediction-viewer/prediction-viewer.component';
import { ExplorerComponent } from './explorer.component';

/** jsdom has no WebGL: stand-in for the viewer. */
@Component({ selector: 'app-prediction-viewer', standalone: true, template: '' })
class ViewerStubComponent {
  @Input() pdb: string | null = null;
  @Input() sequence = '';
  @Input() probability: number[] = [];
  @Input() binding: boolean[] = [];
  @Input() groundTruth: boolean[] = [];
  @Input() status: string[] = [];
  @Input() plddt: number[] = [];
  @Input() colorMode = '';
  @Input() errorsOnly = false;
  @Input() ligandClassColor: string | null = null;
  @Input() ligandClassLabel: string | null = null;
  @Input() selectedIndex: number | null = null;
  @Input() cameraLink: unknown = null;
  @Output() residueSelect = new EventEmitter<number>();
  focusPocket(): void { /* no 3D in tests */ }
  resetView(): void { /* no 3D in tests */ }
  exportPng(): void { /* no 3D in tests */ }
}

const row = (id: string, split: ProteinRow['split'], ligands: ProteinRow['ligands'], name: string | null = `Protein ${id}`): ProteinRow => ({
  id, split, length: 6, name, nameSource: 'uniprot', nameNote: null, gene: null, organism: 'E. coli', sequence: 'MKVLAG', ligands,
});

const LIGANDS: LigandClass[] = ['metal', 'small', 'dna', 'rna'];
const m = { AUPRC: 0.5, AUROC: 0.9, precision: 0.5, recall: 0.5, F1: 0.5, MCC: 0.4, TP: 1, FP: 1, TN: 3, FN: 1 };
const dm = { ...m, threshold: 0.5, n_residues: 6, n_positive: 2 };
const models = { adabind: dm, bindEmbed21DL: dm, bindNode24: dm };
const entry = { n_proteins_with_site: 2, models };
const perLigand = { metal: entry, small: entry, dna: entry, rna: entry };
const thresholds = { metal: 0.91, small: 0.49, dna: 0.56, rna: 0.78 };
const half = { metal: 0.5, small: 0.5, dna: 0.5, rna: 0.5 };

const INDEX = {
  generated: '', checks_passed: 477,
  datasets: [
    { id: 'TestSet300', label: 'TestSet300', proteins: 3, description: '' },
    { id: 'TestSetNew46', label: 'TestSetNew46', proteins: 1, description: '' },
  ],
  ligands: {},
  models: {
    adabind: { label: 'AdaBind', thresholds, note: '' },
    bindEmbed21DL: { label: 'bindEmbed21DL', thresholds: half, note: '' },
    bindNode24: { label: 'bindNode24', thresholds: half, note: '' },
  },
  notes: { thresholds: 'threshold note', dnaRna: 'dna rna note', labels: '', structure: 'structure note' },
  summary: { TestSet300: perLigand, TestSetNew46: perLigand },
  featured: {
    TestSet300: { protein: 'BBB', ligand: 'rna', MCC: 1, TP: 2, FP: 0, FN: 0 },
    TestSetNew46: { protein: 'DDD', ligand: 'rna', MCC: 0.9, TP: 1, FP: 0, FN: 0 },
  },
  proteins: [
    row('AAA', 'TestSet300', { metal: 2, small: 1 }),
    row('BBB', 'TestSet300', { dna: 2, rna: 2 }),
    row('CCC', 'TestSet300', { small: 3 }, null),
    row('DDD', 'TestSetNew46', { rna: 1 }),
  ],
} as unknown as ExploreIndex;

/** Plain text, as when a server already decoded the .gz (real gzip is covered in the browser check). */
function pdbBytes(): ArrayBuffer {
  const bytes = new ArrayBuffer(4);
  new Uint8Array(bytes).set([65, 84, 79, 77]);
  return bytes;
}

function doc(id: string, split: ProteinRow['split']): ProteinDoc {
  const model = (bits: string) => ({
    prob: Object.fromEntries(LIGANDS.map(l => [l, [0.9, 0.8, 0.1, 0.1, 0.2, 0.1]])),
    call: Object.fromEntries(LIGANDS.map(l => [l, bits])),
    metrics: Object.fromEntries(LIGANDS.map(l => [l, m])),
  });
  return {
    id, split, sequence: 'MKVLAG', plddt: [0.9, 0.9, 0.9, 0.5, 0.9, 0.9],
    labels: { metal: '110000', small: '001000', dna: '110000', rna: '000011' },
    models: { adabind: model('100100'), bindEmbed21DL: model('110000'), bindNode24: model('000000') } as Record<ModelId, ProteinDoc['models'][ModelId]>,
  } as ProteinDoc;
}

describe('ExplorerComponent', () => {
  let fixture: ComponentFixture<ExplorerComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let c: ExplorerComponent;

  const settle = async () => {
    await fixture.whenStable();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
  };

  /** Answers the requests of one protein. */
  const serve = async (id: string, split: ProteinRow['split'] = 'TestSet300') => {
    http.expectOne(`explore-data/proteins/${id}.json`).flush(doc(id, split));
    http.expectOne(`explore-data/structures/${id}.pdb.gz`).flush(pdbBytes());
    await settle();
  };

  const setup = async (query: Record<string, string> = {}) => {
    await TestBed.configureTestingModule({
      imports: [ExplorerComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    })
      .overrideComponent(ExplorerComponent, {
        remove: { imports: [PredictionViewerComponent] },
        add: { imports: [ViewerStubComponent] },
      })
      .compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ExplorerComponent);
    c = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne('explore-data/index.json').flush(INDEX);
    fixture.detectChanges();
  };

  const ligandButtons = () => [...el.querySelectorAll('.field.ligand button')].map(b => b.textContent?.replace(/\s+/g, ' ').trim());

  beforeAll(() => {
    // jsdom has no ResizeObserver; the track keeps its default width.
    globalThis.ResizeObserver ??= class {
      observe(): void { /* nothing to measure */ }
      unobserve(): void { /* nothing to measure */ }
      disconnect(): void { /* nothing to measure */ }
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => http.verify());

  it('opens on the best AdaBind protein of TestSet300, with three model columns, and says so', async () => {
    await setup();
    await serve('BBB');
    expect(el.querySelector('.protein-head h2')?.textContent).toBe('Protein BBB');
    expect(c.ligand()).toBe('rna');
    expect(el.querySelector('.featured')?.textContent).toContain('Best AdaBind result in TestSet300');
    expect([...el.querySelectorAll('article.model h2')].map(e => e.textContent)).toEqual(['AdaBind', 'bindEmbed21DL', 'bindNode24']);
    expect(el.querySelectorAll('.explorer-sidebar').length).toBe(0);
    c.setLigand('dna');          // another ligand of that protein is not the featured result
    fixture.detectChanges();
    expect(el.querySelector('.featured')).toBeNull();
  });

  it('a link to a protein wins over the featured one', async () => {
    await setup({ protein: 'AAA', ligand: 'small' });
    await serve('AAA');
    expect(c.shown()?.doc.id).toBe('AAA');
    expect(c.ligand()).toBe('small');
    expect(el.querySelector('.featured')).toBeNull();
  });

  it('offers only the ligand classes the protein has', async () => {
    await setup({ protein: 'AAA' });
    await serve('AAA');
    expect(ligandButtons()).toEqual(['Metal ion 2', 'Small molecule 1']);
    c.selectProtein('BBB');
    await serve('BBB');
    expect(ligandButtons()).toEqual(['DNA 2', 'RNA 2']);
    expect(c.ligand()).toBe('dna');   // metal is not available here
  });

  it('never offers a nucleic-acid class', async () => {
    await setup({ protein: 'BBB' });
    await serve('BBB');
    expect(el.textContent).not.toContain('Nucleic acid');
    expect(c.ligandChoices().map(l => l.value)).toEqual(['dna', 'rna']);
  });

  it('colours each residue against the ground truth of the chosen ligand, per model', async () => {
    await setup({ protein: 'AAA', ligand: 'metal' });
    await serve('AAA');
    const status = Object.fromEntries(c.panels().map(p => [p.id, p.status.join(' ')]));
    expect(status['adabind']).toBe('TP FN TN FP TN TN');
    expect(status['bindEmbed21DL']).toBe('TP TP TN TN TN TN');
    expect(status['bindNode24']).toBe('FN FN TN TN TN TN');
    expect(c.panels().map(p => p.threshold)).toEqual([0.91, 0.5, 0.5]);
    c.setLigand('small');
    fixture.detectChanges();
    expect(c.panels()[1].status.join(' ')).toBe('FP FP FN TN TN TN');
    expect(c.panels()[0].threshold).toBe(0.49);
  });

  it('marks the baselines as nucleic-acid output on DNA and RNA only', async () => {
    await setup({ protein: 'BBB', ligand: 'dna' });
    await serve('BBB');
    expect(c.panels().map(p => p.proxy)).toEqual([false, true, true]);
    expect(el.querySelector('.footnotes')?.textContent).toContain('dna rna note');
    c.selectProtein('AAA', 'metal');
    await serve('AAA');
    expect(c.panels().map(p => p.proxy)).toEqual([false, false, false]);
    expect(el.querySelector('.footnotes')?.textContent).not.toContain('dna rna note');
  });

  it('lists every ground-truth residue and every residue a model called', async () => {
    await setup({ protein: 'AAA', ligand: 'metal' });
    await serve('AAA');
    expect(c.residueRows().map(r => r.index)).toEqual([1, 2, 4]);
    expect(el.querySelectorAll('.tables tbody tr').length).toBe(3 + 3);  // + the benchmark table
  });

  it('shows the sequence when a protein has no name', async () => {
    await setup({ protein: 'CCC' });
    await serve('CCC');
    expect(el.querySelector('.protein-head h2')?.textContent).toBe('MKVLAG');
  });

  it('moves to the best protein of the chosen test set', async () => {
    await setup();
    await serve('BBB');
    const select = el.querySelector('#dataset') as HTMLSelectElement;
    select.value = 'TestSetNew46';
    select.dispatchEvent(new Event('change'));
    await serve('DDD', 'TestSetNew46');
    expect(el.querySelector('.count')?.textContent).toContain('1 / 1');
    expect(ligandButtons()).toEqual(['RNA 1']);
    expect(el.querySelector('.tables .wb-panel:nth-child(2) h2')?.textContent).toContain('TestSetNew46, RNA');
  });

  it('counts proteins per ligand in the test set and filters the list', async () => {
    await setup({ protein: 'AAA' });
    await serve('AAA');
    expect(c.ligandCounts()).toEqual({ metal: 1, small: 2, dna: 1, rna: 1 });
    c.onLigandFilter('rna');
    await serve('BBB');
    expect(c.listed().map(p => p.id)).toEqual(['BBB']);
    expect(c.ligand()).toBe('rna');
    expect(el.querySelector('.count')?.textContent).toContain('1 / 1');
  });

  it('falls back to an available ligand when the link asks for another one', async () => {
    await setup({ protein: 'BBB', ligand: 'metal', res: '4' });
    await serve('BBB');
    expect(c.ligand()).toBe('dna');
    expect(c.selectedIndex()).toBe(4);
  });

  it('ignores a slower answer for a protein that is no longer selected', async () => {
    await setup({ protein: 'AAA' });
    c.selectProtein('BBB');
    await settle();
    http.expectOne('explore-data/proteins/AAA.json').flush(doc('AAA', 'TestSet300'));
    http.expectOne('explore-data/structures/AAA.pdb.gz').flush(pdbBytes());
    await serve('BBB');
    expect(c.shown()?.doc.id).toBe('BBB');
    expect(c.loadingProtein()).toBe(false);
  });

  it('selects a residue from the track, and clears it on another protein', async () => {
    await setup({ protein: 'AAA' });
    await serve('AAA');
    (el.querySelector('.col[data-index="2"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(c.selectedIndex()).toBe(2);
    expect(el.querySelector('.readout')?.textContent).toContain('K2');
    c.selectProtein('BBB');
    await serve('BBB');
    expect(c.selectedIndex()).toBeNull();
  });
});
