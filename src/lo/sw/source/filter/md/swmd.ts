// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/md/swmd.cxx reduced
// @upstream sw/source/filter/md/mdcallbcks.cxx reduced
// @upstream sw/source/filter/md/mdtab.cxx reduced
// @upstream sw/source/filter/md/swmd.hxx reduced
// @upstream sw/source/filter/md/mdnum.hxx reduced
// Markdown import: md4c's callbacks build the document. The md4c parser itself is injected (the
// application drives a JavaScript CommonMark parser through the same callbacks). Differences: the
// document is built directly instead of through SwPaM operations; raw HTML is not parsed by the
// HTML filter (it is not ported): its text is kept; images other than data: URLs cannot be linked
// and are kept as a hyperlink with their description; task list items are ☐/☒ characters instead of
// checkbox content controls; the start number of an ordered list is kept (upstream drops it); no
// empty paragraph is added after a table.
import { SwDoc } from '../../../inc/doc.ts';
import { CH_TXTATR_BREAKWORD, type SwAttrSet, type SwCharAttrSet } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { DetectGraphic } from '../../../../vcl/source/filter/GraphicFormatDetector.ts';
import type { ImportResult } from '../xml/odt.ts';

// md4c.h
export const MD_BLOCK = { DOC: 0, QUOTE: 1, UL: 2, OL: 3, LI: 4, HR: 5, H: 6, CODE: 7, HTML: 8, P: 9, TABLE: 10, THEAD: 11, TBODY: 12, TR: 13, TH: 14, TD: 15 } as const;
export const MD_SPAN = { EM: 0, STRONG: 1, A: 2, IMG: 3, CODE: 4, DEL: 5, LATEXMATH: 6, LATEXMATH_DISPLAY: 7, WIKILINK: 8, U: 9 } as const;
export const MD_TEXT = { NORMAL: 0, NULLCHAR: 1, BR: 2, SOFTBR: 3, ENTITY: 4, CODE: 5, HTML: 6, LATEXMATH: 7 } as const;
export type MD_ALIGN = 'default' | 'left' | 'center' | 'right';
/** The details md4c passes with blocks and spans that have them. */
export interface MD_DETAIL {
  level?: number; // MD_BLOCK_H_DETAIL
  start?: number; // MD_BLOCK_OL_DETAIL
  is_task?: boolean; task_mark?: string; // MD_BLOCK_LI_DETAIL
  col_count?: number; head_row_count?: number; body_row_count?: number; // MD_BLOCK_TABLE_DETAIL
  align?: MD_ALIGN; // MD_BLOCK_TD_DETAIL
  href?: string; src?: string; title?: string; target?: string; // MD_SPAN_A / IMG / WIKILINK_DETAIL
  lang?: string; // MD_BLOCK_CODE_DETAIL
}
/** MD_PARSER's callbacks. */
export interface MD_PARSER {
  enter_block(type: number, detail: MD_DETAIL): void;
  leave_block(type: number, detail: MD_DETAIL): void;
  enter_span(type: number, detail: MD_DETAIL): void;
  leave_span(type: number, detail: MD_DETAIL): void;
  text(type: number, text: string): void;
}
/** md_parse with MD_DIALECT_GITHUB | MD_FLAG_WIKILINKS. */
export type MdParse = (text: string, parser: MD_PARSER) => void;

/** o3tl::toTwips(5, mm) */
const MD_PARSPACE = 283;
const MD_MAX_IMAGE_WIDTH_IN_TWIPS = 5000;
const MD_MAX_IMAGE_HEIGHT_IN_TWIPS = 5000;
const MD_MIN_IMAGE_WIDTH_IN_TWIPS = 500;
const MD_MIN_IMAGE_HEIGHT_IN_TWIPS = 500;
/** mdnum.hxx: 12.5 mm per level, a first line 5 mm to the left. */
const MD_NUMBER_BULLET_MARGINLEFT = 709;
const MD_NUMBER_BULLET_INDENT = -283;
const COL_CODE_BLOCK = '#e1e1e1';
/** SwContentControl::CHECKED_STATE and UNCHECKED_STATE */
export const CHECKED_STATE = '☒', UNCHECKED_STATE = '☐';
const CHAR_HARDBLANK = ' ';

const SwMdAppendMode = { AM_NORMAL: 0, AM_NOSPACE: 1, AM_SPACE: 2, AM_SOFTNOSPACE: 3, AM_NONE: 4 } as const;
type SwMdAppendMode = (typeof SwMdAppendMode)[keyof typeof SwMdAppendMode];

/** SwMdNumRuleInfo: the list being read. */
class SwMdNumRuleInfo {
  m_aNumStarts: (number | null)[] = Array(MAXLEVEL).fill(null);
  m_pNumRule: SwNumRule | null = null;
  m_nDeep = 0;
  /** The levels whose format was set (upstream: GetNumFormat(nLevel) != nullptr). */
  m_aSetLevels = new Set<number>();
  GetLevel(): number { return Math.max(0, Math.min(this.m_nDeep, MAXLEVEL) - 1); }
  SetNodeStartValue(nLvl: number, nVal: number | null = null): void { this.m_aNumStarts[nLvl] = nVal; }
  Clear(): void { this.m_pNumRule = null; this.m_nDeep = 0; this.m_aNumStarts.fill(null); this.m_aSetLevels.clear(); }
}

/** MDTable */
interface MDTable { cells: SwTextNode[][]; nCurRow: number; nCurCol: number; after: SwTextNode }

class SwMarkdownParser {
  readonly m_xDoc = new SwDoc();
  readonly lost = new Set<string>();
  private cur: SwTextNode;
  private m_aAttrStack: (SwCharAttrSet | null)[] = [];
  private m_htmlData = '';
  private m_nBlockQuoteDepth = -1;
  private m_bNoParSpace = true;
  private m_bInsideImage = false;
  private m_aImg = { url: '', title: '', desc: '', link: '' };
  private m_aNumRuleInfo = new SwMdNumRuleInfo();
  private m_xTable: MDTable | null = null;
  /** OL start numbers by depth, applied to the first item. */
  private m_aOlStarts: (number | undefined)[] = [];
  private nImage = 0;

  constructor() { this.cur = this.m_xDoc.GetNodes().FirstTextNode(); }

  private coll(name: string) { return this.m_xDoc.FindTextFormatCollByName(name) ?? this.m_xDoc.FindTextFormatCollByName('Standard')!; }
  private SetTextFormatColl(name: string): void { this.cur.m_pColl = this.coll(name); }

  private SetNodeNum(nLevel: number): void {
    const rule = this.m_aNumRuleInfo.m_pNumRule;
    if (!rule) return;
    Object.assign(this.cur.m_aSet, { RES_PARATR_NUMRULE: rule.GetName(), RES_PARATR_LIST_LEVEL: nLevel, RES_PARATR_LIST_ISCOUNTED: false } satisfies SwAttrSet);
  }

  private StripTrailingLF(): number {
    const t = this.cur.GetText();
    let nPos = t.length, nLFCount = 0;
    while (nPos && t[--nPos] === '\n') nLFCount++;
    if (!nLFCount) return 0;
    nLFCount = Math.min(nLFCount, 2);
    this.cur.EraseText(t.length - nLFCount, nLFCount);
    return nLFCount;
  }

  private AppendTextNode(eMode: SwMdAppendMode, bUpdateNum = true): void {
    const nLFStripped = this.StripTrailingLF();
    if ((eMode === SwMdAppendMode.AM_NOSPACE || eMode === SwMdAppendMode.AM_SOFTNOSPACE) && nLFStripped > 1) eMode = SwMdAppendMode.AM_SPACE;
    if (eMode === SwMdAppendMode.AM_SPACE || eMode === SwMdAppendMode.AM_NOSPACE) {
      const ul = this.cur.GetAttr('RES_UL_SPACE');
      const bChange = eMode === SwMdAppendMode.AM_NOSPACE ? ul.lower > 0 : ul.lower === 0;
      if (bChange) {
        const collUL = this.cur.GetTextColl().GetFormatAttr('RES_UL_SPACE');
        const bMayReset = eMode === SwMdAppendMode.AM_NOSPACE ? collUL.lower === 0 : collUL.lower > 0;
        if (bMayReset && collUL.upper === ul.upper) delete this.cur.m_aSet.RES_UL_SPACE;
        else this.cur.m_aSet.RES_UL_SPACE = { upper: ul.upper, lower: eMode === SwMdAppendMode.AM_NOSPACE ? 0 : MD_PARSPACE };
      }
    }
    this.m_bNoParSpace = eMode === SwMdAppendMode.AM_NOSPACE || eMode === SwMdAppendMode.AM_SOFTNOSPACE;
    // IDocumentContentOperations::AppendTextNode: a new paragraph with the paragraph's attributes.
    this.cur = this.cur.SplitContentNode(this.cur.Len());
    for (const k of ['RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE'] as const) delete this.cur.m_aSet[k];
    if (bUpdateNum) {
      if (this.m_aNumRuleInfo.m_nDeep) this.SetNodeNum(this.m_aNumRuleInfo.GetLevel());
      else this.ResetNum();
    }
  }

  private ResetNum(): void {
    for (const k of ['RES_PARATR_NUMRULE', 'RES_PARATR_LIST_LEVEL', 'RES_PARATR_LIST_ISCOUNTED', 'RES_PARATR_LIST_ISRESTART', 'RES_PARATR_LIST_RESTARTVALUE'] as const) delete this.cur.m_aSet[k];
  }

  private AddParSpace(): void {
    if (!this.m_bNoParSpace) return;
    this.m_bNoParSpace = false;
    const nodes = this.m_xDoc.GetNodes();
    const prev = nodes.node(this.cur.GetIndex() - 1);
    if (!prev.IsTextNode()) return;
    const ul = prev.GetAttr('RES_UL_SPACE');
    if (ul.lower) return;
    prev.m_aSet.RES_UL_SPACE = { upper: ul.upper, lower: MD_PARSPACE };
  }

  /** "Start a block on a new paragraph": append when the current one has text, else add spacing. */
  private newBlock(): void {
    if (this.cur.Len()) this.AppendTextNode(SwMdAppendMode.AM_SPACE);
    else this.AddParSpace();
  }

  AddBlockQuote(): void {
    this.newBlock();
    this.m_nBlockQuoteDepth++;
    this.SetTextFormatColl('Quotations');
  }
  EndBlockQuote(): void {
    this.newBlock();
    if (this.m_nBlockQuoteDepth === 0) this.SetTextFormatColl('Text Body');
    this.m_nBlockQuoteDepth--;
  }
  AddHR(): void {
    if (this.cur.Len()) this.AppendTextNode(SwMdAppendMode.AM_SPACE);
    this.SetTextFormatColl('Horizontal Line');
  }
  EndHR(): void {
    this.AppendTextNode(SwMdAppendMode.AM_SPACE);
    this.SetTextFormatColl('Text Body');
  }
  StartPara(): void {
    // A loose task list item: its paragraph continues after the checkbox (upstream splits them).
    if (/^[\u2610\u2612] $/.test(this.cur.GetText()) && this.cur.m_aSet.RES_PARATR_NUMRULE) return;
    this.newBlock();
  }
  EndPara(): void { this.newBlock(); }
  StartHeading(nLvl: number): void {
    this.newBlock();
    this.SetTextFormatColl(`Heading ${nLvl}`);
  }
  EndHeading(): void {
    this.newBlock();
    this.SetTextFormatColl(this.m_nBlockQuoteDepth >= 0 ? 'Quotations' : 'Text Body');
  }

  StartNumberedBulletList(type: number, detail: MD_DETAIL): void {
    const rInfo = this.m_aNumRuleInfo;
    const bSpace = rInfo.m_nDeep === 0;
    if (this.cur.Len()) this.AppendTextNode(bSpace ? SwMdAppendMode.AM_SPACE : SwMdAppendMode.AM_NOSPACE, false);
    else if (bSpace) this.AddParSpace();
    rInfo.m_nDeep++;
    const nLevel = rInfo.GetLevel();
    if (!rInfo.m_pNumRule) {
      const rule = new SwNumRule(this.m_xDoc.GetUniqueNumRuleName());
      this.m_xDoc.PutNumRule(rule);
      rInfo.m_pNumRule = rule;
    }
    rInfo.SetNodeStartValue(nLevel);
    if (!rInfo.m_aSetLevels.has(nLevel)) {
      // Create the default numbering format
      const aNumFormat = rInfo.m_pNumRule.Get(nLevel).Clone();
      if (type === MD_BLOCK.OL) aNumFormat.SetNumberingType(NumberingType.ARABIC);
      else { aNumFormat.SetNumberingType(NumberingType.CHAR_SPECIAL); aNumFormat.SetBulletChar('•'); }
      let nAbsLSpace = MD_NUMBER_BULLET_MARGINLEFT, nFirstLineIndent = MD_NUMBER_BULLET_INDENT;
      if (nLevel > 0) {
        const prev = rInfo.m_pNumRule.Get(nLevel - 1);
        nAbsLSpace += prev.GetIndentAt();
        nFirstLineIndent = prev.GetFirstLineIndent();
      }
      aNumFormat.SetIndentAt(nAbsLSpace);
      aNumFormat.SetListtabPos(nAbsLSpace);
      aNumFormat.SetFirstLineIndent(nFirstLineIndent);
      rInfo.m_pNumRule.Set(nLevel, aNumFormat);
      rInfo.m_aSetLevels.add(nLevel);
    }
    this.m_aOlStarts[nLevel] = type === MD_BLOCK.OL && detail.start !== undefined && detail.start !== 1 ? detail.start : undefined;
    this.SetNodeNum(nLevel);
  }

  EndNumberedBulletList(): void {
    const rInfo = this.m_aNumRuleInfo;
    const bAppend = this.cur.Len() > 0 || (!!this.cur.m_aSet.RES_PARATR_NUMRULE && this.cur.m_aSet.RES_PARATR_LIST_ISCOUNTED !== false);
    const bSpace = rInfo.m_nDeep === 1;
    if (bAppend) this.AppendTextNode(bSpace ? SwMdAppendMode.AM_SPACE : SwMdAppendMode.AM_NOSPACE, false);
    else if (bSpace) this.AddParSpace();
    if (rInfo.m_nDeep > 0) {
      rInfo.m_nDeep--;
      if (!rInfo.m_nDeep) {
        // The formats not yet modified are now modified, to ease editing
        let ref: SwNumFormat | null = null;
        for (let i = 0; i < MAXLEVEL; i++) {
          if (rInfo.m_aSetLevels.has(i)) { ref = rInfo.m_pNumRule!.Get(i); continue; }
          if (!ref) continue;
          const f = rInfo.m_pNumRule!.Get(i).Clone();
          f.SetNumberingType(ref.GetNumberingType());
          if (ref.GetNumberingType() === NumberingType.CHAR_SPECIAL) f.SetBulletChar('•');
          f.SetIndentAt((i + 1) * MD_NUMBER_BULLET_MARGINLEFT);
          f.SetListtabPos((i + 1) * MD_NUMBER_BULLET_MARGINLEFT);
          f.SetFirstLineIndent(MD_NUMBER_BULLET_INDENT);
          rInfo.m_pNumRule!.Set(i, f);
        }
        this.ResetNum();
        rInfo.Clear();
      } else this.SetNodeNum(rInfo.GetLevel());
    }
  }

  StartNumberedBulletListItem(detail: MD_DETAIL): void {
    const rInfo = this.m_aNumRuleInfo;
    const nLevel = rInfo.GetLevel();
    if (this.cur.Len()) this.AppendTextNode(SwMdAppendMode.AM_NOSPACE, false);
    this.m_bNoParSpace = false; // no space in <LI>!
    const rule = rInfo.m_pNumRule;
    if (!rule) return;
    if (detail.is_task) {
      // Map the task list item to a checkbox (upstream: a checkbox content control).
      const bChecked = detail.task_mark === 'x' || detail.task_mark === 'X';
      this.cur.InsertText(`${bChecked ? CHECKED_STATE : UNCHECKED_STATE} `, this.cur.Len());
    }
    Object.assign(this.cur.m_aSet, { RES_PARATR_NUMRULE: rule.GetName(), RES_PARATR_LIST_LEVEL: nLevel, RES_PARATR_LIST_ISCOUNTED: nLevel < MAXLEVEL } satisfies SwAttrSet);
    const nStart = this.m_aOlStarts[nLevel];
    if (nStart !== undefined) {
      this.cur.m_aSet.RES_PARATR_LIST_ISRESTART = true;
      this.cur.m_aSet.RES_PARATR_LIST_RESTARTVALUE = nStart;
      this.m_aOlStarts[nLevel] = undefined;
    }
  }

  EndNumberedBulletListItem(): void {
    if (this.cur.Len()) this.AppendTextNode(SwMdAppendMode.AM_SPACE);
  }

  BeginHtmlBlock(): void { this.newBlock(); }
  EndHtmlBlock(): void { this.InsertHtmlData(); this.m_htmlData = ''; }
  /** Upstream reads the HTML with the HTML filter, which is not ported: its text is kept. */
  private InsertHtmlData(): void {
    const text = this.m_htmlData.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n+$/, '');
    if (this.m_htmlData.trim()) this.lost.add('HTML in Markdown (its text is kept)');
    if (text) this.InsertText(text);
  }

  BeginCodeBlock(): void {
    this.newBlock();
    this.SetTextFormatColl('Preformatted Text');
    this.cur.m_aSet.RES_BACKGROUND = COL_CODE_BLOCK;
  }
  EndCodeBlock(): void {
    this.newBlock();
    this.SetTextFormatColl(this.m_nBlockQuoteDepth >= 0 ? 'Quotations' : 'Text Body');
    delete this.cur.m_aSet.RES_BACKGROUND;
  }

  InsertText(aStr: string): void {
    const nStart = this.cur.Len();
    this.cur.InsertText(aStr, nStart);
    if (!aStr) return;
    // ClearAttrs: the text must not take on the attributes of the text before it.
    const nEnd = nStart + aStr.length;
    const inherited = new Set<string>();
    for (const h of this.cur.m_aHints) if (h.nStart < nEnd && h.nEnd > nStart) for (const k of Object.keys(h.aAttrs)) inherited.add(k);
    if (inherited.size) this.cur.ResetAttr(nStart, nEnd, [...inherited] as (keyof SwCharAttrSet)[]);
    const attrs: SwCharAttrSet = Object.assign({}, ...this.m_aAttrStack.filter((a): a is SwCharAttrSet => !!a));
    if (Object.keys(attrs).length) this.cur.SetAttr(nStart, nEnd, attrs);
  }

  private InsertImage(): void {
    const img = this.m_aImg;
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(img.url);
    if (!m) {
      // A linked image cannot be loaded here: its description stays, linked to the image.
      this.lost.add('linked images (their description links to them)');
      const saved = this.m_aAttrStack;
      this.m_aAttrStack = [...saved, { RES_TXTATR_INETFMT: img.url }];
      this.InsertText(img.desc || img.url);
      this.m_aAttrStack = saved;
      return;
    }
    let bytes: Uint8Array;
    try { bytes = m[2] ? Uint8Array.from(atob(m[3]!.replace(/\s+/g, '')), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]!)); } catch {
      this.lost.add('images with broken data');
      this.InsertText(img.desc);
      return;
    }
    const meta = DetectGraphic(bytes);
    let nWidth = MD_MIN_IMAGE_WIDTH_IN_TWIPS, nHeight = MD_MIN_IMAGE_HEIGHT_IN_TWIPS;
    if (meta?.mnPixWidth && meta.mnPixHeight) {
      // o3tl::convert(px, twip): 15 twips per pixel.
      nWidth = meta.mnPixWidth * 15;
      nHeight = meta.mnPixHeight * 15;
      if (nWidth > MD_MAX_IMAGE_WIDTH_IN_TWIPS || nHeight > MD_MAX_IMAGE_HEIGHT_IN_TWIPS) {
        const fScale = Math.min(MD_MAX_IMAGE_WIDTH_IN_TWIPS / nWidth, MD_MAX_IMAGE_HEIGHT_IN_TWIPS / nHeight);
        nWidth = Math.trunc(nWidth * fScale);
        nHeight = Math.trunc(nHeight * fScale);
      }
      if (nWidth < MD_MIN_IMAGE_WIDTH_IN_TWIPS && nWidth < MD_MIN_IMAGE_HEIGHT_IN_TWIPS) {
        nWidth = MD_MIN_IMAGE_WIDTH_IN_TWIPS;
        nHeight = MD_MIN_IMAGE_HEIGHT_IN_TWIPS;
      }
    }
    const graphic = this.m_xDoc.AddGraphic(bytes, m[1] || 'image/png');
    const name = `Image${++this.nImage}`;
    this.InsertText('');
    const pos = this.cur.Len();
    this.cur.InsertText(CH_TXTATR_BREAKWORD, pos);
    this.cur.SetAttr(pos, pos + 1, { RES_TXTATR_FLYCNT: { graphic, width: nWidth, height: nHeight, name, ...(img.desc ? { alt: img.desc } : {}) } });
    if (img.link) this.lost.add('links on images');
    this.m_bNoParSpace = true;
  }

  StartTable(detail: MD_DETAIL): void {
    this.newBlock();
    const nRow = (detail.body_row_count ?? 0) + (detail.head_row_count ?? 0), nCol = detail.col_count ?? 1;
    const nodes = this.m_xDoc.GetNodes();
    const body = this.coll('Table Contents'), head = this.coll('Table Heading');
    const table = nodes.InsertTable(this.cur.GetIndex(), nCol, body, Math.max(1, nRow), 1, head,
      { name: this.m_xDoc.GetUniqueTableName(), adjust: 'full', width: 0, leftSpace: 0, upper: 0, lower: 0 }, {}, true);
    const cells = table.m_pTable.GetTabLines().map((l) => l.m_aBoxes.map((b) => nodes.GoNext(b.m_pStartNode!.GetIndex())!));
    this.m_xTable = { cells, nCurRow: -1, nCurCol: -1, after: this.cur };
  }
  EndTable(): void {
    if (!this.m_xTable) return;
    this.cur = this.m_xTable.after;
    this.m_xTable = null;
    this.m_bNoParSpace = false;
  }
  StartRow(): void { if (this.m_xTable) { this.m_xTable.nCurRow++; this.m_xTable.nCurCol = -1; } }
  StartCell(align: MD_ALIGN | undefined): void {
    const t = this.m_xTable;
    if (!t) return;
    t.nCurCol++;
    const node = t.cells[t.nCurRow]?.[t.nCurCol];
    if (!node) return;
    node.m_aSet.RES_PARATR_ADJUST = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    this.cur = node;
  }

  // mdcallbcks.cxx
  readonly callbacks: MD_PARSER = {
    enter_block: (type, d) => {
      switch (type) {
        case MD_BLOCK.QUOTE: this.AddBlockQuote(); break;
        case MD_BLOCK.UL: case MD_BLOCK.OL: this.StartNumberedBulletList(type, d); break;
        case MD_BLOCK.LI: this.StartNumberedBulletListItem(d); break;
        case MD_BLOCK.HR: this.AddHR(); break;
        case MD_BLOCK.H: this.StartHeading(d.level ?? 1); break;
        case MD_BLOCK.CODE: this.BeginCodeBlock(); break;
        case MD_BLOCK.HTML: this.BeginHtmlBlock(); break;
        case MD_BLOCK.P: this.StartPara(); break;
        case MD_BLOCK.TABLE: this.StartTable(d); break;
        case MD_BLOCK.TR: this.StartRow(); break;
        case MD_BLOCK.TH: case MD_BLOCK.TD: this.StartCell(d.align); break;
      }
    },
    leave_block: (type) => {
      switch (type) {
        case MD_BLOCK.QUOTE: this.EndBlockQuote(); break;
        case MD_BLOCK.UL: case MD_BLOCK.OL: this.EndNumberedBulletList(); break;
        case MD_BLOCK.LI: this.EndNumberedBulletListItem(); break;
        case MD_BLOCK.HR: this.EndHR(); break;
        case MD_BLOCK.H: this.EndHeading(); break;
        case MD_BLOCK.CODE: this.EndCodeBlock(); break;
        case MD_BLOCK.HTML: this.EndHtmlBlock(); break;
        case MD_BLOCK.P: this.EndPara(); break;
        case MD_BLOCK.TABLE: this.EndTable(); break;
      }
    },
    enter_span: (type, d) => {
      let item: SwCharAttrSet | null = null;
      switch (type) {
        case MD_SPAN.EM: item = { RES_CHRATR_POSTURE: true }; break;
        case MD_SPAN.STRONG: item = { RES_CHRATR_WEIGHT: true }; break;
        case MD_SPAN.A: item = { RES_TXTATR_INETFMT: d.href ?? '' }; break;
        case MD_SPAN.IMG: {
          // Copy the link to the image, so it won't be lost for empty spans.
          const top = this.m_aAttrStack[this.m_aAttrStack.length - 1];
          this.m_aImg = { url: d.src ?? '', title: d.title ?? '', desc: '', link: top?.RES_TXTATR_INETFMT ?? '' };
          this.m_bInsideImage = true;
          break;
        }
        case MD_SPAN.CODE: item = { RES_CHRATR_FONT: this.coll('Preformatted Text').GetFormatAttr('RES_CHRATR_FONT') }; break;
        case MD_SPAN.DEL: item = { RES_CHRATR_CROSSEDOUT: true }; break;
        case MD_SPAN.WIKILINK: {
          const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0];
          item = { RES_TXTATR_INETFMT: `https://${lang}.wikipedia.org/wiki/${d.target ?? ''}` };
          break;
        }
        case MD_SPAN.U: item = { RES_CHRATR_UNDERLINE: 'single' }; break;
      }
      this.m_aAttrStack.push(item);
    },
    leave_span: (type) => {
      this.m_aAttrStack.pop();
      if (type === MD_SPAN.IMG) { this.InsertImage(); this.m_aImg = { url: '', title: '', desc: '', link: '' }; this.m_bInsideImage = false; }
    },
    text: (type, text) => {
      switch (type) {
        case MD_TEXT.HTML: this.m_htmlData += text; break;
        case MD_TEXT.CODE: case MD_TEXT.NORMAL: case MD_TEXT.ENTITY:
          if (!this.m_bInsideImage) this.InsertText(text);
          else this.m_aImg.desc += text;
          break;
        case MD_TEXT.BR: this.InsertText('\n'); break;
        case MD_TEXT.SOFTBR: this.InsertText(this.m_bInsideImage ? ' ' : CHAR_HARDBLANK); break;
        case MD_TEXT.LATEXMATH: this.lost.add('LaTeX formulas (their source is kept)'); this.InsertText(text); break;
      }
    },
  };

  /** CallParser */
  CallParser(text: string, parse: MdParse): void {
    this.SetTextFormatColl('Text Body');
    parse(text, this.callbacks);
    // The last paragraph is the empty one the last block ended with: drop it unless it is the only one.
    const nodes = this.m_xDoc.GetNodes();
    if (!this.cur.Len() && this.cur.GetIndex() > nodes.FirstTextNode().GetIndex() && nodes.node(this.cur.GetIndex() + 1) === nodes.GetEndOfContent()) {
      const prev = nodes.node(this.cur.GetIndex() - 1);
      if (prev.IsTextNode()) nodes.Remove(this.cur.GetIndex());
    }
  }
}

/** MarkdownReader::Read for a new document. */
export function ImportMarkdown(text: string, parse: MdParse): ImportResult {
  const p = new SwMarkdownParser();
  p.CallParser(text.replace(/^﻿/, ''), parse);
  return { doc: p.m_xDoc, lost: [...p.lost] };
}
