import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="empty-container">
      <div class="empty-icon">
        <ng-content select="[icon]"></ng-content>
      </div>
      <h3 class="empty-title">{{ title }}</h3>
      <p class="empty-message">{{ message }}</p>
      <div class="empty-action">
        <ng-content select="[action]"></ng-content>
      </div>
    </div>
  `,
  styles: [`
    .empty-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      text-align: center;
    }

    .empty-icon {
      color: #64748B;
      margin-bottom: 1.5rem;
      opacity: 0.5;
    }

    .empty-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #94A3B8;
      margin-bottom: 0.5rem;
    }

    .empty-message {
      color: #64748B;
      font-size: 0.875rem;
      max-width: 400px;
      margin-bottom: 1.5rem;
    }

    .empty-action {
      margin-top: 0.5rem;
    }
  `]
})
export class EmptyStateComponent {
  @Input() title: string = 'No data';
  @Input() message: string = 'There is no data to display.';
}
