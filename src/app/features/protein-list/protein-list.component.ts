import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../core/services/mock-data.service';
import { Protein } from '../../core/models/protein.model';

@Component({
  selector: 'app-protein-list',
  imports: [CommonModule, RouterLink],
  templateUrl: './protein-list.component.html',
  styleUrl: './protein-list.component.scss'
})
export class ProteinListComponent implements OnInit {
  private mockDataService = inject(MockDataService);

  proteins = signal<Protein[]>([]);
  loading = signal(true);
  searchQuery = signal('');
  
  filteredProteins = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.proteins();
    
    return this.proteins().filter(protein => 
      protein.name.toLowerCase().includes(query) ||
      protein.pdbId.toLowerCase().includes(query) ||
      protein.organism?.toLowerCase().includes(query)
    );
  });

  selectedDataset = this.mockDataService.selectedDataset;

  ngOnInit(): void {
    this.loadProteins();
  }

  loadProteins(): void {
    this.loading.set(true);
    this.mockDataService.getProteins(this.selectedDataset()).subscribe({
      next: (proteins) => {
        this.proteins.set(proteins);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading proteins:', err);
        this.loading.set(false);
      }
    });
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  getResolutionClass(resolution?: number): string {
    if (!resolution) return 'medium';
    if (resolution < 2.0) return 'high';
    if (resolution < 2.5) return 'medium';
    return 'low';
  }
}
