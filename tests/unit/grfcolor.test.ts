// Image colour attributes: the drawinglayer colour modifiers, SwGrfShell's attributes and their
// ODT and DOCX forms.
import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { BColorModifierStack, BColorModifier_RGBLuminanceContrast, BColorModifier_gamma } from '../../src/lo/basegfx/source/color/bcolormodifier.ts';
import { GraphicDrawMode, GraphicModifierKey, GraphicModifierStack } from '../../src/lo/drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import { Modify } from '../../src/lo/vcl/source/bitmap/bitmap.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import type { BColor } from '../../src/lo/basegfx/source/color/bcolortools.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
const close = (a: BColor, b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe('Colour modifiers (bcolormodifier.cxx)', () => {
  // Reference values from upstream's code compiled as C++.
  const px: BColor[] = [[0.2, 0.5, 0.8], [1, 0, 0.25], [0.05, 0.95, 0.6]];
  it('RGBLuminanceContrast', () => {
    const m = new BColorModifier_RGBLuminanceContrast(0.1, -0.2, 0.3, 0.25, -0.4);
    close(m.getModifiedColor(px[0]!), [0.669840686275, 0.550778186275, 1]);
    close(m.getModifiedColor(px[1]!), [1, 0.249215686275, 0.899996936275]);
    close(m.getModifiedColor(px[2]!), [0.579371936275, 0.822184436275, 1]);
  });
  it('the watermark: luminance +50 %, contrast -70 %', () => {
    const s = GraphicModifierStack({ m_eDrawMode: GraphicDrawMode.Watermark });
    close(s.getModifiedColor(px[0]!), [0.909721200980, 1, 1]);
    close(s.getModifiedColor(px[1]!), [1, 0.848627450980, 0.924994638480]);
  });
  it('gamma with the approximate power', () => {
    const g = new BColorModifier_gamma(2.2);
    expect(g.getModifiedColor(px[0]!)[0]).toBeCloseTo(0.469365596771, 9);
    expect(g.getModifiedColor(px[0]!)[1]).toBeCloseTo(0.756913185120, 9);
    expect(new BColorModifier_gamma(0.5).getModifiedColor(px[2]!)[2]).toBeCloseTo(0.364495992661, 9);
  });
  it('applies grey first, then the adjustments, then inversion; Modify keeps alpha', () => {
    const s = GraphicModifierStack({ m_eDrawMode: GraphicDrawMode.Greys, m_bInvert: true });
    // Grey of (1, 0, 0) is 77/256, inverted.
    close(s.getModifiedColor([1, 0, 0]), [1 - 77 / 256, 1 - 77 / 256, 1 - 77 / 256]);
    const mono = GraphicModifierStack({ m_eDrawMode: GraphicDrawMode.Mono });
    expect(mono.getModifiedColor([0.6, 0.6, 0.6])).toEqual([1, 1, 1]);
    expect(mono.getModifiedColor([0.4, 0.4, 0.4])).toEqual([0, 0, 0]);
    const out = Modify({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 128]) }, s);
    expect([...out.data]).toEqual([178, 178, 178, 128]);
    expect(Modify({ width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4]) }, new BColorModifierStack()).data).toEqual(new Uint8ClampedArray([1, 2, 3, 4]));
    expect(GraphicModifierKey({ m_nTransparency: 40 })).toBe('');
    expect(GraphicModifierKey({ m_nLuminance: 10 })).not.toBe('');
  });
});

function image(asChar: boolean) {
  const sh = new SwWrtShell(new SwDoc(), mono);
  sh.Insert('x');
  const name = sh.InsertGraphic(PNG, 'image/png', { width: 1440, height: 720 }, asChar);
  sh.SelectFly(name);
  return sh;
}

describe('Image colour attributes', () => {
  it('are set on the selected image, one undo step each', () => {
    const sh = image(true);
    sh.SetGrfAttr({ m_nLuminance: 20, m_eDrawMode: GraphicDrawMode.Greys });
    sh.SetGrfAttr({ m_nTransparency: 30 });
    expect(sh.GetGrfAttr()).toEqual({ m_nLuminance: 20, m_eDrawMode: GraphicDrawMode.Greys, m_nTransparency: 30 });
    sh.Undo();
    sh.SelectFly(sh.m_pDoc.GetFlyFormats()[0]!.name);
    expect(sh.GetGrfAttr()).toEqual({ m_nLuminance: 20, m_eDrawMode: GraphicDrawMode.Greys });
    // Back to the defaults: no attributes left.
    sh.SetGrfAttr({ m_nLuminance: 0, m_eDrawMode: GraphicDrawMode.Standard });
    expect(sh.GetFlyFrameFormat()!.m_aGrfAttr).toBeUndefined();
  });

  it('keep every attribute through ODT', async () => {
    for (const asChar of [true, false]) {
      const sh = image(asChar);
      const a = { m_nLuminance: -15, m_nContrast: 25, m_nChannelR: 10, m_nChannelG: -20, m_nChannelB: 30, m_fGamma: 1.5, m_bInvert: true, m_nTransparency: 40, m_eDrawMode: GraphicDrawMode.Watermark };
      sh.SetGrfAttr(a);
      const back = new SwWrtShell((await ImportODT(await ExportODT(sh.m_pDoc))).doc, mono);
      back.SelectFly(back.m_pDoc.GetFlyFormats()[0]!.name);
      expect(back.GetGrfAttr()).toEqual(a);
    }
  });

  it('write the image mode, brightness, contrast and transparency to DOCX as Word does', async () => {
    const sh = image(false);
    sh.SetGrfAttr({ m_nLuminance: 20, m_nContrast: -10, m_nTransparency: 25, m_eDrawMode: GraphicDrawMode.Greys });
    const bytes = await ExportDOCX(sh.m_pDoc);
    const xml = new TextDecoder().decode((await readZip(bytes)).get('word/document.xml')!);
    expect(xml).toMatch(/<a:blip r:embed="[^"]+"><a:grayscl\/><a:lum bright="20000" contrast="-10000"\/><a:alphaModFix amt="75000"\/><\/a:blip>/);
    const r = await ImportDOCX(bytes);
    expect(r.lost).toEqual([]);
    const back = new SwWrtShell(r.doc, mono);
    back.SelectFly(back.m_pDoc.GetFlyFormats()[0]!.name);
    expect(back.GetGrfAttr()).toEqual({ m_nLuminance: 20, m_nContrast: -10, m_nTransparency: 25, m_eDrawMode: GraphicDrawMode.Greys });
    // The watermark becomes MSO's washout and back.
    sh.SetGrfAttr({ m_nLuminance: 0, m_nContrast: 0, m_nTransparency: 0, m_eDrawMode: GraphicDrawMode.Watermark });
    const w = new SwWrtShell((await ImportDOCX(await ExportDOCX(sh.m_pDoc))).doc, mono);
    w.SelectFly(w.m_pDoc.GetFlyFormats()[0]!.name);
    expect(w.GetGrfAttr()).toEqual({ m_eDrawMode: GraphicDrawMode.Watermark });
  });
});
