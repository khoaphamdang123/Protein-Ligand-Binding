import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExplorerStateService } from '../../core/state/explorer.state';
import { MockDataService } from '../../core/services/mock-data.service';
import { PredictionMethod } from '../../core/models/method.model';
import { ProteinViewerComponent } from '../../molecular/protein-viewer/protein-viewer.component';
import { SequenceViewerComponent } from '../../molecular/sequence-viewer/sequence-viewer.component';

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ProteinViewerComponent,
    SequenceViewerComponent
  ],
  templateUrl: './explorer.component.html',
  styleUrl: './explorer.component.scss'
})
export class ExplorerComponent implements OnInit {
  private explorerState = inject(ExplorerStateService);
  private mockDataService = inject(MockDataService);

  // Expose state signals
  currentProtein = this.explorerState.currentProtein;
  currentPrediction = this.explorerState.currentPrediction;
  selectedResidue = this.explorerState.selectedResidue;
  filters = this.explorerState.filters;
  residues = this.explorerState.residues;

  // Available proteins for search
  proteins = this.mockDataService.proteins;
  
  // Search and filter states
  searchQuery = '';
  showSearchResults = false;
  filteredProteins = this.proteins();

  // Dataset options
  datasetOptions = [
    { value: 'all', label: 'All Datasets' },
    { value: 'testset300', label: 'TestSet300' },
    { value: 'testset46', label: 'TestSet46' }
  ];

  // Method options
  methodOptions = [
    { value: 'ESM-ORION' as const, label: 'ESM-ORION' },
    { value: 'BindNode24' as const, label: 'BindNode24' },
    { value: 'bindEmbed21DL' as const, label: 'bindEmbed21DL' },
    { value: 'P2Rank' as const, label: 'P2Rank' }
  ];

  // Get current method as PredictionMethod type
  get currentMethod(): PredictionMethod {
    const method = this.filters().method;
    return method === 'all' ? 'ESM-ORION' : method;
  }

  // Binding type options
  bindingTypeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'metal', label: 'Metal' },
    { value: 'nucleic-acid', label: 'Nucleic Acid' },
    { value: 'small-molecule', label: 'Small Molecule' },
    { value: 'other', label: 'Other' }
  ];

  // Mock metrics
  metrics = {
    f1: 0.847,
    mcc: 0.782,
    precision: 0.891,
    recall: 0.806
  };

  ngOnInit(): void {
    // Load first protein by default
    const firstProtein = this.proteins()[0];
    if (firstProtein) {
      this.loadProtein(firstProtein.id);
    }
  }

  onSearchInput(query: string): void {
    this.searchQuery = query;
    this.showSearchResults = query.length > 0;
    
    if (query.length > 0) {
      const lowerQuery = query.toLowerCase();
      this.filteredProteins = this.proteins().filter(p =>
        p.id.toLowerCase().includes(lowerQuery) ||
        p.name.toLowerCase().includes(lowerQuery) ||
        p.pdbId.toLowerCase().includes(lowerQuery)
      );
    } else {
      this.filteredProteins = this.proteins();
    }
  }

  selectProtein(proteinId: string): void {
    this.loadProtein(proteinId);
    this.searchQuery = '';
    this.showSearchResults = false;
  }

  loadProtein(proteinId: string): void {
    const protein = this.proteins().find(p => p.id === proteinId);
    if (protein) {
      this.explorerState.setCurrentProtein(protein);
      
      // Load prediction for current method
      const method = this.filters().method;
      const predictions = this.mockDataService.getPredictions();
      const prediction = predictions.find(
        (p: any) => p.proteinId === proteinId && p.method === method
      );
      this.explorerState.setCurrentPrediction(prediction || null);
    }
  }

  onFilterChange(): void {
    const filters = this.filters();
    this.explorerState.updateFilters(filters);
    
    // Reload prediction with new method
    const currentProtein = this.currentProtein();
    if (currentProtein) {
      const predictions = this.mockDataService.getPredictions();
      const prediction = predictions.find(
        (p: any) => p.proteinId === currentProtein.id && p.method === filters.method
      );
      this.explorerState.setCurrentPrediction(prediction || null);
    }
  }

  resetFilters(): void {
    this.explorerState.resetFilters();
    this.onFilterChange();
  }

  onResidueSelect(position: number): void {
    this.explorerState.selectResidueByPosition(position);
  }
}
