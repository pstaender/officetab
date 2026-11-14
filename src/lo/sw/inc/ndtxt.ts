// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/ndtxt.hxx reduced
// @upstream sw/source/core/txtnode/ndtxt.cxx reduced
// @upstream sw/source/core/txtnode/thints.cxx reduced
// @upstream sw/inc/txatbase.hxx reduced
// @upstream sw/source/core/txtnode/txtedt.cxx partial
// JS strings are UTF-16 like OUString, so content offsets carry over unchanged.
// Hints are kept as sorted, non-overlapping runs: the form RES_TXTATR_AUTOFMT reaches after BuildPortions.
import { SwContentNode } from './node.ts';
import { SwNodeType } from './ndtyp.ts';
import { CHAR_KEYS, type SwAttrs, type SwAttrSet, type SwCharAttrSet, type SwRedlineData } from './hintids.ts';
import type { SwNodes } from './ndarr.ts';
import { transliterate, TransliterationFlags } from '../../i18npool/source/transliteration/transliteration_body.ts';
import type { SwTextFormatColl } from './format.ts';
import type { SwPosition } from './pam.ts';
import { RndStdIds, type SwAnchoredFly } from './frmfmt.ts';

export interface SwTextAttr { nStart: number; nEnd: number; aAttrs: SwCharAttrSet }

/** SwRedlineData::CanCombine: same type and author, made within the same minute. */
export const SameRedline = (a: SwRedlineData | null | undefined, b: SwRedlineData | null | undefined): boolean =>
  a === b || (!!a && !!b && a.type === b.type && a.author === b.author && Math.abs(Date.parse(a.date) - Date.parse(b.date)) < 60000);

/** The same index marks (by identity), in the same order. */
const SameMarks = (a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((m, i) => m === b[i]);

const sameAttrs = (a: SwCharAttrSet, b: SwCharAttrSet): boolean => {
  const ka = Object.keys(a) as (keyof SwCharAttrSet)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k] || (k === 'RES_TXTATR_REDLINE' && SameRedline(a[k], b[k])) || (k === 'RES_TXTATR_TOXMARK' && SameMarks(a[k], b[k])));
};

export class SwTextNode extends SwContentNode {
  m_Text = '';
  m_aHints: SwTextAttr[] = [];
  m_pColl: SwTextFormatColl;
  /** Direct paragraph formatting. */
  m_aSet: SwAttrSet = {};
  m_aIndices = new Set<SwPosition>();
  /**
   * Paragraph and character anchored flys of this paragraph (SwNode::m_aAnchoredFlys); a
   * character anchor's offset moves with the text like an SwPosition.
   */
  m_aAnchoredFlys: SwAnchoredFly[] = [];
  /** SwTextNode::SetAutoFormatLvl: the tab count AutoFormat stores between two runs while typing. */
  m_nAutoFormatLvl?: number;
  /** Bumped on each change; the layout uses it to invalidate cached lines. */
  m_nVersion = 0;

  constructor(nodes: SwNodes, coll: SwTextFormatColl, text = '') {
    super(nodes, SwNodeType.Text);
    this.m_pColl = coll;
    this.m_Text = text;
  }

  GetText(): string { return this.m_Text; }
  Len(): number { return this.m_Text.length; }
  GetTextColl(): SwTextFormatColl { return this.m_pColl; }

  GetAttr<K extends keyof SwAttrs>(which: K): SwAttrs[K] {
    const v = this.m_aSet[which];
    return v !== undefined ? (v as SwAttrs[K]) : this.m_pColl.GetFormatAttr(which);
  }

  /** Attribute value at a character position: hint first, then its character style, then paragraph and style chain. */
  GetCharAttrAt<K extends keyof SwAttrs>(which: K, pos: number): SwAttrs[K] {
    if (CHAR_KEYS.has(which)) {
      const hint = this.m_aHints.find((h) => h.nStart <= pos && pos < h.nEnd);
      const v = hint?.aAttrs[which as keyof SwCharAttrSet];
      if (v !== undefined) return v as SwAttrs[K];
      const cf = hint?.aAttrs.RES_TXTATR_CHARFMT?.GetFormatAttrIfSet(which);
      if (cf !== undefined) return cf;
    }
    return this.GetAttr(which);
  }

  private touch(): void { this.m_nVersion++; }

  InsertText(str: string, pos: number): void {
    const len = str.length;
    if (!len) return;
    // SwTextTOXMark is not an expanding hint (SetDontExpand): text typed at a mark's edge stays
    // outside it, text typed inside it belongs to it.
    const marksBefore = pos > 0 ? this.GetCharAttrAt('RES_TXTATR_TOXMARK', pos - 1) : null;
    const marksAfter = pos < this.m_Text.length ? this.GetCharAttrAt('RES_TXTATR_TOXMARK', pos) : null;
    const keepMarks = marksBefore?.filter((m) => marksAfter?.includes(m)) ?? [];
    this.m_Text = this.m_Text.slice(0, pos) + str + this.m_Text.slice(pos);
    // SwTextNode::Update: hints at or after the position shift, a hint ending there expands.
    let endsLink = false;
    for (const h of this.m_aHints) {
      if (h.nStart >= pos) { h.nStart += len; h.nEnd += len; }
      else if (h.nEnd >= pos) { if (h.nEnd === pos && (h.aAttrs.RES_TXTATR_INETFMT || h.aAttrs.RES_TXTATR_FIELD || h.aAttrs.RES_TXTATR_FLYCNT || h.aAttrs.RES_TXTATR_FTN || h.aAttrs.RES_TXTATR_ANNOTATION || h.aAttrs.RES_TXTATR_ANNOTMARK || h.aAttrs.RES_TXTATR_REDLINE)) endsLink = true; h.nEnd += len; }
    }
    // SwTextNode::InsertText: "no field, at paragraph start, HintExpand".
    if (pos === 0) for (const h of this.m_aHints) if (h.nStart === len && !h.aAttrs.RES_TXTATR_FIELD && !h.aAttrs.RES_TXTATR_FLYCNT && !h.aAttrs.RES_TXTATR_FTN && !h.aAttrs.RES_TXTATR_ANNOTATION) h.nStart = 0;
    for (const i of this.m_aIndices) if (i.m_nContent >= pos) i.m_nContent += len;
    for (const f of this.m_aAnchoredFlys) if (f.nContent >= pos && f.nContent > 0) f.nContent += len;
    // Hyperlinks and fields do not grow when typing at their end (they are not expanding hints).
    if (endsLink) this.ResetAttr(pos, pos + len, ['RES_TXTATR_INETFMT', 'RES_TXTATR_FIELD', 'RES_TXTATR_FLYCNT', 'RES_TXTATR_FTN', 'RES_TXTATR_ANNOTATION', 'RES_TXTATR_ANNOTMARK', 'RES_TXTATR_REDLINE']);
    if ((marksBefore || marksAfter) && (marksBefore?.length !== keepMarks.length || marksAfter?.length !== keepMarks.length)) {
      if (keepMarks.length) this.SetAttr(pos, pos + len, { RES_TXTATR_TOXMARK: keepMarks });
      else this.ResetAttr(pos, pos + len, ['RES_TXTATR_TOXMARK']);
    }
    this.touch();
  }

  EraseText(pos: number, count: number): void {
    if (!count) return;
    const end = pos + count;
    this.m_Text = this.m_Text.slice(0, pos) + this.m_Text.slice(end);
    const adjust = (n: number) => (n <= pos ? n : n >= end ? n - count : pos);
    for (const h of this.m_aHints) { h.nStart = adjust(h.nStart); h.nEnd = adjust(h.nEnd); }
    this.m_aHints = this.m_aHints.filter((h) => h.nEnd > h.nStart);
    for (const i of this.m_aIndices) i.m_nContent = adjust(i.m_nContent);
    // sw::IsDestroyFrameAnchoredAtChar: a character anchor inside the deleted text goes with it; one
    // at either edge only when the whole paragraph text is deleted.
    const whole = pos === 0 && end === this.m_Text.length + count;
    this.m_aAnchoredFlys = this.m_aAnchoredFlys.filter((f) => f.fmt.m_aAnchor.m_eAnchorId !== RndStdIds.FLY_AT_CHAR || !((f.nContent > pos && f.nContent < end) || (whole && (f.nContent === pos || f.nContent === end))));
    for (const f of this.m_aAnchoredFlys) f.nContent = adjust(f.nContent);
    this.MergePortions();
    this.touch();
  }

  /**
   * SwTextNode::ReplaceTextOnly, reduced: replaces [pos, pos + len) keeping the attributes. The
   * characters both texts share are replaced in place; extra characters continue the attributes of
   * the last replaced one, missing ones are erased (upstream maps each one through offsets).
   */
  ReplaceTextOnly(pos: number, len: number, text: string): void {
    const common = Math.min(len, text.length);
    this.m_Text = this.m_Text.slice(0, pos) + text.slice(0, common) + this.m_Text.slice(pos + common);
    if (text.length > len) this.InsertText(text.slice(common), pos + common);
    else if (text.length < len) this.EraseText(pos + common, len - common);
    this.touch();
  }

  /**
   * SwTextNode::TransliterateText, reduced: the changes a transliteration makes in [nStt, nEnd),
   * from the end to the start so that earlier offsets stay valid. Title case goes word by word,
   * sentence case sentence by sentence (the platform's word and sentence segmentation standing in
   * for the break iterator); the others take the range at once.
   */
  TransliterateText(mode: TransliterationFlags, nStt: number, nEnd: number, bApply = true): { nStart: number; nLen: number; sChanged: string }[] {
    if (nStt >= nEnd) return [];
    const text = this.m_Text;
    const lang = (i: number) => { const l = this.GetCharAttrAt('RES_CHRATR_LANGUAGE', Math.min(i, Math.max(0, text.length - 1))); return l === 'zxx' ? 'en' : l; };
    const aChanges: { nStart: number; nLen: number; sChanged: string }[] = [];
    const change = (start: number, end: number) => {
      if (end <= start) return;
      const sChgd = transliterate(mode, text.slice(start, end), lang(start));
      if (sChgd !== text.slice(start, end)) aChanges.push({ nStart: start, nLen: end - start, sChanged: sChgd });
    };
    if (mode === TransliterationFlags.TITLE_CASE) {
      // Each word (ANYWORD_IGNOREWHITESPACES) that the range touches, from the range's start on.
      for (const w of new Intl.Segmenter(lang(nStt), { granularity: 'word' }).segment(text)) {
        const ws = w.index, we = ws + w.segment.length;
        if (we <= nStt || ws >= nEnd || !w.segment.trim()) continue;
        change(Math.max(ws, nStt), we);
      }
    } else if (mode === TransliterationFlags.SENTENCE_CASE) {
      for (const sn of new Intl.Segmenter(lang(nStt), { granularity: 'sentence' }).segment(text)) {
        const ss = sn.index, se = ss + sn.segment.trimEnd().length;
        if (se <= nStt || ss >= nEnd) continue;
        // The sentence's text from the first non-blank character, within the range.
        let start = Math.max(ss, nStt);
        while (start < se && /\s/.test(text[start]!)) start++;
        change(start, Math.min(se, nEnd));
      }
    } else change(nStt, nEnd);
    aChanges.reverse();
    if (bApply) for (const c of aChanges) this.ReplaceTextOnly(c.nStart, c.nLen, c.sChanged);
    return aChanges;
  }

  /** Applies character attributes on [start, end), splitting runs (SwpHints::BuildPortions). */
  SetAttr(start: number, end: number, attrs: SwCharAttrSet): void {
    if (start >= end) return;
    const out: SwTextAttr[] = [];
    let cursor = start;
    for (const h of this.m_aHints) {
      if (h.nEnd <= start || h.nStart >= end) { out.push(h); continue; }
      if (h.nStart < start) out.push({ nStart: h.nStart, nEnd: start, aAttrs: { ...h.aAttrs } });
      const s = Math.max(h.nStart, start), e = Math.min(h.nEnd, end);
      if (s > cursor) out.push({ nStart: cursor, nEnd: s, aAttrs: { ...attrs } });
      out.push({ nStart: s, nEnd: e, aAttrs: { ...h.aAttrs, ...attrs } });
      cursor = e;
      if (h.nEnd > end) out.push({ nStart: end, nEnd: h.nEnd, aAttrs: { ...h.aAttrs } });
    }
    if (cursor < end) out.push({ nStart: cursor, nEnd: end, aAttrs: { ...attrs } });
    out.sort((a, b) => a.nStart - b.nStart);
    this.m_aHints = out;
    this.MergePortions();
    this.touch();
  }

  /** Removes the given attribute keys on [start, end); with no keys, all automatic (RES_CHRATR_*) ones. */
  ResetAttr(start: number, end: number, keys?: (keyof SwCharAttrSet)[]): void {
    const out: SwTextAttr[] = [];
    for (const h of this.m_aHints) {
      if (h.nEnd <= start || h.nStart >= end) { out.push(h); continue; }
      if (h.nStart < start) out.push({ nStart: h.nStart, nEnd: start, aAttrs: { ...h.aAttrs } });
      const rest: SwCharAttrSet = { ...h.aAttrs };
      // Without keys, only automatic formatting goes: text attributes such as hyperlinks stay.
      for (const k of keys ?? (Object.keys(rest) as (keyof SwCharAttrSet)[]).filter((x) => !x.startsWith('RES_TXTATR_'))) delete rest[k];
      if (Object.keys(rest).length) out.push({ nStart: Math.max(h.nStart, start), nEnd: Math.min(h.nEnd, end), aAttrs: rest });
      if (h.nEnd > end) out.push({ nStart: end, nEnd: h.nEnd, aAttrs: { ...h.aAttrs } });
    }
    this.m_aHints = out;
    this.MergePortions();
    this.touch();
  }

  MergePortions(): void {
    const out: SwTextAttr[] = [];
    for (const h of this.m_aHints) {
      const last = out[out.length - 1];
      if (last && last.nEnd === h.nStart && sameAttrs(last.aAttrs, h.aAttrs)) last.nEnd = h.nEnd;
      else out.push(h);
    }
    this.m_aHints = out;
  }

  /** Moves [pos, end) into a new following node and returns it. */
  SplitContentNode(pos: number): SwTextNode {
    const next = new SwTextNode(this.m_pNodes, this.m_pColl, this.m_Text.slice(pos));
    next.m_aSet = structuredClone(this.m_aSet);
    next.m_pStartOfSection = this.m_pStartOfSection;
    this.m_pNodes.Insert(next, this.GetIndex() + 1);
    const keep: SwTextAttr[] = [];
    for (const h of this.m_aHints) {
      if (h.nEnd > pos) next.m_aHints.push({ nStart: Math.max(h.nStart, pos) - pos, nEnd: h.nEnd - pos, aAttrs: { ...h.aAttrs } });
      if (h.nStart < pos) keep.push({ nStart: h.nStart, nEnd: Math.min(h.nEnd, pos), aAttrs: h.aAttrs });
    }
    this.m_aHints = keep;
    // Character anchors after the split point move to the new paragraph.
    next.m_aAnchoredFlys = this.m_aAnchoredFlys.filter((f) => f.fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR && f.nContent > pos).map((f) => ({ fmt: f.fmt, nContent: f.nContent - pos }));
    this.m_aAnchoredFlys = this.m_aAnchoredFlys.filter((f) => !(f.fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR && f.nContent > pos));
    this.m_Text = this.m_Text.slice(0, pos);
    for (const i of [...this.m_aIndices]) if (i.m_nContent > pos) i.Assign(next, i.m_nContent - pos);
    this.touch();
    return next;
  }

  /** Appends the following text node to this one and removes it. */
  JoinNext(): void {
    const next = this.m_pNodes.at(this.GetIndex() + 1) as SwTextNode;
    const offset = this.m_Text.length;
    this.m_Text += next.m_Text;
    for (const h of next.m_aHints) this.m_aHints.push({ nStart: h.nStart + offset, nEnd: h.nEnd + offset, aAttrs: h.aAttrs });
    for (const i of [...next.m_aIndices]) i.Assign(this, i.m_nContent + offset);
    for (const f of next.m_aAnchoredFlys) this.m_aAnchoredFlys.push({ fmt: f.fmt, nContent: f.fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? f.nContent + offset : 0 });
    this.m_pNodes.Remove(next.GetIndex());
    this.MergePortions();
    this.touch();
  }
}
