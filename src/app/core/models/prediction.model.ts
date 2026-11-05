/**
 * Backend API contract (adabind/docs/APP_INTEGRATION.md, section 5), with the five ligand classes of adabind.
 * Fields marked "additive" are returned by our backend but are not part of the contract.
 */

/** The five models the backend can run (POST /predict, /predict-pdb). */
export type BindingType = 'metal' | 'nuclear' | 'small' | 'dna' | 'rna';

/** The three ligand classes evaluated in the paper (Explore, benchmarks). DNA / RNA are extra model lines. */
export type LigandClass = Extract<BindingType, 'metal' | 'nuclear' | 'small'>;

export interface PredictRequest {
  sequence: string;
  binding_type: BindingType;
}

export interface PredictPdbRequest {
  pdb: string;
  binding_type: BindingType;
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
    source: string;     // "local" (self-hosted ESMFold v1) | "esmatlas" (public API) | "upload" (POST /predict-pdb)
    plddt: number[];    // 0-1
    pdb: string;
    cached?: boolean;   // additive
    fallback_reason?: string | null;  // additive: why the API was used although local ESMFold is configured
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
  structure_source?: string;                           // additive: "local ESMFold, API fallback" | "ESMFold API"
  esmfold_local?: ComponentStatus | null;              // additive
  self_test?: ComponentStatus | null;                  // additive: golden-set check at start-up
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

/** Normalised error for the UI, whatever failed (backend, proxy, network, timeout). */
export interface ApiFailure {
  status: number;       // HTTP status, 0 when there was no response
  code: string;
  message: string;
  requestId?: string;
}

/**
 * The five independent models of adabind/final_model. dna and rna are their own model lines, not a split of
 * nuclear: "nuclear" asks "binds DNA or RNA?", dna / rna ask about one of them only.
 */
export const BINDING_TYPES: { value: BindingType; label: string; ligands: string }[] = [
  { value: 'metal', label: 'Metal ion', ligands: 'Zn, Ca, Mg, Fe, ...' },
  { value: 'small', label: 'Small molecule', ligands: 'Drugs, cofactors, ...' },
  { value: 'nuclear', label: 'Nucleic acid', ligands: 'DNA or RNA' },
  { value: 'dna', label: 'DNA', ligands: 'DNA only' },
  { value: 'rna', label: 'RNA', ligands: 'RNA only' },
];

/** The paper's three ligand classes, as shown in Explore. */
export const LIGAND_CLASSES: { value: LigandClass; label: string; ligands: string }[] = [
  { value: 'metal', label: 'Metal ion', ligands: 'Zn, Ca, Mg, Fe, ...' },
  { value: 'nuclear', label: 'Nucleic acid', ligands: 'DNA / RNA' },
  { value: 'small', label: 'Small molecule', ligands: 'Drugs, cofactors, ...' },
];
