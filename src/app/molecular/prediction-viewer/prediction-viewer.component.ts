import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy,
  Output, SimpleChanges, ViewChild, computed, inject, signal
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec';
import { Color } from 'molstar/lib/mol-util/color';
import { ColorTheme } from 'molstar/lib/mol-theme/color';
import { Location } from 'molstar/lib/mol-model/location';
import { Loci } from 'molstar/lib/mol-model/loci';
import { StructureElement, StructureProperties } from 'molstar/lib/mol-model/structure';
import { Expression } from 'molstar/lib/mol-script/language/expression';
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder';
import { StructureSelectionQuery } from 'molstar/lib/mol-plugin-state/helpers/structure-selection-query';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands';
import { Camera } from 'molstar/lib/mol-canvas3d/camera';
import { ErrorReporterService, describeError } from '../../core/services/error-reporter.service';
import { hexToInt, plddtColor, probabilityColor, STATUS_COLORS } from '../../core/utils/prediction-colors';
import { ResidueStatus } from '../../core/models/explore.model';

export type PredictionColorMode = 'outcome' | 'probability' | 'plddt' | 'rainbow';
export type FocusMode = 'ground-truth' | 'predicted';

/** Neutral cartoon of the 'outcome' mode, so that only the TP / FP / FN sticks carry colour. */
const OUTCOME_CARTOON = 0xa9b4c2;
const DEFAULT_SITE_COLOR = '#22D3EE';

/**
 * Keeps several viewers of the same structure on one camera. The viewer under the pointer leads: the others copy
 * its camera after each frame it draws.
 */
export class CameraLink {
  enabled = true;
  private viewers = new Set<PredictionViewerComponent>();

  join(viewer: PredictionViewerComponent): void {
    this.viewers.add(viewer);
  }

  leave(viewer: PredictionViewerComponent): void {
    this.viewers.delete(viewer);
  }

  publish(source: PredictionViewerComponent, snapshot: Camera.Snapshot): void {
    if (this.enabled) {
      this.viewers.forEach(v => { if (v !== source) v.applyCamera(snapshot); });
    }
  }
}

/**
 * Mol* (Molstar) based 3D structure viewer, drop-in replacement for the former
 * NGL viewer. Renders an ESMFold PDB as a cartoon coloured per residue and
 * overlays binding/prediction residues. Keeps the same @Input/@Output surface.
 */
@Component({
  selector: 'app-prediction-viewer',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="viewer-wrap">
      <div class="viewer" #container></div>
      @if (hoverInfo(); as h) {
        <div class="residue-tooltip" [style.left.px]="tooltipPos().x" [style.top.px]="tooltipPos().y">
          <div class="tt-title">{{ h.aa }}{{ h.position }}</div>
          <div class="tt-row"><span>Score</span><b>{{ h.probability | number: '1.3-3' }}</b></div>
          <div class="tt-row"><span>pLDDT</span><b [class.low]="h.plddt < 0.7">{{ h.plddt | number: '1.2-2' }}</b></div>
          <div class="tt-row"><span>Prediction</span><b>{{ h.predicted ? 'binding' : 'non-binding' }}</b></div>
          @if (h.status) {
            <div class="tt-row"><span>Status</span><b [style.color]="statusColor(h.status)">{{ h.status }}</b></div>
          }
          @if (h.hasGroundTruth) {
            <div class="tt-row"><span>Ground truth</span><b>{{ h.groundTruth ? 'binding' : 'non-binding' }}</b></div>
          }
          @if (h.ligandClassLabel) {
            <div class="tt-row"><span>Class</span><b>{{ h.ligandClassLabel }}</b></div>
          }
        </div>
      }
      @if (loading()) {
        <div class="viewer-overlay">Rendering structure…</div>
      }
      @if (error()) {
        <div class="viewer-overlay viewer-error" role="alert">
          <strong>3D viewer error</strong>
          <span>{{ error() }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .viewer-wrap {
      position: relative;
      height: 100%;
      min-height: 360px;
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--color-bg-primary);
    }
    .viewer { position: absolute; inset: 0; }
    .viewer-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
      text-align: center;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      background: color-mix(in srgb, var(--color-bg-primary) 70%, transparent);
      pointer-events: none;
    }
    .viewer-error { color: var(--color-error); }
    .residue-tooltip {
      position: absolute;
      z-index: var(--z-tooltip);
      transform: translate(14px, 14px);
      max-width: 200px;
      padding: var(--space-3);
      background: color-mix(in srgb, var(--color-bg-elevated) 94%, transparent);
      border: 1px solid var(--color-border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      font-size: var(--font-size-xs);
      pointer-events: none;
    }
    .tt-title {
      font-family: var(--font-mono);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin-bottom: var(--space-2);
    }
    .tt-row {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      padding: 1px 0;
      span { color: var(--color-text-tertiary); }
      b { color: var(--color-text-primary); font-family: var(--font-mono); }
      b.low { color: var(--color-error); }
    }
  `]
})
export class PredictionViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('container', { static: true }) container!: ElementRef<HTMLDivElement>;

  @Input() pdb: string | null = null;
  @Input() probability: number[] = [];
  @Input() binding: boolean[] = [];
  @Input() plddt: number[] = [];
  @Input() colorMode: PredictionColorMode = 'probability';
  @Input() selectedIndex: number | null = null;
  @Input() sequence = '';
  @Input() groundTruth: boolean[] = [];
  @Input() status: ResidueStatus[] = [];
  @Input() showGroundTruth = false;
  @Input() showPredicted = true;
  @Input() errorsOnly = false;
  @Input() ligandClassColor: string | null = null;
  @Input() ligandClassLabel: string | null = null;
  @Input() cameraLink: CameraLink | null = null;
  @Input() predictedColor: string | null = null;   // sticks on called residues when there is no ground truth
  @Output() residueSelect = new EventEmitter<number>();
  @Output() residueHover = new EventEmitter<number | null>();

  loading = signal(false);
  error = signal<string | null>(null);
  hoverIndex = signal<number | null>(null);
  tooltipPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  private zone = inject(NgZone);
  private reporter = inject(ErrorReporterService);

  private plugin: PluginContext | null = null;
  private structure: any = null; // StateObjectSelector<SO.Molecule.Structure>
  private colorFn: (seqId: number) => number = () => 0x888888;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private loadToken = 0;
  private pointerInside = false;
  private lastCamera = '';
  private cameraSub: { unsubscribe(): void } | null = null;
  private readonly onPointerEnter = () => { this.pointerInside = true; };
  private readonly onPointerLeave = () => { this.pointerInside = false; };
  private readonly onPointerMove = (e: PointerEvent) => {
    // Next to the pointer, on the side where the tooltip stays inside the viewer.
    const box = this.container.nativeElement.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    this.tooltipPos.set({ x: x > box.width - 230 ? x - 240 : x, y: y > box.height - 190 ? y - 180 : y });
  };

  hoverInfo = computed(() => {
    const i = this.hoverIndex();
    if (!i || i < 1 || i > this.probability.length) return null;
    const idx = i - 1;
    return {
      position: i,
      aa: this.sequence[idx] ?? '',
      probability: this.probability[idx] ?? 0,
      plddt: this.plddt[idx] ?? 0,
      predicted: this.binding[idx] ?? false,
      groundTruth: this.groundTruth[idx] ?? false,
      hasGroundTruth: this.groundTruth.length > 0,
      status: this.status[idx] ?? null,
      ligandClassLabel: this.ligandClassLabel,
    };
  });

  statusColor(status: ResidueStatus | null | undefined): string {
    return status ? STATUS_COLORS[status] : '#94A3B8';
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.zone.runOutsideAngular(async () => {
        const plugin = new PluginContext(DefaultPluginSpec());
        await plugin.init();
        plugin.mount(this.container.nativeElement);
        this.plugin = plugin;

        this.setBackground();
        this.themeObserver = new MutationObserver(() => this.setBackground());
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

        this.registerColorTheme();

        plugin.behaviors.interaction.click.subscribe((e: any) => this.onPick(e));
        plugin.behaviors.interaction.hover.subscribe((e: any) => this.onHover(e));

        this.resizeObserver = new ResizeObserver(() => this.plugin?.handleResize());
        this.resizeObserver.observe(this.container.nativeElement);
        this.container.nativeElement.addEventListener('pointermove', this.onPointerMove);

        this.linkCamera();
      });
    } catch (err) {
      this.fail('Cannot initialise the 3D viewer (WebGL unavailable?)', err);
      return;
    }
    await this.load();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.plugin) return;
    // Scene inputs first: a protein change usually clears the selection in the same pass, and load() re-applies it.
    if (
      changes['pdb'] || changes['colorMode'] || changes['probability'] || changes['binding'] ||
      changes['plddt'] || changes['groundTruth'] || changes['status'] || changes['showGroundTruth'] ||
      changes['showPredicted'] || changes['errorsOnly'] || changes['ligandClassColor'] || changes['predictedColor']
    ) {
      this.load();
    } else if (changes['selectedIndex']) {
      this.selectResidue();
    }
  }

  ngOnDestroy(): void {
    this.cameraLink?.leave(this);
    this.cameraSub?.unsubscribe();
    this.container.nativeElement.removeEventListener('pointermove', this.onPointerMove);
    this.container.nativeElement.removeEventListener('pointerenter', this.onPointerEnter);
    this.container.nativeElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.plugin?.dispose();
    this.plugin = null;
  }

  /** Focus the camera on the ground-truth or predicted pocket. */
  focusPocket(mode: FocusMode): void {
    if (!this.plugin || !this.structure) return;
    const source = mode === 'ground-truth' ? this.groundTruth : this.binding;
    const indices = source.flatMap((b, i) => (b ? [i + 1] : []));
    if (!indices.length) return;
    this.focusResidues(indices);
  }

  /** Back to the whole structure. */
  resetView(): void {
    if (this.plugin) {
      this.zone.runOutsideAngular(() => this.plugin?.managers.camera.reset(undefined, 300));
    }
  }

  /** Another viewer of the same structure moved (see CameraLink). */
  applyCamera(snapshot: Camera.Snapshot): void {
    const camera = this.plugin?.canvas3d?.camera;
    if (camera) {
      this.lastCamera = cameraKey(snapshot);
      camera.setState(snapshot, 0);
    }
  }

  private linkCamera(): void {
    const canvas = this.plugin?.canvas3d;
    if (!canvas || !this.cameraLink) return;
    this.cameraLink.join(this);
    const element = this.container.nativeElement;
    element.addEventListener('pointerenter', this.onPointerEnter);
    element.addEventListener('pointerleave', this.onPointerLeave);
    this.cameraSub = canvas.didDraw.subscribe(() => {
      if (!this.pointerInside) return;
      const snapshot = canvas.camera.getSnapshot();
      const key = cameraKey(snapshot);
      if (key !== this.lastCamera) {
        this.lastCamera = key;
        this.cameraLink?.publish(this, snapshot);
      }
    });
  }

  /** Export a high-resolution PNG snapshot at the requested scale (1x/2x/4x). */
  async exportPng(scale = 2, filename = 'structure'): Promise<void> {
    if (!this.plugin) return;
    try {
      const helper = this.plugin.helpers.viewportScreenshot;
      if (!helper) throw new Error('Screenshot helper unavailable');
      const uri = await this.zone.runOutsideAngular(async () => {
        // Reset to viewport resolution first so we measure the true canvas size.
        const base = helper.values;
        helper.behaviors.values.next({ ...base, resolution: { name: 'viewport', params: {} } });
        const { width, height } = helper.getSizeAndViewport();
        // Render at the requested scale.
        helper.behaviors.values.next({
          ...base,
          resolution: {
            name: 'custom',
            params: {
              width: Math.max(128, Math.round(width * scale)),
              height: Math.max(128, Math.round(height * scale)),
            },
          },
        });
        return helper.getImageDataUri();
      });
      const a = document.createElement('a');
      a.href = uri;
      a.download = `${filename}.png`;
      a.click();
    } catch (err) {
      this.fail('Could not export image', err);
    }
  }

  private setBackground(): void {
    if (!this.plugin) return;
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim() || '#0B1020';
    PluginCommands.Canvas3D.SetSettings(this.plugin, {
      settings: (props: any) => { props.renderer.backgroundColor = Color(hexToInt(hex)); },
    });
  }

  private registerColorTheme(): void {
    if (!this.plugin) return;
    const self = this;
    const factory: ColorTheme.Factory<any, any> = (ctx, props) => {
      const color = (location: Location, isSecondary: boolean): Color => {
        if (StructureElement.Location.is(location)) {
          const seqId = StructureProperties.residue.auth_seq_id(location);
          return Color(self.colorFn(seqId));
        }
        return Color(0x888888);
      };
      return { factory, granularity: 'group', preferSmoothing: true, color, props };
    };
    const provider: ColorTheme.Provider<any> = {
      name: 'prediction-residue-color',
      label: 'Prediction Residue Color',
      category: ColorTheme.Category.Residue,
      factory,
      getParams: () => ({}),
      defaultValues: {},
      isApplicable: (ctx: any) => !!ctx.structure,
    };
    this.plugin.representation.structure.themes.colorThemeRegistry.add(provider);
  }

  /** Load (or reload) the structure and rebuild all representations. */
  private async load(): Promise<void> {
    const plugin = this.plugin;
    if (!plugin) return;
    const token = ++this.loadToken;
    this.error.set(null);
    if (!this.pdb) return;

    this.loading.set(true);
    try {
      await this.zone.runOutsideAngular(async () => {
        await plugin.clear();
        const data = await plugin.builders.data.rawData({ data: this.pdb as string, label: 'structure' });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
        const model = await plugin.builders.structure.createModel(trajectory);
        const structure = await plugin.builders.structure.createStructure(model);
        if (token !== this.loadToken) return;
        this.structure = structure;

        this.updateColorFn();
        await this.addCartoon();

        if (this.showGroundTruth && this.groundTruth.length) {
          const gt = this.groundTruth.flatMap((b, i) => (b ? [i + 1] : []));
          if (gt.length) await this.addHighlight('ground-truth', gt, hexToInt(this.ligandClassColor ?? DEFAULT_SITE_COLOR));
        }

        if (this.showPredicted && this.status.length) {
          for (const s of ['TP', 'FP', 'FN', 'TN'] as ResidueStatus[]) {
            if (this.errorsOnly && (s === 'TP' || s === 'TN')) continue;
            // TN is the "background" (correctly non-binding); keep it as the
            // cartoon instead of drawing a highlight on ~85% of residues.
            if (s === 'TN') continue;
            const indices = this.status.flatMap((st, i) => (st === s ? [i + 1] : []));
            if (indices.length) await this.addHighlight(`status-${s}`, indices, hexToInt(STATUS_COLORS[s]));
          }
        } else if (this.showPredicted && this.predictedColor) {
          const called = this.binding.flatMap((b, i) => (b ? [i + 1] : []));
          if (called.length) await this.addHighlight('predicted', called, hexToInt(this.predictedColor));
        }

        plugin.managers.camera.reset(undefined, 0);
      });
      // Re-apply the residue highlight without re-zooming (keeps the default view).
      this.selectResidue(false);
    } catch (err) {
      if (token === this.loadToken) this.fail('Could not load the predicted structure', err);
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  private updateColorFn(): void {
    const values = this.colorMode === 'plddt' ? this.plddt : this.probability;
    const n = Math.max(this.sequence.length, values.length, 1);
    if (this.colorMode === 'rainbow') {
      this.colorFn = (seqId) => rainbowColor(seqId - 1, n);
    } else if (this.colorMode === 'outcome') {
      this.colorFn = () => OUTCOME_CARTOON;
    } else {
      const colorOf = this.colorMode === 'plddt' ? plddtColor : probabilityColor;
      const colors = values.map((v) => hexToInt(colorOf(v)));
      this.colorFn = (seqId) => colors[seqId - 1] ?? 0x888888;
    }
  }

  private async addCartoon(): Promise<void> {
    if (!this.plugin || !this.structure) return;
    const color = 'prediction-residue-color' as unknown as ColorTheme.BuiltIn;
    await this.plugin.builders.structure.representation.addRepresentation(this.structure, {
      type: 'cartoon',
      typeParams: {},
      color,
      colorParams: {},
    });
  }

  private async addHighlight(name: string, residues: number[], color: number): Promise<void> {
    if (!this.plugin || !this.structure || residues.length === 0) return;
    try {
      const query = StructureSelectionQuery(name, this.residueExpression(residues));
      const component = await this.plugin.builders.structure.tryCreateComponentFromSelection(
        this.structure, query, name
      );
      if (!component) return;
      await this.plugin.builders.structure.representation.addRepresentation(component, {
        type: 'ball-and-stick',
        typeParams: {},
        color: 'uniform' as ColorTheme.BuiltIn,
        colorParams: { value: color },
      });
    } catch (err) {
      // Highlighting is best-effort; never break the base cartoon for it.
      console.warn('Molstar highlight skipped', name, err);
    }
  }

  private residueExpression(indices: number[]): Expression {
    if (indices.length === 1) {
      return MS.struct.generator.atomGroups({
        'residue-test': MS.core.rel.eq([MS.ammp('auth_seq_id'), indices[0]]),
      });
    }
    const tests: Record<string, unknown> = {};
    indices.forEach((n, i) => {
      tests[`r${i}`] = MS.core.rel.eq([MS.ammp('auth_seq_id'), n]);
    });
    return MS.struct.generator.atomGroups({
      'residue-test': MS.core.logic.or(tests as any),
    });
  }

  private selectResidue(zoom = true): void {
    if (!this.plugin || !this.structure) return;
    if (!this.selectedIndex) {
      this.plugin.managers.interactivity.lociSelects.deselectAll();
      return;
    }
    const loci = this.residueLoci([this.selectedIndex]);
    if (!loci || (StructureElement.Loci.is(loci) && StructureElement.Loci.isEmpty(loci))) return;
    this.plugin.managers.interactivity.lociSelects.selectOnly({ loci });
    if (zoom) {
      this.plugin.managers.camera.focusLoci(loci, { minRadius: 4, extraRadius: 2, durationMs: 400 });
      // `focusLoci` narrows the camera's clipping `radius` to the residue, so
      // zooming back out afterwards would clip the rest of the protein. Once the
      // focus animation finishes, widen `radius` back to the full scene radius.
      this.scheduleClippingWiden(400);
    }
  }

  private focusResidues(indices: number[]): void {
    if (!this.plugin || !this.structure) return;
    const loci = this.residueLoci(indices);
    if (loci) {
      this.plugin.managers.camera.focusLoci(loci, { minRadius: 6, extraRadius: 6, durationMs: 600 });
      this.scheduleClippingWiden(600);
    }
  }

  private scheduleClippingWiden(durationMs: number): void {
    window.setTimeout(() => {
      const camera = this.plugin?.canvas3d?.camera;
      if (!camera) return;
      // Restore the clipping radius to the whole scene so near/far planes keep
      // covering the protein regardless of how far the user zooms back out.
      camera.setState({ radius: camera.state.radiusMax }, 0);
    }, durationMs + 80);
  }

  private residueLoci(indices: number[]): Loci | null {
    // `this.structure` is a StateObjectSelector; fromExpression needs the
    // actual Structure data object, so use `.data`.
    const data = this.structure?.data;
    if (!data) return null;
    try {
      return StructureElement.Loci.fromExpression(data, this.residueExpression(indices));
    } catch (err) {
      console.warn('residueLoci failed', err);
      return null;
    }
  }

  private onPick(e: any): void {
    const seqId = this.lociSeqId(e?.current?.loci);
    if (seqId) this.zone.run(() => this.residueSelect.emit(seqId));
  }

  private onHover(e: any): void {
    const seqId = this.lociSeqId(e?.current?.loci);
    this.zone.run(() => {
      this.hoverIndex.set(seqId);
      this.residueHover.emit(seqId);
    });
  }

  private lociSeqId(loci: any): number | null {
    if (!loci || !StructureElement.Loci.is(loci)) return null;
    const loc = StructureElement.Loci.getFirstLocation(loci);
    if (!loc) return null;
    const seqId = StructureProperties.residue.auth_seq_id(loc);
    return seqId > 0 ? seqId : null;
  }

  private fail(message: string, err: unknown): void {
    const detail = `${message}: ${describeError(err)}`;
    console.error(detail, err);
    this.zone.run(() => {
      this.error.set(detail);
      this.loading.set(false);
    });
    this.reporter.report('error', detail, 'prediction-viewer', err, { pdbLength: this.pdb?.length ?? 0 });
  }
}

function cameraKey(s: Camera.Snapshot): string {
  return [...s.position, ...s.target, ...s.up, s.radius].map(v => v.toFixed(4)).join(',');
}

const RAINBOW_STOPS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E5AA8', '#7E57C2'];

function rainbowColor(index: number, count: number): number {
  const position = (Math.max(0, index) / Math.max(1, count - 1)) * (RAINBOW_STOPS.length - 1);
  const start = Math.min(Math.floor(position), RAINBOW_STOPS.length - 2);
  const fraction = position - start;
  const from = hexToInt(RAINBOW_STOPS[start]);
  const to = hexToInt(RAINBOW_STOPS[start + 1]);
  const channel = (shift: number) => Math.round(
    ((from >> shift) & 0xff) * (1 - fraction) + ((to >> shift) & 0xff) * fraction
  );
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
