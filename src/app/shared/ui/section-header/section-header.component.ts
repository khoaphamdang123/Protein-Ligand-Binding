import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-section-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="section-header">
      <div class="section-header-content">
        @if (title) {
          <h2 class="section-title">{{ title }}</h2>
        }
        @if (subtitle) {
          <p class="section-subtitle">{{ subtitle }}</p>
        }
      </div>
      @if (hasActions) {
        <div class="section-actions">
          <ng-content select="[actions]"></ng-content>
        </div>
      }
    </div>
  `,
  styles: [`
    .section-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }

    .section-header-content {
      flex: 1;
    }

    .section-title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0 0 var(--space-2) 0;
      letter-spacing: var(--letter-spacing-tight);
    }

    .section-subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin: 0;
      line-height: var(--line-height-relaxed);
    }

    .section-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-shrink: 0;
    }

    @media (max-width: 640px) {
      .section-header {
        flex-direction: column;
        align-items: stretch;
      }

      .section-title {
        font-size: var(--font-size-xl);
      }

      .section-actions {
        width: 100%;
      }
    }
  `]
})
export class SectionHeaderComponent {
  @Input() title?: string;
  @Input() subtitle?: string;
  
  hasActions: boolean = false;
}
