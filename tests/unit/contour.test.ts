// Contour wrap: the automatic contour of a graphic (Bitmap::GetContour, CreateAutoContour), text
// flowing along it (TextRanger), and contours in ODT (draw:contour-polygon) and DOCX (wrapPolygon).
import { describe, expect, it } from 'vitest';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { CreateAutoContour } from '../../src/lo/svx/source/dialog/_contdlg.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { GraphicFlyFormat, HoriOrientation, RelOrientation, VertOrientation, WrapTextMode, type SwFlyFrameFormat } from '../../src/lo/sw/inc/frmfmt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
/** A 1x1 PNG. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0]);

/** A 40x40 bitmap, transparent but for a triangle pointing up (wide at the bottom). */
function triangle(): { width: number; height: number; data: Uint8ClampedArray } {
  const w = 40, h = 40, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.abs(x - 20) <= y / 2) { const i = (y * w + x) * 4; data[i] = 255; data[i + 3] = 255; }
  }
  return { width: w, height: h, data };
}

describe('Automatic contour', () => {
  it('traces the first and last opaque pixel of each row', () => {
    const [poly] = CreateAutoContour(triangle());
    expect(poly!.length).toBeGreaterThan(10);
    // closed, down the left side and up the right side
    expect(poly![0]).toEqual(poly!.at(-1));
    const xs = (y: number) => poly!.filter(([, py]) => Math.abs(py - y) < 1e-9).map(([px]) => px);
    expect(xs(10 / 40)).toEqual([15 / 40, 25 / 40]);
    expect(xs(38 / 40)).toEqual([1 / 40, 38 / 40]);
  });

  it('finds edges in a bitmap without alpha', () => {
    const w = 40, h = 40, data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 10; y < 30; y++) for (let x = 12; x < 28; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
    const [poly] = CreateAutoContour({ width: w, height: h, data });
    const xs = poly!.map(([x]) => x * w);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(29);
  });
});

/** A paragraph of text beside a 2000 × 2000 graphic at the left of the text area, contour wrap on. */
function wrapped(contour?: SwFlyFrameFormat['m_aContour']): { doc: SwDoc; sh: SwWrtShell } {
  const doc = new SwDoc();
  const sh = new SwWrtShell(doc, mono);
  sh.Insert('word '.repeat(200));
  sh.SttDoc();
  const fmt: SwFlyFrameFormat = { ...GraphicFlyFormat('Image1', doc.AddGraphic(PNG, 'image/png'), 2000, 2000),
    m_aHoriOrient: { m_eOrient: HoriOrientation.LEFT, m_eRelation: RelOrientation.FRAME, m_nPos: 0 },
    m_aVertOrient: { m_eOrient: VertOrientation.TOP, m_eRelation: RelOrientation.FRAME, m_nPos: 0 },
    m_aSurround: { m_eSurround: WrapTextMode.PARALLEL, m_bContour: true, m_bOutside: true }, ...(contour ? { m_aContour: contour } : {}) };
  doc.MakeFlyFrameFormat(sh.m_pCursor, fmt);
  sh.m_pRoot.Layout();
  return { doc, sh };
}
const lineStarts = (sh: SwWrtShell) => sh.m_pRoot.pages[0]!.frames[0]!.lines.slice(0, 8).map((l) => l.nX);

describe('Contour wrap', () => {
  it('lets lines come closer where the contour is narrower', () => {
    // A triangle pointing right: wide at the top left, narrow at the bottom.
    const { sh } = wrapped([[[0, 0], [1, 0], [0, 1], [0, 0]]]);
    const xs = lineStarts(sh);
    expect(xs[0]!).toBeGreaterThan(1500);
    // further down the lines start further left
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThanOrEqual(xs[i - 1]!);
    expect(xs[6]!).toBeLessThan(xs[0]! - 900);
  });

  it('wraps around the frame without a contour', () => {
    const { sh } = wrapped();
    const xs = lineStarts(sh);
    expect(new Set(xs.slice(0, 7)).size).toBe(1);
  });

  it('keeps the contour in ODT and DOCX', async () => {
    const poly: [number, number][] = [[0, 0], [1, 0], [0.5, 1], [0, 0]];
    const { doc } = wrapped([poly]);
    const odt = await ExportODT(doc);
    const content = new TextDecoder().decode((await readZip(odt)).get('content.xml'));
    expect(content).toContain('style:wrap-contour="true" style:wrap-contour-mode="outside"');
    expect(content).toMatch(/<draw:contour-polygon [^>]*draw:points="0,0 3528,0 1764,3528 0,0"/);
    const back = (await ImportODT(odt)).doc.FindFlyByName('Image1')!;
    const f = back.fmt ?? null;
    expect(f!.m_aSurround).toMatchObject({ m_bContour: true, m_bOutside: true });
    expect(f!.m_aContour![0]!.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])).toEqual(poly);
    const docx = await ExportDOCX(doc);
    const xml = new TextDecoder().decode((await readZip(docx)).get('word/document.xml'));
    expect(xml).toMatch(/<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="-162" y="0"\/>/);
    const d = (await ImportDOCX(docx)).doc.FindFlyByName('Image1')!.fmt!;
    expect(d.m_aSurround).toMatchObject({ m_bContour: true, m_bOutside: true });
    expect(d.m_aContour![0]!.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])).toEqual(poly);
  });
});
