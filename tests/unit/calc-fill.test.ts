// Translated from sc/qa/unit/ucalc.cxx (testAutoFill, testAutoFillSimple) and extended with
// the series types of table4.cxx and ScDocFunc's FillSimple/FillSeries/FillAuto with undo.
import { describe, expect, it } from 'vitest';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { CELLTYPE_NONE } from '../../src/lo/sc/inc/cellvalue.ts';
import { FillCmd, FillDateCmd, FillDir, InsertDeleteFlags } from '../../src/lo/sc/inc/global.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { MAXDOUBLE } from '../../src/lo/sc/source/core/data/table4.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { formula, newDoc, put, putAll, str, val } from './calchelper.ts';

const { FILL_TO_BOTTOM, FILL_TO_RIGHT, FILL_TO_TOP, FILL_TO_LEFT } = FillDir;
const { FILL_SIMPLE, FILL_LINEAR, FILL_GROWTH, FILL_DATE, FILL_AUTO } = FillCmd;

function mark(doc: ScDocument, nTab = 0): ScMarkData {
  const m = new ScMarkData(doc.GetSheetLimits());
  m.SelectTable(nTab, true);
  return m;
}

function clearColumnA(doc: ScDocument): void {
  doc.DeleteAreaTab(0, 0, 0, doc.MaxRow(), 0, InsertDeleteFlags.ALL);
  doc.SetRowHidden(0, doc.MaxRow(), 0, false);
}

describe('Calc fill (table4.cxx)', () => {
  it('testAutoFill: linear fill, hidden rows, fill to the right', () => {
    const doc = newDoc();
    doc.SetValue(0, 0, 0, 1);
    const aMarkData = mark(doc);

    doc.Fill(0, 0, 0, 0, aMarkData, 5);
    for (let i = 0; i < 6; ++i) expect(doc.GetValue(0, i, 0)).toBe(i + 1);

    // check that hidden rows are not affected by autofill
    doc.SetValue(0, 1, 0, 10);
    doc.SetValue(0, 2, 0, 10);
    doc.SetRowHidden(1, 2, 0, true);
    doc.Fill(0, 0, 0, 0, aMarkData, 8);

    expect(doc.GetValue(0, 1, 0)).toBe(10);
    expect(doc.GetValue(0, 2, 0)).toBe(10);
    for (let i = 3; i < 8; ++i) expect(doc.GetValue(0, i, 0)).toBe(i - 1);

    doc.Fill(0, 0, 0, 8, aMarkData, 5, FILL_TO_RIGHT);
    for (let i = 0; i < 5; ++i) {
      for (let j = 0; j < 8; ++j) {
        if (j > 2) expect(doc.GetValue(i, j, 0)).toBe(j - 1 + i);
        else if (j === 0) expect(doc.GetValue(i, 0, 0)).toBe(i + 1);
        else if (i === 0) expect(doc.GetValue(0, j, 0)).toBe(10);
        else expect(doc.GetValue(i, j, 0)).toBe(0);
      }
    }
  });

  it('testAutoFill: sort lists (month names)', () => {
    const doc = newDoc();
    const aMarkData = mark(doc);
    doc.SetString(0, 100, 0, 'January');
    doc.Fill(0, 100, 0, 100, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(0, 101, 0)).toBe('February');
    expect(doc.GetString(0, 102, 0)).toBe('March');

    // test that two same user data list entries will not result in incremental fill
    doc.SetString(0, 101, 0, 'January');
    doc.Fill(0, 100, 0, 101, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    for (let i = 102; i <= 103; ++i) expect(doc.GetString(0, i, 0)).toBe('January');

    // day names, abbreviated, steps of two, wrapping around
    doc.SetString(1, 0, 0, 'Mon');
    doc.SetString(1, 1, 0, 'Wed');
    doc.Fill(1, 0, 1, 1, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    expect([2, 3, 4].map((r) => doc.GetString(1, r, 0))).toEqual(['Fri', 'Sun', 'Tue']);
    // upwards
    doc.SetString(2, 10, 0, 'March');
    doc.Fill(2, 10, 2, 10, aMarkData, 3, FILL_TO_TOP, FILL_AUTO);
    expect([7, 8, 9].map((r) => doc.GetString(2, r, 0))).toEqual(['December', 'January', 'February']);
  });

  it('testAutoFill: FillSeries with FILL_AUTO and its undo and redo', () => {
    const doc = newDoc();
    const sh = new ScDocShell(doc);
    const rFunc = sh.GetDocFunc();
    const aMarkData = mark(doc);
    doc.SetValue(new ScAddress(0, 0, 0), 1.0);
    const aRange = new ScRange(0, 0, 0, 0, 5, 0);
    aMarkData.SetMarkArea(aRange);
    rFunc.FillSeries(aRange, aMarkData, FILL_TO_BOTTOM, FILL_AUTO, FillDateCmd.FILL_DAY, MAXDOUBLE, 1.0, MAXDOUBLE, true);
    for (let i = 0; i <= 5; i++) expect(doc.GetValue(new ScAddress(0, i, 0))).toBe(i + 1);

    // Undo should clear the area except for the top cell.
    sh.GetUndoManager().Undo();
    expect(doc.GetValue(new ScAddress(0, 0, 0))).toBe(1.0);
    for (let i = 1; i <= 5; ++i) expect(doc.GetCellType(new ScAddress(0, i, 0))).toBe(CELLTYPE_NONE);

    // Redo should put the serial values back in.
    sh.GetUndoManager().Redo();
    for (let i = 0; i <= 5; i++) expect(doc.GetValue(new ScAddress(0, i, 0))).toBe(i + 1);
  });

  it('testAutoFill: filling formulas vertically up', () => {
    const doc = newDoc();
    const aMarkData = mark(doc);
    for (let nRow = 0; nRow < 10; ++nRow) doc.SetValue(100, 100 + nRow, 0, 1);
    doc.SetString(100, 110, 0, '=A111');
    doc.Fill(100, 110, 100, 110, aMarkData, 10, FILL_TO_TOP, FILL_AUTO);
    for (let nRow = 110; nRow >= 100; --nRow) expect(doc.GetFormula(100, nRow, 0)).toBe(`=A${nRow + 1}`);
  });

  it('testAutoFill: dates (tdf#89754, tdf#58745)', () => {
    const doc = newDoc();
    const aMarkData = mark(doc);
    doc.SetString(0, 100, 0, '2012-10-31');
    doc.SetString(0, 101, 0, '2012-10-31');
    doc.Fill(0, 100, 0, 101, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    // tdf#89754: equal dates are not incremented
    for (const r of [102, 103, 104]) expect(doc.GetString(0, r, 0)).toBe('2012-10-31');

    clearColumnA(doc);
    doc.SetString(0, 100, 0, '2019-10-31');
    doc.SetString(0, 101, 0, '2019-11-30');
    doc.SetString(0, 102, 0, '2019-12-31');
    doc.Fill(0, 100, 0, 102, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    // tdf#58745: end of month
    expect(doc.GetString(0, 103, 0)).toBe('2020-01-31');
    expect(doc.GetString(0, 104, 0)).toBe('2020-02-29');
    expect(doc.GetString(0, 105, 0)).toBe('2020-03-31');

    // a single date increments by days, two dates a month apart by months
    clearColumnA(doc);
    doc.SetString(0, 0, 0, '2024-01-30');
    doc.Fill(0, 0, 0, 0, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(0, 3, 0)).toBe('2024-02-02');
    doc.SetString(1, 0, 0, '2024-01-15');
    doc.SetString(1, 1, 0, '2024-02-15');
    doc.Fill(1, 0, 1, 1, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(1, 2, 0)).toBe('2024-03-15');
    expect(doc.GetString(1, 3, 0)).toBe('2024-04-15');
    // a year apart
    doc.SetString(2, 0, 0, '2020-02-29');
    doc.SetString(2, 1, 0, '2021-02-28');
    doc.Fill(2, 0, 2, 1, aMarkData, 1, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(2, 2, 0)).toBe('2022-02-28');
  });

  it('testAutoFill: decimal steps and text with numbers (tdf#37424, tdf#105268, tdf#89998, tdf#129606)', () => {
    const doc = newDoc();
    const aMarkData = mark(doc);
    putAll(doc, { A51: '1.0', A52: '1.1', A53: '1.2', A54: '1.3' });
    doc.Fill(0, 50, 0, 53, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    expect([54, 55, 56].map((r) => doc.GetString(0, r, 0))).toEqual(['1.4', '1.5', '1.6']);

    putAll(doc, { A61: '4.0', A62: '4.1', A63: '4.2', A64: '4.3' });
    doc.Fill(0, 60, 0, 63, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    expect([64, 65, 66].map((r) => doc.GetString(0, r, 0))).toEqual(['4.4', '4.5', '4.6']);

    clearColumnA(doc);
    doc.SetString(0, 70, 0, '001-001-001');
    doc.Fill(0, 70, 0, 70, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    expect([71, 72, 73].map((r) => doc.GetString(0, r, 0))).toEqual(['001-001-002', '001-001-003', '001-001-004']);

    clearColumnA(doc);
    doc.SetString(0, 80, 0, '1%');
    doc.Fill(0, 80, 0, 80, aMarkData, 3, FILL_TO_BOTTOM, FILL_AUTO);
    // (upstream shows 2.00%: the percent format detected from the input is not ours to test here)
    expect([81, 82, 83].map((r) => doc.GetValue(0, r, 0))).toEqual([0.02, 0.03, 0.04]);

    clearColumnA(doc);
    doc.SetString(0, 0, 0, '1');
    doc.SetString(0, 1, 0, '1.1');
    doc.Fill(0, 0, 0, 1, aMarkData, 60, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(0, 50, 0)).toBe('6');
  });

  it('testAutoFill: ordinal suffixes and text with numbers', () => {
    const doc = newDoc();
    const aMarkData = mark(doc);
    doc.SetString(0, 0, 0, '1st');
    doc.Fill(0, 0, 0, 0, aMarkData, 5, FILL_TO_BOTTOM, FILL_AUTO);
    expect([0, 1, 2, 3, 4, 5].map((r) => doc.GetString(0, r, 0))).toEqual(['1st', '2nd', '3rd', '4th', '5th', '6th']);

    // number at the end, with leading zeros
    doc.SetString(1, 0, 0, 'Item 009');
    doc.Fill(1, 0, 1, 0, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(1, 1, 0)).toBe('Item 010');
    expect(doc.GetString(1, 2, 0)).toBe('Item 011');
    // number at the beginning followed by a space
    doc.SetString(2, 0, 0, '10 apples');
    doc.Fill(2, 0, 2, 0, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(2, 2, 0)).toBe('12 apples');
    // a series with a step from two cells
    doc.SetString(3, 0, 0, 'Q1');
    doc.SetString(3, 1, 0, 'Q3');
    doc.Fill(3, 0, 3, 1, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(3, 2, 0)).toBe('Q5');
    expect(doc.GetString(3, 3, 0)).toBe('Q7');
    // plain text is copied
    doc.SetString(4, 0, 0, 'abc');
    doc.Fill(4, 0, 4, 0, aMarkData, 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetString(4, 2, 0)).toBe('abc');
  });

  it('testAutoFill: times (tdf#151460, tdf#153517)', () => {
    const doc = newDoc();
    const aMarkData = mark(doc);
    doc.SetString(0, 200, 0, '15:00');
    doc.SetString(0, 201, 0, '15:20');
    doc.Fill(0, 200, 0, 201, aMarkData, 25, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetValue(0, 202, 0)).toBeCloseTo(15 / 24 + 40 / 1440, 12);
    expect(doc.GetValue(0, 203, 0)).toBeCloseTo(16 / 24, 12);
    // whole seconds: no drift after many steps
    expect(Math.round(doc.GetValue(0, 225, 0) * 86400 * 1000) % 1000).toBe(0);
  });

  it('testAutoFillSimple: a value and a formula alternate', () => {
    const doc = newDoc();
    doc.SetValue(0, 0, 0, 1);
    doc.SetString(0, 1, 0, '=10');
    const aMarkData = mark(doc);
    doc.Fill(0, 0, 0, 1, aMarkData, 6, FILL_TO_BOTTOM, FILL_AUTO);
    for (let nRow = 0; nRow < 8; ++nRow) {
      if (nRow % 2 === 0) expect(doc.GetValue(0, nRow, 0)).toBe((nRow + 2) / 2);
      else expect(doc.GetValue(0, nRow, 0)).toBe(10);
    }
  });

  it('fills formulas with relative references moved and absolute ones kept', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, A4: 4, B1: '=A1*$A$1+A$2' });
    doc.Fill(1, 0, 1, 0, mark(doc), 3, FILL_TO_BOTTOM, FILL_AUTO);
    expect(formula(doc, 'B2')).toBe('=A2*$A$1+A$2');
    expect(formula(doc, 'B4')).toBe('=A4*$A$1+A$2');
    expect(val(doc, 'B4')).toBe(6);
    // to the right
    doc.Fill(1, 0, 1, 0, mark(doc), 2, FILL_TO_RIGHT, FILL_AUTO);
    expect(formula(doc, 'C1')).toBe('=B1*$A$1+B$2');
    expect(formula(doc, 'D1')).toBe('=C1*$A$1+C$2');
  });

  it('copies attributes with the fill', () => {
    const doc = newDoc();
    put(doc, 'A1', 5);
    doc.ApplyAttr(0, 0, 0, { ATTR_FONT_WEIGHT: true });
    doc.Fill(0, 0, 0, 0, mark(doc), 2, FILL_TO_BOTTOM, FILL_AUTO);
    expect(doc.GetPattern(0, 2, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(true);
    expect(val(doc, 'A3')).toBe(7);
  });

  it('fills series: linear, growth, date and the limit', () => {
    const doc = newDoc();
    const m = mark(doc);
    put(doc, 'A1', 2);
    doc.Fill(0, 0, 0, 0, m, 4, FILL_TO_BOTTOM, FILL_LINEAR, FillDateCmd.FILL_DAY, 3, 9);
    expect([0, 1, 2, 3, 4].map((r) => doc.GetCellType(0, r, 0) === CELLTYPE_NONE ? null : doc.GetValue(0, r, 0))).toEqual([2, 5, 8, null, null]);
    put(doc, 'B1', 1);
    doc.Fill(1, 0, 1, 0, m, 4, FILL_TO_BOTTOM, FILL_GROWTH, FillDateCmd.FILL_DAY, 2, MAXDOUBLE);
    expect([1, 2, 3, 4].map((r) => doc.GetValue(1, r, 0))).toEqual([2, 4, 8, 16]);
    // weekdays skip the weekend: Fri 2024-03-01
    doc.SetString(2, 0, 0, '2024-03-01');
    doc.Fill(2, 0, 2, 0, m, 2, FILL_TO_BOTTOM, FILL_DATE, FillDateCmd.FILL_WEEKDAY, 1, MAXDOUBLE);
    expect(doc.GetString(2, 1, 0)).toBe('2024-03-04');
    expect(doc.GetString(2, 2, 0)).toBe('2024-03-05');
    // months keep the day of month where possible
    doc.SetString(3, 0, 0, '2024-01-31');
    doc.Fill(3, 0, 3, 0, m, 2, FILL_TO_BOTTOM, FILL_DATE, FillDateCmd.FILL_MONTH, 1, MAXDOUBLE);
    expect(doc.GetString(3, 1, 0)).toBe('2024-02-29');
    expect(doc.GetString(3, 2, 0)).toBe('2024-03-31');
    // years
    doc.SetString(4, 0, 0, '2024-02-29');
    doc.Fill(4, 0, 4, 0, m, 1, FILL_TO_BOTTOM, FILL_DATE, FillDateCmd.FILL_YEAR, 1, MAXDOUBLE);
    // Date::SetYear keeps the 29th, which normalizes to the 1st of March as upstream
    expect(doc.GetString(4, 1, 0)).toBe('2025-03-01');
    // to the left
    put(doc, 'J1', 10);
    doc.Fill(9, 0, 9, 0, m, 2, FILL_TO_LEFT, FILL_LINEAR, FillDateCmd.FILL_DAY, 1, MAXDOUBLE);
    expect(val(doc, 'I1')).toBe(11);
    expect(val(doc, 'H1')).toBe(12);
  });

  it('ScDocFunc::FillSimple copies the first row down, with undo and redo', () => {
    const doc = newDoc();
    const sh = new ScDocShell(doc);
    putAll(doc, { A1: 7, B1: '=A1*2', A3: 'old' });
    const aRange = new ScRange(0, 0, 0, 1, 3, 0);
    expect(sh.GetDocFunc().FillSimple(aRange, null, FILL_TO_BOTTOM)).toBe(true);
    expect(val(doc, 'A4')).toBe(7);
    expect(formula(doc, 'B3')).toBe('=A3*2');
    expect(val(doc, 'B3')).toBe(14);
    sh.GetUndoManager().Undo();
    expect(str(doc, 'A3')).toBe('old');
    expect(doc.GetCellType(new ScAddress(0, 3, 0))).toBe(CELLTYPE_NONE);
    expect(doc.GetCellType(new ScAddress(1, 2, 0))).toBe(CELLTYPE_NONE);
    sh.GetUndoManager().Redo();
    expect(val(doc, 'A3')).toBe(7);
    expect(formula(doc, 'B4')).toBe('=A4*2');
    expect(val(doc, 'B4')).toBe(14);
  });

  it('ScDocFunc::FillAuto returns the destination and undoes values, formulas and attributes', () => {
    const doc = newDoc();
    const sh = new ScDocShell(doc);
    putAll(doc, { A1: 1, A2: 2, B1: '=A1+100', A4: 'keep?' });
    doc.ApplyAttr(1, 0, 0, { ATTR_FONT_WEIGHT: true });
    const aRange = new ScRange(0, 0, 0, 1, 1, 0);
    expect(sh.GetDocFunc().FillAuto(aRange, null, FILL_TO_BOTTOM, 3)).toBe(true);
    expect(aRange.equals(new ScRange(0, 0, 0, 1, 4, 0))).toBe(true);
    expect([2, 3, 4].map((r) => doc.GetValue(0, r, 0))).toEqual([3, 4, 5]);
    expect(formula(doc, 'B3')).toBe('=A3+100');
    expect(val(doc, 'B5')).toBe(105);
    expect(doc.GetPattern(1, 2, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(true);

    sh.GetUndoManager().Undo();
    expect(str(doc, 'A4')).toBe('keep?');
    expect(doc.GetCellType(new ScAddress(0, 2, 0))).toBe(CELLTYPE_NONE);
    expect(doc.GetCellType(new ScAddress(1, 2, 0))).toBe(CELLTYPE_NONE);
    expect(doc.GetPattern(1, 2, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(false);
    expect(val(doc, 'B1')).toBe(101);

    sh.GetUndoManager().Redo();
    expect(val(doc, 'A4')).toBe(4);
    expect(formula(doc, 'B5')).toBe('=A5+100');
    expect(doc.GetPattern(1, 4, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(true);
  });

  it('ScDocFunc::FillSeries with a start value and undo', () => {
    const doc = newDoc();
    const sh = new ScDocShell(doc);
    const aRange = new ScRange(0, 0, 0, 3, 0, 0);
    sh.GetDocFunc().FillSeries(aRange, null, FILL_TO_RIGHT, FILL_LINEAR, FillDateCmd.FILL_DAY, 10, 5, MAXDOUBLE);
    expect([0, 1, 2, 3].map((c) => doc.GetValue(c, 0, 0))).toEqual([10, 15, 20, 25]);
    sh.GetUndoManager().Undo();
    for (let c = 0; c <= 3; c++) expect(doc.GetCellType(c, 0, 0)).toBe(CELLTYPE_NONE);
    sh.GetUndoManager().Redo();
    expect([0, 1, 2, 3].map((c) => doc.GetValue(c, 0, 0))).toEqual([10, 15, 20, 25]);
    void FILL_SIMPLE;
  });
});
