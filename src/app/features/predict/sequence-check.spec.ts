import { checkSequence, headerAccession } from './sequence-check';

const UBQ = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';
const check = (raw: string) => checkSequence(raw, 30, 400);

describe('checkSequence (mirrors backend/app/sequence.py)', () => {
  it('accepts a plain sequence', () => {
    expect(check(UBQ)).toEqual({ sequence: UBQ, error: null });
  });

  it('strips one FASTA header, whitespace and case', () => {
    const raw = `>sp|P0CG48|UBC_HUMAN\r\n  ${UBQ.slice(0, 30).toLowerCase()}\n${UBQ.slice(30, 60)} \t\n${UBQ.slice(60)}\n\n`;
    expect(check(raw)).toEqual({ sequence: UBQ, error: null });
  });

  it('shows no error for empty input', () => {
    expect(check('   \n')).toEqual({ sequence: '', error: null });
  });

  it('rejects a header without sequence', () => {
    expect(check('>only a header').error).toBe('Sequence is empty.');
  });

  it('rejects more than one FASTA record', () => {
    expect(check(`>a\n${UBQ}\n>b\n${UBQ}`).error).toContain('found 2 FASTA records');
  });

  it.each(['X', 'U', 'B', 'Z', 'O', '*', '1', '-'])('rejects %s with its position', bad => {
    expect(check(UBQ.slice(0, 10) + bad + UBQ.slice(10)).error).toContain(`'${bad}' at 11`);
  });

  it('summarises many invalid characters', () => {
    expect(check('X'.repeat(8) + UBQ).error).toContain('(+3 more)');
  });

  it('enforces the length limits', () => {
    expect(check('A'.repeat(30)).error).toBeNull();
    expect(check('A'.repeat(400)).error).toBeNull();
    expect(check('A'.repeat(29)).error).toBe('Too short: 29 residues (minimum 30).');
    expect(check('A'.repeat(401)).error).toContain('Too long: 401 residues (maximum 400');
  });
});

describe('headerAccession', () => {
  it('reads UniProt accessions from common FASTA headers', () => {
    expect(headerAccession('>sp|P0CG48|UBIQ_HUMAN Polyubiquitin-C\nMQIF')).toBe('P0CG48');
    expect(headerAccession('>tr|A0A0B0QJR1|X\nMQIF')).toBe('A0A0B0QJR1');
    expect(headerAccession('>Q9K943 HTH-type transcriptional regulator MntR\nMPTP')).toBe('Q9K943');
    expect(headerAccession('  >p06956\nMSNL')).toBe('P06956');
  });

  it('ignores headers without an accession, and plain sequences', () => {
    expect(headerAccession('>my protein\nMQIF')).toBeNull();
    expect(headerAccession('>1ABC_A chain A\nMQIF')).toBeNull();
    expect(headerAccession('MQIFVKTLTG')).toBeNull();
  });
});
