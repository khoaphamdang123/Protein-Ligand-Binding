/**
 * Client-side copy of the backend rules (backend/app/sequence.py) for instant feedback.
 * The backend stays the source of truth and re-validates every request.
 */

const STANDARD_AA = new Set('ACDEFGHIKLMNPQRSTVWY');

export interface SequenceCheck {
  sequence: string;      // cleaned sequence ('' when nothing usable was entered)
  error: string | null;
}

export function checkSequence(raw: string, minLength: number, maxLength: number): SequenceCheck {
  if (!raw.trim()) {
    return { sequence: '', error: null };
  }
  const lines = raw.trim().split(/\r\n|\r|\n/);
  const isHeader = (line: string) => line.trimStart().startsWith('>');
  const headers = lines.filter(isHeader).length;
  const sequence = lines.filter(line => !isHeader(line)).join('').replace(/\s+/g, '').toUpperCase();

  if (headers > 1) {
    return { sequence, error: `Only one sequence per request is supported (found ${headers} FASTA records).` };
  }
  if (!sequence) {
    return { sequence, error: 'Sequence is empty.' };
  }
  const invalid = [...sequence]
    .map((aa, i) => ({ aa, position: i + 1 }))
    .filter(({ aa }) => !STANDARD_AA.has(aa));
  if (invalid.length) {
    const shown = invalid.slice(0, 5).map(({ aa, position }) => `'${aa}' at ${position}`).join(', ');
    const more = invalid.length > 5 ? ` (+${invalid.length - 5} more)` : '';
    return {
      sequence,
      error: `Only the 20 standard amino acids are allowed (X, U, B, Z, O are not supported). Found ${shown}${more}.`
    };
  }
  if (sequence.length < minLength) {
    return { sequence, error: `Too short: ${sequence.length} residues (minimum ${minLength}).` };
  }
  if (sequence.length > maxLength) {
    return {
      sequence,
      error: `Too long: ${sequence.length} residues (maximum ${maxLength}, the limit of the ESMFold API).`
    };
  }
  return { sequence, error: null };
}
