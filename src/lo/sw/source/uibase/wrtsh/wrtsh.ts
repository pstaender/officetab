// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/wrtsh/wrtsh1.cxx reduced
// @upstream sw/source/uibase/wrtsh/move.cxx reduced
// @upstream sw/source/uibase/wrtsh/delete.cxx reduced
// @upstream sw/source/core/crsr/crsrsh.cxx reduced
// @upstream sw/source/core/crsr/swcrsr.cxx reduced
// @upstream sw/source/core/edit/edattr.cxx reduced
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwDoc, SwPosition } from '../../../inc/doc.ts';
import { SwPaM } from '../../../inc/pam.ts';
import { SwRootFrame } from '../../core/layout/pagechg.ts';
import { LineXAt } from '../../core/text/itrform2.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { MAXLEVEL, SwNumRule, numfunc } from '../../../inc/numrule.ts';
import { GetActualListLevel } from '../../core/doc/list.ts';
import type { SwAttrs, SwAttrSet, SwCharAttrSet } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
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
    else { const p = this.m_pDoc.GetNodes().GoPrevious(n.GetIndex()); if (p) this.place(p, p.Len(), extend); }
  }

  Right(extend = false): void {
    const c = this.m_pCursor;
    if (!extend && c.HasMark()) { const e = c.End(); this.place(e.GetNode(), e.GetContentIndex(), false); return; }
    const n = this.pt.GetNode(), i = this.pt.GetContentIndex();
    if (i < n.Len()) this.place(n, nextGrapheme(n.GetText(), i), extend);
    else { const p = this.m_pDoc.GetNodes().GoNext(n.GetIndex()); if (p) this.place(p, 0, extend); }
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
    const y = distance !== undefined
      ? r.Top() + dir * distance
      : dir < 0 ? r.Top() - 1 : r.Top() + r.Height() + this.lineGapBelow();
    const hit = this.m_pRoot.GetModelPositionForViewPoint(new Point(this.m_nUpDownX, y));
    this.place(hit.node, hit.content, extend, true);
  }

  /** Vertical distance from the caret bottom into the next line, across spacing and page gaps. */
  private lineGapBelow(): number {
    const cur = this.m_pRoot.FindLine(this.pt.GetNode(), this.pt.GetContentIndex());
    if (!cur) return 1;
    const { frame, line, top, page } = cur;
    const lineBottom = top + line.nRealHeight;
    if (frame.lines[frame.lines.length - 1] !== line) return 1;
    const i = page.frames.indexOf(frame);
    const next = page.frames[i + 1];
    if (next) return next.nTop - lineBottom + 1;
    const nextPage = this.m_pRoot.pages[page.nIndex + 1];
    return nextPage?.frames[0] ? nextPage.frames[0].nTop - lineBottom + 1 : 1;
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

  SttDoc(extend = false): void { this.place(this.m_pDoc.GetNodes().FirstTextNode(), 0, extend); }
  EndDoc(extend = false): void { const n = this.m_pDoc.GetNodes().LastTextNode(); this.place(n, n.Len(), extend); }

  SetCursor(pt: Point, extend = false): void {
    const hit = this.m_pRoot.GetModelPositionForViewPoint(pt);
    this.place(hit.node, hit.content, extend);
  }

  SelAll(): void {
    const nodes = this.m_pDoc.GetNodes();
    this.m_pCursor.GetMark().Assign(nodes.FirstTextNode(), 0);
    const last = nodes.LastTextNode();
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
    this.DelSelection();
  }

  DelRight(): void {
    if (this.HasSelection()) { this.DelSelection(); return; }
    this.Right(true);
    this.DelSelection();
  }

  DelPrevWord(): void { if (!this.HasSelection()) this.PrevWord(true); this.DelSelection(); }
  DelNextWord(): void { if (!this.HasSelection()) this.NextWord(true); this.DelSelection(); }

  DelSelection(): void { this.m_nUpDownX = null; this.m_aPending = {}; this.m_pDoc.DeleteAndJoin(this.m_pCursor); }

  Undo(): void { this.m_aPending = {}; this.m_pDoc.Undo(this.m_pCursor); }
  Redo(): void { this.m_aPending = {}; this.m_pDoc.Redo(this.m_pCursor); }

  GetSelText(): string {
    if (!this.HasSelection()) return '';
    const s = this.m_pCursor.Start(), e = this.m_pCursor.End();
    if (s.GetNode() === e.GetNode()) return s.GetNode().GetText().slice(s.GetContentIndex(), e.GetContentIndex());
    const out = [s.GetNode().GetText().slice(s.GetContentIndex())];
    const nodes = this.m_pDoc.GetNodes();
    for (let n = nodes.GoNext(s.GetNodeIndex()); n && n !== e.GetNode(); n = nodes.GoNext(n.GetIndex())) out.push(n.GetText());
    out.push(e.GetNode().GetText().slice(0, e.GetContentIndex()));
    return out.join('\n');
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
