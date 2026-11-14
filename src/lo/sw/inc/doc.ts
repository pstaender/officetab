// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/doc.hxx reduced
// @upstream sw/source/core/doc/poolfmt.cxx reduced
// @upstream sw/source/core/doc/DocumentContentOperationsManager.cxx reduced
// @upstream sw/source/core/undo/docundo.cxx reduced
// @upstream sw/inc/undobj.hxx reduced
// @upstream sw/source/core/doc/docnum.cxx reduced
// @upstream sw/source/core/docnode/ndtbl.cxx reduced
// @upstream sw/source/core/doc/doc.cxx reduced
// @upstream sw/source/core/doc/DocumentLayoutManager.cxx partial
// Undo snapshots the touched node range instead of using upstream's per-operation SwUndo classes.
// Ranges are widened to whole sections, so tables are always restored complete.
import { NumberingType } from '../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { SwNodes } from './ndarr.ts';
import { TransliterationFlags } from '../../i18npool/source/transliteration/transliteration_body.ts';
import { SwTextFormatColl, SwCharFormat, type SwFormat } from './format.ts';
import { DEFAULT_PAGE_DESC, MakePoolPageDesc, SwPageDesc } from './pagedesc.ts';
import { SwPaM, SwPosition } from './pam.ts';
import { CH_TXTATR_BREAKWORD, LIST_KEYS, PARA_HIDDEN_PROPERTIES, PARA_OWN_KEYS, type SwAttrSet, type SwCharAttrSet, type SwField, type SwFlyCnt, type SwPostItField } from './hintids.ts';
import { GetNumRuleFromPool, MAXLEVEL, POOL_NUMRULES, SwNumRule } from './numrule.ts';
import { SwTextNode, type SwTextAttr } from './ndtxt.ts';
import { SwEndNode, SwSectionNode, SwStartNode, SwTableNode, type SwAreaKind, type SwNode, type SwSectionData } from './node.ts';
import { SwNodeType, SwStartNodeType } from './ndtyp.ts';
import { GetActualListLevel } from '../source/core/doc/list.ts';
import { AsCharFormat, ChainOf, FlyCntOf, RndStdIds, SwChainRet, TextFlyFormat, type SwAnchoredFly, type SwFlyFrameFormat } from './frmfmt.ts';
import { DocumentRedlineManager } from '../source/core/doc/DocumentRedlineManager.ts';
import { MarkManager, MarkType, type MarkSnap } from '../source/core/doc/docbm.ts';
import { AutoFormatPos, BoxBorders, type SwTableAutoFormat } from '../source/core/doc/tblafmt.ts';
import { BoxLanguage, BoxText, CalcFormula } from '../source/core/fields/cellfml.ts';
import { GetOutputString, GetType, IsNumberFormat, IsTextFormat, SvNumFormatType } from '../../svl/source/numbers/zforlist.ts';
import { SfxDocumentMetaData } from '../../sfx2/source/doc/SfxDocumentMetaData.ts';
import { SwGetSetExpType, SwInputFieldSubType, SwSetExpFieldType } from '../source/core/fields/expfld.ts';
import { SwUserFieldType } from '../source/core/fields/usrfld.ts';
import { ExpandSelection, lcl_Box2LeftBorder, lcl_LeftBorder2Box, lcl_ChangeRowSpan, lcl_SophisticatedFillLineIndices, lcl_UnMerge, SnapTable, SwTableBox, SwTableLine, TableFromSnap, SwTable, defaultBoxAttrs, type SwTableSnap } from './swtable.ts';

type NodeSnap =
  | { t: 'text'; text: string; hints: SwTextAttr[]; coll: SwTextFormatColl; set: SwAttrSet; flys: SwAnchoredFly[] }
  | { t: 'table'; table: SwTableSnap }
  | { t: 'section'; data: SwSectionData }
  | { t: 'start'; kind: SwStartNodeType; footnote: string; area: SwAreaKind; fly: string; desc: string }
  | { t: 'end' };
interface CursorSnap { node: number; content: number; markNode: number; markContent: number }

/** One changed node range: where it starts before and after the operation, and its nodes then. */
interface UndoPart { firstBefore: number; firstAfter: number; before: NodeSnap[]; after: NodeSnap[] }

/** vcl's FontFamily, as ODF names it (style:font-family-generic). */
export type FontFamily = 'roman' | 'swiss' | 'modern' | 'script' | 'decorative';

export interface SwUndo {
  kind: string;
  /** Disjoint ranges in ascending order; undo and redo apply them from the last to the first. */
  parts: UndoPart[];
  cursorBefore: CursorSnap;
  cursorAfter: CursorSnap;
  /** The rule table is copied, not diffed: rules are replaced, never changed in place. */
  numRulesBefore: Map<string, SwNumRule>;
  numRulesAfter: Map<string, SwNumRule>;
  /** Page anchored flys; their formats are replaced, never changed in place. */
  pageFlysBefore: SwFlyFrameFormat[];
  pageFlysAfter: SwFlyFrameFormat[];
  /** Paragraph styles, for operations that change them (SwUndoFormatAttr and friends). */
  collsBefore?: CollsSnap;
  collsAfter?: CollsSnap;
  /** The bookmarks, where any exist before or after (SwUndoInsBookmark and friends). */
  marksBefore?: MarkSnap[];
  marksAfter?: MarkSnap[];
  /** A compound step (SwUndoComments): its parts, undone last to first. */
  steps?: SwUndo[];
}

/** The paragraph styles, and with them the character styles and the document's default attributes. */
interface CollsSnap {
  table: Map<string, SwTextFormatColl>;
  colls: Map<SwTextFormatColl, { name: string; set: SwAttrSet; parent: SwFormat | null; next: SwTextFormatColl | null }>;
  charTable: Map<string, SwCharFormat>;
  chars: Map<SwCharFormat, { name: string; set: SwAttrSet; parent: SwFormat | null }>;
  defaults: SwAttrSet;
}

/** Where a fly is: its anchor paragraph and offset (none for page anchors), and its format. */
/** ShellResource::aCalc_Error (STR_CALC_ERROR): the text of a box whose formula cannot be calculated. */
/** The number ranges of captions (the SwSetExpFieldTypes of GST_SEQ a new document has). */
export const CAPTION_CATEGORIES = ['Illustration', 'Table', 'Text', 'Drawing', 'Figure'] as const;
export const SW_CALC_ERROR = '** Expression is faulty **';

/** T2T_PARA: text to table with one cell per paragraph. */
export const T2T_PARA = '\x0a';

/** SplitTable_HeadlineOption: what the second table of a split gets as its heading. */
export const SplitTable_HeadlineOption = { NONE: 0, BorderCopy: 1, ContentCopy: 2, BoxAttrCopy: 3, BoxAttrAllCopy: 4 } as const;
export type SplitTable_HeadlineOption = (typeof SplitTable_HeadlineOption)[keyof typeof SplitTable_HeadlineOption];

/** TableMergeErr */
export const TableMergeErr = { Ok: 0, NoSelection: 1, TooComplex: 2 } as const;
export type TableMergeErr = (typeof TableMergeErr)[keyof typeof TableMergeErr];

/** A paragraph of an object's text in the clipboard: its style by name, so it pastes into another document. */
export interface SwClipPara { text: string; hints: SwTextAttr[]; coll: string; set: SwAttrSet }
/**
 * The clipboard document of SwFEShell::Copy when an object is selected, reduced to that object:
 * its format (a copy), its graphic's data and, for text frames and shapes, the paragraphs of its text.
 */
export interface SwFlyClip { fmt: SwFlyFrameFormat; graphic?: { data: Uint8Array; mime: string }; text?: SwClipPara[] }

/**
 * A paragraph of an object's text for the clipboard. Footnotes, comments and objects anchored in
 * it are left out (their ids and names must stay unique), with their placeholder characters.
 */
function ClipPara(n: SwTextNode): SwClipPara {
  const drop = new Set<number>();
  for (const h of n.m_aHints) if (h.nEnd === h.nStart + 1 && (h.aAttrs.RES_TXTATR_FTN || h.aAttrs.RES_TXTATR_ANNOTATION || h.aAttrs.RES_TXTATR_FLYCNT)) drop.add(h.nStart);
  const map = (i: number) => { let k = 0; for (const d of drop) if (d < i) k++; return i - k; };
  let text = '';
  for (let i = 0; i < n.m_Text.length; i++) if (!drop.has(i)) text += n.m_Text[i];
  const hints: SwTextAttr[] = [];
  for (const h of n.m_aHints) {
    if (h.nEnd === h.nStart + 1 && drop.has(h.nStart)) continue;
    const aAttrs = { ...h.aAttrs };
    delete aAttrs.RES_TXTATR_ANNOTMARK;
    const nStart = map(h.nStart), nEnd = map(h.nEnd);
    if (nEnd > nStart && Object.keys(aAttrs).length) hints.push({ nStart, nEnd, aAttrs });
  }
  return { text, hints, coll: n.GetTextColl().m_aName, set: structuredClone(n.m_aSet) };
}

export interface SwFlyLocation { name: string; node?: SwTextNode; nContent?: number; fmt?: SwFlyFrameFormat; asChar?: SwFlyCnt }

function snap(n: SwNode): NodeSnap {
  if (n.IsTextNode()) {
    return { t: 'text', text: n.m_Text, hints: n.m_aHints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } })), coll: n.m_pColl, set: structuredClone(n.m_aSet), flys: n.m_aAnchoredFlys.map((f) => ({ ...f })) };
  }
  if (n.IsTableNode()) return { t: 'table', table: SnapTable((n as SwTableNode).m_pTable) };
  if (n.IsSectionNode()) return { t: 'section', data: structuredClone((n as SwSectionNode).m_pSection) };
  return n.IsStartNode() ? { t: 'start', kind: (n as SwStartNode).m_eStartNodeType, footnote: (n as SwStartNode).m_sFootnoteId, area: (n as SwStartNode).m_eAreaKind, fly: (n as SwStartNode).m_sFlyId, desc: (n as SwStartNode).m_sPageDesc } : { t: 'end' };
}

/** A view's position in a document: the cursor's (ViewLeft, ViewTop) and the visible area's top left corner, in twips. */
export interface SwViewData { nViewLeft: number; nViewTop: number; nVisibleLeft?: number; nVisibleTop?: number }
/** A changed node range: the nodes between `prev` and `next`, which both survived the change. */
export interface SwChangeRange { prev: SwNode | null; next: SwNode }

export class SwDoc {
  m_aNodes = new SwNodes();
  /** SwPageDescs, by name; the Default Page Style is always there. */
  m_aPageDescs = new Map<string, SwPageDesc>([[DEFAULT_PAGE_DESC, new SwPageDesc()]]);
  /** The Default Page Style. */
  get m_aPageDesc(): SwPageDesc { return this.m_aPageDescs.get(DEFAULT_PAGE_DESC)!; }
  m_aTextFormatColls = new Map<string, SwTextFormatColl>();
  m_aCharFormats = new Map<string, SwCharFormat>();
  /** IDocumentMarkAccess: the bookmarks. */
  m_pMarkManager = new MarkManager();
  getIDocumentMarkAccess(): MarkManager { return this.m_pMarkManager; }
  /** SwNumRuleTable, by name. Rules are immutable once inserted, so undo can share them. */
  m_aNumRules = new Map<string, SwNumRule>();
  private m_nListIdCounter = 0;
  /** Graphic data by key, shared by every as-character graphic that shows it. Entries are never removed while the document is open, so undo can bring a graphic back. */
  m_aGraphics = new Map<string, { data: Uint8Array; mime: string }>();
  /**
   * DocumentSettingId::PARA_SPACE_MAX (IDocumentSettingAccess): add the lower spacing of a paragraph
   * and the upper spacing of the next instead of taking the larger. Writer's documents add them;
   * Word's do unless w:doNotUseHTMLParagraphAutoSpacing is off.
   */
  m_bParaSpaceMax = true;
  /**
   * DocumentSettingId::PARA_SPACE_MAX_AT_PAGES: the upper spacing of a paragraph at the top of the
   * first page or after a break counts. On for new documents; off for ODF files that do not say.
   */
  m_bParaSpaceMaxAtPages = true;
  /** DocumentSettingId::HEADER_SPACING_BELOW_LAST_PARA: set for Word documents. */
  m_bHeaderSpacingBelowLastPara = false;
  /**
   * DocumentSettingId::TAB_OVER_SPACING and TAB_OVER_MARGIN (Word 2013+ and Word 2010 layout):
   * with the first only, the upper spacing of a paragraph at the top of a page other than the
   * first is ignored (SwFrame::IsCollapseUpper).
   */
  m_bTabOverSpacing = false;
  /**
   * DocumentSettingId::MATH_BASELINE_ALIGNMENT: formulas anchored as characters sit on the line's
   * baseline. On for new documents (and imported ones, SwDocShell::InitNew), off for ODF documents
   * without the setting.
   */
  m_bMathBaselineAlignment = true;
  /**
   * DocumentSettingId::PROTECT_BOOKMARKS and PROTECT_FIELDS (Tools > Protect Document): bookmarks
   * and fields cannot be deleted, neither by editing the text (SwPaM::HasReadonlySel) nor in the
   * Bookmark dialog.
   */
  m_bProtectBookmarks = false;
  m_bProtectFields = false;
  m_bTabOverMargin = false;
  /**
   * DocumentSettingId::PROP_LINE_SPACING_SHRINKS_FIRST_LINE: proportional line spacing below 100%
   * shrinks the first line of a paragraph too. New documents have it; ODT without it does not.
   */
  m_bPropLineSpacingShrinksFirstLine = true;
  /**
   * DocumentSettingManager::mnImagePreferredDPI (File > Properties > General): the resolution
   * images are inserted at and that Graphic Size Check compares with; 0 for none.
   */
  m_nImagePreferredDPI = 0;
  /**
   * The document shell's part (SwDocShell is not ported): the document properties
   * (SfxObjectShell::getDocProperties), whether saving records the user (IsUseUserData, the
   * ApplyUserData setting), when editing time was last counted (SfxObjectShell_Impl::nTime), and
   * whether closing saves a new version (SfxObjectShell_Impl::bSaveVersionOnClose).
   */
  m_xDocProps = new SfxDocumentMetaData();
  m_bUseUserData = true;
  m_bSaveVersionOnClose = false;
  m_nTime = new Date();
  /**
   * The view settings of settings.xml (SwView::ReadUserDataSequence and WriteUserDataSequence's
   * ViewLeft, ViewTop, VisibleLeft, VisibleTop): where the cursor and the visible area were, in
   * twips. Read from the file; written from `m_fnGetViewData` when a view gives them, as the
   * document's controller does upstream (SwXMLExport::GetViewSettings).
   */
  m_aViewData: SwViewData | null = null;
  m_fnGetViewData: (() => SwViewData | null) | null = null;
  /**
   * SwDoc::SetDefault: the document's default attributes, which every style falls back to before
   * the pool's (ODF style:default-style). Set them before the document is laid out.
   */
  m_aDefaults: SwAttrSet = {};
  /**
   * The family of each font the document names (SvxFontItem's FontFamily: roman for serif fonts,
   * swiss for sans-serif ones, modern for monospaced ones, script, decorative), from the file's font
   * table; it decides the fallback for a font the system does not have.
   */
  m_aFontFamilies = new Map<string, FontFamily>();
  /** The user field types (SwUserFieldType), by name. */
  m_aUserFieldTypes = new Map<string, SwUserFieldType>();
  /** The variables' field types (SwSetExpFieldType other than number ranges), by name. */
  m_aSetExpFieldTypes = new Map<string, SwSetExpFieldType>();
  /** Tracked changes (IDocumentRedlineAccess). */
  m_pDocumentRedlineManager = new DocumentRedlineManager(this);
  /** Page anchored flys (the FLY_AT_PAGE part of SwDoc's SpzFrameFormats). */
  m_aPageFlys: SwFlyFrameFormat[] = [];
  /** Bumped when a style changes, so that layouts cached per paragraph are redone. */
  m_nFormatVersion = 0;
  m_aUndo: SwUndo[] = [];
  m_aRedo: SwUndo[] = [];
  private m_aListeners = new Set<() => void>();
  /** Undo depth at the last save, for the modified flag; -1 once that state is unreachable. */
  private m_nSavedDepth = 0;

  constructor() {
    const standard = this.MakeColl('Standard', null);
    const body = this.MakeColl('Text Body', standard, { RES_UL_SPACE: { upper: 0, lower: 140 } });
    const heading = this.MakeColl('Heading', standard, {
      RES_CHRATR_FONT: 'Liberation Sans', RES_CHRATR_FONTSIZE: 280, RES_UL_SPACE: { upper: 240, lower: 120 }, RES_KEEP: true,
    });
    heading.m_pNextTextFormatColl = body;
    const sizes: [number, number, boolean][] = [[1, 360, true], [2, 320, true], [3, 280, true], [4, 240, true], [5, 220, true], [6, 200, true]];
    for (const [lvl, size, bold] of sizes) {
      this.MakeColl(`Heading ${lvl}`, heading, { RES_CHRATR_FONTSIZE: size, RES_CHRATR_WEIGHT: bold }).m_pNextTextFormatColl = body;
    }
    this.MakeColl('Title', heading, { RES_CHRATR_FONTSIZE: 560, RES_CHRATR_WEIGHT: true, RES_PARATR_ADJUST: 'center' }).m_pNextTextFormatColl = body;
    this.MakeColl('Subtitle', heading, { RES_CHRATR_FONTSIZE: 360, RES_PARATR_ADJUST: 'center' }).m_pNextTextFormatColl = body;
    this.MakeColl('Quotations', standard, { RES_LR_SPACE: { left: 567, right: 567, firstLine: 0 }, RES_UL_SPACE: { upper: 0, lower: 283 } });
    this.MakeColl('Preformatted Text', standard, { RES_CHRATR_FONT: 'Liberation Mono', RES_CHRATR_FONTSIZE: 200, RES_UL_SPACE: { upper: 0, lower: 0 } });
    // RES_POOLCOLL_HTML_HR: a grey bottom border (double upstream), 6 pt, HTML_PARSPACE below.
    this.MakeColl('Horizontal Line', standard, { RES_BOX: { top: null, left: null, right: null, bottom: { color: '#808080', width: 30 }, padding: 0 }, RES_PARATR_CONNECT_BORDER: false, RES_CHRATR_FONTSIZE: 120, RES_UL_SPACE: { upper: 0, lower: 283 } }).m_pNextTextFormatColl = body;
    // RES_POOLCOLL_HEADERFOOTER, RES_POOLCOLL_HEADER and RES_POOLCOLL_FOOTER, with centre and right tabs.
    const pw = this.m_aPageDesc.PrintWidth();
    const hf = this.MakeColl('Header and Footer', standard, {
      RES_PARATR_TABSTOP: [{ pos: Math.trunc(pw / 2), adjust: 'center', fill: ' ', decimal: '.' }, { pos: pw, adjust: 'right', fill: ' ', decimal: '.' }],
    });
    this.MakeColl('Header', hf);
    this.MakeColl('Footer', hf);
    // RES_POOLCOLL_FOOTNOTE: 6 mm hanging indent, 10 pt.
    this.MakeColl('Footnote', standard, { RES_LR_SPACE: { left: 340, right: 0, firstLine: -340 }, RES_CHRATR_FONTSIZE: 200 });
    // RES_POOLCOLL_ENDNOTE: as the footnote style.
    this.MakeColl('Endnote', standard, { RES_LR_SPACE: { left: 340, right: 0, firstLine: -340 }, RES_CHRATR_FONTSIZE: 200 });
    // RES_POOLCOLL_FRAME
    this.MakeColl('Frame Contents', standard);
    // RES_POOLCOLL_TABLE and RES_POOLCOLL_TABLE_HDLN
    const tableContents = this.MakeColl('Table Contents', standard);
    this.MakeColl('Table Heading', tableContents, { RES_PARATR_ADJUST: 'center', RES_CHRATR_WEIGHT: true });
    // RES_POOLCOLL_LABEL: 6 pt above and below, italic, 10 pt; and the captions of each category
    // (RES_POOLCOLL_LABEL_ABB, _TABLE, _FRAME, _DRAWING, _FIGURE), named as their number ranges.
    const label = this.MakeColl('Caption', standard, { RES_UL_SPACE: { upper: 120, lower: 120 }, RES_CHRATR_POSTURE: true, RES_CHRATR_FONTSIZE: 200 });
    for (const name of CAPTION_CATEGORIES) this.MakeColl(name, label);
    this.m_aNodes.MakeTextNode(this.m_aNodes.GetEndOfContent().GetIndex(), standard);
    // RES_POOLCHR_*: the character styles the Styles menu applies.
    const dflt = new SwCharFormat('Default Character Style');
    this.m_aCharFormats.set(dflt.GetName(), dflt);
    for (const [name, set] of [
      ['Emphasis', { RES_CHRATR_POSTURE: true }], ['Strong Emphasis', { RES_CHRATR_WEIGHT: true }],
      ['Citation', { RES_CHRATR_POSTURE: true }], ['Source Text', { RES_CHRATR_FONT: 'Liberation Mono' }],
    ] as const) this.m_aCharFormats.set(name, new SwCharFormat(name, dflt, { ...set }));
  }

  FindCharFormatByName(name: string): SwCharFormat | undefined { return this.m_aCharFormats.get(name); }

  /** RES_POOLCHR_TOXJUMP: "Index Link", the character style of an index's links, without attributes. */
  GetIndexLinkFormat(): SwCharFormat { return this.FindCharFormatByName('Index Link') ?? this.MakeCharFormat('Index Link'); }

  /** SwDoc::FindPageDesc, creating pool page styles on first use (GetPageDescFromPool). */
  FindPageDesc(name: string): SwPageDesc | undefined {
    let d = this.m_aPageDescs.get(name);
    if (!d) {
      const made = MakePoolPageDesc(name, this.m_aPageDesc);
      if (made) { this.m_aPageDescs.set(name, made); d = made; }
    }
    return d;
  }

  /** SwDoc::MakePageDesc: a new page style copied from another. */
  MakePageDesc(name: string, base: SwPageDesc = this.m_aPageDesc, follow = name): SwPageDesc {
    const d = base.Clone(name, follow);
    this.m_aPageDescs.set(name, d);
    return d;
  }

  MakeCharFormat(name: string, set: SwAttrSet = {}): SwCharFormat {
    const f = new SwCharFormat(name, this.m_aCharFormats.get('Default Character Style') ?? null, set);
    f.m_pDefaults = this.m_aDefaults;
    this.m_aCharFormats.set(name, f);
    return f;
  }

  MakeColl(name: string, parent: SwTextFormatColl | null, set: SwAttrSet = {}): SwTextFormatColl {
    const c = new SwTextFormatColl(name, parent, set);
    c.m_pDefaults = this.m_aDefaults;
    this.m_aTextFormatColls.set(name, c);
    return c;
  }

  FindTextFormatCollByName(name: string): SwTextFormatColl | undefined { return this.m_aTextFormatColls.get(name); }

  // --- numbering rules (docnum.cxx) ---
  FindNumRulePtr(name: string): SwNumRule | undefined {
    if (!name) return undefined;
    const r = this.m_aNumRules.get(name);
    if (r) return r;
    // Pool list styles are created on first use, as GetNumRuleFromPool does.
    if ((POOL_NUMRULES as readonly string[]).includes(name)) {
      const p = GetNumRuleFromPool(name as (typeof POOL_NUMRULES)[number]);
      this.m_aNumRules.set(name, p);
      return p;
    }
    return undefined;
  }

  /** Inserts or replaces a rule by name. Call inside a recorded operation so undo restores the old one. */
  PutNumRule(rule: SwNumRule): void { this.m_aNumRules.set(rule.GetName(), rule); }

  GetUniqueNumRuleName(): string {
    let n = this.m_aNumRules.size + 1;
    while (this.m_aNumRules.has(`Numbering ${n}`)) n++;
    return `Numbering ${n}`;
  }

  /** SwDoc::CreateListId */
  CreateListId(): string {
    let id: string;
    do id = `list${++this.m_nListIdCounter}`; while ([...this.allText()].some((n) => n.m_aSet.RES_PARATR_LIST_ID === id));
    return id;
  }

  *allText(): Generator<SwTextNode> {
    for (let n = this.m_aNodes.GoNext(0); n; n = this.m_aNodes.GoNext(n.GetIndex())) yield n; // headers and footers too
  }
  GetNodes(): SwNodes { return this.m_aNodes; }

  // --- change notification (stands in for SwModify/SwClient at document level) ---
  Subscribe(f: () => void): () => void { this.m_aListeners.add(f); return () => this.m_aListeners.delete(f); }
  /** Counts the changes the listeners were told of: the layout knows whether it saw the last one. */
  m_nChangeSeq = 0;
  /**
   * The node ranges the last change touched, each by the surviving nodes around it (standing in
   * for upstream's frames, which invalidate themselves when their content changes): the layout
   * lays out again only from there. Null when not known (styles, page styles, undo), so that the
   * whole document is laid out again; empty when nothing that is laid out changed.
   */
  m_aLastChangeRanges: SwChangeRange[] | null = null;
  Changed(ranges: SwChangeRange[] | null = null): void {
    this.m_nChangeSeq++;
    this.m_aLastChangeRanges = ranges;
    for (const f of this.m_aListeners) f();
  }

  IsModified(): boolean { return this.m_aUndo.length !== this.m_nSavedDepth; }
  SetUnmodified(): void { this.m_nSavedDepth = this.m_aUndo.length; }
  /** SetModified for changes outside undo, such as the document properties: modified until saved. */
  SetModified(): void { this.m_nSavedDepth = -1; this.Changed(); }

  // --- undo ---
  private cursorSnap(p: SwPaM): CursorSnap {
    return { node: p.GetPoint().GetNodeIndex(), content: p.GetPoint().GetContentIndex(), markNode: p.GetMark().GetNodeIndex(), markContent: p.GetMark().GetContentIndex() };
  }

  /** Widens [first, last] until every start node in it has its end node in it and vice versa. */
  private balance(first: number, last: number): [number, number] {
    const nodes = this.m_aNodes;
    for (let changed = true; changed;) {
      changed = false;
      for (let i = first; i <= last; i++) {
        const n = nodes.node(i);
        if (n.IsEndNode()) {
          const s = n.m_pStartOfSection!.GetIndex();
          if (s < first) { first = s; changed = true; }
        } else if (n.IsStartNode()) {
          const e = (n as SwStartNode).EndOfSectionNode().GetIndex();
          if (e > last) { last = e; changed = true; }
        }
      }
    }
    return [first, last];
  }

  /** Runs `op`, which must only change nodes in [first, last + delta], delta being the change in node count. */
  recorded(kind: string, pam: SwPaM, first: number, last: number, op: () => void, merge = false): void {
    this.recordedRanges(kind, pam, [[first, last]], op, merge);
  }

  /**
   * Runs `op`, which may change several disjoint node ranges (an empty range, last = first - 1,
   * marks a place where nodes are inserted). The nodes around each range must survive `op`.
   */
  recordedRanges(kind: string, pam: SwPaM, ranges: [number, number][], op: () => void, merge = false): void {
    const nodes = this.m_aNodes;
    const spans = ranges.map(([f, l]) => (l < f ? [f, l] : this.balance(f, l)) as [number, number]).sort((a, b) => a[0] - b[0]);
    const pending = spans.map(([f, l]) => {
      const before: NodeSnap[] = [];
      for (let i = f; i <= l; i++) before.push(snap(nodes.node(i)));
      return { firstBefore: f, before, prev: f > 0 ? nodes.node(f - 1) : null, next: nodes.node(l + 1) };
    });
    const cursorBefore = this.cursorSnap(pam);
    const numRulesBefore = new Map(this.m_aNumRules);
    const pageFlysBefore = [...this.m_aPageFlys];
    const marksBefore = this.m_pMarkManager.getAllMarksCount() ? this.m_pMarkManager.Snapshot() : undefined;
    op();
    const parts: UndoPart[] = pending.map((p) => {
      const firstAfter = p.prev ? p.prev.GetIndex() + 1 : 0;
      const after: NodeSnap[] = [];
      for (let i = firstAfter; i < p.next.GetIndex(); i++) after.push(snap(nodes.node(i)));
      return { firstBefore: p.firstBefore, firstAfter, before: p.before, after };
    });
    const cursorAfter = this.cursorSnap(pam);
    const numRulesAfter = new Map(this.m_aNumRules);
    const pageFlysAfter = [...this.m_aPageFlys];
    const marksAfter = marksBefore || this.m_pMarkManager.getAllMarksCount() ? this.m_pMarkManager.Snapshot() : undefined;
    const top = this.m_aUndo[this.m_aUndo.length - 1];
    const one = parts.length === 1 ? parts[0]! : null;
    const topOne = top?.parts.length === 1 ? top.parts[0]! : null;
    if (merge && one && topOne && top!.kind === kind && topOne.firstAfter === one.firstBefore && topOne.after.length === 1 && one.after.length === 1
      && top!.cursorAfter.node === cursorBefore.node && top!.cursorAfter.content === cursorBefore.content
      && this.m_nSavedDepth !== this.m_aUndo.length) {
      topOne.after = one.after;
      top!.cursorAfter = cursorAfter;
      top!.pageFlysAfter = pageFlysAfter;
      if (marksAfter) { top!.marksBefore ??= marksBefore ?? []; top!.marksAfter = marksAfter; }
    } else {
      // A save point that lies in the discarded redo branch can no longer be reached.
      if (this.m_nSavedDepth > this.m_aUndo.length) this.m_nSavedDepth = -1;
      this.m_aUndo.push({ kind, parts, cursorBefore, cursorAfter, numRulesBefore, numRulesAfter, pageFlysBefore, pageFlysAfter, ...(marksAfter ? { marksBefore: marksBefore ?? [], marksAfter } : {}) });
    }
    this.m_aRedo.length = 0;
    // The layout follows the ranges changed; a page anchored object added or removed changes pages anywhere.
    const pageFlysSame = pageFlysBefore.length === pageFlysAfter.length && pageFlysBefore.every((f, i) => f === pageFlysAfter[i]);
    this.Changed(pageFlysSame ? pending.map((p) => ({ prev: p.prev, next: p.next })) : null);
  }

  /** Replaces the `currentCount` nodes at `first` with nodes rebuilt from `target`. */
  private restore(first: number, currentCount: number, target: NodeSnap[]): void {
    const nodes = this.m_aNodes;
    // In place when only text changes, so that positions and cached layouts survive.
    if (currentCount === target.length && target.every((t, i) => t.t === 'text' && nodes.node(first + i).IsTextNode())) {
      target.forEach((t, i) => this.fill(nodes.node(first + i) as SwTextNode, t as Extract<NodeSnap, { t: 'text' }>));
      return;
    }
    // Remember registered positions by text node ordinal, to move them to the rebuilt nodes.
    const moved: { pos: SwPosition; ordinal: number }[] = [];
    let ordinal = 0;
    for (let i = 0; i < currentCount; i++) {
      const n = nodes.node(first + i);
      if (n.IsTextNode()) { for (const p of n.m_aIndices) moved.push({ pos: p, ordinal }); ordinal++; }
    }
    const parent = nodes.SectionAt(first);
    nodes.Remove(first, currentCount);
    const stack: SwStartNode[] = [parent];
    const boxQueues = new Map<SwTableNode, SwTableBox[]>();
    const texts: SwTextNode[] = [];
    let at = first;
    for (const t of target) {
      const up = stack[stack.length - 1]!;
      let n: SwNode;
      if (t.t === 'text') {
        const tn = new SwTextNode(nodes, t.coll);
        this.fill(tn, t);
        texts.push(tn);
        n = tn;
      } else if (t.t === 'table') {
        const tn = new SwTableNode(nodes, TableFromSnap(t.table));
        boxQueues.set(tn, tn.m_pTable.GetTabSortBoxes());
        stack.push(tn);
        n = tn;
      } else if (t.t === 'section') {
        const sn = new SwSectionNode(nodes, structuredClone(t.data));
        stack.push(sn);
        n = sn;
      } else if (t.t === 'start') {
        const sn = new SwStartNode(nodes, SwNodeType.Start, t.kind);
        sn.m_sFootnoteId = t.footnote;
        sn.m_sFlyId = t.fly;
        sn.m_sPageDesc = t.desc;
        sn.m_eAreaKind = t.area;
        const box = up.IsTableNode() ? boxQueues.get(up as SwTableNode)?.shift() : undefined;
        if (box) box.m_pStartNode = sn;
        stack.push(sn);
        n = sn;
      } else {
        const start = stack.pop()!;
        n = new SwEndNode(nodes, start);
        nodes.Insert(n, at++);
        continue;
      }
      n.m_pStartOfSection = up;
      nodes.Insert(n, at++);
    }
    for (const { pos, ordinal: o } of moved) {
      const tn = texts[Math.min(o, texts.length - 1)];
      if (tn) pos.Assign(tn, Math.min(pos.m_nContent, tn.Len()));
    }
  }

  private fill(n: SwTextNode, s: Extract<NodeSnap, { t: 'text' }>): void {
    n.m_Text = s.text;
    n.m_aHints = s.hints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } }));
    n.m_pColl = s.coll;
    n.m_aSet = structuredClone(s.set);
    n.m_aAnchoredFlys = s.flys.map((f) => ({ ...f }));
    n.m_nVersion++;
    for (const p of n.m_aIndices) if (p.m_nContent > n.Len()) p.m_nContent = n.Len();
  }

  private restoreMarks(s: MarkSnap[]): void {
    const nodes = this.m_aNodes;
    this.m_pMarkManager.Restore(s, (i) => { const n = i < nodes.Count() ? nodes.node(i) : null; return n?.IsTextNode() ? n : null; });
  }

  private applyCursor(pam: SwPaM, c: CursorSnap): void {
    const nodes = this.m_aNodes;
    pam.GetPoint().Assign(nodes.node(c.node) as SwTextNode, c.content);
    pam.GetMark().Assign(nodes.node(c.markNode) as SwTextNode, c.markContent);
  }

  private snapColls(): CollsSnap {
    const colls = new Map<SwTextFormatColl, { name: string; set: SwAttrSet; parent: SwFormat | null; next: SwTextFormatColl | null }>();
    for (const c of this.m_aTextFormatColls.values()) colls.set(c, { name: c.m_aName, set: structuredClone(c.m_aSet), parent: c.m_pDerivedFrom, next: c.m_pNextTextFormatColl });
    const chars = new Map<SwCharFormat, { name: string; set: SwAttrSet; parent: SwFormat | null }>();
    for (const c of this.m_aCharFormats.values()) chars.set(c, { name: c.m_aName, set: structuredClone(c.m_aSet), parent: c.m_pDerivedFrom });
    return { table: new Map(this.m_aTextFormatColls), colls, charTable: new Map(this.m_aCharFormats), chars, defaults: structuredClone(this.m_aDefaults) };
  }

  private restoreColls(s: CollsSnap): void {
    this.m_aTextFormatColls = new Map(s.table);
    for (const [c, v] of s.colls) { c.m_aName = v.name; c.m_aSet = structuredClone(v.set); c.m_pDerivedFrom = v.parent; c.m_pNextTextFormatColl = v.next; }
    this.m_aCharFormats = new Map(s.charTable);
    for (const [c, v] of s.chars) { c.m_aName = v.name; c.m_aSet = structuredClone(v.set); c.m_pDerivedFrom = v.parent; }
    // The defaults object is shared by every format (m_pDefaults): restored in place.
    for (const k of Object.keys(this.m_aDefaults)) delete (this.m_aDefaults as Record<string, unknown>)[k];
    Object.assign(this.m_aDefaults, structuredClone(s.defaults));
    this.m_nFormatVersion++;
  }

  /** Runs a style change, with the nodes in `ranges` it also changes, as one undo step. */
  private recordedStyles(kind: string, pam: SwPaM, ranges: [number, number][], op: () => void): void {
    const before = this.snapColls();
    this.recordedRanges(kind, pam, ranges, () => { op(); this.m_nFormatVersion++; });
    const u = this.m_aUndo[this.m_aUndo.length - 1]!;
    u.collsBefore = before;
    u.collsAfter = this.snapColls();
  }

  /** SwDoc::ChgFormat for a paragraph style: its attributes, name, parent and follow style. */
  ChgFormatColl(pam: SwPaM, coll: SwTextFormatColl, change: { set?: SwAttrSet; name?: string; parent?: SwTextFormatColl | null; next?: SwTextFormatColl | null }): void {
    this.recordedStyles('style-change', pam, [], () => {
      if (change.set) coll.m_aSet = { ...change.set };
      if (change.parent !== undefined && change.parent !== coll && !this.derivesFrom(change.parent, coll)) coll.m_pDerivedFrom = change.parent;
      if (change.next !== undefined) coll.m_pNextTextFormatColl = change.next;
      if (change.name && change.name !== coll.GetName() && !this.m_aTextFormatColls.has(change.name)) {
        this.m_aTextFormatColls.delete(coll.GetName());
        coll.m_aName = change.name;
        this.m_aTextFormatColls.set(change.name, coll);
      }
    });
  }

  private derivesFrom(a: SwFormat | null, b: SwFormat): boolean {
    for (let f = a; f; f = f.m_pDerivedFrom) if (f === b) return true;
    return false;
  }

  /**
   * SwDocShell::MakeByExample (New Style from Selection): a style derived from the paragraph's,
   * holding its direct formatting, which the paragraphs of the selection then drop.
   */
  MakeCollByExample(pam: SwPaM, name: string, chars: SwCharAttrSet): SwTextFormatColl | null {
    if (!name || this.m_aTextFormatColls.has(name)) return null;
    const n = pam.GetPoint().GetNode();
    const s = pam.Start().GetNodeIndex(), e = pam.End().GetNodeIndex();
    let made: SwTextFormatColl | null = null;
    this.recordedStyles('style-new', pam, [[s, e]], () => {
      made = this.MakeColl(name, n.GetTextColl(), { ...structuredClone(n.m_aSet), ...chars });
      made.m_pNextTextFormatColl = n.GetTextColl().m_pNextTextFormatColl === n.GetTextColl() ? made : n.GetTextColl().m_pNextTextFormatColl;
      for (let i = s; i <= e; i++) {
        const t = this.m_aNodes.node(i);
        if (t.IsTextNode()) { t.m_pColl = made; t.m_aSet = Object.fromEntries(Object.entries(t.m_aSet).filter(([k]) => (PARA_OWN_KEYS as readonly string[]).includes(k))); t.m_nVersion++; }
      }
    });
    return made;
  }

  /** SwDocShell::UpdateStyle (Update Selected Style): the paragraph's direct formatting moves into its style. */
  UpdateCollByExample(pam: SwPaM, chars: SwCharAttrSet): void {
    const n = pam.GetPoint().GetNode(), coll = n.GetTextColl();
    const idx = n.GetIndex();
    this.recordedStyles('style-update', pam, [[idx, idx]], () => {
      const direct = Object.fromEntries(Object.entries(n.m_aSet).filter(([k]) => !(PARA_OWN_KEYS as readonly string[]).includes(k)));
      coll.m_aSet = { ...coll.m_aSet, ...structuredClone(direct), ...chars };
      n.m_aSet = Object.fromEntries(Object.entries(n.m_aSet).filter(([k]) => (PARA_OWN_KEYS as readonly string[]).includes(k)));
      n.m_nVersion++;
    });
  }

  /**
   * SvXMLStylesContext::CopyStylesToDoc in the styles-only mode of the ODF import
   * (SwXMLImport::setStyleInsertMode), reduced: the styles of `src`, a document the import has
   * read, are copied into this one by name. A style this document has keeps its attributes
   * unless `bOverwrite`; otherwise (and for a new style) it gets the source's attributes, its
   * parent and follow style by name when this document has them (FinishStyles), else none. The
   * text styles are the paragraph and character styles; with `bOverwrite` they also bring the
   * default attributes (SetDefaults). List styles are copied without the automatic ones of the
   * content. Page styles bring their page format, not their headers' and footers' content.
   * Upstream cannot undo loading page styles and deletes the undo history then; otherwise the
   * text and list styles are one undo step.
   */
  LoadStyles(pam: SwPaM, src: SwDoc, opt: { bText: boolean; bPage: boolean; bNum: boolean; bOverwrite: boolean }): void {
    const { bText, bPage, bNum, bOverwrite } = opt;
    // XMLPropStyleContext::CreateAndInsert: a style this document has is changed only when overwriting.
    const take = (has: boolean) => bOverwrite || !has;
    const op = () => {
      if (bText) {
        if (bOverwrite) {
          for (const k of Object.keys(this.m_aDefaults)) delete (this.m_aDefaults as Record<string, unknown>)[k];
          Object.assign(this.m_aDefaults, structuredClone(src.m_aDefaults));
        }
        // pass 1: create the styles (CreateAndInsert); their parents are cleared.
        const colls: [SwTextFormatColl, SwTextFormatColl][] = [];
        for (const s of src.m_aTextFormatColls.values()) {
          const mine = this.m_aTextFormatColls.get(s.GetName());
          if (!take(!!mine)) continue;
          const d = mine ?? this.MakeColl(s.GetName(), null);
          d.m_aSet = structuredClone(s.m_aSet);
          d.m_pDerivedFrom = null;
          colls.push([s, d]);
        }
        const chars: [SwCharFormat, SwCharFormat][] = [];
        for (const s of src.m_aCharFormats.values()) {
          const mine = this.m_aCharFormats.get(s.GetName());
          if (!take(!!mine)) continue;
          const d = mine ?? this.MakeCharFormat(s.GetName());
          d.m_aSet = structuredClone(s.m_aSet);
          d.m_pDerivedFrom = null;
          chars.push([s, d]);
        }
        // pass 3: FinishStyles connects the parents and follow styles found in this document.
        for (const [s, d] of colls) {
          const parent = s.m_pDerivedFrom ? this.m_aTextFormatColls.get(s.m_pDerivedFrom.GetName()) : undefined;
          d.m_pDerivedFrom = parent && parent !== d && !this.derivesFrom(parent, d) ? parent : null;
          d.m_pNextTextFormatColl = s.m_pNextTextFormatColl ? this.m_aTextFormatColls.get(s.m_pNextTextFormatColl.GetName()) ?? null : null;
        }
        for (const [s, d] of chars) {
          const parent = s.m_pDerivedFrom ? this.m_aCharFormats.get(s.m_pDerivedFrom.GetName()) : undefined;
          d.m_pDerivedFrom = parent && parent !== d && !this.derivesFrom(parent, d) ? parent : null;
        }
        for (const [k, v] of src.m_aFontFamilies) if (!this.m_aFontFamilies.has(k)) this.m_aFontFamilies.set(k, v);
      }
      // pass 2: the list styles (CreateAndInsertLate). Rules are never changed in place: shared.
      if (bNum) for (const [name, r] of src.m_aNumRules) if (!r.IsAutoRule() && take(this.m_aNumRules.has(name))) this.m_aNumRules.set(name, r);
      if (bPage) {
        for (const [name, s] of src.m_aPageDescs) {
          const mine = this.m_aPageDescs.get(name);
          if (!take(!!mine)) continue;
          this.m_aPageDescs.set(name, s.Clone(name, s.m_sFollow));
        }
      }
    };
    if (bPage) {
      op();
      this.m_aUndo.length = 0;
      this.m_aRedo.length = 0;
      // The state at the last save can no longer be reached by undoing.
      this.m_nSavedDepth = -1;
      this.m_nFormatVersion++;
      this.Changed();
    } else this.recordedStyles('style-load', pam, [], op);
  }

  /** Joins the last two undo steps into one (several operations the user did as one action). */
  MergeLastUndo(): void {
    const b = this.m_aUndo.pop(), a = this.m_aUndo[this.m_aUndo.length - 1];
    if (!a || !b) { if (b) this.m_aUndo.push(b); return; }
    this.m_aUndo[this.m_aUndo.length - 1] = {
      kind: a.kind, parts: [], cursorBefore: a.cursorBefore, cursorAfter: b.cursorAfter, numRulesBefore: a.numRulesBefore, numRulesAfter: b.numRulesAfter,
      pageFlysBefore: a.pageFlysBefore, pageFlysAfter: b.pageFlysAfter, collsBefore: a.collsBefore, collsAfter: b.collsAfter, steps: [a, b],
    };
  }

  private undoStep(pam: SwPaM, u: SwUndo): void {
    if (u.steps) { for (const st of [...u.steps].reverse()) this.undoStep(pam, st); return; }
    if (u.collsBefore) this.restoreColls(u.collsBefore);
    for (const p of [...u.parts].reverse()) this.restore(p.firstAfter, p.after.length, p.before);
    this.m_aNumRules = new Map(u.numRulesBefore);
    this.m_aPageFlys = [...u.pageFlysBefore];
    if (u.marksBefore) this.restoreMarks(u.marksBefore);
    this.applyCursor(pam, u.cursorBefore);
  }

  private redoStep(pam: SwPaM, u: SwUndo): void {
    if (u.steps) { for (const st of u.steps) this.redoStep(pam, st); return; }
    if (u.collsAfter) this.restoreColls(u.collsAfter);
    for (const p of [...u.parts].reverse()) this.restore(p.firstBefore, p.before.length, p.after);
    this.m_aNumRules = new Map(u.numRulesAfter);
    this.m_aPageFlys = [...u.pageFlysAfter];
    if (u.marksAfter) this.restoreMarks(u.marksAfter);
    this.applyCursor(pam, u.cursorAfter);
  }

  Undo(pam: SwPaM): boolean {
    const u = this.m_aUndo.pop();
    if (!u) return false;
    this.undoStep(pam, u);
    this.m_aRedo.push(u);
    this.Changed();
    return true;
  }

  Redo(pam: SwPaM): boolean {
    const u = this.m_aRedo.pop();
    if (!u) return false;
    this.redoStep(pam, u);
    this.m_aUndo.push(u);
    this.Changed();
    return true;
  }

  // --- content operations (IDocumentContentOperations) ---

  /** Inserts at the point, replacing any selection first. */
  InsertString(pam: SwPaM, text: string, attrs?: SwCharAttrSet): void {
    const rdl = this.m_pDocumentRedlineManager;
    if (pam.HasMark()) {
      this.DeleteAndJoin(pam);
      // With changes recorded, the new text follows the text it replaces.
      if (rdl.IsRedlineOn()) this.SkipDeleted(pam);
    }
    if (rdl.IsRedlineOn()) attrs = { ...attrs, RES_TXTATR_REDLINE: rdl.NewData('Insert') };
    const pt = pam.GetPoint();
    const idx = pt.GetNodeIndex();
    // SwUndoInsert::CanGrouping: only runs of the same class (word characters or delimiters) group.
    const kind = /^[\p{L}\p{N}]+$/u.test(text) ? 'insert-word' : 'insert-delim';
    this.recorded(kind, pam, idx, idx, () => {
      const start = pt.GetContentIndex();
      pt.GetNode().InsertText(text, start);
      if (attrs) pt.GetNode().SetAttr(start, start + text.length, attrs);
    }, true);
  }

  /**
   * DocumentContentOperationsManager::ReplaceRange, reduced to a selection within one paragraph:
   * the new text keeps the attributes of the text it replaces. With changes recorded, the old text
   * becomes a tracked deletion followed by the new text as an insertion.
   */
  ReplaceRange(pam: SwPaM, text: string): void {
    const s = pam.Start(), e = pam.End();
    if (this.m_pDocumentRedlineManager.IsRedlineOn() || s.GetNode() !== e.GetNode()) { this.InsertString(pam, text); return; }
    const node = s.GetNode(), idx = node.GetIndex(), pos = s.GetContentIndex(), len = e.GetContentIndex() - pos;
    this.recorded('replace', pam, idx, idx, () => {
      node.ReplaceTextOnly(pos, len, text);
      pam.GetPoint().Assign(node, pos + text.length);
      pam.DeleteMark();
    });
  }

  /**
   * DocumentContentOperationsManager::TransliterateText: changes the case (or width, or kana) of
   * the selection. Without a selection, the word the cursor is in (for sentence case: its
   * sentence); outside a word nothing happens. With changes recorded, each changed part is
   * replaced as a tracked deletion and insertion; otherwise the text keeps its attributes.
   */
  TransliterateText(pam: SwPaM, mode: TransliterationFlags): void {
    const pStart = pam.Start(), pEnd = pam.End();
    const nSttNd = pStart.GetNodeIndex(), nEndNd = pEnd.GetNodeIndex();
    let nSttCnt = pStart.GetContentIndex(), nEndCnt = pEnd.GetContentIndex();
    if (!pam.HasMark()) {
      const pTNd = pStart.GetNode(), text = pTNd.GetText();
      const lang = pTNd.GetCharAttrAt('RES_CHRATR_LANGUAGE', Math.max(0, nSttCnt - 1));
      const seg = (g: 'word' | 'sentence') => [...new Intl.Segmenter(lang === 'zxx' ? 'en' : lang, { granularity: g }).segment(text)];
      const word = seg('word').find((w) => w.index < nSttCnt && nSttCnt < w.index + w.segment.length && w.segment.trim());
      // Cursor is not inside of a word. Nothing should happen.
      if (!word) return;
      if (mode === TransliterationFlags.SENTENCE_CASE) {
        const sn = seg('sentence').find((x) => x.index <= nSttCnt && nSttCnt < x.index + x.segment.length)!;
        nSttCnt = sn.index; nEndCnt = sn.index + sn.segment.trimEnd().length;
      } else { nSttCnt = word.index; nEndCnt = word.index + word.segment.length; }
    }
    const each = (f: (n: SwTextNode, s: number, e: number) => void) => {
      for (let i = nSttNd; i <= nEndNd; i++) {
        const n = this.m_aNodes.node(i);
        if (n.IsTextNode()) f(n, i === nSttNd ? nSttCnt : 0, i === nEndNd ? nEndCnt : n.Len());
      }
    };
    if (this.m_pDocumentRedlineManager.IsRedlineOn()) {
      const before = this.m_aUndo.length;
      const todo: { n: SwTextNode; c: { nStart: number; nLen: number; sChanged: string } }[] = [];
      each((n, s, e) => { for (const c of n.TransliterateText(mode, s, e, false)) todo.push({ n, c }); });
      for (const { n, c } of todo.reverse()) {
        const tmp = new SwPaM(new SwPosition(n, c.nStart + c.nLen), new SwPosition(n, c.nStart));
        this.InsertString(tmp, c.sChanged);
        tmp.Release();
      }
      while (this.m_aUndo.length > before + 1) this.MergeLastUndo();
      return;
    }
    this.recorded('transliterate', pam, nSttNd, nEndNd, () => each((n, s, e) => { n.TransliterateText(mode, s, e); }));
  }

  /** Splits the paragraph at the point; the new paragraph takes the style's follow style at the end. */
  SplitNode(pam: SwPaM): void {
    if (pam.HasMark()) this.DeleteAndJoin(pam);
    const pt = pam.GetPoint();
    const idx = pt.GetNodeIndex();
    this.recorded('split', pam, idx, idx, () => {
      const node = pt.GetNode();
      const atEnd = pt.GetContentIndex() === node.Len();
      const next = node.SplitContentNode(pt.GetContentIndex());
      if (atEnd) next.m_pColl = node.m_pColl.GetNextTextFormatColl();
      // SwTextNode::SplitContentNode: breaks before the paragraph stay with its first part, a break
      // after it goes with the second.
      delete next.m_aSet.RES_PAGEDESC;
      if (next.m_aSet.RES_BREAK && next.m_aSet.RES_BREAK !== 'page-after') delete next.m_aSet.RES_BREAK;
      if (node.m_aSet.RES_BREAK === 'page-after') delete node.m_aSet.RES_BREAK;
      // The new paragraph has the old end mark; the first one's mark is new (and recorded as inserted).
      if (this.m_pDocumentRedlineManager.IsRedlineOn()) node.m_aSet.RES_PARATR_REDLINE = this.m_pDocumentRedlineManager.NewData('Insert');
      else delete node.m_aSet.RES_PARATR_REDLINE;
      pt.Assign(next, 0);
      pam.DeleteMark();
    });
  }

  /** Deletes the selection and joins the first and last paragraphs. */
  DeleteAndJoin(pam: SwPaM): void {
    if (!pam.HasMark()) return;
    if (this.m_pDocumentRedlineManager.IsRedlineOn()) { this.m_pDocumentRedlineManager.DeleteRedlineRange(pam); return; }
    const start = pam.Start(), end = pam.End();
    const nFirst = start.GetNodeIndex(), nLast = end.GetNodeIndex();
    this.recorded('delete', pam, nFirst, nLast, () => {
      const first = start.GetNode(), last = end.GetNode();
      const startContent = start.GetContentIndex(), endContent = end.GetContentIndex();
      if (first.StartOfSectionNode() !== last.StartOfSectionNode()) {
        // Across a table boundary only text goes: cells and paragraphs keep their structure.
        for (let i = nFirst; i <= nLast; i++) {
          const n = this.m_aNodes.node(i);
          if (!n.IsTextNode()) continue;
          const a = n === first ? startContent : 0, b = n === last ? endContent : n.Len();
          n.EraseText(a, b - a);
        }
      } else if (first === last) {
        first.EraseText(startContent, endContent - startContent);
      } else {
        first.EraseText(startContent, first.Len() - startContent);
        last.EraseText(0, endContent);
        for (let i = nFirst + 1; i < nLast; i++) {
          const dead = this.m_aNodes.node(nFirst + 1);
          if (dead.IsTextNode()) for (const p of [...dead.m_aIndices]) p.Assign(first, startContent);
          this.m_aNodes.Remove(nFirst + 1);
        }
        first.JoinNext();
      }
      pam.GetPoint().Assign(first, startContent);
      pam.DeleteMark();
    });
  }

  /** Moves the point past text marked as deleted (and deleted paragraph ends), where new text goes. */
  SkipDeleted(pam: SwPaM): void {
    const pt = pam.GetPoint();
    for (let guard = 0; guard < 100000; guard++) {
      const n = pt.GetNode(), c = pt.GetContentIndex();
      if (c < n.Len() && n.GetCharAttrAt('RES_TXTATR_REDLINE', c)?.type === 'Delete') { pt.Assign(n, c + 1); continue; }
      const next = c === n.Len() && n.m_aSet.RES_PARATR_REDLINE?.type === 'Delete' ? this.m_pDocumentRedlineManager.NextInSection(n) : null;
      if (next) { pt.Assign(next, 0); continue; }
      break;
    }
  }

  /** Applies character attributes over the selection. */
  InsertAttr(pam: SwPaM, attrs: SwCharAttrSet): void {
    if (!pam.HasMark()) return;
    this.overRange(pam, 'attr', (n, s, e) => n.SetAttr(s, e, attrs));
  }

  /** Removes character attributes on the selection: the given ones, or all. */
  ResetAttrs(pam: SwPaM, keys?: (keyof SwCharAttrSet)[]): void {
    this.overRange(pam, 'reset', (n, s, e) => n.ResetAttr(s, e, keys));
  }

  /**
   * lcl_RstAttr with Format > Clear Direct Formatting's attributes (FN_FORMAT_RESET): the
   * paragraphs' own attributes go, from node `nFirst` to `nLast`, but not the writing direction
   * (tdf#40496), the languages, the list attributes, a list style, a page style, a break, nor what
   * is no formatting (a tracked paragraph end, an index's paragraph). `merge` joins the undo step
   * to the one before.
   */
  ResetParaAttrs(pam: SwPaM, nFirst: number, nLast: number, merge = false): void {
    const keep = (k: string, v: unknown): boolean =>
      k === 'RES_FRAMEDIR' || k === 'RES_CHRATR_LANGUAGE' || k.startsWith('RES_PARATR_LIST_') || k === 'RES_PARATR_REDLINE' || k === 'RES_PARATR_TOX_ID'
      || (k === 'RES_PARATR_NUMRULE' && !!v) || (k === 'RES_PAGEDESC' && !!v) || (k === 'RES_BREAK' && v !== 'none');
    if (nFirst > nLast) return;
    this.recorded('reset', pam, nFirst, nLast, () => {
      for (let i = nFirst; i <= nLast; i++) {
        const n = this.m_aNodes.node(i);
        if (!n.IsTextNode()) continue;
        n.m_aSet = Object.fromEntries(Object.entries(n.m_aSet).filter(([k, v]) => keep(k, v))) as SwAttrSet;
        n.m_nVersion++;
      }
    });
    if (merge) this.MergeLastUndo();
  }

  /** Applies direct paragraph attributes to every paragraph touched by the selection. */
  SetParaAttr(pam: SwPaM, attrs: SwAttrSet): void {
    this.overRange(pam, 'para', (n) => { Object.assign(n.m_aSet, attrs); n.m_nVersion++; });
  }

  SetTextFormatColl(pam: SwPaM, coll: SwTextFormatColl): void {
    this.overRange(pam, 'style', (n) => { n.m_pColl = coll; n.m_aSet = n.m_aSet.RES_PARATR_REDLINE ? { RES_PARATR_REDLINE: n.m_aSet.RES_PARATR_REDLINE } : {}; n.m_nVersion++; });
  }

  // --- headers and footers (DocumentLayoutManager::MakeLayoutFormat, SwWrtShell::ChangeHeaderOrFooter) ---

  /** Turns the page style's header or footer on (with an empty paragraph) or off (deleting its content). */
  SetHeaderFooter(pam: SwPaM, bHeader: boolean, bOn: boolean, kind: SwAreaKind = 'default', desc = DEFAULT_PAGE_DESC): void {
    const nodes = this.m_aNodes;
    const eTyp = bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode;
    // Turning the header off removes its first and left page variants too.
    if (!bOn && kind === 'default') for (const k of ['first', 'left'] as const) this.SetHeaderFooter(pam, bHeader, false, k, desc);
    const existing = nodes.FindAreaSection(eTyp, kind, desc);
    if (!!existing === bOn) return;
    if (bOn) {
      const at = nodes.GetEndOfAutotext().GetIndex();
      // An empty range before the end of the autotext area: the new section is all that changes.
      this.recorded(bHeader ? 'header' : 'footer', pam, at, at - 1, () => {
        nodes.MakeAreaSection(eTyp, this.FindTextFormatCollByName(bHeader ? 'Header' : 'Footer')!, kind, desc);
      });
      return;
    }
    const s = existing!.GetIndex(), e = existing!.EndOfSectionNode().GetIndex();
    this.recorded(bHeader ? 'header' : 'footer', pam, s, e, () => {
      const body = nodes.FirstTextNode();
      for (let i = s; i <= e; i++) {
        const n = nodes.node(i);
        if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(body, 0);
      }
      nodes.Remove(s, e - s + 1);
      pam.DeleteMark();
    });
  }

  /** Stores graphic data and returns its key; identical data shares one key. */
  AddGraphic(data: Uint8Array, mime: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += Math.max(1, data.length >> 12)) h = Math.imul(h ^ data[i]!, 0x01000193);
    let key = `${(h >>> 0).toString(16)}${data.length.toString(16)}`;
    while (this.m_aGraphics.has(key) && this.m_aGraphics.get(key)!.data.length !== data.length) key += 'x';
    this.m_aGraphics.set(key, { data, mime });
    return key;
  }

  GetUniqueGrfName(): string { return this.GetUniqueFlyName('Image'); }
  GetUniqueFrameName(): string { return this.GetUniqueFlyName('Frame'); }
  /** SwDoc::GetUniqueOLEName */
  GetUniqueOLEName(): string { return this.GetUniqueFlyName('Object'); }
  /** SwDoc::GetUniqueShapeName */
  GetUniqueShapeName(): string { return this.GetUniqueFlyName('Shape'); }

  /** SwDoc::GetUniqueGrfName and GetUniqueFrameName: the prefix and the first free number. */
  GetUniqueFlyName(prefix: string): string {
    const used = new Set(this.GetFlyFormats().map((f) => f.name));
    let k = 1;
    while (used.has(`${prefix}${k}`)) k++;
    return `${prefix}${k}`;
  }

  /** Every fly in the document: as-character ones in their text, anchored ones, page ones. */
  GetFlyFormats(): SwFlyLocation[] {
    const out: SwFlyLocation[] = [];
    for (const n of this.allText()) {
      for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_FLYCNT) out.push({ name: h.aAttrs.RES_TXTATR_FLYCNT.name, node: n, nContent: h.nStart, asChar: h.aAttrs.RES_TXTATR_FLYCNT });
      for (const f of n.m_aAnchoredFlys) out.push({ name: f.fmt.m_aName, node: n, nContent: f.nContent, fmt: f.fmt });
    }
    for (const f of this.m_aPageFlys) out.push({ name: f.m_aName, fmt: f });
    return out;
  }

  FindFlyByName(name: string): SwFlyLocation | undefined { return this.GetFlyFormats().find((f) => f.name === name); }

  /** SwDoc::InsertGraphic anchored as character at the point. */
  InsertGraphic(pam: SwPaM, fly: SwFlyCnt): void {
    this.InsertString(pam, CH_TXTATR_BREAKWORD, { RES_TXTATR_FLYCNT: fly });
  }

  /**
   * SwDoc::MakeFlySection / MakeFlyAndMove, reduced: inserts a fly with its format's anchor at the
   * point (an as-character anchor becomes the graphic's placeholder character). Page anchored flys
   * go on page `nPage`.
   */
  MakeFlyFrameFormat(pam: SwPaM, fmt: SwFlyFrameFormat): void {
    if (fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AS_CHAR) {
      this.InsertGraphic(pam, FlyCntOf(fmt));
      return;
    }
    const pt = pam.GetPoint(), idx = pt.GetNodeIndex();
    this.recorded('fly-insert', pam, idx, idx, () => {
      if (fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE) this.m_aPageFlys.push(fmt);
      else pt.GetNode().m_aAnchoredFlys.push({ fmt, nContent: fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? pt.GetContentIndex() : 0 });
    });
  }

  /**
   * SwDoc::SetFlyFrameAttr / SetFrameFormatToFly with anchor changes (SwDoc::SetFlyFrameAnchor):
   * replaces the named fly's format and, when the anchor changes or `to` is given, moves it to its
   * new anchor. Converting to or from an as-character anchor swaps the placeholder character.
   */
  SetFlyFrameFormat(pam: SwPaM, name: string, fmt: SwFlyFrameFormat, to?: { node: SwTextNode; nContent: number }): boolean {
    const loc = this.FindFlyByName(name);
    if (!loc) return false;
    const target = to ?? (loc.node ? { node: loc.node, nContent: loc.nContent! } : { node: pam.GetPoint().GetNode(), nContent: pam.GetPoint().GetContentIndex() });
    const touched = [loc.node?.GetIndex(), target.node.GetIndex()].filter((i): i is number => i !== undefined);
    const first = Math.min(...touched), last = Math.max(...touched);
    this.recordedRanges('fly-change', pam, first === last ? [[first, first]] : [[first, first], [last, last]], () => {
      // Take it out of its old place.
      if (loc.asChar) {
        const n = loc.node!;
        for (const p of n.m_aIndices) if (p.m_nContent > loc.nContent!) p.m_nContent--;
        n.EraseText(loc.nContent!, 1);
        if (target.node === n && target.nContent > loc.nContent!) target.nContent--;
      } else if (loc.node) loc.node.m_aAnchoredFlys = loc.node.m_aAnchoredFlys.filter((f) => f.fmt.m_aName !== name);
      else this.m_aPageFlys = this.m_aPageFlys.filter((f) => f.m_aName !== name);
      // Put it into its new one.
      switch (fmt.m_aAnchor.m_eAnchorId) {
        case RndStdIds.FLY_AS_CHAR:
          target.node.InsertText(CH_TXTATR_BREAKWORD, target.nContent);
          target.node.SetAttr(target.nContent, target.nContent + 1, { RES_TXTATR_FLYCNT: FlyCntOf(fmt) });
          break;
        case RndStdIds.FLY_AT_PAGE: this.m_aPageFlys.push(fmt); break;
        default: target.node.m_aAnchoredFlys.push({ fmt, nContent: fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? target.nContent : 0 });
      }
      target.node.m_nVersion++;
      loc.node && loc.node.m_nVersion++;
    });
    return true;
  }

  /** SwDoc::MakeFlySection for a text frame: an empty frame section and the fly anchored at the point. */
  MakeTextFly(pam: SwPaM, fmt: SwFlyFrameFormat): void {
    const nodes = this.m_aNodes;
    const at = nodes.GetEndOfAutotext().GetIndex(), idx = pam.GetPoint().GetNodeIndex();
    this.recordedRanges('fly-insert', pam, [[at, at - 1], [idx, idx]], () => {
      nodes.MakeFlySection(fmt.m_sContentId!, this.FindTextFormatCollByName('Frame Contents') ?? this.FindTextFormatCollByName('Standard')!);
      const pt = pam.GetPoint();
      if (fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE) this.m_aPageFlys.push(fmt);
      else pt.GetNode().m_aAnchoredFlys.push({ fmt, nContent: fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? pt.GetContentIndex() : 0 });
      pt.GetNode().m_nVersion++;
    });
  }

  /**
   * SdrObjEditView::SdrBeginTextEdit for a shape without text: the shape gets its text section
   * (the outliner text of a SwDrawFrameFormat's object), with LibreOffice's 0.25 cm text distance.
   */
  MakeShapeText(pam: SwPaM, name: string): boolean {
    const loc = this.FindFlyByName(name);
    const fmt = loc?.fmt;
    if (!loc || !fmt?.m_pShape || fmt.m_sContentId !== undefined) return false;
    const nodes = this.m_aNodes;
    const at = nodes.GetEndOfAutotext().GetIndex();
    const ranges: [number, number][] = [[at, at - 1]];
    if (loc.node) ranges.push([loc.node.GetIndex(), loc.node.GetIndex()]);
    this.recordedRanges('fly-change', pam, ranges, () => {
      nodes.MakeFlySection(name, this.FindTextFormatCollByName('Frame Contents') ?? this.FindTextFormatCollByName('Standard')!);
      const next: SwFlyFrameFormat = { ...fmt, m_sContentId: name, m_aBox: { top: null, bottom: null, left: null, right: null, padding: 142 } };
      if (loc.node) { loc.node.m_aAnchoredFlys = loc.node.m_aAnchoredFlys.map((f) => (f.fmt === fmt ? { ...f, fmt: next } : f)); loc.node.m_nVersion++; }
      else this.m_aPageFlys = this.m_aPageFlys.map((f) => (f === fmt ? next : f));
    });
    return true;
  }

  // --- sections (ndsect.cxx) ---

  /** Every section in document order. */
  GetSections(): SwSectionNode[] {
    const out: SwSectionNode[] = [];
    for (let i = 0; i < this.m_aNodes.Count(); i++) { const n = this.m_aNodes.node(i); if (n.IsSectionNode()) out.push(n as SwSectionNode); }
    return out;
  }

  GetUniqueSectionName(): string {
    const used = new Set(this.GetSections().map((s) => s.m_pSection.m_sSectionName));
    let k = 1;
    while (used.has(`Section${k}`)) k++;
    return `Section${k}`;
  }

  /**
   * SwDoc::InsertSwSection: the selected paragraphs (whole, tables included) go into a new
   * section; without a selection the section gets a new empty paragraph at the cursor, which the
   * cursor moves into. Returns the section node, or null when the selection crosses sections.
   */
  InsertSwSection(pam: SwPaM, data: SwSectionData): SwSectionNode | null {
    const nodes = this.m_aNodes;
    // The blocks at both ends: a paragraph, or the outermost table holding it below the common parent.
    const blockOf = (n: SwNode, parent: SwStartNode): SwNode | null => {
      let b: SwNode = n;
      while (b.m_pStartOfSection && b.m_pStartOfSection !== parent) b = b.m_pStartOfSection;
      return b.m_pStartOfSection === parent ? b : null;
    };
    const sNode = pam.Start().GetNode(), eNode = pam.End().GetNode();
    let parent: SwStartNode = sNode.FindTableNode()?.m_pStartOfSection ?? sNode.m_pStartOfSection!;
    while (parent.IsTableNode() || parent.m_eStartNodeType === SwStartNodeType.SwTableBoxStartNode) parent = parent.m_pStartOfSection!;
    const first = blockOf(sNode, parent), last = blockOf(eNode, parent);
    if (!first || !last) return null;
    const f = first.GetIndex();
    const l = last.IsStartNode() ? (last as SwStartNode).EndOfSectionNode().GetIndex() : last.GetIndex();
    let made: SwSectionNode | null = null;
    this.recorded('section-insert', pam, f, l, () => {
      let from = f, to = l;
      if (!pam.HasMark()) {
        // A new empty paragraph at the cursor, splitting the paragraph if needed.
        const pt = pam.GetPoint(), n = pt.GetNode(), c = pt.GetContentIndex();
        let at: number;
        if (c === 0 && n.Len() > 0) at = n.GetIndex();
        else { if (c < n.Len()) n.SplitContentNode(c); at = n.GetIndex() + 1; }
        const empty = nodes.MakeTextNode(at, n.GetTextColl());
        from = to = empty.GetIndex();
        pt.Assign(empty, 0);
      }
      const sec = new SwSectionNode(nodes, data);
      sec.m_pStartOfSection = parent;
      for (let i = from; i <= to; i++) { const k = nodes.node(i); if (k.m_pStartOfSection === parent) k.m_pStartOfSection = sec; }
      nodes.Insert(sec, from);
      nodes.Insert(new SwEndNode(nodes, sec), to + 2);
      made = sec;
      pam.DeleteMark();
    });
    return made;
  }

  /** SwDoc::UpdateSection: new name, columns, hidden and protection flags. */
  UpdateSection(pam: SwPaM, sec: SwSectionNode, data: SwSectionData): void {
    const i = sec.GetIndex();
    this.recorded('section-change', pam, i, sec.EndOfSectionNode().GetIndex(), () => { sec.m_pSection = structuredClone(data); });
  }

  /** SwDoc::DelSectionFormat: the section goes, its content stays. */
  DelSectionFormat(pam: SwPaM, sec: SwSectionNode): void {
    const nodes = this.m_aNodes;
    const s = sec.GetIndex(), e = sec.EndOfSectionNode().GetIndex();
    this.recorded('section-delete', pam, s, e, () => {
      const parent = sec.m_pStartOfSection!;
      for (let i = s + 1; i < e; i++) { const k = nodes.node(i); if (k.m_pStartOfSection === sec) k.m_pStartOfSection = parent; }
      nodes.Remove(e);
      nodes.Remove(s);
    });
  }

  // --- chained frames (docfly.cxx Chainable, Chain, Unchain) ---

  /** SwDoc::SetAttr on a fly's format: replaces the format where it is, as one undo step. */
  private ReplaceFlyFormat(pam: SwPaM, name: string, fmt: SwFlyFrameFormat): boolean {
    const loc = this.FindFlyByName(name);
    if (!loc?.fmt) return false;
    const idx = loc.node?.GetIndex() ?? pam.GetPoint().GetNodeIndex();
    this.recordedRanges('fly-change', pam, [[idx, idx]], () => {
      if (loc.node) { loc.node.m_aAnchoredFlys = loc.node.m_aAnchoredFlys.map((f) => (f.fmt.m_aName === name ? { ...f, fmt } : f)); loc.node.m_nVersion++; }
      else this.m_aPageFlys = this.m_aPageFlys.map((f) => (f.m_aName === name ? fmt : f));
    });
    return true;
  }

  /** SwDoc::Chainable: whether the text of frame `src` may continue in frame `dest`. */
  Chainable(src: string, dest: string): SwChainRet {
    const s = this.FindFlyByName(src), d = this.FindFlyByName(dest);
    if (!s?.fmt || !d?.fmt || s.fmt.m_sContentId === undefined || d.fmt.m_sContentId === undefined) return SwChainRet.NOT_FOUND;
    // The Source must not yet have a Follow.
    if (s.fmt.m_aChain?.m_sNext) return SwChainRet.SOURCE_CHAINED;
    // Target must not be equal to Source and we also must not have a closed chain.
    for (let f: SwFlyFrameFormat | undefined = d.fmt, guard = 0; f && guard < 1000; f = f.m_aChain?.m_sNext ? this.FindFlyByName(f.m_aChain.m_sNext)?.fmt : undefined, guard++) {
      if (f.m_aName === src) return SwChainRet.SELF;
    }
    const nodes = this.m_aNodes;
    const sSec = nodes.FindFlySection(s.fmt.m_sContentId), dSec = nodes.FindFlySection(d.fmt.m_sContentId);
    if (!sSec || !dSec) return SwChainRet.NOT_FOUND;
    // There must not be a chaining from outside to inside or the other way around (IsLowerOf).
    const inside = (n: SwNode | undefined, sec: SwStartNode): boolean => {
      // Up from the anchor through the frames it is in, and their anchors (SwFrameFormat::IsLowerOf).
      for (let st = n?.FindFlyStartNode() ?? null, guard = 0; st && guard < 100; guard++) {
        if (st === sec) return true;
        const outer = this.GetFlyFormats().find((f) => f.fmt?.m_sContentId === st!.m_sFlyId);
        st = outer?.node?.FindFlyStartNode() ?? null;
      }
      return false;
    };
    if (inside(d.node, sSec) || inside(s.node, dSec)) return SwChainRet.SELF;
    // The Target must not yet have a Master.
    if (d.fmt.m_aChain?.m_sPrev) return SwChainRet.IS_IN_CHAIN;
    // Target must be empty.
    const first = nodes.node(dSec.GetIndex() + 1);
    if (dSec.EndOfSectionNode().GetIndex() - dSec.GetIndex() !== 2 || !first.IsTextNode() || (first as SwTextNode).Len() || (first as SwTextNode).m_aAnchoredFlys.length) return SwChainRet.NOT_EMPTY;
    // We also need to consider the right area.
    // Both Flys need to be located in the same area (Body, Header/Footer, Fly).
    const body = nodes.m_pStartOfContent;
    let bAllowed = false;
    if (!s.node) bAllowed = !d.node || nodes.AreaOf(d.node) === body;
    else if (d.node) bAllowed = s.node === d.node || nodes.AreaOf(s.node) === nodes.AreaOf(d.node);
    return bAllowed ? SwChainRet.OK : SwChainRet.WRONG_AREA;
  }

  /** SwDoc::Chain: the text of `src` continues in `dest`; the source gets a fixed height. One undo step. */
  Chain(pam: SwPaM, src: string, dest: string, nSrcHeight?: number): SwChainRet {
    const nErr = this.Chainable(src, dest);
    if (nErr !== SwChainRet.OK) return nErr;
    const s = this.FindFlyByName(src)!.fmt!, d = this.FindFlyByName(dest)!.fmt!;
    const before = this.m_aUndo.length;
    // Attach Follow to the Master.
    this.ReplaceFlyFormat(pam, dest, { ...d, m_aChain: ChainOf(src, d.m_aChain?.m_sNext) });
    // Attach Master to the Follow.
    // Make sure that the Master has a fixed height.
    this.ReplaceFlyFormat(pam, src, { ...s, m_aChain: ChainOf(s.m_aChain?.m_sPrev, dest), ...(s.m_bAutoHeight ? { m_bAutoHeight: false, m_nHeight: nSrcHeight ?? s.m_nHeight } : {}) });
    while (this.m_aUndo.length > before + 1) this.MergeLastUndo();
    return SwChainRet.OK;
  }

  /** SwDoc::Unchain: the text of `name` no longer continues in its follow. */
  Unchain(pam: SwPaM, name: string): void {
    const f = this.FindFlyByName(name)?.fmt, next = f?.m_aChain?.m_sNext;
    const n = next ? this.FindFlyByName(next)?.fmt : undefined;
    if (!f || !next) return;
    const before = this.m_aUndo.length;
    this.ReplaceFlyFormat(pam, name, { ...f, m_aChain: ChainOf(f.m_aChain?.m_sPrev) });
    if (n) this.ReplaceFlyFormat(pam, next, { ...n, m_aChain: ChainOf(undefined, n.m_aChain?.m_sNext) });
    while (this.m_aUndo.length > before + 1) this.MergeLastUndo();
  }

  /** SwDoc::DelLayoutFormat for a fly. */
  DelFly(pam: SwPaM, name: string): boolean {
    let loc = this.FindFlyByName(name);
    if (!loc) return false;
    // A frame in a chain leaves it first (SwDoc::DelLayoutFormat: Unchain / the previous one's Unchain).
    const chain = loc.fmt?.m_aChain;
    if (chain) {
      const before = this.m_aUndo.length;
      if (chain.m_sPrev) this.Unchain(pam, chain.m_sPrev);
      if (chain.m_sNext) this.Unchain(pam, name);
      const ok = this.DelFly(pam, name);
      while (this.m_aUndo.length > before + 1) this.MergeLastUndo();
      return ok;
    }
    loc = this.FindFlyByName(name)!;
    const idx = loc.node?.GetIndex() ?? pam.GetPoint().GetNodeIndex();
    const sec = loc.fmt?.m_sContentId ? this.m_aNodes.FindFlySection(loc.fmt.m_sContentId) : null;
    const ranges: [number, number][] = sec ? [[sec.GetIndex(), sec.EndOfSectionNode().GetIndex()], [idx, idx]] : [[idx, idx]];
    this.recordedRanges('fly-delete', pam, ranges, () => {
      if (sec) {
        // Positions inside the frame's text move to the anchor paragraph.
        const anchor = loc.node ?? pam.GetPoint().GetNode();
        for (let i = sec.GetIndex(); i <= sec.EndOfSectionNode().GetIndex(); i++) {
          const n = this.m_aNodes.node(i);
          if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(anchor, 0);
        }
        this.m_aNodes.Remove(sec.GetIndex(), sec.EndOfSectionNode().GetIndex() - sec.GetIndex() + 1);
      }
      if (loc.asChar) loc.node!.EraseText(loc.nContent!, 1);
      else if (loc.node) { loc.node.m_aAnchoredFlys = loc.node.m_aAnchoredFlys.filter((f) => f.fmt.m_aName !== name); loc.node.m_nVersion++; }
      else this.m_aPageFlys = this.m_aPageFlys.filter((f) => f.m_aName !== name);
    });
    return true;
  }

  // --- copying objects (fecopy.cxx SwFEShell::Copy and Paste, DocumentLayoutManager::CopyLayoutFormat) ---

  /**
   * SwFEShell::Copy with a frame selected, reduced: the object as the clipboard document holds it.
   * A chain is not copied (CopyLayoutFormat does not copy RES_CHAIN). Tables in a frame's text
   * arrive as their paragraphs.
   */
  CopyFlyToClip(name: string): SwFlyClip | null {
    const loc = this.FindFlyByName(name);
    const fmt = loc?.fmt ?? (loc?.asChar ? AsCharFormat(loc.asChar) : null);
    if (!fmt) return null;
    const g = fmt.graphic ? this.m_aGraphics.get(fmt.graphic) : undefined;
    const clip: SwFlyClip = { fmt: { ...fmt, m_aChain: undefined }, ...(g ? { graphic: { data: g.data, mime: g.mime } } : {}) };
    const sec = fmt.m_sContentId !== undefined ? this.m_aNodes.FindFlySection(fmt.m_sContentId) : null;
    if (sec) {
      clip.text = [];
      for (let i = sec.GetIndex() + 1; i < sec.EndOfSectionNode().GetIndex(); i++) {
        const n = this.m_aNodes.node(i);
        if (n.IsTextNode()) clip.text.push(ClipPara(n));
      }
    }
    return clip;
  }

  /**
   * lcl_PasteFlyOrDrawFormat with CopyLayoutFormat, reduced: the clipboard's object as a new fly
   * `name`, anchored at the point (a page anchored one on page `nPage`), with its text. One undo step.
   */
  PasteFlyClip(pam: SwPaM, clip: SwFlyClip, name: string, nPage: number): void {
    // Formats are replaced, never mutated, so the copy shares its members with the clipboard's.
    const fmt: SwFlyFrameFormat = { ...clip.fmt, m_aName: name };
    if (clip.graphic) fmt.graphic = this.AddGraphic(clip.graphic.data, clip.graphic.mime);
    const eAnchor = fmt.m_aAnchor.m_eAnchorId;
    if (eAnchor === RndStdIds.FLY_AT_PAGE) fmt.m_aAnchor = { ...fmt.m_aAnchor, m_nPageNumber: nPage };
    else if (eAnchor === RndStdIds.FLY_AT_FLY) fmt.m_aAnchor = { ...fmt.m_aAnchor, m_eAnchorId: RndStdIds.FLY_AT_PARA };
    if (!clip.text || eAnchor === RndStdIds.FLY_AS_CHAR) {
      delete fmt.m_sContentId;
      this.MakeFlyFrameFormat(pam, fmt);
      return;
    }
    fmt.m_sContentId = name;
    const before = this.m_aUndo.length;
    this.MakeTextFly(pam, fmt);
    const nodes = this.m_aNodes;
    const first = nodes.FindFlySection(name)!.GetIndex() + 1;
    const dflt = this.FindTextFormatCollByName('Frame Contents') ?? this.FindTextFormatCollByName('Standard')!;
    this.recorded('fly-change', pam, first, first, () => {
      clip.text!.forEach((p, i) => {
        const coll = this.FindTextFormatCollByName(p.coll) ?? dflt;
        const tn = i === 0 ? (nodes.node(first) as SwTextNode) : nodes.MakeTextNode(first + i, coll);
        tn.m_Text = p.text;
        tn.m_aHints = p.hints.map((h) => ({ ...h, aAttrs: { ...h.aAttrs } }));
        tn.m_pColl = coll;
        tn.m_aSet = structuredClone(p.set);
        tn.m_nVersion++;
      });
    });
    while (this.m_aUndo.length > before + 1) this.MergeLastUndo();
  }

  // --- comments (SwPostItField, sw::mark::AnnotationMark) ---

  /** Every comment anchor in the document, in node order. */
  GetAnnotations(): { node: SwTextNode; pos: number; field: SwPostItField }[] {
    const out: { node: SwTextNode; pos: number; field: SwPostItField }[] = [];
    for (const n of this.allText()) for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_ANNOTATION) out.push({ node: n, pos: h.nStart, field: h.aAttrs.RES_TXTATR_ANNOTATION });
    return out;
  }

  NewAnnotationId(): string {
    const used = new Set(this.GetAnnotations().map((a) => a.field.id));
    let k = 1;
    while (used.has(`c${k}`)) k++;
    return `c${k}`;
  }

  /**
   * SwWrtShell::InsertPostIt: the anchor goes at the start of the selection, and the selected text
   * of that paragraph becomes the comment's range.
   */
  InsertAnnotation(pam: SwPaM, field: SwPostItField): void {
    const start = pam.Start(), end = pam.End();
    const n = start.GetNode(), pos = start.GetContentIndex();
    const rangeEnd = end.GetNode() === n ? end.GetContentIndex() : n.Len();
    const idx = n.GetIndex();
    this.recorded('annotation', pam, idx, idx, () => {
      n.InsertText(CH_TXTATR_BREAKWORD, pos);
      n.SetAttr(pos, pos + 1, { RES_TXTATR_ANNOTATION: field });
      if (rangeEnd > pos) n.SetAttr(pos + 1, rangeEnd + 1, { RES_TXTATR_ANNOTMARK: field.id });
      pam.GetPoint().Assign(n, pos + 1);
      pam.DeleteMark();
    });
  }

  /** Replaces a comment's field (its text, or its resolved state). */
  SetAnnotation(id: string, change: Partial<SwPostItField>): boolean {
    const a = this.GetAnnotations().find((x) => x.field.id === id);
    if (!a) return false;
    const idx = a.node.GetIndex();
    const pam = new SwPaM(new SwPosition(a.node, a.pos));
    this.recorded('annotation-edit', pam, idx, idx, () => a.node.SetAttr(a.pos, a.pos + 1, { RES_TXTATR_ANNOTATION: { ...a.field, ...change } }));
    pam.Release();
    return true;
  }

  /** Deletes comments (all when no ids are given), with their anchors and range marks. */
  DeleteAnnotations(pam: SwPaM, ids?: string[]): void {
    const victims = this.GetAnnotations().filter((a) => !ids || ids.includes(a.field.id));
    if (!victims.length) return;
    const gone = new Set(victims.map((v) => v.field.id));
    const indices = [...new Set(victims.map((v) => v.node.GetIndex()))].sort((a, b) => a - b);
    this.recordedRanges('annotation-delete', pam, indices.map((i) => [i, i] as [number, number]), () => {
      for (const i of indices) {
        const n = this.m_aNodes.node(i) as SwTextNode;
        for (const h of [...n.m_aHints].reverse()) {
          if (h.aAttrs.RES_TXTATR_ANNOTMARK && gone.has(h.aAttrs.RES_TXTATR_ANNOTMARK)) n.ResetAttr(h.nStart, h.nEnd, ['RES_TXTATR_ANNOTMARK']);
        }
        for (const h of [...n.m_aHints].reverse()) {
          if (h.aAttrs.RES_TXTATR_ANNOTATION && gone.has(h.aAttrs.RES_TXTATR_ANNOTATION.id)) n.EraseText(h.nStart, 1);
        }
      }
    });
  }

  /** A footnote id not used by any footnote section. */
  NewFootnoteId(): string {
    let k = 1;
    while (this.m_aNodes.FindFootnoteSection(`ftn${k}`)) k++;
    return `ftn${k}`;
  }

  /**
   * SwDoc::InsertPoolItem for SwFormatFootnote: an anchor at the point and a new footnote section,
   * as one undo step. Returns the id.
   */
  InsertFootnote(pam: SwPaM, bEndNote = false): string {
    if (pam.HasMark()) this.DeleteAndJoin(pam);
    const nodes = this.m_aNodes;
    const id = this.NewFootnoteId();
    const at = nodes.GetEndOfInserts().GetIndex();
    const pt = pam.GetPoint(), idx = pt.GetNodeIndex();
    this.recordedRanges('footnote', pam, [[at, at - 1], [idx, idx]], () => {
      nodes.MakeFootnoteSection(id, this.FindTextFormatCollByName(bEndNote ? 'Endnote' : 'Footnote')!);
      const n = pt.GetNode(), pos = pt.GetContentIndex();
      n.InsertText(CH_TXTATR_BREAKWORD, pos);
      n.SetAttr(pos, pos + 1, { RES_TXTATR_FTN: bEndNote ? { id, endnote: true } : { id } });
    });
    return id;
  }

  /**
   * SwDoc::InsertLabel (lcl_InsertLabel) for SwLabelType::Table: a paragraph above or below the
   * table at the point, in the paragraph style named as the category (else Caption), with the
   * category, its number range field, the separator and the text. A caption above keeps with the
   * table; below, the table keeps with its caption. Returns false outside a table.
   */
  InsertLabel(pam: SwPaM, rCategory: string, rText: string, rSeparator: string, rNumberingSeparator: string, bBefore: boolean, numType?: number, bOrderNumberingFirst = false): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const t = at.tableNode, first = t.GetIndex(), last = t.EndOfSectionNode().GetIndex();
    this.recordedRanges('label', pam, [[first, last]], () => {
      const pColl = this.GetLabelColl(rCategory);
      const nNode = bBefore ? t.GetIndex() : t.EndOfSectionNode().GetIndex() + 1;
      const pNew = this.m_aNodes.MakeTextNode(nNode, pColl);
      this.lcl_FillLabel(pNew, rCategory, rText, rSeparator, rNumberingSeparator, numType, bOrderNumberingFirst);
      if (bBefore) {
        if (!pNew.GetAttr('RES_KEEP')) pNew.m_aSet = { ...pNew.m_aSet, RES_KEEP: true };
      } else if (!t.m_pTable.m_aAttrs.keepWithNext) {
        t.m_pTable.m_aAttrs = { ...t.m_pTable.m_aAttrs, keepWithNext: true };
      }
      pNew.m_nVersion++;
    });
    this.SetModified();
    return true;
  }

  /** lcl_InsertLabel's text collection: the one named as the category, else RES_POOLCOLL_LABEL. */
  private GetLabelColl(rCategory: string): SwTextFormatColl {
    return (rCategory ? this.FindTextFormatCollByName(rCategory) : undefined) ?? this.FindTextFormatCollByName('Caption')!;
  }

  /** lcl_InsertLabel's caption: the category, its number range field, the separator and the text. */
  private lcl_FillLabel(pNew: SwTextNode, rCategory: string, rText: string, rSeparator: string, rNumberingSeparator: string, numType: number | undefined, bOrderNumberingFirst: boolean): void {
    // Work up OUString
    let aText = '';
    if (bOrderNumberingFirst) aText = rNumberingSeparator;
    if (rCategory) {
      aText += rCategory;
      if (!bOrderNumberingFirst) aText += ' ';
    }
    let nIdx = aText.length;
    if (rText) aText += rSeparator;
    aText += rText;
    // Insert string
    pNew.InsertText(aText, pNew.Len());
    // Insert field
    if (rCategory) {
      if (bOrderNumberingFirst) nIdx = 0;
      const field: SwField = { type: 'Sequence', name: rCategory };
      if (numType !== undefined && numType !== NumberingType.ARABIC) field.numType = numType;
      field.seqNo = this.NextSeqNo(rCategory);
      pNew.InsertText(CH_TXTATR_BREAKWORD, nIdx);
      pNew.SetAttr(nIdx, nIdx + 1, { RES_TXTATR_FIELD: field });
    }
    pNew.m_nVersion++;
  }

  /**
   * SwSetExpFieldType::SetSeqRefNo for the fields of a loaded document: every number range field
   * without a sequence number gets one.
   */
  SetSeqRefNos(): void {
    for (const n of this.allText()) for (const h of n.m_aHints) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (f?.type === 'Sequence' && f.seqNo === undefined) f.seqNo = this.NextSeqNo(f.name ?? '');
    }
  }

  /** SwDoc::IsUsed for a number range: whether a field of the category is in the document. */
  IsUsedSeq(rCategory: string): boolean {
    for (const n of this.allText()) for (const h of n.m_aHints) if (h.aAttrs.RES_TXTATR_FIELD?.type === 'Sequence' && h.aAttrs.RES_TXTATR_FIELD.name === rCategory) return true;
    return false;
  }

  /**
   * SwSetExpFieldType::SetSeqRefNo for a new field: the lowest number no field of the category
   * uses, by which references find it.
   */
  NextSeqNo(rCategory: string): number {
    const used = new Set<number>();
    for (const n of this.allText()) for (const h of n.m_aHints) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (f?.type === 'Sequence' && f.name === rCategory && f.seqNo !== undefined) used.add(f.seqNo);
    }
    let n = 0;
    while (used.has(n)) n++;
    return n;
  }

  /**
   * SwDoc::InsertLabel for a fly (lcl_InsertLabel, lcl_InsertDrawLabel):
   * - SwLabelType::Fly, a text frame: the caption paragraph at the start or end of its text.
   * - SwLabelType::Object (a graphic or formula) and SwLabelType::Draw (a shape): a new text frame
   *   takes the object's anchor, position, wrap and spacing and grows with its content: the object
   *   and the caption above or below it.
   * Reduced: upstream anchors the object to the caption's paragraph in the new frame, centred
   * above or below it; here it is anchored as character in a centred paragraph of its own before
   * or after the caption's (the layout places no paragraph anchored objects inside frames). An
   * object anchored as character, and a shape with text, get no caption. Returns the new frame's
   * name (the text frame's for Fly), or null.
   */
  InsertFlyLabel(pam: SwPaM, name: string, rCategory: string, rText: string, rSeparator: string, rNumberingSeparator: string, bBefore: boolean, numType?: number, bOrderNumberingFirst = false): string | null {
    const loc = this.FindFlyByName(name);
    const old = loc?.fmt;
    if (!loc || !old) return null;
    const pColl = this.GetLabelColl(rCategory);
    const nodes = this.m_aNodes;
    if (old.m_sContentId !== undefined && !old.m_pShape) {
      // At the FlySection's Beginning/End insert the corresponding Node with its Field.
      const pSttNd = nodes.FindFlySection(old.m_sContentId);
      if (!pSttNd) return null;
      const nNode = bBefore ? pSttNd.GetIndex() + 1 : pSttNd.EndOfSectionNode().GetIndex();
      this.recorded('label', pam, nNode, nNode - 1, () => {
        // Create Node for labeling paragraph.
        const pNew = nodes.MakeTextNode(nNode, pColl);
        this.lcl_FillLabel(pNew, rCategory, rText, rSeparator, rNumberingSeparator, numType, bOrderNumberingFirst);
      });
      this.SetModified();
      return name;
    }
    if (old.m_pShape && old.m_sContentId !== undefined) return null;
    const newName = this.GetUniqueFrameName();
    const idx = loc.node?.GetIndex() ?? pam.GetPoint().GetNodeIndex();
    const at = nodes.GetEndOfAutotext().GetIndex();
    this.recordedRanges('label', pam, [[at, at - 1], [idx, idx]], () => {
      // Copy only the set attributes; the frame has no border (the template's is reset) and grows
      // with its content from the object's height (SwFrameSize::Minimum).
      const pNewFormat: SwFlyFrameFormat = {
        ...TextFlyFormat(newName, newName, old.m_nWidth, old.m_nHeight),
        m_aAnchor: { ...old.m_aAnchor }, m_aHoriOrient: { ...old.m_aHoriOrient }, m_aVertOrient: { ...old.m_aVertOrient },
        m_aSurround: { ...old.m_aSurround }, m_bOpaque: old.m_bOpaque,
        m_nLeftSpace: old.m_nLeftSpace, m_nRightSpace: old.m_nRightSpace, m_nUpperSpace: old.m_nUpperSpace, m_nLowerSpace: old.m_nLowerSpace,
        m_aBox: old.m_aBox ?? null, m_aBackground: old.m_aBackground ?? null, m_bAutoHeight: true,
        ...(old.m_nZOrder !== undefined ? { m_nZOrder: old.m_nZOrder } : {}),
      };
      const pSttNd = nodes.MakeFlySection(newName, pColl);
      // The old one has no flow and is centred above or below the caption.
      const pObj = nodes.GoNext(pSttNd.GetIndex())!;
      pObj.m_aSet = { ...pObj.m_aSet, RES_PARATR_ADJUST: 'center' };
      pObj.InsertText(CH_TXTATR_BREAKWORD, 0);
      pObj.SetAttr(0, 1, { RES_TXTATR_FLYCNT: FlyCntOf({ ...old, m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AS_CHAR, m_nPageNumber: 0 } }) });
      const pNew = nodes.MakeTextNode(bBefore ? pObj.GetIndex() : pObj.GetIndex() + 1, pColl);
      this.lcl_FillLabel(pNew, rCategory, rText, rSeparator, rNumberingSeparator, numType, bOrderNumberingFirst);
      // The new frame takes the old one's place.
      if (loc.node) {
        loc.node.m_aAnchoredFlys = loc.node.m_aAnchoredFlys.map((f) => (f.fmt.m_aName === name ? { fmt: pNewFormat, nContent: f.nContent } : f));
        loc.node.m_nVersion++;
      } else this.m_aPageFlys = this.m_aPageFlys.map((f) => (f.m_aName === name ? pNewFormat : f));
    });
    this.SetModified();
    return newName;
  }

  // --- field types (DocumentFieldsManager's mpFieldTypes, reduced to user fields and variables) ---

  /**
   * GetFieldType(SwFieldIds::SetExp | SwFieldIds::User, name): the variable or user field type of
   * a name. Number ranges are not in this table (their categories come from their fields).
   */
  GetFieldType(nWhich: 'SetExp' | 'User', rName: string): SwSetExpFieldType | SwUserFieldType | undefined {
    return nWhich === 'User' ? this.m_aUserFieldTypes.get(rName) : this.m_aSetExpFieldTypes.get(rName);
  }

  /** DocumentFieldsManager::InsertFieldType: the existing type of the name, else the new one. */
  InsertFieldType<T extends SwSetExpFieldType | SwUserFieldType>(rFieldTyp: T): T {
    const table = (rFieldTyp instanceof SwUserFieldType ? this.m_aUserFieldTypes : this.m_aSetExpFieldTypes) as Map<string, T>;
    const got = table.get(rFieldTyp.GetName());
    if (got) return got;
    table.set(rFieldTyp.GetName(), rFieldTyp);
    this.SetModified();
    return rFieldTyp;
  }

  /** DocumentFieldsManager::RemoveFieldType, for a type no field uses. */
  RemoveFieldType(nWhich: 'SetExp' | 'User', rName: string): void {
    (nWhich === 'User' ? this.m_aUserFieldTypes : this.m_aSetExpFieldTypes).delete(rName);
    this.m_nFormatVersion++;
    this.SetModified();
  }

  /** SwEditShell::IsUsed for a field type: whether a field of the document shows or sets it. */
  IsUsed(nWhich: 'SetExp' | 'User', rName: string): boolean {
    for (const n of this.allText()) {
      for (const h of n.m_aHints) {
        const f = h.aAttrs.RES_TXTATR_FIELD;
        if (!f) continue;
        if (nWhich === 'User' && ((f.type === 'User' && f.name === rName) || (f.type === 'Input' && f.subType === SwInputFieldSubType.User && f.content === rName))) return true;
        if (nWhich === 'SetExp' && ((f.type === 'SetExp' && f.name === rName) || (f.type === 'GetExp' && !((f.subType ?? 0) & SwGetSetExpType.Formula) && f.formula === rName))) return true;
      }
    }
    return false;
  }

  /** A field type's content or type changed (SwFieldType::UpdateFields): the fields show it anew. */
  UpdateFields(): void {
    this.m_nFormatVersion++;
    this.SetModified();
  }

  /** SwDoc::InsertField at the point (DocumentContentOperationsManager::InsertPoolItem for RES_TXTATR_FIELD). */
  InsertField(pam: SwPaM, field: SwField, attrs?: SwCharAttrSet): void {
    this.InsertString(pam, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FIELD: field });
  }

  // --- tables of contents (doctxm.cxx, reduced: entries are text, refreshed by Update Index) ---

  /** RES_POOLCOLL_TOX_CNTNTH and RES_POOLCOLL_TOX_CNTNT1..10 (lcl_SetRegister). */
  GetTocColl(level: number): SwTextFormatColl {
    const name = level ? `Contents ${level}` : 'Contents Heading';
    const got = this.FindTextFormatCollByName(name);
    if (got) return got;
    if (!level) return this.MakeColl(name, this.FindTextFormatCollByName('Heading')!, { RES_LR_SPACE: { left: 0, right: 0, firstLine: 0 }, RES_CHRATR_WEIGHT: true, RES_CHRATR_FONTSIZE: 320 });
    const left = Math.round((5 * (level - 1) * 1440) / 25.4);
    const right = this.m_aPageDesc.PrintWidth();
    return this.MakeColl(name, this.FindTextFormatCollByName('Standard')!, {
      RES_LR_SPACE: { left, right: 0, firstLine: 0 },
      RES_PARATR_TABSTOP: [{ pos: right - left, adjust: 'right', fill: '.', decimal: '.' }],
    });
  }

  /**
   * SwDoc::HasParagraphDirectFormatting (doc.cxx): whether the paragraph sets any paragraph or
   * character property itself. As upstream's hidden properties, the list level, restart, start
   * value and counted state are not formatting; the tracked change of the paragraph mark is not a
   * property at all.
   */
  static HasParagraphDirectFormatting(n: SwTextNode): boolean {
    return Object.keys(n.m_aSet).some((k) => !PARA_HIDDEN_PROPERTIES.has(k));
  }

  /** Outline level of a paragraph for the table of contents: its Heading N style, else 0. */
  static OutlineLevel(n: SwTextNode): number {
    for (let c: SwFormat | null = n.GetTextColl(); c; c = c.m_pDerivedFrom) {
      const m = /^Heading (\d+)$/.exec(c.GetName());
      if (m) return parseInt(m[1]!, 10);
    }
    return 0;
  }

  /**
   * SwNodes::GetOutLineNds, reduced: the body's paragraphs with an outline level, in document
   * order (headings in frames, headers and footers are not counted).
   */
  GetOutLineNds(): SwTextNode[] {
    const nodes = this.m_aNodes, out: SwTextNode[] = [];
    for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) if (SwDoc.OutlineLevel(n)) out.push(n);
    return out;
  }

  /**
   * RES_POOLCOLL_HEADLINE1..10 (DocumentStylePoolManager's lcl_SetHeadline): the heading style of
   * an outline level, made when a document lacks it (aHeadlineSizes: 10, 10, 9 and 9 pt below 6).
   */
  GetHeadingColl(level: number): SwTextFormatColl {
    const name = `Heading ${level}`;
    const got = this.FindTextFormatCollByName(name);
    if (got) return got;
    const size = [200, 200, 180, 180][level - 7] ?? 200;
    const coll = this.MakeColl(name, this.FindTextFormatCollByName('Heading') ?? this.FindTextFormatCollByName('Standard')!, { RES_CHRATR_FONTSIZE: size, RES_CHRATR_WEIGHT: true });
    coll.m_pNextTextFormatColl = this.FindTextFormatCollByName('Text Body') ?? null;
    return coll;
  }

  /**
   * SwDoc::OutlineUpDown, reduced: each heading in the range gets the heading style of its outline
   * level plus nOffset (from 1 to MAXLEVEL); paragraphs without an outline level stay as they are.
   */
  OutlineUpDown(pam: SwPaM, nOffset: number): boolean {
    const nFirst = pam.Start().GetNodeIndex(), nLast = pam.End().GetNodeIndex();
    const changes: [SwTextNode, SwTextFormatColl][] = [];
    for (let i = nFirst; i <= nLast; i++) {
      const n = this.m_aNodes.node(i);
      if (!n.IsTextNode()) continue;
      const nLevel = SwDoc.OutlineLevel(n);
      if (!nLevel) continue;
      const nNew = Math.max(1, Math.min(10, nLevel + nOffset));
      if (nNew !== nLevel) changes.push([n, this.GetHeadingColl(nNew)]);
    }
    if (!changes.length) return false;
    this.recorded('outline-updown', pam, nFirst, nLast, () => {
      for (const [n, coll] of changes) { n.m_pColl = coll; n.m_nVersion++; }
    });
    return true;
  }

  /** Each index's settings, as SwTOXBase keeps them (title and outline levels evaluated). */
  m_aTocSettings = new Map<string, { title: string; levels: number }>();

  NewTocId(): string {
    const used = new Set([...this.allText()].map((n) => n.m_aSet.RES_PARATR_TOX_ID).filter(Boolean));
    let k = 1;
    while (used.has(`Table of Contents${k}`)) k++;
    return `Table of Contents${k}`;
  }

  /** Paragraphs of an index, in order. */
  GetTocParas(id: string): SwTextNode[] {
    return [...this.allText()].filter((n) => n.m_aSet.RES_PARATR_TOX_ID === id);
  }

  /**
   * SwDoc::InsertTableOf and SwTOXBaseSection::Update: the title and one entry per heading up to
   * `levels`, each "text, tab, page". `pageOf` reads the layout, which `relayout` refreshes, so that
   * the page numbers are those after the index itself has been inserted.
   */
  InsertTableOf(pam: SwPaM, opts: { title: string; levels: number; id?: string }, pageOf: (n: SwTextNode) => number, relayout: () => void): string {
    const nodes = this.m_aNodes;
    const id = opts.id ?? this.NewTocId();
    this.m_aTocSettings.set(id, { title: opts.title, levels: opts.levels });
    const old = this.GetTocParas(id);
    const pt = pam.GetPoint();
    let first: number, last: number;
    if (old.length) { first = old[0]!.GetIndex(); last = old[old.length - 1]!.GetIndex(); }
    else { first = last = pt.GetNodeIndex(); }
    this.recorded('toc', pam, first, last, () => {
      let before: SwTextNode;
      if (old.length) {
        // Update: the old paragraphs go, positions in them move to the paragraph after.
        before = nodes.GoNext(old[old.length - 1]!.GetIndex()) ?? nodes.MakeTextNode(old[old.length - 1]!.GetIndex() + 1, this.FindTextFormatCollByName('Standard')!);
        for (const n of old) for (const p of [...n.m_aIndices]) p.Assign(before, 0);
        for (const n of [...old].reverse()) nodes.Remove(n.GetIndex());
      } else {
        before = pt.GetNode();
        if (pt.GetContentIndex() !== 0) { before = before.SplitContentNode(pt.GetContentIndex()); pt.Assign(before, 0); }
      }
      const headings = [...this.allText()].filter((n) => !n.m_aSet.RES_PARATR_TOX_ID && n.m_pStartOfSection === nodes.m_pStartOfContent)
        .map((n) => ({ n, level: SwDoc.OutlineLevel(n) })).filter((h) => h.level > 0 && h.level <= opts.levels && h.n.GetText().trim());
      const made: { node: SwTextNode; heading: SwTextNode | null }[] = [];
      const add = (text: string, level: number, heading: SwTextNode | null) => {
        const n = nodes.MakeTextNode(before.GetIndex(), this.GetTocColl(level), text);
        n.m_aSet.RES_PARATR_TOX_ID = id;
        made.push({ node: n, heading });
      };
      if (opts.title) add(opts.title, 0, null);
      for (const h of headings) add(`${h.n.GetText().split(CH_TXTATR_BREAKWORD).join('')}\t`, h.level, h.n);
      // Page numbers settle once the index's own length is known.
      for (let pass = 0; pass < 3; pass++) {
        relayout();
        let changed = false;
        for (const m of made) {
          if (!m.heading) continue;
          const t = m.node.GetText();
          const want = `${t.slice(0, t.lastIndexOf('\t') + 1)}${pageOf(m.heading)}`;
          if (want !== t) { m.node.m_Text = want; m.node.m_nVersion++; changed = true; }
        }
        if (!changed) break;
      }
      // SwTOXPara::GetURL: each entry (LS to LE of the default form) links to its heading's
      // cross-reference bookmark, in the "Index Link" style.
      for (const m of made) {
        if (!m.heading) continue;
        const mark = this.m_pMarkManager.getMarkForTextNode(m.heading, MarkType.CROSSREF_HEADING_BOOKMARK);
        m.node.SetAttr(0, m.node.Len(), { RES_TXTATR_INETFMT: `#${mark.GetName()}`, RES_TXTATR_INETFMT_CHARFMT: this.GetIndexLinkFormat() });
      }
      pam.DeleteMark();
    });
    return id;
  }

  /** SwDoc::DeleteTOX: the index's paragraphs go. */
  DeleteTableOf(pam: SwPaM, id: string): void {
    const paras = this.GetTocParas(id);
    if (!paras.length) return;
    const first = paras[0]!.GetIndex(), last = paras[paras.length - 1]!.GetIndex();
    this.recorded('toc-delete', pam, first, last, () => {
      const nodes = this.m_aNodes;
      const refuge = nodes.GoNext(last) ?? nodes.GoPrevious(first) ?? nodes.MakeTextNode(last + 1, this.FindTextFormatCollByName('Standard')!);
      for (const n of paras) for (const p of [...n.m_aIndices]) p.Assign(refuge, 0);
      for (const n of [...paras].reverse()) nodes.Remove(n.GetIndex());
      pam.DeleteMark();
    });
  }

  // --- tables (ndtbl.cxx) ---

  GetUniqueTableName(): string {
    const used = new Set<string>();
    for (let i = 0; i < this.m_aNodes.Count(); i++) {
      const n = this.m_aNodes.node(i);
      if (n.IsTableNode()) used.add((n as SwTableNode).m_pTable.m_aAttrs.name);
    }
    let k = 1;
    while (used.has(`Table${k}`)) k++;
    return `Table${k}`;
  }

  /**
   * SwEditShell::InsertTable + SwDoc::InsertTable: splits the paragraph if the point is inside it,
   * then inserts the table before the point's paragraph and moves the point into the first cell.
   */
  InsertTable(pam: SwPaM, nRows: number, nCols: number, opts: { heading: boolean; repeatHeading: boolean; borders: boolean }): SwTableNode | null {
    if (pam.HasMark()) this.DeleteAndJoin(pam);
    const pt = pam.GetPoint();
    const idx = pt.GetNodeIndex();
    let table: SwTableNode | null = null;
    this.recorded('instable', pam, idx, idx, () => {
      let node = pt.GetNode();
      if (pt.GetContentIndex() !== 0) {
        node = node.SplitContentNode(pt.GetContentIndex());
        pt.Assign(node, 0);
      }
      const body = this.FindTextFormatCollByName('Table Contents')!;
      const head = opts.heading ? this.FindTextFormatCollByName('Table Heading')! : null;
      table = this.m_aNodes.InsertTable(node.GetIndex(), nCols, body, nRows, opts.heading && opts.repeatHeading ? 1 : 0, head,
        { name: this.GetUniqueTableName(), adjust: 'full', width: 0, leftSpace: 0, upper: 0, lower: 0 }, node.m_aSet, opts.borders);
      pt.Assign(this.m_aNodes.GoNext(table.GetIndex())!, 0);
      pam.DeleteMark();
    });
    return table;
  }

  /** The box and line containing a position, with the box's column (by left edge in relative units). */
  GetTableBoxAt(node: SwTextNode): { tableNode: SwTableNode; box: SwTableBox; line: number; left: number } | null {
    const start = node.FindTableBoxStartNode();
    const tableNode = start?.m_pStartOfSection as SwTableNode | null;
    if (!start || !tableNode?.IsTableNode()) return null;
    const lines = tableNode.m_pTable.GetTabLines();
    for (let l = 0; l < lines.length; l++) {
      let left = 0;
      for (const b of lines[l]!.m_aBoxes) {
        if (b.m_pStartNode === start) return { tableNode, box: b, line: l, left };
        left += b.m_aAttrs.width;
      }
    }
    return null;
  }

  private tableOp(pam: SwPaM, kind: string, f: (tableNode: SwTableNode, at: NonNullable<ReturnType<SwDoc['GetTableBoxAt']>>) => void): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const t = at.tableNode, first = t.GetIndex(), last = t.EndOfSectionNode().GetIndex();
    this.recorded(kind, pam, first, last, () => f(t, at));
    return true;
  }

  /** Creates the nodes of one empty box before `where` and returns its start node. */
  private makeBoxNodes(tableNode: SwTableNode, where: number, coll: SwTextFormatColl): SwStartNode {
    const sn = new SwStartNode(this.m_aNodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
    sn.m_pStartOfSection = tableNode;
    this.m_aNodes.Insert(sn, where);
    const tn = new SwTextNode(this.m_aNodes, coll);
    tn.m_pStartOfSection = sn;
    this.m_aNodes.Insert(tn, where + 1);
    this.m_aNodes.Insert(new SwEndNode(this.m_aNodes, sn), where + 2);
    return sn;
  }

  private boxColl(box: SwTableBox): SwTextFormatColl {
    return this.m_aNodes.GoNext(box.m_pStartNode!.GetIndex())?.GetTextColl() ?? this.FindTextFormatCollByName('Table Contents')!;
  }

  /** Removes a box's nodes; positions in it move to `refuge`. */
  private removeBoxNodes(box: SwTableBox, refuge: SwTextNode): void {
    const s = box.m_pStartNode!.GetIndex(), e = box.m_pStartNode!.EndOfSectionNode().GetIndex();
    for (let i = s; i <= e; i++) {
      const n = this.m_aNodes.node(i);
      if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(refuge, 0);
    }
    this.m_aNodes.Remove(s, e - s + 1);
  }

  /** SwDoc::InsertRow: copies the current row's box layout and paragraph styles. */
  InsertRow(pam: SwPaM, bBehind: boolean, nCnt = 1): boolean {
    return this.tableOp(pam, 'insrow', (t, at) => {
      const table = t.m_pTable;
      const src = table.m_aLines[at.line]!;
      for (let k = 0; k < nCnt; k++) {
        const line = new SwTableLine();
        line.m_aAttrs = structuredClone(src.m_aAttrs);
        const anchorLine = bBehind ? table.m_aLines[at.line + k]! : src;
        const anchorBox = bBehind ? anchorLine.m_aBoxes[anchorLine.m_aBoxes.length - 1]! : anchorLine.m_aBoxes[0]!;
        let where = bBehind ? anchorBox.m_pStartNode!.EndOfSectionNode().GetIndex() + 1 : anchorBox.m_pStartNode!.GetIndex();
        for (const b of src.m_aBoxes) {
          const box = new SwTableBox(line, structuredClone(b.m_aAttrs));
          box.m_pStartNode = this.makeBoxNodes(t, where, this.boxColl(b));
          where += 3;
          line.m_aBoxes.push(box);
        }
        table.m_aLines.splice(bBehind ? at.line + 1 + k : at.line + k, 0, line);
        if (!bBehind && table.m_nRowsToRepeat > at.line) table.m_nRowsToRepeat++;
      }
    });
  }

  /** Index of the box in `line` covering the relative x position `left`. */
  private boxAtLeft(line: SwTableLine, left: number): number {
    let x = 0;
    for (let i = 0; i < line.m_aBoxes.length; i++) {
      const w = line.m_aBoxes[i]!.m_aAttrs.width;
      if (left < x + w - 1e-6) return i;
      x += w;
    }
    return line.m_aBoxes.length - 1;
  }

  /** SwDoc::InsertCol: a column as wide as the current one, in every row. */
  InsertCol(pam: SwPaM, bBehind: boolean, nCnt = 1): boolean {
    return this.tableOp(pam, 'inscol', (t, at) => {
      for (const line of t.m_pTable.m_aLines) {
        const i = this.boxAtLeft(line, at.left);
        const ref = line.m_aBoxes[i]!;
        let where = bBehind ? ref.m_pStartNode!.EndOfSectionNode().GetIndex() + 1 : ref.m_pStartNode!.GetIndex();
        for (let k = 0; k < nCnt; k++) {
          const box = new SwTableBox(line, { ...structuredClone(ref.m_aAttrs), width: at.box.m_aAttrs.width });
          box.m_pStartNode = this.makeBoxNodes(t, where, this.boxColl(ref));
          where += 3;
          line.m_aBoxes.splice(bBehind ? i + 1 + k : i + k, 0, box);
        }
      }
    });
  }

  /** SwDoc::DeleteRowCol for the rows of the selection; the whole table goes with its last row. */
  DeleteRow(pam: SwPaM): boolean {
    const a = this.GetTableBoxAt(pam.Start().GetNode()), b = this.GetTableBoxAt(pam.End().GetNode());
    if (!a) return false;
    const lines = a.tableNode.m_pTable.m_aLines;
    const from = a.line, to = b && b.tableNode === a.tableNode ? b.line : a.line;
    if (to - from + 1 >= lines.length) return this.DeleteTable(pam);
    return this.tableOp(pam, 'delrow', (t) => {
      const table = t.m_pTable;
      // The cursor goes to the row after, or before when the last rows go.
      const refugeLine = table.m_aLines[to + 1] ?? table.m_aLines[from - 1]!;
      const refuge = this.m_aNodes.GoNext(refugeLine.m_aBoxes[0]!.m_pStartNode!.GetIndex())!;
      for (let l = to; l >= from; l--) for (const box of [...table.m_aLines[l]!.m_aBoxes].reverse()) this.removeBoxNodes(box, refuge);
      table.m_aLines.splice(from, to - from + 1);
      table.m_nRowsToRepeat = Math.min(table.m_nRowsToRepeat, table.m_aLines.length);
      pam.GetPoint().Assign(refuge, 0);
      pam.DeleteMark();
    });
  }

  DeleteCol(pam: SwPaM): boolean {
    const a = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!a) return false;
    if (a.tableNode.m_pTable.m_aLines.every((l) => l.m_aBoxes.length <= 1)) return this.DeleteTable(pam);
    return this.tableOp(pam, 'delcol', (t, at) => {
      let refuge: SwTextNode | null = null;
      for (const line of t.m_pTable.m_aLines) {
        const i = this.boxAtLeft(line, at.left);
        if (line.m_aBoxes.length <= 1) continue;
        const neighbour = line.m_aBoxes[i + 1] ?? line.m_aBoxes[i - 1]!;
        const r = this.m_aNodes.GoNext(neighbour.m_pStartNode!.GetIndex())!;
        if (line === t.m_pTable.m_aLines[at.line]) refuge = r;
        this.removeBoxNodes(line.m_aBoxes[i]!, r);
        line.m_aBoxes.splice(i, 1);
      }
      if (refuge) pam.GetPoint().Assign(refuge, 0);
      pam.DeleteMark();
    });
  }

  /** SwDoc::DeleteTable: keeps a paragraph where the table was if nothing else is left there. */
  DeleteTable(pam: SwPaM): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const t = at.tableNode, first = t.GetIndex(), last = t.EndOfSectionNode().GetIndex();
    const after = this.m_aNodes.node(last + 1), before = this.m_aNodes.node(first - 1);
    // Include the paragraph after (or before) the table so that the cursor has a home.
    const home = after.IsTextNode() ? last + 1 : before.IsTextNode() ? first - 1 : -1;
    const rFirst = home === first - 1 ? first - 1 : first, rLast = home === last + 1 ? last + 1 : last;
    this.recorded('deltable', pam, rFirst, rLast, () => {
      let target: SwTextNode;
      if (home < 0) {
        target = new SwTextNode(this.m_aNodes, this.FindTextFormatCollByName('Standard')!);
        target.m_pStartOfSection = t.m_pStartOfSection;
        this.m_aNodes.Insert(target, last + 1);
      } else target = this.m_aNodes.node(home) as SwTextNode;
      for (let i = first; i <= last; i++) {
        const n = this.m_aNodes.node(i);
        if (n.IsTextNode()) for (const p of [...n.m_aIndices]) p.Assign(target, home === first - 1 ? target.Len() : 0);
      }
      this.m_aNodes.Remove(first, last - first + 1);
      pam.DeleteMark();
    });
    return true;
  }

  /** SwTable's IsEmptyBox: one empty paragraph and nothing anchored in it. */
  private IsEmptyBox(box: SwTableBox): boolean {
    const s = box.m_pStartNode!.GetIndex(), e = box.m_pStartNode!.EndOfSectionNode().GetIndex();
    if (e - s !== 2) return false;
    const n = this.m_aNodes.node(s + 1);
    return n.IsTextNode() && !n.Len() && !n.m_aAnchoredFlys.length;
  }

  /**
   * Moves the content of box `from` (all but a new empty paragraph left behind, as AppendTextNode
   * and MoveNodeRange do) to the end of box `to`.
   */
  private MoveBoxContent(from: SwTableBox, to: SwTableBox): void {
    const nodes = this.m_aNodes;
    const sn = from.m_pStartNode!, s = sn.GetIndex() + 1, e = sn.EndOfSectionNode().GetIndex();
    const moved: SwNode[] = [];
    for (let i = s; i < e; i++) moved.push(nodes.node(i));
    const keep = new SwTextNode(nodes, (moved.find((n) => n.IsTextNode()) as SwTextNode | undefined)?.GetTextColl() ?? this.FindTextFormatCollByName('Table Contents')!);
    nodes.Remove(s, moved.length);
    keep.m_pStartOfSection = sn;
    nodes.Insert(keep, s);
    const target = to.m_pStartNode!, at = target.EndOfSectionNode().GetIndex();
    moved.forEach((n, k) => {
      if (n.m_pStartOfSection === sn) n.m_pStartOfSection = target;
      nodes.Insert(n, at + k);
    });
  }

  /**
   * SwDoc::MergeTable with SwTable::PrepareMerge and NewMerge: the selected rectangle becomes one
   * box, the top left one, spanning the rows of the selection; the other boxes' content is appended
   * to it. Not ported: moving the borders of deleted boxes onto their neighbours.
   */
  MergeTable(pam: SwPaM): TableMergeErr {
    const sa = pam.Start().GetNode().FindTableBoxStartNode(), sb = pam.End().GetNode().FindTableBoxStartNode();
    if (!sa || !sb || sa === sb || sa.m_pStartOfSection !== sb.m_pStartOfSection || !sa.m_pStartOfSection?.IsTableNode()) return TableMergeErr.NoSelection;
    const tableNode = sa.m_pStartOfSection as SwTableNode, table = tableNode.m_pTable;
    // A selection that is no rectangle changes nothing.
    if (!table.CollectBoxSelection(sa, sb, false)) return TableMergeErr.TooComplex;
    let ret: TableMergeErr = TableMergeErr.NoSelection;
    this.tableOp(pam, 'merge', () => {
      const pSel = table.CollectBoxSelection(sa, sb)!;
      const rBoxes = new Set<SwTableBox>(), rMerged = new Set<SwTableBox>();
      const pMergeBox = pSel.maBoxes[0]?.[0];
      if (!pMergeBox) return;
      let pLastBox: SwTableBox | null = null;
      let bMerge = false;
      const nLineCount = pSel.maBoxes.length;
      let nRowSpan = nLineCount;
      let pFirstLn: SwTableLine | null = null, pLastLn: SwTableLine | null = null;
      for (let nCurrLine = 0; nCurrLine < nLineCount; ++nCurrLine) {
        const rLineBoxes = pSel.maBoxes[nCurrLine]!;
        const nColCount = rLineBoxes.length;
        for (let nCurrCol = 0; nCurrCol < nColCount; ++nCurrCol) {
          const pBox = rLineBoxes[nCurrCol]!;
          rMerged.add(pBox);
          // Only the first selected cell in every row will be alive, the other will be deleted
          if (nCurrCol) rBoxes.add(pBox);
          else {
            if (nCurrLine === 1) pFirstLn = pBox.m_pUpper;
            if (nCurrLine + 1 === nLineCount) pLastLn = pBox.m_pUpper;
          }
          // A box has to be merged if it's not the master box itself,
          // but an already overlapped cell must not be merged as well.
          const bDoMerge = pBox !== pMergeBox && pBox.getRowSpan() > 0;
          if (nCurrCol + 1 === nColCount && pBox.getRowSpan() > 0) pLastBox = pBox;
          if (bDoMerge) {
            bMerge = true;
            // If the cell to merge contains only one empty paragraph, we do not transfer this paragraph.
            if (!this.IsEmptyBox(pBox)) this.MoveBoxContent(pBox, pMergeBox);
          }
          // Only the cell of the first selected column will stay alive and got a new row span
          if (!nCurrCol) pBox.setRowSpan(nRowSpan);
        }
        if (nRowSpan > 0) nRowSpan = -nRowSpan; // the master cell is done, from now on we set negative row spans
        ++nRowSpan; // ... -3, -2, -1
      }
      if (bMerge) {
        // A row containing overlapped cells is superfluous, these cells can be put into rBoxes for deletion
        table.FindSuperfluousRows_(rBoxes, pFirstLn, pLastLn);
        const merged = { ...pMergeBox.m_aAttrs, width: pSel.mnMergeWidth };
        for (let nCurrLine = 0; nCurrLine < nLineCount; ++nCurrLine) {
          pSel.maBoxes[nCurrLine]!.forEach((pBox, nCurrCol) => {
            // Even this box will be deleted soon, we have to correct the width to avoid side effects
            if (nCurrCol) pBox.m_aAttrs = { ...pBox.m_aAttrs, width: 0 };
            else {
              pBox.m_aAttrs = structuredClone(merged);
              // remove numbering from cells that will be disabled in the merge
              if (nCurrLine) for (let i = pBox.m_pStartNode!.GetIndex() + 1; i < pBox.m_pStartNode!.EndOfSectionNode().GetIndex(); i++) {
                const n = this.m_aNodes.node(i);
                if (n.IsTextNode() && n.m_aSet.RES_PARATR_NUMRULE) n.m_aSet.RES_PARATR_LIST_ISCOUNTED = false;
              }
            }
          });
        }
        if (pLastBox) {
          // The new borders of the master cell...
          const lb = (pLastBox as SwTableBox).m_aAttrs.box;
          pMergeBox.m_aAttrs = { ...pMergeBox.m_aAttrs, box: { ...pMergeBox.m_aAttrs.box, right: lb.right, bottom: lb.bottom } };
        }
        // NewMerge: SwTable::DeleteSel
        const refuge = this.m_aNodes.GoNext(pMergeBox.m_pStartNode!.GetIndex())!;
        const del = table.GetTabSortBoxes().filter((b) => rBoxes.has(b));
        table.PrepareDelBoxes(del);
        for (const box of [...del].reverse()) {
          this.removeBoxNodes(box, refuge);
          const l = box.m_pUpper;
          l.m_aBoxes.splice(l.m_aBoxes.indexOf(box), 1);
        }
        // GCLines
        table.m_aLines = table.m_aLines.filter((l) => l.m_aBoxes.length);
        table.m_nRowsToRepeat = Math.min(table.m_nRowsToRepeat, table.m_aLines.length);
        pam.GetPoint().Assign(refuge, 0);
        pam.DeleteMark();
        ret = TableMergeErr.Ok;
      }
    });
    return ret;
  }

  /**
   * InsertRow_ for InsertSpannedRow: nCnt rows after line nRowIdx with empty copies of its boxes,
   * whose row spans the caller sets.
   */
  private insertEmptyLinesAfter(tableNode: SwTableNode, nRowIdx: number, nCnt: number): void {
    const table = tableNode.m_pTable, src = table.m_aLines[nRowIdx]!;
    let where = src.m_aBoxes[src.m_aBoxes.length - 1]!.m_pStartNode!.EndOfSectionNode().GetIndex() + 1;
    for (let k = 0; k < nCnt; k++) {
      const line = new SwTableLine();
      line.m_aAttrs = structuredClone(src.m_aAttrs);
      for (const b of src.m_aBoxes) {
        const box = new SwTableBox(line, structuredClone(b.m_aAttrs));
        box.m_pStartNode = this.makeBoxNodes(tableNode, where, this.boxColl(b));
        where += 3;
        line.m_aBoxes.push(box);
      }
      table.m_aLines.splice(nRowIdx + 1 + k, 0, line);
    }
  }

  /** SwTable::InsertSpannedRow: rows of overlapped cells only, as a preparation for a split. */
  private InsertSpannedRow(tableNode: SwTableNode, nRowIdx: number, nCnt: number): void {
    const table = tableNode.m_pTable, rLine = table.m_aLines[nRowIdx]!;
    // A row height other than the automatic one is shared.
    if (rLine.m_aAttrs.minHeight) rLine.m_aAttrs = { ...rLine.m_aAttrs, minHeight: Math.max(1, Math.trunc(rLine.m_aAttrs.minHeight / (nCnt + 1))) };
    this.insertEmptyLinesAfter(tableNode, nRowIdx, nCnt);
    const nBoxCount = rLine.m_aBoxes.length;
    for (let n = 0; n < nCnt; ++n) {
      const pNewLine = table.m_aLines[nRowIdx + nCnt - n]!;
      for (let nCurrBox = 0; nCurrBox < nBoxCount; ++nCurrBox) {
        let nRowSpan = rLine.m_aBoxes[nCurrBox]!.getRowSpan();
        if (nRowSpan > 0) nRowSpan = -nRowSpan;
        pNewLine.m_aBoxes[nCurrBox]!.setRowSpan(nRowSpan - n);
      }
    }
    lcl_ChangeRowSpan(table, nCnt, nRowIdx, false);
  }

  /**
   * SwDoc::SplitTable for boxes (SwFEShell::SplitTab): bVert splits each box into nCnt + 1 boxes
   * side by side (SwTable::SplitCol), otherwise into nCnt + 1 rows (SwTable::NewSplitRow). The
   * split into rows of the same height (bSameHeight, which needs the layout's row heights) is
   * not ported: rows are shared evenly.
   */
  SplitTable(pam: SwPaM, boxes: SwTableBox[], bVert: boolean, nCnt: number): boolean {
    if (!boxes.length || nCnt < 1) return false;
    return this.tableOp(pam, 'splitcells', (tableNode) => {
      const table = tableNode.m_pTable;
      if (bVert) {
        // SwTable::SplitCol
        for (const pSelBox of ExpandSelection(table, boxes)) {
          const nBoxSz = pSelBox.m_aAttrs.width;
          // We don't want to split small table cells into very very small cells
          if (nBoxSz / (nCnt + 1) < 1e-6) continue;
          const pInsLine = pSelBox.m_pUpper;
          const nBoxPos = pInsLine.m_aBoxes.indexOf(pSelBox);
          const nNewBoxSz = nBoxSz / (nCnt + 1);
          const right = pSelBox.m_aAttrs.box.right;
          pSelBox.m_aAttrs = { ...pSelBox.m_aAttrs, width: nNewBoxSz };
          let where = pSelBox.m_pStartNode!.EndOfSectionNode().GetIndex() + 1;
          for (let i = 1; i <= nCnt; ++i) {
            // InsTableBox: insert after
            const box = new SwTableBox(pInsLine, structuredClone({ ...pSelBox.m_aAttrs, width: i === nCnt ? nBoxSz - nNewBoxSz * nCnt : nNewBoxSz }));
            box.setRowSpan(pSelBox.getRowSpan());
            box.m_pStartNode = this.makeBoxNodes(tableNode, where, this.boxColl(pSelBox));
            where += 3;
            pInsLine.m_aBoxes.splice(nBoxPos + i, 0, box);
          }
          // Special treatment for the Border: the right border goes to the last new box.
          if (right) pSelBox.m_aAttrs = { ...pSelBox.m_aAttrs, box: { ...pSelBox.m_aAttrs.box, right: null } };
        }
        return;
      }
      // SwTable::NewSplitRow
      const parts = nCnt + 1;
      const aLineOffs = lcl_SophisticatedFillLineIndices(table, boxes, parts);
      for (const [line, n] of [...aLineOffs].reverse()) this.InsertSpannedRow(tableNode, line, n);
      for (const b of boxes) if (b.getRowSpan() > 1) lcl_UnMerge(table, b, parts);
    });
  }

  /**
   * The paragraphs of a box, copied into a box with one empty paragraph (CopyHeadlineIntoTable's
   * lcl_CopyLineToDoc, reduced): text, styles and attributes; footnotes, comments, objects and
   * nested tables are not copied.
   */
  private copyBoxParagraphs(src: SwTableBox, dst: SwTableBox): void {
    const nodes = this.m_aNodes, ss = src.m_pStartNode!, ds = dst.m_pStartNode!;
    const texts: SwTextNode[] = [];
    for (let i = ss.GetIndex() + 1; i < ss.EndOfSectionNode().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode() && n.m_pStartOfSection === ss) texts.push(n); }
    const skip = (a: SwCharAttrSet) => !!(a.RES_TXTATR_FTN || a.RES_TXTATR_ANNOTATION || a.RES_TXTATR_FLYCNT || a.RES_TXTATR_REDLINE);
    if (!texts.length) return;
    const at = ds.EndOfSectionNode().GetIndex();
    nodes.Remove(ds.GetIndex() + 1, at - ds.GetIndex() - 1);
    texts.forEach((t, k) => {
      const n = new SwTextNode(nodes, t.GetTextColl());
      // Placeholders of content that is not copied go with it.
      const gone = new Set(t.m_aHints.filter((h) => skip(h.aAttrs) && t.m_Text[h.nStart] === CH_TXTATR_BREAKWORD).map((h) => h.nStart));
      const map = (i: number) => i - [...gone].filter((g) => g < i).length;
      n.m_Text = [...t.m_Text].filter((_, i) => !gone.has(i)).join('');
      n.m_aHints = t.m_aHints.filter((h) => !skip(h.aAttrs)).map((h) => ({ nStart: map(h.nStart), nEnd: map(h.nEnd), aAttrs: { ...h.aAttrs } }));
      n.m_aSet = structuredClone(t.m_aSet);
      delete n.m_aSet.RES_PARATR_REDLINE;
      n.m_pStartOfSection = ds;
      nodes.Insert(n, ds.GetIndex() + 1 + k);
    });
  }

  /**
   * SwDoc::SplitTable at a position (SwNodes::SplitTable): the rows from the cursor's row on become
   * a new table after a new paragraph; its heading follows eHdlnMode. Not ported: recalculating the
   * table widths (bCalcNewSize) and floating tables.
   */
  SplitTableAt(pam: SwPaM, eHdlnMode: SplitTable_HeadlineOption): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const pTNd = at.tableNode, rTable = pTNd.m_pTable;
    const nLinePos = at.line;
    if (!nLinePos) return false; // Not found or first Line!
    this.recorded('splittable', pam, pTNd.GetIndex(), pTNd.EndOfSectionNode().GetIndex(), () => {
      const nodes = this.m_aNodes;
      const pBox = rTable.m_aLines[nLinePos]!.m_aBoxes[0]!;
      const where = pBox.m_pStartNode!.GetIndex();
      // Insert an EndNode and TableNode into the Nodes Array
      const pOldTableEndNd = pTNd.EndOfSectionNode();
      const newTable = new SwTable({ ...structuredClone(rTable.m_aAttrs), name: this.GetUniqueTableName() });
      const pNewTableNd = new SwTableNode(nodes, newTable);
      pNewTableNd.m_pStartOfSection = pTNd.m_pStartOfSection;
      const end = new SwEndNode(nodes, pTNd);
      pOldTableEndNd.m_pStartOfSection = pNewTableNd;
      pNewTableNd.m_pEndOfSection = pOldTableEndNd;
      nodes.Insert(end, where);
      nodes.Insert(pNewTableNd, where + 1);
      // Move the Lines
      const moved = rTable.m_aLines.splice(nLinePos);
      newTable.m_aLines = moved;
      for (const l of moved) for (const b of l.m_aBoxes) b.m_pStartNode!.m_pStartOfSection = pNewTableNd;
      // A new SwTable repeats one heading row.
      newTable.m_nRowsToRepeat = 1;
      rTable.m_nRowsToRepeat = Math.min(rTable.m_nRowsToRepeat, rTable.m_aLines.length);
      // SwTable::CleanUpBottomRowSpan and CleanUpTopRowSpan
      if (rTable.m_aLines[rTable.m_aLines.length - 1]!.m_aBoxes.some((b) => Math.abs(b.getRowSpan()) > 1)) lcl_ChangeRowSpan(rTable, -moved.length, rTable.m_aLines.length - 1, false);
      for (const b of moved[0]!.m_aBoxes) if (b.getRowSpan() < 0) b.setRowSpan(-b.getRowSpan());
      switch (eHdlnMode) {
        // Set the lower Border of the preceding Line to the upper Border of the current one
        case SplitTable_HeadlineOption.BorderCopy: {
          const last = rTable.m_aLines[rTable.m_aLines.length - 1]!;
          for (const b of moved[0]!.m_aBoxes) {
            const src = lcl_LeftBorder2Box(lcl_Box2LeftBorder(b), last) ?? last.m_aBoxes[0]!;
            if (!b.m_aAttrs.box.top) b.m_aAttrs = { ...b.m_aAttrs, box: { ...b.m_aAttrs.box, top: src.m_aAttrs.box.bottom } };
          }
          // Switch off repeating Header
          newTable.m_nRowsToRepeat = 0;
          break;
        }
        // Take over the Attributes of the first Line to the new one
        case SplitTable_HeadlineOption.BoxAttrCopy:
        case SplitTable_HeadlineOption.BoxAttrAllCopy: {
          const first = rTable.m_aLines[0]!;
          for (const b of moved[0]!.m_aBoxes) {
            const src = lcl_LeftBorder2Box(lcl_Box2LeftBorder(b), first) ?? first.m_aBoxes[0]!;
            b.m_aAttrs = { ...b.m_aAttrs, box: structuredClone(src.m_aAttrs.box), padding: src.m_aAttrs.padding, background: src.m_aAttrs.background, vertOrient: src.m_aAttrs.vertOrient, protect: src.m_aAttrs.protect };
            if (eHdlnMode === SplitTable_HeadlineOption.BoxAttrAllCopy) {
              // If the Node is alone in the Section, it takes the paragraph style.
              const sn = b.m_pStartNode!;
              if (sn.EndOfSectionNode().GetIndex() - sn.GetIndex() === 2) (nodes.node(sn.GetIndex() + 1) as SwTextNode).m_pColl = this.boxColl(src);
            }
          }
          break;
        }
        case SplitTable_HeadlineOption.ContentCopy: {
          // CopyHeadlineIntoTable: the first line, with its content, at the top of the new table.
          const head = rTable.m_aLines[0]!;
          const line = new SwTableLine();
          line.m_aAttrs = structuredClone(head.m_aAttrs);
          let w = pNewTableNd.GetIndex() + 1;
          for (const b of head.m_aBoxes) {
            const box = new SwTableBox(line, structuredClone(b.m_aAttrs));
            box.m_pStartNode = this.makeBoxNodes(pNewTableNd, w, this.boxColl(b));
            this.copyBoxParagraphs(b, box);
            w = box.m_pStartNode.EndOfSectionNode().GetIndex() + 1;
            line.m_aBoxes.push(box);
          }
          // The copied line must not contain any row span attributes > 1
          newTable.m_aLines.unshift(line);
          break;
        }
        case SplitTable_HeadlineOption.NONE:
          // Switch off repeating the Header
          newTable.m_nRowsToRepeat = 0;
          break;
      }
      // Insert a paragraph between the tables
      const para = new SwTextNode(nodes, this.FindTextFormatCollByName('Text Body') ?? this.FindTextFormatCollByName('Standard')!);
      para.m_pStartOfSection = pTNd.m_pStartOfSection;
      nodes.Insert(para, pNewTableNd.GetIndex());
      pam.GetPoint().Assign(para, 0);
      pam.DeleteMark();
    });
    return true;
  }

  /** SwFEShell::CanMergeTable: the tables directly before and after the cursor's table. */
  CanMergeTable(node: SwTextNode): { prev: boolean; next: boolean } {
    const t = node.FindTableNode();
    if (!t) return { prev: false, next: false };
    const before = this.m_aNodes.node(t.GetIndex() - 1), after = this.m_aNodes.node(t.EndOfSectionNode().GetIndex() + 1);
    return { prev: before.IsEndNode() && !!before.m_pStartOfSection?.IsTableNode(), next: !!after?.IsTableNode() };
  }

  /**
   * SwDoc::MergeTable with SwNodes::MergeTable: the cursor's table and the one directly before
   * (bWithPrev) or after it become one; the earlier one stays. Not ported: the border clean-up.
   */
  MergeTables(pam: SwPaM, bWithPrev: boolean): boolean {
    const pTableNd = pam.GetPoint().GetNode().FindTableNode();
    if (!pTableNd) return false;
    const can = this.CanMergeTable(pam.GetPoint().GetNode());
    if (bWithPrev ? !can.prev : !can.next) return false;
    const first = bWithPrev ? (this.m_aNodes.node(pTableNd.GetIndex() - 1).m_pStartOfSection as SwTableNode) : pTableNd;
    const second = bWithPrev ? pTableNd : (this.m_aNodes.node(pTableNd.EndOfSectionNode().GetIndex() + 1) as SwTableNode);
    this.recorded('mergetables', pam, first.GetIndex(), second.EndOfSectionNode().GetIndex(), () => {
      const rTable = first.m_pTable, rDelTable = second.m_pTable;
      // Sync the TableFormat's Width
      if (rDelTable.m_aAttrs.adjust !== 'full' && rTable.m_aAttrs.adjust !== 'full') rTable.m_aAttrs = { ...rTable.m_aAttrs, width: Math.max(rTable.m_aAttrs.width, rDelTable.m_aAttrs.width) };
      // Scale the second table's box widths to the first's units.
      const total = (t: SwTable) => t.m_aLines[0]?.m_aBoxes.reduce((x, b) => x + b.m_aAttrs.width, 0) || 1;
      const k = total(rTable) / total(rDelTable);
      for (const l of rDelTable.m_aLines) for (const b of l.m_aBoxes) { b.m_aAttrs = { ...b.m_aAttrs, width: b.m_aAttrs.width * k }; b.m_pStartNode!.m_pStartOfSection = first; }
      rTable.m_aLines.push(...rDelTable.m_aLines);
      rDelTable.m_aLines = [];
      // The preceding Table always remains, while the succeeding one is deleted
      const pTableEndNd = second.EndOfSectionNode();
      first.m_pEndOfSection = pTableEndNd;
      pTableEndNd.m_pStartOfSection = first;
      this.m_aNodes.Remove(second.GetIndex() - 1, 2);
    });
    return true;
  }

  /**
   * SwDoc::TextToTable with SwNodes::TextToTable: the paragraphs of the selection become the rows of
   * a table, split into cells at `cCh` (or one cell per paragraph with T2T_PARA); short rows get
   * empty cells (lcl_BalanceTable). The columns are of equal width: the tab positions of the
   * first line (cCh 0x0b, the "Equal width" option off) are not used. Tracked changes in the
   * selection are not accepted first; a selection containing a table is refused.
   */
  TextToTable(pam: SwPaM, cCh: string, opts: { repeat: number; dontSplit: boolean; borders: boolean }): SwTableNode | null {
    const start = pam.Start(), end = pam.End();
    // See if the selection contains a Table
    for (let i = start.GetNodeIndex(); i <= end.GetNodeIndex(); i++) if (!this.m_aNodes.node(i).IsTextNode()) return null;
    if (start.GetNode().StartOfSectionNode() !== end.GetNode().StartOfSectionNode()) return null;
    let pTableNd: SwTableNode | null = null;
    const startNode = start.GetNode(), startContent = start.GetContentIndex();
    const endNode = end.GetNode(), endContent = end.GetContentIndex();
    this.recorded('texttotable', pam, start.GetNodeIndex(), end.GetNodeIndex(), () => {
      const nodes = this.m_aNodes;
      // Make sure that the range is on Node Edges
      let first = startNode, last = endNode;
      if (startContent) { first = startNode.SplitContentNode(startContent); if (last === startNode) last = first; }
      const lastEnd = last === endNode ? endContent - (endNode === startNode ? startContent : 0) : last.Len();
      // Do not split at the End of a Line
      if (lastEnd && lastEnd < last.Len()) last.SplitContentNode(lastEnd);
      const parent = first.m_pStartOfSection!;
      const table = new SwTable({ name: this.GetUniqueTableName(), adjust: 'full', width: 0, leftSpace: 0, upper: 0, lower: 0, ...(opts.dontSplit ? { dontSplit: true } : {}) });
      const tableNd = new SwTableNode(nodes, table);
      tableNd.m_pStartOfSection = parent;
      nodes.Insert(tableNd, first.GetIndex());
      const paras: SwTextNode[] = [];
      for (let i = first.GetIndex(); i <= last.GetIndex(); i++) paras.push(nodes.node(i) as SwTextNode);
      let nMaxBoxes = 0;
      for (const para of paras) {
        const line = new SwTableLine();
        table.m_aLines.push(line);
        const pieces: SwTextNode[] = [para];
        if (cCh !== T2T_PARA) {
          for (let cur = para, at = cur.GetText().indexOf(cCh); at >= 0; at = cur.GetText().indexOf(cCh)) {
            const next = cur.SplitContentNode(at);
            // Delete separator and correct search string
            next.EraseText(0, 1);
            pieces.push(next);
            cur = next;
          }
        }
        for (const piece of pieces) {
          const sn = new SwStartNode(nodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
          sn.m_pStartOfSection = tableNd;
          nodes.Insert(sn, piece.GetIndex());
          piece.m_pStartOfSection = sn;
          // Breaks of the paragraphs go (lcl_RemoveBreaks); the first one's becomes the table's (not ported).
          delete piece.m_aSet.RES_BREAK;
          delete piece.m_aSet.RES_PAGEDESC;
          nodes.Insert(new SwEndNode(nodes, sn), piece.GetIndex() + 1);
          const box = new SwTableBox(line, defaultBoxAttrs(1, opts.borders));
          box.m_pStartNode = sn;
          line.m_aBoxes.push(box);
        }
        nMaxBoxes = Math.max(nMaxBoxes, pieces.length);
      }
      const lastLine = table.m_aLines[table.m_aLines.length - 1]!;
      nodes.Insert(new SwEndNode(nodes, tableNd), lastLine.m_aBoxes[lastLine.m_aBoxes.length - 1]!.m_pStartNode!.EndOfSectionNode().GetIndex() + 1);
      // lcl_BalanceTable: every row gets as many boxes as the longest one.
      const coll = this.FindTextFormatCollByName('Standard')!;
      for (const line of table.m_aLines) {
        while (line.m_aBoxes.length < nMaxBoxes) {
          const lastBox = line.m_aBoxes[line.m_aBoxes.length - 1]!;
          const box = new SwTableBox(line, defaultBoxAttrs(1, opts.borders));
          box.m_pStartNode = this.makeBoxNodes(tableNd, lastBox.m_pStartNode!.EndOfSectionNode().GetIndex() + 1, coll);
          line.m_aBoxes.push(box);
        }
      }
      table.m_nRowsToRepeat = Math.min(opts.repeat, table.m_aLines.length);
      pam.GetPoint().Assign(nodes.GoNext(tableNd.GetIndex())!, 0);
      pam.DeleteMark();
      pTableNd = tableNd;
    });
    return pTableNd;
  }

  /**
   * SwDoc::TableToText with SwNodes::TableToText: each row becomes a paragraph, its cells' text
   * joined by `cCh` (with T2T_PARA every cell's paragraphs stay paragraphs). Refused for a table
   * containing tables.
   */
  TableToText(pam: SwPaM, cCh: string): boolean {
    const at = this.GetTableBoxAt(pam.GetPoint().GetNode());
    if (!at) return false;
    const t = at.tableNode, first = t.GetIndex(), last = t.EndOfSectionNode().GetIndex();
    for (let i = first + 1; i < last; i++) if (this.m_aNodes.node(i).IsTableNode()) return false;
    this.recorded('tabletotext', pam, first, last, () => {
      const nodes = this.m_aNodes, parent = t.m_pStartOfSection!;
      // Each box's first and last paragraph, by line.
      const ends = t.m_pTable.m_aLines.map((line) => line.m_aBoxes.map((box) => {
        const sn = box.m_pStartNode!;
        return { first: nodes.GoNext(sn.GetIndex())!, last: nodes.GoPrevious(sn.EndOfSectionNode().GetIndex())! };
      }));
      // lcl_DelBox: the boxes' paragraphs go to the section of the table's parent.
      for (const line of [...t.m_pTable.m_aLines].reverse()) {
        for (const box of [...line.m_aBoxes].reverse()) {
          const sn = box.m_pStartNode!, en = sn.EndOfSectionNode();
          for (let i = sn.GetIndex() + 1; i < en.GetIndex(); i++) { const n = nodes.node(i); if (n.m_pStartOfSection === sn) n.m_pStartOfSection = parent; }
          nodes.Remove(en.GetIndex());
          nodes.Remove(sn.GetIndex());
        }
      }
      nodes.Remove(t.EndOfSectionNode().GetIndex());
      nodes.Remove(t.GetIndex());
      // A box's first paragraph is appended to the previous box's last, with the separator between.
      if (cCh !== T2T_PARA) {
        for (const line of ends) {
          for (let k = line.length - 1; k > 0; k--) {
            const prev = line[k - 1]!.last;
            prev.InsertText(cCh, prev.Len());
            prev.JoinNext();
          }
        }
      }
      pam.GetPoint().Assign(ends[0]![0]!.first, 0);
      pam.DeleteMark();
    });
    return true;
  }

  /**
   * SwDoc::SetTableAutoFormat with lcl_SetAFormatBox and SwTableAutoFormat::UpdateToSet and
   * RestoreTableProperties: the boxes take the format of their row and column class; their
   * paragraphs its character attributes and alignment. Boxes' direct formatting is not tracked
   * (HasDirectFormatting), so every box is formatted. Number formats are not ported.
   */
  SetTableAutoFormat(pam: SwPaM, rBoxes: SwTableBox[], rNew: SwTableAutoFormat): boolean {
    if (!rBoxes.length) return false;
    const tableNode = rBoxes[0]!.m_pStartNode!.m_pStartOfSection;
    if (!tableNode?.IsTableNode()) return false;
    return this.tableOp(pam, 'autoformat', (t) => {
      const table = t.m_pTable;
      table.m_aAttrs = { ...table.m_aAttrs, styleName: rNew.m_aName };
      // RestoreTableProperties
      table.m_aAttrs = { ...table.m_aAttrs, dontSplit: rNew.m_bLayoutSplit ? undefined : true, keepWithNext: rNew.m_bKeepWithNextPara ? true : table.m_aAttrs.keepWithNext };
      const sel = new Set(rBoxes);
      const lines = table.m_aLines.filter((l) => l.m_aBoxes.some((b) => sel.has(b)));
      for (const l of lines) l.m_aAttrs = { ...l.m_aAttrs, cantSplit: rNew.m_bRowSplit ? undefined : true };
      table.m_nRowsToRepeat = rNew.m_aRepeatHeading;
      const bSingleRowTable = lines.length === 1;
      lines.forEach((line, n) => {
        const boxes = line.m_aBoxes.filter((b) => sel.has(b));
        boxes.forEach((pSetBox, k) => {
          const nPos = AutoFormatPos(n, lines.length, k, boxes.length);
          const rChg = rNew.m_aBoxAutoFormat[nPos]!;
          const chars: SwAttrSet = {};
          if (rNew.m_bInclFont) {
            Object.assign(chars, {
              RES_CHRATR_FONT: rChg.font, RES_CHRATR_FONTSIZE: rChg.height, RES_CHRATR_WEIGHT: rChg.weight, RES_CHRATR_POSTURE: rChg.posture,
              RES_CHRATR_UNDERLINE: rChg.underline, RES_CHRATR_OVERLINE: rChg.overline, RES_CHRATR_CROSSEDOUT: rChg.crossedOut,
              RES_CHRATR_CONTOUR: rChg.contour, RES_CHRATR_SHADOWED: rChg.shadowed, RES_CHRATR_COLOR: rChg.color,
            });
          }
          if (rNew.m_bInclJustify) chars.RES_PARATR_ADJUST = rChg.adjust;
          const sn = pSetBox.m_pStartNode!;
          if (Object.keys(chars).length) for (let i = sn.GetIndex() + 1; i < sn.EndOfSectionNode().GetIndex(); i++) {
            const nd = this.m_aNodes.node(i);
            if (nd.IsTextNode()) { Object.assign(nd.m_aSet, chars); nd.m_nVersion++; }
          }
          let a = { ...pSetBox.m_aAttrs };
          if (rNew.m_bInclFrame) {
            const box = BoxBorders(rNew, nPos, bSingleRowTable, boxes.length === 1);
            const [l, tp, , b] = rChg.dist;
            a = { ...a, box: structuredClone(box), padding: l, ...(tp !== l || b !== l ? { dist: { top: tp, bottom: b } } : { dist: undefined }) };
          }
          if (rNew.m_bInclBackground) a.background = rChg.background;
          // Do not put a VertAlign when it has default value.
          if (rChg.vertOrient) a.vertOrient = rChg.vertOrient === 'top' ? undefined : rChg.vertOrient;
          pSetBox.m_aAttrs = a;
        });
      });
    });
  }

  // --- box values, number formats and formulas (ndtbl.cxx ChkBoxNumFormat, swtable.cxx ChgTextToNum) ---

  /**
   * ChgTextToNum: the box's paragraph shows `rText` (tabs at its start and end kept), right
   * aligned with bChgAlign when it was left aligned or justified, in the format's colour (the
   * user's own colour comes back when the format has none).
   */
  private ChgTextToNum(box: SwTableBox, rText: string, pCol: string | null, bChgAlign: boolean): void {
    const sn = box.m_pStartNode!;
    if (sn.EndOfSectionNode().GetIndex() !== sn.GetIndex() + 2) return;
    const pTNd = this.m_aNodes.node(sn.GetIndex() + 1);
    if (!pTNd.IsTextNode()) return;
    if (bChgAlign) {
      const eAdjust = pTNd.GetAttr('RES_PARATR_ADJUST');
      if (eAdjust === 'left' || eAdjust === 'block') pTNd.m_aSet.RES_PARATR_ADJUST = 'right';
    }
    // assign color or save "user color"
    const old = box.m_aAttrs.numColor ?? null, user = pTNd.m_aSet.RES_CHRATR_COLOR;
    if (pCol) pTNd.m_aSet.RES_CHRATR_COLOR = pCol;
    else if (old && user === old) delete pTNd.m_aSet.RES_CHRATR_COLOR;
    box.m_aAttrs = { ...box.m_aAttrs, numColor: pCol ?? undefined };
    if (pTNd.GetText() !== rText) {
      // Exchange text. Bugfix to keep Tabs (front and back!)
      const rOrig = pTNd.GetText();
      let n = 0;
      while (n < rOrig.length && rOrig[n] === '\t') n++;
      let e = rOrig.length;
      while (e > n && rOrig[e - 1] === '\t') e--;
      pTNd.EraseText(n, e - n);
      pTNd.InsertText(rText, n);
    }
    pTNd.m_nVersion++;
  }

  /** ChgNumToText: back to text; a right alignment set for the number goes. */
  private ChgNumToText(box: SwTableBox): void {
    const sn = box.m_pStartNode!;
    const pTNd = this.m_aNodes.node(sn.GetIndex() + 1);
    if (!pTNd.IsTextNode()) return;
    if (pTNd.m_aSet.RES_PARATR_ADJUST === 'right') delete pTNd.m_aSet.RES_PARATR_ADJUST;
    if (box.m_aAttrs.numColor && pTNd.m_aSet.RES_CHRATR_COLOR === box.m_aAttrs.numColor) delete pTNd.m_aSet.RES_CHRATR_COLOR;
    box.m_aAttrs = { ...box.m_aAttrs, numColor: undefined };
    pTNd.m_nVersion++;
  }

  /**
   * SwTableBoxFormat::BoxAttributeChanged: after a new format, value or formula the box's text shows
   * the value in the format (a value read from the text when there is none yet); a text format
   * keeps the text.
   */
  private BoxAttributeChanged(box: SwTableBox, bFormatChanged: boolean): void {
    const a = box.m_aAttrs, lang = BoxLanguage(this, box);
    const fmt = a.numFormat ?? 'General';
    if (IsTextFormat(fmt, lang)) { if (bFormatChanged) this.ChgNumToText(box); return; }
    let fVal = a.value;
    if (fVal === undefined) {
      // so far, no value has been set, so try to evaluate the content
      const aText = BoxText(this, box);
      if (!aText) return;
      const r = IsNumberFormat(aText, lang, a.numFormat);
      if (!r) return;
      fVal = r.value;
      box.m_aAttrs = { ...box.m_aAttrs, value: fVal };
    }
    if (Number.isNaN(fVal)) { this.ChgTextToNum(box, SW_CALC_ERROR, null, false); return; }
    const out = GetOutputString(fVal, fmt, lang);
    this.ChgTextToNum(box, out.text, out.color, true);
  }

  /** The formula boxes of a table get their values anew (SwDoc::UpdateTableFields, reduced to one table). */
  private UpdateTableFieldsOf(table: SwTable): void {
    for (const box of table.GetTabSortBoxes()) {
      if (box.m_aAttrs.formula === undefined) continue;
      const v = CalcFormula(this, table, box.m_aAttrs.formula, undefined, BoxLanguage(this, box));
      box.m_aAttrs = { ...box.m_aAttrs, value: v };
      this.BoxAttributeChanged(box, false);
    }
  }

  /**
   * SwEditShell::SetTableBoxFormulaAttrs: the boxes' number format, value or formula (null removes
   * it); the formulas of the table are calculated again.
   */
  SetTableBoxFormulaAttrs(pam: SwPaM, boxes: SwTableBox[], change: { numFormat?: string | null; value?: number | null; formula?: string | null }): boolean {
    if (!boxes.length) return false;
    return this.tableOp(pam, 'boxformula', (t) => {
      for (const box of boxes) {
        const a = { ...box.m_aAttrs };
        if (change.numFormat !== undefined) { if (change.numFormat === null) delete a.numFormat; else a.numFormat = change.numFormat; }
        if (change.value !== undefined) { if (change.value === null) delete a.value; else a.value = change.value; }
        if (change.formula !== undefined) {
          if (change.formula === null) delete a.formula; else { a.formula = change.formula; delete a.value; }
        }
        box.m_aAttrs = a;
        if (change.formula) a.value = CalcFormula(this, t.m_pTable, change.formula, undefined, BoxLanguage(this, box));
        this.BoxAttributeChanged(box, change.numFormat !== undefined);
      }
      this.UpdateTableFieldsOf(t.m_pTable);
    });
  }

  /**
   * SwDoc::ChkBoxNumFormat: after editing, a box whose text is a number gets it as its value (with
   * number recognition, bInsTableFormatNum, in the format it was written in; a box with a format of
   * the same type keeps it), and the table's formulas are calculated again. `sOrigText` is the
   * text before editing: a formula box whose text changed loses its formula (ClearBoxNumAttrs).
   */
  ChkBoxNumFormat(pam: SwPaM, rBox: SwTableBox, bInsTableFormatNum: boolean, sOrigText: string | null): void {
    const tableNode = rBox.m_pStartNode?.m_pStartOfSection;
    if (!tableNode?.IsTableNode()) return;
    const lang = BoxLanguage(this, rBox);
    const aText = BoxText(this, rBox);
    const a = rBox.m_aAttrs;
    const formulaEdited = a.formula !== undefined && sOrigText !== null && aText !== sOrigText;
    // Optimization: If the Box says it's Text, it remains Text
    if (a.numFormat && IsTextFormat(a.numFormat, lang) && !formulaEdited) return;
    const r = aText !== null && aText !== '' ? IsNumberFormat(aText, lang, a.numFormat) : null;
    const table = (tableNode as SwTableNode).m_pTable;
    // UpdateTableFields: only a table with formulas has something to update.
    const refresh = () => { if (table.GetTabSortBoxes().some((b) => b.m_aAttrs.formula !== undefined)) this.tableOp(pam, 'tablefields', (t) => this.UpdateTableFieldsOf(t.m_pTable)); };
    const hasFormula = a.formula !== undefined && !formulaEdited;
    if (hasFormula) { refresh(); return; }
    const sameValue = r && a.value === r.value && aText === (a.numFormat ? GetOutputString(r.value, a.numFormat, lang).text : aText);
    if (r && sameValue && !formulaEdited) { refresh(); return; }
    // Without number recognition, a box without a format stays text.
    if (r && !bInsTableFormatNum && a.numFormat === undefined && a.value === undefined && !formulaEdited) { refresh(); return; }
    if (!r && a.numFormat === undefined && a.value === undefined && a.formula === undefined) { refresh(); return; }
    this.tableOp(pam, 'numformat', (t) => {
      const b = { ...rBox.m_aAttrs };
      delete b.formula;
      if (r) {
        let nFormat = r.code, bSetNumberFormat = bInsTableFormatNum;
        // if the user forced a number format in this cell previously, keep it
        if (a.numFormat) {
          const nFormatType = GetType(nFormat, lang);
          if (nFormatType === GetType(a.numFormat, lang) || nFormatType === SvNumFormatType.NUMBER) { nFormat = a.numFormat; bSetNumberFormat = true; }
          else bSetNumberFormat = false; // -> insert as Text
        }
        delete b.value;
        if (bSetNumberFormat) { b.value = r.value; b.numFormat = nFormat; } else delete b.numFormat;
        rBox.m_aAttrs = b;
        if (bSetNumberFormat) this.BoxAttributeChanged(rBox, true);
      } else {
        // It's not a number: remove all number formats
        delete b.value;
        if (aText) delete b.numFormat;
        rBox.m_aAttrs = b;
        if (aText) this.ChgNumToText(rBox);
      }
      this.UpdateTableFieldsOf(t.m_pTable);
    });
  }

  /** Sets attributes of the boxes of the selection, or of every box with `whole`. */
  SetBoxAttr(pam: SwPaM, f: (box: SwTableBox) => void, whole = false, sel?: SwTableBox[]): boolean {
    const a = this.GetTableBoxAt(pam.Start().GetNode()), b = this.GetTableBoxAt(pam.End().GetNode());
    if (!a) return false;
    return this.tableOp(pam, 'boxattr', (t) => {
      const boxes = t.m_pTable.GetTabSortBoxes();
      if (sel) { for (const box of boxes) if (sel.includes(box)) f(box); return; }
      const i0 = boxes.indexOf(a.box), i1 = b && b.tableNode === t ? boxes.indexOf(b.box) : i0;
      boxes.forEach((box, i) => { if (whole || (i >= Math.min(i0, i1) && i <= Math.max(i0, i1))) f(box); });
    });
  }

  /** Sets attributes of the table at the point. */
  SetTableAttr(pam: SwPaM, f: (t: SwTable) => void): boolean {
    return this.tableOp(pam, 'tableattr', (t) => f(t.m_pTable));
  }

  // --- lists (docnum.cxx) ---

  /**
   * SwDoc::SetNumRule: puts the paragraphs of the selection into a list with `rule`, replacing a rule
   * of the same name. `listId` continues that list; `bCreateNewList` starts a new one; otherwise
   * paragraphs keep their list. With `bResetIndentAttrs` direct indents go, so the list's apply.
   */
  SetNumRule(pam: SwPaM, rule: SwNumRule, bCreateNewList: boolean, listId = '', bResetIndentAttrs = true, bSetCounted = false): void {
    const newId = bCreateNewList && !listId ? this.CreateListId() : listId;
    this.overRange(pam, 'numrule', (n) => {
      // SwDoc::SetCounted(true), in the same undo step (SwEditShell::SetCurNumRule).
      if (bSetCounted) delete n.m_aSet.RES_PARATR_LIST_ISCOUNTED;
      if (n === pam.Start().GetNode()) this.PutNumRule(rule);
      // A paragraph moving to another rule leaves its old list, unless a list is given.
      if (n.GetAttr('RES_PARATR_NUMRULE') !== rule.GetName()) delete n.m_aSet.RES_PARATR_LIST_ID;
      n.m_aSet.RES_PARATR_NUMRULE = rule.GetName();
      if (newId) n.m_aSet.RES_PARATR_LIST_ID = newId;
      if (bResetIndentAttrs) delete n.m_aSet.RES_LR_SPACE;
      n.m_nVersion++;
    });
  }

  /** SwDoc::DelNumRules */
  DelNumRules(pam: SwPaM): void {
    this.overRange(pam, 'delnum', (n) => {
      for (const k of LIST_KEYS) delete n.m_aSet[k];
      // A list set by the paragraph style must be switched off explicitly.
      if (n.GetAttr('RES_PARATR_NUMRULE')) n.m_aSet.RES_PARATR_NUMRULE = '';
      n.m_nVersion++;
    });
  }

  /** SwDoc::NumUpDown: fails without change if any paragraph is already at the outermost level. */
  NumUpDown(pam: SwPaM, bDown: boolean): boolean {
    const paras = this.listParas(pam);
    if (!paras.length) return false;
    const limit = bDown ? MAXLEVEL - 1 : 0;
    if (paras.some((n) => n.GetAttr('RES_PARATR_LIST_LEVEL') === limit)) return false;
    this.overRange(pam, 'numupdown', (n) => {
      if (!n.GetAttr('RES_PARATR_NUMRULE')) return;
      n.m_aSet.RES_PARATR_LIST_LEVEL = n.GetAttr('RES_PARATR_LIST_LEVEL') + (bDown ? 1 : -1);
      n.m_nVersion++;
    });
    return true;
  }

  /** SwDoc::NumOrNoNum: makes the paragraph at the point counted or not. Returns whether it changed. */
  NumOrNoNum(pam: SwPaM, bCounted: boolean): boolean {
    const n = pam.GetPoint().GetNode();
    if (!n.GetAttr('RES_PARATR_NUMRULE') || n.GetAttr('RES_PARATR_LIST_ISCOUNTED') === bCounted) return false;
    const idx = n.GetIndex();
    this.recorded('numornonum', pam, idx, idx, () => { n.m_aSet.RES_PARATR_LIST_ISCOUNTED = bCounted; n.m_nVersion++; });
    return true;
  }

  /** SwDoc::SetNumRuleStart */
  SetNumRuleStart(pam: SwPaM, bFlag: boolean): void {
    this.overRange(pam, 'numstart', (n) => {
      if (!n.GetAttr('RES_PARATR_NUMRULE')) return;
      if (bFlag) n.m_aSet.RES_PARATR_LIST_ISRESTART = true; else delete n.m_aSet.RES_PARATR_LIST_ISRESTART;
      n.m_nVersion++;
    });
  }

  private listParas(pam: SwPaM): SwTextNode[] {
    const out: SwTextNode[] = [];
    for (let i = pam.Start().GetNodeIndex(); i <= pam.End().GetNodeIndex(); i++) {
      const n = this.m_aNodes.node(i);
      if (n.IsTextNode() && n.GetAttr('RES_PARATR_NUMRULE')) out.push(n);
    }
    return out;
  }

  /**
   * SwDoc::SearchNumRule, backwards: the rule of the nearest preceding list paragraph, only if it
   * is of the wanted kind. Up to `nNonEmptyAllowed` non-empty paragraphs without a list may lie
   * between (-1: any number); the search stays in the node's area (body, header, footnote).
   */
  SearchNumRule(node: SwTextNode, bNum: boolean, nNonEmptyAllowed = 0): { rule: SwNumRule; listId: string } | null {
    const area = this.m_aNodes.AreaOf(node);
    for (let n = this.m_aNodes.GoPrevious(node.GetIndex()); n; n = this.m_aNodes.GoPrevious(n.GetIndex())) {
      if (this.m_aNodes.AreaOf(n) !== area || (nNonEmptyAllowed === 0 && n.StartOfSectionNode() !== node.StartOfSectionNode())) return null;
      const rule = this.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
      if (rule) {
        const f = rule.Get(0);
        return (bNum && f.IsEnumeration()) || (!bNum && f.IsItemize())
          ? { rule, listId: n.GetAttr('RES_PARATR_LIST_ID') || `rule:${rule.GetName()}` }
          : null;
      }
      if (n.Len() > 0) {
        if (nNonEmptyAllowed === 0) return null;
        nNonEmptyAllowed--;
        if (nNonEmptyAllowed < 0) nNonEmptyAllowed = -1;
      }
    }
    return null;
  }

  /** lcl_IsValidPrevNextNumNode: structure nodes a list may continue over (table boxes, sections). */
  private IsValidPrevNextNumNode(i: number): boolean {
    const n = this.m_aNodes.node(i);
    if (n.IsEndNode()) { const st = n.StartOfSectionNode()!; return st.m_eStartNodeType === SwStartNodeType.SwTableBoxStartNode || st.IsSectionNode(); }
    if (n.IsSectionNode()) return true;
    if (n.IsStartNode()) return (n as SwStartNode).m_eStartNodeType === SwStartNodeType.SwTableBoxStartNode;
    return false;
  }

  /**
   * lcl_GotoNextPrevNum: the next (or previous) paragraph of the list on the level of the one at
   * `idx`, not beyond a higher level unless bOverUpper is false (then up to the list's end).
   * Returns its node index and the highest and lowest levels passed (nUpper, nLower).
   */
  GotoNextPrevNum(idx: number, bNext: boolean, bOverUpper = true): { idx: number; nUpper: number; nLower: number } | null {
    const nodes = this.m_aNodes;
    const start = nodes.node(idx);
    if (!start.IsTextNode() || !start.GetAttr('RES_PARATR_NUMRULE')) return null;
    let pNd: SwTextNode = start;
    const nSrchNum = GetActualListLevel(pNd);
    let aIdx = idx;
    if (!pNd.GetAttr('RES_PARATR_LIST_ISCOUNTED')) {
      let bError = false;
      do {
        aIdx--;
        const n = nodes.node(aIdx);
        if (n.IsTextNode()) {
          pNd = n;
          if (n.GetAttr('RES_PARATR_NUMRULE')) {
            if (n.GetAttr('RES_PARATR_LIST_ISCOUNTED') || GetActualListLevel(n) < nSrchNum) break; // found it!
          } else bError = true;
        } else bError = !this.IsValidPrevNextNumNode(aIdx);
      } while (!bError);
      if (bError) return null;
    }
    let nLower = nSrchNum, nUpper = nSrchNum;
    let found = -1;
    let pLast: SwTextNode | null;
    if (bNext) { aIdx++; pLast = pNd; } else { aIdx--; pLast = null; }
    while (bNext ? aIdx < nodes.Count() - 1 : aIdx !== 0) {
      const n = nodes.node(aIdx);
      if (n.IsTextNode()) {
        if (!n.GetAttr('RES_PARATR_NUMRULE')) break;
        // lcl_IsNumOk
        const nNumber = GetActualListLevel(n);
        if (bOverUpper ? nSrchNum === nNumber : nSrchNum >= nNumber) { found = aIdx; break; }
        if (nNumber > nLower) nLower = nNumber;
        else if (nNumber < nUpper) nUpper = nNumber;
        pLast = n;
      } else if (!this.IsValidPrevNextNumNode(aIdx)) break;
      aIdx += bNext ? 1 : -1;
    }
    // do not iterate over higher numbers, but still to the end
    if (found < 0 && !bOverUpper && pLast) found = bNext ? aIdx : pLast.GetIndex();
    return found < 0 ? null : { idx: found, nUpper, nLower };
  }

  /**
   * SwDoc::NoNum (Insert Unnumbered Entry): splits the paragraph at the point; the new paragraph
   * stays in the list without a number.
   */
  NoNum(pam: SwPaM): boolean {
    const before = this.m_aUndo.length;
    this.SplitNode(pam);
    const pNd = pam.GetPoint().GetNode();
    if (!pNd.GetAttr('RES_PARATR_NUMRULE')) return false;
    this.NumOrNoNum(pam, false);
    while (this.m_aUndo.length > before + 1) this.MergeLastUndo();
    return true;
  }

  /**
   * SwDoc::MoveParagraph (MoveParagraphImpl without outline moves), reduced: swaps the selected
   * paragraphs with the `nOffset` nodes after (positive) or before them, if both lie in the same
   * section. Moves are not recorded as tracked changes.
   */
  MoveParagraph(pam: SwPaM, nOffset: number): boolean {
    return this.MoveParagraphImpl(pam, nOffset, pam.Start().GetNodeIndex(), pam.End().GetNodeIndex());
  }

  /**
   * SwDoc::MoveParagraphImpl: the nodes from nStIdx to nEndIdx (which need not be text nodes, as
   * for a chapter ending in a table: MoveOutlinePara's range) swapped as MoveParagraph does.
   */
  MoveParagraphImpl(pam: SwPaM, nOffset: number, nSttIdx: number, nEndIdx0: number): boolean {
    const nodes = this.m_aNodes;
    let nStIdx = nSttIdx, nEndIdx = nEndIdx0;
    let nInEndIdx: number;
    if (nOffset > 0) { nInEndIdx = nEndIdx; nEndIdx += nOffset; } else {
      // Impossible to move to negative index
      if (Math.abs(nOffset) > nStIdx) return false;
      nInEndIdx = nStIdx - 1;
      nStIdx += nOffset;
    }
    const nInStIdx = nInEndIdx + 1;
    // The following paragraphs shall be swapped: [nStIdx, nInEndIdx] with [nInStIdx, nEndIdx]
    if (nEndIdx >= nodes.GetEndOfContent().GetIndex()) return false;
    // Both "start" nodes and both "end" nodes must belong to the same section.
    if (nodes.node(nStIdx).StartOfSectionNode() !== nodes.node(nInStIdx).StartOfSectionNode()) return false;
    const sectionEnd = (i: number) => {
      let p: SwNode = nodes.node(i);
      if (!p.IsStartNode()) { const bIsEndNode = p.IsEndNode(); p = p.StartOfSectionNode()!; if (bIsEndNode) p = p.StartOfSectionNode()!; }
      return (p as SwStartNode).EndOfSectionNode();
    };
    if (sectionEnd(nEndIdx) !== sectionEnd(nInEndIdx)) return false;
    this.recorded('move-para', pam, nStIdx, nEndIdx, () => {
      for (let k = 0; k <= nEndIdx - nInStIdx; k++) nodes.Move(nInStIdx + k, nStIdx + k);
    });
    return true;
  }

  private overRange(pam: SwPaM, kind: string, f: (n: SwTextNode, start: number, end: number) => void): void {
    const start = pam.Start(), end = pam.End();
    const nFirst = start.GetNodeIndex(), nLast = end.GetNodeIndex();
    this.recorded(kind, pam, nFirst, nLast, () => {
      for (let i = nFirst; i <= nLast; i++) {
        const n = this.m_aNodes.node(i);
        if (!n.IsTextNode()) continue;
        f(n, i === nFirst ? start.GetContentIndex() : 0, i === nLast ? end.GetContentIndex() : n.Len());
      }
    });
  }
}

export { SwPosition };
