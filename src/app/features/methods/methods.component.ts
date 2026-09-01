import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

type MethodCategory = 'protein-language-model' | 'geometry-based' | 'deep-learning' | 'machine-learning';
type BindingSiteTask = 'binding-site-prediction' | 'pocket-detection' | 'ligandability-prediction';

interface MethodInfo {
  id: string;
  name: string;
  shortName: string;
  category: MethodCategory;
  categoryLabel: string;
  task: BindingSiteTask;
  taskLabel: string;
  description: string;
  overview: string;
  architecture: string;
  input: {
    title: string;
    description: string;
    formats: string[];
  };
  output: {
    title: string;
    description: string;
    format: string;
  };
  metrics: {
    testset300: { f1: number; mcc: number; precision: number; recall: number };
    testset46: { f1: number; mcc: number; precision: number; recall: number };
  };
  references: { title: string; url: string }[];
  color: string;
  icon: string;
}

@Component({
  selector: 'app-methods',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './methods.component.html',
  styleUrl: './methods.component.scss'
})
export class MethodsComponent {
  // Selected method for detail view
  selectedMethod = signal<MethodInfo | null>(null);
  
  // Search and filter
  searchQuery = signal('');
  selectedCategory = signal<MethodCategory | 'all'>('all');

  // Methods data
  methods: MethodInfo[] = [
    {
      id: 'esm-orion',
      name: 'ESM-ORION',
      shortName: 'ESM-ORION',
      category: 'protein-language-model',
      categoryLabel: 'Protein Language Model',
      task: 'binding-site-prediction',
      taskLabel: 'Binding Site Prediction',
      description: 'A transformer-based protein language model approach for binding site prediction using evolutionary scale modeling.',
      overview: `ESM-ORION leverages the power of large protein language models trained on evolutionary sequences to identify binding sites. The model utilizes attention mechanisms to capture residue-residue relationships across the entire protein structure.

This approach represents a paradigm shift in computational biology, moving from traditional feature engineering to learned representations that capture complex patterns in protein sequences.`,
      architecture: `The architecture consists of:
• ESM-2 protein language model backbone (650M parameters)
• Evolutionary representation learning
• Binding site prediction head
• Attention-based residue importance scoring

[Architecture diagram placeholder - pending real diagram]`,
      input: {
        title: 'Protein Sequences',
        description: 'Amino acid sequences in FASTA format or PDB structures for structure-aware predictions.',
        formats: ['FASTA', 'PDB', 'mmCIF']
      },
      output: {
        title: 'Binding Site Predictions',
        description: 'Per-residue binding probability scores and predicted binding site regions.',
        format: 'JSON / CSV / PyMOL script'
      },
      metrics: {
        testset300: { f1: 0.847, mcc: 0.782, precision: 0.891, recall: 0.806 },
        testset46: { f1: 0.823, mcc: 0.756, precision: 0.865, recall: 0.785 }
      },
      references: [
        { title: 'Original Paper (arXiv:2023)', url: '#' },
        { title: 'GitHub Repository', url: '#' },
        { title: 'Model Checkpoints', url: '#' }
      ],
      color: '#22D3EE',
      icon: 'transformer'
    },
    {
      id: 'bindnode24',
      name: 'BindNode24',
      shortName: 'BindNode24',
      category: 'deep-learning',
      categoryLabel: 'Deep Learning',
      task: 'binding-site-prediction',
      taskLabel: 'Binding Site Prediction',
      description: 'A graph neural network approach for protein binding site prediction using node-level features.',
      overview: `BindNode24 employs graph neural networks to model protein structures as graphs, where nodes represent residues and edges capture spatial relationships. The model learns to identify binding sites through graph convolution operations.

This approach leverages the power of graph-based representations to capture both local and global structural patterns that are critical for binding site identification.`,
      architecture: `The architecture consists of:
• Graph construction from protein structure
• Multi-layer graph convolutional network
• Node feature aggregation
• Binding site classification head

[Architecture diagram placeholder - pending real diagram]`,
      input: {
        title: 'Protein Structures',
        description: 'Three-dimensional protein structures for graph construction.',
        formats: ['PDB', 'mmCIF']
      },
      output: {
        title: 'Binding Site Predictions',
        description: 'Per-residue binding probability scores and predicted binding site regions.',
        format: 'JSON / CSV / PyMOL script'
      },
      metrics: {
        testset300: { f1: 0.723, mcc: 0.658, precision: 0.756, recall: 0.692 },
        testset46: { f1: 0.698, mcc: 0.625, precision: 0.732, recall: 0.667 }
      },
      references: [
        { title: 'BindNode24 Paper (2024)', url: '#' },
        { title: 'GitHub Repository', url: '#' }
      ],
      color: '#38BDF8',
      icon: 'geometry'
    },
    {
      id: 'bindembed21dl',
      name: 'bindEmbed21DL',
      shortName: 'bindEmbed21DL',
      category: 'deep-learning',
      categoryLabel: 'Deep Learning',
      task: 'binding-site-prediction',
      taskLabel: 'Binding Site Prediction',
      description: 'A deep learning approach using embedding representations for binding site prediction.',
      overview: `bindEmbed21DL uses learned embeddings to represent protein residues in a high-dimensional space where binding and non-binding residues are separable. The model combines sequence and structural embeddings for accurate predictions.

This method demonstrates the effectiveness of representation learning in capturing complex patterns that distinguish binding sites from other protein regions.`,
      architecture: `The network architecture includes:
• Protein sequence and structure encoding
• Multi-scale embedding layers
• Feature fusion network
• Binary classification head

[Network architecture diagram placeholder - pending real diagram]`,
      input: {
        title: 'Protein Sequences and Structures',
        description: 'Amino acid sequences and structural information for embedding generation.',
        formats: ['FASTA', 'PDB', 'mmCIF']
      },
      output: {
        title: 'Binding Site Predictions',
        description: 'Residue-level predictions with confidence scores.',
        format: 'JSON / CSV / PyMOL script'
      },
      metrics: {
        testset300: { f1: 0.801, mcc: 0.734, precision: 0.823, recall: 0.780 },
        testset46: { f1: 0.779, mcc: 0.708, precision: 0.801, recall: 0.758 }
      },
      references: [
        { title: 'bindEmbed21DL Paper (2021)', url: '#' },
        { title: 'GitHub Repository', url: '#' }
      ],
      color: '#10B981',
      icon: 'neural'
    },
    {
      id: 'p2rank',
      name: 'P2Rank',
      shortName: 'P2Rank',
      category: 'machine-learning',
      categoryLabel: 'Machine Learning',
      task: 'ligandability-prediction',
      taskLabel: 'Ligandability Prediction',
      description: 'A machine learning-based method for predicting ligand-binding sites using random forest classifiers.',
      overview: `P2Rank is a machine learning approach that predicts binding sites by analyzing physico-chemical properties of surface points. It uses a Random Forest classifier trained on engineered features derived from local surface geometry.

The method has shown strong performance in ligandability predictions and is widely used in drug discovery workflows.`,
      architecture: `The system architecture:
• Surface point sampling
• Feature extraction (geometric + chemical)
• Random Forest classifier
• Consensus scoring

[System architecture placeholder - pending real diagram]`,
      input: {
        title: 'Protein Structures',
        description: 'Protein structures for surface analysis and feature computation.',
        formats: ['PDB', 'mmCIF']
      },
      output: {
        title: 'Ranked Predictions',
        description: 'Ranked list of predicted binding sites with confidence scores.',
        format: 'CSV / JSON / Pymol script'
      },
      metrics: {
        testset300: { f1: 0.778, mcc: 0.701, precision: 0.795, recall: 0.762 },
        testset46: { f1: 0.752, mcc: 0.678, precision: 0.771, recall: 0.734 }
      },
      references: [
        { title: 'P2Rank Paper (Bioinformatics 2018)', url: '#' },
        { title: 'GitHub Repository', url: '#' },
        { title: 'Web Server', url: '#' }
      ],
      color: '#F97316',
      icon: 'ml'
    }
  ];

  // Computed: filtered methods
  filteredMethods = computed(() => {
    let filtered = this.methods;
    
    // Search filter
    const query = this.searchQuery().toLowerCase();
    if (query) {
      filtered = filtered.filter(m => 
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.categoryLabel.toLowerCase().includes(query)
      );
    }
    
    // Category filter
    const category = this.selectedCategory();
    if (category !== 'all') {
      filtered = filtered.filter(m => m.category === category);
    }
    
    return filtered;
  });

  // Categories for filter
  categories = [
    { value: 'all', label: 'All Categories' },
    { value: 'protein-language-model', label: 'Protein Language Model' },
    { value: 'geometry-based', label: 'Geometry-Based' },
    { value: 'deep-learning', label: 'Deep Learning' },
    { value: 'machine-learning', label: 'Machine Learning' }
  ];

  // Open method detail
  openMethodDetail(method: MethodInfo): void {
    this.selectedMethod.set(method);
  }

  // Close method detail
  closeMethodDetail(): void {
    this.selectedMethod.set(null);
  }

  // Get category icon
  getCategoryIcon(category: MethodCategory): string {
    const icons: Record<MethodCategory, string> = {
      'protein-language-model': 'transformer',
      'geometry-based': 'geometry',
      'deep-learning': 'neural',
      'machine-learning': 'ml'
    };
    return icons[category];
  }

  // Format metric
  formatMetric(value: number): string {
    return (value * 100).toFixed(1) + '%';
  }
}
