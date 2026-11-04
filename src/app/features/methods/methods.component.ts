import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

type MethodCategory = 'protein-language-model' | 'geometry-based' | 'deep-learning' | 'machine-learning';
type BindingSiteTask = 'binding-site-prediction' | 'pocket-detection' | 'ligandability-prediction';

interface MethodMetrics {
  f1: number;
  mcc: number;
  precision: number;
  recall: number;
}

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
    testset300: MethodMetrics;
    testsetnew46?: MethodMetrics;
    testsetnew46Label?: string;
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

  // Methods data (from the AdaBind paper, 2026)
  methods: MethodInfo[] = [
    {
      id: 'ada-bind',
      name: 'AdaBind',
      shortName: 'AdaBind',
      category: 'protein-language-model',
      categoryLabel: 'Protein Language Model',
      task: 'binding-site-prediction',
      taskLabel: 'Ligand-Class Binding Site Prediction',
      description:
        'Ligand-class-specific multimodal representations that couple ESM-2 embeddings with coordination, patch and pocket descriptors, with separate predictors for metal, nucleic-acid and small-molecule binding.',
      overview: `AdaBind predicts ligand-binding residues by coupling protein language model (ESM-2) embeddings with multimodal, ligand-class-specific representations. It trains three separate predictors for metal ions, nucleic acids and small molecules, because each ligand class imposes distinct chemical and spatial constraints.

Metal coordination relies on donor chemistry (Cys/His/Asp/Glu) and coordination-compatible environments. Nucleic-acid recognition is mediated by cationic Arg/Lys surface patches. Small-molecule binding is framed as candidate pocket neighborhoods. On homology-filtered benchmarks (<20% sequence identity), AdaBind reaches metal-binding F1 of 45.8% on TestSet300 and 70.7% on the external TestSetNew46, with competitive small-molecule performance.`,
      architecture: `ESM-2 backbone (esm2_t33_650M_UR50D, 1,280-dim per-residue embeddings averaged over the last two layers) + ESMFold-predicted structures.

Three ligand-class branches (final selected residue blocks):
• Metal — ESM1280 + ATOM15 + CHEM24 + MULTI2 (1,377 dims)
• Nucleic acid — ESM1280 + ACCESS10 + NA_PATCH3D40 + NA_TOPO12 (1,342 dims)
• Small molecule — ESM1280 + ACCESS10 + SM_POCKET3D44 + SM_TOPO16 (1,350 dims)

The nucleic-acid and small-molecule encoders use six-head modality self-attention and hypergraph message passing over candidate patches/pockets (V1 + multiscale ensembles: 0.70/0.30 for nucleic acid, 0.60/0.40 for small molecule).

Locked out-of-fold decision thresholds: metal 0.9389, nucleic-acid 0.7357, small-molecule 0.5133.`,
      input: {
        title: 'Protein sequences + predicted structures',
        description:
          'Amino-acid sequences (FASTA) and ESMFold-predicted structures. No query ligand or experimentally solved structure is required.',
        formats: ['FASTA', 'PDB (ESMFold)', 'mmCIF']
      },
      output: {
        title: 'Per-residue binding scores',
        description:
          'Per-residue binding probability scores for metal, nucleic-acid and small-molecule binding, with thresholded predictions and confusion-matrix status.',
        format: 'JSON / CSV / per-residue scores'
      },
      metrics: {
        testset300: { f1: 0.4611, mcc: 0.4127, precision: 0.470, recall: 0.453 },
        testsetnew46: { f1: 0.7068, mcc: 0.7128, precision: 0.68, recall: 0.736 },
        testsetnew46Label: 'Metal-binding (external)'
      },
      references: [
        {
          title: 'AdaBind: Ligand-class-specific multimodal representations improve protein binding residue prediction (2026)',
          url: '#'
        },
        { title: 'BindSite Explorer (Hugging Face Space)', url: 'https://huggingface.co/spaces/Quangg/Protein-Ligand-Binding' }
      ],
      color: '#22D3EE',
      icon: 'transformer'
    },
    {
      id: 'bindembed21dl',
      name: 'bindEmbed21DL',
      shortName: 'bindEmbed21DL',
      category: 'deep-learning',
      categoryLabel: 'Deep Learning',
      task: 'binding-site-prediction',
      taskLabel: 'Binding Site Prediction',
      description:
        'Per-residue ProtT5 embeddings combined with a shallow convolutional network to predict binding residues across metal, nucleic-acid and small-molecule classes.',
      overview: `bindEmbed21DL showed that per-residue embeddings from the ProtT5 protein language model, combined with a shallow convolutional network, can predict binding residues across three ligand classes. It established sequence embeddings as a competitive default representation for binding-residue prediction.

On the AdaBind benchmark (any-ligand, TestSet300), bindEmbed21DL achieves a residue-global F1 of 43.0% and MCC of 41.0%.`,
      architecture: `• ProtT5 per-residue embeddings
• Shallow convolutional network
• Residue-level binary classification across metal, nucleic-acid and small-molecule labels`,
      input: {
        title: 'Protein sequences',
        description: 'Amino-acid sequences processed into ProtT5 per-residue embeddings.',
        formats: ['FASTA']
      },
      output: {
        title: 'Binding site predictions',
        description: 'Per-residue binding probability scores and predicted binding regions.',
        format: 'JSON / CSV'
      },
      metrics: {
        testset300: { f1: 0.43, mcc: 0.41, precision: 0.45, recall: 0.412 }
      },
      references: [
        {
          title: 'Protein embeddings and deep learning predict binding residues for various ligand classes (Sci Rep 2021)',
          url: 'https://doi.org/10.1038/s41598-021-03431-4'
        }
      ],
      color: '#10B981',
      icon: 'neural'
    },
    {
      id: 'bindnode24',
      name: 'bindNode24',
      shortName: 'bindNode24',
      category: 'geometry-based',
      categoryLabel: 'Geometry-Based',
      task: 'binding-site-prediction',
      taskLabel: 'Binding Site Prediction',
      description:
        'A graph neural network that incorporates structural proximity for competitive binding-residue prediction with a substantially smaller model.',
      overview: `bindNode24 extends sequence-embedding approaches by incorporating structural proximity through a graph neural network, achieving competitive accuracy with a substantially smaller model (~60% smaller).

On the AdaBind benchmark (any-ligand, TestSet300), bindNode24 achieves a residue-global F1 of 44.0% and MCC of 42.0%.`,
      architecture: `• Residue graph construction from protein structure
• Graph neural network encoding spatial context
• Binding-residue classification head`,
      input: {
        title: 'Protein sequences and structures',
        description: 'Amino-acid sequences with structural proximity encoded as residue graphs.',
        formats: ['PDB', 'mmCIF']
      },
      output: {
        title: 'Binding site predictions',
        description: 'Per-residue binding probability scores and predicted binding residues.',
        format: 'JSON / CSV'
      },
      metrics: {
        testset300: { f1: 0.44, mcc: 0.42, precision: 0.46, recall: 0.422 }
      },
      references: [
        {
          title: 'bindNode24: Competitive binding residue prediction with 60% smaller model (CSBJ 2025)',
          url: 'https://doi.org/10.1016/j.csbj.2025.02.042'
        }
      ],
      color: '#38BDF8',
      icon: 'geometry'
    }
  ];

  // Computed: filtered methods
  filteredMethods = computed(() => {
    let filtered = this.methods;

    // Search filter
    const query = this.searchQuery().toLowerCase();
    if (query) {
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.categoryLabel.toLowerCase().includes(query)
      );
    }

    // Category filter
    const category = this.selectedCategory();
    if (category !== 'all') {
      filtered = filtered.filter((m) => m.category === category);
    }

    return filtered;
  });

  // Categories for filter
  categories = [
    { value: 'all', label: 'All Categories' },
    { value: 'protein-language-model', label: 'Protein Language Model' },
    { value: 'geometry-based', label: 'Geometry-Based' },
    { value: 'deep-learning', label: 'Deep Learning' }
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
