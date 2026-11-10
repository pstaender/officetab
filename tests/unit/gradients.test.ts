import { describe, expect, it } from 'vitest';
import { parseXml } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import { ImportGradFill } from '../../src/lo/oox/source/drawingml/fillproperties.ts';
import { createGradientSteps, getInterpolatedBColor, type BGradient } from '../../src/lo/basegfx/source/tools/gradienttools.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';

const el = (xml: string) => parseXml(xml).children[0] as never;
const gs = '<a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst>';

describe('gradients', () => {
  it('reads DrawingML linear and path gradients as upstream does', () => {
    const lin = ImportGradFill(el(`<a:gradFill>${gs}<a:lin ang="0"/></a:gradFill>`), {})!;
    expect(lin).toMatchObject({ eStyle: 'linear', nAngle: 900 });
    const down = ImportGradFill(el(`<a:gradFill>${gs}<a:lin ang="5400000"/></a:gradFill>`), {})!;
    expect(down.nAngle).toBe(0);
    // From the centre outwards becomes ODF's from the outside in.
    const radial = ImportGradFill(el(`<a:gradFill>${gs}<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`), {})!;
    expect(radial).toMatchObject({ eStyle: 'radial', nOffsetX: 50, nOffsetY: 50 });
    expect(radial.aColorStops.map((s) => s.aStopColor)).toEqual(['#0000ff', '#ff0000']);
    // Symmetric stops are an axial gradient.
    const axial = ImportGradFill(el('<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="50000"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="FF0000"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>'), {})!;
    expect(axial.eStyle).toBe('axial');
    expect(axial.aColorStops).toEqual([{ fStopOffset: 0, aStopColor: '#ff0000' }, { fStopOffset: 1, aStopColor: '#ffffff' }]);
  });

  it('decomposes into steps from the start colour to the end colour', () => {
    // DrawingML ang 0: red on the left, blue on the right.
    const g = ImportGradFill(el(`<a:gradFill>${gs}<a:lin ang="0"/></a:gradFill>`), {})!;
    const steps = createGradientSteps(g, 1000, 500);
    expect(steps[0]!.color).toBe('#ff0000');
    expect(steps[steps.length - 1]!.color).toBe('#0000ff');
    // Each step's area starts further right.
    const left = steps.slice(1).map((s) => Math.min(...s.poly.pts.map((p) => p.x)));
    for (let k = 1; k < left.length; k++) expect(left[k]!).toBeGreaterThan(left[k - 1]!);
    expect(left[0]!).toBeCloseTo(1000 / steps.length, 0);
    const g2: BGradient = { ...g, nIntensStart: 50 };
    expect(getInterpolatedBColor(g2, 0)).toBe('#800000');
  });

  it('keeps shape gradients through ODT and DOCX', async () => {
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
    const shape = `<w:p><w:r><w:drawing><wp:anchor behindDoc="0"><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapNone/><wp:docPr id="1" name="G"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:gradFill>${gs}<a:lin ang="2700000"/></a:gradFill></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
    const { doc, lost } = await ImportDOCX(await writeZip([{ name: 'word/document.xml', data: new TextEncoder().encode(`<w:document ${NS}><w:body>${shape}</w:body></w:document>`) }]));
    expect([...lost]).toEqual([]);
    const fly = (d: typeof doc) => d.GetNodes().FirstTextNode().m_aAnchoredFlys[0]!.fmt.m_pShape!;
    const want = { eStyle: 'linear', nAngle: 450, aColorStops: [{ fStopOffset: 0, aStopColor: '#ff0000' }, { fStopOffset: 1, aStopColor: '#0000ff' }] };
    expect(fly(doc).m_aGradient).toMatchObject(want);
    const odt = await ImportODT(await ExportODT(doc));
    expect([...odt.lost]).toEqual([]);
    expect(fly(odt.doc).m_aGradient).toMatchObject(want);
    expect(fly((await ImportDOCX(await ExportDOCX(odt.doc))).doc).m_aGradient).toMatchObject(want);
  });
});
