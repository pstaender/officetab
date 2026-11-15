import { describe, expect, it } from 'vitest';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { newDoc } from './calchelper.ts';

describe('Calc performance', () => {
  it('handles 100k values and 10k formulas', () => {
    const doc = newDoc();
    const t0 = performance.now();
    for (let r = 0; r < 100000; r++) doc.SetValue(0, r, 0, r % 100);
    for (let r = 0; r < 10000; r++) doc.SetString(new ScAddress(1, r, 0), `=A${r + 1}*2+SUM(A${r + 1}:A${r + 10})`);
    doc.SetString(new ScAddress(2, 0, 0), '=SUM(A:A)');
    doc.SetString(new ScAddress(2, 1, 0), '=SUM(B1:B10000)');
    const t1 = performance.now();
    expect(doc.GetValue(new ScAddress(2, 0, 0))).toBe(4950000);
    const fSum = doc.GetValue(new ScAddress(2, 1, 0));
    const t2 = performance.now();
    // Changing one value recalculates its dependents only.
    doc.SetValue(0, 5, 0, 1000);
    expect(doc.GetValue(new ScAddress(2, 1, 0))).toBe(fSum + (1000 - 5) * (2 + 6));
    const t3 = performance.now();
    console.log(`fill ${(t1 - t0).toFixed(0)} ms, calc ${(t2 - t1).toFixed(0)} ms, recalc ${(t3 - t2).toFixed(0)} ms`);
    expect(t3 - t0).toBeLessThan(15000);
  }, 60000);
});
