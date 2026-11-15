// Translated from sc/qa/unit/ucalc_sort.cxx (testSort, testSortWithStrings, testSortWithFormulaRefs,
// testSortSingleRow, testSortWithCellFormats) and extended with ScDBDocFunc::Sort with undo and
// redo, several keys, case sensitivity, sort lists and sorting by columns.
import { describe, expect, it } from 'vitest';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { CELLTYPE_NONE } from '../../src/lo/sc/inc/cellvalue.ts';
import { ReorderParam, ScSortParam } from '../../src/lo/sc/inc/sortparam.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { ScDBDocFunc } from '../../src/lo/sc/source/ui/docshell/dbdocfun.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { GetUserList } from '../../src/lo/sc/source/core/tool/userlist.ts';
import { addr, formula, newDoc, putAll, str, val } from './calchelper.ts';

function param(nCol1: number, nRow1: number, nCol2: number, nRow2: number, keys: { nField: number; bAscending?: boolean }[], extra: Partial<ScSortParam> = {}): ScSortParam {
  const p = new ScSortParam();
  p.nCol1 = nCol1;
  p.nRow1 = nRow1;
  p.nCol2 = nCol2;
  p.nRow2 = nRow2;
  keys.forEach((k, i) => {
    p.maKeyState[i]!.bDoSort = true;
    p.maKeyState[i]!.nField = k.nField;
    p.maKeyState[i]!.bAscending = k.bAscending ?? true;
  });
  Object.assign(p, extra);
  return p;
}

const colStrings = (doc: ScDocument, nCol: number, nRow1: number, nRow2: number): string[] => {
  const a: string[] = [];
  for (let r = nRow1; r <= nRow2; r++) a.push(doc.GetString(nCol, r, 0));
  return a;
};

describe('Calc sort (table3.cxx, dbdocfun.cxx)', () => {
  it('testSort: notes move, numbers before strings, empty cells last, header stays', () => {
    const doc = newDoc();
    putAll(doc, { A1: 2, B1: 4, A2: 4, B2: 1, A3: 1, B3: 2, A4: 1, B4: 23 });
    // Insert note in cell B2.
    doc.SetNote(new ScAddress(1, 1, 0), { maText: 'Hello', maAuthor: 'Jim Bob', maDate: '', mbShown: false });

    const aSortData = param(1, 0, 1, 2, [{ nField: 1 }]);
    doc.Sort(0, aSortData, false, true);
    expect(doc.GetValue(1, 0, 0)).toBe(1);
    // check that note is also moved after sorting
    expect(doc.GetNote(new ScAddress(1, 0, 0))?.maText).toBe('Hello');

    doc.DeleteAreaTab(0, 0, 1, 9, 0, 0x1ff);
    putAll(doc, { A1: 'Title', A4: 12, A5: 'b', A6: 1, A7: 9, A8: 123 });
    const p2 = param(0, 0, 0, 7, [{ nField: 0 }], { bHasHeader: true });
    doc.Sort(0, p2, false, true);
    // Title should stay at the top, numbers should be sorted numerically,
    // numbers always come before strings, and empty cells always occur at the end.
    expect(colStrings(doc, 0, 0, 5)).toEqual(['Title', '1', '9', '12', '123', 'b']);
    expect(doc.GetCellType(new ScAddress(0, 6, 0))).toBe(CELLTYPE_NONE);
  });

  it('testSortWithStrings: edit cells, ascending and descending', () => {
    const doc = newDoc();
    doc.SetString(new ScAddress(1, 1, 0), 'Header');
    doc.SetString(new ScAddress(1, 2, 0), 'Val2');
    doc.SetTextCell(new ScAddress(1, 3, 0), 'Val\n1');
    const aParam = param(1, 1, 1, 3, [{ nField: 1 }], { bHasHeader: true });
    doc.Sort(0, aParam, false, true);
    expect(colStrings(doc, 1, 1, 3)).toEqual(['Header', 'Val\n1', 'Val2']);
    aParam.maKeyState[0]!.bAscending = false;
    doc.Sort(0, aParam, false, true);
    expect(colStrings(doc, 1, 1, 3)).toEqual(['Header', 'Val2', 'Val\n1']);
  });

  it('testSortWithFormulaRefs: the sorted data, formulas on another sheet unchanged', () => {
    const doc = newDoc(2);
    doc.RenameTab(0, 'List1');
    doc.RenameTab(1, 'List2');
    const aTextData = ['bob', 'tim', 'brian', 'larry'];
    for (let i = 1; i <= 4; ++i) doc.SetString(0, i, 0, aTextData[i - 1]!);
    for (let i = 0; i < 6; ++i) doc.SetString(0, i, 1, `=IF($List1.A${i + 2}<>"";$List1.A${i + 2};"")`);
    doc.Sort(0, param(0, 1, 0, 7, [{ nField: 0 }]), false, true);
    expect(colStrings(doc, 0, 1, 6)).toEqual(['bob', 'brian', 'larry', 'tim', '', '']);
    // the formulas on List2 follow the values at their (unchanged) references
    expect(doc.GetString(0, 1, 1)).toBe('brian');
    expect(doc.GetFormula(0, 1, 1)).toBe('=IF($List1.A3<>"",$List1.A3,"")');
  });

  it('formulas moved by a row sort keep their relative references relative', () => {
    const doc = newDoc();
    // B = A * 10, sorted by A descending: each formula moves with its row
    putAll(doc, { A1: 1, A2: 3, A3: 2, B1: '=A1*10', B2: '=A2*10', B3: '=A3*10', C1: '=$A$1' });
    doc.Sort(0, param(0, 0, 2, 2, [{ nField: 0, bAscending: false }]), false, false);
    expect(colStrings(doc, 0, 0, 2)).toEqual(['3', '2', '1']);
    expect([formula(doc, 'B1'), formula(doc, 'B2'), formula(doc, 'B3')]).toEqual(['=A1*10', '=A2*10', '=A3*10']);
    expect([val(doc, 'B1'), val(doc, 'B2'), val(doc, 'B3')]).toEqual([30, 20, 10]);
    // the absolute reference moved to row 3 still points to $A$1
    expect(formula(doc, 'C3')).toBe('=$A$1');
    expect(val(doc, 'C3')).toBe(3);
  });

  it('testSortSingleRow: a one-row range is left alone', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'X', B1: 'Y' });
    const aSortData = param(0, 0, 1, 0, [{ nField: 0 }]);
    doc.Sort(0, aSortData, false, true);
    expect(str(doc, 'A1')).toBe('X');
    // sort by column (horizontally) with a header column
    const p2 = param(0, 0, 1, 0, [{ nField: 0 }], { bByRow: false, bHasHeader: true });
    doc.Sort(0, p2, false, true);
    expect([str(doc, 'A1'), str(doc, 'B1')]).toEqual(['X', 'Y']);
  });

  it('testSortWithCellFormats: the cell formats move with the cells', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'Header', A2: 'Normal', A3: 'Bold', A4: 'Italic' });
    doc.ApplyAttr(0, 2, 0, { ATTR_FONT_WEIGHT: true });
    doc.ApplyAttr(0, 3, 0, { ATTR_FONT_POSTURE: true });
    const sh = new ScDocShell(doc);
    new ScDBDocFunc(sh).Sort(0, param(0, 0, 0, 3, [{ nField: 0 }], { bHasHeader: true }));
    expect(colStrings(doc, 0, 0, 3)).toEqual(['Header', 'Bold', 'Italic', 'Normal']);
    expect(doc.GetPattern(0, 1, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(true);
    expect(doc.GetPattern(0, 2, 0).GetItem('ATTR_FONT_POSTURE')).toBe(true);
    expect(doc.GetPattern(0, 3, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(false);

    sh.GetUndoManager().Undo();
    expect(colStrings(doc, 0, 0, 3)).toEqual(['Header', 'Normal', 'Bold', 'Italic']);
    expect(doc.GetPattern(0, 2, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(true);
    expect(doc.GetPattern(0, 3, 0).GetItem('ATTR_FONT_POSTURE')).toBe(true);
    expect(doc.GetPattern(0, 1, 0).GetItem('ATTR_FONT_WEIGHT')).toBe(false);
  });

  it('several keys, descending, and case sensitivity', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'b', B1: 2, A2: 'a', B2: 1, A3: 'b', B3: 1, A4: 'A', B4: 3, A5: 'B', B5: 0 });
    // by A ascending (case-insensitive: a = A, b = B keep their order), then B descending
    doc.Sort(0, param(0, 0, 1, 4, [{ nField: 0 }, { nField: 1, bAscending: false }]), false, false);
    expect(colStrings(doc, 0, 0, 4)).toEqual(['A', 'a', 'b', 'b', 'B']);
    expect(colStrings(doc, 1, 0, 4)).toEqual(['3', '1', '2', '1', '0']);
    // case-sensitive: lower case before upper case
    doc.Sort(0, param(0, 0, 1, 4, [{ nField: 0 }], { bCaseSens: true }), false, false);
    expect(colStrings(doc, 0, 0, 4)).toEqual(['a', 'A', 'b', 'b', 'B']);
  });

  it('errors sort after numbers and strings', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=1/0', A2: 'x', A3: 5, A4: -1 });
    doc.Sort(0, param(0, 0, 0, 3, [{ nField: 0 }]), false, false);
    expect(colStrings(doc, 0, 0, 3)).toEqual(['-1', '5', 'x', '#DIV/0!']);
  });

  it('sorts by a sort list (month names)', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'March', A2: 'January', A3: 'December', A4: 'February' });
    const nMonths = [...Array(GetUserList().size()).keys()].find((i) => GetUserList().at(i).GetSubStr(0) === 'January')!;
    doc.Sort(0, param(0, 0, 0, 3, [{ nField: 0 }], { bUserDef: true, nUserIndex: nMonths }), false, false);
    expect(colStrings(doc, 0, 0, 3)).toEqual(['January', 'February', 'March', 'December']);
  });

  it('sorts columns by a row (bByRow false), formulas keep relative references', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'key', B1: 3, C1: 1, D1: 2, B2: 'three', C2: 'one', D2: 'two', B3: '=B1*2', C3: '=C1*2', D3: '=D1*2' });
    const sh = new ScDocShell(doc);
    new ScDBDocFunc(sh).Sort(0, param(0, 0, 3, 2, [{ nField: 0 }], { bByRow: false, bHasHeader: true }));
    expect(['A2', 'B2', 'C2', 'D2'].map((a) => str(doc, a))).toEqual(['', 'one', 'two', 'three']);
    expect(['B3', 'C3', 'D3'].map((a) => formula(doc, a))).toEqual(['=B1*2', '=C1*2', '=D1*2']);
    expect(['B3', 'C3', 'D3'].map((a) => val(doc, a))).toEqual([2, 4, 6]);
    sh.GetUndoManager().Undo();
    expect(['B2', 'C2', 'D2'].map((a) => str(doc, a))).toEqual(['three', 'one', 'two']);
    expect(['B3', 'C3', 'D3'].map((a) => val(doc, a))).toEqual([6, 2, 4]);
    sh.GetUndoManager().Redo();
    expect(['B2', 'C2', 'D2'].map((a) => str(doc, a))).toEqual(['one', 'two', 'three']);
  });

  it('ScDBDocFunc::Sort undo and redo restore contents, formulas and dependent results', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'Name', B1: 'Score', A2: 'Carl', B2: 70, A3: 'Anna', B3: 90, A4: 'Bert', B4: 80, C2: '=B2+1', C3: '=B3+1', C4: '=B4+1', E1: '=B2' });
    const sh = new ScDocShell(doc);
    const fn = new ScDBDocFunc(sh);
    expect(fn.Sort(0, param(0, 0, 2, 3, [{ nField: 1, bAscending: false }], { bHasHeader: true }))).toBe(true);
    expect(colStrings(doc, 0, 0, 3)).toEqual(['Name', 'Anna', 'Bert', 'Carl']);
    expect(colStrings(doc, 2, 1, 3)).toEqual(['91', '81', '71']);
    expect([formula(doc, 'C2'), formula(doc, 'C3'), formula(doc, 'C4')]).toEqual(['=B2+1', '=B3+1', '=B4+1']);
    // a reference from outside the range is not changed and sees the new value
    expect(formula(doc, 'E1')).toBe('=B2');
    expect(val(doc, 'E1')).toBe(90);
    expect(sh.GetUndoManager().GetUndoActionComment()).toBe('Sort');

    sh.GetUndoManager().Undo();
    expect(colStrings(doc, 0, 0, 3)).toEqual(['Name', 'Carl', 'Anna', 'Bert']);
    expect(colStrings(doc, 2, 1, 3)).toEqual(['71', '91', '81']);
    expect(val(doc, 'E1')).toBe(70);

    sh.GetUndoManager().Redo();
    expect(colStrings(doc, 0, 0, 3)).toEqual(['Name', 'Anna', 'Bert', 'Carl']);
    expect(val(doc, 'E1')).toBe(90);
  });

  it('ScDBDocFunc::Sort shrinks the range to the data and refuses merged cells', () => {
    const doc = newDoc();
    putAll(doc, { A1: 3, A2: 1, A3: 2 });
    const sh = new ScDocShell(doc);
    const fn = new ScDBDocFunc(sh);
    // the whole column: the trailing empty rows are not sorted to the top
    expect(fn.Sort(0, param(0, 0, 0, doc.MaxRow(), [{ nField: 0 }]))).toBe(true);
    expect(colStrings(doc, 0, 0, 2)).toEqual(['1', '2', '3']);
    putAll(doc, { B1: 'x', B2: 'y', B3: 'z' });
    doc.DoMerge(1, 0, 1, 1, 0);
    expect(fn.Sort(0, param(0, 0, 1, 2, [{ nField: 0, bAscending: false }]), true, true, true)).toBe(false);
  });

  it('ReorderParam::reverse inverts a permutation', () => {
    const p = new ReorderParam();
    p.mbByRow = true;
    p.maSortRange.aStart.SetRow(2);
    p.maSortRange.aEnd.SetRow(5);
    p.maOrderIndices = [4, 2, 5, 3];
    p.reverse();
    expect(p.maOrderIndices).toEqual([3, 5, 2, 4]);
    void addr;
  });
});
