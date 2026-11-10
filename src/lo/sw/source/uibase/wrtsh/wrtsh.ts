// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/wrtsh/wrtsh1.cxx reduced
// @upstream sw/source/uibase/wrtsh/move.cxx reduced
// @upstream sw/source/uibase/wrtsh/delete.cxx reduced
// @upstream sw/source/core/crsr/crsrsh.cxx reduced
// @upstream sw/source/core/crsr/swcrsr.cxx reduced
// @upstream sw/source/core/edit/edattr.cxx reduced
// @upstream sw/source/core/frmedt/fetab.cxx reduced
// @upstream sw/source/core/edit/edtab.cxx reduced
// @upstream sw/source/core/frmedt/fefly1.cxx reduced
// @upstream sw/source/core/frmedt/feshview.cxx reduced
import { BoxLanguage, BoxText, GetAutoSum, GetBoxName } from '../../core/fields/cellfml.ts';
import { IsNumberFormat } from '../../../../svl/source/numbers/zforlist.ts';
import type { SwTableAutoFormat } from '../../core/doc/tblafmt.ts';
import { SortTable, type SwSortOptions } from '../../core/doc/docsort.ts';
import { NormalizeGrfAttr, type SwGrfAttr } from '../../../inc/hintids.ts';
import { DetectGraphic } from '../../../../vcl/source/filter/GraphicFormatDetector.ts';
import type { TransliterationFlags } from '../../../../i18npool/source/transliteration/transliteration_body.ts';
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwDoc, SwPosition, type SplitTable_HeadlineOption, type TableMergeErr } from '../../../inc/doc.ts';
import { SwPaM } from '../../../inc/pam.ts';
import { SwRootFrame, type SwCellFrame, type SwTabFrame } from '../../core/layout/pagechg.ts';
import { FormatParagraph, LineRangeX, LineXAt } from '../../core/text/itrform2.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { MAXLEVEL, SwNumRule, numfunc } from '../../../inc/numrule.ts';
import { GetActualListLevel } from '../../core/doc/list.ts';
import { CH_TXTATR_BREAKWORD, type SwAttrs, type SwAttrSet, type SwCharAttrSet, type SwField, type SwFlyCnt, type SwPostItField } from '../../../inc/hintids.ts';
import { SwStartNodeType } from '../../../inc/ndtyp.ts';
import { AsCharFormat, GraphicFlyFormat, ShapeFlyFormat, TextFlyFormat, HoriOrientation, RelOrientation, RndStdIds, RotatedBoundSize, VertOrientation, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { SwRect } from '../../../inc/swrect.ts';
import { SpellParagraph, type SwWrongArea } from '../../core/txtnode/txtedt.ts';
import type { SpellChecker } from '../../../../lingucomponent/source/spellcheck/spell/sspellimp.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import { RedlineEnd, RedlineStart, type SwRangeRedline } from '../../core/doc/DocumentRedlineManager.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { SearchType, lcl_Box2LeftBorder, type SvxBorderLine, type SwTableBox, type SwTableLine } from '../../../inc/swtable.ts';

/** SwTabCols, reduced: column borders in twips from the table's left edge. */
export interface SwTabCols { left: number; right: number; cols: number[]; rightMax: number }
/** MINLAY: the smallest width of a cell's content. */
const MINLAY = 23;
import type { SwStartNode, SwTableNode } from '../../../inc/node.ts';
import type { SwSpotlight } from '../../core/text/inftxt.ts';
import type { TextMeasurer } from '../../../../vcl/source/outdev/text.ts';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

export function nextGrapheme(text: string, pos: number): number {
  return graphemes.segment(text).containing(pos)?.index !== undefined
    ? pos + graphemes.segment(text).containing(pos)!.segment.length
    : pos + 1;
}

export function prevGrapheme(text: string, pos: number): number {
  return pos > 0 ? graphemes.segment(text).containing(pos - 1)!.index : 0;
}

export class SwWrtShell {
  m_pDoc: SwDoc;
  m_pRoot: SwRootFrame;
  m_pCursor: SwPaM;
  private m: TextMeasurer;
  /** Column kept across vertical moves, as SwCursor's "up/down" x position. */
  private m_nUpDownX: number | null = null;
  /** Attributes toggled with no selection, applied to the next typed text. */
  m_aPending: SwCharAttrSet = {};
  /** The selected fly, by name (SwFEShell::IsFrameSelected); the text cursor stays where it was. */
  m_sSelFly: string | null = null;

  constructor(doc: SwDoc, measurer: TextMeasurer) {
    this.m_pDoc = doc;
    this.m = measurer;
    this.m_pRoot = new SwRootFrame(doc, measurer);
    this.m_pCursor = new SwPaM(new SwPosition(doc.GetNodes().FirstTextNode(), 0));
    this.m_pRoot.Layout();
    doc.Subscribe(() => this.m_pRoot.Layout());
  }

  private get pt(): SwPosition { return this.m_pCursor.GetPoint(); }
  HasSelection(): boolean { return this.m_pCursor.HasMark(); }

  // --- movement ---
  private place(node: SwTextNode, content: number, extend: boolean, keepColumn = false): void {
    this.pt.Assign(node, content);
    if (!extend) this.m_pCursor.DeleteMark();
    if (!keepColumn) this.m_nUpDownX = null;
    this.m_aPending = {};
  }

  /** The paragraph at the cursor runs right to left: the arrow keys move visually (SwCursor::LeftRight). */
  private isRTL(): boolean { return this.pt.GetNode().GetAttr('RES_FRAMEDIR') === 'rl-tb'; }

  /** The Left and Right keys: visually left and right, so backwards and forwards in right-to-left text. */
  VisualLeft(extend = false): void { if (this.isRTL()) this.Right(extend); else this.Left(extend); }
  VisualRight(extend = false): void { if (this.isRTL()) this.Left(extend); else this.Right(extend); }

  /**
   * SID_ATTR_PARA_LEFT_TO_RIGHT and SID_ATTR_PARA_RIGHT_TO_LEFT: the direction, and a left or right
   * alignment turned with it (alignment is physical).
   */
  SetParaDirection(rtl: boolean): void {
    const adjust = this.pt.GetNode().GetAttr('RES_PARATR_ADJUST');
    const swap = (adjust === 'left' && rtl) || (adjust === 'right' && !rtl);
    this.SetParaAttr({ RES_FRAMEDIR: rtl ? 'rl-tb' : 'lr-tb', ...(swap ? { RES_PARATR_ADJUST: rtl ? 'right' : 'left' } : {}) });
  }

  Left(extend = false): void {
    const c = this.m_pCursor;
    if (!extend && c.HasMark()) { const s = c.Start(); this.place(s.GetNode(), s.GetContentIndex(), false); return; }
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    if (i > 0) this.place(n, prevGrapheme(n.GetText(), i), extend);
    else { const p = this.m_pDoc.GetNodes().GoPrevious(n.GetIndex()); if (p && this.sameArea(p, n)) this.place(p, p.Len(), extend); }
  }

  Right(extend = false): void {
    const c = this.m_pCursor;
    if (!extend && c.HasMark()) { const e = c.End(); this.place(e.GetNode(), e.GetContentIndex(), false); return; }
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    if (i < n.Len()) this.place(n, nextGrapheme(n.GetText(), i), extend);
    else { const p = this.m_pDoc.GetNodes().GoNext(n.GetIndex()); if (p && this.sameArea(p, n)) this.place(p, 0, extend); }
  }

  /** Whether two nodes are in the same header, footer or the body. */
  private sameArea(a: SwTextNode, b: SwTextNode): boolean {
    const nodes = this.m_pDoc.GetNodes();
    return nodes.AreaOf(a) === nodes.AreaOf(b);
  }

  private wordStops(text: string): number[] {
    const stops: number[] = [];
    for (const s of words.segment(text)) if (s.isWordLike) stops.push(s.index);
    return stops;
  }

  PrevWord(extend = false): void {
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    if (i === 0) { this.Left(extend); return; }
    const stop = this.wordStops(n.GetText()).filter((s) => s < i).pop() ?? 0;
    this.place(n, stop, extend);
  }

  NextWord(extend = false): void {
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    if (i >= n.Len()) { this.Right(extend); return; }
    this.place(n, this.wordStops(n.GetText()).find((s) => s > i) ?? n.Len(), extend);
  }

  private verticalMove(dir: -1 | 1, extend: boolean, distance?: number): void {
    const r = this.GetCharRect();
    if (!r) return;
    this.m_nUpDownX ??= r.Left();
    let target: Point | null;
    if (distance !== undefined) target = new Point(this.m_nUpDownX, r.Top() + dir * distance);
    else {
      const cur = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex());
      const lineTop = cur ? cur.top : r.Top(), lineBottom = cur ? cur.top + cur.line.nRealHeight : r.Top() + r.Height();
      target = this.m_pRoot.NextLinePoint(this.m_nUpDownX, lineTop, lineBottom, dir, cur?.frame.pArea ?? 'body', cur?.page, this.m_pDoc.GetNodes().AreaOf(this.pt.GetNode()));
      // At the first or last line the cursor stays.
      if (!target) return;
    }
    const hit = this.m_pRoot.GetModelPositionForViewPoint(target);
    this.place(hit.node, hit.content, extend, true);
  }

  Up(extend = false): void { this.verticalMove(-1, extend); }
  Down(extend = false): void { this.verticalMove(1, extend); }
  PageUp(extend: boolean, viewHeight: number): void { this.verticalMove(-1, extend, viewHeight); }
  PageDown(extend: boolean, viewHeight: number): void { this.verticalMove(1, extend, viewHeight); }

  LeftMargin(extend = false): void {
    const n = this.pt.GetNode();
    const hit = this.m_pRoot.FindLine(n, this.pt.GetContentIndex());
    if (hit) this.place(n, hit.line.nStart, extend);
  }

  RightMargin(extend = false): void {
    const n = this.pt.GetNode();
    const hit = this.m_pRoot.FindLine(n, this.pt.GetContentIndex());
    if (!hit) return;
    let end = hit.line.nStart + hit.line.nLen;
    const text = n.GetText();
    // A wrapped line's end belongs to the next line's start, so stop before its hanging space or break.
    if (end > hit.line.nStart && (end < text.length || text[end - 1] === '\n')) end = prevGrapheme(text, end);
    this.place(n, end, extend);
  }

  /** First and last paragraph of the area the cursor is in: the body, a header or a footer. */
  private areaBounds(): { first: SwTextNode; last: SwTextNode } {
    const nodes = this.m_pDoc.GetNodes();
    const area = nodes.AreaOf(this.pt.GetNode());
    return { first: nodes.GoNext(area.GetIndex())!, last: nodes.GoPrevious(area.EndOfSectionNode().GetIndex())! };
  }

  SttDoc(extend = false): void { this.place(this.areaBounds().first, 0, extend); }
  EndDoc(extend = false): void { const n = this.areaBounds().last; this.place(n, n.Len(), extend); }

  SetCursor(pt: Point, extend = false): void {
    const hit = this.m_pRoot.GetModelPositionForViewPoint(pt);
    this.place(hit.node, hit.content, extend);
  }

  SelAll(): void {
    const { first, last } = this.areaBounds();
    this.m_pCursor.GetMark().Assign(first, 0);
    this.pt.Assign(last, last.Len());
  }

  SelectRange(node: SwTextNode, start: number, end: number): void {
    this.m_pCursor.GetMark().Assign(node, start);
    this.pt.Assign(node, end);
    this.m_nUpDownX = null;
    this.m_aPending = {};
  }

  SelWrd(): void {
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex(), text = n.GetText();
    if (!text) return;
    const seg = words.segment(text).containing(Math.min(i, text.length - 1));
    if (seg) this.SelectRange(n, seg.index, seg.index + seg.segment.length);
  }

  SelPara(): void { const n = this.pt.GetNode(); this.SelectRange(n, 0, n.Len()); }

  GetCharRect() { return this.m_pRoot.GetCharRect(this.pt.GetNode(), this.pt.GetContentIndex()); }

  // --- editing ---
  /** Called when an edit is refused because it would change protected content (SwWrtShell's InfoReadOnlyDialog). */
  m_fnReadonly: () => void = () => {};
  /** Refuses an edit of protected content. */
  private readonlyRefused(): boolean {
    if (!this.HasReadonlySel()) return false;
    this.m_fnReadonly();
    return true;
  }

  // --- table box content (SwCursorShell::SaveTableBoxContent, CheckTableBoxContent) ---

  /** Tools > Options > Writer > Table: Number recognition (IsInsTableFormatNum). */
  m_bInsTableFormatNum = false;
  /** The box being edited and its text before (m_pBoxIdx, m_pBoxPtr). */
  private m_pBoxPtr: SwTableBox | null = null;
  private m_sBoxText: string | null = null;

  /** SwCursorShell::SaveTableBoxContent: remembers the box an edit happens in. */
  SaveTableBoxContent(): void {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    if (!at || at.box === this.m_pBoxPtr) return;
    this.CheckTableBoxContent();
    this.m_pBoxPtr = at.box;
    this.m_sBoxText = BoxText(this.m_pDoc, at.box);
  }

  /**
   * SwCursorShell::CheckTableBoxContent: when the cursor has left the edited box (or selects),
   * its content is checked for a number (SwDoc::ChkBoxNumFormat) and the formulas are updated.
   */
  CheckTableBoxContent(): boolean {
    const pChkBox = this.m_pBoxPtr;
    if (!pChkBox) return false;
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    if (at?.box === pChkBox && !this.HasSelection()) return false;
    this.m_pBoxPtr = null;
    const sn = pChkBox.m_pStartNode;
    // The box went (undo rebuilt the table): nothing to check.
    if (!sn || sn.IsDisconnected() || !sn.m_pStartOfSection?.IsTableNode() || sn.m_pStartOfSection.IsDisconnected() || !(sn.m_pStartOfSection as SwTableNode).m_pTable.GetTabSortBoxes().includes(pChkBox)) return false;
    this.m_pDoc.ChkBoxNumFormat(this.m_pCursor, pChkBox, this.m_bInsTableFormatNum, this.m_sBoxText);
    return true;
  }

  /** SwEditShell::SetTableBoxFormulaAttrs for the selected boxes. */
  SetTableBoxFormulaAttrs(change: { numFormat?: string | null; value?: number | null; formula?: string | null }): boolean {
    this.CheckTableBoxContent();
    return this.m_pDoc.SetTableBoxFormulaAttrs(this.m_pCursor, this.GetTableSelBoxes(), change);
  }

  /** The cursor box's number format, or null outside a table. */
  GetBoxNumFormat(): string | null {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    return at ? at.box.m_aAttrs.numFormat ?? 'General' : null;
  }

  /** The cursor box's value: its value, else its text read as a number (for the number format dialog's preview). */
  GetBoxValue(): number | null {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    if (!at) return null;
    if (at.box.m_aAttrs.value !== undefined) return at.box.m_aAttrs.value;
    const tx = BoxText(this.m_pDoc, at.box);
    return tx ? IsNumberFormat(tx, BoxLanguage(this.m_pDoc, at.box))?.value ?? null : null;
  }

  /** The cursor box's formula as the input window shows it ("=…"), or null. */
  GetTableBoxFormula(): string | null {
    const f = this.m_pDoc.GetTableBoxAt(this.pt.GetNode())?.box.m_aAttrs.formula;
    return f === undefined ? null : `=${f}`;
  }

  /** SwTableBox::GetName of the cursor box (the input window's position field), with the table's name. */
  GetBoxName(): string | null {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    return at ? GetBoxName(at.tableNode.m_pTable, at.box) : null;
  }

  /** SwFEShell::GetAutoSum */
  GetAutoSum(): string {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    return at ? GetAutoSum(this.m_pDoc, at.tableNode.m_pTable, at.box) : 'sum';
  }

  Insert(text: string): void {
    if (this.readonlyRefused()) return;
    this.SaveTableBoxContent();
    this.m_nUpDownX = null;
    const pending = this.m_aPending;
    this.m_pDoc.InsertString(this.m_pCursor, text, Object.keys(pending).length ? pending : undefined);
  }

  /** Inserts text containing newlines as separate paragraphs. */
  Paste(text: string): void {
    const parts = text.replace(/\r\n?/g, '\n').split('\n');
    parts.forEach((p, i) => {
      if (i) this.SplitNode();
      if (p) this.Insert(p);
    });
  }

  SplitNode(): void { if (this.readonlyRefused()) return; this.m_nUpDownX = null; this.m_aPending = {}; this.m_pDoc.SplitNode(this.m_pCursor); }
  InsertLineBreak(): void { this.Insert('\n'); }

  DelLeft(): void {
    if (this.readonlyRefused()) return;
    this.SaveTableBoxContent();
    if (this.HasSelection()) { this.DelSelection(); return; }
    // With changes recorded, deleted text before the cursor is stepped over, not deleted again.
    if (this.IsRedlineOn()) while (this.deletedBefore()) this.Left(false);
    this.Left(true);
    if (this.crossesSection()) { this.m_pCursor.GetPoint().Assign(this.m_pCursor.GetMark().GetNode(), this.m_pCursor.GetMark().GetContentIndex()); return; }
    this.DelSelection();
  }

  DelRight(): void {
    if (this.readonlyRefused()) return;
    this.SaveTableBoxContent();
    if (this.HasSelection()) { this.DelSelection(); return; }
    if (this.IsRedlineOn()) this.m_pDoc.SkipDeleted(this.m_pCursor);
    this.Right(true);
    if (this.crossesSection()) { this.m_pCursor.GetPoint().Assign(this.m_pCursor.GetMark().GetNode(), this.m_pCursor.GetMark().GetContentIndex()); return; }
    this.DelSelection();
    // The cursor goes past what it marked, so that Delete continues forward.
    if (this.IsRedlineOn()) this.m_pDoc.SkipDeleted(this.m_pCursor);
  }

  /** View > Spotlight (SwView::m_bIsSpotlightCharDF, m_bIsSpotlightParaStyles, m_bIsSpotlightCharStyles). */
  m_aSpotlight: SwSpotlight = { charDF: false, paraStyles: false, charStyles: false };

  // --- spelling (SwEditShell::SpellContinue, SwView::ExecSpell, the AutoSpell context menu) ---

  /** The spell checker (LinguMgr::GetSpellChecker), set by the web shell once it has dictionaries. */
  m_pSpell: SpellChecker | null = null;
  /** Tools > Automatic Spell Checking (SwViewOption::IsOnlineSpell). */
  m_bOnlineSpell = true;
  private m_aWrong = new WeakMap<SwTextNode, { version: number; spell: number; list: SwWrongArea[] }>();

  /** SwTextNode::GetWrong: the paragraph's misspelled words, checked again after any change. */
  GetWrongList(node: SwTextNode): SwWrongArea[] {
    const sp = this.m_pSpell;
    if (!sp) return [];
    const hit = this.m_aWrong.get(node);
    const version = node.m_nVersion * 1000 + (this.m_pDoc.m_nFormatVersion % 1000);
    if (hit && hit.version === version && hit.spell === sp.m_nVersion) return hit.list;
    const list = SpellParagraph(node, sp);
    this.m_aWrong.set(node, { version, spell: sp.m_nVersion, list });
    return list;
  }

  /** The misspelled word at a model position, if any. */
  GetWrongAt(node: SwTextNode, content: number): SwWrongArea | null {
    return this.GetWrongList(node).find((w) => content >= w.nStart && content <= w.nEnd) ?? null;
  }

  /** SwEditShell::SpellContinue: the next misspelled word after the cursor, wrapping once; it is selected. */
  SpellContinue(): SwWrongArea | null {
    const nodes = this.m_pDoc.GetNodes();
    const all: SwTextNode[] = [];
    for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) all.push(n);
    const cur = this.m_pCursor.End();
    const start = Math.max(0, all.indexOf(cur.GetNode()));
    for (let k = 0; k <= all.length; k++) {
      const n = all[(start + k) % all.length]!;
      const from = k === 0 ? cur.GetContentIndex() : k === all.length ? -1 : 0;
      const w = this.GetWrongList(n).find((x) => (k === all.length ? x.nStart < cur.GetContentIndex() : x.nStart >= from));
      if (w) { this.SelectRange(n, w.nStart, w.nEnd); return w; }
    }
    return null;
  }

  /** SwEditShell::TransliterateText (Format > Text > Change Case). */
  TransliterateText(mode: TransliterationFlags): void { this.m_pDoc.TransliterateText(this.m_pCursor, mode); }

  /** Replaces a word, as accepting a suggestion does (one undo step). */
  ReplaceWord(node: SwTextNode, start: number, end: number, text: string): void {
    const before = this.m_pDoc.m_aUndo.length;
    this.SelectRange(node, start, end);
    this.Insert(text);
    while (this.m_pDoc.m_aUndo.length > before + 1) this.m_pDoc.MergeLastUndo();
  }

  /**
   * SwView's language menus (Tools > Language: for selection, paragraph, all text): sets the
   * character language. All text also becomes the default language of the document.
   */
  SetLanguage(lang: string, scope: 'selection' | 'paragraph' | 'all'): void {
    const doc = this.m_pDoc;
    if (scope === 'selection' && this.HasSelection()) { this.SetCharAttr({ RES_CHRATR_LANGUAGE: lang }); return; }
    const nodes = doc.GetNodes();
    const saved = { n: this.pt.GetNode(), c: this.pt.GetContentIndex(), mn: this.m_pCursor.GetMark().GetNode(), mc: this.m_pCursor.GetMark().GetContentIndex() };
    if (scope === 'paragraph') {
      const n = this.pt.GetNode();
      this.SelectRange(n, 0, n.Len());
      if (n.Len()) doc.InsertAttr(this.m_pCursor, { RES_CHRATR_LANGUAGE: lang });
      doc.SetParaAttr(this.m_pCursor, { RES_CHRATR_LANGUAGE: lang });
    } else {
      // The default paragraph style carries the document's language; hard languages go.
      const std = doc.FindTextFormatCollByName('Standard')!;
      doc.ChgFormatColl(this.m_pCursor, std, { set: { ...std.m_aSet, RES_CHRATR_LANGUAGE: lang } });
      for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) {
        if (n.m_aHints.some((h) => h.aAttrs.RES_CHRATR_LANGUAGE !== undefined)) { this.SelectRange(n, 0, n.Len()); doc.ResetAttrs(this.m_pCursor, ['RES_CHRATR_LANGUAGE']); doc.MergeLastUndo(); }
      }
    }
    this.m_pCursor.GetMark().Assign(saved.mn, Math.min(saved.mc, saved.mn.Len()));
    this.pt.Assign(saved.n, Math.min(saved.c, saved.n.Len()));
  }

  // --- tracked changes (SwEditShell, edredln.cxx; SwView::ExecuteRedline) ---

  IsRedlineOn(): boolean { return this.m_pDoc.m_pDocumentRedlineManager.IsRedlineOn(); }
  SetRedlineOn(b: boolean): void { this.m_pDoc.m_pDocumentRedlineManager.m_bRecord = b; this.m_pDoc.Changed(); }
  IsShowChanges(): boolean { return this.m_pDoc.m_pDocumentRedlineManager.m_bShow; }
  SetShowChanges(b: boolean): void { this.m_pDoc.m_pDocumentRedlineManager.m_bShow = b; this.m_pDoc.m_nFormatVersion++; this.m_pDoc.Changed(); }

  private deletedBefore(): boolean {
    const n = this.pt.GetNode(), c = this.pt.GetContentIndex();
    if (c > 0) return n.GetCharAttrAt('RES_TXTATR_REDLINE', c - 1)?.type === 'Delete';
    const p = this.m_pDoc.GetNodes().GoPrevious(n.GetIndex());
    return !!p && this.sameArea(p, n) && p.m_aSet.RES_PARATR_REDLINE?.type === 'Delete';
  }

  /** SwEditShell::GetRedlineCount and GetRedline. */
  GetRedlineTable() { return this.m_pDoc.m_pDocumentRedlineManager.GetRedlineTable(); }

  /** SwEditShell::AcceptRedline / RejectRedline: the changes in the selection, or the one at the cursor. */
  AcceptRejectAtCursor(bAccept: boolean): boolean {
    const m = this.m_pDoc.m_pDocumentRedlineManager;
    return m.AcceptRejectRedlines(this.m_pCursor, m.GetRedlinesAt(this.m_pCursor), bAccept);
  }

  AcceptRejectAll(bAccept: boolean): boolean {
    const m = this.m_pDoc.m_pDocumentRedlineManager;
    return m.AcceptRejectRedlines(this.m_pCursor, m.GetRedlineTable(), bAccept);
  }

  AcceptReject(r: SwRangeRedline, bAccept: boolean): boolean {
    return this.m_pDoc.m_pDocumentRedlineManager.AcceptRejectRedlines(this.m_pCursor, [r], bAccept);
  }

  /** SwCursorShell::SelectRedline: the change becomes the selection. */
  SelectRedline(r: SwRangeRedline): void {
    const m = this.m_pDoc.m_pDocumentRedlineManager;
    const s = RedlineStart(r), e = RedlineEnd(r, (n) => m.NextInSection(n));
    this.m_pCursor.GetMark().Assign(s.node, s.content);
    this.pt.Assign(e.node, e.content);
    this.m_nUpDownX = null;
  }

  /** SwCursorShell::GotoNextRedline / GotoPrevRedline: selects the next or previous change, wrapping around. */
  GotoRedline(bNext: boolean): boolean {
    const table = this.GetRedlineTable();
    if (!table.length) return false;
    const cur = this.m_pCursor[bNext ? 'End' : 'Start']();
    const key = (node: SwTextNode, c: number) => node.GetIndex() * 1e6 + c;
    const here = key(cur.GetNode(), cur.GetContentIndex());
    const starts = table.map((r) => { const st = RedlineStart(r); return key(st.node, st.content); });
    let i = bNext ? starts.findIndex((k) => k >= here && !(this.HasSelection() && k === key(this.m_pCursor.Start().GetNode(), this.m_pCursor.Start().GetContentIndex()))) : starts.findLastIndex((k) => k < here);
    if (i < 0) i = bNext ? 0 : table.length - 1;
    this.SelectRedline(table[i]!);
    return true;
  }

  /** Character deletion never joins paragraphs across a cell or table boundary. */
  private crossesSection(): boolean {
    return this.pt.GetNode().StartOfSectionNode() !== this.m_pCursor.GetMark().GetNode().StartOfSectionNode();
  }

  // --- hyperlinks (wrtsh2.cxx, edattr.cxx) ---

  /** The hyperlink at a position, with its extent (adjacent runs with the same URL form one link). */
  GetINetAttr(node = this.pt.GetNode(), pos = this.pt.GetContentIndex()): { url: string; start: number; end: number } | null {
    const hints = node.m_aHints;
    // At a link's end the caret still counts as on it, as upstream's SwCursorShell::GetINetAttr.
    let i = hints.findIndex((h) => h.nStart <= pos && pos < h.nEnd && h.aAttrs.RES_TXTATR_INETFMT);
    if (i < 0) i = hints.findIndex((h) => h.nEnd === pos && pos > 0 && h.aAttrs.RES_TXTATR_INETFMT);
    if (i < 0) return null;
    const url = hints[i]!.aAttrs.RES_TXTATR_INETFMT!;
    let a = i, b = i;
    while (a > 0 && hints[a - 1]!.nEnd === hints[a]!.nStart && hints[a - 1]!.aAttrs.RES_TXTATR_INETFMT === url) a--;
    while (b + 1 < hints.length && hints[b + 1]!.nStart === hints[b]!.nEnd && hints[b + 1]!.aAttrs.RES_TXTATR_INETFMT === url) b++;
    return { url, start: hints[a]!.nStart, end: hints[b]!.nEnd };
  }

  /**
   * SwWrtShell::InsertURL: links the selection, or replaces the link at the cursor, or inserts
   * `text` as a new link. The text replaces the selection when it differs.
   */
  InsertURL(url: string, text: string): void {
    this.m_nUpDownX = null;
    this.m_aPending = {};
    const cur = this.HasSelection() ? null : this.GetINetAttr();
    if (cur) this.SelectRange(this.pt.GetNode(), cur.start, cur.end);
    if (this.HasSelection() && (!text || text === this.GetSelText())) {
      this.m_pDoc.InsertAttr(this.m_pCursor, { RES_TXTATR_INETFMT: url });
      return;
    }
    const label = text || url;
    this.m_pDoc.InsertString(this.m_pCursor, label, { RES_TXTATR_INETFMT: url });
  }

  /** Removes the hyperlink at the cursor or in the selection, keeping its text. */
  DeleteINetAttr(): void {
    const cur = this.HasSelection() ? null : this.GetINetAttr();
    if (cur) {
      const n = this.pt.GetNode(), keep = this.pt.GetContentIndex();
      this.SelectRange(n, cur.start, cur.end);
      this.m_pDoc.ResetAttrs(this.m_pCursor, ['RES_TXTATR_INETFMT']);
      this.SelectRange(n, keep, keep);
    } else if (this.HasSelection()) this.m_pDoc.ResetAttrs(this.m_pCursor, ['RES_TXTATR_INETFMT']);
  }

  // --- clone formatting (sw/source/uibase/uiview/formatclipboard.cxx) ---

  /** SwFormatClipboard::Copy: the direct character formatting at the cursor and the paragraph's style and attributes. */
  CopyFormat(): { chars: SwCharAttrSet; para: SwAttrSet; coll: string } {
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    const at = !this.HasSelection() && i > 0 ? i - 1 : this.m_pCursor.Start().GetContentIndex();
    const hint = n.m_aHints.find((h) => h.nStart <= at && at < h.nEnd);
    const chars: SwCharAttrSet = {};
    for (const [k, v] of Object.entries(hint?.aAttrs ?? {})) if (k.startsWith('RES_CHRATR_')) (chars as Record<string, unknown>)[k] = v;
    return { chars, para: structuredClone(n.m_aSet), coll: n.GetTextColl().GetName() };
  }

  /**
   * SwFormatClipboard::Paste: the selection's direct character formatting is replaced, and unless
   * `bNoParagraphFormats`, its paragraphs take the style and paragraph attributes too.
   */
  PasteFormat(f: { chars: SwCharAttrSet; para: SwAttrSet; coll: string }, bNoParagraphFormats = false): void {
    if (!this.HasSelection()) this.SelWrd();
    if (this.HasSelection()) {
      this.m_pDoc.ResetAttrs(this.m_pCursor);
      if (Object.keys(f.chars).length) this.m_pDoc.InsertAttr(this.m_pCursor, f.chars);
    }
    if (!bNoParagraphFormats) {
      this.SetTextFormatColl(f.coll);
      const para = Object.fromEntries(Object.entries(f.para).filter(([k]) => !k.startsWith('RES_CHRATR_'))) as SwAttrSet;
      if (Object.keys(para).length) this.SetParaAttr(para);
    }
  }

  // --- graphics (wrtsh1.cxx InsertGraphic) ---

  /**
   * SwWrtShell::InsertGraphic, anchored as character: a graphic larger than the text area is
   * scaled down, keeping its proportions, to fit.
   */
  InsertGraphic(data: Uint8Array, mime: string, size: { width: number; height: number }, asChar = false): string {
    this.m_nUpDownX = null;
    const doc = this.m_pDoc, pd = doc.m_aPageDesc;
    // The document's preferred image resolution (File > Properties) sizes the image by its pixels.
    const nPreferredDPI = doc.m_nImagePreferredDPI;
    const px = nPreferredDPI > 0 ? DetectGraphic(data) : null;
    if (px && px.mnPixWidth && px.mnPixHeight) size = { width: Math.round((px.mnPixWidth / nPreferredDPI) * 1440), height: Math.round((px.mnPixHeight / nPreferredDPI) * 1440) };
    const frame = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex())?.frame;
    const maxW = frame?.nWidth ?? pd.PrintWidth(), maxH = pd.PrintHeight();
    const scale = Math.min(1, maxW / size.width, maxH / size.height);
    const name = doc.GetUniqueGrfName();
    const width = Math.round(size.width * scale), height = Math.round(size.height * scale);
    if (this.HasSelection()) this.DelSelection();
    if (asChar) {
      const fly: SwFlyCnt = { graphic: doc.AddGraphic(data, mime), width, height, name };
      doc.InsertGraphic(this.m_pCursor, fly);
    } else {
      // The default anchor of Tools > Options > Writer > Formatting Aids is "To character".
      doc.MakeFlyFrameFormat(this.m_pCursor, GraphicFlyFormat(name, doc.AddGraphic(data, mime), width, height));
    }
    this.m_sSelFly = name;
    return name;
  }

  // --- fly frames (fefly1.cxx, feshview.cxx) ---

  /**
   * SwFrameInsertDlg with its defaults (FN_INSERT_FRAME): a frame anchored to the paragraph, as
   * wide as the text area allows up to 5 cm, growing with its text. The cursor goes into it.
   */
  InsertTextFrame(width = 2835, height = 567): string {
    if (this.HasSelection()) this.DelSelection();
    const doc = this.m_pDoc;
    const name = doc.GetUniqueFrameName();
    doc.MakeTextFly(this.m_pCursor, TextFlyFormat(name, name, width, height));
    const sec = doc.GetNodes().FindFlySection(name)!;
    this.place(doc.GetNodes().GoNext(sec.GetIndex())!, 0, false);
    this.m_sSelFly = null;
    return name;
  }

  /**
   * SwFEShell::BeginCreate / EndCreate with ImpEndCreate: a drawing shape of a type in a document
   * rectangle, anchored to the paragraph there and selected. One undo step.
   */
  InsertShape(type: string, r: SwRect): string {
    if (this.HasSelection()) this.DelSelection();
    const doc = this.m_pDoc;
    const at = this.m_pRoot.GetModelPositionForViewPoint(new Point(r.Left(), r.Top()));
    this.place(at.node, at.content, false);
    const name = doc.GetUniqueShapeName();
    doc.MakeFlyFrameFormat(this.m_pCursor, ShapeFlyFormat(name, type, Math.max(56, Math.round(r.Width())), Math.max(56, Math.round(r.Height())), 0, 0));
    this.SelectFly(name);
    if (this.MoveFly(r.Left(), r.Top())) doc.MergeLastUndo();
    return name;
  }

  /**
   * SwDrawTextShell: starts editing the text of a shape (a double click on it). The shape gets a
   * text section if it has none; the cursor goes to the end of its text.
   */
  EditShapeText(name: string): boolean {
    const doc = this.m_pDoc;
    const fmt = this.GetFlyFrameFormat(name);
    if (!fmt?.m_pShape || fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AS_CHAR) return false;
    if (fmt.m_sContentId === undefined) doc.MakeShapeText(this.m_pCursor, name);
    const sec = doc.GetNodes().FindFlySection(name);
    if (!sec) return false;
    this.m_sSelFly = null;
    const last = doc.GetNodes().node(sec.EndOfSectionNode().GetIndex() - 1);
    if (last.IsTextNode()) this.place(last, last.Len(), false);
    return true;
  }

  /** The text frame the cursor is in, if any (SwFEShell::GetCurrFlyFrame). */
  GetCurrFlyName(): string | null {
    const sec = this.pt.GetNode().FindFlyStartNode();
    return sec ? sec.m_sFlyId : null;
  }

  IsFrameSelected(): boolean { return !!this.m_sSelFly && !!this.m_pDoc.FindFlyByName(this.m_sSelFly); }

  /** SwFEShell::SelectObj for a fly; null deselects (SwFEShell::EnterStdMode). */
  SelectFly(name: string | null): void {
    this.m_sSelFly = name;
    if (name) this.m_pCursor.DeleteMark();
  }

  /** The selected fly's format, as-character graphics included. */
  GetFlyFrameFormat(name = this.m_sSelFly): SwFlyFrameFormat | null {
    if (!name) return null;
    const loc = this.m_pDoc.FindFlyByName(name);
    if (!loc) return null;
    return loc.fmt ?? (loc.asChar ? AsCharFormat(loc.asChar) : null);
  }

  /** The selected fly's rectangle in the current layout. */
  GetFlyRect(name = this.m_sSelFly): SwRect | null { return name ? this.m_pRoot.FindFly(name)?.fly.aFrame ?? null : null; }

  /** SwFEShell::SetFlyFrameAttr: changes the selected fly's format. */
  /** SwGrfShell::GetAttrState: the selected graphic's colour attributes. */
  GetGrfAttr(): SwGrfAttr { return { ...(this.GetFlyFrameFormat()?.m_aGrfAttr ?? {}) }; }

  /** SwGrfShell::ExecAttr for SID_ATTR_GRAF_*: changes the selected graphic's colour attributes. */
  SetGrfAttr(change: SwGrfAttr): boolean {
    const old = this.GetFlyFrameFormat();
    if (!old || old.graphic === undefined) return false;
    return this.SetFlyFrameAttr({ m_aGrfAttr: NormalizeGrfAttr({ ...old.m_aGrfAttr, ...change }) });
  }

  SetFlyFrameAttr(change: Partial<SwFlyFrameFormat>): boolean {
    const name = this.m_sSelFly, old = this.GetFlyFrameFormat();
    if (!name || !old) return false;
    const fmt: SwFlyFrameFormat = { ...old, ...change };
    // An as-character graphic stays where it is unless its anchor changes.
    if (fmt.m_aAnchor.m_eAnchorId !== old.m_aAnchor.m_eAnchorId) return this.ChgAnchor(fmt.m_aAnchor.m_eAnchorId, fmt);
    return this.m_pDoc.SetFlyFrameFormat(this.m_pCursor, name, fmt);
  }

  /**
   * SwFEShell::ChgAnchor: anchors the selected fly differently, keeping it where it is on the page
   * (its orientation becomes "from left" and "from top" against the new anchor).
   */
  ChgAnchor(eAnchorId: RndStdIds, base?: SwFlyFrameFormat): boolean {
    const name = this.m_sSelFly, old = base ?? this.GetFlyFrameFormat();
    const hit = name ? this.m_pRoot.FindFly(name) : null;
    if (!name || !old || !hit) return false;
    if (eAnchorId === RndStdIds.FLY_AS_CHAR && old.graphic === undefined) return false; // text frames as characters are not ported
    const r = hit.fly.aFrame, page = hit.page;
    const loc = this.m_pDoc.FindFlyByName(name)!;
    let fmt: SwFlyFrameFormat = { ...old, m_aAnchor: { m_eAnchorId: eAnchorId, m_nPageNumber: eAnchorId === RndStdIds.FLY_AT_PAGE ? page.nIndex + 1 : 0 } };
    let to: { node: SwTextNode; nContent: number } | undefined;
    if (eAnchorId === RndStdIds.FLY_AT_PAGE) {
      fmt = { ...fmt, m_aHoriOrient: { m_eOrient: HoriOrientation.NONE, m_eRelation: RelOrientation.PAGE_FRAME, m_nPos: r.Left() - page.aFrame.Left() },
        m_aVertOrient: { m_eOrient: VertOrientation.NONE, m_eRelation: RelOrientation.PAGE_FRAME, m_nPos: r.Top() - page.aFrame.Top() } };
    } else if (eAnchorId === RndStdIds.FLY_AS_CHAR) {
      to = loc.node ? { node: loc.node, nContent: loc.nContent! } : { node: this.pt.GetNode(), nContent: this.pt.GetContentIndex() };
    } else {
      // The paragraph at the fly's top left corner becomes the anchor, unless it keeps its own.
      const node = loc.node && !loc.asChar ? loc.node : this.m_pRoot.GetModelPositionForViewPoint(new Point(r.Left(), r.Top())).node;
      const nContent = loc.node === node ? (loc.nContent ?? 0) : 0;
      to = { node, nContent };
      const geo = this.m_pRoot.GetAnchorGeometry(node);
      if (geo) {
        fmt = { ...fmt, m_aHoriOrient: { m_eOrient: HoriOrientation.NONE, m_eRelation: RelOrientation.FRAME, m_nPos: r.Left() - geo.g.left },
          m_aVertOrient: { m_eOrient: VertOrientation.NONE, m_eRelation: RelOrientation.FRAME, m_nPos: r.Top() - geo.g.top } };
      }
    }
    return this.m_pDoc.SetFlyFrameFormat(this.m_pCursor, name, fmt, to);
  }

  GetAnchorId(): RndStdIds | null { return this.GetFlyFrameFormat()?.m_aAnchor.m_eAnchorId ?? null; }

  /**
   * SwFEShell::MoveObj / SwFEShell::SetFlyPos: moves the selected fly to a new top-left corner. A
   * paragraph or character anchor moves to the paragraph there (SwFEShell::FindAnchorPos).
   */
  MoveFly(left: number, top: number): boolean {
    const name = this.m_sSelFly, old = this.GetFlyFrameFormat();
    const hit = name ? this.m_pRoot.FindFly(name) : null;
    if (!name || !old || !hit || old.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AS_CHAR) return false;
    // A rotated graphic's frame is its bounds: the position is the unrotated frame's.
    if (old.m_nGrfRotation && old.graphic !== undefined) {
      const b = RotatedBoundSize(old.m_nWidth, old.m_nHeight, old.m_nGrfRotation);
      left += (b.width - old.m_nWidth) / 2; top += (b.height - old.m_nHeight) / 2;
    }
    const loc = this.m_pDoc.FindFlyByName(name)!;
    let rel = { h: hit.fly.aRelH.left, v: hit.fly.aRelV.top };
    let to: { node: SwTextNode; nContent: number } | undefined;
    let fmt = old;
    if (old.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE) {
      const page = this.m_pRoot.GetPageAt(new Point(left, top));
      if (page !== hit.page) {
        fmt = { ...fmt, m_aAnchor: { ...fmt.m_aAnchor, m_nPageNumber: page.nIndex + 1 } };
        rel = { h: hit.fly.aRelH.left - hit.page.aFrame.Left() + page.aFrame.Left(), v: hit.fly.aRelV.top - hit.page.aFrame.Top() + page.aFrame.Top() };
      }
    } else {
      const at = this.m_pRoot.GetModelPositionForViewPoint(new Point(left, top));
      const inBody = this.m_pDoc.GetNodes().AreaOf(at.node) === this.m_pDoc.GetNodes().m_pStartOfContent;
      const geo = this.m_pRoot.GetAnchorGeometry(at.node);
      if (inBody && at.node !== loc.node && geo && this.m_pDoc.GetNodes().AreaOf(loc.node!) === this.m_pDoc.GetNodes().m_pStartOfContent) {
        to = { node: at.node, nContent: old.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? at.content : 0 };
        const old0 = this.m_pRoot.GetAnchorGeometry(loc.node!)!;
        // The relations keep their kind; their origins move with the paragraph.
        rel = { h: hit.fly.aRelH.left - old0.g.left + geo.g.left, v: hit.fly.aRelV.top - old0.g.top + geo.g.top };
        if (old.m_aVertOrient.m_eRelation >= RelOrientation.PAGE_LEFT && old.m_aVertOrient.m_eRelation !== RelOrientation.TEXT_LINE) rel.v = hit.fly.aRelV.top - hit.page.aFrame.Top() + geo.page.aFrame.Top();
      }
    }
    fmt = { ...fmt, m_aHoriOrient: { ...fmt.m_aHoriOrient, m_eOrient: HoriOrientation.NONE, m_nPos: Math.round(left - rel.h) },
      m_aVertOrient: { ...fmt.m_aVertOrient, m_eOrient: VertOrientation.NONE, m_nPos: Math.round(top - rel.v) } };
    return this.m_pDoc.SetFlyFrameFormat(this.m_pCursor, name, fmt, to);
  }

  /** SwFEShell::SetObjRect: new size (and position, for flys not anchored as characters). */
  SetFlyRect(r: SwRect): boolean {
    const old = this.GetFlyFrameFormat(), cur = this.GetFlyRect();
    if (!old || !cur) return false;
    let width = Math.max(56, Math.round(r.Width())), height = Math.max(56, Math.round(r.Height()));
    if (old.m_nGrfRotation && old.graphic !== undefined) {
      // The bounds of a rotated graphic scale its unrotated size (quarter turns swap the sides).
      const sx = r.Width() / cur.Width(), sy = r.Height() / cur.Height();
      const quarter = Math.round(old.m_nGrfRotation / 900) % 2 === 1;
      width = Math.max(56, Math.round(old.m_nWidth * (quarter ? sy : sx)));
      height = Math.max(56, Math.round(old.m_nHeight * (quarter ? sx : sy)));
    }
    if (!this.SetFlyFrameAttr({ m_nWidth: width, m_nHeight: height })) return false;
    if (old.m_aAnchor.m_eAnchorId !== RndStdIds.FLY_AS_CHAR && (r.Left() !== cur.Left() || r.Top() !== cur.Top())) {
      // One undo step for a resize that also moves the frame.
      this.MoveFly(r.Left(), r.Top());
      this.m_pDoc.MergeLastUndo();
    }
    return true;
  }

  /**
   * SwGrfShell::ExecuteRotation: adds a rotation (1/10 degree, counterclockwise) to the selected
   * graphic, or with null resets it (SwFlyFrameAttrMgr::SetRotation).
   */
  RotateGraphic(delta: number | null): boolean {
    const f = this.GetFlyFrameFormat();
    if (!f || f.graphic === undefined) return false;
    const n = delta === null ? 0 : (((f.m_nGrfRotation ?? 0) + delta) % 3600 + 3600) % 3600;
    return this.SetFlyFrameAttr({ m_nGrfRotation: n || undefined });
  }

  /**
   * The end of a rotation drag (SdrDragRotate): turns the selected object by `degrees`
   * clockwise on the page. A shape's rotation is clockwise in degrees; a graphic's
   * (SwRotationGrf) counterclockwise in 1/10 degree.
   */
  RotateSelection(degrees: number): boolean {
    const f = this.GetFlyFrameFormat();
    if (!f) return false;
    if (f.m_pShape) {
      const r = (((f.m_pShape.m_nRotate ?? 0) + degrees) % 360 + 360) % 360;
      return this.SetFlyFrameAttr({ m_pShape: { ...f.m_pShape, m_nRotate: r || undefined } });
    }
    return f.graphic !== undefined && this.RotateGraphic(-Math.round(degrees * 10));
  }

  /** SwGrfShell's SID_FLIP_HORIZONTAL and SID_FLIP_VERTICAL on the SwMirrorGrf of the selected graphic. */
  MirrorGraphic(bHorizontal: boolean): boolean {
    const f = this.GetFlyFrameFormat();
    if (!f || f.graphic === undefined) return false;
    const m = f.m_eMirror ?? 'none';
    const next = bHorizontal
      ? ({ none: 'vertical', horizontal: 'both', vertical: 'none', both: 'horizontal' } as const)[m]
      : ({ none: 'horizontal', vertical: 'both', horizontal: 'none', both: 'vertical' } as const)[m];
    return this.SetFlyFrameAttr({ m_eMirror: next === 'none' ? undefined : next });
  }

  /**
   * SwFEShell::MirrorSelection for a drawing shape: mirrors it left and right (or top and
   * bottom); a rotation turns the other way, as SdrObject::Mirror does.
   */
  MirrorSelection(bHorizontal: boolean): boolean {
    const f = this.GetFlyFrameFormat();
    if (!f?.m_pShape) return false;
    const sh = f.m_pShape;
    const rot = sh.m_nRotate ? (360 - sh.m_nRotate) % 360 : undefined;
    const shape = bHorizontal ? { ...sh, m_bFlipH: !sh.m_bFlipH, m_nRotate: rot } : { ...sh, m_bFlipV: !sh.m_bFlipV, m_nRotate: rot };
    return this.SetFlyFrameAttr({ m_pShape: shape });
  }

  /** SwWrtShell::ReRead: the selected graphic shows other data in its frame (Replace Image, filters). */
  ReRead(data: Uint8Array, mime: string): boolean {
    if (this.GetFlyFrameFormat()?.graphic === undefined) return false;
    return this.SetFlyFrameAttr({ graphic: this.m_pDoc.AddGraphic(data, mime) });
  }

  /**
   * The end of a crop drag (SdrDragCrop): the frame takes the rectangle `r`, and the graphic is
   * cropped so that it stays where it is at its scale. Growing past the graphic crops negatively,
   * which adds empty space.
   */
  CropFly(r: SwRect): boolean {
    const old = this.GetFlyFrameFormat(), cur = this.GetFlyRect();
    if (!old || !cur || old.graphic === undefined) return false;
    const c = old.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
    // The whole graphic's area at its current scale.
    const fw = cur.Width() / Math.max(1e-6, 1 - c.left - c.right), fh = cur.Height() / Math.max(1e-6, 1 - c.top - c.bottom);
    const x0 = cur.Left() - c.left * fw, y0 = cur.Top() - c.top * fh;
    const width = Math.max(56, Math.round(r.Width())), height = Math.max(56, Math.round(r.Height()));
    const crop = {
      left: (r.Left() - x0) / fw, right: (x0 + fw - (r.Left() + width)) / fw,
      top: (r.Top() - y0) / fh, bottom: (y0 + fh - (r.Top() + height)) / fh,
    };
    const none = Object.values(crop).every((v) => Math.abs(v) < 1e-9);
    const change: Partial<SwFlyFrameFormat> = { m_nWidth: width, m_nHeight: height, crop: none ? undefined : crop };
    if (!this.SetFlyFrameAttr(change)) return false;
    if (old.m_aAnchor.m_eAnchorId !== RndStdIds.FLY_AS_CHAR && (r.Left() !== cur.Left() || r.Top() !== cur.Top())) {
      this.MoveFly(r.Left(), r.Top());
      this.m_pDoc.MergeLastUndo();
    }
    return true;
  }

  /** SwFEShell::DelSelectedObj */
  DelSelectedFly(): boolean {
    const name = this.m_sSelFly;
    this.m_sSelFly = null;
    return !!name && this.m_pDoc.DelFly(this.m_pCursor, name);
  }

  // --- comments (wrtsh1.cxx InsertPostIt) ---

  /** Inserts an empty comment on the selection or at the cursor; returns its id. */
  InsertPostIt(author: string): string {
    this.m_nUpDownX = null;
    this.m_aPending = {};
    const id = this.m_pDoc.NewAnnotationId();
    this.m_pDoc.InsertAnnotation(this.m_pCursor, { id, author, date: new Date().toISOString(), text: '', resolved: false });
    return id;
  }

  /** The comment at the cursor: its anchor just before the cursor, or a commented range around it. */
  GetCurrentPostIt(): SwPostItField | null {
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    const at = (k: number) => (k >= 0 ? n.GetCharAttrAt('RES_TXTATR_ANNOTATION', k) : null);
    const direct = at(i - 1) ?? at(i);
    if (direct) return direct;
    const mark = n.GetCharAttrAt('RES_TXTATR_ANNOTMARK', Math.max(0, i - 1));
    return mark ? this.m_pDoc.GetAnnotations().find((a) => a.field.id === mark)?.field ?? null : null;
  }

  // --- footnotes (wrtsh1.cxx InsertFootnote, crstrvl.cxx GotoFootnoteText/GotoFootnoteAnchor) ---

  /** SwWrtShell::InsertFootnote: inserts an anchor and moves into the new footnote's text. */
  InsertFootnote(bEndNote = false): void {
    this.m_nUpDownX = null;
    this.m_aPending = {};
    const id = this.m_pDoc.InsertFootnote(this.m_pCursor, bEndNote);
    this.GotoFootnoteText(id);
  }

  GotoFootnoteText(id: string): boolean {
    const nodes = this.m_pDoc.GetNodes();
    const sec = nodes.FindFootnoteSection(id);
    const first = sec && nodes.GoNext(sec.GetIndex());
    if (!first) return false;
    this.place(first, 0, false);
    return true;
  }

  /** In a footnote: back behind its anchor. At an anchor: into its footnote (FN_FOOTNOTE_TO_ANCHOR). */
  GotoFootnoteOrAnchor(): boolean {
    const nodes = this.m_pDoc.GetNodes();
    const sec = this.pt.GetNode().FindFootnoteStartNode();
    if (sec) {
      for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) {
        const h = n.m_aHints.find((x) => x.aAttrs.RES_TXTATR_FTN?.id === sec.m_sFootnoteId);
        if (h) { this.place(n, h.nEnd, false); return true; }
      }
      return false;
    }
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    const ftn = n.GetCharAttrAt('RES_TXTATR_FTN', i) ?? (i > 0 ? n.GetCharAttrAt('RES_TXTATR_FTN', i - 1) : null);
    return ftn ? this.GotoFootnoteText(ftn.id) : false;
  }

  // --- tables of contents (SwWrtShell::InsertTableOf, UpdateTableOf) ---

  private pageOf = (n: SwTextNode): number => (this.m_pRoot.FindLine(n, 0)?.page.nIndex ?? 0) + 1;
  private relayout = (): void => this.m_pRoot.Layout();

  InsertTableOf(title = 'Table of Contents', levels = 10): string {
    this.m_nUpDownX = null;
    return this.m_pDoc.InsertTableOf(this.m_pCursor, { title, levels }, this.pageOf, this.relayout);
  }

  /** The index the cursor is in, if any. */
  GetCurTOX(): string { return this.pt.GetNode().GetAttr('RES_PARATR_TOX_ID'); }

  /** Regenerates an index with its title and levels as they are. */
  UpdateTableOf(id: string): void {
    const paras = this.m_pDoc.GetTocParas(id);
    const kept = this.m_pDoc.m_aTocSettings.get(id);
    const title = kept?.title ?? (paras[0]?.GetTextColl().GetName() === 'Contents Heading' ? paras[0].GetText() : '');
    this.m_pDoc.InsertTableOf(this.m_pCursor, { title, levels: kept?.levels ?? 10, id }, this.pageOf, this.relayout);
  }

  UpdateAllTableOf(): void {
    const ids = new Set<string>();
    for (let n = this.m_pDoc.GetNodes().FirstTextNode() as SwTextNode | null; n; n = this.m_pDoc.GetNodes().GoNext(n.GetIndex())) if (n.m_aSet.RES_PARATR_TOX_ID) ids.add(n.m_aSet.RES_PARATR_TOX_ID);
    for (const id of ids) this.UpdateTableOf(id);
  }

  // --- headers, footers and fields ---
  /** SwFEShell::GetCurPageDesc: the page style of the page the cursor is on. */
  GetCurPageDesc(): SwPageDesc {
    const area = this.pt.GetNode().FindHeaderStartNode() ?? this.pt.GetNode().FindFooterStartNode();
    if (area) return this.m_pDoc.FindPageDesc(area.m_sPageDesc) ?? this.m_pDoc.m_aPageDesc;
    return this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex())?.page.pDesc ?? this.m_pDoc.m_aPageDesc;
  }

  IsHeaderOn(bHeader: boolean, desc = this.GetCurPageDesc().m_aName): boolean {
    return !!this.m_pDoc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, 'default', desc);
  }

  /** SwWrtShell::ChangeHeaderOrFooter for the cursor's page style; turning one on moves the cursor into it. */
  ChangeHeaderOrFooter(bHeader: boolean, bOn: boolean, bGoto = true, desc = this.GetCurPageDesc().m_aName): void {
    const wasOn = this.IsHeaderOn(bHeader, desc);
    this.m_pDoc.SetHeaderFooter(this.m_pCursor, bHeader, bOn, 'default', desc);
    if (bOn && !wasOn && bGoto) this.GotoHeaderFooter(bHeader);
  }

  /**
   * SwWrtShell::InsertPageBreak with a page style (Insert > More Breaks > Manual Break): a new
   * paragraph that starts a page of that style, optionally renumbering from `numOffset`.
   */
  InsertPageBreak(desc: string | null, numOffset: number | null = null): void {
    this.SplitNode();
    if (desc) this.SetParaAttr({ RES_PAGEDESC: { name: desc, numOffset } });
    else this.SetParaAttr({ RES_BREAK: 'page-before' });
  }

  /** The page style a paragraph starts, set or cleared (the Text Flow tab's "With page style"). */
  SetPageDescAttr(v: { name: string; numOffset: number | null } | null): void { this.SetParaAttr({ RES_PAGEDESC: v }); }

  /** FN_TO_HEADER / FN_TO_FOOTER: into the header or footer, on the caret's page. */
  GotoHeaderFooter(bHeader: boolean): boolean {
    const page = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex())?.page;
    const s = this.m_pDoc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, 'default', this.GetCurPageDesc().m_aName);
    if (!s) return false;
    const r = bHeader ? page?.aHeader : page?.aFooter;
    if (r) this.SetCursor(new Point(r.Left(), r.Top() + 1));
    else this.place(this.m_pDoc.GetNodes().GoNext(s.GetIndex())!, 0, false);
    return true;
  }

  /** Back from a header or footer to the body. */
  IsInHeaderFooter(): boolean { return this.m_pDoc.GetNodes().AreaOf(this.pt.GetNode()) !== this.m_pDoc.GetNodes().m_pStartOfContent; }

  InsertField(type: SwField['type'], fixed = false): void {
    this.m_nUpDownX = null;
    const field: SwField = { type };
    if (fixed && type === 'Date') field.fixed = new Date().toLocaleDateString();
    if (fixed && type === 'Time') field.fixed = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pending = this.m_aPending;
    this.m_pDoc.InsertField(this.m_pCursor, field, Object.keys(pending).length ? pending : undefined);
  }

  // --- tables (fetab.cxx, edtab.cxx) ---
  IsCursorInTable(): boolean { return !!this.pt.GetNode().FindTableNode(); }

  InsertTable(nRows: number, nCols: number, opts = { heading: true, repeatHeading: true, borders: true }): void {
    this.m_nUpDownX = null;
    this.m_aPending = {};
    this.m_pDoc.InsertTable(this.m_pCursor, nRows, nCols, opts);
  }

  private cellStart(box: SwTableBox): SwTextNode { return this.m_pDoc.GetNodes().GoNext(box.m_pStartNode!.GetIndex())!; }

  /** SwCursorShell::GoNextCell; with `bAppendLine` the last cell gets a new row after it. */
  GoNextCell(bAppendLine = true): boolean {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    if (!at) return false;
    const boxes = at.tableNode.m_pTable.GetTabSortBoxes().filter((b) => b.getRowSpan() > 0);
    const next = boxes[boxes.indexOf(at.box) + 1];
    if (next) { this.place(this.cellStart(next), 0, false); return true; }
    if (!bAppendLine) return false;
    this.m_pDoc.InsertRow(this.m_pCursor, true);
    const line = at.tableNode.m_pTable.GetTabLines()[at.line + 1];
    if (line?.m_aBoxes[0]) this.place(this.cellStart(line.m_aBoxes[0]), 0, false);
    return true;
  }

  GoPrevCell(): boolean {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    if (!at) return false;
    const boxes = at.tableNode.m_pTable.GetTabSortBoxes().filter((b) => b.getRowSpan() > 0);
    const prev = boxes[boxes.indexOf(at.box) - 1];
    if (prev) this.place(this.cellStart(prev), 0, false);
    return true;
  }

  InsertRow(bBehind: boolean, nCnt = 1): boolean { return this.m_pDoc.InsertRow(this.m_pCursor, bBehind, nCnt); }
  InsertCol(bBehind: boolean, nCnt = 1): boolean { return this.m_pDoc.InsertCol(this.m_pCursor, bBehind, nCnt); }

  /** SwFEShell::MergeTab: merges the selected cells. */
  MergeTab(): TableMergeErr { return this.m_pDoc.MergeTable(this.m_pCursor); }
  /** SwFEShell::SplitTab: splits the selected cells into nCnt + 1, side by side with bVert. */
  SplitTab(bVert: boolean, nCnt: number): boolean { return this.m_pDoc.SplitTable(this.m_pCursor, this.GetTableSelBoxes(), bVert, nCnt); }
  /** SwFEShell::SplitTable: a new table from the cursor's row on. */
  SplitTable(eMode: SplitTable_HeadlineOption): boolean { return this.m_pDoc.SplitTableAt(this.m_pCursor, eMode); }
  /** SwWrtShell::InsertLabel for the table at the cursor (SwView::InsertCaption). */
  InsertLabel(rCategory: string, rText: string, rSeparator: string, bBefore: boolean, numType?: number): boolean {
    return this.m_pDoc.InsertLabel(this.m_pCursor, rCategory, rText, rSeparator, '. ', bBefore, numType);
  }
  /** SwFEShell::CanMergeTable */
  CanMergeTable(): { prev: boolean; next: boolean } { return this.m_pDoc.CanMergeTable(this.pt.GetNode()); }
  /** SwFEShell::MergeTable */
  MergeTable(bWithPrev: boolean): boolean { return this.m_pDoc.MergeTables(this.m_pCursor, bWithPrev); }
  /** The cursor's row in its table, or -1. */
  GetTableRow(): number { return this.m_pDoc.GetTableBoxAt(this.pt.GetNode())?.line ?? -1; }
  DeleteRow(): boolean { return this.m_pDoc.DeleteRow(this.m_pCursor); }
  DeleteCol(): boolean { return this.m_pDoc.DeleteCol(this.m_pCursor); }
  DeleteTable(): boolean { return this.m_pDoc.DeleteTable(this.m_pCursor); }

  // --- table cursor (SwShellTableCursor, SwCursorShell::IsTableMode, SwFEShell::SelTableRowCol) ---

  /** The table box start nodes of point and mark, when both are in boxes of the same table. */
  private tableSelEnds(): { table: SwTableNode; pt: SwStartNode; mk: SwStartNode } | null {
    const a = this.pt.GetNode().FindTableBoxStartNode(), b = this.m_pCursor.GetMark().GetNode().FindTableBoxStartNode();
    if (!a || !b) return null;
    const ta = a.m_pStartOfSection, tb = b.m_pStartOfSection;
    if (ta !== tb || !ta?.IsTableNode()) {
      // A selection from a box of a nested table to its outer table: the outer boxes containing them.
      return null;
    }
    return { table: ta as SwTableNode, pt: a, mk: b };
  }

  /** SwCursorShell::IsTableMode: point and mark are in different boxes of one table. */
  IsTableMode(): boolean {
    if (!this.HasSelection()) return false;
    const e = this.tableSelEnds();
    return !!e && e.pt !== e.mk;
  }

  /**
   * GetTableSel: the selected boxes, a rectangle in table mode (SwTable::CreateSelection);
   * otherwise the box at the cursor. Empty outside a table.
   */
  GetTableSelBoxes(eSearch: SearchType = SearchType.SEARCH_NONE): SwTableBox[] {
    const e = this.tableSelEnds();
    if (e) return e.table.m_pTable.CreateSelection(e.pt, e.mk, eSearch);
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    return at ? at.tableNode.m_pTable.CreateSelection(at.box.m_pStartNode!, at.box.m_pStartNode!, eSearch) : [];
  }

  /** The table the cursor is in (its innermost one). */
  GetTableNode(): SwTableNode | null { return this.m_pDoc.GetTableBoxAt(this.pt.GetNode())?.tableNode ?? null; }

  /** A PaM over a box's whole content. */
  private boxPaM(box: SwTableBox): SwPaM {
    const nodes = this.m_pDoc.GetNodes(), sn = box.m_pStartNode!;
    const first = nodes.GoNext(sn.GetIndex())!, last = nodes.GoPrevious(sn.EndOfSectionNode().GetIndex())!;
    return new SwPaM(new SwPosition(last, last.Len()), new SwPosition(first, 0));
  }

  /** The ring of a table cursor: `f` on each selected box's content, as one undo step. */
  private ForEachTableBoxPaM(f: (pam: SwPaM) => void): void {
    const boxes = this.GetTableSelBoxes();
    const n = this.StartUndo();
    for (const box of boxes) {
      const pam = this.boxPaM(box);
      f(pam);
      pam.Release();
    }
    this.EndUndo(n);
  }

  /** SwFEShell::SelTableRowCol: from the first box of the selection's rows or columns to the last. */
  private SelTableBoxes(boxes: SwTableBox[]): void {
    if (!boxes.length) return;
    const nodes = this.m_pDoc.GetNodes();
    const first = boxes[0]!, last = boxes[boxes.length - 1]!;
    const a = nodes.GoNext(first.m_pStartNode!.GetIndex())!, b = nodes.GoPrevious(last.m_pStartNode!.EndOfSectionNode().GetIndex())!;
    this.m_pCursor.GetMark().Assign(a, 0);
    this.pt.Assign(b, b.Len());
  }

  /** SwFEShell::SelTableRow (.uno:EntireRow) */
  SelTableRow(): void { this.SelTableBoxes(this.GetTableSelBoxes(SearchType.SEARCH_ROW)); }
  /** SwFEShell::SelTableCol (.uno:EntireColumn) */
  SelTableCol(): void { this.SelTableBoxes(this.GetTableSelBoxes(SearchType.SEARCH_COL)); }
  /** SwCursorShell::SelTableBox (.uno:EntireCell): the cells of the selection, whole. */
  SelTableBox(): void { this.SelTableBoxes(this.GetTableSelBoxes()); }

  // --- table geometry (fetab.cxx, tablemgr.cxx, ndtbl1.cxx) ---

  /** The first frame of a table, for its geometry. */
  private tabFrame(t: SwTableNode): SwTabFrame | null {
    for (const page of this.m_pRoot.pages) {
      const walk = (tabs: SwTabFrame[]): SwTabFrame | null => {
        for (const tab of tabs) {
          if (tab.node === t) return tab;
          for (const r of tab.rows) for (const c of r.cells) { const f = walk(c.tabs); if (f) return f; }
        }
        return null;
      };
      const f = walk(page.tabs);
      if (f) return f;
    }
    return null;
  }

  /**
   * SwFEShell::GetTabCols, reduced: the column borders of the cursor's table in twips from its
   * left edge (every box border of every row), the table's width as `right`, and the width it may
   * take as `rightMax`.
   */
  GetTabCols(): SwTabCols | null {
    const t = this.GetTableNode();
    if (!t) return null;
    const table = t.m_pTable, frame = this.tabFrame(t);
    const total = Math.max(...table.m_aLines.map((l) => l.m_aBoxes.reduce((x, b) => x + b.m_aAttrs.width, 0))) || 1;
    const right = frame ? frame.aFrame.Width() : table.m_aAttrs.width || this.m_pDoc.m_aPageDesc.PrintWidth();
    const k = right / total;
    const set = new Set<number>();
    for (const l of table.m_aLines) { let x = 0; for (const b of l.m_aBoxes.slice(0, -1)) { x += b.m_aAttrs.width; set.add(Math.round(x * k)); } }
    const cols = [...set].filter((x) => x > 0 && x < Math.round(right)).sort((a, b) => a - b);
    // The width a table may take: its column's (or cell's) width less its spacing.
    let rightMax = this.m_pDoc.m_aPageDesc.PrintWidth();
    const outer = t.m_pStartOfSection?.IsStartNode() && t.m_pStartOfSection.GetStartNodeType() === SwStartNodeType.SwTableBoxStartNode ? t.m_pStartOfSection : null;
    if (frame && outer) for (const page of this.m_pRoot.pages) for (const c of this.cellFrames(page.tabs)) if (c.box.m_pStartNode === outer) rightMax = c.aFrame.Width();
    return { left: 0, right: Math.round(right), cols, rightMax: Math.max(Math.round(right), rightMax - (table.m_aAttrs.leftSpace ?? 0) * 0) };
  }

  private cellFrames(tabs: SwTabFrame[]): SwCellFrame[] {
    const out: SwCellFrame[] = [];
    for (const t of tabs) for (const r of t.rows) for (const c of r.cells) { out.push(c); out.push(...this.cellFrames(c.tabs)); }
    return out;
  }

  /**
   * SwDoc::SetTabCols, reduced: the boxes take the widths between the new borders (each old border
   * moves to the new one at its index), and the table the new width. A table filling its area
   * (HoriOrientation::FULL) that becomes narrower is aligned left.
   */
  SetTabCols(old: SwTabCols, cols: SwTabCols): boolean {
    const t = this.GetTableNode();
    if (!t || old.cols.length !== cols.cols.length) return false;
    const table = t.m_pTable;
    const total = Math.max(...table.m_aLines.map((l) => l.m_aBoxes.reduce((x, b) => x + b.m_aAttrs.width, 0))) || 1;
    const k = old.right / total;
    const from = [0, ...old.cols, old.right], to = [0, ...cols.cols, cols.right];
    const map = (x: number) => {
      for (let i = 0; i + 1 < from.length; i++) {
        if (Math.abs(x - from[i]!) <= 2) return to[i]!;
        if (x < from[i + 1]! - 2) return to[i]! + ((x - from[i]!) * (to[i + 1]! - to[i]!)) / Math.max(1, from[i + 1]! - from[i]!);
      }
      return to[to.length - 1]!;
    };
    return this.m_pDoc.SetTableAttr(this.m_pCursor, (tab) => {
      for (const l of tab.m_aLines) {
        let x = 0;
        for (const b of l.m_aBoxes) {
          const a = map(x * k), e = map((x + b.m_aAttrs.width) * k);
          x += b.m_aAttrs.width;
          b.m_aAttrs = { ...b.m_aAttrs, width: Math.max(1, e - a) };
        }
      }
      if (cols.right !== old.right) {
        const at = tab.m_aAttrs;
        tab.m_aAttrs = { ...at, width: cols.right, adjust: at.adjust === 'full' && cols.right < old.right ? 'left' : at.adjust };
      }
    });
  }

  /** SwTableFUNC::GetColCount and GetColWidth: the cursor table's columns in twips. */
  GetColWidths(): number[] {
    const c = this.GetTabCols();
    if (!c) return [];
    const b = [c.left, ...c.cols, c.right];
    return b.slice(1).map((x, i) => x - b[i]!);
  }

  /** The column of the cursor (SwFEShell::GetCurTabColNum, for the cursor's cell's left border). */
  GetCurTabColNum(): number {
    const at = this.m_pDoc.GetTableBoxAt(this.pt.GetNode()), c = this.GetTabCols();
    if (!at || !c) return 0;
    const total = Math.max(...at.tableNode.m_pTable.m_aLines.map((l) => l.m_aBoxes.reduce((x, b) => x + b.m_aAttrs.width, 0))) || 1;
    const left = Math.round((at.left * c.right) / total);
    return c.cols.filter((x) => x <= left + 2).length;
  }

  /** SwTableFUNC::SetColWidth: the column gets its width from the next one (or the previous one, for the last). */
  SetColWidth(nNum: number, nNewWidth: number): boolean {
    const old = this.GetTabCols();
    if (!old) return false;
    const c: SwTabCols = { ...old, cols: [...old.cols] };
    const widths = this.GetColWidths(), n = widths.length;
    if (!old.cols.length) c.right = Math.min(nNewWidth, old.rightMax);
    else {
      const nDiff = nNewWidth - widths[nNum]!;
      if (!nNum) c.cols[0]! += nDiff;
      else if (nNum < n - 1) {
        if (nDiff < widths[nNum + 1]! - MINLAY) c.cols[nNum]! += nDiff;
        else {
          const nDiffLeft = nDiff - widths[nNum + 1]! + MINLAY;
          c.cols[nNum]! += nDiff - nDiffLeft;
          c.cols[nNum - 1]! -= nDiffLeft;
        }
      } else c.cols[nNum - 1]! -= nDiff;
    }
    return this.SetTabCols(old, c);
  }

  /** The lines of the selection (lcl_CollectLines). */
  private selLines(): SwTableLine[] {
    const lines: SwTableLine[] = [];
    for (const b of this.GetTableSelBoxes()) if (!lines.includes(b.m_pUpper)) lines.push(b.m_pUpper);
    return lines;
  }

  /** SwFEShell::GetRowHeight: the first selected row's height, fixed or minimal. */
  GetRowHeight(): { height: number; fix: boolean } | null {
    const l = this.selLines()[0];
    return l ? { height: l.m_aAttrs.minHeight, fix: !!l.m_aAttrs.fixHeight } : null;
  }

  /** SwDoc::SetRowHeight: the selected rows' height; 0 and not fixed is the automatic height. */
  SetRowHeight(height: number, fix: boolean): boolean {
    const sel = new Set(this.selLines());
    return this.m_pDoc.SetTableAttr(this.m_pCursor, (tab) => {
      for (const l of tab.m_aLines) if (sel.has(l)) l.m_aAttrs = { ...l.m_aAttrs, minHeight: Math.max(0, Math.round(height)), fixHeight: fix && height > 0 ? true : undefined };
    });
  }

  /** The laid-out height of a line: the largest of its row frames. */
  private lineHeight(t: SwTableNode, l: SwTableLine): number {
    let h = 0;
    const idx = t.m_pTable.m_aLines.indexOf(l);
    for (const page of this.m_pRoot.pages) {
      const walk = (tabs: SwTabFrame[]) => { for (const tab of tabs) { if (tab.node === t) for (const r of tab.rows) if (!r.bRepeated && r.cells.some((c) => c.box.m_pUpper === l)) h = Math.max(h, r.aFrame.Height()); for (const r of tab.rows) for (const c of r.cells) walk(c.tabs); } };
      walk(page.tabs);
    }
    void idx;
    return h;
  }

  /**
   * SwDoc::BalanceRowHeight: the selected rows all get the minimum height of the tallest one
   * (with bOptimize their average). False with fewer than two rows.
   */
  BalanceRowHeight(bTstOnly: boolean, bOptimize = false): boolean {
    const t = this.GetTableNode(), lines = this.selLines();
    if (!t || lines.length < 2) return false;
    if (bTstOnly) return true;
    let nHeight = 0, nTotalHeight = 0;
    for (const l of lines) {
      if (bOptimize) nHeight = 0;
      nHeight = Math.max(nHeight, this.lineHeight(t, l));
      nTotalHeight += nHeight;
    }
    if (bOptimize) nHeight = Math.trunc(nTotalHeight / lines.length);
    const sel = new Set(lines);
    return this.m_pDoc.SetTableAttr(this.m_pCursor, (tab) => {
      for (const l of tab.m_aLines) if (sel.has(l)) l.m_aAttrs = { ...l.m_aAttrs, minHeight: nHeight, fixHeight: undefined };
    });
  }

  /** lcl_CalcCellFit: the width a cell's content wants without wrapping, with its insets. */
  private CalcCellFit(c: SwCellFrame): number {
    const a = c.box.m_aAttrs, ins = a.padding * 2 + (a.box.left?.width ?? 0) + (a.box.right?.width ?? 0);
    let nRet = 0;
    for (const f of c.frames) {
      if (f.pCell !== c) continue;
      const para = FormatParagraph(f.node, 1e7, this.m, this.m_pRoot.m_aNums.get(f.node));
      const lr = f.node.GetAttr('RES_LR_SPACE');
      for (const l of para.lines) nRet = Math.max(nRet, l.nWidth + Math.max(0, lr.left) + Math.max(0, lr.right) + (l.nX > 0 ? l.nX : 0));
    }
    for (const t of c.tabs) nRet = Math.max(nRet, t.aFrame.Width());
    return Math.ceil(nRet) + ins;
  }

  /**
   * SwDoc::AdjustCellWidth with lcl_CalcColValues: the columns of the selection get the width
   * their content wants (bNoShrink: without getting narrower, the rest shared; bBalance: the same
   * width), within the room the table has and no less than the minimum of every cell.
   */
  AdjustCellWidth(bBalance: boolean, bNoShrink: boolean): boolean {
    const t = this.GetTableNode(), aTabCols = this.GetTabCols();
    if (!t || !aTabCols) return false;
    const old: SwTabCols = { ...aTabCols, cols: [...aTabCols.cols] };
    const n = aTabCols.cols.length + 1;
    const borders = () => [aTabCols.left, ...aTabCols.cols, aTabCols.right];
    const aWish = new Array<number>(n).fill(0), aMins = new Array<number>(n).fill(0);
    const frame = this.tabFrame(t);
    if (!frame) return false;
    const sel = new Set(this.GetTableSelBoxes());
    const x0 = frame.aFrame.Left();
    for (const page of this.m_pRoot.pages) for (const c of this.cellFrames(page.tabs)) {
      if (c.box.m_pStartNode?.m_pStartOfSection !== t) continue;
      const cl = c.aFrame.Left() - x0, cr = c.aFrame.Left() + c.aFrame.Width() - x0;
      const b = borders();
      const nWish = sel.has(c.box) ? this.CalcCellFit(c) : 0;
      const nMin = MINLAY + (c.box.m_aAttrs.padding * 2 + (c.box.m_aAttrs.box.left?.width ?? 0) + (c.box.m_aAttrs.box.right?.width ?? 0));
      for (let i = 0; i < n; i++) {
        const colL = b[i]!, colR = b[i + 1]!;
        // The share of the column in the cell (lcl_CalcSubColValues), or the whole cell.
        let w = 0;
        if (colL <= cl + 2 && colR >= cl + 2) w = Math.min(colR, cr) - cl;
        else if (colL <= cr - 2 && colR >= cr) w = cr - colL;
        else if (colL >= cl && colR <= cr) w = colR - colL;
        if (w <= 0 || !c.aFrame.Width()) continue;
        const f = w / c.aFrame.Width();
        if (nWish) aWish[i] = Math.max(aWish[i]!, Math.round(nWish * f));
        aMins[i] = Math.max(aMins[i]!, Math.round(nMin * f));
      }
    }
    let nSelectedWidth = 0, nCols = 0, fTotalWish = 0;
    if (bBalance || bNoShrink) {
      // Find the combined size of the selected columns
      const b = borders();
      for (let i = 0; i < n; i++) {
        if (aWish[i]) { nSelectedWidth += b[i + 1]! - b[i]!; ++nCols; }
        fTotalWish += aWish[i]!;
      }
      // bBalance: Distribute the width evenly
      if (bBalance && nCols) { const nEqualWidth = Math.trunc(nSelectedWidth / nCols); for (let i = 0; i < n; i++) if (aWish[i]) aWish[i] = nEqualWidth; }
    }
    const nOldRight = aTabCols.right;
    const nMaxRight = Math.max(aTabCols.rightMax, nOldRight);
    const nEqualWidth = Math.trunc((nMaxRight - aTabCols.left) / n);
    const nTablePadding = nSelectedWidth - fTotalWish;
    // In order to make the implementation easier, but still use the available space properly, we do this twice.
    for (let k = 0; k < 2; ++k) {
      for (let i = 0; i < n; ++i) {
        // bNoShrink: distribute excess space proportionately on pass 2.
        if (bNoShrink && k && nTablePadding > 0 && fTotalWish > 0) aWish[i]! += Math.round((aWish[i]! / fTotalWish) * nTablePadding);
        let nDiff = k ? aWish[i]! : Math.min(aWish[i]!, nEqualWidth);
        if (nDiff) {
          const nMin = aMins[i]!;
          if (nMin > nDiff) nDiff = nMin;
          const b = borders();
          nDiff -= b[i + 1]! - b[i]!;
          let nTabRight = aTabCols.right + nDiff;
          // If the Table would become (or is already) too wide, restrict the column growth to the allowed maximum.
          if (!bBalance && nTabRight > nMaxRight) { const nTmpD = nTabRight - nMaxRight; nDiff -= nTmpD; nTabRight -= nTmpD; }
          // all the remaining columns need to be shifted by the same amount
          for (let i2 = i; i2 < aTabCols.cols.length; ++i2) aTabCols.cols[i2]! += nDiff;
          aTabCols.right = nTabRight;
        }
      }
    }
    return this.SetTabCols(old, aTabCols);
  }

  /** SwFEShell::GetRowSelectionFromTop: how many rows from the top the selection covers. */
  GetRowSelectionFromTop(): number {
    const t = this.GetTableNode();
    if (!t) return 0;
    const rowOf = (n: SwTextNode) => { const at = this.m_pDoc.GetTableBoxAt(n); return at && at.tableNode === t ? at.line : -1; };
    const nPtLine = rowOf(this.pt.GetNode());
    if (!this.IsTableMode()) return nPtLine === 0 ? 1 : 0;
    const nMkLine = rowOf(this.m_pCursor.GetMark().GetNode());
    if ((nPtLine === 0 && nMkLine >= 0) || (nMkLine === 0 && nPtLine >= 0)) return Math.max(nPtLine, nMkLine) + 1;
    return 0;
  }

  GetRowsToRepeat(): number { return this.GetTableNode()?.m_pTable.GetRowsToRepeat() ?? 0; }
  /** SwFEShell::SetRowsToRepeat */
  SetRowsToRepeat(nSet: number): boolean {
    if (this.GetRowsToRepeat() === nSet) return false;
    return this.m_pDoc.SetTableAttr(this.m_pCursor, (tab) => { tab.m_nRowsToRepeat = nSet; });
  }

  /** SwFEShell::GetRowSplit: whether the selected rows may break across pages (null when they differ). */
  GetRowSplit(): boolean | null {
    const v = this.selLines().map((l) => !l.m_aAttrs.cantSplit);
    return v.length && v.every((x) => x === v[0]) ? v[0]! : null;
  }
  /** SwDoc::SetRowSplit */
  SetRowSplit(bSplit: boolean): boolean {
    const sel = new Set(this.selLines());
    return this.m_pDoc.SetTableAttr(this.m_pCursor, (tab) => {
      for (const l of tab.m_aLines) if (sel.has(l)) l.m_aAttrs = { ...l.m_aAttrs, cantSplit: bSplit ? undefined : true };
    });
  }

  /** SwFEShell::ProtectCells / UnProtectCells: the selected cells' content protection. */
  ProtectCells(bProtect: boolean): boolean {
    return this.m_pDoc.SetBoxAttr(this.m_pCursor, (box) => { box.m_aAttrs = { ...box.m_aAttrs, protect: bProtect || undefined }; }, false, this.GetTableSelBoxes());
  }
  /** SwFEShell::CanUnProtectCells */
  CanUnProtectCells(): boolean { return this.GetTableSelBoxes().some((b) => b.m_aAttrs.protect); }

  /**
   * SwCursorShell::HasReadonlySel, for protected cells: editing at the cursor or in the selection
   * would change a protected cell's content.
   */
  HasReadonlySel(): boolean {
    const boxAt = (n: SwTextNode) => this.m_pDoc.GetTableBoxAt(n)?.box;
    if (this.IsTableMode()) return this.GetTableSelBoxes().some((b) => b.m_aAttrs.protect);
    return !!boxAt(this.pt.GetNode())?.m_aAttrs.protect || (this.HasSelection() && !!boxAt(this.m_pCursor.GetMark().GetNode())?.m_aAttrs.protect);
  }

  /** SwFEShell::SelTable: from the first cell's start to the last cell's end. */
  SelTable(): void {
    const t = this.pt.GetNode().FindTableNode();
    if (!t) return;
    const nodes = this.m_pDoc.GetNodes();
    const first = nodes.GoNext(t.GetIndex())!, last = nodes.GoPrevious(t.EndOfSectionNode().GetIndex())!;
    this.m_pCursor.GetMark().Assign(first, 0);
    this.pt.Assign(last, last.Len());
  }

  DelPrevWord(): void { if (!this.HasSelection()) this.PrevWord(true); this.DelSelection(); }
  DelNextWord(): void { if (!this.HasSelection()) this.NextWord(true); this.DelSelection(); }

  DelSelection(): void {
    if (this.readonlyRefused()) return;
    this.m_nUpDownX = null; this.m_aPending = {};
    if (this.IsTableMode()) {
      // SwEditShell::DeleteSel: in table mode only the content of the selected boxes goes.
      const first = this.GetTableSelBoxes()[0];
      this.ForEachTableBoxPaM((pam) => this.m_pDoc.DeleteAndJoin(pam));
      const n = first && this.m_pDoc.GetNodes().GoNext(first.m_pStartNode!.GetIndex());
      if (n) { this.pt.Assign(n, 0); this.m_pCursor.DeleteMark(); }
      return;
    }
    this.m_pDoc.DeleteAndJoin(this.m_pCursor);
  }

  Undo(): void { this.m_aPending = {}; this.m_pDoc.Undo(this.m_pCursor); }
  Redo(): void { this.m_aPending = {}; this.m_pDoc.Redo(this.m_pCursor); }

  GetSelText(): string {
    if (!this.HasSelection()) return '';
    if (this.IsTableMode()) {
      // The boxes as text: tabs between the boxes of a row, a new line between rows.
      const boxes = this.GetTableSelBoxes(), rows: string[][] = [];
      let line: SwTableLine | null = null;
      for (const b of boxes) {
        if (b.m_pUpper !== line) { rows.push([]); line = b.m_pUpper; }
        const pam = this.boxPaM(b);
        const nodes = this.m_pDoc.GetNodes(), texts: string[] = [];
        for (let n = pam.Start().GetNode() as SwTextNode | null; n; n = n === pam.End().GetNode() ? null : nodes.GoNext(n.GetIndex())) texts.push(n.GetText());
        pam.Release();
        rows[rows.length - 1]!.push(texts.join(' ').split(CH_TXTATR_BREAKWORD).join(''));
      }
      return rows.map((r) => r.join('\t')).join('\n');
    }
    const s = this.m_pCursor.Start(), e = this.m_pCursor.End();
    // Field placeholders do not go to the clipboard as text.
    const strip = (t: string) => t.split(CH_TXTATR_BREAKWORD).join('');
    if (s.GetNode() === e.GetNode()) return strip(s.GetNode().GetText().slice(s.GetContentIndex(), e.GetContentIndex()));
    const out = [s.GetNode().GetText().slice(s.GetContentIndex())];
    const nodes = this.m_pDoc.GetNodes();
    for (let n = nodes.GoNext(s.GetNodeIndex()); n && n !== e.GetNode(); n = nodes.GoNext(n.GetIndex())) out.push(n.GetText());
    out.push(e.GetNode().GetText().slice(0, e.GetContentIndex()));
    return strip(out.join('\n'));
  }

  // --- attributes ---
  /** Value at the caret, or at the selection start; pending toggles take precedence. */
  GetAttr<K extends keyof SwAttrs>(which: K): SwAttrs[K] {
    if (!this.HasSelection() && which in this.m_aPending) return (this.m_aPending as SwAttrs)[which];
    const s = this.m_pCursor.Start();
    const n = s.GetNode();
    // With a bare caret, typing continues the attributes of the preceding character.
    const at = !this.HasSelection() && s.GetContentIndex() > 0 ? s.GetContentIndex() - 1 : s.GetContentIndex();
    return n.GetCharAttrAt(which, at);
  }

  SetCharAttr(attrs: SwCharAttrSet): void {
    if (this.IsTableMode()) this.ForEachTableBoxPaM((pam) => this.m_pDoc.InsertAttr(pam, attrs));
    else if (this.HasSelection()) this.m_pDoc.InsertAttr(this.m_pCursor, attrs);
    else { this.m_aPending = { ...this.m_aPending, ...attrs }; this.m_pDoc.Changed(); }
  }

  SetParaAttr(attrs: SwAttrSet): void {
    if (this.IsTableMode()) this.ForEachTableBoxPaM((pam) => this.m_pDoc.SetParaAttr(pam, attrs));
    else this.m_pDoc.SetParaAttr(this.m_pCursor, attrs);
  }

  /** SwWrtShell::SetAttrItem with SwFormatCharFormat: applies a character style, or none. */
  SetCharFormat(name: string | null): void {
    const f = name ? this.m_pDoc.FindCharFormatByName(name) ?? null : null;
    // Inside a word without a selection, the whole word takes the style (SwWrtShell's word-wise attributes).
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex(), t = n.GetText();
    if (!this.HasSelection() && i > 0 && i < t.length && /[\p{L}\p{N}]/u.test(t[i - 1]!) && /[\p{L}\p{N}]/u.test(t[i]!)) this.SelWrd();
    this.SetCharAttr({ RES_TXTATR_CHARFMT: f });
  }

  GetCharFormatName(): string | null { return this.GetAttr('RES_TXTATR_CHARFMT')?.GetName() ?? null; }

  ResetAttrs(): void {
    this.m_aPending = {};
    if (this.IsTableMode()) this.ForEachTableBoxPaM((pam) => this.m_pDoc.ResetAttrs(pam));
    else if (this.HasSelection()) this.m_pDoc.ResetAttrs(this.m_pCursor);
    else this.m_pDoc.Changed();
  }

  SetTextFormatColl(name: string): void {
    const coll = this.m_pDoc.FindTextFormatCollByName(name);
    if (!coll) return;
    if (this.IsTableMode()) this.ForEachTableBoxPaM((pam) => this.m_pDoc.SetTextFormatColl(pam, coll));
    else this.m_pDoc.SetTextFormatColl(this.m_pCursor, coll);
  }

  GetCurTextFormatColl(): string { return this.pt.GetNode().GetTextColl().GetName(); }

  // --- lists (wrtsh1.cxx, edtwin.cxx key handling) ---
  GetNumRuleAtCurrCursorPos(): SwNumRule | undefined {
    return this.m_pDoc.FindNumRulePtr(this.pt.GetNode().GetAttr('RES_PARATR_NUMRULE'));
  }

  private selectionParas(): SwTextNode[] {
    const nodes = this.m_pDoc.GetNodes(), out: SwTextNode[] = [];
    for (let i = this.m_pCursor.Start().GetNodeIndex(); i <= this.m_pCursor.End().GetNodeIndex(); i++) {
      const n = nodes.node(i);
      if (n.IsTextNode()) out.push(n);
    }
    return out;
  }

  private selectionHas(test: (f: ReturnType<SwNumRule['Get']>) => boolean): boolean {
    return this.selectionParas().some((n) => {
      const rule = this.m_pDoc.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
      return !!rule && test(rule.Get(GetActualListLevel(n)));
    });
  }

  /** SwEditShell::SelectionHasNumber */
  SelectionHasNumber(): boolean { return this.selectionHas((f) => f.IsEnumeration()); }
  /** SwEditShell::SelectionHasBullet */
  SelectionHasBullet(): boolean { return this.selectionHas((f) => f.IsItemize()); }

  /**
   * SwWrtShell::NumOrBulletOn. Outline numbering and the user's bullet configuration are not ported;
   * leading whitespace is kept rather than converted into indent.
   */
  NumOrBulletOn(bNum: boolean): void {
    const doc = this.m_pDoc;
    const node = this.pt.GetNode();
    // Only automatic numbering/bullet rules should be changed.
    let pNumRule = this.GetNumRuleAtCurrCursorPos();
    if (pNumRule && !pNumRule.IsAutoRule()) pNumRule = undefined;

    // Search for a previous numbering/bullet rule to continue it.
    let sContinuedListId = '';
    let bContinueFoundNumRule = false;
    if (!pNumRule) {
      const found = doc.SearchNumRule(node, bNum);
      if (found) { pNumRule = found.rule; sContinuedListId = found.listId; }
      bContinueFoundNumRule = !!found;
    }

    if (pNumRule) {
      const aNumRule = pNumRule.Clone();
      // do not change found numbering/bullet rule, if it should only be continued.
      if (!bContinueFoundNumRule) {
        const nLevel = GetActualListLevel(node);
        const aFormat = aNumRule.Get(nLevel).Clone();
        if (bNum) aFormat.SetNumberingType(NumberingType.ARABIC);
        else {
          aFormat.SetBulletChar(numfunc.GetBulletChar(nLevel));
          aFormat.SetNumberingType(NumberingType.CHAR_SPECIAL);
          // #i93908# clear suffix for bullet lists
          aFormat.SetListFormat('', '', nLevel);
        }
        aNumRule.Set(nLevel, aFormat);
      }
      // reset indent attribute on applying list style
      doc.SetNumRule(this.m_pCursor, aNumRule, false, sContinuedListId, true);
    } else {
      const aNumRule = new SwNumRule(doc.GetUniqueNumRuleName());
      for (let nLvl = 0; nLvl < MAXLEVEL; ++nLvl) {
        const aFormat = aNumRule.Get(nLvl).Clone();
        if (!bNum) {
          aFormat.SetBulletChar(numfunc.GetBulletChar(nLvl));
          aFormat.SetNumberingType(NumberingType.CHAR_SPECIAL);
          // #i93908# clear suffix for bullet lists
          aFormat.SetListFormat('', '', nLvl);
        }
        aNumRule.Set(nLvl, aFormat);
      }
      // reset indent attribute on applying list style; start new list
      doc.SetNumRule(this.m_pCursor, aNumRule, true, '', true);
    }
  }

  NumOrBulletOff(): void { if (this.GetNumRuleAtCurrCursorPos()) this.m_pDoc.DelNumRules(this.m_pCursor); }

  /** FN_NUM_NUMBERING_ON / FN_NUM_BULLET_ON: toggles. */
  ToggleNum(bNum: boolean): void {
    const has = bNum ? this.SelectionHasNumber() : this.SelectionHasBullet();
    if (has) this.NumOrBulletOff(); else this.NumOrBulletOn(bNum);
  }

  /**
   * SwEditShell::GetNumRuleAtCurrentSelection: the list rule of the selected paragraphs, if they
   * have only one; paragraphs outside lists do not count.
   */
  GetNumRuleAtCurrentSelection(): SwNumRule | undefined {
    let pNumRuleAtCurrentSelection: SwNumRule | undefined;
    for (const n of this.selectionParas()) {
      const pNumRule = this.m_pDoc.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
      if (!pNumRule) continue;
      else if (pNumRule !== pNumRuleAtCurrentSelection) {
        if (!pNumRuleAtCurrentSelection) pNumRuleAtCurrentSelection = pNumRule;
        else return undefined;
      }
    }
    return pNumRuleAtCurrentSelection;
  }

  /**
   * SwEditShell::SetCurNumRule: puts the selection into the rule and counts its paragraphs. A rule
   * of the same name changes the existing one (SwDoc::SetNumRule's lcl_ChgNumRule, which keeps
   * whether it is a list style).
   */
  SetCurNumRule(rRule: SwNumRule, bCreateNewList: boolean, rContinuedListId = '', bResetIndentAttrs = false): void {
    const old = this.m_pDoc.FindNumRulePtr(rRule.GetName());
    const r = rRule.Clone();
    if (old) r.SetAutoRule(old.IsAutoRule());
    this.m_pDoc.SetNumRule(this.m_pCursor, r, bCreateNewList, rContinuedListId, bResetIndentAttrs, true);
  }


  /** Applies a list style (`.uno:StyleApply` with FamilyName NumberingStyles). */
  SetCurNumRuleByName(name: string): void {
    const rule = this.m_pDoc.FindNumRulePtr(name);
    if (rule) this.m_pDoc.SetNumRule(this.m_pCursor, rule, false, '', true);
  }

  /** SwFEShell::SetBoxAlign: the vertical alignment of the selected cells' content. */
  SetBoxAlign(nAlign: 'top' | 'center' | 'bottom'): void {
    this.m_pDoc.SetBoxAttr(this.m_pCursor, (box) => { box.m_aAttrs = { ...box.m_aAttrs, vertOrient: nAlign === 'top' ? undefined : nAlign }; }, false, this.GetTableSelBoxes());
  }

  /**
   * SwDoc::SetTabBorders: the selected cells get the outer lines on the edges of the selection and
   * the inner ones between them; a line left undefined is not changed (SvxBoxInfoItem's valid
   * flags), null removes it. Without a cell selection the whole table (FN_TABLE_SELECT_ALL, as
   * ItemSetToTableParam does). The edges come from the model's rectangle rather than the layout's
   * cell frames, which is the same for a selection on one page.
   */
  SetTabBorders(b: { left?: SvxBorderLine | null; right?: SvxBorderLine | null; top?: SvxBorderLine | null; bottom?: SvxBorderLine | null; hori?: SvxBorderLine | null; vert?: SvxBorderLine | null }): boolean {
    const t = this.GetTableNode();
    if (!t) return false;
    const table = t.m_pTable;
    const boxes = this.IsTableMode() ? this.GetTableSelBoxes() : table.GetTabSortBoxes().filter((x) => x.getRowSpan() > 0);
    if (!boxes.length) return false;
    const pos = (x: SwTableBox) => {
      const line = table.GetLineIndex(x), left = lcl_Box2LeftBorder(x);
      return { top: line, bottom: line + Math.max(1, x.getRowSpan()) - 1, left, right: left + x.m_aAttrs.width };
    };
    const all = boxes.map(pos);
    const u = { top: Math.min(...all.map((p) => p.top)), bottom: Math.max(...all.map((p) => p.bottom)), left: Math.min(...all.map((p) => p.left)), right: Math.max(...all.map((p) => p.right)) };
    const near = (a: number, c: number) => Math.abs(a - c) <= Math.max(1e-6, Math.abs(c) / 1000);
    const sel = new Map(boxes.map((x, i) => [x, all[i]!]));
    return this.m_pDoc.SetBoxAttr(this.m_pCursor, (box) => {
      const p = sel.get(box);
      if (!p) return;
      const aBox = { ...box.m_aAttrs.box };
      const bTopOver = p.top <= u.top, bLeftOver = near(p.left, u.left) || p.left < u.left;
      const bRightOver = near(p.right, u.right) || p.right > u.right, bBottomOver = p.bottom >= u.bottom;
      // Top Border
      if (b.top !== undefined) {
        if (bTopOver) aBox.top = b.top;
        else if (b.hori !== undefined) aBox.top = null;
      }
      // Left Border
      if (bLeftOver) { if (b.left !== undefined) aBox.left = b.left; }
      else if (b.vert !== undefined) aBox.left = b.vert;
      // Right Border
      if (b.right !== undefined) {
        if (bRightOver) aBox.right = b.right;
        else if (b.vert !== undefined) aBox.right = null;
      }
      // Bottom Border
      if (bBottomOver) { if (b.bottom !== undefined) aBox.bottom = b.bottom; }
      else if (b.hori !== undefined) aBox.bottom = b.hori;
      box.m_aAttrs = { ...box.m_aAttrs, box: aBox };
    }, false, boxes);
  }

  /** SwFEShell::UpdateTableStyleFormatting: the style on the selected cells, or on the whole table. */
  SetTableStyle(rStyle: SwTableAutoFormat): boolean {
    const t = this.GetTableNode();
    if (!t) return false;
    const boxes = this.IsTableMode() ? this.GetTableSelBoxes() : t.m_pTable.GetTabSortBoxes();
    return this.m_pDoc.SetTableAutoFormat(this.m_pCursor, boxes, rStyle);
  }

  /** SwEditShell::TextToTable: the selected paragraphs become a table. */
  TextToTable(cCh: string, opts: { repeat: number; dontSplit: boolean; borders: boolean }): boolean { return !!this.m_pDoc.TextToTable(this.m_pCursor, cCh, opts); }
  /** SwEditShell::TableToText */
  TableToText(cCh: string): boolean { return this.m_pDoc.TableToText(this.m_pCursor, cCh); }
  /** SwEditShell::Sort for a table selection. */
  SortTable(rOpt: SwSortOptions): boolean { return SortTable(this.m_pDoc, this.m_pCursor, this.GetTableSelBoxes(), rOpt); }

  /**
   * SwDoc::SetTabLineStyle: the existing border lines of the selected cells get a colour and/or a
   * width (the toolbar's Border Color and Border Style).
   */
  SetTabLineStyle(o: { color?: string; width?: number }): boolean {
    return this.m_pDoc.SetBoxAttr(this.m_pCursor, (box) => {
      const b = { ...box.m_aAttrs.box };
      for (const k of ['left', 'top', 'right', 'bottom'] as const) {
        const l = b[k];
        if (l) b[k] = { color: o.color ?? l.color, width: o.width ?? l.width };
      }
      box.m_aAttrs = { ...box.m_aAttrs, box: b };
    }, false, this.GetTableSelBoxes());
  }

  /** SwFEShell::SetBoxBackground: the selected cells' background colour, or none. */
  SetBoxBackground(color: string | null): boolean {
    return this.m_pDoc.SetBoxAttr(this.m_pCursor, (box) => { box.m_aAttrs = { ...box.m_aAttrs, background: color }; }, false, this.GetTableSelBoxes());
  }
  GetBoxBackground(): string | null { return this.m_pDoc.GetTableBoxAt(this.pt.GetNode())?.box.m_aAttrs.background ?? null; }

  /** SwFEShell::GetBoxAlign: the cell's vertical alignment, or null outside a table. */
  GetBoxAlign(): 'top' | 'center' | 'bottom' | null {
    const b = this.m_pDoc.GetTableBoxAt(this.pt.GetNode());
    return b ? b.box.m_aAttrs.vertOrient ?? 'top' : null;
  }

  /** SwCursorShell::MoveCursorToNum: into the paragraph at `node`, in the column the cursor was in. */
  private MoveCursorToNum(node: SwTextNode): void {
    const x = this.m_nUpDownX ?? this.GetCharRect()?.Left();
    this.place(node, 0, false, true);
    const r = this.GetCharRect();
    if (!r || x === undefined) return;
    this.m_nUpDownX = x;
    const hit = this.m_pRoot.GetModelPositionForViewPoint(new Point(x, r.Top() + r.Height() / 2));
    if (hit.node === node) this.place(hit.node, hit.content, false, true);
  }

  /** SwCursorShell::GotoNextNum / GotoPrevNum: the next or previous list paragraph on this level. */
  GotoNextNum(): boolean { return this.gotoNum(true); }
  GotoPrevNum(): boolean { return this.gotoNum(false); }
  private gotoNum(bNext: boolean): boolean {
    const r = this.m_pDoc.GotoNextPrevNum(this.pt.GetNodeIndex(), bNext);
    const n = r && this.m_pDoc.GetNodes().node(r.idx);
    if (!n || !n.IsTextNode()) return false;
    this.MoveCursorToNum(n);
    return true;
  }

  /** SwEditShell::NoNum: Insert Unnumbered Entry. */
  NoNum(): void { this.m_nUpDownX = null; this.m_pDoc.NoNum(this.m_pCursor); }

  /** SwEditShell::MoveParagraph (Move Item Up and Down). */
  MoveParagraph(nOffset = 1): boolean { return this.m_pDoc.MoveParagraph(this.m_pCursor, nOffset); }

  /** SwEditShell::GetCurrentOutlineLevels: the levels of the list item and its sub-items. */
  GetCurrentOutlineLevels(): { nUpper: number; nLower: number } | null {
    const r = this.m_pDoc.GotoNextPrevNum(this.m_pCursor.End().GetNodeIndex(), true, false);
    return r && { nUpper: r.nUpper, nLower: r.nLower };
  }

  /**
   * SwEditShell::MoveNumParas: the selected list items with their sub-items moved up or down
   * past the neighbouring item (bUpperLower), or promoted or demoted together.
   */
  MoveNumParas(bUpperLower: boolean, bUpperLeft: boolean): boolean {
    const doc = this.m_pDoc, nodes = doc.GetNodes();
    const nMark = this.m_pCursor.Start().GetNodeIndex();
    let nPoint = this.m_pCursor.End().GetNodeIndex();
    const found = doc.GotoNextPrevNum(nPoint, true, false);
    if (!found) return false;
    const { nUpper: nUpperLevel, nLower: nLowerLevel } = found;
    nPoint = found.idx;
    const mark = nodes.node(nMark);
    if (!mark.IsTextNode()) return false;
    // The items and their sub-items: from the selection's start to before the next item.
    const range = (): SwPaM => {
      let last = nPoint - 1;
      while (last > nMark && !nodes.node(last).IsTextNode()) last--;
      const end = nodes.node(last);
      return new SwPaM(new SwPosition(end.IsTextNode() ? end : mark, 0), new SwPosition(mark, 0));
    };
    let bRet = false;
    if (bUpperLower) {
      // on top of the next numbering
      let nOffset = 0;
      if (bUpperLeft) { // move up
        const prev = doc.GotoNextPrevNum(nMark, false, false);
        if (prev) nOffset = prev.idx - nMark;
        else {
          let nIdx = nMark - 1;
          while (nIdx && (nodes.node(nIdx).IsSectionNode() || (nodes.node(nIdx).IsEndNode() && nodes.node(nIdx).StartOfSectionNode()!.IsSectionNode()))) --nIdx;
          if (nodes.node(nIdx).IsTextNode()) nOffset = nIdx - nMark;
        }
      } else { // move down
        const pt = nodes.node(nPoint);
        const pOrig = mark.GetAttr('RES_PARATR_NUMRULE');
        if (pt.IsTextNode() && pOrig === pt.GetAttr('RES_PARATR_NUMRULE')) {
          const nStt = nPoint;
          let nIdx = nStt + 1;
          while (nIdx < nodes.Count() - 1) {
            const pNd = nodes.node(nIdx);
            if (pNd.IsSectionNode() || (pNd.IsEndNode() && pNd.StartOfSectionNode()!.IsSectionNode())) ++nIdx;
            else if (pNd.IsTextNode() && pOrig === pNd.GetAttr('RES_PARATR_NUMRULE') && GetActualListLevel(pNd) > nUpperLevel) ++nIdx;
            else break; // #i57856#
          }
          nOffset = nStt === nIdx || !nodes.node(nIdx).IsTextNode() ? 1 : nIdx - nStt;
        } else nOffset = 1;
      }
      if (nOffset) {
        const pam = range();
        bRet = doc.MoveParagraph(pam, nOffset);
        pam.Release();
      }
    } else if ((bUpperLeft ? nUpperLevel : nLowerLevel + 1) < MAXLEVEL) {
      const pam = range();
      bRet = doc.NumUpDown(pam, !bUpperLeft);
      pam.Release();
    }
    return bRet;
  }

  /** FN_NUM_CONTINUE (Add to List): joins the paragraphs to the previous list of their kind. */
  ContinueNumbering(): void {
    const node = this.m_pCursor.Start().GetNode();
    const found = this.m_pDoc.SearchNumRule(node, true, -1) ?? this.m_pDoc.SearchNumRule(node, false, -1);
    if (!found) return;
    const before = this.m_pDoc.m_aUndo.length;
    // When merging with a different list, also helpfully remove any restart-numbering.
    const nodes = this.m_pDoc.GetNodes();
    for (let i = this.m_pCursor.Start().GetNodeIndex(); i <= this.m_pCursor.End().GetNodeIndex(); i++) {
      const n = nodes.node(i);
      if (!n.IsTextNode() || !n.GetAttr('RES_PARATR_LIST_ISRESTART') || n.GetAttr('RES_PARATR_NUMRULE') === found.rule.GetName()) continue;
      const pam = new SwPaM(new SwPosition(n, 0));
      this.m_pDoc.SetNumRuleStart(pam, false);
      pam.Release();
    }
    this.m_pDoc.SetNumRule(this.m_pCursor, found.rule, false, found.listId, false);
    while (this.m_pDoc.m_aUndo.length > before + 1) this.m_pDoc.MergeLastUndo();
  }

  /** Whether Add to List finds a list to continue (SwTextShell::GetState for FN_NUM_CONTINUE). */
  CanContinueNumbering(): boolean {
    const node = this.m_pCursor.Start().GetNode();
    return !!(this.m_pDoc.SearchNumRule(node, true, -1) ?? this.m_pDoc.SearchNumRule(node, false, -1));
  }

  NumUpDown(bDown = true): boolean { return this.m_pDoc.NumUpDown(this.m_pCursor, bDown); }
  DelNumRules(): void { this.m_pDoc.DelNumRules(this.m_pCursor); }
  NumOrNoNum(bCounted: boolean): boolean { return this.m_pDoc.NumOrNoNum(this.m_pCursor, bCounted); }
  IsNoNum(): boolean { return !!this.GetNumRuleAtCurrCursorPos() && !this.pt.GetNode().GetAttr('RES_PARATR_LIST_ISCOUNTED'); }
  IsSttPara(): boolean { return this.pt.GetContentIndex() === 0; }
  IsEndPara(): boolean { return this.pt.GetContentIndex() === this.pt.GetNode().Len(); }
  GetNumLevel(): number { return GetActualListLevel(this.pt.GetNode()); }
  IsNumRuleStart(): boolean { return this.pt.GetNode().GetAttr('RES_PARATR_LIST_ISRESTART'); }
  SetNumRuleStart(b: boolean): void { this.m_pDoc.SetNumRuleStart(this.m_pCursor, b); }

  // --- find ---
  /** Finds from the cursor, wrapping once. Returns whether a match was selected. */
  Find(needle: string, opts: { matchCase: boolean; backward: boolean }): boolean {
    if (!needle) return false;
    const nodes = this.m_pDoc.GetNodes();
    const norm = (s: string) => (opts.matchCase ? s : s.toLowerCase());
    const q = norm(needle);
    const paras: SwTextNode[] = [];
    for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) paras.push(n);
    const s = this.m_pCursor.Start(), e = this.m_pCursor.End();
    const count = paras.length;
    const startIdx = paras.indexOf((opts.backward ? s : e).GetNode());
    for (let k = 0; k <= count; k++) {
      const i = opts.backward ? (startIdx - k + count * 2) % count : (startIdx + k) % count;
      const para = paras[i]!, t = norm(para.GetText());
      let at: number;
      if (opts.backward) {
        const from = k === 0 ? s.GetContentIndex() - q.length : t.length;
        at = from < 0 ? -1 : t.lastIndexOf(q, from);
      } else at = t.indexOf(q, k === 0 ? e.GetContentIndex() : 0);
      if (at >= 0) { this.SelectRange(para, at, at + q.length); return true; }
    }
    return false;
  }

  /** Replaces every match, as one undo step per replacement. Returns the count. */
  ReplaceAll(needle: string, replacement: string, matchCase: boolean): number {
    if (!needle) return 0;
    const nodes = this.m_pDoc.GetNodes();
    const q = matchCase ? needle : needle.toLowerCase();
    let count = 0;
    for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) {
      let from = 0;
      for (;;) {
        const t = matchCase ? n.GetText() : n.GetText().toLowerCase();
        const at = t.indexOf(q, from);
        if (at < 0) break;
        this.SelectRange(n, at, at + needle.length);
        this.m_pDoc.InsertString(this.m_pCursor, replacement);
        from = at + replacement.length;
        count++;
      }
    }
    return count;
  }

  GetWordCount(): { words: number; chars: number } {
    const nodes = this.m_pDoc.GetNodes();
    let w = 0, c = 0;
    for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) {
      for (const s of words.segment(n.GetText())) if (s.isWordLike) w++;
      c += [...graphemes.segment(n.GetText())].length;
    }
    return { words: w, chars: c };
  }

  /** The reference device the layout measures with (SwViewShell::GetRefDev). */
  GetTextMeasurer(): TextMeasurer { return this.m; }

  /** SwCursorShell::GetPageCnt */
  GetPageCnt(): number { return this.m_pRoot.pages.length; }

  /**
   * SwCursorShell::GotoPage (SwRootFrame::SetCurrPage): the cursor to the first content of page
   * `nPage` (1-based), or of the last page beyond the end. False if the page has no body text.
   */
  GotoPage(nPage: number): boolean {
    const pages = this.m_pRoot.pages;
    const page = pages[Math.max(0, Math.min(nPage, pages.length) - 1)];
    const f = page?.frames.find((fr) => !fr.pArea);
    if (!f) return false;
    this.place(f.node, f.lines[0]?.nStart ?? 0, false);
    return true;
  }

  /** SwWrtShell::SttNxtPg (MovePage(GetNextFrame, GetFirstSub)): to the start of the next page. */
  SttNxtPg(): boolean {
    const n = this.GetPageNumber();
    return n < this.GetPageCnt() && this.GotoPage(n + 1);
  }

  /** SwCursorShell::Push: a copy of the cursor that follows the edits made meanwhile. */
  SaveCursor(): SwPaM {
    const p = this.m_pCursor.GetPoint(), m = this.m_pCursor.GetMark();
    return new SwPaM(new SwPosition(p.GetNode(), p.GetContentIndex()), new SwPosition(m.GetNode(), m.GetContentIndex()));
  }

  /** SwCursorShell::Pop(PopMode::DeleteCurrent): back to the saved cursor. */
  RestoreCursor(saved: SwPaM): void {
    const p = saved.GetPoint(), m = saved.GetMark();
    // An undone or rebuilt node is no longer in the document; the cursor then stays where it is.
    if (this.m_pDoc.GetNodes().node(p.GetNodeIndex()) === p.GetNode() && this.m_pDoc.GetNodes().node(m.GetNodeIndex()) === m.GetNode()) {
      this.m_pCursor.GetMark().Assign(m.GetNode(), Math.min(m.GetContentIndex(), m.GetNode().Len()));
      this.place(p.GetNode(), Math.min(p.GetContentIndex(), p.GetNode().Len()), true);
    }
    saved.Release();
  }

  /** SwWrtShell::StartUndo / EndUndo: the steps in between become one. */
  StartUndo(): number { return this.m_pDoc.m_aUndo.length; }
  EndUndo(before: number): void { while (this.m_pDoc.m_aUndo.length > before + 1) this.m_pDoc.MergeLastUndo(); }

  /** The caret's page number, 1-based. */
  GetPageNumber(): number {
    const hit = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex());
    return (hit?.page.nIndex ?? 0) + 1;
  }

  /** The page number shown on the cursor's page (SwFrame::GetVirtPageNum). */
  GetVirtPageNum(): number { return this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex())?.page.nVirtNum ?? 1; }

  /** Line rectangles covering the current selection, in document coordinates. */
  GetSelectionRects(): { x: number; y: number; w: number; h: number }[] {
    if (!this.HasSelection()) return [];
    if (this.IsTableMode()) {
      // SwShellTableCursor: the selected cells, whole.
      const sel = new Set(this.GetTableSelBoxes());
      const out: { x: number; y: number; w: number; h: number }[] = [];
      const walk = (tabs: SwTabFrame[]) => { for (const t of tabs) for (const r of t.rows) for (const c of r.cells) { if (sel.has(c.box)) out.push({ x: c.aFrame.Left(), y: c.aFrame.Top(), w: c.aFrame.Width(), h: c.aFrame.Height() }); walk(c.tabs); } };
      for (const page of this.m_pRoot.pages) walk(page.tabs);
      return out;
    }
    const s = this.m_pCursor.Start(), e = this.m_pCursor.End();
    const first = s.GetNodeIndex(), last = e.GetNodeIndex();
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const page of this.m_pRoot.pages) {
      for (const frame of page.frames) {
        const idx = frame.node.GetIndex();
        if (idx < first || idx > last) continue;
        const text = frame.node.GetText();
        let top = frame.nTop;
        for (const line of frame.lines) {
          const lineEnd = line.nStart + line.nLen;
          const a = idx === first ? Math.max(s.GetContentIndex(), line.nStart) : line.nStart;
          const b = idx === last ? Math.min(e.GetContentIndex(), lineEnd) : lineEnd;
          const startsInside = idx !== first || s.GetContentIndex() < lineEnd || line.nLen === 0 || lineEnd === text.length;
          if (a <= b && startsInside && (idx !== last || e.GetContentIndex() >= line.nStart)) {
            const pieces = LineRangeX(text, line, a, b, this.m);
            // Selected paragraph ends show a small mark so empty lines are visible in the selection.
            if (idx !== last && lineEnd === text.length) {
              const endX = LineXAt(text, line, lineEnd, this.m);
              if (pieces.length === 1 && !line.bBidi) pieces[0]![1] += 120; else pieces.push([endX, endX + 120]);
            }
            for (const [x0, x1] of pieces) if (x1 > x0) out.push({ x: frame.nLeft + line.nX + x0, y: top, w: x1 - x0, h: line.nRealHeight });
          }
          top += line.nRealHeight;
        }
      }
    }
    return out;
  }
}
