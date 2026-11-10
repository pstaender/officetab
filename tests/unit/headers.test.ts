import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

/** A document long enough for three pages, with a footer "Page N of M". */
function threePages() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  for (let i = 0; i < 150; i++) { if (i) sh.SplitNode(); sh.Insert(`line ${i}`); }
  sh.ChangeHeaderOrFooter(false, true);
  sh.Insert('Page ');
  sh.InsertField('PageNumber');
  sh.Insert(' of ');
  sh.InsertField('PageCount');
  return sh;
}
const footerTexts = (sh: SwWrtShell) => sh.m_pRoot.pages.map((p) => p.frames.filter((f) => f.pArea === 'footer').flatMap((f) => f.lines.flatMap((l) => l.portions.map((x) => (x.kind === 'field' ? x.aExpand : f.node.GetText().slice(x.nStart, x.nStart + x.nLen))))).join(''));

describe('headers, footers and fields', () => {
  it('repeats the footer on every page with the page number and count', () => {
    const sh = threePages();
    const n = sh.m_pRoot.pages.length;
    expect(n).toBeGreaterThan(2);
    expect(footerTexts(sh)).toEqual(Array.from({ length: n }, (_, i) => `Page ${i + 1} of ${n}`));
    expect(sh.IsInHeaderFooter()).toBe(true);
  });

  it('pushes the body away from the header and footer', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('body');
    const before = sh.m_pRoot.pages[0]!.aPrt;
    sh.ChangeHeaderOrFooter(true, true);
    sh.Insert('head');
    const page = sh.m_pRoot.pages[0]!;
    expect(page.aHeader!.Top()).toBe(before.Top());
    expect(page.aPrt.Top()).toBe(before.Top() + 240 + 283);
    // The cursor stays in the header; Ctrl+End does not leave it.
    sh.EndDoc();
    expect(sh.IsInHeaderFooter()).toBe(true);
    sh.Down();
    expect(sh.IsInHeaderFooter()).toBe(true);
    // A click in the body goes back.
    sh.SetCursor(new Point(page.aPrt.Left() + 10, page.aPrt.Top() + 10));
    expect(sh.IsInHeaderFooter()).toBe(false);
    sh.Undo(); sh.Undo();
    expect(sh.IsHeaderOn(true)).toBe(false);
    expect(sh.m_pRoot.pages[0]!.aPrt.Top()).toBe(before.Top());
  });

  it('does not let typing extend a field', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.InsertField('PageNumber');
    sh.Insert('x');
    const n = sh.m_pCursor.GetPoint().GetNode();
    expect(n.GetCharAttrAt('RES_TXTATR_FIELD', 0)?.type).toBe('PageNumber');
    expect(n.GetCharAttrAt('RES_TXTATR_FIELD', 1)).toBeNull();
    sh.SelAll();
    expect(sh.GetSelText()).toBe('x');
  });

  it('round-trips headers, footers and fields through ODT', async () => {
    const sh = threePages();
    sh.ChangeHeaderOrFooter(true, true);
    sh.Insert('Title');
    sh.InsertField('Date', true);
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    const sh2 = new SwWrtShell(doc, mono);
    expect(footerTexts(sh2)).toEqual(footerTexts(sh));
    expect(sh2.IsHeaderOn(true)).toBe(true);
    const header = sh2.m_pRoot.pages[1]!.frames.find((f) => f.pArea === 'header')!;
    expect(header.node.GetText().startsWith('Title')).toBe(true);
    expect(header.node.GetCharAttrAt('RES_TXTATR_FIELD', 5)).toEqual({ type: 'Date', fixed: new Date().toLocaleDateString() });
    expect(sh2.m_pDoc.GetNodes().FirstTextNode().GetText()).toBe('line 0');
  });
});
