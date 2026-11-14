// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/html/parcss1.cxx reduced
// @upstream sw/source/filter/html/parcss1.hxx reduced
// @upstream sw/source/filter/html/svxcss1.cxx reduced
// @upstream sw/source/filter/html/svxcss1.hxx reduced
// CSS1 for the HTML filter: style sheets and STYLE options are split into rules and declarations
// (CSS1Parser), and the declarations become Writer attributes (SvxCSS1Parser's ParseCSS1_*
// functions). Differences: the expression grammar is reduced to space and comma separated values
// (no backslash escapes); only simple selectors (tag, .class, tag.class and #id, also in lists) are
// kept, pseudo classes and nested selectors are dropped; the supported properties are color,
// background(-color), font and its parts, text-decoration, text-transform, text-align,
// text-indent, line-height, margin, padding, border, page-break-before/after, direction, width
// and height (for images and tables), white-space and display; letter-spacing, positioning, float, lists and drop caps
// are not ported. "em" and "%" in lengths are taken relative to 12 pt.
import type { SwAttrSet, SvxBorderLine, SvxParaBox } from '../../../inc/hintids.ts';
import { GetHTMLColor } from '../../../../svtools/source/svhtml/htmlkywd.ts';

/** officecfg Office.Common/Filter/HTML/Import/FontSize/Size_1..7, in twips. */
export const aFontHeights = [140, 200, 240, 280, 360, 480, 720];

/** A selector: its tag (lower case, '' for any), class and id. */
export interface CSS1Selector { aToken: string; aClass: string; aId: string }
/** A rule of a style sheet. */
export interface CSS1Rule { aSelectors: CSS1Selector[]; aDecls: [string, string][] }

/** What the declarations set besides attributes (SvxCSS1PropertyInfo). */
export interface SvxCSS1PropertyInfo {
  /** width and height of images and tables, in twips, or percent of the available width. */
  nWidth?: number; bWidthPercent?: boolean;
  nHeight?: number;
  /** display: none */
  bHidden?: boolean;
  /** display: block (of a list item: a list header) */
  bDisplayBlock?: boolean;
  /** white-space: pre, pre-wrap or break-spaces (HTMLParser::m_bPreserveSpaces) */
  bPreserveSpaces?: boolean;
  /** The four borders and padding, applied by SetBoxItem. */
  aBorders?: Partial<Record<'top' | 'bottom' | 'left' | 'right', SvxBorderLine | null>>;
  nPadding?: number;
  /** The margins, merged into RES_LR_SPACE and RES_UL_SPACE by the caller with its defaults. */
  nLeftMargin?: number; nRightMargin?: number; nTextIndent?: number; nTopMargin?: number; nBottomMargin?: number;
}

/** CSS1Parser::ParseStyleSheet: the rules of a style sheet. @rules (@page, @media) are skipped. */
export function ParseStyleSheet(rIn: string): CSS1Rule[] {
  const s = rIn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--|-->/g, ' ');
  const rules: CSS1Rule[] = [];
  let nPos = 0;
  while (nPos < s.length) {
    const nOpen = s.indexOf('{', nPos);
    if (nOpen < 0) break;
    const sSel = s.slice(nPos, nOpen).trim();
    // the block, with nested blocks (@media) skipped as a whole
    let nDepth = 1, nEnd = nOpen + 1;
    while (nEnd < s.length && nDepth) { if (s[nEnd] === '{') nDepth++; else if (s[nEnd] === '}') nDepth--; nEnd++; }
    const sBlock = s.slice(nOpen + 1, nEnd - 1);
    nPos = nEnd;
    // An @import before the first rule ends with ';' instead of a block.
    const sel = sSel.replace(/^(@import[^;]*;\s*)+/, '');
    if (!sel || sel.startsWith('@')) continue;
    const aSelectors: CSS1Selector[] = [];
    for (const one of sel.split(',')) {
      const m = /^\s*([A-Za-z][\w-]*)?(?:\.([\w-]+))?(?:#([\w-]+))?\s*$/.exec(one);
      if (m && (m[1] || m[2] || m[3])) aSelectors.push({ aToken: (m[1] ?? '').toLowerCase(), aClass: m[2] ?? '', aId: m[3] ?? '' });
    }
    if (aSelectors.length) rules.push({ aSelectors, aDecls: ParseDeclarations(sBlock) });
  }
  return rules;
}

/** CSS1Parser::ParseStyleOption: the declarations of a STYLE option, in order. */
export function ParseDeclarations(rIn: string): [string, string][] {
  const out: [string, string][] = [];
  for (const decl of rIn.split(/;(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/)) {
    const nColon = decl.indexOf(':');
    if (nColon < 0) continue;
    const sProp = decl.slice(0, nColon).trim().toLowerCase();
    const sValue = decl.slice(nColon + 1).replace(/!\s*important\s*$/i, '').trim();
    if (sProp && sValue) out.push([sProp, sValue]);
  }
  return out;
}

/** CSS1Expression::GetColor, with the HTML colour names: '#rrggbb', or undefined. */
export function GetColor(rValue: string): string | undefined {
  const v = rValue.trim().toLowerCase();
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  let m = /^#?([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]}`;
  // RGBA: the colour on white (CSS1Expression::GetColor, tdf#147398)
  const onWhite = (r: number, g: number, b: number, a: number) => hex([r, g, b].map((c) => Math.trunc((c * a + 255 * (255 - a)) / 255)).reduce((n, c) => (n << 8) | c, 0));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(v);
  if (m) { const n = parseInt(m[1]!, 16); return onWhite(n >> 16, (n >> 8) & 0xff, n & 0xff, parseInt(m[2]!, 16)); }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?/.exec(v);
  if (m) {
    const c = (x: string) => Math.max(0, Math.min(255, Math.round(x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x))));
    if (m[4] !== undefined) {
      const a = Math.max(0, Math.min(255, Math.round(m[4].endsWith('%') ? parseFloat(m[4]) * 2.55 : parseFloat(m[4]) * 255)));
      return onWhite(c(m[1]!), c(m[2]!), c(m[3]!), a);
    }
    return hex((c(m[1]!) << 16) | (c(m[2]!) << 8) | c(m[3]!));
  }
  const n = GetHTMLColor(v);
  if (n !== 0xffffffff) return hex(n);
  // HTML colour values without '#' (bgcolor=ff0000) are read as hex by the HTML parser.
  return undefined;
}

/** A CSS length in twips (CSS1Expression::GetULength and PixelToTwip); undefined if it is none. */
export function GetLength(rValue: string, bAllowNumber = false): number | undefined {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px|em|ex|%)?$/i.exec(rValue.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  if (Number.isNaN(n)) return undefined;
  const unit = (m[2] ?? '').toLowerCase();
  if (!unit && !(bAllowNumber || n === 0)) return undefined;
  const f: Record<string, number> = { cm: 1440 / 2.54, mm: 144 / 2.54, in: 1440, pt: 20, pc: 240, px: 15, em: 240, ex: 120, '%': 2.4, '': 15 };
  return Math.round(n * f[unit]!);
}

const aBorderWidths = [1, 15, 40]; // thin, medium, thick (DEF_LINE_WIDTH_0..2, in twips)

/** ParseCSS1_border_xxx: a border line, null for none, undefined if the value says nothing. */
function ParseBorder(rValue: string): SvxBorderLine | null | undefined {
  let width: number | undefined, color: string | undefined, bNone = false, bStyle = false;
  for (const part of rValue.trim().split(/\s+(?![^(]*\))/)) {
    const p = part.toLowerCase();
    if (p === 'none' || p === 'hidden') { bNone = true; continue; }
    if (/^(dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(p)) { bStyle = true; continue; }
    const w = ['thin', 'medium', 'thick'].indexOf(p);
    if (w >= 0) { width = aBorderWidths[w]; continue; }
    const len = GetLength(p);
    if (len !== undefined) { width = len; continue; }
    const c = GetColor(p);
    if (c) color = c;
  }
  if (bNone || width === 0) return null;
  if (!bStyle && width === undefined && !color) return undefined;
  return { color: color ?? '#000000', width: Math.max(1, width ?? aBorderWidths[1]!) };
}

/** The four values of a margin or padding shorthand: top, right, bottom, left. */
function Sides(rValue: string): (number | undefined)[] {
  const v = rValue.trim().split(/\s+/).map((x) => (x === 'auto' ? undefined : GetLength(x)));
  const [t, r = t, b = t, l = r] = v;
  return [t, r, b, l];
}

/** ParseCSS1_font_family: the first family; a generic one becomes the LibreOffice font for it. */
function ParseFontFamily(rValue: string): string | undefined {
  const generic: Record<string, string> = { serif: 'Liberation Serif', 'sans-serif': 'Liberation Sans', monospace: 'Liberation Mono', cursive: 'Liberation Serif', fantasy: 'Liberation Sans' };
  const names = rValue.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  if (!names.length) return undefined;
  return names[0]!.toLowerCase() in generic ? generic[names[0]!.toLowerCase()] : names[0];
}

/** ParseCSS1_font_size */
function ParseFontSize(rValue: string): number | undefined {
  const v = rValue.trim().toLowerCase();
  const nSize = ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large'].indexOf(v);
  if (nSize >= 0) return aFontHeights[nSize];
  if (v === 'smaller') return 200;
  if (v === 'larger') return 280;
  const n = GetLength(v);
  return n && n > 0 ? n : undefined;
}

/**
 * SvxCSS1Parser::ParseProperty for each declaration: the attributes go into rItemSet (character
 * attributes, RES_BACKGROUND for any background, paragraph attributes), the rest into rPropInfo.
 */
export function ParseProperties(aDecls: [string, string][], rItemSet: SwAttrSet, rPropInfo: SvxCSS1PropertyInfo): void {
  for (const [sProp, sValue] of aDecls) {
    const v = sValue.trim();
    const lv = v.toLowerCase();
    switch (sProp) {
      case 'color': { const c = GetColor(v); if (c) rItemSet.RES_CHRATR_COLOR = c; break; }
      case 'background': case 'background-color': {
        if (lv === 'transparent' || lv === 'none') { rItemSet.RES_BACKGROUND = null; break; }
        const c = v.split(/\s+(?![^(]*\))/).map(GetColor).find((x) => x);
        if (c) rItemSet.RES_BACKGROUND = c;
        break;
      }
      case 'font-weight': {
        const n = parseInt(lv, 10);
        if (!Number.isNaN(n)) rItemSet.RES_CHRATR_WEIGHT = n >= 600;
        else if (['bold', 'bolder', 'extra-bold'].includes(lv)) rItemSet.RES_CHRATR_WEIGHT = true;
        else if (['normal', 'lighter', 'light', 'extra-light', 'demi-light', 'medium', 'demi-bold'].includes(lv)) rItemSet.RES_CHRATR_WEIGHT = false;
        break;
      }
      case 'font-style':
        if (lv === 'italic' || lv === 'oblique') rItemSet.RES_CHRATR_POSTURE = true;
        else if (lv === 'normal') rItemSet.RES_CHRATR_POSTURE = false;
        break;
      case 'font-variant':
        if (lv === 'small-caps') rItemSet.RES_CHRATR_CASEMAP = 'smallcaps';
        else if (lv === 'normal') rItemSet.RES_CHRATR_CASEMAP = 'none';
        break;
      case 'text-transform':
        if (lv === 'uppercase' || lv === 'lowercase' || lv === 'capitalize') rItemSet.RES_CHRATR_CASEMAP = lv;
        else if (lv === 'none') rItemSet.RES_CHRATR_CASEMAP = 'none';
        break;
      case 'font-size': { const n = ParseFontSize(v); if (n) rItemSet.RES_CHRATR_FONTSIZE = n; break; }
      case 'font-family': { const f = ParseFontFamily(v); if (f) rItemSet.RES_CHRATR_FONT = f; break; }
      case 'font': {
        // ParseCSS1_font: [style] [variant] [weight] size[/line-height] family
        const m = /^((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|[1-9]00)\s+)*)([^\s/]+)(?:\s*\/\s*(\S+))?\s+(.+)$/i.exec(v);
        if (!m) break;
        const pre = m[1]!.toLowerCase().split(/\s+/);
        rItemSet.RES_CHRATR_POSTURE = pre.includes('italic') || pre.includes('oblique');
        rItemSet.RES_CHRATR_WEIGHT = pre.some((x) => x === 'bold' || x === 'bolder' || /^[6-9]00$/.test(x));
        if (pre.includes('small-caps')) rItemSet.RES_CHRATR_CASEMAP = 'smallcaps';
        const n = ParseFontSize(m[2]!);
        if (n) rItemSet.RES_CHRATR_FONTSIZE = n;
        if (m[3]) ParseProperties([['line-height', m[3]]], rItemSet, rPropInfo);
        const f = ParseFontFamily(m[4]!);
        if (f) rItemSet.RES_CHRATR_FONT = f;
        break;
      }
      case 'text-decoration': case 'text-decoration-line': {
        const parts = lv.split(/\s+/);
        if (parts.includes('none')) { rItemSet.RES_CHRATR_UNDERLINE = 'none'; rItemSet.RES_CHRATR_CROSSEDOUT = false; rItemSet.RES_CHRATR_OVERLINE = 'none'; break; }
        if (parts.includes('underline')) rItemSet.RES_CHRATR_UNDERLINE = 'single';
        if (parts.includes('line-through')) rItemSet.RES_CHRATR_CROSSEDOUT = true;
        if (parts.includes('overline')) rItemSet.RES_CHRATR_OVERLINE = 'single';
        break;
      }
      case 'text-align':
        if (lv === 'left' || lv === 'start') rItemSet.RES_PARATR_ADJUST = 'left';
        else if (lv === 'right' || lv === 'end') rItemSet.RES_PARATR_ADJUST = 'right';
        else if (lv === 'center') rItemSet.RES_PARATR_ADJUST = 'center';
        else if (lv === 'justify') rItemSet.RES_PARATR_ADJUST = 'block';
        break;
      case 'text-indent': { const n = GetLength(v); if (n !== undefined) rPropInfo.nTextIndent = n; break; }
      case 'line-height': {
        // a number or percentage is proportional, a length the minimum height
        if (lv === 'normal') { rItemSet.RES_PARATR_LINESPACING = { rule: 'proportional', value: 100 }; break; }
        const pm = /^([\d.]+)(%)?$/.exec(lv);
        if (pm) { const n = parseFloat(pm[1]!) * (pm[2] ? 1 : 100); if (n > 0) rItemSet.RES_PARATR_LINESPACING = { rule: 'proportional', value: Math.round(n) }; break; }
        const n = GetLength(v);
        if (n && n > 0) rItemSet.RES_PARATR_LINESPACING = { rule: 'min', value: n };
        break;
      }
      case 'margin-left': { const n = GetLength(v); if (n !== undefined) rPropInfo.nLeftMargin = n; break; }
      case 'margin-right': { const n = GetLength(v); if (n !== undefined) rPropInfo.nRightMargin = n; break; }
      case 'margin-top': { const n = GetLength(v); if (n !== undefined) rPropInfo.nTopMargin = Math.max(0, n); break; }
      case 'margin-bottom': { const n = GetLength(v); if (n !== undefined) rPropInfo.nBottomMargin = Math.max(0, n); break; }
      case 'margin': {
        const [t, r, b, l] = Sides(v);
        if (t !== undefined) rPropInfo.nTopMargin = Math.max(0, t);
        if (r !== undefined) rPropInfo.nRightMargin = r;
        if (b !== undefined) rPropInfo.nBottomMargin = Math.max(0, b);
        if (l !== undefined) rPropInfo.nLeftMargin = l;
        break;
      }
      case 'padding': case 'padding-top': case 'padding-bottom': case 'padding-left': case 'padding-right': {
        // SvxBoxItem has one distance in this port: the largest one given.
        const vals = sProp === 'padding' ? Sides(v) : [GetLength(v)];
        const n = Math.max(...vals.map((x) => x ?? 0));
        rPropInfo.nPadding = Math.max(rPropInfo.nPadding ?? 0, n);
        break;
      }
      case 'border': case 'border-top': case 'border-bottom': case 'border-left': case 'border-right': {
        const line = ParseBorder(v);
        if (line === undefined) break;
        rPropInfo.aBorders ??= {};
        for (const side of sProp === 'border' ? (['top', 'bottom', 'left', 'right'] as const) : [sProp.slice(7) as 'top']) rPropInfo.aBorders[side] = line;
        break;
      }
      case 'page-break-before': case 'break-before':
        if (lv === 'always' || lv === 'page' || lv === 'left' || lv === 'right') rItemSet.RES_BREAK = 'page-before';
        break;
      case 'page-break-after': case 'break-after':
        if (lv === 'always' || lv === 'page' || lv === 'left' || lv === 'right') rItemSet.RES_BREAK = 'page-after';
        else if (lv === 'avoid') rItemSet.RES_KEEP = true;
        break;
      case 'direction':
        if (lv === 'rtl') rItemSet.RES_FRAMEDIR = 'rl-tb';
        else if (lv === 'ltr') rItemSet.RES_FRAMEDIR = 'lr-tb';
        break;
      case 'width': {
        const pm = /^([\d.]+)%$/.exec(lv);
        if (pm) { rPropInfo.nWidth = parseFloat(pm[1]!); rPropInfo.bWidthPercent = true; break; }
        const n = GetLength(v);
        if (n && n > 0) { rPropInfo.nWidth = n; rPropInfo.bWidthPercent = false; }
        break;
      }
      case 'height': { const n = GetLength(v); if (n && n > 0) rPropInfo.nHeight = n; break; }
      case 'display':
        if (lv === 'none') rPropInfo.bHidden = true;
        else if (lv === 'block') rPropInfo.bDisplayBlock = true;
        break;
      case 'white-space': rPropInfo.bPreserveSpaces = lv === 'pre' || lv === 'pre-wrap' || lv === 'break-spaces'; break;
      case 'vertical-align':
        if (lv === 'super') rItemSet.RES_CHRATR_ESCAPEMENT = 33;
        else if (lv === 'sub') rItemSet.RES_CHRATR_ESCAPEMENT = -33;
        break;
    }
  }
}

/** SvxCSS1PropertyInfo::SetBoxItem: the borders as a paragraph box; undefined if none was given. */
export function GetBoxItem(rPropInfo: SvxCSS1PropertyInfo, pOld: SvxParaBox | null = null): SvxParaBox | null | undefined {
  if (!rPropInfo.aBorders && rPropInfo.nPadding === undefined) return undefined;
  const b = rPropInfo.aBorders ?? {};
  const box: SvxParaBox = {
    top: b.top !== undefined ? b.top : pOld?.top ?? null, bottom: b.bottom !== undefined ? b.bottom : pOld?.bottom ?? null,
    left: b.left !== undefined ? b.left : pOld?.left ?? null, right: b.right !== undefined ? b.right : pOld?.right ?? null,
    padding: rPropInfo.nPadding ?? pOld?.padding ?? 0,
  };
  return box.top || box.bottom || box.left || box.right ? box : null;
}
