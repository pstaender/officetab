import { describe, expect, it } from 'vitest';
import { writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ExportDOCX } from '../../src/lo/sw/source/filter/ww8/docxexport.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';
import { Point } from '../../src/lo/tools/source/generic/gen.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => t.length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const documentXml = `<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Annual report</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="both"/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/></w:pPr>
  <w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="C00000"/></w:rPr><w:t xml:space="preserve">Bold red </w:t></w:r>
  <w:r><w:rPr><w:i/><w:u w:val="double"/><w:highlight w:val="yellow"/></w:rPr><w:t>marked</w:t></w:r>
  <w:hyperlink r:id="rLink"><w:r><w:t xml:space="preserve"> site</w:t></w:r></w:hyperlink>
  <w:r><w:footnoteReference w:id="1"/></w:r>
  <w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve"> noted</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>
</w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>bullet</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/></w:tblGrid>
  <w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="DDEEFF"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>tall</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
  <w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Logo" descr="Company logo"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720"/></w:sectPr>
</w:body></w:document>`;

const stylesXml = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const numberingXml = `<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

const theme = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
const footnotes = `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Source: survey.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
const comments = `<w:comments ${W}><w:comment w:id="0" w:author="Ada" w:date="2026-01-02T03:04:05Z"><w:p><w:r><w:t>Check this</w:t></w:r></w:p></w:comment></w:comments>`;
const header = `<w:hdr ${W}><w:p><w:r><w:t>Confidential</w:t></w:r></w:p></w:hdr>`;
const docRels = `<Relationships ${REL}><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/><Relationship Id="rImg" Type="image" Target="media/image1.png"/><Relationship Id="rHdr" Type="header" Target="header1.xml"/></Relationships>`;

async function fixture() {
  const enc = (s: string) => new TextEncoder().encode(s);
  return writeZip([
    { name: 'word/document.xml', data: enc(documentXml) }, { name: 'word/styles.xml', data: enc(stylesXml) },
    { name: 'word/numbering.xml', data: enc(numberingXml) }, { name: 'word/theme/theme1.xml', data: enc(theme) },
    { name: 'word/footnotes.xml', data: enc(footnotes) }, { name: 'word/comments.xml', data: enc(comments) },
    { name: 'word/header1.xml', data: enc(header) }, { name: 'word/_rels/document.xml.rels', data: enc(docRels) },
    { name: 'word/media/image1.png', data: PNG },
  ]);
}

describe('DOCX import', () => {
  it('reads styles, paragraphs, runs, links, footnotes, comments, lists, tables, fields, images, headers and page setup', async () => {
    const { doc, lost } = await ImportDOCX(await fixture());
    expect(lost).toEqual([]);
    const sh = new SwWrtShell(doc, mono);
    const nodes = doc.GetNodes();
    const paras: SwTextNode[] = [];
    for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) paras.push(n);
    const [h, p] = paras;
    // Styles: Heading 1 maps to Writer's, docDefaults and the theme font reach the default style.
    expect(h!.GetTextColl().GetName()).toBe('Heading 1');
    expect(h!.GetAttr('RES_CHRATR_FONTSIZE')).toBe(320);
    expect(h!.GetAttr('RES_KEEP')).toBe(true);
    expect(doc.FindTextFormatCollByName('Standard')!.GetFormatAttr('RES_CHRATR_FONT')).toBe('Calibri');
    expect(doc.FindTextFormatCollByName('Standard')!.GetFormatAttr('RES_UL_SPACE')).toEqual({ upper: 0, lower: 160 });
    // Paragraph and run properties.
    expect(p!.GetAttr('RES_PARATR_ADJUST')).toBe('block');
    expect(p!.GetAttr('RES_PARATR_LINESPACING')).toEqual({ rule: 'proportional', value: 150 });
    expect(p!.GetAttr('RES_LR_SPACE')).toEqual({ left: 720, right: 0, firstLine: -360 });
    expect(p!.GetCharAttrAt('RES_CHRATR_WEIGHT', 0)).toBe(true);
    expect(p!.GetCharAttrAt('RES_CHRATR_FONTSIZE', 0)).toBe(280);
    expect(p!.GetCharAttrAt('RES_CHRATR_COLOR', 0)).toBe('#c00000');
    expect(p!.GetCharAttrAt('RES_CHRATR_UNDERLINE', 9)).toBe('double');
    expect(p!.GetCharAttrAt('RES_CHRATR_BACKGROUND', 9)).toBe('#ffff00');
    expect(sh.GetINetAttr(p!, 16)?.url).toBe('https://example.org/');
    // Footnote and comment with its range.
    const ftnAt = p!.GetText().indexOf('\u0001');
    expect(p!.GetCharAttrAt('RES_TXTATR_FTN', ftnAt)).toBeTruthy();
    expect(sh.m_pRoot.pages[0]!.frames.filter((f) => f.pArea === 'footnote').map((f) => f.node.GetText())).toEqual([' Source: survey.']);
    const [ann] = doc.GetAnnotations();
    expect(ann!.field).toMatchObject({ author: 'Ada', text: 'Check this' });
    expect(p!.GetCharAttrAt('RES_TXTATR_ANNOTMARK', ann!.pos + 2)).toBe(ann!.field.id);
    // Lists: start value, nested level format, a Symbol bullet.
    const labels = paras.slice(2, 5).map((n) => sh.m_pRoot.m_aNums.get(n)?.label);
    expect(labels).toEqual(['3.', '3.a)', '•']);
    // Table: grid spans, vertical merge, Table Grid borders, header row, cell shading.
    let t: SwTableNode | null = null;
    for (let i = 0; i < nodes.Count(); i++) if (nodes.node(i).IsTableNode()) { t = nodes.node(i) as SwTableNode; break; }
    const lines = t!.m_pTable.GetTabLines();
    expect(lines.map((l) => l.m_aBoxes.map((b) => [b.m_aAttrs.width, b.getRowSpan()]))).toEqual([[[5000, 1], [1000, 2]], [[2000, 1], [3000, 1], [1000, -1]]]);
    expect(t!.m_pTable.m_nRowsToRepeat).toBe(1);
    expect(lines[0]!.m_aBoxes[0]!.m_aAttrs.background).toBe('#ddeeff');
    expect(lines[0]!.m_aBoxes[0]!.m_aAttrs.box.top).toEqual({ color: '#000000', width: 10 });
    // A PAGE field replaces its cached result; the image keeps its size and description.
    const last = paras.find((n) => n.GetText().startsWith('Page'))!;
    expect(last.GetText()).toBe('Page \u0001\u0001');
    expect(last.GetCharAttrAt('RES_TXTATR_FIELD', 5)).toEqual({ type: 'PageNumber' });
    expect(last.GetCharAttrAt('RES_TXTATR_FLYCNT', 6)).toMatchObject({ width: 1440, height: 720, name: 'Logo', alt: 'Company logo' });
    // Page setup and header: the header sits at its distance from the edge, the body below the top margin.
    const pd = doc.m_aPageDesc;
    expect([pd.nWidth, pd.nHeight, pd.nLeft, pd.nTop, pd.nHeaderMinHeight, pd.nHeaderSpacing]).toEqual([12240, 15840, 1080, 720, 720, 0]);
    expect(sh.m_pRoot.pages[0]!.aPrt.Top() - sh.m_pRoot.pages[0]!.aFrame.Top()).toBe(1440);
    expect(sh.m_pRoot.pages[0]!.frames.find((f) => f.pArea === 'header')!.node.GetText()).toBe('Confidential');
  });
});

describe('DOCX anchored objects', () => {
  it('keeps picture positions and wrap, text boxes and framePr frames', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const WPS = `${W} xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`;
    const body = `<w:document ${WPS}><w:body>
<w:p><w:pPr><w:framePr w:wrap="none" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/></w:pPr><w:r><w:t>12</w:t></w:r></w:p>
<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" behindDoc="1" relativeHeight="1"><wp:simplePos x="0" y="0"/>
  <wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>
  <wp:extent cx="914400" cy="457200"/><wp:wrapSquare wrapText="largest"/><wp:docPr id="2" name="Pic"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>
  <w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0"><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="margin"><wp:posOffset>635000</wp:posOffset></wp:positionV>
  <wp:extent cx="1270000" cy="635000"/><wp:wrapTopAndBottom/><wp:docPr id="3" name="Box"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:solidFill><a:srgbClr val="FFEE00"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></wps:spPr>
  <wps:txbx><w:txbxContent><w:p><w:r><w:t>Inside</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr lIns="91440"/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr></w:body></w:document>`;
    const zip = await writeZip([{ name: 'word/document.xml', data: enc(body) }, { name: 'word/_rels/document.xml.rels', data: enc(docRels) }, { name: 'word/media/image1.png', data: PNG }]);
    const { doc, lost } = await ImportDOCX(zip);
    expect(lost).toEqual([]);
    const flys = doc.GetFlyFormats();
    const frame = flys.find((f) => f.fmt?.m_aName === 'Frame1')!;
    const pic = flys.find((f) => f.name === 'Pic')!;
    const box = flys.find((f) => f.name === 'Box')!;
    // The framePr paragraph went into a frame anchored at the next paragraph.
    expect(doc.GetNodes().FirstTextNode().GetText()).toBe('Text');
    expect(frame.node!.GetText()).toBe('Text');
    expect(frame.fmt).toMatchObject({ m_bAutoWidth: true, m_aSurround: { m_eSurround: 1 }, m_aHoriOrient: { m_eOrient: 1, m_eRelation: 8 } });
    expect(pic.fmt).toMatchObject({ m_bOpaque: false, m_nLeftSpace: 180, m_aSurround: { m_eSurround: 3 }, m_aHoriOrient: { m_eOrient: 0, m_eRelation: 7, m_nPos: 1440 }, m_aVertOrient: { m_eOrient: 1, m_eRelation: 0 } });
    expect(pic.nContent).toBe(4);
    // The outline is centred on the shape's edge: the frame is half the line larger on each side.
    expect(box.fmt).toMatchObject({ m_aBackground: '#ffee00', m_aSurround: { m_eSurround: 0 }, m_aBox: { padding: 144, top: { color: '#ff0000', width: 20 } }, m_aVertOrient: { m_eRelation: 8, m_nPos: 990 }, m_nWidth: 2000 + 20, m_nHeight: 1000 + 20 });
    // Saved back, the shape has its own size and position again.
    const again = (await ImportDOCX(await ExportDOCX(doc))).doc.GetFlyFormats().find((f) => f.name === 'Box')!.fmt!;
    expect([again.m_nWidth, again.m_nHeight, again.m_aVertOrient.m_nPos]).toEqual([2020, 1020, 990]);
    const sec = doc.GetNodes().FindFlySection(box.fmt!.m_sContentId!)!;
    expect(doc.GetNodes().GoNext(sec.GetIndex())!.GetText()).toBe('Inside');
    // Laid out: the page number frame hugs its text at the right margin.
    const sh = new SwWrtShell(doc, mono);
    const page = sh.m_pRoot.pages[0]!;
    const f = page.flys.find((x) => x.fmt.m_aName === 'Frame1')!;
    expect(f.aFrame.Width()).toBeLessThan(400);
    expect(f.aFrame.Left() + f.aFrame.Width()).toBe(page.aPrt.Left() + page.aPrt.Width());
    // The text box's paragraph can be clicked into.
    const b = page.flys.find((x) => x.fmt.m_aName === 'Box')!;
    sh.SetCursor(new Point(b.frames[0]!.nLeft + 50, b.frames[0]!.nTop + 50));
    expect(sh.m_pCursor.GetPoint().GetNode().GetText()).toBe('Inside');
  });
});

describe('DOCX tracked changes', () => {
  it('reads insertions, deletions and paragraph mark changes', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const body = `<w:document ${W}><w:body>
<w:p><w:pPr><w:rPr><w:del w:id="3" w:author="Bo" w:date="2026-01-02T00:00:00Z"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">Keep </w:t></w:r>
<w:del w:id="1" w:author="Bo" w:date="2026-01-02T00:00:00Z"><w:r><w:delText>gone</w:delText></w:r></w:del>
<w:ins w:id="2" w:author="Cy" w:date="2026-01-03T00:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:t>next</w:t></w:r></w:p></w:body></w:document>`;
    const settings = `<w:settings ${W}><w:trackRevisions/></w:settings>`;
    const { doc, lost } = await ImportDOCX(await writeZip([{ name: 'word/document.xml', data: enc(body) }, { name: 'word/settings.xml', data: enc(settings) }]));
    expect(lost).toEqual([]);
    expect(doc.GetNodes().FirstTextNode().GetText()).toBe('Keep gonenew');
    const t = doc.m_pDocumentRedlineManager.GetRedlineTable().map((r) => [r.data.type, r.data.author, r.pieces.map((p) => (p.mark ? '¶' : p.node.GetText().slice(p.start, p.end))).join('')]);
    expect(t).toEqual([['Delete', 'Bo', 'gone'], ['Insert', 'Cy', 'new'], ['Delete', 'Bo', '¶']]);
    expect(doc.m_pDocumentRedlineManager.m_bRecord).toBe(true);
  });
});

describe('DOCX sections', () => {
  it('become page styles, and continuous ones with columns become sections', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const body = `<w:document ${W}><w:body>
<w:p><w:r><w:t>Portrait</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rHdr"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"/></w:sectPr></w:pPr><w:r><w:t>end one</w:t></w:r></w:p>
<w:p><w:r><w:t>Wide</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:pgNumType w:start="5"/></w:sectPr></w:pPr><w:r><w:t>end two</w:t></w:r></w:p>
<w:p><w:r><w:t>In columns</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="2" w:space="360" w:sep="1"/></w:sectPr></w:pPr><w:r><w:t>end three</w:t></w:r></w:p>
<w:p><w:r><w:t>last</w:t></w:r></w:p>
<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const { doc, lost } = await ImportDOCX(await writeZip([{ name: 'word/document.xml', data: enc(body) }, { name: 'word/header1.xml', data: enc(header) }, { name: 'word/_rels/document.xml.rels', data: enc(docRels) }]));
    expect(lost).toEqual([]);
    const sh = new SwWrtShell(doc, mono);
    expect(sh.m_pRoot.pages.map((p) => [p.pDesc.m_aName, p.nVirtNum, !!p.aHeader])).toEqual([['Default Page Style', 1, true], ['Converted1', 5, true]]);
    expect(doc.FindPageDesc('Converted1')!.nWidth).toBe(15840);
    const secs = doc.GetSections();
    expect(secs.map((x) => x.m_pSection.m_aCol)).toEqual([{ m_nCount: 2, m_nGutterWidth: 360, m_bLine: true, m_bBalanced: true }]);
    expect(doc.GetNodes().GoNext(secs[0]!.GetIndex())!.GetText()).toBe('In columns');
    expect(doc.GetNodes().LastTextNode().FindSectionNode()).toBeNull();
  });
});

describe('DOCX groups', () => {
  it('split an anchored group into its parts, placed through the group\'s child coordinates', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const NS = `${W} xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"`;
    // A group 2" wide at 1" from the page whose child coordinates are half as large: a line, a
    // picture at its right end and a nested group with a text box.
    const body = `<w:document ${NS}><w:body><w:p><w:r><w:t>Header</w:t></w:r><w:r><w:drawing>
<wp:anchor distT="0" distB="0" distL="0" distR="0" behindDoc="0" relativeHeight="1"><wp:simplePos x="0" y="0"/>
  <wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>91440</wp:posOffset></wp:positionV>
  <wp:extent cx="1828800" cy="457200"/><wp:wrapNone/><wp:docPr id="1" name="Group 1"/>
  <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp>
    <wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/><a:chOff x="100" y="0"/><a:chExt cx="914400" cy="228600"/></a:xfrm></wpg:grpSpPr>
    <wps:wsp><wps:cNvPr id="2" name="Line"/><wps:cNvCnPr/><wps:spPr><a:xfrm><a:off x="100" y="114300"/><a:ext cx="685800" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>
      <a:ln w="25400"><a:solidFill><a:srgbClr val="327A86"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>
    <pic:pic><pic:nvPicPr><pic:cNvPr id="3" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="685900" y="0"/><a:ext cx="228600" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
    <wpg:grpSp><wpg:cNvPr id="4" name="Inner"/><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="100" y="0"/><a:ext cx="228600" cy="114300"/><a:chOff x="0" y="0"/><a:chExt cx="228600" cy="114300"/></a:xfrm></wpg:grpSpPr>
      <wps:wsp><wps:cNvPr id="5" name="Note"/><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="228600" cy="114300"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr>
        <wps:txbx><w:txbxContent><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>
    </wpg:grpSp>
  </wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const zip = await writeZip([{ name: 'word/document.xml', data: enc(body) }, { name: 'word/_rels/document.xml.rels', data: enc(docRels) }, { name: 'word/media/image1.png', data: PNG }]);
    const { doc, lost } = await ImportDOCX(zip);
    expect(lost).toEqual([]);
    const fly = (name: string) => doc.GetFlyFormats().find((f) => f.name === name)!.fmt!;
    // Child coordinates are half the group's: the logo at 685800 child EMU is 1371600 EMU (1.5")
    // into the group, which starts at 1" (1440 twips).
    expect(fly('Logo')).toMatchObject({ graphic: expect.any(String), m_nWidth: 720, m_nHeight: 720, m_aHoriOrient: { m_nPos: 1440 + 2160 }, m_aVertOrient: { m_nPos: 144 } });
    expect(fly('Line')).toMatchObject({ m_pShape: expect.anything(), m_nWidth: 2160, m_aHoriOrient: { m_nPos: 1440 }, m_aVertOrient: { m_nPos: 144 + 360 } });
    // The nested group's text box, scaled by the outer group only (its own factor is 1).
    const note = fly('Note');
    expect(note).toMatchObject({ m_nWidth: 720, m_nHeight: 360, m_aHoriOrient: { m_nPos: 1440 }, m_aVertOrient: { m_nPos: 144 } });
    const sec = doc.GetNodes().FindFlySection(note.m_sContentId!)!;
    expect(doc.GetNodes().GoNext(sec.GetIndex())!.GetText()).toBe('Note');
  });
});
