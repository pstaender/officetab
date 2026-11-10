// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/text/itrform2.cxx reduced
// @upstream sw/source/core/text/itrform2.hxx reduced
// @upstream sw/source/core/text/porlin.hxx reduced
// @upstream sw/source/core/text/porlay.hxx reduced
// @upstream sw/source/core/text/guess.cxx reduced
// @upstream sw/source/core/text/itradj.cxx reduced
// @upstream sw/source/core/text/txttab.cxx reduced
// @upstream sw/source/core/text/txtfld.cxx reduced
// @upstream sw/source/core/text/porfld.cxx reduced
// CalcRealHeight follows upstream. Line-break opportunities approximate i18npool's ICU rules
// because browsers expose no line-break iterator: after spaces and hyphens, and around CJK.
import type { FontDesc, TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import type { FontLineStyle, SvxAdjust, SwAttrs } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNodeNum } from '../doc/list.ts';

export const CH_BREAK = '\n';
export const CH_TAB = '\t';
/** Writer's default tab distance: 1.25 cm. */
export const DEFAULT_TAB = 709;
/** Upstream's automatic sub/superscript font height (DFLT_ESC_PROP). */
const DFLT_ESC_PROP = 58;

export interface SwFont extends FontDesc {
  underline: FontLineStyle;
  strike: boolean;
  color: string | null;
  background: string | null;
  /** Baseline raise in twips; negative lowers. */
  rise: number;
  upper: boolean;
  lower: boolean;
}

export type PortionKind = 'text' | 'tab' | 'break' | 'number';

export interface SwLinePortion {
  kind: PortionKind;
  nStart: number;
  nLen: number;
  nX: number; // from the start of the line's text area
  nWidth: number;
  font: SwFont;
  /** Number portions: the label and its offset within the portion (negative when right-aligned). */
  aExpand?: string;
  nLabelX?: number;
}

export interface SwLineLayout {
  nStart: number;
  nLen: number;
  portions: SwLinePortion[];
  nX: number; // alignment and indent offset within the frame
  nWidth: number;
  nHeight: number;
  nAscent: number;
  nRealHeight: number;
  /** Extra width per expandable space for justified lines. */
  nSpaceAdd: number;
}

export interface SwParaPortion { lines: SwLineLayout[]; nHeight: number }

export function fontAt(node: SwTextNode, pos: number): SwFont {
  const a = <K extends keyof SwAttrs>(k: K) => node.GetCharAttrAt(k, pos);
  const baseSize = a('RES_CHRATR_FONTSIZE');
  const esc = a('RES_CHRATR_ESCAPEMENT');
  const size = esc ? Math.round((baseSize * DFLT_ESC_PROP) / 100) : baseSize;
  const casemap = a('RES_CHRATR_CASEMAP');
  return {
    family: a('RES_CHRATR_FONT'), size,
    bold: a('RES_CHRATR_WEIGHT'), italic: a('RES_CHRATR_POSTURE'),
    underline: a('RES_CHRATR_UNDERLINE'), strike: a('RES_CHRATR_CROSSEDOUT'),
    color: a('RES_CHRATR_COLOR'), background: a('RES_CHRATR_BACKGROUND'),
    rise: esc ? Math.round((baseSize * esc) / 100) : 0,
    upper: casemap === 'uppercase', lower: casemap === 'lowercase',
  };
}

export const displayText = (s: string, f: SwFont): string => (f.upper ? s.toUpperCase() : f.lower ? s.toLowerCase() : s);

const isCJK = (c: number): boolean =>
  (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef);

/** May a line break before index i? */
export function canBreakBefore(t: string, i: number): boolean {
  if (i <= 0 || i >= t.length) return false;
  const p = t[i - 1]!, c = t[i]!;
  if (c === ' ' || c === '\t') return false;
  if (p === ' ' || p === '\t') return true;
  if (p === '-' && /\p{L}/u.test(c)) return true;
  return isCJK(p.charCodeAt(0)) || isCJK(c.charCodeAt(0));
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Never split a grapheme cluster: returns the nearest boundary at or below i within t. */
function graphemeFloor(t: string, i: number): number {
  let last = 0;
  for (const s of graphemes.segment(t)) { if (s.index > i) break; last = s.index; }
  return last;
}

interface Run { start: number; end: number; font: SwFont }

function buildRuns(node: SwTextNode): Run[] {
  const text = node.GetText();
  const cuts = new Set<number>([0, text.length]);
  for (const h of node.m_aHints) { cuts.add(h.nStart); cuts.add(h.nEnd); }
  const sorted = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const runs: Run[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) runs.push({ start: sorted[i]!, end: sorted[i + 1]!, font: fontAt(node, sorted[i]!) });
  return runs;
}

const isHanging = (c: string | undefined) => c === ' ';

/**
 * SwTextFormatter::NewNumberPortion: the label font is the paragraph font without its weight,
 * posture and underline (i18463). Hints at the start of the paragraph do not apply.
 */
export function NumberFont(node: SwTextNode): SwFont {
  const a = <K extends keyof SwAttrs>(k: K) => node.GetAttr(k);
  return {
    family: a('RES_CHRATR_FONT'), size: a('RES_CHRATR_FONTSIZE'), bold: false, italic: false,
    underline: 'none', strike: a('RES_CHRATR_CROSSEDOUT'), color: a('RES_CHRATR_COLOR'), background: null,
    rise: 0, upper: false, lower: false,
  };
}

/**
 * Indents of a list paragraph in LABEL_ALIGNMENT mode: the list level's indents apply unless the
 * paragraph has its own direct indent (SwTextNode::AreListLevelIndentsApplicable, reduced).
 * Entries that are not counted have no first line indent.
 */
export function ListIndents(node: SwTextNode, num: SwNodeNum | undefined): { left: number; right: number; firstLine: number } {
  const lr = node.GetAttr('RES_LR_SPACE');
  if (!num || node.m_aSet.RES_LR_SPACE) return lr;
  return { left: num.fmt.GetIndentAt(), right: lr.right, firstLine: num.counted ? num.fmt.GetFirstLineIndent() : 0 };
}

/** Formats one paragraph into lines for the given available width. */
export function FormatParagraph(node: SwTextNode, nAreaWidth: number, m: TextMeasurer, num?: SwNodeNum): SwParaPortion {
  const text = node.GetText();
  const lr = ListIndents(node, num);
  const adjust = node.GetAttr('RES_PARATR_ADJUST');
  const spacing = node.GetAttr('RES_PARATR_LINESPACING');
  const runs = buildRuns(node);
  const lines: SwLineLayout[] = [];
  const measure = (f: SwFont, a: number, b: number) => m.GetTextWidth(f, displayText(text.slice(a, b), f));

  let pos = 0;
  let runIdx = 0;
  let openLine = false; // a hard break at the very end still opens an empty last line
  do {
    const isFirst = lines.length === 0;
    const leftIndent = lr.left + (isFirst ? lr.firstLine : 0);
    const avail = Math.max(1, nAreaWidth - leftIndent - lr.right);
    const portions: SwLinePortion[] = [];
    const lineStart = pos;
    let x = 0;
    let lastBreak = -1; // best break opportunity seen on this line
    let hardBreak = false;
    let overflow = false;

    if (isFirst && num?.label) {
      // SwNumberPortion::Format, LABEL_ALIGNMENT: the label is aligned at the first line's start and
      // followed by a tab to the list tab position, a space, or nothing.
      const font = NumberFont(node);
      const w = m.GetTextWidth(font, num.label);
      const adjust = num.fmt.GetNumAdjust();
      const labelX = adjust === 'right' ? -w : adjust === 'center' ? -w / 2 : 0;
      const labelEnd = labelX + w;
      let textX = labelEnd;
      switch (num.fmt.GetLabelFollowedBy()) {
        case 'listtab': {
          const tabPos = num.fmt.GetListtabPos() - leftIndent;
          // Past the list tab position, the next default tab stop (relative to the indent) applies.
          textX = labelEnd < tabPos ? tabPos : (Math.floor((labelEnd + leftIndent - lr.left) / DEFAULT_TAB) + 1) * DEFAULT_TAB + lr.left - leftIndent;
          break;
        }
        case 'space': textX = labelEnd + m.GetTextWidth(font, ' '); break;
        default: break;
      }
      const width = Math.max(0, Math.min(textX, avail));
      portions.push({ kind: 'number', nStart: 0, nLen: 0, nX: 0, nWidth: width, font, aExpand: num.label, nLabelX: labelX });
      x = width;
    }

    while (runIdx < runs.length && !overflow && !hardBreak) {
      const run = runs[runIdx]!;
      if (pos >= run.end) { runIdx++; continue; }
      const c = text[pos]!;
      if (c === CH_TAB) {
        const next = (Math.floor((x + leftIndent) / DEFAULT_TAB) + 1) * DEFAULT_TAB - leftIndent;
        if (next > avail && portions.length) { overflow = true; lastBreak = pos; break; }
        portions.push({ kind: 'tab', nStart: pos, nLen: 1, nX: x, nWidth: next - x, font: run.font });
        x = next; pos++;
        lastBreak = pos;
        continue;
      }
      if (c === CH_BREAK) {
        portions.push({ kind: 'break', nStart: pos, nLen: 1, nX: x, nWidth: 0, font: run.font });
        pos++;
        hardBreak = true;
        break;
      }
      let segEnd = pos;
      while (segEnd < run.end && text[segEnd] !== CH_TAB && text[segEnd] !== CH_BREAK) segEnd++;
      const width = measure(run.font, pos, segEnd);
      if (x + width <= avail) {
        for (let i = pos + 1; i <= segEnd; i++) if (i < text.length && canBreakBefore(text, i)) lastBreak = i;
        portions.push({ kind: 'text', nStart: pos, nLen: segEnd - pos, nX: x, nWidth: width, font: run.font });
        x += width; pos = segEnd;
        continue;
      }
      // Largest prefix that fits, then extend across spaces, which hang past the margin.
      let lo = pos, hi = segEnd;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (x + measure(run.font, pos, mid) <= avail) lo = mid; else hi = mid - 1;
      }
      let fit = lo;
      while (fit < segEnd && isHanging(text[fit])) fit++;
      let brk = -1;
      for (let i = pos + 1; i <= fit; i++) if (canBreakBefore(text, i)) brk = i;
      if (fit === segEnd && fit < text.length && canBreakBefore(text, fit)) brk = fit;
      let cut: number;
      if (brk > pos) cut = brk;
      else if (lastBreak > lineStart) {
        // Rewind to a break opportunity in an earlier portion of this line.
        while (portions.length && portions[portions.length - 1]!.nStart >= lastBreak) portions.pop();
        const tail = portions[portions.length - 1];
        if (tail && tail.nStart + tail.nLen > lastBreak) {
          tail.nLen = lastBreak - tail.nStart;
          tail.nWidth = measure(tail.font, tail.nStart, lastBreak);
        }
        x = tail ? tail.nX + tail.nWidth : 0;
        pos = lastBreak;
        while (runIdx > 0 && runs[runIdx]!.start > pos) runIdx--;
        overflow = true;
        break;
      } else {
        // No opportunity on the line: split the word, keeping at least one grapheme.
        const rel = graphemeFloor(text.slice(pos, segEnd), Math.max(lo - pos, 0));
        cut = pos + (rel > 0 ? rel : (graphemes.segment(text.slice(pos, segEnd))[Symbol.iterator]().next().value?.segment.length ?? 1));
        if (x > 0 && lo === pos) { overflow = true; break; } // Nothing fits after existing portions.
      }
      const w = measure(run.font, pos, cut);
      portions.push({ kind: 'text', nStart: pos, nLen: cut - pos, nX: x, nWidth: w, font: run.font });
      x += w; pos = cut;
      overflow = true;
    }

    // Empty lines take their height from the font at their position.
    const font = portions[0]?.font ?? fontAt(node, Math.min(pos, Math.max(0, text.length - 1)));
    let ascent = 0, descent = 0;
    for (const p of portions.length ? portions : [{ font } as SwLinePortion]) {
      const fm = m.GetFontMetric(p.font);
      ascent = Math.max(ascent, fm.ascent + Math.max(0, p.font.rise));
      descent = Math.max(descent, fm.descent + Math.max(0, -p.font.rise));
    }
    let nHeight = ascent + descent;
    const nTextHeight = nHeight;
    let nLineHeight = nHeight;

    // SwTextFormatter::CalcRealHeight (non-grid path)
    if (spacing.rule === 'min') {
      if (nLineHeight < spacing.value) nLineHeight = spacing.value;
    } else if (spacing.rule === 'fix') {
      nLineHeight = spacing.value;
      ascent = Math.trunc((4 * nLineHeight) / 5); // 80%
      nHeight = nLineHeight;
    } else if (!isFirst) {
      // For the _first_ line the proportion is handled by SwFlowFrame::CalcUpperSpace.
      let nTmp = spacing.value;
      if (nTmp < 50) nTmp = nTmp ? 50 : 100; // 50% is the minimum, 0% means the default
      nLineHeight = Math.max(1, Math.trunc(((nTmp - 100) * nTextHeight) / 100) + nLineHeight);
    }

    // Trailing spaces hang and do not count for alignment.
    const end = portions.length ? portions[portions.length - 1]!.nStart + portions[portions.length - 1]!.nLen : pos;
    let contentEnd = end;
    while (contentEnd > lineStart && (text[contentEnd - 1] === ' ' || text[contentEnd - 1] === CH_BREAK)) contentEnd--;
    let visible = x;
    if (contentEnd < end) {
      visible = 0;
      for (const p of portions) {
        if (p.nStart >= contentEnd) break;
        visible = p.nStart + p.nLen <= contentEnd ? p.nX + p.nWidth : p.nX + measure(p.font, p.nStart, contentEnd);
      }
    }
    const free = Math.max(0, avail - visible);
    const isLast = pos >= text.length || hardBreak;
    let nSpaceAdd = 0;
    let shift = 0;
    const a: SvxAdjust = adjust;
    if (a === 'right') shift = free;
    else if (a === 'center') shift = free / 2;
    else if (a === 'block' && !isLast) {
      let spaces = 0;
      for (let i = lineStart; i < contentEnd; i++) if (text[i] === ' ') spaces++;
      if (spaces) nSpaceAdd = free / spaces;
    }
    lines.push({
      nStart: lineStart, nLen: pos - lineStart, portions, nX: leftIndent + shift, nWidth: visible,
      nHeight, nAscent: ascent, nRealHeight: nLineHeight, nSpaceAdd,
    });
    openLine = hardBreak && pos === text.length;
  } while (pos < text.length || openLine);

  return { lines, nHeight: lines.reduce((h, l) => h + l.nRealHeight, 0) };
}

/** Horizontal offset of content position `pos` within line `l`, including justification. */
export function LineXAt(text: string, l: SwLineLayout, pos: number, m: TextMeasurer): number {
  let x = 0;
  for (const p of l.portions) {
    if (pos >= p.nStart + p.nLen) { x = p.nX + p.nWidth; continue; }
    if (pos <= p.nStart) return p.nX + spacesBefore(text, l, p.nStart) * l.nSpaceAdd;
    x = p.nX + (p.kind === 'text' ? m.GetTextWidth(p.font, displayText(text.slice(p.nStart, pos), p.font)) : 0);
    return x + spacesBefore(text, l, pos) * l.nSpaceAdd;
  }
  return x + spacesBefore(text, l, pos) * l.nSpaceAdd;
}

function spacesBefore(text: string, l: SwLineLayout, pos: number): number {
  if (!l.nSpaceAdd) return 0;
  let n = 0;
  for (let i = l.nStart; i < pos; i++) if (text[i] === ' ') n++;
  return n;
}
