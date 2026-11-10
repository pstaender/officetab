import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { fontAt } from '../../src/lo/sw/source/core/text/itrform2.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const para = (sh: SwWrtShell) => sh.m_pCursor.GetPoint().GetNode();

describe('hyperlinks', () => {
  it('inserts a link, does not grow it when typing at its end, and styles it', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('See ');
    sh.InsertURL('https://example.org/', 'example');
    sh.Insert(' now');
    const n = para(sh);
    expect(n.GetText()).toBe('See example now');
    expect(sh.GetINetAttr(n, 5)).toEqual({ url: 'https://example.org/', start: 4, end: 11 });
    expect(sh.GetINetAttr(n, 13)).toBeNull();
    expect(fontAt(n, 5)).toMatchObject({ color: '#000080', underline: 'single' });
    expect(fontAt(n, 1)).toMatchObject({ color: null, underline: 'none' });
  });

  it('links a selection, keeps the link when clearing direct formatting, and removes it', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('click here');
    sh.SelectRange(para(sh), 6, 10);
    sh.InsertURL('https://a.test/', 'here');
    sh.SelectRange(para(sh), 0, 10);
    sh.SetCharAttr({ RES_CHRATR_WEIGHT: true });
    sh.ResetAttrs();
    expect(sh.GetINetAttr(para(sh), 7)?.url).toBe('https://a.test/');
    sh.SelectRange(para(sh), 7, 7);
    sh.DeleteINetAttr();
    expect(sh.GetINetAttr(para(sh), 7)).toBeNull();
    expect(para(sh).GetText()).toBe('click here');
    sh.Undo();
    expect(sh.GetINetAttr(para(sh), 7)?.url).toBe('https://a.test/');
  });

  it('round-trips through ODT as text:a, with formatting inside the link', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('a ');
    sh.InsertURL('https://example.org/?q=1&r=2', 'link');
    sh.SelectRange(para(sh), 2, 4);
    sh.SetCharAttr({ RES_CHRATR_WEIGHT: true });
    const { doc, lost } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(lost).toEqual([]);
    const sh2 = new SwWrtShell(doc, mono);
    const n = sh2.m_pCursor.GetPoint().GetNode();
    expect(n.GetText()).toBe('a link');
    expect(sh2.GetINetAttr(n, 3)).toEqual({ url: 'https://example.org/?q=1&r=2', start: 2, end: 6 });
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 2)).toBe(true);
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 5)).toBe(false);
    // The link style's colour is not turned into direct formatting.
    expect(n.m_aHints.some((h) => h.aAttrs.RES_CHRATR_COLOR)).toBe(false);
  });
});
