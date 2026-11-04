import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  icon: string;
  label: string;
  route: string;
  badge?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar" [class.collapsed]="collapsed()">
      <div class="sidebar-header">
        @if (!collapsed()) {
          <span class="sidebar-title">Navigation</span>
        }
        <button class="collapse-btn" (click)="toggleCollapse()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            @if (collapsed()) {
              <path d="m9 18 6-6-6-6"/>
            } @else {
              <path d="m15 18-6-6 6-6"/>
            }
          </svg>
        </button>
      </div>

      <nav class="sidebar-nav">
        @for (item of navItems; track item.route) {
          <a 
            [routerLink]="item.route" 
            routerLinkActive="active"
            class="nav-item"
            [title]="collapsed() ? item.label : ''"
          >
            <span class="nav-icon" [innerHTML]="item.icon"></span>
            @if (!collapsed()) {
              <span class="nav-label">{{ item.label }}</span>
              @if (item.badge) {
                <span class="nav-badge">{{ item.badge }}</span>
              }
            }
          </a>
        }
      </nav>

      <div class="sidebar-footer">
        @if (!collapsed()) {
          <div class="version-info">
            <span class="version-label">Version</span>
            <span class="version-number">1.0.0</span>
          </div>
        }
      </div>
    </aside>
  `,
  styles: [`
    .sidebar {
      width: 240px;
      background-color: #1E293B;
      border-right: 1px solid rgba(148, 163, 184, 0.12);
      display: flex;
      flex-direction: column;
      transition: width 0.2s ease;

      &.collapsed {
        width: 64px;
      }
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);
      min-height: 56px;
    }

    .sidebar-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .collapse-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: #64748B;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background-color: rgba(148, 163, 184, 0.08);
        color: #CBD5E1;
      }
    }

    .sidebar-nav {
      flex: 1;
      padding: 0.5rem;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      color: #94A3B8;
      text-decoration: none;
      border-radius: 8px;
      transition: all 0.15s ease;
      margin-bottom: 0.25rem;

      &:hover {
        background-color: rgba(148, 163, 184, 0.08);
        color: #CBD5E1;
      }

      &.active {
        background-color: rgba(34, 211, 238, 0.1);
        color: #22D3EE;
      }
    }

    .nav-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex-shrink: 0;

      :host ::ng-deep svg {
        width: 20px;
        height: 20px;
      }
    }

    .nav-label {
      font-size: 0.875rem;
      font-weight: 500;
      flex: 1;
    }

    .nav-badge {
      padding: 0.125rem 0.5rem;
      font-size: 0.6875rem;
      font-weight: 600;
      background-color: rgba(34, 211, 238, 0.15);
      color: #22D3EE;
      border-radius: 10px;
    }

    .sidebar-footer {
      padding: 1rem;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
    }

    .version-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .version-label {
      font-size: 0.75rem;
      color: #64748B;
    }

    .version-number {
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      color: #94A3B8;
    }

    :host ::ng-deep .sidebar.collapsed .nav-item {
      justify-content: center;
      padding: 0.75rem;
    }
  `]
})
export class SidebarComponent {
  collapsed = signal(false);

  navItems: NavItem[] = [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
      label: 'Home',
      route: '/'
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
      label: 'Explore',
      route: '/explore'
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
      label: 'Benchmark',
      route: '/benchmark',
      badge: 'New'
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
      label: 'About',
      route: '/about'
    }
  ];

  toggleCollapse(): void {
    this.collapsed.set(!this.collapsed());
  }
}
