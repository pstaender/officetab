import { describe, expect, it } from 'vitest';
import { ScDocumentMode, ScClipParam } from '../../src/lo/sc/source/core/data/document.ts';
import { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { ScRange, ScRefFlags } from '../../src/lo/sc/inc/address.ts';
import { InsertDeleteFlags } from '../../src/lo/sc/inc/global.ts';
import { addr, formula, newDoc, put, putAll, str, val } from './calchelper.ts';

describe('Calc recalculation', () => {
  it('follows dependency chains', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: '=A1+1', A3: '=A2+1', A4: '=SUM(A1:A3)' });
    expect(val(doc, 'A4')).toBe(6);
    put(doc, 'A1', 10);
    expect(val(doc, 'A3')).toBe(12);
    expect(val(doc, 'A4')).toBe(33);
  });

  it('notices changes in whole column ranges', () => {
    const doc = newDoc();
    put(doc, 'B1', '=SUM(A:A)');
    expect(val(doc, 'B1')).toBe(0);
    put(doc, 'A1000000', 5);
    expect(val(doc, 'B1')).toBe(5);
    put(doc, 'A7', 2);
    expect(val(doc, 'B1')).toBe(7);
  });

  it('recalculates across sheets', () => {
    const doc = newDoc(2);
    putAll(doc, { 'Sheet2.A1': 4, A1: '=$Sheet2.A1*2' });
    expect(val(doc, 'A1')).toBe(8);
    put(doc, 'Sheet2.A1', 5);
    expect(val(doc, 'A1')).toBe(10);
  });

  it('reports circular references as Err:522', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=B1+1', B1: '=A1+1' });
    expect(str(doc, 'A1')).toBe('Err:522');
    expect(str(doc, 'B1')).toBe('Err:522');
    put(doc, 'C1', '=C1');
    expect(str(doc, 'C1')).toBe('Err:522');
    // Breaking the cycle recovers.
    put(doc, 'B1', 1);
    expect(val(doc, 'A1')).toBe(2);
  });

  it('iterates circular references when iteration is on', () => {
    const doc = newDoc();
    const opt = doc.GetDocOptions().clone();
    opt.SetIter(true);
    opt.SetIterCount(100);
    opt.SetIterEps(0.001);
    doc.SetDocOptions(opt);
    // x = 1 + x/2 converges to 2.
    putAll(doc, { A1: '=1+A1/2' });
    expect(val(doc, 'A1')).toBeCloseTo(2, 2);
    // A diverging cycle does not converge: Err:523.
    put(doc, 'B1', '=B1+1');
    expect(str(doc, 'B1')).toBe('Err:523');
  });

  it('holds back with AutoCalc off until a hard recalc', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: '=A1*2' });
    expect(val(doc, 'A2')).toBe(2);
    doc.SetAutoCalc(false);
    put(doc, 'A1', 5);
    expect(val(doc, 'A2')).toBe(2);
    doc.CalcAll();
    expect(val(doc, 'A2')).toBe(10);
    doc.SetAutoCalc(true);
    put(doc, 'A1', 6);
    expect(val(doc, 'A2')).toBe(12);
  });

  it('computes a long dependency chain without overflowing the stack', () => {
    const doc = newDoc();
    put(doc, 'A1', 1);
    for (let r = 2; r <= 5000; r++) put(doc, `A${r}`, `=A${r - 1}+1`);
    expect(val(doc, 'A5000')).toBe(5000);
    put(doc, 'A1', 2);
    expect(val(doc, 'A5000')).toBe(5001);
  });

  it('enters array formulas', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3 });
    const mark = new ScMarkData(doc.GetSheetLimits());
    mark.SelectOneTable(0);
    doc.InsertMatrixFormula(1, 0, 1, 2, mark, '=A1:A3*10');
    expect([str(doc, 'B1'), str(doc, 'B2'), str(doc, 'B3')]).toEqual(['10', '20', '30']);
    expect(formula(doc, 'B2')).toBe('{=A1:A3*10}');
    put(doc, 'A2', 5);
    expect(str(doc, 'B2')).toBe('50');
  });
});

describe('Calc structural changes', () => {
  it('adjusts references when rows are inserted and deleted', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, B1: '=SUM(A1:A3)', B2: '=A3', B3: '=$A$2' });
    doc.InsertRow(0, 0, doc.MaxCol(), 0, 1, 2); // two rows before row 2
    expect(formula(doc, 'B1')).toBe('=SUM(A1:A5)');
    expect(formula(doc, 'B4')).toBe('=A5');
    expect(formula(doc, 'B5')).toBe('=$A$4');
    expect(val(doc, 'B1')).toBe(6);
    put(doc, 'A2', 10);
    expect(val(doc, 'B1')).toBe(16);
    doc.DeleteRow(0, 0, doc.MaxCol(), 0, 1, 2);
    expect(formula(doc, 'B1')).toBe('=SUM(A1:A3)');
    expect(formula(doc, 'B3')).toBe('=$A$2');
    // Deleting a referenced cell gives #REF!.
    doc.DeleteRow(0, 0, doc.MaxCol(), 0, 2, 1);
    // The deleted row part is written as #REF! (ConventionOOO_A1::makeSingleCellStr).
    expect(formula(doc, 'B2')).toBe('=A#REF!');
    expect(str(doc, 'B2')).toBe('#REF!');
    expect(formula(doc, 'B1')).toBe('=SUM(A1:A2)');
  });

  it('adjusts references when columns are inserted and deleted', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, B1: 2, C1: '=A1+B1' });
    doc.InsertCol(0, 0, doc.MaxRow(), 0, 1, 1);
    expect(formula(doc, 'D1')).toBe('=A1+C1');
    expect(val(doc, 'D1')).toBe(3);
    doc.DeleteCol(0, 0, doc.MaxRow(), 0, 0, 1);
    expect(formula(doc, 'C1')).toBe('=#REF!1+B1');
  });

  it('adjusts references to other sheets when sheets are inserted, renamed and deleted', () => {
    const doc = newDoc(2);
    putAll(doc, { 'Sheet2.A1': 7, A1: '=$Sheet2.A1' });
    doc.InsertTab(1, 'New');
    expect(doc.GetName(2)).toBe('Sheet2');
    expect(formula(doc, 'A1')).toBe('=$Sheet2.A1');
    expect(val(doc, 'A1')).toBe(7);
    doc.RenameTab(2, 'Data');
    expect(formula(doc, 'A1')).toBe('=$Data.A1');
    doc.DeleteTab(2);
    expect(formula(doc, 'A1')).toBe('=$#REF!.A1');
  });

  it('copies and pastes with relative references', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, B1: '=A1*2', C1: '=$A$1+A2' });
    const clip = new ScDocument(ScDocumentMode.SCDOCMODE_CLIP);
    const mark = new ScMarkData(doc.GetSheetLimits());
    const src = new ScRange(1, 0, 0, 2, 0, 0);
    mark.SetMarkArea(src);
    mark.SelectOneTable(0);
    doc.CopyToClip(new ScClipParam(src, false), clip, mark);
    const dest = new ScRange(1, 4, 0, 2, 4, 0);
    const destMark = new ScMarkData(doc.GetSheetLimits());
    destMark.SetMarkArea(dest);
    destMark.SelectOneTable(0);
    doc.CopyFromClip(dest, destMark, InsertDeleteFlags.ALL, null, clip);
    expect(formula(doc, 'B5')).toBe('=A5*2');
    expect(formula(doc, 'C5')).toBe('=$A$1+A6');
    put(doc, 'A5', 4);
    expect(val(doc, 'B5')).toBe(8);
  });

  it('merges cells', () => {
    const doc = newDoc();
    doc.DoMerge(0, 0, 1, 1, 0);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(true);
    expect(doc.IsOverlapped(addr(doc, 'B2'))).toBe(true);
    expect(doc.GetMergeOrigin(addr(doc, 'B2')).Format(ScRefFlags.VALID | ScRefFlags.COL_VALID | ScRefFlags.ROW_VALID, doc)).toBe('A1');
    doc.RemoveMerge(0, 0, 0);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(false);
    expect(doc.IsOverlapped(addr(doc, 'B2'))).toBe(false);
  });
});
