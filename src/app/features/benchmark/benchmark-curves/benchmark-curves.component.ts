import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective } from 'ngx-echarts';
import { EChartsOption } from 'echarts';

type MethodName = 'AdaBind' | 'bindNode24' | 'bindEmbed21DL' | 'ESMBind' | 'MetalBind';
type CurveScore = { method: MethodName; auroc: number; auprc: number };
type CurveGroup = { id: string; label: string; scores: CurveScore[] };
type CurveDataset = { id: string; label: string; estimate: boolean; groups: CurveGroup[] };

const METHOD_COLORS: Record<MethodName, string> = {
  AdaBind: '#E87524',
  bindNode24: '#3478C5',
  bindEmbed21DL: '#2D9B68',
  ESMBind: '#B65A9C',
  MetalBind: '#5F646B',
};

const curve = (method: MethodName, auprc: number, auroc: number): CurveScore => ({ method, auprc, auroc });

@Component({
  selector: 'app-benchmark-curves',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  template: `
    <main class="curves-page">
      <header class="page-header">
        <p class="eyebrow">Benchmark visualization</p>
        <h1>ROC &amp; Precision–Recall Curves</h1>
        <p class="subtitle">Compare AdaBind and reference methods by ligand class across both test sets.</p>
      </header>

      <section class="method-legend" aria-label="Methods">
        @for (method of methods; track method) {
          <span class="method-key"><i [style.background]="methodColors[method]"></i>{{ method }}</span>
        }
      </section>

      <aside class="data-note" [class.estimate-note]="activeDataset.estimate">
        @if (activeDataset.estimate) {
          <strong>Estimated curves.</strong> Per-residue benchmark scores for TestSetNew46 are not included in this project;
          curves are approximate visual reconstructions of the supplied figure, not raw evaluation output.
        } @else {
          <strong>Reconstructed curves.</strong> TestSet300 AUPRC/AUROC values use the reported Table 3 estimates.
          Curve coordinates are illustrative because raw per-residue scores are not included.
        }
      </aside>

      <nav class="dataset-tabs" role="tablist" aria-label="Benchmark dataset">
        @for (dataset of datasets; track dataset.id) {
          <button type="button" role="tab" [attr.aria-selected]="selectedDataset === dataset.id"
                  [class.active]="selectedDataset === dataset.id" (click)="selectedDataset = dataset.id">
            {{ dataset.label }}
          </button>
        }
      </nav>

      <section class="curve-sheet" [attr.aria-label]="activeDataset.label + ' ROC and precision-recall curves'">
        <div class="sheet-head">
          <h2>{{ activeDataset.label }}</h2>
          <span>ROC (AUROC) · Precision–Recall (AUPRC)</span>
        </div>

        @for (group of activeDataset.groups; track group.id) {
          <article class="class-row">
            <h3>{{ group.label }}</h3>
            <div class="chart-pair">
              <div class="chart-panel">
                <h4>ROC curve <span>(AUROC)</span></h4>
                <div echarts [options]="rocOption(group)" class="curve-chart" [attr.aria-label]="group.label + ' ROC curve'"></div>
              </div>
              <div class="chart-panel">
                <h4>Precision–Recall <span>(AUPRC)</span></h4>
                <div echarts [options]="prOption(group)" class="curve-chart" [attr.aria-label]="group.label + ' Precision Recall curve'"></div>
              </div>
            </div>
          </article>
        }
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }
    .curves-page { min-height: calc(100vh - 60px); padding: var(--space-6); background: var(--color-bg-primary); }
    .page-header { max-width: 1200px; margin: 0 auto var(--space-5); }
    .eyebrow { margin: 0 0 var(--space-2); color: var(--color-primary); font-size: var(--font-size-xs); font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; color: var(--color-text-primary); font-size: var(--font-size-3xl); }
    .subtitle { margin: var(--space-2) 0 0; color: var(--color-text-secondary); }
    .method-legend { max-width: 1200px; margin: 0 auto var(--space-4); display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
    .method-key { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .method-key i { width: 18px; height: 3px; border-radius: 3px; }
    .data-note { max-width: 1200px; margin: 0 auto var(--space-4); padding: var(--space-3) var(--space-4); border: 1px solid var(--color-border-primary); border-radius: var(--radius-md); background: var(--color-bg-panel); color: var(--color-text-secondary); font-size: var(--font-size-sm); line-height: 1.5; }
    .data-note strong { color: var(--color-text-primary); }
    .estimate-note { border-color: color-mix(in srgb, var(--color-warning) 50%, var(--color-border-primary)); }
    .dataset-tabs { max-width: 1200px; margin: 0 auto var(--space-4); display: flex; gap: var(--space-2); }
    .dataset-tabs button { padding: var(--space-2) var(--space-4); border: 1px solid var(--color-border-primary); border-radius: var(--radius-base); background: var(--color-bg-panel); color: var(--color-text-secondary); cursor: pointer; font: inherit; }
    .dataset-tabs button.active { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 16%, var(--color-bg-panel)); color: var(--color-text-primary); }
    .curve-sheet { max-width: 1200px; margin: 0 auto; padding: var(--space-5); background: var(--color-bg-panel); border: 1px solid var(--color-border-primary); border-radius: var(--radius-lg); }
    .sheet-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border-primary); }
    .sheet-head h2 { margin: 0; color: var(--color-text-primary); font-size: var(--font-size-xl); }
    .sheet-head span { color: var(--color-text-tertiary); font-size: var(--font-size-xs); }
    .class-row { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: var(--space-4); padding: var(--space-4) 0; border-bottom: 1px solid var(--color-border-primary); }
    .class-row:last-child { border-bottom: 0; }
    .class-row h3 { margin: var(--space-2) 0 0; color: var(--color-text-primary); font-size: var(--font-size-sm); }
    .chart-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
    .chart-panel { min-width: 0; padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-bg-primary); }
    .chart-panel h4 { margin: 0; text-align: center; color: var(--color-text-primary); font-size: var(--font-size-sm); font-weight: 600; }
    .chart-panel h4 span { color: var(--color-text-tertiary); font-weight: 400; }
    .curve-chart { width: 100%; height: 245px; }
    @media (max-width: 760px) {
      .curves-page { padding: var(--space-4); }
      h1 { font-size: var(--font-size-2xl); }
      .curve-sheet { padding: var(--space-3); }
      .sheet-head { align-items: flex-start; flex-direction: column; }
      .class-row { grid-template-columns: 1fr; gap: var(--space-2); }
      .class-row h3 { margin: 0; }
      .chart-pair { grid-template-columns: 1fr; }
      .curve-chart { height: 220px; }
    }
  `]
})
export class BenchmarkCurvesComponent {
  readonly methodColors = METHOD_COLORS;
  readonly methods: MethodName[] = ['AdaBind', 'bindNode24', 'bindEmbed21DL', 'ESMBind', 'MetalBind'];
  selectedDataset = 'testset300';

  readonly datasets: CurveDataset[] = [
    {
      id: 'testset300', label: 'TestSet300', estimate: false,
      groups: [
        { id: 'metal', label: 'Metal ions', scores: [
          curve('AdaBind', .386, .845), curve('ESMBind', .343, .833), curve('bindNode24', .321, .833),
          curve('bindEmbed21DL', .307, .823), curve('MetalBind', .203, .826),
        ] },
        { id: 'small', label: 'Small molecules', scores: [
          curve('AdaBind', .504, .889), curve('bindNode24', .432, .870), curve('bindEmbed21DL', .394, .864),
        ] },
        { id: 'dna', label: 'DNA', scores: [
          curve('AdaBind', .475, .960), curve('bindNode24', .342, .946), curve('bindEmbed21DL', .312, .926),
        ] },
        { id: 'rna', label: 'RNA', scores: [
          curve('AdaBind', .343, .888), curve('bindNode24', .070, .907), curve('bindEmbed21DL', .077, .882),
        ] },
      ]
    },
    {
      id: 'testsetnew46', label: 'TestSetNew46', estimate: true,
      groups: [
        { id: 'metal', label: 'Metal ions', scores: [
          curve('AdaBind', .72, .96), curve('ESMBind', .68, .97), curve('bindNode24', .66, .95),
          curve('bindEmbed21DL', .60, .93), curve('MetalBind', .31, .84),
        ] },
        { id: 'small', label: 'Small molecules', scores: [
          curve('AdaBind', .61, .97), curve('bindNode24', .55, .95), curve('bindEmbed21DL', .48, .93),
        ] },
        { id: 'dna', label: 'DNA', scores: [
          curve('AdaBind', .48, .99), curve('bindNode24', .14, .97), curve('bindEmbed21DL', .11, .96),
        ] },
        { id: 'rna', label: 'RNA', scores: [
          curve('AdaBind', .20, .94), curve('bindNode24', .06, .97), curve('bindEmbed21DL', .05, .96),
        ] },
      ]
    },
  ];

  get activeDataset(): CurveDataset {
    return this.datasets.find(d => d.id === this.selectedDataset) ?? this.datasets[0];
  }

  rocOption(group: CurveGroup): EChartsOption {
    const series: NonNullable<EChartsOption['series']> = group.scores.map(score => ({
      name: score.method,
      type: 'line',
      showSymbol: false,
      smooth: 0.15,
      lineStyle: { width: score.method === 'AdaBind' ? 2.8 : 2, color: METHOD_COLORS[score.method] },
      data: this.rocPoints(score.auroc),
    } as any));
    series.push({
      name: 'Chance', type: 'line', showSymbol: false, silent: true,
      lineStyle: { color: '#64748B', type: 'dashed', width: 1 },
      data: [[0, 0], [1, 1]],
    } as any);
    return this.baseOption('False positive rate', 'True positive rate', series, 'AUROC',
      Object.fromEntries(group.scores.map(score => [score.method, score.auroc])));
  }

  prOption(group: CurveGroup): EChartsOption {
    const series = group.scores.map(score => ({
      name: score.method,
      type: 'line',
      showSymbol: false,
      smooth: 0.15,
      lineStyle: { width: score.method === 'AdaBind' ? 2.8 : 2, color: METHOD_COLORS[score.method] },
      data: this.prPoints(score.auprc, score.method === 'MetalBind' ? .10 : .10),
    } as any));
    return this.baseOption('Recall', 'Precision', series, 'AUPRC',
      Object.fromEntries(group.scores.map(score => [score.method, score.auprc])));
  }

  private baseOption(
    xName: string,
    yName: string,
    series: any[],
    metric: 'AUROC' | 'AUPRC',
    metricValues: Record<string, number>,
  ): EChartsOption {
    return {
      animation: false,
      color: Object.values(METHOD_COLORS),
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B', borderColor: '#475569', textStyle: { color: '#F8FAFC' },
        valueFormatter: value => Number(value).toFixed(3),
        formatter: (items: any) => {
          const lines = items.filter((item: any) => item.seriesName !== 'Chance')
            .map((item: any) => `${item.marker}${item.seriesName}: ${metric} ${(metricValues[item.seriesName] ?? 0).toFixed(3)}<br/>${xName}: ${Number(item.value[0]).toFixed(2)}, ${yName}: ${Number(item.value[1]).toFixed(2)}`);
          return lines.join('<br/>');
        }
      },
      grid: { left: 42, right: 14, top: 18, bottom: 34 },
      xAxis: {
        type: 'value', min: 0, max: 1, name: xName, nameLocation: 'middle', nameGap: 25,
        axisLabel: { color: '#94A3B8', fontSize: 10 }, axisLine: { lineStyle: { color: '#64748B' } },
        splitLine: { lineStyle: { color: '#1E293B' } },
      },
      yAxis: {
        type: 'value', min: 0, max: 1, name: yName, nameLocation: 'middle', nameGap: 30,
        axisLabel: { color: '#94A3B8', fontSize: 10 }, axisLine: { lineStyle: { color: '#64748B' } },
        splitLine: { lineStyle: { color: '#1E293B' } },
      },
      series,
    };
  }

  private rocPoints(auc: number): any {
    const alpha = Math.max(.001, 1 / auc - 1);
    const points: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      const fpr = i / 100;
      points.push([fpr, Math.pow(fpr, alpha)]);
    }
    (points as any).score = auc;
    return points;
  }

  private prPoints(auprc: number, prevalence: number): any {
    const floor = Math.min(prevalence, auprc * .8);
    const exponent = Math.max(.001, (1 - floor) / Math.max(.001, auprc - floor) - 1);
    const points: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      const recall = i / 100;
      points.push([recall, floor + (1 - floor) * Math.pow(1 - recall, exponent)]);
    }
    (points as any).score = auprc;
    return points;
  }
}
