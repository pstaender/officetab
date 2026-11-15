// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/xml/swxml.cxx reduced
// @upstream sw/source/filter/xml/wrtxml.cxx reduced
// @upstream sw/source/uibase/uiview/view.cxx reduced
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
// @upstream xmloff/source/text/XMLIndexMarkExport.cxx reduced
// @upstream xmloff/source/text/txtfldi.cxx partial
// @upstream xmloff/source/text/XMLSectionExport.cxx partial
// Reads and writes paragraphs, spans, styles and page geometry. Unsupported content is reported
// through `ImportResult.lost` so that callers can warn before a save would drop it.
import { GetExpand, RefFieldFormat, ReferencesSubtype, SetExpand } from '../../core/fields/reffld.ts';
import { DocInfoExpandImpl, GetContent, SetContent, SwDocInfoSubType, SwDocStatSubType } from '../../core/fields/docufld.ts';
import { ExportGradientStyle, ImportGradientStyle } from '../../../../xmloff/source/style/GradientStyle.ts';
import type { BGradient } from '../../../../basegfx/source/tools/gradienttools.ts';
import { EnhancedCustomShapeSegmentCommand } from '../../../../svx/source/customshapes/EnhancedCustomShape2d.ts';
import { ImportPolyShape } from '../../../../xmloff/source/draw/ximpshap.ts';
import { readZip, writeZip, type ZipEntry } from '../../../../package/source/zipapi/zip.ts';
import { child, childElements, escapeXml, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { SwDoc, type FontFamily, type SwViewData } from '../../../inc/doc.ts';
import { SwPosition } from '../../../inc/pam.ts';
import { GetCrossRefHeadingBookmarkNamePrefix, GetCrossRefNumItemBookmarkNamePrefix, MarkType, type MarkBase } from '../../core/doc/docbm.ts';
import { MetaOf, SfxDocumentMetaData } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';
import { GetGeneratorString } from '../../../../unotools/source/config/docinfohelper.ts';
import { NormalizeGrfAttr, type SwGrfAttr, type SwMathObj } from '../../../inc/hintids.ts';
import { ImportMathMLString } from '../../../../starmath/source/mathml/mathmlimport.ts';
import { ExportMathML } from '../../../../starmath/source/mathml/mathmlexport.ts';
import { CH_TXTATR_BREAKWORD, ODF_FORMCHECKBOX_RESULT, ODF_FORMDROPDOWN_LISTENTRY, ODF_FORMDROPDOWN_RESULT, ODF_FORMTEXT, POOL_DEFAULTS, type FontLineStyle, type SvxAdjust, type SvxBorderLine, type SvxParaBox, type SwAttrSet, type SwCharAttrSet, type SwAttrs, type SwCropGrf, type SwField, type SwFlyCnt, type SwPostItField, type SwRedlineData } from '../../../inc/hintids.ts';
import { GraphicDrawMode } from '../../../../drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import { ExportNumberStyle, ImportNumberStyles, ValueTypeOf } from '../../../../xmloff/source/style/xmlnumfe.ts';
import { BoxLanguage } from '../../core/fields/cellfml.ts';
import { RecodeBullet } from '../../../../unotools/source/misc/fontcvt.ts';
import { ExportEnhancedGeometry, ImportEnhancedGeometry } from '../../../../xmloff/source/draw/ximpcustomshape.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { GetPrefSizeTwips } from '../../../../vcl/source/filter/GraphicFormatDetector.ts';
import type { SwCharFormat, SwTextFormatColl } from '../../../inc/format.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule, type SvxNumLabelFollowedBy } from '../../../inc/numrule.ts';
import { NumberingType, makeNumberingString, makeNumberingIdentifier, getNumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { ExpandSeq, FindUserFieldType, GetDocLanguage, GetSeqNumbers, SwGetSetExpType, SwInputFieldSubType, SwSetExpFieldType, UpdateExpFields } from '../../core/fields/expfld.ts';
import { DoubleToString, SwUserFieldType, SwUserType } from '../../core/fields/usrfld.ts';
import { ArrangedMathFly, DefaultExpand } from '../../core/text/itrform2.ts';
import { SwTOXMark } from '../../../inc/tox.ts';
import { TOXTypes, ToxAuthorityField } from '../../../inc/toxe.ts';
import { GetTOXType, GetUserTOXType, SetMarks } from '../../core/doc/doctxm.ts';
import { ConditionalExpandAuthIdentifier, SwAuthEntry } from '../../../inc/authfld.ts';
import { SwEndNode, SwSectionNode, SwStartNode, SwTableNode, type SwNode, type SwSectionData } from '../../../inc/node.ts';
import { DEF_GUTTER_WIDTH, type SwFormatCol } from '../../../inc/fmtclds.ts';
import { DEFAULT_PAGE_DESC, type SwPageDesc } from '../../../inc/pagedesc.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SwTableAdjust, type SwTableBoxAttrs } from '../../../inc/swtable.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { AsCharFormat, COL_DEFAULT_SHAPE_FILLING, FlyCntOf, COL_DEFAULT_SHAPE_STROKE, HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SdrShape, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';

/** lcl_aReferenceTypeTokenMap: text:reference-format by RefFieldFormat (page-desc is written as page). */
const REFERENCE_FORMATS = ['page', 'chapter', 'text', 'direction', 'page-desc', 'category-and-value', 'caption', 'value', 'number', 'number-no-superior', 'number-all-superior'];

const MIME = 'application/vnd.oasis.opendocument.text';
// The writer8_template filter's media type (filter/source/config/fragments/types/writer8_template.xcu).
const MIME_TEMPLATE = 'application/vnd.oasis.opendocument.text-template';


/** A formula attribute's formula: without the ooow: namespace prefix (XMLTextImportHelper's GetKeyByAttrValueQName). */
/**
 * XMLTextFieldExport::MapBibliographyFieldName: the attribute of each field of a bibliography
 * entry (ToxAuthorityField order); the last three are LibreOffice's extensions (loext).
 */
const BIBLIOGRAPHY_ATTRS = ['identifier', 'bibliography-type', 'address', 'annote', 'author', 'booktitle', 'chapter', 'edition', 'editor',
  'howpublished', 'institution', 'journal', 'month', 'note', 'number', 'organizations', 'pages', 'publisher', 'school', 'series', 'title',
  'report-type', 'volume', 'year', 'url', 'custom1', 'custom2', 'custom3', 'custom4', 'custom5', 'isbn', 'local-url', 'target-type', 'target-url'];
const BIBLIOGRAPHY_ATTR = (i: number) => `${i >= ToxAuthorityField.AUTH_FIELD_LOCAL_URL ? 'loext' : 'text'}:${BIBLIOGRAPHY_ATTRS[i]}`;
/** aBibliographyDataTypeMap: text:bibliography-type, in ToxAuthorityType order. */
const BIBLIOGRAPHY_TYPES = ['article', 'book', 'booklet', 'conference', 'inbook', 'incollection', 'inproceedings', 'journal', 'manual',
  'mastersthesis', 'misc', 'phdthesis', 'proceedings', 'techreport', 'unpublished', 'email', 'www', 'custom1', 'custom2', 'custom3', 'custom4', 'custom5'];
/** XMLIndexMarkExport's element names of each kind of index mark: collapsed, start, end. */
const INDEX_MARK_ELEMENTS = { toc: 'text:toc-mark', user: 'text:user-index-mark', alpha: 'text:alphabetical-index-mark' } as const;

function OoowFormula(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.startsWith('ooow:') ? s.slice(5) : s;
}

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
/**
 * XMLBorderHdl: fo:border and its sides, fo:padding the distance to the text. Undefined when the
 * properties name no border, null for no lines.
 */
function readBox(a: (k: string) => string | undefined): SvxParaBox | null | undefined {
  const borderOf = (v: string | undefined): SvxBorderLine | null | undefined => {
    if (v === undefined) return undefined;
    const parts = v.trim().split(/\s+/);
    if (!v || parts.includes('none') || parts.includes('hidden')) return null;
    const width = parts.map((p) => toTwips(p)).find((w) => w !== undefined) ?? 10;
    return width <= 0 ? null : { color: parts.find((p) => p.startsWith('#')) ?? '#000000', width: Math.max(1, width) };
  };
  const all = borderOf(a('fo:border'));
  const sides = { top: borderOf(a('fo:border-top')) ?? all, bottom: borderOf(a('fo:border-bottom')) ?? all, left: borderOf(a('fo:border-left')) ?? all, right: borderOf(a('fo:border-right')) ?? all };
  if (!Object.values(sides).some((x) => x !== undefined)) return undefined;
  const box = { top: sides.top ?? null, bottom: sides.bottom ?? null, left: sides.left ?? null, right: sides.right ?? null, padding: toTwips(a('fo:padding') ?? a('fo:padding-left')) ?? 0 };
  return box.top || box.bottom || box.left || box.right ? box : null;
}

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
    const box = readBox(a);
    if (box !== undefined) out.RES_BOX = box;
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
/** SvXMLUnitConverter::convertNumFormat: the five ODF formats, else the numbering provider's identifiers. */
const numFormatIn = (fmt: string): NumberingType | undefined => NUM_FORMATS[fmt] ?? getNumberingType(fmt);

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
      let t = numFormatIn(fmt) ?? NumberingType.ARABIC;
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
/** SvXMLUnitConverter::convertNumFormat for export: the identifier of the other types. */
const numFormatOut = (t: NumberingType): string => NUM_FORMAT_OUT[t] ?? makeNumberingIdentifier(t) ?? '1';

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
      levels += `<text:list-level-style-number text:level="${n + 1}" style:num-prefix="${escapeXml(f.GetPrefix())}" style:num-suffix="${escapeXml(f.GetSuffix())}" style:num-format="${escapeXml(numFormatOut(t))}"${sync}${fix}${f.GetStart() !== 1 ? ` text:start-value="${f.GetStart()}"` : ''}${f.GetIncludeUpperLevels() > 1 ? ` text:display-levels="${f.GetIncludeUpperLevels()}"` : ''}>${props}</text:list-level-style-number>`;
    }
  }
  return `<text:list-style style:name="${styleName}"${display ? ` style:display-name="${escapeXml(display)}"` : ''}>${levels}</text:list-style>`;
}

const charOnly = (s: SwAttrSet): SwCharAttrSet => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('RES_CHRATR_'))) as SwCharAttrSet;

/**
 * The imported document, what it lost, and for packages the package's streams (the storage
 * SfxMedium keeps, which holds the version list and the versions).
 */
/** `template`: the package is an ODF text template (.ott), by its mimetype. */
export interface ImportResult { doc: SwDoc; lost: string[]; storage?: Map<string, Uint8Array>; template?: boolean }

const decodeXml = (b: Uint8Array) => new TextDecoder().decode(b);
/** The content of a package without content.xml: one empty paragraph. */
const EMPTY_CONTENT = '<office:document-content><office:body><office:text><text:p/></office:text></office:body></office:document-content>';

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

/** bRepairPackage: the MediaDescriptor's RepairPackage, which reads a broken package's entries from their local headers. */
const mm100ToTwip = (n: number) => Math.round((n * 1440) / 2540);
const twipToMm100 = (n: number) => Math.round((n * 2540) / 1440);

/**
 * settings.xml's ooo:view-settings, as SwView::ReadUserDataSequence reads them: the first view's
 * ViewLeft and ViewTop (the cursor) and VisibleLeft and VisibleTop, from 1/100 mm to twips.
 */
export function ReadViewSettings(xml: string): SwViewData | null {
  const set = /<config:config-item-set config:name="ooo:view-settings">([\s\S]*?)<\/config:config-item-set>/.exec(xml)?.[1];
  const view = set && /<config:config-item-map-indexed config:name="Views">\s*<config:config-item-map-entry>([\s\S]*?)<\/config:config-item-map-entry>/.exec(set)?.[1];
  if (!view) return null;
  const item = (name: string) => { const m = new RegExp(`<config:config-item config:name="${name}"[^>]*>(-?\\d+)<`).exec(view); return m ? mm100ToTwip(Number(m[1])) : undefined; };
  const nViewLeft = item('ViewLeft'), nViewTop = item('ViewTop');
  if (nViewLeft === undefined || nViewTop === undefined) return null;
  return { nViewLeft, nViewTop, nVisibleLeft: item('VisibleLeft'), nVisibleTop: item('VisibleTop') };
}

/**
 * SwView::WriteUserDataSequence, the part that is ported: one view with the cursor and the visible
 * area in 1/100 mm. VisibleRight and VisibleBottom, no longer read, are written for older versions,
 * here equal to the left and top as for an empty area.
 */
export function WriteViewSettings(d: SwViewData | null): string {
  if (!d) return '';
  const int = (name: string, v: number) => `<config:config-item config:name="${name}" config:type="long">${twipToMm100(v)}</config:config-item>`;
  const left = d.nVisibleLeft ?? 0, top = d.nVisibleTop ?? 0;
  return `<config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item config:name="ViewId" config:type="string">view2</config:config-item>${int('ViewLeft', d.nViewLeft)}${int('ViewTop', d.nViewTop)}${int('VisibleLeft', left)}${int('VisibleTop', top)}${int('VisibleRight', left)}${int('VisibleBottom', top)}</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set>`;
}

export async function ImportODT(bytes: Uint8Array, bRepairPackage = false): Promise<ImportResult> {
  const files = await readZip(bytes, bRepairPackage);
  if (files.has('META-INF/manifest.xml') && new TextDecoder().decode(files.get('META-INF/manifest.xml')).includes('encryption-data')) {
    throw new Error('This document is password-protected. Encrypted documents cannot be opened yet.');
  }
  // SwXMLImport reads the streams a package has: a package of styles only (as LibreOffice's
  // styles templates) has an empty body.
  const contentBytes = files.get('content.xml') ?? (files.has('styles.xml') ? new TextEncoder().encode(EMPTY_CONTENT) : undefined);
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
    const tal = /config:name="TabAtLeftIndentForParagraphsInList"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (tal) doc.m_bTabAtLeftIndentForParagraphsInList = tal[1] === 'true';
    const dpi = /config:name="ImagePreferredDPI"[^>]*>(\d+)</.exec(decodeXml(settingsBytes));
    if (dpi) doc.m_nImagePreferredDPI = Number(dpi[1]);
    const ud = /config:name="ApplyUserData"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (ud) doc.m_bUseUserData = ud[1] === 'true';
    const svc = /config:name="SaveVersionOnClose"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (svc) doc.m_bSaveVersionOnClose = svc[1] === 'true';
    const pb = /config:name="ProtectBookmarks"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (pb) doc.m_bProtectBookmarks = pb[1] === 'true';
    const pf = /config:name="ProtectFields"[^>]*>(true|false)</.exec(decodeXml(settingsBytes));
    if (pf) doc.m_bProtectFields = pf[1] === 'true';
  }
  // SwXMLImport::SetViewSettings and SwView::ReadUserDataSequence: the first view's cursor and visible area.
  if (settingsBytes) doc.m_aViewData = ReadViewSettings(decodeXml(settingsBytes));
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
      const generic = f.attrs.get('style:font-family-generic');
      if (family && generic && ['roman', 'swiss', 'modern', 'script', 'decorative'].includes(generic)) doc.m_aFontFamilies.set(family.replace(/^['"]|['"]$/g, ''), generic as FontFamily);
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
  // XMLIndexBibliographyConfigurationContext: the citations' brackets, numbering and sort keys.
  const biblioConf = childElements(child(stylesDoc, 'office:styles') ?? EMPTY_EL).find((e) => e.name === 'text:bibliography-configuration');
  if (biblioConf) {
    const pAuthType = doc.m_pAuthorityFieldType;
    pAuthType.SetPreSuffix((biblioConf.attrs.get('text:prefix') ?? '').slice(0, 1), (biblioConf.attrs.get('text:suffix') ?? '').slice(0, 1));
    pAuthType.SetSequence(biblioConf.attrs.get('text:numbered-entries') === 'true');
    pAuthType.SetSortByDocument(biblioConf.attrs.get('text:sort-by-position') !== 'false');
    pAuthType.m_sSortAlgorithm = biblioConf.attrs.get('text:sort-algorithm') ?? '';
    const lang = biblioConf.attrs.get('fo:language');
    if (lang) pAuthType.m_eLanguage = [lang, biblioConf.attrs.get('fo:country')].filter((x) => x && x !== 'none').join('-');
    pAuthType.SetSortKeys(childElements(biblioConf).filter((k) => k.name === 'text:sort-key').flatMap((k) => {
      const eField = BIBLIOGRAPHY_ATTRS.indexOf(k.attrs.get('text:key') ?? '');
      return eField < 0 ? [] : [{ eField: eField as ToxAuthorityField, bSortAscending: k.attrs.get('text:sort-ascending') !== 'false' }];
    }));
  }
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
      const numFmt = lp.attrs.get('style:num-format');
      if (numFmt) pd.m_nNumType = numFormatIn(numFmt) ?? pd.m_nNumType;
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
      // The header's or footer's border and background (RES_BOX, RES_BACKGROUND of its frame format).
      const box = readBox((k) => hp.attrs.get(k)) ?? null;
      const bg = hp.attrs.get('fo:background-color');
      const background = bg && bg !== 'transparent' ? bg : null;
      if (bHeader) { pd.m_aHeaderBox = box; pd.m_aHeaderBackground = background; }
      else { pd.m_aFooterBox = box; pd.m_aFooterBackground = background; }
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
  const refMarkStarts = new Map<string, { node: SwTextNode; nContent: number }>();
  /** The number range fields by their text:ref-name, and the reference fields to resolve with them. */
  const sequenceIds = new Map<string, SwField>();
  const refFields: SwField[] = [];
  /** The notes' ids in the file (text:id) and in the document. */
  const noteIds = new Map<string, string>();
  const makeBookmark = (name: string, n1: SwTextNode, c1: number, n2: SwTextNode, c2: number, eRefType?: MarkType) => {
    if (!name) return;
    const p1 = new SwPosition(n1, c1), p2 = new SwPosition(n2, c2);
    // Cross-reference heading bookmarks keep their type, so the index finds them again.
    const eType = eRefType ?? (name.startsWith(GetCrossRefHeadingBookmarkNamePrefix()) ? MarkType.CROSSREF_HEADING_BOOKMARK : name.startsWith(GetCrossRefNumItemBookmarkNamePrefix()) ? MarkType.CROSSREF_NUMITEM_BOOKMARK : MarkType.BOOKMARK);
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
        // XMLTextMarkImportContext: form fields (fieldmarks) with their field:param children; a
        // text form field's text, up to field:fieldmark-end, becomes its content.
        case 'field:fieldmark': case 'field:fieldmark-start': {
          const params: NonNullable<SwField['params']> = {};
          for (const p of childElements(c)) {
            if (p.name !== 'field:param') continue;
            const k = p.attrs.get('field:name') ?? '', v = p.attrs.get('field:value') ?? '';
            // txtimp.cxx's FieldParamImporter: the list's entries, the selection's index, flags.
            if (k === ODF_FORMDROPDOWN_LISTENTRY) params[k] = [...((params[k] as string[] | undefined) ?? []), v];
            else if (k === ODF_FORMDROPDOWN_RESULT) params[k] = parseInt(v, 10) || 0;
            else if (k === ODF_FORMCHECKBOX_RESULT) params[k] = v === 'true';
            else params[k] = v;
          }
          const field: SwField = { type: 'Fieldmark', fieldType: c.attrs.get('field:type') ?? '', name: c.attrs.get('text:name') ?? '', params };
          if (c.name === 'field:fieldmark') append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          else { field.content = ''; openFieldmark = field; }
          break;
        }
        case 'field:fieldmark-separator': break;
        case 'field:fieldmark-end': {
          const field = openFieldmark;
          openFieldmark = null;
          if (field) append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLTextFieldImportContext for the field types ported (SwField).
        case 'text:page-number': case 'text:page-count': {
          // Without style:num-format the field numbers as its page's style (SVX_NUM_PAGEDESC).
          const field: SwField = { type: c.name === 'text:page-number' ? 'PageNumber' : 'PageCount' };
          const fmt = c.attrs.get('style:num-format');
          const t = fmt ? numFormatIn(fmt) : undefined;
          if (t !== undefined) field.numType = t;
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLSimpleDocInfoImportContext, XMLDateTimeDocInfoImportContext, XMLRevisionDocInfoImportContext
        // and XMLUserDocInfoImportContext: a fixed field keeps the text it showed.
        case 'text:title': case 'text:subject': case 'text:keywords': case 'text:description': case 'text:editing-cycles': case 'text:editing-duration':
        case 'text:initial-creator': case 'text:creation-date': case 'text:creation-time': case 'text:creator': case 'text:modification-date':
        case 'text:modification-time': case 'text:printed-by': case 'text:print-date': case 'text:print-time': case 'text:user-defined': {
          const field: SwField = { type: 'DocInfo', subType: DOCINFO_ELEMENTS.find(([, e]) => e === c.name)![0] };
          if (c.name === 'text:user-defined') field.name = c.attrs.get('text:name') ?? '';
          if (c.attrs.get('text:fixed') === 'true') field.fixed = textOf(c);
          SetContent(field, textOf(c));
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLCountFieldImportContext
        case 'loext:page-count-range': case 'text:paragraph-count': case 'text:word-count': case 'text:character-count':
        case 'text:table-count': case 'text:image-count': case 'text:object-count': {
          const field: SwField = { type: 'DocStat', subType: COUNT_ELEMENTS.find(([, e]) => e === c.name)![0] };
          const fmt = c.attrs.get('style:num-format');
          const t = fmt ? numFormatIn(fmt) : undefined;
          if (t !== undefined) field.numType = t;
          SetContent(field, textOf(c));
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLSetVarFieldImportContext and its subclasses (txtvfldi.cxx): variables, input fields,
        // formulas and user fields; text:display none is invisible, formula shows the command.
        case 'text:variable-set': case 'text:variable-input': case 'text:variable-get': case 'text:expression':
        case 'text:user-field-get': case 'text:user-field-input': case 'text:text-input': {
          const sName = c.attrs.get('text:name') ?? '';
          const sDisplay = c.attrs.get('text:display');
          const sContent = textOf(c);
          const bString = c.attrs.get('office:value-type') === 'string';
          // XMLValueImportHelper: the formula (default: the text shown), the data style's code.
          const sFormula = OoowFormula(c.attrs.get('text:formula')) ?? (bString ? c.attrs.get('office:string-value') : undefined) ?? sContent;
          const ds = c.attrs.get('style:data-style-name');
          const sCode = ds ? numberStyles.get(ds) : undefined;
          let field: SwField;
          switch (c.name) {
            case 'text:variable-set': case 'text:variable-input': {
              // FindFieldMaster: the declared variable, else one of the field's value type.
              const t = doc.InsertFieldType(new SwSetExpFieldType(sName));
              // XMLVariableSetFieldImportContext::PrepareField: the field's value type is its variable's.
              if (c.name === 'text:variable-set' || !doc.IsUsed('SetExp', sName)) t.SetType(bString ? SwGetSetExpType.String : SwGetSetExpType.Expr);
              field = { type: 'SetExp', name: sName, formula: sFormula };
              if (sDisplay === 'none') field.subType = SwGetSetExpType.Invisible;
              if (c.name === 'text:variable-input') { field.input = true; field.prompt = c.attrs.get('text:description') ?? ''; }
              break;
            }
            case 'text:variable-get': {
              // SwGetExpField's late initialization: a string variable's field shows its text.
              const t = doc.m_aSetExpFieldTypes.get(sName);
              field = { type: 'GetExp', formula: sName, subType: ((t ? t.GetType() : bString ? SwGetSetExpType.String : SwGetSetExpType.Expr) & SwGetSetExpType.LowerMask) | (sDisplay === 'formula' ? SwGetSetExpType.Command : 0) };
              break;
            }
            case 'text:expression':
              field = { type: 'GetExp', formula: sFormula, subType: SwGetSetExpType.Formula | (bString ? SwGetSetExpType.String : 0) | (sDisplay === 'formula' ? SwGetSetExpType.Command : 0) };
              break;
            case 'text:user-field-get':
              field = { type: 'User', name: sName, subType: (sDisplay === 'none' ? SwUserType.Invisible : 0) | (sDisplay === 'formula' ? SwUserType.ShowCommand : 0) };
              if (!doc.m_aUserFieldTypes.has(sName)) doc.InsertFieldType(new SwUserFieldType(sName));
              break;
            case 'text:user-field-input':
              field = { type: 'Input', subType: SwInputFieldSubType.User | SwInputFieldSubType.Invisible, content: sName, prompt: c.attrs.get('text:description') ?? '' };
              break;
            default:
              field = { type: 'Input', subType: SwInputFieldSubType.Text, content: sContent, prompt: c.attrs.get('text:description') ?? '' };
          }
          if (sCode && sCode !== 'General' && field.type !== 'Input') field.numFormat = sCode;
          SetContent(field, sContent);
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLPageVarSetFieldImportContext, XMLPageVarGetFieldImportContext
        case 'text:page-variable-set': {
          const field: SwField = { type: 'RefPageSet', subType: c.attrs.get('text:active') === 'false' ? 0 : 1 };
          const nAdjust = Number.parseInt(c.attrs.get('text:page-adjust') ?? '0', 10);
          if (nAdjust) field.offset = nAdjust;
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        case 'text:page-variable-get': {
          const field: SwField = { type: 'RefPageGet' };
          const fmt = c.attrs.get('style:num-format');
          const t = fmt ? numFormatIn(fmt) : undefined;
          if (t !== undefined) field.numType = t;
          SetContent(field, textOf(c));
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLSequenceFieldImportContext
        case 'text:sequence': {
          const field: SwField = { type: 'Sequence', name: c.attrs.get('text:name') ?? '' };
          // text:formula: kept unless it is the default name+1.
          const sSeqFormula = OoowFormula(c.attrs.get('text:formula'));
          if (sSeqFormula && sSeqFormula.replace(/\s+/g, '') !== `${field.name}+1`) field.formula = sSeqFormula;
          const t = numFormatIn(c.attrs.get('style:num-format') ?? '1');
          if (t !== undefined && t !== NumberingType.ARABIC) field.numType = t;
          // text:ref-name: the field's sequence number for references (XMLTextImportHelper::InsertSequenceID).
          const refName = c.attrs.get('text:ref-name');
          if (refName) sequenceIds.set(refName, field);
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLReferenceFieldImportContext: a reference to a reference mark, bookmark, number range
        // field or note; the reference format defaults to page-desc (ReferenceFieldPart::PAGE_DESC).
        case 'text:reference-ref': case 'text:bookmark-ref': case 'text:sequence-ref': case 'text:note-ref': {
          const fmt = REFERENCE_FORMATS.indexOf(c.attrs.get('text:reference-format') ?? '');
          const nSubType = c.name === 'text:reference-ref' ? ReferencesSubtype.SetRefAttr : c.name === 'text:bookmark-ref' ? ReferencesSubtype.Bookmark
            : c.name === 'text:sequence-ref' ? ReferencesSubtype.SequenceField : c.attrs.get('text:note-class') === 'endnote' ? ReferencesSubtype.Endnote : ReferencesSubtype.Footnote;
          const field: SwField = { type: 'GetRef', subType: nSubType, format: fmt >= 0 ? fmt : RefFieldFormat.AsPageStyle, name: c.attrs.get('text:ref-name') ?? '' };
          // The text it showed, until the layout updates it.
          SetExpand(field, textOf(c));
          refFields.push(field);
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLTextMarkImportContext for reference marks (SwFormatRefMark).
        case 'text:reference-mark': makeBookmark(c.attrs.get('text:name') ?? '', node, node.Len(), node, node.Len(), MarkType.REFMARK); break;
        case 'text:reference-mark-start': refMarkStarts.set(c.attrs.get('text:name') ?? '', { node, nContent: node.Len() }); break;
        case 'text:reference-mark-end': {
          const name = c.attrs.get('text:name') ?? '';
          const start = refMarkStarts.get(name);
          refMarkStarts.delete(name);
          if (start) makeBookmark(name, start.node, start.nContent, node, node.Len(), MarkType.REFMARK);
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
          const odfId = c.attrs.get('text:id');
          if (odfId) noteIds.set(odfId, id);
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
        // XMLIndexMarkImportContext_Impl: a collapsed mark with its text (string-value) on a
        // placeholder character; a start and end pair marks the text between them (one paragraph).
        case 'text:toc-mark': case 'text:alphabetical-index-mark': case 'text:user-index-mark':
        case 'text:toc-mark-start': case 'text:alphabetical-index-mark-start': case 'text:user-index-mark-start': {
          const kind = c.name.startsWith('text:toc') ? 'toc' : c.name.startsWith('text:user') ? 'user' : 'alpha';
          const pType = kind === 'toc' ? GetTOXType(doc, TOXTypes.TOX_CONTENT, 0)! : kind === 'alpha' ? GetTOXType(doc, TOXTypes.TOX_INDEX, 0)!
            : c.attrs.get('text:index-name') ? GetUserTOXType(doc, c.attrs.get('text:index-name')!) : GetTOXType(doc, TOXTypes.TOX_USER, 0)!;
          const pMark = new SwTOXMark(pType);
          const a = (k: string) => c.attrs.get(k) ?? '';
          if (kind === 'alpha') {
            pMark.SetTextReading(a('text:string-value-phonetic'));
            pMark.SetPrimaryKey(a('text:key1'));
            pMark.SetPrimaryKeyReading(a('text:key1-phonetic'));
            pMark.SetSecondaryKey(a('text:key2'));
            pMark.SetSecondaryKeyReading(a('text:key2-phonetic'));
            pMark.SetMainEntry(a('text:main-entry') === 'true');
          } else pMark.SetLevel(parseInt(a('text:outline-level'), 10) || 0);
          if (!c.name.endsWith('-start')) {
            // A collapsed mark without its text is no mark.
            if (!a('text:string-value')) break;
            pMark.SetAlternativeText(a('text:string-value'));
            append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_TOXMARK: [pMark] });
          } else openIndexMarks.set(a('text:id'), { pMark, node, nStart: node.Len() });
          break;
        }
        case 'text:toc-mark-end': case 'text:alphabetical-index-mark-end': case 'text:user-index-mark-end': {
          const m = openIndexMarks.get(c.attrs.get('text:id') ?? '');
          if (!m) break;
          openIndexMarks.delete(c.attrs.get('text:id')!);
          const nEnd = m.node === node ? node.Len() : m.node.Len();
          if (nEnd > m.nStart) SetMarks(m.node, m.nStart, nEnd, m.pMark, null);
          break;
        }
        // XMLBibliographyFieldImportContext: a citation, with the entry's fields as attributes.
        case 'text:bibliography-mark': {
          const aFields = BIBLIOGRAPHY_ATTRS.map((_, i) => c.attrs.get(BIBLIOGRAPHY_ATTR(i)) ?? '');
          const nType = BIBLIOGRAPHY_TYPES.indexOf(aFields[ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE]!);
          aFields[ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE] = String(nType < 0 ? 0 : nType);
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: { type: 'TableOfAuthorities', m_xAuthEntry: new SwAuthEntry(aFields) } });
          break;
        }
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
          else if (c.name.startsWith('field:fieldmark')) {
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
      // XMLSignatureLineContext: loext:signatureline marks the graphic as a signature line.
      const sl = child(c, 'loext:signatureline');
      if (sl) {
        const at = (k: string) => sl.attrs.get(`loext:${k}`) || undefined;
        fmt.m_aSignatureLine = {
          m_aId: at('id') ?? '', m_bShowSignDate: at('show-sign-date') === 'true', m_bCanAddComment: at('can-add-comment') === 'true',
          ...(at('suggested-signer-name') ? { m_aSuggestedSignerName: at('suggested-signer-name') } : {}),
          ...(at('suggested-signer-title') ? { m_aSuggestedSignerTitle: at('suggested-signer-title') } : {}),
          ...(at('suggested-signer-email') ? { m_aSuggestedSignerEmail: at('suggested-signer-email') } : {}),
          ...(at('signing-instructions') ? { m_aSigningInstructions: at('signing-instructions') } : {}),
        };
      }
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
    // TextWritingMode (style:writing-mode of the graphic properties): vertical text.
    if (gp('style:writing-mode') === 'tb-rl') shape.m_bVerticalWriting = true;
    // SdrTextAutoGrowHeightItem and SdrTextAutoGrowWidthItem.
    if (gp('draw:auto-grow-height') === 'true') fmt.m_bAutoHeight = true;
    if (gp('draw:auto-grow-width') === 'true') fmt.m_bAutoWidth = true;
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
  /** The text form field between field:fieldmark-start and -end, which takes the text. */
  let openFieldmark: SwField | null = null;
  /** The index marks started (text:*-mark-start) and not yet ended, by their text:id. */
  const openIndexMarks = new Map<string, { pMark: SwTOXMark; node: SwTextNode; nStart: number }>();
  const append = (node: SwTextNode, text: string, attrs: SwCharAttrSet) => {
    if (!text) return;
    if (openFieldmark) { if (text !== CH_TXTATR_BREAKWORD) openFieldmark.content += text; return; }
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
        // XMLVariableDeclImportContext: the variables' types, and the user fields with their
        // contents (a numeric one's value, as upstream reads no formula there).
        case 'text:variable-decls':
          for (const d of childElements(el)) {
            if (d.name !== 'text:variable-decl') continue;
            const t = doc.InsertFieldType(new SwSetExpFieldType(d.attrs.get('text:name') ?? ''));
            t.SetType(d.attrs.get('office:value-type') === 'string' ? SwGetSetExpType.String : SwGetSetExpType.Expr);
          }
          break;
        case 'text:user-field-decls':
          for (const d of childElements(el)) {
            if (d.name !== 'text:user-field-decl') continue;
            const t = doc.InsertFieldType(new SwUserFieldType(d.attrs.get('text:name') ?? ''));
            if ((d.attrs.get('office:value-type') ?? 'string') === 'string') {
              t.SetType(SwUserType.String);
              t.SetContent(d.attrs.get('office:string-value') ?? '');
            } else {
              t.SetType(SwUserType.Expr);
              const v = Number(d.attrs.get('office:value') ?? d.attrs.get('office:date-value') ?? 0);
              // SwUserFieldType::PutValue(FIELD_PROP_DOUBLE): the value, and its text as the content.
              t.SetContent(DoubleToString(Number.isFinite(v) ? v : 0, 'en-US'));
            }
          }
          break;
        case 'text:sequence-decls': case 'office:forms':
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
  // XMLTextImportHelper: the reference fields find their number range fields and notes.
  doc.SetSeqRefNos();
  for (const f of refFields) {
    if (f.subType === ReferencesSubtype.SequenceField) {
      const seq = sequenceIds.get(f.name ?? '');
      if (seq) {
        seq.seqNo ??= doc.NextSeqNo(seq.name ?? '');
        f.name = seq.name;
        f.seqNo = seq.seqNo;
      }
    } else if (f.subType === ReferencesSubtype.Footnote || f.subType === ReferencesSubtype.Endnote) f.name = noteIds.get(f.name ?? '') ?? f.name;
  }
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
  const template = new TextDecoder().decode(files.get('mimetype') ?? new Uint8Array()).trim() === MIME_TEMPLATE;
  // SwGetExpField's late initialization (m_bLateInitialization): a field showing a variable shows
  // it as the variable's type once the document is read.
  for (const n of doc.allText()) {
    for (const h of n.m_aHints) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (f?.type !== 'GetExp' || ((f.subType ?? 0) & SwGetSetExpType.Formula)) continue;
      const t = doc.m_aSetExpFieldTypes.get(f.formula ?? '');
      if (t) f.subType = ((f.subType ?? 0) & ~SwGetSetExpType.LowerMask) | t.GetType();
    }
  }
  return { doc, lost: [...lost], storage: files, template };
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

/**
 * XMLTextFieldExport's elements of the document information fields (MapDocInfoFieldName), by
 * SwDocInfoSubType with its author, date or time part.
 */
const DOCINFO_ELEMENTS: [number, string][] = [
  [SwDocInfoSubType.Title, 'text:title'], [SwDocInfoSubType.Subject, 'text:subject'], [SwDocInfoSubType.Keys, 'text:keywords'],
  [SwDocInfoSubType.Comment, 'text:description'], [SwDocInfoSubType.DocNo, 'text:editing-cycles'], [SwDocInfoSubType.Edit, 'text:editing-duration'],
  [SwDocInfoSubType.Create | SwDocInfoSubType.SubAuthor, 'text:initial-creator'], [SwDocInfoSubType.Create | SwDocInfoSubType.SubDate, 'text:creation-date'],
  [SwDocInfoSubType.Create | SwDocInfoSubType.SubTime, 'text:creation-time'], [SwDocInfoSubType.Change | SwDocInfoSubType.SubAuthor, 'text:creator'],
  [SwDocInfoSubType.Change | SwDocInfoSubType.SubDate, 'text:modification-date'], [SwDocInfoSubType.Change | SwDocInfoSubType.SubTime, 'text:modification-time'],
  [SwDocInfoSubType.Print | SwDocInfoSubType.SubAuthor, 'text:printed-by'], [SwDocInfoSubType.Print | SwDocInfoSubType.SubDate, 'text:print-date'],
  [SwDocInfoSubType.Print | SwDocInfoSubType.SubTime, 'text:print-time'], [SwDocInfoSubType.Custom, 'text:user-defined'],
];
/** XMLTextFieldExport::MapCountFieldName, by SwDocStatSubType (the page count is the PageCount field). */
const COUNT_ELEMENTS: [number, string][] = [
  [SwDocStatSubType.PageRange, 'loext:page-count-range'], [SwDocStatSubType.Paragraph, 'text:paragraph-count'], [SwDocStatSubType.Word, 'text:word-count'],
  [SwDocStatSubType.Character, 'text:character-count'], [SwDocStatSubType.Table, 'text:table-count'], [SwDocStatSubType.Graphic, 'text:image-count'],
  [SwDocStatSubType.OLE, 'text:object-count'],
];

const NS = 'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:field="urn:openoffice:names:experimental:ooo-ms-interop:xmlns:field:1.0" office:version="1.3"';

const styleId = (name: string) => name.replace(/ /g, '_20_').replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

/**
 * The document as an ODT package. `extra` are further streams of the package that are not the
 * document's (SfxObjectShell::SaveTo_Impl adds the version list and the versions).
 */
/** With `bTemplate`, the package is a text template (.ott): only its media type differs. */
export async function ExportODT(doc: SwDoc, extra: readonly ZipEntry[] = [], bTemplate = false): Promise<Uint8Array> {
  const mime = bTemplate ? MIME_TEMPLATE : MIME;
  const nodes = doc.GetNodes();
  /** The marks of each paragraph, gathered once (the document does not change while it is written). */
  let marksByNode: Map<SwTextNode, MarkBase[]> | undefined;
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
  /**
   * XMLNumberFormatAttributesExportHelper::SetNumberFormatAttributes for a number in a format:
   * office:value-type and the value attribute of that type.
   */
  const valueAttrs = (code: string, v: number, lang: string): string => {
    const vt = ValueTypeOf(code, lang);
    switch (vt) {
      case 'date': return ` office:value-type="date" office:date-value="${new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)).toISOString().replace(/\.000Z$|Z$/, '').replace(/T00:00:00$/, '')}"`;
      case 'time': { const sec = Math.round(v * 86400); return ` office:value-type="time" office:time-value="PT${Math.floor(sec / 3600)}H${Math.floor((sec % 3600) / 60)}M${sec % 60}S"`; }
      case 'boolean': return ` office:value-type="boolean" office:boolean-value="${v ? 'true' : 'false'}"`;
      case 'string': return ' office:value-type="string"';
      default: return ` office:value-type="${vt}" office:value="${v}"`;
    }
  };
  /** XMLTextExport for a table cell's value: office:value-type and its value, table:formula. */
  const cellValueAttrs = (box: SwTableBox): { attrs: string; style: string } => {
    const a = box.m_aAttrs, lang = BoxLanguage(doc, box);
    const code = a.numFormat ?? (a.formula !== undefined || a.value !== undefined ? 'General' : null);
    let attrs = '';
    if (a.formula !== undefined) attrs += ` table:formula="ooow:${escapeXml(a.formula)}"`;
    if (code && a.value !== undefined && !Number.isNaN(a.value)) attrs += valueAttrs(code, a.value, lang);
    else attrs += ' office:value-type="string"';
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
    const marks = (marksByNode ??= doc.getIDocumentMarkAccess().getMarksByNode()).get(n) ?? [];
    for (const m of marks) { if (m.GetMarkStart().GetNode() === n) cuts.add(Math.min(m.GetMarkStart().GetContentIndex(), text.length)); if (m.GetMarkEnd().GetNode() === n) cuts.add(Math.min(m.GetMarkEnd().GetContentIndex(), text.length)); }
    const marksAt = (pos: number) => {
      const at = (p: SwPosition) => p.GetNode() === n && Math.min(p.GetContentIndex(), text.length) === pos;
      let out = '';
      // Reference marks are text:reference-mark (XMLTextParagraphExport::exportTextMark).
      const tag = (m: MarkBase) => (m.m_eType === MarkType.REFMARK ? 'text:reference-mark' : 'text:bookmark');
      for (const m of marks) if (m.IsExpanded() && at(m.GetMarkEnd())) out += `<${tag(m)}-end text:name="${escapeXml(m.GetName())}"/>`;
      for (const m of marks) {
        if (!at(m.GetMarkStart())) continue;
        out += m.IsExpanded() ? `<${tag(m)}-start text:name="${escapeXml(m.GetName())}"/>` : `<${tag(m)} text:name="${escapeXml(m.GetName())}"/>`;
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
      // XMLIndexMarkExport: a mark with an alternative text is collapsed on its placeholder; the
      // others start before the first run they mark and end after the last.
      const marks = h?.aAttrs.RES_TXTATR_TOXMARK ?? [];
      const prevMarks = a > 0 ? n.GetCharAttrAt('RES_TXTATR_TOXMARK', a - 1) ?? [] : [];
      const nextMarks = b < text.length ? n.GetCharAttrAt('RES_TXTATR_TOXMARK', b) ?? [] : [];
      const pointMarks = !fld && !ftn && !fly && !ann && text.slice(a, b) === CH_TXTATR_BREAKWORD ? marks.filter((m) => m.IsAlternativeText()) : [];
      for (const m of marks) if (!m.IsAlternativeText() && !prevMarks.includes(m)) inner += indexMarkXml(m, 'start');
      const run = ann ? text.slice(a, b).split('').map(() => annotationXml(ann, n)).join('')
        : ftn ? text.slice(a, b).split('').map(() => noteXml(ftn.id, !!ftn.endnote)).join('')
        : fly ? text.slice(a, b).split('').map(() => frameXml(fly)).join('')
        : fld ? text.slice(a, b).split('').map(() => fieldXml(fld)).join('')
        : pointMarks.length ? pointMarks.map((m) => indexMarkXml(m, 'collapsed')).join('') : serialiseRun(text.slice(a, b), a === 0);
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
      for (const m of marks) if (!m.IsAlternativeText() && !nextMarks.includes(m)) inner += indexMarkXml(m, 'end');
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

  /** XMLIndexMarkExport::ExportIndexMark: one element of a mark, its attributes on all but the end. */
  const indexMarkIds = new Map<SwTOXMark, string>();
  const indexMarkXml = (m: SwTOXMark, part: 'collapsed' | 'start' | 'end'): string => {
    const eType = m.GetTOXType().GetType();
    const kind = eType === TOXTypes.TOX_INDEX ? 'alpha' : eType === TOXTypes.TOX_USER ? 'user' : 'toc';
    const el = INDEX_MARK_ELEMENTS[kind] + (part === 'collapsed' ? '' : `-${part}`);
    let attrs = '';
    if (part === 'collapsed') attrs += ` text:string-value="${escapeXml(m.GetAlternativeText())}"`;
    else {
      // GetID
      if (!indexMarkIds.has(m)) indexMarkIds.set(m, `IMark${indexMarkIds.size + 1}`);
      attrs += ` text:id="${indexMarkIds.get(m)}"`;
    }
    if (part !== 'end') {
      const str = (k: string, v: string) => (v ? ` text:${k}="${escapeXml(v)}"` : '');
      if (kind === 'alpha') {
        // ExportAlphabeticalIndexMarkAttributes
        attrs += str('string-value-phonetic', m.GetTextReading()) + str('key1', m.GetPrimaryKey()) + str('key1-phonetic', m.GetPrimaryKeyReading())
          + str('key2', m.GetSecondaryKey()) + str('key2-phonetic', m.GetSecondaryKeyReading()) + (m.IsMainEntry() ? ' text:main-entry="true"' : '');
      } else {
        // ExportUserIndexMarkAttributes, ExportTOCMarkAttributes
        if (kind === 'user') attrs += str('index-name', m.GetTOXType().GetTypeName());
        if (m.GetLevel() > 0) attrs += ` text:outline-level="${m.GetLevel()}"`;
      }
    }
    return `<${el}${attrs}/>`;
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
      ? `<text:note text:id="${id}" text:note-class="endnote"><text:note-citation>${makeNumberingString(NumberingType.ROMAN_LOWER, nr)}</text:note-citation><text:note-body>${inner}</text:note-body></text:note>`
      : `<text:note text:id="${id}" text:note-class="footnote"><text:note-citation>${nr}</text:note-citation><text:note-body>${inner}</text:note-body></text:note>`;
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
    return `${head} svg:height="${twipsToCm(f.m_nHeight)}"${transformAttr(f.m_nGrfRotation, h.m_nPos, v.m_nPos, f.m_nWidth, f.m_nHeight)} draw:z-index="${flyZ++}"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${doc.m_aGraphics.get(f.graphic!)!.mime}"/>${signatureLineXml(f)}${desc}${contourXml(f)}</draw:frame>`;
  };
  /**
   * XMLTextParagraphExport::exportContour: the graphic's contour as draw:contour-polygon, in a view
   * box of the frame's size in 1/100 mm; draw:recreate-on-edit for an automatic contour.
   */
  /** XMLShapeExport::ImpExportSignatureLine */
  const signatureLineXml = (f: SwFlyFrameFormat): string => {
    const s = f.m_aSignatureLine;
    if (!s) return '';
    const opt = (k: string, v: string | undefined) => (v ? ` loext:${k}="${escapeXml(v)}"` : '');
    return `<loext:signatureline loext:id="${escapeXml(s.m_aId)}"${opt('suggested-signer-name', s.m_aSuggestedSignerName)}${opt('suggested-signer-title', s.m_aSuggestedSignerTitle)}${opt('suggested-signer-email', s.m_aSuggestedSignerEmail)}${opt('signing-instructions', s.m_aSigningInstructions)} loext:show-sign-date="${s.m_bShowSignDate}" loext:can-add-comment="${s.m_bCanAddComment}"/>`;
  };
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
    if (sh.m_bVerticalWriting) props.push('style:writing-mode="tb-rl"');
    if (f.m_bAutoHeight) props.push('draw:auto-grow-height="true"');
    if (f.m_bAutoWidth) props.push('draw:auto-grow-width="true"');
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
  const expFields = UpdateExpFields(doc, seqNums);
  const docLang = GetDocLanguage(doc);
  /** XMLTextFieldExport::ProcessDisplay: text:display unless it is "value". */
  const display = (bIsVisible: boolean, bIsCommand: boolean) => (!bIsVisible ? ' text:display="none"' : bIsCommand ? ' text:display="formula"' : '');
  /** ProcessString for a formula: ooow: before it, nothing when it is what the field shows. */
  const formulaAttr = (sFormula: string, sPresentation: string) => (sFormula !== sPresentation ? ` text:formula="ooow:${escapeXml(sFormula)}"` : '');
  /**
   * XMLTextFieldExport::ProcessValueAndType: a string's value type and value, or a number's value
   * type, value and data style (each when asked for).
   */
  const valueAndType = (bIsString: boolean, sFormat: string | undefined, sContent: string, sDefault: string, fValue: number | undefined, bExportValue: boolean, bExportValueType: boolean, bExportStyle: boolean): string => {
    if (bIsString) {
      if (!bExportValue && !bExportValueType) return '';
      return ` office:value-type="string"${bExportValue && sContent !== sDefault ? ` office:string-value="${escapeXml(sContent)}"` : ''}`;
    }
    const code = sFormat || 'General';
    let out = '';
    if (bExportValue && fValue !== undefined) out += valueAttrs(code, fValue, docLang);
    else if (bExportValueType) out += ` office:value-type="${ValueTypeOf(code, docLang)}"`;
    if (bExportStyle && code !== 'General') out += ` style:data-style-name="${dataStyle(code, docLang)}"`;
    return out;
  };
  const isStringVar = (name: string) => !!((doc.m_aSetExpFieldTypes.get(name)?.GetType() ?? 0) & SwGetSetExpType.String);
  const numFmt = (f: SwField) => (f.numType !== undefined ? ` style:num-format="${escapeXml(numFormatOut(f.numType as NumberingType))}"` : '');
  const fieldXml = (f: SwField): string => {
    const sPresentation = f.type === 'Sequence' ? ExpandSeq(f, seqNums.get(f) ?? 1) : expFields.m_aTexts.get(f) ?? DefaultExpand(f);
    const shown = escapeXml(sPresentation);
    const nSub = f.subType ?? 0;
    switch (f.type) {
      // FIELD_ID_BIBLIOGRAPHY: ProcessBibliographyData, one attribute per field that is not empty.
      case 'TableOfAuthorities': {
        const e = f.m_xAuthEntry ?? new SwAuthEntry();
        let attrs = '';
        e.m_aAuthFields.forEach((v, i) => {
          if (i === ToxAuthorityField.AUTH_FIELD_AUTHORITY_TYPE) { const t = BIBLIOGRAPHY_TYPES[parseInt(v, 10) || 0]; if (t) attrs += ` text:bibliography-type="${t}"`; }
          else if (v) attrs += ` ${BIBLIOGRAPHY_ATTR(i)}="${escapeXml(v)}"`;
        });
        return `<text:bibliography-mark${attrs}>${escapeXml(ConditionalExpandAuthIdentifier(f, doc.m_pAuthorityFieldType))}</text:bibliography-mark>`;
      }
      // XMLTextFieldExport::ExportFieldHelper for FIELD_ID_VARIABLE_SET and FIELD_ID_VARIABLE_INPUT
      case 'SetExp': {
        const bString = isStringVar(f.name ?? '');
        const el = f.input ? 'text:variable-input' : 'text:variable-set';
        return `<${el} text:name="${escapeXml(f.name ?? '')}"${f.input ? ` text:description="${escapeXml(f.prompt ?? '')}"` : ''}${display(!(nSub & SwGetSetExpType.Invisible), false)}${formulaAttr(f.formula ?? '', sPresentation)}${valueAndType(bString, f.numFormat, f.formula ?? '', sPresentation, expFields.m_aValues.get(f), true, true, true)}>${shown}</${el}>`;
      }
      // FIELD_ID_VARIABLE_GET and FIELD_ID_EXPRESSION
      case 'GetExp': {
        const bCmd = !!(nSub & SwGetSetExpType.Command), bString = !!(nSub & SwGetSetExpType.String);
        if (nSub & SwGetSetExpType.Formula) return `<text:expression${formulaAttr(f.formula ?? '', sPresentation)}${display(true, bCmd)}${valueAndType(bString, f.numFormat, f.formula ?? '', sPresentation, expFields.m_aValues.get(f), !bCmd, !bCmd, !bCmd)}>${shown}</text:expression>`;
        return `<text:variable-get text:name="${escapeXml(f.formula ?? '')}"${display(true, bCmd)}${valueAndType(bString, f.numFormat, '', '', 0, false, false, !bCmd)}>${shown}</text:variable-get>`;
      }
      // FIELD_ID_USER_GET
      case 'User': {
        const bCmd = !!(nSub & SwUserType.ShowCommand);
        const bString = !!((FindUserFieldType(doc, f.name ?? '')?.GetType() ?? 0) & SwUserType.String);
        return `<text:user-field-get${display(!(nSub & SwUserType.Invisible), bCmd)}${valueAndType(bString, f.numFormat, '', '', 0, false, false, !bCmd)} text:name="${escapeXml(f.name ?? '')}">${shown}</text:user-field-get>`;
      }
      // FIELD_ID_USER_INPUT and FIELD_ID_TEXT_INPUT
      case 'Input':
        if ((nSub & 0x00ff) === SwInputFieldSubType.User) return `<text:user-field-input text:name="${escapeXml(f.content ?? '')}" text:description="${escapeXml(f.prompt ?? '')}">${shown}</text:user-field-input>`;
        return `<text:text-input text:description="${escapeXml(f.prompt ?? '')}">${shown}</text:text-input>`;
      // FIELD_ID_REFPAGE_SET, FIELD_ID_REFPAGE_GET
      case 'RefPageSet': return `<text:page-variable-set${f.subType ? '' : ' text:active="false"'}${f.offset ? ` text:page-adjust="${f.offset}"` : ''}/>`;
      case 'RefPageGet': return `<text:page-variable-get${numFmt(f)}>${escapeXml(GetContent(f) ?? '')}</text:page-variable-get>`;
      // XMLSequenceFieldExportContext
      case 'Sequence': {
        const name = escapeXml(f.name ?? '');
        return `<text:sequence${f.seqNo !== undefined ? ` text:ref-name="ref${name}${f.seqNo}"` : ''} text:name="${name}" text:formula="ooow:${f.formula ? escapeXml(f.formula) : `${name}+1`}" style:num-format="${escapeXml(numFormatOut((f.numType ?? NumberingType.ARABIC) as NumberingType))}">${shown}</text:sequence>`;
      }
      // XMLTextFieldExport for FIELD_ID_REF_REFERENCE and the others of SwGetRefField.
      case 'GetRef': {
        const fmt = ` text:reference-format="${REFERENCE_FORMATS[f.format === RefFieldFormat.AsPageStyle ? RefFieldFormat.Page : f.format ?? RefFieldFormat.Content]}"`;
        const text = escapeXml(GetExpand(f) ?? f.fixed ?? '');
        switch (f.subType) {
          case ReferencesSubtype.SetRefAttr: return `<text:reference-ref${fmt} text:ref-name="${escapeXml(f.name ?? '')}">${text}</text:reference-ref>`;
          case ReferencesSubtype.SequenceField: return `<text:sequence-ref${fmt} text:ref-name="${escapeXml(`ref${f.name ?? ''}${f.seqNo ?? 0}`)}">${text}</text:sequence-ref>`;
          case ReferencesSubtype.Footnote: case ReferencesSubtype.Endnote:
            return `<text:note-ref text:note-class="${f.subType === ReferencesSubtype.Endnote ? 'endnote' : 'footnote'}"${fmt} text:ref-name="${escapeXml(f.name ?? '')}">${text}</text:note-ref>`;
          default: return `<text:bookmark-ref${fmt} text:ref-name="${escapeXml(f.name ?? '')}">${text}</text:bookmark-ref>`;
        }
      }
      case 'PageNumber': return `<text:page-number${numFmt(f)} text:select-page="current">${shown}</text:page-number>`;
      case 'PageCount': return `<text:page-count${numFmt(f)}>${shown}</text:page-count>`;
      case 'Date': return `<text:date${f.fixed !== undefined ? ' text:fixed="true"' : ''}>${shown}</text:date>`;
      // XMLTextFieldExport for FIELD_ID_DOCINFO_*: the author, date or time part names the element.
      case 'DocInfo': {
        const nSub = (f.subType ?? 0) & (SwDocInfoSubType.LowerMask | SwDocInfoSubType.SubMask);
        const el = DOCINFO_ELEMENTS.find(([k]) => k === nSub)?.[1] ?? DOCINFO_ELEMENTS.find(([k]) => k === (nSub & SwDocInfoSubType.LowerMask))?.[1] ?? 'text:title';
        const name = el === 'text:user-defined' ? ` text:name="${escapeXml(f.name ?? '')}"` : '';
        return `<${el}${name}${f.fixed !== undefined ? ' text:fixed="true"' : ''}>${escapeXml(DocInfoExpandImpl(f, doc.m_xDocProps))}</${el}>`;
      }
      // XMLTextFieldExport for FIELD_ID_COUNT_*
      case 'DocStat': {
        const el = COUNT_ELEMENTS.find(([k]) => k === f.subType)?.[1] ?? 'text:page-count';
        return `<${el}${numFmt(f)}>${escapeXml(GetContent(f) ?? '')}</${el}>`;
      }
      case 'Time': return `<text:time${f.fixed !== undefined ? ' text:fixed="true"' : ''}>${shown}</text:time>`;
      // XMLTextParagraphExport: a form field as field:fieldmark (a text form field as
      // fieldmark-start, -separator and -end around its text), FieldParamExporter's parameters.
      case 'Fieldmark': {
        const params = Object.entries(f.params ?? {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [String(v)]).map((x) => `<field:param field:name="${escapeXml(k)}" field:value="${escapeXml(x)}"/>`)).join('');
        const head = `text:name="${escapeXml(f.name ?? '')}" field:type="${escapeXml(f.fieldType ?? '')}"`;
        if (f.fieldType === ODF_FORMTEXT) return `<field:fieldmark-start ${head}>${params}</field:fieldmark-start><field:fieldmark-separator/>${escapeXml(f.content ?? '')}<field:fieldmark-end/>`;
        return `<field:fieldmark ${head}>${params}</field:fieldmark>`;
      }
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
  // XMLPageExport::exportStyles(bUsed false, as SwXMLExport exports its styles): every page style
  // (the default, those paragraphs start, their follows, then the others the document has), each a
  // page layout and a master page with its headers and footers.
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
  for (const name of doc.m_aPageDescs.keys()) usedDescs.add(name);
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
    pageLayouts += `<style:page-layout style:name="${layout}"><style:page-layout-properties fo:page-width="${twipsToCm(d.nWidth)}" fo:page-height="${twipsToCm(d.nHeight)}" style:print-orientation="${d.nWidth > d.nHeight ? 'landscape' : 'portrait'}" style:num-format="${escapeXml(numFormatOut(d.m_nNumType as NumberingType))}" fo:margin-top="${twipsToCm(d.nTop)}" fo:margin-bottom="${twipsToCm(d.nBottom)}" fo:margin-left="${twipsToCm(d.nLeft)}" fo:margin-right="${twipsToCm(d.nRight)}">${columnsXml(d.m_aCol)}</style:page-layout-properties>${hfStyle(d, true)}${hfStyle(d, false)}</style:page-layout>`;
    const follow = d.m_sFollow !== name && usedDescs.has(d.m_sFollow) ? ` style:next-style-name="${masterName(d.m_sFollow)}"` : '';
    masterPages += `<style:master-page style:name="${masterName(name)}" style:display-name="${escapeXml(name)}" style:page-layout-name="${layout}"${follow}>${content}</style:master-page>`;
  });
  auto = contentAuto;
  function hfStyle(pd: SwPageDesc, bHeader: boolean): string {
    const on = nodes.FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, 'default', pd.m_aName);
    if (!on) return '';
    const minH = bHeader ? pd.nHeaderMinHeight : pd.nFooterMinHeight, sp = bHeader ? pd.nHeaderSpacing : pd.nFooterSpacing;
    const tag = bHeader ? 'style:header-style' : 'style:footer-style';
    const box = bHeader ? pd.m_aHeaderBox : pd.m_aFooterBox, bg = bHeader ? pd.m_aHeaderBackground : pd.m_aFooterBackground;
    const line = (l: SvxBorderLine | null) => (l ? `${(l.width / 20).toFixed(2)}pt solid ${l.color}` : 'none');
    const boxXml = box ? ` fo:padding="${twipsToCm(box.padding)}" fo:border-top="${line(box.top)}" fo:border-bottom="${line(box.bottom)}" fo:border-left="${line(box.left)}" fo:border-right="${line(box.right)}"` : '';
    return `<${tag}><style:header-footer-properties fo:min-height="${twipsToCm(minH)}" ${bHeader ? 'fo:margin-bottom' : 'fo:margin-top'}="${twipsToCm(sp)}" style:dynamic-spacing="${bHeader ? pd.bHeaderEatSpacing : pd.bFooterEatSpacing}"${boxXml}${bg ? ` fo:background-color="${bg}"` : ''}/></${tag}>`;
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
  // XMLTextParagraphExport::exportTextStyles(bUsed false): every list style, used or not.
  for (const rule of doc.m_aNumRules.values()) if (!rule.IsAutoRule()) listStyleName(rule);
  let autoLists = '', namedLists = '';
  for (const [rule, name] of listStyleNames) {
    if (rule.IsAutoRule()) autoLists += writeListStyle(rule, name);
    else namedLists += writeListStyle(rule, name, rule.GetName());
  }
  noteFont(POOL_DEFAULTS);
  noteFont(doc.m_aDefaults);
  // XMLFontStylesContext: the family as style:font-family-generic.
  const fontDecls = `<office:font-face-decls>${[...fonts].map((f) => `<style:font-face style:name="${escapeXml(f)}" svg:font-family="'${escapeXml(f)}'"${doc.m_aFontFamilies.has(f) ? ` style:font-family-generic="${doc.m_aFontFamilies.get(f)}"` : ''}/>`).join('')}</office:font-face-decls>`;
  const dflt: SwAttrSet = { RES_CHRATR_FONT: POOL_DEFAULTS.RES_CHRATR_FONT, RES_CHRATR_FONTSIZE: POOL_DEFAULTS.RES_CHRATR_FONTSIZE, RES_PARATR_WIDOWS: 2, RES_PARATR_ORPHANS: 2, ...doc.m_aDefaults };
  const defaults = `<style:default-style style:family="paragraph">${paragraphProps(dflt)}${textProps(dflt)}</style:default-style>`;
  const pd = doc.m_aPageDesc;
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  // XMLTextFieldExport::ExportFieldDeclarations: the number ranges, LibreOffice's own first.
  const seqNames = new Set(['Illustration', 'Table', 'Text', 'Drawing', 'Figure']);
  for (const f of seqNums.keys()) if (f.name) seqNames.add(f.name);
  // The variables and the user fields: a numeric user field keeps its value.
  const varDecls = doc.m_aSetExpFieldTypes.size ? `<text:variable-decls>${[...doc.m_aSetExpFieldTypes.values()].map((t) => `<text:variable-decl office:value-type="${t.GetType() & SwGetSetExpType.String ? 'string' : 'float'}" text:name="${escapeXml(t.GetName())}"/>`).join('')}</text:variable-decls>` : '';
  const userDecls = doc.m_aUserFieldTypes.size ? `<text:user-field-decls>${[...doc.m_aUserFieldTypes.values()].map((t) => (t.GetType() & SwUserType.String
    ? `<text:user-field-decl office:value-type="string" office:string-value="${escapeXml(t.GetContent())}" text:name="${escapeXml(t.GetName())}"/>`
    : `<text:user-field-decl office:value-type="float" office:value="${t.m_nValue}" text:name="${escapeXml(t.GetName())}"/>`)).join('')}</text:user-field-decls>` : '';
  const seqDecls = `${varDecls}<text:sequence-decls>${[...seqNames].map((n) => `<text:sequence-decl text:display-outline-level="0" text:name="${escapeXml(n)}"/>`).join('')}</text:sequence-decls>`;
  const contentXml = `${head}<office:document-content ${NS}>${fontDecls}<office:automatic-styles>${[...dataStyles.values()].map((e) => e.xml).join('')}${[...contentAuto.values()].map((e) => e.xml).join('')}${autoLists}</office:automatic-styles><office:body><office:text>${seqDecls}${userDecls}${body}</office:text></office:body></office:document-content>`;
  // XMLSectionExport::ExportBibliographyConfiguration, when the document cites or has changed the settings.
  const pAuthType = doc.m_pAuthorityFieldType;
  const bBiblio = pAuthType.GetEntries().length > 0 || pAuthType.GetPrefix() !== '[' || pAuthType.GetSuffix() !== ']' || pAuthType.IsSequence() || !pAuthType.IsSortByDocument();
  const biblioConf = !bBiblio ? '' : `<text:bibliography-configuration text:prefix="${escapeXml(pAuthType.GetPrefix())}" text:suffix="${escapeXml(pAuthType.GetSuffix())}"`
    + `${pAuthType.IsSequence() ? ' text:numbered-entries="true"' : ''}${pAuthType.IsSortByDocument() ? '' : ' text:sort-by-position="false"'}`
    + `${pAuthType.m_sSortAlgorithm ? ` text:sort-algorithm="${escapeXml(pAuthType.m_sSortAlgorithm)}"` : ''}>`
    + pAuthType.m_SortKeyArr.map((k) => `<text:sort-key text:key="${BIBLIOGRAPHY_ATTRS[k.eField]}" text:sort-ascending="${k.bSortAscending}"/>`).join('')
    + '</text:bibliography-configuration>';
  const stylesXml = `${head}<office:document-styles ${NS}>${fontDecls}<office:styles>${defaults}${named}${namedLists}${biblioConf}${[...gradientStyles].map(([xml, name]) => xml.replace('%NAME%', name)).join('')}</office:styles><office:automatic-styles>${pageLayouts}${[...stylesAuto.values()].map((e) => e.xml).join('')}</office:automatic-styles><office:master-styles>${masterPages}</office:master-styles></office:document-styles>`;
  // SvXMLMetaExport: the document properties, with this application as their generator.
  doc.m_xDocProps.setGenerator(GetGeneratorString());
  const metaXml = `${head}<office:document-meta ${NS}>${doc.m_xDocProps.Write()}</office:document-meta>`;
  // SwXMLExport::GetConfigurationSettings, for the settings that are ported.
  const settingsXml = `${head}<office:document-settings ${NS} xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><office:settings>${WriteViewSettings(doc.m_fnGetViewData?.() ?? doc.m_aViewData)}<config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="AddParaTableSpacing" config:type="boolean">${doc.m_bParaSpaceMax}</config:config-item><config:config-item config:name="HeaderSpacingBelowLastPara" config:type="boolean">${doc.m_bHeaderSpacingBelowLastPara}</config:config-item><config:config-item config:name="AddParaTableSpacingAtStart" config:type="boolean">${doc.m_bParaSpaceMaxAtPages}</config:config-item><config:config-item config:name="TabOverSpacing" config:type="boolean">${doc.m_bTabOverSpacing}</config:config-item><config:config-item config:name="TabOverMargin" config:type="boolean">${doc.m_bTabOverMargin}</config:config-item><config:config-item config:name="TabAtLeftIndentForParagraphsInList" config:type="boolean">${doc.m_bTabAtLeftIndentForParagraphsInList}</config:config-item><config:config-item config:name="PropLineSpacingShrinksFirstLine" config:type="boolean">${doc.m_bPropLineSpacingShrinksFirstLine}</config:config-item><config:config-item config:name="ImagePreferredDPI" config:type="int">${doc.m_nImagePreferredDPI}</config:config-item><config:config-item config:name="ApplyUserData" config:type="boolean">${doc.m_bUseUserData}</config:config-item><config:config-item config:name="SaveVersionOnClose" config:type="boolean">${doc.m_bSaveVersionOnClose}</config:config-item><config:config-item config:name="MathBaselineAlignment" config:type="boolean">${doc.m_bMathBaselineAlignment}</config:config-item><config:config-item config:name="ProtectBookmarks" config:type="boolean">${doc.m_bProtectBookmarks}</config:config-item><config:config-item config:name="ProtectFields" config:type="boolean">${doc.m_bProtectFields}</config:config-item></config:config-item-set></office:settings></office:document-settings>`;
  const manifest = `${head}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>${[...pictures].map(([k, p]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${doc.m_aGraphics.get(k)!.mime}"/>`).join('')}${objects.map((o) => `<manifest:file-entry manifest:full-path="${o.dir}/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.formula"/><manifest:file-entry manifest:full-path="${o.dir}/content.xml" manifest:media-type="text/xml"/>`).join('')}${extra.map((e) => `<manifest:file-entry manifest:full-path="${escapeXml(e.name)}" manifest:media-type="${e.name.endsWith('.png') ? 'image/png' : ''}"/>`).join('')}</manifest:manifest>`;
  const enc = new TextEncoder();
  return writeZip([
    { name: 'mimetype', data: enc.encode(mime), store: true }, // ODF requires it first and uncompressed
    { name: 'content.xml', data: enc.encode(contentXml) },
    { name: 'styles.xml', data: enc.encode(stylesXml) },
    { name: 'meta.xml', data: enc.encode(metaXml) },
    { name: 'settings.xml', data: enc.encode(settingsXml) },
    // Compressed graphics gain nothing from deflate: store them, as LibreOffice does.
    ...[...pictures].map(([k, p]) => ({ name: p, data: doc.m_aGraphics.get(k)!.data, store: true })),
    ...objects.map((o) => ({ name: `${o.dir}/content.xml`, data: enc.encode(o.xml) })),
    ...extra,
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
  ]);
}
