import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { IsOverHeaderFooterArea } from '../../src/lo/sw/source/core/layout/pagechg.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

describe('header and footer controls', () => {
  it('tells the header and footer areas of a page apart from its body', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('body');
    const page = sh.m_pRoot.pages[0]!;
    const x = page.aPrt.Left() + 100;
    expect(IsOverHeaderFooterArea(page, new Point(x, page.aFrame.Top() + 10))).toBe('header');
    expect(IsOverHeaderFooterArea(page, new Point(x, page.aPrt.Top() + 10))).toBeNull();
    expect(IsOverHeaderFooterArea(page, new Point(x, page.aFrame.Bottom() - 10))).toBe('footer');
    // Editing a header shows the header controls without a click.
    expect(sh.IsShowHeaderFooterSeparator('header')).toBe(false);
    sh.ChangeHeaderOrFooter(true, true);
    expect(sh.IsShowHeaderFooterSeparator('header')).toBe(true);
    expect(sh.IsShowHeaderFooterSeparator('footer')).toBe(false);
  });

  it('turns the header on or off for one page style, or for all of them', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('body');
    sh.m_pDoc.FindPageDesc('Landscape');
    sh.ChangeHeaderOrFooter(true, true, true, 'Landscape');
    expect(sh.IsHeaderOn(true, 'Landscape')).toBe(true);
    expect(sh.IsHeaderOn(true, 'Default Page Style')).toBe(false);
    // The cursor goes into that style's header (SetCursorInHdFt).
    expect(sh.IsInHeaderFooter()).toBe(true);
    expect(sh.GetCurPageDesc().m_aName).toBe('Landscape');
    // "All": every page style of the document.
    sh.ChangeHeaderOrFooter(true, true, true, '');
    expect(sh.IsHeaderOn(true, 'Default Page Style')).toBe(true);
    expect(sh.IsInHeaderFooter()).toBe(true);
    sh.ChangeHeaderOrFooter(true, false, true, '');
    expect(sh.IsHeaderOn(true, 'Default Page Style') || sh.IsHeaderOn(true, 'Landscape')).toBe(false);
    expect(sh.IsInHeaderFooter()).toBe(false);
  });

  it('insets the header content by its border and padding, and round-trips them through ODT', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('body');
    sh.ChangeHeaderOrFooter(true, true);
    sh.Insert('head');
    const plain = sh.m_pRoot.pages[0]!;
    const plainHeight = plain.aHeader!.Height(), plainText = plain.frames.find((f) => f.pArea === 'header')!;
    const line = { color: '#ff0000', width: 20 };
    sh.ChgPageDesc(sh.GetCurPageDesc(), (d) => { d.m_aHeaderBox = { top: null, bottom: line, left: line, right: null, padding: 100 }; d.m_aHeaderBackground = '#eeeeee'; });
    const page = sh.m_pRoot.pages[0]!;
    const text = page.frames.find((f) => f.pArea === 'header')!;
    expect(page.aHeader!.Height()).toBe(plainHeight + 100 + 20 + 100);
    expect(text.nTop).toBe(plainText.nTop + 100);
    expect(text.nLeft).toBe(plainText.nLeft + 20 + 100);
    expect(text.nWidth).toBe(plainText.nWidth - 20 - 100 - 100);

    const { doc } = await ImportODT(await ExportODT(sh.m_pDoc));
    const d = doc.m_aPageDesc;
    expect(d.m_aHeaderBox).toEqual({ top: null, bottom: line, left: line, right: null, padding: 100 });
    expect(d.m_aHeaderBackground).toBe('#eeeeee');
    expect(d.m_aFooterBox).toBeNull();
  });
});
