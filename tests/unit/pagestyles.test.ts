import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwStartNodeType } from '../../src/lo/sw/inc/ndtyp.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };

describe('page styles', () => {
  it('start with a paragraph, follow on, renumber pages and keep their own headers', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    const doc = sh.m_pDoc;
    // The first page is a "First Page", whose follow is the Default Page Style.
    sh.SetPageDescAttr({ name: 'First Page', numOffset: null });
    sh.Insert('Title');
    sh.InsertPageBreak(null);
    sh.Insert('Body');
    sh.InsertPageBreak('Landscape', 7);
    sh.Insert('Wide');
    sh.ChangeHeaderOrFooter(true, true, false);
    const pages = sh.m_pRoot.pages;
    expect(pages.map((p) => p.pDesc.m_aName)).toEqual(['First Page', 'Default Page Style', 'Landscape']);
    expect(pages.map((p) => p.nVirtNum)).toEqual([1, 2, 7]);
    expect(pages[2]!.aFrame.Width()).toBeGreaterThan(pages[2]!.aFrame.Height());
    // The header was turned on for the Landscape style only.
    expect(pages.map((p) => !!p.aHeader)).toEqual([false, false, true]);
    expect(doc.GetNodes().FindAreaSection(SwStartNodeType.SwHeaderStartNode, 'default', 'Landscape')).not.toBeNull();
    // Narrower pages are centred against the widest one.
    expect(pages[0]!.aFrame.Left()).toBeGreaterThan(pages[2]!.aFrame.Left());

    const back = await ImportODT(await ExportODT(doc));
    expect(back.lost).toEqual([]);
    const sh2 = new SwWrtShell(back.doc, mono);
    expect(sh2.m_pRoot.pages.map((p) => [p.pDesc.m_aName, p.nVirtNum, !!p.aHeader])).toEqual([['First Page', 1, false], ['Default Page Style', 2, false], ['Landscape', 7, true]]);
    expect(back.doc.FindPageDesc('First Page')!.m_sFollow).toBe('Default Page Style');
  });
});
