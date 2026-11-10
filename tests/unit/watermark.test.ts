// Format > Watermark (SwEditShell::SetWatermark / GetWatermark).
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { DefaultWatermark, GetWatermark, SetWatermark } from '../../src/lo/sw/source/core/edit/edfcol.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (f: FontDesc, t: string) => t.length * f.size * 0.6, GetFontMetric: (f) => ({ ascent: f.size * 0.9, descent: f.size * 0.2 }) };

function doc() {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('Body');
  sh.InsertPageBreak(null);
  sh.Insert('Second');
  return sh;
}
const draft = { ...DefaultWatermark(), m_aText: 'DRAFT' };

describe('Watermark', () => {
  it('puts a centred, turned Fontwork shape into the header of every page', () => {
    const sh = doc();
    expect(GetWatermark(sh).m_aText).toBe('');
    SetWatermark(sh, draft);
    expect(sh.IsHeaderOn(true)).toBe(true);
    expect(GetWatermark(sh)).toEqual({ m_aText: 'DRAFT', m_aFont: 'Liberation Sans', m_nAngle: 45, m_nTransparency: 50, m_nColor: '#c0c0c0' });
    const pd = sh.m_pDoc.m_aPageDesc;
    for (const page of sh.m_pRoot.pages) {
      const fly = page.flys.find((f) => f.fmt.m_aName.startsWith('PowerPlusWaterMarkObject'))!;
      // As wide as the text area, as high as the text at that width (5 characters: 3 × 1.1 / 5 · 0.6).
      expect(fly.aFrame.Width()).toBe(pd.PrintWidth());
      expect(fly.aFrame.Height()).toBe(Math.trunc((1.1 / 3) * pd.PrintWidth()));
      // Centred on the area between header and footer.
      expect(Math.abs(fly.aFrame.Left() + fly.aFrame.Width() / 2 - (page.aPrt.Left() + page.aPrt.Width() / 2))).toBeLessThan(1);
      expect(Math.abs(fly.aFrame.Top() + fly.aFrame.Height() / 2 - (page.aPrt.Top() + page.aPrt.Height() / 2))).toBeLessThan(1);
      expect(fly.fmt.m_pShape!.m_nRotate).toBe(315);
      expect(fly.fmt.m_bOpaque).toBe(false);
    }
  });

  it('keeps the watermark through ODT', async () => {
    const sh = doc();
    SetWatermark(sh, { ...draft, m_aFont: 'DejaVu Sans', m_nAngle: 30, m_nTransparency: 20, m_nColor: '#ff0000' });
    const back = new SwWrtShell((await ImportODT(await ExportODT(sh.m_pDoc))).doc, mono);
    expect(GetWatermark(back)).toEqual({ m_aText: 'DRAFT', m_aFont: 'DejaVu Sans', m_nAngle: 30, m_nTransparency: 20, m_nColor: '#ff0000' });
  });

  it('replaces a changed watermark, removes it with an empty text, and undoes in one step', () => {
    const sh = doc();
    SetWatermark(sh, draft);
    SetWatermark(sh, { ...draft, m_aText: 'COPY' });
    const shapes = () => sh.m_pRoot.pages[0]!.flys.filter((f) => f.fmt.m_aName.startsWith('PowerPlusWaterMarkObject')).map((f) => f.fmt.m_pShape!.m_sText);
    expect(shapes()).toEqual(['COPY']);
    sh.Undo();
    expect(shapes()).toEqual(['DRAFT']);
    SetWatermark(sh, DefaultWatermark());
    expect(shapes()).toEqual([]);
    expect(GetWatermark(sh).m_aText).toBe('');
  });

  it('keeps the watermark through DOCX as a VML text path, as Word writes it', async () => {
    const sh = doc();
    SetWatermark(sh, { ...draft, m_aFont: 'Calibri', m_nAngle: 45, m_nTransparency: 50, m_nColor: '#c0c0c0' });
    const r = await ImportDOCX(await ExportDOCX(sh.m_pDoc));
    expect(r.lost).toEqual([]);
    const back = new SwWrtShell(r.doc, mono);
    expect(GetWatermark(back)).toEqual({ m_aText: 'DRAFT', m_aFont: 'Calibri', m_nAngle: 45, m_nTransparency: 50, m_nColor: '#c0c0c0' });
    const fly = back.m_pRoot.pages[0]!.flys.find((f) => f.fmt.m_pShape?.m_bTextPath)!;
    expect(fly.fmt.m_bOpaque).toBe(false);
    expect(fly.aFrame.Width()).toBe(sh.m_pDoc.m_aPageDesc.PrintWidth());
  });
});
