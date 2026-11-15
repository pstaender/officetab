import { describe, expect, it } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { MAXCOL, MAXROW, ScAddress, ScAddressDetails, ScColToAlpha, ScRange, ScRefFlags } from '../../src/lo/sc/inc/address.ts';
import { ScRangeList } from '../../src/lo/sc/inc/rangelst.ts';
import { newDoc } from './calchelper.ts';

const { CONV_OOO, CONV_XL_A1, CONV_XL_R1C1 } = FormulaGrammar;

describe('Calc addresses', () => {
  it('has the upstream limits', () => {
    expect(MAXCOL).toBe(16383);
    expect(MAXROW).toBe(1048575);
    expect(ScColToAlpha(0)).toBe('A');
    expect(ScColToAlpha(25)).toBe('Z');
    expect(ScColToAlpha(26)).toBe('AA');
    expect(ScColToAlpha(MAXCOL)).toBe('XFD');
  });

  it('parses and formats Calc A1', () => {
    const doc = newDoc(2);
    const a = new ScAddress();
    let f = a.Parse('B3', doc);
    expect(f & ScRefFlags.VALID).toBeTruthy();
    expect([a.Col(), a.Row(), a.Tab()]).toEqual([1, 2, 0]);
    f = a.Parse('$Sheet2.$C$10', doc);
    expect(f & ScRefFlags.VALID).toBeTruthy();
    expect([a.Col(), a.Row(), a.Tab()]).toEqual([2, 9, 1]);
    expect(a.Format(ScRefFlags.ADDR_ABS_3D, doc)).toBe('$Sheet2.$C$10');
    expect(a.Format(ScRefFlags.VALID | ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID, doc)).toBe('C10');
    expect(new ScAddress().Parse('XFE1', doc) & ScRefFlags.VALID).toBeFalsy();
    expect(new ScAddress().Parse('A1048577', doc) & ScRefFlags.VALID).toBeFalsy();
    expect(new ScAddress().Parse('Nope.A1', doc) & ScRefFlags.VALID).toBeFalsy();
  });

  it('round trips ranges in all conventions', () => {
    const doc = newDoc(2);
    for (const [eConv, s] of [
      [CONV_OOO, '$Sheet1.$A$1:$B$2'],
      [CONV_XL_A1, 'Sheet1!$A$1:$B$2'],
      [CONV_XL_R1C1, 'Sheet1!R1C1:R2C2'],
    ] as const) {
      const r = new ScRange();
      const d = ScAddressDetails(eConv, 0, 0);
      const f = r.Parse(s, doc, d);
      expect(f & ScRefFlags.VALID, s).toBeTruthy();
      expect([r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row()]).toEqual([0, 0, 1, 1]);
      expect(r.Format(doc, ScRefFlags.RANGE_ABS_3D, d)).toBe(s);
    }
  });

  it('parses Excel R1C1 relative references against a position', () => {
    const doc = newDoc();
    const a = new ScAddress();
    const f = a.Parse('R[1]C[-1]', doc, ScAddressDetails(CONV_XL_R1C1, 4, 4));
    expect(f & ScRefFlags.VALID).toBeTruthy();
    expect([a.Col(), a.Row()]).toEqual([3, 5]);
  });

  it('parses whole columns and rows', () => {
    const doc = newDoc();
    const r = new ScRange();
    expect(r.Parse('A:B', doc) & ScRefFlags.VALID).toBeTruthy();
    expect([r.aStart.Row(), r.aEnd.Row(), r.aEnd.Col()]).toEqual([0, MAXROW, 1]);
    expect(r.Parse('3:5', doc) & ScRefFlags.VALID).toBeTruthy();
    expect([r.aStart.Col(), r.aEnd.Col(), r.aStart.Row(), r.aEnd.Row()]).toEqual([0, MAXCOL, 2, 4]);
  });

  it('keeps range lists', () => {
    const doc = newDoc();
    const l = new ScRangeList();
    expect(l.Parse('A1:B2;D4', doc) & ScRefFlags.VALID).toBeTruthy();
    expect(l.size()).toBe(2);
    expect(l.GetCellCount()).toBe(5);
    expect(l.Format(doc, ScRefFlags.VALID)).toBe('A1:B2;D4');
  });

  it('intersects and moves ranges', () => {
    const r = new ScRange(0, 0, 0, 4, 4, 0);
    expect(r.Intersection(new ScRange(3, 3, 0, 9, 9, 0)).equals(new ScRange(3, 3, 0, 4, 4, 0))).toBe(true);
    expect(r.Contains(new ScAddress(2, 2, 0))).toBe(true);
    const doc = newDoc();
    expect(r.Move(1, 1, 0, new ScRange(), doc)).toBe(true);
    expect(r.aEnd.Col()).toBe(5);
  });
});
