// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/html/swhtml.cxx reduced
// @upstream sw/source/filter/html/swhtml.hxx reduced
// @upstream sw/source/filter/html/htmlctxt.cxx reduced
// @upstream sw/source/filter/html/htmlnumreader.cxx reduced
// @upstream sw/source/filter/html/htmltab.cxx reduced
// @upstream sw/source/filter/html/htmlgrin.cxx reduced
// @upstream sw/source/filter/html/htmlcss1.cxx reduced
// @upstream sw/source/filter/html/htmlftn.cxx reduced
// HTML import: SwHTMLParser builds a new document from HTMLParser's tokens. Paragraphs and
// headings, PRE/LISTING/XMP, BLOCKQUOTE, ADDRESS, CENTER and DIV, definition lists, bulleted and
// numbered lists (TYPE, START, VALUE), tables (with COLSPAN, ROWSPAN, CAPTION, header cells,
// widths, borders, cell padding and backgrounds), character formatting (B, I, U, S, SUP, SUB,
// FONT, BIG, SMALL, SPAN and the HTML character styles EM, STRONG, CODE, ...), hyperlinks,
// bookmarks (A NAME, ID), line breaks, horizontal rules, images given as data: URLs, CSS (the
// properties of svxcss1.ts in STYLE options and style sheets; tag rules change the paragraph
// styles, class rules make "<style>.<class>" styles as upstream does), the title and META
// properties, and LibreOffice's own markup for footnotes, endnotes, headers, footers and the
// page number and count fields (SDFIELD; other fields stay text).
// Differences: attributes are kept on a context stack and applied to the text as it is inserted
// (upstream: the attribute table with its start and end positions); paragraph spacing comes from
// the styles (upstream's AM_SPACE/AM_NOSPACE adjustments are reduced to lists); images are always
// anchored as characters (ALIGN=LEFT/RIGHT and CSS float are not ported); DIVs do not become
// sections; @page sets the size and margins of the default page style. Not ported and reported as
// lost: linked images (their description links to them), forms (their text is kept), scripts,
// comments, frames and embedded objects, image maps.
import { SwDoc } from '../../../inc/doc.ts';
import { CH_TXTATR_BREAKWORD, type SvxULSpace, type SwAttrSet, type SwCharAttrSet } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwCharFormat, SwTextFormatColl } from '../../../inc/format.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule, numfunc } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { DetectGraphic } from '../../../../vcl/source/filter/GraphicFormatDetector.ts';
import { SwEndNode, SwStartNode, SwTableNode } from '../../../inc/node.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { DEFAULT_PAGE_DESC } from '../../../inc/pagedesc.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SwTableAdjust, type SwTableBoxAttrs } from '../../../inc/swtable.ts';
import { SwPosition } from '../../../inc/pam.ts';
import { MarkType } from '../../core/doc/docbm.ts';
import { HTMLParser, GetEncodingFromMeta, type HTMLOptions } from '../../../../svtools/source/svhtml/parhtml.ts';
import { HtmlTokenId, isOffToken, getOnToken } from '../../../../include/svtools/htmltokn.ts';
import { aFontHeights, GetBoxItem, GetColor, GetLength, ParseDeclarations, ParseProperties, ParseStyleSheet, type CSS1Rule, type SvxCSS1PropertyInfo } from './svxcss1.ts';
import type { ImportResult } from '../xml/odt.ts';

/** htmlnum.hxx */
const HTML_NUMBER_BULLET_MARGINLEFT = 709;
const HTML_NUMBER_BULLET_INDENT = -283;
/** swhtml.hxx: HTML_PARSPACE, o3tl::toTwips(5, mm) */
const HTML_PARSPACE = 283;
/** HTML_DFLT_IMG_WIDTH and HTML_DFLT_IMG_HEIGHT in pixels, for images of unknown size. */
const HTML_DFLT_IMG_WIDTH = 555, HTML_DFLT_IMG_HEIGHT = 555;
const CHAR_HARDBLANK = '\u00a0';

/** HTMLAttrContext: what an open element sets, and what to undo when it ends. */
interface HTMLAttrContext {
  nToken: HtmlTokenId;
  /** The paragraph style the element sets (GetTextFormatColl), with its class. */
  aColl?: string;
  aClass?: string;
  /** The style of paragraphs inside it that set none (table cells: GetDefaultTextFormatColl). */
  aDfltColl?: string;
  /** Character attributes: of the text inside an inline element, of the paragraphs inside a block. */
  aChar?: SwCharAttrSet;
  /** Hard paragraph attributes (ALIGN, STYLE). */
  aPara?: SwAttrSet;
  /** Paragraph indents added by the element (IsLRSpaceChanged, GetMargins). */
  nLeft?: number; nRight?: number; nFirstLine?: number;
  /** Space above and below the element's paragraphs (SetULSpace). */
  nUpper?: number; nLower?: number;
  /** A block element: its paragraphs end with it. */
  bBlock?: boolean;
  /** A list (UL, OL, DIR, MENU) or definition list. */
  bList?: boolean; bDefList?: boolean;
  /** The list style to go back to at the end of a list of the other type (SetSavedNumRule). */
  oSavedNumRule?: { rule: SwNumRule; levels: Set<number> };
  /** An element whose text is not inserted (the footnote marks, TITLE, ...). */
  bIgnoreText?: boolean;
  /** Insertion point to restore when the element ends (table cells, footnote bodies, header and footer). */
  oSaved?: { end: SwEndNode; cur: SwTextNode };
  /** The name of an element that has no token (HTML5_BLOCKS). */
  aTagName?: string;
  /** white-space: pre-wrap: blanks and line feeds of the source are text. */
  bPreserveSpaces?: boolean;
}

/** SwHTMLNumRuleInfo: the list being read. */
class SwHTMLNumRuleInfo {
  m_pNumRule: SwNumRule | null = null;
  m_nDeep = 0;
  m_aNumStarts: (number | null)[] = Array(MAXLEVEL).fill(null);
  m_aSetLevels = new Set<number>();
  GetLevel(): number { return Math.max(0, Math.min(this.m_nDeep, MAXLEVEL) - 1); }
  Clear(): void { this.m_pNumRule = null; this.m_nDeep = 0; this.m_aNumStarts.fill(null); this.m_aSetLevels.clear(); }
}

/** HTMLTable, reduced to what the token stream needs: rows of boxes, then widths at the end. */
interface HTMLTable {
  tableNode: SwTableNode;
  table: SwTable;
  tableEnd: SwEndNode;
  /** Columns spanned by each box, per row. */
  spans: Map<SwTableBox, number>;
  /** The boxes whose bottom line is the table's BORDER (only the last row keeps it). */
  borderBoxes: Set<SwTableBox>;
  line: SwTableLine | null;
  nCol: number;
  /** Rows a cell still covers, per column, with its column span. */
  vmerge: { left: number; span: number }[];
  /** COL widths (twips, or negative for percent), CELLPADDING, BORDER and the first row's widths. */
  colWidths: number[];
  nCellPadding: number;
  nBorder: number;
  nWidth: number; bWidthPercent: boolean;
  bInHead: boolean;
  /** The paragraph after the table, the insertion end and the contexts around it. */
  saved: { end: SwEndNode; cur: SwTextNode };
  nContextDepth: number;
  /** The cell context open, if any. */
  bCell: boolean;
  aBackground: string | null;
}

class SwHTMLParser extends HTMLParser {
  readonly m_xDoc = new SwDoc();
  readonly lost = new Set<string>();
  private readonly nodes = this.m_xDoc.GetNodes();
  /** The paragraph text goes into, always the last paragraph before m_pEnd. */
  private cur: SwTextNode;
  /** The end of the section being filled (the body, a table cell, a footnote, a header). */
  private m_pEnd: SwEndNode;
  private m_aContexts: HTMLAttrContext[] = [];
  private m_aNumRuleInfo = new SwHTMLNumRuleInfo();
  private m_aTables: HTMLTable[] = [];
  private m_aStyleRules: CSS1Rule[] = [];
  private m_aStyleSource = '';
  private m_sTitle = '';
  private m_bInTitle = false;
  /** Text read inside the current anchor before its HREF applies (empty anchors become bookmarks). */
  private m_aFootnotes = new Map<string, string>();
  /** The footnote placeholder inserted by the current SDFOOTNOTEANC anchor. */
  private m_bInFootEndNoteAnchor = false;
  private m_bInFootEndNoteSymbol = false;
  /** Inside an SDFIELD that became a field. */
  private m_bInField = false;
  /**
   * The bookmarks, made when the text is complete: a mark at the end of a paragraph would move
   * with the text inserted there.
   */
  private m_aBookmarks: { name: string; node: SwTextNode; pos: number }[] = [];
  /** The list paragraphs whose spacing below AppendTextNode removed, with what they had (AM_NOSPACE). */
  private m_aNoSpaceParas = new Map<SwTextNode, SvxULSpace | undefined>();
  /** The captions waiting for their table. */
  private m_nCaptionDepth = -1;

  constructor(rIn: string) {
    super(rIn);
    this.cur = this.nodes.FirstTextNode();
    this.m_pEnd = this.nodes.GetEndOfContent();
  }

  // ---- styles (SwCSS1Parser) ----

  private coll(name: string): SwTextFormatColl {
    let c = this.m_xDoc.FindTextFormatCollByName(name);
    if (c) return c;
    // The HTML pool styles the default document lacks (RES_POOLCOLL_HTML_DD and _DT, SEND_ADDRESS).
    const standard = this.m_xDoc.FindTextFormatCollByName('Standard')!;
    switch (name) {
      case 'List Contents': c = this.m_xDoc.MakeColl(name, standard, { RES_LR_SPACE: { left: 567, right: 0, firstLine: 0 } }); break;
      case 'List Heading': c = this.m_xDoc.MakeColl(name, standard); break;
      case 'Sender': c = this.m_xDoc.MakeColl(name, standard, { RES_CHRATR_POSTURE: true, RES_UL_SPACE: { upper: 0, lower: 0 } }); break;
      default: return this.m_xDoc.FindTextFormatCollByName('Text Body')!;
    }
    return c;
  }

  /** The script classes of LibreOffice's export (western, cjk, ctl) are no classes (GetScriptFromClass). */
  private static ClassOf(aClass: string): string {
    const c = aClass.trim().split(/\s+/)[0] ?? '';
    return /^(western|cjk|ctl)$/i.test(c) ? '' : c.replace(/-(western|cjk|ctl)$/i, '');
  }

  /** SwCSS1Parser::GetTextFormatColl: the style, or its "<style>.<class>" style made from the class rules. */
  private GetTextFormatColl(name: string, aClass: string, aTag: string): SwTextFormatColl {
    const base = this.coll(name);
    const c = SwHTMLParser.ClassOf(aClass);
    if (!c) return base;
    // sdfootnote and sdendnote are the footnote and endnote styles.
    if (/^sdfootnote$/i.test(c)) return this.coll('Footnote');
    if (/^sdendnote$/i.test(c)) return this.coll('Endnote');
    const aName = `${base.GetName()}.${c}`;
    let coll = this.m_xDoc.FindTextFormatCollByName(aName);
    if (!coll) {
      const set: SwAttrSet = {};
      this.ApplyRules((sel) => sel.aClass.toLowerCase() === c.toLowerCase() && (!sel.aToken || sel.aToken === aTag), set);
      coll = this.m_xDoc.MakeColl(aName, base, set);
    }
    return coll;
  }

  /** The declarations of the style sheet's rules matching a selector, as attributes. */
  private ApplyRules(match: (sel: { aToken: string; aClass: string; aId: string }) => boolean, set: SwAttrSet): SvxCSS1PropertyInfo {
    const info: SvxCSS1PropertyInfo = {};
    for (const r of this.m_aStyleRules) if (r.aSelectors.some(match)) ParseProperties(r.aDecls, set, info);
    SwHTMLParser.MergeInfo(set, info);
    return info;
  }

  /** The margins, indent and borders of a SvxCSS1PropertyInfo as attributes. */
  private static MergeInfo(set: SwAttrSet, info: SvxCSS1PropertyInfo, lr = set.RES_LR_SPACE, ul = set.RES_UL_SPACE): void {
    if (info.nLeftMargin !== undefined || info.nRightMargin !== undefined || info.nTextIndent !== undefined) {
      set.RES_LR_SPACE = { left: info.nLeftMargin ?? lr?.left ?? 0, right: info.nRightMargin ?? lr?.right ?? 0, firstLine: info.nTextIndent ?? lr?.firstLine ?? 0 };
    }
    if (info.nTopMargin !== undefined || info.nBottomMargin !== undefined) set.RES_UL_SPACE = { upper: info.nTopMargin ?? ul?.upper ?? 0, lower: info.nBottomMargin ?? ul?.lower ?? 0 };
    const box = GetBoxItem(info);
    if (box !== undefined) set.RES_BOX = box;
  }

  /** The tag rules of the style sheet change the HTML pool styles (SwCSS1Parser::StyleParsed). */
  private ApplyStyleSheet(): void {
    const styles: [string, string][] = [
      ['p', 'Text Body'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'],
      ['pre', 'Preformatted Text'], ['blockquote', 'Quotations'], ['address', 'Sender'], ['dd', 'List Contents'], ['dt', 'List Heading'],
      ['td', 'Table Contents'], ['th', 'Table Heading'], ['body', 'Standard'],
    ];
    for (const [tag, name] of styles) {
      const set: SwAttrSet = {};
      const coll = this.coll(name);
      this.ApplyRules((sel) => sel.aToken === tag && !SwHTMLParser.ClassOf(sel.aClass) && !sel.aId, set);
      if (!Object.keys(set).length) continue;
      // The background of a style sheet's paragraph is its paragraph background.
      if (set.RES_BACKGROUND === null) delete set.RES_BACKGROUND;
      coll.m_aSet = { ...coll.m_aSet, ...set };
    }
    // Rules for the HTML character styles.
    for (const [tag, name] of Object.entries(CHAR_STYLES)) {
      const set: SwAttrSet = {};
      this.ApplyRules((sel) => sel.aToken === tag && !sel.aClass && !sel.aId, set);
      const chars = SwHTMLParser.CharsOf(set);
      if (Object.keys(chars).length) { const f = this.GetCharFormat(name); f.m_aSet = { ...f.m_aSet, ...chars }; }
    }
    this.ApplyPageRule();
  }

  /** @page { size; margin }: the default page style (SwCSS1Parser::SetPageDescAttrs). */
  private ApplyPageRule(): void {
    const m = /@page\s*(?::\w+\s*)?\{([^}]*)\}/i.exec(this.m_aStyleSource.replace(/\/\*[\s\S]*?\*\//g, ''));
    if (!m) return;
    const desc = this.m_xDoc.m_aPageDesc;
    for (const [prop, value] of ParseDeclarations(m[1]!)) {
      if (prop === 'size') {
        const [w, h] = value.trim().split(/\s+/).map((x) => GetLength(x));
        if (w && h && w > 1440 && h > 1440) { desc.nWidth = w; desc.nHeight = h; }
      } else if (prop.startsWith('margin')) {
        const one = GetLength(value);
        const set = (side: 'nLeft' | 'nRight' | 'nTop' | 'nBottom', v: number | undefined) => { if (v !== undefined && v >= 0) desc[side] = v; };
        if (prop === 'margin-left') set('nLeft', one);
        else if (prop === 'margin-right') set('nRight', one);
        else if (prop === 'margin-top') set('nTop', one);
        else if (prop === 'margin-bottom') set('nBottom', one);
        else if (prop === 'margin') {
          const v = value.trim().split(/\s+/).map((x) => GetLength(x));
          const [t, r = t, b = t, l = r] = v;
          set('nTop', t); set('nRight', r); set('nBottom', b); set('nLeft', l);
        }
      }
    }
  }

  private static CharsOf(set: SwAttrSet): SwCharAttrSet {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(set)) if (k.startsWith('RES_CHRATR_')) out[k] = v;
    // A background on text is the character background.
    if (set.RES_BACKGROUND !== undefined) out.RES_CHRATR_BACKGROUND = set.RES_BACKGROUND;
    return out as SwCharAttrSet;
  }
  private static ParasOf(set: SwAttrSet): SwAttrSet {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(set)) if (!k.startsWith('RES_CHRATR_') && !k.startsWith('RES_TXTATR_')) out[k] = v;
    return out as SwAttrSet;
  }

  /** The character style of an HTML character tag, made with its pool attributes when missing. */
  private GetCharFormat(name: string): SwCharFormat {
    const f = this.m_xDoc.FindCharFormatByName(name);
    if (f) return f;
    const pool: Record<string, SwCharAttrSet> = {
      'User Entry': { RES_CHRATR_FONT: 'Liberation Mono' }, Example: { RES_CHRATR_FONT: 'Liberation Mono' },
      Teletype: { RES_CHRATR_FONT: 'Liberation Mono' }, Variable: { RES_CHRATR_POSTURE: true }, Definition: {},
    };
    return this.m_xDoc.MakeCharFormat(name, { ...(pool[name] ?? {}) });
  }

  /** ParseStyleOptions: STYLE, CLASS (rules of the style sheet), LANG and DIR of an element. */
  private ParseStyleOptions(opts: HTMLOptions, aTag: string, bForPara: boolean): { set: SwAttrSet; info: SvxCSS1PropertyInfo } {
    const set: SwAttrSet = {};
    let info: SvxCSS1PropertyInfo = {};
    const opt = (n: string) => opts.find((o) => o.aToken === n)?.aValue;
    const aClass = SwHTMLParser.ClassOf(opt('class') ?? '');
    const aId = opt('id');
    // Class rules apply hard to inline elements; paragraphs get them through their class style.
    if (aClass && !bForPara) info = this.ApplyRules((sel) => sel.aClass.toLowerCase() === aClass.toLowerCase() && (!sel.aToken || sel.aToken === aTag), set);
    if (aId) {
      const idInfo = this.ApplyRules((sel) => sel.aId === aId && (!sel.aToken || sel.aToken === aTag), set);
      info = { ...info, ...idInfo };
    }
    const style = opt('style');
    if (style) {
      const own: SvxCSS1PropertyInfo = {};
      ParseProperties(ParseDeclarations(style), set, own);
      SwHTMLParser.MergeInfo(set, own);
      info = { ...info, ...own };
    }
    const lang = opt('lang') ?? opt('xml:lang');
    if (lang) set.RES_CHRATR_LANGUAGE = lang;
    const dir = opt('dir')?.toLowerCase();
    if (dir === 'rtl') set.RES_FRAMEDIR = 'rl-tb';
    else if (dir === 'ltr' && bForPara) set.RES_FRAMEDIR = 'lr-tb';
    return { set, info };
  }

  // ---- paragraphs ----

  private InTable(): HTMLTable | undefined { return this.m_aTables[this.m_aTables.length - 1]; }

  /** SwHTMLParser::SetTextCollAttrs: the style and paragraph attributes of the current paragraph from the contexts. */
  private SetTextCollAttrs(): void {
    let aColl: string | undefined, aClass = '', aTag = 'p';
    let aDfltColl = 'Text Body';
    const para: SwAttrSet = {};
    let nLeft = 0, nRight = 0, nFirstLine: number | undefined, bLR = false;
    const chars: SwCharAttrSet = {};
    let nUpper: number | undefined, nLower: number | undefined;
    for (const c of this.m_aContexts) {
      if (c.aColl) {
        // <TD><P CLASS=xxx> must become TD.xxx
        // (also the paragraphs of headers, footers and notes take their area's style)
        aColl = c.aColl === 'Text Body' && aDfltColl !== 'Text Body' ? aDfltColl : c.aColl;
        aClass = c.aClass ?? '';
        aTag = TAG_OF[c.nToken] ?? 'p';
      } else if (c.aDfltColl) aDfltColl = c.aDfltColl;
      if (c.nLeft !== undefined || c.nRight !== undefined || c.nFirstLine !== undefined) {
        nLeft += c.nLeft ?? 0; nRight += c.nRight ?? 0;
        if (c.nFirstLine !== undefined) nFirstLine = c.nFirstLine;
        bLR = true;
      }
      if (c.nUpper !== undefined) nUpper = c.nUpper;
      if (c.nLower !== undefined) nLower = c.nLower;
      if (c.bBlock) {
        if (c.aPara) Object.assign(para, c.aPara);
        if (c.aChar) Object.assign(chars, c.aChar);
      }
    }
    const coll = aColl ? this.GetTextFormatColl(aColl, aClass, aTag) : this.coll(aDfltColl);
    this.cur.m_pColl = coll;
    // Keep the list attributes of the paragraph; set the rest anew.
    const keep: SwAttrSet = {};
    for (const k of ['RES_PARATR_NUMRULE', 'RES_PARATR_LIST_LEVEL', 'RES_PARATR_LIST_ISCOUNTED', 'RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE'] as const) {
      if (this.cur.m_aSet[k] !== undefined) (keep as Record<string, unknown>)[k] = this.cur.m_aSet[k];
    }
    this.cur.m_aSet = { ...keep, ...para, ...chars };
    if (bLR && !this.cur.m_aSet.RES_PARATR_NUMRULE) {
      const own = coll.GetFormatAttr('RES_LR_SPACE');
      const lr = { left: nLeft + (para.RES_LR_SPACE?.left ?? 0), right: nRight + (para.RES_LR_SPACE?.right ?? 0), firstLine: para.RES_LR_SPACE?.firstLine ?? nFirstLine ?? own.firstLine };
      if (lr.left !== own.left || lr.right !== own.right || lr.firstLine !== own.firstLine) this.cur.m_aSet.RES_LR_SPACE = lr;
      else delete this.cur.m_aSet.RES_LR_SPACE;
    }
    if ((nUpper !== undefined || nLower !== undefined) && !para.RES_UL_SPACE) {
      const own = coll.GetFormatAttr('RES_UL_SPACE');
      const ul = { upper: nUpper ?? own.upper, lower: nLower ?? own.lower };
      if (ul.upper !== own.upper || ul.lower !== own.lower) this.cur.m_aSet.RES_UL_SPACE = ul;
    }
  }

  /** SwHTMLParser::StripTrailingLF */
  private StripTrailingLF(): number {
    const t = this.cur.GetText();
    let nPos = t.length, nLFCount = 0;
    while (nPos && t[--nPos] === '\n') nLFCount++;
    if (!nLFCount) return 0;
    // On Netscape, a paragraph end matches 2 LFs
    nLFCount = Math.min(nLFCount, 2);
    this.cur.EraseText(t.length - nLFCount, nLFCount);
    return nLFCount;
  }

  /** Trailing blanks of a paragraph are no text (outside PRE). */
  private StripTrailingBlanks(): void {
    if (this.IsReadPRE() || this.m_bPreserveSpaces) return;
    const t = this.cur.GetText();
    let n = t.length;
    while (n && t[n - 1] === ' ') n--;
    if (n < t.length) this.cur.EraseText(n, t.length - n);
  }

  /** SwHTMLParser::AppendTextNode: ends the current paragraph and starts a new one. */
  private AppendTextNode(bUpdateNum = true): void {
    // A caption is one paragraph.
    if (this.m_nCaptionDepth >= 0) { if (this.cur.Len()) this.InsertText('\n'); return; }
    this.StripTrailingLF();
    this.StripTrailingBlanks();
    const prev = this.cur;
    this.cur = this.nodes.MakeTextNode(this.m_pEnd.GetIndex(), prev.GetTextColl());
    // A paragraph inside a list has no lower spacing, but the last one (AM_NOSPACE).
    if (this.m_aNumRuleInfo.m_nDeep && prev.m_aSet.RES_PARATR_NUMRULE && !this.m_aContexts.some((c) => c.bBlock && c.aPara?.RES_UL_SPACE)) {
      const ul = prev.GetAttr('RES_UL_SPACE');
      if (ul.lower) { this.m_aNoSpaceParas.set(prev, prev.m_aSet.RES_UL_SPACE); prev.m_aSet.RES_UL_SPACE = { upper: ul.upper, lower: 0 }; }
    }
    if (bUpdateNum && this.m_aNumRuleInfo.m_nDeep) this.SetNodeNum(this.m_aNumRuleInfo.GetLevel(), false);
    this.SetTextCollAttrs();
  }

  /** A new block starts: on a new paragraph unless the current one is empty. */
  private NewPara(): void {
    if (this.cur.Len()) this.AppendTextNode();
  }

  private PushContext(c: HTMLAttrContext): void {
    this.m_aContexts.push(c);
    this.SetPreserveSpaces();
    if (c.bBlock) this.SetTextCollAttrs();
  }

  /** HTMLParser::SetPreserveSpaces from the open elements. */
  private SetPreserveSpaces(): void {
    this.m_bPreserveSpaces = this.m_aContexts.some((c) => c.bPreserveSpaces);
  }

  /** The innermost open context of the element, from the end (PopContext). */
  private FindContext(nToken: HtmlTokenId, nLimit = 0): number {
    for (let i = this.m_aContexts.length - 1; i >= nLimit; i--) {
      if (this.m_aContexts[i]!.nToken === nToken) return i;
      // Tables and cells end the search: their contexts cannot be closed from inside.
      const t = this.m_aContexts[i]!.nToken;
      if (t === HtmlTokenId.TABLE_ON || t === HtmlTokenId.TABLEDATA_ON || t === HtmlTokenId.TABLEHEADER_ON || t === HtmlTokenId.CAPTION_ON) {
        if (t !== nToken) return -1;
      }
    }
    return -1;
  }

  /** EndContext: closes the element and those opened inside it. */
  private EndContext(nToken: HtmlTokenId): HTMLAttrContext | null {
    return this.EndContextAt(this.FindContext(nToken, this.InTable()?.nContextDepth ?? 0));
  }

  private EndContextAt(nPos: number): HTMLAttrContext | null {
    if (nPos < 0) return null;
    const bBlock = this.m_aContexts.slice(nPos).some((c) => c.bBlock || c.bList);
    if (bBlock) this.NewPara();
    let last: HTMLAttrContext | null = null;
    while (this.m_aContexts.length > nPos) {
      const c = this.m_aContexts.pop()!;
      if (c.bList) this.EndNumberBulletList(c);
      if (c.oSaved) this.RestoreInsertion(c.oSaved);
      last = c;
    }
    this.SetPreserveSpaces();
    if (bBlock) this.SetTextCollAttrs();
    return last;
  }

  /** Back to an insertion point, dropping the empty paragraph a section ended with. */
  private RestoreInsertion(saved: { end: SwEndNode; cur: SwTextNode }): void {
    this.FinishSection();
    this.m_pEnd = saved.end;
    this.cur = saved.cur;
  }

  /** The last paragraph of a section is the empty one its last block ended with: drop it unless it is the only one. */
  private FinishSection(): void {
    this.StripTrailingLF();
    this.StripTrailingBlanks();
    const i = this.cur.GetIndex();
    const prev = this.nodes.node(i - 1);
    if (!this.cur.Len() && prev.IsTextNode() && this.nodes.node(i + 1) === this.m_pEnd && !this.cur.m_aAnchoredFlys.length) {
      for (const b of this.m_aBookmarks) if (b.node === this.cur) { b.node = prev as SwTextNode; b.pos = (prev as SwTextNode).Len(); }
      this.nodes.Remove(i);
      this.cur = prev as SwTextNode;
    }
  }

  // ---- text ----

  /** The character attributes of the open inline elements. */
  private CharAttrs(): SwCharAttrSet {
    const attrs: SwCharAttrSet = {};
    for (const c of this.m_aContexts) if (!c.bBlock && c.aChar) Object.assign(attrs, c.aChar);
    return attrs;
  }

  /** InsertString: the text with the attributes of the open elements, not of the text before it. */
  private InsertText(aStr: string, extra?: SwCharAttrSet): void {
    if (!aStr) return;
    const nStart = this.cur.Len();
    this.cur.InsertText(aStr, nStart);
    const nEnd = nStart + aStr.length;
    const inherited = new Set<string>();
    for (const h of this.cur.m_aHints) if (h.nStart < nEnd && h.nEnd > nStart) for (const k of Object.keys(h.aAttrs)) inherited.add(k);
    if (inherited.size) this.cur.ResetAttr(nStart, nEnd, [...inherited] as (keyof SwCharAttrSet)[]);
    const attrs = { ...this.CharAttrs(), ...(extra ?? {}) };
    if (Object.keys(attrs).length) this.cur.SetAttr(nStart, nEnd, attrs);
  }

  /** SwHTMLParser::InsertBookmark: a bookmark at the current position. */
  private InsertBookmark(rName: string): void {
    if (!rName || this.m_aBookmarks.some((b) => b.name === rName)) return;
    this.m_aBookmarks.push({ name: rName, node: this.cur, pos: this.cur.Len() });
  }

  private MakeBookmarks(): void {
    for (const b of this.m_aBookmarks) {
      const p = new SwPosition(b.node, Math.min(b.pos, b.node.Len()));
      this.m_xDoc.getIDocumentMarkAccess().makeMark({ GetPoint: () => p, GetMark: () => p, HasMark: () => false }, b.name, MarkType.BOOKMARK);
      p.Release();
    }
  }

  // ---- lists (htmlnumreader.cxx) ----

  private SetNodeNum(nLevel: number, bCounted: boolean): void {
    const rule = this.m_aNumRuleInfo.m_pNumRule;
    if (!rule) return;
    Object.assign(this.cur.m_aSet, { RES_PARATR_NUMRULE: rule.GetName(), RES_PARATR_LIST_LEVEL: nLevel, RES_PARATR_LIST_ISCOUNTED: bCounted } satisfies SwAttrSet);
    for (const k of ['RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE'] as const) delete this.cur.m_aSet[k];
  }

  private ResetNum(): void {
    for (const k of ['RES_PARATR_NUMRULE', 'RES_PARATR_LIST_LEVEL', 'RES_PARATR_LIST_ISCOUNTED', 'RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE'] as const) delete this.cur.m_aSet[k];
  }

  /** SwHTMLParser::NewNumberBulletList */
  private NewNumberBulletList(nToken: HtmlTokenId): void {
    const rInfo = this.m_aNumRuleInfo;
    this.NewPara();
    rInfo.m_nDeep++;
    const nLevel = rInfo.GetLevel();
    if (!rInfo.m_pNumRule) {
      const rule = new SwNumRule(this.m_xDoc.GetUniqueNumRuleName());
      this.m_xDoc.PutNumRule(rule);
      rInfo.m_pNumRule = rule;
    }
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n);
    let bNewNumFormat = !rInfo.m_aSetLevels.has(nLevel);
    let oSavedNumRule: HTMLAttrContext['oSavedNumRule'];
    if (!bNewNumFormat) {
      // A list of the other type at a level with a format: a new list style with the levels above.
      const rExisting = rInfo.m_pNumRule.Get(nLevel);
      const bExistingIsOrdered = rExisting.GetNumberingType() !== NumberingType.CHAR_SPECIAL && rExisting.GetNumberingType() !== NumberingType.BITMAP;
      if (bExistingIsOrdered !== (nToken === HtmlTokenId.ORDERLIST_ON)) {
        oSavedNumRule = { rule: rInfo.m_pNumRule, levels: new Set(rInfo.m_aSetLevels) };
        const pNewRule = new SwNumRule(this.m_xDoc.GetUniqueNumRuleName());
        this.m_xDoc.PutNumRule(pNewRule);
        rInfo.m_aSetLevels = new Set();
        for (let i = 0; i < nLevel; i++) if (oSavedNumRule.levels.has(i)) { pNewRule.Set(i, oSavedNumRule.rule.Get(i).Clone()); rInfo.m_aSetLevels.add(i); }
        rInfo.m_pNumRule = pNewRule;
        bNewNumFormat = true;
      }
    }
    rInfo.m_aNumStarts[nLevel] = null;
    if (bNewNumFormat) {
      const aNumFormat = rInfo.m_pNumRule.Get(nLevel).Clone();
      if (nToken === HtmlTokenId.ORDERLIST_ON) {
        aNumFormat.SetNumberingType(NumberingType.ARABIC);
        switch (opt('type')?.aValue[0]) {
          case 'A': aNumFormat.SetNumberingType(NumberingType.CHARS_UPPER_LETTER); break;
          case 'a': aNumFormat.SetNumberingType(NumberingType.CHARS_LOWER_LETTER); break;
          case 'I': aNumFormat.SetNumberingType(NumberingType.ROMAN_UPPER); break;
          case 'i': aNumFormat.SetNumberingType(NumberingType.ROMAN_LOWER); break;
        }
      } else {
        aNumFormat.SetNumberingType(NumberingType.CHAR_SPECIAL);
        // aHTMLULTypeTable, with the port's bullets for disc, circle and square
        const type = opt('type')?.aValue.toLowerCase();
        aNumFormat.SetBulletChar(type === 'disc' ? '•' : type === 'circle' ? '◦' : type === 'square' ? '▪' : numfunc.GetBulletChar(nLevel));
      }
      // css list-style-type on the list
      const style = opt('style')?.aValue ?? '';
      const lst = /list-style(?:-type)?\s*:\s*([\w-]+)/i.exec(style)?.[1]?.toLowerCase();
      if (lst) {
        const types: Record<string, NumberingType> = { decimal: NumberingType.ARABIC, 'lower-alpha': NumberingType.CHARS_LOWER_LETTER, 'lower-latin': NumberingType.CHARS_LOWER_LETTER, 'upper-alpha': NumberingType.CHARS_UPPER_LETTER, 'upper-latin': NumberingType.CHARS_UPPER_LETTER, 'lower-roman': NumberingType.ROMAN_LOWER, 'upper-roman': NumberingType.ROMAN_UPPER, none: NumberingType.NUMBER_NONE };
        const bullets: Record<string, string> = { disc: '•', circle: '◦', square: '▪' };
        if (lst in types) aNumFormat.SetNumberingType(types[lst]!);
        else if (lst in bullets) { aNumFormat.SetNumberingType(NumberingType.CHAR_SPECIAL); aNumFormat.SetBulletChar(bullets[lst]!); }
      }
      const start = opt('start');
      if (start && nToken === HtmlTokenId.ORDERLIST_ON) aNumFormat.SetStart(start.GetSNumber());
      let nAbsLSpace = HTML_NUMBER_BULLET_MARGINLEFT, nFirstLineIndent = HTML_NUMBER_BULLET_INDENT;
      if (nLevel > 0) {
        const rPrev = rInfo.m_pNumRule.Get(nLevel - 1);
        nAbsLSpace += rPrev.GetIndentAt();
        nFirstLineIndent = rPrev.GetFirstLineIndent();
      }
      aNumFormat.SetIndentAt(nAbsLSpace);
      aNumFormat.SetListtabPos(nAbsLSpace);
      aNumFormat.SetFirstLineIndent(nFirstLineIndent);
      rInfo.m_pNumRule.Set(nLevel, aNumFormat);
      rInfo.m_aSetLevels.add(nLevel);
    } else {
      const start = opt('start');
      rInfo.m_aNumStarts[nLevel] = start ? start.GetSNumber() : rInfo.m_pNumRule.Get(nLevel).GetStart() !== 1 ? 1 : null;
    }
    // don't number the current paragraph (for now)
    this.SetNodeNum(nLevel, false);
    const { set } = this.ParseStyleOptions(opts, TAG_OF[nToken] ?? 'ul', true);
    this.PushContext({ nToken, bList: true, bBlock: true, aChar: SwHTMLParser.CharsOf(set), oSavedNumRule });
  }

  /** SwHTMLParser::EndNumberBulletList, when its context is popped. */
  private EndNumberBulletList(pCntxt: HTMLAttrContext): void {
    const rInfo = this.m_aNumRuleInfo;
    if (rInfo.m_nDeep > 0) rInfo.m_nDeep--;
    if (pCntxt.oSavedNumRule) { rInfo.m_pNumRule = pCntxt.oSavedNumRule.rule; rInfo.m_aSetLevels = pCntxt.oSavedNumRule.levels; }
    if (!rInfo.m_nDeep) {
      // The formats not yet modified are now modified, to ease editing
      let ref: SwNumFormat | null = null;
      for (let i = 0; i < MAXLEVEL; i++) {
        if (rInfo.m_aSetLevels.has(i)) { ref = rInfo.m_pNumRule!.Get(i); continue; }
        if (!ref) continue;
        const f = rInfo.m_pNumRule!.Get(i).Clone();
        f.SetNumberingType(ref.GetNumberingType());
        if (ref.GetNumberingType() === NumberingType.CHAR_SPECIAL) f.SetBulletChar(numfunc.GetBulletChar(i));
        f.SetIndentAt((i + 1) * HTML_NUMBER_BULLET_MARGINLEFT);
        f.SetListtabPos((i + 1) * HTML_NUMBER_BULLET_MARGINLEFT);
        f.SetFirstLineIndent(HTML_NUMBER_BULLET_INDENT);
        rInfo.m_pNumRule!.Set(i, f);
      }
      // The last paragraph of the list keeps the spacing below the list.
      const prev = this.nodes.node(this.cur.GetIndex() - 1);
      if (prev.IsTextNode() && this.m_aNoSpaceParas.has(prev as SwTextNode)) {
        const p = prev as SwTextNode, old = this.m_aNoSpaceParas.get(p);
        if (old) p.m_aSet.RES_UL_SPACE = old; else delete p.m_aSet.RES_UL_SPACE;
      }
      this.ResetNum();
      rInfo.Clear();
    } else this.SetNodeNum(rInfo.GetLevel(), false);
  }

  /** SwHTMLParser::NewNumberBulletListItem */
  private NewNumberBulletListItem(): void {
    const rInfo = this.m_aNumRuleInfo;
    // Close an item still open (LI has an optional end tag).
    this.EndListItem();
    this.NewPara();
    const opts = this.GetOptions();
    const { set } = this.ParseStyleOptions(opts, 'li', true);
    if (!rInfo.m_pNumRule) {
      // An LI outside any list: a paragraph of its own.
      this.PushContext({ nToken: HtmlTokenId.LI_ON, bBlock: true, aChar: SwHTMLParser.CharsOf(set), aPara: SwHTMLParser.ParasOf(set) });
      return;
    }
    const nLevel = rInfo.GetLevel();
    // <LI STYLE="display: block">: a list header, not numbered
    const bHeader = !!this.ParseStyleOptions(opts, 'li', true).info.bDisplayBlock;
    this.SetNodeNum(nLevel, !bHeader);
    const value = bHeader ? undefined : opts.find((o) => o.aToken === 'value');
    const nStart = value ? value.GetSNumber() : bHeader ? null : rInfo.m_aNumStarts[nLevel];
    if (nStart !== null && nStart !== undefined) {
      this.cur.m_aSet.RES_PARATR_LIST_ISRESTART = true;
      this.cur.m_aSet.RES_PARATR_LIST_RESTARTVALUE = nStart;
      rInfo.m_aNumStarts[nLevel] = null;
    }
    const para = SwHTMLParser.ParasOf(set);
    delete para.RES_LR_SPACE;
    this.PushContext({ nToken: HtmlTokenId.LI_ON, bBlock: true, aChar: SwHTMLParser.CharsOf(set), aPara: para });
  }

  /** The end of a list item: the paragraphs after it in the list are not numbered. */
  private EndListItem(): void {
    const nPos = this.FindContext(HtmlTokenId.LI_ON, this.InTable()?.nContextDepth ?? 0);
    // Only the item of the innermost list.
    const nList = this.m_aContexts.findLastIndex((c) => c.bList);
    if (nPos < 0 || nPos < nList) return;
    this.EndContext(HtmlTokenId.LI_ON);
  }

  // ---- tables (htmltab.cxx) ----

  private BuildTable(): void {
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n);
    // A table starts on a paragraph of its own, which it is inserted before.
    this.NewPara();
    const { set, info } = this.ParseStyleOptions(opts, 'table', false);
    const align = opt('align')?.aValue.toLowerCase();
    let nWidth = 0, bWidthPercent = false;
    const w = opt('width')?.aValue.trim();
    if (w) {
      if (w.endsWith('%')) { nWidth = parseFloat(w); bWidthPercent = true; } else nWidth = (parseInt(w, 10) || 0) * 15;
    }
    if (info.nWidth) { nWidth = info.nWidth; bWidthPercent = !!info.bWidthPercent; }
    const adjust: SwTableAdjust = align === 'center' || /margin-left\s*:\s*auto/i.test(opt('style')?.aValue ?? '') ? 'center' : align === 'right' ? 'right' : nWidth && !(bWidthPercent && nWidth >= 100) ? 'left' : 'full';
    const table = new SwTable({ name: this.m_xDoc.GetUniqueTableName(), adjust, width: 0, leftSpace: 0, upper: 0, lower: 0 });
    const tableNode = new SwTableNode(this.nodes, table);
    const at = this.cur.GetIndex();
    tableNode.m_pStartOfSection = this.m_pEnd.m_pStartOfSection;
    this.nodes.Insert(tableNode, at);
    const tableEnd = new SwEndNode(this.nodes, tableNode);
    this.nodes.Insert(tableEnd, at + 1);
    const nBorder = opt('border') ? (opt('border')!.aValue === '' ? 1 : opt('border')!.GetNumber()) : 0;
    const nCellPadding = opt('cellpadding') ? opt('cellpadding')!.GetNumber() * 15 : -1;
    const bgcolor = opt('bgcolor') ? GetColor(opt('bgcolor')!.aValue) ?? GetColor(`#${opt('bgcolor')!.aValue}`) ?? null : null;
    this.m_aTables.push({
      tableNode, table, tableEnd, spans: new Map(), borderBoxes: new Set(), line: null, nCol: 0, vmerge: [], colWidths: [], nCellPadding, nBorder,
      nWidth, bWidthPercent, bInHead: false, saved: { end: this.m_pEnd, cur: this.cur }, nContextDepth: this.m_aContexts.length + 1, bCell: false,
      aBackground: typeof set.RES_BACKGROUND === 'string' ? set.RES_BACKGROUND : bgcolor,
    });
    this.m_aContexts.push({ nToken: HtmlTokenId.TABLE_ON });
  }

  private NewTableRow(): void {
    const t = this.InTable();
    if (!t) return;
    this.EndTableRow();
    t.line = new SwTableLine();
    t.table.m_aLines.push(t.line);
    t.nCol = 0;
    const opts = this.GetOptions();
    const h = opts.find((o) => o.aToken === 'height');
    if (h) t.line.m_aAttrs.minHeight = h.GetNumber() * 15;
    if (t.bInHead) t.table.m_nRowsToRepeat = t.table.m_aLines.length;
  }

  private EndTableRow(): void {
    const t = this.InTable();
    if (!t || !t.line) return;
    this.EndTableCell();
    // The cells of the row's last columns still covered by row spans.
    while (t.vmerge.some((v, i) => i >= t.nCol && v && v.left > 0)) {
      if (!this.CoverCell(t)) { this.MakeBox(t, defaultBoxAttrs(0, t.nBorder > 0), 1, 1); t.nCol++; }
    }
    t.line = null;
  }

  /** A box covered by a row span from above, at the current column; false if there is none. */
  private CoverCell(t: HTMLTable): boolean {
    const v = t.vmerge[t.nCol];
    if (!v || v.left <= 0) return false;
    this.MakeBox(t, { ...defaultBoxAttrs(0, t.nBorder > 0) }, -v.left, v.span);
    v.left--;
    t.nCol += v.span;
    return true;
  }

  /** A box at the end of the current row; its section goes at nAt (default: the end of the table). */
  private MakeBox(t: HTMLTable, attrs: SwTableBoxAttrs, nRowSpan: number, nColSpan: number, nAt = t.tableEnd.GetIndex()): SwTableBox {
    if (!t.line) { this.NewTableRowImplicit(t); }
    const box = new SwTableBox(t.line!, attrs);
    box.setRowSpan(nRowSpan);
    const sn = new SwStartNode(this.nodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
    sn.m_pStartOfSection = t.tableNode;
    this.nodes.Insert(sn, nAt);
    const en = new SwEndNode(this.nodes, sn);
    this.nodes.Insert(en, nAt + 1);
    box.m_pStartNode = sn;
    this.nodes.MakeTextNode(en.GetIndex(), this.coll('Table Contents'));
    t.line!.m_aBoxes.push(box);
    t.spans.set(box, nColSpan);
    return box;
  }

  private NewTableRowImplicit(t: HTMLTable): void {
    t.line = new SwTableLine();
    t.table.m_aLines.push(t.line);
    t.nCol = 0;
  }

  private NewTableCell(nToken: HtmlTokenId): void {
    const t = this.InTable();
    if (!t) return;
    this.EndTableCell();
    if (!t.line) this.NewTableRowImplicit(t);
    while (this.CoverCell(t)) { /* boxes covered from above come first */ }
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n);
    const nColSpan = Math.max(1, Math.min(opt('colspan')?.GetNumber() || 1, 1000));
    const nRowSpan = Math.max(1, Math.min(opt('rowspan')?.GetNumber() || 1, 1000));
    const { set, info } = this.ParseStyleOptions(opts, nToken === HtmlTokenId.TABLEHEADER_ON ? 'th' : 'td', false);
    const attrs = defaultBoxAttrs(0, t.nBorder > 0);
    if (t.nBorder > 1) for (const k of ['left', 'top', 'right', 'bottom'] as const) attrs.box[k] = { color: '#000000', width: Math.min(t.nBorder, 10) * 15 };
    if (t.nCellPadding >= 0) attrs.padding = t.nCellPadding;
    if (info.aBorders) for (const k of ['left', 'top', 'right', 'bottom'] as const) if (info.aBorders[k] !== undefined) attrs.box[k] = info.aBorders[k]!;
    if (info.nPadding !== undefined) attrs.padding = info.nPadding;
    const bg = opt('bgcolor') ? GetColor(opt('bgcolor')!.aValue) ?? GetColor(`#${opt('bgcolor')!.aValue}`) : undefined;
    attrs.background = typeof set.RES_BACKGROUND === 'string' ? set.RES_BACKGROUND : bg ?? t.aBackground;
    const valign = (opt('valign')?.aValue ?? /vertical-align\s*:\s*(\w+)/i.exec(opt('style')?.aValue ?? '')?.[1] ?? '').toLowerCase();
    if (valign === 'middle' || valign === 'center') attrs.vertOrient = 'center';
    else if (valign === 'bottom') attrs.vertOrient = 'bottom';
    const w = opt('width')?.aValue.trim();
    const nW = info.nWidth && !info.bWidthPercent ? info.nWidth : w && !w.endsWith('%') ? (parseInt(w, 10) || 0) * 15 : 0;
    if (nW && nColSpan === 1 && !t.colWidths[t.nCol]) t.colWidths[t.nCol] = nW;
    const box = this.MakeBox(t, attrs, nRowSpan, nColSpan);
    if (t.nBorder > 0 && info.aBorders?.bottom === undefined) t.borderBoxes.add(box);
    if (nRowSpan > 1) t.vmerge[t.nCol] = { left: nRowSpan - 1, span: nColSpan };
    for (let k = 1; k < nColSpan; k++) delete t.vmerge[t.nCol + k];
    t.nCol += nColSpan;
    // The cell's paragraphs go into its box.
    const first = this.nodes.GoNext(box.m_pStartNode!.GetIndex())!;
    const saved = { end: this.m_pEnd, cur: this.cur };
    this.m_pEnd = box.m_pStartNode!.EndOfSectionNode();
    this.cur = first;
    t.bCell = true;
    const align = opt('align')?.aValue.toLowerCase();
    const para: SwAttrSet = SwHTMLParser.ParasOf(set);
    delete para.RES_BACKGROUND; delete para.RES_BOX;
    if (align === 'center' || align === 'right' || align === 'left' || align === 'justify') para.RES_PARATR_ADJUST = align === 'justify' ? 'block' : align;
    const dflt = nToken === HtmlTokenId.TABLEHEADER_ON ? 'Table Heading' : 'Table Contents';
    this.PushContext({ nToken, bBlock: true, aDfltColl: dflt, aChar: SwHTMLParser.CharsOf(set), aPara: para, oSaved: saved });
  }

  private EndTableCell(): void {
    const t = this.InTable();
    if (!t || !t.bCell) return;
    const nPos = this.m_aContexts.findIndex((c, i) => i >= t.nContextDepth && (c.nToken === HtmlTokenId.TABLEDATA_ON || c.nToken === HtmlTokenId.TABLEHEADER_ON));
    t.bCell = false;
    if (nPos < 0) return;
    while (this.m_aContexts.length > nPos) {
      const c = this.m_aContexts.pop()!;
      if (c.bList) this.EndNumberBulletList(c);
      if (c.oSaved) this.RestoreInsertion(c.oSaved);
    }
  }

  private EndTable(): void {
    const t = this.InTable();
    if (!t) return;
    this.EndTableRow();
    // close what is still open inside the table
    while (this.m_aContexts.length >= t.nContextDepth) {
      const c = this.m_aContexts.pop()!;
      if (c.bList) this.EndNumberBulletList(c);
      if (c.oSaved) this.RestoreInsertion(c.oSaved);
    }
    this.m_aTables.pop();
    this.m_pEnd = t.saved.end;
    this.cur = t.saved.cur;
    const lines = t.table.m_aLines.filter((l) => l.m_aBoxes.length);
    if (!lines.length) {
      this.nodes.Remove(t.tableNode.GetIndex(), t.tableEnd.GetIndex() - t.tableNode.GetIndex() + 1);
      return;
    }
    t.table.m_aLines = lines;
    // The number of columns, and empty boxes for short rows.
    const nCols = Math.max(...lines.map((l) => l.m_aBoxes.reduce((n, b) => n + (t.spans.get(b) ?? 1), 0)));
    for (const l of lines) {
      let n = l.m_aBoxes.reduce((s, b) => s + (t.spans.get(b) ?? 1), 0);
      while (n < nCols) {
        t.line = l;
        const last = l.m_aBoxes[l.m_aBoxes.length - 1]!;
        this.MakeBox(t, defaultBoxAttrs(0, t.nBorder > 0), 1, 1, last.m_pStartNode!.EndOfSectionNode().GetIndex() + 1);
        n++;
      }
    }
    t.line = null;
    // The BORDER of a table: a line below the cells of the last row only (the cell below draws
    // its top line), as HTMLTable::SetBorders does.
    lines.forEach((l, nRow) => {
      for (const b of l.m_aBoxes) if (t.borderBoxes.has(b) && nRow + Math.max(1, b.getRowSpan()) < lines.length) b.m_aAttrs.box = { ...b.m_aAttrs.box, bottom: null };
    });
    // The widths: the table's, or the page's; columns without one share the rest.
    const desc = this.m_xDoc.m_aPageDesc;
    const nAvail = desc.nWidth - desc.nLeft - desc.nRight;
    const nTableWidth = t.nWidth ? (t.bWidthPercent ? Math.round(nAvail * Math.min(t.nWidth, 100) / 100) : Math.min(t.nWidth, nAvail)) : nAvail;
    const cols = Array.from({ length: nCols }, (_, i) => t.colWidths[i] ?? 0);
    const nKnown = cols.reduce((a, b) => a + b, 0), nUnknown = cols.filter((c) => !c).length;
    const nRest = nUnknown ? Math.max(nTableWidth - nKnown, nUnknown * 283) / nUnknown : 0;
    const widths = cols.map((c) => c || nRest);
    const nSum = widths.reduce((a, b) => a + b, 0);
    const scale = nSum > 0 ? nTableWidth / nSum : 1;
    for (const l of lines) {
      let col = 0;
      for (const b of l.m_aBoxes) {
        const span = t.spans.get(b) ?? 1;
        let w = 0;
        for (let k = 0; k < span; k++) w += widths[col + k] ?? nRest;
        b.m_aAttrs.width = Math.max(1, Math.round(w * scale));
        col += span;
      }
    }
    if (t.table.m_aAttrs.adjust !== 'full') {
      t.table.m_aAttrs.width = nTableWidth;
      if (t.bWidthPercent) t.table.m_aAttrs.relWidth = Math.min(t.nWidth, 100);
    }
  }

  // ---- images (htmlgrin.cxx) ----

  /** SwHTMLParser::InsertImage */
  private InsertImage(): void {
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n)?.aValue;
    const src = (opt('src') ?? '').trim();
    const alt = opt('alt') ?? '';
    const title = opt('title');
    const m = /^data:([^;,]+)?((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(src);
    if (!m) {
      // A linked image cannot be loaded here: its description stays, linked to the image.
      this.lost.add('linked images (their description links to them)');
      if (src) this.InsertText(alt || src, { RES_TXTATR_INETFMT: src });
      else if (alt) this.InsertText(alt);
      return;
    }
    let bytes: Uint8Array;
    try { bytes = m[3] ? Uint8Array.from(atob(m[4]!.replace(/\s+/g, '')), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[4]!)); } catch {
      this.lost.add('images with broken data');
      if (alt) this.InsertText(alt);
      return;
    }
    const meta = DetectGraphic(bytes);
    const { info } = this.ParseStyleOptions(opts, 'img', false);
    const desc = this.m_xDoc.m_aPageDesc;
    const nAvail = desc.nWidth - desc.nLeft - desc.nRight;
    const size = (v: string | undefined, nCss: number | undefined, bPercent?: boolean): number | undefined => {
      if (nCss) return bPercent ? Math.round(nAvail * nCss / 100) : nCss;
      if (!v) return undefined;
      const s = v.trim();
      if (s.endsWith('%')) return Math.round(nAvail * parseFloat(s) / 100);
      const n = parseInt(s, 10);
      return n > 0 ? n * 15 : undefined;
    };
    let nWidth = size(opt('width'), info.nWidth, info.bWidthPercent);
    let nHeight = size(opt('height'), info.nHeight);
    const nPixW = meta?.mnPixWidth ?? 0, nPixH = meta?.mnPixHeight ?? 0;
    if (nWidth === undefined && nHeight === undefined) {
      nWidth = (nPixW || HTML_DFLT_IMG_WIDTH / 15) * 15;
      nHeight = (nPixH || HTML_DFLT_IMG_HEIGHT / 15) * 15;
    } else if (nWidth === undefined) nWidth = nPixW && nPixH ? Math.round(nHeight! * nPixW / nPixH) : nHeight!;
    else if (nHeight === undefined) nHeight = nPixW && nPixH ? Math.round(nWidth * nPixH / nPixW) : nWidth;
    const graphic = this.m_xDoc.AddGraphic(bytes, m[1] || 'image/png');
    const name = opt('name') || opt('id') || this.m_xDoc.GetUniqueGrfName();
    const pos = this.cur.Len();
    this.cur.InsertText(CH_TXTATR_BREAKWORD, pos);
    this.cur.SetAttr(pos, pos + 1, {
      ...this.CharAttrs(),
      RES_TXTATR_FLYCNT: { graphic, width: Math.max(1, nWidth!), height: Math.max(1, nHeight!), name, ...(alt ? { alt } : {}), ...(title ? { title } : {}) },
    });
  }

  // ---- footnotes (htmlftn.cxx) ----

  /** SwHTMLParser::InsertFootEndNote: the anchor of a footnote, SDFOOTNOTEnANC. */
  private InsertFootEndNote(rName: string, bEndNote: boolean): void {
    const id = this.m_xDoc.NewFootnoteId();
    const sec = this.nodes.MakeFootnoteSection(id, this.coll(bEndNote ? 'Endnote' : 'Footnote'));
    void sec;
    this.m_aFootnotes.set(rName.toLowerCase(), id);
    this.InsertText(CH_TXTATR_BREAKWORD, { RES_TXTATR_FTN: bEndNote ? { id, endnote: true } : { id } });
    this.m_bInFootEndNoteAnchor = true;
  }

  // ---- the tokens ----

  protected NextToken(nToken: HtmlTokenId): void {
    // The title is all text up to </TITLE>.
    if (this.m_bInTitle) {
      if (nToken === HtmlTokenId.TITLE_OFF) { this.m_bInTitle = false; this.m_xDoc.m_xDocProps.setTitle(this.m_sTitle.replace(/\s+/g, ' ').trim()); }
      else if (nToken === HtmlTokenId.TEXTTOKEN) this.m_sTitle += this.aToken;
      return;
    }
    // The text of the footnote marks is the footnote's number.
    if (this.m_bInFootEndNoteAnchor || this.m_bInFootEndNoteSymbol) {
      if (nToken === HtmlTokenId.ANCHOR_OFF) { this.m_bInFootEndNoteAnchor = false; this.m_bInFootEndNoteSymbol = false; }
      return;
    }
    const opts = (): HTMLOptions => this.GetOptions();
    const opt = (n: string) => opts().find((o) => o.aToken === n)?.aValue;
    // The text of a field is its current value.
    if (this.m_bInField && (nToken === HtmlTokenId.TEXTTOKEN || nToken === HtmlTokenId.NONBREAKSPACE)) return;

    switch (nToken) {
      case HtmlTokenId.TITLE_ON: this.m_bInTitle = true; this.m_sTitle = ''; return;
      case HtmlTokenId.META: this.ParseMetaOptions(); return;
      case HtmlTokenId.STYLE_ON: this.m_aStyleSource = ''; return;
      case HtmlTokenId.RAWDATA:
        if (this.IsReadStyle()) this.m_aStyleSource += `${this.m_aStyleSource ? '\n' : ''}${this.aToken}`;
        else if (this.IsReadScript()) this.lost.add('scripts');
        return;
      case HtmlTokenId.STYLE_OFF:
        this.m_aStyleRules.push(...ParseStyleSheet(this.m_aStyleSource));
        this.ApplyStyleSheet();
        return;
      case HtmlTokenId.SCRIPT_ON: case HtmlTokenId.SCRIPT_OFF: case HtmlTokenId.NOSCRIPT_ON: case HtmlTokenId.NOSCRIPT_OFF:
      case HtmlTokenId.DOCTYPE: case HtmlTokenId.HTML_ON: case HtmlTokenId.HTML_OFF: case HtmlTokenId.HEAD_ON: case HtmlTokenId.HEAD_OFF:
      case HtmlTokenId.BASE: case HtmlTokenId.LINK: case HtmlTokenId.BODY_OFF: case HtmlTokenId.TBODY_ON: case HtmlTokenId.TBODY_OFF:
      case HtmlTokenId.TFOOT_ON: case HtmlTokenId.TFOOT_OFF: case HtmlTokenId.COLGROUP_ON: case HtmlTokenId.COLGROUP_OFF: case HtmlTokenId.COL_OFF:
        return;
      case HtmlTokenId.BODY_ON: {
        const { set } = this.ParseStyleOptions(opts(), 'body', true);
        const text = opt('text') ? GetColor(opt('text')!) : undefined;
        if (text) set.RES_CHRATR_COLOR = text;
        const chars = SwHTMLParser.CharsOf(set);
        delete chars.RES_CHRATR_BACKGROUND;
        if (Object.keys(chars).length) { const s = this.coll('Standard'); s.m_aSet = { ...s.m_aSet, ...chars }; }
        return;
      }
      case HtmlTokenId.COMMENT: this.lost.add('comments in the HTML source'); return;
      case HtmlTokenId.TEXTTOKEN: case HtmlTokenId.CDATA: {
        let aToken = this.aToken;
        // insert string without spanning attributes at the end.
        if (aToken.startsWith(' ') && !this.IsReadPRE() && !this.m_bPreserveSpaces) {
          const t = this.cur.GetText();
          if (!t.length || t.endsWith(' ') || t.endsWith('\n')) aToken = aToken.slice(1);
        }
        if (!aToken) return;
        if (this.InTable() && !this.InTable()!.bCell && this.m_nCaptionDepth < 0) {
          // Text between the cells of a table goes before it (upstream: into the paragraph before).
          return;
        }
            this.InsertText(aToken);
        return;
      }
      case HtmlTokenId.NEWPARA:
        // CR in PRE/LISTING/XMP
        this.AppendTextNode();
        return;
      case HtmlTokenId.LINEBREAK:
        if (this.IsReadPRE()) { this.AppendTextNode(); return; }
        this.InsertText('\n');
        return;
      case HtmlTokenId.NONBREAKSPACE: this.InsertText(CHAR_HARDBLANK); return;
      case HtmlTokenId.SOFTHYPH: this.InsertText('\u00ad'); return;
      case HtmlTokenId.IMAGE: this.InsertImage(); return;
      case HtmlTokenId.HORZRULE: {
        // InsertHorzRule: an empty paragraph with the Horizontal Line style.
        this.NewPara();
        this.PushContext({ nToken, bBlock: true, aColl: 'Horizontal Line' });
        this.m_aContexts.pop();
        this.AppendTextNode();
        return;
      }

      // paragraphs
      case HtmlTokenId.PARABREAK_ON: case HtmlTokenId.HEAD1_ON: case HtmlTokenId.HEAD2_ON: case HtmlTokenId.HEAD3_ON:
      case HtmlTokenId.HEAD4_ON: case HtmlTokenId.HEAD5_ON: case HtmlTokenId.HEAD6_ON: case HtmlTokenId.ADDRESS_ON:
      case HtmlTokenId.BLOCKQUOTE_ON: case HtmlTokenId.BLOCKQUOTE30_ON: case HtmlTokenId.PREFORMTXT_ON:
      case HtmlTokenId.LISTING_ON: case HtmlTokenId.XMP_ON: case HtmlTokenId.DT_ON: case HtmlTokenId.DD_ON:
        this.NewTextFormatColl(nToken);
        return;
      case HtmlTokenId.PARABREAK_OFF: case HtmlTokenId.HEAD1_OFF: case HtmlTokenId.HEAD2_OFF: case HtmlTokenId.HEAD3_OFF:
      case HtmlTokenId.HEAD4_OFF: case HtmlTokenId.HEAD5_OFF: case HtmlTokenId.HEAD6_OFF: case HtmlTokenId.ADDRESS_OFF:
      case HtmlTokenId.BLOCKQUOTE_OFF: case HtmlTokenId.BLOCKQUOTE30_OFF: case HtmlTokenId.PREFORMTXT_OFF:
      case HtmlTokenId.LISTING_OFF: case HtmlTokenId.XMP_OFF: case HtmlTokenId.DT_OFF: case HtmlTokenId.DD_OFF:
      case HtmlTokenId.CENTER_OFF: case HtmlTokenId.DIVISION_OFF: case HtmlTokenId.LI_OFF:
        this.EndBlock(getOnToken(nToken));
        return;
      case HtmlTokenId.CENTER_ON: case HtmlTokenId.DIVISION_ON:
        this.NewDivision(nToken);
        return;

      // lists
      case HtmlTokenId.UNORDERLIST_ON: case HtmlTokenId.ORDERLIST_ON: case HtmlTokenId.DIRLIST_ON: case HtmlTokenId.MENULIST_ON:
        this.NewNumberBulletList(nToken === HtmlTokenId.ORDERLIST_ON ? nToken : HtmlTokenId.UNORDERLIST_ON);
        // the context carries the real token, so that </DIR> and </MENU> close it
        this.m_aContexts[this.m_aContexts.length - 1]!.nToken = nToken;
        return;
      case HtmlTokenId.UNORDERLIST_OFF: case HtmlTokenId.ORDERLIST_OFF: case HtmlTokenId.DIRLIST_OFF: case HtmlTokenId.MENULIST_OFF:
        this.EndContext(getOnToken(nToken));
        return;
      case HtmlTokenId.LI_ON: this.NewNumberBulletListItem(); return;
      case HtmlTokenId.DEFLIST_ON: {
        this.NewPara();
        this.PushContext({ nToken, bBlock: true, bDefList: true });
        return;
      }
      case HtmlTokenId.DEFLIST_OFF: this.EndContext(HtmlTokenId.DEFLIST_ON); return;

      // tables
      case HtmlTokenId.TABLE_ON: this.BuildTable(); return;
      case HtmlTokenId.TABLE_OFF: if (this.InTable()) this.EndTable(); return;
      case HtmlTokenId.THEAD_ON: if (this.InTable()) this.InTable()!.bInHead = true; return;
      case HtmlTokenId.THEAD_OFF: if (this.InTable()) { this.EndTableRow(); this.InTable()!.bInHead = false; } return;
      case HtmlTokenId.TABLEROW_ON: this.NewTableRow(); return;
      case HtmlTokenId.TABLEROW_OFF: this.EndTableRow(); return;
      case HtmlTokenId.TABLEDATA_ON: case HtmlTokenId.TABLEHEADER_ON:
        if (this.InTable()) this.NewTableCell(nToken);
        else this.NewTextFormatColl(HtmlTokenId.PARABREAK_ON);
        return;
      case HtmlTokenId.TABLEDATA_OFF: case HtmlTokenId.TABLEHEADER_OFF:
        if (this.InTable()) this.EndTableCell();
        else this.EndBlock(HtmlTokenId.PARABREAK_ON);
        return;
      case HtmlTokenId.COL_ON: {
        const t = this.InTable();
        if (!t) return;
        const w = opt('width')?.trim();
        const n = Math.max(1, Math.min(parseInt(opt('span') ?? '1', 10) || 1, 1000));
        for (let k = 0; k < n; k++) t.colWidths.push(w && !w.endsWith('%') && !w.endsWith('*') ? (parseInt(w, 10) || 0) * 15 : 0);
        return;
      }
      case HtmlTokenId.CAPTION_ON: {
        const t = this.InTable();
        if (!t) return;
        // InsertTableSection for the caption: a Caption paragraph before the table.
        const p = this.nodes.MakeTextNode(t.tableNode.GetIndex(), this.coll('Caption'));
        const saved = { end: this.m_pEnd, cur: this.cur };
        this.cur = p;
        this.m_nCaptionDepth = this.m_aContexts.length;
        this.m_aContexts.push({ nToken, oSaved: saved });
        return;
      }
      case HtmlTokenId.CAPTION_OFF: {
        if (this.m_nCaptionDepth < 0) return;
        while (this.m_aContexts.length > this.m_nCaptionDepth) {
          const c = this.m_aContexts.pop()!;
          if (c.oSaved) { this.StripTrailingLF(); this.StripTrailingBlanks(); this.m_pEnd = c.oSaved.end; this.cur = c.oSaved.cur; }
        }
        this.m_nCaptionDepth = -1;
        return;
      }

      // SDFIELD: the page number and page count fields (htmlfld.cxx, reduced); other fields stay text.
      case HtmlTokenId.SDFIELD_ON: {
        const type = (opt('type') ?? '').toUpperCase(), subtype = (opt('subtype') ?? '').toUpperCase();
        const field = type === 'PAGE' ? 'PageNumber' : type === 'DOCSTAT' && subtype === 'PAGE' ? 'PageCount' : null;
        if (!field) return;
            this.InsertText(CH_TXTATR_BREAKWORD, { RES_TXTATR_FIELD: { type: field } });
        this.m_bInField = true;
        return;
      }
      case HtmlTokenId.SDFIELD_OFF: this.m_bInField = false; return;

      // anchors
      case HtmlTokenId.ANCHOR_ON: this.NewAnchor(); return;
      case HtmlTokenId.ANCHOR_OFF: this.EndContext(HtmlTokenId.ANCHOR_ON); return;

      // forms, frames and objects are not ported
      case HtmlTokenId.FORM_ON: case HtmlTokenId.INPUT: case HtmlTokenId.SELECT_ON: case HtmlTokenId.TEXTAREA_ON: case HtmlTokenId.OPTION:
        this.lost.add('forms (their text is kept)');
        if (nToken === HtmlTokenId.INPUT && opt('value') && !/^(hidden|checkbox|radio|file|image)$/i.test(opt('type') ?? '')) this.InsertText(opt('value')!);
        return;
      case HtmlTokenId.IFRAME_ON: case HtmlTokenId.OBJECT_ON: case HtmlTokenId.EMBED: case HtmlTokenId.APPLET_ON: case HtmlTokenId.FRAMESET_ON:
        this.lost.add('frames and embedded objects');
        return;
      case HtmlTokenId.MAP_ON: case HtmlTokenId.AREA:
        this.lost.add('image maps');
        return;

      case HtmlTokenId.UNKNOWNCONTROL_ON: case HtmlTokenId.UNKNOWNCONTROL_OFF: {
        // The sectioning elements of HTML5 are blocks (upstream does not know them).
        const aName = this.sSaveToken.toLowerCase();
        if (!HTML5_BLOCKS.has(aName)) return;
        if (nToken === HtmlTokenId.UNKNOWNCONTROL_OFF) {
          const nPos = this.m_aContexts.findLastIndex((c) => c.aTagName === aName);
          if (nPos >= (this.InTable()?.nContextDepth ?? 0)) this.EndContextAt(nPos);
          return;
        }
        this.NewPara();
        const { set } = this.ParseStyleOptions(opts(), aName, true);
        const para = SwHTMLParser.ParasOf(set);
        if (para.RES_BACKGROUND === null) delete para.RES_BACKGROUND;
        if (opt('id')) this.InsertBookmark(opt('id')!);
        this.PushContext({ nToken, aTagName: aName, bBlock: true, aChar: SwHTMLParser.CharsOf(set), aPara: para });
        return;
      }

      default:
        break;
    }

    // character formatting
    if (nToken >= HtmlTokenId.ONOFF_START) {
      const on = getOnToken(nToken);
      const item = this.CharAttrOf(on);
      if (item !== undefined) {
        if (isOffToken(nToken)) this.EndContext(on);
        else {
          const { set } = this.ParseStyleOptions(this.GetOptions(), TAG_OF[on] ?? 'span', false);
          this.PushContext({ nToken: on, aChar: { ...item, ...SwHTMLParser.CharsOf(set) } });
        }
      }
    }
  }

  /** The character attributes of an inline element (NewStdAttr, NewFontAttr, NewCharFormat); undefined if it is none. */
  private CharAttrOf(nToken: HtmlTokenId): SwCharAttrSet | undefined {
    switch (nToken) {
      case HtmlTokenId.BOLD_ON: return { RES_CHRATR_WEIGHT: true };
      case HtmlTokenId.ITALIC_ON: return { RES_CHRATR_POSTURE: true };
      case HtmlTokenId.UNDERLINE_ON: case HtmlTokenId.INSERTEDTEXT_ON: return { RES_CHRATR_UNDERLINE: 'single' };
      case HtmlTokenId.STRIKE_ON: case HtmlTokenId.STRIKETHROUGH_ON: case HtmlTokenId.DELETEDTEXT_ON: return { RES_CHRATR_CROSSEDOUT: true };
      case HtmlTokenId.SUPERSCRIPT_ON: return { RES_CHRATR_ESCAPEMENT: 33 };
      case HtmlTokenId.SUBSCRIPT_ON: return { RES_CHRATR_ESCAPEMENT: -33 };
      case HtmlTokenId.BIGPRINT_ON: return { RES_CHRATR_FONTSIZE: aFontHeights[3]! };
      case HtmlTokenId.SMALLPRINT_ON: return { RES_CHRATR_FONTSIZE: aFontHeights[1]! };
      case HtmlTokenId.FONT_ON: case HtmlTokenId.BASEFONT_ON: {
        const opts = this.GetOptions();
        const opt = (n: string) => opts.find((o) => o.aToken === n)?.aValue;
        const a: SwCharAttrSet = {};
        const color = opt('color');
        if (color) { const c = GetColor(color) ?? GetColor(`#${color}`); if (c) a.RES_CHRATR_COLOR = c; }
        const face = opt('face');
        if (face) { const f = face.split(',')[0]!.trim(); if (f) a.RES_CHRATR_FONT = f; }
        const size = opt('size')?.trim();
        if (size) {
          // +n and -n are relative to the base font size 3
          const n = /^[+-]/.test(size) ? 3 + parseInt(size, 10) : parseInt(size, 10);
          if (!Number.isNaN(n)) a.RES_CHRATR_FONTSIZE = aFontHeights[Math.max(1, Math.min(7, n)) - 1]!;
        }
        return a;
      }
      case HtmlTokenId.SPAN_ON: case HtmlTokenId.SHORTQUOTE_ON: case HtmlTokenId.ABBREVIATION_ON: case HtmlTokenId.ACRONYM_ON:
      case HtmlTokenId.AUTHOR_ON: case HtmlTokenId.PERSON_ON: case HtmlTokenId.LANGUAGE_ON: case HtmlTokenId.BLINK_ON:
      case HtmlTokenId.NOBR_ON:
        return {};
    }
    const name = CHAR_STYLES[TAG_OF[nToken] ?? ''];
    if (name) return { RES_TXTATR_CHARFMT: this.GetCharFormat(name) };
    return undefined;
  }

  /** SwHTMLParser::NewTextFormatColl: a paragraph style element. */
  private NewTextFormatColl(nToken: HtmlTokenId): void {
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n)?.aValue;
    // <P> inside an open <P>, a heading inside a heading: the open one ends.
    if (nToken === HtmlTokenId.PARABREAK_ON || (nToken >= HtmlTokenId.HEAD1_ON && nToken <= HtmlTokenId.HEAD6_ON) || nToken === HtmlTokenId.DT_ON || nToken === HtmlTokenId.DD_ON) {
      const top = this.m_aContexts[this.m_aContexts.length - 1];
      if (top && (top.nToken === HtmlTokenId.PARABREAK_ON || (top.nToken >= HtmlTokenId.HEAD1_ON && top.nToken <= HtmlTokenId.HEAD6_ON) || ((nToken === HtmlTokenId.DT_ON || nToken === HtmlTokenId.DD_ON) && (top.nToken === HtmlTokenId.DT_ON || top.nToken === HtmlTokenId.DD_ON)))) this.EndContext(top.nToken);
    }
    this.NewPara();
    const aTag = TAG_OF[nToken] ?? 'p';
    const { set, info } = this.ParseStyleOptions(opts, aTag, true);
    const align = opt('align')?.toLowerCase();
    if (align === 'center' || align === 'right' || align === 'left') set.RES_PARATR_ADJUST = align;
    else if (align === 'justify') set.RES_PARATR_ADJUST = 'block';
    const aColl = COLL_OF[nToken] ?? 'Text Body';
    const c: HTMLAttrContext = { nToken, bBlock: true, aColl, aClass: opt('class') ?? '', aChar: SwHTMLParser.CharsOf(set), aPara: SwHTMLParser.ParasOf(set), bPreserveSpaces: info.bPreserveSpaces };
    // Nested block quotes and definitions indent further.
    if (aColl === 'Quotations' && this.m_aContexts.some((x) => x.aColl === 'Quotations')) c.nLeft = 567;
    if (aColl === 'List Contents') {
      const nDeep = this.m_aContexts.filter((x) => x.bDefList).length;
      if (nDeep > 1) c.nLeft = (nDeep - 1) * 567;
    }
    if (c.aPara?.RES_BACKGROUND === null) delete c.aPara.RES_BACKGROUND;
    const id = opt('id');
    if (id) this.InsertBookmark(id);
    this.PushContext(c);
  }

  /** The end of a block element (EndTextFormatColl, EndDivision). */
  private EndBlock(nToken: HtmlTokenId): void {
    if (nToken === HtmlTokenId.LI_ON) { this.EndListItem(); return; }
    const c = this.EndContext(nToken);
    if (!c && nToken === HtmlTokenId.PARABREAK_ON) {
      // </P> without <P>: an empty paragraph (as browsers do).
      this.NewPara();
      this.AppendTextNode();
    }
  }

  /** SwHTMLParser::NewDivision: CENTER, DIV, and LibreOffice's header, footer and footnote divisions. */
  private NewDivision(nToken: HtmlTokenId): void {
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n)?.aValue;
    const id = (opt('id') ?? '').toLowerCase();
    const title = (opt('title') ?? '').toLowerCase();
    // The body of a footnote: <DIV ID="sdfootnote1">.
    const ftn = this.m_aFootnotes.get(id);
    if (ftn) {
      const sec = this.nodes.FindFootnoteSection(ftn)!;
      const saved = { end: this.m_pEnd, cur: this.cur };
      this.NewPara();
      saved.cur = this.cur;
      this.m_pEnd = sec.EndOfSectionNode();
      this.cur = this.nodes.GoNext(sec.GetIndex())!;
      this.PushContext({ nToken, bBlock: true, aDfltColl: /^sdendnote/.test(id) ? 'Endnote' : 'Footnote', oSaved: saved });
      return;
    }
    // <DIV TITLE="header">, <DIV TITLE="footer">: the default page style's header or footer.
    if ((title === 'header' || title === 'footer') && !this.InTable()) {
      const bHeader = title === 'header';
      const eTyp = bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode;
      if (!this.nodes.FindAreaSection(eTyp, 'default', DEFAULT_PAGE_DESC)) {
        const sec = this.nodes.MakeAreaSection(eTyp, this.coll(bHeader ? 'Header' : 'Footer'), 'default', DEFAULT_PAGE_DESC);
        const saved = { end: this.m_pEnd, cur: this.cur };
        this.m_pEnd = sec.EndOfSectionNode();
        this.cur = this.nodes.GoNext(sec.GetIndex())!;
        this.PushContext({ nToken, bBlock: true, aDfltColl: bHeader ? 'Header' : 'Footer', oSaved: saved });
        return;
      }
    }
    this.NewPara();
    const { set, info } = this.ParseStyleOptions(opts, 'div', true);
    const align = opt('align')?.toLowerCase();
    if (nToken === HtmlTokenId.CENTER_ON || align === 'center') set.RES_PARATR_ADJUST = 'center';
    else if (align === 'right' || align === 'left') set.RES_PARATR_ADJUST = align;
    else if (align === 'justify') set.RES_PARATR_ADJUST = 'block';
    const para = SwHTMLParser.ParasOf(set);
    if (para.RES_BACKGROUND === null) delete para.RES_BACKGROUND;
    // (the ID of a DIV names a section upstream: it is no bookmark)
    this.PushContext({ nToken, bBlock: true, aChar: SwHTMLParser.CharsOf(set), aPara: para, bPreserveSpaces: info.bPreserveSpaces });
  }

  /** SwHTMLParser::NewAnchor: a hyperlink, a bookmark, or a footnote mark. */
  private NewAnchor(): void {
    const opts = this.GetOptions();
    const opt = (n: string) => opts.find((o) => o.aToken === n)?.aValue;
    // An anchor ends the one still open (anchors don't nest).
    if (this.FindContext(HtmlTokenId.ANCHOR_ON) >= 0) this.EndContext(HtmlTokenId.ANCHOR_ON);
    const aClass = (opt('class') ?? '').toLowerCase();
    const href = opt('href');
    const name = opt('name') ?? opt('id');
    if (aClass === 'sdfootnoteanc' || aClass === 'sdendnoteanc') {
      // the key of the footnote is its href's target without "sym": #sdfootnote1sym -> sdfootnote1
      const key = (href ?? '').replace(/^#/, '').replace(/sym$/i, '') || (name ?? '').replace(/anc$/i, '');
      this.InsertFootEndNote(key, aClass === 'sdendnoteanc');
      return;
    }
    if (aClass === 'sdfootnotesym' || aClass === 'sdendnotesym') { this.m_bInFootEndNoteSymbol = true; return; }
    if (name) this.InsertBookmark(name);
    const { set } = this.ParseStyleOptions(opts, 'a', false);
    const aChar = SwHTMLParser.CharsOf(set);
    if (href !== undefined) aChar.RES_TXTATR_INETFMT = href.trim();
    this.PushContext({ nToken: HtmlTokenId.ANCHOR_ON, aChar });
  }

  /** HTMLParser::ParseMetaOptions: the document properties of META elements. */
  private ParseMetaOptions(): void {
    const opts = this.GetOptions();
    const name = (opts.find((o) => o.aToken === 'name')?.aValue ?? '').toLowerCase();
    const content = opts.find((o) => o.aToken === 'content')?.aValue ?? '';
    const props = this.m_xDoc.m_xDocProps;
    const date = (v: string) => (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? v.replace(/Z$/, '') : '');
    switch (name) {
      case 'author': props.setAuthor(content); break;
      case 'changedby': props.setModifiedBy(content); break;
      case 'description': props.setDescription(content); break;
      case 'keywords': props.setKeywords(content.split(',').map((k) => k.trim()).filter(Boolean)); break;
      case 'classification': props.setSubject(content); break;
      case 'created': if (date(content)) props.setMetaText('meta:creation-date', date(content)); break;
      case 'changed': if (date(content)) props.setMetaText('dc:date', date(content)); break;
    }
  }

  /** SwHTMLParser::CallParser */
  CallParser(): void {
    this.SetTextCollAttrs();
    this.Continue();
    // Close the tables and elements still open.
    while (this.InTable()) this.EndTable();
    while (this.m_aContexts.length) {
      const c = this.m_aContexts.pop()!;
      if (c.bList) this.EndNumberBulletList(c);
      if (c.oSaved) this.RestoreInsertion(c.oSaved);
    }
    this.FinishSection();
    this.MakeBookmarks();
  }
}

/** The tag names of the tokens, for style sheet selectors. */
const TAG_OF: Record<number, string> = {
  [HtmlTokenId.PARABREAK_ON]: 'p', [HtmlTokenId.HEAD1_ON]: 'h1', [HtmlTokenId.HEAD2_ON]: 'h2', [HtmlTokenId.HEAD3_ON]: 'h3',
  [HtmlTokenId.HEAD4_ON]: 'h4', [HtmlTokenId.HEAD5_ON]: 'h5', [HtmlTokenId.HEAD6_ON]: 'h6', [HtmlTokenId.ADDRESS_ON]: 'address',
  [HtmlTokenId.BLOCKQUOTE_ON]: 'blockquote', [HtmlTokenId.BLOCKQUOTE30_ON]: 'blockquote', [HtmlTokenId.PREFORMTXT_ON]: 'pre',
  [HtmlTokenId.LISTING_ON]: 'pre', [HtmlTokenId.XMP_ON]: 'pre', [HtmlTokenId.DT_ON]: 'dt', [HtmlTokenId.DD_ON]: 'dd',
  [HtmlTokenId.UNORDERLIST_ON]: 'ul', [HtmlTokenId.ORDERLIST_ON]: 'ol', [HtmlTokenId.SPAN_ON]: 'span', [HtmlTokenId.FONT_ON]: 'font',
  [HtmlTokenId.EMPHASIS_ON]: 'em', [HtmlTokenId.STRONG_ON]: 'strong', [HtmlTokenId.CITATION_ON]: 'cite', [HtmlTokenId.CODE_ON]: 'code',
  [HtmlTokenId.KEYBOARD_ON]: 'kbd', [HtmlTokenId.SAMPLE_ON]: 'samp', [HtmlTokenId.VARIABLE_ON]: 'var', [HtmlTokenId.DEFINSTANCE_ON]: 'dfn',
  [HtmlTokenId.TELETYPE_ON]: 'tt', [HtmlTokenId.BOLD_ON]: 'b', [HtmlTokenId.ITALIC_ON]: 'i', [HtmlTokenId.UNDERLINE_ON]: 'u',
};
/** The paragraph styles of the tokens (NewTextFormatColl's pool ids). */
const COLL_OF: Record<number, string> = {
  [HtmlTokenId.PARABREAK_ON]: 'Text Body', [HtmlTokenId.HEAD1_ON]: 'Heading 1', [HtmlTokenId.HEAD2_ON]: 'Heading 2', [HtmlTokenId.HEAD3_ON]: 'Heading 3',
  [HtmlTokenId.HEAD4_ON]: 'Heading 4', [HtmlTokenId.HEAD5_ON]: 'Heading 5', [HtmlTokenId.HEAD6_ON]: 'Heading 6', [HtmlTokenId.ADDRESS_ON]: 'Sender',
  [HtmlTokenId.BLOCKQUOTE_ON]: 'Quotations', [HtmlTokenId.BLOCKQUOTE30_ON]: 'Quotations', [HtmlTokenId.PREFORMTXT_ON]: 'Preformatted Text',
  [HtmlTokenId.LISTING_ON]: 'Preformatted Text', [HtmlTokenId.XMP_ON]: 'Preformatted Text', [HtmlTokenId.DT_ON]: 'List Heading', [HtmlTokenId.DD_ON]: 'List Contents',
};
/** The sectioning elements of HTML5, read as DIV. */
const HTML5_BLOCKS = new Set(['section', 'article', 'aside', 'nav', 'main', 'header', 'footer', 'figure', 'figcaption', 'details', 'summary', 'hgroup']);
/** The HTML character styles (RES_POOLCHR_HTML_*), by tag. */
export const CHAR_STYLES: Record<string, string> = {
  em: 'Emphasis', strong: 'Strong Emphasis', cite: 'Citation', code: 'Source Text', kbd: 'User Entry',
  samp: 'Example', var: 'Variable', dfn: 'Definition', tt: 'Teletype',
};

/** HTMLReader::Read for a new document: bytes are decoded by their BOM or META charset. */
export function ImportHTML(input: Uint8Array | string): ImportResult {
  const text = typeof input === 'string' ? input : new TextDecoder(GetEncodingFromMeta(input)).decode(input);
  const p = new SwHTMLParser(text.replace(/^\ufeff/, ''));
  p.CallParser();
  return { doc: p.m_xDoc, lost: [...p.lost] };
}
