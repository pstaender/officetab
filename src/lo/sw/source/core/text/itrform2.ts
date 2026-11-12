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
// because browsers expose no line-break iterator: after spaces, hyphens, soft hyphens and zero
// width spaces, and around CJK, never next to a word joiner. The special characters of
// SwTextFormatter::NewPortion are mapped in displayText instead of having portions of their own,
// apart from a soft hyphen ending a line (SwSoftHyphPortion).
import { RotatedBoundSize } from '../../../inc/frmfmt.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { FontDesc, TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import { CH_TXTATR_BREAKWORD, ExpandFieldmark, type FontLineStyle, type SvxAdjust, type SvxBorderLine, type SvxTabStop, type SwAttrs, type SwField, type SwFlyCnt } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNodeNum } from '../doc/list.ts';
import { GetAuthorColor } from '../../uibase/app/swmodul1.ts';
import { GetFormula } from '../../../../starmath/source/document.ts';

/** The measurer formulas were last arranged with: frames anchored outside the text draw with it. */
let lastMeasurer: TextMeasurer | null = null;
const mathFlys = new WeakMap<SwFlyCnt, { m: TextMeasurer; fly: SwFlyCnt }>();
/**
 * An as-character formula (SwOLENode with a Math object) as the line takes it: the formula
 * arranged with the layout's measurer gives its size, and its baseline when it is aligned to the
 * line's (SwFEShell::AlignFormulaToBaseline).
 */
export function MathFlyCnt(fly: SwFlyCnt, m: TextMeasurer): SwFlyCnt {
  if (!fly.math) return fly;
  lastMeasurer = m;
  const hit = mathFlys.get(fly);
  if (hit && hit.m === m) return hit.fly;
  const doc = GetFormula(m, fly.math.m_sText, fly.math.m_nBaseFontHeight);
  const { width, height } = doc.GetSize(m);
  const out: SwFlyCnt = { ...fly, width, height, ...(fly.math.m_bBaseline ? { m_nAscent: Math.max(0, Math.min(height, doc.GetBaseline(m))) } : fly.math.m_eVertOrient === 'center' ? { m_nAscent: Math.trunc(height / 2) } : {}) };
  mathFlys.set(fly, { m, fly: out });
  arranged.set(out, { m, doc });
  return out;
}
/** A formula's size and baseline outside layout (filters): measured as the layout last measured. */
const roughMeasurer: TextMeasurer = { GetTextWidth: (f, t) => [...t].length * f.size * 0.5, GetFontMetric: (f) => ({ ascent: Math.round(f.size * 0.9), descent: Math.round(f.size * 0.22) }) };
export const ArrangedMathFly = (fly: SwFlyCnt): SwFlyCnt => MathFlyCnt(fly, lastMeasurer ?? roughMeasurer);
const arranged = new WeakMap<SwFlyCnt, { m: TextMeasurer; doc: ReturnType<typeof GetFormula> }>();

/** SmDocShell::DrawFormula for a formula the layout arranged (MathFlyCnt); false for other objects. */
export function DrawMathFly(ctx: CanvasRenderingContext2D, fly: SwFlyCnt, x: number, top: number, autoColor: string, m?: TextMeasurer): boolean {
  if (!fly.math) return false;
  m ??= lastMeasurer ?? undefined;
  const a = arranged.get(fly) ?? (m ? { m, doc: GetFormula(m, fly.math.m_sText, fly.math.m_nBaseFontHeight) } : null);
  if (!a) return false;
  a.doc.DrawFormula(ctx, a.m, x, top, autoColor);
  return true;
}

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
  /** The comment whose range this text is, for highlighting. */
  comment?: string | null;
  upper: boolean;
  lower: boolean;
  /** SvxCaseMap::Capitalize: the first letter of each word upper case. */
  title?: boolean;
  /** SvxCaseMap::SmallCaps: lower case letters as upper case at SMALL_CAPS_PERCENTAGE (SwSubFont::DoOnCapitals). */
  smallCaps?: boolean;
  overline?: FontLineStyle;
  shadow?: boolean;
  /** Outline font effect (SvxContourItem). */
  outline?: boolean;
  /** Text in a tracked change (SwRedlineItr): its type, for the change bar. */
  redline?: 'Insert' | 'Delete';
  /** Deleted text while changes are not shown: it takes no space and is not painted. */
  hidden?: boolean;
  /** The character border (SwFont::m_aTopBorder and the other sides, one line here). */
  box?: SvxBorderLine | null;
}

export type PortionKind = 'text' | 'tab' | 'break' | 'number' | 'field' | 'fly';

/** Expands a field for display (SwField::ExpandField); the layout supplies page context. */
export type FieldExpander = (f: SwField) => string;

/** Expansion without page context, for measuring outside a page. */
export const DefaultExpand: FieldExpander = (f) => {
  if (f.fixed !== undefined) return f.fixed;
  switch (f.type) {
    case 'PageNumber': case 'PageCount': case 'Sequence': return '1';
    case 'Date': return new Date().toLocaleDateString();
    case 'Time': return new Date().toLocaleTimeString();
    case 'Fieldmark': return ExpandFieldmark(f);
  }
};

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
  /** Tab portions: the fill character drawn across the tab, if any. */
  aFill?: string;
  /** Fly portions: the graphic, standing on the baseline (SwFlyCntPortion). */
  pFly?: SwFlyCnt;
  /** The bidi embedding level (SwScriptInfo's direction runs); odd runs right to left. */
  nLevel?: number;
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
  /** SwLineLayout::GetTextHeight: the height of the line's text, without as-character objects. */
  nTextHeight?: number;
  /** Extra width per expandable space for justified lines. */
  nSpaceAdd: number;
  /** Portions are in visual order with mixed directions (SwMultiPortion's bidi portions, reduced). */
  bBidi?: boolean;
}

export interface SwParaPortion { lines: SwLineLayout[]; nHeight: number }

export function fontAt(node: SwTextNode, pos: number): SwFont {
  const f = fontAtNoRedline(node, pos);
  // SwRedlineItr::FillHints with SwModule::GetInsertAuthorAttr / GetDeletedAuthorAttr: insertions
  // underlined, deletions struck through, both in the author's colour.
  const r = node.GetCharAttrAt('RES_TXTATR_REDLINE', pos);
  if (!r) return f;
  const color = GetAuthorColor(r.author);
  return r.type === 'Insert' ? { ...f, underline: 'single', color, redline: 'Insert' } : { ...f, strike: true, color, redline: 'Delete' };
}

function fontAtNoRedline(node: SwTextNode, pos: number): SwFont {
  const a = <K extends keyof SwAttrs>(k: K) => node.GetCharAttrAt(k, pos);
  const baseSize = a('RES_CHRATR_FONTSIZE');
  const esc = a('RES_CHRATR_ESCAPEMENT');
  const size = esc ? Math.round((baseSize * DFLT_ESC_PROP) / 100) : baseSize;
  const casemap = a('RES_CHRATR_CASEMAP');
  const caseAndEffects = () => ({
    upper: casemap === 'uppercase', lower: casemap === 'lowercase', title: casemap === 'capitalize', smallCaps: casemap === 'smallcaps',
    overline: a('RES_CHRATR_OVERLINE'), shadow: a('RES_CHRATR_SHADOWED'), outline: a('RES_CHRATR_CONTOUR'),
    box: a('RES_CHRATR_BOX'),
  });
  const comment = a('RES_TXTATR_ANNOTMARK');
  // Hyperlinks take the "Internet Link" character style (COL_BLUE, single underline) beneath the
  // run's own attributes, or the character style the link names (an index's "Index Link").
  const link = a('RES_TXTATR_INETFMT');
  const own = link ? node.m_aHints.find((h) => h.nStart <= pos && pos < h.nEnd)?.aAttrs : undefined;
  const linkFmt = own?.RES_TXTATR_INETFMT_CHARFMT;
  if (link && linkFmt) {
    const l = <K extends keyof SwAttrs>(k: K): SwAttrs[K] => (own?.[k as keyof typeof own] as SwAttrs[K] | undefined) ?? linkFmt.GetFormatAttrIfSet(k) ?? a(k);
    return {
      family: l('RES_CHRATR_FONT'), size, bold: l('RES_CHRATR_WEIGHT'), italic: l('RES_CHRATR_POSTURE'),
      underline: l('RES_CHRATR_UNDERLINE'), strike: l('RES_CHRATR_CROSSEDOUT'),
      color: l('RES_CHRATR_COLOR'), background: l('RES_CHRATR_BACKGROUND'),
      rise: esc ? Math.round((baseSize * esc) / 100) : 0, comment, ...caseAndEffects(),
    };
  }
  if (link) {
    return {
      family: a('RES_CHRATR_FONT'), size, bold: a('RES_CHRATR_WEIGHT'), italic: a('RES_CHRATR_POSTURE'),
      underline: own?.RES_CHRATR_UNDERLINE ?? 'single', strike: a('RES_CHRATR_CROSSEDOUT'),
      color: own?.RES_CHRATR_COLOR !== undefined ? own.RES_CHRATR_COLOR : '#000080', background: a('RES_CHRATR_BACKGROUND'),
      rise: esc ? Math.round((baseSize * esc) / 100) : 0, comment, ...caseAndEffects(),
    };
  }
  return {
    family: a('RES_CHRATR_FONT'), size,
    bold: a('RES_CHRATR_WEIGHT'), italic: a('RES_CHRATR_POSTURE'),
    underline: a('RES_CHRATR_UNDERLINE'), strike: a('RES_CHRATR_CROSSEDOUT'),
    color: a('RES_CHRATR_COLOR'), background: a('RES_CHRATR_BACKGROUND'),
    rise: esc ? Math.round((baseSize * esc) / 100) : 0,
    comment, ...caseAndEffects(),
  };
}

/**
 * SvxFont::CalcCaseMap: the text as displayed. Small capitals display upper case; Capitalize
 * upper-cases every letter after a blank (from the start of the given text, as upstream).
 */
export const displayText = (s: string, f: SwFont): string => {
  // SwBlankPortion('-') for a non-breaking hyphen; no width for a soft hyphen inside a line
  // (SwSoftHyphPortion), a zero width space or a word joiner (SwControlCharPortion).
  if (/[\u00ad\u2011\u200b\u2060]/.test(s)) s = s.replace(/\u2011/g, '-').replace(/[\u00ad\u200b\u2060]/g, '');
  if (f.upper || f.smallCaps) return s.toUpperCase();
  if (f.lower) return s.toLowerCase();
  if (f.title) {
    let bBlank = true, out = '';
    for (const c of s) {
      if (c === ' ' || c === '\t') { bBlank = true; out += c; } else { out += bBlank ? c.toUpperCase() : c; bBlank = false; }
    }
    return out;
  }
  return s;
};

/** editeng's SMALL_CAPS_PERCENTAGE. */
export const SMALL_CAPS_PERCENTAGE = 80;
const LOWERCASE_BLOCK = /\p{Ll}+|[^\p{Ll}]+/gu;

/**
 * SwSubFont::DoOnCapitals: small capitals are blocks of lower case letters, shown upper case in
 * a font of SMALL_CAPS_PERCENTAGE of the size, and blocks of everything else in the font itself.
 * Other fonts are one block.
 */
export function CapitalBlocks(s: string, f: SwFont): { text: string; font: SwFont }[] {
  if (!f.smallCaps) return [{ text: displayText(s, f), font: f }];
  const small: SwFont = { ...f, size: Math.round((f.size * SMALL_CAPS_PERCENTAGE) / 100) };
  return (s.match(LOWERCASE_BLOCK) ?? []).map((b) => (/\p{Ll}/u.test(b) ? { text: b.toUpperCase(), font: small } : { text: b.toUpperCase(), font: f }));
}

/** SwSubFont::GetTextSize_ (with GetCapitalSize for small capitals): the width of `s` as displayed. */
export function GetTextSize(m: TextMeasurer, f: SwFont, s: string): number {
  if (!f.smallCaps) return m.GetTextWidth(f, displayText(s, f));
  return CapitalBlocks(s, f).reduce((w, b) => w + m.GetTextWidth(b.font, b.text), 0);
}

/** sw/inc/swtypes.hxx */
export const CHAR_HARDBLANK = '\u00a0', CHAR_HARDHYPHEN = '\u2011', CHAR_SOFTHYPHEN = '\u00ad', CHAR_RLM = '\u200f', CHAR_LRM = '\u200e',
  CHAR_ZWSP = '\u200b', CHAR_WJ = '\u2060', CHAR_NNBSP = '\u202f';

const isCJK = (c: number): boolean =>
  (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef);

/** May a line break before index i? */
export function canBreakBefore(t: string, i: number): boolean {
  if (i <= 0 || i >= t.length) return false;
  const p = t[i - 1]!, c = t[i]!;
  if (c === ' ' || c === '\t') return false;
  if (p === CHAR_WJ || c === CHAR_WJ) return false;
  if (p === ' ' || p === '\t' || p === CHAR_SOFTHYPHEN || p === CHAR_ZWSP) return true;
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

function buildRuns(node: SwTextNode, hideDeleted = false): Run[] {
  const text = node.GetText();
  const cuts = new Set<number>([0, text.length]);
  for (const h of node.m_aHints) { cuts.add(h.nStart); cuts.add(h.nEnd); }
  const sorted = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const runs: Run[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const font = fontAt(node, sorted[i]!);
    runs.push({ start: sorted[i]!, end: sorted[i + 1]!, font: hideDeleted && font.redline === 'Delete' ? { ...font, hidden: true } : font });
  }
  return runs;
}

const isHanging = (c: string | undefined) => c === ' ';

/**
 * SwTextFormatter::NewNumberPortion: the label font is the paragraph font without its weight,
 * posture and underline (i18463). Hints at the start of the paragraph do not apply.
 */
export function NumberFont(node: SwTextNode, bulletFont?: string | null): SwFont {
  const a = <K extends keyof SwAttrs>(k: K) => node.GetAttr(k);
  return {
    // SVX_NUM_CHAR_SPECIAL: the bullet font replaces the family.
    family: bulletFont ?? a('RES_CHRATR_FONT'), size: a('RES_CHRATR_FONTSIZE'), bold: false, italic: false,
    underline: 'none', strike: a('RES_CHRATR_CROSSEDOUT'), color: a('RES_CHRATR_COLOR'), background: null,
    rise: 0, upper: false, lower: false,
  };
}

/**
 * NewFootnoteNumPortion's font: the paragraph's font without underline, posture and weight, with
 * the Footnote Characters format (superscript). The font is the one of the footnote's first
 * character, where Word documents carry the w:footnoteRef run's formatting.
 */
export function FootnoteNumberFont(node: SwTextNode): SwFont {
  const a = <K extends keyof SwAttrs>(k: K) => (node.Len() ? node.GetCharAttrAt(k as never, 0) as SwAttrs[K] : node.GetAttr(k));
  const size = a('RES_CHRATR_FONTSIZE');
  return {
    family: a('RES_CHRATR_FONT'), size: Math.round((size * DFLT_ESC_PROP) / 100), bold: false, italic: false,
    underline: 'none', strike: a('RES_CHRATR_CROSSEDOUT'), color: a('RES_CHRATR_COLOR'), background: null,
    rise: Math.round((size * 33) / 100), upper: false, lower: false,
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

/**
 * The free horizontal spans of a line at `top` (relative to the paragraph's first line) and of
 * `height`, in the paragraph's coordinates, as wrapping objects leave them (SwTextFly::GetFrame).
 * No spans means the line is blocked; `next` is where the obstacle ends. Null: no obstacle.
 */
export interface SwLineArea { segs: [number, number][]; next: number }
export type LineAreaFn = (top: number, height: number) => SwLineArea | null;

// Strong right-to-left characters: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and
// their presentation forms (the bidi class R and AL ranges of the BMP and beyond).
const STRONG_R = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * The Unicode Bidirectional Algorithm, reduced (ubidi as SwScriptInfo uses it): characters are
 * strong right to left (R), strong left to right (L, letters), numbers (EN, kept left to right) or
 * neutral; neutrals between runs of one direction take it, others the paragraph's. Levels are
 * then resolved (I1, I2) and the portions split into level runs and reordered (L2).
 */
export function ReorderBidi(text: string, portions: SwLinePortion[], base: 0 | 1, measure: (f: SwFont, a: number, b: number) => number): SwLinePortion[] {
  if (!portions.length) return portions;
  const start = Math.min(...portions.map((p) => p.nStart)), end = Math.max(...portions.map((p) => p.nStart + p.nLen));
  const cls: ('R' | 'L' | 'N')[] = [];
  for (let i = start; i < end; i++) {
    const c = text[i]!;
    cls.push(STRONG_R.test(c) ? 'R' : /[\p{L}\p{Nd}]/u.test(c) ? 'L' : 'N');
  }
  // Neutrals: the direction of equal strong neighbours, else the paragraph's.
  const dir = cls.map((c, i) => {
    if (c !== 'N') return c;
    let a: 'R' | 'L' | null = null, b: 'R' | 'L' | null = null;
    for (let k = i - 1; k >= 0 && !a; k--) if (cls[k] !== 'N') a = cls[k] as 'R' | 'L';
    for (let k = i + 1; k < cls.length && !b; k++) if (cls[k] !== 'N') b = cls[k] as 'R' | 'L';
    return a && a === b ? a : base ? 'R' : 'L';
  });
  const levelAt = (i: number) => (dir[i - start] === 'R' ? 1 : base ? 2 : 0);
  // Split text portions at level changes; other portions keep the paragraph's level.
  const units: SwLinePortion[] = [];
  for (const p of portions) {
    if (p.kind !== 'text' || p.nLen === 0) { units.push({ ...p, nLevel: p.kind === 'field' ? (base ? 2 : 0) : base }); continue; }
    let s = p.nStart;
    for (let i = p.nStart + 1; i <= p.nStart + p.nLen; i++) {
      if (i < p.nStart + p.nLen && levelAt(i) === levelAt(s)) continue;
      units.push({ ...p, nStart: s, nLen: i - s, nWidth: measure(p.font, s, i), nLevel: levelAt(s) });
      s = i;
    }
  }
  // L2: from the highest level down to the lowest odd one, reverse every run at or above it.
  const max = Math.max(...units.map((u) => u.nLevel ?? 0));
  const minOdd = Math.min(...units.map((u) => u.nLevel ?? 0).filter((l) => l % 2), Infinity);
  for (let lvl = max; lvl >= (minOdd === Infinity ? max + 1 : minOdd); lvl--) {
    for (let i = 0; i < units.length;) {
      if ((units[i]!.nLevel ?? 0) < lvl) { i++; continue; }
      let j = i;
      while (j < units.length && (units[j]!.nLevel ?? 0) >= lvl) j++;
      units.splice(i, j - i, ...units.slice(i, j).reverse());
      i = j;
    }
  }
  let x = 0;
  for (const u of units) { u.nX = x; x += u.nWidth; }
  return units;
}

/** Narrower spans beside an object stay empty (SwTextFly's TEXT_MIN for "optimal", reduced). */
const MIN_SEG = 283;

/**
 * Formats one paragraph into lines for the given available width. With `lineArea`, lines go around
 * wrapping objects (SwTextFormatter::CalcFlyWidth, reduced: a line beside an object is split into
 * spans with an SwFlyPortion gap; justification and centring then apply to no span). `nStart`
 * formats a follow frame from that offset.
 */
export function FormatParagraph(node: SwTextNode, nAreaWidth: number, m: TextMeasurer, num?: SwNodeNum, expand: FieldExpander = DefaultExpand,
  footnote: (id: string) => string = () => '1', opt: { lineArea?: LineAreaFn; nStart?: number; hideDeleted?: boolean; propLineSpacingShrinksFirstLine?: boolean } = {}): SwParaPortion {
  const text = node.GetText();
  const lr = ListIndents(node, num);
  const tabStops = node.GetAttr('RES_PARATR_TABSTOP');
  const adjust = node.GetAttr('RES_PARATR_ADJUST');
  const spacing = node.GetAttr('RES_PARATR_LINESPACING');
  const runs = buildRuns(node, opt.hideDeleted);
  // SvxFrameDirection: a right-to-left paragraph is formatted from its start (right) edge; its
  // indents are "before" and "after" text, while its alignment stays physical (SvxAdjust).
  const rtl = node.GetAttr('RES_FRAMEDIR') === 'rl-tb';
  const bidi = rtl || STRONG_R.test(text);
  const lines: SwLineLayout[] = [];
  const measure = (f: SwFont, a: number, b: number) => (f.hidden ? 0 : GetTextSize(m, f, text.slice(a, b)));

  let pos = opt.nStart ?? 0;
  let runIdx = 0;
  while (runIdx < runs.length && runs[runIdx]!.end <= pos && runs[runIdx]!.end < text.length) runIdx++;
  let openLine = false; // a hard break at the very end still opens an empty last line
  let lineTop = 0;
  let hadText = false;
  let estHeight = 0;

  /** Formats one line into the spans `segs` (absolute to the paragraph); advances pos and runIdx. */
  const buildLine = (segs: [number, number][], isFirst: boolean): { line: SwLineLayout; hardBreak: boolean } => {
    const lineOrigin = segs[0]![0];
    let segIdx = 0;
    let avail = Math.max(1, segs[0]![1] - lineOrigin);
    const portions: SwLinePortion[] = [];
    const lineStart = pos;
    let x = 0;
    let lastBreak = -1; // best break opportunity seen on this line
    let minBreak = lineStart; // breaks never go back before the current span
    let hardBreak = false;
    let overflow = false;
    let lastTab: { index: number; stop: number; adjust: SvxTabStop['adjust']; decimal: string } | null = null;

    /**
     * SwTextFormatter::NewTabPortion: the next tab stop after x (relative to the line start).
     * Stops are relative to the paragraph indent; after the last one the default stops apply,
     * at least 51 twips away. Inside a hanging indent, the indent itself is a tab stop.
     */
    const NewTabPortion = (curX: number): { next: number; adjust: SvxTabStop['adjust']; fill: string; decimal: string } => {
      const nSearchPos = curX + lineOrigin - lr.left;
      const stop = tabStops.find((s) => s.pos > nSearchPos);
      let next: number, adjust: SvxTabStop['adjust'] = 'left', fill = '', decimal = '.';
      if (stop) {
        next = stop.pos; adjust = stop.adjust; fill = stop.fill === ' ' ? '' : stop.fill; decimal = stop.decimal;
        // Beyond the text area a non-left stop acts as a right stop at the margin (#i115705 era rule).
        if (next + lr.left - lineOrigin > avail && adjust !== 'left') { adjust = 'right'; next = avail + lineOrigin - lr.left; }
      } else {
        const nCount = Math.trunc(nSearchPos / DEFAULT_TAB);
        next = nCount < 0 || (!nCount && nSearchPos <= 0) ? nCount * DEFAULT_TAB : (nCount + 1) * DEFAULT_TAB;
        // #117919 Minimum tab stop width is 1 or 51 twips
        if (next <= nSearchPos + 50) next += DEFAULT_TAB;
      }
      // #i115705# a tab inside the hanging indent goes to the indent.
      if (curX + lineOrigin < lr.left && (!stop || next > 0)) { next = 0; adjust = 'left'; fill = ''; }
      return { next: next + lr.left - lineOrigin, adjust, fill, decimal };
    };

    /** SwTabPortion::PostFormat: sizes a pending right, centre or decimal tab from the text after it. */
    const postFormatTab = () => {
      if (!lastTab) return;
      const tab = portions[lastTab.index];
      // The tab went with portions moved to the next line.
      if (!tab || tab.kind !== 'tab') { lastTab = null; return; }
      const after = portions.slice(lastTab.index + 1);
      let nPorWidth = after.reduce((w, p) => w + p.nWidth, 0);
      const nRight = Math.min(lastTab.stop, avail);
      if (lastTab.adjust === 'decimal') {
        // Width of the text up to the decimal character, if there is one.
        let w = 0;
        for (const p of after) {
          const seg = p.kind === 'text' ? text.slice(p.nStart, p.nStart + p.nLen) : '';
          const at = seg.indexOf(lastTab.decimal);
          if (at >= 0) { w += GetTextSize(m, p.font, seg.slice(0, at)); nPorWidth = w; break; }
          w += p.nWidth;
        }
      } else if (lastTab.adjust === 'center') {
        let nNewWidth = nPorWidth / 2;
        if (nNewWidth > avail - nRight) nNewWidth = nPorWidth - (avail - nRight);
        nPorWidth = nNewWidth;
      }
      const nDiffWidth = nRight - tab.nX;
      if (nDiffWidth > nPorWidth) {
        const delta = nDiffWidth - nPorWidth - tab.nWidth;
        tab.nWidth += delta;
        for (const p of after) p.nX += delta;
        x += delta;
      }
      lastTab = null;
    };

    if (isFirst && num?.label) {
      // SwNumberPortion::Format, LABEL_ALIGNMENT: the label is aligned at the first line's start and
      // followed by a tab to the list tab position, a space, or nothing.
      const font = num.footnote ? FootnoteNumberFont(node) : NumberFont(node, num.fmt.GetNumberingType() === NumberingType.CHAR_SPECIAL ? num.fmt.GetBulletFont() : null);
      const w = m.GetTextWidth(font, num.label);
      const adjust = num.fmt.GetNumAdjust();
      const labelX = adjust === 'right' ? -w : adjust === 'center' ? -w / 2 : 0;
      const labelEnd = labelX + w;
      let textX = labelEnd;
      // SwFootnoteNumPortion is a number portion of the old positioning mode without a minimum
      // distance: the text follows the number, at the left indent at the earliest.
      if (num.footnote) textX = Math.max(labelEnd, lr.left - lineOrigin);
      else switch (num.fmt.GetLabelFollowedBy()) {
        case 'listtab': {
          const tabPos = num.fmt.GetListtabPos() - lineOrigin;
          // Past the list tab position, the next default tab stop (relative to the indent) applies.
          textX = labelEnd < tabPos ? tabPos : (Math.floor((labelEnd + lineOrigin - lr.left) / DEFAULT_TAB) + 1) * DEFAULT_TAB + lr.left - lineOrigin;
          break;
        }
        case 'space': textX = labelEnd + m.GetTextWidth(font, ' '); break;
        default: break;
      }
      const width = Math.max(0, Math.min(textX, avail));
      portions.push({ kind: 'number', nStart: 0, nLen: 0, nX: 0, nWidth: width, font, aExpand: num.label, nLabelX: labelX });
      x = width;
    }

    const inLastSeg = () => segIdx === segs.length - 1;
    const hasContent = () => portions.some((p) => p.kind !== 'number' && p.nStart >= minBreak && !(p.kind === 'fly' && !p.pFly));

    for (;;) {
      while (runIdx < runs.length && !overflow && !hardBreak) {
        const run = runs[runIdx]!;
        if (pos >= run.end) { runIdx++; continue; }
        const c = text[pos]!;
        if (c === CH_TAB) {
          postFormatTab();
          const t = NewTabPortion(x);
          if (t.adjust === 'left') {
            if (t.next > avail && hasContent()) { overflow = true; lastBreak = pos; break; }
            portions.push({ kind: 'tab', nStart: pos, nLen: 1, nX: x, nWidth: Math.max(0, Math.min(t.next, avail) - x), font: run.font, aFill: t.fill });
            x = Math.max(x, Math.min(t.next, avail));
          } else {
            // Right, centre and decimal tabs get their width once the text after them is known.
            portions.push({ kind: 'tab', nStart: pos, nLen: 1, nX: x, nWidth: 0, font: run.font, aFill: t.fill });
            lastTab = { index: portions.length - 1, stop: t.next, adjust: t.adjust, decimal: t.decimal };
          }
          pos++;
          lastBreak = pos;
          continue;
        }
        const rawFly = c === CH_TXTATR_BREAKWORD ? node.GetCharAttrAt('RES_TXTATR_FLYCNT', pos) : null;
        const fly = rawFly && MathFlyCnt(rawFly, m);
        if (fly) {
          // SwFlyCntPortion: a graphic anchored as character is one wide portion; it moves to the
          // next line when it does not fit, unless it is first on its line.
          // A rotated graphic takes its bounds (SwFlyCntPortion of a transformed frame).
          const flyW = RotatedBoundSize(fly.width, fly.height, fly.rotation).width;
          if (x + flyW > avail && (hasContent() || !inLastSeg())) { overflow = true; lastBreak = pos; break; }
          portions.push({ kind: 'fly', nStart: pos, nLen: 1, nX: x, nWidth: flyW, font: run.font, pFly: fly });
          x += flyW; pos++;
          lastBreak = pos;
          continue;
        }
        if (c === CH_TXTATR_BREAKWORD) {
          // SwFieldPortion: the expansion is measured and painted, the placeholder has length 1.
          // A footnote anchor (SwFootnotePortion) shows its number in the Footnote Anchor style: superscript.
          // A comment anchor (SwPostItsPortion) takes no space.
          const ftn = node.GetCharAttrAt('RES_TXTATR_FTN', pos);
          const fld = ftn ? null : node.GetCharAttrAt('RES_TXTATR_FIELD', pos);
          const aExpand = ftn ? footnote(ftn.id) : fld ? expand(fld) : '';
          // The anchor's character format replaces an escapement the text already has.
          const font = ftn ? (run.font.rise > 0 ? run.font : { ...run.font, size: Math.round((run.font.size * DFLT_ESC_PROP) / 100), rise: Math.round((run.font.size * 33) / 100) }) : run.font;
          const w = GetTextSize(m, font, aExpand);
          if (x + w > avail && (hasContent() || !inLastSeg())) { overflow = true; lastBreak = pos; break; }
          portions.push({ kind: 'field', nStart: pos, nLen: 1, nX: x, nWidth: w, font, aExpand });
          x += w; pos++;
          continue;
        }
        if (c === CH_BREAK) {
          portions.push({ kind: 'break', nStart: pos, nLen: 1, nX: x, nWidth: 0, font: run.font });
          pos++;
          hardBreak = true;
          break;
        }
        let segEnd = pos;
        while (segEnd < run.end && text[segEnd] !== CH_TAB && text[segEnd] !== CH_BREAK && text[segEnd] !== CH_TXTATR_BREAKWORD) segEnd++;
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
        else if (lastBreak > minBreak) {
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
        } else if (!inLastSeg()) {
          // A word that does not fit beside an object moves on to the next span.
          overflow = true;
          break;
        } else {
          // No opportunity on the line: split the word, keeping at least one grapheme.
          const rel = graphemeFloor(text.slice(pos, segEnd), Math.max(lo - pos, 0));
          cut = pos + (rel > 0 ? rel : (graphemes.segment(text.slice(pos, segEnd))[Symbol.iterator]().next().value?.segment.length ?? 1));
          if (x > 0 && lo === pos && hasContent()) { overflow = true; break; } // Nothing fits after existing portions.
        }
        const w = measure(run.font, pos, cut);
        portions.push({ kind: 'text', nStart: pos, nLen: cut - pos, nX: x, nWidth: w, font: run.font });
        x += w; pos = cut;
        overflow = true;
      }
      postFormatTab();
      // SwFlyPortion: the text continues in the next span beside the object.
      if (!overflow || hardBreak || inLastSeg()) break;
      segIdx++;
      const next = segs[segIdx]!;
      portions.push({ kind: 'fly', nStart: pos, nLen: 0, nX: x, nWidth: Math.max(0, next[0] - lineOrigin - x), font: portions[portions.length - 1]?.font ?? fontAt(node, Math.min(pos, Math.max(0, text.length - 1))) });
      x = next[0] - lineOrigin;
      avail = next[1] - lineOrigin;
      overflow = false;
      lastBreak = -1;
      minBreak = pos;
    }

    // SwSoftHyphPortion: a soft hyphen where the line breaks shows as a hyphen.
    const tail = portions[portions.length - 1];
    if (overflow && !hardBreak && tail?.kind === 'text' && tail.nStart + tail.nLen === pos && pos > tail.nStart && text[pos - 1] === CHAR_SOFTHYPHEN) {
      const w = GetTextSize(m, tail.font, '-');
      tail.nLen--;
      tail.nWidth = measure(tail.font, tail.nStart, pos - 1);
      portions.push({ kind: 'field', nStart: pos - 1, nLen: 1, nX: tail.nX + tail.nWidth, nWidth: w, font: tail.font, aExpand: '-' });
      x = tail.nX + tail.nWidth + w;
    }

    // Empty lines take their height from the font at their position.
    const font = portions.find((p) => p.kind !== 'fly' || p.pFly)?.font ?? fontAt(node, Math.min(pos, Math.max(0, text.length - 1)));
    let ascent = 0, descent = 0;
    // SwLineLayout's text height: that of the text portions; as-character objects only raise the line.
    let textAscent = 0, textDescent = 0;
    const measured = portions.filter((p) => p.kind !== 'fly' || p.pFly);
    for (const p of measured.length ? measured : [{ font } as SwLinePortion]) {
      if (p.pFly) {
        // SwAsCharAnchoredObjectPosition: on the baseline, or with its own baseline on it.
        const h = RotatedBoundSize(p.pFly.width, p.pFly.height, p.pFly.rotation).height, a = p.pFly.m_nAscent ?? h;
        ascent = Math.max(ascent, a);
        descent = Math.max(descent, h - a);
        continue;
      }
      const fm = m.GetFontMetric(p.font);
      textAscent = Math.max(textAscent, fm.ascent + Math.max(0, p.font.rise));
      textDescent = Math.max(textDescent, fm.descent + Math.max(0, -p.font.rise));
    }
    if (!textAscent && !textDescent) { const fm = m.GetFontMetric(font); textAscent = fm.ascent; textDescent = fm.descent; }
    ascent = Math.max(ascent, textAscent);
    descent = Math.max(descent, textDescent);
    let nHeight = ascent + descent;
    const nTextHeight = textAscent + textDescent;
    let nLineHeight = nHeight;

    // SwTextFormatter::CalcRealHeight (non-grid path)
    if (spacing.rule === 'min') {
      if (nLineHeight < spacing.value) nLineHeight = spacing.value;
    } else if (spacing.rule === 'fix') {
      nLineHeight = spacing.value;
      ascent = Math.trunc((4 * nLineHeight) / 5); // 80%
      nHeight = nLineHeight;
    } else if (isFirst) {
      // PROP_LINE_SPACING_SHRINKS_FIRST_LINE: below 100% the first line shrinks too (as a fixed
      // height with an 80% ascent); otherwise SwFlowFrame::CalcUpperSpace handles its proportion.
      let nTmp = spacing.value;
      if (nTmp < 50) nTmp = nTmp ? 50 : 100;
      if (nTmp < 100 && opt.propLineSpacingShrinksFirstLine) {
        nLineHeight = Math.max(1, Math.trunc((nTmp * nLineHeight) / 100));
        ascent = Math.trunc((4 * nLineHeight) / 5);
        nHeight = nLineHeight;
      }
    } else {
      let nTmp = spacing.value;
      if (nTmp < 50) nTmp = nTmp ? 50 : 100; // 50% is the minimum, 0% means the default
      const bPropLineShrinks = nTmp < 100;
      nLineHeight = Math.max(1, Math.trunc(((nTmp - 100) * nTextHeight) / 100) + nLineHeight);
      // tdf#146081: the following lines take the same adjustments as the first.
      if (bPropLineShrinks && opt.propLineSpacingShrinksFirstLine) {
        ascent = Math.trunc((4 * nLineHeight) / 5);
        nHeight = nLineHeight;
      }
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
    const split = segs.length > 1;
    let nSpaceAdd = 0;
    let shift = 0;
    // The alignment is physical: from the start edge of a right-to-left line, "right" is near.
    const a: SvxAdjust = rtl ? (adjust === 'left' ? 'right' : adjust === 'right' ? 'left' : adjust) : adjust;
    if (a === 'right' && !split) shift = free;
    else if (a === 'center' && !split) shift = free / 2;
    else if (a === 'block' && !isLast && !split) {
      let spaces = 0;
      for (let i = lineStart; i < contentEnd; i++) if (text[i] === ' ') spaces++;
      if (spaces) nSpaceAdd = free / spaces;
    }
    const line: SwLineLayout = { nStart: lineStart, nLen: pos - lineStart, portions, nX: lineOrigin + shift, nWidth: visible, nHeight, nAscent: ascent, nRealHeight: nLineHeight, nSpaceAdd, nTextHeight };
    if (bidi && !split) {
      // SwTextFormatter::BuildMultiPortion for bidi text, reduced: the portions are split into
      // direction runs and put in visual order; a right-to-left line is then mirrored.
      line.portions = ReorderBidi(text, portions, rtl ? 1 : 0, (f, x0, x1) => measure(f, x0, x1));
      line.bBidi = true;
      line.nSpaceAdd = 0;
      const total = line.portions.reduce((w, p) => w + p.nWidth, 0);
      if (rtl) line.nX = nAreaWidth - (lineOrigin + shift) - total;
    }
    return { line, hardBreak };
  };

  /** The spans for a line, or null when an object blocks it entirely (then `skip` is set). */
  let skip = 0;
  const spansFor = (isFirst: boolean, height: number): [number, number][] | null => {
    const leftIndent = lr.left + (isFirst ? lr.firstLine : 0);
    const own: [number, number] = [leftIndent, Math.max(leftIndent + 1, nAreaWidth - lr.right)];
    const area = opt.lineArea?.(lineTop, height);
    if (!area) return [own];
    // The spans beside objects are physical; a right-to-left line takes them mirrored, from its start.
    const phys = rtl ? area.segs.map(([a, b]) => [nAreaWidth - b, nAreaWidth - a] as [number, number]).reverse() : area.segs;
    const segs = phys.map(([a, b]) => [Math.max(a, own[0]), Math.min(b, own[1])] as [number, number]).filter(([a, b]) => b - a >= MIN_SEG);
    if (segs.length) return segs;
    skip = Math.max(1, area.next - lineTop);
    return null;
  };

  for (;;) {
    const isFirst = !hadText && (opt.nStart ?? 0) === 0;
    if (!estHeight) {
      const fm = m.GetFontMetric(fontAt(node, Math.min(pos, Math.max(0, text.length - 1))));
      estHeight = fm.ascent + fm.descent;
    }
    let segs = spansFor(isFirst, estHeight);
    if (!segs) {
      // SwTextFormatter::FormatLine with a fly portion over the whole line: an empty line down to
      // the object's bottom edge.
      lines.push({ nStart: pos, nLen: 0, portions: [], nX: 0, nWidth: 0, nHeight: skip, nAscent: skip, nRealHeight: skip, nSpaceAdd: 0 });
      lineTop += skip;
      continue;
    }
    const pos0 = pos, run0 = runIdx;
    let built = buildLine(segs, isFirst);
    if (opt.lineArea && built.line.nRealHeight > estHeight) {
      // The line turned out taller than assumed: format it again for the area it really covers.
      const again = spansFor(isFirst, built.line.nRealHeight);
      if (!again) { pos = pos0; runIdx = run0; estHeight = built.line.nRealHeight; lines.push({ nStart: pos, nLen: 0, portions: [], nX: 0, nWidth: 0, nHeight: skip, nAscent: skip, nRealHeight: skip, nSpaceAdd: 0 }); lineTop += skip; continue; }
      if (JSON.stringify(again) !== JSON.stringify(segs)) { pos = pos0; runIdx = run0; segs = again; built = buildLine(segs, isFirst); }
    }
    lines.push(built.line);
    hadText = true;
    lineTop += built.line.nRealHeight;
    estHeight = built.line.nRealHeight;
    openLine = built.hardBreak && pos === text.length;
    if (!(pos < text.length || openLine)) break;
    // A line that took nothing (no span wide enough for a single character) must not loop forever.
    if (pos === pos0 && !built.hardBreak) {
      if (!opt.lineArea) break;
      const blocked = Math.max(1, built.line.nRealHeight);
      lines[lines.length - 1] = { ...built.line, portions: [], nLen: 0, nRealHeight: blocked };
    }
  }

  return { lines, nHeight: lines.reduce((h, l) => h + l.nRealHeight, 0) };
}

/**
 * The horizontal pieces a range [a, b) of a line covers: one for left-to-right lines, one per
 * direction run in visual order for bidi lines (SwTextCursor's selection painting, reduced).
 */
export function LineRangeX(text: string, l: SwLineLayout, a: number, b: number, m: TextMeasurer): [number, number][] {
  if (!l.bBidi) return [[LineXAt(text, l, a, m), LineXAt(text, l, b, m)]];
  const out: [number, number][] = [];
  for (const p of l.portions) {
    const s = Math.max(a, p.nStart), e = Math.min(b, p.nStart + p.nLen);
    if (s >= e) continue;
    const w = (to: number) => (p.kind === 'text' && !p.font.hidden ? GetTextSize(m, p.font, text.slice(p.nStart, to)) : to > p.nStart ? p.nWidth : 0);
    const x0 = w(s), x1 = w(e);
    out.push((p.nLevel ?? 0) % 2 ? [p.nX + p.nWidth - x1, p.nX + p.nWidth - x0] : [p.nX + x0, p.nX + x1]);
  }
  return out;
}

/** Horizontal offset of content position `pos` within line `l`, including justification. */
export function LineXAt(text: string, l: SwLineLayout, pos: number, m: TextMeasurer): number {
  if (l.bBidi) {
    // Visual order: the portion holding the position, measured from its start edge.
    const width = (p: SwLinePortion, to: number) => (p.kind === 'text' && !p.font.hidden ? GetTextSize(m, p.font, text.slice(p.nStart, to)) : to > p.nStart ? p.nWidth : 0);
    const hit = l.portions.find((p) => pos >= p.nStart && pos < p.nStart + p.nLen) ?? l.portions.find((p) => p.nLen && pos === p.nStart + p.nLen);
    if (!hit) return l.portions.length ? Math.min(...l.portions.map((p) => p.nX)) : 0;
    const w = width(hit, Math.min(pos, hit.nStart + hit.nLen));
    return (hit.nLevel ?? 0) % 2 ? hit.nX + hit.nWidth - w : hit.nX + w;
  }
  let x = 0;
  for (const p of l.portions) {
    if (pos >= p.nStart + p.nLen) { x = p.nX + p.nWidth; continue; }
    if (pos <= p.nStart) return p.nX + spacesBefore(text, l, p.nStart) * l.nSpaceAdd;
    x = p.nX + (p.kind === 'text' && !p.font.hidden ? GetTextSize(m, p.font, text.slice(p.nStart, pos)) : 0);
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
