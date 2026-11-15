// AutoFilter and the standard filter: database ranges (dbdata.cxx), ScTable::Query, the view's
// ToggleAutoFilter/Query with undo, and the filter entries of a column. Translated from
// ucalc.cxx (testAutofilter, testAutoFilterTimeValue) and extended.
import { describe, expect, test } from 'vitest';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { ScQueryOp } from '../../src/lo/sc/inc/global.ts';
import { ScInputOptions } from '../../src/lo/sc/inc/inputopt.ts';
import { ScQueryEntry } from '../../src/lo/sc/inc/queryentry.ts';
import { ScQueryParam } from '../../src/lo/sc/inc/queryparam.ts';
import { ScMF } from '../../src/lo/sc/inc/scitems.ts';
import { ScFilterEntries } from '../../src/lo/sc/inc/filterentries.ts';
import { ScDBData, STR_DB_GLOBAL_NONAME, STR_DB_LOCAL_NONAME } from '../../src/lo/sc/source/core/tool/dbdata.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScTabViewShell } from '../../src/lo/sc/source/ui/view/tabvwsh.ts';
import { newDoc, putAll } from './calchelper.ts';

function hiddenRange(doc: ReturnType<typeof newDoc>, nRow: number): [boolean, number, number] {
  const r = doc.FetchTable(0)!.RowHiddenRange(nRow);
  return [r.bHidden, r.nFirstRow, r.nLastRow];
}

describe('ScTable::Query', () => {
  test('testAutofilter', () => {
    const doc = newDoc();
    const aData = [['C1', 'C2', 'C3'], ['0', '1', 'A'], ['1', '2', null], ['1', '2', 'B'], ['0', '2', 'B']];
    aData.forEach((row, i) => row.forEach((v, j) => { if (v !== null) doc.SetString(new ScAddress(j, i, 0), v); }));
    const pDBData = new ScDBData('NONAME', 0, 0, 0, 2, 4);
    doc.SetAnonymousDBData(0, pDBData);
    pDBData.SetAutoFilter(true);
    const aRange = pDBData.GetArea();
    doc.ApplyFlagsTab(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aStart.Row(), aRange.aStart.Tab(), ScMF.Auto);

    const aParam = pDBData.GetQueryParam();
    const rEntry = aParam.GetEntry(0);
    rEntry.bDoQuery = true;
    rEntry.nField = 0;
    rEntry.eOp = ScQueryOp.SC_EQUAL;
    rEntry.GetQueryItem().mfVal = 0;
    pDBData.SetQueryParam(aParam);
    doc.Query(0, aParam, true);
    expect(hiddenRange(doc, 2)).toEqual([true, 2, 3]);

    // Remove filtering.
    rEntry.Clear();
    doc.Query(0, aParam, true);
    expect(hiddenRange(doc, 0)).toEqual([false, 0, doc.MaxRow()]);

    // Filter for non-empty cells by column C.
    rEntry.bDoQuery = true;
    rEntry.nField = 2;
    rEntry.SetQueryByNonEmpty();
    doc.Query(0, aParam, true);
    expect(hiddenRange(doc, 0)).toEqual([false, 0, 1]);
    expect(hiddenRange(doc, 2)).toEqual([true, 2, 2]);
    expect(hiddenRange(doc, 3)).toEqual([false, 3, doc.MaxRow()]);

    // Now, filter for empty cells by column C.
    rEntry.SetQueryByEmpty();
    doc.Query(0, aParam, true);
    expect(hiddenRange(doc, 0)).toEqual([false, 0, 0]);
    expect(hiddenRange(doc, 1)).toEqual([true, 1, 1]);
    expect(hiddenRange(doc, 2)).toEqual([false, 2, 2]);
    expect(hiddenRange(doc, 3)).toEqual([true, 3, 4]);
    expect(hiddenRange(doc, 5)).toEqual([false, 5, doc.MaxRow()]);
    expect(doc.RowFiltered(3, 0)).toBe(true);
  });

  test('testAutoFilterTimeValue', () => {
    const doc = newDoc();
    doc.SetString(new ScAddress(0, 0, 0), 'Hours');
    doc.SetValue(new ScAddress(0, 1, 0), 72.3604166666671);
    doc.SetValue(new ScAddress(0, 2, 0), 265);
    const pDBData = new ScDBData(STR_DB_GLOBAL_NONAME, 0, 0, 0, 0, 2);
    doc.SetAnonymousDBData(0, pDBData);
    doc.ApplyAttr(0, 1, 0, { ATTR_VALUE_FORMAT: '[HH]:MM:SS' });
    doc.ApplyAttr(0, 2, 0, { ATTR_VALUE_FORMAT: '[HH]:MM:SS' });
    expect(doc.GetString(new ScAddress(0, 1, 0))).toBe('1736:39:00');
    expect(doc.GetString(new ScAddress(0, 2, 0))).toBe('6360:00:00');

    const aParam = pDBData.GetQueryParam();
    const rEntry = aParam.GetEntry(0);
    rEntry.bDoQuery = true;
    rEntry.nField = 0;
    rEntry.eOp = ScQueryOp.SC_EQUAL;
    rEntry.GetQueryItem().maString = '1736:39:00';
    rEntry.GetQueryItem().meType = ScQueryEntry.ByString;
    pDBData.SetQueryParam(aParam);
    doc.Query(0, aParam, true);
    expect(doc.RowFiltered(0, 0)).toBe(false);
    expect(doc.RowFiltered(1, 0)).toBe(false);
    expect(doc.RowFiltered(2, 0)).toBe(true);
  });

  test('Top 10 and duplicates', () => {
    const doc = newDoc();
    putAll(doc, { A1: 'N', A2: 5, A3: 1, A4: 9, A5: 3, A6: 7, A7: 9 });
    const pDBData = new ScDBData(STR_DB_LOCAL_NONAME, 0, 0, 0, 0, 6);
    doc.SetAnonymousDBData(0, pDBData);
    const aParam = pDBData.GetQueryParam();
    const rEntry = aParam.GetEntry(0);
    rEntry.bDoQuery = true;
    rEntry.nField = 0;
    rEntry.eOp = ScQueryOp.SC_TOPVAL;
    rEntry.GetQueryItem().mfVal = 2;
    expect(doc.Query(0, aParam, false)).toBe(2); // the largest value 2 times: 9 and 9
    expect([1, 2, 3, 4, 5, 6].map((r) => doc.RowFiltered(r, 0))).toEqual([true, true, false, true, true, false]);
    rEntry.eOp = ScQueryOp.SC_TOPVAL;
    rEntry.GetQueryItem().mfVal = 3;
    expect(doc.Query(0, aParam, false)).toBe(3); // 9, 9 and 7
    rEntry.eOp = ScQueryOp.SC_GREATER;
    rEntry.GetQueryItem().mfVal = 0;
    aParam.bDuplicate = false;
    expect(doc.Query(0, aParam, false)).toBe(5);
    expect(doc.RowFiltered(6, 0)).toBe(true);
  });
});

function view() {
  const sh = new ScDocShell();
  const v = new ScTabViewShell(sh, () => new ScInputOptions());
  v.GetViewData().SetScrSize(1000, 600);
  return { sh, doc: sh.GetDocument(), v };
}

describe('the AutoFilter of the view', () => {
  function setup() {
    const r = view();
    putAll(r.doc, { A1: 'Name', B1: 'Value', A2: 'a', B2: 1, A3: 'b', B3: 2, A4: 'a', B4: 3, A5: 'c', B5: 4 });
    r.v.SetCursor(0, 0);
    return r;
  }

  test('ToggleAutoFilter makes an anonymous range with buttons, undoably', () => {
    const { doc, v, sh } = setup();
    v.ToggleAutoFilter();
    const pDBData = doc.GetAnonymousDBData(0)!;
    expect(pDBData).not.toBeNull();
    expect(pDBData.GetName()).toBe(STR_DB_LOCAL_NONAME);
    expect(pDBData.GetArea()).toEqual(new ScRange(0, 0, 0, 1, 4, 0));
    expect(pDBData.HasAutoFilter()).toBe(true);
    expect(pDBData.HasHeader()).toBe(true);
    expect(doc.GetAttr(0, 0, 0, 'ATTR_MERGE_FLAG') & ScMF.Auto).toBeTruthy();
    expect(doc.HasAutoFilter(0, 2, 0)).toBe(true);
    sh.GetUndoManager().Undo();
    expect(doc.GetAttr(0, 0, 0, 'ATTR_MERGE_FLAG') & ScMF.Auto).toBe(0);
    sh.GetUndoManager().Redo();
    expect(doc.GetAttr(1, 0, 0, 'ATTR_MERGE_FLAG') & ScMF.Auto).toBeTruthy();
  });

  test('filtering a column hides rows, the entries list what is left, undo shows them again', () => {
    const { doc, v, sh } = setup();
    v.ToggleAutoFilter();
    const pDBData = doc.GetAnonymousDBData(0)!;
    const aParam = pDBData.GetQueryParam();
    const rEntry = aParam.GetEntry(0);
    rEntry.bDoQuery = true;
    rEntry.nField = 0;
    rEntry.eOp = ScQueryOp.SC_EQUAL;
    const rItems = rEntry.GetQueryItems();
    rItems[0]!.meType = ScQueryEntry.ByString;
    rItems[0]!.maString = 'a';
    v.Query(aParam);
    expect([1, 2, 3, 4].map((r) => doc.RowHidden(r, 0))).toEqual([false, true, false, true]);
    expect(pDBData.GetFilterSelCount()).toEqual({ nSelected: 2, nTotal: 4 });

    // the other column's entries: the hidden ones are marked
    const aEntries = new ScFilterEntries();
    doc.GetFilterEntries(1, 0, 0, aEntries);
    expect(aEntries.maStrData.map((e) => [e.GetString(), e.IsHiddenByFilter()])).toEqual([['1', false], ['3', false], ['2', true], ['4', true]]);
    // its own column lists all
    const aOwn = new ScFilterEntries();
    doc.GetFilterEntries(0, 0, 0, aOwn);
    expect(aOwn.maStrData.map((e) => e.GetString())).toEqual(['a', 'b', 'c']);

    sh.GetUndoManager().Undo();
    expect([1, 2, 3, 4].map((r) => doc.RowHidden(r, 0))).toEqual([false, false, false, false]);
    sh.GetUndoManager().Redo();
    expect(doc.RowHidden(2, 0)).toBe(true);

    // Clear the column's filter at the cursor (ClearAutoFilter)
    v.SetCursor(0, 2);
    v.ClearAutoFilter();
    expect(doc.RowHidden(2, 0)).toBe(false);

    // switching the AutoFilter off removes the filter too
    v.SetCursor(0, 0);
    v.Query(aParam);
    expect(doc.RowHidden(2, 0)).toBe(true);
    v.ToggleAutoFilter();
    expect(doc.RowHidden(2, 0)).toBe(false);
    expect(doc.GetAttr(0, 0, 0, 'ATTR_MERGE_FLAG') & ScMF.Auto).toBe(0);
    sh.GetUndoManager().Undo(); // one list action: buttons and filter back
    expect(doc.RowHidden(2, 0)).toBe(true);
    expect(doc.GetAttr(0, 0, 0, 'ATTR_MERGE_FLAG') & ScMF.Auto).toBeTruthy();
  });

  test('the database range follows inserted and deleted rows and columns', () => {
    const { doc, v } = setup();
    v.ToggleAutoFilter();
    doc.InsertRow(0, 0, doc.MaxCol(), 0, 2, 1);
    expect(doc.GetAnonymousDBData(0)!.GetArea()).toEqual(new ScRange(0, 0, 0, 1, 5, 0));
    doc.InsertCol(0, 0, doc.MaxRow(), 0, 0, 1);
    expect(doc.GetAnonymousDBData(0)!.GetArea()).toEqual(new ScRange(1, 0, 0, 2, 5, 0));
    doc.DeleteRow(0, 0, doc.MaxCol(), 0, 1, 2);
    expect(doc.GetAnonymousDBData(0)!.GetArea()).toEqual(new ScRange(1, 0, 0, 2, 3, 0));
  });

  test('a standard filter copying the results elsewhere', () => {
    const { doc, v, sh } = setup();
    const pDBData = v.GetDBData(false)!;
    const aParam = pDBData.GetQueryParam();
    const rEntry = aParam.GetEntry(0);
    rEntry.bDoQuery = true;
    rEntry.nField = 1;
    rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
    rEntry.GetQueryItem().mfVal = 3;
    aParam.bInplace = false;
    aParam.nDestTab = 0;
    aParam.nDestCol = 4;
    aParam.nDestRow = 0;
    v.Query(aParam);
    expect(doc.RowHidden(1, 0)).toBe(false);
    expect([0, 1, 2].map((r) => doc.GetString(new ScAddress(4, r, 0)))).toEqual(['Name', 'a', 'c']);
    expect(doc.GetValue(new ScAddress(5, 2, 0))).toBe(4);
    sh.GetUndoManager().Undo();
    expect(doc.GetString(new ScAddress(4, 0, 0))).toBe('');
  });

  test('a new query param is empty', () => {
    expect(new ScQueryParam().GetEntry(0).bDoQuery).toBe(false);
  });
});
