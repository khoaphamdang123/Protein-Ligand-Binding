import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="about-page">
      <header class="page-header">
        <h1 class="page-title">About BindSite Explorer</h1>
        <p class="page-subtitle">Protein binding site prediction research platform</p>
      </header>

      <div class="about-content">
        <section class="about-section">
          <h2>Project Overview</h2>
          <p>
            BindSite Explorer is the interactive visualization platform accompanying the AdaBind paper,
            benchmarking ligand-class-specific binding-residue prediction on TestSet300 and TestSetNew46
            against bindEmbed21DL and bindNode24.
          </p>
        </section>

        <section class="about-section">
          <h2>Research Context</h2>
          <p>
            This platform supports research on protein binding site prediction, providing tools for
            comparing different methods and analyzing their performance characteristics.
          </p>
        </section>

        <section class="about-section">
          <h2>Technology Stack</h2>
          <div class="tech-grid">
            <div class="tech-item">
              <span class="tech-name">Angular 22</span>
              <span class="tech-desc">Frontend Framework</span>
            </div>
            <div class="tech-item">
              <span class="tech-name">TypeScript 6</span>
              <span class="tech-desc">Programming Language</span>
            </div>
            <div class="tech-item">
              <span class="tech-name">Apache ECharts</span>
              <span class="tech-desc">Data Visualization</span>
            </div>
            <div class="tech-item">
              <span class="tech-name">SCSS</span>
              <span class="tech-desc">Styling</span>
            </div>
          </div>
        </section>

        <section class="about-section">
          <h2>Future Development</h2>
          <ul class="future-list">
            <li>Backend integration with FastAPI</li>
            <li>AdaBind multimodal inference (ESM-2 + ESMFold descriptors)</li>
            <li>3D protein structure visualization</li>
            <li>User authentication system</li>
            <li>Data export and reporting</li>
          </ul>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .about-page {
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
    }

    .page-header {
      margin-bottom: 3rem;
      text-align: center;
    }

    .page-title {
      font-size: 2rem;
      font-weight: 600;
      color: #F8FAFC;
      margin-bottom: 0.5rem;
    }

    .page-subtitle {
      color: #94A3B8;
      font-size: 1rem;
    }

    .about-content {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .about-section {
      background-color: rgba(26, 35, 50, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 12px;
      padding: 2rem;

      h2 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #F8FAFC;
        margin-bottom: 1rem;
      }

      p {
        color: #94A3B8;
        line-height: 1.7;
        margin: 0;
      }
    }

    .tech-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .tech-item {
      display: flex;
      flex-direction: column;
      padding: 1rem;
      background-color: #1E293B;
      border-radius: 8px;
    }

    .tech-name {
      font-weight: 600;
      color: #22D3EE;
      margin-bottom: 0.25rem;
    }

    .tech-desc {
      font-size: 0.8125rem;
      color: #64748B;
    }

    .future-list {
      list-style: none;
      padding: 0;
      margin: 0;

      li {
        color: #94A3B8;
        padding: 0.5rem 0;
        padding-left: 1.5rem;
        position: relative;

        &::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 6px;
          height: 6px;
          background-color: #22D3EE;
          border-radius: 50%;
        }
      }
    }
  `]
})
export class AboutComponent {}
