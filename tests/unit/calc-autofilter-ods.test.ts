// Database ranges, AutoFilter and filters in ODS (xmldrani.cxx, xmlfilti.cxx,
// XMLExportDatabaseRanges.cxx): upstream's database.ods (subsequent_filters_test.cxx,
// testDatabaseRangesODS) and round trips.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { ScDBDocFunc } from '../../src/lo/sc/source/ui/docshell/dbdocfun.ts';
import { ScQueryConnect, ScQueryOp } from '../../src/lo/sc/inc/global.ts';
import { ScQueryEntry } from '../../src/lo/sc/inc/queryentry.ts';
import { ScInputOptions } from '../../src/lo/sc/inc/inputopt.ts';
import { ScMF } from '../../src/lo/sc/inc/scitems.ts';
import { ExportFODS, ImportFODS, ImportODS } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScTabViewShell } from '../../src/lo/sc/source/ui/view/tabvwsh.ts';
import { putAll } from './calchelper.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/', import.meta.url);

describe('database ranges in ODS', () => {
  test('testDatabaseRangesODS', async () => {
    const { doc: sh, lost } = await ImportODS(new Uint8Array(readFileSync(new URL('ods/database.ods', DATA))));
    const rDoc = sh.GetDocument();
    rDoc.CalcAll();
    expect(lost).toEqual([]);
    expect(rDoc.GetAnonymousDBData(0)).not.toBeNull();
    const h = (r: number) => { const x = rDoc.FetchTable(0)!.RowHiddenRange(r); return [x.bHidden, x.nFirstRow, x.nLastRow]; };
    expect(h(0)).toEqual([false, 0, 0]);
    expect(h(1)).toEqual([true, 1, 2]);
    expect(h(3)).toEqual([false, 3, 3]);
    expect(h(4)).toEqual([true, 4, 5]);
    expect(h(6)).toEqual([false, 6, rDoc.MaxRow()]);
    expect(rDoc.GetValue(new ScAddress(0, 10, 1))).toBe(4);
    expect(rDoc.GetValue(new ScAddress(1, 10, 1))).toBe(2);
    expect(rDoc.GetValue(new ScAddress(3, 10, 1))).toBe(4);
    expect(rDoc.GetValue(new ScAddress(4, 10, 1))).toBe(2);
  });

  test('an AutoFilter with a multi-value and an or condition survives a round trip', () => {
    const sh = new ScDocShell();
    const v = new ScTabViewShell(sh, () => new ScInputOptions());
    const doc = sh.GetDocument();
    putAll(doc, { A1: 'Name', B1: 'Value', A2: 'a', B2: 1, A3: 'b', B3: 2, A4: 'c', B4: 3, A5: 'd', B5: 4 });
    v.SetCursor(0, 0);
    v.ToggleAutoFilter();
    const pDBData = doc.GetAnonymousDBData(0)!;
    const aParam = pDBData.GetQueryParam();
    const e0 = aParam.GetEntry(0);
    e0.bDoQuery = true; e0.nField = 0; e0.eOp = ScQueryOp.SC_EQUAL;
    const items = e0.GetQueryItems();
    items[0]!.maString = 'a'; items[0]!.meType = ScQueryEntry.ByString;
    const second = items[0]!.clone(); second.maString = 'c'; items.push(second);
    const e1 = aParam.GetEntry(1);
    e1.bDoQuery = true; e1.nField = 1; e1.eOp = ScQueryOp.SC_GREATER_EQUAL; e1.eConnect = ScQueryConnect.SC_OR;
    e1.GetQueryItem().meType = ScQueryEntry.ByValue; e1.GetQueryItem().mfVal = 4;
    v.Query(aParam);
    expect([1, 2, 3, 4].map((r) => doc.RowHidden(r, 0))).toEqual([false, true, false, false]);

    const xml = ExportFODS(sh);
    expect(xml).toContain('table:display-filter-buttons="true"');
    expect(xml).toContain('<table:filter-set-item table:value="c"/>');
    const { doc: sh2, lost } = ImportFODS(xml);
    expect(lost).toEqual([]);
    const d2 = sh2.GetDocument();
    const p2 = d2.GetAnonymousDBData(0)!;
    expect(p2.HasAutoFilter()).toBe(true);
    expect(d2.GetAttr(1, 0, 0, 'ATTR_MERGE_FLAG') & ScMF.Auto).toBeTruthy();
    const q = p2.GetQueryParam();
    expect(q.GetEntry(0).GetQueryItems().map((i) => i.maString)).toEqual(['a', 'c']);
    expect(q.GetEntry(1).eConnect).toBe(ScQueryConnect.SC_OR);
    expect(q.GetEntry(1).eOp).toBe(ScQueryOp.SC_GREATER_EQUAL);
    expect([1, 2, 3, 4].map((r) => d2.RowFiltered(r, 0))).toEqual([false, true, false, false]);
    // filtering again in the loaded document gives the same rows
    const v2 = new ScTabViewShell(sh2, () => new ScInputOptions());
    v2.Query(q);
    expect([1, 2, 3, 4].map((r) => d2.RowHidden(r, 0))).toEqual([false, true, false, false]);
  });

  test('named database ranges are kept', () => {
    const sh = new ScDocShell();
    const doc = sh.GetDocument();
    putAll(doc, { A1: 'x', A2: 1 });
    expect(new ScDBDocFunc(sh).AddDBRange('MyRange', new ScRange(0, 0, 0, 0, 1, 0))).toBe(true);
    putAll(doc, { B1: '=ROWS(MyRange)' });
    expect(doc.GetValue(new ScAddress(1, 0, 0))).toBe(2);
    expect(doc.GetFormula(new ScAddress(1, 0, 0))).toBe('=ROWS(MyRange)');
    const { doc: sh2 } = ImportFODS(ExportFODS(sh));
    const p = sh2.GetDocument().GetDBCollection().getNamedDBs().findByName('MyRange')!;
    expect(p.GetArea().aEnd.Row()).toBe(1);
  });
});
