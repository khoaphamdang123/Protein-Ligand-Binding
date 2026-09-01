import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-error',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="error-container">
      <div class="error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
      </div>
      <h3 class="error-title">{{ title }}</h3>
      <p class="error-message">{{ message }}</p>
      @if (retryAction) {
        <button class="retry-btn" (click)="retryAction()">Try Again</button>
      }
    </div>
  `,
  styles: [`
    .error-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      text-align: center;
    }

    .error-icon {
      color: #EF4444;
      margin-bottom: 1.5rem;
    }

    .error-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #F8FAFC;
      margin-bottom: 0.5rem;
    }

    .error-message {
      color: #94A3B8;
      font-size: 0.875rem;
      max-width: 400px;
      margin-bottom: 1.5rem;
    }

    .retry-btn {
      padding: 0.5rem 1.5rem;
      background-color: #EF4444;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s ease;

      &:hover {
        background-color: #DC2626;
      }
    }
  `]
})
export class ErrorComponent {
  @Input() title: string = 'An error occurred';
  @Input() message: string = 'Something went wrong. Please try again.';
  @Input() retryAction?: () => void;
}
