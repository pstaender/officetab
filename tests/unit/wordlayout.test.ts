// Word layout compatibility, found by comparing specs/writer/exam.docx with Word's PDF of it.
import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { ExportODT, ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { SwStartNodeType } from '../../src/lo/sw/inc/ndtyp.ts';
import { GetPrefSizeTwips } from '../../src/lo/vcl/source/filter/GraphicFormatDetector.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
/** A 4x2 pixel PNG at 96 DPI: IHDR only. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 2, 8, 6, 0, 0, 0, 0, 0, 0, 0]);

interface Parts { body: string; styles?: string; settings?: string; numbering?: string; header?: string; sectPr?: string }
async function docx(p: Parts): Promise<SwDoc> {
  const enc = new TextEncoder();
  const files = [
    { name: 'word/document.xml', data: enc.encode(`<w:document ${NS}><w:body>${p.body}${p.sectPr ?? ''}</w:body></w:document>`) },
    { name: 'word/styles.xml', data: enc.encode(`<w:styles ${NS}><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${p.styles ?? ''}</w:styles>`) },
    { name: 'word/settings.xml', data: enc.encode(`<w:settings ${NS}>${p.settings ?? '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'}</w:settings>`) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(`<Relationships ${REL}><Relationship Id="rImg" Type="image" Target="media/a.png"/><Relationship Id="rHdr" Type="header" Target="header1.xml"/><Relationship Id="rNum" Type="numbering" Target="numbering.xml"/></Relationships>`) },
    { name: 'word/media/a.png', data: PNG },
  ];
  if (p.numbering) files.push({ name: 'word/numbering.xml', data: enc.encode(`<w:numbering ${NS}>${p.numbering}</w:numbering>`) });
  if (p.header) files.push({ name: 'word/header1.xml', data: enc.encode(`<w:hdr ${NS}>${p.header}</w:hdr>`) });
  return (await ImportDOCX(await writeZip(files))).doc;
}
const para = (text: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tops = (sh: SwWrtShell, page = 0) => sh.m_pRoot.pages[page]!.frames.filter((f) => !f.pArea && !f.pCell).map((f) => f.nTop);

describe('Word paragraph spacing', () => {
  it('inherits the spacing a paragraph does not set, and takes the larger of lower and upper spacing', async () => {
    const doc = await docx({ body: para('a') + para('b', '<w:spacing w:before="400"/>') + para('c') });
    const nodes = [0, 1].map((k) => doc.GetNodes().FirstTextNode().GetIndex() + k).map((i) => doc.GetNodes().node(i) as import('../../src/lo/sw/inc/ndtxt.ts').SwTextNode);
    // "b" keeps the default lower spacing although it sets its upper spacing.
    expect(nodes[1]!.GetAttr('RES_UL_SPACE')).toMatchObject({ upper: 400, lower: 160 });
    expect(doc.m_bParaSpaceMax).toBe(false);
    const sh = new SwWrtShell(doc, mono);
    const [ta, tb, tc] = tops(sh);
    // Lines are 240 high; 1.5 spacing adds 120 above the next paragraph. Between a and b: max(160, 400).
    expect(tb! - ta!).toBe(240 + 120 + 400);
    expect(tc! - tb!).toBe(240 + 120 + 160);
  });

  it('adds both with w:doNotUseHTMLParagraphAutoSpacing, and keeps the setting through ODT', async () => {
    const doc = await docx({ body: para('a') + para('b', '<w:spacing w:before="400"/>'), settings: '<w:compat><w:doNotUseHTMLParagraphAutoSpacing/></w:compat>' });
    expect(doc.m_bParaSpaceMax).toBe(true);
    const [ta, tb] = tops(new SwWrtShell(doc, mono));
    expect(tb! - ta!).toBe(240 + 120 + 160 + 400);
    const back = (await ImportODT(await ExportODT(doc))).doc;
    expect([back.m_bParaSpaceMax, back.m_bHeaderSpacingBelowLastPara, back.m_bTabOverSpacing]).toEqual([true, true, true]);
  });

  it('leaves out the spacing between paragraphs of one style with contextual spacing', async () => {
    const styles = '<w:style w:type="paragraph" w:styleId="List"><w:name w:val="List Paragraph"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>';
    const doc = await docx({ styles, body: para('a', '<w:pStyle w:val="List"/>') + para('b', '<w:pStyle w:val="List"/>') + para('c') });
    const [ta, tb, tc] = tops(new SwWrtShell(doc, mono));
    expect(tb! - ta!).toBe(240 + 120);
    expect(tc! - tb!).toBe(240 + 120 + 160);
    const back = (await ImportDOCX(await ExportDOCX(doc))).doc;
    expect(back.GetNodes().FirstTextNode().GetAttr('RES_UL_SPACE').context).toBe(true);
  });

  it('drops the upper spacing at the top of later pages in Word 2013 layout, not after a new page style', async () => {
    const body = para('a') + `<w:p><w:r><w:br w:type="page"/><w:t>b</w:t></w:r></w:p>`.replace('<w:p>', '<w:p><w:pPr><w:spacing w:before="400"/></w:pPr>');
    const doc = await docx({ body });
    const sh = new SwWrtShell(doc, mono);
    expect(sh.m_pRoot.pages.length).toBe(2);
    const page = sh.m_pRoot.pages[1]!;
    expect(tops(sh, 1)[0]).toBe(page.aPrt.Top());
    // Word 2010 layout keeps it.
    const old = await docx({ body, settings: '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat>' });
    const sh2 = new SwWrtShell(old, mono);
    expect(tops(sh2, 1)[0]).toBe(sh2.m_pRoot.pages[1]!.aPrt.Top() + 400);
  });
});

describe('Word tables, headers and pictures', () => {
  it('uses separate top and bottom cell margins and adds the last line spacing in cells', async () => {
    const tbl = '<w:tbl><w:tblPr><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const doc = await docx({ body: tbl + para('after') });
    const sh = new SwWrtShell(doc, mono);
    const row = sh.m_pRoot.pages[0]!.tabs[0]!.rows[0]!;
    // 40 + 240 + 40, and the last paragraph's line spacing: half of 12 pt by 1.15 (SwBorderAttrs::CalcLineSpacing).
    expect(row.aFrame.Height()).toBe(40 + 240 + Math.trunc((240 * 50 * 1.15) / 100) + 40);
    const box = row.cells[0]!.box.m_aAttrs;
    expect([box.padding, box.dist]).toEqual([80, { top: 40, bottom: 40 }]);
    const odt = await ImportODT(await ExportODT(doc));
    const t2 = new SwWrtShell(odt.doc, mono).m_pRoot.pages[0]!.tabs[0]!.rows[0]!.cells[0]!.box.m_aAttrs;
    expect(t2.dist).toEqual({ top: 40, bottom: 40 });
  });

  it('keeps a framed paragraph inside a content control of the header', async () => {
    const header = '<w:sdt><w:sdtContent><w:p><w:pPr><w:framePr w:wrap="none" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/></w:pPr><w:r><w:t>Seite 1</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p><w:r><w:tab/></w:r></w:p>';
    const doc = await docx({ body: para('body'), header, sectPr: '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/></w:sectPr>' });
    const nodes = doc.GetNodes();
    const hdr = nodes.FindAreaSection(SwStartNodeType.SwHeaderStartNode, 'default', doc.m_aPageDesc.m_aName)!;
    const first = nodes.GoNext(hdr.GetIndex())!;
    expect(first.GetText()).toBe('\t');
    expect(first.m_aAnchoredFlys).toHaveLength(1);
    const sh = new SwWrtShell(doc, mono);
    // The frame is as wide as its text, on one line.
    const fly = sh.m_pRoot.pages[0]!.flys[0]!;
    expect(fly.frames[0]!.lines).toHaveLength(1);
  });

  it('crops pictures with a:srcRect, and keeps the crop in DOCX and ODT', async () => {
    const pic = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="P"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/><a:srcRect t="50000" r="25000"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const doc = await docx({ body: pic });
    const fly = () => (d: SwDoc) => d.GetNodes().FirstTextNode().m_aHints.find((h) => h.aAttrs.RES_TXTATR_FLYCNT)!.aAttrs.RES_TXTATR_FLYCNT!;
    expect(fly()(doc).crop).toEqual({ left: 0, top: 0.5, right: 0.25, bottom: 0 });
    expect(fly()((await ImportDOCX(await ExportDOCX(doc))).doc).crop).toEqual({ left: 0, top: 0.5, right: 0.25, bottom: 0 });
    const odt = fly()((await ImportODT(await ExportODT(doc))).doc).crop!;
    expect([odt.left, odt.top, odt.right, odt.bottom].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0.5, 0.25, 0]);
    expect(GetPrefSizeTwips(PNG)).toEqual({ width: 60, height: 30 });
  });

  it('breaks before a paragraph that starts with a page break', async () => {
    const doc = await docx({ body: para('a') + '<w:p><w:r><w:br w:type="page"/><w:t>b</w:t></w:r></w:p>' });
    const sh = new SwWrtShell(doc, mono);
    expect(sh.m_pRoot.pages.map((p) => p.frames.filter((f) => !f.pArea).map((f) => f.node.GetText()))).toEqual([['a'], ['b']]);
  });

  it('uses the bullet font of a list level for the label', async () => {
    const numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const doc = await docx({ body: para('item', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'), numbering });
    const sh = new SwWrtShell(doc, mono);
    const label = sh.m_pRoot.pages[0]!.frames[0]!.lines[0]!.portions[0]!;
    expect([label.kind, label.font.family, label.aExpand]).toEqual(['number', 'Symbol', '•']);
  });
});
