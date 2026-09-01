import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

@Component({
  selector: 'app-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tooltip-wrapper" (mouseenter)="show()" (mouseleave)="hide()">
      <ng-content></ng-content>
      @if (visible && content) {
        <div [class]="'tooltip tooltip-' + position" role="tooltip">
          {{ content }}
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: inline-block;
    }

    .tooltip-wrapper {
      position: relative;
      display: inline-block;
    }

    .tooltip {
      position: absolute;
      z-index: var(--z-tooltip);
      padding: var(--space-2) var(--space-3);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-inverse);
      background-color: var(--color-text-primary);
      border-radius: var(--radius-base);
      white-space: nowrap;
      pointer-events: none;
      animation: fadeIn 0.15s ease-out;
    }

    .tooltip-top {
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
    }

    .tooltip-bottom {
      top: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
    }

    .tooltip-left {
      right: calc(100% + 8px);
      top: 50%;
      transform: translateY(-50%);
    }

    .tooltip-right {
      left: calc(100% + 8px);
      top: 50%;
      transform: translateY(-50%);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  `]
})
export class TooltipComponent {
  @Input() content: string = '';
  @Input() position: TooltipPosition = 'top';
  
  visible = false;

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }
}
