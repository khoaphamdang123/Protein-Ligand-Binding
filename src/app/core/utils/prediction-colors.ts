import { BindingType } from '../models/prediction.model';
import { ResidueStatus } from '../models/explore.model';

/**
 * Colours shared by the 3D viewer, the sequence track and their legends.
 */

const PROBABILITY_STOPS: [number, string][] = [
  [0.0, '#94A3B8'],
  [0.5, '#FBBF24'],
  [1.0, '#EF4444'],
];

/** Confusion-matrix colours (TP/FP/FN/TN) used by the 3D viewer and legend. */
export const STATUS_COLORS: Record<ResidueStatus, string> = {
  TP: '#10B981',
  FP: '#F97316',
  FN: '#EF4444',
  TN: '#64748B',
};

export const STATUS_LABELS: Record<ResidueStatus, string> = {
  TP: 'True Positive',
  FP: 'False Positive',
  FN: 'False Negative',
  TN: 'True Negative',
};

/** Ligand-class colours: the paper evaluates three branches (metal / nucleic / small). */
export const LIGAND_CLASS_COLORS: Record<BindingType, string> = {
  metal: '#22D3EE',
  nuclear: '#A78BFA',
  small: '#F59E0B',
};

export function statusColor(status: ResidueStatus): string {
  return STATUS_COLORS[status];
}

export function ligandClassColor(bindingType: BindingType): string {
  return LIGAND_CLASS_COLORS[bindingType];
}

/** pLDDT bands as used by AlphaFold/ESMFold viewers (pLDDT on a 0-1 scale). */
export const PLDDT_BANDS: { min: number; color: string; label: string }[] = [
  { min: 0.9, color: '#0053D6', label: 'Very high (> 0.9)' },
  { min: 0.7, color: '#65CBF3', label: 'Confident (0.7-0.9)' },
  { min: 0.5, color: '#FFDB13', label: 'Low (0.5-0.7)' },
  { min: 0, color: '#FF7D45', label: 'Very low (< 0.5)' },
];

/** Below this pLDDT the structure, and structure-based predictions, are less reliable (guide section 6). */
export const LOW_PLDDT = 0.7;

export function probabilityColor(p: number): string {
  const value = Math.min(1, Math.max(0, p));
  for (let i = 1; i < PROBABILITY_STOPS.length; i++) {
    const [x1, c1] = PROBABILITY_STOPS[i];
    if (value <= x1) {
      const [x0, c0] = PROBABILITY_STOPS[i - 1];
      return mixHex(c0, c1, (value - x0) / (x1 - x0));
    }
  }
  return PROBABILITY_STOPS[PROBABILITY_STOPS.length - 1][1];
}

export function plddtColor(plddt: number): string {
  return (PLDDT_BANDS.find(band => plddt > band.min) ?? PLDDT_BANDS[PLDDT_BANDS.length - 1]).color;
}

export function probabilityGradientCss(): string {
  return `linear-gradient(90deg, ${PROBABILITY_STOPS.map(([x, c]) => `${c} ${x * 100}%`).join(', ')})`;
}

export function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

function mixHex(a: string, b: string, t: number): string {
  const ca = hexToInt(a);
  const cb = hexToInt(b);
  const channel = (shift: number) =>
    Math.round(((ca >> shift) & 0xff) * (1 - t) + ((cb >> shift) & 0xff) * t);
  return '#' + [16, 8, 0].map(s => channel(s).toString(16).padStart(2, '0')).join('');
}
