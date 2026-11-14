// Table > Convert, Table > Sort and Table > AutoFormat Styles.
import { describe, expect, it } from 'vitest';
import { SwDoc, T2T_PARA } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwSortDirection, SwSortOrder, StrToDouble } from '../../src/lo/sw/source/core/doc/docsort.ts';
import { AutoFormatPos, DefaultTableStyle, type SwTableAutoFormat } from '../../src/lo/sw/source/core/doc/tblafmt.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import formats from '../../src/writer/generated/tableautoformats.json';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

function paras(...texts: string[]) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  texts.forEach((t, i) => { if (i) sh.SplitNode(); sh.Insert(t); });
  return sh;
}
const nodes = (sh: SwWrtShell): SwTextNode[] => { const out: SwTextNode[] = [], ns = sh.m_pDoc.GetNodes(); for (let n: SwTextNode | null = ns.FirstTextNode(); n; n = ns.GoNext(n.GetIndex())) out.push(n); return out; };
const selectAll = (sh: SwWrtShell) => { const n = nodes(sh); sh.m_pCursor.GetMark().Assign(n[0]!, 0); sh.m_pCursor.GetPoint().Assign(n[n.length - 1]!, n[n.length - 1]!.Len()); };
const table = (doc: SwDoc): SwTableNode | null => { const ns = doc.GetNodes(); for (let i = 0; i < ns.Count(); i++) { const n = ns.node(i); if (n.IsTableNode()) return n as SwTableNode; } return null; };
const cells = (sh: SwWrtShell) => table(sh.m_pDoc)!.m_pTable.m_aLines.map((l) => l.m_aBoxes.map((b) => sh.m_pDoc.GetNodes().GoNext(b.m_pStartNode!.GetIndex())!.GetText()));

describe('Convert', () => {
  it('turns tab separated paragraphs into a table with even rows, and back', () => {
    const sh = paras('a\tb\tc', 'd\te', 'f');
    selectAll(sh);
    expect(sh.TextToTable('\t', { repeat: 0, dontSplit: false, borders: true })).toBe(true);
    expect(cells(sh)).toEqual([['a', 'b', 'c'], ['d', 'e', ''], ['f', '', '']]);
    expect(sh.IsCursorInTable()).toBe(true);
    expect(sh.TableToText(';')).toBe(true);
    expect(table(sh.m_pDoc)).toBeNull();
    expect(nodes(sh).map((n) => n.GetText())).toEqual(['a;b;c', 'd;e;', 'f;;']);
    sh.Undo();
    expect(cells(sh)).toEqual([['a', 'b', 'c'], ['d', 'e', ''], ['f', '', '']]);
    sh.Undo();
    expect(table(sh.m_pDoc)).toBeNull();
    expect(nodes(sh).map((n) => n.GetText())).toEqual(['a\tb\tc', 'd\te', 'f']);
  });

  it('makes one cell per paragraph with the paragraph separator, keeping text before the selection out', () => {
    const sh = paras('keep: x', 'y');
    sh.m_pCursor.GetMark().Assign(nodes(sh)[0]!, 6);
    sh.m_pCursor.GetPoint().Assign(nodes(sh)[1]!, 1);
    sh.TextToTable(T2T_PARA, { repeat: 1, dontSplit: true, borders: false });
    expect(nodes(sh)[0]!.GetText()).toBe('keep: ');
    expect(cells(sh)).toEqual([['x'], ['y']]);
    expect(table(sh.m_pDoc)!.m_pTable.m_aAttrs.dontSplit).toBe(true);
    expect(table(sh.m_pDoc)!.m_pTable.GetRowsToRepeat()).toBe(1);
  });
});

describe('Sort', () => {
  const grid = () => {
    const sh = paras('Name\tScore', 'Bob\t10', 'alice\t9,5', 'Carol\t100');
    selectAll(sh);
    sh.TextToTable('\t', { repeat: 1, dontSplit: false, borders: true });
    sh.SelTable();
    return sh;
  };
  it('reads numbers as the locale writes them', () => {
    expect(StrToDouble('9,5 kg', 'de-DE')).toBe(9.5);
    expect(StrToDouble('1,000.25', 'en-US')).toBe(1000.25);
    expect(StrToDouble('abc', 'en-US')).toBe(0);
  });
  it('sorts the rows below the repeated heading, numerically or by the collator', () => {
    const sh = grid();
    expect(sh.SortTable({ aKeys: [{ nColumnId: 2, bIsNumeric: true, eSortOrder: SwSortOrder.Descending }], eDirection: SwSortDirection.Rows, bIgnoreCase: true, nLanguage: 'de-DE' })).toBe(true);
    expect(cells(sh)).toEqual([['Name', 'Score'], ['Carol', '100'], ['Bob', '10'], ['alice', '9,5']]);
    sh.SelTable();
    sh.SortTable({ aKeys: [{ nColumnId: 1, bIsNumeric: false, eSortOrder: SwSortOrder.Ascending }], eDirection: SwSortDirection.Rows, bIgnoreCase: true, nLanguage: 'en-US' });
    expect(cells(sh).map((r) => r[0])).toEqual(['Name', 'alice', 'Bob', 'Carol']);
    sh.Undo();
    expect(cells(sh).map((r) => r[0])).toEqual(['Name', 'Carol', 'Bob', 'alice']);
  });
  it('refuses a selection with merged cells', () => {
    const sh = grid();
    // Bob and alice merged.
    const cell = (t: string) => nodes(sh).find((n) => n.GetText() === t)!;
    sh.m_pCursor.GetMark().Assign(cell('Bob'), 0);
    sh.m_pCursor.GetPoint().Assign(cell('alice'), 0);
    sh.m_pDoc.MergeTable(sh.m_pCursor);
    sh.SelTable();
    expect(sh.SortTable({ aKeys: [{ nColumnId: 1, bIsNumeric: false, eSortOrder: SwSortOrder.Ascending }], eDirection: SwSortDirection.Rows, bIgnoreCase: true, nLanguage: 'en' })).toBe(false);
  });
});

describe('AutoFormat', () => {
  const academic = (formats as SwTableAutoFormat[]).find((f) => f.m_aName === 'Academic')!;
  it("reads LibreOffice's built-in styles", () => {
    expect((formats as SwTableAutoFormat[]).map((f) => f.m_aName)).toEqual(['Academic', 'Box List Blue', 'Box List Green', 'Box List Red', 'Box List Yellow', 'Elegant', 'Financial', 'Simple Grid Columns', 'Simple Grid Rows', 'Simple List Shaded']);
    expect(AutoFormatPos(0, 5, 0, 4)).toBe(0);
    expect(AutoFormatPos(4, 5, 3, 4)).toBe(15);
    expect(AutoFormatPos(2, 5, 2, 4)).toBe(2 * 4 + 2);
    const d = DefaultTableStyle('Liberation Serif');
    expect([d.m_aBoxAutoFormat[0]!.box.top, d.m_aBoxAutoFormat[5]!.box.top, d.m_aBoxAutoFormat[3]!.box.right]).toEqual([{ color: '#000000', width: 10 }, null, { color: '#000000', width: 10 }]);
  });

  it('formats the table by row and column class, in one undo step, and keeps the style name in ODT', async () => {
    const sh = paras('a\tb', 'c\td', 'e\tf');
    selectAll(sh);
    sh.TextToTable('\t', { repeat: 0, dontSplit: false, borders: false });
    const box = (r: number, c: number) => table(sh.m_pDoc)!.m_pTable.m_aLines[r]!.m_aBoxes[c]!;
    sh.SetTableStyle({ ...DefaultTableStyle('Liberation Sans', 'Default Table Style') });
    expect([!!box(0, 0).m_aAttrs.box.top, !!box(1, 0).m_aAttrs.box.top, !!box(0, 1).m_aAttrs.box.right]).toEqual([true, false, true]);
    expect(sh.m_pDoc.GetNodes().GoNext(box(0, 0).m_pStartNode!.GetIndex())!.GetAttr('RES_CHRATR_FONT')).toBe('Liberation Sans');
    sh.SetTableStyle(academic);
    const first = academic.m_aBoxAutoFormat[0]!, last = academic.m_aBoxAutoFormat[15]!;
    expect(box(0, 0).m_aAttrs.box.bottom).toEqual(first.box.bottom);
    expect(box(2, 1).m_aAttrs.box.bottom).toEqual(last.box.bottom);
    expect(table(sh.m_pDoc)!.m_pTable.m_aAttrs.styleName).toBe('Academic');
    const back = (await ImportODT(await ExportODT(sh.m_pDoc))).doc;
    expect(table(back)!.m_pTable.m_aAttrs.styleName).toBe('Academic');
    sh.Undo();
    expect(table(sh.m_pDoc)!.m_pTable.m_aAttrs.styleName).toBe('Default Table Style');
  });
});
