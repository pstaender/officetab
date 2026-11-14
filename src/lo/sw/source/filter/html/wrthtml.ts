// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/html/wrthtml.cxx reduced
// @upstream sw/source/filter/html/wrthtml.hxx reduced
// @upstream sw/source/filter/html/htmlatr.cxx reduced
// @upstream sw/source/filter/html/css1atr.cxx reduced
// @upstream sw/source/filter/html/htmlnumwriter.cxx reduced
// @upstream sw/source/filter/html/htmltabw.cxx reduced
// @upstream sw/source/filter/html/htmlftn.cxx reduced
// @upstream sw/source/filter/html/htmlflywriter.cxx reduced
// HTML export, as SwHTMLWriter writes with the filter options "EmbedImages" (images as data:
// URLs, so the page is one file) and styles on: the document information as META elements, a
// style sheet with @page and the rules of the paragraph styles in use, paragraphs as the tag of
// their style (GetCSS1Selector: P, H1-H6, PRE, BLOCKQUOTE, ADDRESS, DT, DD, HR) with CLASS for
// derived styles and their hard attributes as STYLE, character attributes as upstream's tags (B,
// I, U, STRIKE, SUP, SUB, FONT, the HTML character styles, A) and SPAN with STYLE, lists as UL/OL
// with LI (TYPE, START, VALUE), tables with COL widths, COLSPAN, ROWSPAN, TH for heading cells,
// borders, padding and backgrounds, bookmarks as A NAME, footnotes and endnotes, the header and
// footer of the default page style as DIV TITLE, and page and line breaks.
// Differences: lengths are written in points (upstream: the unit of the measurement setting);
// tracked changes are written as INS and DEL (upstream writes the text as it is); fields are
// written as their text, page numbers and counts as SDFIELD; frames and their paragraphs become a
// DIV before their paragraph, images anchored to paragraphs IMG with ALIGN; drawing shapes,
// formulas, comments, the first and left page headers and footers, hidden paragraphs and the
// script-dependent (CJK, CTL) attributes are not written; long lines are not wrapped.
import type { SwDoc } from '../../../inc/doc.ts';
import { CH_TXTATR_BREAKWORD, POOL_DEFAULTS, type SvxBorderLine, type SvxLineSpacing, type SwAttrs, type SwCharAttrSet, type SwField, type SwRedlineData } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNode, SwSectionNode, SwTableNode } from '../../../inc/node.ts';
import type { SwFormat, SwTextFormatColl } from '../../../inc/format.ts';
import type { SwTableBox } from '../../../inc/swtable.ts';
import type { SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { HoriOrientation } from '../../../inc/frmfmt.ts';
import { SwStartNodeType } from '../../../inc/ndtyp.ts';
import { DEFAULT_PAGE_DESC } from '../../../inc/pagedesc.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { NumberParagraphs, GetActualListLevel, type SwNodeNum } from '../../core/doc/list.ts';
import { DefaultExpand } from '../../core/text/itrform2.ts';
import { GetGeneratorString } from '../../../../unotools/source/config/docinfohelper.ts';
import { aFontHeights } from './svxcss1.ts';
import { CHAR_STYLES } from './swhtml.ts';

const SAL_NEWLINE_STRING = '\n';

/** HTMLOutFuncs::Out_String: the text with the characters HTML reserves as entities. */
function ConvertStringToHTML(s: string, bAttr = false): string {
  let out = '';
  for (const c of s) {
    switch (c) {
      case '&': out += '&amp;'; break;
      case '<': out += '&lt;'; break;
      case '>': out += '&gt;'; break;
      case '"': out += bAttr ? '&quot;' : c; break;
      case ' ': out += '&nbsp;'; break;
      case '­': out += '&shy;'; break;
      default: out += c;
    }
  }
  return out;
}

/** A CSS length of twips in points (exact to the twip). */
const pt = (nTwips: number): string => `${Number((nTwips / 20).toFixed(2))}pt`;
/** SwHTMLWriter::ToPixel */
const ToPixel = (nTwips: number): number => (nTwips > 0 ? Math.max(1, Math.round(nTwips / 15)) : 0);

const base64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The HTML tags of the paragraph pool styles (GetCSS1Selector). */
const PARA_TOKENS: Record<string, string> = {
  'Text Body': 'p', 'Heading 1': 'h1', 'Heading 2': 'h2', 'Heading 3': 'h3', 'Heading 4': 'h4', 'Heading 5': 'h5', 'Heading 6': 'h6',
  Sender: 'address', Quotations: 'blockquote', 'Preformatted Text': 'pre', 'List Contents': 'dd', 'List Heading': 'dt',
  'Table Contents': 'p', 'Table Heading': 'p',
};
/** The tags of the HTML character styles. */
const CHAR_TOKENS: Record<string, string> = Object.fromEntries(Object.entries(CHAR_STYLES).map(([tag, name]) => [name, tag]));

/** What GetCSS1Selector finds for a style: its tag, its class, and the style the tag stands for. */
interface SwHTMLFormatInfo { aToken: string; aClass: string; pRefFormat: SwFormat | null; nDeep: number }

/** A text attribute with its range and its markup (HTMLStartEndPos). */
interface HTMLStartEndPos { nStart: number; nEnd: number; sOn: string; sOff: string; nPrio: number }

/** SwHTMLNumRuleInfo of the paragraph written last. */
interface NumInfo { rule: string; depth: number }

class SwHTMLWriter {
  private readonly m_pDoc: SwDoc;
  private readonly out: string[] = [];
  private m_nIndentLvl = 0;
  private m_bLFPossible = false;
  private readonly nums: Map<SwTextNode, SwNodeNum>;
  private readonly m_TextCollInfos = new Map<SwFormat, SwHTMLFormatInfo>();
  /** The styles used, for the style sheet. */
  private readonly m_aUsedColls = new Set<SwTextFormatColl>();
  /** The open lists: their tags (UL, OL); and whether the innermost LI is open. */
  private m_aListTags: string[] = [];
  private m_aLiOpen: boolean[] = [];
  private m_aNumInfo: NumInfo = { rule: '', depth: 0 };
  /** PRE is open (consecutive preformatted paragraphs share it). */
  private m_bInPRE = false;
  /** The footnotes and endnotes in the order of their anchors, for OutFootEndNotes. */
  private m_aFootEndNotes: { id: string; endnote: boolean; nNo: number }[] = [];
  private m_nFootNote = 0;
  private m_nEndNote = 0;
  private readonly m_eLang: string;
  /** Bookmarks by paragraph. */
  private readonly m_aBookmarks = new Map<SwNode, { pos: number; name: string }[]>();

  constructor(doc: SwDoc) {
    this.m_pDoc = doc;
    const nodes = doc.GetNodes(), paras: SwTextNode[] = [];
    for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTextNode()) paras.push(n as SwTextNode); }
    this.nums = NumberParagraphs(doc, paras);
    this.m_eLang = doc.FindTextFormatCollByName('Standard')?.GetFormatAttr('RES_CHRATR_LANGUAGE') ?? 'en-US';
    for (const m of doc.getIDocumentMarkAccess().getBookmarks()) {
      const p = m.GetMarkStart();
      const node = p.GetNode();
      const list = this.m_aBookmarks.get(node) ?? [];
      list.push({ pos: p.GetContentIndex(), name: m.GetName() });
      this.m_aBookmarks.set(node, list);
    }
  }

  private Strm(s: string): void { this.out.push(s); }

  /** SwHTMLWriter::OutNewLine */
  private OutNewLine(): void {
    this.Strm(SAL_NEWLINE_STRING + '\t'.repeat(Math.min(this.m_nIndentLvl, 20)));
  }

  /** HTMLOutFuncs::Out_AsciiTag */
  private static Tag(name: string, bOn = true): string { return bOn ? `<${name}>` : `</${name}>`; }

  // ---- styles (css1atr.cxx) ----

  /** SwHTMLWriter::GetCSS1Selector, for paragraph styles. */
  private GetFormatInfo(pFormat: SwFormat): SwHTMLFormatInfo {
    const cached = this.m_TextCollInfos.get(pFormat);
    if (cached) return cached;
    let aToken = '', nDeep = 0, pRefFormat: SwFormat | null = null;
    for (let f: SwFormat | null = pFormat; f; f = f.DerivedFrom()) {
      const name = f.GetName();
      // the pool styles that are not exported: Standard, Heading, Horizontal Line
      if (name === 'Standard' || name === 'Heading' || name === 'Horizontal Line') break;
      const t = PARA_TOKENS[name];
      if (t) { aToken = t; pRefFormat = f; break; }
      nDeep++;
    }
    let aClass = '';
    if (!aToken) nDeep = 0;
    else if (nDeep > 0) {
      // the class is the style's name after its first '.', lower case, with '-' for '.', ' ' and '_'
      aClass = pFormat.GetName();
      const nPos = aClass.indexOf('.');
      if (nPos >= 0 && aClass.length > nPos + 1) aClass = aClass.slice(nPos + 1);
      aClass = aClass.toLowerCase().replace(/[. _]/g, '-');
    }
    // The footnote and endnote styles are P with their class.
    if (!aToken && (pFormat.GetName() === 'Footnote' || pFormat.GetName() === 'Endnote')) {
      aToken = 'p'; aClass = pFormat.GetName() === 'Footnote' ? 'sdfootnote' : 'sdendnote'; nDeep = 1;
      pRefFormat = this.m_pDoc.FindTextFormatCollByName('Text Body') ?? null;
    }
    const info = { aToken: aToken || 'p', aClass, pRefFormat, nDeep };
    this.m_TextCollInfos.set(pFormat, info);
    return info;
  }

  /** The paragraph and character properties of an attribute set as CSS declarations (OutCSS1_SfxItemSet). */
  private static CSS1Props(get: <K extends keyof SwAttrs>(k: K) => SwAttrs[K] | undefined, bPara: boolean): string[] {
    const out: string[] = [];
    const font = get('RES_CHRATR_FONT');
    if (font !== undefined) out.push(`font-family: ${/[^\w-]/.test(font) ? `"${font}"` : font}`);
    const size = get('RES_CHRATR_FONTSIZE');
    if (size !== undefined) out.push(`font-size: ${pt(size)}`);
    const weight = get('RES_CHRATR_WEIGHT');
    if (weight !== undefined) out.push(`font-weight: ${weight ? 'bold' : 'normal'}`);
    const posture = get('RES_CHRATR_POSTURE');
    if (posture !== undefined) out.push(`font-style: ${posture ? 'italic' : 'normal'}`);
    const color = get('RES_CHRATR_COLOR');
    if (color !== undefined) out.push(`color: ${color ?? '#000000'}`);
    const casemap = get('RES_CHRATR_CASEMAP');
    if (casemap !== undefined) out.push(casemap === 'smallcaps' ? 'font-variant: small-caps' : `text-transform: ${casemap}`);
    const deco: string[] = [];
    const ul = get('RES_CHRATR_UNDERLINE'), co = get('RES_CHRATR_CROSSEDOUT'), ol = get('RES_CHRATR_OVERLINE');
    if (ul !== undefined && ul !== 'none') deco.push('underline');
    if (ol !== undefined && ol !== 'none') deco.push('overline');
    if (co) deco.push('line-through');
    if (deco.length) out.push(`text-decoration: ${deco.join(' ')}`);
    else if (ul === 'none' || co === false || ol === 'none') out.push('text-decoration: none');
    const cbg = get('RES_CHRATR_BACKGROUND');
    if (cbg !== undefined && !bPara) out.push(`background: ${cbg ?? 'transparent'}`);
    if (!bPara) return out;
    const lr = get('RES_LR_SPACE');
    if (lr) {
      out.push(`margin-left: ${pt(lr.left)}`, `margin-right: ${pt(lr.right)}`);
      if (lr.firstLine) out.push(`text-indent: ${pt(lr.firstLine)}`);
    }
    const ulsp = get('RES_UL_SPACE');
    if (ulsp) out.push(`margin-top: ${pt(ulsp.upper)}`, `margin-bottom: ${pt(ulsp.lower)}`);
    const ls = get('RES_PARATR_LINESPACING');
    if (ls) out.push(`line-height: ${SwHTMLWriter.LineHeight(ls)}`);
    const adj = get('RES_PARATR_ADJUST');
    if (adj) out.push(`text-align: ${adj === 'block' ? 'justify' : adj}`);
    const bg = get('RES_BACKGROUND');
    if (bg !== undefined) out.push(`background: ${bg ?? 'transparent'}`);
    const box = get('RES_BOX');
    if (box !== undefined) {
      const line = (l: SvxBorderLine | null) => (l ? `${pt(l.width)} solid ${l.color}` : 'none');
      if (box && box.top && box.bottom && box.left && box.right && line(box.top) === line(box.bottom) && line(box.top) === line(box.left) && line(box.top) === line(box.right)) out.push(`border: ${line(box.top)}`);
      else out.push(`border-top: ${line(box?.top ?? null)}`, `border-bottom: ${line(box?.bottom ?? null)}`, `border-left: ${line(box?.left ?? null)}`, `border-right: ${line(box?.right ?? null)}`);
      if (box?.padding) out.push(`padding: ${pt(box.padding)}`);
    }
    const brk = get('RES_BREAK');
    if (brk === 'page-before') out.push('page-break-before: always');
    else if (brk === 'page-after') out.push('page-break-after: always');
    if (get('RES_PAGEDESC')) out.push('page-break-before: always');
    if (get('RES_KEEP')) out.push('page-break-after: avoid');
    return out;
  }

  private static LineHeight(ls: SvxLineSpacing): string {
    return ls.rule === 'proportional' ? `${ls.value}%` : pt(ls.value);
  }

  /** The attributes of a style that differ from those of pRef (SubtractItemSet); all of them without pRef but the pool defaults. */
  private static StyleDiff(pFormat: SwFormat, pRef: SwFormat | null): <K extends keyof SwAttrs>(k: K) => SwAttrs[K] | undefined {
    return (k) => {
      const v = pFormat.GetFormatAttr(k);
      const ref = pRef ? pRef.GetFormatAttr(k) : POOL_DEFAULTS[k as keyof typeof POOL_DEFAULTS];
      return JSON.stringify(v) === JSON.stringify(ref) ? undefined : v;
    };
  }

  /** SwHTMLWriter::OutStyleSheet: @page, and a rule for each paragraph style in use. */
  private OutStyleSheet(): void {
    const desc = this.m_pDoc.m_aPageDesc;
    const rules: string[] = [];
    rules.push(`@page { size: ${pt(desc.nWidth)} ${pt(desc.nHeight)}; margin-left: ${pt(desc.nLeft)}; margin-right: ${pt(desc.nRight)}; margin-top: ${pt(desc.nTop)}; margin-bottom: ${pt(desc.nBottom)} }`);
    const done = new Set<string>();
    for (const coll of this.m_aUsedColls) {
      const info = this.GetFormatInfo(coll);
      // the tag style itself, then the derived class style
      const chain: [SwFormat, string, SwFormat | null][] = [];
      if (info.pRefFormat && info.aToken !== 'p') chain.push([info.pRefFormat, info.aToken, null]);
      else if (info.pRefFormat && info.pRefFormat.GetName() === 'Text Body') chain.push([info.pRefFormat, 'p', null]);
      if (info.nDeep > 0 && info.aClass && info.aClass !== 'sdfootnote' && info.aClass !== 'sdendnote') chain.push([coll, `${info.aToken}.${info.aClass}`, info.pRefFormat]);
      for (const [f, sel, ref] of chain) {
        if (done.has(sel)) continue;
        done.add(sel);
        const props = SwHTMLWriter.CSS1Props(SwHTMLWriter.StyleDiff(f, ref), true);
        if (props.length) rules.push(`${sel} { ${props.join('; ')} }`);
      }
    }
    this.OutNewLine();
    this.Strm('<style type="text/css">');
    this.m_nIndentLvl++;
    for (const r of rules) { this.OutNewLine(); this.Strm(r); }
    this.m_nIndentLvl--;
    this.OutNewLine();
    this.Strm('</style>');
  }

  // ---- the document ----

  /** SwHTMLWriter::MakeHeader */
  private MakeHeader(): void {
    this.Strm('<!DOCTYPE html>');
    this.OutNewLine();
    this.Strm('<html>');
    this.OutNewLine();
    this.Strm('<head>');
    this.m_nIndentLvl++;
    // SfxFrameHTMLWriter::Out_DocInfo
    const props = this.m_pDoc.m_xDocProps;
    this.OutNewLine();
    this.Strm('<meta http-equiv="content-type" content="text/html; charset=utf-8"/>');
    this.OutNewLine();
    this.Strm(`<title>${ConvertStringToHTML(props.getTitle())}</title>`);
    const meta = (name: string, content: string) => { if (content) { this.OutNewLine(); this.Strm(`<meta name="${name}" content="${ConvertStringToHTML(content, true)}"/>`); } };
    meta('generator', GetGeneratorString());
    meta('author', props.getAuthor());
    meta('created', props.getMetaText('meta:creation-date'));
    meta('changedby', props.getModifiedBy());
    meta('changed', props.getMetaText('dc:date'));
    meta('description', props.getDescription());
    meta('keywords', props.getKeywords().join(', '));
    meta('classification', props.getSubject());
    this.OutStyleSheet();
    this.m_nIndentLvl--;
    this.OutNewLine();
    this.Strm('</head>');
    this.OutNewLine();
    const dir = this.m_pDoc.FindTextFormatCollByName('Standard')?.GetFormatAttr('RES_FRAMEDIR') === 'rl-tb' ? 'rtl' : 'ltr';
    this.Strm(`<body lang="${ConvertStringToHTML(this.m_eLang, true)}" dir="${dir}">`);
  }

  /** SwHTMLWriter::WriteStream */
  WriteStream(): string {
    const nodes = this.m_pDoc.GetNodes();
    // Collect the styles first, for the style sheet.
    for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTextNode()) this.m_aUsedColls.add((n as SwTextNode).GetTextColl()); }
    this.MakeHeader();
    this.m_bLFPossible = true;
    const header = nodes.FindAreaSection(SwStartNodeType.SwHeaderStartNode, 'default', DEFAULT_PAGE_DESC);
    if (header) this.OutHTML_HeaderFooter(header.GetIndex(), true);
    // page anchored images before the text
    for (const f of this.m_pDoc.m_aPageFlys) if (f.graphic !== undefined) { this.OutNewLine(); this.Strm(`<p>${this.OutHTML_Image(f.graphic, f.m_nWidth, f.m_nHeight, f.m_aName, f.alt, f.m_sTitle)}</p>`); }
    this.Out_SwDoc(nodes.BodyStart(), nodes.GetEndOfContent().GetIndex());
    this.OutFootEndNotes();
    const footer = nodes.FindAreaSection(SwStartNodeType.SwFooterStartNode, 'default', DEFAULT_PAGE_DESC);
    if (footer) this.OutHTML_HeaderFooter(footer.GetIndex(), false);
    this.OutNewLine();
    this.Strm('</body>');
    this.OutNewLine();
    this.Strm('</html>');
    this.Strm(SAL_NEWLINE_STRING);
    return this.out.join('');
  }

  /** SwHTMLWriter::Out_SwDoc: the nodes of a range. */
  private Out_SwDoc(nStart: number, nEnd: number): void {
    const nodes = this.m_pDoc.GetNodes();
    for (let i = nStart; i < nEnd; i++) {
      const rNd = nodes.node(i);
      if (rNd.IsTextNode()) this.OutHTML_SwTextNode(rNd as SwTextNode);
      else if (rNd.IsTableNode()) {
        this.ChangeParaToken();
        this.OutListEnd(null);
        this.OutHTML_SwTableNode(rNd as SwTableNode);
        i = (rNd as SwTableNode).EndOfSectionNode().GetIndex();
      } else if (rNd.GetSectionNode()) {
        const sec = rNd.GetSectionNode() as SwSectionNode;
        if (sec.m_pSection.m_bHidden) { i = sec.EndOfSectionNode().GetIndex(); continue; }
        // OutHTML_Section: the section as a DIV with its name.
        this.ChangeParaToken();
        this.OutListEnd(null);
        this.OutNewLine();
        this.Strm(`<div id="${ConvertStringToHTML(sec.m_pSection.m_sSectionName, true)}">`);
        this.m_nIndentLvl++;
        this.Out_SwDoc(i + 1, sec.EndOfSectionNode().GetIndex());
        this.ChangeParaToken();
        this.OutListEnd(null);
        this.m_nIndentLvl--;
        this.OutNewLine();
        this.Strm('</div>');
        i = sec.EndOfSectionNode().GetIndex();
      }
    }
    this.ChangeParaToken();
    this.OutListEnd(null);
  }

  /** OutHTML_HeaderFooter: the paragraphs of the header or footer in a DIV with its TITLE. */
  private OutHTML_HeaderFooter(nStart: number, bHeader: boolean): void {
    const start = this.m_pDoc.GetNodes().node(nStart) as unknown as { EndOfSectionNode(): SwNode };
    this.OutNewLine();
    this.Strm(`<div title="${bHeader ? 'header' : 'footer'}">`);
    this.m_nIndentLvl++;
    this.Out_SwDoc(nStart + 1, start.EndOfSectionNode().GetIndex());
    this.m_nIndentLvl--;
    this.OutNewLine();
    this.Strm('</div>');
  }

  /** SwHTMLWriter::ChangeParaToken: closes an open PRE. */
  private ChangeParaToken(): void {
    if (this.m_bInPRE) { this.Strm('</pre>'); this.m_bInPRE = false; }
  }

  // ---- lists (htmlnumwriter.cxx) ----

  /** OutHTML_NumberBulletListEnd: closes the lists deeper than the next paragraph's (all for null). */
  private OutListEnd(next: NumInfo | null): void {
    const nKeep = next && next.rule === this.m_aNumInfo.rule ? Math.min(next.depth, this.m_aListTags.length) : 0;
    while (this.m_aListTags.length > nKeep) {
      if (this.m_aLiOpen.pop()) this.Strm('</li>');
      this.m_nIndentLvl--;
      this.OutNewLine();
      this.Strm(SwHTMLWriter.Tag(this.m_aListTags.pop()!, false));
    }
    if (!this.m_aListTags.length) this.m_aNumInfo = { rule: '', depth: 0 };
  }

  /** OutHTML_NumberBulletListStart: opens the lists down to the paragraph's level, and its LI. */
  private OutListStart(rNode: SwTextNode, num: SwNodeNum): void {
    const rule = num.rule.GetName();
    const depth = GetActualListLevel(rNode) + 1;
    if (rule !== this.m_aNumInfo.rule) this.OutListEnd(null);
    else this.OutListEnd({ rule, depth });
    while (this.m_aListTags.length < depth) {
      const nLvl = this.m_aListTags.length;
      const fmt = num.rule.Get(nLvl);
      const type = fmt.GetNumberingType();
      const bBullet = type === NumberingType.CHAR_SPECIAL || type === NumberingType.BITMAP || type === NumberingType.NUMBER_NONE;
      let sOut = bBullet ? 'ul' : 'ol';
      if (!bBullet) {
        const t = type === NumberingType.CHARS_UPPER_LETTER || type === NumberingType.CHARS_UPPER_LETTER_N ? 'A'
          : type === NumberingType.CHARS_LOWER_LETTER || type === NumberingType.CHARS_LOWER_LETTER_N ? 'a'
            : type === NumberingType.ROMAN_UPPER ? 'I' : type === NumberingType.ROMAN_LOWER ? 'i' : '';
        if (t) sOut += ` type="${t}"`;
        if (fmt.GetStart() !== 1) sOut += ` start="${fmt.GetStart()}"`;
      } else if (type === NumberingType.NUMBER_NONE) sOut += ' style="list-style-type: none"';
      // A deeper list goes into the item before it; without one, into an item of its own.
      if (this.m_aListTags.length && !this.m_aLiOpen[this.m_aLiOpen.length - 1]) {
        this.OutNewLine();
        this.Strm('<li style="display: block">');
        this.m_aLiOpen[this.m_aLiOpen.length - 1] = true;
      }
      this.OutNewLine();
      this.Strm(`<${sOut}>`);
      this.m_aListTags.push(bBullet ? 'ul' : 'ol');
      this.m_aLiOpen.push(false);
      this.m_nIndentLvl++;
    }
    this.m_aNumInfo = { rule, depth };
    if (num.counted) {
      if (this.m_aLiOpen[this.m_aLiOpen.length - 1]) this.Strm('</li>');
      this.OutNewLine();
      const bRestart = rNode.GetAttr('RES_PARATR_LIST_ISRESTART') && rNode.GetAttr('RES_PARATR_LIST_RESTARTVALUE') >= 0;
      this.Strm(bRestart ? `<li value="${rNode.GetAttr('RES_PARATR_LIST_RESTARTVALUE')}">` : '<li>');
      this.m_aLiOpen[this.m_aLiOpen.length - 1] = true;
    } else if (!this.m_aLiOpen[this.m_aLiOpen.length - 1]) {
      // Handles list headers (<text:list-header> ODF element)
      this.OutNewLine();
      this.Strm('<li style="display: block">');
      this.m_aLiOpen[this.m_aLiOpen.length - 1] = true;
    }
  }

  // ---- paragraphs (htmlatr.cxx) ----

  /** OutHTML_SwTextNode */
  private OutHTML_SwTextNode(rNode: SwTextNode): void {
    const nodes = this.m_pDoc.GetNodes();
    const coll = rNode.GetTextColl();
    const text = rNode.GetText();
    const num = this.nums.get(rNode);
    // Frames anchored to the paragraph come before it.
    for (const f of rNode.m_aAnchoredFlys) if (f.fmt.m_sContentId) this.OutHTML_FrameFormat(f.fmt);

    // An empty paragraph with the Horizontal Line style is <HR>.
    if (!text && coll.GetName() === 'Horizontal Line' && !num) {
      this.ChangeParaToken();
      this.OutListEnd(null);
      this.OutNewLine();
      this.Strm('<hr/>');
      return;
    }

    const info = this.GetFormatInfo(coll);
    if (num) { this.ChangeParaToken(); this.OutListStart(rNode, num); } else if (this.m_aListTags.length) { this.ChangeParaToken(); this.OutListEnd(null); }

    // The hard paragraph attributes, as far as they differ from the style.
    const own = (k: keyof SwAttrs) => {
      const v = (rNode.m_aSet as Record<string, unknown>)[k];
      if (v === undefined) return undefined;
      return JSON.stringify(v) === JSON.stringify(coll.GetFormatAttr(k)) ? undefined : v;
    };
    // Styles that are no tag style write their attributes as hard ones (relative to Text Body).
    const styleOwn = info.nDeep === 0 && info.pRefFormat === null ? SwHTMLWriter.StyleDiff(coll, this.m_pDoc.FindTextFormatCollByName('Text Body') ?? null) : null;
    const get = <K extends keyof SwAttrs>(k: K): SwAttrs[K] | undefined => {
      if (k.startsWith('RES_CHRATR_')) return styleOwn ? styleOwn(k) : undefined; // hard ones are text attributes
      const v = own(k) as SwAttrs[K] | undefined;
      return v !== undefined ? v : styleOwn ? styleOwn(k) : undefined;
    };
    const props = SwHTMLWriter.CSS1Props(get, true).filter((p) => !p.startsWith('text-align'));
    // In lists, the indents come from the list.
    const aProps = num ? props.filter((p) => !/^(margin-left|text-indent)/.test(p)) : props;
    const adjust = own('RES_PARATR_ADJUST') as string | undefined ?? (styleOwn ? styleOwn('RES_PARATR_ADJUST') : undefined);
    // NeedPreserveWhitespace: leading, trailing or repeated blanks and tabs.
    const bPre = info.aToken === 'pre';
    if (!bPre && /^[ \t]|[ \t]$| {2}|\t/.test(text.replaceAll(CH_TXTATR_BREAKWORD, 'x'))) aProps.push('white-space: pre-wrap');
    const lang = (rNode.m_aSet.RES_CHRATR_LANGUAGE !== undefined && rNode.m_aSet.RES_CHRATR_LANGUAGE !== this.m_eLang) ? rNode.m_aSet.RES_CHRATR_LANGUAGE : undefined;
    const dir = own('RES_FRAMEDIR');

    let sOpt = '';
    if (lang) sOpt += ` lang="${ConvertStringToHTML(lang, true)}"`;
    if (dir) sOpt += ` dir="${dir === 'rl-tb' ? 'rtl' : 'ltr'}"`;
    if (info.aClass) sOpt += ` class="${ConvertStringToHTML(info.aClass, true)}"`;
    if (adjust && !bPre) sOpt += ` align="${adjust === 'block' ? 'justify' : adjust}"`;
    if (aProps.length) sOpt += ` style="${ConvertStringToHTML(aProps.join('; '), true)}"`;

    if (bPre) {
      // Consecutive PRE paragraphs are lines of one PRE.
      if (this.m_bInPRE && !sOpt) this.Strm(SAL_NEWLINE_STRING);
      else {
        this.ChangeParaToken();
        this.OutNewLine();
        this.Strm(`<pre${sOpt}>`);
        this.m_bInPRE = true;
      }
      this.OutText(rNode, true);
      const next = nodes.node(rNode.GetIndex() + 1);
      const bNextPre = next.IsTextNode() && this.GetFormatInfo((next as SwTextNode).GetTextColl()).aToken === 'pre' && !this.nums.get(next as SwTextNode);
      if (!bNextPre) this.ChangeParaToken();
      return;
    }
    this.ChangeParaToken();
    if (!num) this.OutNewLine();
    this.Strm(`<${info.aToken}${sOpt}>`);
    // an empty paragraph keeps its height with a line break
    if (!this.OutText(rNode, false)) this.Strm('<br/>');
    this.Strm(SwHTMLWriter.Tag(info.aToken, false));
  }

  /** The text of a paragraph with its attributes (HTMLEndPosLst); whether there was any. */
  private OutText(rNode: SwTextNode, bPre: boolean): boolean {
    const text = rNode.GetText();
    const nEnd = text.length;
    const items: HTMLStartEndPos[] = [];
    // Paragraph character attributes span the text.
    const paraChar: SwCharAttrSet = {};
    for (const [k, v] of Object.entries(rNode.m_aSet)) if (k.startsWith('RES_CHRATR_') && k !== 'RES_CHRATR_LANGUAGE') (paraChar as Record<string, unknown>)[k] = v;
    if (nEnd) this.InsertItems(items, rNode, paraChar, 0, nEnd);
    // placeholders: images, footnotes, fields
    const atPos = new Map<number, string>();
    for (const h of rNode.m_aHints) {
      const a = h.aAttrs;
      if (a.RES_TXTATR_FLYCNT && h.nEnd - h.nStart === 1) {
        const fly = a.RES_TXTATR_FLYCNT;
        if (fly.graphic && !fly.math && !fly.shape) atPos.set(h.nStart, this.OutHTML_Image(fly.graphic, fly.width, fly.height, fly.name, fly.alt, fly.title));
        else atPos.set(h.nStart, '');
      } else if (a.RES_TXTATR_FTN) atPos.set(h.nStart, this.OutHTML_SwFormatFootnote(a.RES_TXTATR_FTN.id, !!a.RES_TXTATR_FTN.endnote));
      else if (a.RES_TXTATR_FIELD) atPos.set(h.nStart, SwHTMLWriter.OutHTML_SwFormatField(a.RES_TXTATR_FIELD));
      else if (a.RES_TXTATR_ANNOTATION) atPos.set(h.nStart, '');
      if (h.nEnd > h.nStart) this.InsertItems(items, rNode, a, h.nStart, Math.min(h.nEnd, nEnd));
    }
    // Images anchored to the paragraph, at their position.
    const flyAt = new Map<number, string>();
    for (const f of rNode.m_aAnchoredFlys) {
      if (f.fmt.graphic === undefined) continue;
      const align = f.fmt.m_aHoriOrient.m_eOrient === HoriOrientation.RIGHT ? 'right' : f.fmt.m_aHoriOrient.m_eOrient === HoriOrientation.LEFT ? 'left' : '';
      const p = Math.min(f.nContent, nEnd);
      flyAt.set(p, (flyAt.get(p) ?? '') + this.OutHTML_Image(f.fmt.graphic, f.fmt.m_nWidth, f.fmt.m_nHeight, f.fmt.m_aName, f.fmt.alt, f.fmt.m_sTitle, align));
    }
    const marks = this.m_aBookmarks.get(rNode) ?? [];

    // positions where markup changes
    const cuts = new Set<number>([0, nEnd]);
    for (const it of items) { cuts.add(it.nStart); cuts.add(it.nEnd); }
    for (const p of [...atPos.keys(), ...flyAt.keys(), ...marks.map((m) => m.pos)]) { cuts.add(p); if (p < nEnd) cuts.add(p + 1); }
    const order = [...cuts].filter((c) => c >= 0 && c <= nEnd).sort((a, b) => a - b);
    const open: HTMLStartEndPos[] = [];
    let bAny = false;
    for (let k = 0; k < order.length; k++) {
      const pos = order[k]!;
      // OutEndAttrs: close what ends here, and reopen what was opened after it but goes on.
      const ending = open.filter((o) => o.nEnd <= pos);
      if (ending.length) {
        const nFirst = Math.min(...ending.map((e) => open.indexOf(e)));
        const reopen = open.slice(nFirst).filter((o) => o.nEnd > pos);
        for (let i = open.length - 1; i >= nFirst; i--) this.Strm(open[i]!.sOff);
        open.length = nFirst;
        for (const o of reopen) { this.Strm(o.sOn); open.push(o); }
      }
      // bookmarks and paragraph anchored images at this position
      for (const m of marks) if (m.pos === pos) { this.Strm(`<a name="${ConvertStringToHTML(m.name, true)}"></a>`); }
      const fly = flyAt.get(pos);
      if (fly) { this.Strm(fly); bAny = true; }
      if (pos === nEnd) break;
      // OutStartAttrs: the longest first, then by priority
      const starting = items.filter((it) => it.nStart === pos).sort((a, b) => b.nEnd - a.nEnd || a.nPrio - b.nPrio);
      for (const s of starting) { this.Strm(s.sOn); open.push(s); }
      const next = order[k + 1]!;
      let chunk = '';
      for (let i = pos; i < next; i++) {
        const c = text[i]!;
        if (c === CH_TXTATR_BREAKWORD) { chunk += atPos.get(i) ?? ''; continue; }
        if (c === '\n') chunk += bPre ? SAL_NEWLINE_STRING : '<br/>';
        else chunk += ConvertStringToHTML(c);
      }
      if (chunk) bAny = true;
      this.Strm(chunk);
    }
    for (let i = open.length - 1; i >= 0; i--) this.Strm(open[i]!.sOff);
    return bAny;
  }

  /** HTMLEndPosLst::Insert: the markup of the attributes of a range (aHTMLAttrFnTab). */
  private InsertItems(items: HTMLStartEndPos[], rNode: SwTextNode, a: SwCharAttrSet, nStart: number, nEnd: number): void {
    if (nEnd <= nStart) return;
    const add = (sOn: string, sOff: string, nPrio: number) => items.push({ nStart, nEnd, sOn, sOff, nPrio });
    const coll = rNode.GetTextColl();
    // the value the paragraph gives the text, which a hint changes
    const base = <K extends keyof SwAttrs>(k: K): SwAttrs[K] => ((rNode.m_aSet as Record<string, unknown>)[k] as SwAttrs[K] | undefined) ?? coll.GetFormatAttr(k);
    if (a.RES_TXTATR_INETFMT) add(`<a href="${ConvertStringToHTML(a.RES_TXTATR_INETFMT, true)}">`, '</a>', 0);
    const r: SwRedlineData | null | undefined = a.RES_TXTATR_REDLINE;
    if (r && (r.type === 'Insert' || r.type === 'Delete')) {
      const tag = r.type === 'Insert' ? 'ins' : 'del';
      add(`<${tag}${r.author ? ` title="${ConvertStringToHTML(`Author: ${r.author}`, true)}"` : ''}${r.date ? ` datetime="${ConvertStringToHTML(r.date, true)}"` : ''}>`, `</${tag}>`, 1);
    }
    const cf = a.RES_TXTATR_CHARFMT;
    if (cf) {
      // OutHTML_SwTextCharFormat: the tag of an HTML character style, else SPAN with the style's attributes
      const tag = CHAR_TOKENS[cf.GetName()];
      if (tag) add(`<${tag}>`, `</${tag}>`, 2);
      else {
        const props = SwHTMLWriter.CSS1Props(SwHTMLWriter.StyleDiff(cf, null), false);
        if (props.length) add(`<span class="${ConvertStringToHTML(cf.GetName().toLowerCase().replace(/[. _]/g, '-'), true)}" style="${ConvertStringToHTML(props.join('; '), true)}">`, '</span>', 2);
      }
    }
    if (a.RES_CHRATR_FONT !== undefined && a.RES_CHRATR_FONT !== base('RES_CHRATR_FONT')) add(`<font face="${ConvertStringToHTML(a.RES_CHRATR_FONT, true)}">`, '</font>', 3);
    if (a.RES_CHRATR_FONTSIZE !== undefined && a.RES_CHRATR_FONTSIZE !== base('RES_CHRATR_FONTSIZE')) {
      // OutHTML_SvxFontHeight: the HTML size, and the exact one as STYLE
      const nHeight = a.RES_CHRATR_FONTSIZE;
      let nSize = 1;
      for (let i = 6; i > 0; i--) if (nHeight > (aFontHeights[i]! + aFontHeights[i - 1]!) / 2) { nSize = i + 1; break; }
      add(`<font size="${nSize}" style="font-size: ${pt(nHeight)}">`, '</font>', 4);
    }
    if (a.RES_CHRATR_COLOR !== undefined && a.RES_CHRATR_COLOR !== base('RES_CHRATR_COLOR')) add(`<font color="${a.RES_CHRATR_COLOR ?? '#000000'}">`, '</font>', 5);
    if (a.RES_CHRATR_WEIGHT !== undefined && a.RES_CHRATR_WEIGHT !== base('RES_CHRATR_WEIGHT')) add(a.RES_CHRATR_WEIGHT ? '<b>' : '<span style="font-weight: normal">', a.RES_CHRATR_WEIGHT ? '</b>' : '</span>', 6);
    if (a.RES_CHRATR_POSTURE !== undefined && a.RES_CHRATR_POSTURE !== base('RES_CHRATR_POSTURE')) add(a.RES_CHRATR_POSTURE ? '<i>' : '<span style="font-style: normal">', a.RES_CHRATR_POSTURE ? '</i>' : '</span>', 7);
    if (a.RES_CHRATR_UNDERLINE !== undefined && a.RES_CHRATR_UNDERLINE !== base('RES_CHRATR_UNDERLINE')) add(a.RES_CHRATR_UNDERLINE !== 'none' ? '<u>' : '<span style="text-decoration: none">', a.RES_CHRATR_UNDERLINE !== 'none' ? '</u>' : '</span>', 8);
    if (a.RES_CHRATR_CROSSEDOUT !== undefined && a.RES_CHRATR_CROSSEDOUT !== base('RES_CHRATR_CROSSEDOUT') && a.RES_CHRATR_CROSSEDOUT) add('<strike>', '</strike>', 9);
    if (a.RES_CHRATR_ESCAPEMENT !== undefined && a.RES_CHRATR_ESCAPEMENT !== base('RES_CHRATR_ESCAPEMENT') && a.RES_CHRATR_ESCAPEMENT) add(a.RES_CHRATR_ESCAPEMENT > 0 ? '<sup>' : '<sub>', a.RES_CHRATR_ESCAPEMENT > 0 ? '</sup>' : '</sub>', 10);
    // The attributes without a tag go into a SPAN's STYLE (OutHTML_CSS1Attr).
    const css: string[] = [];
    if (a.RES_CHRATR_BACKGROUND !== undefined && a.RES_CHRATR_BACKGROUND !== base('RES_CHRATR_BACKGROUND')) css.push(`background: ${a.RES_CHRATR_BACKGROUND ?? 'transparent'}`);
    if (a.RES_CHRATR_CASEMAP !== undefined && a.RES_CHRATR_CASEMAP !== base('RES_CHRATR_CASEMAP')) css.push(a.RES_CHRATR_CASEMAP === 'smallcaps' ? 'font-variant: small-caps' : `text-transform: ${a.RES_CHRATR_CASEMAP}`);
    if (a.RES_CHRATR_OVERLINE !== undefined && a.RES_CHRATR_OVERLINE !== 'none' && a.RES_CHRATR_OVERLINE !== base('RES_CHRATR_OVERLINE')) css.push('text-decoration: overline');
    if (a.RES_CHRATR_SHADOWED && !base('RES_CHRATR_SHADOWED')) css.push('text-shadow: 1px 1px 1px #666666');
    if (a.RES_CHRATR_BOX && !base('RES_CHRATR_BOX')) css.push(`border: ${pt(a.RES_CHRATR_BOX.width)} solid ${a.RES_CHRATR_BOX.color}`);
    if (css.length) add(`<span style="${ConvertStringToHTML(css.join('; '), true)}">`, '</span>', 11);
    if (a.RES_CHRATR_LANGUAGE !== undefined && a.RES_CHRATR_LANGUAGE !== base('RES_CHRATR_LANGUAGE')) add(`<span lang="${ConvertStringToHTML(a.RES_CHRATR_LANGUAGE, true)}">`, '</span>', 12);
  }

  /** OutHTML_Image (htmlflywriter.cxx) with EmbedImages: the graphic as a data: URL. */
  private OutHTML_Image(graphic: string, nWidth: number, nHeight: number, name: string, alt?: string, title?: string, align = ''): string {
    const g = this.m_pDoc.m_aGraphics.get(graphic);
    if (!g) return '';
    let s = `<img src="data:${g.mime};base64,${base64(g.data)}" name="${ConvertStringToHTML(name, true)}" alt="${ConvertStringToHTML(alt ?? '', true)}"`;
    if (title) s += ` title="${ConvertStringToHTML(title, true)}"`;
    if (align) s += ` align="${align}"`;
    s += ` width="${ToPixel(nWidth)}" height="${ToPixel(nHeight)}" border="0"/>`;
    return s;
  }

  /** A text frame anchored to the paragraph: its paragraphs in a DIV (htmlflywriter.cxx, reduced). */
  private OutHTML_FrameFormat(f: SwFlyFrameFormat): void {
    const sec = this.m_pDoc.GetNodes().FindFlySection(f.m_sContentId!);
    if (!sec) return;
    this.ChangeParaToken();
    this.OutListEnd(null);
    this.OutNewLine();
    const align = f.m_aHoriOrient.m_eOrient === HoriOrientation.RIGHT ? 'right' : f.m_aHoriOrient.m_eOrient === HoriOrientation.LEFT ? 'left' : '';
    this.Strm(`<div id="${ConvertStringToHTML(f.m_aName, true)}" style="width: ${pt(f.m_nWidth)}${align ? `; float: ${align}` : ''}">`);
    this.m_nIndentLvl++;
    this.Out_SwDoc(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex());
    this.m_nIndentLvl--;
    this.OutNewLine();
    this.Strm('</div>');
  }

  /** OutHTML_SwFormatField: a field's text; page numbers and counts as SDFIELD, which upstream reads back. */
  private static OutHTML_SwFormatField(f: SwField): string {
    const text = ConvertStringToHTML(DefaultExpand(f) ?? '');
    if (f.type === 'PageNumber' && f.fixed === undefined) return `<sdfield type=PAGE subtype=RANDOM format=PAGE>${text}</sdfield>`;
    if (f.type === 'PageCount' && f.fixed === undefined) return `<sdfield type=DOCSTAT subtype=PAGE format=PAGE>${text}</sdfield>`;
    return text;
  }

  // ---- footnotes (htmlftn.cxx) ----

  /** OutHTML_SwFormatFootnote: the anchor, linked to the note at the end. */
  private OutHTML_SwFormatFootnote(id: string, bEndNote: boolean): string {
    const nNo = bEndNote ? ++this.m_nEndNote : ++this.m_nFootNote;
    this.m_aFootEndNotes.push({ id, endnote: bEndNote, nNo });
    const sClass = bEndNote ? 'sdendnoteanc' : 'sdfootnoteanc';
    const sName = `${bEndNote ? 'sdendnote' : 'sdfootnote'}${nNo}`;
    const sLabel = bEndNote ? SwHTMLWriter.Roman(nNo) : String(nNo);
    return `<a class="${sClass}" name="${sName}anc" href="#${sName}sym"><sup>${sLabel}</sup></a>`;
  }

  /** The endnotes are numbered i, ii, iii (SwEndNoteInfo's default). */
  private static Roman(n: number): string {
    const r: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [v, c] of r) while (n >= v) { s += c; n -= v; }
    return s;
  }

  /** SwHTMLWriter::OutFootEndNotes: the notes, each a DIV with its paragraphs, the first starting with its number. */
  private OutFootEndNotes(): void {
    const nodes = this.m_pDoc.GetNodes();
    // footnotes first, then endnotes
    const notes = [...this.m_aFootEndNotes.filter((n) => !n.endnote), ...this.m_aFootEndNotes.filter((n) => n.endnote)];
    for (const n of notes) {
      const sec = nodes.FindFootnoteSection(n.id);
      if (!sec) continue;
      const sName = `${n.endnote ? 'sdendnote' : 'sdfootnote'}${n.nNo}`;
      this.OutNewLine();
      this.Strm(`<div id="${sName}">`);
      this.m_nIndentLvl++;
      const nStart = this.out.length;
      this.Out_SwDoc(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex());
      // The number goes at the start of the first paragraph (OutFootEndNoteSym).
      const sym = `<a class="${n.endnote ? 'sdendnotesym' : 'sdfootnotesym'}" name="${sName}sym" href="#${sName}anc">${n.endnote ? SwHTMLWriter.Roman(n.nNo) : n.nNo}</a>`;
      for (let i = nStart; i < this.out.length; i++) {
        const m = /^<(p|h[1-6]|pre|blockquote|address|dt|dd)\b[^>]*>/.exec(this.out[i]!);
        if (m) {
          const rest = this.out[i + 1] === '<br/>' ? 2 : 1;
          this.out.splice(i + 1, rest === 2 ? 1 : 0, sym);
          break;
        }
      }
      this.m_nIndentLvl--;
      this.OutNewLine();
      this.Strm('</div>');
    }
  }

  // ---- tables (htmltabw.cxx) ----

  /** OutHTML_SwTableNode */
  private OutHTML_SwTableNode(rTableNd: SwTableNode): void {
    const table = rTableNd.m_pTable;
    const attrs = table.GetFrameFormat();
    const lines = table.GetTabLines();
    // The column grid: the box borders of all rows (SwWriteTable's columns).
    const rowEdges = lines.map((l) => {
      let x = 0;
      const sum = l.m_aBoxes.reduce((s, b) => s + b.m_aAttrs.width, 0) || 1;
      return l.m_aBoxes.map((b) => { const s = x; x += b.m_aAttrs.width; return { box: b, s: s / sum, e: x / sum }; });
    });
    const edges = [...new Set(rowEdges.flatMap((r) => r.flatMap((c) => [Math.round(c.s * 10000), Math.round(c.e * 10000)])))].sort((a, b) => a - b);
    const desc = this.m_pDoc.m_aPageDesc;
    const nAvail = desc.nWidth - desc.nLeft - desc.nRight;
    const nTableWidth = attrs.adjust === 'full' ? nAvail : attrs.relWidth ? Math.round(nAvail * attrs.relWidth / 100) : attrs.width || nAvail;
    const colWidths = edges.slice(1).map((e, i) => ToPixel(Math.round((e - edges[i]!) / 10000 * nTableWidth)));

    let sOut = '<table';
    sOut += attrs.adjust === 'full' ? ' width="100%"' : attrs.relWidth ? ` width="${attrs.relWidth}%"` : ` width="${ToPixel(nTableWidth)}"`;
    if (attrs.adjust === 'center' || attrs.adjust === 'right') sOut += ` align="${attrs.adjust}"`;
    const firstBox = lines[0]?.m_aBoxes[0];
    sOut += ` cellpadding="${ToPixel(firstBox?.m_aAttrs.padding ?? 0)}" cellspacing="0">`;
    this.OutNewLine();
    this.Strm(sOut);
    this.m_nIndentLvl++;
    for (const w of colWidths) { this.OutNewLine(); this.Strm(`<col width="${w}"/>`); }
    const nHead = table.GetRowsToRepeat();
    lines.forEach((line, nRow) => {
      if (nHead && nRow === 0) { this.OutNewLine(); this.Strm('<thead>'); }
      if (nHead && nRow === nHead) { this.OutNewLine(); this.Strm('<tbody>'); }
      this.OutNewLine();
      this.Strm(line.m_aAttrs.minHeight ? `<tr height="${ToPixel(line.m_aAttrs.minHeight)}">` : '<tr>');
      this.m_nIndentLvl++;
      for (const c of rowEdges[nRow]!) {
        const box = c.box;
        if (box.getRowSpan() < 1) continue;
        const nFirst = edges.indexOf(Math.round(c.s * 10000)), nLast = edges.indexOf(Math.round(c.e * 10000));
        this.OutTableCell(box, nLast - nFirst, colWidths.slice(nFirst, nLast).reduce((a, b) => a + b, 0));
      }
      this.m_nIndentLvl--;
      this.OutNewLine();
      this.Strm('</tr>');
      if (nHead && nRow === nHead - 1) { this.OutNewLine(); this.Strm('</thead>'); }
    });
    if (nHead && lines.length > nHead) { this.OutNewLine(); this.Strm('</tbody>'); }
    this.m_nIndentLvl--;
    this.OutNewLine();
    this.Strm('</table>');
  }

  /** SwHTMLWrtTable::OutTableCell */
  private OutTableCell(box: SwTableBox, nColSpan: number, nWidth: number): void {
    const nodes = this.m_pDoc.GetNodes();
    const start = box.m_pStartNode!;
    const first = nodes.node(start.GetIndex() + 1);
    // a cell is a header cell when its paragraph has the table heading style
    const bHead = first.IsTextNode() && (first as SwTextNode).GetTextColl().GetName() === 'Table Heading';
    const tag = bHead ? 'th' : 'td';
    const a = box.m_aAttrs;
    let sOut = `<${tag}`;
    if (nColSpan > 1) sOut += ` colspan="${nColSpan}"`;
    if (box.getRowSpan() > 1) sOut += ` rowspan="${box.getRowSpan()}"`;
    sOut += ` width="${nWidth}"`;
    if (a.vertOrient) sOut += ` valign="${a.vertOrient === 'center' ? 'middle' : 'bottom'}"`;
    if (a.background) sOut += ` bgcolor="${a.background}"`;
    const line = (l: SvxBorderLine | null) => (l ? `${pt(l.width)} solid ${l.color}` : 'none');
    const b = a.box;
    const css: string[] = [];
    if (line(b.top) === line(b.bottom) && line(b.top) === line(b.left) && line(b.top) === line(b.right)) css.push(`border: ${line(b.top)}`);
    else css.push(`border-top: ${line(b.top)}`, `border-bottom: ${line(b.bottom)}`, `border-left: ${line(b.left)}`, `border-right: ${line(b.right)}`);
    css.push(`padding: ${a.dist ? `${pt(a.dist.top)} ${pt(a.padding)} ${pt(a.dist.bottom)}` : pt(a.padding)}`);
    sOut += ` style="${css.join('; ')}">`;
    this.OutNewLine();
    this.Strm(sOut);
    this.m_nIndentLvl++;
    this.Out_SwDoc(start.GetIndex() + 1, start.EndOfSectionNode().GetIndex());
    this.m_nIndentLvl--;
    this.OutNewLine();
    this.Strm(`</${tag}>`);
  }
}

/** SwHTMLWriter::WriteStream for the whole document. */
export function ExportHTML(doc: SwDoc): string {
  return new SwHTMLWriter(doc).WriteStream();
}

