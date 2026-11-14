// The HTML filter (sw/source/filter/html): the tokenizer, import of HTML as browsers and
// LibreOffice write it, export, and round trips of HTML and of the reference documents.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ImportHTML } from '../../src/lo/sw/source/filter/html/swhtml.ts';
import { ExportHTML } from '../../src/lo/sw/source/filter/html/wrthtml.ts';
import { HTMLParser } from '../../src/lo/svtools/source/svhtml/parhtml.ts';
import { HtmlTokenId } from '../../src/lo/include/svtools/htmltokn.ts';
import { GetColor } from '../../src/lo/sw/source/filter/html/svxcss1.ts';
import { ImportODT } from '../../src/lo/sw/source/filter/xml/odt.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import type { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';
import type { SwTableNode } from '../../src/lo/sw/inc/node.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
const sample = `<!DOCTYPE html>
<html><head><title>My  Doc</title><meta name="author" content="A. Person">
<style>p.note { color: #ff0000 } h2 { font-size: 20pt } @page { size: 612pt 792pt; margin: 72pt }</style></head>
<body>
<div title="header"><p>Page <sdfield type=PAGE subtype=RANDOM format=PAGE>3</sdfield></p></div>
<h1 id="top">Title</h1>
<p class="note">Some <b>bold</b>, <i>it</i>, <u>u</u>, <s>gone</s> and <a href="https://example.org">link</a>.<br>Second&nbsp;line x<sup>2</sup> &amp; &lt;tag&gt;</p>
<p style="text-align: center; margin-left: 1cm">Centered <span style="color: blue; font-weight: bold">blue</span> <em>em</em> <code>code</code><a class="sdfootnoteanc" name="sdfootnote1anc" href="#sdfootnote1sym"><sup>1</sup></a></p>
<ul><li>one</li><li>two<ol type="a" start="3"><li>nested</li></ol></li><li><p>three a</p><p>three b</p></li></ul>
<table border="1" cellpadding="4" width="50%"><tr><th>H1</th><th>H2</th><th>H3</th></tr>
<tr><td rowspan="2">r</td><td colspan="2" bgcolor="#ffff00">wide</td></tr><tr><td>x</td><td>y</td></tr></table>
<pre>code line 1
  indented</pre>
<blockquote>Quoted</blockquote>
<hr>
<p><img src="data:image/png;base64,${PNG}" alt="dot" width="20"></p>
<section><p>in a section</p></section>
<div id="sdfootnote1"><p class="sdfootnote"><a class="sdfootnotesym" name="sdfootnote1sym" href="#sdfootnote1anc">1</a>The note.</p></div>
</body></html>`;

const paras = (doc: SwDoc, from = doc.GetNodes().BodyStart(), to = doc.GetNodes().GetEndOfContent().GetIndex()) => {
  const out: SwTextNode[] = [];
  const nodes = doc.GetNodes();
  for (let i = from; i < to; i++) { const n = nodes.node(i); if (n.IsTextNode()) out.push(n as SwTextNode); }
  return out;
};
const byText = (doc: SwDoc, t: string) => paras(doc).find((p) => p.GetText() === t) ?? paras(doc).find((p) => p.GetText().includes(t))!;
/** The body as text, style, list level and character attributes per paragraph, for comparisons. */
const dump = (doc: SwDoc) => {
  const nodes = doc.GetNodes(), out: string[] = [];
  for (let i = 0; i < nodes.Count(); i++) {
    const n = nodes.node(i);
    if (n.IsTableNode()) out.push(`TABLE ${(n as SwTableNode).m_pTable.GetTabLines().map((l) => l.m_aBoxes.map((b) => b.getRowSpan()).join(',')).join('|')}`);
    if (!n.IsTextNode()) continue;
    const p = n as SwTextNode;
    const list = p.m_aSet.RES_PARATR_NUMRULE ? ` L${p.m_aSet.RES_PARATR_LIST_LEVEL}${p.m_aSet.RES_PARATR_LIST_ISCOUNTED === false ? 'u' : ''}` : '';
    const hints = p.m_aHints.map((h) => `${h.nStart}-${h.nEnd}:${Object.keys(h.aAttrs).sort().join('+')}`).join(' ');
    out.push(`${p.GetTextColl().GetName()}${list}: ${JSON.stringify(p.GetText())} ${hints}`);
  }
  return out;
};

class Tokens extends HTMLParser {
  readonly out: string[] = [];
  protected NextToken(t: HtmlTokenId): void {
    const name = Object.entries(HtmlTokenId).find(([, v]) => v === t)![0];
    const opts = t >= HtmlTokenId.ONOFF_START ? this.GetOptions().map((o) => ` ${o.aToken}=${o.aValue}`).join('') : '';
    this.out.push(t < HtmlTokenId.ONOFF_START && this.aToken ? `${name}(${this.aToken})` : `${name}${opts}`);
  }
  static of(s: string): string[] { const p = new Tokens(s); p.Continue(); return p.out; }
}

describe('HTMLParser', () => {
  it('tokenizes tags, options, entities, comments and raw style text', () => {
    expect(Tokens.of('<P Class="a" title=\'x y\' hidden>a  &amp;&#x41;&#66;&copy&nbsp;b</P><!-- c --><style>p{}</style>')).toEqual([
      'PARABREAK_ON class=a title=x y hidden=', 'TEXTTOKEN(a &AB© b)', 'PARABREAK_OFF', 'COMMENT( c )', 'STYLE_ON', 'RAWDATA(p{})', 'STYLE_OFF',
    ]);
  });
  it('keeps line feeds and tabs in PRE, and turns self-closing tags into on and off', () => {
    expect(Tokens.of('<pre>\na\n\tb</pre><br/><p/>')).toEqual([
      'PREFORMTXT_ON', 'TEXTTOKEN(a)', 'NEWPARA', 'TEXTTOKEN(        )', 'TEXTTOKEN(b)', 'PREFORMTXT_OFF', 'LINEBREAK', 'PARABREAK_ON', 'PARABREAK_OFF',
    ]);
  });
  it('reads RGBA colours on white, as upstream (testRGBAColor)', () => {
    expect(GetColor('#5fb23680')).toBe('#aed89a');
    expect(GetColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(GetColor('Navy')).toBe('#000080');
  });
});

describe('HTML import', () => {
  const { doc, lost } = ImportHTML(new TextEncoder().encode(sample));

  it('reads paragraphs, styles, character formatting and the document information', () => {
    expect(lost).toEqual([]);
    expect(doc.m_xDocProps.getTitle()).toBe('My Doc');
    expect(doc.m_xDocProps.getAuthor()).toBe('A. Person');
    expect([doc.m_aPageDesc.nWidth, doc.m_aPageDesc.nLeft]).toEqual([12240, 1440]);
    expect(byText(doc, 'Title').GetTextColl().GetName()).toBe('Heading 1');
    const body = byText(doc, 'Some');
    expect(body.GetText()).toBe('Some bold, it, u, gone and link.\nSecond line x2 & <tag>');
    // a class makes "<style>.<class>" with the rules of the style sheet
    expect(body.GetTextColl().GetName()).toBe('Text Body.note');
    expect(body.GetTextColl().GetFormatAttr('RES_CHRATR_COLOR')).toBe('#ff0000');
    const at = (s: string) => body.GetText().indexOf(s);
    expect(body.GetCharAttrAt('RES_CHRATR_WEIGHT', at('bold'))).toBe(true);
    expect(body.GetCharAttrAt('RES_CHRATR_POSTURE', at('it'))).toBe(true);
    expect(body.GetCharAttrAt('RES_CHRATR_UNDERLINE', at('u,'))).toBe('single');
    expect(body.GetCharAttrAt('RES_CHRATR_CROSSEDOUT', at('gone'))).toBe(true);
    expect(body.GetCharAttrAt('RES_TXTATR_INETFMT', at('link'))).toBe('https://example.org');
    expect(body.GetCharAttrAt('RES_CHRATR_ESCAPEMENT', at('2 &'))).toBe(33);
    const centered = byText(doc, 'Centered');
    expect(centered.m_aSet).toMatchObject({ RES_PARATR_ADJUST: 'center', RES_LR_SPACE: { left: 567 } });
    expect(centered.GetCharAttrAt('RES_CHRATR_COLOR', centered.GetText().indexOf('blue'))).toBe('#0000ff');
    expect(centered.GetCharAttrAt('RES_TXTATR_CHARFMT', centered.GetText().indexOf('em'))?.GetName()).toBe('Emphasis');
    expect(centered.GetCharAttrAt('RES_TXTATR_CHARFMT', centered.GetText().indexOf('code'))?.GetName()).toBe('Source Text');
    expect(doc.getIDocumentMarkAccess().findBookmark('top')?.GetMarkStart().GetContentIndex()).toBe(0);
  });

  it('reads lists with their levels, types and start values', () => {
    const one = byText(doc, 'one'), nested = byText(doc, 'nested'), b = byText(doc, 'three b');
    expect(one.m_aSet).toMatchObject({ RES_PARATR_LIST_LEVEL: 0, RES_PARATR_LIST_ISCOUNTED: true });
    const rule = doc.FindNumRulePtr(nested.m_aSet.RES_PARATR_NUMRULE!)!;
    expect(nested.m_aSet.RES_PARATR_LIST_LEVEL).toBe(1);
    expect([rule.Get(1).GetStart(), rule.Get(0).GetBulletChar()]).toEqual([3, '•']);
    // a second paragraph of an item is not numbered
    expect(b.m_aSet.RES_PARATR_LIST_ISCOUNTED).toBe(false);
  });

  it('reads tables with header cells, column and row spans', () => {
    const h = byText(doc, 'H1');
    expect(h.GetTextColl().GetName()).toBe('Table Heading');
    const table = h.FindTableNode()!.m_pTable;
    expect(table.GetTabLines().map((l) => l.m_aBoxes.map((x) => x.getRowSpan()))).toEqual([[1, 1, 1], [2, 1], [-1, 1, 1]]);
    const wide = table.GetTabLines()[1]!.m_aBoxes[1]!;
    expect(wide.m_aAttrs.width).toBe(2 * table.GetTabLines()[0]!.m_aBoxes[0]!.m_aAttrs.width);
    expect(wide.m_aAttrs.background).toBe('#ffff00');
    expect(table.m_aAttrs.relWidth).toBe(50);
  });

  it('reads PRE lines, quotations, rules, images, headers, fields and footnotes', () => {
    expect(byText(doc, 'code line').GetTextColl().GetName()).toBe('Preformatted Text');
    expect(byText(doc, 'indented').GetText()).toBe('  indented');
    expect(byText(doc, 'Quoted').GetTextColl().GetName()).toBe('Quotations');
    expect(paras(doc).some((p) => p.GetTextColl().GetName() === 'Horizontal Line')).toBe(true);
    const fly = paras(doc).flatMap((p) => p.m_aHints).find((h) => h.aAttrs.RES_TXTATR_FLYCNT)!.aAttrs.RES_TXTATR_FLYCNT!;
    expect([fly.alt, fly.width, fly.height]).toEqual(['dot', 300, 300]);
    expect(byText(doc, 'in a section').GetText()).toBe('in a section');
    const nodes = doc.GetNodes();
    const all = paras(doc, 0, nodes.Count());
    const page = all.find((p) => p.GetText().startsWith('Page'))!;
    expect(page.GetTextColl().GetName()).toBe('Header');
    expect(page.m_aHints.find((h) => h.aAttrs.RES_TXTATR_FIELD)?.aAttrs.RES_TXTATR_FIELD).toEqual({ type: 'PageNumber' });
    const ftn = byText(doc, 'Centered').m_aHints.find((h) => h.aAttrs.RES_TXTATR_FTN)!.aAttrs.RES_TXTATR_FTN!;
    const sec = nodes.FindFootnoteSection(ftn.id)!;
    expect(paras(doc, sec.GetIndex(), sec.EndOfSectionNode().GetIndex()).map((p) => [p.GetText(), p.GetTextColl().GetName()])).toEqual([['The note.', 'Footnote']]);
  });

  it('reports what it cannot read, and keeps the text of it', () => {
    const r = ImportHTML('<p>a<!-- x --><img src="pic.png" alt="Pic"><script>alert(1)</script><input value="v"></p>');
    expect(r.lost.sort()).toEqual(['comments in the HTML source', 'forms (their text is kept)', 'linked images (their description links to them)', 'scripts']);
    const p = paras(r.doc)[0]!;
    expect(p.GetText()).toBe('aPicv');
    expect(p.GetCharAttrAt('RES_TXTATR_INETFMT', 1)).toBe('pic.png');
  });

  it('decodes the bytes by their byte order mark or META charset', () => {
    const latin1 = Uint8Array.from([...'<meta charset="iso-8859-1"><p>'].map((c) => c.charCodeAt(0)).concat([0xe4, 0x3c, 0x2f, 0x70, 0x3e]));
    expect(paras(ImportHTML(latin1).doc)[0]!.GetText()).toBe('ä');
    const utf16 = new Uint8Array([0xfe, 0xff, ...[...'<p>é</p>'].flatMap((c) => [0, c.charCodeAt(0)])]);
    expect(paras(ImportHTML(utf16).doc)[0]!.GetText()).toBe('é');
  });

  it('reads LibreOffice\'s own HTML: header, page break, list, borders and table cells', () => {
    const lo = `<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>
	<style type="text/css">@page { size: 8.27in 11.69in; margin-left: 0.98in } p { margin-bottom: 0.1in; line-height: 115%; background: transparent }</style></head>
<body lang="de-DE" link="#000080" vlink="#800000" dir="ltr">
<div title="header"><p style="margin-bottom: 0in; line-height: 100%"><font face="Arial, sans-serif"><font size="2" style="font-size: 10pt">Seite
		<span style="background: #c0c0c0"><sdfield type=PAGE subtype=RANDOM format=PAGE>2</sdfield></span></font></font></p></div>
<p style="margin-bottom: 0.11in; line-height: 150%; page-break-before: always"><font face="Arial, sans-serif"><font size="2" style="font-size: 10pt"><b>Hinweise:</b></font></font></p>
<ul>
	<li><p style="line-height: 150%; margin-bottom: 0.11in"><font face="Arial, sans-serif">Bitte
	lese</font></p></li>
</ul>
<p style="margin-top: 0.08in; border-top: none; border-bottom: 1.00pt solid #000000; border-left: none; border-right: none; padding-bottom: 0.03in">Teil A</p>
<p style="margin-bottom: 0in; line-height: 150%"><br/>

</p>
<table width="605" cellpadding="3" cellspacing="0"><col width="144"/><col width="145"/>
	<tr><td width="144" style="border: 1px solid #000000; padding: 0.03in 0.06in"><p align="center">14
			mm</p></td><td width="145" style="border: 1px solid #000000"><p>2 m</p></td></tr>
</table>
</body></html>`;
    const r = ImportHTML(lo);
    expect(r.lost).toEqual([]);
    expect(r.doc.m_aPageDesc.nWidth).toBe(11909);
    const hinweise = byText(r.doc, 'Hinweise');
    expect(hinweise.m_aSet).toMatchObject({ RES_BREAK: 'page-before', RES_PARATR_LINESPACING: { rule: 'proportional', value: 150 }, RES_UL_SPACE: { lower: 158 } });
    expect([hinweise.GetCharAttrAt('RES_CHRATR_FONT', 0), hinweise.GetCharAttrAt('RES_CHRATR_FONTSIZE', 0), hinweise.GetCharAttrAt('RES_CHRATR_WEIGHT', 0)]).toEqual(['Arial', 200, true]);
    const item = byText(r.doc, 'Bitte');
    expect(item.GetText()).toBe('Bitte lese');
    expect(item.m_aSet).toMatchObject({ RES_PARATR_LIST_ISCOUNTED: true, RES_UL_SPACE: { lower: 158 } });
    expect(byText(r.doc, 'Teil A').m_aSet.RES_BOX).toMatchObject({ top: null, bottom: { color: '#000000', width: 20 } });
    // the empty paragraph of <p><br/></p>
    expect(paras(r.doc).some((p) => p.GetText() === '' && p.m_aSet.RES_UL_SPACE?.lower === 0)).toBe(true);
    const cell = byText(r.doc, '14 mm');
    expect(cell.GetAttr('RES_PARATR_ADJUST')).toBe('center');
    expect(cell.FindTableNode()!.m_pTable.GetTabLines()[0]!.m_aBoxes[0]!.m_aAttrs.box.top).toEqual({ color: '#000000', width: 15 });
  });
});

describe('HTML export', () => {
  const { doc } = ImportHTML(sample);
  const html = ExportHTML(doc);

  it('writes the head, the style sheet and the paragraphs as the tags of their styles', () => {
    for (const piece of [
      '<!DOCTYPE html>', '<meta http-equiv="content-type" content="text/html; charset=utf-8"/>', '<title>My Doc</title>', '<meta name="author" content="A. Person"/>',
      '@page { size: 612pt 792pt;', 'p.note { color: #ff0000 }', '<div title="header">', '<sdfield type=PAGE subtype=RANDOM format=PAGE>1</sdfield>',
      '<h1><a name="top"></a>Title</h1>',
      '<p class="note">Some <b>bold</b>, <i>it</i>, <u>u</u>, <strike>gone</strike> and <a href="https://example.org">link</a>.<br/>Second&nbsp;line x<sup>2</sup> &amp; &lt;tag&gt;</p>',
      '<p align="center" style="margin-left: 28.35pt; margin-right: 0pt">', '<em>em</em>', '<code>code</code>',
      '<a class="sdfootnoteanc" name="sdfootnote1anc" href="#sdfootnote1sym"><sup>1</sup></a>',
      '<ol type="a" start="3">', '<li><p style="margin-top: 0pt; margin-bottom: 0pt">nested</p></li>',
      '<table width="50%"', '<th width="104"', '<td rowspan="2"', '<td colspan="2" width="208" bgcolor="#ffff00"',
      '<pre>code line 1\n  indented</pre>', '<blockquote>Quoted</blockquote>', '<hr/>', `<img src="data:image/png;base64,${PNG}" name="Image1" alt="dot" width="20" height="20" border="0"/>`,
      '<div id="sdfootnote1">', '<p class="sdfootnote"><a class="sdfootnotesym" name="sdfootnote1sym" href="#sdfootnote1anc">1</a>The note.</p>',
    ]) expect(html, piece).toContain(piece);
  });

  it('reads its own HTML back as it was', () => {
    const back = ImportHTML(html);
    expect(back.lost).toEqual([]);
    expect(dump(back.doc)).toEqual(dump(doc));
    expect(ExportHTML(back.doc)).toBe(html);
  });

  it('keeps blanks with white-space: pre-wrap and marks tracked changes', () => {
    const d = ImportHTML('<p>a  b</p>').doc;
    const p = paras(d)[0]!;
    p.InsertText('  x', 0);
    const out = ExportHTML(d);
    expect(out).toContain('<p style="white-space: pre-wrap">  xa b</p>');
    expect(paras(ImportHTML(out).doc)[0]!.GetText()).toBe('  xa b');
  });

  for (const name of ['exam_word_export.odt', 'versions.odt', 'sample3.docx', 'course_schedule_template.docx', 'sample-docx-files-sample1.docx']) {
    it(`writes ${name} as HTML that reads back with the same text`, async () => {
      const bytes = readFileSync(`specs/writer/${name}`);
      const { doc: d } = name.endsWith('.odt') ? await ImportODT(bytes) : await ImportDOCX(bytes);
      const back = ImportHTML(ExportHTML(d)).doc;
      // Text frames are written before their paragraph; compare the body's text without them.
      const text = (x: SwDoc) => paras(x).map((p) => p.GetText().replace(/[\u0001\s]+/g, ' ').trim()).filter(Boolean).join('\n');
      expect(text(back)).toBe(text(d));
    });
  }
});

// LibreOffice's own test documents (sw/qa/extras/htmlimport and htmlexport), when the upstream
// sources are fetched: every one opens, and writes HTML that reads back with the same text.
const upstreamDirs = ['htmlimport', 'htmlexport'].map((d) => `upstream/core/sw/qa/extras/${d}/data/`).filter((d) => existsSync(d));
describe.skipIf(!upstreamDirs.length)('upstream HTML test documents', () => {
  const files = upstreamDirs.flatMap((d) => readdirSync(d).filter((n) => /\.x?html?$/i.test(n)).map((n) => d + n));
  it.each(files)('%s', (file) => {
    const { doc } = ImportHTML(new Uint8Array(readFileSync(file)));
    const text = (x: SwDoc) => paras(x).map((p) => p.GetText());
    expect(text(ImportHTML(ExportHTML(doc)).doc)).toEqual(text(doc));
  });
  it('nested lists of the other type get their own list style (testNestedListMixedType)', () => {
    const file = upstreamDirs.map((d) => `${d}nested-list-mixed-type.html`).find(existsSync);
    if (!file) return;
    const { doc } = ImportHTML(new Uint8Array(readFileSync(file)));
    const typeOf = (t: string) => { const p = byText(doc, t); return doc.FindNumRulePtr(p.m_aSet.RES_PARATR_NUMRULE!)!.Get(1).GetNumberingType(); };
    expect(typeOf('Ordered 1')).not.toBe(typeOf('Bullet 1'));
  });
});
