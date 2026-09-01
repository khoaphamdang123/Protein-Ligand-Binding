import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface DataTableColumn<T = any> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (row: T) => string;
}

export type SortDirection = 'asc' | 'desc' | null;

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="data-table-wrapper">
      <table class="data-table">
        <thead class="data-table-head">
          <tr>
            @for (column of columns; track column.key) {
              <th 
                [class]="'data-table-header data-table-align-' + (column.align || 'left')"
                [style.width]="column.width"
                [class.sortable]="column.sortable"
                (click)="column.sortable && handleSort(column.key)"
              >
                <div class="header-content">
                  <span>{{ column.label }}</span>
                  @if (column.sortable) {
                    <span class="sort-icon">
                      @if (sortColumn === column.key && sortDirection === 'asc') {
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="m18 15-6-6-6 6"/>
                        </svg>
                      } @else if (sortColumn === column.key && sortDirection === 'desc') {
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="m6 9 6 6 6-6"/>
                        </svg>
                      } @else {
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>
                        </svg>
                      }
                    </span>
                  }
                </div>
              </th>
            }
          </tr>
        </thead>
        <tbody class="data-table-body">
          @if (data.length === 0) {
            <tr>
              <td [attr.colspan]="columns.length" class="data-table-empty">
                <div class="empty-state">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M16 16s-1.5-2-4-2-4 2-4 2M9 9h.01M15 9h.01"/>
                  </svg>
                  <p>{{ emptyMessage }}</p>
                </div>
              </td>
            </tr>
          } @else {
            @for (row of data; track getRowKey(row); let i = $index) {
              <tr class="data-table-row" (click)="rowClick.emit(row)">
                @for (column of columns; track column.key) {
                  <td [class]="'data-table-cell data-table-align-' + (column.align || 'left')">
                    @if (column.render) {
                      <span [innerHTML]="column.render(row)"></span>
                    } @else {
                      {{ getCellValue(row, column.key) }}
                    }
                  </td>
                }
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .data-table-wrapper {
      width: 100%;
      overflow-x: auto;
      border: 1px solid var(--color-border-primary);
      border-radius: var(--radius-md);
      background-color: var(--color-bg-panel);
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-sm);
    }

    .data-table-head {
      background-color: var(--color-bg-secondary);
      border-bottom: 1px solid var(--color-border-primary);
    }

    .data-table-header {
      padding: var(--space-3) var(--space-4);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      font-size: var(--font-size-xs);
      letter-spacing: var(--letter-spacing-wide);
      white-space: nowrap;

      &.sortable {
        cursor: pointer;
        user-select: none;
        transition: color var(--transition-fast);

        &:hover {
          color: var(--color-text-primary);
        }
      }
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .sort-icon {
      display: inline-flex;
      align-items: center;
      color: var(--color-text-tertiary);

      svg {
        width: 14px;
        height: 14px;
      }
    }

    .data-table-align-left {
      text-align: left;
      justify-content: flex-start;
    }

    .data-table-align-center {
      text-align: center;
      justify-content: center;
    }

    .data-table-align-right {
      text-align: right;
      justify-content: flex-end;
    }

    .data-table-body {
      .data-table-row {
        border-bottom: 1px solid var(--color-border-primary);
        transition: background-color var(--transition-fast);
        cursor: pointer;

        &:hover {
          background-color: var(--color-bg-hover);
        }

        &:last-child {
          border-bottom: none;
        }
      }
    }

    .data-table-cell {
      padding: var(--space-4);
      color: var(--color-text-primary);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
    }

    .data-table-empty {
      padding: var(--space-10) var(--space-4);
      text-align: center;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      color: var(--color-text-tertiary);

      svg {
        width: 48px;
        height: 48px;
        opacity: 0.5;
      }

      p {
        margin: 0;
        font-size: var(--font-size-sm);
      }
    }
  `]
})
export class DataTableComponent<T = any> {
  @Input() columns: DataTableColumn<T>[] = [];
  @Input() data: T[] = [];
  @Input() rowKey?: string;
  @Input() emptyMessage: string = 'No data available';
  
  @Output() rowClick = new EventEmitter<T>();
  @Output() sort = new EventEmitter<{ column: string; direction: SortDirection }>();

  sortColumn: string | null = null;
  sortDirection: SortDirection = null;

  getRowKey(row: T): any {
    if (this.rowKey) {
      return (row as any)[this.rowKey];
    }
    return (row as any)['id'] ?? JSON.stringify(row);
  }

  getCellValue(row: T, key: string): any {
    return (row as any)[key];
  }

  handleSort(column: string): void {
    if (this.sortColumn === column) {
      // Cycle through: asc -> desc -> null
      if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else if (this.sortDirection === 'desc') {
        this.sortDirection = null;
        this.sortColumn = null;
      } else {
        this.sortDirection = 'asc';
      }
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }

    this.sort.emit({ column: this.sortColumn || '', direction: this.sortDirection });
  }
}
