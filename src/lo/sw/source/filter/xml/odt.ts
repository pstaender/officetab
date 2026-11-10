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
// Reads and writes paragraphs, spans, styles and page geometry. Unsupported content is reported
// through `ImportResult.lost` so that callers can warn before a save would drop it.
import { readZip, writeZip } from '../../../../package/source/zipapi/zip.ts';
import { child, childElements, escapeXml, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { CH_TXTATR_BREAKWORD, POOL_DEFAULTS, type FontLineStyle, type SvxAdjust, type SvxBorderLine, type SwAttrSet, type SwCharAttrSet, type SwField, type SwFlyCnt, type SwPostItField } from '../../../inc/hintids.ts';
import type { SwCharFormat, SwTextFormatColl } from '../../../inc/format.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule, type SvxNumLabelFollowedBy } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { DefaultExpand } from '../../core/text/itrform2.ts';
import { SwEndNode, SwStartNode, SwTableNode, type SwNode } from '../../../inc/node.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SwTableAdjust, type SwTableBoxAttrs } from '../../../inc/swtable.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';

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

interface OdfStyle { name: string; display: string; family: string; parent?: string; next?: string; attrs: SwAttrSet; el: XmlElement }

function readProps(styleEl: XmlElement, fonts: Map<string, string>): SwAttrSet {
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
    const bg = a('fo:background-color');
    if (bg) out.RES_CHRATR_BACKGROUND = bg === 'transparent' ? null : bg;
    const tt = a('fo:text-transform');
    if (tt) out.RES_CHRATR_CASEMAP = tt === 'uppercase' ? 'uppercase' : tt === 'lowercase' ? 'lowercase' : 'none';
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
    if (ta) {
      const map: Record<string, SvxAdjust> = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'block' };
      out.RES_PARATR_ADJUST = map[ta] ?? 'left';
    }
    if (a('fo:margin-left') || a('fo:margin-right') || a('fo:text-indent')) {
      out.RES_LR_SPACE = { left: toTwips(a('fo:margin-left')) ?? 0, right: toTwips(a('fo:margin-right')) ?? 0, firstLine: toTwips(a('fo:text-indent')) ?? 0 };
    }
    if (a('fo:margin-top') || a('fo:margin-bottom')) {
      out.RES_UL_SPACE = { upper: toTwips(a('fo:margin-top')) ?? 0, lower: toTwips(a('fo:margin-bottom')) ?? 0 };
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
      f.SetBulletChar(a('text:bullet-char') || '\u2022');
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
      levels += `<text:list-level-style-bullet text:level="${n + 1}" text:bullet-char="${escapeXml(f.GetBulletChar())}">${props}</text:list-level-style-bullet>`;
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

  // Page geometry from the Standard master page, else the first one.
  const masters = child(stylesDoc, 'office:master-styles');
  const master = masters && (childElements(masters).find((m) => m.attrs.get('style:name') === 'Standard') ?? childElements(masters)[0]);
  const layoutName = master?.attrs.get('style:page-layout-name');
  const layouts = child(stylesDoc, 'office:automatic-styles');
  const layout = layouts && childElements(layouts).find((l) => l.name === 'style:page-layout' && l.attrs.get('style:name') === layoutName);
  const lp = child(layout, 'style:page-layout-properties');
  if (lp) {
    const pd = doc.m_aPageDesc;
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
    const pd = doc.m_aPageDesc;
    const minH = toTwips(hp.attrs.get('fo:min-height')) ?? 0;
    const spacing = toTwips(hp.attrs.get(bHeader ? 'fo:margin-bottom' : 'fo:margin-top'));
    if (bHeader) { pd.nHeaderMinHeight = minH; if (spacing !== undefined) pd.nHeaderSpacing = spacing; }
    else { pd.nFooterMinHeight = minH; if (spacing !== undefined) pd.nFooterSpacing = spacing; }
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
          const st = styles.get(`text/${c.attrs.get('text:style-name') ?? ''}`);
          collectText(c, node, { ...inherited, ...(st && !['Internet_20_link', 'Internet link'].includes(st.name) ? charChain(st) : {}), ...(href ? { RES_TXTATR_INETFMT: href } : {}) });
          break;
        }
        // XMLTextFieldImportContext for the field types ported (SwField).
        case 'text:page-number': append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: { type: 'PageNumber' } }); break;
        case 'text:page-count': append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: { type: 'PageCount' } }); break;
        case 'text:date': case 'text:time': {
          const field: SwField = { type: c.name === 'text:date' ? 'Date' : 'Time' };
          if (c.attrs.get('text:fixed') === 'true') field.fixed = textOf(c);
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FIELD: field });
          break;
        }
        // XMLFootnoteImportContext: the body goes into a new footnote section.
        case 'text:note': {
          if (c.attrs.get('text:note-class') === 'endnote') lost.add('endnotes (they are shown as footnotes)');
          const id = doc.NewFootnoteId();
          const sec = nodes.MakeFootnoteSection(id, doc.FindTextFormatCollByName('Footnote')!);
          const placeholder = nodes.GoNext(sec.GetIndex())!;
          const saved = sectionEnd;
          sectionEnd = sec.EndOfSectionNode();
          const noteBody = child(c, 'text:note-body');
          if (noteBody) readBlocks(noteBody);
          sectionEnd = saved;
          if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
          append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FTN: { id } });
          break;
        }
        case 'text:bookmark': case 'text:bookmark-start': case 'text:bookmark-end':
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
        default:
          if (c.name === 'text:change' || c.name === 'text:change-start' || c.name === 'text:change-end') lost.add('tracked changes (shown as they are now)');
          else if (c.name.startsWith('draw:')) lost.add('shapes');
          else if (/^text:(reference-mark|alphabetical-index-mark|toc-mark|user-index-mark|bookmark-ref)/.test(c.name) || c.name.startsWith('field:fieldmark')) {
            if (c.children.length) collectText(c, node, inherited);
          } else if (c.name.startsWith('text:') && c.children.length) { collectText(c, node, inherited); lost.add('fields (their current value is kept as text)'); }
          else lost.add(c.name);
      }
    }
  };
  // SdXMLGraphicObjectShapeContext and XMLTextFrameContext: an image or text box frame becomes a
  // fly with its anchor, position and wrap from its graphic style (XMLTextFrameContext_Impl).
  const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };
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
  /** Reads a draw:frame; returns its format, or null when its content cannot be shown. */
  const readFlyFormat = (c: XmlElement): SwFlyFrameFormat | null => {
    const textBox = child(c, 'draw:text-box');
    // LibreOffice may write several draw:image elements: the first one a browser can show wins.
    let data: Uint8Array | undefined, mime = '';
    for (const img of childElements(c).filter((x) => x.name === 'draw:image')) {
      const href = img.attrs.get('xlink:href')?.replace(/^\.\//, '');
      const ext = href?.split('.').pop()?.toLowerCase() ?? '';
      const type = img.attrs.get('draw:mime-type') ?? img.attrs.get('loext:mime-type') ?? MIME_BY_EXT[ext] ?? '';
      if (!Object.values(MIME_BY_EXT).includes(type)) continue;
      const bin = child(img, 'office:binary-data');
      const bytes = href ? files.get(href) : bin ? Uint8Array.from(atob(textOf(bin).replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)) : undefined;
      if (bytes) { data = bytes; mime = type; break; }
    }
    const width = toTwips(c.attrs.get('svg:width') ?? c.attrs.get('fo:min-width'));
    const height = toTwips(c.attrs.get('svg:height') ?? c.attrs.get('fo:min-height') ?? textBox?.attrs.get('fo:min-height')) ?? (textBox ? 0 : undefined);
    if ((!data && !textBox) || !width || height === undefined || (!textBox && !height)) {
      lost.add('objects and images in formats a browser cannot show');
      return null;
    }
    const st = c.attrs.get('draw:style-name');
    const gp = (a: string) => graphicProp(st, a);
    let name = c.attrs.get('draw:name') ?? '';
    if (!name || usedFlyNames.has(name)) {
      let k = 1;
      while (usedFlyNames.has(`${textBox ? 'Frame' : 'Image'}${k}`)) k++;
      name = `${textBox ? 'Frame' : 'Image'}${k}`;
    }
    usedFlyNames.add(name);
    let anchor = ANCHOR[c.attrs.get('text:anchor-type') ?? 'paragraph'] ?? RndStdIds.FLY_AT_PARA;
    // Text frames anchored as characters are not ported: they are anchored at the character instead.
    if (textBox && anchor === RndStdIds.FLY_AS_CHAR) { anchor = RndStdIds.FLY_AT_CHAR; lost.add('text frames in the line (they are anchored to the character instead)'); }
    const wrap = WRAP[gp('style:wrap') ?? 'parallel'] ?? WrapTextMode.PARALLEL;
    const fake: XmlElement = { name: 'x', attrs: new Map(), children: [{ name: 'style:paragraph-properties', attrs: new Map([...(graphicDefaults?.attrs ?? []), ...(st ? styleChainGraphicAttrs(st) : [])]), children: [] }] };
    const box = readProps(fake, fonts);
    const alt = textOf(child(c, 'svg:desc') ?? child(c, 'svg:title') ?? EMPTY_EL) || undefined;
    const fmt: SwFlyFrameFormat = {
      m_aName: name, m_nWidth: width, m_nHeight: height,
      m_aAnchor: { m_eAnchorId: anchor, m_nPageNumber: parseInt(c.attrs.get('text:anchor-page-number') ?? '1', 10) || 1 },
      m_aHoriOrient: { m_eOrient: HORI_POS[gp('style:horizontal-pos') ?? 'center'] ?? HoriOrientation.CENTER, m_eRelation: HORI_REL[gp('style:horizontal-rel') ?? 'paragraph'] ?? RelOrientation.FRAME, m_nPos: toTwips(c.attrs.get('svg:x')) ?? 0 },
      m_aVertOrient: { m_eOrient: VERT_POS[gp('style:vertical-pos') ?? 'top'] ?? VertOrientation.TOP, m_eRelation: VERT_REL[gp('style:vertical-rel') ?? 'paragraph'] ?? RelOrientation.FRAME, m_nPos: toTwips(c.attrs.get('svg:y')) ?? 0 },
      m_aSurround: { m_eSurround: wrap },
      m_nLeftSpace: toTwips(gp('fo:margin-left')) ?? 0, m_nRightSpace: toTwips(gp('fo:margin-right')) ?? 0,
      m_nUpperSpace: toTwips(gp('fo:margin-top')) ?? 0, m_nLowerSpace: toTwips(gp('fo:margin-bottom')) ?? 0,
      // A run-through object is in the background unless it says it is in front.
      m_bOpaque: !(wrap === WrapTextMode.THROUGH && gp('style:run-through') === 'background'),
      ...(alt ? { alt } : {}),
    };
    if (data) fmt.graphic = doc.AddGraphic(data, mime);
    if (textBox) {
      fmt.m_sContentId = name;
      fmt.m_bAutoHeight = !c.attrs.get('svg:height') || !!textBox.attrs.get('fo:min-height');
      if (c.attrs.get('fo:min-width')) fmt.m_bAutoWidth = true;
      fmt.m_aBox = box.RES_BOX ?? null;
      fmt.m_aBackground = box.RES_BACKGROUND ?? null;
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
  const readFrame = (c: XmlElement, node: SwTextNode, inherited: SwCharAttrSet) => {
    const fmt = readFlyFormat(c);
    if (!fmt) return;
    switch (fmt.m_aAnchor.m_eAnchorId) {
      case RndStdIds.FLY_AS_CHAR:
        append(node, CH_TXTATR_BREAKWORD, { ...inherited, RES_TXTATR_FLYCNT: { graphic: fmt.graphic ?? '', width: fmt.m_nWidth, height: fmt.m_nHeight, name: fmt.m_aName, ...(fmt.alt ? { alt: fmt.alt } : {}) } });
        break;
      case RndStdIds.FLY_AT_PAGE: doc.m_aPageFlys.push(fmt); break;
      default: node.m_aAnchoredFlys.push({ fmt, nContent: fmt.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_CHAR ? node.Len() : 0 });
    }
  };
  const EMPTY: XmlElement = EMPTY_EL;
  // Commented ranges still open, by annotation name.
  const pendingMarks = new Map<string, { node: SwTextNode; start: number; id: string }>();
  const textOf = (el: XmlElement): string => el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
  const charChain = (s: OdfStyle): SwCharAttrSet => {
    const parent = s.parent ? styles.get(`${s.family}/${s.parent}`) : undefined;
    return { ...(parent ? charChain(parent) : {}), ...charOnly(s.attrs) };
  };
  const append = (node: SwTextNode, text: string, attrs: SwCharAttrSet) => {
    if (!text) return;
    const start = node.Len();
    node.m_Text += text;
    if (Object.keys(attrs).length) node.SetAttr(start, start + text.length, attrs);
  };

  const readPara = (el: XmlElement): SwTextNode => {
    const node = newNode();
    const styleName = el.attrs.get('text:style-name');
    const st = styleName ? styles.get(`paragraph/${styleName}`) : undefined;
    if (st && !namedParagraph.has(st.name)) {
      // Automatic style: direct formatting on top of its named parent.
      node.m_pColl = st.parent ? resolveColl(st.parent) : standard;
      node.m_aSet = { ...st.attrs };
    } else if (st) node.m_pColl = resolveColl(st.name);
    collectText(el, node, {});
    node.m_nVersion++;
    return node;
  };

  const readBlocks = (parent: XmlElement) => {
    for (const el of childElements(parent)) {
      switch (el.name) {
        case 'text:p': case 'text:h': readPara(el); break;
        case 'text:list': readList(el, 0, undefined); break;
        case 'text:section': lost.add('sections (the text is kept)'); readBlocks(el); break;
        case 'table:table': readTable(el); break;
        case 'text:sequence-decls': case 'text:user-field-decls': case 'text:variable-decls': case 'office:forms':
        case 'table:calculation-settings': case 'text:soft-page-break': case 'text:dde-connection-decls': break;
        case 'text:tracked-changes': if (childElements(el).length) lost.add('tracked changes (shown as they are now)'); break;
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
        case 'draw:custom-shape': case 'draw:rect': case 'draw:g': case 'draw:line': case 'draw:ellipse': case 'draw:polygon': case 'draw:path': case 'draw:connector':
          lost.add('shapes'); break;
        // Page-anchored frames come before the paragraphs.
        case 'draw:frame': {
          const fmt = readFlyFormat(el);
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
    const bg = g('fo:background-color');
    a.background = bg && bg !== 'transparent' ? bg : null;
    return a;
  };
  const readTable = (t: XmlElement) => {
    const tp = styleProps('table', t.attrs.get('table:style-name'), 'style:table-properties');
    const align = tp?.attrs.get('table:align');
    const adjust: SwTableAdjust = !align || align === 'margins' ? 'full' : align === 'center' ? 'center' : align === 'right' ? 'right' : align === 'left' ? 'left' : 'none';
    const table = new SwTable({
      name: t.attrs.get('table:name') ?? doc.GetUniqueTableName(), adjust,
      width: toTwips(tp?.attrs.get('style:width')) ?? 0, leftSpace: toTwips(tp?.attrs.get('fo:margin-left')) ?? 0,
      upper: toTwips(tp?.attrs.get('fo:margin-top')) ?? 0, lower: toTwips(tp?.attrs.get('fo:margin-bottom')) ?? 0,
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
        makeBox(cellAttrs(c.attrs.get('table:style-name'), w), rspan, c);
        if (rspan > 1) vmerge[col] = { left: rspan - 1, span: cspan };
        col += cspan; ci += cspan;
      }
    }
    sectionEnd = saved;
    if (!table.m_aLines.length) { nodes.Remove(tableNode.GetIndex(), 2); return; }
  };

  // Header and footer content goes into its section of the autotext area.
  for (const [tag, eTyp, coll, kind] of [
    ['style:header', SwStartNodeType.SwHeaderStartNode, 'Header', 'default'], ['style:footer', SwStartNodeType.SwFooterStartNode, 'Footer', 'default'],
    ['style:header-first', SwStartNodeType.SwHeaderStartNode, 'Header', 'first'], ['style:footer-first', SwStartNodeType.SwFooterStartNode, 'Footer', 'first'],
    ['style:header-left', SwStartNodeType.SwHeaderStartNode, 'Header', 'left'], ['style:footer-left', SwStartNodeType.SwFooterStartNode, 'Footer', 'left'],
  ] as const) {
    const el = master && child(master, tag);
    if (!el || el.attrs.get('style:display') === 'false') continue;
    // A first or left page variant needs the page style's header to be on at all.
    if (kind !== 'default' && !child(master, tag.replace(/-(first|left)$/, ''))) continue;
    const section = nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!, kind);
    const placeholder = nodes.GoNext(section.GetIndex())!;
    const saved = sectionEnd;
    sectionEnd = section.EndOfSectionNode();
    readBlocks(el);
    sectionEnd = saved;
    // MakeAreaSection's empty paragraph only stays if the header had no content.
    if (section.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
  }

  const text = child(child(content, 'office:body'), 'office:text');
  if (!text) throw new Error('This document has no text body.');
  readBlocks(text);
  // A document that starts with a table does not keep the initial empty paragraph before it;
  // one that ends with a table gets an empty paragraph after it, so the cursor can go there.
  if (initialUsed && !initialIsPara && nodes.node(nodes.BodyStart() + 1).IsTableNode()) nodes.Remove(nodes.BodyStart());
  if (nodes.node(nodes.GetEndOfContent().GetIndex() - 1).IsEndNode()) nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), standard);
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}

function paragraphProps(s: SwAttrSet): string {
  const p: string[] = [];
  if (s.RES_PARATR_ADJUST) p.push(`fo:text-align="${{ left: 'start', right: 'end', center: 'center', block: 'justify' }[s.RES_PARATR_ADJUST]}"`);
  if (s.RES_LR_SPACE) p.push(`fo:margin-left="${twipsToCm(s.RES_LR_SPACE.left)}" fo:margin-right="${twipsToCm(s.RES_LR_SPACE.right)}" fo:text-indent="${twipsToCm(s.RES_LR_SPACE.firstLine)}"`);
  if (s.RES_UL_SPACE) p.push(`fo:margin-top="${twipsToCm(s.RES_UL_SPACE.upper)}" fo:margin-bottom="${twipsToCm(s.RES_UL_SPACE.lower)}"`);
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
  if (s.RES_CHRATR_BACKGROUND !== undefined) p.push(`fo:background-color="${s.RES_CHRATR_BACKGROUND ?? 'transparent'}"`);
  if (s.RES_CHRATR_ESCAPEMENT !== undefined) p.push(`style:text-position="${s.RES_CHRATR_ESCAPEMENT > 0 ? `super` : s.RES_CHRATR_ESCAPEMENT < 0 ? 'sub' : '0%'}"`);
  if (s.RES_CHRATR_CASEMAP) p.push(`fo:text-transform="${s.RES_CHRATR_CASEMAP}"`);
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

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3"';

const styleId = (name: string) => name.replace(/ /g, '_20_').replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

export async function ExportODT(doc: SwDoc): Promise<Uint8Array> {
  const nodes = doc.GetNodes();
  // Automatic styles of content.xml; master page content (headers, footers) uses styles.xml's own.
  const contentAuto = new Map<string, { name: string; xml: string }>();
  const stylesAuto = new Map<string, { name: string; xml: string }>();
  let auto = contentAuto;
  const fonts = new Set<string>();
  const noteFont = (s: SwAttrSet) => { if (s.RES_CHRATR_FONT) fonts.add(s.RES_CHRATR_FONT); };
  const prefixes: Record<string, string> = { paragraph: 'P', text: 'T', table: 'Table', 'table-column': 'Col', 'table-row': 'Row', 'table-cell': 'Cell', graphic: 'fr' };
  const autoStyle = (family: 'paragraph' | 'text' | 'table' | 'table-column' | 'table-row' | 'table-cell' | 'graphic', inner: string, parent?: string): string => {
    const key = `${family}|${parent ?? ''}|${inner}`;
    let e = auto.get(key);
    if (!e) {
      const name = `${auto === stylesAuto ? 'M' : ''}${prefixes[family]}${auto.size + 1}`;
      e = { name, xml: `<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}>${inner}</style:style>` };
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

  const paraXml = (n: SwTextNode): string => {
    const collId = styleId(n.GetTextColl().GetName());
    noteFont(n.m_aSet);
    const direct = paragraphProps(n.m_aSet) + textProps(charOnly(n.m_aSet));
    const pStyle = direct ? autoStyle('paragraph', direct, collId) : collId;
    const text = n.GetText();
    const cuts = new Set([0, text.length]);
    for (const h of n.m_aHints) { cuts.add(h.nStart); cuts.add(h.nEnd); }
    // XMLTextParagraphExport::exportTextFrame: anchored frames go at their anchor position.
    for (const f of n.m_aAnchoredFlys) cuts.add(Math.min(f.nContent, text.length));
    const anchoredAt = (pos: number) => n.m_aAnchoredFlys.filter((f) => Math.min(f.nContent, text.length) === pos).map((f) => flyXml(f.fmt)).join('');
    const sorted = [...cuts].sort((a, b) => a - b);
    let inner = '';
    let openLink: string | null = null;
    if (!text.length) inner += anchoredAt(0);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      inner += anchoredAt(a);
      const h = n.m_aHints.find((x) => x.nStart <= a && a < x.nEnd);
      // Adjacent runs with the same URL share one text:a.
      const url = h?.aAttrs.RES_TXTATR_INETFMT ?? null;
      if (url !== openLink) {
        if (openLink !== null) inner += '</text:a>';
        if (url !== null) inner += `<text:a xlink:type="simple" xlink:href="${escapeXml(url)}" text:style-name="Internet_20_link" text:visited-style-name="Visited_20_Internet_20_Link">`;
        openLink = url;
      }
      const fld = h?.aAttrs.RES_TXTATR_FIELD;
      // XMLTextFieldExport: one element per placeholder, holding the current expansion.
      const fly = h?.aAttrs.RES_TXTATR_FLYCNT;
      const ftn = h?.aAttrs.RES_TXTATR_FTN;
      const ann = h?.aAttrs.RES_TXTATR_ANNOTATION;
      const run = ann ? text.slice(a, b).split('').map(() => annotationXml(ann, n)).join('')
        : ftn ? text.slice(a, b).split('').map(() => noteXml(ftn.id)).join('')
        : fly ? text.slice(a, b).split('').map(() => frameXml(fly)).join('')
        : fld ? text.slice(a, b).split('').map(() => fieldXml(fld)).join('') : serialiseRun(text.slice(a, b), a === 0);
      const own = h ? (Object.fromEntries(Object.entries(h.aAttrs).filter(([k]) => !k.startsWith('RES_TXTATR_'))) as SwCharAttrSet) : {};
      const cf = h?.aAttrs.RES_TXTATR_CHARFMT;
      if (Object.keys(own).length) {
        noteFont(own);
        inner += `<text:span text:style-name="${autoStyle('text', textProps(own), cf ? styleId(cf.GetName()) : undefined)}">${run}</text:span>`;
      } else if (cf) inner += `<text:span text:style-name="${styleId(cf.GetName())}">${run}</text:span>`;
      else inner += run;
      const mark = h?.aAttrs.RES_TXTATR_ANNOTMARK;
      if (mark) {
        const next = n.m_aHints.find((x) => x.nStart <= b && b < x.nEnd);
        if (next?.aAttrs.RES_TXTATR_ANNOTMARK !== mark) inner += `<office:annotation-end office:name="__Annotation__${escapeXml(mark)}"/>`;
      }
    }
    if (openLink !== null) inner += '</text:a>';
    if (text.length) inner += anchoredAt(text.length);
    return `<text:p text:style-name="${pStyle}">${inner}</text:p>`;
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
  let noteCount = 0;
  const noteXml = (id: string): string => {
    const sec = nodes.FindFootnoteSection(id);
    if (!sec) return '';
    const nr = ++noteCount;
    const saved = open;
    open = null;
    const inner = exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex());
    open = saved;
    return `<text:note text:id="ftn${nr}" text:note-class="footnote"><text:note-citation>${nr}</text:note-citation><text:note-body>${inner}</text:note-body></text:note>`;
  };

  // Pictures/ entries of the package, by graphic key.
  const pictures = new Map<string, string>();
  const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' };
  const frameXml = (f: SwFlyCnt): string => {
    const g = doc.m_aGraphics.get(f.graphic);
    if (!g) return '';
    let path = pictures.get(f.graphic);
    if (!path) { path = `Pictures/${f.graphic}.${EXT_BY_MIME[g.mime] ?? 'bin'}`; pictures.set(f.graphic, path); }
    return `<draw:frame draw:name="${escapeXml(f.name)}" text:anchor-type="as-char" svg:width="${twipsToCm(f.width)}" svg:height="${twipsToCm(f.height)}" draw:z-index="0"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${g.mime}"/>${f.alt ? `<svg:desc>${escapeXml(f.alt)}</svg:desc>` : ''}</draw:frame>`;
  };

  /** XMLShapeExport / XMLTextParagraphExport::exportAnyTextFrame for a fly with its graphic style. */
  let flyZ = 0;
  const flyXml = (f: SwFlyFrameFormat): string => {
    const h = f.m_aHoriOrient, v = f.m_aVertOrient;
    const props = [
      `style:wrap="${keyOf(WRAP, f.m_aSurround.m_eSurround, 'parallel')}"`,
      ...(f.m_aSurround.m_eSurround === WrapTextMode.THROUGH ? [`style:run-through="${f.m_bOpaque ? 'foreground' : 'background'}"`] : []),
      `style:horizontal-pos="${keyOf(HORI_POS, h.m_eOrient, 'from-left')}" style:horizontal-rel="${keyOf(HORI_REL, h.m_eRelation, 'paragraph')}"`,
      `style:vertical-pos="${keyOf(VERT_POS, v.m_eOrient, 'from-top')}" style:vertical-rel="${keyOf(VERT_REL, v.m_eRelation, 'paragraph')}"`,
      `fo:margin-left="${twipsToCm(f.m_nLeftSpace)}" fo:margin-right="${twipsToCm(f.m_nRightSpace)}" fo:margin-top="${twipsToCm(f.m_nUpperSpace)}" fo:margin-bottom="${twipsToCm(f.m_nLowerSpace)}"`,
    ];
    if (f.m_sContentId !== undefined) {
      const b = f.m_aBox;
      props.push(b ? `fo:padding="${twipsToCm(b.padding)}" fo:border-top="${borderXml(b.top)}" fo:border-bottom="${borderXml(b.bottom)}" fo:border-left="${borderXml(b.left)}" fo:border-right="${borderXml(b.right)}"` : 'fo:border="none" fo:padding="0cm"');
      props.push(f.m_aBackground ? `fo:background-color="${f.m_aBackground}"` : 'fo:background-color="transparent" style:background-transparency="100%"');
    }
    const style = autoStyle('graphic', `<style:graphic-properties ${props.join(' ')}/>`, f.m_sContentId !== undefined ? 'Frame' : 'Graphics');
    const anchor = keyOf(ANCHOR, f.m_aAnchor.m_eAnchorId, 'paragraph');
    const pos = `${h.m_eOrient === HoriOrientation.NONE ? ` svg:x="${twipsToCm(h.m_nPos)}"` : ''}${v.m_eOrient === VertOrientation.NONE ? ` svg:y="${twipsToCm(v.m_nPos)}"` : ''}`;
    const head = `<draw:frame draw:style-name="${style}" draw:name="${escapeXml(f.m_aName)}" text:anchor-type="${anchor}"${f.m_aAnchor.m_eAnchorId === RndStdIds.FLY_AT_PAGE ? ` text:anchor-page-number="${Math.max(1, f.m_aAnchor.m_nPageNumber)}"` : ''}${pos} svg:width="${twipsToCm(f.m_nWidth)}"${f.m_bAutoWidth ? ` fo:min-width="${twipsToCm(f.m_nWidth)}"` : ''}`;
    const desc = f.alt ? `<svg:desc>${escapeXml(f.alt)}</svg:desc>` : '';
    if (f.m_sContentId !== undefined) {
      const sec = nodes.FindFlySection(f.m_sContentId);
      const saved = open;
      open = null;
      const inner = sec ? exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex()) + closeAll() : '';
      open = saved;
      const hAttr = f.m_bAutoHeight ? '' : ` svg:height="${twipsToCm(f.m_nHeight)}"`;
      return `${head}${hAttr} draw:z-index="${flyZ++}"><draw:text-box${f.m_bAutoHeight ? ` fo:min-height="${twipsToCm(f.m_nHeight)}"` : ''}>${inner}</draw:text-box>${desc}</draw:frame>`;
    }
    const path = picturePath(f.graphic ?? '');
    if (!path) return '';
    return `${head} svg:height="${twipsToCm(f.m_nHeight)}" draw:z-index="${flyZ++}"><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${doc.m_aGraphics.get(f.graphic!)!.mime}"/>${desc}</draw:frame>`;
  };
  const picturePath = (key: string): string | null => {
    const g = doc.m_aGraphics.get(key);
    if (!g) return null;
    let path = pictures.get(key);
    if (!path) { path = `Pictures/${key}.${EXT_BY_MIME[g.mime] ?? 'bin'}`; pictures.set(key, path); }
    return path;
  };

  const fieldXml = (f: SwField): string => {
    const shown = escapeXml(DefaultExpand(f));
    switch (f.type) {
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
    const tStyle = autoStyle('table', `<style:table-properties style:width="${twipsToCm(tableWidth)}" table:align="${align}"${a.leftSpace ? ` fo:margin-left="${twipsToCm(a.leftSpace)}"` : ''}${a.upper ? ` fo:margin-top="${twipsToCm(a.upper)}"` : ''}${a.lower ? ` fo:margin-bottom="${twipsToCm(a.lower)}"` : ''}/>`);
    let out = `<table:table table:name="${escapeXml(a.name)}" table:style-name="${tStyle}">`;
    for (let i = 0; i + 1 < edges.length; i++) {
      const frac = (edges[i + 1]! - edges[i]!) / 1e6;
      out += `<table:table-column table:style-name="${autoStyle('table-column', `<style:table-column-properties style:column-width="${twipsToCm(frac * tableWidth)}" style:rel-column-width="${Math.round(frac * 65535)}*"/>`)}"/>`;
    }
    const repeat = table.GetRowsToRepeat();
    table.m_aLines.forEach((line, li) => {
      if (li === 0 && repeat) out += '<table:table-header-rows>';
      const rowStyle = line.m_aAttrs.minHeight ? ` table:style-name="${autoStyle('table-row', `<style:table-row-properties style:min-row-height="${twipsToCm(line.m_aAttrs.minHeight)}"/>`)}"` : '';
      out += `<table:table-row${rowStyle}>`;
      edgesOf(line).forEach(([f, e], bi) => {
        const box = line.m_aBoxes[bi]!;
        const span = Math.max(1, colIndex(e) - colIndex(f));
        if (box.getRowSpan() < 0) { out += '<table:covered-table-cell/>'.repeat(span); return; }
        const ba = box.m_aAttrs;
        const cStyle = autoStyle('table-cell', `<style:table-cell-properties fo:padding="${twipsToCm(ba.padding)}" fo:border-left="${borderXml(ba.box.left)}" fo:border-right="${borderXml(ba.box.right)}" fo:border-top="${borderXml(ba.box.top)}" fo:border-bottom="${borderXml(ba.box.bottom)}"${ba.background ? ` fo:background-color="${ba.background}"` : ''}/>`);
        const sn = box.m_pStartNode!;
        out += `<table:table-cell table:style-name="${cStyle}" office:value-type="string"${span > 1 ? ` table:number-columns-spanned="${span}"` : ''}${box.getRowSpan() > 1 ? ` table:number-rows-spanned="${box.getRowSpan()}"` : ''}>`;
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
        out += paraXml(n);
        i++;
      } else if (n.IsTableNode()) {
        out += closeAll() + tableXml(n as SwTableNode);
        i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1;
      } else i++;
    }
    return out + closeAll();
  }

  // Page anchored frames come first in the body (XMLTextParagraphExport::exportPageFrames).
  const pageFrames = doc.m_aPageFlys.map(flyXml).join('');
  const body = pageFrames + exportSection(nodes.BodyStart(), nodes.GetEndOfContent().GetIndex());
  auto = stylesAuto;
  let masterContent = '';
  for (const [tag, eTyp, kind] of [
    ['style:header', SwStartNodeType.SwHeaderStartNode, 'default'], ['style:header-left', SwStartNodeType.SwHeaderStartNode, 'left'], ['style:header-first', SwStartNodeType.SwHeaderStartNode, 'first'],
    ['style:footer', SwStartNodeType.SwFooterStartNode, 'default'], ['style:footer-left', SwStartNodeType.SwFooterStartNode, 'left'], ['style:footer-first', SwStartNodeType.SwFooterStartNode, 'first'],
  ] as const) {
    const sec = nodes.FindAreaSection(eTyp, kind);
    if (sec) masterContent += `<${tag}>${exportSection(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex())}</${tag}>`;
  }
  auto = contentAuto;
  const hfStyle = (bHeader: boolean) => {
    const on = nodes.FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode);
    if (!on) return '';
    const minH = bHeader ? pd.nHeaderMinHeight : pd.nFooterMinHeight, sp = bHeader ? pd.nHeaderSpacing : pd.nFooterSpacing;
    const tag = bHeader ? 'style:header-style' : 'style:footer-style';
    return `<${tag}><style:header-footer-properties fo:min-height="${twipsToCm(minH)}" ${bHeader ? 'fo:margin-bottom' : 'fo:margin-top'}="${twipsToCm(sp)}" style:dynamic-spacing="false"/></${tag}>`;
  };

  // RES_POOLCHR_INET_NORMAL and RES_POOLCHR_INET_VISIT, referenced by every text:a.
  let named = '<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#000080" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style><style:style style:name="Visited_20_Internet_20_Link" style:display-name="Visited Internet Link" style:family="text"><style:text-properties fo:color="#800000" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>';
  // RES_POOLFRM_GRAPHIC and RES_POOLFRM_FRAME, which frames' automatic styles derive from.
  named += '<style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" style:wrap="dynamic" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph"/></style:style>'
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
  const defaults = `<style:default-style style:family="paragraph">${textProps({ RES_CHRATR_FONT: POOL_DEFAULTS.RES_CHRATR_FONT, RES_CHRATR_FONTSIZE: POOL_DEFAULTS.RES_CHRATR_FONTSIZE })}${paragraphProps({ RES_PARATR_WIDOWS: 2, RES_PARATR_ORPHANS: 2 })}</style:default-style>`;
  const pd = doc.m_aPageDesc;
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const contentXml = `${head}<office:document-content ${NS}>${fontDecls}<office:automatic-styles>${[...contentAuto.values()].map((e) => e.xml).join('')}${autoLists}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const stylesXml = `${head}<office:document-styles ${NS}>${fontDecls}<office:styles>${defaults}${named}${namedLists}</office:styles><office:automatic-styles><style:page-layout style:name="Mpm1"><style:page-layout-properties fo:page-width="${twipsToCm(pd.nWidth)}" fo:page-height="${twipsToCm(pd.nHeight)}" style:print-orientation="${pd.nWidth > pd.nHeight ? 'landscape' : 'portrait'}" fo:margin-top="${twipsToCm(pd.nTop)}" fo:margin-bottom="${twipsToCm(pd.nBottom)}" fo:margin-left="${twipsToCm(pd.nLeft)}" fo:margin-right="${twipsToCm(pd.nRight)}"/>${hfStyle(true)}${hfStyle(false)}</style:page-layout>${[...stylesAuto.values()].map((e) => e.xml).join('')}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Mpm1">${masterContent}</style:master-page></office:master-styles></office:document-styles>`;
  const metaXml = `${head}<office:document-meta ${NS}><office:meta><meta:generator>LibreOffice-Webbrowser/0.1</meta:generator></office:meta></office:document-meta>`;
  const manifest = `${head}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${[...pictures].map(([k, p]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${doc.m_aGraphics.get(k)!.mime}"/>`).join('')}</manifest:manifest>`;
  const enc = new TextEncoder();
  return writeZip([
    { name: 'mimetype', data: enc.encode(MIME), store: true }, // ODF requires it first and uncompressed
    { name: 'content.xml', data: enc.encode(contentXml) },
    { name: 'styles.xml', data: enc.encode(stylesXml) },
    { name: 'meta.xml', data: enc.encode(metaXml) },
    // Compressed graphics gain nothing from deflate: store them, as LibreOffice does.
    ...[...pictures].map(([k, p]) => ({ name: p, data: doc.m_aGraphics.get(k)!.data, store: true })),
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
  ]);
}
