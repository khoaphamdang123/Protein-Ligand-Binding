export class FormatUtils {
  static formatPercent(value: number, decimals: number = 1): string {
    return `${(value * 100).toFixed(decimals)}%`;
  }

  static formatNumber(value: number, decimals: number = 2): string {
    return value.toFixed(decimals);
  }

  static formatDecimal(value: number, decimals: number = 3): string {
    return value.toFixed(decimals);
  }

  static formatSequence(sequence: string, chunkSize: number = 60): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < sequence.length; i += chunkSize) {
      chunks.push(sequence.substring(i, i + chunkSize));
    }
    return chunks;
  }

  static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  static formatPDBId(pdbId: string): string {
    return pdbId.toUpperCase();
  }
}
