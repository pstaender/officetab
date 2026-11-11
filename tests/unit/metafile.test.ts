// Windows metafiles (emfio's WmfReader and EmfReader, reduced): hand-built WMF and EMF files read
// into GDIMetaFile actions and written as SVG, and the WMF logos of specs/writer/math.docx through
// the DOCX import, ODT and DOCX export.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { IsEMF, IsWMF, ReadWindowMetafile } from '../../src/lo/vcl/source/filter/wmf/wmf.ts';
import { WriteMetaFileSVG } from '../../src/lo/filter/source/svg/svgwriter.ts';
import { DetectGraphic, GetPrefSizeTwips } from '../../src/lo/vcl/source/filter/GraphicFormatDetector.ts';
import { MetafileSVG } from '../../src/lo/vcl/source/graphic/Manager.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { readZip } from '../../src/lo/package/source/zipapi/zip.ts';
import type { MetaAction } from '../../src/lo/vcl/source/gdi/gdimtf.ts';

/** Little-endian bytes of 16-bit words. */
const words = (ws: number[]): number[] => ws.flatMap((w) => [w & 0xff, (w >> 8) & 0xff]);
const u32w = (v: number): number[] => [v & 0xffff, (v >>> 16) & 0xffff];
const COLORREF = (r: number, g: number, b: number) => u32w(r | (g << 8) | (b << 16));

/** A WMF record: its size in words, the function and the parameter words. */
const rec = (func: number, params: number[]): number[] => [...u32w(3 + params.length), func, ...params];

/** A placeable WMF of the records (words), bound (0, 0, w, h) at `inch` units per inch. */
function WMF(records: number[][], w: number, h: number, inch: number): Uint8Array {
  const body = [...records.flat(), ...rec(0, [])];
  const header = [1, 9, 0x300, ...u32w(9 + body.length), 8, ...u32w(64), 0];
  const placeable = [...u32w(0x9ac6cdd7), 0, 0, 0, w, h, inch, 0, 0, 0];
  return new Uint8Array(words([...placeable, ...header, ...body]));
}

/** A 2 × 2 24-bit DIB: its BITMAPINFOHEADER and rows of blue, green / red, white (bottom-up). */
function DIB(): number[] {
  const bytes = [40, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 24, 0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 255, 255, 255, 255, 0, 0, // bottom row: red, white
    255, 0, 0, 0, 255, 0, 0, 0]; // top row: blue, green
  const ws: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) ws.push(bytes[i]! | (bytes[i + 1]! << 8));
  return ws;
}

const SRCCOPY = 0x00cc0020, SRCINVERT = 0x00660046;
const W_META = { SETWINDOWORG: 0x20b, SETWINDOWEXT: 0x20c, CREATEBRUSHINDIRECT: 0x2fc, CREATEPENINDIRECT: 0x2fa, SELECTOBJECT: 0x12d, POLYGON: 0x324, RECTANGLE: 0x41b, ELLIPSE: 0x418, CREATEFONTINDIRECT: 0x2fb, SETTEXTCOLOR: 0x209, SETBKMODE: 0x102, EXTTEXTOUT: 0xa32, SAVEDC: 0x1e, RESTOREDC: 0x127, DELETEOBJECT: 0x1f0, STRETCHDIB: 0xf43, POLYLINE: 0x325 };
const types = (a: MetaAction[]) => a.map((x) => x.mnType);

describe('WMF', () => {
  const window = [rec(W_META.SETWINDOWORG, [0, 0]), rec(W_META.SETWINDOWEXT, [100, 200])];

  it('reads shapes with pens and brushes in the window mapped to the placeable size', () => {
    const data = WMF([
      ...window,
      rec(W_META.CREATEBRUSHINDIRECT, [0, ...COLORREF(255, 0, 0), 0]), rec(W_META.SELECTOBJECT, [0]),
      rec(W_META.CREATEPENINDIRECT, [0, 0, 0, ...COLORREF(0, 0, 255)]), rec(W_META.SELECTOBJECT, [1]),
      rec(W_META.POLYGON, [3, 0, 0, 200, 0, 100, 100]),
      rec(W_META.SAVEDC, []),
      rec(W_META.CREATEBRUSHINDIRECT, [1, 0, 0, 0]), rec(W_META.SELECTOBJECT, [2]),
      rec(W_META.RECTANGLE, [80, 180, 20, 20]),
      rec(W_META.RESTOREDC, [0xffff]),
      rec(W_META.ELLIPSE, [100, 200, 50, 100]),
      rec(W_META.DELETEOBJECT, [2]),
    ], 200, 100, 100);
    expect(IsWMF(data)).toBe(true);
    const mtf = ReadWindowMetafile(data)!;
    // 200 × 100 units at 100 units per inch: 2 × 1 inch in 1/100 mm.
    expect(mtf.GetPrefSize()).toEqual({ width: 5080, height: 2540 });
    expect(types(mtf.m_aList).filter((t) => ['POLYGON', 'RECT', 'ELLIPSE'].includes(t))).toEqual(['POLYGON', 'RECT', 'ELLIPSE']);
    const poly = mtf.m_aList.find((a) => a.mnType === 'POLYGON') as Extract<MetaAction, { mnType: 'POLYGON' }>;
    expect(poly.maPoly.mxPointAry.map((p) => [p.X(), p.Y()])).toEqual([[0, 0], [5080, 0], [2540, 2540]]);
    const svg = WriteMetaFileSVG(mtf);
    expect(svg).toContain('viewBox="0 0 5080 2540"');
    expect(svg).toMatch(/<path d="M0 0L5080 0L2540 2540Z" fill-rule="evenodd" fill="#ff0000" stroke="#0000ff"/);
    // The hollow brush of the saved state draws the rectangle's outline only; after RestoreDC the ellipse is red again.
    expect(svg).toMatch(/<path d="M508 508H4571V2031H508Z" fill="none" stroke="#0000ff"/);
    expect(svg).toMatch(/<ellipse [^>]*fill="#ff0000"/);
    expect(DetectGraphic(data)).toMatchObject({ mnPixWidth: 5080, mnPixHeight: 2540, mnDpiX: 2540 });
    expect(GetPrefSizeTwips(data)).toEqual({ width: 2880, height: 1440 });
  });

  it('writes text in the selected font with its colour and DX array', () => {
    const face = [0x7241, 0x6169, 0x006c, 0]; // "Arial"
    const data = WMF([
      ...window,
      rec(W_META.CREATEFONTINDIRECT, [0x10000 - 20, 0, 0, 0, 700, 0x0001, 0, 0, 0, ...face]), rec(W_META.SELECTOBJECT, [0]),
      rec(W_META.SETTEXTCOLOR, COLORREF(0, 128, 0)), rec(W_META.SETBKMODE, [1]),
      rec(W_META.EXTTEXTOUT, [50, 10, 2, 0, 0x6948, 10, 12]),
    ], 200, 100, 100);
    const mtf = ReadWindowMetafile(data)!;
    const font = mtf.m_aList.find((a) => a.mnType === 'FONT') as Extract<MetaAction, { mnType: 'FONT' }>;
    expect(font.maFont).toMatchObject({ maFamilyName: 'Arial', meWeight: 700, mbItalic: true, maColor: '#008000' });
    // 20 units high: 20 / 100 inch in 1/100 mm.
    expect(font.maFont.maFontSize.Height()).toBe(508);
    const text = mtf.m_aList.find((a) => a.mnType === 'TEXTARRAY') as Extract<MetaAction, { mnType: 'TEXTARRAY' }>;
    expect(text.maStr).toBe('Hi');
    expect(text.maDXAry).toEqual([254, 559]);
    const svg = WriteMetaFileSVG(mtf);
    expect(svg).toMatch(/<text x="254 508" y="[\d.]+" font-family="'Arial', sans-serif" font-size="508" font-weight="700" font-style="italic" fill="#008000"[^>]*>Hi<\/text>/);
  });

  it('draws DIB bitmaps as BMP, and the XOR paint trick as the bitmap clipped to the shapes', () => {
    const stretch = (rop: number) => rec(W_META.STRETCHDIB, [...u32w(rop), 0, 2, 2, 0, 0, 100, 200, 0, 0, ...DIB()]);
    const plain = ReadWindowMetafile(WMF([...window, stretch(SRCCOPY)], 200, 100, 100))!;
    const bmp = plain.m_aList.find((a) => a.mnType === 'BMPSCALE') as Extract<MetaAction, { mnType: 'BMPSCALE' }>;
    expect([bmp.maBmp.width, bmp.maBmp.height, bmp.maSz.Width(), bmp.maSz.Height()]).toEqual([2, 2, 5080, 2540]);
    const file = Buffer.from(bmp.maBmp.href.replace('data:image/bmp;base64,', ''), 'base64');
    expect([file.toString('latin1', 0, 2), file.readUInt32LE(10), file.length]).toEqual(['BM', 54, 70]);

    const xor = ReadWindowMetafile(WMF([
      ...window, stretch(SRCINVERT),
      rec(W_META.CREATEPENINDIRECT, [5, 0, 0, 0, 0]), rec(W_META.SELECTOBJECT, [0]),
      rec(W_META.CREATEBRUSHINDIRECT, [0, 0, 0, 0]), rec(W_META.SELECTOBJECT, [1]),
      rec(W_META.POLYGON, [3, 0, 0, 200, 0, 100, 100]),
      stretch(SRCINVERT),
    ], 200, 100, 100))!;
    const svg = WriteMetaFileSVG(xor);
    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(svg).toMatch(/<clipPath id="(c\d+)"><path d="M0 0L5080 0L2540 2540Z"\/><\/clipPath>.*<g clip-path="url\(#\1\)"><image /);
    expect(svg).not.toContain('fill="#000000"');
  });

  it('reads the logos of math.docx', async () => {
    const files = await readZip(readFileSync('specs/writer/math.docx'));
    const wave = ReadWindowMetafile(files.get('word/media/image1.wmf')!)!;
    // GetPlaceableBound: the window (3300 × 792 at 72 units per inch) is the bound.
    expect(wave.GetPrefSize()).toEqual({ width: 116417, height: 27940 });
    expect(types(wave.m_aList).filter((t) => t === 'POLYPOLYGON')).toHaveLength(85);
    const cc = MetafileSVG(files.get('word/media/image2.wmf')!)!;
    // The badge is a bitmap painted with the XOR trick (clipped to its frame).
    expect(cc.svg.match(/<image /g)).toHaveLength(1);
    expect(cc.svg).toMatch(/<g clip-path="url\(#c\d+\)"><image href="data:image\/bmp;base64,/);
  });
});

describe('EMF', () => {
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const i16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const emr = (type: number, body: number[]): number[] => [...u32(type), ...u32(8 + body.length), ...body];
  const ints = (...v: number[]) => v.flatMap(u32);
  const utf16 = (s: string, n: number) => Array.from({ length: n }, (_, i) => i16(s.charCodeAt(i) || 0)).flat();
  function EMF(records: number[][]): Uint8Array {
    const body = [...records.flat(), ...emr(14, ints(0, 0, 20))];
    const header = emr(1, [...ints(0, 0, 199, 99), ...ints(0, 0, 1999, 999), ...u32(0x464d4520), ...u32(0x10000), ...u32(88 + body.length), ...u32(records.length + 2), ...i16(4), ...i16(0), ...ints(0, 0, 0), ...ints(1000, 1000, 100, 100)]);
    return new Uint8Array([...header, ...body]);
  }

  it('reads brushes, polygons, paths and text in device units', () => {
    const data = EMF([
      emr(39, ints(1, 0, 0x00ff00, 0)), emr(37, ints(1)), emr(37, ints(0x80000008)),
      emr(86, [...ints(0, 0, 0, 0), ...u32(3), ...i16(0), ...i16(0), ...i16(100), ...i16(0), ...i16(100), ...i16(50)]),
      emr(59, []), emr(27, ints(10, 10)), emr(54, ints(50, 10)), emr(54, ints(50, 40)), emr(61, []), emr(60, []), emr(62, ints(0, 0, 0, 0)),
      emr(82, [...ints(2, -20, 0, 0, 0, 400), 0, 0, 0, 0, 0, 0, 0, 0, ...utf16('Times New Roman', 32)]), emr(37, ints(2)),
      emr(24, ints(0x0000ff)),
      emr(84, [...ints(0, 0, 0, 0, 1), ...ints(0, 0), ...ints(20, 60, 2, 76, 0x100, 0, 0, 0, 0, 80), ...utf16('Hi', 2), ...ints(12, 12)]),
    ]);
    expect(IsEMF(data)).toBe(true);
    const mtf = ReadWindowMetafile(data)!;
    // rclFrame in 1/100 mm; a device pixel is 1/10 mm.
    expect(mtf.GetPrefSize()).toEqual({ width: 2000, height: 1000 });
    const polys = mtf.m_aList.filter((a) => a.mnType === 'POLYGON') as Extract<MetaAction, { mnType: 'POLYGON' }>[];
    expect(polys.map((p) => p.maPoly.mxPointAry.map((pt) => [pt.X(), pt.Y()]))).toEqual([[[0, 0], [1000, 0], [1000, 500]], [[100, 100], [500, 100], [500, 400], [100, 100]]]);
    const text = mtf.m_aList.find((a) => a.mnType === 'TEXTARRAY') as Extract<MetaAction, { mnType: 'TEXTARRAY' }>;
    expect([text.maStr, text.maStartPt.X(), text.maStartPt.Y(), text.maDXAry]).toEqual(['Hi', 200, 600, [120, 240]]);
    const svg = WriteMetaFileSVG(mtf);
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).toMatch(/font-family="'Times New Roman', sans-serif" font-size="200"[^>]*fill="#ff0000"/);
  });
});

describe('Metafiles in documents', () => {
  it('imports the WMF pictures of math.docx and keeps them through ODT and DOCX', async () => {
    const { doc, lost } = await ImportDOCX(readFileSync('specs/writer/math.docx'));
    expect(lost.join('\n')).not.toMatch(/formats a browser cannot show/);
    const wmfs = [...doc.m_aGraphics.values()].filter((g) => g.mime === 'image/x-wmf');
    expect(wmfs).toHaveLength(2);

    const odt = await ImportODT(await ExportODT(doc));
    expect([...odt.doc.m_aGraphics.values()].filter((g) => g.mime === 'image/x-wmf').map((g) => g.data.length).sort()).toEqual(wmfs.map((g) => g.data.length).sort());

    const files = await readZip(await ExportDOCX(doc));
    const media = [...files.keys()].filter((k) => k.endsWith('.wmf'));
    expect(media).toHaveLength(2);
    expect(new TextDecoder().decode(files.get('[Content_Types].xml'))).toContain('<Default Extension="wmf" ContentType="image/x-wmf"/>');
    const back = await ImportDOCX(await ExportDOCX(doc));
    expect([...back.doc.m_aGraphics.values()].filter((g) => g.mime === 'image/x-wmf')).toHaveLength(2);
  });
});
