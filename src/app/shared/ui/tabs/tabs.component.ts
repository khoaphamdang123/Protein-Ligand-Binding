import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Tab {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tabs">
      <div class="tabs-list" role="tablist">
        @for (tab of tabs; track tab.id) {
          <button
            [class]="'tab-trigger' + (activeTab() === tab.id ? ' tab-trigger-active' : '') + (tab.disabled ? ' tab-trigger-disabled' : '')"
            [disabled]="tab.disabled"
            role="tab"
            [attr.aria-selected]="activeTab() === tab.id"
            (click)="selectTab(tab.id)"
          >
            @if (tab.icon) {
              <span class="tab-icon" [innerHTML]="tab.icon"></span>
            }
            {{ tab.label }}
          </button>
        }
      </div>
      <div class="tabs-content">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [`
    .tabs {
      display: flex;
      flex-direction: column;
    }

    .tabs-list {
      display: flex;
      gap: var(--space-1);
      border-bottom: 1px solid var(--color-border-primary);
      padding: 0 var(--space-2);
    }

    .tab-trigger {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      font-family: var(--font-sans);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: all var(--transition-fast);

      &:hover:not(.tab-trigger-disabled) {
        color: var(--color-text-primary);
        background-color: var(--color-bg-hover);
      }

      &.tab-trigger-active {
        color: var(--color-primary);
        border-bottom-color: var(--color-primary);
      }

      &.tab-trigger-disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &:focus-visible {
        outline: 2px solid var(--color-border-focus);
        outline-offset: -2px;
      }
    }

    .tab-icon {
      display: inline-flex;
      align-items: center;
      
      ::ng-deep svg {
        width: 16px;
        height: 16px;
      }
    }

    .tabs-content {
      padding: var(--space-5);
    }
  `]
})
export class TabsComponent {
  @Input() tabs: Tab[] = [];
  @Input() defaultTab?: string;
  
  activeTab = signal<string>('');

  ngOnInit(): void {
    if (this.defaultTab) {
      this.activeTab.set(this.defaultTab);
    } else if (this.tabs.length > 0) {
      this.activeTab.set(this.tabs[0].id);
    }
  }

  selectTab(tabId: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && !tab.disabled) {
      this.activeTab.set(tabId);
    }
  }
}
