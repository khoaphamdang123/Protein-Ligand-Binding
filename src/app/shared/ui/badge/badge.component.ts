import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="badge" [class]="'badge-' + variant + ' badge-' + size">
      <ng-content></ng-content>
    </span>
  `,
  styles: [`
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.625rem;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      white-space: nowrap;
    }

    .badge-sm { padding: 0.125rem 0.5rem; font-size: 0.6875rem; }
    .badge-lg { padding: 0.375rem 0.875rem; font-size: 0.875rem; }

    .badge-primary {
      background-color: rgba(34, 211, 238, 0.15);
      color: #22D3EE;
    }

    .badge-success {
      background-color: rgba(16, 185, 129, 0.15);
      color: #10B981;
    }

    .badge-warning {
      background-color: rgba(245, 158, 11, 0.15);
      color: #F59E0B;
    }

    .badge-error {
      background-color: rgba(239, 68, 68, 0.15);
      color: #EF4444;
    }

    .badge-neutral {
      background-color: rgba(148, 163, 184, 0.15);
      color: #94A3B8;
    }
  `]
})
export class BadgeComponent {
  @Input() variant: 'primary' | 'success' | 'warning' | 'error' | 'neutral' = 'primary';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
}
