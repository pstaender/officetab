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
import type { TransliterationFlags } from '../../../../i18npool/source/transliteration/transliteration_body.ts';
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwDoc, SwPosition } from '../../../inc/doc.ts';
import { SwPaM } from '../../../inc/pam.ts';
import { SwRootFrame } from '../../core/layout/pagechg.ts';
import { LineRangeX, LineXAt } from '../../core/text/itrform2.ts';
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
import type { SwTableBox } from '../../../inc/swtable.ts';
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
  Insert(text: string): void {
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

  SplitNode(): void { this.m_nUpDownX = null; this.m_aPending = {}; this.m_pDoc.SplitNode(this.m_pCursor); }
  InsertLineBreak(): void { this.Insert('\n'); }

  DelLeft(): void {
    if (this.HasSelection()) { this.DelSelection(); return; }
    // With changes recorded, deleted text before the cursor is stepped over, not deleted again.
    if (this.IsRedlineOn()) while (this.deletedBefore()) this.Left(false);
    this.Left(true);
    if (this.crossesSection()) { this.m_pCursor.GetPoint().Assign(this.m_pCursor.GetMark().GetNode(), this.m_pCursor.GetMark().GetContentIndex()); return; }
    this.DelSelection();
  }

  DelRight(): void {
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

  InsertRow(bBehind: boolean): boolean { return this.m_pDoc.InsertRow(this.m_pCursor, bBehind); }
  InsertCol(bBehind: boolean): boolean { return this.m_pDoc.InsertCol(this.m_pCursor, bBehind); }
  DeleteRow(): boolean { return this.m_pDoc.DeleteRow(this.m_pCursor); }
  DeleteCol(): boolean { return this.m_pDoc.DeleteCol(this.m_pCursor); }
  DeleteTable(): boolean { return this.m_pDoc.DeleteTable(this.m_pCursor); }

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

  DelSelection(): void { this.m_nUpDownX = null; this.m_aPending = {}; this.m_pDoc.DeleteAndJoin(this.m_pCursor); }

  Undo(): void { this.m_aPending = {}; this.m_pDoc.Undo(this.m_pCursor); }
  Redo(): void { this.m_aPending = {}; this.m_pDoc.Redo(this.m_pCursor); }

  GetSelText(): string {
    if (!this.HasSelection()) return '';
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
    if (this.HasSelection()) this.m_pDoc.InsertAttr(this.m_pCursor, attrs);
    else { this.m_aPending = { ...this.m_aPending, ...attrs }; this.m_pDoc.Changed(); }
  }

  SetParaAttr(attrs: SwAttrSet): void { this.m_pDoc.SetParaAttr(this.m_pCursor, attrs); }

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
    if (this.HasSelection()) this.m_pDoc.ResetAttrs(this.m_pCursor);
    else this.m_pDoc.Changed();
  }

  SetTextFormatColl(name: string): void {
    const coll = this.m_pDoc.FindTextFormatCollByName(name);
    if (coll) this.m_pDoc.SetTextFormatColl(this.m_pCursor, coll);
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

  /** Applies a list style (`.uno:StyleApply` with FamilyName NumberingStyles). */
  SetCurNumRuleByName(name: string): void {
    const rule = this.m_pDoc.FindNumRulePtr(name);
    if (rule) this.m_pDoc.SetNumRule(this.m_pCursor, rule, false, '', true);
  }

  /** SwFEShell::SetBoxAlign: the vertical alignment of the selected cells' content. */
  SetBoxAlign(nAlign: 'top' | 'center' | 'bottom'): void {
    this.m_pDoc.SetBoxAttr(this.m_pCursor, (box) => { box.m_aAttrs = { ...box.m_aAttrs, vertOrient: nAlign === 'top' ? undefined : nAlign }; });
  }

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
