/**
 * Backend API contract (integration guide, section 5).
 * Fields marked "additive" are returned by our backend but are not part of the contract.
 */

export type BindingType = 'metal' | 'nuclear' | 'small';

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
    source: string;
    plddt: number[];    // 0-1
    pdb: string;
    cached?: boolean;   // additive
  };
  mock?: boolean;       // additive: true while pbind is not installed
  timing?: { esmfold_s: number; predict_s: number; total_s: number };  // additive
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  model_version: string | null;
  max_length: number;
  min_length?: number;   // additive
  predictor?: string;    // additive
  mock?: boolean;        // additive
  profile?: string;      // additive
}

export type ComponentStatus = 'ok' | 'warning' | 'error' | 'unknown';

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

export const BINDING_TYPES: { value: BindingType; label: string; ligands: string }[] = [
  { value: 'metal', label: 'Metal ion', ligands: 'Zn, Ca, Mg, Fe, ...' },
  { value: 'nuclear', label: 'Nucleic acid', ligands: 'DNA / RNA' },
  { value: 'small', label: 'Small molecule', ligands: 'Drugs, cofactors, ...' },
];
