// Table rows breaking across pages (SwTabFrame::Split with a follow flow row).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** A paragraph, then a 2 × 1 table whose second row's first cell has `n` paragraphs. */
function doc(n: number) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Before');
  sh.SplitNode();
  sh.InsertTable(2, 2, { heading: true, repeatHeading: true, borders: true });
  sh.Insert('Head'); sh.GoNextCell(false); sh.Insert('Head 2'); sh.GoNextCell(false);
  for (let i = 0; i < n; i++) { if (i) sh.SplitNode(); sh.Insert(`Line ${i + 1}`); }
  sh.GoNextCell(false); sh.Insert('Right');
  return sh;
}
const table = (sh: SwWrtShell): SwTableNode => { const ns = sh.m_pDoc.GetNodes(); for (let i = 0; i < ns.Count(); i++) { const x = ns.node(i); if (x.IsTableNode()) return x as SwTableNode; } throw new Error(); };
const linesOn = (sh: SwWrtShell, page: number) => sh.m_pRoot.pages[page]!.frames.filter((f) => f.pCell && /^Line/.test(f.node.GetText())).map((f) => f.node.GetText());

describe('Rows across pages', () => {
  it('breaks a long row at the page bottom and repeats the heading above its rest', () => {
    const sh = doc(80);
    expect(sh.m_pRoot.pages.length).toBe(2);
    const [p1, p2] = sh.m_pRoot.pages;
    // The row's first part ends at the page bottom.
    const tab1 = p1!.tabs[0]!, last1 = tab1.rows[tab1.rows.length - 1]!;
    expect(Math.round(last1.aFrame.Top() + last1.aFrame.Height())).toBe(Math.round(p1!.aPrt.Top() + p1!.aPrt.Height()));
    // Page 2 starts with the repeated heading, then the rest of the row.
    const tab2 = p2!.tabs[0]!;
    expect(tab2.rows[0]!.bRepeated).toBe(true);
    expect(Math.round(tab2.aFrame.Top())).toBe(Math.round(p2!.aPrt.Top()));
    const all = [...linesOn(sh, 0), ...linesOn(sh, 1)];
    expect(all).toEqual(Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`));
    expect(linesOn(sh, 1).length).toBeGreaterThan(0);
    // The right cell stays in the first part.
    expect(p1!.frames.some((f) => f.node.GetText() === 'Right')).toBe(true);
  });

  it('moves a row that may not break to the next page as a whole', () => {
    const make = (cantSplit: boolean) => {
      const sh = new SwWrtShell(new SwDoc(), mono);
      for (let i = 0; i < 40; i++) { if (i) sh.SplitNode(); sh.Insert(`Para ${i + 1}`); }
      sh.SplitNode();
      sh.InsertTable(1, 1, { heading: false, repeatHeading: false, borders: true });
      for (let i = 0; i < 30; i++) { if (i) sh.SplitNode(); sh.Insert(`Line ${i + 1}`); }
      if (cantSplit) sh.SetRowSplit(false);
      return sh;
    };
    const split = make(false), whole = make(true);
    expect(linesOn(split, 0).length).toBeGreaterThan(0);
    expect(linesOn(split, 0).length + linesOn(split, 1).length).toBe(30);
    expect(linesOn(whole, 0)).toEqual([]);
    expect(linesOn(whole, 1).length).toBe(30);
  });

  it('moves a table that may not split to the next page when it fits there', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    for (let i = 0; i < 40; i++) { if (i) sh.SplitNode(); sh.Insert(`Para ${i + 1}`); }
    sh.SplitNode();
    sh.InsertTable(10, 1, { heading: false, repeatHeading: false, borders: true });
    sh.m_pDoc.SetTableAttr(sh.m_pCursor, (t) => { t.m_aAttrs = { ...t.m_aAttrs, dontSplit: true }; });
    const pages = sh.m_pRoot.pages;
    const pieces = pages.map((p) => p.tabs.length);
    expect(pieces.filter(Boolean).length).toBe(1);
  });
});
