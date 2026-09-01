import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" [class.card-hoverable]="hoverable" [class.card-bordered]="bordered">
      @if (title) {
        <div class="card-header">
          <h3 class="card-title">{{ title }}</h3>
          <ng-content select="[header]"></ng-content>
        </div>
      }
      <div class="card-body">
        <ng-content></ng-content>
      </div>
      <ng-content select="[footer]"></ng-content>
    </div>
  `,
  styles: [`
    .card {
      background-color: rgba(26, 35, 50, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 12px;
      overflow: hidden;
    }

    .card-bordered {
      border-width: 1px;
    }

    .card-hoverable {
      transition: all 0.2s ease;
      cursor: pointer;

      &:hover {
        border-color: rgba(34, 211, 238, 0.3);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        transform: translateY(-2px);
      }
    }

    .card-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-title {
      font-size: 1rem;
      font-weight: 600;
      color: #F8FAFC;
      margin: 0;
    }

    .card-body {
      padding: 1.5rem;
    }
  `]
})
export class CardComponent {
  @Input() title?: string;
  @Input() hoverable: boolean = false;
  @Input() bordered: boolean = true;
}
