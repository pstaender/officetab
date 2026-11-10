import { describe, expect, it } from 'vitest';
import { SwDoc, SwPosition } from '../../src/lo/sw/inc/doc.ts';
import { SwPaM } from '../../src/lo/sw/inc/pam.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';
import { SwRootFrame } from '../../src/lo/sw/source/core/layout/pagechg.ts';
import { FormatParagraph } from '../../src/lo/sw/source/core/text/itrform2.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

/** Monospace: every character is 100 wide; font ascent 200, descent 40. */
const mono: TextMeasurer = {
  GetTextWidth: (_f: FontDesc, t: string) => t.length * 100,
  GetFontMetric: () => ({ ascent: 200, descent: 40 }),
};

function doc1(text: string) {
  const doc = new SwDoc();
  const pam = new SwPaM(new SwPosition(doc.GetNodes().FirstTextNode(), 0));
  if (text) doc.InsertString(pam, text);
  return { doc, pam, node: pam.GetPoint().GetNode() };
}
const lineTexts = (n: SwTextNode, width: number) => FormatParagraph(n, width, mono).lines.map((l) => n.GetText().slice(l.nStart, l.nStart + l.nLen));

describe('FormatParagraph', () => {
  it('breaks at spaces and lets trailing spaces hang', () => {
    const { node } = doc1('aaaa bbbb cccc');
    expect(lineTexts(node, 900)).toEqual(['aaaa bbbb ', 'cccc']);
  });

  it('breaks at a space in an earlier attribute run', () => {
    const { node } = doc1('aaaa bbbbbbb');
    node.SetAttr(5, 12, { RES_CHRATR_WEIGHT: true });
    expect(lineTexts(node, 800)).toEqual(['aaaa ', 'bbbbbbb']);
  });

  it('splits a word longer than the line', () => {
    const { node } = doc1('abcdefghij');
    expect(lineTexts(node, 400)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('honours hard line breaks and an empty final line', () => {
    const { node } = doc1('ab\ncd\n');
    expect(lineTexts(node, 1000)).toEqual(['ab\n', 'cd\n', '']);
  });

  it('advances tabs to default stops', () => {
    const { node } = doc1('a\tb');
    const [l] = FormatParagraph(node, 5000, mono).lines;
    expect(l!.portions.map((p) => [p.kind, p.nX])).toEqual([['text', 0], ['tab', 100], ['text', 709]]);
  });

  it('aligns and justifies, excluding hanging space and the last line', () => {
    const { doc, pam, node } = doc1('aa bb cc dd');
    doc.SetParaAttr(pam, { RES_PARATR_ADJUST: 'block' });
    const lines = FormatParagraph(node, 600, mono).lines;
    expect(lines.map((l) => l.nSpaceAdd)).toEqual([100, 0]);
    doc.SetParaAttr(pam, { RES_PARATR_ADJUST: 'right' });
    expect(FormatParagraph(node, 600, mono).lines.map((l) => l.nX)).toEqual([100, 100]);
    doc.SetParaAttr(pam, { RES_PARATR_ADJUST: 'center' });
    expect(FormatParagraph(node, 600, mono).lines.map((l) => l.nX)).toEqual([50, 50]);
  });

  it('applies proportional spacing to all but the first line', () => {
    const { doc, pam, node } = doc1('aaaa bbbb');
    doc.SetParaAttr(pam, { RES_PARATR_LINESPACING: { rule: 'proportional', value: 150 } });
    expect(FormatParagraph(node, 500, mono).lines.map((l) => l.nRealHeight)).toEqual([240, 360]);
  });

  it('uses fixed spacing with an 80% ascent', () => {
    const { doc, pam, node } = doc1('a');
    doc.SetParaAttr(pam, { RES_PARATR_LINESPACING: { rule: 'fix', value: 500 } });
    const [l] = FormatParagraph(node, 500, mono).lines;
    expect([l!.nRealHeight, l!.nAscent]).toEqual([500, 400]);
  });
});

function paged(lineCounts: number[], lineWidth = 1000) {
  const doc = new SwDoc();
  const pd = doc.m_aPageDesc;
  pd.nLeft = pd.nRight = 0; pd.nTop = pd.nBottom = 0;
  pd.nWidth = lineWidth; pd.nHeight = 2400; // exactly 10 lines of 240
  const pam = new SwPaM(new SwPosition(doc.GetNodes().FirstTextNode(), 0));
  lineCounts.forEach((c, i) => {
    if (i) doc.SplitNode(pam);
    doc.InsertString(pam, Array.from({ length: c }, () => 'x'.repeat(lineWidth / 100 - 1)).join(' '));
  });
  const root = new SwRootFrame(doc, mono);
  return { doc, root, pam };
}
const shape = (r: SwRootFrame) => r.pages.map((p) => p.frames.map((f) => f.lines.length));

describe('SwRootFrame pagination', () => {
  it('fills a page and flows a paragraph onto the next', () => {
    const { root } = paged([12]);
    root.Layout();
    expect(shape(root)).toEqual([[10], [2]]);
  });

  it('respects widows by pulling a line to the next page', () => {
    const { doc, root } = paged([11]);
    doc.GetNodes().FirstTextNode().m_aSet.RES_PARATR_WIDOWS = 2;
    root.Layout();
    expect(shape(root)).toEqual([[9], [2]]);
  });

  it('respects orphans by moving the whole paragraph', () => {
    const { doc, root } = paged([9, 5]);
    const second = doc.GetNodes().LastTextNode();
    second.m_aSet.RES_PARATR_ORPHANS = 2;
    root.Layout();
    expect(shape(root)).toEqual([[9], [5]]);
  });

  it('keeps a keep-with-next paragraph with its successor', () => {
    const { doc, root } = paged([9, 1, 3]);
    const nodes = doc.GetNodes();
    (nodes.GoNext(nodes.FirstTextNode().GetIndex()) as SwTextNode).m_aSet.RES_KEEP = true;
    root.Layout();
    expect(shape(root)).toEqual([[9], [1, 3]]);
  });

  it('starts a new page for a page-break-before paragraph', () => {
    const { doc, root } = paged([1, 1]);
    doc.GetNodes().LastTextNode().m_aSet.RES_BREAK = 'page-before';
    root.Layout();
    expect(shape(root)).toEqual([[1], [1]]);
  });

  it('adds lower and upper paragraph spacing between paragraphs', () => {
    const { doc, root } = paged([1, 1]);
    const first = doc.GetNodes().FirstTextNode();
    first.m_aSet.RES_UL_SPACE = { upper: 0, lower: 100 };
    doc.GetNodes().LastTextNode().m_aSet.RES_UL_SPACE = { upper: 50, lower: 0 };
    root.Layout();
    const [a, b] = root.pages[0]!.frames;
    expect(b!.nTop - a!.nTop).toBe(240 + 150);
  });

  it('terminates when one line is taller than the page', () => {
    const { doc, root } = paged([1]);
    doc.GetNodes().FirstTextNode().m_aSet.RES_PARATR_LINESPACING = { rule: 'fix', value: 5000 };
    root.Layout();
    expect(shape(root)).toEqual([[1]]);
  });

  it('maps positions to rectangles and back', () => {
    const { doc, root } = paged([12]);
    root.Layout();
    const node = doc.GetNodes().FirstTextNode();
    for (const content of [0, 3, 25, 45, 105, 118]) {
      const r = root.GetCharRect(node, content)!;
      const back = root.GetModelPositionForViewPoint(new Point(r.Left(), r.Top() + 10));
      expect(back.node).toBe(node);
      expect(back.content).toBe(content);
    }
  });

  it('re-formats only paragraphs whose version changed', () => {
    const { doc, root } = paged([1, 1]);
    root.Layout();
    const before = root.pages[0]!.frames.map((f) => f.lines);
    doc.GetNodes().LastTextNode().InsertText('y', 0);
    root.Layout();
    const after = root.pages[0]!.frames.map((f) => f.lines);
    expect(after[0]![0]).toBe(before[0]![0]);
    expect(after[1]![0]).not.toBe(before[1]![0]);
  });
});

describe('tab stops', () => {
  const tabbed = (text: string, stops: import('../../src/lo/sw/inc/hintids.ts').SvxTabStop[], lr?: { left: number; right: number; firstLine: number }) => {
    const { node } = doc1(text);
    node.m_aSet.RES_PARATR_TABSTOP = stops;
    if (lr) node.m_aSet.RES_LR_SPACE = lr;
    return FormatParagraph(node, 10000, mono).lines[0]!.portions;
  };
  const stop = (pos: number, adjust: 'left' | 'right' | 'center' | 'decimal', fill = ' ') => ({ pos, adjust, fill, decimal: '.' });

  it('aligns text after left, right, centre and decimal stops', () => {
    expect(tabbed('a\tb', [stop(2000, 'left')])[2]!.nX).toBe(2000);
    expect(tabbed('a\tbb', [stop(2000, 'right')])[2]!.nX).toBe(1800);
    expect(tabbed('a\tbbbb', [stop(2000, 'center')])[2]!.nX).toBe(1800);
    expect(tabbed('a\t12.50', [stop(2000, 'decimal')])[2]!.nX).toBe(1800);
  });

  it('uses default stops after the last one, relative to the indent, at least 51 twips away', () => {
    expect(tabbed('a\tb', [])[1]!.nWidth).toBe(709 - 100);
    // 690 is within 50 of the first default stop at 709, so the next one is used.
    expect(tabbed('aaaaaa\tb', [])[2]!.nX).toBe(709);
    expect(tabbed('a\tb', [], { left: 300, right: 0, firstLine: 0 })[2]!.nX).toBe(709);
  });

  it('stops at the indent inside a hanging indent', () => {
    const p = tabbed('1.\ttext', [], { left: 1000, right: 0, firstLine: -1000 });
    expect(p[2]!.nX).toBe(1000);
  });

  it('keeps the fill character for painting', () => {
    expect(tabbed('a\tb', [stop(3000, 'right', '.')])[1]).toMatchObject({ kind: 'tab', aFill: '.' });
  });
});
