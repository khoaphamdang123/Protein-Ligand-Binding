import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent {
  private themeService = inject(ThemeService);
  
  theme = this.themeService.theme;
  mobileMenuOpen = signal(false);
  searchOpen = signal(false);

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.set(!this.mobileMenuOpen());
    if (this.mobileMenuOpen()) {
      this.searchOpen.set(false);
    }
  }

  toggleSearch(): void {
    this.searchOpen.set(!this.searchOpen());
    if (this.searchOpen()) {
      this.mobileMenuOpen.set(false);
    }
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
