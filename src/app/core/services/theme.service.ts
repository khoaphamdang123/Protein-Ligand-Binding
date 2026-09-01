import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_STORAGE_KEY = 'bindsite-theme';
  
  // Current theme signal
  readonly theme = signal<Theme>(this.getInitialTheme());

  constructor() {
    // Apply theme on initialization
    this.applyTheme(this.theme());
    
    // Watch for theme changes and persist
    effect(() => {
      const currentTheme = this.theme();
      this.applyTheme(currentTheme);
      this.saveTheme(currentTheme);
    });
    
    // Listen for system theme changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      prefersDark.addEventListener('change', (e) => {
        if (!this.hasStoredTheme()) {
          this.setTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  /**
   * Toggle between light and dark theme
   */
  toggleTheme(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }

  /**
   * Set specific theme
   */
  setTheme(theme: Theme): void {
    this.theme.set(theme);
  }

  /**
   * Get initial theme from storage or system preference
   */
  private getInitialTheme(): Theme {
    const stored = this.getStoredTheme();
    if (stored) {
      return stored;
    }
    
    // Fall back to system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      return prefersDark.matches ? 'dark' : 'light';
    }
    
    // Default to dark theme
    return 'dark';
  }

  /**
   * Get theme from localStorage
   */
  private getStoredTheme(): Theme | null {
    try {
      const stored = localStorage.getItem(this.THEME_STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if theme is stored
   */
  private hasStoredTheme(): boolean {
    return this.getStoredTheme() !== null;
  }

  /**
   * Save theme to localStorage
   */
  private saveTheme(theme: Theme): void {
    try {
      localStorage.setItem(this.THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn('Failed to save theme preference:', error);
    }
  }

  /**
   * Apply theme to document
   */
  private applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update meta theme-color for mobile browsers
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0B1020' : '#FFFFFF');
    }
  }
}
