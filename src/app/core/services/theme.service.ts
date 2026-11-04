import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  // Bump the key so users who previously inherited a light system preference
  // get the requested dark default once; manual choices after that persist.
  private readonly THEME_STORAGE_KEY = 'bindsite-theme-v2';
  
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
   * Default to dark unless the user has explicitly chosen a theme.
   */
  private getInitialTheme(): Theme {
    const stored = this.getStoredTheme();
    return stored ?? 'dark';
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
