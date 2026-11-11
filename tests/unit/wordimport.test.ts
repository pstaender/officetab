// Word import rules found by comparing sample documents with Word's and LibreOffice's PDFs:
// breaks inside paragraphs, table styles' paragraph properties and conditional formats, relative
// table widths, continuous sections, proportional spacing below 100% and character borders.
import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTableNode, SwSectionNode } from '../../src/lo/sw/inc/node.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: (f: FontDesc) => ({ ascent: Math.round(f.size * 0.8), descent: Math.round(f.size * 0.2) }) };
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(body: string, styles = '', compat = 15): Promise<SwDoc> {
  const enc = new TextEncoder();
  const r = await ImportDOCX(await writeZip([
    { name: 'word/document.xml', data: enc.encode(`<w:document ${NS}><w:body>${body}</w:body></w:document>`) },
    { name: 'word/styles.xml', data: enc.encode(`<w:styles ${NS}><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles}</w:styles>`) },
    { name: 'word/settings.xml', data: enc.encode(`<w:settings ${NS}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${compat}"/></w:compat></w:settings>`) },
  ]));
  return r.doc;
}
const paras = (doc: SwDoc): SwTextNode[] => [...doc.allText()].filter((n) => n.m_pStartOfSection !== null);
const bodyNodes = (doc: SwDoc) => { const ns = doc.GetNodes(); const out = []; for (let i = ns.BodyStart(); i < ns.GetEndOfContent().GetIndex(); i++) out.push(ns.node(i)); return out; };

describe('Breaks inside a paragraph', () => {
  it('split it, the rest breaking before (DomainMapper::lcl_utext, m_bIsSplitPara)', async () => {
    const doc = await docx('<w:p><w:r><w:t>Column one.</w:t></w:r><w:r><w:br w:type="column"/></w:r><w:r><w:t>Column two.</w:t></w:r></w:p><w:p><w:r><w:t>Before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r></w:p>');
    const texts = paras(doc).map((n) => [n.GetText(), n.m_aSet.RES_BREAK ?? 'none']);
    expect(texts).toEqual([['Column one.', 'none'], ['Column two.', 'column-before'], ['Before', 'none'], ['after', 'page-before']]);
  });

  it('go to the next paragraph when nothing follows, which loses its upper spacing', async () => {
    const doc = await docx('<w:p><w:r><w:t>One</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:pPr><w:spacing w:before="480"/></w:pPr><w:r><w:t>Two</w:t></w:r></w:p>');
    const two = paras(doc).find((n) => n.GetText() === 'Two')!;
    expect(two.m_aSet.RES_BREAK).toBe('page-before');
    expect(two.GetAttr('RES_UL_SPACE').upper).toBe(0);
  });
});

describe('Table styles', () => {
  const STYLE = `<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/>
    <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr>
    <w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="DBE5F1"/></w:tcPr>
    <w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr>
    <w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="B8CCE4"/></w:tcPr></w:tblStylePr></w:style>
    <w:style w:type="paragraph" w:styleId="Own"><w:name w:val="Own"/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>`;
  const cell = (t: string, pPr = '') => `<w:tc><w:p>${pPr}<w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const table = (w: string, jc = '') => `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/>${w}${jc}<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/></w:tblGrid>
    <w:tr>${cell('Head')}${cell('Head 2')}</w:tr><w:tr>${cell('Odd')}${cell('Own', '<w:pPr><w:pStyle w:val="Own"/></w:pPr>')}</w:tr><w:tr>${cell('Even')}${cell('x')}</w:tr></w:tbl><w:p/>`;

  it('shade cells by row band over the style, by tblLook (GetLocalPropertiesFromMask)', async () => {
    const doc = await docx(table('<w:tblW w:w="0" w:type="auto"/>'), STYLE);
    const t = bodyNodes(doc).find((n) => n.IsTableNode()) as SwTableNode;
    expect(t.m_pTable.m_aLines.map((l) => l.m_aBoxes[0]!.m_aAttrs.background)).toEqual(['#dbe5f1', '#b8cce4', '#dbe5f1']);
    // An automatic width is the grid's.
    expect(t.m_pTable.m_aAttrs).toMatchObject({ width: 3000, adjust: 'left' });
  });

  it("give cell paragraphs the style's paragraph and character properties their own style does not set", async () => {
    const doc = await docx(table('<w:tblW w:w="2500" w:type="pct"/>', '<w:jc w:val="center"/>'), STYLE);
    const by = (t: string) => paras(doc).find((n) => n.GetText() === t)!;
    expect(by('Odd').GetAttr('RES_PARATR_LINESPACING')).toEqual({ rule: 'proportional', value: 100 });
    expect(by('Odd').GetAttr('RES_UL_SPACE').lower).toBe(0);
    expect(by('Odd').GetAttr('RES_CHRATR_FONTSIZE')).toBe(180);
    // The paragraph's own style wins over the table style.
    expect(by('Own').GetAttr('RES_UL_SPACE').lower).toBe(100);
    // The first row's conditional character properties.
    expect(by('Head').GetAttr('RES_CHRATR_WEIGHT')).toBe(true);
    expect(by('Odd').GetAttr('RES_CHRATR_WEIGHT')).toBe(false);
    const t = bodyNodes(doc).find((n) => n.IsTableNode()) as SwTableNode;
    expect(t.m_pTable.m_aAttrs).toMatchObject({ relWidth: 50, adjust: 'center' });
    // The relative width survives ODT and DOCX.
    const odt = await ImportODT(await ExportODT(doc));
    expect((bodyNodes(odt.doc).find((n) => n.IsTableNode()) as SwTableNode).m_pTable.m_aAttrs.relWidth).toBe(50);
    const back = await ImportDOCX(await ExportDOCX(doc));
    expect((bodyNodes(back.doc).find((n) => n.IsTableNode()) as SwTableNode).m_pTable.m_aAttrs.relWidth).toBe(50);
  });
});

describe('Sections', () => {
  it('keep a continuous break continuous when only the margins change, without the empty sectPr paragraph', async () => {
    const sect = (type: string, bottom: number, cols = '') => `<w:sectPr>${type}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="${bottom}" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>${cols}</w:sectPr>`;
    const doc = await docx(`<w:p><w:r><w:t>Heading</w:t></w:r></w:p><w:p><w:pPr>${sect('', 720)}</w:pPr></w:p><w:p><w:r><w:t>In columns</w:t></w:r></w:p>${sect('<w:type w:val="continuous"/>', 1440, '<w:cols w:num="2" w:space="720"/>')}`);
    expect(paras(doc).map((n) => n.GetText())).toEqual(['Heading', 'In columns', '']);
    const sec = bodyNodes(doc).find((n) => n.IsSectionNode()) as SwSectionNode;
    expect(sec.m_pSection.m_aCol?.m_nCount).toBe(2);
    expect(paras(doc).some((n) => n.m_aSet.RES_PAGEDESC)).toBe(false);
  });
});

describe('Proportional line spacing below 100%', () => {
  it('shrinks the first line too (PROP_LINE_SPACING_SHRINKS_FIRST_LINE), kept in ODT', async () => {
    const doc = await docx('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="auto"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:t>y</w:t></w:r></w:p>');
    const sh = new SwWrtShell(doc, mono);
    const [half, full] = sh.m_pRoot.pages[0]!.frames.filter((f) => !f.pArea);
    expect(half!.nHeight * 2).toBeCloseTo(full!.nHeight, -1);
    const odt = await ImportODT(await ExportODT(doc));
    expect(odt.doc.m_bPropLineSpacingShrinksFirstLine).toBe(true);
  });
});

describe('Character borders', () => {
  it('read w:bdr, and round-trip through ODT and DOCX', async () => {
    const doc = await docx('<w:p><w:r><w:t xml:space="preserve">Some </w:t></w:r><w:r><w:rPr><w:bdr w:val="single" w:sz="4" w:space="0" w:color="FF0000"/></w:rPr><w:t>box</w:t></w:r></w:p>');
    const box = (d: SwDoc) => paras(d)[0]!.GetCharAttrAt('RES_CHRATR_BOX', 6);
    expect(box(doc)).toEqual({ color: '#ff0000', width: 10 });
    expect(paras(doc)[0]!.GetCharAttrAt('RES_CHRATR_BOX', 0)).toBeNull();
    expect(box((await ImportODT(await ExportODT(doc))).doc)).toEqual({ color: '#ff0000', width: 10 });
    expect(box((await ImportDOCX(await ExportDOCX(doc))).doc)).toEqual({ color: '#ff0000', width: 10 });
  });
});
