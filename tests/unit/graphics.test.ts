import { describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { readZip, writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

describe('graphics anchored as character', () => {
  it('sits on the baseline, makes its line taller and is scaled to fit the text area', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('ab');
    sh.InsertGraphic(PNG, 'image/png', { width: 1000, height: 600 });
    sh.Insert('c');
    const line = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!;
    expect(line.portions.map((p) => p.kind)).toEqual(['text', 'fly', 'text']);
    expect(line.nAscent).toBe(600);
    expect(line.nHeight).toBe(640);
    sh.SttDoc();
    sh.InsertGraphic(PNG, 'image/png', { width: 40000, height: 20000 });
    const big = sh.m_pCursor.GetPoint().GetNode().GetCharAttrAt('RES_TXTATR_FLYCNT', 0)!;
    expect(big.width).toBe(sh.m_pDoc.m_aPageDesc.PrintWidth());
    expect(big.height).toBe(Math.round(20000 * (big.width / 40000)));
    expect(sh.m_pDoc.m_aGraphics.size).toBe(1); // the same data is stored once
  });

  it('round-trips through ODT with the picture in the package', async () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Insert('x');
    sh.InsertGraphic(PNG, 'image/png', { width: 1440, height: 720 });
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

  it('imports paragraph-anchored images inline and says so', async () => {
    const content = `<office:document-content xmlns:office="o" xmlns:text="t" xmlns:draw="d" xmlns:svg="s" xmlns:xlink="x"><office:body><office:text><text:p>A<draw:frame draw:name="Logo" text:anchor-type="paragraph" svg:width="2cm" svg:height="1cm"><draw:image xlink:href="Pictures/logo.png"/><svg:desc>Company logo</svg:desc></draw:frame>B</text:p></office:text></office:body></office:document-content>`;
    const zip = await writeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }, { name: 'Pictures/logo.png', data: PNG }]);
    const { doc, lost } = await ImportODT(zip);
    expect(lost).toEqual(['image positions and text wrap (images are shown in the line they are anchored to)']);
    const n = doc.GetNodes().FirstTextNode();
    expect(n.GetText()).toBe('A\u0001B');
    expect(n.GetCharAttrAt('RES_TXTATR_FLYCNT', 1)).toMatchObject({ name: 'Logo', alt: 'Company logo', width: 1134, height: 567 });
  });
});
