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
  testset46: Dataset | null = null;

  methods = [
    { 
      id: 'ESM-ORION', 
      name: 'ESM-ORION', 
      color: '#22D3EE', 
      description: 'Transformer-based protein language model for binding site prediction' 
    },
    { 
      id: 'BindNode24', 
      name: 'BindNode24', 
      color: '#38BDF8', 
      description: 'Graph neural network approach for binding site prediction' 
    },
    { 
      id: 'bindEmbed21DL', 
      name: 'bindEmbed21DL', 
      color: '#10B981', 
      description: 'Deep learning embedding-based binding site prediction' 
    },
    { 
      id: 'P2Rank', 
      name: 'P2Rank', 
      color: '#F97316', 
      description: 'Machine learning based ligandability prediction' 
    }
  ];

  ngOnInit(): void {
    this.mockDataService.getDatasets().subscribe(datasets => {
      this.testset300 = datasets.find(d => d.id === 'testset300') || null;
      this.testset46 = datasets.find(d => d.id === 'testset46') || null;
    });
  }
}
