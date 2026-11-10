import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { PrintSVG } from '../../src/lo/sw/source/core/view/vprint.ts';
import { SVGContext } from '../../src/lo/filter/source/svg/svgwriter.ts';
import { parseXml, childElements, type XmlElement } from '../../src/lo/xmloff/source/core/xmlparse.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const env = { measure: (_css: string, t: string) => [...t].length * 100 };
const all = (e: XmlElement, name: string): XmlElement[] => [...(e.name === name ? [e] : []), ...childElements(e).flatMap((c) => all(c, name))];
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe('printing as SVG', () => {
  it('gives each page an SVG of its size, with the text as text at the laid-out width', async () => {
    const body = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>a b</w:t></w:r></w:p>';
    const { doc } = await ImportDOCX(await writeZip([{ name: 'word/document.xml', data: new TextEncoder().encode(`<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`) }]));
    const sh = new SwWrtShell(doc, mono);
    const [svg] = PrintSVG(sh, env, new Map());
    const root = parseXml(svg!).children[0] as XmlElement;
    expect(root.attrs.get('width')).toBe(`${11906 / 15}px`);
    expect(root.attrs.get('viewBox')!.split(' ').slice(2).map(Number)).toEqual([11906, 16838]);
    const texts = all(root, 'text');
    const hello = texts.find((t) => t.children.join('') === 'Hello world')!;
    expect(hello.attrs.get('textLength')).toBe('1100');
    expect(hello.attrs.get('style')).toContain('white-space:pre');
  });

  it('records clips, transforms, images and paths', () => {
    const ctx = new SVGContext(env);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, 100, 100); ctx.clip();
    ctx.transform(0, -1, 1, 0, 10, 20);
    ctx.drawImage({ svgHref: 'blob:x' }, 0, 0, 50, 50);
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(1, 2, 3, 4, 5, 6); ctx.closePath();
    ctx.fillStyle = '#ff0000'; ctx.fill('evenodd');
    ctx.fillStyle = 'transparent'; ctx.fillRect(0, 0, 10, 10);
    const root = parseXml(ctx.Emit([0, 0, 100, 100], '10px', '10px')).children[0] as XmlElement;
    const img = all(root, 'image')[0]!;
    expect(img.attrs.get('href')).toBe('blob:x');
    expect(img.attrs.get('transform')).toBe('matrix(0 -1 1 0 10 20)');
    // The clip was set before the rotation: it goes on a group around the image, since an
    // element's own clip-path would turn with its transform.
    expect(img.attrs.get('clip-path')).toBeUndefined();
    const group = all(root, 'g').find((g) => g.children.includes(img))!;
    expect(group.attrs.get('clip-path')).toBe('url(#pc1)');
    expect(group.attrs.get('transform')).toBeUndefined();
    expect(all(root, 'clipPath')).toHaveLength(1);
    const path = all(root, 'path').find((p) => p.attrs.get('fill') === '#ff0000')!;
    expect(path.attrs.get('d')).toBe('M0 0C1 2 3 4 5 6Z');
    expect(path.attrs.get('fill-rule')).toBe('evenodd');
    // Nothing for transparent fills; the white page is the only rectangle.
    expect(all(root, 'rect')).toHaveLength(1);
  });
});
