import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MockDataService } from '../../../core/services/mock-data.service';
import { Dataset } from '../../../core/models/dataset.model';

@Component({
  selector: 'app-benchmark-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './benchmark-list.component.html',
  styleUrl: './benchmark-list.component.scss'
})
export class BenchmarkListComponent implements OnInit {
  private mockDataService = inject(MockDataService);

  testset300: Dataset | null = null;
  testsetnew46: Dataset | null = null;

  methods = [
    { 
      id: 'AdaBind', 
      name: 'AdaBind', 
      color: '#22D3EE', 
      description: 'Ligand-class-specific multimodal representations (ESM-2 + coordination/pocket descriptors)' 
    },
    { 
      id: 'bindEmbed21DL', 
      name: 'bindEmbed21DL', 
      color: '#10B981', 
      description: 'ProtT5 embeddings with a shallow convolutional network' 
    },
    { 
      id: 'bindNode24', 
      name: 'bindNode24', 
      color: '#38BDF8', 
      description: 'Graph neural network incorporating structural proximity' 
    }
  ];

  ngOnInit(): void {
    this.mockDataService.getDatasets().subscribe(datasets => {
      this.testset300 = datasets.find(d => d.id === 'testset300') || null;
      this.testsetnew46 = datasets.find(d => d.id === 'testsetnew46') || null;
    });
  }
}
