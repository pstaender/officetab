// XLSX export: documents built in the model survive export and re-import, and upstream's export
// assertions (subsequent_export_test*.cxx) on parts of the package.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExportXLSX, ImportXLSX } from '../../src/lo/sc/source/filter/oox/xlsx.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { SfxStyleFamily } from '../../src/lo/sc/inc/stlsheet.ts';
import { HFText } from '../../src/lo/sc/inc/stlpool.ts';
import { EditTextObject } from '../../src/lo/editeng/source/editeng/editobj.ts';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { ScRangeData } from '../../src/lo/sc/source/core/tool/rangenam.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { DefaultViewSettings, DefaultViewSettingsTable, ScSplitMode } from '../../src/lo/sc/source/filter/xml/ods.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/', import.meta.url);
const A = (c: number, r: number, t = 0) => new ScAddress(c, r, t);
const part = async (bytes: Uint8Array, name: string) => new TextDecoder().decode((await readZip(bytes)).get(name));

function buildDoc(): ScDocShell {
  const sh = new ScDocShell();
  const d = sh.GetDocument();
  d.InsertTab(1, 'Second Sheet');
  d.SetValue(A(0, 0), 42.5);
  d.SetString(A(1, 0), 'Hello');
  d.SetFormula(A(2, 0), '=A1*2', FormulaGrammar.GRAM_NATIVE);
  d.SetFormula(A(3, 0), "='Second Sheet'.A1&\"!\"", FormulaGrammar.GRAM_NATIVE);
  d.SetValue(A(0, 0, 1), 7);
  d.SetEditText(A(1, 1), new EditTextObject([{ aText: 'bold and plain', maCharAttribs: [{ nStart: 0, nEnd: 4, aAttribs: { ATTR_FONT_WEIGHT: true } }] }, { aText: 'second line', maCharAttribs: [] }]));
  d.SetValue(A(0, 2), 45000);
  d.SetNumberFormat(A(0, 2), 'YYYY-MM-DD');
  d.SetValue(A(0, 3), 0.25);
  d.SetNumberFormat(A(0, 3), '0.00%');
  d.ApplyAttr(1, 0, 0, { ATTR_FONT_WEIGHT: true, ATTR_BACKGROUND: '#ffcc00', ATTR_HOR_JUSTIFY: 'Center', ATTR_LINEBREAK: true, ATTR_FONT_COLOR: '#ff0000', ATTR_ROTATE_VALUE: 4500 });
  d.ApplyAttr(2, 2, 0, { ATTR_BORDER: { top: { color: '#000000', width: 15, style: 'solid' }, bottom: { color: '#0000ff', width: 35, style: 'dashed' }, left: null, right: null } });
  d.SetString(A(4, 4), 'merged');
  d.DoMerge(4, 4, 6, 5, 0);
  d.SetColWidth(1, 0, 2880);
  d.SetRowHeight(6, 0, 600);
  d.SetManualHeight(6, 6, 0, true);
  d.SetColHidden(8, 8, 0, true);
  d.SetRowHidden(9, 9, 0, true);
  d.SetNote(A(0, 0), { maText: 'A note', maAuthor: 'Me', maDate: '', mbShown: false });
  d.SetTabBgColor(1, '#00ff00');
  d.InsertTab(2, 'Hidden');
  d.SetVisible(2, false);
  d.GetRangeName()!.insert(new ScRangeData(d, 'Total', '$Sheet1.$A$1:$A$4', A(0, 0), undefined, FormulaGrammar.GRAM_NATIVE));
  d.GetRangeName(1)!.insert(new ScRangeData(d, 'Local', '$\'Second Sheet\'.$A$1', A(0, 0, 1), undefined, FormulaGrammar.GRAM_NATIVE));
  d.SetFormula(A(5, 0), '=SUM(Total)', FormulaGrammar.GRAM_NATIVE);
  const aMark = new ScMarkData(d.GetSheetLimits());
  aMark.SelectOneTable(0);
  d.InsertMatrixFormula(0, 10, 1, 11, aMark, '=A1:B2*1', null, FormulaGrammar.GRAM_NATIVE);
  d.SetEditText(A(0, 12), new EditTextObject([{ aText: 'link', maCharAttribs: [{ nStart: 0, nEnd: 4, aAttribs: { URL: 'https://example.org/' } }] }]));
  d.ClearPrintRanges(0);
  d.AddPrintRange(0, new ScRange(0, 0, 0, 3, 9, 0));
  d.SetRepeatRowRange(0, new ScRange(0, 0, 0, d.MaxCol(), 0, 0));
  // page style
  const pPool = d.GetStyleSheetPool();
  const pStyle = pPool.Make('MyPage', SfxStyleFamily.Page);
  pStyle.SetItemSet({
    ATTR_PAGE: { bLandscape: true, eUse: 'All', eNumType: '1' }, ATTR_PAGE_SIZE: { nWidth: 16838, nHeight: 11906 }, ATTR_PAGE_SCALE: 80,
    ATTR_PAGE_GRID: true, ATTR_PAGE_HORCENTER: true, ATTR_LRSPACE: { nLeft: 1440, nRight: 720 },
    ATTR_PAGE_HEADERRIGHT: { pLeftArea: HFText(['TABLE']), pCenterArea: new EditTextObject(), pRightArea: HFText(['Page ', 'PAGE', ' of ', 'PAGES']) },
  });
  d.SetPageStyle(0, 'MyPage');
  // a user cell style
  const pCell = pPool.Make('Important', SfxStyleFamily.Para, { ATTR_FONT_POSTURE: true, ATTR_FONT_HEIGHT: 280 });
  d.ApplyStyleAreaTab(0, 13, 0, 13, 0, pCell);
  d.SetString(A(0, 13), 'styled');
  d.SetTabProtection(1, true);
  sh.m_xDocProps.setTitle('XLSX round trip');
  sh.m_xDocProps.setAuthor('Tester');
  d.CalcAll();
  return sh;
}

describe('XLSX export and re-import', () => {
  it('keeps contents, formats, structure and settings', async () => {
    const sh = buildDoc();
    const vs = DefaultViewSettings();
    vs.ActiveTable = 'Second Sheet';
    vs.Tables['Sheet1'] = { ...DefaultViewSettingsTable(), HorizontalSplitMode: ScSplitMode.SC_SPLIT_FIX, VerticalSplitMode: ScSplitMode.SC_SPLIT_FIX, HorizontalSplitPosition: 1, VerticalSplitPosition: 2, PositionRight: 1, PositionBottom: 2, CursorPositionX: 3, CursorPositionY: 4, ZoomValue: 150 };
    const bytes = await ExportXLSX(sh, vs);
    if (process.env.XLSX_DUMP) (await import('node:fs')).writeFileSync(process.env.XLSX_DUMP, bytes);
    const r = await ImportXLSX(bytes);
    const d = r.doc.GetDocument();
    expect(r.lost).toEqual([]);
    expect(d.GetAllTableNames()).toEqual(['Sheet1', 'Second Sheet', 'Hidden']);
    expect(d.IsVisible(2)).toBe(false);
    expect(d.GetTabBgColor(1)).toBe('#00ff00');
    expect(d.IsTabProtected(1)).toBe(true);
    expect(d.GetValue(A(0, 0))).toBe(42.5);
    expect(d.GetString(A(1, 0))).toBe('Hello');
    expect(d.GetFormula(A(2, 0))).toBe('=A1*2');
    expect(d.GetValue(A(2, 0))).toBe(85);
    expect(d.GetString(A(3, 0))).toBe('7!');
    expect(d.GetFormula(A(5, 0))).toBe('=SUM(Total)');
    expect(d.GetValue(A(5, 0))).toBe(42.5 + 45000 + 0.25);
    // rich text
    const e = d.GetEditText(A(1, 1))!;
    expect(e.GetParagraphCount()).toBe(2);
    expect(e.GetText(0)).toBe('bold and plain');
    expect(e.GetParagraph(0)!.maCharAttribs.find((x) => x.nStart === 0)?.aAttribs.ATTR_FONT_WEIGHT).toBe(true);
    // number formats
    expect(d.GetNumberFormat(A(0, 2))).toBe('YYYY-MM-DD');
    expect(d.GetString(A(0, 3))).toBe('25.00%');
    // cell attributes
    const p = d.GetPattern(1, 0, 0);
    expect([p.GetItem('ATTR_FONT_WEIGHT'), p.GetItem('ATTR_BACKGROUND'), p.GetItem('ATTR_HOR_JUSTIFY'), p.GetItem('ATTR_LINEBREAK'), p.GetItem('ATTR_FONT_COLOR'), p.GetItem('ATTR_ROTATE_VALUE')]).toEqual([true, '#ffcc00', 'Center', true, '#ff0000', 4500]);
    const b = d.GetPattern(2, 2, 0).GetItem('ATTR_BORDER');
    expect(b.top).toEqual({ color: '#000000', width: 15, style: 'solid' });
    expect(b.bottom).toEqual({ color: '#0000ff', width: 35, style: 'dashed' });
    // merged cells, sizes, hidden
    expect(d.ExtendMerge(4, 4, 4, 4, 0)).toMatchObject({ nEndCol: 6, nEndRow: 5 });
    expect(Math.abs(d.GetColWidth(1, 0, false) - 2880)).toBeLessThanOrEqual(1);
    expect(d.GetRowHeight(6, 0, false)).toBe(600);
    expect(d.IsManualRowHeight(6, 0)).toBe(true);
    expect(d.ColHidden(8, 0)).toBe(true);
    expect(d.RowHidden(9, 0)).toBe(true);
    // notes, names, array formula, hyperlink
    expect(d.GetNote(A(0, 0))).toMatchObject({ maText: 'A note', maAuthor: 'Me' });
    expect(d.GetRangeName()!.findByUpperName('TOTAL')!.GetSymbol()).toBe('$Sheet1.$A$1:$A$4');
    expect(d.GetRangeName(1)!.findByUpperName('LOCAL')).toBeTruthy();
    expect(d.GetFormula(A(0, 10))).toBe('{=A1:B2*1}');
    expect(d.GetFormula(A(1, 11))).toBe('{=A1:B2*1}');
    expect(d.GetEditText(A(0, 12))!.GetParagraph(0)!.maCharAttribs[0]!.aAttribs.URL).toBe('https://example.org/');
    // print ranges
    expect(d.GetPrintRangeCount(0)).toBe(1);
    expect(d.GetPrintRange(0, 0)!.aEnd.Row()).toBe(9);
    expect(d.GetRepeatRowRange(0)?.aStart.Row()).toBe(0);
    // page style
    const ps = d.GetStyleSheetPool().Find(d.GetPageStyle(0), SfxStyleFamily.Page)!;
    expect(ps.GetItem('ATTR_PAGE').bLandscape).toBe(true);
    expect(ps.GetItem('ATTR_PAGE_SIZE')).toEqual({ nWidth: 16838, nHeight: 11906 });
    expect(ps.GetItem('ATTR_PAGE_SCALE')).toBe(80);
    expect(ps.GetItem('ATTR_PAGE_GRID')).toBe(true);
    expect(ps.GetItem('ATTR_PAGE_HORCENTER')).toBe(true);
    expect(ps.GetItem('ATTR_LRSPACE')).toEqual({ nLeft: 1440, nRight: 720 });
    const hf = ps.GetItem('ATTR_PAGE_HEADERRIGHT');
    expect(hf.pLeftArea!.GetParagraph(0)!.maCharAttribs[0]!.aAttribs.FIELD).toBe('TABLE');
    expect(hf.pRightArea!.GetParagraph(0)!.maCharAttribs.map((x) => x.aAttribs.FIELD)).toEqual(['PAGE', 'PAGES']);
    // cell style
    expect(d.GetStyleSheetPool().Find('Important')?.GetItem('ATTR_FONT_POSTURE')).toBe(true);
    expect(d.GetPattern(0, 13, 0).GetStyleName()).toBe('Important');
    // document properties and view settings
    expect(r.doc.m_xDocProps.getTitle()).toBe('XLSX round trip');
    expect(r.doc.m_xDocProps.getAuthor()).toBe('Tester');
    expect(r.viewSettings?.ActiveTable).toBe('Second Sheet');
    const t = r.viewSettings!.Tables['Sheet1']!;
    expect([t.HorizontalSplitMode, t.VerticalSplitMode, t.HorizontalSplitPosition, t.VerticalSplitPosition, t.CursorPositionX, t.CursorPositionY, t.ZoomValue]).toEqual([ScSplitMode.SC_SPLIT_FIX, ScSplitMode.SC_SPLIT_FIX, 1, 2, 3, 4, 150]);
  });

  it('round-trips 1904 workbooks', async () => {
    const sh = new ScDocShell();
    const o = sh.GetDocument().GetDocOptions().clone();
    o.SetDate(1, 1, 1904);
    sh.GetDocument().SetDocOptions(o);
    const r = await ImportXLSX(await ExportXLSX(sh));
    expect(r.doc.GetDocument().GetDocOptions().GetDate()).toEqual({ nDay: 1, nMonth: 1, nYear: 1904 });
  });
});

describe('XLSX export (subsequent_export_test)', () => {
  it('testColumnWidthResaveXLSX', async () => {
    const r = await ImportXLSX(new Uint8Array(readFileSync(new URL('xlsx/different-column-width-excel2010.xlsx', DATA))));
    const sheet = await part(await ExportXLSX(r.doc, r.viewSettings), 'xl/worksheets/sheet1.xml');
    const cols = [...sheet.matchAll(/<col [^>]*>/g)].map((m) => m[0]);
    expect(cols.length).toBe(5);
    expect(cols.map((c) => /width="([^"]*)"/.exec(c)![1])).toEqual(['24', '12', '6', '1', '250']);
    expect(cols.every((c) => c.includes('customWidth="true"'))).toBe(true);
  });

  it('keeps an imported document lossless (values, formulas, formats, page and view settings)', async () => {
    const src = new Uint8Array(readFileSync(new URL('xlsx/universal-content.xlsx', DATA)));
    const r1 = await ImportXLSX(src);
    const r2 = await ImportXLSX(await ExportXLSX(r1.doc, r1.viewSettings));
    const d1 = r1.doc.GetDocument(), d2 = r2.doc.GetDocument();
    for (let t = 0; t < d1.GetTableCount(); t++) {
      for (let c = 0; c < 10; c++) for (let rr = 0; rr < 10; rr++) {
        expect(d2.GetString(c, rr, t)).toBe(d1.GetString(c, rr, t));
        expect(d2.GetFormula(c, rr, t)).toBe(d1.GetFormula(c, rr, t));
        expect(d2.GetPattern(c, rr, t).GetItem('ATTR_FONT')).toBe(d1.GetPattern(c, rr, t).GetItem('ATTR_FONT'));
      }
    }
    expect(r2.viewSettings).toEqual(r1.viewSettings);
  });

  it('writes a valid package skeleton', async () => {
    const bytes = await ExportXLSX(buildDoc());
    const files = await readZip(bytes);
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml', 'docProps/core.xml']) expect(files.has(n), n).toBe(true);
    const wb = await part(bytes, 'xl/workbook.xml');
    expect(wb).toContain('<definedName localSheetId="0" name="_xlnm.Print_Area">Sheet1!$A$1:$D$10</definedName>');
    expect(wb).toContain('<definedName localSheetId="0" name="_xlnm.Print_Titles">Sheet1!$1:$1</definedName>');
    expect(wb).toContain('state="hidden"');
  });
});

/** What a round trip keeps: per sheet the cells (display string, formula, format), the effective
    cell attributes, the page style items, names, sheet settings, column widths (within 1/16 of a
    character, as XclExpDefcolwidth::IsDefWidth) and row heights. */
function dumpDoc(d: import('../../src/lo/sc/source/core/data/document.ts').ScDocument): string[] {
  const out: string[] = [];
  const ITEMS = ['ATTR_FONT', 'ATTR_FONT_HEIGHT', 'ATTR_FONT_WEIGHT', 'ATTR_FONT_POSTURE', 'ATTR_FONT_UNDERLINE', 'ATTR_FONT_COLOR', 'ATTR_FONT_CROSSEDOUT', 'ATTR_HOR_JUSTIFY', 'ATTR_VER_JUSTIFY', 'ATTR_LINEBREAK', 'ATTR_INDENT', 'ATTR_ROTATE_VALUE', 'ATTR_BACKGROUND', 'ATTR_BORDER', 'ATTR_PROTECTION', 'ATTR_MERGE', 'ATTR_SHRINKTOFIT'] as const;
  for (let t = 0; t < d.GetTableCount(); t++) {
    out.push(`tab ${d.GetName(t)} ${d.IsVisible(t)} ${d.GetTabBgColor(t)} ${d.IsTabProtected(t)} ${d.GetPrintRangeCount(t)}`);
    d.FetchTable(t)!.GetColumns().forEach((c, col) => c.ForEachCell(0, d.MaxRow(), (row) => {
      const p = d.GetPattern(col, row, t);
      // Excel has no standard vertical alignment: it is bottom
      const eff = ITEMS.map((k) => (k === 'ATTR_VER_JUSTIFY' && p.GetItem(k) === 'Standard' ? '"Bottom"' : JSON.stringify(p.GetItem(k)))).join(' ');
      out.push(`${t}/${col}/${row} ${JSON.stringify(d.GetString(col, row, t))} ${d.GetFormula(col, row, t)} ${d.GetNumberFormat(col, row, t)} ${p.GetStyleName()} ${eff}`);
    }));
    const ps = d.GetStyleSheetPool().Find(d.GetPageStyle(t), SfxStyleFamily.Page)!;
    for (const k of ['ATTR_PAGE', 'ATTR_PAGE_SIZE', 'ATTR_PAGE_SCALE', 'ATTR_PAGE_SCALETO', 'ATTR_LRSPACE', 'ATTR_ULSPACE', 'ATTR_PAGE_GRID', 'ATTR_PAGE_HEADERS', 'ATTR_PAGE_TOPDOWN', 'ATTR_PAGE_HORCENTER', 'ATTR_PAGE_VERCENTER', 'ATTR_PAGE_HEADERRIGHT', 'ATTR_PAGE_FOOTERRIGHT'] as const) out.push(`${k} ${JSON.stringify(ps.GetItem(k))}`);
    out.push(`names ${[...(d.GetRangeName(t)?.begin() ?? [])].map((n) => `${n.GetName()}=${n.GetSymbol()}`).sort().join(';')}`);
    for (let c = 0; c < 30; c++) out.push(`w ${d.GetColWidth(c, t, false)} ${d.ColHidden(c, t)}`);
    for (let r = 0; r < 60; r++) out.push(`h ${d.GetRowHeight(r, t, false)} ${d.RowHidden(r, t)}`);
  }
  out.push(`names ${[...(d.GetRangeName()?.begin() ?? [])].map((n) => `${n.GetName()}=${n.GetSymbol()}`).sort().join(';')}`);
  return out;
}

describe('XLSX round trips of upstream documents', () => {
  const FILES = ['universal-content.xlsx', 'cell-value.xlsx', 'named-ranges-global.xlsx', 'shared-formula/basic.xlsx', 'row-index-1-based.xlsx', 'page_scale.xlsx',
    'hidden_sheets.xlsx', 'sheet-names.xlsx', 'hyperlinks.xlsx', 'bug-fixes.xlsx', 'formats.xlsx', 'check-boolean.xlsx', 'tdf100709.xlsx', 'functions-excel-2010.xlsx',
    'column-style.xlsx', 'cell-multi-line.xlsx', 'strike-through.xlsx', 'TextColor.xlsx', 'tdf58243.xlsx', 'escape-unicode.xlsx'];
  for (const f of FILES) {
    it(f, async () => {
      const r1 = await ImportXLSX(new Uint8Array(readFileSync(new URL(`xlsx/${f}`, DATA))));
      const r2 = await ImportXLSX(await ExportXLSX(r1.doc, r1.viewSettings));
      const a = dumpDoc(r1.doc.GetDocument()), b = dumpDoc(r2.doc.GetDocument());
      // the column widths may differ by one twip (the rounding of XclExpColinfo's widths)
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        const wa = /^w (\d+) (.*)$/.exec(a[i]!), wb = /^w (\d+) (.*)$/.exec(b[i]!);
        if (wa && wb) { expect(Math.abs(Number(wa[1]) - Number(wb[1])), f).toBeLessThanOrEqual(8); expect(wb[2]).toBe(wa[2]); } else if (a[i] !== b[i]) expect(b[i], f).toBe(a[i]);
      }
    }, 60000);
  }
});
