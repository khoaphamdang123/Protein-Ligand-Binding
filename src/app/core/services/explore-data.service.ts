import { Injectable, signal } from '@angular/core';
import { DatasetType } from '../models/dataset.model';
import { PredictionMethod } from '../models/method.model';
import { BindingType } from '../models/prediction.model';
import {
  ExploreMetrics,
  ExploreProtein,
  ExploreResidue,
  ExploreResult,
  ResidueStatus,
} from '../models/explore.model';

const AA = 'ARNDCQEGHILKMFPSTWYV';

const AA3: Record<string, string> = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY',
  H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER',
  T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL',
};

// A handful of real proteins used to give the mock entries realistic names
// (name, UniProt accession, representative PDB).
const REAL_PROTEINS: [string, string, string][] = [
  ['Cytochrome P450 2C9', 'P11712', '1OG2'],
  ['Carbonic anhydrase 2', 'P00918', '1CA2'],
  ['Serum albumin', 'P02768', '1AO6'],
  ['Lysozyme C', 'P00698', '1LYZ'],
  ['Myoglobin', 'P02144', '1MBN'],
  ['Hemoglobin subunit alpha', 'P69905', '1HHO'],
  ['Trypsin-1', 'P07477', '1TRN'],
  ['Thrombin', 'P00734', '1PPB'],
  ['HIV-1 protease', 'P04585', '1HPV'],
  ['Dihydrofolate reductase', 'P00374', '1DRF'],
  ['Glutathione S-transferase P', 'P09211', '1GSS'],
  ['Estrogen receptor', 'P03372', '1ERE'],
  ['Androgen receptor', 'P10275', '1E3G'],
  ['Cyclin-dependent kinase 2', 'P24941', '1HCL'],
  ['Mitogen-activated protein kinase 14', 'Q16539', '1OUY'],
  ['Acetylcholinesterase', 'P22303', '1ACJ'],
  ['Carboxypeptidase A1', 'P15085', '1CPA'],
  ['Ribonuclease A', 'P61823', '1RNU'],
  ['Chymotrypsinogen A', 'P00766', '1CHG'],
  ['Pepsin A', 'P00790', '1PSN'],
  ['Beta-lactamase', 'P62593', '1BTL'],
  ['Ras-related protein Rab-1A', 'P62820', '1RAB'],
  ['Transthyretin', 'P02766', '1TTA'],
  ['Retinol-binding protein 4', 'P02753', '1RBP'],
  ['Alpha-1-antitrypsin', 'P01009', '1QLP'],
  ['Superoxide dismutase [Cu-Zn]', 'P00441', '1SOS'],
  ['Catalase', 'P04040', '1CAG'],
  ['Alcohol dehydrogenase 1B', 'P00325', '1ADB'],
  ['Creatine kinase M-type', 'P06732', '1CRK'],
  ['Adenylate kinase 1', 'P00568', '1AKE'],
];

/** Deterministic PRNG so a protein + method always produces the same data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const normalize = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

@Injectable({ providedIn: 'root' })
export class ExploreDataService {
  private readonly all: ExploreProtein[] = this.generateProteins();
  readonly proteins = signal<ExploreProtein[]>(this.all);

  private generateProteins(): ExploreProtein[] {
    const proteins: ExploreProtein[] = [];
    const total = 300 + 46;

    for (let i = 0; i < total; i++) {
      const dataset: DatasetType = i < 300 ? 'TestSet300' : 'TestSetNew46';
      const real = REAL_PROTEINS[i % REAL_PROTEINS.length];
      const rand = mulberry32(hashCode(`protein:${i}`));
      const length = dataset === 'TestSet300' ? 150 + Math.floor(rand() * 250) : 100 + Math.floor(rand() * 120);
      const bindingType = this.pickBindingType(rand, i);

      proteins.push({
        id: dataset === 'TestSet300' ? `TS300_${String(i + 1).padStart(4, '0')}` : `TSN46_${String(i - 300 + 1).padStart(4, '0')}`,
        uniprotId: `${real[1]}-${i + 1}`,
        pdbId: this.generatePDBId(rand),
        name: i < REAL_PROTEINS.length ? real[0] : `${real[0]} homolog ${i % 7 + 1}`,
        length,
        sequence: this.generateSequence(length, mulberry32(hashCode(`seq:${i}`))),
        bindingType,
        dataset,
        source: 'ESMFold',
      });
    }
    return proteins;
  }

  private pickBindingType(rand: () => number, i: number): BindingType {
    const roll = rand();
    if (roll < 0.34) return 'metal';
    if (roll < 0.62) return 'nuclear';
    return 'small';
  }

  private generatePDBId(rand: () => number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(rand() * chars.length)]).join('');
  }

  private generateSequence(length: number, rand: () => number): string {
    return Array.from({ length }, () => AA[Math.floor(rand() * AA.length)]).join('');
  }

  /** Build the full per-residue dataset for a protein + method. */
  getResult(protein: ExploreProtein, method: PredictionMethod): ExploreResult {
    // Ground truth and pLDDT are properties of the structure/experiment, so they
    // must be identical across methods. Only the prediction changes with method.
    const gtRand = mulberry32(hashCode(`${protein.id}:gt`));
    const plddtRand = mulberry32(hashCode(`${protein.id}:plddt`));
    const predRand = mulberry32(hashCode(`${protein.id}:${method}`));
    const threshold = 0.5;

    const plddt = this.generatePlddt(protein.length, plddtRand);
    const groundTruth = this.generateGroundTruth(protein.length, protein.bindingType, gtRand);
    const probability = this.generateProbability(protein.length, groundTruth, predRand);
    const binding = probability.map(p => p >= threshold);
    const status = groundTruth.map((gt, i): ResidueStatus => {
      const pred = binding[i];
      if (gt && pred) return 'TP';
      if (!gt && pred) return 'FP';
      if (gt && !pred) return 'FN';
      return 'TN';
    });

    const residues: ExploreResidue[] = protein.sequence.split('').map((aa, i) => ({
      position: i + 1,
      aminoAcid: aa,
      probability: probability[i],
      predicted: binding[i],
      groundTruth: groundTruth[i],
      status: status[i],
      plddt: plddt[i],
    }));

    return {
      protein,
      method,
      threshold,
      probability,
      binding,
      groundTruth,
      status,
      plddt,
      pdb: this.generatePDB(protein.sequence, plddt, hashCode(`${protein.id}:fold`)),
      residues,
      metrics: this.computeMetrics(status),
    };
  }

  private generatePlddt(length: number, rand: () => number): number[] {
    const values = Array.from({ length }, () => 0.86 + rand() * 0.12);
    // A few low-confidence regions (ESMFold is less sure at termini and in flexible loops).
    const regions = 1 + Math.floor(rand() * 3);
    for (let r = 0; r < regions; r++) {
      const start = Math.floor(rand() * length);
      const size = 5 + Math.floor(rand() * 12);
      for (let i = start; i < Math.min(length, start + size); i++) {
        values[i] = 0.42 + rand() * 0.2;
      }
    }
    return values.map(v => Math.min(1, Math.max(0, v)));
  }

  private generateGroundTruth(length: number, bindingType: BindingType, rand: () => number): boolean[] {
    const gt = new Array<boolean>(length).fill(false);
    const clusterSize = (): number => {
      switch (bindingType) {
        case 'metal': return 3 + Math.floor(rand() * 4); // 3-6
        case 'nuclear': return 8 + Math.floor(rand() * 8); // 8-15
        case 'small': return 5 + Math.floor(rand() * 8); // 5-12
        default: return 5;
      }
    };
    const clusters = 1 + Math.floor(rand() * 3);
    for (let c = 0; c < clusters; c++) {
      const size = clusterSize();
      const start = Math.floor(rand() * (length - size));
      for (let i = start; i < start + size; i++) gt[i] = true;
    }
    return gt;
  }

  private generateProbability(length: number, groundTruth: boolean[], rand: () => number): number[] {
    return groundTruth.map(gt => {
      if (gt) return 0.45 + rand() * 0.5; // 0.45-0.95: mostly TP, a few FN below 0.5
      return rand() * 0.55; // 0-0.55: mostly TN, a few FP above 0.5
    });
  }

  private computeMetrics(status: ResidueStatus[]): ExploreMetrics {
    const tp = status.filter(s => s === 'TP').length;
    const fp = status.filter(s => s === 'FP').length;
    const tn = status.filter(s => s === 'TN').length;
    const fn = status.filter(s => s === 'FN').length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const denom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
    const mcc = denom > 0 ? (tp * tn - fp * fn) / denom : 0;
    const accuracy = tp + tn + fp + fn > 0 ? (tp + tn) / (tp + tn + fp + fn) : 0;
    return { precision, recall, f1, mcc, accuracy, tp, fp, tn, fn };
  }

  /**
   * Synthetic ESMFold-style structure (N, CA, C, O backbone) built with
   * physically-correct φ/ψ dihedral angles so Molstar's DSSP can detect
   * alpha-helices, beta-sheets and coils. B-factor carries the pLDDT.
   */
  private generatePDB(sequence: string, plddt: number[], seed: number): string {
    const rand = mulberry32(seed);
    const n = sequence.length;

    const segments = this.planSegments(n, rand);
    const { phiPsi, helices, sheets } = this.assignSecondaryStructure(segments, rand);
    const { N, CA, C, O } = this.buildBackbone(phiPsi);

    const lines: string[] = [];
    lines.push('HEADER    ESMFold PREDICTED STRUCTURE (SYNTHETIC)');
    lines.push('TITLE     BINDING SITE EXPLORATION — MIXED ALPHA/BETA FOLD');
    lines.push('REMARK   1 B-FACTOR = pLDDT * 100 (0-100)');
    lines.push('REMARK   2 SYNTHETIC SECONDARY STRUCTURE FOR VISUALISATION');

    helices.forEach((h, i) => {
      const initResName = AA3[sequence[h.start - 1]] ?? 'GLY';
      const endResName = AA3[sequence[h.end - 1]] ?? 'GLY';
      lines.push(this.helixRecord(i + 1, initResName, h.start, endResName, h.end));
    });

    sheets.forEach((sheet, si) => {
      const strands = sheet.strands;
      const sense = strands.length > 1 ? strands[1].sense : 0;
      sheet.strands.forEach((s, strandIndex) => {
        const initResName = AA3[sequence[s.start - 1]] ?? 'GLY';
        const endResName = AA3[sequence[s.end - 1]] ?? 'GLY';
        lines.push(this.sheetRecord(strandIndex + 1, `S${si + 1}`, strands.length, initResName, s.start, endResName, s.end, strandIndex === 0 ? 0 : sense));
      });
    });

    let serial = 1;
    for (let i = 0; i < n; i++) {
      const aa = sequence[i];
      const resName = AA3[aa] ?? 'GLY';
      const b = plddt[i] * 100;
      lines.push(this.atom(serial++, 'N', resName, 'A', i + 1, N[i], b, 'N'));
      lines.push(this.atom(serial++, 'CA', resName, 'A', i + 1, CA[i], b, 'C'));
      lines.push(this.atom(serial++, 'C', resName, 'A', i + 1, C[i], b, 'C'));
      lines.push(this.atom(serial++, 'O', resName, 'A', i + 1, O[i], b, 'O'));
    }
    lines.push('TER');
    lines.push('END');
    return lines.join('\n') + '\n';
  }

  /**
   * Split the sequence into loops, alpha-helices and beta-strands. Each protein
   * gets its own beta fraction (derived from the seed), so the fold ranges from
   * alpha-rich to beta-rich. Beta elements are built as antiparallel 3-strand
   * sheets (strand → hairpin → strand → hairpin → strand).
   */
  private planSegments(
    n: number,
    rand: () => number,
  ): Array<{ type: 'helix' | 'strand' | 'loop' | 'hairpin'; length: number }> {
    const segs: Array<{ type: 'helix' | 'strand' | 'loop' | 'hairpin'; length: number }> = [];
    let idx = 0;

    // Per-protein beta content in [0.25, 0.80] — keeps every fold mixed but diverse.
    const betaFraction = 0.25 + rand() * 0.55;

    const add = (type: 'helix' | 'strand' | 'loop' | 'hairpin', len: number): boolean => {
      const l = Math.min(len, n - idx);
      if (l <= 0) return false;
      segs.push({ type, length: l });
      idx += l;
      return true;
    };

    // N-terminal loop.
    add('loop', 2 + Math.floor(rand() * 3));

    while (idx < n) {
      if (rand() < betaFraction) {
        // Antiparallel 3-strand beta-sheet.
        for (let s = 0; s < 3 && idx < n; s++) {
          if (!add('strand', 4 + Math.floor(rand() * 4))) break;
          if (s < 2) add('hairpin', 2);
        }
      } else {
        if (!add('helix', 8 + Math.floor(rand() * 13))) break;
      }
      if (!add('loop', 2 + Math.floor(rand() * 3))) break;
    }

    return segs;
  }

  /**
   * Assign per-residue φ/ψ dihedrals from the segment plan and record the
   * residue ranges of helices and sheets. Hairpin loops use a type-II' beta
   * turn so adjacent strands hydrogen-bond antiparallel.
   */
  private assignSecondaryStructure(
    segments: Array<{ type: 'helix' | 'strand' | 'loop' | 'hairpin'; length: number }>,
    rand: () => number,
  ): {
    phiPsi: Array<[number, number]>;
    helices: Array<{ start: number; end: number }>;
    sheets: Array<{ strands: Array<{ start: number; end: number; sense: number }> }>;
  } {
    const phiPsi: Array<[number, number]> = [];
    const helices: Array<{ start: number; end: number }> = [];
    const sheets: Array<{ strands: Array<{ start: number; end: number; sense: number }> }> = [];
    let offset = 0;
    let currentSheet: { strands: Array<{ start: number; end: number; sense: number }> } | null = null;

    for (const seg of segments) {
      if (seg.type === 'helix') {
        helices.push({ start: offset + 1, end: offset + seg.length });
        for (let k = 0; k < seg.length; k++) phiPsi.push([-57, -47]);
        currentSheet = null;
      } else if (seg.type === 'strand') {
        if (!currentSheet) {
          currentSheet = { strands: [] };
          sheets.push(currentSheet);
        }
        currentSheet.strands.push({ start: offset + 1, end: offset + seg.length, sense: -1 });
        for (let k = 0; k < seg.length; k++) phiPsi.push([-139, 135]);
      } else if (seg.type === 'hairpin') {
        // Type-II' beta turn: reverses the chain so neighbouring strands pair up.
        const turn: Array<[number, number]> = [[60, -120], [-80, 0]];
        for (let k = 0; k < seg.length; k++) {
          phiPsi.push(k < 2 ? turn[k] : [(rand() - 0.5) * 60, (rand() - 0.5) * 60]);
        }
      } else {
        for (let k = 0; k < seg.length; k++) {
          phiPsi.push([(rand() - 0.5) * 140, (rand() - 0.5) * 140]);
        }
        currentSheet = null;
      }

      offset += seg.length;
    }

    return { phiPsi, helices, sheets };
  }

  /** Build a full backbone (N, CA, C, O) from per-residue φ/ψ dihedrals. */
  private buildBackbone(phiPsi: Array<[number, number]>): { N: Vec3[]; CA: Vec3[]; C: Vec3[]; O: Vec3[] } {
    const n = phiPsi.length;
    const N = new Array<Vec3>(n);
    const CA = new Array<Vec3>(n);
    const C = new Array<Vec3>(n);
    const O = new Array<Vec3>(n);

    const BOND_CN = 1.329, BOND_NCA = 1.458, BOND_CAC = 1.525, BOND_CO = 1.231;
    const ANG_CA_CN = 116.2, ANG_CN_CA = 121.7, ANG_N_CA_C = 111.2, ANG_CA_C_O = 120.8;
    const OMEGA = 180, O_DIHEDRAL = 90;

    N[0] = [0, 0, 0];
    CA[0] = [BOND_NCA, 0, 0];
    const seedAngle = 68.8 * Math.PI / 180;
    C[0] = [BOND_NCA + BOND_CAC * Math.cos(seedAngle), BOND_CAC * Math.sin(seedAngle), 0];
    O[0] = this.placeAtom(N[0], CA[0], C[0], BOND_CO, ANG_CA_C_O, O_DIHEDRAL);

    for (let i = 1; i < n; i++) {
      const [phi, psi] = phiPsi[i];
      const prevPsi = phiPsi[i - 1][1];
      N[i] = this.placeAtom(N[i - 1], CA[i - 1], C[i - 1], BOND_CN, ANG_CA_CN, prevPsi);
      CA[i] = this.placeAtom(CA[i - 1], C[i - 1], N[i], BOND_NCA, ANG_CN_CA, OMEGA);
      C[i] = this.placeAtom(C[i - 1], N[i], CA[i], BOND_CAC, ANG_N_CA_C, phi);
      O[i] = this.placeAtom(N[i], CA[i], C[i], BOND_CO, ANG_CA_C_O, O_DIHEDRAL);
    }

    return { N, CA, C, O };
  }

  /** Place atom D given A-B-C-D with bond length, angle (deg) and dihedral (deg). */
  private placeAtom(A: Vec3, B: Vec3, C: Vec3, l: number, thetaDeg: number, phiDeg: number): Vec3 {
    const z = normalize(sub(B, C));
    const CAv = sub(A, C);
    const aPerp = sub(CAv, scale(z, dot(CAv, z)));
    const aHat = normalize(aPerp);
    const th = (thetaDeg * Math.PI) / 180;
    const ph = (phiDeg * Math.PI) / 180;
    const perp = cross(z, aHat);
    return add(
      C,
      add(
        scale(z, l * Math.cos(th)),
        scale(add(scale(aHat, Math.cos(ph)), scale(perp, Math.sin(ph))), l * Math.sin(th)),
      ),
    );
  }

  /** Minimal PDB HELIX record (chain A) for a residue range [initSeq, endSeq]. */
  private helixRecord(serial: number, initResName: string, initSeq: number, endResName: string, endSeq: number): string {
    const rec = new Array<string>(80).fill(' ');
    const put = (s: string, start: number) => {
      for (let i = 0; i < s.length; i++) rec[start + i] = s[i];
    };
    put('HELIX ', 0);
    put(String(serial), 7);
    put(`H${serial}`, 11);
    put(initResName, 15);
    put('A', 19);
    put(String(initSeq), 21);
    put(endResName, 27);
    put('A', 31);
    put(String(endSeq), 33);
    return rec.join('');
  }

  /** Minimal PDB SHEET record (chain A) for a strand range [initSeq, endSeq]. */
  private sheetRecord(
    strand: number, sheetId: string, numStrands: number,
    initResName: string, initSeq: number, endResName: string, endSeq: number, sense: number,
  ): string {
    const rec = new Array<string>(80).fill(' ');
    const put = (s: string, start: number) => {
      for (let i = 0; i < s.length; i++) rec[start + i] = s[i];
    };
    put('SHEET ', 0);
    put(String(strand), 7);
    put(sheetId, 11);
    put(String(numStrands), 14);
    put(initResName, 17);
    put('A', 21);
    put(String(initSeq), 22);
    put(endResName, 28);
    put('A', 32);
    put(String(endSeq), 33);
    put(String(sense), 38);
    return rec.join('');
  }

  private atom(
    serial: number, name: string, resName: string, chain: string, resSeq: number,
    pos: Vec3, bfactor: number, element: string,
  ): string {
    const [x, y, z] = pos;
    return (
      'ATOM  ' +
      serial.toString().padStart(5) +
      ' ' + name.padEnd(4) +
      ' ' + resName +
      ' ' + chain +
      resSeq.toString().padStart(4) +
      '    ' +
      x.toFixed(3).padStart(8) +
      y.toFixed(3).padStart(8) +
      z.toFixed(3).padStart(8) +
      '  1.00' +
      bfactor.toFixed(2).padStart(6) +
      '          ' +
      element.padStart(2)
    );
  }
}
