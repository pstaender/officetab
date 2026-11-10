import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';

const mono: TextMeasurer = {
  GetTextWidth: (_f: FontDesc, t: string) => t.length * 100,
  GetFontMetric: () => ({ ascent: 200, descent: 40 }),
};

const texts = (sh: SwWrtShell): string[] => {
  const out: string[] = [];
  const ns = sh.m_pDoc.GetNodes();
  for (let n: SwTextNode | null = ns.FirstTextNode(); n; n = ns.GoNext(n.GetIndex())) out.push(n.GetText());
  return out;
};
const tableOf = (sh: SwWrtShell): SwTableNode | null => sh.m_pCursor.GetPoint().GetNode().FindTableNode();
/** Text of every cell, row by row. */
const grid = (sh: SwWrtShell, t = tableOf(sh)!) => t.m_pTable.GetTabLines().map((l) => l.m_aBoxes.map((b) => sh.m_pDoc.GetNodes().GoNext(b.m_pStartNode!.GetIndex())!.GetText()));

/** Checks that start and end nodes pair up and every node's section is its enclosing start node. */
function checkStructure(doc: SwDoc): void {
  const nodes = doc.GetNodes();
  const stack: unknown[] = [];
  for (let i = 0; i < nodes.Count(); i++) {
    const n = nodes.node(i);
    expect(n.m_pStartOfSection ?? undefined).toBe(stack[stack.length - 1]);
    if (n.IsEndNode()) stack.pop();
    else if (n.IsStartNode()) stack.push(n);
  }
  expect(stack).toEqual([]);
}

function withTable(rows = 2, cols = 3) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('before');
  sh.InsertTable(rows, cols);
  return sh;
}

describe('tables', () => {
  it('inserts a table after splitting the paragraph and puts the cursor in the first cell', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('beforeafter');
    sh.m_pCursor.GetPoint().Assign(sh.m_pCursor.GetPoint().GetNode(), 6);
    sh.m_pCursor.DeleteMark();
    sh.InsertTable(2, 2);
    expect(texts(sh)).toEqual(['before', '', '', '', '', 'after']);
    expect(sh.IsCursorInTable()).toBe(true);
    const t = tableOf(sh)!;
    expect(t.m_pTable.m_nRowsToRepeat).toBe(1);
    expect(sh.m_pCursor.GetPoint().GetNode().GetTextColl().GetName()).toBe('Table Heading');
    checkStructure(sh.m_pDoc);
    sh.Undo();
    expect(texts(sh)).toEqual(['beforeafter']);
    checkStructure(sh.m_pDoc);
    sh.Redo();
    expect(texts(sh)).toEqual(['before', '', '', '', '', 'after']);
    checkStructure(sh.m_pDoc);
  });

  it('moves with Tab between cells and appends a row after the last one', () => {
    const sh = withTable(1, 2);
    sh.Insert('a'); sh.GoNextCell(); sh.Insert('b'); sh.GoNextCell(); sh.Insert('c');
    expect(grid(sh)).toEqual([['a', 'b'], ['c', '']]);
    sh.GoPrevCell();
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('b');
    checkStructure(sh.m_pDoc);
  });

  it('inserts and deletes rows and columns, with undo', () => {
    const sh = withTable(2, 2);
    sh.Insert('a'); sh.GoNextCell(); sh.Insert('b'); sh.GoNextCell(); sh.Insert('c'); sh.GoNextCell(); sh.Insert('d');
    sh.InsertRow(false);
    expect(grid(sh)).toEqual([['a', 'b'], ['', ''], ['c', 'd']]);
    sh.InsertCol(true);
    expect(grid(sh)).toEqual([['a', 'b', ''], ['', '', ''], ['c', 'd', '']]);
    checkStructure(sh.m_pDoc);
    sh.GoNextCell(); // into the new last column
    sh.DeleteCol();
    sh.GoPrevCell(); sh.GoPrevCell(); // into the empty row
    sh.DeleteRow();
    expect(grid(sh)).toEqual([['a', 'b'], ['c', 'd']]);
    sh.Undo(); sh.Undo();
    expect(grid(sh)).toEqual([['a', 'b', ''], ['', '', ''], ['c', 'd', '']]);
    checkStructure(sh.m_pDoc);
    sh.DeleteTable();
    expect(tableOf(sh)).toBeNull();
    expect(texts(sh)).toEqual(['before', '']);
    sh.Undo();
    checkStructure(sh.m_pDoc);
    expect(grid(sh)).toEqual([['a', 'b', ''], ['', '', ''], ['c', 'd', '']]);
  });

  it('does not join paragraphs across cell boundaries', () => {
    const sh = withTable(1, 2);
    sh.Insert('a'); sh.GoNextCell(); sh.Insert('b');
    sh.SelectRange(sh.m_pCursor.GetPoint().GetNode(), 0, 0);
    sh.DelLeft();
    expect(grid(sh)).toEqual([['a', 'b']]);
    // A selection across cells clears the text but keeps the cells.
    sh.SelTable();
    sh.DelSelection();
    expect(grid(sh)).toEqual([['', '']]);
    checkStructure(sh.m_pDoc);
  });

  it('lays out cells side by side with borders, padding and equal widths', () => {
    const sh = withTable(1, 2);
    sh.Insert('x');
    const page = sh.m_pRoot.pages[0]!;
    const tab = page.tabs[0]!;
    expect(tab.aFrame.Width()).toBe(page.aPrt.Width());
    const [c1, c2] = tab.rows[0]!.cells;
    expect(c1!.aFrame.Width()).toBeCloseTo(page.aPrt.Width() / 2);
    expect(c2!.aFrame.Left()).toBeCloseTo(c1!.aFrame.Left() + c1!.aFrame.Width());
    // Content is inset by the border (10) and the spacing to contents (55).
    expect(c1!.frames[0]!.nLeft).toBeCloseTo(c1!.aFrame.Left() + 65);
    expect(tab.rows[0]!.aFrame.Height()).toBe(240 + 130);
    // Clicking into the second cell puts the cursor there.
    const hit = sh.m_pRoot.GetModelPositionForViewPoint(new Point(c2!.aFrame.Left() + 200, c2!.aFrame.Top() + 100));
    expect(hit.node).toBe(c2!.frames[0]!.node);
  });

  it('moves up and down between rows and out of the table', () => {
    const sh = withTable(2, 2);
    sh.Insert('a');
    sh.Down();
    const grid0 = tableOf(sh)!.m_pTable.GetTabLines();
    expect(sh.m_pCursor.GetPoint().GetNode()).toBe(sh.m_pDoc.GetNodes().GoNext(grid0[1]!.m_aBoxes[0]!.m_pStartNode!.GetIndex()));
    sh.Down();
    expect(sh.IsCursorInTable()).toBe(false);
    sh.Up();
    expect(sh.IsCursorInTable()).toBe(true);
  });

  it('breaks long tables between rows and repeats the heading row', () => {
    const sh = withTable(60, 2);
    const pages = sh.m_pRoot.pages;
    expect(pages.length).toBeGreaterThan(1);
    const second = pages[1]!.tabs[0]!;
    expect(second.rows[0]!.bRepeated).toBe(true);
    expect(second.rows[1]!.bRepeated).toBe(false);
    // Every row is placed once, outside the repeated headings.
    const placed = pages.flatMap((p) => p.tabs.flatMap((t) => t.rows.filter((r) => !r.bRepeated)));
    expect(placed.length).toBe(60);
  });
});

import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';

const roundTrip = async (sh: SwWrtShell) => {
  const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
  expect(lost).toEqual([]);
  checkStructure(doc);
  return new SwWrtShell(doc, mono);
};
const firstTable = (sh: SwWrtShell): SwTableNode => {
  const ns = sh.m_pDoc.GetNodes();
  for (let i = 0; i < ns.Count(); i++) if (ns.node(i).IsTableNode()) return ns.node(i) as SwTableNode;
  throw new Error('no table');
};

describe('ODT tables', () => {
  it('round-trips cells, heading rows, widths, borders and lists in cells', async () => {
    const sh = withTable(2, 2);
    sh.Insert('h1'); sh.GoNextCell(); sh.Insert('h2'); sh.GoNextCell(); sh.Insert('a'); sh.ToggleNum(true); sh.GoNextCell(); sh.Insert('b');
    const t = tableOf(sh)!.m_pTable;
    t.m_aLines[1]!.m_aBoxes[0]!.m_aAttrs.width = 3;
    t.m_aLines[1]!.m_aBoxes[0]!.m_aAttrs.background = '#ffcc00';
    t.m_aLines[0]!.m_aBoxes[0]!.m_aAttrs.width = 3;
    const sh2 = await roundTrip(sh);
    const t2 = firstTable(sh2);
    expect(grid(sh2, t2)).toEqual([['h1', 'h2'], ['a', 'b']]);
    expect(t2.m_pTable.m_nRowsToRepeat).toBe(1);
    const [b0, b1] = t2.m_pTable.m_aLines[1]!.m_aBoxes;
    expect(b0!.m_aAttrs.width / (b0!.m_aAttrs.width + b1!.m_aAttrs.width)).toBeCloseTo(0.75, 3);
    expect(b0!.m_aAttrs.background).toBe('#ffcc00');
    expect(b0!.m_aAttrs.box.left).toEqual({ color: '#000000', width: 10 });
    expect(sh2.m_pRoot.m_aNums.get(sh2.m_pDoc.GetNodes().GoNext(b0!.m_pStartNode!.GetIndex())!)?.label).toBe('1.');
    expect(texts(sh2)).toEqual(['before', 'h1', 'h2', 'a', 'b', '']);
  });

  it('round-trips merged cells and nested tables', async () => {
    const sh = withTable(2, 3);
    const t = tableOf(sh)!;
    // Merge the first row's last two boxes horizontally and the first column vertically.
    const [l0, l1] = t.m_pTable.m_aLines;
    l0!.m_aBoxes[0]!.setRowSpan(2);
    l1!.m_aBoxes[0]!.setRowSpan(-1);
    sh.GoNextCell();
    sh.InsertTable(1, 2);
    const sh2 = await roundTrip(sh);
    const t2 = firstTable(sh2);
    expect(t2.m_pTable.m_aLines.map((l) => l.m_aBoxes.map((b) => b.getRowSpan()))).toEqual([[2, 1, 1], [-1, 1, 1]]);
    const nested = sh2.m_pDoc.GetNodes().node(t2.m_pTable.m_aLines[0]!.m_aBoxes[1]!.m_pStartNode!.GetIndex() + 1);
    expect(nested.IsTableNode()).toBe(true);
    // The merged cell spans both rows in the layout.
    const cell = sh2.m_pRoot.pages[0]!.tabs[0]!.rows[0]!.cells[0]!;
    expect(cell.aFrame.Height()).toBeCloseTo(sh2.m_pRoot.pages[0]!.tabs[0]!.aFrame.Height());
  });

  it('imports LibreOffice table markup with spans and repeated columns', async () => {
    const content = `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:text="t" xmlns:table="tb" xmlns:style="s" xmlns:fo="f"><office:automatic-styles>
      <style:style style:name="Table1" style:family="table"><style:table-properties style:width="10cm" table:align="center"/></style:style>
      <style:style style:name="Table1.A" style:family="table-column"><style:table-column-properties style:column-width="2cm" style:rel-column-width="1*"/></style:style>
      <style:style style:name="Table1.B" style:family="table-column"><style:table-column-properties style:column-width="4cm" style:rel-column-width="2*"/></style:style>
      <style:style style:name="Table1.A1" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #ff0000"/></style:style>
      </office:automatic-styles><office:body><office:text>
      <table:table table:name="Table1" table:style-name="Table1"><table:table-column table:style-name="Table1.A"/><table:table-column table:style-name="Table1.B" table:number-columns-repeated="2"/>
      <table:table-row><table:table-cell table:style-name="Table1.A1" table:number-columns-spanned="2"><text:p>wide</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>c</text:p></table:table-cell></table:table-row>
      <table:table-row><table:table-cell><text:p>1</text:p></table:table-cell><table:table-cell><text:p>2</text:p></table:table-cell><table:table-cell/></table:table-row>
      </table:table></office:text></office:body></office:document-content>`;
    const { doc, lost } = await ImportODT(await writeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }]));
    expect(lost).toEqual([]);
    checkStructure(doc);
    const sh = new SwWrtShell(doc, mono);
    const t = firstTable(sh);
    expect(grid(sh, t)).toEqual([['wide', 'c'], ['1', '2', '']]);
    expect(t.m_pTable.m_aLines[0]!.m_aBoxes.map((b) => b.m_aAttrs.width)).toEqual([3, 2]);
    expect(t.m_pTable.m_aAttrs).toMatchObject({ adjust: 'center' });
    expect(t.m_pTable.m_aLines[0]!.m_aBoxes[0]!.m_aAttrs.box.top).toEqual({ color: '#ff0000', width: 10 });
    // The document starts with the table and ends with an empty paragraph after it.
    expect(sh.m_pDoc.GetNodes().node(sh.m_pDoc.GetNodes().BodyStart()).IsTableNode()).toBe(true);
    expect(texts(sh)).toEqual(['wide', 'c', '1', '2', '', '']);
  });
});

describe('Format > Align Text > Top, Center, Bottom (SwFEShell::SetBoxAlign)', () => {
  it('aligns the cell content vertically, with undo', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.InsertTable(1, 2);
    // A tall neighbour: the first cell has room below its line.
    sh.GoNextCell(); sh.Insert('a'); for (let i = 0; i < 4; i++) { sh.SplitNode(); sh.Insert('b'); }
    sh.GoPrevCell(); sh.Insert('x');
    expect(sh.GetBoxAlign()).toBe('top');
    const cell = () => sh.m_pRoot.pages[0]!.tabs[0]!.rows[0]!.cells[0]!;
    const topGap = () => cell().frames[0]!.nTop - cell().aFrame.Top();
    const before = topGap();
    sh.SetBoxAlign('bottom');
    expect(sh.GetBoxAlign()).toBe('bottom');
    expect(topGap()).toBeGreaterThan(before + 500);
    sh.SetBoxAlign('center');
    const centred = topGap();
    expect(centred).toBeGreaterThan(before);
    expect(centred).toBeLessThan(before + 500 + 1000);
    sh.Undo();
    expect(sh.GetBoxAlign()).toBe('bottom');
  });
});
