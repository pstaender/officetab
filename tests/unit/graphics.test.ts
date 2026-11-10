import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { readZip, writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

describe('graphics anchored as character', () => {
  it('sits on the baseline, makes its line taller and is scaled to fit the text area', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('ab');
    sh.InsertGraphic(PNG, 'image/png', { width: 1000, height: 600 }, true);
    sh.Insert('c');
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    expect(line.portions.map((p) => p.kind)).toEqual(['text', 'fly', 'text']);
    expect(line.nAscent).toBe(600);
    expect(line.nHeight).toBe(640);
    sh.SttDoc();
    sh.InsertGraphic(PNG, 'image/png', { width: 40000, height: 20000 }, true);
    const big = sh.m_pCursor.GetPoint().GetNode().GetCharAttrAt('RES_TXTATR_FLYCNT', 0)!;
    expect(big.width).toBe(sh.m_pDoc.m_aPageDesc.PrintWidth());
    expect(big.height).toBe(Math.round(20000 * (big.width / 40000)));
    expect(sh.m_pDoc.m_aGraphics.size).toBe(1); // the same data is stored once
  });

  it('round-trips through ODT with the picture in the package', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    sh.InsertGraphic(PNG, 'image/png', { width: 1440, height: 720 }, true);
    const bytes = await ExportODT(sh.m_pDoc);
    const files = await readZip(bytes);
    const pic = [...files.keys()].find((k) => k.startsWith('Pictures/'))!;
    expect(files.get(pic)).toEqual(PNG);
    expect(new TextDecoder().decode(files.get('META-INF/manifest.xml'))).toContain(pic);
    const { doc, lost } = await ImportODT(bytes);
    expect(lost).toEqual([]);
    const n = doc.GetNodes().FirstTextNode();
    expect(n.GetCharAttrAt('RES_TXTATR_FLYCNT', 1)).toMatchObject({ width: 1440, height: 720, name: 'Image1' });
    expect(doc.m_aGraphics.get(n.GetCharAttrAt('RES_TXTATR_FLYCNT', 1)!.graphic)!.data).toEqual(PNG);
  });

  it('imports paragraph-anchored images at their paragraph, out of the text', async () => {
    const content = `<office:document-content xmlns:office="o" xmlns:text="t" xmlns:draw="d" xmlns:svg="s" xmlns:xlink="x"><office:body><office:text><text:p>A<draw:frame draw:name="Logo" text:anchor-type="paragraph" svg:width="2cm" svg:height="1cm"><draw:image xlink:href="Pictures/logo.png"/><svg:desc>Company logo</svg:desc></draw:frame>B</text:p></office:text></office:body></office:document-content>`;
    const zip = await writeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }, { name: 'Pictures/logo.png', data: PNG }]);
    const { doc, lost } = await ImportODT(zip);
    expect(lost).toEqual([]);
    const n = doc.GetNodes().FirstTextNode();
    expect(n.GetText()).toBe('AB');
    expect(n.m_aAnchoredFlys[0]!.fmt).toMatchObject({ m_aName: 'Logo', alt: 'Company logo', m_nWidth: 1134, m_nHeight: 567, m_aAnchor: { m_eAnchorId: 0 } });
  });
});

describe('Format > Image', () => {
  /** A PNG header of 200 × 100 pixels (IHDR), enough for the size detection. */
  const REAL_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200, 0, 0, 0, 100, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
  const setup = () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    const name = sh.InsertGraphic(REAL_PNG, 'image/png', { width: 2000, height: 1000 });
    sh.SelectFly(name);
    return sh;
  };

  it('crops by dragging an edge in, keeping the rest of the image where it was (SdrDragCrop)', async () => {
    const sh = setup();
    const r = sh.GetFlyRect()!;
    // The left edge 500 twips in: a quarter of the image is cut off on the left.
    sh.CropFly(new (r.constructor as new (x: number, y: number, w: number, h: number) => typeof r)(r.Left() + 500, r.Top(), r.Width() - 500, r.Height()));
    const f = sh.GetFlyFrameFormat()!;
    expect(f.m_nWidth).toBe(1500);
    expect(f.crop!.left).toBeCloseTo(0.25);
    expect(f.crop!.right).toBeCloseTo(0);
    expect(sh.GetFlyRect()!.Left()).toBe(r.Left() + 500);
    // Cropping again from the right keeps the scale: the visible part is half the image.
    const r2 = sh.GetFlyRect()!;
    sh.CropFly(new (r2.constructor as new (x: number, y: number, w: number, h: number) => typeof r2)(r2.Left(), r2.Top(), r2.Width() - 500, r2.Height()));
    expect(sh.GetFlyFrameFormat()!.crop).toEqual({ left: 0.25, right: 0.25, top: 0, bottom: 0 });
    // It survives ODT, and undo takes both steps back.
    const { doc } = await ImportODT(await ExportODT(sh.m_pDoc));
    expect(doc.GetFlyFormats()[0]!.fmt!.crop!.left).toBeCloseTo(0.25);
    sh.Undo(); sh.Undo();
    expect(sh.m_pDoc.GetFlyFormats()[0]!.fmt!.crop).toBeUndefined();
  });

  it('replaces the image in its frame (ReRead)', () => {
    const sh = setup();
    const other = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
    expect(sh.ReRead(other, 'image/png')).toBe(true);
    const f = sh.GetFlyFrameFormat()!;
    expect(sh.m_pDoc.m_aGraphics.get(f.graphic!)!.data).toEqual(other);
    expect([f.m_nWidth, f.m_nHeight]).toEqual([2000, 1000]);
  });
});

describe('Format > Rotate or Flip, Name and Alt Text', () => {
  const REAL_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200, 0, 0, 0, 100, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
  const setup = (asChar = false) => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    const name = sh.InsertGraphic(REAL_PNG, 'image/png', { width: 2000, height: 1000 }, asChar);
    sh.SelectFly(name);
    return sh;
  };

  it('rotates a graphic in quarter turns about its centre, the frame keeping its size (RotateFlyFrame3)', () => {
    const sh = setup();
    const before = sh.GetFlyRect()!;
    sh.RotateGraphic(900);
    const f = sh.GetFlyFrameFormat()!;
    expect([f.m_nGrfRotation, f.m_nWidth, f.m_nHeight]).toEqual([900, 2000, 1000]);
    const r = sh.GetFlyRect()!;
    expect([r.Width(), r.Height()]).toEqual([1000, 2000]);
    expect(r.Left() + r.Width() / 2).toBeCloseTo(before.Left() + before.Width() / 2, 0);
    sh.RotateGraphic(2700);
    expect(sh.GetFlyFrameFormat()!.m_nGrfRotation).toBeUndefined();
    sh.RotateGraphic(1800); sh.RotateGraphic(null);
    expect(sh.GetFlyFrameFormat()!.m_nGrfRotation).toBeUndefined();
  });

  it('holds the rotated bounds in the line for a graphic anchored as character', () => {
    const sh = setup(true);
    sh.RotateGraphic(900);
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    const fly = line.portions.find((p) => p.kind === 'fly')!;
    expect(fly.nWidth).toBe(1000);
    expect(line.nAscent).toBe(2000);
  });

  it('flips graphics as SwMirrorGrf does and keeps rotation, mirror and title through ODT and DOCX', async () => {
    const sh = setup();
    sh.MirrorGraphic(true);
    expect(sh.GetFlyFrameFormat()!.m_eMirror).toBe('vertical');
    sh.MirrorGraphic(false);
    expect(sh.GetFlyFrameFormat()!.m_eMirror).toBe('both');
    sh.MirrorGraphic(true);
    expect(sh.GetFlyFrameFormat()!.m_eMirror).toBe('horizontal');
    sh.RotateGraphic(900);
    sh.SetFlyFrameAttr({ m_sTitle: 'A title', alt: 'A longer description' });
    const want = { m_nGrfRotation: 900, m_eMirror: 'horizontal', m_sTitle: 'A title', alt: 'A longer description' };
    const pick = (d: SwDoc) => { const f = d.GetFlyFormats()[0]!.fmt!; return { m_nGrfRotation: f.m_nGrfRotation, m_eMirror: f.m_eMirror, m_sTitle: f.m_sTitle, alt: f.alt }; };
    expect(pick((await ImportODT(await ExportODT(sh.m_pDoc))).doc)).toEqual(want);
    expect(pick((await ImportDOCX(await ExportDOCX(sh.m_pDoc))).doc)).toEqual(want);
  });

  it('mirrors a shape, turning its rotation the other way (SdrObject::Mirror)', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    sh.InsertShape('rectangle', new (sh.m_pRoot.pages[0]!.aFrame.constructor as new (x: number, y: number, w: number, h: number) => never)(2000, 2000, 1000, 500));
    sh.SetFlyFrameAttr({ m_pShape: { ...sh.GetFlyFrameFormat()!.m_pShape!, m_nRotate: 30 } });
    sh.MirrorSelection(true);
    const s = sh.GetFlyFrameFormat()!.m_pShape!;
    expect([s.m_bFlipH, s.m_nRotate]).toEqual([true, 330]);
  });
});

describe('Format > Rotate or Flip > Rotate (SdrDragRotate)', () => {
  it('turns shapes clockwise in degrees and graphics counterclockwise in tenths', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    const g = sh.InsertGraphic(PNG, 'image/png', { width: 2000, height: 1000 });
    sh.SelectFly(g);
    sh.RotateSelection(30);
    expect(sh.GetFlyFrameFormat()!.m_nGrfRotation).toBe(3300);
    sh.RotateSelection(-30);
    expect(sh.GetFlyFrameFormat()!.m_nGrfRotation).toBeUndefined();
  });
});
