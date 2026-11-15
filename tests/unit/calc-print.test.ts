// ScPrintFunc (sc/source/ui/view/printfun.cxx) and the page breaks of ScTable (table5.cxx): page
// counts and breaks for the page style's scaling, repeated rows, manual breaks, print ranges with
// undo, page order, empty pages, and the header and footer fields.
import { describe, expect, it } from 'vitest';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { ScPrintOptions } from '../../src/lo/sc/inc/printopt.ts';
import { ScBreakType } from '../../src/lo/sc/inc/global.ts';
import { SfxStyleFamily } from '../../src/lo/sc/inc/stlsheet.ts';
import type { ScItemSet } from '../../src/lo/sc/inc/scitems.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { CalcFieldValue, ScHeaderFieldData, lcl_GetNumStr } from '../../src/lo/sc/source/core/tool/editutil.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ScModelObj, type ScRenderOptions } from '../../src/lo/sc/source/ui/unoobj/docuno.ts';
import { PageRange, ScPrintFunc } from '../../src/lo/sc/source/ui/view/printfun.ts';
import { ScTabViewShell } from '../../src/lo/sc/source/ui/view/tabvwsh.ts';
import { ScInputOptions } from '../../src/lo/sc/inc/inputopt.ts';
import { ExportODS, ImportODS } from '../../src/lo/sc/source/filter/xml/ods.ts';
import type { ScRenderContext } from '../../src/lo/sc/source/ui/view/output.ts';
import { newDoc } from './calchelper.ts';

/** A context recording the texts drawn (and where, in the page's twips with the zoom applied). */
function Recorder(): ScRenderContext & { texts: { text: string; x: number; y: number }[] } {
  const stack: number[][] = [];
  let m = [1, 0, 0, 1, 0, 0];
  const nop = () => {};
  const texts: { text: string; x: number; y: number }[] = [];
  return {
    texts,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    save: () => { stack.push(m); }, restore: () => { m = stack.pop() ?? m; },
    beginPath: nop, closePath: nop, rect: nop, clip: nop, fill: nop, stroke: nop, moveTo: nop, lineTo: nop, fillRect: nop, setLineDash: nop,
    translate: (x, y) => { m = [m[0]!, m[1]!, m[2]!, m[3]!, m[4]! + m[0]! * x, m[5]! + m[3]! * y]; },
    scale: (sx, sy) => { m = [m[0]! * sx, m[1]!, m[2]!, m[3]! * sy, m[4]!, m[5]!]; },
    fillText: (text, x, y) => { texts.push({ text, x: m[4]! + m[0]! * x, y: m[5]! + m[3]! * y }); },
  };
}

function shell(nTabs = 1): { doc: ScDocument; sh: ScDocShell } {
  const doc = newDoc(nTabs);
  for (let i = 0; i < nTabs; i++) doc.RenameTab(i, `Sheet${i + 1}`);
  return { doc, sh: new ScDocShell(doc) };
}

const fill = (doc: ScDocument, nRows: number, nCols = 1, nTab = 0) => {
  for (let c = 0; c < nCols; c++) for (let r = 0; r < nRows; r++) doc.SetValue(c, r, nTab, r + 1);
};

/** The default page style's items changed (as the Page Style dialog does, without undo). */
const pageStyle = (doc: ScDocument, items: ScItemSet) => {
  const s = doc.GetStyleSheetPool().Find('Default', SfxStyleFamily.Page)!;
  s.SetItemSet({ ...s.GetItemSet(), ...items });
};

const pages = (sh: ScDocShell, nTab = 0, opts = new ScPrintOptions()) => new ScPrintFunc(null, sh, nTab, 1, 0, null, opts).GetTotalPages();

/** A4 portrait, 2 cm margins and the default header and footer leave 13720 twips: 53 rows of 256. */
const ROWS_PER_PAGE = 53;

describe('ScPrintFunc: page breaks and counts', () => {
  it('counts the pages of the used area and sets the automatic row breaks', () => {
    const { doc, sh } = shell();
    fill(doc, 100);
    expect(pages(sh)).toBe(2);
    expect(doc.GetAllRowBreaks(0, true, false)).toContain(ROWS_PER_PAGE);
    expect(doc.GetAllRowBreaks(0, true, false)[0]).toBe(ROWS_PER_PAGE);
  });

  it('an empty sheet has no pages unless empty pages are printed', () => {
    const { sh } = shell();
    expect(pages(sh)).toBe(0);
    const o = new ScPrintOptions();
    o.SetSkipEmpty(false);
    expect(pages(sh, 0, o)).toBe(1);
  });

  it('columns wider than the page break into pages across, in page order', () => {
    const { doc, sh } = shell();
    for (let c = 0; c < 20; c++) doc.SetColWidth(c, 0, 2000);
    fill(doc, 100, 20);
    // 17 cm of A4's width fit 4 columns of 2000 twips (3.5 cm)
    expect(pages(sh)).toBe(2 * 5);
    expect(doc.GetAllColBreaks(0, true, false).slice(0, 2)).toEqual([4, 8]);
  });

  it('scales by a percentage', () => {
    const { doc, sh } = shell();
    fill(doc, 100);
    pageStyle(doc, { ATTR_PAGE_SCALE: 50 });
    expect(pages(sh)).toBe(1);
    pageStyle(doc, { ATTR_PAGE_SCALE: 25 });
    fill(doc, 400);
    expect(pages(sh)).toBe(2);
  });

  it('fits into a number of pages', () => {
    const { doc, sh } = shell();
    fill(doc, 400);
    expect(pages(sh)).toBe(8);
    pageStyle(doc, { ATTR_PAGE_SCALETOPAGES: 1 });
    const f = new ScPrintFunc(null, sh, 0, 1, 0, null, new ScPrintOptions());
    expect(f.GetTotalPages()).toBe(1);
    // the zoom's bisection: 100, 50, 25, 12, 18, 15, 13, 14
    expect(f.GetZoom()).toBe(14);
    pageStyle(doc, { ATTR_PAGE_SCALETOPAGES: 3 });
    expect(pages(sh)).toBe(3);
  });

  it('fits into pages wide and high', () => {
    const { doc, sh } = shell();
    for (let c = 0; c < 20; c++) doc.SetColWidth(c, 0, 2000);
    fill(doc, 100, 20);
    pageStyle(doc, { ATTR_PAGE_SCALETO: { nWidth: 1, nHeight: 0 } });
    const f = new ScPrintFunc(null, sh, 0, 1, 0, null, new ScPrintOptions());
    // one page wide: the 100 rows at the small zoom fit on one page high too
    expect(f.GetTotalPages()).toBe(1);
    // one page high: at about half the size, 9 of the 20 columns fit a page
    pageStyle(doc, { ATTR_PAGE_SCALETO: { nWidth: 0, nHeight: 1 } });
    expect(pages(sh)).toBe(3);
  });

  it('repeats rows on every page, which leaves less room for the others', () => {
    const { doc, sh } = shell();
    fill(doc, 200);
    expect(pages(sh)).toBe(4);
    for (let r = 0; r < 5; r++) doc.SetRowHeight(r, 0, 1000);
    const nWithout = pages(sh);
    doc.SetRepeatRowRange(0, new ScRange(0, 0, 0, doc.MaxCol(), 4, 0));
    expect(pages(sh)).toBeGreaterThan(nWithout);
    // the repeated rows are printed on the second page too
    const rec = Recorder();
    const f = new ScPrintFunc(rec, sh, 0, 1, 0, null, new ScPrintOptions());
    f.DoPrint(PageRange(2), 0, 0, true);
    expect(rec.texts.map((t) => t.text)).toContain('1');
    expect(rec.texts.map((t) => t.text)).toContain('5');
  });

  it('breaks at manual breaks, with undo, and fitting to pages ignores them', () => {
    const { doc, sh } = shell();
    fill(doc, 100);
    const view = new ScTabViewShell(sh, () => new ScInputOptions());
    view.SetCursor(0, 10);
    view.InsertPageBreak(false);
    expect(doc.HasRowBreak(10, 0) & ScBreakType.Manual).toBeTruthy();
    expect(pages(sh)).toBe(3);
    sh.GetUndoManager().Undo();
    expect(doc.GetRowManualBreaks(0)).toEqual([]);
    expect(pages(sh)).toBe(2);
    sh.GetUndoManager().Redo();
    expect(doc.GetRowManualBreaks(0)).toEqual([10]);
    pageStyle(doc, { ATTR_PAGE_SCALETOPAGES: 1 });
    expect(pages(sh)).toBe(1);
    // the manual breaks follow inserted rows
    doc.InsertRow(0, 0, doc.MaxCol(), 0, 0, 2);
    expect(doc.GetRowManualBreaks(0)).toEqual([12]);
    view.SetCursor(0, 12);
    view.DeletePageBreak(false);
    expect(doc.GetRowManualBreaks(0)).toEqual([]);
    view.SetCursor(3, 0);
    view.InsertPageBreak(true);
    view.SetCursor(0, 40);
    view.InsertPageBreak(false);
    view.RemoveManualBreaks();
    expect(doc.HasManualBreaks(0)).toBe(false);
    sh.GetUndoManager().Undo();
    expect(doc.GetColManualBreaks(0)).toEqual([3]);
    expect(doc.GetRowManualBreaks(0)).toEqual([40]);
  });

  it('prints the print ranges, set with undo', () => {
    const { doc, sh } = shell();
    fill(doc, 300, 3);
    const view = new ScTabViewShell(sh, () => new ScInputOptions());
    view.MarkRange(new ScRange(0, 0, 0, 1, 19, 0));
    view.SetPrintRanges(false, null, null, null, false);
    expect(doc.GetPrintRangeCount(0)).toBe(1);
    expect(doc.GetPrintRange(0, 0)!.equals(new ScRange(0, 0, 0, 1, 19, 0))).toBe(true);
    expect(pages(sh)).toBe(1);
    view.SetPrintRanges(false, 'A100:A200', null, '$1:$2', true);
    expect(doc.GetPrintRangeCount(0)).toBe(2);
    expect(doc.GetRepeatRowRange(0)!.aEnd.Row()).toBe(1);
    expect(pages(sh)).toBe(1 + 2);
    sh.GetUndoManager().Undo();
    expect(doc.GetPrintRangeCount(0)).toBe(1);
    expect(doc.GetRepeatRowRange(0)).toBeNull();
    view.SetPrintRanges(true, '', null, null, false);
    expect(doc.IsPrintEntireSheet(0)).toBe(true);
    expect(pages(sh)).toBe(6);
    sh.GetUndoManager().Undo();
    sh.GetUndoManager().Undo();
    expect(doc.IsPrintEntireSheet(0)).toBe(true);
    expect(doc.GetPrintRangeCount(0)).toBe(0);
  });

  it('orders the pages top to bottom or left to right', () => {
    const { doc, sh } = shell();
    for (let c = 0; c < 8; c++) doc.SetColWidth(c, 0, 2000);
    fill(doc, 100, 8);
    const range = (n: number) => {
      const f = new ScPrintFunc(Recorder(), sh, 0, 1, 0, null, new ScPrintOptions());
      f.DoPrint(PageRange(n), 0, 0, true);
      return f.GetLastSourceRange()!;
    };
    // top to bottom: the second page is below the first
    expect(range(2).aStart.Col()).toBe(0);
    expect(range(2).aStart.Row()).toBe(ROWS_PER_PAGE);
    pageStyle(doc, { ATTR_PAGE_TOPDOWN: false });
    expect(range(2).aStart.Col()).toBe(4);
    expect(range(2).aStart.Row()).toBe(0);
  });

  it('leaves out empty pages', () => {
    const { doc, sh } = shell();
    for (let c = 0; c < 8; c++) doc.SetColWidth(c, 0, 2000);
    doc.SetValue(0, 0, 0, 1);
    doc.SetValue(7, 150, 0, 1);
    // 3 pages high and 2 wide, of which only the first and the last have content
    expect(pages(sh)).toBe(2);
    const o = new ScPrintOptions();
    o.SetSkipEmpty(false);
    expect(pages(sh, 0, o)).toBe(6);
  });

  it('counts the pages of all sheets, numbering them on', () => {
    const { doc, sh } = shell(2);
    fill(doc, 100, 1, 0);
    fill(doc, 10, 1, 1);
    const model = new ScModelObj(sh);
    const all: ScRenderOptions = { nPrintContent: 0, bSuppressEmptyPages: true, aSelectedTabs: [0], aSelection: null };
    expect(model.getRendererCount(all)).toBe(3);
    expect(model.getRendererCount({ ...all, nPrintContent: 1 })).toBe(2);
    expect(model.getRendererCount({ ...all, nPrintContent: 2, aSelection: new ScRange(0, 0, 0, 0, 9, 0) })).toBe(1);
    // the last page shows the second sheet's name in the header and "Page 3" in the footer
    const rec = Recorder();
    model.render(2, all, rec);
    const texts = rec.texts.map((t) => t.text);
    expect(texts).toContain('Sheet2');
    expect(texts.join('')).toContain('Page 3');
    expect(model.getRenderer(2, all)).toEqual({ Width: 11906, Height: 16838 });
  });

  it('centres the cells and prints the headers and the grid', () => {
    const { doc, sh } = shell();
    doc.SetString(0, 0, 0, 'x');
    const at = () => {
      const rec = Recorder();
      new ScPrintFunc(rec, sh, 0, 1, 0, null, new ScPrintOptions()).DoPrint(PageRange(1), 0, 0, true);
      return rec.texts;
    };
    const x0 = at().find((t) => t.text === 'x')!.x;
    expect(x0).toBeGreaterThan(1134);
    expect(x0).toBeLessThan(1134 + 200);
    pageStyle(doc, { ATTR_PAGE_HORCENTER: true });
    const x1 = at().find((t) => t.text === 'x')!.x;
    expect(x1).toBeGreaterThan(11906 / 2 - 1300);
    pageStyle(doc, { ATTR_PAGE_HORCENTER: false, ATTR_PAGE_HEADERS: true });
    const texts = at().map((t) => t.text);
    expect(texts).toContain('A');
    expect(texts).toContain('1');
  });
});

describe('header and footer fields', () => {
  it('numbers pages in the page style\'s numbering', () => {
    expect(lcl_GetNumStr(4, '1')).toBe('4');
    expect(lcl_GetNumStr(4, 'I')).toBe('IV');
    expect(lcl_GetNumStr(14, 'i')).toBe('xiv');
    expect(lcl_GetNumStr(28, 'A')).toBe('AB');
    expect(lcl_GetNumStr(3, 'a')).toBe('c');
    expect(lcl_GetNumStr(3, '')).toBe('');
    expect(lcl_GetNumStr(0, '1')).toBe('0');
  });

  it('expands the fields', () => {
    const d = new ScHeaderFieldData();
    d.nPageNo = 2; d.nTotalPages = 7; d.aTabName = 'Data'; d.aTitle = 'Budget'; d.aShortDocName = 'budget.ods';
    d.aDateTime = new Date(2026, 10, 15, 9, 5, 7);
    expect(CalcFieldValue('PAGE', d)).toBe('2');
    expect(CalcFieldValue('PAGES', d)).toBe('7');
    expect(CalcFieldValue('TABLE', d)).toBe('Data');
    expect(CalcFieldValue('TITLE', d)).toBe('Budget');
    expect(CalcFieldValue('FILE', d)).toBe('budget.ods');
    expect(CalcFieldValue('DATE', d)).toBe('11/15/26');
    expect(CalcFieldValue('TIME', d)).toBe('09:05:07');
  });

  it('prints the Report style\'s header with the file name, date and page count', () => {
    const { doc, sh } = shell();
    sh.SetTitle('budget.ods');
    fill(doc, 100);
    doc.SetPageStyle(0, 'Report');
    const rec = Recorder();
    const f = new ScPrintFunc(rec, sh, 0, 1, 0, null, new ScPrintOptions());
    f.SetDateTime(new Date(2026, 0, 2, 3, 4, 5));
    f.DoPrint(PageRange(2), 0, 0, true);
    const all = rec.texts.map((t) => t.text).join('');
    expect(all).toContain('Sheet1 (budget.ods)');
    expect(all).toContain('Page 2 / 2');
  });
});

describe('page style changes', () => {
  it('modifies the page style with undo, and the pages follow', () => {
    const { doc, sh } = shell();
    fill(doc, 100);
    expect(pages(sh)).toBe(2);
    sh.ModifyPageStyle(0, { ATTR_PAGE_SIZE: { nWidth: 16838, nHeight: 11906 }, ATTR_PAGE: { bLandscape: true, eUse: 'All', eNumType: '1' } });
    expect(pages(sh)).toBe(3);
    sh.GetUndoManager().Undo();
    expect(doc.GetStyleSheetPool().Find('Default', SfxStyleFamily.Page)!.GetItem('ATTR_PAGE').bLandscape).toBe(false);
    expect(pages(sh)).toBe(2);
    sh.GetUndoManager().Redo();
    expect(pages(sh)).toBe(3);
  });
});

describe('ODS', () => {
  it('keeps manual page breaks', async () => {
    const { doc, sh } = shell();
    fill(doc, 50, 5);
    doc.SetRowBreak(20, 0, false, true);
    doc.SetColBreak(3, 0, false, true);
    const r = await ImportODS(await ExportODS(sh));
    const d2 = r.doc.GetDocument();
    expect(d2.GetRowManualBreaks(0)).toEqual([20]);
    expect(d2.GetColManualBreaks(0)).toEqual([3]);
    expect(r.lost).not.toContain('Manual page breaks');
    void ScAddress;
  });
});
