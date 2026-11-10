// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/wrtsh/wrtsh1.cxx reduced
// @upstream sw/source/uibase/wrtsh/move.cxx reduced
// @upstream sw/source/uibase/wrtsh/delete.cxx reduced
// @upstream sw/source/core/crsr/crsrsh.cxx reduced
// @upstream sw/source/core/crsr/swcrsr.cxx reduced
// @upstream sw/source/core/edit/edattr.cxx reduced
// @upstream sw/source/core/frmedt/fetab.cxx reduced
// @upstream sw/source/core/edit/edtab.cxx reduced
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwDoc, SwPosition } from '../../../inc/doc.ts';
import { SwPaM } from '../../../inc/pam.ts';
import { SwRootFrame } from '../../core/layout/pagechg.ts';
import { LineXAt } from '../../core/text/itrform2.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { MAXLEVEL, SwNumRule, numfunc } from '../../../inc/numrule.ts';
import { GetActualListLevel } from '../../core/doc/list.ts';
import { CH_TXTATR_BREAKWORD, type SwAttrs, type SwAttrSet, type SwCharAttrSet, type SwField, type SwFlyCnt, type SwPostItField } from '../../../inc/hintids.ts';
import { SwStartNodeType } from '../../../inc/ndtyp.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwTableBox } from '../../../inc/swtable.ts';
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
      target = this.m_pRoot.NextLinePoint(this.m_nUpDownX, lineTop, lineBottom, dir, cur?.frame.pArea ?? 'body', cur?.page);
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
    this.Left(true);
    if (this.crossesSection()) { this.m_pCursor.GetPoint().Assign(this.m_pCursor.GetMark().GetNode(), this.m_pCursor.GetMark().GetContentIndex()); return; }
    this.DelSelection();
  }

  DelRight(): void {
    if (this.HasSelection()) { this.DelSelection(); return; }
    this.Right(true);
    if (this.crossesSection()) { this.m_pCursor.GetPoint().Assign(this.m_pCursor.GetMark().GetNode(), this.m_pCursor.GetMark().GetContentIndex()); return; }
    this.DelSelection();
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
  InsertGraphic(data: Uint8Array, mime: string, size: { width: number; height: number }): void {
    this.m_nUpDownX = null;
    const doc = this.m_pDoc, pd = doc.m_aPageDesc;
    const frame = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex())?.frame;
    const maxW = frame?.nWidth ?? pd.PrintWidth(), maxH = pd.PrintHeight();
    const scale = Math.min(1, maxW / size.width, maxH / size.height);
    const fly: SwFlyCnt = { graphic: doc.AddGraphic(data, mime), width: Math.round(size.width * scale), height: Math.round(size.height * scale), name: doc.GetUniqueGrfName() };
    doc.InsertGraphic(this.m_pCursor, fly);
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
  InsertFootnote(): void {
    this.m_nUpDownX = null;
    this.m_aPending = {};
    const id = this.m_pDoc.InsertFootnote(this.m_pCursor);
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
  IsHeaderOn(bHeader: boolean): boolean {
    return !!this.m_pDoc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode);
  }

  /** SwWrtShell::ChangeHeaderOrFooter for the default page style; turning one on moves the cursor into it. */
  ChangeHeaderOrFooter(bHeader: boolean, bOn: boolean, bGoto = true): void {
    const wasOn = this.IsHeaderOn(bHeader);
    this.m_pDoc.SetHeaderFooter(this.m_pCursor, bHeader, bOn);
    if (bOn && !wasOn && bGoto) this.GotoHeaderFooter(bHeader);
  }

  /** FN_TO_HEADER / FN_TO_FOOTER: into the header or footer, on the caret's page. */
  GotoHeaderFooter(bHeader: boolean): boolean {
    const page = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex())?.page;
    const s = this.m_pDoc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode);
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
            const x0 = LineXAt(text, line, a, this.m);
            let x1 = LineXAt(text, line, b, this.m);
            // Selected paragraph ends show a small mark so empty lines are visible in the selection.
            if (idx !== last && lineEnd === text.length) x1 += 120;
            if (x1 > x0) out.push({ x: frame.nLeft + line.nX + x0, y: top, w: x1 - x0, h: line.nRealHeight });
          }
          top += line.nRealHeight;
        }
      }
    }
    return out;
  }
}
