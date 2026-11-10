import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { EnhancedCustomShape2d } from '../../src/lo/svx/source/customshapes/EnhancedCustomShape2d.ts';
import { GetCustomShapeContent, GetOOXMLPresetGeometry } from '../../src/lo/svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { parseFunction } from '../../src/lo/svx/source/customshapes/EnhancedCustomShapeFunctionParser.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { ShapeFlyFormat } from '../../src/lo/sw/inc/frmfmt.ts';
import { GetColor } from '../../src/lo/oox/source/drawingml/color.ts';
import { parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import { ImportCustGeom } from '../../src/lo/oox/source/drawingml/customshapegeometry.ts';

/** The bounding box of a shape's sub-paths (on-curve points only). */
const bounds = (type: string, w: number, h: number, adjust?: number[]) => {
  const objs = new EnhancedCustomShape2d(type, GetCustomShapeContent(type)!, w, h, true, true, adjust).CreatePathObj();
  const pts = objs.flatMap((o) => o.polys.flatMap((p) => p.pts));
  return { objs, minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)), n: pts.length };
};

describe('custom shape geometry', () => {
  it('evaluates equations with references, functions and if()', () => {
    const ctx = { GetEnumFunc: (e: string) => (e === 'EnumLogWidth' ? 1000 : e === 'EnumPi' ? Math.PI : 0), GetAdjustValueAsDouble: () => 25000, GetEquationValueAsDouble: () => 7 };
    expect(parseFunction('logwidth*$0 /100000', ctx as never)()).toBe(250);
    expect(parseFunction('if(-1, 2, ?0 )', ctx as never)()).toBe(7);
    expect(parseFunction('atan2(1,1)/(pi/180)', ctx as never)()).toBeCloseTo(45);
    expect(parseFunction('-(3+4)*2', ctx as never)()).toBe(-14);
  });

  it('fills the shape rectangle for LibreOffice and OOXML presets', () => {
    for (const type of ['rectangle', 'ellipse', 'star5', 'right-arrow', 'round-rectangle', 'ooxml-rect', 'ooxml-ellipse', 'ooxml-star5', 'ooxml-rightArrow', 'ooxml-roundRect']) {
      const b = bounds(type, 2000, 1000);
      expect(b.n, type).toBeGreaterThan(2);
      expect(b.minX, type).toBeGreaterThanOrEqual(-2);
      expect(b.maxX, type).toBeLessThanOrEqual(2002);
      expect(b.maxX - b.minX, type).toBeGreaterThan(1900);
      expect(b.maxY - b.minY, type).toBeGreaterThan(900);
    }
  });

  it('takes adjustment values, and keeps the smiley face separate from its outline', () => {
    // roundRect's adj: the corner radius in 1/100000 of the shorter side.
    const square = bounds('ooxml-roundRect', 1000, 1000, [0]).objs[0]!.polys[0]!.pts;
    const round = bounds('ooxml-roundRect', 1000, 1000, [50000]).objs[0]!.polys[0]!.pts;
    expect(square.some((p) => p.x === 0 && p.y === 0)).toBe(true);
    expect(round.some((p) => p.x === 0 && p.y === 0)).toBe(false);
    expect(bounds('smiley', 1000, 1000).objs.length).toBeGreaterThan(1);
  });

  it('maps LibreOffice types to OOXML presets', () => {
    expect([GetOOXMLPresetGeometry('rectangle'), GetOOXMLPresetGeometry('star5'), GetOOXMLPresetGeometry('ooxml-heart'), GetOOXMLPresetGeometry('nonsense')]).toEqual(['rect', 'star5', 'heart', 'rect']);
  });
});

describe('shapes in documents', () => {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const theme = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="t"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>';
  const star = `<w:p><w:r><w:drawing><wp:anchor behindDoc="0"><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapNone/><wp:docPr id="1" name="Star"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="star5"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom></wps:spPr><wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></wps:style><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
  const docx = async () => {
    const enc = new TextEncoder();
    return writeZip([
      { name: 'word/document.xml', data: enc.encode(`<w:document ${NS}><w:body>${star}</w:body></w:document>`) },
      { name: 'word/theme/theme1.xml', data: enc.encode(theme) },
    ]);
  };

  it('reads Word shapes with theme colours, adjustments, rotation and mirroring', async () => {
    const { doc, lost } = await ImportDOCX(await docx());
    expect([...lost]).toEqual([]);
    const fly = doc.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt;
    expect(fly.m_pShape).toMatchObject({ m_sType: 'ooxml-star5', m_aAdjust: [30000], m_aFill: '#4472c4', m_nRotate: 90, m_bFlipH: true });
    // shade 50% darkens in linear RGB.
    expect(fly.m_pShape!.m_aLine!.color).toBe(GetColor(parseXml('<a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr>').children[0] as never, { accent1: '#4472c4' }));
  });

  it('reads a:custGeom paths with guides, arcs and their own coordinate spaces', async () => {
    const paths = (xml: string, w: number, h: number) => {
      const g = ImportCustGeom(parseXml(xml).children[0] as never, w * 635, h * 635)!;
      const objs = new EnhancedCustomShape2d('ooxml-non-primitive', g, w, h, true, true).CreatePathObj();
      const pts = objs.flatMap((o) => o.polys.flatMap((p) => p.pts));
      return { g, objs, minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
    };
    // A triangle in a path of its own size: no guides, so the view box is the shape's extent.
    const tri = paths('<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path w="100" h="50"><a:moveTo><a:pt x="50" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>', 2000, 1000);
    expect([tri.minX, tri.maxX, tri.minY, tri.maxY]).toEqual([0, 2000, 0, 1000]);
    expect(tri.objs[0]!.polys[0]!.closed).toBe(true);
    // A half disc from guides on the shape's size and an arc of 180°.
    const half = paths('<a:custGeom><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst><a:gdLst><a:gd name="r" fmla="*/ w adj 100000"/></a:gdLst><a:pathLst><a:path><a:moveTo><a:pt x="l" y="vc"/></a:moveTo><a:arcTo wR="r" hR="hd2" stAng="cd2" swAng="cd2"/><a:close/></a:path></a:pathLst><a:rect l="l" t="t" r="r" b="b"/></a:custGeom>', 2000, 1000);
    expect(half.g.viewBox).toEqual([0, 0, 0, 0]);
    expect(half.minX).toBeCloseTo(0); expect(half.maxX).toBeCloseTo(2000);
    expect(half.minY).toBeCloseTo(0); expect(half.maxY).toBeCloseTo(500);
  });

  it('writes shapes without an OOXML preset as a:custGeom', async () => {
    const xml = '<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path w="100" h="50"><a:moveTo><a:pt x="50" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>';
    const own = star.replace(/<a:prstGeom.*<\/a:prstGeom>/, xml);
    const enc = new TextEncoder();
    const { doc, lost } = await ImportDOCX(await writeZip([{ name: 'word/document.xml', data: enc.encode(`<w:document ${NS}><w:body>${own}</w:body></w:document>`) }, { name: 'word/theme/theme1.xml', data: enc.encode(theme) }]));
    expect([...lost]).toEqual([]);
    expect(doc.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt.m_pShape!.m_sType).toBe('ooxml-non-primitive');
    const again = (await ImportDOCX(await ExportDOCX(doc))).doc.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt;
    const sh = again.m_pShape!;
    expect(sh.m_sType).toBe('ooxml-non-primitive');
    const pts = new EnhancedCustomShape2d(sh.m_sType, sh.m_aGeometry!, 1440, 1440, true, true).CreatePathObj()[0]!.polys[0]!.pts;
    expect(pts.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[720, 0], [1440, 1440], [0, 1440]]);
  });

  it('keeps shapes through DOCX and ODT', async () => {
    const { doc } = await ImportDOCX(await docx());
    const viaDocx = (await ImportDOCX(await ExportDOCX(doc))).doc.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt.m_pShape!;
    expect(viaDocx).toMatchObject({ m_sType: 'ooxml-star5', m_aAdjust: [30000], m_aFill: '#4472c4', m_nRotate: 90, m_bFlipH: true });
    const odt = await ImportODT(await ExportODT(doc));
    expect([...odt.lost]).toEqual([]);
    const viaOdt = odt.doc.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt;
    // ODF writes every modifier: the preset's defaults for the others.
    expect(viaOdt.m_pShape).toMatchObject({ m_sType: 'ooxml-star5', m_aAdjust: [30000, 105146, 110557], m_aFill: '#4472c4', m_bFlipH: true });
    expect(viaOdt.m_pShape!.m_nRotate).toBeCloseTo(90);
    expect([viaOdt.m_nWidth, viaOdt.m_nHeight]).toEqual([1440, 1440]);
    // The geometry went through draw:enhanced-path and equations.
    expect(viaOdt.m_pShape!.m_aGeometry?.equations?.length).toBeGreaterThan(5);
  });

  it('writes a new LibreOffice shape with its text, and reads it back', async () => {
    const doc = new SwDoc();
    const n = doc.GetNodes().FirstTextNode();
    const fmt = ShapeFlyFormat('Shape1', 'round-rectangle', 2000, 1000, 100, 200);
    n.m_aAnchoredFlys.push({ fmt, nContent: 0 });
    const back = await ImportODT(await ExportODT(doc));
    const f2 = back.doc.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt;
    expect(f2.m_pShape).toMatchObject({ m_sType: 'round-rectangle', m_aFill: '#729fcf', m_aLine: { color: '#3465a4', width: 0 } });
    expect([f2.m_aHoriOrient.m_nPos, f2.m_aVertOrient.m_nPos]).toEqual([100, 200]);
  });
});
