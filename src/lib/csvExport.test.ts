// Ported from src/test/csvExport.test.ts @ 7a29f3a (Q-Tech CRM v1). Unchanged tests; header only.
import { describe, it, expect } from 'vitest';
import { generateCSV } from '@/lib/csvExport';

// Security-critical: exported CSV cells must not execute as formulas in Excel,
// and embedded quotes must not corrupt columns.
describe('generateCSV formula-injection guard', () => {
  it('neutralizes cells starting with = + - @ by prefixing a quote', () => {
    expect(generateCSV(['h'], [['=SUM(A1)']])).toContain(`"'=SUM(A1)"`);
    expect(generateCSV(['h'], [['+1']])).toContain(`"'+1"`);
    expect(generateCSV(['h'], [['-1']])).toContain(`"'-1"`);
    expect(generateCSV(['h'], [['@cmd']])).toContain(`"'@cmd"`);
  });

  it('does not prefix a safe value', () => {
    const out = generateCSV(['h'], [['Acme Ltd']]);
    expect(out).toContain(`"Acme Ltd"`);
    expect(out).not.toContain(`"'Acme`);
  });

  it('escapes embedded double quotes', () => {
    expect(generateCSV(['h'], [['he said "hi"']])).toContain(`"he said ""hi"""`);
  });

  it('renders null/undefined as empty quoted cells', () => {
    // two cells, each an empty quoted string, comma-joined
    expect(generateCSV(['h'], [[null, undefined]])).toContain('"",""');
  });
});
