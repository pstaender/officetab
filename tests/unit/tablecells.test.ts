// Table cursor (cell selection), merging and splitting cells, splitting and merging tables.
import { describe, expect, it } from 'vitest';
import { SwDoc, SplitTable_HeadlineOption, TableMergeErr } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** A 3 × 3 table whose cells say A1 … C3. */
function grid(rows = 3, cols = 3) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.InsertTable(rows, cols, { heading: false, repeatHeading: false, borders: true });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { sh.Insert(`${'ABC'[c]}${r + 1}`); if (r < rows - 1 || c < cols - 1) sh.GoNextCell(false); }
  return sh;
}
const table = (sh: SwWrtShell, k = 0): SwTableNode => {
  const nodes = sh.m_pDoc.GetNodes(), out: SwTableNode[] = [];
  for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTableNode()) out.push(n as SwTableNode); }
  return out[k]!;
};
const cellText = (sh: SwWrtShell, box: { m_pStartNode: { GetIndex(): number; EndOfSectionNode(): { GetIndex(): number } } | null }) => {
  const nodes = sh.m_pDoc.GetNodes(), out: string[] = [];
  for (let i = box.m_pStartNode!.GetIndex() + 1; i < box.m_pStartNode!.EndOfSectionNode().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode()) out.push(n.GetText()); }
  return out.join('|');
};
/** The table as text, row by row; covered cells show as "^". */
const layout = (sh: SwWrtShell, k = 0) => table(sh, k).m_pTable.m_aLines.map((l) => l.m_aBoxes.map((b) => (b.getRowSpan() < 0 ? '^' : cellText(sh, b) + (b.getRowSpan() > 1 ? `*${b.getRowSpan()}` : ''))).join(' '));
/** Selects from the cell saying `a` to the one saying `b`. */
function select(sh: SwWrtShell, a: string, b: string) {
  const find = (t: string) => { const nodes = sh.m_pDoc.GetNodes(); for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) if (n.GetText() === t) return n; throw new Error(t); };
  sh.m_pCursor.GetMark().Assign(find(a), 0);
  sh.m_pCursor.GetPoint().Assign(find(b), 1);
}
const names = (sh: SwWrtShell) => sh.GetTableSelBoxes().map((b) => cellText(sh, b));

describe('Table cursor', () => {
  it('selects the rectangle between two cells, whole rows and whole columns', () => {
    const sh = grid();
    select(sh, 'A1', 'B2');
    expect(sh.IsTableMode()).toBe(true);
    expect(names(sh)).toEqual(['A1', 'B1', 'A2', 'B2']);
    sh.SelTableCol();
    expect(names(sh)).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    select(sh, 'B2', 'B2');
    expect(sh.IsTableMode()).toBe(false);
    sh.SelTableRow();
    expect(names(sh)).toEqual(['A2', 'B2', 'C2']);
    expect(sh.GetSelText()).toBe('A2\tB2\tC2');
  });

  it('formats and deletes only the selected cells, in one undo step', () => {
    const sh = grid();
    select(sh, 'B1', 'C2');
    sh.SetCharAttr({ RES_CHRATR_WEIGHT: true });
    const bold = (t: string) => { const nodes = sh.m_pDoc.GetNodes(); for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) if (n.GetText() === t) return n.GetCharAttrAt('RES_CHRATR_WEIGHT', 0); return null; };
    expect(['A1', 'B1', 'C1', 'A2', 'B2', 'C2'].map(bold)).toEqual([false, true, true, false, true, true]);
    sh.DelSelection();
    expect(layout(sh)).toEqual(['A1  ', 'A2  ', 'A3 B3 C3']);
    sh.Undo();
    expect(layout(sh)).toEqual(['A1 B1 C1', 'A2 B2 C2', 'A3 B3 C3']);
  });
});

describe('Merging and splitting cells', () => {
  it('merges a rectangle into its top left cell, which spans its rows', () => {
    const sh = grid();
    select(sh, 'A1', 'B2');
    expect(sh.m_pDoc.MergeTable(sh.m_pCursor)).toBe(TableMergeErr.Ok);
    expect(layout(sh)).toEqual(['A1|B1|A2|B2*2 C1', '^ C2', 'A3 B3 C3']);
    const t = table(sh).m_pTable;
    expect(t.m_aLines[0]!.m_aBoxes.map((b) => b.m_aAttrs.width)).toEqual([2, 1]);
    sh.Undo();
    expect(layout(sh)).toEqual(['A1 B1 C1', 'A2 B2 C2', 'A3 B3 C3']);
  });

  it('drops a row that only covered cells would be left in', () => {
    const sh = grid(2, 2);
    select(sh, 'A1', 'B2');
    sh.m_pDoc.MergeTable(sh.m_pCursor);
    expect(layout(sh)).toEqual(['A1|B1|A2|B2']);
  });

  it('refuses a selection that is not a rectangle of cells', () => {
    const sh = grid();
    select(sh, 'A1', 'B2');
    sh.m_pDoc.MergeTable(sh.m_pCursor);
    // C2 to A3 would cut the merged cell (its covered part is in the top row).
    select(sh, 'C2', 'A3');
    const before = layout(sh);
    expect(sh.m_pDoc.MergeTable(sh.m_pCursor)).toBe(TableMergeErr.TooComplex);
    expect(layout(sh)).toEqual(before);
  });

  it('splits a cell into columns and into rows', () => {
    const sh = grid();
    select(sh, 'B2', 'B2');
    sh.m_pDoc.SplitTable(sh.m_pCursor, sh.GetTableSelBoxes(), true, 2);
    expect(layout(sh)).toEqual(['A1 B1 C1', 'A2 B2   C2', 'A3 B3 C3']);
    const widths = table(sh).m_pTable.m_aLines[1]!.m_aBoxes.map((b) => b.m_aAttrs.width);
    expect(widths.map((w) => Math.round(w * 3))).toEqual([3, 1, 1, 1, 3]);
    sh.Undo();
    select(sh, 'B2', 'B2');
    sh.m_pDoc.SplitTable(sh.m_pCursor, sh.GetTableSelBoxes(), false, 1);
    expect(layout(sh)).toEqual(['A1 B1 C1', 'A2*2 B2 C2*2', '^  ^', 'A3 B3 C3']);
  });

  it('splits a merged cell back into its rows', () => {
    const sh = grid();
    select(sh, 'A1', 'A3');
    sh.m_pDoc.MergeTable(sh.m_pCursor);
    expect(layout(sh)).toEqual(['A1|A2|A3*3 B1 C1', '^ B2 C2', '^ B3 C3']);
    const merged = table(sh).m_pTable.m_aLines[0]!.m_aBoxes[0]!;
    sh.m_pCursor.GetPoint().Assign(sh.m_pDoc.GetNodes().GoNext(merged.m_pStartNode!.GetIndex())!, 0);
    sh.m_pCursor.DeleteMark();
    sh.m_pDoc.SplitTable(sh.m_pCursor, sh.GetTableSelBoxes(), false, 2);
    expect(layout(sh)).toEqual(['A1|A2|A3 B1 C1', ' B2 C2', ' B3 C3']);
  });
});

describe('Splitting and merging tables', () => {
  it('splits a table before the cursor row, with each heading option', () => {
    for (const [mode, second] of [
      [SplitTable_HeadlineOption.ContentCopy, ['A1 B1 C1', 'A2 B2 C2', 'A3 B3 C3']],
      [SplitTable_HeadlineOption.NONE, ['A2 B2 C2', 'A3 B3 C3']],
    ] as const) {
      const sh = grid();
      select(sh, 'B2', 'B2');
      sh.m_pCursor.DeleteMark();
      expect(sh.m_pDoc.SplitTableAt(sh.m_pCursor, mode)).toBe(true);
      expect(layout(sh, 0)).toEqual(['A1 B1 C1']);
      expect(layout(sh, 1)).toEqual(second);
      // A paragraph between them holds the cursor.
      expect(sh.IsCursorInTable()).toBe(false);
      expect(table(sh, 1).m_pTable.m_aAttrs.name).toBe('Table2');
      sh.Undo();
      expect(layout(sh)).toEqual(['A1 B1 C1', 'A2 B2 C2', 'A3 B3 C3']);
    }
  });

  it('merges two adjacent tables into the first', () => {
    const sh = grid();
    select(sh, 'B2', 'B2');
    sh.m_pCursor.DeleteMark();
    sh.m_pDoc.SplitTableAt(sh.m_pCursor, SplitTable_HeadlineOption.NONE);
    // Remove the paragraph between them.
    const para = sh.m_pCursor.GetPoint().GetNode();
    sh.m_pDoc.GetNodes().Remove(para.GetIndex());
    select(sh, 'A2', 'A2');
    sh.m_pCursor.DeleteMark();
    expect(sh.m_pDoc.CanMergeTable(sh.m_pCursor.GetPoint().GetNode())).toEqual({ prev: true, next: false });
    expect(sh.m_pDoc.MergeTables(sh.m_pCursor, true)).toBe(true);
    expect(layout(sh)).toEqual(['A1 B1 C1', 'A2 B2 C2', 'A3 B3 C3']);
    expect(sh.m_pRoot.pages[0]!.tabs.length).toBe(1);
  });
});
