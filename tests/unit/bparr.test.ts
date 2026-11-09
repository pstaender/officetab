import { describe, expect, it } from 'vitest';
import { BigPtrArray, BigPtrEntry, MAXENTRY } from '../../src/lo/sw/inc/bparr.ts';

class E extends BigPtrEntry { v: number; constructor(v: number) { super(); this.v = v; } }

/** Model check: every mutation is mirrored on a plain array and all positions are compared. */
function check(a: BigPtrArray, m: E[]): void {
  expect(a.Count()).toBe(m.length);
  m.forEach((e, i) => {
    expect(a.at(i)).toBe(e);
    expect(e.GetPos()).toBe(i);
  });
}

function rng(seed: number): (n: number) => number {
  return (n) => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed % n);
}

describe('BigPtrArray', () => {
  it('crosses block boundaries on append and front insert', () => {
    const a = new BigPtrArray(); const m: E[] = [];
    for (let i = 0; i < MAXENTRY * 3 + 5; i++) { const e = new E(i); a.Insert(e, i); m.push(e); }
    for (let i = 0; i < 1500; i++) { const e = new E(-i); a.Insert(e, 0); m.unshift(e); }
    check(a, m);
  });

  it('clears back-pointers on Remove but not on Move', () => {
    const a = new BigPtrArray(); const es = [new E(0), new E(1), new E(2)];
    es.forEach((e, i) => a.Insert(e, i));
    a.Move(0, 3);
    expect(es[0]!.IsDisconnected()).toBe(false);
    expect(es[0]!.GetPos()).toBe(2);
    a.Remove(0);
    expect(es[1]!.IsDisconnected()).toBe(true);
  });

  it('matches a plain array under random operations', () => {
    const r = rng(42); const a = new BigPtrArray(); const m: E[] = [];
    for (let i = 0; i < 4000; i++) { const e = new E(i); a.Insert(e, i); m.push(e); }
    for (let step = 0; step < 30000; step++) {
      const op = r(100);
      if (op < 45 || m.length === 0) { const p = r(m.length + 1); const e = new E(step); a.Insert(e, p); m.splice(p, 0, e); }
      else if (op < 85) { const p = r(m.length); const n = Math.min(1 + r(1500 * (r(40) === 0 ? 1 : 0) + 3), m.length - p); a.Remove(p, n); m.splice(p, n); }
      else if (op < 95) { const p = r(m.length); const e = new E(-step); a.Replace(p, e); m[p] = e; }
      else { const f = r(m.length); const t = r(m.length + 1); a.Move(f, t); const [e] = m.splice(f, 1); m.splice(t > f ? t - 1 : t, 0, e!); }
      if (step % 500 === 0) check(a, m);
    }
    check(a, m);
  });
});
