import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="panel" [class.panel-bordered]="bordered">
      @if (title || hasHeader) {
        <div class="panel-header">
          @if (title) {
            <h3 class="panel-title">{{ title }}</h3>
          }
          <ng-content select="[header]"></ng-content>
        </div>
      }
      <div class="panel-body" [class.panel-body-padded]="padded">
        <ng-content></ng-content>
      </div>
      @if (hasFooter) {
        <div class="panel-footer">
          <ng-content select="[footer]"></ng-content>
        </div>
      }
    </div>
  `,
  styles: [`
    .panel {
      background-color: var(--color-bg-panel);
      border-radius: var(--radius-md);
      overflow: hidden;
      transition: background-color var(--transition-base);
    }

    .panel-bordered {
      border: 1px solid var(--color-border-primary);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--color-border-primary);
    }

    .panel-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }

    .panel-body {
      &.panel-body-padded {
        padding: var(--space-5);
      }
    }

    .panel-footer {
      padding: var(--space-4) var(--space-5);
      border-top: 1px solid var(--color-border-primary);
      background-color: var(--color-bg-secondary);
    }
  `]
})
export class PanelComponent {
  @Input() title?: string;
  @Input() bordered: boolean = true;
  @Input() padded: boolean = true;
  
  hasHeader: boolean = false;
  hasFooter: boolean = false;
}
