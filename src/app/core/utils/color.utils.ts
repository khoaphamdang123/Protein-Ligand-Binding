export class ColorUtils {
  // Amino acid color scheme for sequence visualization
  static readonly AMINO_ACID_COLORS: Record<string, string> = {
    'A': '#82C91E', // Hydrophobic - Green
    'V': '#82C91E',
    'I': '#82C91E',
    'L': '#82C91E',
    'M': '#82C91E',
    'F': '#F59F00', // Aromatic - Orange
    'W': '#F59F00',
    'Y': '#F59F00',
    'S': '#22D3EE', // Polar - Cyan
    'T': '#22D3EE',
    'N': '#22D3EE',
    'Q': '#22D3EE',
    'D': '#EF4444', // Acidic - Red
    'E': '#EF4444',
    'K': '#3B82F6', // Basic - Blue
    'R': '#3B82F6',
    'H': '#3B82F6',
    'C': '#FACC15', // Sulfur - Yellow
    'G': '#94A3B8', // Special - Gray
    'P': '#94A3B8'
  };

  // Method color scheme
  static readonly METHOD_COLORS: Record<string, string> = {
    'AdaBind': '#22D3EE',
    'bindEmbed21DL': '#10B981',
    'bindNode24': '#38BDF8'
  };

  // Metric color based on threshold
  static getMetricColor(value: number, thresholds: { good: number; medium: number } = { good: 0.8, medium: 0.6 }): string {
    if (value >= thresholds.good) return '#10B981'; // Green - Good
    if (value >= thresholds.medium) return '#F59E0B'; // Yellow - Medium
    return '#EF4444'; // Red - Poor
  }

  static getBindingSiteColor(confidence: number): string {
    if (confidence >= 0.85) return '#10B981'; // High
    if (confidence >= 0.70) return '#F59E0B'; // Medium
    return '#EF4444'; // Low
  }

  static rgba(color: string, opacity: number): string {
    return `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
  }
}
