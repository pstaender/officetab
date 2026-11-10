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

interface Parts { body: string; styles?: string; settings?: string; numbering?: string; header?: string; sectPr?: string; theme?: string }
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
  if (p.theme) files.push({ name: 'word/theme/theme1.xml', data: enc.encode(p.theme) });
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
    // 40 + 240 + 40, and the last paragraph's line spacing: half of 10 pt (Word's default size,
    // StyleSheetTable) by 1.15 (SwBorderAttrs::CalcLineSpacing).
    expect(row.aFrame.Height()).toBe(40 + 240 + Math.trunc((200 * 50 * 1.15) / 100) + 40);
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

describe('Word defaults, text boxes and character anchors', () => {
  const WPS = 'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

  it('sizes text 10 pt when neither the styles nor w:docDefaults do (StyleSheetTable)', async () => {
    const styles = '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Own"><w:name w:val="Own"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:style>';
    const doc = await docx({ body: para('x', '<w:pStyle w:val="Own"/>'), styles });
    expect(doc.GetNodes().FirstTextNode().GetAttr('RES_CHRATR_FONTSIZE')).toBe(200);
  });

  it('fills a text box with a theme colour', async () => {
    const theme = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="t"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFE"/></a:lt1></a:clrScheme></a:themeElements></a:theme>';
    const box = `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0"><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="635000" cy="635000"/><wp:wrapNone/><wp:docPr id="1" name="Box"/><a:graphic><a:graphicData><wps:wsp ${WPS}><wps:spPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>e)</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr lIns="0"/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
    const doc = await docx({ body: box, theme });
    expect(doc.GetFlyFormats().find((f) => f.name === 'Box')!.fmt!.m_aBackground).toBe('#fffffe');
  });

  it('turns a text box with vert270 so that its text runs bottom to top, and keeps it in DOCX and ODT', async () => {
    const box = `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0"><wp:positionH relativeFrom="page"><wp:posOffset>254000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>2540000</wp:posOffset></wp:positionV><wp:extent cx="254000" cy="1905000"/><wp:wrapNone/><wp:docPr id="1" name="Side"/><a:graphic><a:graphicData><wps:wsp ${WPS}><wps:spPr><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Upwards</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr vert="vert270" lIns="0" tIns="0" rIns="0" bIns="0"/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
    const doc = await docx({ body: box });
    const fmt = doc.GetFlyFormats().find((f) => f.name === 'Side')!.fmt!;
    expect(fmt.m_eFrameDir).toBe('bt-lr');
    const sh = new SwWrtShell(doc, mono);
    const fly = sh.m_pRoot.pages[0]!.flys.find((f) => f.fmt.m_aName === 'Side')!;
    // One line as long as the box is high (3000 twips), not broken to the box's 400 twips width.
    expect(fly.frames[0]!.lines.length).toBe(1);
    expect(fly.frames[0]!.nWidth).toBe(3000);
    // The caret before the first character is at the box's bottom left, after it higher up.
    const node = fly.frames[0]!.node;
    const r0 = sh.m_pRoot.GetCharRect(node, 0)!, r3 = sh.m_pRoot.GetCharRect(node, 3)!;
    expect(r0.Top() + r0.Height()).toBe(fly.aFrame.Top() + fly.aFrame.Height());
    expect(r3.Top()).toBe(r0.Top() - 300);
    expect(r0.Left()).toBeGreaterThanOrEqual(fly.aFrame.Left());
    for (const back of [(await ImportDOCX(await ExportDOCX(doc))).doc, (await ImportODT(await ExportODT(doc))).doc]) {
      expect(back.GetFlyFormats().find((f) => f.name === 'Side')!.fmt!.m_eFrameDir).toBe('bt-lr');
    }
  });

  it('places a character anchored picture beside its character, from the top of the paragraph below the spacing before it', async () => {
    const pic = (h: string) => `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0"><wp:positionH relativeFrom="${h}"><wp:posOffset>63500</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="127000" cy="127000"/><wp:wrapNone/><wp:docPr id="1" name="Icon"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
    const body = para('before', '<w:spacing w:after="400"/>') + `<w:p><w:pPr><w:spacing w:before="0"/></w:pPr><w:r><w:t>Heading</w:t></w:r>${pic('character')}</w:p>`;
    const sh = new SwWrtShell(await docx({ body }), mono);
    const page = sh.m_pRoot.pages[0]!;
    const fly = page.flys.find((f) => f.fmt.m_aName === 'Icon')!;
    const heading = page.frames.find((f) => f.node.GetText().startsWith('Heading'))!;
    // x: after the 7 characters of "Heading" (100 each), then the 100 twips offset.
    expect(fly.aFrame.Left()).toBe(heading.nLeft + 700 + 100);
    // y: the paragraph's top for objects is below the previous paragraph's lower spacing: its text top.
    expect(fly.aFrame.Top()).toBe(heading.nTop);
    // The picture does not wrap: the heading keeps its line.
    expect(heading.lines.length).toBe(1);
  });
});
