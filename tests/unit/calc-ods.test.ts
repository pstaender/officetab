// ODS import and export: round trips and upstream's test documents (sc/qa/unit/data/ods).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { HFText } from '../../src/lo/sc/inc/stlpool.ts';
import { SfxStyleFamily } from '../../src/lo/sc/inc/stlsheet.ts';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScRangeData } from '../../src/lo/sc/source/core/tool/rangenam.ts';
import { ExportFODS, ExportODS, ImportFODS, ImportODS, DefaultViewSettings, DefaultViewSettingsTable, ScSplitMode } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/ods/', import.meta.url);
const load = async (name: string) => ImportODS(new Uint8Array(readFileSync(new URL(name, DATA))));
const roundTrip = async (sh: ScDocShell) => ImportODS(await ExportODS(sh));
const A = (c: number, r: number, t = 0) => new ScAddress(c, r, t);

function sample(): ScDocShell {
  const sh = new ScDocShell();
  const doc = sh.GetDocument();
  doc.InsertTab(1, 'Second Sheet');
  doc.SetValue(0, 0, 0, 1.5);
  doc.SetValue(0, 1, 0, 2);
  doc.SetRawString(A(1, 0), 'Hello  world');
  doc.SetFormula(A(2, 0), '=A1+A2', FormulaGrammar.GRAM_NATIVE);
  doc.SetFormula(A(2, 1), "='Second Sheet'.A1*2", FormulaGrammar.GRAM_NATIVE);
  doc.SetValue(0, 0, 1, 21);
  doc.SetValue(0, 2, 0, 45000.5);
  doc.SetNumberFormat(A(0, 2), 'YYYY-MM-DD HH:MM');
  doc.SetValue(0, 3, 0, 0.25);
  doc.SetNumberFormat(A(0, 3), '0.00%');
  doc.ApplyAttr(1, 0, 0, { ATTR_FONT_WEIGHT: true, ATTR_BACKGROUND: '#ffcc00', ATTR_HOR_JUSTIFY: 'Center', ATTR_BORDER: { top: { color: '#000000', width: 15, style: 'solid' }, bottom: null, left: null, right: null } });
  doc.DoMerge(3, 3, 4, 5, 0);
  doc.SetColWidth(1, 0, 3000);
  doc.SetRowHeight(4, 0, 600);
  doc.SetManualHeight(4, 4, 0, true);
  doc.SetColHidden(5, 5, 0, true);
  doc.SetTabBgColor(1, '#ff0000');
  doc.SetNote(A(0, 0), { maText: 'a note', maAuthor: 'me', maDate: '2024-01-01', mbShown: false });
  doc.GetRangeName()!.insert(new ScRangeData(doc, 'MyRange', '$Sheet1.$A$1:$A$2', A(0, 0), undefined, FormulaGrammar.GRAM_NATIVE));
  const page = doc.GetStyleSheetPool().Find('Default', SfxStyleFamily.Page)!;
  page.SetItemSet({ ...page.GetItemSet(), ATTR_PAGE: { bLandscape: true, eUse: 'All', eNumType: '1' }, ATTR_PAGE_SIZE: { nWidth: 16838, nHeight: 11906 }, ATTR_PAGE_GRID: true, ATTR_PAGE_SCALETO: { nWidth: 1, nHeight: 2 }, ATTR_PAGE_HORCENTER: true });
  doc.AddPrintRange(0, new ScRange(0, 0, 0, 3, 9, 0));
  sh.m_xDocProps.setTitle?.('Title');
  return sh;
}

describe('ODS round trip', () => {
  test('cells, formats, formulas, styles', async () => {
    const { doc: sh, lost } = await roundTrip(sample());
    const doc = sh.GetDocument();
    expect(lost).toEqual([]);
    expect(doc.GetAllTableNames()).toEqual(['Sheet1', 'Second Sheet']);
    expect(doc.GetValue(A(0, 0))).toBe(1.5);
    expect(doc.GetString(A(1, 0))).toBe('Hello  world');
    expect(doc.GetFormula(A(2, 0))).toBe('=A1+A2');
    expect(doc.GetValue(A(2, 0))).toBe(3.5);
    expect(doc.GetValue(A(2, 1))).toBe(42);
    expect(doc.GetValue(A(0, 2))).toBe(45000.5);
    expect(doc.GetNumberFormat(A(0, 2))).toBe('YYYY-MM-DD HH:MM');
    expect(doc.GetNumberFormat(A(0, 3))).toBe('0.00%');
    const p = doc.GetPattern(A(1, 0));
    expect(p.GetItem('ATTR_FONT_WEIGHT')).toBe(true);
    expect(p.GetItem('ATTR_BACKGROUND')).toBe('#ffcc00');
    expect(p.GetItem('ATTR_HOR_JUSTIFY')).toBe('Center');
    expect(p.GetItem('ATTR_BORDER').top).toEqual({ color: '#000000', width: 15, style: 'solid' });
    expect(doc.GetPattern(A(3, 3)).GetItem('ATTR_MERGE')).toEqual({ nColMerge: 2, nRowMerge: 3 });
    expect(doc.GetColWidth(1, 0)).toBe(3000);
    expect(doc.GetRowHeight(4, 0)).toBe(600);
    expect(doc.ColHidden(5, 0)).toBe(true);
    expect(doc.GetTabBgColor(1)).toBe('#ff0000');
    expect(doc.GetNote(A(0, 0))).toEqual({ maText: 'a note', maAuthor: 'me', maDate: '2024-01-01', mbShown: false });
    expect(doc.GetRangeName()!.findByUpperName('MYRANGE')!.GetSymbol(FormulaGrammar.GRAM_NATIVE)).toBe('$Sheet1.$A$1:$A$2');
    const page = doc.GetStyleSheetPool().Find('Default', SfxStyleFamily.Page)!;
    expect(page.GetItem('ATTR_PAGE').bLandscape).toBe(true);
    expect(page.GetItem('ATTR_PAGE_SIZE')).toEqual({ nWidth: 16838, nHeight: 11906 });
    expect(page.GetItem('ATTR_PAGE_GRID')).toBe(true);
    expect(page.GetItem('ATTR_PAGE_SCALETO')).toEqual({ nWidth: 1, nHeight: 2 });
    expect(page.GetItem('ATTR_PAGE_HORCENTER')).toBe(true);
    expect(page.GetItem('ATTR_PAGE_HEADERRIGHT').pCenterArea!.GetString()).toBe(HFText(['TABLE']).GetString());
    expect(page.GetItem('ATTR_PAGE_FOOTERRIGHT').pCenterArea!.GetParagraph(0)!.maCharAttribs[0]!.aAttribs.FIELD).toBe('PAGE');
    expect(doc.GetPrintRange(0, 0)!.Format(doc)).toBeTruthy();
    expect(doc.GetPrintRangeCount(0)).toBe(1);
  });

  test('a second round trip writes the same content', async () => {
    const once = await ExportODS((await roundTrip(sample())).doc);
    const twice = await ExportODS((await ImportODS(once)).doc);
    const { readZip } = await import('../../src/lo/package/source/zipapi/zip.ts');
    const a = await readZip(once), b = await readZip(twice);
    expect(new TextDecoder().decode(b.get('content.xml'))).toBe(new TextDecoder().decode(a.get('content.xml')));
    expect(new TextDecoder().decode(b.get('styles.xml'))).toBe(new TextDecoder().decode(a.get('styles.xml')));
  });

  test('view settings and template', async () => {
    const v = DefaultViewSettings();
    v.ActiveTable = 'Second Sheet';
    v.Tables.Sheet1 = { ...DefaultViewSettingsTable(), CursorPositionX: 3, CursorPositionY: 7, HorizontalSplitMode: ScSplitMode.SC_SPLIT_FIX, VerticalSplitMode: ScSplitMode.SC_SPLIT_FIX, HorizontalSplitPosition: 1, VerticalSplitPosition: 2, ZoomValue: 150 };
    const r = await ImportODS(await ExportODS(sample(), [], true, v));
    expect(r.template).toBe(true);
    expect(r.viewSettings!.ActiveTable).toBe('Second Sheet');
    expect(r.viewSettings!.Tables.Sheet1).toMatchObject({ CursorPositionX: 3, CursorPositionY: 7, HorizontalSplitPosition: 1, VerticalSplitPosition: 2, ZoomValue: 150, HorizontalSplitMode: 2 });
  });

  test('flat ODS', () => {
    const r = ImportFODS(ExportFODS(sample()));
    expect(r.doc.GetDocument().GetValue(A(2, 1))).toBe(42);
    expect(r.doc.GetDocument().GetNumberFormat(A(0, 3))).toBe('0.00%');
  });
});

describe('upstream ODS documents', () => {
  const files = readdirSync(DATA).filter((f) => /\.(ods|ots)$/.test(f) && !f.startsWith('password'));
  test('encrypted documents are refused', async () => {
    await expect(load('password.ods')).rejects.toThrow(/password-protected/);
  });
  test.each(files)('%s imports', async (f) => {
    const r = await load(f);
    expect(r.doc.GetDocument().GetTableCount()).toBeGreaterThan(0);
    // and exports again
    const again = await ImportODS(await ExportODS(r.doc));
    expect(again.doc.GetDocument().GetTableCount()).toBe(r.doc.GetDocument().GetTableCount());
  });
});

describe('assertions of subsequent_filters_test*.cxx', () => {
  test('testBasicCellContentODS', async () => {
    const doc = (await load('basic-cell-content.ods')).doc.GetDocument();
    expect(doc.GetString(1, 1, 0)).toBe('LibreOffice Calc');
    expect(doc.GetValue(1, 2, 0)).toBe(12345);
    expect(doc.GetString(1, 3, 0)).toBe('A < B');
    expect(doc.GetCellType(A(1, 4))).toBe(1 /* CELLTYPE_VALUE */);
    expect(doc.GetValue(A(1, 4))).toBe(0);
  });
  test('testHiddenRangeNameODS', async () => {
    const doc = (await load('named-ranges-hidden.ods')).doc.GetDocument();
    expect(doc.GetRangeName()!.findByUpperName('NAMEDRANGE1')!.HasType(0x0100)).toBe(true);
    expect(doc.GetRangeName()!.findByUpperName('NAMEDRANGE2')!.HasType(0x0100)).toBe(false);
  });
  test('testMergedCellsODS', async () => {
    const doc = (await load('merged.ods')).doc.GetDocument();
    const merged = (c1: number, r1: number, c2: number, r2: number, t: number) => doc.GetPattern(A(c1, r1, t)).GetItem('ATTR_MERGE');
    expect(merged(0, 0, 5, 11, 0)).toEqual({ nColMerge: 6, nRowMerge: 12 });
    expect(merged(7, 2, 9, 12, 0)).toEqual({ nColMerge: 3, nRowMerge: 11 });
    expect(merged(3, 15, 7, 23, 0)).toEqual({ nColMerge: 5, nRowMerge: 9 });
    expect(merged(4, 3, 6, 15, 1)).toEqual({ nColMerge: 3, nRowMerge: 13 });
  });
  test('testPrintRangeODS', async () => {
    const doc = (await load('print-range.ods')).doc.GetDocument();
    const r0 = doc.GetRepeatRowRange(0)!, r1 = doc.GetRepeatRowRange(1)!;
    expect([r0.aStart.Row(), r0.aEnd.Row()]).toEqual([0, 1]);
    expect([r1.aStart.Row(), r1.aEnd.Row()]).toEqual([2, 4]);
  });
  test('content upstream does not support yet is reported', async () => {
    expect((await load('dataValidity.ods')).lost).toContain('Validity rules');
    expect((await load('outline.ods')).lost).toContain('Outlines (grouped rows and columns)');
    expect((await load('chart-import-basic.ods')).lost).toContain('Charts and embedded objects');
  });
  test('cached matrix results and error results (testCachedMatrixFormulaResultsODS)', async () => {
    const doc = (await load('matrix.ods')).doc.GetDocument();
    expect(doc.GetString(3, 0, 2)).toBe('');
    expect(doc.GetString(0, 2, 2)).toBe('#DIV/0!');
  });
});
