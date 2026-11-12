// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/xml/swxml.cxx reduced
// @upstream sw/source/filter/xml/wrtxml.cxx reduced
// @upstream sw/source/filter/xml/xmlfmt.cxx reduced
// @upstream xmloff/source/text/txtparai.cxx reduced
// @upstream xmloff/source/text/txtparae.cxx reduced
// @upstream xmloff/source/style/xmlnume.cxx reduced
// @upstream xmloff/source/style/xmlnumi.cxx reduced
// @upstream xmloff/source/text/XMLTextListBlockContext.cxx reduced
// @upstream sw/source/filter/xml/xmltbli.cxx reduced
// @upstream sw/source/filter/xml/xmltble.cxx reduced
// @upstream xmloff/source/draw/ximpshap.cxx reduced
// @upstream xmloff/source/text/txtparae.cxx reduced
// @upstream xmloff/source/style/xmlbahdl.cxx reduced
// Reads and writes paragraphs, spans, styles and page geometry. Unsupported content is reported
// through `ImportResult.lost` so that callers can warn before a save would drop it.
import { ExportGradientStyle, ImportGradientStyle } from '../../../../xmloff/source/style/GradientStyle.ts';
import type { BGradient } from '../../../../basegfx/source/tools/gradienttools.ts';
import { EnhancedCustomShapeSegmentCommand } from '../../../../svx/source/customshapes/EnhancedCustomShape2d.ts';
import { ImportPolyShape } from '../../../../xmloff/source/draw/ximpshap.ts';
import { readZip, writeZip } from '../../../../package/source/zipapi/zip.ts';
import { child, childElements, escapeXml, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { SwPosition } from '../../../inc/pam.ts';
import { MarkType } from '../../core/doc/docbm.ts';
import { MetaOf, SfxDocumentMetaData } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';
import { GetGeneratorString } from '../../../../unotools/source/config/docinfohelper.ts';
import { NormalizeGrfAttr, type SwGrfAttr, type SwMathObj } from '../../../inc/hintids.ts';
import { ImportMathMLString } from '../../../../starmath/source/mathml/mathmlimport.ts';
import { ExportMathML } from '../../../../starmath/source/mathml/mathmlexport.ts';
import { CH_TXTATR_BREAKWORD, POOL_DEFAULTS, type FontLineStyle, type SvxAdjust, type SvxBorderLine, type SwAttrSet, type SwCharAttrSet, type SwAttrs, type SwCropGrf, type SwField, type SwFlyCnt, type SwPostItField, type SwRedlineData } from '../../../inc/hintids.ts';
import { GraphicDrawMode } from '../../../../drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import { ExportNumberStyle, ImportNumberStyles, ValueTypeOf } from '../../../../xmloff/source/style/xmlnumfe.ts';
import { BoxLanguage } from '../../core/fields/cellfml.ts';
import { RecodeBullet } from '../../../../unotools/source/misc/fontcvt.ts';
import { ExportEnhancedGeometry, ImportEnhancedGeometry } from '../../../../xmloff/source/draw/ximpcustomshape.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { GetPrefSizeTwips } from '../../../../vcl/source/filter/GraphicFormatDetector.ts';
import type { SwCharFormat, SwTextFormatColl } from '../../../inc/format.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule, type SvxNumLabelFollowedBy } from '../../../inc/numrule.ts';
import { NumberingType, makeNumberingString } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { ExpandSeq, GetSeqNumbers } from '../../core/fields/expfld.ts';
import { ArrangedMathFly, DefaultExpand } from '../../core/text/itrform2.ts';
import { SwEndNode, SwSectionNode, SwStartNode, SwTableNode, type SwNode, type SwSectionData } from '../../../inc/node.ts';
import { DEF_GUTTER_WIDTH, type SwFormatCol } from '../../../inc/fmtclds.ts';
import { DEFAULT_PAGE_DESC, type SwPageDesc } from '../../../inc/pagedesc.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SwTableAdjust, type SwTableBoxAttrs } from '../../../inc/swtable.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { AsCharFormat, COL_DEFAULT_SHAPE_FILLING, FlyCntOf, COL_DEFAULT_SHAPE_STROKE, HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SdrShape, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';

const MIME = 'application/vnd.oasis.opendocument.text';

export function toTwips(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px|twip)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const f: Record<string, number> = { cm: 1440 / 2.54, mm: 144 / 2.54, in: 1440, pt: 20, pc: 240, px: 15, twip: 1 };
  return Math.round(n * (f[m[2] ?? 'pt'] ?? 20));
}

const twipsToCm = (t: number): string => `${(t * 2.54 / 1440).toFixed(4)}cm`;

// XMLAnchorTypePropHdl, XMLHoriMirrorPropHdl and friends (xmloff/source/text/txtprhdl.cxx): ODF
// position, relation and wrap values and their API constants.
const HORI_POS: Record<string, number> = { left: HoriOrientation.LEFT, center: HoriOrientation.CENTER, right: HoriOrientation.RIGHT, 'from-left': HoriOrientation.NONE, inside: HoriOrientation.INSIDE, outside: HoriOrientation.OUTSIDE, 'from-inside': HoriOrientation.NONE };
const HORI_REL: Record<string, number> = {
  paragraph: RelOrientation.FRAME, 'paragraph-content': RelOrientation.PRINT_AREA, page: RelOrientation.PAGE_FRAME, 'page-content': RelOrientation.PAGE_PRINT_AREA,
  'page-start-margin': RelOrientation.PAGE_LEFT, 'page-end-margin': RelOrientation.PAGE_RIGHT, 'paragraph-start-margin': RelOrientation.FRAME_LEFT,
  'paragraph-end-margin': RelOrientation.FRAME_RIGHT, char: RelOrientation.CHAR, frame: RelOrientation.FRAME, 'frame-content': RelOrientation.PRINT_AREA,
};
const VERT_POS: Record<string, number> = { top: VertOrientation.TOP, middle: VertOrientation.CENTER, bottom: VertOrientation.BOTTOM, 'from-top': VertOrientation.NONE, below: VertOrientation.CHAR_BOTTOM };
const VERT_REL: Record<string, number> = {
  paragraph: RelOrientation.FRAME, 'paragraph-content': RelOrientation.PRINT_AREA, page: RelOrientation.PAGE_FRAME, 'page-content': RelOrientation.PAGE_PRINT_AREA,
  'page-content-top': RelOrientation.PAGE_PRINT_AREA_TOP, 'page-content-bottom': RelOrientation.PAGE_PRINT_AREA_BOTTOM, char: RelOrientation.CHAR,
  line: RelOrientation.TEXT_LINE, baseline: RelOrientation.TEXT_LINE, text: RelOrientation.CHAR, frame: RelOrientation.FRAME, 'frame-content': RelOrientation.PRINT_AREA,
};
const WRAP: Record<string, WrapTextMode> = { none: WrapTextMode.NONE, left: WrapTextMode.LEFT, right: WrapTextMode.RIGHT, parallel: WrapTextMode.PARALLEL, dynamic: WrapTextMode.DYNAMIC, 'run-through': WrapTextMode.THROUGH };
const ANCHOR: Record<string, RndStdIds> = { paragraph: RndStdIds.FLY_AT_PARA, char: RndStdIds.FLY_AT_CHAR, 'as-char': RndStdIds.FLY_AS_CHAR, page: RndStdIds.FLY_AT_PAGE, frame: RndStdIds.FLY_AT_PARA };
const EMPTY_EL: XmlElement = { name: '', attrs: new Map(), children: [] };
const keyOf = <T,>(m: Record<string, T>, v: T, dflt: string): string => Object.keys(m).find((k) => m[k] === v) ?? dflt;

/** XMLTextColumnsContext: style:columns with equal columns, gap and separator. */
function readColumns(props: XmlElement | undefined, balanced = true): SwFormatCol | null {
  const c = child(props, 'style:columns');
  const n = parseInt(c?.attrs.get('fo:column-count') ?? '1', 10) || 1;
  if (!c || n < 2) return null;
  let gap = toTwips(c.attrs.get('fo:column-gap'));
  // Columns of their own widths: the gap is the spacing around the second column.
  if (gap === undefined) {
    const second = childElements(c).filter((x) => x.name === 'style:column')[1];
    gap = (toTwips(second?.attrs.get('fo:start-indent')) ?? 0) * 2 || DEF_GUTTER_WIDTH;
  }
  const sep = child(c, 'style:column-sep');
  return { m_nCount: n, m_nGutterWidth: gap, m_bLine: !!sep && sep.attrs.get('style:style') !== 'none' && (toTwips(sep.attrs.get('style:width')) ?? 1) > 0, m_bBalanced: balanced };
}

function columnsXml(c: SwFormatCol | null): string {
  if (!c || c.m_nCount < 2) return '<style:columns fo:column-count="1" fo:column-gap="0cm"/>';
  return `<style:columns fo:column-count="${c.m_nCount}" fo:column-gap="${twipsToCm(c.m_nGutterWidth)}">${c.m_bLine ? '<style:column-sep style:width="0.02cm" style:color="#000000" style:height="100%" style:vertical-align="top"/>' : ''}</style:columns>`;
}

interface OdfStyle { name: string; display: string; family: string; parent?: string; next?: string; attrs: SwAttrSet; el: XmlElement }

/**
 * The properties of a style element. ODF inherits each margin on its own (fo:margin-top apart from
 * fo:margin-bottom), the model keeps them in one item: `inherited` gives what the style would
 * otherwise have, for the sides it does not set.
 */
function readProps(styleEl: XmlElement, fonts: Map<string, string>, inherited?: <K extends keyof SwAttrs>(k: K) => SwAttrs[K]): SwAttrSet {
  const out: SwAttrSet = {};
  const tp = child(styleEl, 'style:text-properties');
  if (tp) {
    const a = (k: string) => tp.attrs.get(k);
    const size = toTwips(a('fo:font-size'));
    if (size !== undefined) out.RES_CHRATR_FONTSIZE = size;
    const fontName = a('style:font-name') ?? a('fo:font-family');
    if (fontName) out.RES_CHRATR_FONT = fonts.get(fontName) ?? fontName.replace(/^['"]|['"]$/g, '');
    const w = a('fo:font-weight');
    if (w) out.RES_CHRATR_WEIGHT = w === 'bold' || parseInt(w, 10) >= 600;
    const st = a('fo:font-style');
    if (st) out.RES_CHRATR_POSTURE = st === 'italic' || st === 'oblique';
    const ul = a('style:text-underline-style');
    if (ul) {
      const type = a('style:text-underline-type');
      const map: Record<string, FontLineStyle> = { none: 'none', solid: 'single', dotted: 'dotted', dash: 'dash', 'long-dash': 'dash', wave: 'wave' };
      out.RES_CHRATR_UNDERLINE = type === 'double' ? 'double' : map[ul] ?? 'single';
    }
    const lt = a('style:text-line-through-style');
    if (lt) out.RES_CHRATR_CROSSEDOUT = lt !== 'none';
    const c = a('fo:color');
    if (c) out.RES_CHRATR_COLOR = c;
    // XMLIsAutoColorPropHdl: an auto color overrides any other color set.
    if (a('style:use-window-font-color') === 'true') out.RES_CHRATR_COLOR = null;
    const bg = a('fo:background-color');
    if (bg) out.RES_CHRATR_BACKGROUND = bg === 'transparent' ? null : bg;
    // XMLCharBorderHdl: fo:border on text properties is the character border.
    const cb = a('fo:border');
    if (cb !== undefined) {
      const parts = cb.trim().split(/\s+/);
      const w = parts.map((p) => toTwips(p)).find((x) => x !== undefined);
      out.RES_CHRATR_BOX = cb === 'none' || parts.includes('none') || !w ? null : { color: parts.find((p) => p.startsWith('#')) ?? '#000000', width: Math.max(1, w) };
    }
    const tt = a('fo:text-transform');
    if (tt) out.RES_CHRATR_CASEMAP = tt === 'uppercase' ? 'uppercase' : tt === 'lowercase' ? 'lowercase' : tt === 'capitalize' ? 'capitalize' : 'none';
    // XMLCaseMapVariantHdl: fo:font-variant small-caps.
    const fv = a('fo:font-variant');
    if (fv === 'small-caps') out.RES_CHRATR_CASEMAP = 'smallcaps';
    else if (fv === 'normal' && !tt) out.RES_CHRATR_CASEMAP = 'none';
    const ol = a('style:text-overline-style');
    if (ol) {
      const map: Record<string, FontLineStyle> = { none: 'none', solid: 'single', dotted: 'dotted', dash: 'dash', 'long-dash': 'dash', wave: 'wave' };
      out.RES_CHRATR_OVERLINE = a('style:text-overline-type') === 'double' ? 'double' : map[ol] ?? 'single';
    }
    // XMLShadowedPropHdl: any shadow but "none".
    const sh = a('fo:text-shadow');
    if (sh) out.RES_CHRATR_SHADOWED = sh !== 'none';
    const outline = a('style:text-outline');
    if (outline) out.RES_CHRATR_CONTOUR = outline === 'true';
    // SvxLanguageItem: fo:language and fo:country ("none" is no language).
    const lang = a('fo:language');
    if (lang) out.RES_CHRATR_LANGUAGE = lang === 'none' ? 'zxx' : [lang, a('fo:script'), a('fo:country')].filter((x) => x && x !== 'none').join('-');
    const pos = a('style:text-position');
    if (pos) {
      const token = pos.split(/\s+/)[0]!;
      out.RES_CHRATR_ESCAPEMENT = token === 'super' ? 33 : token === 'sub' ? -33 : parseInt(token, 10) || 0;
    }
  }
  const pp = child(styleEl, 'style:paragraph-properties');
  if (pp) {
    const a = (k: string) => pp.attrs.get(k);
    const ta = a('fo:text-align');
    // style:writing-mode: right-to-left paragraphs, whose start is the right edge.
    const wm = a('style:writing-mode');
    const rl = wm === 'rl-tb' || wm === 'rl';
    if (wm === 'rl-tb' || wm === 'rl' || wm === 'lr-tb' || wm === 'lr') out.RES_FRAMEDIR = rl ? 'rl-tb' : 'lr-tb';
    if (ta) {
      const map: Record<string, SvxAdjust> = { start: rl ? 'right' : 'left', left: 'left', end: rl ? 'left' : 'right', right: 'right', center: 'center', justify: 'block' };
      out.RES_PARATR_ADJUST = map[ta] ?? 'left';
    }
    if (a('fo:margin-left') || a('fo:margin-right') || a('fo:text-indent')) {
      const lr = inherited?.('RES_LR_SPACE') ?? { left: 0, right: 0, firstLine: 0 };
      out.RES_LR_SPACE = { left: toTwips(a('fo:margin-left')) ?? lr.left, right: toTwips(a('fo:margin-right')) ?? lr.right, firstLine: toTwips(a('fo:text-indent')) ?? lr.firstLine };
    }
    if (a('fo:margin-top') || a('fo:margin-bottom') || a('style:contextual-spacing')) {
      const ul = inherited?.('RES_UL_SPACE') ?? { upper: 0, lower: 0 };
      const ctx = a('style:contextual-spacing');
      out.RES_UL_SPACE = { upper: toTwips(a('fo:margin-top')) ?? ul.upper, lower: toTwips(a('fo:margin-bottom')) ?? ul.lower, ...((ctx ? ctx === 'true' : ul.context) ? { context: true } : {}) };
    }
    const lh = a('fo:line-height');
    if (lh) {
      if (lh.endsWith('%')) out.RES_PARATR_LINESPACING = { rule: 'proportional', value: parseFloat(lh) };
      else if (lh !== 'normal') out.RES_PARATR_LINESPACING = { rule: 'fix', value: toTwips(lh) ?? 240 };
    }
    const atLeast = toTwips(a('style:line-height-at-least'));
    if (atLeast !== undefined) out.RES_PARATR_LINESPACING = { rule: 'min', value: atLeast };
    const w = a('fo:widows'); if (w) out.RES_PARATR_WIDOWS = parseInt(w, 10);
    const o = a('fo:orphans'); if (o) out.RES_PARATR_ORPHANS = parseInt(o, 10);
    const k = a('fo:keep-with-next'); if (k) out.RES_KEEP = k === 'always';
    if (a('fo:break-before') === 'page') out.RES_BREAK = 'page-before';
    else if (a('fo:break-after') === 'page') out.RES_BREAK = 'page-after';
    const bg = a('fo:background-color');
    if (bg) out.RES_BACKGROUND = bg === 'transparent' ? null : bg;
    // XMLBorderHdl: fo:border and its sides; fo:padding is the distance to the text.
    const borderOf = (v: string | undefined): SvxBorderLine | null | undefined => {
      if (v === undefined) return undefined;
      const parts = v.trim().split(/\s+/);
      if (!v || parts.includes('none') || parts.includes('hidden')) return null;
      const width = parts.map((p) => toTwips(p)).find((w) => w !== undefined) ?? 10;
      return width <= 0 ? null : { color: parts.find((p) => p.startsWith('#')) ?? '#000000', width: Math.max(1, width) };
    };
    const all = borderOf(a('fo:border'));
    const sides = { top: borderOf(a('fo:border-top')) ?? all, bottom: borderOf(a('fo:border-bottom')) ?? all, left: borderOf(a('fo:border-left')) ?? all, right: borderOf(a('fo:border-right')) ?? all };
    if (Object.values(sides).some((x) => x !== undefined)) {
      const box = { top: sides.top ?? null, bottom: sides.bottom ?? null, left: sides.left ?? null, right: sides.right ?? null, padding: toTwips(a('fo:padding') ?? a('fo:padding-left')) ?? 0 };
      out.RES_BOX = box.top || box.bottom || box.left || box.right ? box : null;
    }
    const join = a('style:join-border');
    if (join) out.RES_PARATR_CONNECT_BORDER = join !== 'false';
    const ts = child(pp, 'style:tab-stops');
    if (ts) {
      out.RES_PARATR_TABSTOP = childElements(ts).filter((t) => t.name === 'style:tab-stop').map((t) => {
        const type = t.attrs.get('style:type');
        const leader = t.attrs.get('style:leader-text') ?? (t.attrs.get('style:leader-style') && t.attrs.get('style:leader-style') !== 'none' ? '.' : ' ');
        return {
          pos: toTwips(t.attrs.get('style:position')) ?? 0,
          adjust: type === 'right' ? 'right' : type === 'center' ? 'center' : type === 'char' ? 'decimal' : 'left',
          fill: leader || ' ', decimal: t.attrs.get('style:char') ?? '.',
        } as const;
      }).sort((x, y) => x.pos - y.pos);
    }
  }
  return out;
}

const NUM_FORMATS: Record<string, NumberingType> = {
  '1': NumberingType.ARABIC, A: NumberingType.CHARS_UPPER_LETTER, a: NumberingType.CHARS_LOWER_LETTER,
  I: NumberingType.ROMAN_UPPER, i: NumberingType.ROMAN_LOWER, '': NumberingType.NUMBER_NONE,
};

/** SvxXMLListStyleContext: one text:list-style element as a numbering rule. */
function readListStyle(el: XmlElement, name: string, auto: boolean): SwNumRule {
  const rule = new SwNumRule(name);
  rule.SetAutoRule(auto);
  for (const lvl of childElements(el)) {
    const n = parseInt(lvl.attrs.get('text:level') ?? '0', 10) - 1;
    if (n < 0 || n >= MAXLEVEL) continue;
    const f = new SwNumFormat();
    const a = (k: string) => lvl.attrs.get(k);
    if (lvl.name === 'text:list-level-style-bullet') {
      f.SetNumberingType(NumberingType.CHAR_SPECIAL);
      f.SetBulletChar(RecodeBullet(a('text:bullet-char') || '\u2022'));
      // SvxXMLListLevelStyleContext_Impl: the bullet font from style:text-properties.
      const tp = child(lvl, 'style:text-properties');
      const bf = tp?.attrs.get('fo:font-family') ?? tp?.attrs.get('style:font-name');
      if (bf) f.SetBulletFont(bf.replace(/^'|'$/g, ''));
      f.SetListFormat(a('style:num-prefix') ?? '', a('style:num-suffix') ?? '', n);
    } else if (lvl.name === 'text:list-level-style-number') {
      const fmt = a('style:num-format') ?? '';
      let t = NUM_FORMATS[fmt] ?? NumberingType.ARABIC;
      if (a('style:num-letter-sync') === 'true') {
        if (t === NumberingType.CHARS_UPPER_LETTER) t = NumberingType.CHARS_UPPER_LETTER_N;
        if (t === NumberingType.CHARS_LOWER_LETTER) t = NumberingType.CHARS_LOWER_LETTER_N;
      }
      f.SetNumberingType(t);
      f.SetStart(parseInt(a('text:start-value') ?? '1', 10) || 1);
      f.SetIncludeUpperLevels(parseInt(a('text:display-levels') ?? '1', 10) || 1);
      const listFormat = a('loext:num-list-format');
      if (listFormat !== undefined) f.SetListFormatString(listFormat);
      else f.SetListFormat(a('style:num-prefix') ?? '', a('style:num-suffix') ?? '', n);
    } else continue;
    const props = child(lvl, 'style:list-level-properties');
    const align = props?.attrs.get('fo:text-align');
    f.SetNumAdjust(align === 'end' || align === 'right' ? 'right' : align === 'center' ? 'center' : 'left');
    const la = child(props, 'style:list-level-label-alignment');
    if (la) {
      const fb = la.attrs.get('text:label-followed-by');
      f.SetLabelFollowedBy(fb === 'space' ? 'space' : fb === 'nothing' ? 'nothing' : 'listtab');
      f.SetListtabPos(toTwips(la.attrs.get('text:list-tab-stop-position')) ?? 0);
      f.SetFirstLineIndent(toTwips(la.attrs.get('fo:text-indent')) ?? 0);
      f.SetIndentAt(toTwips(la.attrs.get('fo:margin-left')) ?? 0);
    } else if (props) {
      // LABEL_WIDTH_AND_POSITION is not ported: approximate it with the same label position.
      const before = toTwips(props.attrs.get('text:space-before')) ?? 0;
      const width = toTwips(props.attrs.get('text:min-label-width')) ?? 0;
      f.SetFirstLineIndent(-width);
      f.SetIndentAt(before + width);
      f.SetListtabPos(before + width);
    }
    rule.Set(n, f);
  }
  return rule;
}

const NUM_FORMAT_OUT: Partial<Record<NumberingType, string>> = {
  [NumberingType.ARABIC]: '1', [NumberingType.CHARS_UPPER_LETTER]: 'A', [NumberingType.CHARS_LOWER_LETTER]: 'a',
  [NumberingType.CHARS_UPPER_LETTER_N]: 'A', [NumberingType.CHARS_LOWER_LETTER_N]: 'a',
  [NumberingType.ROMAN_UPPER]: 'I', [NumberingType.ROMAN_LOWER]: 'i', [NumberingType.NUMBER_NONE]: '',
};

/** SvxXMLNumRuleExport::exportLevelStyles, LABEL_ALIGNMENT mode. */
function writeListStyle(rule: SwNumRule, styleName: string, display?: string): string {
  let levels = '';
  for (let n = 0; n < MAXLEVEL; n++) {
    const f = rule.Get(n);
    const followed: Record<SvxNumLabelFollowedBy, string> = { listtab: 'listtab', space: 'space', nothing: 'nothing', newline: 'nothing' };
    const align = f.GetNumAdjust() === 'right' ? ' fo:text-align="end"' : f.GetNumAdjust() === 'center' ? ' fo:text-align="center"' : '';
    const props = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"${align}><style:list-level-label-alignment text:label-followed-by="${followed[f.GetLabelFollowedBy()]}"${f.GetLabelFollowedBy() === 'listtab' ? ` text:list-tab-stop-position="${twipsToCm(f.GetListtabPos())}"` : ''} fo:text-indent="${twipsToCm(f.GetFirstLineIndent())}" fo:margin-left="${twipsToCm(f.GetIndentAt())}"/></style:list-level-properties>`;
    if (f.IsItemize()) {
      const bf = f.GetBulletFont();
      levels += `<text:list-level-style-bullet text:level="${n + 1}" text:bullet-char="${escapeXml(f.GetBulletChar())}">${props}${bf ? `<style:text-properties fo:font-family="${escapeXml(bf)}"/>` : ''}</text:list-level-style-bullet>`;
    } else {
      const t = f.GetNumberingType();
      const sync = t === NumberingType.CHARS_UPPER_LETTER_N || t === NumberingType.CHARS_LOWER_LETTER_N ? ' style:num-letter-sync="true"' : '';
      const fix = f.HasListFormat() ? ` loext:num-list-format="${escapeXml(f.GetListFormat())}"` : '';
      levels += `<text:list-level-style-number text:level="${n + 1}" style:num-prefix="${escapeXml(f.GetPrefix())}" style:num-suffix="${escapeXml(f.GetSuffix())}" style:num-format="${NUM_FORMAT_OUT[t] ?? '1'}"${sync}${fix}${f.GetStart() !== 1 ? ` text:start-value="${f.GetStart()}"` : ''}${f.GetIncludeUpperLevels() > 1 ? ` text:display-levels="${f.GetIncludeUpperLevels()}"` : ''}>${props}</text:list-level-style-number>`;
    }
  }
  return `<text:list-style style:name="${styleName}"${display ? ` style:display-name="${escapeXml(display)}"` : ''}>${levels}</text:list-style>`;
}

const charOnly = (s: SwAttrSet): SwCharAttrSet => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('RES_CHRATR_'))) as SwCharAttrSet;

export interface ImportResult { doc: SwDoc; lost: string[] }

const decodeXml = (b: Uint8Array) => new TextDecoder().decode(b);

/** txtprmap.cxx's RES_GRFATR_* graphic properties: XML_TYPE_PERCENT16, DOUBLE_PERCENT, NEG_PERCENT16, BOOL and COLOR_MODE. */
const COLOR_MODES: Record<string, GraphicDrawMode> = { standard: GraphicDrawMode.Standard, greyscale: GraphicDrawMode.Greys, mono: GraphicDrawMode.Mono, watermark: GraphicDrawMode.Watermark };
function ImportGrfAttr(gp: (n: string) => string | undefined): SwGrfAttr | undefined {
  const percent = (n: string) => { const m = /^\s*(-?[\d.]+)\s*%/.exec(gp(n) ?? ''); return m ? Math.round(parseFloat(m[1]!)) : undefined; };
  const a: SwGrfAttr = {
    m_nLuminance: percent('draw:luminance'), m_nContrast: percent('draw:contrast'),
    m_nChannelR: percent('draw:red'), m_nChannelG: percent('draw:green'), m_nChannelB: percent('draw:blue'),
  };
  // XMLDoublePercentPropHdl: "100%" or a plain number.
  const g = gp('draw:gamma');
  if (g) a.m_fGamma = g.includes('%') ? (percent('draw:gamma') ?? 100) / 100 : parseFloat(g) || 1;
  if (gp('draw:color-inversion') === 'true') a.m_bInvert = true;
  // XML_TYPE_NEG_PERCENT16: the opacity, 100 less the transparency.
  const op = percent('draw:image-opacity');
  if (op !== undefined) a.m_nTransparency = Math.max(0, Math.min(100, 100 - op));
  const mode = COLOR_MODES[gp('draw:color-mode') ?? ''];
  if (mode) a.m_eDrawMode = mode;
  return NormalizeGrfAttr(a);
}
function ExportGrfAttr(a: SwGrfAttr | undefined): string[] {
  if (!a) return [];
  const out: string[] = [];
  const pct = (name: string, v: number | undefined) => { if (v) out.push(`${name}="${v}%"`); };
  pct('draw:luminance', a.m_nLuminance); pct('draw:contrast', a.m_nContrast);
  pct('draw:red', a.m_nChannelR); pct('draw:green', a.m_nChannelG); pct('draw:blue', a.m_nChannelB);
  if (a.m_fGamma !== undefined && a.m_fGamma !== 1) out.push(`draw:gamma="${Math.round(a.m_fGamma * 100)}%"`);
  if (a.m_bInvert) out.push('draw:color-inversion="true"');
  if (a.m_nTransparency) out.push(`draw:image-opacity="${100 - a.m_nTransparency}%"`);
  if (a.m_eDrawMode) out.push(`draw:color-mode="${Object.keys(COLOR_MODES).find((k) => COLOR_MODES[k] === a.m_eDrawMode)}"`);
  return out;
}

export async function ImportODT(bytes: Uint8Array): Promise<ImportResult> {
  const files = await readZip(bytes);
  if (files.has('META-INF/manifest.xml') && new TextDecoder().decode(files.get('META-INF/manifest.xml')).includes('encryption-data')) {
    throw new Error('This document is password-protected. Encrypted documents cannot be opened yet.');
  }
  const contentBytes = files.get('content.xml');
  if (!contentBytes) throw new Error('This file has no content.xml, so it is not an OpenDocument text file.');
  const contentRoot = parseXml(decodeXml(contentBytes));
  const content = child(contentRoot, 'office:document-content');
  const stylesBytes = files.get('styles.xml');
  const stylesDoc = stylesBytes ? child(parseXml(decodeXml(stylesBytes)), 'office:document-styles') : undefined;

  const doc = new SwDoc();
  // SwXMLImport::SetConfigurationSettings: the document settings of settings.xml that are ported.
  const settingsBytes = files.get('settings.xml');
  // SwXMLImport: a setting a document does not have keeps the behaviour before it existed.
  doc.m_bParaSpaceMaxAtPages = false;
  doc.m_bPropLineSpacingShrinksFirstLine = false;
  if (settingsBytes) {
    const shrink = /config:name="PropLineSpacingShrinksFirstLine"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (shrink) doc.m_bPropLineSpacingShrinksFirstLine = shrink[1] === 'true';
    const at = /config:name="AddParaTableSpacingAtStart"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (at) doc.m_bParaSpaceMaxAtPages = at[1] === 'true';
    const m = /config:name="AddParaTableSpacing"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (m) doc.m_bParaSpaceMax = m[1] === 'true';
    const h = /config:name="HeaderSpacingBelowLastPara"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (h) doc.m_bHeaderSpacingBelowLastPara = h[1] === 'true';
    const tos = /config:name="TabOverSpacing"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (tos) doc.m_bTabOverSpacing = tos[1] === 'true';
    const tom = /config:name="TabOverMargin"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (tom) doc.m_bTabOverMargin = tom[1] === 'true';
    const dpi = /config:name="ImagePreferredDPI"[^>]*>(\d+)</.exec(decodeXml(settingsBytes));
    if (dpi) doc.m_nImagePreferredDPI = Number(dpi[1]);
    const ud = /config:name="ApplyUserData"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (ud) doc.m_bUseUserData = ud[1] === 'true';
  }
  const mba = settingsBytes && /config:name="MathBaselineAlignment"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
  doc.m_bMathBaselineAlignment = !!mba && mba[1] === 'true';
  // SfxDocumentMetaData::init: the document properties of meta.xml.
  const metaBytes = files.get('meta.xml');
  if (metaBytes) { try { doc.m_xDocProps = SfxDocumentMetaData.Read(MetaOf(parseXml(decodeXml(metaBytes)))); } catch { /* a broken meta.xml leaves the properties empty, as upstream */ } }
  const lost = new Set<string>();
  const fonts = new Map<string, string>();
  for (const root of [stylesDoc, content]) {
    for (const f of childElements(child(root, 'office:font-face-decls') ?? { name: '', attrs: new Map(), children: [] })) {
      const family = f.attrs.get('svg:font-family');
      if (f.attrs.get('style:name') && family) fonts.set(f.attrs.get('style:name')!, family.replace(/^['"]|['"]$/g, ''));
    }
  }

  const styles = new Map<string, OdfStyle>(); // keyed "family/name"
  const collect = (container?: XmlElement) => {
    for (const s of container ? childElements(container) : []) {
      if (s.name !== 'style:style') continue;
      const name = s.attrs.get('style:name')!;
      const family = s.attrs.get('style:family')!;
      styles.set(`${family}/${name}`, {
        name, family, display: s.attrs.get('style:display-name') ?? name.replace(/_20_/g, ' '),
        parent: s.attrs.get('style:parent-style-name'), next: s.attrs.get('style:next-style-name'), attrs: readProps(s, fonts), el: s,
      });
    }
  };
  collect(child(stylesDoc, 'office:styles'));
  // SvXMLNumFormatContext: the data styles of both files by name, as format codes.
  const numberStyles = ImportNumberStyles([child(stylesDoc, 'office:styles'), child(stylesDoc, 'office:automatic-styles'), child(content, 'office:automatic-styles')]);
  // The named gradients of draw:fill-gradient-name (XMLGradientStyleImport).
  const gradients = new Map<string, BGradient>();
  for (const root of [stylesDoc, content]) for (const g of childElements(child(root, 'office:styles') ?? EMPTY_EL)) if (g.name === 'draw:gradient') gradients.set(g.attrs.get('draw:name') ?? '', ImportGradientStyle(g));
  // XMLTextImportHelper / SwXMLImport: style:default-style family="paragraph" sets the document defaults.
  const defaultStyle = childElements(child(stylesDoc, 'office:styles') ?? EMPTY_EL).find((e) => e.name === 'style:default-style' && e.attrs.get('style:family') === 'paragraph');
  if (defaultStyle) Object.assign(doc.m_aDefaults, readProps(defaultStyle, fonts));
  // List styles: named ones keep their display name, automatic ones belong to their paragraphs.
  const listStyles = new Map<string, string>(); // ODF style name -> rule name
  const collectLists = (container: XmlElement | undefined, auto: boolean) => {
    for (const s of container ? childElements(container) : []) {
      if (s.name !== 'text:list-style') continue;
      const name = s.attrs.get('style:name')!;
      const ruleName = auto ? `${name}${doc.m_aNumRules.has(name) ? '_' : ''}` : (s.attrs.get('style:display-name') ?? name.replace(/_20_/g, ' '));
      doc.PutNumRule(readListStyle(s, ruleName, auto));
      listStyles.set(name, ruleName);
    }
  };
  collectLists(child(stylesDoc, 'office:styles'), false);
  collectLists(child(stylesDoc, 'office:automatic-styles'), true);
  collectLists(child(content, 'office:automatic-styles'), true);
  const namedParagraph = new Set([...styles.values()].filter((s) => s.family === 'paragraph').map((s) => s.name));
  // Named text styles become character styles (SwCharFormat); automatic ones are direct formatting.
  const charFormats = new Map<string, SwCharFormat>();
  for (const st of styles.values()) {
    if (st.family !== 'text') continue;
    if (['Internet_20_link', 'Visited_20_Internet_20_Link'].includes(st.name)) continue;
    charFormats.set(st.name, doc.FindCharFormatByName(st.display) ?? doc.MakeCharFormat(st.display));
  }
  for (const [name, cf] of charFormats) cf.m_aSet = charOnly(styles.get(`text/${name}`)!.attrs);
  collect(child(stylesDoc, 'office:automatic-styles'));
  collect(child(content, 'office:automatic-styles'));

  // Named paragraph styles become format collections, resolved parent first.
  const colls = new Map<string, SwTextFormatColl>();
  const standard = doc.FindTextFormatCollByName('Standard')!;
  const resolveColl = (name: string): SwTextFormatColl => {
    const got = colls.get(name);
    if (got) return got;
    const s = styles.get(`paragraph/${name}`);
    if (!s) return standard;
    const parent = s.parent ? resolveColl(s.parent) : null;
    // Now that the parent is known, the margins it does not set come from the parent (or defaults).
    s.attrs = readProps(s.el, fonts, (k) => (parent ? parent.GetFormatAttr(k) : doc.m_aDefaults[k] ?? POOL_DEFAULTS[k]) as never);
    const existing = doc.FindTextFormatCollByName(s.display);
    let c: SwTextFormatColl;
    if (existing) { existing.m_aSet = s.attrs; if (existing !== standard) existing.m_pDerivedFrom = parent; c = existing; }
    else c = doc.MakeColl(s.display, parent, s.attrs);
    colls.set(name, c);
    return c;
  };
  for (const n of namedParagraph) resolveColl(n);
  for (const n of namedParagraph) {
    const s = styles.get(`paragraph/${n}`)!;
    if (s.next && namedParagraph.has(s.next)) colls.get(n)!.m_pNextTextFormatColl = colls.get(s.next)!;
  }

  // XMLPageExport's counterpart: every master page is a page style, "Standard" the default one.
  const masters = child(stylesDoc, 'office:master-styles');
  const masterList = masters ? childElements(masters).filter((m) => m.name === 'style:master-page') : [];
  const layouts = child(stylesDoc, 'office:automatic-styles');
  const descOfMaster = new Map<string, string>();
  for (const m of masterList) {
    const name = m.attrs.get('style:name') ?? '';
    descOfMaster.set(name, name === 'Standard' ? DEFAULT_PAGE_DESC : m.attrs.get('style:display-name') ?? name.replace(/_20_/g, ' '));
  }
  // Without a Standard master page, the first one is the default page style.
  if (masterList.length && !descOfMaster.has('Standard')) descOfMaster.set(masterList[0]!.attrs.get('style:name') ?? '', DEFAULT_PAGE_DESC);
  for (const m of masterList) {
    const descName = descOfMaster.get(m.attrs.get('style:name') ?? '')!;
    const pd = descName === DEFAULT_PAGE_DESC ? doc.m_aPageDesc : doc.MakePageDesc(descName);
    const next = m.attrs.get('style:next-style-name');
    pd.m_sFollow = next && descOfMaster.has(next) ? descOfMaster.get(next)! : descName;
    const layout = layouts && childElements(layouts).find((l) => l.name === 'style:page-layout' && l.attrs.get('style:name') === m.attrs.get('style:page-layout-name'));
    const lp = child(layout, 'style:page-layout-properties');
    if (lp) {
      pd.m_aCol = readColumns(lp);
      pd.nWidth = toTwips(lp.attrs.get('fo:page-width')) ?? pd.nWidth;
      pd.nHeight = toTwips(lp.attrs.get('fo:page-height')) ?? pd.nHeight;
      pd.nLeft = toTwips(lp.attrs.get('fo:margin-left')) ?? pd.nLeft;
      pd.nRight = toTwips(lp.attrs.get('fo:margin-right')) ?? pd.nRight;
      pd.nTop = toTwips(lp.attrs.get('fo:margin-top')) ?? pd.nTop;
      pd.nBottom = toTwips(lp.attrs.get('fo:margin-bottom')) ?? pd.nBottom;
    }
    // style:header-footer-properties of the page layout: minimum height and spacing to the body.
    for (const [tag, bHeader] of [['style:header-style', true], ['style:footer-style', false]] as const) {
      const hp = child(child(layout, tag), 'style:header-footer-properties');
      if (!hp) continue;
      const minH = toTwips(hp.attrs.get('fo:min-height')) ?? 0;
      // An absent margin is 0 (the ODF default), not Writer's 0.5 cm for new headers.
      const spacing = toTwips(hp.attrs.get(bHeader ? 'fo:margin-bottom' : 'fo:margin-top')) ?? 0;
      const eat = hp.attrs.get('style:dynamic-spacing') === 'true';
      if (bHeader) { pd.nHeaderMinHeight = minH; if (spacing !== undefined) pd.nHeaderSpacing = spacing; pd.bHeaderEatSpacing = eat; }
      else { pd.nFooterMinHeight = minH; if (spacing !== undefined) pd.nFooterSpacing = spacing; pd.bFooterEatSpacing = eat; }
    }
  }

  const nodes = doc.GetNodes();
  // New nodes go before the end node of the section being read: the body, or a table cell.
  let sectionEnd: SwNode = nodes.GetEndOfContent();
  const initial = nodes.FirstTextNode();
  let initialUsed = false;
  let initialIsPara = false;
  const newNode = (): SwTextNode => {
    if (!initialUsed && sectionEnd === nodes.GetEndOfContent() && nodes.GetEndOfContent().GetIndex() === initial.GetIndex() + 1) {
      initialUsed = initialIsPara = true;
      return initial;
    }
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
    return nodes.MakeTextNode(sectionEnd.GetIndex(), standard);
  };

  const bookmarkStarts = new Map<string, { node: SwTextNode; nContent: number }>();
  const makeBookmark = (name: string, n1: SwTextNode, c1: number, n2: SwTextNode, c2: number) => {
    if (!name) return;
    const p1 = new SwPosition(n1, c1), p2 = new SwPosition(n2, c2);
    // Cross-reference heading bookmarks keep their type, so the index finds them again.
    const eType = name.startsWith('__RefHeading__') ? MarkType.CROSSREF_HEADING_BOOKMARK : MarkType.BOOKMARK;
    doc.getIDocumentMarkAccess().makeMark({ GetPoint: () => p1, GetMark: () => p2, HasMark: () => p1.compare(p2) !== 0 }, name, eType);
    p1.Release(); p2.Release();
  };
  const collectText = (el: XmlElement, node: SwTextNode, inherited: SwCharAttrSet): void => {
    for (const c of el.children) {
      if (typeof c === 'string') { append(node, c.replace(/[\r\n\t ]+/g, ' '), inherited); continue; }
      switch (c.name) {
        case 'text:span': {
          const name = c.attrs.get('text:style-name') ?? '';
          const st = styles.get(`text/${name}`);
          const named = charFormats.get(name);
          const parent = st?.parent ? charFormats.get(st.parent) : undefined;
          // A named style is a character style; an automatic one is direct formatting on top of its parent style.
          const attrs: SwCharAttrSet = named ? { RES_TXTATR_CHARFMT: named } : st ? { ...charOnly(st.attrs), ...(parent ? { RES_TXTATR_CHARFMT: parent } : {}) } : {};
          collectText(c, node, { ...inherited, ...attrs });
          break;
        }
        case 'text:s': append(node, ' '.repeat(parseInt(c.attrs.get('text:c') ?? '1', 10)), inherited); break;
        case 'text:tab': append(node, '\t', inherited); break;
        case 'text:line-break': append(node, '\n', inherited); break;
        case 'text:a': {
          const href = c.attrs.get('xlink:href');
          const styleName = c.attrs.get('text:style-name') ?? '';
          const st = styles.get(`text/${styleName}`);
          // XMLHyperlinkContext: a named style other than Internet Link is the link's character style.
          const linkFmt = st && !['Internet_20_link', 'Internet link'].includes(st.name) ? charFormats.get(styleName) : undefined;
          collectText(c, node, { ...inherited, ...(st && !linkFmt && !['Internet_20_link', 'Internet link'].includes(st.name) ? charChain(st) : {}), ...(href ? { RES_TXTATR_INETFMT: href } : {}), ...(href && linkFmt ? { RES_TXTATR_INETFMT_CHARFMT: linkFmt } : {}) });
          break;
        }
        // XMLTextFieldImportContext for the field types ported (SwField).
        case 'text:page-number': append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: { type: 'PageNumber' } }); break;
        case 'text:page-count': append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: { type: 'PageCount' } }); break;
        // XMLSequenceFieldImportContext
        case 'text:sequence': {
          const field: SwField = { type: 'Sequence', name: c.attrs.get('text:name') ?? '' };
          const t = NUM_FORMATS[c.attrs.get('style:num-format') ?? '1'];
          if (t !== undefined && t !== NumberingType.ARABIC) field.numType = t;
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        case 'text:date': case 'text:time': {
          const field: SwField = { type: c.name === 'text:date' ? 'Date' : 'Time' };
          if (c.attrs.get('text:fixed') === 'true') field.fixed = textOf(c);
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLFootnoteImportContext: the body goes into a new footnote section.
        case 'text:note': {
          const endnote = c.attrs.get('text:note-class') === 'endnote';
          const id = doc.NewFootnoteId();
          const sec = nodes.MakeFootnoteSection(id, doc.FindTextFormatCollByName(endnote ? 'Endnote' : 'Footnote')!);
          const placeholder = nodes.GoNext(sec.GetIndex())!;
          const saved = sectionEnd;
          sectionEnd = sec.EndOfSectionNode();
          const noteBody = child(c, 'text:note-body');
          if (noteBody) readBlocks(noteBody);
          sectionEnd = saved;
          if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FTN: endnote ? { id, endnote } : { id } });
          break;
        }
        // XMLTextMarkImportContext: bookmarks; a range from its start to the end of that name.
        case 'text:bookmark': makeBookmark(c.attrs.get('text:name') ?? '', node, node.Len(), node, node.Len()); break;
        case 'text:bookmark-start': bookmarkStarts.set(c.attrs.get('text:name') ?? '', { node, nContent: node.Len() }); break;
        case 'text:bookmark-end': {
          const name = c.attrs.get('text:name') ?? '';
          const start = bookmarkStarts.get(name);
          bookmarkStarts.delete(name);
          if (start) makeBookmark(name, start.node, start.nContent, node, node.Len());
          break;
        }
        case 'text:soft-page-break': break;
        // XMLAnnotationImportContext: the comment's paragraphs become its plain text.
        case 'office:annotation': {
          const id = doc.NewAnnotationId();
          const paras = childElements(c).filter((x) => x.name === 'text:p' || x.name === 'text:h' || x.name === 'text:list');
          const text = paras.map((p) => textOf(p)).join('\n');
          const field: SwPostItField = { id, author: textOf(child(c, 'dc:creator') ?? EMPTY) || 'Unknown Author', date: textOf(child(c, 'dc:date') ?? EMPTY), text, resolved: c.attrs.get('loext:resolved') === 'true' };
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_ANNOTATION: field });
          const name = c.attrs.get('office:name');
          if (name) pendingMarks.set(name, { node, start: node.Len(), id });
          break;
        }
        case 'office:annotation-end': {
          const mark = pendingMarks.get(c.attrs.get('office:name') ?? '');
          if (!mark) break;
          pendingMarks.delete(c.attrs.get('office:name')!);
          if (mark.node === node && node.Len() > mark.start) node.SetAttr(mark.start, node.Len(), { RES_TXTATR_ANNOTMARK: mark.id });
          else if (mark.node !== node) lost.add('comment ranges across paragraphs (the comments are kept)');
          break;
        }
        case 'draw:frame': readFrame(c, node, inherited); break;
        // XMLChangeImportContext: insertions are open between change-start and change-end; a
        // deletion's text comes back from its region, its paragraph ends split later (PARA_MARK).
        case 'text:change-start': case 'text:change-end': {
          const r = changes.get(c.attrs.get('text:change-id') ?? '');
          if (r?.data.type === 'Insert') openInsert = c.name === 'text:change-start' ? r.data : null;
          break;
        }
        case 'text:change': {
          const r = changes.get(c.attrs.get('text:change-id') ?? '');
          if (r?.data.type !== 'Delete') break;
          const paras = r.content.filter((x) => x.name === 'text:p' || x.name === 'text:h');
          paras.forEach((pe, k) => {
            if (k) append(node, PARA_MARK, { RES_TXTATR_REDLINE: r.data });
            collectText(pe, node, { ...inherited, RES_TXTATR_REDLINE: r.data });
          });
          if (r.content.some((x) => x.name !== 'text:p' && x.name !== 'text:h')) lost.add('deleted tables and objects in tracked changes');
          break;
        }
        default:
          if (c.name.startsWith('draw:')) readFrame(c, node, inherited);
          else if (/^text:(reference-mark|alphabetical-index-mark|toc-mark|user-index-mark|bookmark-ref)/.test(c.name) || c.name.startsWith('field:fieldmark')) {
            if (c.children.length) collectText(c, node, inherited);
          } else if (c.name.startsWith('text:') && c.children.length) { collectText(c, node, inherited); lost.add('fields (their current value is kept as text)'); }
          else lost.add(c.name);
      }
    }
  };
  // SdXMLGraphicObjectShapeContext and XMLTextFrameContext: an image or text box frame becomes a
  // fly with its anchor, position and wrap from its graphic style (XMLTextFrameContext_Impl).
  const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff', wmf: 'image/x-wmf', emf: 'image/x-emf' };
  /** Other names of the metafile types (GraphicMimeTypeHelper). */
  const MIME_ALIAS: Record<string, string> = { 'image/wmf': 'image/x-wmf', 'image/emf': 'image/x-emf', 'image/x-msmetafile': 'image/x-wmf', 'application/x-msmetafile': 'image/x-wmf' };
  /** A graphic-properties attribute through the style's parents and the default graphic style. */
  const graphicProp = (styleName: string | undefined, attr: string): string | undefined => {
    for (let st = styleName ? styles.get(`graphic/${styleName}`) : undefined, guard = 0; st && guard < 20; st = st.parent ? styles.get(`graphic/${st.parent}`) : undefined, guard++) {
      const v = child(st.el, 'style:graphic-properties')?.attrs.get(attr);
      if (v !== undefined) return v;
    }
    return graphicDefaults?.attrs.get(attr);
  };
  const graphicDefaults = childElements(child(stylesDoc, 'office:styles') ?? EMPTY_EL).find((e) => e.name === 'style:default-style' && e.attrs.get('style:family') === 'graphic')
    ?.children.find((c): c is XmlElement => typeof c !== 'string' && c.name === 'style:graphic-properties');
  const usedFlyNames = new Set<string>();
  /** XMLTextFrameContext: draw:chain-next-name, connected once every frame is read (SwXFrame's ChainNextName). */
  const chainNext: [SwFlyFrameFormat, string][] = [];
  /** Reads a draw:frame; returns its format, or null when its content cannot be shown. */
  const readFlyFormat = (c: XmlElement, bShape = false): SwFlyFrameFormat | null => {
    const textBox = child(c, 'draw:text-box');
    // LibreOffice may write several draw:image elements: the first one a browser can show wins.
    let data: Uint8Array | undefined, mime = '';
    for (const img of childElements(c).filter((x) => x.name === 'draw:image')) {
      const href = img.attrs.get('xlink:href')?.replace(/^\.\//, '');
      const ext = href?.split('.').pop()?.toLowerCase() ?? '';
      const declared = img.attrs.get('draw:mime-type') ?? img.attrs.get('loext:mime-type');
      const type = (declared && (MIME_ALIAS[declared] ?? declared)) ?? MIME_BY_EXT[ext] ?? '';
      if (!Object.values(MIME_BY_EXT).includes(type)) continue;
      const bin = child(img, 'office:binary-data');
      const bytes = href ? files.get(href) : bin ? Uint8Array.from(atob(textOf(bin).replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)) : undefined;
      if (bytes) { data = bytes; mime = type; break; }
    }
    // SwXMLTextImportHelper::createAndInsertOLEObject: an embedded formula, its MathML in the
    // object's content.xml (SmXMLImport). Other embedded objects are not ported.
    let math: SwMathObj | undefined;
    const obj = child(c, 'draw:object');
    const objHref = obj?.attrs.get('xlink:href')?.replace(/^\.\//, '').replace(/\/$/, '');
    const objXml = objHref !== undefined ? files.get(`${objHref}/content.xml`) : undefined;
    if (objXml) {
      const m_sText = ImportMathMLString(decodeXml(objXml));
      if (m_sText || /<(\w+:)?math\b/.test(decodeXml(objXml))) math = { m_sText };
    }
    // A text box without svg:width grows with its text from fo:min-width (XMLTextFrameContext).
    const minWidth = c.attrs.get('fo:min-width') ?? textBox?.attrs.get('fo:min-width');
    const width = toTwips(c.attrs.get('svg:width') ?? minWidth) ?? (textBox ? 0 : undefined);
    const height = toTwips(c.attrs.get('svg:height') ?? c.attrs.get('fo:min-height') ?? textBox?.attrs.get('fo:min-height')) ?? (textBox ? 0 : undefined);
    if ((!data && !textBox && !bShape && !math) || width === undefined || (!textBox && !width) || height === undefined || (!textBox && !height)) {
      lost.add('objects and images in formats a browser cannot show');
      return null;
    }
    const st = c.attrs.get('draw:style-name');
    const gp = (a: string) => graphicProp(st, a);
    let name = c.attrs.get('draw:name') ?? '';
    if (!name || usedFlyNames.has(name)) {
      let k = 1;
      const prefix = textBox ? 'Frame' : math ? 'Object' : 'Image';
      while (usedFlyNames.has(`${prefix}${k}`)) k++;
      name = `${prefix}${k}`;
    }
    usedFlyNames.add(name);
    let anchor = ANCHOR[c.attrs.get('text:anchor-type') ?? 'paragraph'] ?? RndStdIds.FLY_AT_PARA;
    // Text frames anchored as characters are not ported: they are anchored at the character instead.
    if (textBox && !bShape && anchor === RndStdIds.FLY_AS_CHAR) { anchor = RndStdIds.FLY_AT_CHAR; lost.add('text frames in the line (they are anchored to the character instead)'); }
    const wrap = WRAP[gp('style:wrap') ?? 'parallel'] ?? WrapTextMode.PARALLEL;
    const fake: XmlElement = { name: 'x', attrs: new Map(), children: [{ name: 'style:paragraph-properties', attrs: new Map([...(graphicDefaults?.attrs ?? []), ...(st ? styleChainGraphicAttrs(st) : [])]), children: [] }] };
    const box = readProps(fake, fonts);
    const alt = textOf(child(c, 'svg:desc') ?? EMPTY_EL) || undefined;
    const title = textOf(child(c, 'svg:title') ?? EMPTY_EL) || undefined;
    const fmt: SwFlyFrameFormat = {
      m_aName: name, m_nWidth: width, m_nHeight: height,
      m_aAnchor: { m_eAnchorId: anchor, m_nPageNumber: parseInt(c.attrs.get('text:anchor-page-number') ?? '1', 10) || 1 },
      m_aHoriOrient: { m_eOrient: HORI_POS[gp('style:horizontal-pos') ?? 'center'] ?? HoriOrientation.CENTER, m_eRelation: HORI_REL[gp('style:horizontal-rel') ?? 'paragraph'] ?? RelOrientation.FRAME, m_nPos: toTwips(c.attrs.get('svg:x')) ?? 0 },
      m_aVertOrient: { m_eOrient: VERT_POS[gp('style:vertical-pos') ?? 'top'] ?? VertOrientation.TOP, m_eRelation: VERT_REL[gp('style:vertical-rel') ?? 'paragraph'] ?? RelOrientation.FRAME, m_nPos: toTwips(c.attrs.get('svg:y')) ?? 0 },
      // XMLParagraphOnlyPropHdl_Impl: style:number-wrapped-paragraphs="1" wraps only the anchor paragraph.
      m_aSurround: {
        m_eSurround: wrap, ...(gp('style:number-wrapped-paragraphs') === '1' ? { m_bAnchorOnly: true } : {}),
        // XMLWrapPropHdl: style:wrap-contour, and style:wrap-contour-mode outside.
        ...(gp('style:wrap-contour') === 'true' && data ? { m_bContour: true, ...(gp('style:wrap-contour-mode') === 'outside' ? { m_bOutside: true } : {}) } : {}),
      },
      m_nLeftSpace: toTwips(gp('fo:margin-left')) ?? 0, m_nRightSpace: toTwips(gp('fo:margin-right')) ?? 0,
      m_nUpperSpace: toTwips(gp('fo:margin-top')) ?? 0, m_nLowerSpace: toTwips(gp('fo:margin-bottom')) ?? 0,
      // A run-through object is in the background unless it says it is in front.
      m_bOpaque: !(wrap === WrapTextMode.THROUGH && gp('style:run-through') === 'background'),
      ...(alt ? { alt } : {}), ...(title ? { m_sTitle: title } : {}),
    };
    if (math) {
      // AlignFormulaToBaseline: vertically at minus the baseline; a centred formula keeps its
      // centre on the baseline (SwAsCharAnchoredObjectPosition).
      const vpos = gp('style:vertical-pos');
      if (doc.m_bMathBaselineAlignment || vpos === 'from-top') math.m_bBaseline = true;
      else if (vpos === 'middle' || vpos === 'center') math.m_eVertOrient = 'center';
      fmt.m_pMath = math;
      // Formulas are anchored as characters here (SwOLENode in other anchors are not ported).
      fmt.m_aAnchor = { m_eAnchorId: RndStdIds.FLY_AS_CHAR, m_nPageNumber: 0 };
    }
    if (data) {
      fmt.graphic = doc.AddGraphic(data, mime);
      // XMLTextFrameContourContext_Impl: draw:contour-polygon, its points in its view box.
      const cp = child(c, 'draw:contour-polygon');
      const vb = cp?.attrs.get('svg:viewBox')?.trim().split(/[\s,]+/).map(Number);
      const pts = cp?.attrs.get('draw:points')?.trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]);
      if (vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0 && pts && pts.length > 2 && pts.every((p) => p.length === 2 && p.every(Number.isFinite))) {
        fmt.m_aContour = [pts.map(([x, y]) => [(x - vb[0]!) / vb[2]!, (y - vb[1]!) / vb[3]!] as [number, number])];
        if (cp!.attrs.get('draw:recreate-on-edit') === 'true') fmt.m_bAutoContour = true;
      }
      // XMLTextFrameContext_Impl, RotateFlyFrameFix: the rotation of draw:transform, as written.
      const rot = /rotate\s*\(\s*([-\d.eE+]+)\s*\)/.exec(c.attrs.get('draw:transform') ?? '');
      if (rot) {
        const n = ((Math.round((parseFloat(rot[1]!) * 1800) / Math.PI) % 3600) + 3600) % 3600;
        if (n) fmt.m_nGrfRotation = n;
      }
      // XMLGrfMirrorPropHdl_Impl
      const mir = (gp('style:mirror') ?? '').split(/\s+/);
      const lr = mir.some((m) => m.startsWith('horizontal')), tb = mir.includes('vertical');
      if (lr || tb) fmt.m_eMirror = lr && tb ? 'both' : lr ? 'vertical' : 'horizontal';
      const grf = ImportGrfAttr(gp);
      if (grf) fmt.m_aGrfAttr = grf;
      // XMLClipPropertyHandler: fo:clip="rect(top, right, bottom, left)", lengths of the graphic's preferred size.
      const clip = /rect\(([^)]*)\)/.exec(gp('fo:clip') ?? '');
      const pref = clip && GetPrefSizeTwips(data);
      if (clip && pref) {
        const [t, r, b, l] = clip[1]!.split(/[\s,]+/).map((x) => (x === 'auto' ? 0 : toTwips(x) ?? 0));
        const crop = { left: l! / pref.width, top: t! / pref.height, right: r! / pref.width, bottom: b! / pref.height };
        if (crop.left || crop.top || crop.right || crop.bottom) fmt.crop = crop;
      }
    }
    if (textBox) {
      fmt.m_sContentId = name;
      const next = textBox.attrs.get('draw:chain-next-name');
      if (next) chainNext.push([fmt, next]);
      fmt.m_bAutoHeight = !c.attrs.get('svg:height') || !!textBox.attrs.get('fo:min-height');
      if (!c.attrs.get('svg:width') || minWidth !== undefined) fmt.m_bAutoWidth = true;
      fmt.m_aBox = box.RES_BOX ?? null;
      fmt.m_aBackground = box.RES_BACKGROUND ?? null;
      // style:writing-mode of the frame (XMLTextFrameContext's frame direction).
      const wm = gp('style:writing-mode');
      if (wm === 'bt-lr' || wm === 'tb-rl') fmt.m_eFrameDir = wm;
      // XMLTextFrameContext: the box's paragraphs go into the frame's own section.
      const section = nodes.MakeFlySection(name, standard);
      const placeholder = nodes.GoNext(section.GetIndex())!;
      const saved = sectionEnd;
      sectionEnd = section.EndOfSectionNode();
      readBlocks(textBox);
      sectionEnd = saved;
      if (section.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
    } else if (box.RES_BOX) fmt.m_aBox = box.RES_BOX;
    return fmt;
  };
  /** Graphic-properties attributes of a style and its parents, the nearest last so it wins. */
  const styleChainGraphicAttrs = (name: string): [string, string][] => {
    const chain: XmlElement[] = [];
    for (let st = styles.get(`graphic/${name}`), guard = 0; st && guard < 20; st = st.parent ? styles.get(`graphic/${st.parent}`) : undefined, guard++) {
      const g = child(st.el, 'style:graphic-properties');
      if (g) chain.unshift(g);
    }
    return chain.flatMap((g) => [...g.attrs]);
  };
  /**
   * SdXMLCustomShapeContext, SdXMLRectShapeContext, SdXMLEllipseShapeContext and SdXMLLineShapeContext:
   * a drawing shape as a fly with the shape's geometry, fill and line. Polygons, paths, connectors
   * and groups are not ported.
   */
  const readShapeFormat = (el: XmlElement): SwFlyFrameFormat | null => {
    const POLY = ['draw:polygon', 'draw:polyline', 'draw:path'];
    if (![...POLY, 'draw:custom-shape', 'draw:rect', 'draw:ellipse', 'draw:line'].includes(el.name)) { lost.add(el.name === 'draw:g' ? 'grouped shapes' : 'connectors'); return null; }
    const polyGeom = POLY.includes(el.name) ? ImportPolyShape(el) : null;
    if (POLY.includes(el.name) && !polyGeom) { lost.add('polygons and curves without valid points'); return null; }
    const attrs = new Map(el.attrs);
    let flipH = false, flipV = false, rotate = 0;
    if (el.name === 'draw:line') {
      const [x1, y1, x2, y2] = ['svg:x1', 'svg:y1', 'svg:x2', 'svg:y2'].map((k) => toTwips(el.attrs.get(k)) ?? 0) as [number, number, number, number];
      flipH = x2 < x1; flipV = y2 < y1;
      attrs.set('svg:x', `${Math.min(x1, x2) / 1440}in`); attrs.set('svg:y', `${Math.min(y1, y2) / 1440}in`);
      attrs.set('svg:width', `${Math.max(1, Math.abs(x2 - x1)) / 1440}in`); attrs.set('svg:height', `${Math.max(1, Math.abs(y2 - y1)) / 1440}in`);
    }
    // draw:transform="rotate (a) translate (x y)": rotated around the top left corner, then moved.
    const tr = el.attrs.get('draw:transform');
    if (tr) {
      const rot = /rotate\s*\(\s*([-\d.e]+)\s*\)/.exec(tr), mv = /translate\s*\(\s*([^\s,)]+)[\s,]+([^\s,)]+)\s*\)/.exec(tr);
      const w = toTwips(attrs.get('svg:width')) ?? 0, h = toTwips(attrs.get('svg:height')) ?? 0;
      const a = rot ? -parseFloat(rot[1]!) : 0;
      rotate = (a * 180) / Math.PI;
      if (mv) {
        const tx = toTwips(mv[1]) ?? 0, ty = toTwips(mv[2]) ?? 0;
        const cx = tx + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a), cy = ty + (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
        attrs.set('svg:x', `${(cx - w / 2) / 1440}in`); attrs.set('svg:y', `${(cy - h / 2) / 1440}in`);
      }
    }
    // The shape's text becomes the content of a text box of the fly; Fontwork keeps it as a string.
    const bTextPath = child(el, 'draw:enhanced-geometry')?.attrs.get('draw:text-path') === 'true';
    const paras = childElements(el).filter((x) => x.name === 'text:p' || x.name === 'text:h' || x.name === 'text:list');
    const text = bTextPath ? [] : paras;
    const frameEl: XmlElement = { name: 'draw:frame', attrs, children: text.length ? [{ name: 'draw:text-box', attrs: new Map(), children: text }] : [] };
    const fmt = readFlyFormat(frameEl, true);
    if (!fmt) return null;
    fmt.m_bAutoHeight = false;
    delete fmt.m_bAutoWidth;
    fmt.m_aBackground = null;
    if (fmt.m_aBox) fmt.m_aBox = { top: null, bottom: null, left: null, right: null, padding: fmt.m_aBox.padding };
    if (!el.attrs.get('draw:name')) {
      let k = 1;
      while (usedFlyNames.has(`Shape${k}`)) k++;
      fmt.m_aName = `Shape${k}`;
      usedFlyNames.add(fmt.m_aName);
      if (fmt.m_sContentId !== undefined) { nodes.FindFlySection(fmt.m_sContentId)!.m_sFlyId = fmt.m_aName; fmt.m_sContentId = fmt.m_aName; }
    }
    const st = el.attrs.get('draw:style-name');
    const gp = (k: string) => graphicProp(st, k);
    const shape: SdrShape = { m_sType: el.name === 'draw:ellipse' ? 'ellipse' : el.name === 'draw:line' ? 'line' : 'rectangle', m_aFill: null, m_aLine: null };
    const geom = child(el, 'draw:enhanced-geometry');
    if (polyGeom) { shape.m_sType = 'non-primitive'; shape.m_aGeometry = polyGeom; }
    else if (geom) {
      const g = ImportEnhancedGeometry(geom);
      shape.m_sType = g.sType;
      if (g.aGeometry) shape.m_aGeometry = g.aGeometry;
      else if (!GetCustomShapeContent(g.sType)) { lost.add(`shapes of the type "${g.sType}" (shown as rectangles)`); shape.m_sType = 'rectangle'; }
      if (g.aAdjust) shape.m_aAdjust = g.aAdjust;
      flipH ||= g.bFlipH; flipV ||= g.bFlipV;
    }
    const fill = gp('draw:fill') ?? 'solid';
    // An open outline has no fill (PolyLineShape, OpenBezierShape).
    const bOpen = !!polyGeom?.segments?.some(([c]) => c === EnhancedCustomShapeSegmentCommand.NOFILL);
    if (el.name !== 'draw:line' && !bOpen && fill !== 'none') {
      shape.m_aFill = gp('draw:fill-color') ?? COL_DEFAULT_SHAPE_FILLING;
      const gradient = fill === 'gradient' ? gradients.get(gp('draw:fill-gradient-name') ?? '') : undefined;
      if (gradient) {
        shape.m_aGradient = { ...gradient, nStepCount: parseInt(gp('draw:gradient-step-count') ?? '0', 10) || 0 };
        shape.m_aFill = gradient.aColorStops[0]?.aStopColor ?? shape.m_aFill;
      } else if (fill !== 'solid') lost.add('hatch and bitmap fills (shown in the fill colour)');
    }
    if ((gp('draw:stroke') ?? 'solid') !== 'none') shape.m_aLine = { color: gp('svg:stroke-color') ?? COL_DEFAULT_SHAPE_STROKE, width: toTwips(gp('svg:stroke-width')) ?? 0 };
    if (flipH) shape.m_bFlipH = true;
    if (flipV) shape.m_bFlipV = true;
    if (rotate) shape.m_nRotate = rotate;
    const va = gp('draw:textarea-vertical-align');
    if (va === 'top' || va === 'bottom') shape.m_eTextVertAdjust = va;
    // draw:opacity: the fill transparency.
    const opacity = gp('draw:opacity');
    if (opacity && parseFloat(opacity) < 100) shape.m_nFillTransparence = Math.round(100 - parseFloat(opacity));
    if (bTextPath) {
      shape.m_bTextPath = true;
      shape.m_sText = paras.map(textOf).join('\n');
      // The font: the graphic style's text properties, else the first paragraph's style.
      let font: string | undefined;
      for (let gs = st ? styles.get(`graphic/${st}`) : undefined, guard = 0; gs && !font && guard < 20; gs = gs.parent ? styles.get(`graphic/${gs.parent}`) : undefined, guard++) {
        const tp = child(gs.el, 'style:text-properties');
        font = tp?.attrs.get('fo:font-family') ?? tp?.attrs.get('style:font-name');
      }
      const ps = paras[0]?.attrs.get('text:style-name');
      const pst = ps ? styles.get(`paragraph/${ps}`) : undefined;
      if (!font && pst) font = readProps(pst.el, fonts, () => undefined as never).RES_CHRATR_FONT;
      if (font) shape.m_sFontName = font.replace(/^'|'$/g, '');
    }
    fmt.m_pShape = shape;
    return fmt;
  };
  const readFrame = (c: XmlElement, node: SwTextNode, inherited: SwCharAttrSet) => {
    const fmt = c.name === 'draw:frame' ? readFlyFormat(c) : readShapeFormat(c);
    if (!fmt) return;
    switch (fmt.m_aAnchor.m_eAnchorId) {
      case RndStdIds.FLY_AS_CHAR:
        // A shape in the line keeps its geometry; its text is not ported there.
        if (fmt.m_pShape && fmt.m_sContentId !== undefined) lost.add('text in shapes anchored as characters');
        append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FLYCNT: FlyCntOf(fmt) });
        break;
      case RndStdIds.FLY_AT_PAGE: doc.m_aPageFlys.push(fmt); break;
      default: node.m_aAnchoredFlys.push({ fmt, nContent: fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? node.Len() : 0 });
    }
  };
  const EMPTY: XmlElement = EMPTY_EL;
  // Tracked changes by region id, and the insertion open while reading.
  const changes = new Map<string, { data: SwRedlineData; content: XmlElement[] }>();
  let openInsert: SwRedlineData | null = null;
  /** Stands for a deleted paragraph end while a paragraph is read. */
  const PARA_MARK = '\u2029';
  // Commented ranges still open, by annotation name.
  const pendingMarks = new Map<string, { node: SwTextNode; start: number; id: string }>();
  const textOf = (el: XmlElement): string => el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
  const charChain = (s: OdfStyle): SwCharAttrSet => {
    const parent = s.parent ? styles.get(`${s.family}/${s.parent}`) : undefined;
    return { ...(parent ? charChain(parent) : {}), ...charOnly(s.attrs) };
  };
  const append = (node: SwTextNode, text: string, attrs: SwCharAttrSet) => {
    if (!text) return;
    if (openInsert && !attrs.RES_TXTATR_REDLINE) attrs = { ...attrs, RES_TXTATR_REDLINE: openInsert };
    const start = node.Len();
    node.m_Text += text;
    if (Object.keys(attrs).length) node.SetAttr(start, start + text.length, attrs);
  };

  const readPara = (el: XmlElement): SwTextNode => {
    const node = newNode();
    const done = readParaInto(node, el);
    return done;
  };
  /** Reads a paragraph, then splits it where deleted paragraph ends came back from changes. */
  const readParaInto = (node: SwTextNode, el: XmlElement): SwTextNode => {
    const styleName = el.attrs.get('text:style-name');
    const st = styleName ? styles.get(`paragraph/${styleName}`) : undefined;
    if (st && !namedParagraph.has(st.name)) {
      // Automatic style: direct formatting on top of its named parent.
      node.m_pColl = st.parent ? resolveColl(st.parent) : standard;
      node.m_aSet = { ...readProps(st.el, fonts, (k) => node.m_pColl.GetFormatAttr(k)) };
    } else if (st) node.m_pColl = resolveColl(st.name);
    // style:master-page-name starts a page of that style (SwFormatPageDesc), maybe renumbered.
    const masterPage = st?.el.attrs.get('style:master-page-name');
    if (masterPage && descOfMaster.has(masterPage)) {
      const pn = child(st!.el, 'style:paragraph-properties')?.attrs.get('style:page-number');
      node.m_aSet.RES_PAGEDESC = { name: descOfMaster.get(masterPage)!, numOffset: pn && pn !== 'auto' ? parseInt(pn, 10) || null : null };
    }
    collectText(el, node, {});
    // An insertion still open at the end covers the paragraph's end mark.
    if (openInsert) node.m_aSet.RES_PARATR_REDLINE = openInsert;
    let cur = node;
    for (let k = cur.GetText().indexOf(PARA_MARK); k >= 0; k = cur.GetText().indexOf(PARA_MARK)) {
      const data = cur.GetCharAttrAt('RES_TXTATR_REDLINE', k);
      const next = cur.SplitContentNode(k);
      next.EraseText(0, 1);
      if (data) cur.m_aSet.RES_PARATR_REDLINE = data; else delete cur.m_aSet.RES_PARATR_REDLINE;
      cur.m_nVersion++;
      cur = next;
    }
    node.m_nVersion++;
    return node;
  };

  const readBlocks = (parent: XmlElement) => {
    for (const el of childElements(parent)) {
      switch (el.name) {
        case 'text:p': case 'text:h': readPara(el); break;
        case 'text:list': readList(el, 0, undefined); break;
        case 'text:section': {
          // XMLSectionImportContext: a section with its columns, hidden and protected flags.
          const st = styles.get(`section/${el.attrs.get('text:style-name') ?? ''}`);
          const sp = child(st?.el, 'style:section-properties');
          const data: SwSectionData = {
            m_sSectionName: el.attrs.get('text:name') ?? doc.GetUniqueSectionName(),
            m_bHidden: el.attrs.get('text:display') === 'none',
            m_bProtectFlag: el.attrs.get('text:protected') === 'true',
            m_aCol: readColumns(sp, sp?.attrs.get('text:dont-balance-text-columns') !== 'true'),
            m_aBackground: sp?.attrs.get('fo:background-color') && sp.attrs.get('fo:background-color') !== 'transparent' ? sp.attrs.get('fo:background-color')! : null,
          };
          if (el.attrs.get('text:display') === 'condition') lost.add('conditionally hidden sections (they are shown)');
          if (child(el, 'text:section-source')) lost.add('linked sections (their current text is kept)');
          const sec = new SwSectionNode(nodes, data);
          sec.m_pStartOfSection = sectionEnd.m_pStartOfSection;
          const at = sectionEnd.GetIndex();
          nodes.Insert(sec, at);
          const end = new SwEndNode(nodes, sec);
          nodes.Insert(end, at + 1);
          if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
          const saved = sectionEnd;
          sectionEnd = end;
          readBlocks(el);
          sectionEnd = saved;
          if (end.GetIndex() === sec.GetIndex() + 1) nodes.MakeTextNode(end.GetIndex(), standard);
          break;
        }
        case 'text:section-source': break;
        case 'table:table': readTable(el); break;
        case 'text:sequence-decls': case 'text:user-field-decls': case 'text:variable-decls': case 'office:forms':
        case 'table:calculation-settings': case 'text:soft-page-break': case 'text:dde-connection-decls': break;
        case 'text:tracked-changes': {
          // XMLTrackedChangesImportContext: the regions, by id, and whether changes are recorded.
          if (el.attrs.get('text:track-changes') === 'true') doc.m_pDocumentRedlineManager.m_bRecord = true;
          for (const region of childElements(el).filter((x) => x.name === 'text:changed-region')) {
            const id = region.attrs.get('text:id') ?? region.attrs.get('xml:id') ?? '';
            const kind = childElements(region)[0];
            if (!kind || (kind.name !== 'text:insertion' && kind.name !== 'text:deletion')) { if (kind) lost.add('tracked formatting changes (the current formatting is kept)'); continue; }
            const info = child(kind, 'office:change-info');
            const date = textOf(child(info, 'dc:date') ?? EMPTY_EL);
            changes.set(id, {
              data: { type: kind.name === 'text:insertion' ? 'Insert' : 'Delete', author: textOf(child(info, 'dc:creator') ?? EMPTY_EL) || 'Unknown Author', date: date && !/Z|[+-]\d\d:?\d\d$/.test(date) ? `${date}Z` : date },
              content: childElements(kind).filter((x) => x.name !== 'office:change-info'),
            });
          }
          break;
        }
        // Indexes keep their current text (SwTOXBase is not ported).
        case 'text:table-of-content': {
          // XMLIndexTOCContext: the body's paragraphs become the index, which Update Index regenerates.
          const id = el.attrs.get('text:name') ?? doc.NewTocId();
          const source = child(el, 'text:table-of-content-source');
          doc.m_aTocSettings.set(id, {
            title: textOf(child(source, 'text:index-title-template') ?? EMPTY),
            levels: parseInt(source?.attrs.get('text:outline-level') ?? '10', 10) || 10,
          });
          const initialFree = !initialUsed;
          const firstNew = nodes.GetEndOfContent().GetIndex();
          const indexBody = child(el, 'text:index-body');
          if (indexBody) readBlocks(indexBody);
          if (initialFree && initialIsPara) initial.m_aSet.RES_PARATR_TOX_ID = id;
          for (let i = firstNew; i < nodes.GetEndOfContent().GetIndex(); i++) {
            const n = nodes.node(i);
            if (n.IsTextNode() && n.m_pStartOfSection === nodes.m_pStartOfContent) n.m_aSet.RES_PARATR_TOX_ID = id;
          }
          break;
        }
        case 'text:alphabetical-index': case 'text:bibliography': case 'text:illustration-index':
        case 'text:table-index': case 'text:object-index': case 'text:user-index': {
          lost.add('tables of contents and indexes (their current text is kept)');
          const indexBody = child(el, 'text:index-body');
          if (indexBody) readBlocks(indexBody);
          break;
        }
        case 'text:index-title': readBlocks(el); break;
        // Page-anchored frames and shapes come before the paragraphs.
        case 'draw:custom-shape': case 'draw:rect': case 'draw:g': case 'draw:line': case 'draw:ellipse': case 'draw:polygon': case 'draw:path': case 'draw:connector':
        case 'draw:frame': {
          const fmt = el.name === 'draw:frame' ? readFlyFormat(el) : readShapeFormat(el);
          if (fmt?.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE) doc.m_aPageFlys.push(fmt);
          else if (fmt) { fmt.m_aAnchor = { m_eAnchorId: RndStdIds.FLY_AT_PAGE, m_nPageNumber: 1 }; doc.m_aPageFlys.push(fmt); }
          break;
        }
        default: lost.add(el.name);
      }
    }
  };
  // XMLTextListBlockContext: nested text:list elements are levels of one list.
  const listIdsByXmlId = new Map<string, string>();
  const lastListOfStyle = new Map<string, string>();
  let listCounter = 0;
  const readList = (l: XmlElement, level: number, outer: { rule: string; id: string } | undefined) => {
    let ctx = outer;
    const styleName = l.attrs.get('text:style-name');
    if (!ctx) {
      const rule = (styleName && listStyles.get(styleName)) || '';
      const cont = l.attrs.get('text:continue-list');
      let id = cont ? listIdsByXmlId.get(cont) : undefined;
      if (!id && l.attrs.get('text:continue-numbering') === 'true') id = lastListOfStyle.get(rule);
      id ??= `list${++listCounter}`;
      const xmlId = l.attrs.get('xml:id');
      if (xmlId) listIdsByXmlId.set(xmlId, id);
      lastListOfStyle.set(rule, id);
      ctx = { rule, id };
    } else if (styleName && listStyles.get(styleName)) ctx = { ...ctx, rule: listStyles.get(styleName)! };
    for (const item of childElements(l)) {
      if (item.name !== 'text:list-item' && item.name !== 'text:list-header') continue;
      // Only an item's first paragraph carries its number.
      let counted = item.name === 'text:list-item';
      const start = item.attrs.get('text:start-value');
      let restart = start !== undefined;
      for (const c of childElements(item)) {
        if (c.name === 'text:p' || c.name === 'text:h') {
          const node = readPara(c);
          if (!ctx.rule) continue;
          Object.assign(node.m_aSet, {
            RES_PARATR_NUMRULE: ctx.rule, RES_PARATR_LIST_ID: ctx.id, RES_PARATR_LIST_LEVEL: Math.min(level, MAXLEVEL - 1),
          } satisfies SwAttrSet);
          if (!counted) node.m_aSet.RES_PARATR_LIST_ISCOUNTED = false;
          if (restart) { node.m_aSet.RES_PARATR_LIST_ISRESTART = true; node.m_aSet.RES_PARATR_LIST_RESTARTVALUE = parseInt(start!, 10) || -1; }
          counted = false; restart = false;
        } else if (c.name === 'text:list') readList(c, level + 1, ctx);
        else readBlocks({ ...item, children: [c] });
      }
    }
  };
  // SwXMLTableContext: columns give the widths, covered cells become spans.
  const styleProps = (family: string, name: string | undefined, props: string): XmlElement | undefined =>
    name ? child(styles.get(`${family}/${name}`)?.el, props) : undefined;
  const parseBorder = (v: string | undefined): SvxBorderLine | null | undefined => {
    if (v === undefined) return undefined;
    if (!v || v === 'none' || v.startsWith('0pt') || v.startsWith('0cm')) return null;
    const parts = v.trim().split(/\s+/);
    const width = parts.map((p) => toTwips(p)).find((w) => w !== undefined) ?? 10;
    const color = parts.find((p) => p.startsWith('#')) ?? '#000000';
    return parts.includes('none') || parts.includes('hidden') ? null : { color, width: Math.max(1, width) };
  };
  const cellAttrs = (name: string | undefined, width: number): SwTableBoxAttrs => {
    const a = defaultBoxAttrs(width, false);
    const p = styleProps('table-cell', name, 'style:table-cell-properties');
    if (!p) return a;
    const g = (k: string) => p.attrs.get(k);
    const all = parseBorder(g('fo:border'));
    a.box = {
      left: parseBorder(g('fo:border-left')) ?? all ?? null, right: parseBorder(g('fo:border-right')) ?? all ?? null,
      top: parseBorder(g('fo:border-top')) ?? all ?? null, bottom: parseBorder(g('fo:border-bottom')) ?? all ?? null,
    };
    a.padding = toTwips(g('fo:padding') ?? g('fo:padding-left')) ?? 0;
    const pt = toTwips(g('fo:padding-top')), pb = toTwips(g('fo:padding-bottom'));
    if ((pt !== undefined && pt !== a.padding) || (pb !== undefined && pb !== a.padding)) a.dist = { top: pt ?? a.padding, bottom: pb ?? a.padding };
    const bg = g('fo:background-color');
    a.background = bg && bg !== 'transparent' ? bg : null;
    const va = g('style:vertical-align');
    if (va === 'middle') a.vertOrient = 'center'; else if (va === 'bottom') a.vertOrient = 'bottom';
    const wm = g('style:writing-mode') ?? g('loext:writing-mode');
    // Word writes CSS's sideways-lr and sideways-rl (not in LibreOffice's table): bottom to top
    // and top to bottom.
    if (wm === 'bt-lr' || wm === 'sideways-lr') a.frameDir = 'bt-lr';
    else if (wm === 'tb-rl' || wm === 'sideways-rl') a.frameDir = 'tb-rl';
    // XMLCellProtectPropHdl: "protected" (or "formula-hidden protected") protects the content.
    if (/\bprotected\b/.test(g('style:cell-protect') ?? '')) a.protect = true;
    return a;
  };
  const readTable = (t: XmlElement) => {
    const tp = styleProps('table', t.attrs.get('table:style-name'), 'style:table-properties');
    const align = tp?.attrs.get('table:align');
    const adjust: SwTableAdjust = !align || align === 'margins' ? 'full' : align === 'center' ? 'center' : align === 'right' ? 'right' : align === 'left' ? 'left' : 'none';
    const table = new SwTable({
      name: t.attrs.get('table:name') ?? doc.GetUniqueTableName(), adjust,
      width: toTwips(tp?.attrs.get('style:width')) ?? 0,
      ...(adjust !== 'full' && /%$/.test(tp?.attrs.get('style:rel-width') ?? '') ? { relWidth: parseFloat(tp!.attrs.get('style:rel-width')!) } : {}),
      leftSpace: toTwips(tp?.attrs.get('fo:margin-left')) ?? 0,
      upper: toTwips(tp?.attrs.get('fo:margin-top')) ?? 0, lower: toTwips(tp?.attrs.get('fo:margin-bottom')) ?? 0,
      ...(toTwips(tp?.attrs.get('fo:margin-right')) ? { rightSpace: toTwips(tp?.attrs.get('fo:margin-right')) } : {}),
      ...(tp?.attrs.get('style:may-break-between-rows') === 'false' ? { dontSplit: true } : {}),
      ...(tp?.attrs.get('fo:keep-with-next') === 'always' ? { keepWithNext: true } : {}),
      ...(tp?.attrs.get('fo:break-before') === 'page' ? { breakBefore: true } : {}),
      // style:master-page-name on the table's style starts a page of that style (SwFormatPageDesc).
      ...(() => {
        const master = styles.get(`table/${t.attrs.get('table:style-name')}`)?.el.attrs.get('style:master-page-name');
        if (!master || !descOfMaster.has(master)) return {};
        const pn = tp?.attrs.get('style:page-number');
        return { pageDesc: { name: descOfMaster.get(master)!, numOffset: pn && pn !== 'auto' ? parseInt(pn, 10) || null : null } };
      })(),
      ...(t.attrs.get('table:template-name') ? { styleName: t.attrs.get('table:template-name') } : {}),
    });
    const tableNode = new SwTableNode(nodes, table);
    const at = sectionEnd.GetIndex();
    tableNode.m_pStartOfSection = sectionEnd.m_pStartOfSection;
    nodes.Insert(tableNode, at);
    const tableEnd = new SwEndNode(nodes, tableNode);
    nodes.Insert(tableEnd, at + 1);
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;

    const cols: number[] = [];
    const rows: { el: XmlElement; header: boolean }[] = [];
    const walk = (el: XmlElement, header: boolean) => {
      for (const c of childElements(el)) {
        if (c.name === 'table:table-column') {
          const p = styleProps('table-column', c.attrs.get('table:style-name'), 'style:table-column-properties');
          const rel = p?.attrs.get('style:rel-column-width');
          const w = rel ? parseFloat(rel) : toTwips(p?.attrs.get('style:column-width')) ?? 1000;
          for (let k = parseInt(c.attrs.get('table:number-columns-repeated') ?? '1', 10); k > 0; k--) cols.push(w || 1000);
        } else if (c.name === 'table:table-row') {
          for (let k = Math.min(parseInt(c.attrs.get('table:number-rows-repeated') ?? '1', 10), 1000); k > 0; k--) rows.push({ el: c, header });
        } else if (c.name === 'table:table-header-rows') walk(c, true);
        else if (c.name === 'table:table-columns' || c.name === 'table:table-header-columns' || c.name === 'table:table-column-group' || c.name === 'table:table-rows' || c.name === 'table:table-row-group') walk(c, header);
        else if (c.name !== 'table:title' && c.name !== 'table:desc' && c.name !== 'text:soft-page-break') lost.add(c.name);
      }
    };
    walk(t, false);
    table.m_nRowsToRepeat = rows.filter((r) => r.header).length;
    const colWidth = (c: number) => cols[c] ?? cols[cols.length - 1] ?? 1000;
    // Remaining rows of a vertical merge per column, with its column span.
    const vmerge: { left: number; span: number }[] = [];
    const saved = sectionEnd;
    for (const { el } of rows) {
      const line = new SwTableLine();
      table.m_aLines.push(line);
      const rp = styleProps('table-row', el.attrs.get('table:style-name'), 'style:table-row-properties');
      line.m_aAttrs.minHeight = toTwips(rp?.attrs.get('style:min-row-height') ?? rp?.attrs.get('style:row-height')) ?? 0;
      // XMLTableRowProperties: style:row-height is the fixed height, fo:keep-together the row split.
      if (!rp?.attrs.get('style:min-row-height') && rp?.attrs.get('style:row-height')) line.m_aAttrs.fixHeight = true;
      if (rp?.attrs.get('fo:keep-together') === 'always') line.m_aAttrs.cantSplit = true;
      let col = 0;
      const cells: XmlElement[] = [];
      for (const c of childElements(el)) {
        if (c.name !== 'table:table-cell' && c.name !== 'table:covered-table-cell') continue;
        for (let k = Math.min(parseInt(c.attrs.get('table:number-columns-repeated') ?? '1', 10), 1000); k > 0; k--) cells.push(c);
      }
      for (let ci = 0; ci < cells.length;) {
        const c = cells[ci]!;
        const v = vmerge[col];
        const makeBox = (attrs: SwTableBoxAttrs, rowSpan: number, content?: XmlElement) => {
          const box = new SwTableBox(line, attrs);
          box.setRowSpan(rowSpan);
          const sn = new SwStartNode(nodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
          sn.m_pStartOfSection = tableNode;
          nodes.Insert(sn, tableEnd.GetIndex());
          const en = new SwEndNode(nodes, sn);
          nodes.Insert(en, tableEnd.GetIndex());
          box.m_pStartNode = sn;
          sectionEnd = en;
          if (content) readBlocks(content);
          // Every box holds at least one paragraph.
          if (en.GetIndex() === sn.GetIndex() + 1) nodes.MakeTextNode(en.GetIndex(), doc.FindTextFormatCollByName('Table Contents')!);
          line.m_aBoxes.push(box);
        };
        if (c.name === 'table:covered-table-cell' && v && v.left > 0) {
          // Covered by a merge from above: a box with a negative row span, as wide as the merge.
          let w = 0;
          for (let k = 0; k < v.span; k++) w += colWidth(col + k);
          makeBox({ ...defaultBoxAttrs(w, false) }, -v.left);
          v.left--;
          col += v.span; ci += v.span;
          continue;
        }
        if (c.name === 'table:covered-table-cell') { col++; ci++; continue; } // stray: covered by a span we already widened
        const cspan = Math.max(1, parseInt(c.attrs.get('table:number-columns-spanned') ?? '1', 10));
        const rspan = Math.max(1, parseInt(c.attrs.get('table:number-rows-spanned') ?? '1', 10));
        let w = 0;
        for (let k = 0; k < cspan; k++) w += colWidth(col + k);
        const ba = cellAttrs(c.attrs.get('table:style-name'), w);
        // XMLTableImport: the cell's value, its data style and its formula (Writer's own "ooow:" notation).
        const ds = styles.get(`table-cell/${c.attrs.get('table:style-name')}`)?.el.attrs.get('style:data-style-name');
        const code = ds ? numberStyles.get(ds) : undefined;
        const vt = c.attrs.get('office:value-type');
        let cellValue: number | undefined;
        if (vt === 'float' || vt === 'percentage' || vt === 'currency') cellValue = Number(c.attrs.get('office:value'));
        else if (vt === 'date') { const d = Date.parse(`${c.attrs.get('office:date-value')}${/T/.test(c.attrs.get('office:date-value') ?? '') ? 'Z' : 'T00:00:00Z'}`); if (!Number.isNaN(d)) cellValue = (d - Date.UTC(1899, 11, 30)) / 86400000; }
        else if (vt === 'time') { const m = /^-?PT?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(c.attrs.get('office:time-value') ?? ''); if (m) cellValue = (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) / 86400; }
        else if (vt === 'boolean') cellValue = c.attrs.get('office:boolean-value') === 'true' ? 1 : 0;
        if (cellValue !== undefined && Number.isFinite(cellValue) && (code || vt !== 'float' || c.attrs.get('table:formula'))) ba.value = cellValue;
        if (code && code !== 'General') ba.numFormat = code;
        const fml = c.attrs.get('table:formula');
        if (fml?.startsWith('ooow:')) ba.formula = fml.slice(5).replace(/^=/, '');
        else if (fml) lost.add('formulas not in Writer notation');
        makeBox(ba, rspan, c);
        if (rspan > 1) vmerge[col] = { left: rspan - 1, span: cspan };
        col += cspan; ci += cspan;
      }
    }
    sectionEnd = saved;
    if (!table.m_aLines.length) { nodes.Remove(tableNode.GetIndex(), 2); return; }
  };

  // Header and footer content goes into its page style's section of the autotext area.
  for (const master of masterList) for (const [tag, eTyp, coll, kind] of [
    ['style:header', SwStartNodeType.SwHeaderStartNode, 'Header', 'default'], ['style:footer', SwStartNodeType.SwFooterStartNode, 'Footer', 'default'],
    ['style:header-first', SwStartNodeType.SwHeaderStartNode, 'Header', 'first'], ['style:footer-first', SwStartNodeType.SwFooterStartNode, 'Footer', 'first'],
    ['style:header-left', SwStartNodeType.SwHeaderStartNode, 'Header', 'left'], ['style:footer-left', SwStartNodeType.SwFooterStartNode, 'Footer', 'left'],
  ] as const) {
    const el = child(master, tag);
    if (!el || el.attrs.get('style:display') === 'false') continue;
    // A first or left page variant needs the page style's header to be on at all.
    if (kind !== 'default' && !child(master, tag.replace(/-(first|left)$/, ''))) continue;
    const section = nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!, kind, descOfMaster.get(master.attrs.get('style:name') ?? '') ?? DEFAULT_PAGE_DESC);
    const placeholder = nodes.GoNext(section.GetIndex())!;
    const saved = sectionEnd;
    sectionEnd = section.EndOfSectionNode();
    readBlocks(el);
    sectionEnd = saved;
    // MakeAreaSection's empty paragraph only stays if the header had no content.
    if (section.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
  }

  // Word writes its header and footer distance as the page margin and the rest of its margin as a
  // negative minimum height, also for pages without a header or footer. A negative height can
  // only mean that: the margin is the sum (LibreOffice ignores both and keeps the larger margin).
  for (const pd of doc.m_aPageDescs.values()) {
    const has = (t: SwStartNodeType) => !!nodes.FindAreaSection(t, 'default', pd.m_aName);
    if (pd.nHeaderMinHeight < 0) { if (!has(SwStartNodeType.SwHeaderStartNode)) pd.nTop = Math.max(0, pd.nTop + pd.nHeaderMinHeight); pd.nHeaderMinHeight = 0; }
    if (pd.nFooterMinHeight < 0) { if (!has(SwStartNodeType.SwFooterStartNode)) pd.nBottom = Math.max(0, pd.nBottom + pd.nFooterMinHeight); pd.nFooterMinHeight = 0; }
  }

  const text = child(child(content, 'office:body'), 'office:text');
  if (!text) throw new Error('This document has no text body.');
  readBlocks(text);
  // Chains: each frame names its next one; the next one gets its previous (SwFormatChain).
  for (const [fmt, next] of chainNext) {
    const loc = doc.FindFlyByName(next);
    if (!loc?.fmt || loc.fmt.m_aChain?.m_sPrev || loc.fmt === fmt) continue;
    fmt.m_aChain = { ...fmt.m_aChain, m_sNext: next };
    loc.fmt.m_aChain = { ...loc.fmt.m_aChain, m_sPrev: fmt.m_aName };
  }
  // A document that starts with a table does not keep the initial empty paragraph before it;
  // one that ends with a table gets an empty paragraph after it, so the cursor can go there.
  if (initialUsed && !initialIsPara && (nodes.node(nodes.BodyStart() + 1).IsTableNode() || nodes.node(nodes.BodyStart() + 1).IsSectionNode())) nodes.Remove(nodes.BodyStart());
  if (nodes.node(nodes.GetEndOfContent().GetIndex() - 1).IsEndNode()) nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), standard);
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}

/** The master page of a page style: Writer calls the Default Page Style "Standard" in files. */
const masterName = (desc: string): string => (desc === DEFAULT_PAGE_DESC ? 'Standard' : styleId(desc));

function paragraphProps(s: SwAttrSet, pageNumber?: number): string {
  const p: string[] = [];
  if (pageNumber !== undefined) p.push(`style:page-number="${pageNumber}"`);
  const rl = s.RES_FRAMEDIR === 'rl-tb';
  if (s.RES_FRAMEDIR) p.push(`style:writing-mode="${rl ? 'rl-tb' : 'lr-tb'}"`);
  if (s.RES_PARATR_ADJUST) p.push(`fo:text-align="${{ left: rl ? 'end' : 'start', right: rl ? 'start' : 'end', center: 'center', block: 'justify' }[s.RES_PARATR_ADJUST]}"`);
  if (s.RES_LR_SPACE) p.push(`fo:margin-left="${twipsToCm(s.RES_LR_SPACE.left)}" fo:margin-right="${twipsToCm(s.RES_LR_SPACE.right)}" fo:text-indent="${twipsToCm(s.RES_LR_SPACE.firstLine)}"`);
  if (s.RES_UL_SPACE) p.push(`fo:margin-top="${twipsToCm(s.RES_UL_SPACE.upper)}" fo:margin-bottom="${twipsToCm(s.RES_UL_SPACE.lower)}"${s.RES_UL_SPACE.context ? ' style:contextual-spacing="true"' : ''}`);
  const ls = s.RES_PARATR_LINESPACING;
  if (ls) p.push(ls.rule === 'proportional' ? `fo:line-height="${ls.value}%"` : ls.rule === 'fix' ? `fo:line-height="${twipsToCm(ls.value)}"` : `style:line-height-at-least="${twipsToCm(ls.value)}"`);
  if (s.RES_PARATR_WIDOWS !== undefined) p.push(`fo:widows="${s.RES_PARATR_WIDOWS}"`);
  if (s.RES_PARATR_ORPHANS !== undefined) p.push(`fo:orphans="${s.RES_PARATR_ORPHANS}"`);
  if (s.RES_KEEP !== undefined) p.push(`fo:keep-with-next="${s.RES_KEEP ? 'always' : 'auto'}"`);
  if (s.RES_BREAK === 'page-before') p.push('fo:break-before="page"');
  if (s.RES_BREAK === 'page-after') p.push('fo:break-after="page"');
  if (s.RES_BACKGROUND !== undefined) p.push(`fo:background-color="${s.RES_BACKGROUND ?? 'transparent'}"`);
  if (s.RES_BOX !== undefined) {
    const line = (l: SvxBorderLine | null) => (l ? `${(l.width / 20).toFixed(2)}pt solid ${l.color}` : 'none');
    const b = s.RES_BOX;
    p.push(b ? `fo:padding="${twipsToCm(b.padding)}" fo:border-top="${line(b.top)}" fo:border-bottom="${line(b.bottom)}" fo:border-left="${line(b.left)}" fo:border-right="${line(b.right)}"` : 'fo:border="none"');
  }
  if (s.RES_PARATR_CONNECT_BORDER === false) p.push('style:join-border="false"');
  // RES_PARATR_TOX_ID marks index paragraphs in the model only: text:table-of-content says it in ODF.
  const tabs = s.RES_PARATR_TABSTOP;
  const tabXml = tabs ? `<style:tab-stops>${tabs.map((t) => `<style:tab-stop style:position="${twipsToCm(t.pos)}"${t.adjust === 'left' ? '' : ` style:type="${t.adjust === 'decimal' ? 'char' : t.adjust}"`}${t.adjust === 'decimal' ? ` style:char="${escapeXml(t.decimal)}"` : ''}${t.fill.trim() ? ` style:leader-style="dotted" style:leader-text="${escapeXml(t.fill)}"` : ''}/>`).join('')}</style:tab-stops>` : '';
  if (tabXml) return `<style:paragraph-properties${p.length ? ` ${p.join(' ')}` : ''}>${tabXml}</style:paragraph-properties>`;
  return p.length ? `<style:paragraph-properties ${p.join(' ')}/>` : '';
}

function textProps(s: SwAttrSet): string {
  const p: string[] = [];
  if (s.RES_CHRATR_FONT) { const f = escapeXml(s.RES_CHRATR_FONT); p.push(`style:font-name="${f}" fo:font-family="'${f}'"`); }
  if (s.RES_CHRATR_FONTSIZE) p.push(`fo:font-size="${s.RES_CHRATR_FONTSIZE / 20}pt"`);
  if (s.RES_CHRATR_WEIGHT !== undefined) p.push(`fo:font-weight="${s.RES_CHRATR_WEIGHT ? 'bold' : 'normal'}"`);
  if (s.RES_CHRATR_POSTURE !== undefined) p.push(`fo:font-style="${s.RES_CHRATR_POSTURE ? 'italic' : 'normal'}"`);
  const ul = s.RES_CHRATR_UNDERLINE;
  if (ul) {
    if (ul === 'none') p.push('style:text-underline-style="none"');
    else if (ul === 'double') p.push('style:text-underline-style="solid" style:text-underline-type="double"');
    else p.push(`style:text-underline-style="${ul === 'single' ? 'solid' : ul}" style:text-underline-width="auto" style:text-underline-color="font-color"`);
  }
  if (s.RES_CHRATR_CROSSEDOUT !== undefined) p.push(`style:text-line-through-style="${s.RES_CHRATR_CROSSEDOUT ? 'solid' : 'none'}"`);
  if (s.RES_CHRATR_COLOR) p.push(`fo:color="${s.RES_CHRATR_COLOR}"`);
  // XMLIsAutoColorPropHdl: Automatic, set explicitly (over a style's colour).
  else if (s.RES_CHRATR_COLOR === null) p.push('style:use-window-font-color="true"');
  if (s.RES_CHRATR_BOX !== undefined) p.push(`fo:border="${s.RES_CHRATR_BOX ? `${s.RES_CHRATR_BOX.width / 20}pt solid ${s.RES_CHRATR_BOX.color}` : 'none'}"`);
  if (s.RES_CHRATR_BACKGROUND !== undefined) p.push(`fo:background-color="${s.RES_CHRATR_BACKGROUND ?? 'transparent'}"`);
  if (s.RES_CHRATR_ESCAPEMENT !== undefined) p.push(`style:text-position="${s.RES_CHRATR_ESCAPEMENT > 0 ? `super` : s.RES_CHRATR_ESCAPEMENT < 0 ? 'sub' : '0%'}"`);
  if (s.RES_CHRATR_CASEMAP) p.push(s.RES_CHRATR_CASEMAP === 'smallcaps' ? 'fo:text-transform="none" fo:font-variant="small-caps"' : `fo:text-transform="${s.RES_CHRATR_CASEMAP}" fo:font-variant="normal"`);
  const ol = s.RES_CHRATR_OVERLINE;
  if (ol) {
    if (ol === 'none') p.push('style:text-overline-style="none"');
    else if (ol === 'double') p.push('style:text-overline-style="solid" style:text-overline-type="double"');
    else p.push(`style:text-overline-style="${ol === 'single' ? 'solid' : ol}" style:text-overline-width="auto" style:text-overline-color="font-color"`);
  }
  if (s.RES_CHRATR_SHADOWED !== undefined) p.push(`fo:text-shadow="${s.RES_CHRATR_SHADOWED ? '1pt 1pt' : 'none'}"`);
  if (s.RES_CHRATR_CONTOUR !== undefined) p.push(`style:text-outline="${s.RES_CHRATR_CONTOUR}"`);
  if (s.RES_CHRATR_LANGUAGE) {
    if (s.RES_CHRATR_LANGUAGE === 'zxx') p.push('fo:language="none" fo:country="none"');
    else { const [l, ...rest] = s.RES_CHRATR_LANGUAGE.split('-'); const country = rest.find((x) => /^[A-Z]{2}$|^\d{3}$/.test(x)); p.push(`fo:language="${l}"${country ? ` fo:country="${country}"` : ''}`); }
  }
  return p.length ? `<style:text-properties ${p.join(' ')}/>` : '';
}

/** Serialises text so the ODF whitespace collapsing rules reproduce it exactly on import. */
function serialiseRun(t: string, atParaStart: boolean): string {
  let out = '', buf = '';
  const flush = () => { out += escapeXml(buf); buf = ''; };
  let i = 0;
  let prevSpace = !atParaStart ? false : true;
  while (i < t.length) {
    const c = t[i]!;
    if (c === ' ') {
      let n = 1;
      while (t[i + n] === ' ') n++;
      if (prevSpace) { flush(); out += n > 1 ? `<text:s text:c="${n}"/>` : '<text:s/>'; }
      else { buf += ' '; if (n > 1) { flush(); out += n > 2 ? `<text:s text:c="${n - 1}"/>` : '<text:s/>'; } }
      i += n; prevSpace = true;
      continue;
    }
    if (c === '\t') { flush(); out += '<text:tab/>'; prevSpace = false; i++; continue; }
    if (c === '\n') { flush(); out += '<text:line-break/>'; prevSpace = false; i++; continue; }
    buf += c; prevSpace = false; i++;
  }
  flush();
  return out;
}

const NS = 'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3"';

const styleId = (name: string) => name.replace(/ /g, '_20_').replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

export async function ExportODT(doc: SwDoc): Promise<Uint8Array> {
  const nodes = doc.GetNodes();
  // Automatic styles of content.xml; master page content (headers, footers) uses styles.xml's own.
  const contentAuto = new Map<string, { name: string; xml: string }>();
  const stylesAuto = new Map<string, { name: string; xml: string }>();
  let auto = contentAuto;
  const fonts = new Set<string>();
  const noteFont = (s: SwAttrSet) => { if (s.RES_CHRATR_FONT) fonts.add(s.RES_CHRATR_FONT); };
  const prefixes: Record<string, string> = { paragraph: 'P', text: 'T', table: 'Table', 'table-column': 'Col', 'table-row': 'Row', 'table-cell': 'Cell', graphic: 'fr', section: 'Sect' };
  // SvXMLNumFmtExport: the data styles of the boxes' number formats, by code.
  const dataStyles = new Map<string, { name: string; xml: string }>();
  const dataStyle = (code: string, lang: string): string => {
    const key = `${lang}\n${code}`;
    let e = dataStyles.get(key);
    if (!e) { const name = `N${dataStyles.size + 1}`; e = { name, xml: ExportNumberStyle(name, code, lang) }; dataStyles.set(key, e); }
    return e.name;
  };
  /** XMLTextExport for a table cell's value: office:value-type and its value, table:formula. */
  const cellValueAttrs = (box: SwTableBox): { attrs: string; style: string } => {
    const a = box.m_aAttrs, lang = BoxLanguage(doc, box);
    const code = a.numFormat ?? (a.formula !== undefined || a.value !== undefined ? 'General' : null);
    let attrs = '';
    if (a.formula !== undefined) attrs += ` table:formula="ooow:${escapeXml(a.formula)}"`;
    if (code && a.value !== undefined && !Number.isNaN(a.value)) {
      const vt = ValueTypeOf(code, lang), v = a.value;
      switch (vt) {
        case 'date': attrs += ` office:value-type="date" office:date-value="${new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)).toISOString().replace(/\.000Z$|Z$/, '').replace(/T00:00:00$/, '')}"`; break;
        case 'time': { const sec = Math.round(v * 86400); attrs += ` office:value-type="time" office:time-value="PT${Math.floor(sec / 3600)}H${Math.floor((sec % 3600) / 60)}M${sec % 60}S"`; break; }
        case 'boolean': attrs += ` office:value-type="boolean" office:boolean-value="${v ? 'true' : 'false'}"`; break;
        case 'string': attrs += ' office:value-type="string"'; break;
        default: attrs += ` office:value-type="${vt}" office:value="${v}"`;
      }
    } else attrs += ' office:value-type="string"';
    return { attrs, style: code && code !== 'General' ? ` style:data-style-name="${dataStyle(code, lang)}"` : '' };
  };

  const autoStyle = (family: 'paragraph' | 'text' | 'table' | 'table-column' | 'table-row' | 'table-cell' | 'graphic' | 'section', inner: string, parent?: string, attrs = ''): string => {
    const key = `${family}|${parent ?? ''}|${attrs}|${inner}`;
    let e = auto.get(key);
    if (!e) {
      const name = `${auto === stylesAuto ? 'M' : ''}${prefixes[family]}${auto.size + 1}`;
      e = { name, xml: `<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}${attrs}>${inner}</style:style>` };
      auto.set(key, e);
    }
    return e.name;
  };

  // XMLTextParagraphExport::exportListChange: consecutive paragraphs of one list nest by level.
  const listStyleNames = new Map<SwNumRule, string>();
  const listStyleName = (rule: SwNumRule): string => {
    let name = listStyleNames.get(rule);
    if (!name) {
      name = rule.IsAutoRule() ? `L${[...listStyleNames.keys()].filter((r) => r.IsAutoRule()).length + 1}` : styleId(rule.GetName());
      listStyleNames.set(rule, name);
    }
    return name;
  };
  const xmlIdOfList = new Map<string, string>();
  // The open text:list elements, outermost first, each with the tag of its open item (or null).
  let open: { id: string; lists: (string | null)[] } | null = null;
  const closeLevel = (o: { lists: (string | null)[] }): string => {
    const tag = o.lists.pop();
    return `${tag ? `</${tag}>` : ''}</text:list>`;
  };
  const closeAll = (): string => {
    if (!open) return '';
    let out = '';
    while (open.lists.length) out += closeLevel(open);
    open = null;
    return out;
  };
  const listChange = (n: SwTextNode, rule: SwNumRule): string => {
    const id = n.GetAttr('RES_PARATR_LIST_ID') || `rule:${rule.GetName()}`;
    const depth = Math.min(n.GetAttr('RES_PARATR_LIST_LEVEL'), MAXLEVEL - 1) + 1;
    const counted = n.GetAttr('RES_PARATR_LIST_ISCOUNTED');
    const restart = n.GetAttr('RES_PARATR_LIST_ISRESTART') && counted;
    const startValue = n.GetAttr('RES_PARATR_LIST_RESTARTVALUE');
    let out = '';
    if (open && open.id !== id) out += closeAll();
    if (!open) {
      const prior = xmlIdOfList.get(id);
      const xmlId = prior ?? `list${xmlIdOfList.size + 1}`;
      xmlIdOfList.set(id, xmlId);
      out += `<text:list${prior ? ` text:continue-list="${prior}"` : ` xml:id="${xmlId}"`} text:style-name="${listStyleName(rule)}">`;
      open = { id, lists: [null] };
    }
    const o: { id: string; lists: (string | null)[] } = open;
    // Deeper lists end; at this depth the open item ends.
    while (o.lists.length > depth) out += closeLevel(o);
    if (o.lists.length === depth) {
      const t = o.lists[depth - 1];
      if (t) out += `</${t}>`;
      o.lists[depth - 1] = null;
    }
    // Lists open down to this depth, each inside an item of the list above.
    while (o.lists.length < depth) {
      const last = o.lists.length - 1;
      if (o.lists[last] === null) { out += '<text:list-item>'; o.lists[last] = 'text:list-item'; }
      out += '<text:list>';
      o.lists.push(null);
    }
    const tag = counted ? 'text:list-item' : 'text:list-header';
    out += `<${tag}${restart ? ` text:start-value="${startValue >= 0 ? startValue : rule.Get(depth - 1).GetStart()}"` : ''}>`;
    o.lists[depth - 1] = tag;
    return out;
  };

  // XMLRedlineExport: every change gets a changed-region; insertions are marked by change-start and
  // change-end, deletions by a text:change point where their text (kept in the region) was.
  const redlines = doc.m_pDocumentRedlineManager.GetRedlineTable();
  const redlinePiece = new Map<string, { id: string; first: boolean; last: boolean; type: 'Insert' | 'Delete' }>();
  redlines.forEach((r, i) => r.pieces.forEach((p, k) => redlinePiece.set(`${p.node.GetIndex()}:${p.mark ? 'm' : p.start}`, { id: `ct${i + 1}`, first: k === 0, last: k === r.pieces.length - 1, type: r.data.type })));
  const changeRegions = redlines.map((r, i) => {
    const info = `<office:change-info><dc:creator>${escapeXml(r.data.author)}</dc:creator><dc:date>${escapeXml(r.data.date.replace(/Z$/, ''))}</dc:date></office:change-info>`;
    let body = '';
    if (r.data.type === 'Delete') {
      body = '<text:p>';
      for (const p of r.pieces) body += p.mark ? '</text:p><text:p>' : serialiseRun(p.node.GetText().slice(p.start, p.end).replace(/\u0001/g, ''), p.start === 0);
      body += '</text:p>';
    }
    return `<text:changed-region xml:id="ct${i + 1}" text:id="ct${i + 1}"><text:${r.data.type === 'Insert' ? 'insertion' : 'deletion'}>${info}${body}</text:${r.data.type === 'Insert' ? 'insertion' : 'deletion'}></text:changed-region>`;
  });
  /** Change marks before a paragraph's text: the end of an insertion that covered the previous paragraph's end. */
  const markBefore = (n: SwTextNode): string => {
    const prev = nodes.node(n.GetIndex() - 1);
    const r = prev.IsTextNode() ? redlinePiece.get(`${prev.GetIndex()}:m`) : undefined;
    return r && r.last && r.type === 'Insert' ? `<text:change-end text:change-id="${r.id}"/>` : '';
  };
  /** Change marks after a paragraph's text: its end mark's change. */
  const markAfter = (n: SwTextNode): string => {
    const r = redlinePiece.get(`${n.GetIndex()}:m`);
    if (!r || !r.first) return '';
    return r.type === 'Insert' ? `<text:change-start text:change-id="${r.id}"/>` : `<text:change text:change-id="${r.id}"/>`;
  };

  const paraXml = (n: SwTextNode): string => { const p = paraParts(n); return p.open + p.inner + p.close; };
  const paraParts = (n: SwTextNode): { open: string; inner: string; close: string } => {
    const collId = styleId(n.GetTextColl().GetName());
    noteFont(n.m_aSet);
    const pdesc = n.m_aSet.RES_PAGEDESC;
    // A page style break: the automatic style names the master page and may renumber pages.
    const direct = paragraphProps(n.m_aSet, pdesc?.numOffset ?? undefined) + textProps(charOnly(n.m_aSet));
    const master = pdesc && doc.m_aPageDescs.has(pdesc.name) ? ` style:master-page-name="${masterName(pdesc.name)}"` : '';
    const pStyle = direct || master ? autoStyle('paragraph', direct, collId, master) : collId;
    const text = n.GetText();
    const cuts = new Set([0, text.length]);
    for (const h of n.m_aHints) { cuts.add(h.nStart); cuts.add(h.nEnd); }
    // XMLTextParagraphExport::exportTextFrame: anchored frames go at their anchor position.
    for (const f of n.m_aAnchoredFlys) cuts.add(Math.min(f.nContent, text.length));
    // XMLTextParagraphExport::exportTextRangeEnumeration: bookmarks at their positions, ends first.
    const marks = doc.getIDocumentMarkAccess().getMarksIn(n);
    for (const m of marks) { if (m.GetMarkStart().GetNode() === n) cuts.add(Math.min(m.GetMarkStart().GetContentIndex(), text.length)); if (m.GetMarkEnd().GetNode() === n) cuts.add(Math.min(m.GetMarkEnd().GetContentIndex(), text.length)); }
    const marksAt = (pos: number) => {
      const at = (p: SwPosition) => p.GetNode() === n && Math.min(p.GetContentIndex(), text.length) === pos;
      let out = '';
      for (const m of marks) if (m.IsExpanded() && at(m.GetMarkEnd())) out += `<text:bookmark-end text:name="${escapeXml(m.GetName())}"/>`;
      for (const m of marks) {
        if (!at(m.GetMarkStart())) continue;
        out += m.IsExpanded() ? `<text:bookmark-start text:name="${escapeXml(m.GetName())}"/>` : `<text:bookmark text:name="${escapeXml(m.GetName())}"/>`;
      }
      return out;
    };
    const anchoredAt = (pos: number) => marksAt(pos) + n.m_aAnchoredFlys.filter((f) => Math.min(f.nContent, text.length) === pos).map((f) => flyXml(f.fmt)).join('');
    const sorted = [...cuts].sort((a, b) => a - b);
    let inner = markBefore(n);
    let openLink: string | null = null;
    if (!text.length) inner += anchoredAt(0);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      inner += anchoredAt(a);
      const h = n.m_aHints.find((x) => x.nStart <= a && a < x.nEnd);
      // Adjacent runs with the same URL share one text:a.
      const url = h?.aAttrs.RES_TXTATR_INETFMT ?? null;
      const linkFmt = h?.aAttrs.RES_TXTATR_INETFMT_CHARFMT ?? null;
      if (url !== openLink) {
        if (openLink !== null) inner += '</text:a>';
        if (url !== null) {
          const styles = linkFmt ? `text:style-name="${styleId(linkFmt.GetName())}" text:visited-style-name="${styleId(linkFmt.GetName())}"` : 'text:style-name="Internet_20_link" text:visited-style-name="Visited_20_Internet_20_Link"';
          inner += `<text:a xlink:type="simple" xlink:href="${escapeXml(url)}" ${styles}>`;
        }
        openLink = url;
      }
      const fld = h?.aAttrs.RES_TXTATR_FIELD;
      // XMLTextFieldExport: one element per placeholder, holding the current expansion.
      const fly = h?.aAttrs.RES_TXTATR_FLYCNT;
      const ftn = h?.aAttrs.RES_TXTATR_FTN;
      const ann = h?.aAttrs.RES_TXTATR_ANNOTATION;
      const run = ann ? text.slice(a, b).split('').map(() => annotationXml(ann, n)).join('')
        : ftn ? text.slice(a, b).split('').map(() => noteXml(ftn.id, !!ftn.endnote)).join('')
        : fly ? text.slice(a, b).split('').map(() => frameXml(fly)).join('')
        : fld ? text.slice(a, b).split('').map(() => fieldXml(fld)).join('') : serialiseRun(text.slice(a, b), a === 0);
      const own = h ? (Object.fromEntries(Object.entries(h.aAttrs).filter(([k]) => !k.startsWith('RES_TXTATR_'))) as SwCharAttrSet) : {};
      const cf = h?.aAttrs.RES_TXTATR_CHARFMT;
      const change = h?.aAttrs.RES_TXTATR_REDLINE ? redlinePiece.get(`${n.GetIndex()}:${a}`) : undefined;
      if (change?.type === 'Delete') {
        // The deleted text lives in its changed-region.
        if (change.first) inner += `<text:change text:change-id="${change.id}"/>`;
        continue;
      }
      if (change?.first) inner += `<text:change-start text:change-id="${change.id}"/>`;
      if (Object.keys(own).length) {
        noteFont(own);
        inner += `<text:span text:style-name="${autoStyle('text', textProps(own), cf ? styleId(cf.GetName()) : undefined)}">${run}</text:span>`;
      } else if (cf) inner += `<text:span text:style-name="${styleId(cf.GetName())}">${run}</text:span>`;
      else inner += run;
      if (change?.last) inner += `<text:change-end text:change-id="${change.id}"/>`;
      const mark = h?.aAttrs.RES_TXTATR_ANNOTMARK;
      if (mark) {
        const next = n.m_aHints.find((x) => x.nStart <= b && b < x.nEnd);
        if (next?.aAttrs.RES_TXTATR_ANNOTMARK !== mark) inner += `<office:annotation-end office:name="__Annotation__${escapeXml(mark)}"/>`;
      }
    }
    if (openLink !== null) inner += '</text:a>';
    if (text.length) inner += anchoredAt(text.length);
    inner += markAfter(n);
    return { open: `<text:p text:style-name="${pStyle}">`, inner, close: '</text:p>' };
  };

  /** XMLTextParagraphExport::exportAnnotation: the comment, then annotation-end after its range. */
  const annotationXml = (f: SwPostItField, n: SwTextNode): string => {
    const hasRange = n.m_aHints.some((h) => h.aAttrs.RES_TXTATR_ANNOTMARK === f.id);
    const name = hasRange ? ` office:name="__Annotation__${escapeXml(f.id)}"` : '';
    const paras = f.text.split('\n').map((t) => `<text:p>${serialiseRun(t, true)}</text:p>`).join('');
    return `<office:annotation${name}${f.resolved ? ' loext:resolved="true"' : ''}><dc:creator>${escapeXml(f.author)}</dc:creator><dc:date>${escapeXml(f.date)}</dc:date>${paras}</office:annotation>`;
  };

  // XMLTextParagraphExport::exportTextFootnote: the note body is exported in place, with the list
  // state of the paragraph around it kept aside.
  let noteCount = 0, endnoteCount = 0;
  const noteXml = (id: string, endnote: boolean): string => {
    const sec = nodes.FindFootnoteSection(id);
    if (!sec) return '';
    const nr = endnote ? ++endnoteCount : ++noteCount;
    const saved = open;
    open = null;
    const inner = exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex());
    open = saved;
    return endnote
      ? `<text:note text:id="edn${nr}" text:note-class="endnote"><text:note-citation>${makeNumberingString(NumberingType.ROMAN_LOWER, nr)}</text:note-citation><text:note-body>${inner}</text:note-body></text:note>`
      : `<text:note text:id="ftn${nr}" text:note-class="footnote"><text:note-citation>${nr}</text:note-citation><text:note-body>${inner}</text:note-body></text:note>`;
  };

  // Pictures/ entries of the package, by graphic key.
  const pictures = new Map<string, string>();
  /** Embedded formula objects: their directory and content.xml. */
  const objects: { dir: string; xml: string }[] = [];
  const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/tiff': 'tif', 'image/x-wmf': 'wmf', 'image/x-emf': 'emf' };
  /** XMLClipPropertyHandler::exportXML for SwCropGrf. */
  const clipAttr = (key: string | undefined, crop: SwCropGrf | undefined): string => {
    const g = key !== undefined ? doc.m_aGraphics.get(key) : undefined;
    const pref = crop && g && GetPrefSizeTwips(g.data);
    if (!crop || !pref) return '';
    return `fo:clip="rect(${twipsToCm(crop.top * pref.height)}, ${twipsToCm(crop.right * pref.width)}, ${twipsToCm(crop.bottom * pref.height)}, ${twipsToCm(crop.left * pref.width)})"`;
  };
  /** XMLGrfMirrorPropHdl_Impl: SwMirrorGrf as style:mirror (MirrorGraph::Vertical mirrors left and right, "horizontal"). */
  const mirrorAttr = (m: SwFlyFrameFormat['m_eMirror']): string => (m ? `style:mirror="${({ vertical: 'horizontal', horizontal: 'vertical', both: 'vertical horizontal' } as const)[m]}"` : '');
  /**
   * XMLTextParagraphExport::_exportTextGraphic: a rotated graphic's draw:transform, a rotation
   * about the frame's centre (written, as upstream, with the internal counterclockwise angle).
   */
  const transformAttr = (rotation: number | undefined, x: number, y: number, w: number, h: number): string => {
    if (!rotation) return '';
    const cx = twipsToCm(x + w / 2), cy = twipsToCm(y + h / 2), neg = (v: string) => (v.startsWith('-') ? v.slice(1) : `-${v}`);
    return ` draw:transform="translate (${neg(cx)} ${neg(cy)}) rotate (${((rotation / 10) * Math.PI) / 180}) translate (${cx} ${cy})"`;
  };
  /** svg:title and svg:desc (SdrObject's title and description). */
  const titleDesc = (title: string | undefined, desc: string | undefined) => `${title ? `<svg:title>${escapeXml(title)}</svg:title>` : ''}${desc ? `<svg:desc>${escapeXml(desc)}</svg:desc>` : ''}`;
  const frameXml = (f: SwFlyCnt): string => {
    // SwXMLTextParagraphExport::exportTextEmbedded: a formula is an embedded object in a
    // directory of its own, its MathML in content.xml (SmXMLExport), its frame in the line.
    if (f.math) {
      const dir = `Object ${objects.length + 1}`;
      objects.push({ dir, xml: ExportMathML(f.math.m_sText) });
      const a = ArrangedMathFly(f);
      // AlignFormulaToBaseline: VertOrientation NONE at minus the baseline.
      const vert = f.math.m_bBaseline ? 'style:vertical-pos="from-top" style:vertical-rel="baseline"' : `style:vertical-pos="${f.math.m_eVertOrient === 'center' ? 'middle' : 'top'}" style:vertical-rel="baseline"`;
      const style = autoStyle('graphic', `<style:graphic-properties ${vert}/>`, 'Formula');
      const y = f.math.m_bBaseline ? ` svg:y="${twipsToCm(-(a.m_nAscent ?? 0))}"` : '';
      return `<draw:frame draw:style-name="${style}" draw:name="${escapeXml(f.name)}" text:anchor-type="as-char"${y} svg:width="${twipsToCm(a.width)}" svg:height="${twipsToCm(a.height)}" draw:z-index="0"><draw:object xlink:href="./${dir}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${titleDesc(f.title, f.alt)}</draw:frame>`;
    }
    // A shape in the line: draw:custom-shape anchored as character, on the baseline.
    if (f.shape) return shapeXml(AsCharFormat(f), ['style:vertical-pos="top" style:vertical-rel="baseline"']);
    const g = doc.m_aGraphics.get(f.graphic);
    if (!g) return '';
    let path = pictures.get(f.graphic);
    if (!path) { path = `Pictures/${f.graphic}.${EXT_BY_MIME[g.mime] ?? 'bin'}`; pictures.set(f.graphic, path); }
    const gprops = [clipAttr(f.graphic, f.crop), mirrorAttr(f.mirror), ...ExportGrfAttr(f.m_aGrfAttr)].filter(Boolean).join(' ');
    const style = gprops ? ` draw:style-name="${autoStyle('graphic', `<style:graphic-properties ${gprops}/>`, 'Graphics')}"` : '';
    return `<draw:frame${style} draw:name="${escapeXml(f.name)}" text:anchor-type="as-char" svg:width="${twipsToCm(f.width)}" svg:height="${twipsToCm(f.height)}"${transformAttr(f.rotation, 0, 0, f.width, f.height)} draw:z-index="0"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${g.mime}"/>${titleDesc(f.title, f.alt)}</draw:frame>`;
  };

  /** XMLShapeExport / XMLTextParagraphExport::exportAnyTextFrame for a fly with its graphic style. */
  let flyZ = 0;
  const flyXml = (f: SwFlyFrameFormat): string => {
    const h = f.m_aHoriOrient, v = f.m_aVertOrient;
    const props = [
      `style:wrap="${keyOf(WRAP, f.m_aSurround.m_eSurround, 'parallel')}"`,
      ...(f.m_aSurround.m_eSurround === WrapTextMode.THROUGH ? [`style:run-through="${f.m_bOpaque ? 'foreground' : 'background'}"`] : []),
      `style:number-wrapped-paragraphs="${f.m_aSurround.m_bAnchorOnly ? '1' : 'no-limit'}"`,
      // XMLWrapPropHdl: contour wrap, and around the outside only.
      `style:wrap-contour="${!!f.m_aSurround.m_bContour}"${f.m_aSurround.m_bContour ? ` style:wrap-contour-mode="${f.m_aSurround.m_bOutside ? 'outside' : 'full'}"` : ''}`,
      `style:horizontal-pos="${keyOf(HORI_POS, h.m_eOrient, 'from-left')}" style:horizontal-rel="${keyOf(HORI_REL, h.m_eRelation, 'paragraph')}"`,
      `style:vertical-pos="${keyOf(VERT_POS, v.m_eOrient, 'from-top')}" style:vertical-rel="${keyOf(VERT_REL, v.m_eRelation, 'paragraph')}"`,
      `fo:margin-left="${twipsToCm(f.m_nLeftSpace)}" fo:margin-right="${twipsToCm(f.m_nRightSpace)}" fo:margin-top="${twipsToCm(f.m_nUpperSpace)}" fo:margin-bottom="${twipsToCm(f.m_nLowerSpace)}"`,
    ];
    if (f.m_pShape) return shapeXml(f, props);
    if (f.m_sContentId !== undefined) {
      const b = f.m_aBox;
      props.push(b ? `fo:padding="${twipsToCm(b.padding)}" fo:border-top="${borderXml(b.top)}" fo:border-bottom="${borderXml(b.bottom)}" fo:border-left="${borderXml(b.left)}" fo:border-right="${borderXml(b.right)}"` : 'fo:border="none" fo:padding="0cm"');
      props.push(f.m_aBackground ? `fo:background-color="${f.m_aBackground}"` : 'fo:background-color="transparent" style:background-transparency="100%"');
      if (f.m_eFrameDir) props.push(`style:writing-mode="${f.m_eFrameDir}"`);
    }
    const clip = clipAttr(f.graphic, f.crop);
    if (clip) props.push(clip);
    if (f.m_eMirror) props.push(mirrorAttr(f.m_eMirror));
    if (f.graphic !== undefined) props.push(...ExportGrfAttr(f.m_aGrfAttr));
    const style = autoStyle('graphic', `<style:graphic-properties ${props.join(' ')}/>`, f.m_sContentId !== undefined ? 'Frame' : 'Graphics');
    const anchor = keyOf(ANCHOR, f.m_aAnchor.m_eAnchorId, 'paragraph');
    const pos = `${h.m_eOrient === HoriOrientation.NONE ? ` svg:x="${twipsToCm(h.m_nPos)}"` : ''}${v.m_eOrient === VertOrientation.NONE ? ` svg:y="${twipsToCm(v.m_nPos)}"` : ''}`;
    const head = `<draw:frame draw:style-name="${style}" draw:name="${escapeXml(f.m_aName)}" text:anchor-type="${anchor}"${f.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE ? ` text:anchor-page-number="${Math.max(1, f.m_aAnchor.m_nPageNumber)}"` : ''}${pos} svg:width="${twipsToCm(f.m_nWidth)}"${f.m_bAutoWidth ? ` fo:min-width="${twipsToCm(f.m_nWidth)}"` : ''}`;
    const desc = titleDesc(f.m_sTitle, f.alt);
    if (f.m_sContentId !== undefined) {
      const sec = nodes.FindFlySection(f.m_sContentId);
      const saved = open;
      open = null;
      const inner = sec ? exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex()) + closeAll() : '';
      open = saved;
      const hAttr = f.m_bAutoHeight ? '' : ` svg:height="${twipsToCm(f.m_nHeight)}"`;
      return `${head}${hAttr} draw:z-index="${flyZ++}"><draw:text-box${f.m_bAutoHeight ? ` fo:min-height="${twipsToCm(f.m_nHeight)}"` : ''}${f.m_aChain?.m_sNext ? ` draw:chain-next-name="${escapeXml(f.m_aChain.m_sNext)}"` : ''}>${inner}</draw:text-box>${desc}</draw:frame>`;
    }
    const path = picturePath(f.graphic ?? '');
    if (!path) return '';
    return `${head} svg:height="${twipsToCm(f.m_nHeight)}"${transformAttr(f.m_nGrfRotation, h.m_nPos, v.m_nPos, f.m_nWidth, f.m_nHeight)} draw:z-index="${flyZ++}"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${doc.m_aGraphics.get(f.graphic!)!.mime}"/>${desc}${contourXml(f)}</draw:frame>`;
  };
  /**
   * XMLTextParagraphExport::exportContour: the graphic's contour as draw:contour-polygon, in a view
   * box of the frame's size in 1/100 mm; draw:recreate-on-edit for an automatic contour.
   */
  const contourXml = (f: SwFlyFrameFormat): string => {
    const poly = f.m_aContour?.[0];
    if (!poly || poly.length < 3) return '';
    const w = Math.max(1, Math.round((f.m_nWidth * 2540) / 1440)), h = Math.max(1, Math.round((f.m_nHeight * 2540) / 1440));
    const pts = poly.map(([x, y]) => `${Math.round(x * w)},${Math.round(y * h)}`).join(' ');
    return `<draw:contour-polygon svg:width="${twipsToCm(f.m_nWidth)}" svg:height="${twipsToCm(f.m_nHeight)}" svg:viewBox="0 0 ${w} ${h}" draw:points="${pts}" draw:recreate-on-edit="${!!f.m_bAutoContour}"/>`;
  };
  const gradientStyles = new Map<string, string>();
  /** XMLShapeExport::ImpExportCustomShape: a drawing shape as draw:custom-shape with its geometry. */
  const shapeXml = (f: SwFlyFrameFormat, props: string[]): string => {
    const sh = f.m_pShape!;
    const h = f.m_aHoriOrient, v = f.m_aVertOrient;
    if (sh.m_aFill && sh.m_aGradient) {
      // The gradient is a named style in office:styles; equal gradients share one.
      const xml = ExportGradientStyle(sh.m_aGradient, '%NAME%');
      let name = gradientStyles.get(xml);
      if (!name) { name = `Gradient_20_${gradientStyles.size + 1}`; gradientStyles.set(xml, name); }
      props.push(`draw:fill="gradient" draw:fill-color="${sh.m_aFill}" draw:fill-gradient-name="${name}"${sh.m_aGradient.nStepCount ? ` draw:gradient-step-count="${sh.m_aGradient.nStepCount}"` : ''}`);
    } else props.push(sh.m_aFill ? `draw:fill="solid" draw:fill-color="${sh.m_aFill}"` : 'draw:fill="none"');
    props.push(sh.m_aLine ? `draw:stroke="solid" svg:stroke-color="${sh.m_aLine.color}" svg:stroke-width="${twipsToCm(sh.m_aLine.width)}"` : 'draw:stroke="none"');
    if (f.m_aBox) props.push(`fo:padding="${twipsToCm(f.m_aBox.padding)}"`);
    props.push(`draw:textarea-vertical-align="${sh.m_eTextVertAdjust === 'top' ? 'top' : sh.m_eTextVertAdjust === 'bottom' ? 'bottom' : 'middle'}"`);
    if (sh.m_nFillTransparence) props.push(`draw:opacity="${100 - sh.m_nFillTransparence}%"`);
    const textProps = sh.m_bTextPath && sh.m_sFontName ? `<style:text-properties fo:font-family="'${escapeXml(sh.m_sFontName)}'"/>` : '';
    const style = autoStyle('graphic', `<style:graphic-properties ${props.join(' ')}/>${textProps}`);
    const anchor = keyOf(ANCHOR, f.m_aAnchor.m_eAnchorId, 'paragraph');
    const w = f.m_nWidth, hh = f.m_nHeight;
    const x = h.m_eOrient === HoriOrientation.NONE ? h.m_nPos : null, y = v.m_eOrient === VertOrientation.NONE ? v.m_nPos : null;
    let pos = `${x !== null ? ` svg:x="${twipsToCm(x)}"` : ''}${y !== null ? ` svg:y="${twipsToCm(y)}"` : ''}`;
    // A rotated shape placed by its orientation (a watermark, centred) still needs the rotation;
    // the position in the transform is then not used.
    if (sh.m_nRotate && (x === null || y === null)) {
      const a = (-sh.m_nRotate * Math.PI) / 180;
      pos += ` draw:transform="rotate (${Math.round(a * 1e6) / 1e6})"`;
    } else if (sh.m_nRotate && x !== null && y !== null) {
      // Rotated around the centre: ODF rotates around the top left corner, then moves it.
      // The corner the rotation (clockwise on screen by m_nRotate) takes the top left one to.
      const a = (-sh.m_nRotate * Math.PI) / 180, b = -a, cx = x + w / 2, cy = y + hh / 2;
      const tx = cx - (w / 2) * Math.cos(b) + (hh / 2) * Math.sin(b), ty = cy - (w / 2) * Math.sin(b) - (hh / 2) * Math.cos(b);
      pos = ` draw:transform="rotate (${Math.round(a * 1e6) / 1e6}) translate (${twipsToCm(tx)} ${twipsToCm(ty)})"`;
    }
    let inner = '';
    const sec = f.m_sContentId !== undefined ? nodes.FindFlySection(f.m_sContentId) : null;
    if (sec) {
      const saved = open;
      open = null;
      inner = exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex()) + closeAll();
      open = saved;
    }
    if (sh.m_bTextPath && sh.m_sText) inner = sh.m_sText.split('\n').map((l) => `<text:p>${escapeXml(l)}</text:p>`).join('');
    const type = sh.m_sType === 'line' ? 'ooxml-line' : sh.m_sType;
    const geom = sh.m_aGeometry ?? GetCustomShapeContent(type) ?? GetCustomShapeContent('rectangle')!;
    const page = f.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE ? ` text:anchor-page-number="${Math.max(1, f.m_aAnchor.m_nPageNumber)}"` : '';
    return `<draw:custom-shape draw:style-name="${style}" draw:name="${escapeXml(f.m_aName)}" text:anchor-type="${anchor}"${page}${pos} svg:width="${twipsToCm(w)}" svg:height="${twipsToCm(hh)}" draw:z-index="${flyZ++}">${inner}${ExportEnhancedGeometry(type, geom, sh.m_aAdjust, !!sh.m_bFlipH, !!sh.m_bFlipV, !!sh.m_bTextPath)}</draw:custom-shape>`;
  };
  const picturePath = (key: string): string | null => {
    const g = doc.m_aGraphics.get(key);
    if (!g) return null;
    let path = pictures.get(key);
    if (!path) { path = `Pictures/${key}.${EXT_BY_MIME[g.mime] ?? 'bin'}`; pictures.set(key, path); }
    return path;
  };

  const seqNums = GetSeqNumbers(doc);
  const fieldXml = (f: SwField): string => {
    const shown = escapeXml(f.type === 'Sequence' ? ExpandSeq(f, seqNums.get(f) ?? 1) : DefaultExpand(f));
    switch (f.type) {
      // XMLSequenceFieldExportContext
      case 'Sequence': {
        const name = escapeXml(f.name ?? '');
        return `<text:sequence text:name="${name}" text:formula="ooow:${name}+1" style:num-format="${NUM_FORMAT_OUT[(f.numType ?? NumberingType.ARABIC) as NumberingType] ?? '1'}">${shown}</text:sequence>`;
      }
      case 'PageNumber': return `<text:page-number text:select-page="current">${shown}</text:page-number>`;
      case 'PageCount': return `<text:page-count>${shown}</text:page-count>`;
      case 'Date': return `<text:date${f.fixed !== undefined ? ' text:fixed="true"' : ''}>${shown}</text:date>`;
      case 'Time': return `<text:time${f.fixed !== undefined ? ' text:fixed="true"' : ''}>${shown}</text:time>`;
    }
  };

  const borderXml = (b: SvxBorderLine | null) => (b ? `${b.width / 20}pt solid ${b.color}` : 'none');

  /** SwXMLExport::ExportTable: columns are the union of all rows' cell edges. */
  const tableXml = (t: SwTableNode): string => {
    const table = t.m_pTable, a = table.m_aAttrs;
    const tableWidth = a.adjust === 'full' || !a.width ? doc.m_aPageDesc.PrintWidth() : a.width;
    const edgesOf = (line: SwTableLine) => {
      const total = line.m_aBoxes.reduce((s2, b) => s2 + b.m_aAttrs.width, 0) || 1;
      let x = 0;
      return line.m_aBoxes.map((b) => { const from = x / total; x += b.m_aAttrs.width; return [from, x / total] as const; });
    };
    const key = (v: number) => Math.round(v * 1e6);
    const edgeSet = new Set<number>([0, key(1)]);
    for (const line of table.m_aLines) for (const [f, e] of edgesOf(line)) { edgeSet.add(key(f)); edgeSet.add(key(e)); }
    const edges = [...edgeSet].sort((x, y) => x - y);
    const colIndex = (v: number) => edges.indexOf(key(v));
    const align = { full: 'margins', left: 'left', center: 'center', right: 'right', none: 'left' }[a.adjust];
    const tStyle = autoStyle('table', `<style:table-properties style:width="${twipsToCm(tableWidth)}"${a.relWidth && a.adjust !== 'full' ? ` style:rel-width="${a.relWidth}%"` : ''} table:align="${align}"${a.leftSpace ? ` fo:margin-left="${twipsToCm(a.leftSpace)}"` : ''}${a.rightSpace ? ` fo:margin-right="${twipsToCm(a.rightSpace)}"` : ''}${a.upper ? ` fo:margin-top="${twipsToCm(a.upper)}"` : ''}${a.lower ? ` fo:margin-bottom="${twipsToCm(a.lower)}"` : ''}${a.dontSplit ? ' style:may-break-between-rows="false"' : ''}${a.keepWithNext ? ' fo:keep-with-next="always"' : ''}${a.breakBefore ? ' fo:break-before="page"' : ''}${a.pageDesc?.numOffset != null ? ` style:page-number="${a.pageDesc.numOffset}"` : ''}/>`,
      // A page style break on the table: its automatic style names the master page.
      undefined, a.pageDesc && doc.m_aPageDescs.has(a.pageDesc.name) ? ` style:master-page-name="${masterName(a.pageDesc.name)}"` : '');
    let out = `<table:table table:name="${escapeXml(a.name)}" table:style-name="${tStyle}"${a.styleName ? ` table:template-name="${escapeXml(a.styleName)}"` : ''}>`;
    for (let i = 0; i + 1 < edges.length; i++) {
      const frac = (edges[i + 1]! - edges[i]!) / 1e6;
      out += `<table:table-column table:style-name="${autoStyle('table-column', `<style:table-column-properties style:column-width="${twipsToCm(frac * tableWidth)}" style:rel-column-width="${Math.round(frac * 65535)}*"/>`)}"/>`;
    }
    const repeat = table.GetRowsToRepeat();
    table.m_aLines.forEach((line, li) => {
      if (li === 0 && repeat) out += '<table:table-header-rows>';
      const la = line.m_aAttrs;
      const rowProps = `${la.minHeight ? ` style:${la.fixHeight ? 'row-height' : 'min-row-height'}="${twipsToCm(la.minHeight)}"` : ''}${la.cantSplit ? ' fo:keep-together="always"' : ''}`;
      const rowStyle = rowProps ? ` table:style-name="${autoStyle('table-row', `<style:table-row-properties${rowProps}/>`)}"` : '';
      out += `<table:table-row${rowStyle}>`;
      edgesOf(line).forEach(([f, e], bi) => {
        const box = line.m_aBoxes[bi]!;
        const span = Math.max(1, colIndex(e) - colIndex(f));
        if (box.getRowSpan() < 0) { out += '<table:covered-table-cell/>'.repeat(span); return; }
        const ba = box.m_aAttrs;
        const cStyle = autoStyle('table-cell', `<style:table-cell-properties fo:padding="${twipsToCm(ba.padding)}"${ba.dist ? ` fo:padding-top="${twipsToCm(ba.dist.top)}" fo:padding-bottom="${twipsToCm(ba.dist.bottom)}"` : ''} fo:border-left="${borderXml(ba.box.left)}" fo:border-right="${borderXml(ba.box.right)}" fo:border-top="${borderXml(ba.box.top)}" fo:border-bottom="${borderXml(ba.box.bottom)}"${ba.background ? ` fo:background-color="${ba.background}"` : ''}${ba.vertOrient ? ` style:vertical-align="${ba.vertOrient === 'center' ? 'middle' : 'bottom'}"` : ''}${ba.frameDir ? ` style:writing-mode="${ba.frameDir}"` : ''}${ba.protect ? ' style:cell-protect="protected"' : ''}/>`, undefined, cellValueAttrs(box).style);
        const sn = box.m_pStartNode!;
        out += `<table:table-cell table:style-name="${cStyle}"${cellValueAttrs(box).attrs}${span > 1 ? ` table:number-columns-spanned="${span}"` : ''}${box.getRowSpan() > 1 ? ` table:number-rows-spanned="${box.getRowSpan()}"` : ''}>`;
        out += exportSection(sn.GetIndex() + 1, sn.EndOfSectionNode().GetIndex());
        out += '</table:table-cell>' + '<table:covered-table-cell/>'.repeat(span - 1);
      });
      out += '</table:table-row>';
      if (li + 1 === repeat) out += '</table:table-header-rows>';
    });
    return out + '</table:table>';
  };

  /** Paragraphs and tables of the nodes in [from, to). */
  function exportSection(from: number, to: number): string {
    let out = closeAll();
    for (let i = from; i < to;) {
      const n = nodes.node(i);
      if (n.IsTextNode() && n.m_aSet.RES_PARATR_TOX_ID) {
        // XMLTextParagraphExport::exportIndex: a table of contents with its current text.
        const id = n.m_aSet.RES_PARATR_TOX_ID;
        const kept = doc.m_aTocSettings.get(id);
        let body = '', j = i, title = kept?.title ?? '', levels = kept?.levels ?? 0;
        for (; j < to; j++) {
          const m = nodes.node(j);
          if (!m.IsTextNode() || m.m_aSet.RES_PARATR_TOX_ID !== id) break;
          const lvl = /^Contents (\d+)$/.exec(m.GetTextColl().GetName());
          if (lvl && !kept) levels = Math.max(levels, parseInt(lvl[1]!, 10));
          if (j === i && m.GetTextColl().GetName() === 'Contents Heading') { title ||= m.GetText(); body += `<text:index-title text:name="${escapeXml(id)}_Head">${paraXml(m)}</text:index-title>`; }
          else body += paraXml(m);
        }
        const templates = Array.from({ length: Math.max(levels, 1) }, (_, k) => `<text:table-of-content-entry-template text:outline-level="${k + 1}" text:style-name="Contents_20_${k + 1}"><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:table-of-content-entry-template>`).join('');
        out += closeAll() + `<text:table-of-content text:protected="true" text:name="${escapeXml(id)}"><text:table-of-content-source text:outline-level="${Math.max(levels, 1)}"><text:index-title-template text:style-name="Contents_20_Heading">${escapeXml(title)}</text:index-title-template>${templates}</text:table-of-content-source><text:index-body>${body}</text:index-body></text:table-of-content>`;
        i = j;
      } else if (n.IsTextNode()) {
        const rule = doc.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
        out += rule ? listChange(n, rule) : closeAll();
        // A paragraph whose end is deleted (tracked) is one paragraph with the next in the file.
        const parts = paraParts(n);
        let xml = parts.open + parts.inner;
        let m: SwNode = n;
        while (m.IsTextNode() && m.m_aSet.RES_PARATR_REDLINE?.type === 'Delete' && i + 1 < to && nodes.node(i + 1).IsTextNode()) {
          i++;
          m = nodes.node(i);
          xml += paraParts(m as SwTextNode).inner;
        }
        out += xml + parts.close;
        i++;
      } else if (n.IsTableNode()) {
        out += closeAll() + tableXml(n as SwTableNode);
        i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1;
      } else if (n.IsSectionNode()) {
        // XMLSectionExport: the section's style holds its columns and background.
        const sec = n as SwSectionNode, d = sec.m_pSection;
        const props = `<style:section-properties${d.m_aBackground ? ` fo:background-color="${d.m_aBackground}"` : ''}${d.m_aCol && !d.m_aCol.m_bBalanced ? ' text:dont-balance-text-columns="true"' : ''}>${columnsXml(d.m_aCol)}</style:section-properties>`;
        out += closeAll() + `<text:section text:style-name="${autoStyle('section', props)}" text:name="${escapeXml(d.m_sSectionName)}"${d.m_bHidden ? ' text:display="none"' : ''}${d.m_bProtectFlag ? ' text:protected="true"' : ''}>`;
        out += exportSection(i + 1, sec.EndOfSectionNode().GetIndex()) + '</text:section>';
        i = sec.EndOfSectionNode().GetIndex() + 1;
      } else i++;
    }
    return out + closeAll();
  }

  // Page anchored frames come first in the body (XMLTextParagraphExport::exportPageFrames).
  const pageFrames = doc.m_aPageFlys.map(flyXml).join('');
  const bodyContent = pageFrames + exportSection(nodes.BodyStart(), nodes.GetEndOfContent().GetIndex());
  const rdl = doc.m_pDocumentRedlineManager;
  const body = (changeRegions.length || rdl.m_bRecord ? `<text:tracked-changes${rdl.m_bRecord ? ' text:track-changes="true"' : ''}>${changeRegions.join('')}</text:tracked-changes>` : '') + bodyContent;
  // XMLPageExport: the page styles in use (the default, those paragraphs start, and their follows),
  // each a page layout and a master page with its headers and footers.
  auto = stylesAuto;
  const usedDescs = new Set<string>([DEFAULT_PAGE_DESC]);
  for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) { const d = n.m_aSet.RES_PAGEDESC; if (d && doc.m_aPageDescs.has(d.name)) usedDescs.add(d.name); }
  // Tables can start a page style too (their format's SwFormatPageDesc).
  for (let i = 0; i < nodes.Count(); i++) {
    const k = nodes.node(i);
    const d = k.IsTableNode() ? (k as SwTableNode).m_pTable.GetFrameFormat().pageDesc : undefined;
    if (d && doc.m_aPageDescs.has(d.name)) usedDescs.add(d.name);
  }
  for (const name of [...usedDescs]) for (let d = doc.m_aPageDescs.get(name); d && !usedDescs.has(d.m_sFollow) && doc.m_aPageDescs.has(d.m_sFollow); d = doc.m_aPageDescs.get(d.m_sFollow)) usedDescs.add(d.m_sFollow);
  let pageLayouts = '', masterPages = '';
  [...usedDescs].forEach((name, i) => {
    const d = doc.m_aPageDescs.get(name)!;
    let content = '';
    for (const [tag, eTyp, kind] of [
      ['style:header', SwStartNodeType.SwHeaderStartNode, 'default'], ['style:header-left', SwStartNodeType.SwHeaderStartNode, 'left'], ['style:header-first', SwStartNodeType.SwHeaderStartNode, 'first'],
      ['style:footer', SwStartNodeType.SwFooterStartNode, 'default'], ['style:footer-left', SwStartNodeType.SwFooterStartNode, 'left'], ['style:footer-first', SwStartNodeType.SwFooterStartNode, 'first'],
    ] as const) {
      const sec = nodes.FindAreaSection(eTyp, kind, name);
      if (sec) content += `<${tag}>${exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex())}</${tag}>`;
    }
    const layout = `Mpm${i + 1}`;
    pageLayouts += `<style:page-layout style:name="${layout}"><style:page-layout-properties fo:page-width="${twipsToCm(d.nWidth)}" fo:page-height="${twipsToCm(d.nHeight)}" style:print-orientation="${d.nWidth > d.nHeight ? 'landscape' : 'portrait'}" fo:margin-top="${twipsToCm(d.nTop)}" fo:margin-bottom="${twipsToCm(d.nBottom)}" fo:margin-left="${twipsToCm(d.nLeft)}" fo:margin-right="${twipsToCm(d.nRight)}">${columnsXml(d.m_aCol)}</style:page-layout-properties>${hfStyle(d, true)}${hfStyle(d, false)}</style:page-layout>`;
    const follow = d.m_sFollow !== name && usedDescs.has(d.m_sFollow) ? ` style:next-style-name="${masterName(d.m_sFollow)}"` : '';
    masterPages += `<style:master-page style:name="${masterName(name)}" style:display-name="${escapeXml(name)}" style:page-layout-name="${layout}"${follow}>${content}</style:master-page>`;
  });
  auto = contentAuto;
  function hfStyle(pd: SwPageDesc, bHeader: boolean): string {
    const on = nodes.FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, 'default', pd.m_aName);
    if (!on) return '';
    const minH = bHeader ? pd.nHeaderMinHeight : pd.nFooterMinHeight, sp = bHeader ? pd.nHeaderSpacing : pd.nFooterSpacing;
    const tag = bHeader ? 'style:header-style' : 'style:footer-style';
    return `<${tag}><style:header-footer-properties fo:min-height="${twipsToCm(minH)}" ${bHeader ? 'fo:margin-bottom' : 'fo:margin-top'}="${twipsToCm(sp)}" style:dynamic-spacing="${bHeader ? pd.bHeaderEatSpacing : pd.bFooterEatSpacing}"/></${tag}>`;
  }

  // RES_POOLCHR_INET_NORMAL and RES_POOLCHR_INET_VISIT, referenced by every text:a.
  let named = '<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#000080" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style><style:style style:name="Visited_20_Internet_20_Link" style:display-name="Visited Internet Link" style:family="text"><style:text-properties fo:color="#800000" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>';
  // RES_POOLFRM_GRAPHIC and RES_POOLFRM_FRAME, which frames' automatic styles derive from.
  named += '<style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" style:wrap="dynamic" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph"/></style:style>'
    + '<style:style style:name="Formula" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" fo:margin-left="0cm" fo:margin-right="0cm" style:vertical-pos="top" style:vertical-rel="baseline" style:horizontal-pos="center" style:horizontal-rel="paragraph-content"/></style:style>'
    + '<style:style style:name="Frame" style:family="graphic"><style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" fo:margin-left="0.201cm" fo:margin-right="0.201cm" fo:margin-top="0.201cm" fo:margin-bottom="0.201cm" style:wrap="parallel" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" style:vertical-pos="top" style:vertical-rel="paragraph-content" style:horizontal-pos="center" style:horizontal-rel="paragraph-content" fo:padding="0.15cm" fo:border="0.06pt solid #000000"/></style:style>';
  for (const cf of doc.m_aCharFormats.values()) {
    if (!cf.DerivedFrom()) continue; // the Default Character Style is implicit
    noteFont(cf.m_aSet);
    named += `<style:style style:name="${styleId(cf.GetName())}" style:display-name="${escapeXml(cf.GetName())}" style:family="text">${textProps(cf.m_aSet)}</style:style>`;
  }
  for (const c of doc.m_aTextFormatColls.values()) {
    noteFont(c.m_aSet);
    const parent = c.DerivedFrom();
    const next = c.m_pNextTextFormatColl;
    named += `<style:style style:name="${styleId(c.GetName())}" style:display-name="${escapeXml(c.GetName())}" style:family="paragraph"${parent ? ` style:parent-style-name="${styleId(parent.GetName())}"` : ''}${next ? ` style:next-style-name="${styleId(next.GetName())}"` : ''}>${paragraphProps(c.m_aSet)}${textProps(c.m_aSet)}</style:style>`;
  }
  let autoLists = '', namedLists = '';
  for (const [rule, name] of listStyleNames) {
    if (rule.IsAutoRule()) autoLists += writeListStyle(rule, name);
    else namedLists += writeListStyle(rule, name, rule.GetName());
  }
  noteFont(POOL_DEFAULTS);
  const fontDecls = `<office:font-face-decls>${[...fonts].map((f) => `<style:font-face style:name="${escapeXml(f)}" svg:font-family="'${escapeXml(f)}'"/>`).join('')}</office:font-face-decls>`;
  const dflt: SwAttrSet = { RES_CHRATR_FONT: POOL_DEFAULTS.RES_CHRATR_FONT, RES_CHRATR_FONTSIZE: POOL_DEFAULTS.RES_CHRATR_FONTSIZE, RES_PARATR_WIDOWS: 2, RES_PARATR_ORPHANS: 2, ...doc.m_aDefaults };
  const defaults = `<style:default-style style:family="paragraph">${paragraphProps(dflt)}${textProps(dflt)}</style:default-style>`;
  const pd = doc.m_aPageDesc;
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  // XMLTextFieldExport::ExportFieldDeclarations: the number ranges, LibreOffice's own first.
  const seqNames = new Set(['Illustration', 'Table', 'Text', 'Drawing', 'Figure']);
  for (const f of seqNums.keys()) if (f.name) seqNames.add(f.name);
  const seqDecls = `<text:sequence-decls>${[...seqNames].map((n) => `<text:sequence-decl text:display-outline-level="0" text:name="${escapeXml(n)}"/>`).join('')}</text:sequence-decls>`;
  const contentXml = `${head}<office:document-content ${NS}>${fontDecls}<office:automatic-styles>${[...dataStyles.values()].map((e) => e.xml).join('')}${[...contentAuto.values()].map((e) => e.xml).join('')}${autoLists}</office:automatic-styles><office:body><office:text>${seqDecls}${body}</office:text></office:body></office:document-content>`;
  const stylesXml = `${head}<office:document-styles ${NS}>${fontDecls}<office:styles>${defaults}${named}${namedLists}${[...gradientStyles].map(([xml, name]) => xml.replace('%NAME%', name)).join('')}</office:styles><office:automatic-styles>${pageLayouts}${[...stylesAuto.values()].map((e) => e.xml).join('')}</office:automatic-styles><office:master-styles>${masterPages}</office:master-styles></office:document-styles>`;
  // SvXMLMetaExport: the document properties, with this application as their generator.
  doc.m_xDocProps.setGenerator(GetGeneratorString());
  const metaXml = `${head}<office:document-meta ${NS}>${doc.m_xDocProps.Write()}</office:document-meta>`;
  // SwXMLExport::GetConfigurationSettings, for the settings that are ported.
  const settingsXml = `${head}<office:document-settings ${NS} xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><office:settings><config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="AddParaTableSpacing" config:type="boolean">${doc.m_bParaSpaceMax}</config:config-item><config:config-item config:name="HeaderSpacingBelowLastPara" config:type="boolean">${doc.m_bHeaderSpacingBelowLastPara}</config:config-item><config:config-item config:name="AddParaTableSpacingAtStart" config:type="boolean">${doc.m_bParaSpaceMaxAtPages}</config:config-item><config:config-item config:name="TabOverSpacing" config:type="boolean">${doc.m_bTabOverSpacing}</config:config-item><config:config-item config:name="TabOverMargin" config:type="boolean">${doc.m_bTabOverMargin}</config:config-item><config:config-item config:name="PropLineSpacingShrinksFirstLine" config:type="boolean">${doc.m_bPropLineSpacingShrinksFirstLine}</config:config-item><config:config-item config:name="ImagePreferredDPI" config:type="int">${doc.m_nImagePreferredDPI}</config:config-item><config:config-item config:name="ApplyUserData" config:type="boolean">${doc.m_bUseUserData}</config:config-item><config:config-item config:name="MathBaselineAlignment" config:type="boolean">${doc.m_bMathBaselineAlignment}</config:config-item></config:config-item-set></office:settings></office:document-settings>`;
  const manifest = `${head}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>${[...pictures].map(([k, p]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${doc.m_aGraphics.get(k)!.mime}"/>`).join('')}${objects.map((o) => `<manifest:file-entry manifest:full-path="${o.dir}/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.formula"/><manifest:file-entry manifest:full-path="${o.dir}/content.xml" manifest:media-type="text/xml"/>`).join('')}</manifest:manifest>`;
  const enc = new TextEncoder();
  return writeZip([
    { name: 'mimetype', data: enc.encode(MIME), store: true }, // ODF requires it first and uncompressed
    { name: 'content.xml', data: enc.encode(contentXml) },
    { name: 'styles.xml', data: enc.encode(stylesXml) },
    { name: 'meta.xml', data: enc.encode(metaXml) },
    { name: 'settings.xml', data: enc.encode(settingsXml) },
    // Compressed graphics gain nothing from deflate: store them, as LibreOffice does.
    ...[...pictures].map(([k, p]) => ({ name: p, data: doc.m_aGraphics.get(k)!.data, store: true })),
    ...objects.map((o) => ({ name: `${o.dir}/content.xml`, data: enc.encode(o.xml) })),
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
  ]);
}
