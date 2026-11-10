// ODF import details found with specs/writer/exam.odt (written by Word) against LibreOffice's PDF of it.
import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"';

async function odt(styles: string, body: string, masterStyles = '', autoStyles = '') {
  const enc = new TextEncoder();
  const bytes = await writeZip([
    { name: 'mimetype', data: enc.encode('application/vnd.oasis.opendocument.text'), store: true },
    { name: 'styles.xml', data: enc.encode(`<office:document-styles ${NS}><office:styles>${styles}</office:styles><office:automatic-styles>${autoStyles}</office:automatic-styles><office:master-styles>${masterStyles}</office:master-styles></office:document-styles>`) },
    { name: 'content.xml', data: enc.encode(`<office:document-content ${NS}><office:automatic-styles><style:style style:name="P1" style:family="paragraph" style:parent-style-name="Normal"><style:paragraph-properties fo:margin-top="0.1in"/></style:style></office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`) },
  ]);
  return ImportODT(bytes);
}
const DEFAULTS = '<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.1in" fo:line-height="100%"/></style:default-style>';
const NORMAL = '<style:style style:name="Normal" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.5in"/></style:style>';

describe('ODF import', () => {
  it('applies the default style, and inherits each margin on its own', async () => {
    const r = await odt(DEFAULTS + NORMAL, '<text:p text:style-name="Normal">a</text:p><text:p text:style-name="P1">b</text:p>');
    const nodes = r.doc.GetNodes();
    const a = nodes.FirstTextNode(), b = nodes.GoNext(a.GetIndex()) as SwTextNode;
    // "Normal" has no parent: the default style's lower margin applies; it sets only its left margin.
    expect(a.GetAttr('RES_UL_SPACE')).toMatchObject({ upper: 0, lower: 144 });
    expect(a.GetAttr('RES_LR_SPACE').left).toBe(720);
    // The automatic style sets the top margin; the bottom one and the indent are inherited.
    expect(b.GetAttr('RES_UL_SPACE')).toMatchObject({ upper: 144, lower: 144 });
    expect(b.GetAttr('RES_LR_SPACE').left).toBe(720);
    // The defaults are written back.
    const back = await ImportODT(await ExportODT(r.doc));
    expect(back.doc.GetNodes().FirstTextNode().GetAttr('RES_UL_SPACE').lower).toBe(144);
  });

  it('keeps a text box without a width, recodes symbol bullets and reads a header without spacing', async () => {
    const list = '<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char=""><style:text-properties style:font-name="Symbol"/></text:list-level-style-bullet></text:list-style>';
    const layout = '<style:page-layout style:name="PL"><style:page-layout-properties fo:margin-top="0.5in"/><style:header-style><style:header-footer-properties fo:min-height="0.3in"/></style:header-style></style:page-layout>';
    const master = '<style:master-page style:name="Standard" style:page-layout-name="PL"><style:header><text:p><draw:frame text:anchor-type="paragraph"><draw:text-box fo:min-width="0in"><text:p>Seite 1</text:p></draw:text-box></draw:frame></text:p></style:header></style:master-page>';
    const r = await odt(DEFAULTS + list, '<text:list text:style-name="L1"><text:list-item><text:p>item</text:p></text:list-item></text:list>', master, layout);
    expect([...r.lost]).toEqual([]);
    const pd = r.doc.m_aPageDesc;
    expect([pd.nHeaderMinHeight, pd.nHeaderSpacing]).toEqual([432, 0]);
    const sh = new SwWrtShell(r.doc, mono);
    const fly = sh.m_pRoot.pages[0]!.flys[0]!;
    expect(fly.fmt.m_bAutoWidth).toBe(true);
    expect(fly.aFrame.Width()).toBeGreaterThan(0);
    const label = sh.m_pRoot.pages[0]!.frames.find((f) => !f.pArea)!.lines[0]!.portions[0]!;
    expect([label.aExpand, label.font.family]).toEqual(['•', 'Symbol']);
  });

  it('adds the upper spacing at page tops only when the document asks for it', async () => {
    const big = '<style:style style:name="Big" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.5in"/></style:style>';
    const r = await odt(big, '<text:p text:style-name="Big">a</text:p>');
    expect(r.doc.m_bParaSpaceMaxAtPages).toBe(false);
    const sh = new SwWrtShell(r.doc, mono);
    const page = sh.m_pRoot.pages[0]!;
    expect(page.frames.find((f) => !f.pArea)!.nTop).toBe(page.aPrt.Top());
    // New documents have it on, and keep it through ODT.
    r.doc.m_bParaSpaceMaxAtPages = true;
    const back = await ImportODT(await ExportODT(r.doc));
    expect(back.doc.m_bParaSpaceMaxAtPages).toBe(true);
    const sh2 = new SwWrtShell(back.doc, mono);
    const p2 = sh2.m_pRoot.pages[0]!;
    expect(p2.frames.find((f) => !f.pArea)!.nTop).toBe(p2.aPrt.Top() + 720);
  });
});
