import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-viewer-controls',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="viewer-controls">
      <div class="control-group">
        <label class="control-label">Display</label>
        <div class="control-buttons">
          <button 
            class="control-btn" 
            [class.active]="displayMode === 'ball-stick'"
            (click)="setDisplayMode('ball-stick')"
          >
            Ball & Stick
          </button>
          <button 
            class="control-btn" 
            [class.active]="displayMode === 'surface'"
            (click)="setDisplayMode('surface')"
          >
            Surface
          </button>
          <button 
            class="control-btn" 
            [class.active]="displayMode === 'cartoon'"
            (click)="setDisplayMode('cartoon')"
          >
            Cartoon
          </button>
        </div>
      </div>

      <div class="control-group">
        <label class="control-label">Binding Sites</label>
        <div class="toggle-control">
          <input 
            type="checkbox" 
            id="showBinding" 
            [checked]="showBindingSites"
            (change)="toggleBindingSites()"
          />
          <label for="showBinding" class="toggle-label">Show binding sites</label>
        </div>
      </div>

      <div class="control-group">
        <label class="control-label">Labels</label>
        <div class="toggle-control">
          <input 
            type="checkbox" 
            id="showLabels" 
            [checked]="showLabels"
            (change)="toggleLabels()"
          />
          <label for="showLabels" class="toggle-label">Show residue labels</label>
        </div>
      </div>

      <div class="control-group">
        <label class="control-label">Actions</label>
        <div class="action-buttons">
          <button class="action-btn" (click)="onReset()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Reset View
          </button>
          <button class="action-btn" (click)="onCenter()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Center
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .viewer-controls {
      padding: 1rem;
      background-color: #1E293B;
      border-radius: 8px;
    }

    .control-group {
      margin-bottom: 1.25rem;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .control-label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .control-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .control-btn {
      flex: 1;
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: #94A3B8;
      background-color: #0F172A;
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background-color: #1E293B;
        color: #CBD5E1;
      }

      &.active {
        background-color: rgba(34, 211, 238, 0.15);
        border-color: rgba(34, 211, 238, 0.3);
        color: #22D3EE;
      }
    }

    .toggle-control {
      display: flex;
      align-items: center;
      gap: 0.75rem;

      input[type="checkbox"] {
        width: 18px;
        height: 18px;
        accent-color: #22D3EE;
        cursor: pointer;
      }
    }

    .toggle-label {
      font-size: 0.875rem;
      color: #CBD5E1;
      cursor: pointer;
    }

    .action-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .action-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: #94A3B8;
      background-color: #0F172A;
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background-color: #1E293B;
        color: #CBD5E1;
        border-color: rgba(148, 163, 184, 0.2);
      }

      svg {
        flex-shrink: 0;
      }
    }
  `]
})
export class ViewerControlsComponent {
  @Input() displayMode: 'ball-stick' | 'surface' | 'cartoon' = 'ball-stick';
  @Input() showBindingSites: boolean = true;
  @Input() showLabels: boolean = false;
  @Output() displayModeChange = new EventEmitter<'ball-stick' | 'surface' | 'cartoon'>();
  @Output() showBindingSitesChange = new EventEmitter<boolean>();
  @Output() showLabelsChange = new EventEmitter<boolean>();
  @Output() reset = new EventEmitter<void>();
  @Output() center = new EventEmitter<void>();

  setDisplayMode(mode: 'ball-stick' | 'surface' | 'cartoon'): void {
    this.displayMode = mode;
    this.displayModeChange.emit(mode);
  }

  toggleBindingSites(): void {
    this.showBindingSites = !this.showBindingSites;
    this.showBindingSitesChange.emit(this.showBindingSites);
  }

  toggleLabels(): void {
    this.showLabels = !this.showLabels;
    this.showLabelsChange.emit(this.showLabels);
  }

  onReset(): void {
    this.reset.emit();
  }

  onCenter(): void {
    this.center.emit();
  }
}
