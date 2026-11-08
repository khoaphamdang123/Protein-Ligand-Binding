/**
 * Backend API contract (adabind/docs/APP_INTEGRATION.md, section 5), with the five ligand classes of adabind.
 * Fields marked "additive" are returned by our backend but are not part of the contract.
 */

/** The models the backend can run (POST /predict, /predict-pdb). The pages offer LIGAND_CLASSES; `nuclear` stays API-only. */
export type BindingType = 'metal' | 'nuclear' | 'small' | 'dna' | 'rna';

/** The project's four ligand classes: nucleic-acid labels are split into DNA and RNA. */
export type LigandClass = Exclude<BindingType, 'nuclear'>;

/** Where a structure came from, in the order they are tried. */
export type StructureSource = 'precomputed' | 'esmatlas' | 'local' | 'upload';

export interface StructureSourceStatus {
  status: ComponentStatus;
  message: string;
  state?: string;      // local: idle | loading | ready | unavailable | disabled | off
  count?: number;      // precomputed: number of structures
  device?: string;     // local
  max_length?: number; // esmatlas
}

export interface PredictRequest {
  sequence: string;
  binding_type: BindingType;
}

export interface PredictPdbRequest {
  pdb: string;
  binding_type: BindingType;
}

/** bindEmbed21DL and bindNode24 on the sequence and structure of a prediction (POST /compare). */
export interface CompareRequest {
  sequence: string;
  pdb: string;
  binding_type: BindingType;
  alphafold?: boolean;   // look the sequence up in AlphaFold DB for bindNode24 (false for an uploaded structure)
  accession?: string;    // UniProt accession from the FASTA header: that protein's own AlphaFold DB entry first
}

/** The structure a comparison model ran on. */
export interface CompareStructure {
  source: 'alphafold_db' | 'same' | 'none';   // AlphaFold DB model | the prediction's structure | sequence only
  reason?: string | null;                      // same: why not AlphaFold DB
  entry?: string;                              // alphafold_db: e.g. AF-Q9K943-F1
  version?: string;
  page?: string;
  pdb?: string;                                // alphafold_db: superposed on the prediction's structure for display
  plddt?: number[];
  rmsd?: number;                               // Cα RMSD to the prediction's structure, after superposition
}

export type BaselineId = 'bindEmbed21DL' | 'bindNode24';

export interface CompareModelResult {
  probability: number[];
  binding: boolean[];
  threshold: number;
  output: string;        // which output of the model: metal, small or nuclear (shown for DNA and RNA)
  structure?: CompareStructure;
}

export interface CompareResult {
  sequence: string;
  binding_type: BindingType;
  models: Record<BaselineId, CompareModelResult>;
  mock?: boolean;
  timing: { alphafold_s?: number; prott5_s: number; models_s: number; total_s: number };
}

export interface BindingResidueResult {
  index: number;        // 1-based position in the sequence
  aa: string;
  probability: number;
}

export interface PredictResult {
  sequence: string;
  length: number;
  binding_type: BindingType;
  profile: string;
  model_version: string;
  threshold: number;
  probability: number[];
  binding: boolean[];
  binding_residues: BindingResidueResult[];
  structure: {
    source: StructureSource;
    plddt: number[];    // 0-1
    pdb: string;
    cached?: boolean;   // additive
    fallback_reason?: string | null;  // additive: why local ESMFold had to fold it
    detail?: string | null;           // additive: precomputed file name
  };
  mock?: boolean;       // additive: true with the mock predictor (no models)
  warnings?: string[];  // additive: pbind warnings (low mean pLDDT, length beyond training data, ...)
  timing?: {            // additive
    esmfold_s: number;
    predict_s: number;
    total_s: number;
    esm_s?: number;     // 0 when the embedding was reused from an earlier request on the same structure
    prott5_s?: number;
    esmif_s?: number;
    model_s?: number;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  model_version: string | null;
  max_length: number;
  min_length?: number;   // additive
  predictor?: string;    // additive
  mock?: boolean;        // additive
  profile?: string;      // additive
  binding_types?: BindingType[];                       // additive
  thresholds?: Partial<Record<BindingType, number>>;   // additive
  device?: string | null;                              // additive: cuda | cpu (binding-site checkpoints)
  devices?: Record<string, string>;                    // additive: device of every model
  structure_source?: string;                           // additive: the order of structure sources
  structure_sources?: Partial<Record<'precomputed' | 'esmatlas' | 'local', StructureSourceStatus>>;  // additive
  esmfold_local?: ComponentStatus | null;              // additive
  self_test?: ComponentStatus | null;                  // additive: golden-set check at start-up
  compare?: boolean;                                   // additive: bindEmbed21DL + bindNode24 can run
}

export type ComponentStatus = 'ok' | 'warning' | 'error' | 'running' | 'unknown';

export interface DiagnosticsComponent {
  name: string;
  status: ComponentStatus;
  message: string;
  time?: string;
}

export interface ProblemEntry {
  time: string;
  level: string;
  logger: string;
  request_id: string;
  message: string;
  exception?: string;
}

export interface EnvironmentCheck {
  name: string;
  status: ComponentStatus;
  message: string;
  seconds: number;
}

export interface DiagnosticsResponse {
  status: 'ok' | 'degraded';
  started: string;
  log_file: string;
  components: DiagnosticsComponent[];
  recent_problems: ProblemEntry[];
  environment_report: { status: ComponentStatus; generated?: string; message?: string; checks?: EnvironmentCheck[] } | null;
}

/** HTTP 202 STRUCTURE_FOLDING: local ESMFold on the CPU is folding the sequence in the background. */
export interface FoldingStatus {
  length: number;
  stage: 'queued' | 'folding';
  ahead: number;        // folds before this one in the queue
  device: string;
  waited_s: number;     // since it was queued
  folding_s: number;    // since its fold began
  fallback_reason: string | null;
}

/** Normalised error for the UI, whatever failed (backend, proxy, network, timeout). */
export interface ApiFailure {
  status: number;       // HTTP status, 0 when there was no response
  code: string;
  message: string;
  requestId?: string;
  folding?: FoldingStatus;   // code STRUCTURE_FOLDING only: not a failure, ask again
}

/** Display order of the four ligand classes, on Explore and Predict. */
export const LIGAND_CLASSES: { value: LigandClass; label: string; short: string; ligands: string }[] = [
  { value: 'metal', label: 'Metal ion', short: 'Metal', ligands: 'Zn, Ca, Mg, Fe, ...' },
  { value: 'small', label: 'Small molecule', short: 'Small', ligands: 'Drugs, cofactors, ...' },
  { value: 'dna', label: 'DNA', short: 'DNA', ligands: 'Double or single strand' },
  { value: 'rna', label: 'RNA', short: 'RNA', ligands: 'mRNA, tRNA, rRNA, ...' },
];
