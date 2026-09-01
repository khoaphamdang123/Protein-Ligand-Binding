import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="loading-container" [class]="'size-' + size">
      <div class="spinner">
        <div class="spinner-circle"></div>
      </div>
      @if (message) {
        <p class="loading-message">{{ message }}</p>
      }
    </div>
  `,
  styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      
      &.size-sm {
        padding: 1rem;
        .spinner { width: 24px; height: 24px; }
      }
      
      &.size-lg {
        .spinner { width: 48px; height: 48px; }
        .loading-message { font-size: 1.125rem; }
      }
    }

    .spinner {
      width: 32px;
      height: 32px;
      position: relative;
    }

    .spinner-circle {
      width: 100%;
      height: 100%;
      border: 3px solid rgba(34, 211, 238, 0.2);
      border-top-color: #22D3EE;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .loading-message {
      margin-top: 1rem;
      color: #94A3B8;
      font-size: 0.875rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class LoadingComponent {
  @Input() message?: string;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
}
