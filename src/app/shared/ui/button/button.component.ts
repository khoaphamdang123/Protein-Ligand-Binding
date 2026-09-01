import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button 
      [type]="type"
      [disabled]="disabled || loading"
      [class]="getButtonClasses()"
    >
      @if (loading) {
        <svg class="button-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
      }
      @if (iconLeft && !loading) {
        <span class="button-icon-left">
          <ng-content select="[iconLeft]"></ng-content>
        </span>
      }
      <span class="button-content">
        <ng-content></ng-content>
      </span>
      @if (iconRight) {
        <span class="button-icon-right">
          <ng-content select="[iconRight]"></ng-content>
        </span>
      }
    </button>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }

    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      font-family: var(--font-sans);
      font-weight: var(--font-weight-medium);
      text-align: center;
      white-space: nowrap;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all var(--transition-fast);
      
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
      }

      &:focus-visible {
        outline: 2px solid var(--color-border-focus);
        outline-offset: 2px;
      }
    }

    /* Sizes */
    .btn-sm {
      height: 32px;
      padding: 0 var(--space-3);
      font-size: var(--font-size-xs);
      border-radius: var(--radius-base);
    }

    .btn-md {
      height: 40px;
      padding: 0 var(--space-4);
      font-size: var(--font-size-sm);
      border-radius: var(--radius-md);
    }

    .btn-lg {
      height: 48px;
      padding: 0 var(--space-6);
      font-size: var(--font-size-base);
      border-radius: var(--radius-md);
    }

    /* Variants */
    .btn-primary {
      background-color: var(--color-primary);
      color: var(--color-text-inverse);
      border-color: var(--color-primary);

      &:hover:not(:disabled) {
        background-color: var(--color-primary-hover);
        border-color: var(--color-primary-hover);
      }

      &:active:not(:disabled) {
        background-color: var(--color-primary-active);
        border-color: var(--color-primary-active);
      }
    }

    .btn-secondary {
      background-color: var(--color-bg-elevated);
      color: var(--color-text-primary);
      border-color: var(--color-border-primary);

      &:hover:not(:disabled) {
        background-color: var(--color-bg-hover);
      }

      &:active:not(:disabled) {
        background-color: var(--color-bg-secondary);
      }
    }

    .btn-outline {
      background-color: transparent;
      color: var(--color-text-primary);
      border-color: var(--color-border-primary);

      &:hover:not(:disabled) {
        background-color: var(--color-bg-hover);
        border-color: var(--color-text-tertiary);
      }

      &:active:not(:disabled) {
        background-color: var(--color-bg-secondary);
      }
    }

    .btn-ghost {
      background-color: transparent;
      color: var(--color-text-secondary);
      border-color: transparent;

      &:hover:not(:disabled) {
        color: var(--color-text-primary);
        background-color: var(--color-bg-hover);
      }

      &:active:not(:disabled) {
        background-color: var(--color-bg-secondary);
      }
    }

    .btn-danger {
      background-color: var(--color-error);
      color: white;
      border-color: var(--color-error);

      &:hover:not(:disabled) {
        background-color: var(--color-error-hover);
        border-color: var(--color-error-hover);
      }
    }

    .button-spinner {
      width: 16px;
      height: 16px;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .button-content {
      display: inline-flex;
      align-items: center;
    }

    .button-icon-left,
    .button-icon-right {
      display: inline-flex;
      align-items: center;
      
      ::ng-deep svg {
        width: 16px;
        height: 16px;
      }
    }
  `]
})
export class ButtonComponent {
  variant: ButtonVariant = 'primary';
  size: ButtonSize = 'md';
  type: 'button' | 'submit' | 'reset' = 'button';
  disabled: boolean = false;
  loading: boolean = false;
  iconLeft: boolean = false;
  iconRight: boolean = false;

  getButtonClasses(): string {
    return `btn-${this.size} btn-${this.variant}`;
  }
}
