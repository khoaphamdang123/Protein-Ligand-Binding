import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-protein-detail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="protein-detail-page">
      <header class="page-header">
        <h1 class="page-title">Protein Detail</h1>
        <p class="page-subtitle">Detailed protein analysis view</p>
      </header>

      <div class="content-placeholder">
        <p>Protein detail view with 3D visualization coming soon.</p>
      </div>
    </div>
  `,
  styles: [`
    .protein-detail-page {
      padding: 2rem;
    }
    .page-header {
      margin-bottom: 2rem;
    }
    .page-title {
      font-size: 2rem;
      font-weight: 600;
      color: #F8FAFC;
    }
    .content-placeholder {
      padding: 4rem;
      text-align: center;
      background-color: rgba(26, 35, 50, 0.4);
      border-radius: 12px;
      color: #94A3B8;
    }
  `]
})
export class ProteinDetailComponent {}
