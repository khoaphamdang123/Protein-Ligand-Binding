import { Component, Input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DiagnosticsResponse } from '../../core/models/prediction.model';

/** Backend self-checks, deep environment report and recent problems (GET /api/diagnostics). */
@Component({
  selector: 'app-diagnostics-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    @if (diagnostics; as d) {
      <div class="diag">
        <section>
          <h4>Backend start-up checks <small>since {{ d.started | date: 'medium' }}</small></h4>
          <ul class="checks">
            @for (c of d.components; track c.name) {
              <li><span class="dot" [class]="c.status"></span><b>{{ c.name }}</b><span>{{ c.message }}</span></li>
            }
          </ul>
        </section>

        <section>
          <h4>Foundation models (scripts/check_environment.py)
            @if (d.environment_report?.generated) { <small>run {{ d.environment_report?.generated | date: 'medium' }}</small> }
          </h4>
          @if (d.environment_report?.checks; as checks) {
            <ul class="checks">
              @for (c of checks; track c.name) {
                <li><span class="dot" [class]="c.status"></span><b>{{ c.name }}</b><span>{{ c.message }}</span></li>
              }
            </ul>
          } @else if (d.environment_report?.message) {
            <p class="muted">{{ d.environment_report?.message }}</p>
          } @else {
            <p class="muted">Not run yet: <code>cd backend; .venv\\Scripts\\python.exe scripts\\check_environment.py</code></p>
          }
        </section>

        <section>
          <h4>Recent warnings and errors <small>{{ d.recent_problems.length }}</small></h4>
          @if (d.recent_problems.length) {
            <ul class="problems">
              @for (p of d.recent_problems; track $index) {
                <li [class]="p.level.toLowerCase()">
                  <span class="time">{{ p.time | date: 'HH:mm:ss' }}</span>
                  <span class="level">{{ p.level }}</span>
                  <span class="msg">{{ p.message }}@if (p.exception) { — {{ p.exception }} }</span>
                  <span class="rid">{{ p.logger }} · {{ p.request_id }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="muted">None.</p>
          }
          <p class="muted">Full log: <code>{{ d.log_file }}</code></p>
        </section>
      </div>
    }
  `,
  styles: [`
    .diag { display: grid; gap: var(--space-5); font-size: var(--font-size-sm); }
    h4 {
      margin-bottom: var(--space-2);
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      small { margin-left: var(--space-2); font-weight: var(--font-weight-normal); color: var(--color-text-tertiary); }
    }
    ul { list-style: none; display: grid; gap: var(--space-1); }
    .checks li {
      display: grid;
      grid-template-columns: 10px minmax(150px, 220px) 1fr;
      gap: var(--space-2);
      align-items: baseline;
      color: var(--color-text-secondary);
      b { font-weight: var(--font-weight-medium); color: var(--color-text-primary); }
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-tertiary); }
    .dot.ok { background: var(--color-success); }
    .dot.warning { background: var(--color-warning); }
    .dot.error { background: var(--color-error); }
    .problems li {
      display: grid;
      grid-template-columns: auto auto 1fr;
      gap: 0 var(--space-2);
      padding: var(--space-1) var(--space-2);
      border-left: 3px solid var(--color-warning);
      background: var(--color-bg-secondary);
      &.error, &.critical { border-left-color: var(--color-error); }
      .time, .rid { color: var(--color-text-tertiary); font-family: var(--font-mono); font-size: var(--font-size-xs); }
      .level { font-weight: var(--font-weight-semibold); font-size: var(--font-size-xs); }
      .msg { color: var(--color-text-primary); word-break: break-word; }
      .rid { grid-column: 3; }
    }
    .muted { margin-top: var(--space-2); color: var(--color-text-tertiary); }
    code { font-family: var(--font-mono); font-size: var(--font-size-xs); word-break: break-all; }
    @media (max-width: 640px) {
      .checks li { grid-template-columns: 10px 1fr; span:last-child { grid-column: 2; } }
    }
  `]
})
export class DiagnosticsPanelComponent {
  @Input() diagnostics: DiagnosticsResponse | null = null;
}
