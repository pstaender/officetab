// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/xml/xmlstyle.cxx reduced
// @upstream sc/source/filter/xml/xmlstyli.cxx reduced
// @upstream xmloff/source/style/PageMasterStyleMap.cxx reduced
// @upstream xmloff/source/style/PageMasterImportPropMapper.cxx reduced
// @upstream sc/source/filter/xml/XMLTableHeaderFooterContext.cxx reduced
// @upstream sc/source/filter/xml/XMLTableMasterPageExport.cxx reduced
// The ODF properties of Calc's styles, between their XML attributes and the item sets:
// aXMLScCellStylesProperties (style:table-cell-properties, the paragraph properties text-align
// and margin-left, and the text properties of the font), the page layout properties of a page
// style (PageMasterStyleMap) with its header and footer sets, and the header and footer contents
// of a master page (XMLTableHeaderFooterContext / XMLTableMasterPageExport) as ScPageHFItems.
// The property handlers (XmlScPropHdl_*) are written inline. Left out: the Asian and complex
// font properties (only the Western font is modelled), complex colours, conditional maps
// (style:map of a cell style), validation references, text shadows' offsets, the decimal
// places of the standard format, glyph orientation and the page layout's background images.
import { child, childElements, escapeXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { ExportBorder, ExportBorderLineWidth, ImportBorder, convertMeasureFromTwips, convertMeasureToTwips } from '../../../../xmloff/source/style/bordrhdl.ts';
import { EditTextObject, type EditCharAttribs, type EditParagraph, type SvxFieldKind } from '../../../../editeng/source/editeng/editobj.ts';
import { SC_POOL_DEFAULTS, type FontLineStyle, type SvxBorderLine, type SvxBoxItem, type ScItemId, type ScItems, type ScItemSet, type ScPageHFItem, type ScPageHFSetItem } from '../../../inc/scitems.ts';

const measure = convertMeasureFromTwips;
const toTwips = convertMeasureToTwips;

/** The fonts a document's styles use, for office:font-face-decls. */
export class ScXMLFontCollector {
  readonly maFonts = new Set<string>();
  Add(rName: string): string { this.maFonts.add(rName); return rName; }
  /** XMLFontAutoStylePool::exportXML */
  Export(): string {
    return `<office:font-face-decls>${[...this.maFonts].map((f) => `<style:font-face style:name="${escapeXml(f)}" svg:font-family="${escapeXml(/\s/.test(f) ? `'${f}'` : f)}"/>`).join('')}</office:font-face-decls>`;
  }
}

/** XMLFontStylesContext: the font-face declarations by style:name. */
export function ImportFontDecls(roots: (XmlElement | undefined)[]): Map<string, string> {
  const fonts = new Map<string, string>();
  for (const root of roots) {
    for (const f of childElements(child(root, 'office:font-face-decls') ?? { name: '', attrs: new Map(), children: [] })) {
      const family = f.attrs.get('svg:font-family');
      if (f.attrs.get('style:name') && family) fonts.set(f.attrs.get('style:name')!, family.replace(/^['"]|['"]$/g, ''));
    }
  }
  return fonts;
}

// ---- text properties (the font of a cell or of a text portion) ----

const UNDERLINE_IN: Record<string, FontLineStyle> = { solid: 'single', dotted: 'dotted', dash: 'dash', 'long-dash': 'dash', 'dot-dash': 'dash', 'dot-dot-dash': 'dash', wave: 'wave' };

function lineOf(tp: XmlElement, kind: 'underline' | 'overline'): FontLineStyle | undefined {
  const st = tp.attrs.get(`style:text-${kind}-style`);
  if (st === undefined) return undefined;
  if (st === 'none') return 'none';
  if (tp.attrs.get(`style:text-${kind}-type`) === 'double') return 'double';
  return UNDERLINE_IN[st] ?? 'single';
}

function lineOut(kind: 'underline' | 'overline', v: FontLineStyle): string {
  if (v === 'none') return ` style:text-${kind}-style="none"`;
  const st = v === 'dotted' ? 'dotted' : v === 'dash' ? 'dash' : v === 'wave' ? 'wave' : 'solid';
  return ` style:text-${kind}-style="${st}"${v === 'double' ? ` style:text-${kind}-type="double"` : ''} style:text-${kind}-width="auto" style:text-${kind}-color="font-color"`;
}

/** The character attributes of style:text-properties (XMLTextPropertySetMapper, the Western font). */
export function ImportTextProperties(tp: XmlElement | undefined, fonts: Map<string, string>): EditCharAttribs & { ATTR_FONT_CONTOUR?: boolean; ATTR_FONT_SHADOWED?: boolean; ATTR_FONT_LANGUAGE?: string; ATTR_FONT_WORDLINE?: boolean } {
  const out: ReturnType<typeof ImportTextProperties> = {};
  if (!tp) return out;
  const a = (k: string) => tp.attrs.get(k);
  const fontName = a('style:font-name');
  const family = (fontName && fonts.get(fontName)) ?? fontName ?? a('fo:font-family')?.replace(/^['"]|['"]$/g, '');
  if (family) out.ATTR_FONT = family;
  const size = a('fo:font-size');
  if (size && !size.endsWith('%')) { const t = toTwips(size); if (t !== undefined) out.ATTR_FONT_HEIGHT = t; }
  const w = a('fo:font-weight');
  if (w) out.ATTR_FONT_WEIGHT = w === 'bold' || (/^\d+$/.test(w) && Number(w) >= 600);
  const st = a('fo:font-style');
  if (st) out.ATTR_FONT_POSTURE = st === 'italic' || st === 'oblique';
  const u = lineOf(tp, 'underline');
  if (u) out.ATTR_FONT_UNDERLINE = u;
  const o = lineOf(tp, 'overline');
  if (o) out.ATTR_FONT_OVERLINE = o;
  const lt = a('style:text-line-through-style');
  if (lt) out.ATTR_FONT_CROSSEDOUT = lt !== 'none';
  const ol = a('style:text-outline');
  if (ol) out.ATTR_FONT_CONTOUR = ol === 'true';
  const sh = a('fo:text-shadow');
  if (sh) out.ATTR_FONT_SHADOWED = sh !== 'none';
  if (a('style:use-window-font-color') === 'true') out.ATTR_FONT_COLOR = null;
  else if (a('fo:color')) out.ATTR_FONT_COLOR = a('fo:color')!.toLowerCase();
  const lang = a('fo:language');
  if (lang) out.ATTR_FONT_LANGUAGE = lang === 'none' ? '' : [lang, a('fo:country')].filter((x) => x && x !== 'none').join('-');
  const mode = a('style:text-underline-mode');
  if (mode) out.ATTR_FONT_WORDLINE = mode === 'skip-white-space';
  const pos = a('style:text-position');
  if (pos) {
    const m = /^(super|sub|-?\d+(?:\.\d+)?%)/.exec(pos);
    if (m) out.ESCAPEMENT = m[1] === 'super' ? 33 : m[1] === 'sub' ? -33 : parseFloat(m[1]!);
  }
  return out;
}

/** The style:text-properties of character attributes ('' when there are none). */
export function ExportTextProperties(s: ReturnType<typeof ImportTextProperties>, fonts: ScXMLFontCollector): string {
  let t = '';
  if (s.ATTR_FONT !== undefined) t += ` style:font-name="${escapeXml(fonts.Add(s.ATTR_FONT))}"`;
  if (s.ATTR_FONT_HEIGHT !== undefined) t += ` fo:font-size="${Number((s.ATTR_FONT_HEIGHT / 20).toFixed(2))}pt"`;
  if (s.ATTR_FONT_WEIGHT !== undefined) t += ` fo:font-weight="${s.ATTR_FONT_WEIGHT ? 'bold' : 'normal'}"`;
  if (s.ATTR_FONT_POSTURE !== undefined) t += ` fo:font-style="${s.ATTR_FONT_POSTURE ? 'italic' : 'normal'}"`;
  if (s.ATTR_FONT_UNDERLINE !== undefined) t += lineOut('underline', s.ATTR_FONT_UNDERLINE);
  if (s.ATTR_FONT_OVERLINE !== undefined) t += lineOut('overline', s.ATTR_FONT_OVERLINE);
  if (s.ATTR_FONT_CROSSEDOUT !== undefined) t += s.ATTR_FONT_CROSSEDOUT ? ' style:text-line-through-style="solid" style:text-line-through-type="single"' : ' style:text-line-through-style="none"';
  if (s.ATTR_FONT_CONTOUR !== undefined) t += ` style:text-outline="${s.ATTR_FONT_CONTOUR}"`;
  if (s.ATTR_FONT_SHADOWED !== undefined) t += ` fo:text-shadow="${s.ATTR_FONT_SHADOWED ? '1pt 1pt' : 'none'}"`;
  if (s.ATTR_FONT_COLOR !== undefined) t += s.ATTR_FONT_COLOR === null ? ' style:use-window-font-color="true"' : ` fo:color="${s.ATTR_FONT_COLOR}"`;
  if (s.ATTR_FONT_LANGUAGE !== undefined) {
    const [l, c] = s.ATTR_FONT_LANGUAGE.split('-');
    t += s.ATTR_FONT_LANGUAGE ? ` fo:language="${l}"${c ? ` fo:country="${c}"` : ' fo:country="none"'}` : ' fo:language="zxx" fo:country="none"';
  }
  if (s.ATTR_FONT_WORDLINE !== undefined) t += ` style:text-underline-mode="${s.ATTR_FONT_WORDLINE ? 'skip-white-space' : 'continuous'}"`;
  if (s.ESCAPEMENT) t += ` style:text-position="${s.ESCAPEMENT === 33 ? 'super' : s.ESCAPEMENT === -33 ? 'sub' : `${s.ESCAPEMENT}%`} 58%"`;
  return t ? `<style:text-properties${t}/>` : '';
}

// ---- cell properties ----

const HOR_IN: Record<string, ScItems['ATTR_HOR_JUSTIFY']> = { start: 'Left', left: 'Left', center: 'Center', end: 'Right', right: 'Right', justify: 'Block' };
const VER_IN: Record<string, ScItems['ATTR_VER_JUSTIFY']> = { automatic: 'Standard', top: 'Top', middle: 'Center', bottom: 'Bottom', justify: 'Block' };
const VER_OUT: Record<ScItems['ATTR_VER_JUSTIFY'], string> = { Standard: 'automatic', Top: 'top', Center: 'middle', Bottom: 'bottom', Block: 'justify' };
const ROT_IN: Record<string, ScItems['ATTR_ROTATE_MODE']> = { none: 'STANDARD', bottom: 'BOTTOM', top: 'TOP', center: 'CENTER' };
const ROT_OUT: Record<ScItems['ATTR_ROTATE_MODE'], string> = { STANDARD: 'none', BOTTOM: 'bottom', TOP: 'top', CENTER: 'center' };
const WRITING_IN: Record<string, ScItems['ATTR_WRITINGDIR']> = { 'lr-tb': 'Horizontal_LR_TB', 'rl-tb': 'Horizontal_RL_TB', lr: 'Horizontal_LR_TB', rl: 'Horizontal_RL_TB', page: 'Environment' };
const WRITING_OUT: Record<ScItems['ATTR_WRITINGDIR'], string> = { Horizontal_LR_TB: 'lr-tb', Horizontal_RL_TB: 'rl-tb', Environment: 'page' };

const asLine = (b: ReturnType<typeof ImportBorder>): SvxBorderLine | null | undefined => b;

/** The four borders of fo:border and its sides with style:border-line-width (XMLBorderHdl). */
function ImportBox(a: (k: string) => string | undefined): SvxBoxItem | undefined {
  const all = asLine(ImportBorder(a('fo:border'), a('style:border-line-width')));
  const side = (s: string) => asLine(ImportBorder(a(`fo:border-${s}`), a(`style:border-line-width-${s}`) ?? a('style:border-line-width')));
  const top = side('top') ?? all, bottom = side('bottom') ?? all, left = side('left') ?? all, right = side('right') ?? all;
  if (top === undefined && bottom === undefined && left === undefined && right === undefined) return undefined;
  return { top: top ?? null, bottom: bottom ?? null, left: left ?? null, right: right ?? null };
}

function ExportBox(b: SvxBoxItem): string {
  let t = '';
  const same = ExportBorder(b.top) === ExportBorder(b.bottom) && ExportBorder(b.top) === ExportBorder(b.left) && ExportBorder(b.top) === ExportBorder(b.right);
  if (same) {
    t += ` fo:border="${ExportBorder(b.top)}"`;
    const w = ExportBorderLineWidth(b.top);
    if (w) t += ` style:border-line-width="${w}"`;
  } else {
    for (const s of ['bottom', 'left', 'right', 'top'] as const) {
      t += ` fo:border-${s}="${ExportBorder(b[s])}"`;
      const w = ExportBorderLineWidth(b[s]);
      if (w) t += ` style:border-line-width-${s}="${w}"`;
    }
  }
  return t;
}

/**
 * The item set of a table-cell style element (XMLTableStyleContext's property import through
 * aXMLScCellStylesProperties). The number format is the caller's (style:data-style-name).
 */
export function ImportCellProperties(styleEl: XmlElement, fonts: Map<string, string>): ScItemSet {
  const out: ScItemSet = {};
  const cp = child(styleEl, 'style:table-cell-properties');
  if (cp) {
    const a = (k: string) => cp.attrs.get(k);
    const bg = a('fo:background-color');
    if (bg) out.ATTR_BACKGROUND = bg === 'transparent' ? null : bg.toLowerCase();
    const box = ImportBox(a);
    if (box) out.ATTR_BORDER = box;
    const tlbr = ImportBorder(a('style:diagonal-tl-br'), a('style:diagonal-tl-br-widths'));
    if (tlbr !== undefined) out.ATTR_BORDER_TLBR = tlbr;
    const bltr = ImportBorder(a('style:diagonal-bl-tr'), a('style:diagonal-bl-tr-widths'));
    if (bltr !== undefined) out.ATTR_BORDER_BLTR = bltr;
    const wrap = a('fo:wrap-option');
    if (wrap) out.ATTR_LINEBREAK = wrap === 'wrap';
    const va = a('style:vertical-align');
    if (va && VER_IN[va]) out.ATTR_VER_JUSTIFY = VER_IN[va];
    const vj = a('loext:vertical-justify') ?? a('style:vertical-justify');
    if (vj) out.ATTR_VER_JUSTIFY_METHOD = vj === 'distribute' ? 'Distribute' : 'Auto';
    const rot = a('style:rotation-angle');
    if (rot) {
      const m = /^(-?[\d.]+)(deg|grad|rad)?$/.exec(rot);
      if (m) {
        let deg = parseFloat(m[1]!);
        if (m[2] === 'grad') deg = (deg * 360) / 400;
        else if (m[2] === 'rad') deg = (deg * 180) / Math.PI;
        out.ATTR_ROTATE_VALUE = Math.round((((deg % 360) + 360) % 360) * 100);
      }
    }
    const ra = a('style:rotation-align');
    if (ra && ROT_IN[ra]) out.ATTR_ROTATE_MODE = ROT_IN[ra];
    const dir = a('style:direction');
    if (dir) out.ATTR_STACKED = dir === 'ttb';
    const shrink = a('style:shrink-to-fit');
    if (shrink) out.ATTR_SHRINKTOFIT = shrink === 'true';
    // XmlScPropHdl_CellProtection and XmlScPropHdl_PrintContent
    const prot = a('style:cell-protect');
    const printContent = a('style:print-content');
    if (prot !== undefined || printContent !== undefined) {
      const p = { ...SC_POOL_DEFAULTS.ATTR_PROTECTION };
      if (prot !== undefined) {
        const toks = prot.split(/\s+/);
        p.bProtection = toks.includes('protected') || toks.includes('hidden-and-protected');
        p.bHideCell = toks.includes('hidden-and-protected');
        p.bHideFormula = toks.includes('formula-hidden') || p.bHideCell;
        if (toks.includes('none')) { p.bProtection = false; p.bHideCell = false; p.bHideFormula = false; }
      }
      if (printContent !== undefined) p.bHidePrint = printContent === 'false';
      out.ATTR_PROTECTION = p;
    }
    const pad = toTwips(a('fo:padding'));
    const padSide = (s: string) => toTwips(a(`fo:padding-${s}`)) ?? pad;
    if ([pad, padSide('left'), padSide('right'), padSide('top'), padSide('bottom')].some((x) => x !== undefined)) {
      const d = SC_POOL_DEFAULTS.ATTR_MARGIN;
      out.ATTR_MARGIN = { left: padSide('left') ?? d.left, top: padSide('top') ?? d.top, right: padSide('right') ?? d.right, bottom: padSide('bottom') ?? d.bottom };
    }
    if (a('style:text-align-source') === 'value-type') out.ATTR_HOR_JUSTIFY = 'Standard';
    const link = a('loext:hyperlink') ?? a('style:hyperlink');
    if (link) out.ATTR_HYPERLINK = link;
    const wm = a('style:writing-mode');
    if (wm && WRITING_IN[wm]) out.ATTR_WRITINGDIR = WRITING_IN[wm];
  }
  const pp = child(styleEl, 'style:paragraph-properties');
  if (pp) {
    const a = (k: string) => pp.attrs.get(k);
    const ta = a('fo:text-align');
    // XmlScPropHdl_HoriJustify: the source "fix" with the alignment; repeat-content makes it Repeat.
    if (ta && HOR_IN[ta] && out.ATTR_HOR_JUSTIFY !== 'Standard') out.ATTR_HOR_JUSTIFY = HOR_IN[ta];
    const ind = toTwips(a('fo:margin-left'));
    if (ind !== undefined) out.ATTR_INDENT = ind;
    const tj = a('css3t:text-justify');
    if (tj) out.ATTR_HOR_JUSTIFY_METHOD = tj === 'distribute' ? 'Distribute' : 'Auto';
    const wm = a('style:writing-mode');
    if (wm && WRITING_IN[wm]) out.ATTR_WRITINGDIR = WRITING_IN[wm];
  }
  if (cp?.attrs.get('style:repeat-content') === 'true') out.ATTR_HOR_JUSTIFY = 'Repeat';
  Object.assign(out, ImportTextProperties(child(styleEl, 'style:text-properties'), fonts));
  return out;
}

/** The property elements of a cell item set (ScXMLAutoStylePoolP / the cell styles' export). */
export function ExportCellProperties(s: ScItemSet, fonts: ScXMLFontCollector): string {
  let cell = '';
  if (s.ATTR_BACKGROUND !== undefined) cell += ` fo:background-color="${s.ATTR_BACKGROUND ?? 'transparent'}"`;
  if (s.ATTR_BORDER !== undefined) cell += ExportBox(s.ATTR_BORDER);
  if (s.ATTR_BORDER_TLBR !== undefined) cell += ` style:diagonal-tl-br="${ExportBorder(s.ATTR_BORDER_TLBR)}"`;
  if (s.ATTR_BORDER_BLTR !== undefined) cell += ` style:diagonal-bl-tr="${ExportBorder(s.ATTR_BORDER_BLTR)}"`;
  if (s.ATTR_STACKED !== undefined) cell += ` style:direction="${s.ATTR_STACKED ? 'ttb' : 'ltr'}"`;
  if (s.ATTR_MARGIN !== undefined) {
    const m = s.ATTR_MARGIN;
    if (m.left === m.right && m.left === m.top && m.left === m.bottom) cell += ` fo:padding="${measure(m.left)}"`;
    else cell += ` fo:padding-bottom="${measure(m.bottom)}" fo:padding-left="${measure(m.left)}" fo:padding-right="${measure(m.right)}" fo:padding-top="${measure(m.top)}"`;
  }
  if (s.ATTR_ROTATE_VALUE !== undefined) cell += ` style:rotation-angle="${Number((s.ATTR_ROTATE_VALUE / 100).toFixed(2))}"`;
  if (s.ATTR_ROTATE_MODE !== undefined) cell += ` style:rotation-align="${ROT_OUT[s.ATTR_ROTATE_MODE]}"`;
  if (s.ATTR_SHRINKTOFIT !== undefined) cell += ` style:shrink-to-fit="${s.ATTR_SHRINKTOFIT}"`;
  if (s.ATTR_HOR_JUSTIFY !== undefined) {
    cell += ` style:text-align-source="${s.ATTR_HOR_JUSTIFY === 'Standard' ? 'value-type' : 'fix'}" style:repeat-content="${s.ATTR_HOR_JUSTIFY === 'Repeat'}"`;
  }
  if (s.ATTR_LINEBREAK !== undefined) cell += ` fo:wrap-option="${s.ATTR_LINEBREAK ? 'wrap' : 'no-wrap'}"`;
  if (s.ATTR_VER_JUSTIFY !== undefined) cell += ` style:vertical-align="${VER_OUT[s.ATTR_VER_JUSTIFY]}"`;
  if (s.ATTR_VER_JUSTIFY_METHOD !== undefined) cell += ` loext:vertical-justify="${s.ATTR_VER_JUSTIFY_METHOD === 'Distribute' ? 'distribute' : 'auto'}"`;
  if (s.ATTR_PROTECTION !== undefined) {
    const p = s.ATTR_PROTECTION;
    let v: string;
    if (!(p.bHideFormula || p.bHideCell || p.bProtection)) v = 'none';
    else if (p.bHideCell) v = 'hidden-and-protected';
    else if (p.bProtection && !p.bHideFormula) v = 'protected';
    else if (p.bHideFormula && !p.bProtection) v = 'formula-hidden';
    else v = 'protected formula-hidden';
    cell += ` style:cell-protect="${v}" style:print-content="${!p.bHidePrint}"`;
  }
  if (s.ATTR_HYPERLINK) cell += ` loext:hyperlink="${escapeXml(s.ATTR_HYPERLINK)}"`;
  let para = '';
  if (s.ATTR_HOR_JUSTIFY !== undefined && s.ATTR_HOR_JUSTIFY !== 'Standard') {
    const ta = s.ATTR_HOR_JUSTIFY === 'Center' ? 'center' : s.ATTR_HOR_JUSTIFY === 'Right' ? 'end' : s.ATTR_HOR_JUSTIFY === 'Block' ? 'justify' : 'start';
    para += ` fo:text-align="${ta}"`;
  }
  if (s.ATTR_HOR_JUSTIFY_METHOD !== undefined) para += ` css3t:text-justify="${s.ATTR_HOR_JUSTIFY_METHOD === 'Distribute' ? 'distribute' : 'auto'}"`;
  if (s.ATTR_INDENT !== undefined) para += ` fo:margin-left="${measure(s.ATTR_INDENT)}"`;
  if (s.ATTR_WRITINGDIR !== undefined) para += ` style:writing-mode="${WRITING_OUT[s.ATTR_WRITINGDIR]}"`;
  return (cell ? `<style:table-cell-properties${cell}/>` : '') + (para ? `<style:paragraph-properties${para}/>` : '') + ExportTextProperties(s, fonts);
}

// ---- page layouts ----

const PRINT_ITEMS: [string, ScItemId][] = [['annotations', 'ATTR_PAGE_NOTES'], ['grid', 'ATTR_PAGE_GRID'], ['headers', 'ATTR_PAGE_HEADERS'], ['formulas', 'ATTR_PAGE_FORMULAS'], ['zero-values', 'ATTR_PAGE_NULLVALS']];
const OBJ_ITEMS: [string, ScItemId][] = [['charts', 'ATTR_PAGE_CHARTS'], ['drawings', 'ATTR_PAGE_DRAWINGS'], ['objects', 'ATTR_PAGE_OBJECTS']];

/** The header or footer set of style:header-style / style:footer-style (bFooter: the body distance is the top margin). */
function ImportHFSet(el: XmlElement | undefined, bFooter: boolean): ScPageHFSetItem {
  const d = SC_POOL_DEFAULTS.ATTR_PAGE_HEADERSET;
  const hp = child(el, 'style:header-footer-properties');
  if (!hp) return { ...d, bOn: false };
  const a = (k: string) => hp.attrs.get(k);
  const min = toTwips(a('fo:min-height')), fixed = toTwips(a('svg:height'));
  const dist = toTwips(a(bFooter ? 'fo:margin-top' : 'fo:margin-bottom')) ?? 0;
  const bg = a('fo:background-color');
  return {
    bOn: true, bDynamic: fixed === undefined, bShared: true, bSharedFirst: true,
    nHeight: (fixed ?? min ?? 0) + (fixed === undefined && min === undefined ? dist : 0) || d.nHeight,
    nLeft: toTwips(a('fo:margin-left')) ?? 0, nRight: toTwips(a('fo:margin-right')) ?? 0,
    nUpper: bFooter ? dist : d.nUpper, nLower: bFooter ? d.nLower : dist,
    aBackground: bg && bg !== 'transparent' ? bg.toLowerCase() : null,
    aBorder: ImportBox(a) ?? { top: null, bottom: null, left: null, right: null },
  };
}

function ExportHFSet(s: ScPageHFSetItem, bFooter: boolean): string {
  if (!s.bOn) return '';
  const dist = bFooter ? s.nUpper : s.nLower;
  let t = s.bDynamic ? ` fo:min-height="${measure(s.nHeight)}"` : ` svg:height="${measure(s.nHeight)}"`;
  t += ` fo:margin-left="${measure(s.nLeft)}" fo:margin-right="${measure(s.nRight)}" fo:margin-${bFooter ? 'top' : 'bottom'}="${measure(dist)}"`;
  const b = s.aBorder;
  if (b.top || b.bottom || b.left || b.right) t += ExportBox(b);
  if (s.aBackground) t += ` fo:background-color="${s.aBackground}"`;
  return `<style:header-footer-properties${t}/>`;
}

/** XMLPageMasterContext with PageMasterImportPropMapper: the page items of a style:page-layout. */
export function ImportPageLayout(pl: XmlElement): ScItemSet {
  const out: ScItemSet = {};
  const pp = child(pl, 'style:page-layout-properties');
  if (pp) {
    const a = (k: string) => pp.attrs.get(k);
    const w = toTwips(a('fo:page-width')), h = toTwips(a('fo:page-height'));
    if (w !== undefined || h !== undefined) out.ATTR_PAGE_SIZE = { nWidth: w ?? SC_POOL_DEFAULTS.ATTR_PAGE_SIZE.nWidth, nHeight: h ?? SC_POOL_DEFAULTS.ATTR_PAGE_SIZE.nHeight };
    const orient = a('style:print-orientation'), numFmt = a('style:num-format');
    if (orient !== undefined || numFmt !== undefined) out.ATTR_PAGE = { ...SC_POOL_DEFAULTS.ATTR_PAGE, bLandscape: orient === 'landscape', eNumType: numFmt ?? '1' };
    const all = toTwips(a('fo:margin'));
    const m = (s: string) => toTwips(a(`fo:margin-${s}`)) ?? all;
    if (m('left') !== undefined || m('right') !== undefined) out.ATTR_LRSPACE = { nLeft: m('left') ?? 0, nRight: m('right') ?? 0 };
    if (m('top') !== undefined || m('bottom') !== undefined) out.ATTR_ULSPACE = { nUpper: m('top') ?? 0, nLower: m('bottom') ?? 0 };
    const box = ImportBox(a);
    if (box) out.ATTR_BORDER = box;
    const bg = a('fo:background-color');
    if (bg) out.ATTR_BACKGROUND = bg === 'transparent' ? null : bg.toLowerCase();
    // XMLPMPropHdl_Print: the listed elements are printed.
    const print = a('style:print');
    if (print !== undefined) {
      const toks = new Set(print.split(/\s+/));
      for (const [tok, id] of PRINT_ITEMS) (out as Record<string, unknown>)[id] = toks.has(tok);
      for (const [tok, id] of OBJ_ITEMS) (out as Record<string, unknown>)[id] = toks.has(tok) ? 'Show' : 'Hide';
    }
    const order = a('style:print-page-order');
    if (order) out.ATTR_PAGE_TOPDOWN = order !== 'ltr';
    const first = a('style:first-page-number');
    if (first) out.ATTR_PAGE_FIRSTPAGENO = first === 'continue' ? 0 : Number(first) || 0;
    const scale = a('style:scale-to');
    if (scale) out.ATTR_PAGE_SCALE = Math.round(parseFloat(scale));
    const pages = a('style:scale-to-pages');
    if (pages) out.ATTR_PAGE_SCALETOPAGES = Number(pages);
    const x = a('style:scale-to-X') ?? a('loext:scale-to-X'), y = a('style:scale-to-Y') ?? a('loext:scale-to-Y');
    if (x !== undefined || y !== undefined) out.ATTR_PAGE_SCALETO = { nWidth: Number(x ?? 0), nHeight: Number(y ?? 0) };
    const center = a('style:table-centering');
    if (center) {
      out.ATTR_PAGE_HORCENTER = center === 'horizontal' || center === 'both';
      out.ATTR_PAGE_VERCENTER = center === 'vertical' || center === 'both';
    }
    const wm = a('style:writing-mode');
    if (wm && WRITING_IN[wm]) out.ATTR_WRITINGDIR = WRITING_IN[wm];
  }
  out.ATTR_PAGE_HEADERSET = ImportHFSet(child(pl, 'style:header-style'), false);
  out.ATTR_PAGE_FOOTERSET = ImportHFSet(child(pl, 'style:footer-style'), true);
  return out;
}

/** XMLPageExport::exportPageMaster: a style:page-layout of the page style's items. */
export function ExportPageLayout(sName: string, get: <K extends ScItemId>(k: K) => ScItems[K]): string {
  const size = get('ATTR_PAGE_SIZE'), page = get('ATTR_PAGE'), lr = get('ATTR_LRSPACE'), ul = get('ATTR_ULSPACE');
  let t = ` fo:page-width="${measure(size.nWidth)}" fo:page-height="${measure(size.nHeight)}" style:num-format="${escapeXml(page.eNumType)}" style:print-orientation="${page.bLandscape ? 'landscape' : 'portrait'}"`;
  t += ` fo:margin-top="${measure(ul.nUpper)}" fo:margin-bottom="${measure(ul.nLower)}" fo:margin-left="${measure(lr.nLeft)}" fo:margin-right="${measure(lr.nRight)}"`;
  const bg = get('ATTR_BACKGROUND');
  if (bg) t += ` fo:background-color="${bg}"`;
  const box = get('ATTR_BORDER');
  if (box.top || box.bottom || box.left || box.right) t += ExportBox(box);
  const print = [...PRINT_ITEMS.filter(([, id]) => get(id) === true).map(([tok]) => tok), ...OBJ_ITEMS.filter(([, id]) => get(id) === 'Show').map(([tok]) => tok)].sort();
  t += ` style:print="${print.join(' ')}" style:print-page-order="${get('ATTR_PAGE_TOPDOWN') ? 'ttb' : 'ltr'}"`;
  const first = get('ATTR_PAGE_FIRSTPAGENO');
  t += ` style:first-page-number="${first === 0 ? 'continue' : first}"`;
  const scaleTo = get('ATTR_PAGE_SCALETO'), pages = get('ATTR_PAGE_SCALETOPAGES');
  if (scaleTo.nWidth || scaleTo.nHeight) t += ` loext:scale-to-X="${scaleTo.nWidth}" loext:scale-to-Y="${scaleTo.nHeight}"`;
  else if (pages) t += ` style:scale-to-pages="${pages}"`;
  else t += ` style:scale-to="${get('ATTR_PAGE_SCALE')}%"`;
  const h = get('ATTR_PAGE_HORCENTER'), v = get('ATTR_PAGE_VERCENTER');
  t += ` style:table-centering="${h && v ? 'both' : h ? 'horizontal' : v ? 'vertical' : 'none'}"`;
  t += ` style:writing-mode="${WRITING_OUT[get('ATTR_WRITINGDIR') === 'Environment' ? 'Horizontal_LR_TB' : get('ATTR_WRITINGDIR')]}"`;
  return `<style:page-layout style:name="${sName}"><style:page-layout-properties${t}/><style:header-style>${ExportHFSet(get('ATTR_PAGE_HEADERSET'), false)}</style:header-style><style:footer-style>${ExportHFSet(get('ATTR_PAGE_FOOTERSET'), true)}</style:footer-style></style:page-layout>`;
}

// ---- header and footer contents ----

const FIELD_ELEMENTS: Record<string, SvxFieldKind> = {
  'text:page-number': 'PAGE', 'text:page-count': 'PAGES', 'text:sheet-name': 'TABLE', 'text:date': 'DATE', 'text:time': 'TIME', 'text:file-name': 'FILE', 'text:title': 'TITLE',
};
const FIELD_OUT: Record<SvxFieldKind, string> = { PAGE: 'text:page-number', PAGES: 'text:page-count', TABLE: 'text:sheet-name', DATE: 'text:date', TIME: 'text:time', FILE: 'text:file-name', TITLE: 'text:title' };

/**
 * The paragraphs of text:p elements as edit text: spans (by their text styles) become character
 * attributes, the header and footer fields and text:a links fields of the portion.
 */
export function ImportParagraphs(ps: XmlElement[], textStyles: Map<string, EditCharAttribs>): EditTextObject {
  const paras: EditParagraph[] = ps.map((p) => {
    const para: EditParagraph = { aText: '', maCharAttribs: [] };
    const walk = (e: XmlElement, attrs: EditCharAttribs) => {
      for (const c of e.children) {
        if (typeof c === 'string') {
          const s = c;
          if (s && Object.keys(attrs).length) para.maCharAttribs.push({ nStart: para.aText.length, nEnd: para.aText.length + s.length, aAttribs: { ...attrs } });
          para.aText += s;
          continue;
        }
        if (c.name === 'text:s') { const n = Number(c.attrs.get('text:c') ?? 1); walk({ name: '', attrs: new Map(), children: [' '.repeat(n)] }, attrs); continue; }
        if (c.name === 'text:tab') { walk({ name: '', attrs: new Map(), children: ['\t'] }, attrs); continue; }
        if (c.name === 'text:line-break') { walk({ name: '', attrs: new Map(), children: ['\n'] }, attrs); continue; }
        if (c.name === 'text:span') { walk(c, { ...attrs, ...(textStyles.get(c.attrs.get('text:style-name') ?? '') ?? {}) }); continue; }
        if (c.name === 'text:a') { walk(c, { ...attrs, URL: c.attrs.get('xlink:href') ?? '' }); continue; }
        const f = FIELD_ELEMENTS[c.name];
        if (f) {
          const start = para.aText.length;
          walk(c, {});
          if (para.aText.length === start) para.aText += ' ';
          para.maCharAttribs = para.maCharAttribs.filter((r) => r.nStart < start);
          para.maCharAttribs.push({ nStart: start, nEnd: para.aText.length, aAttribs: { ...attrs, FIELD: f } });
          continue;
        }
        walk(c, attrs);
      }
    };
    walk(p, {});
    return para;
  });
  return new EditTextObject(paras);
}

/** The text:p elements of edit text, the character attributes as text styles (`textStyle` names them). */
export function ExportParagraphs(t: EditTextObject, textStyle: (a: EditCharAttribs) => string | null): string {
  let out = '';
  for (const p of t.GetParagraphs()) {
    let body = '';
    const runs = [...p.maCharAttribs].sort((x, y) => x.nStart - y.nStart);
    const text = (s: string) => {
      let r = '';
      for (const part of s.split(/(\t|\n| {2,})/)) {
        if (part === '\t') r += '<text:tab/>';
        else if (part === '\n') r += '<text:line-break/>';
        else if (/^ {2,}$/.test(part)) r += ` <text:s text:c="${part.length - 1}"/>`;
        else r += escapeXml(part);
      }
      return r.replace(/^ /, '<text:s/>');
    };
    let pos = 0;
    for (const r of runs) {
      if (r.nStart < pos) continue;
      body += text(p.aText.slice(pos, r.nStart));
      const s = p.aText.slice(r.nStart, r.nEnd);
      const { FIELD, URL, ...rest } = r.aAttribs;
      let inner = FIELD ? `<${FIELD_OUT[FIELD]}>${escapeXml(s)}</${FIELD_OUT[FIELD]}>` : text(s);
      if (URL !== undefined) inner = `<text:a xlink:href="${escapeXml(URL)}" xlink:type="simple">${inner}</text:a>`;
      const st = Object.keys(rest).length ? textStyle(rest) : null;
      body += st ? `<text:span text:style-name="${st}">${inner}</text:span>` : inner;
      pos = r.nEnd;
    }
    body += text(p.aText.slice(pos));
    out += `<text:p>${body}</text:p>`;
  }
  return out;
}

/** XMLTableHeaderFooterContext: a style:header (or footer, left, first) as an ScPageHFItem. */
export function ImportHeaderFooter(el: XmlElement, textStyles: Map<string, EditCharAttribs>): ScPageHFItem {
  const kids = childElements(el);
  const region = (n: string) => { const r = kids.find((k) => k.name === `style:region-${n}`); return r ? ImportParagraphs(childElements(r).filter((p) => p.name === 'text:p'), textStyles) : null; };
  const ps = kids.filter((k) => k.name === 'text:p');
  if (ps.length) return { pLeftArea: null, pCenterArea: ImportParagraphs(ps, textStyles), pRightArea: null };
  return { pLeftArea: region('left'), pCenterArea: region('center'), pRightArea: region('right') };
}

const areaText = (t: EditTextObject | null) => (t ? t.GetString() : '');

/** XMLTableMasterPageExport::exportHeaderFooter */
export function ExportHeaderFooter(h: ScPageHFItem, sName: string, bDisplay: boolean, textStyle: (a: EditCharAttribs) => string | null): string {
  const sCenter = areaText(h.pCenterArea), sLeft = areaText(h.pLeftArea), sRight = areaText(h.pRightArea);
  let body = '';
  if (sCenter && !sLeft && !sRight) body = ExportParagraphs(h.pCenterArea!, textStyle);
  else {
    if (sLeft) body += `<style:region-left>${ExportParagraphs(h.pLeftArea!, textStyle)}</style:region-left>`;
    if (sCenter) body += `<style:region-center>${ExportParagraphs(h.pCenterArea!, textStyle)}</style:region-center>`;
    if (sRight) body += `<style:region-right>${ExportParagraphs(h.pRightArea!, textStyle)}</style:region-right>`;
  }
  return `<${sName}${bDisplay ? '' : ' style:display="false"'}>${body}</${sName}>`;
}
