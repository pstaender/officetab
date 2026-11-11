// Table sizes and properties: row heights, column widths, heading rows, row split, protection,
// borders, and their ODT and DOCX forms.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function grid(texts: string[][]) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.InsertTable(texts.length, texts[0]!.length, { heading: false, repeatHeading: false, borders: true });
  texts.flat().forEach((t, i) => { if (i) sh.GoNextCell(false); sh.Insert(t); });
  return sh;
}
const table = (doc: SwDoc): SwTableNode => {
  const nodes = doc.GetNodes();
  for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTableNode()) return n as SwTableNode; }
  throw new Error('no table');
};
function cellOf(sh: SwWrtShell, text: string): SwTextNode {
  const nodes = sh.m_pDoc.GetNodes();
  for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) if (n.GetText() === text) return n;
  throw new Error(text);
}
function select(sh: SwWrtShell, a: string, b: string) {
  sh.m_pCursor.GetMark().Assign(cellOf(sh, a), 0);
  sh.m_pCursor.GetPoint().Assign(cellOf(sh, b), b === a ? 0 : 1);
  if (a === b) sh.m_pCursor.DeleteMark();
}
const rowHeights = (sh: SwWrtShell) => sh.m_pRoot.pages[0]!.tabs[0]!.rows.map((r) => Math.round(r.aFrame.Height()));

describe('Row heights', () => {
  it('fixes a row height whatever its content, and goes back to the automatic height', () => {
    const sh = grid([['a', 'b'], ['c', 'd']]);
    const auto = rowHeights(sh)[0]!;
    select(sh, 'a', 'a');
    sh.SetRowHeight(100, true);
    expect(rowHeights(sh)[0]).toBe(100);
    sh.SetRowHeight(2000, false);
    expect(rowHeights(sh)[0]).toBe(2000);
    sh.SetRowHeight(0, false);
    expect(rowHeights(sh)[0]).toBe(auto);
    expect(sh.GetRowHeight()).toEqual({ height: 0, fix: false });
  });

  it('distributes the selected rows to the tallest one', () => {
    const sh = grid([['a', 'b'], ['c', 'd']]);
    select(sh, 'a', 'a');
    sh.SetRowHeight(1500, false);
    select(sh, 'a', 'd');
    expect(sh.BalanceRowHeight(true)).toBe(true);
    sh.BalanceRowHeight(false);
    expect(rowHeights(sh)).toEqual([1500, 1500]);
  });
});

describe('Column widths', () => {
  it('sets a column width from its neighbour, keeping the table width', () => {
    const sh = grid([['a', 'b', 'c']]);
    const before = sh.GetColWidths();
    sh.SetColWidth(0, before[0]! + 500);
    const after = sh.GetColWidths();
    expect(after[0]).toBeCloseTo(before[0]! + 500, 0);
    expect(after[1]).toBeCloseTo(before[1]! - 500, 0);
    expect(after.reduce((x, y) => x + y)).toBeCloseTo(before.reduce((x, y) => x + y), 0);
  });

  it('gives columns the optimal width for their content and distributes them evenly', () => {
    const sh = grid([['a', 'a much longer cell text'], ['b', 'c']]);
    select(sh, 'a', 'c');
    sh.AdjustCellWidth(false, false);
    const w = sh.GetColWidths();
    // 1 character of 100 twips and 23 characters, plus 2 × 55 padding and the borders.
    expect(Math.round(w[0]!)).toBe(100 + 110 + 20);
    expect(Math.round(w[1]!)).toBe(2300 + 110 + 20);
    // The table became narrower than its area: it is left aligned now.
    expect(table(sh.m_pDoc).m_pTable.m_aAttrs.adjust).toBe('left');
    sh.AdjustCellWidth(true, false);
    const e = sh.GetColWidths();
    expect(Math.abs(e[0]! - e[1]!)).toBeLessThan(2);
  });
});

describe('Heading rows, row split and protection', () => {
  it('repeats the rows selected from the top', () => {
    const sh = grid([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    select(sh, 'a', 'd');
    expect(sh.GetRowSelectionFromTop()).toBe(2);
    sh.SetRowsToRepeat(sh.GetRowSelectionFromTop());
    expect(sh.GetRowsToRepeat()).toBe(2);
    select(sh, 'c', 'c');
    sh.SetRowSplit(false);
    expect(table(sh.m_pDoc).m_pTable.m_aLines.map((l) => !!l.m_aAttrs.cantSplit)).toEqual([false, true, false]);
  });

  it('refuses to edit protected cells', () => {
    const sh = grid([['a', 'b']]);
    let refused = 0;
    sh.m_fnReadonly = () => refused++;
    select(sh, 'a', 'a');
    sh.ProtectCells(true);
    sh.Insert('x');
    sh.DelRight();
    expect(cellOf(sh, 'a').GetText()).toBe('a');
    expect(refused).toBe(2);
    select(sh, 'b', 'b');
    sh.Insert('x');
    expect(cellOf(sh, 'xb')).toBeTruthy();
    select(sh, 'a', 'a');
    expect(sh.CanUnProtectCells()).toBe(true);
    sh.ProtectCells(false);
    sh.Insert('y');
    expect(cellOf(sh, 'ya')).toBeTruthy();
  });
});

describe('Borders', () => {
  it('sets outer and inner lines of the selection', () => {
    const sh = grid([['a', 'b', 'c'], ['d', 'e', 'f']]);
    const line = { color: '#ff0000', width: 40 };
    select(sh, 'b', 'f');
    sh.SetTabBorders({ left: line, right: line, top: line, bottom: line, hori: null, vert: null });
    const boxes = table(sh.m_pDoc).m_pTable.m_aLines.map((l) => l.m_aBoxes.map((b) => ['left', 'top', 'right', 'bottom'].map((k) => (b.m_aAttrs.box[k as 'left']?.color === '#ff0000' ? 'R' : b.m_aAttrs.box[k as 'left'] ? 'b' : '-')).join('')));
    // b: left, top red; right none (inner); bottom none. c: top, right red. e: left, bottom red. f: right, bottom red.
    expect(boxes).toEqual([['bbbb', 'RR--', '-RR-'], ['bbbb', 'R--R', '--RR']]);
  });
});

describe('Table properties in files', () => {
  const setup = () => {
    const sh = grid([['a', 'b'], ['c', 'd']]);
    select(sh, 'a', 'a');
    sh.SetRowHeight(800, true);
    select(sh, 'c', 'c');
    sh.SetRowSplit(false);
    sh.ProtectCells(true);
    sh.m_pDoc.SetTableAttr(sh.m_pCursor, (t) => { t.m_aAttrs = { ...t.m_aAttrs, adjust: 'right', width: 4000, rightSpace: 300, dontSplit: true, keepWithNext: true }; });
    return sh;
  };
  it('keeps them through ODT', async () => {
    const back = (await ImportODT(await ExportODT(setup().m_pDoc))).doc;
    const t = table(back).m_pTable;
    expect(t.m_aLines.map((l) => [l.m_aAttrs.minHeight, !!l.m_aAttrs.fixHeight, !!l.m_aAttrs.cantSplit])).toEqual([[800, true, false], [0, false, true]]);
    expect(t.m_aAttrs).toMatchObject({ adjust: 'right', width: 4000, rightSpace: 300, dontSplit: true, keepWithNext: true });
    expect(t.m_aLines[1]!.m_aBoxes[0]!.m_aAttrs.protect).toBe(true);
  });
  it('keeps the row height rule and row split through DOCX', async () => {
    const back = (await ImportDOCX(await ExportDOCX(setup().m_pDoc))).doc;
    expect(table(back).m_pTable.m_aLines.map((l) => [l.m_aAttrs.minHeight, !!l.m_aAttrs.fixHeight, !!l.m_aAttrs.cantSplit])).toEqual([[800, true, false], [0, false, true]]);
  });
});

describe('Dragging table borders with the mouse (SwFEShell::WhichMouseTabCol, SetMouseTabCols, SetMouseTabRows)', () => {
  const fz = 75;
  const tab = (sh: SwWrtShell) => sh.m_pRoot.pages[0]!.tabs[0]!;

  it('finds column and row borders near the point, but not the top edge', () => {
    const sh = grid([['a', 'b', 'c'], ['d', 'e', 'f']]);
    const t = tab(sh), [c0] = t.rows[0]!.cells, mid = c0!.aFrame.Top() + c0!.aFrame.Height() / 2;
    expect(sh.WhichMouseTabCol(new Point(c0!.aFrame.Right() + 30, mid), fz)).toBe('COL_HORI');
    expect(sh.WhichMouseTabCol(new Point(c0!.aFrame.Left() + 400, c0!.aFrame.Bottom() - 20), fz)).toBe('ROW_HORI');
    expect(sh.WhichMouseTabCol(new Point(c0!.aFrame.Left() + 400, t.aFrame.Top()), fz)).toBe('COL_NONE');
    expect(sh.WhichMouseTabCol(new Point(c0!.aFrame.Left() + 400, mid), fz)).toBe('COL_NONE');
  });

  it('moves a column border, keeping the cursor and undoable', () => {
    const sh = grid([['a', 'b', 'c'], ['d', 'e', 'f']]);
    select(sh, 'f', 'f');
    const c0 = tab(sh).rows[0]!.cells[0]!, pt = new Point(c0.aFrame.Right(), c0.aFrame.Top() + 100);
    const old = sh.GetMouseTabCols(pt, fz)!;
    const w = sh.GetColWidths();
    expect(sh.SetMouseTabCols(old, { ...old, cols: [old.cols[0]! + 1000, old.cols[1]!] }, pt, fz)).toBe(true);
    expect(sh.GetColWidths()).toEqual([w[0]! + 1000, w[1]! - 1000, w[2]!]);
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('f');
    sh.Undo();
    expect(sh.GetColWidths()).toEqual(w);
  });

  it('narrows the table by its right edge, aligned left from then on', () => {
    const sh = grid([['a', 'b']]);
    const c1 = tab(sh).rows[0]!.cells[1]!, pt = new Point(c1.aFrame.Right(), c1.aFrame.Top() + 100);
    const old = sh.GetMouseTabCols(pt, fz)!;
    sh.SetMouseTabCols(old, { ...old, right: old.right - 2000 }, pt, fz);
    expect(table(sh.m_pDoc).m_pTable.m_aAttrs).toMatchObject({ adjust: 'left', width: old.right - 2000 });
    expect(Math.round(tab(sh).aFrame.Width())).toBe(old.right - 2000);
  });

  it('sets the height of the row above a row border as a minimum', () => {
    const sh = grid([['a', 'b'], ['c', 'd']]);
    const before = rowHeights(sh);
    const c = tab(sh).rows[1]!.cells[0]!, pt = new Point(c.aFrame.Left() + 300, c.aFrame.Top());
    expect(sh.SetMouseTabRows(800, pt, fz)).toBe(true);
    expect(rowHeights(sh)).toEqual([before[0]! + 800, before[1]]);
    expect(table(sh.m_pDoc).m_pTable.m_aLines[0]!.m_aAttrs).toMatchObject({ minHeight: before[0]! + 800 });
    expect(table(sh.m_pDoc).m_pTable.m_aLines[0]!.m_aAttrs.fixHeight).toBeUndefined();
  });
});
