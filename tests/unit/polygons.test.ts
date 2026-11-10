import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { importFromSvgD } from '../../src/lo/basegfx/source/polygon/b2dsvgpolypolygon.ts';
import { EnhancedCustomShape2d } from '../../src/lo/svx/source/customshapes/EnhancedCustomShape2d.ts';
import type { SdrShape } from '../../src/lo/sw/inc/frmfmt.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"';
const odt = async (body: string) => {
  const enc = new TextEncoder();
  return ImportODT(await writeZip([
    { name: 'mimetype', data: enc.encode('application/vnd.oasis.opendocument.text'), store: true },
    { name: 'content.xml', data: enc.encode(`<office:document-content ${NS}><office:automatic-styles><style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill-color="#ff0000"/></style:style></office:automatic-styles><office:body><office:text><text:p>${body}</text:p></office:text></office:body></office:document-content>`) },
  ]));
};
const shapes = (doc: SwDoc) => doc.GetNodes().FirstTextNode().m_aAnchoredFlys.map((f) => f.fmt);
/** On-curve points of a shape at its size (of its first part; fill and outline are the same). */
const outline = (sh: SdrShape, w: number, h: number) =>
  new EnhancedCustomShape2d(sh.m_sType, sh.m_aGeometry!, w, h, !!sh.m_aFill, !!sh.m_aLine).CreatePathObj()[0]!.polys.flatMap((p) => p.pts.map((q) => [Math.round(q.x), Math.round(q.y)]));

describe('SVG paths', () => {
  it('reads moves, lines, curves, quadratic curves and arcs', () => {
    const [a, b] = importFromSvgD('M0 0 h10 v10 H0 z m 20 0 c 0 5 5 10 10 10 q 5 0 5 -5 A 5 5 0 0 1 45 5');
    expect(a!.closed).toBe(true);
    expect(a!.pts.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    // The second sub-path starts at the first one's start (after z), moved by (20, 0).
    expect([b!.pts[0]!.x, b!.pts[0]!.y]).toEqual([20, 0]);
    expect(b!.pts[1]).toMatchObject({ x: 30, y: 10, prev: [25, 10] });
    expect(b!.pts[0]!.next).toEqual([20, 5]);
    // A half circle from (35, 5) to (45, 5) in two quarter segments; its top is at y = 0.
    const arc = b!.pts.slice(3);
    expect(arc.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[40, 0], [45, 5]]);
  });
});

describe('ODF polygons and paths', () => {
  it('reads draw:polygon, draw:polyline and draw:path into outlines', async () => {
    const { doc, lost } = await odt(
      '<draw:polygon draw:style-name="gr1" text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" svg:width="1in" svg:height="1in" svg:viewBox="0 0 100 100" draw:points="50,0 100,100 0,100"/>' +
      '<draw:polyline text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" svg:width="2in" svg:height="1in" svg:viewBox="0 0 200 100" draw:points="0,0 100,100 200,0"/>' +
      '<draw:path draw:style-name="gr1" text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" svg:width="1in" svg:height="1in" svg:viewBox="0 0 100 100" svg:d="M0 50 A 50 50 0 0 1 100 50 Z"/>');
    expect([...lost]).toEqual([]);
    const [tri, line, half] = shapes(doc);
    expect(outline(tri!.m_pShape!, 1440, 1440)).toEqual([[720, 0], [1440, 1440], [0, 1440]]);
    expect(tri!.m_pShape!.m_aFill).toBe('#ff0000');
    // A polyline is never filled.
    expect(line!.m_pShape!.m_aFill).toBeNull();
    expect(outline(line!.m_pShape!, 2880, 1440)).toEqual([[0, 0], [1440, 1440], [2880, 0]]);
    const pts = outline(half!.m_pShape!, 1440, 1440);
    expect(pts[0]).toEqual([0, 720]);
    expect(Math.min(...pts.map((p) => p[1]!))).toBe(0);
  });

  it('keeps polygons through ODT and DOCX', async () => {
    const { doc } = await odt('<draw:polygon draw:style-name="gr1" text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" svg:width="1in" svg:height="1in" svg:viewBox="0 0 100 100" draw:points="50,0 100,100 0,100"/>');
    const viaOdt = shapes((await ImportODT(await ExportODT(doc))).doc)[0]!;
    expect(outline(viaOdt.m_pShape!, 1440, 1440)).toEqual([[720, 0], [1440, 1440], [0, 1440]]);
    const viaDocx = shapes((await ImportDOCX(await ExportDOCX(doc))).doc)[0]!;
    expect(outline(viaDocx.m_pShape!, 1440, 1440)).toEqual([[720, 0], [1440, 1440], [0, 1440]]);
    expect(viaDocx.m_pShape!.m_aFill).toBe('#ff0000');
  });
});
