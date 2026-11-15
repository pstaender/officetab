// ScDocFunc (sc/source/ui/docshell/docfunc.cxx) with undo and redo. Cases translated from
// sc/qa/unit/ucalc.cxx (testMergedCells, testRenameTable, testEnterMixedMatrix) and
// ucalc_formula.cxx (testFormulaRefUpdateDeleteAndShiftUp, ...), plus undo/redo checks of
// contents, attributes and formulas for every operation.
import { describe, expect, it } from 'vitest';
import { EditTextObject } from '../../src/lo/editeng/source/editeng/editobj.ts';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../src/lo/sc/inc/cellvalue.ts';
import { DelCellCmd, InsCellCmd, InsertDeleteFlags, ScSizeMode } from '../../src/lo/sc/inc/global.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { SfxStyleFamily } from '../../src/lo/sc/inc/stlsheet.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { ScFormulaCell } from '../../src/lo/sc/source/core/data/formulacell.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScCellMergeOption } from '../../src/lo/sc/source/ui/view/cellmergeoption.ts';
import { addr, formula, newDoc, putAll, str, val } from './calchelper.ts';

function shell(nTabs = 1): { doc: ScDocument; sh: ScDocShell } {
  const doc = newDoc(nTabs);
  for (let i = 0; i < nTabs; i++) doc.RenameTab(i, `Sheet${i + 1}`);
  return { doc, sh: new ScDocShell(doc) };
}

function markRange(doc: ScDocument, r: string): ScMarkData {
  const m = new ScMarkData(doc.GetSheetLimits());
  const a = new ScRange();
  const [s, e] = r.split(':');
  a.aStart = addr(doc, s!);
  a.aEnd = addr(doc, e ?? s!);
  m.SetMarkArea(a);
  return m;
}

const undo = (sh: ScDocShell) => expect(sh.GetUndoManager().Undo()).toBe(true);
const redo = (sh: ScDocShell) => expect(sh.GetUndoManager().Redo()).toBe(true);
const bold = (doc: ScDocument, ref: string) => doc.GetPattern(addr(doc, ref)).GetItem('ATTR_FONT_WEIGHT');

describe('ScDocFunc: EnterData', () => {
  it('enters numbers, text, formulas and apostrophe text, undo and redo restore them', () => {
    const { doc, sh } = shell();
    const f = sh.GetDocFunc();
    f.EnterData(addr(doc, 'A1'), '42');
    f.EnterData(addr(doc, 'A2'), 'hello');
    f.EnterData(addr(doc, 'A3'), '=A1*2');
    f.EnterData(addr(doc, 'A4'), "'0042");
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_VALUE);
    expect(doc.GetCellType(addr(doc, 'A2'))).toBe(CELLTYPE_STRING);
    expect(formula(doc, 'A3')).toBe('=A1*2');
    expect(val(doc, 'A3')).toBe(84);
    expect(str(doc, 'A4')).toBe('0042');
    expect(doc.GetCellType(addr(doc, 'A4'))).toBe(CELLTYPE_STRING);
    expect(sh.GetUndoManager().GetUndoActionCount()).toBe(4);
    expect(sh.GetUndoManager().GetUndoActionComment()).toBe('Input');

    // overwrite and undo: the old content comes back, dependents recalculate
    f.EnterData(addr(doc, 'A1'), '5');
    expect(val(doc, 'A3')).toBe(10);
    undo(sh);
    expect(val(doc, 'A1')).toBe(42);
    expect(val(doc, 'A3')).toBe(84);
    redo(sh);
    expect(val(doc, 'A3')).toBe(10);

    undo(sh); undo(sh); undo(sh);
    expect(doc.GetCellType(addr(doc, 'A3'))).toBe(CELLTYPE_NONE);
    redo(sh);
    expect(formula(doc, 'A3')).toBe('=A1*2');
    expect(val(doc, 'A3')).toBe(84);
  });

  it('treats + and - input as a formula unless it is a number (checkFormula)', () => {
    const { doc, sh } = shell();
    const f = sh.GetDocFunc();
    f.EnterData(addr(doc, 'A1'), '3');
    f.EnterData(addr(doc, 'B1'), '+A1*2');
    expect(doc.GetCellType(addr(doc, 'B1'))).toBe(CELLTYPE_FORMULA);
    expect(val(doc, 'B1')).toBe(6);
    f.EnterData(addr(doc, 'B2'), '-5');
    expect(doc.GetCellType(addr(doc, 'B2'))).toBe(CELLTYPE_VALUE);
    expect(val(doc, 'B2')).toBe(-5);
    // '--5' collapses to '-5', a number, so it is not a formula; as input it is not a number
    f.EnterData(addr(doc, 'B3'), '--5');
    expect(doc.GetCellType(addr(doc, 'B3'))).toBe(CELLTYPE_STRING);
    f.EnterData(addr(doc, 'B4'), '+-A1');
    expect(doc.GetCellType(addr(doc, 'B4'))).toBe(CELLTYPE_FORMULA);
    expect(val(doc, 'B4')).toBe(-3);
    // an unknown name after + or - is not a formula: the input is text
    f.EnterData(addr(doc, 'B5'), '-foo bar');
    expect(doc.GetCellType(addr(doc, 'B5'))).toBe(CELLTYPE_STRING);
    expect(str(doc, 'B5')).toBe('-foo bar');
    // '=' alone is text, '=' with an error stays a formula
    f.EnterData(addr(doc, 'B6'), '=');
    expect(doc.GetCellType(addr(doc, 'B6'))).toBe(CELLTYPE_STRING);
    f.EnterData(addr(doc, 'B7'), '=1/0');
    expect(str(doc, 'B7')).toBe('#DIV/0!');
    undo(sh);
    expect(doc.GetCellType(addr(doc, 'B7'))).toBe(CELLTYPE_NONE);
    redo(sh);
    expect(str(doc, 'B7')).toBe('#DIV/0!');
  });

  it('in a Text formatted cell a formula is text', () => {
    const { doc, sh } = shell();
    doc.ApplyAttr(0, 0, 0, { ATTR_VALUE_FORMAT: '@' });
    sh.GetDocFunc().EnterData(addr(doc, 'A1'), '=1+1');
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_STRING);
    expect(str(doc, 'A1')).toBe('=1+1');
  });

  it('a detected number format is set and undone with the value', () => {
    const { doc, sh } = shell();
    sh.GetDocFunc().EnterData(addr(doc, 'A1'), '12%');
    expect(val(doc, 'A1')).toBeCloseTo(0.12, 12);
    expect(doc.GetNumberFormat(addr(doc, 'A1'))).toContain('%');
    undo(sh);
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_NONE);
    expect(doc.GetNumberFormat(addr(doc, 'A1'))).toBe(doc.GetDefPattern().GetNumberFormat());
    redo(sh);
    expect(doc.GetNumberFormat(addr(doc, 'A1'))).toContain('%');
  });

  it('enters into all selected sheets in one undo step', () => {
    const { doc, sh } = shell(2);
    const m = new ScMarkData(doc.GetSheetLimits());
    m.SelectTable(0, true);
    m.SelectTable(1, true);
    sh.GetDocFunc().EnterData(addr(doc, 'A1'), '7', null, m);
    sh.GetDocFunc().EnterData(addr(doc, 'B1'), '=A1+1', null, m);
    expect(doc.GetValue(0, 0, 1)).toBe(7);
    expect(doc.GetValue(1, 0, 1)).toBe(8);
    undo(sh);
    expect(doc.GetCellType(1, 0, 0)).toBe(CELLTYPE_NONE);
    expect(doc.GetCellType(1, 0, 1)).toBe(CELLTYPE_NONE);
    undo(sh);
    expect(doc.GetCellType(0, 0, 1)).toBe(CELLTYPE_NONE);
    redo(sh); redo(sh);
    expect(doc.GetValue(1, 0, 1)).toBe(8);
  });

  it('multi-line input becomes an edit cell', () => {
    const { doc, sh } = shell();
    sh.GetDocFunc().EnterData(addr(doc, 'A1'), 'a\nb');
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_EDIT);
  });
});

describe('ScDocFunc: setting cells', () => {
  it('SetValueCell, SetStringCell, SetEditCell, SetFormulaCell and PutCell with undo/redo', () => {
    const { doc, sh } = shell();
    const f = sh.GetDocFunc();
    putAll(doc, { A1: 'old' });
    f.SetValueCell(addr(doc, 'A1'), 3.5);
    f.SetStringCell(addr(doc, 'A2'), '123'); // text input: stays a string
    f.SetEditCell(addr(doc, 'A3'), EditTextObject.FromText('x\ny'));
    f.SetFormulaCell(addr(doc, 'A4'), new ScFormulaCell(doc, addr(doc, 'A4'), '=A1*2'));
    f.PutCell(addr(doc, 'A5'), 9);
    expect(val(doc, 'A1')).toBe(3.5);
    expect(doc.GetCellType(addr(doc, 'A2'))).toBe(CELLTYPE_STRING);
    expect(doc.GetCellType(addr(doc, 'A3'))).toBe(CELLTYPE_EDIT);
    expect(val(doc, 'A4')).toBe(7);
    expect(val(doc, 'A5')).toBe(9);
    for (let i = 0; i < 4; i++) undo(sh);
    expect(doc.GetCellType(addr(doc, 'A2'))).toBe(CELLTYPE_NONE);
    expect(doc.GetCellType(addr(doc, 'A4'))).toBe(CELLTYPE_NONE);
    expect(val(doc, 'A1')).toBe(3.5);
    undo(sh);
    expect(str(doc, 'A1')).toBe('old');
    for (let i = 0; i < 5; i++) redo(sh);
    expect(formula(doc, 'A4')).toBe('=A1*2');
    expect(val(doc, 'A4')).toBe(7);
    expect(str(doc, 'A3')).toBe('x\ny');
    expect(str(doc, 'A2')).toBe('123');
  });

  it('SetNormalString returns whether the number format was set', () => {
    const { doc, sh } = shell();
    const r = sh.GetDocFunc().SetNormalString(addr(doc, 'A1'), '2024-05-06');
    expect(r.bSuccess).toBe(true);
    expect(r.o_rbNumFmtSet).toBe(true);
    undo(sh);
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_NONE);
  });
});

describe('ScDocFunc: deleting contents', () => {
  it('DeleteContents by flags; undo restores contents, formulas and attributes', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, A2: 'text', A3: '=A1+10', B1: '=SUM(A1:A3)' });
    doc.ApplyAttr(0, 0, 0, { ATTR_FONT_WEIGHT: true });
    const f = sh.GetDocFunc();
    // values only: the text and the formula stay
    f.DeleteContents(markRange(doc, 'A1:A3'), InsertDeleteFlags.VALUE);
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_NONE);
    expect(str(doc, 'A2')).toBe('text');
    expect(val(doc, 'A3')).toBe(10);
    expect(val(doc, 'B1')).toBe(10);
    expect(bold(doc, 'A1')).toBe(true);
    undo(sh);
    expect(val(doc, 'A1')).toBe(1);
    expect(val(doc, 'B1')).toBe(12);
    redo(sh);
    expect(val(doc, 'B1')).toBe(10);
    undo(sh);

    // everything including attributes
    f.DeleteContents(markRange(doc, 'A1:A3'), InsertDeleteFlags.ALL);
    expect(doc.IsBlockEmpty(0, 0, 0, 2, 0)).toBe(true);
    expect(bold(doc, 'A1')).toBe(false);
    expect(val(doc, 'B1')).toBe(0);
    expect(sh.GetUndoManager().GetUndoActionComment()).toBe('Delete');
    undo(sh);
    expect(val(doc, 'A1')).toBe(1);
    expect(str(doc, 'A2')).toBe('text');
    expect(formula(doc, 'A3')).toBe('=A1+10');
    expect(bold(doc, 'A1')).toBe(true);
    expect(val(doc, 'B1')).toBe(12);
    redo(sh);
    expect(doc.IsBlockEmpty(0, 0, 0, 2, 0)).toBe(true);
    expect(bold(doc, 'A1')).toBe(false);
  });

  it('DeleteContents of a multi-selection only deletes the marked cells', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, A2: 2, A3: 3, A4: 4 });
    const m = new ScMarkData(doc.GetSheetLimits());
    m.SelectTable(0, true);
    m.SetMultiMarkArea(new ScRange(0, 0, 0, 0, 0, 0));
    m.SetMultiMarkArea(new ScRange(0, 2, 0, 0, 3, 0));
    sh.GetDocFunc().DeleteContents(m, InsertDeleteFlags.CONTENTS);
    expect([val(doc, 'A1'), val(doc, 'A2'), val(doc, 'A3'), val(doc, 'A4')]).toEqual([0, 2, 0, 0]);
    expect(doc.GetCellType(addr(doc, 'A2'))).toBe(CELLTYPE_VALUE);
    undo(sh);
    expect([val(doc, 'A1'), val(doc, 'A2'), val(doc, 'A3'), val(doc, 'A4')]).toEqual([1, 2, 3, 4]);
    redo(sh);
    expect(doc.GetCellType(addr(doc, 'A3'))).toBe(CELLTYPE_NONE);
  });

  it('DeleteCell deletes one cell', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 5, B1: '=A1' });
    sh.GetDocFunc().DeleteCell(addr(doc, 'A1'), markRange(doc, 'A1'), InsertDeleteFlags.CONTENTS);
    expect(val(doc, 'B1')).toBe(0);
    undo(sh);
    expect(val(doc, 'B1')).toBe(5);
    redo(sh);
    expect(doc.GetCellType(addr(doc, 'A1'))).toBe(CELLTYPE_NONE);
  });
});

describe('ScDocFunc: attributes and styles', () => {
  it('ApplyAttributes with undo and redo', () => {
    const { doc, sh } = shell();
    doc.ApplyAttr(1, 1, 0, { ATTR_FONT_HEIGHT: 400 });
    sh.GetDocFunc().ApplyAttributes(markRange(doc, 'A1:B2'), { ATTR_FONT_WEIGHT: true });
    expect(bold(doc, 'A1')).toBe(true);
    expect(bold(doc, 'B2')).toBe(true);
    expect(doc.GetPattern(addr(doc, 'B2')).GetItem('ATTR_FONT_HEIGHT')).toBe(400);
    expect(bold(doc, 'C3')).toBe(false);
    undo(sh);
    expect(bold(doc, 'A1')).toBe(false);
    expect(bold(doc, 'B2')).toBe(false);
    expect(doc.GetPattern(addr(doc, 'B2')).GetItem('ATTR_FONT_HEIGHT')).toBe(400);
    redo(sh);
    expect(bold(doc, 'B2')).toBe(true);
  });

  it('ApplyStyle with undo and redo', () => {
    const { doc, sh } = shell();
    const pool = doc.GetStyleSheetPool();
    pool.Make('Accent', SfxStyleFamily.Para, { ATTR_FONT_WEIGHT: true });
    doc.ApplyAttr(0, 0, 0, { ATTR_FONT_HEIGHT: 300 });
    expect(sh.GetDocFunc().ApplyStyle(markRange(doc, 'A1:A2'), 'Accent')).toBe(true);
    expect(doc.GetStyle(0, 0, 0)?.GetName()).toBe('Accent');
    expect(bold(doc, 'A2')).toBe(true);
    undo(sh);
    expect(doc.GetStyle(0, 0, 0)?.GetName()).toBe(doc.GetStyleSheetPool().GetStandardStyle().GetName());
    expect(doc.GetPattern(addr(doc, 'A1')).GetItem('ATTR_FONT_HEIGHT')).toBe(300);
    expect(bold(doc, 'A2')).toBe(false);
    redo(sh);
    expect(doc.GetStyle(0, 1, 0)?.GetName()).toBe('Accent');
    expect(sh.GetDocFunc().ApplyStyle(markRange(doc, 'A1'), 'NoSuchStyle')).toBe(false);
  });
});

describe('ScDocFunc: inserting and deleting cells', () => {
  it('inserts rows: references move, undo restores formulas and contents', () => {
    const { doc, sh } = shell(2);
    putAll(doc, { A1: 1, A2: 2, A3: 3, A4: '=SUM(A1:A3)', B1: '=A3*2', 'Sheet2.A1': '=Sheet1.A3' });
    doc.ApplyAttr(0, 2, 0, { ATTR_FONT_WEIGHT: true });
    const f = sh.GetDocFunc();
    expect(f.InsertCells(new ScRange(0, 1, 0, doc.MaxCol(), 2, 0), null, InsCellCmd.INS_INSROWS_BEFORE)).toBe(true);
    expect(val(doc, 'A5')).toBe(3);
    expect(bold(doc, 'A5')).toBe(true);
    expect(formula(doc, 'A6')).toBe('=SUM(A1:A5)');
    expect(formula(doc, 'B1')).toBe('=A5*2');
    expect(doc.GetFormula(0, 0, 1)).toBe('=Sheet1.A5');
    expect(val(doc, 'A6')).toBe(6);
    expect(sh.GetUndoManager().GetUndoActionComment()).toBe('Insert');
    undo(sh);
    expect(formula(doc, 'A4')).toBe('=SUM(A1:A3)');
    expect(formula(doc, 'B1')).toBe('=A3*2');
    expect(doc.GetFormula(0, 0, 1)).toBe('=Sheet1.A3');
    expect(val(doc, 'A4')).toBe(6);
    expect(val(doc, 'B1')).toBe(6);
    expect(bold(doc, 'A3')).toBe(true);
    expect(doc.GetCellType(addr(doc, 'A6'))).toBe(CELLTYPE_NONE);
    redo(sh);
    expect(formula(doc, 'A6')).toBe('=SUM(A1:A5)');
    expect(formula(doc, 'B1')).toBe('=A5*2');
    expect(val(doc, 'B1')).toBe(6);
  });

  it('inserts columns, cells down and cells right with undo and redo', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, B1: 2, C1: '=A1+B1', A2: 10, B2: 20, C2: '=SUM(A2:B2)' });
    const f = sh.GetDocFunc();
    f.InsertCells(new ScRange(1, 0, 0, 1, doc.MaxRow(), 0), null, InsCellCmd.INS_INSCOLS_BEFORE);
    expect(formula(doc, 'D1')).toBe('=A1+C1');
    expect(formula(doc, 'D2')).toBe('=SUM(A2:C2)');
    undo(sh);
    expect(formula(doc, 'C1')).toBe('=A1+B1');
    expect(formula(doc, 'C2')).toBe('=SUM(A2:B2)');
    expect(val(doc, 'C2')).toBe(30);
    redo(sh);
    expect(val(doc, 'D2')).toBe(30);
    undo(sh);

    // shift cells down in column A only
    f.InsertCells(new ScRange(0, 0, 0, 0, 0, 0), null, InsCellCmd.INS_CELLSDOWN);
    expect(val(doc, 'A2')).toBe(1);
    expect(val(doc, 'A3')).toBe(10);
    expect(formula(doc, 'C1')).toBe('=A2+B1');
    expect(formula(doc, 'C2')).toBe('=SUM(A2:B2)');
    undo(sh);
    expect(val(doc, 'A1')).toBe(1);
    expect(formula(doc, 'C1')).toBe('=A1+B1');
    redo(sh);
    expect(formula(doc, 'C1')).toBe('=A2+B1');
    undo(sh);

    // shift cells right in row 1 only
    f.InsertCells(new ScRange(0, 0, 0, 0, 0, 0), null, InsCellCmd.INS_CELLSRIGHT);
    expect(val(doc, 'B1')).toBe(1);
    expect(formula(doc, 'D1')).toBe('=B1+C1');
    expect(val(doc, 'A2')).toBe(10);
    undo(sh);
    expect(formula(doc, 'C1')).toBe('=A1+B1');
    expect(val(doc, 'C1')).toBe(3);
  });

  it('inserts rows after the selection (INS_INSROWS_AFTER)', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, A2: 2 });
    sh.GetDocFunc().InsertCells(new ScRange(0, 0, 0, doc.MaxCol(), 0, 0), null, InsCellCmd.INS_INSROWS_AFTER);
    expect(val(doc, 'A1')).toBe(1);
    expect(val(doc, 'A3')).toBe(2);
    undo(sh);
    expect(val(doc, 'A2')).toBe(2);
  });

  it('testFormulaRefUpdateDeleteAndShiftUp', () => {
    const { doc, sh } = shell();
    // Insert 1,2,3,4,5 in A3:A7.
    for (let i = 0; i <= 4; ++i) doc.SetValue(new ScAddress(0, i + 2, 0), i + 1);
    const aPos = new ScAddress(0, 7, 0);
    doc.SetString(aPos, '=SUM(A3:A7)');
    expect(doc.GetValue(aPos)).toBe(15);

    const aMark = new ScMarkData(doc.GetSheetLimits());
    aMark.SelectOneTable(0);
    const rFunc = sh.GetDocFunc();
    // Delete rows 4:5 (middle of the reference).
    expect(rFunc.DeleteCells(new ScRange(0, 3, 0, doc.MaxCol(), 4, 0), aMark, DelCellCmd.CellsUp, true)).toBe(true);
    aPos.IncRow(-2);
    expect(doc.GetValue(aPos)).toBe(10);
    expect(doc.GetFormula(aPos)).toBe('=SUM(A3:A5)');
    undo(sh);
    aPos.IncRow(2);
    expect(doc.GetValue(aPos)).toBe(15);
    expect(doc.GetFormula(aPos)).toBe('=SUM(A3:A7)');

    // Delete rows 3:4 (top end of the reference).
    rFunc.DeleteCells(new ScRange(0, 2, 0, doc.MaxCol(), 3, 0), aMark, DelCellCmd.CellsUp, true);
    aPos.IncRow(-2);
    expect(doc.GetValue(aPos)).toBe(12);
    expect(doc.GetFormula(aPos)).toBe('=SUM(A3:A5)');
    undo(sh);
    aPos.IncRow(2);
    expect(doc.GetValue(aPos)).toBe(15);
    expect(doc.GetFormula(aPos)).toBe('=SUM(A3:A7)');

    // Delete rows 2:5 (overlaps on the top).
    rFunc.DeleteCells(new ScRange(0, 1, 0, doc.MaxCol(), 4, 0), aMark, DelCellCmd.CellsUp, true);
    aPos.IncRow(-4);
    expect(doc.GetValue(aPos)).toBe(9);
    expect(doc.GetFormula(aPos)).toBe('=SUM(A2:A3)');
    undo(sh);
    aPos.IncRow(4);
    expect(doc.GetValue(aPos)).toBe(15);
    expect(doc.GetFormula(aPos)).toBe('=SUM(A3:A7)');
    redo(sh);
    expect(doc.GetFormula(new ScAddress(0, 3, 0))).toBe('=SUM(A2:A3)');
  });

  it('deletes rows: references into the block become #REF!, undo restores them', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, A2: 2, A3: 3, B1: '=A2*10', B5: '=A3' });
    doc.ApplyAttr(0, 1, 0, { ATTR_FONT_WEIGHT: true });
    sh.GetDocFunc().DeleteCells(new ScRange(0, 1, 0, doc.MaxCol(), 1, 0), null, DelCellCmd.Rows);
    expect(formula(doc, 'B1')).toBe('=A#REF!*10');
    expect(str(doc, 'B1')).toBe('#REF!');
    expect(formula(doc, 'B4')).toBe('=A2');
    expect(val(doc, 'B4')).toBe(3);
    expect(bold(doc, 'A2')).toBe(false);
    undo(sh);
    expect(formula(doc, 'B1')).toBe('=A2*10');
    expect(val(doc, 'B1')).toBe(20);
    expect(formula(doc, 'B5')).toBe('=A3');
    expect(val(doc, 'A2')).toBe(2);
    expect(bold(doc, 'A2')).toBe(true);
    redo(sh);
    expect(formula(doc, 'B1')).toBe('=A#REF!*10');
    expect(formula(doc, 'B4')).toBe('=A2');
  });

  it('deletes columns and cells shifting left, with undo and redo', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, B1: 2, C1: 3, D1: '=A1+C1', A2: '=SUM(A1:C1)' });
    const f = sh.GetDocFunc();
    f.DeleteCells(new ScRange(1, 0, 0, 1, doc.MaxRow(), 0), null, DelCellCmd.Cols);
    expect(formula(doc, 'C1')).toBe('=A1+B1');
    expect(formula(doc, 'A2')).toBe('=SUM(A1:B1)');
    expect(val(doc, 'A2')).toBe(4);
    undo(sh);
    expect(formula(doc, 'D1')).toBe('=A1+C1');
    expect(formula(doc, 'A2')).toBe('=SUM(A1:C1)');
    expect(val(doc, 'B1')).toBe(2);
    expect(val(doc, 'A2')).toBe(6);
    redo(sh);
    expect(val(doc, 'A2')).toBe(4);
    undo(sh);

    f.DeleteCells(new ScRange(0, 0, 0, 0, 0, 0), null, DelCellCmd.CellsLeft);
    expect(val(doc, 'A1')).toBe(2);
    expect(formula(doc, 'C1')).toBe('=#REF!1+B1');
    expect(formula(doc, 'A2')).toBe('=SUM(A1:B1)');
    undo(sh);
    expect(formula(doc, 'D1')).toBe('=A1+C1');
    expect(val(doc, 'D1')).toBe(4);
    expect(val(doc, 'A1')).toBe(1);

    // shifting only column A up: the range over A1:C1 is not shifted with it
    f.DeleteCells(new ScRange(0, 0, 0, 0, 0, 0), null, DelCellCmd.CellsUp);
    expect(formula(doc, 'A1')).toBe('=SUM(A1:C1)');
    expect(doc.GetCellType(addr(doc, 'A2'))).toBe(CELLTYPE_NONE);
    undo(sh);
    expect(formula(doc, 'A2')).toBe('=SUM(A1:C1)');
    expect(val(doc, 'A1')).toBe(1);
  });

  it('testMergedCells: inserting rows into a merged area enlarges it, undo restores it', () => {
    const { doc, sh } = shell();
    doc.DoMerge(1, 1, 3, 3, 0);
    expect(doc.ExtendMerge(1, 1, 1, 1, 0)).toMatchObject({ nEndCol: 3, nEndRow: 3 });
    const aRange = new ScRange(0, 2, 0, doc.MaxCol(), 2, 0);
    const aMark = new ScMarkData(doc.GetSheetLimits());
    aMark.SetMarkArea(aRange);
    sh.GetDocFunc().InsertCells(aRange, aMark, InsCellCmd.INS_INSROWS_BEFORE, true, true);
    expect(doc.ExtendMerge(1, 1, 1, 1, 0)).toMatchObject({ nEndCol: 3, nEndRow: 4 });
    expect(sh.GetUndoManager().GetUndoActionCount()).toBe(1);
    undo(sh);
    expect(doc.ExtendMerge(1, 1, 1, 1, 0)).toMatchObject({ nEndCol: 3, nEndRow: 3 });
    expect(doc.IsOverlapped(new ScAddress(3, 3, 0))).toBe(true);
    expect(doc.IsOverlapped(new ScAddress(3, 4, 0))).toBe(false);
    redo(sh);
    expect(doc.ExtendMerge(1, 1, 1, 1, 0)).toMatchObject({ nEndCol: 3, nEndRow: 4 });
  });

  it('refuses to shift cells that would cut a merged area', () => {
    const { doc, sh } = shell();
    doc.DoMerge(0, 0, 1, 1, 0);
    expect(sh.GetDocFunc().InsertCells(new ScRange(1, 0, 0, 1, 0, 0), null, InsCellCmd.INS_CELLSDOWN)).toBe(false);
    expect(sh.GetUndoManager().GetUndoActionCount()).toBe(0);
  });
});

describe('ScDocFunc: column widths and row heights', () => {
  it('SetWidthOrHeight: direct widths and heights, hiding, optimal width; undo/redo', () => {
    const { doc, sh } = shell();
    const f = sh.GetDocFunc();
    const w0 = doc.GetColWidth(1, 0);
    f.SetWidthOrHeight(true, [{ mnStart: 1, mnEnd: 2 }], 0, ScSizeMode.SC_SIZE_DIRECT, 2000);
    expect(doc.GetColWidth(1, 0)).toBe(2000);
    expect(doc.GetColWidth(2, 0)).toBe(2000);
    undo(sh);
    expect(doc.GetColWidth(1, 0)).toBe(w0);
    redo(sh);
    expect(doc.GetColWidth(2, 0)).toBe(2000);

    const h0 = doc.GetRowHeight(4, 0);
    f.SetWidthOrHeight(false, [{ mnStart: 4, mnEnd: 4 }], 0, ScSizeMode.SC_SIZE_DIRECT, 900);
    expect(doc.GetRowHeight(4, 0)).toBe(900);
    expect(doc.IsManualRowHeight(4, 0)).toBe(true);
    undo(sh);
    expect(doc.GetRowHeight(4, 0)).toBe(h0);
    expect(doc.IsManualRowHeight(4, 0)).toBe(false);
    redo(sh);
    expect(doc.GetRowHeight(4, 0)).toBe(900);

    // a size of 0 hides
    f.SetWidthOrHeight(false, [{ mnStart: 6, mnEnd: 7 }], 0, ScSizeMode.SC_SIZE_DIRECT, 0);
    expect(doc.RowHidden(6, 0)).toBe(true);
    undo(sh);
    expect(doc.RowHidden(6, 0)).toBe(false);

    // optimal width
    putAll(doc, { E1: 'a rather long text in this cell' });
    f.SetWidthOrHeight(true, [{ mnStart: 4, mnEnd: 4 }], 0, ScSizeMode.SC_SIZE_OPTIMAL, 0);
    expect(doc.GetColWidth(4, 0)).toBeGreaterThan(w0);
    expect(sh.GetUndoManager().GetUndoActionComment()).toBe('Optimal Column Width');
    undo(sh);
    expect(doc.GetColWidth(4, 0)).toBe(w0);
  });
});

describe('ScDocFunc: merging', () => {
  it('MergeCells with contents and UnmergeCells, with undo and redo', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 'a', B1: 'b', A2: 'c', D1: '=B1' });
    const f = sh.GetDocFunc();
    const aOption = new ScCellMergeOption(new ScRange(0, 0, 0, 1, 1, 0));
    expect(f.MergeCells(aOption, true)).toBe(true);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(true);
    expect(doc.IsOverlapped(addr(doc, 'B2'))).toBe(true);
    expect(str(doc, 'A1')).toBe('a b c');
    expect(doc.GetCellType(addr(doc, 'B1'))).toBe(CELLTYPE_NONE);
    expect(val(doc, 'D1')).toBe(0);
    undo(sh);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(false);
    expect(doc.IsOverlapped(addr(doc, 'B2'))).toBe(false);
    expect([str(doc, 'A1'), str(doc, 'B1'), str(doc, 'A2')]).toEqual(['a', 'b', 'c']);
    expect(str(doc, 'D1')).toBe('b');
    redo(sh);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(true);
    expect(str(doc, 'A1')).toBe('a b c');

    // merging merged cells is refused
    expect(f.MergeCells(new ScCellMergeOption(new ScRange(1, 1, 0, 2, 2, 0)), false, true, true)).toBe(false);

    expect(f.UnmergeCells(new ScRange(0, 0, 0, 1, 1, 0))).toBe(true);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(false);
    expect(doc.IsOverlapped(addr(doc, 'B1'))).toBe(false);
    undo(sh);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(true);
    expect(doc.IsOverlapped(addr(doc, 'B1'))).toBe(true);
    redo(sh);
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(false);
  });

  it('MergeCells without contents keeps the hidden cells; centering', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 'a', B1: 'b' });
    const aOption = new ScCellMergeOption(0, 0, 1, 0, true);
    aOption.maTabs.add(0);
    sh.GetDocFunc().MergeCells(aOption, false);
    expect(str(doc, 'B1')).toBe('b');
    expect(doc.GetPattern(addr(doc, 'A1')).GetItem('ATTR_HOR_JUSTIFY')).toBe('Center');
    undo(sh);
    expect(doc.GetPattern(addr(doc, 'A1')).GetItem('ATTR_HOR_JUSTIFY')).toBe('Standard');
    expect(doc.IsMerged(addr(doc, 'A1'))).toBe(false);
  });
});

describe('ScDocFunc: sheets', () => {
  it('testRenameTable and its undo', () => {
    const { doc, sh } = shell(2);
    const f = sh.GetDocFunc();
    // rename table2 to sheet 1, it should return error
    expect(f.RenameTable(1, 'Sheet1', false, true)).toBe(false);
    expect(f.RenameTable(0, 'test1')).toBe(true);
    expect(doc.GetName(0)).toBe('test1');
    expect(f.RenameTable(0, 'test2')).toBe(true);
    undo(sh);
    expect(doc.GetName(0)).toBe('test1');
    redo(sh);
    expect(doc.GetName(0)).toBe('test2');
  });

  it('InsertTable and DeleteTable with references, undo and redo', () => {
    const { doc, sh } = shell(2);
    putAll(doc, { A1: 5, 'Sheet2.A1': '=Sheet1.A1*2', 'Sheet2.B1': 'x' });
    doc.ApplyAttr(1, 0, 1, { ATTR_FONT_WEIGHT: true });
    doc.SetTabBgColor(1, '#ff0000');
    const f = sh.GetDocFunc();
    expect(f.InsertTable(1, 'New')).toBe(true);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'New', 'Sheet2']);
    expect(doc.GetFormula(0, 0, 2)).toBe('=Sheet1.A1*2');
    undo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'Sheet2']);
    redo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'New', 'Sheet2']);
    undo(sh);

    // delete the first sheet: Sheet2's reference becomes #REF!
    expect(f.DeleteTable(0)).toBe(true);
    expect(doc.GetAllTableNames()).toEqual(['Sheet2']);
    expect(doc.GetFormula(0, 0, 0)).toBe('=#REF!.A1*2');
    undo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'Sheet2']);
    expect(doc.GetValue(0, 0, 0)).toBe(5);
    expect(doc.GetFormula(0, 0, 1)).toBe('=Sheet1.A1*2');
    expect(doc.GetValue(0, 0, 1)).toBe(10);
    redo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet2']);
    undo(sh);

    // delete the second sheet: its contents, attributes and colour come back
    f.DeleteTable(1);
    undo(sh);
    expect(doc.GetString(1, 0, 1)).toBe('x');
    expect(doc.GetPattern(1, 0, 1).GetItem('ATTR_FONT_WEIGHT')).toBe(true);
    expect(doc.GetTabBgColor(1)).toBe('#ff0000');
    expect(doc.GetValue(0, 0, 1)).toBe(10);
  });

  it('MoveTable and copying a sheet with undo and redo', () => {
    const { doc, sh } = shell(3);
    putAll(doc, { 'Sheet1.A1': 1, 'Sheet3.A1': '=Sheet1.A1+1' });
    expect(sh.MoveTable(0, 2, false, true)).toBe(true);
    expect(doc.GetAllTableNames()).toEqual(['Sheet2', 'Sheet3', 'Sheet1']);
    expect(doc.GetValue(0, 0, 1)).toBe(2);
    undo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'Sheet2', 'Sheet3']);
    expect(doc.GetFormula(0, 0, 2)).toBe('=Sheet1.A1+1');
    expect(doc.GetValue(0, 0, 2)).toBe(2);
    redo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet2', 'Sheet3', 'Sheet1']);
    undo(sh);

    expect(sh.MoveTable(0, 1, true, true)).toBe(true);
    expect(doc.GetTableCount()).toBe(4);
    expect(doc.GetValue(0, 0, 1)).toBe(1);
    const aCopyName = doc.GetName(1);
    undo(sh);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'Sheet2', 'Sheet3']);
    redo(sh);
    expect(doc.GetName(1)).toBe(aCopyName);
    expect(doc.GetValue(0, 0, 1)).toBe(1);
  });
});

describe('ScDocFunc: array formulas', () => {
  it('testEnterMixedMatrix-like: EnterMatrix with undo and redo', () => {
    const { doc, sh } = shell();
    putAll(doc, { A1: 1, A2: 2, B1: 3, B2: 4, D1: 'old' });
    expect(sh.GetDocFunc().EnterMatrix(new ScRange(3, 0, 0, 4, 1, 0), null, null, '=A1:B2*10')).toBe(true);
    expect([val(doc, 'D1'), val(doc, 'E1'), val(doc, 'D2'), val(doc, 'E2')]).toEqual([10, 30, 20, 40]);
    undo(sh);
    expect(str(doc, 'D1')).toBe('old');
    expect(doc.GetCellType(addr(doc, 'E2'))).toBe(CELLTYPE_NONE);
    redo(sh);
    expect(val(doc, 'E2')).toBe(40);
  });
});

describe('ScDocShell', () => {
  it('posts paints and modification notices; the undo manager records a list action per EnterData', () => {
    const { doc, sh } = shell();
    const paints: string[] = [];
    let changes = 0;
    sh.AddPaintListener((h) => paints.push(`${h.aRange.aStart.Col()},${h.aRange.aStart.Row()}`));
    sh.AddChangeListener(() => changes++);
    sh.GetDocFunc().EnterData(addr(doc, 'B3'), '1');
    expect(paints).toContain('1,2');
    expect(changes).toBeGreaterThan(0);
    expect(doc.GetModifyCount()).toBeGreaterThan(0);
  });

  it('records nothing while undo is disabled in the document', () => {
    const { doc, sh } = shell();
    doc.EnableUndo(false);
    sh.GetDocFunc().SetValueCell(addr(doc, 'A1'), 1);
    expect(sh.GetUndoManager().GetUndoActionCount()).toBe(0);
  });
});
