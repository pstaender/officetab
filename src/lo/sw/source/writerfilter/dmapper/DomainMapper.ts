// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/writerfilter/dmapper/DomainMapper.cxx reduced
// @upstream sw/source/writerfilter/dmapper/DomainMapper_Impl.cxx reduced
// @upstream sw/source/writerfilter/dmapper/StyleSheetTable.cxx reduced
// @upstream sw/source/writerfilter/dmapper/NumberingManager.cxx reduced
// @upstream sw/source/writerfilter/dmapper/DomainMapperTableHandler.cxx reduced
// @upstream sw/source/writerfilter/dmapper/ConversionHelper.cxx reduced
// @upstream sw/source/writerfilter/dmapper/GraphicImport.cxx reduced
// @upstream sw/source/writerfilter/dmapper/PropertyMap.cxx reduced
// @upstream sw/source/writerfilter/dmapper/ThemeHandler.cxx reduced
// Upstream tokenises OOXML into sprms that DomainMapper turns into UNO API calls. This reads the
// WordprocessingML elements directly into the document model, with the same conversions:
// half-points, twips, EMU, lvlText list formats, gridSpan and vMerge, the default header and
// footer of the last section. Content the model cannot hold is reported in `lost`.
import { ImportCustGeom } from '../../../../oox/source/drawingml/customshapegeometry.ts';
import { readZip } from '../../../../package/source/zipapi/zip.ts';
import { RecodeBullet } from '../../../../unotools/source/misc/fontcvt.ts';
import { GetColor, ReadThemeColors } from '../../../../oox/source/drawingml/color.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { child, childElements, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { SwEndNode, SwSectionNode, SwStartNode, SwTableNode, type SwNode } from '../../../inc/node.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { CH_TXTATR_BREAKWORD, POOL_DEFAULTS, type SvxLRSpace, type SvxULSpace, type SwCropGrf, type SwRedlineData, type FontLineStyle, type SvxTabStop, type SwAttrSet, type SwCharAttrSet, type SwPostItField } from '../../../inc/hintids.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SvxBorderLine, type SvxBoxItem, type SwTableAdjust } from '../../../inc/swtable.ts';
import type { SwTextFormatColl } from '../../../inc/format.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { ImportResult } from '../../filter/xml/odt.ts';
import { HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SdrShape, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { DEFAULT_PAGE_DESC, SwPageDesc } from '../../../inc/pagedesc.ts';
import type { SwFormatCol } from '../../../inc/fmtclds.ts';

const W = (e: XmlElement | undefined, k: string): string | undefined => e?.attrs.get(`w:${k}`);
const val = (e: XmlElement | undefined): string | undefined => W(e, 'val');
const kids = (e: XmlElement | undefined, name: string): XmlElement[] => (e ? childElements(e).filter((c) => c.name === name) : []);
const int = (s: string | undefined): number | undefined => (s === undefined || s === '' ? undefined : Math.round(parseFloat(s)));
/** ST_OnOff: present means on, unless val says otherwise. */
const onOff = (e: XmlElement | undefined): boolean | undefined => (e ? !['0', 'false', 'off'].includes(val(e) ?? 'true') : undefined);
/** EMU to twips: 914400 EMU per inch, 1440 twips per inch. */
const emuToTwips = (emu: number): number => Math.round(emu / 635);

// ConversionHelper::ConvertNumberingType
const NUM_FMT: Record<string, NumberingType> = {
  decimal: NumberingType.ARABIC, upperRoman: NumberingType.ROMAN_UPPER, lowerRoman: NumberingType.ROMAN_LOWER,
  bullet: NumberingType.CHAR_SPECIAL, none: NumberingType.NUMBER_NONE,
  upperLetter: NumberingType.CHARS_UPPER_LETTER_N, lowerLetter: NumberingType.CHARS_LOWER_LETTER_N,
};


const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

const UNDERLINE: Record<string, FontLineStyle> = { single: 'single', words: 'single', double: 'double', dotted: 'dotted', dash: 'dash', dashLong: 'dash', wave: 'wave', thick: 'single', none: 'none' };

// StyleSheetTable::ConvertStyleName: Word's built-in style names that map to Writer's pool styles.
const STYLE_NAMES: Record<string, string> = {
  Normal: 'Standard', normal: 'Standard', Title: 'Title', Subtitle: 'Subtitle', Quote: 'Quotations',
  'footnote text': 'Footnote', header: 'Header', footer: 'Footer', 'Body Text': 'Text Body',
};

interface Rel { target: string; external: boolean }

export async function ImportDOCX(bytes: Uint8Array): Promise<ImportResult> {
  // An encrypted document is an OLE compound file, not a zip.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('This Word document is password-protected. Encrypted documents cannot be opened yet.');
  const files = await readZip(bytes);
  const text = (path: string) => { const b = files.get(path); return b ? new TextDecoder().decode(b) : undefined; };
  const xml = (path: string) => { const t = text(path); return t ? parseXml(t) : undefined; };
  // The main part is the package's officeDocument relationship, usually word/document.xml.
  const pkgRoot = xml('_rels/.rels');
  const mainRel = pkgRoot && childElements(childElements(pkgRoot)[0] ?? pkgRoot).find((e) => /officeDocument$/.test(e.attrs.get('Type') ?? ''));
  const mainPart = mainRel?.attrs.get('Target')?.replace(/^\//, '') ?? 'word/document.xml';
  const documentXml = xml(mainPart) ?? xml('word/document.xml');
  if (!documentXml) throw new Error('This file has no word/document.xml, so it is not a Word document.');
  const doc = new SwDoc();
  const lost = new Set<string>();
  const nodes = doc.GetNodes();

  const rels = (part: string): Map<string, Rel> => {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const r = xml(`${dir}_rels/${part.slice(dir.length)}.rels`);
    const out = new Map<string, Rel>();
    // Relationship parts use a default namespace, which the parser leaves unprefixed.
    const root = r && childElements(r).find((e) => /(^|:)Relationships$/.test(e.name));
    for (const e of root ? childElements(root).filter((x) => /(^|:)Relationship$/.test(x.name)) : []) {
      const target = e.attrs.get('Target') ?? '';
      const external = e.attrs.get('TargetMode') === 'External';
      out.set(e.attrs.get('Id') ?? '', { target: external || target.startsWith('/') ? target.replace(/^\//, '') : dir + target, external });
    }
    return out;
  };

  // ThemeHandler: the major and minor Latin fonts that rFonts' theme attributes name.
  const theme = new Map<string, string>();
  const themeXml = xml('word/theme/theme1.xml');
  const themeColors = ReadThemeColors(themeXml);
  const fontScheme = themeXml && childElements(themeXml)[0] && findDeep(childElements(themeXml)[0]!, 'a:fontScheme');
  for (const [k, tag] of [['major', 'a:majorFont'], ['minor', 'a:minorFont']] as const) {
    const latin = child(child(fontScheme, tag), 'a:latin')?.attrs.get('typeface');
    if (latin) theme.set(k, latin);
  }

  // --- properties ---
  const runProps = (rPr: XmlElement | undefined): SwCharAttrSet => {
    const out: SwCharAttrSet = {};
    if (!rPr) return out;
    const fonts = child(rPr, 'w:rFonts');
    if (fonts) {
      const f = W(fonts, 'ascii') ?? W(fonts, 'hAnsi');
      const th = W(fonts, 'asciiTheme') ?? W(fonts, 'hAnsiTheme');
      const themed = th && theme.get(th.startsWith('major') ? 'major' : 'minor');
      if (themed ?? f) out.RES_CHRATR_FONT = (themed ?? f)!;
    }
    const sz = int(val(child(rPr, 'w:sz')));
    if (sz !== undefined) out.RES_CHRATR_FONTSIZE = sz * 10; // half-points to twips
    const b = onOff(child(rPr, 'w:b')); if (b !== undefined) out.RES_CHRATR_WEIGHT = b;
    const i = onOff(child(rPr, 'w:i')); if (i !== undefined) out.RES_CHRATR_POSTURE = i;
    const u = child(rPr, 'w:u');
    if (u) out.RES_CHRATR_UNDERLINE = UNDERLINE[val(u) ?? 'single'] ?? 'single';
    const strike = onOff(child(rPr, 'w:strike')) ?? onOff(child(rPr, 'w:dstrike'));
    if (strike !== undefined) out.RES_CHRATR_CROSSEDOUT = strike;
    const color = val(child(rPr, 'w:color'));
    if (color) out.RES_CHRATR_COLOR = color === 'auto' ? null : `#${color.toLowerCase()}`;
    const hl = val(child(rPr, 'w:highlight'));
    if (hl) out.RES_CHRATR_BACKGROUND = hl === 'none' ? null : HIGHLIGHT[hl] ?? null;
    const shd = W(child(rPr, 'w:shd'), 'fill');
    if (shd && shd !== 'auto' && !hl) out.RES_CHRATR_BACKGROUND = `#${shd.toLowerCase()}`;
    const va = val(child(rPr, 'w:vertAlign'));
    if (va) out.RES_CHRATR_ESCAPEMENT = va === 'superscript' ? 33 : va === 'subscript' ? -33 : 0;
    const caps = onOff(child(rPr, 'w:caps'));
    if (caps !== undefined) out.RES_CHRATR_CASEMAP = caps ? 'uppercase' : 'none';
    // w:lang: the text language (Western script).
    const lang = W(child(rPr, 'w:lang'), 'val');
    if (lang) out.RES_CHRATR_LANGUAGE = lang;
    if (onOff(child(rPr, 'w:smallCaps'))) lost.add('small capitals (shown as normal letters)');
    if (onOff(child(rPr, 'w:vanish'))) lost.add('hidden text (shown)');
    return out;
  };

  /**
   * Paragraph properties. Word sets the upper and lower spacing and contextual spacing as separate
   * properties (ParaTopMargin, ParaBottomMargin, ParaContextMargin); here they share one item, so
   * the ones not set come from `inherited`, the value the paragraph or style would otherwise have.
   */
  const paraProps = (pPr: XmlElement | undefined, inherited: SvxULSpace = POOL_DEFAULTS.RES_UL_SPACE, inheritedLR: SvxLRSpace = POOL_DEFAULTS.RES_LR_SPACE): SwAttrSet => {
    const out: SwAttrSet = {};
    if (!pPr) return out;
    // w:bidi: a right-to-left paragraph, whose left and right alignments Word mirrors
    // (DomainMapper's ExchangeLeftRight).
    const bidi = onOff(child(pPr, 'w:bidi'));
    if (bidi !== undefined) out.RES_FRAMEDIR = bidi ? 'rl-tb' : 'lr-tb';
    const jc = val(child(pPr, 'w:jc'));
    if (jc) {
      const right = jc === 'right' || jc === 'end';
      out.RES_PARATR_ADJUST = jc === 'center' ? 'center' : jc === 'both' || jc === 'distribute' ? 'block' : right !== !!bidi ? 'right' : 'left';
    }
    const ind = child(pPr, 'w:ind');
    if (ind) {
      // Each indent inherits on its own (ParaLeftMargin, ParaRightMargin, ParaFirstLineIndent).
      const left = int(W(ind, 'left') ?? W(ind, 'start')) ?? inheritedLR.left;
      const right = int(W(ind, 'right') ?? W(ind, 'end')) ?? inheritedLR.right;
      const hanging = int(W(ind, 'hanging'));
      const first = hanging !== undefined ? -hanging : int(W(ind, 'firstLine')) ?? inheritedLR.firstLine;
      out.RES_LR_SPACE = { left, right, firstLine: first };
    }
    const sp = child(pPr, 'w:spacing');
    if (sp) {
      // w:beforeAutospacing/w:afterAutospacing: 14 pt, as DomainMapper does (no HTML auto spacing).
      const before = ['1', 'true', 'on'].includes(W(sp, 'beforeAutospacing') ?? '') ? 280 : int(W(sp, 'before'));
      const after = ['1', 'true', 'on'].includes(W(sp, 'afterAutospacing') ?? '') ? 280 : int(W(sp, 'after'));
      if (before !== undefined || after !== undefined) out.RES_UL_SPACE = { ...inherited, upper: before ?? inherited.upper, lower: after ?? inherited.lower };
      const line = int(W(sp, 'line'));
      if (line !== undefined) {
        const rule = W(sp, 'lineRule') ?? 'auto';
        // "auto" is in 240ths of a line.
        out.RES_PARATR_LINESPACING = rule === 'exact' ? { rule: 'fix', value: line } : rule === 'atLeast' ? { rule: 'min', value: line } : { rule: 'proportional', value: Math.round((line * 100) / 240) };
      }
    }
    const context = onOff(child(pPr, 'w:contextualSpacing'));
    if (context !== undefined) out.RES_UL_SPACE = { ...(out.RES_UL_SPACE ?? inherited), context };
    const keep = onOff(child(pPr, 'w:keepNext')); if (keep !== undefined) out.RES_KEEP = keep;
    if (onOff(child(pPr, 'w:pageBreakBefore'))) out.RES_BREAK = 'page-before';
    const widow = onOff(child(pPr, 'w:widowControl'));
    if (widow !== undefined) { out.RES_PARATR_WIDOWS = widow ? 2 : 0; out.RES_PARATR_ORPHANS = widow ? 2 : 0; }
    const shd = W(child(pPr, 'w:shd'), 'fill');
    if (shd && shd !== 'auto') out.RES_BACKGROUND = `#${shd.toLowerCase()}`;
    const tabs = kids(child(pPr, 'w:tabs'), 'w:tab').filter((t) => val(t) !== 'clear');
    if (tabs.length) {
      out.RES_PARATR_TABSTOP = tabs.map((t): SvxTabStop => {
        const v = val(t);
        const leader = W(t, 'leader');
        return {
          pos: int(W(t, 'pos')) ?? 0, adjust: v === 'right' || v === 'end' ? 'right' : v === 'center' ? 'center' : v === 'decimal' ? 'decimal' : 'left',
          fill: leader === 'dot' ? '.' : leader === 'hyphen' ? '-' : leader === 'underscore' ? '_' : ' ', decimal: '.',
        };
      }).sort((a, b) => a.pos - b.pos);
    }
    // BorderHandler: w:sz is in eighths of a point, w:space in points.
    const pBdr = child(pPr, 'w:pBdr');
    if (pBdr) {
      const line = (e: XmlElement | undefined) => {
        const v = val(e);
        if (!e || !v || v === 'nil' || v === 'none') return null;
        const color = W(e, 'color');
        return { color: color && color !== 'auto' ? `#${color.toLowerCase()}` : '#000000', width: Math.max(1, Math.round(((int(W(e, 'sz')) ?? 4) * 20) / 8)) };
      };
      const top = child(pBdr, 'w:top'), left = child(pBdr, 'w:left') ?? child(pBdr, 'w:start');
      const bottom = child(pBdr, 'w:bottom'), right = child(pBdr, 'w:right') ?? child(pBdr, 'w:end');
      // One distance for all sides: that of the first side with a line.
      const spaced = [top, bottom, left, right].find((e) => line(e));
      out.RES_BOX = {
        top: line(top), bottom: line(bottom), left: line(left), right: line(right),
        padding: (int(W(spaced, 'space')) ?? 0) * 20,
      };
      if (child(pBdr, 'w:between')) lost.add('borders between paragraphs');
    }
    return out;
  };

  // --- styles (StyleSheetTable) ---
  const stylesXml = child(xml('word/styles.xml'), 'w:styles');
  const defaults = child(stylesXml, 'w:docDefaults');
  const standard = doc.FindTextFormatCollByName('Standard')!;
  Object.assign(standard.m_aSet, runProps(child(child(defaults, 'w:rPrDefault'), 'w:rPr')), paraProps(child(child(defaults, 'w:pPrDefault'), 'w:pPr')));
  const styleEls = new Map<string, XmlElement>();
  for (const s of kids(stylesXml, 'w:style')) styleEls.set(`${W(s, 'type')}/${W(s, 'styleId')}`, s);
  const colls = new Map<string, SwTextFormatColl>();
  /** Paragraph styles become format collections, parents first; Normal is Writer's Default Paragraph Style. */
  const resolving = new Set<string>();
  const resolveColl = (id: string | undefined): SwTextFormatColl => {
    if (!id) return standard;
    const got = colls.get(id);
    if (got) return got;
    // StyleSheetTable: a basedOn cycle ends at the default style.
    if (resolving.has(id)) return standard;
    resolving.add(id);
    const el = styleEls.get(`paragraph/${id}`);
    if (!el) return standard;
    const raw = val(child(el, 'w:name')) ?? id;
    const heading = /^heading (\d)$/i.exec(raw);
    const name = heading ? `Heading ${heading[1]}` : STYLE_NAMES[raw] ?? raw;
    const isDefault = W(el, 'default') === '1' || name === 'Standard';
    const parentId = val(child(el, 'w:basedOn'));
    const parent = isDefault ? null : resolveColl(parentId);
    const set = { ...paraProps(child(el, 'w:pPr'), (parent ?? standard).GetFormatAttr('RES_UL_SPACE'), (parent ?? standard).GetFormatAttr('RES_LR_SPACE')), ...runProps(child(el, 'w:rPr')) };
    let c: SwTextFormatColl;
    if (isDefault) { Object.assign(standard.m_aSet, set); c = standard; }
    else {
      const existing = doc.FindTextFormatCollByName(name);
      // Word's styles replace the pool style of the same name.
      if (existing) { existing.m_aSet = set; existing.m_pDerivedFrom = parent; c = existing; }
      else c = doc.MakeColl(name, parent, set);
    }
    colls.set(id, c);
    return c;
  };
  for (const [key] of styleEls) if (key.startsWith('paragraph/')) resolveColl(key.slice(10));
  for (const [key, el] of styleEls) {
    if (!key.startsWith('paragraph/')) continue;
    const next = val(child(el, 'w:next'));
    if (next && colls.has(next)) colls.get(key.slice(10))!.m_pNextTextFormatColl = colls.get(next)!;
  }
  /** Character style properties, flattened along basedOn (character styles are not ported). */
  const charStyle = (id: string | undefined): SwCharAttrSet => {
    const el = id ? styleEls.get(`character/${id}`) : undefined;
    if (!el) return {};
    return { ...charStyle(val(child(el, 'w:basedOn'))), ...runProps(child(el, 'w:rPr')) };
  };
  /** Table style properties along basedOn. */
  const tableStyle = (id: string | undefined): { tblPr?: XmlElement; tcPr?: XmlElement }[] => {
    const el = id ? styleEls.get(`table/${id}`) : undefined;
    if (!el) return [];
    return [...tableStyle(val(child(el, 'w:basedOn'))), { tblPr: child(el, 'w:tblPr'), tcPr: child(el, 'w:tcPr') }];
  };
  /** Numbering set by a paragraph style (w:numPr in the style's pPr), along basedOn. */
  const styleNumPr = (id: string | undefined): XmlElement | undefined => {
    const el = id ? styleEls.get(`paragraph/${id}`) : undefined;
    if (!el) return undefined;
    return child(child(el, 'w:pPr'), 'w:numPr') ?? styleNumPr(val(child(el, 'w:basedOn')));
  };

  // --- numbering (NumberingManager): one rule and one list per w:num ---
  const numberingXml = child(xml('word/numbering.xml'), 'w:numbering');
  const abstracts = new Map<string, XmlElement>();
  for (const a of kids(numberingXml, 'w:abstractNum')) abstracts.set(W(a, 'abstractNumId') ?? '', a);
  const nums = new Map<string, { rule: SwNumRule; listId: string }>();
  for (const n of kids(numberingXml, 'w:num')) {
    const numId = W(n, 'numId') ?? '';
    const abs = abstracts.get(val(child(n, 'w:abstractNumId')) ?? '');
    if (!abs) continue;
    const rule = new SwNumRule(`WWNum${numId}`);
    const overrides = new Map(kids(n, 'w:lvlOverride').map((o) => [W(o, 'ilvl') ?? '', o]));
    for (const lvl of kids(abs, 'w:lvl')) {
      const ilvl = int(W(lvl, 'ilvl')) ?? 0;
      if (ilvl >= MAXLEVEL) continue;
      const over = overrides.get(String(ilvl));
      const src = child(over, 'w:lvl') ?? lvl;
      const f = new SwNumFormat();
      const fmt = val(child(src, 'w:numFmt')) ?? 'decimal';
      f.SetNumberingType(NUM_FMT[fmt] ?? NumberingType.ARABIC);
      if (!(fmt in NUM_FMT)) lost.add(`list numbering of type "${fmt}" (shown as 1, 2, 3)`);
      f.SetStart(int(val(child(over, 'w:startOverride'))) ?? int(val(child(src, 'w:start'))) ?? 1);
      // tdf#101626: a soft hyphen becomes a hard one. DOCX level text "%1.%2" is "%1%.%2%" in LO.
      const lvlText = (val(child(src, 'w:lvlText')) ?? '').replace(/\u00ad/g, '-');
      if (fmt === 'bullet') {
        f.SetBulletChar(RecodeBullet(lvlText) || '•');
        // The level's font. Glyphs of symbol fonts became Unicode above; the font stays for its
        // metrics (the line height), and the browser falls back for glyphs it does not have.
        const bf = W(child(child(src, 'w:rPr'), 'w:rFonts'), 'ascii');
        if (bf) f.SetBulletFont(bf);
      }
      else f.SetListFormatString(lvlText.replace(/(%\d)/g, '$1%'));
      const jc = val(child(src, 'w:lvlJc'));
      f.SetNumAdjust(jc === 'right' || jc === 'end' ? 'right' : jc === 'center' ? 'center' : 'left');
      const suff = val(child(src, 'w:suff'));
      f.SetLabelFollowedBy(suff === 'space' ? 'space' : suff === 'nothing' ? 'nothing' : 'listtab');
      const ind = child(child(src, 'w:pPr'), 'w:ind');
      const left = int(W(ind, 'left') ?? W(ind, 'start')) ?? 720 * (ilvl + 1);
      const first = W(ind, 'hanging') !== undefined ? -(int(W(ind, 'hanging')) ?? 0) : int(W(ind, 'firstLine')) ?? 0;
      f.SetIndentAt(left);
      f.SetFirstLineIndent(first);
      // Word's list tab is the indent unless a tab stop says otherwise.
      const tab = kids(child(child(src, 'w:pPr'), 'w:tabs'), 'w:tab').find((t) => val(t) === 'num');
      f.SetListtabPos(int(W(tab, 'pos')) ?? left);
      rule.Set(ilvl, f);
    }
    doc.PutNumRule(rule);
    nums.set(numId, { rule, listId: `docx${numId}` });
  }

  // --- content ---
  // New nodes go before the end of the section being read, as in the ODT importer.
  let sectionEnd: SwNode = nodes.GetEndOfContent();
  const initial = nodes.FirstTextNode();
  let initialUsed = false;
  const newNode = (coll: SwTextFormatColl): SwTextNode => {
    if (!initialUsed && sectionEnd === nodes.GetEndOfContent()) { initialUsed = true; initial.m_pColl = coll; return initial; }
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
    return nodes.MakeTextNode(sectionEnd.GetIndex(), coll);
  };
  const append = (node: SwTextNode, s: string, attrs: SwCharAttrSet) => {
    if (!s) return;
    const start = node.Len();
    node.m_Text += s;
    if (Object.keys(attrs).length) node.SetAttr(start, start + s.length, attrs);
  };

  const docRels = rels(files.has(mainPart) ? mainPart : 'word/document.xml');
  const footnotesXml = child(xml('word/footnotes.xml'), 'w:footnotes');
  const endnotesXml = child(xml('word/endnotes.xml'), 'w:endnotes');
  const commentsXml = child(xml('word/comments.xml'), 'w:comments');
  const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === 'string' ? c : c.name === 'w:t' ? textOf(c) : c.name === 'w:tab' ? '\t' : c.name === 'w:br' ? '\n' : textOf(c))).join('');

  /** A complex field being read: its instruction, whether its result is being read, and whether that result is replaced. */
  interface FieldState { instr: string; inResult: boolean; replaced: boolean; savedLink: string | null }
  interface RunContext { link: string | null; partRels: Map<string, Rel>; fields: FieldState[]; openComments: Map<string, { node: SwTextNode; start: number; id: string }>; redline?: SwRedlineData | null }
  /** w:ins and w:del (CT_TrackChange): author and date. */
  const redlineOf = (e: XmlElement, type: SwRedlineData['type']): SwRedlineData => ({ type, author: W(e, 'author') || 'Unknown Author', date: W(e, 'date') ?? '' });

  const readRun = (r: XmlElement, node: SwTextNode, base: SwCharAttrSet, ctx: RunContext) => {
    const rPr = child(r, 'w:rPr');
    const attrs: SwCharAttrSet = { ...base, ...charStyle(val(child(rPr, 'w:rStyle'))), ...runProps(rPr), ...(ctx.redline ? { RES_TXTATR_REDLINE: ctx.redline } : {}) };
    for (const c of childElements(r)) {
      if (ctx.link) attrs.RES_TXTATR_INETFMT = ctx.link; else delete attrs.RES_TXTATR_INETFMT;
      // Complex fields: begin, instruction, separate, result, end. PAGE and NUMPAGES become fields,
      // HYPERLINK a link; other fields keep their last result as text.
      const field = ctx.fields[ctx.fields.length - 1];
      if (c.name === 'w:fldChar') {
        const t = W(c, 'fldCharType');
        if (t === 'begin') ctx.fields.push({ instr: '', inResult: false, replaced: false, savedLink: ctx.link });
        else if (t === 'separate' && field) {
          field.inResult = true;
          const instr = field.instr.trim();
          const type = /^PAGE\b/.test(instr) ? 'PageNumber' : /^NUMPAGES\b/.test(instr) ? 'PageCount' : null;
          const href = /^HYPERLINK\s+"([^"]*)"/.exec(instr);
          if (type) { append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FIELD: { type } }); field.replaced = true; }
          else if (href) ctx.link = href[1]!;
          else if (instr) lost.add('fields (their current value is kept as text)');
        } else if (t === 'end' && field) { ctx.link = field.savedLink; ctx.fields.pop(); }
        continue;
      }
      if (c.name === 'w:instrText') { if (field && !field.inResult) field.instr += textOf(c); continue; }
      // A field's instruction is never shown, nor a result that became a field of its own.
      if (field && (!field.inResult || field.replaced)) continue;
      switch (c.name) {
        case 'w:t': case 'w:delText': append(node, textOf(c), attrs); break;
        case 'w:delInstrText': break;
        case 'w:tab': append(node, '\t', attrs); break;
        case 'w:br':
          // A page break before any text of its paragraph breaks before that paragraph; later in
          // the paragraph it moves the next paragraph to a new page (upstream splits the paragraph
          // there, which is not ported).
          if (W(c, 'type') === 'page') { if (node.Len() === 0) node.m_aSet.RES_BREAK = 'page-before'; else pendingPageBreak = true; }
          else append(node, '\n', attrs);
          break;
        case 'w:cr': append(node, '\n', attrs); break;
        case 'w:noBreakHyphen': append(node, '‑', attrs); break;
        case 'w:softHyphen': append(node, '­', attrs); break;
        case 'w:sym': {
          const code = W(c, 'char');
          if (code) {
            const pua = String.fromCharCode(parseInt(code, 16) | 0xf000), r = RecodeBullet(pua);
            append(node, r !== pua ? r : String.fromCharCode(parseInt(code, 16)), attrs);
          }
          break;
        }
        case 'w:drawing': readDrawing(c, node, attrs, ctx.partRels); break;
        case 'mc:AlternateContent': {
          const drawing = findDeep(c, 'w:drawing');
          if (drawing) readDrawing(drawing, node, attrs, ctx.partRels);
          else lost.add('shapes and text boxes');
          break;
        }
        case 'w:pict': case 'w:object': lost.add('shapes, text boxes and embedded objects'); break;
        case 'w:ptab': append(node, '\t', attrs); break; // absolute tabs approximate as tabs
        case 'w:footnoteReference': {
          const fn = kids(footnotesXml, 'w:footnote').find((f) => W(f, 'id') === W(c, 'id'));
          if (!fn) break;
          const id = doc.NewFootnoteId();
          const sec = nodes.MakeFootnoteSection(id, doc.FindTextFormatCollByName('Footnote')!);
          const placeholder = nodes.GoNext(sec.GetIndex())!;
          const saved = sectionEnd;
          sectionEnd = sec.EndOfSectionNode();
          readBlocks(fn, rels('word/footnotes.xml'));
          sectionEnd = saved;
          if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
          append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FTN: { id } });
          break;
        }
        case 'w:endnoteReference': {
          const en = kids(endnotesXml, 'w:endnote').find((f) => W(f, 'id') === W(c, 'id'));
          if (!en) break;
          const id = doc.NewFootnoteId();
          const sec = nodes.MakeFootnoteSection(id, doc.FindTextFormatCollByName('Endnote')!);
          const placeholder = nodes.GoNext(sec.GetIndex())!;
          const saved = sectionEnd;
          sectionEnd = sec.EndOfSectionNode();
          readBlocks(en, rels('word/endnotes.xml'));
          sectionEnd = saved;
          if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
          append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FTN: { id, endnote: true } });
          break;
        }
        case 'w:endnoteRef': break;
        case 'w:footnoteRef': break; // the footnote's own number: Writer adds it
        case 'w:commentReference': {
          const cm = kids(commentsXml, 'w:comment').find((x) => W(x, 'id') === W(c, 'id'));
          if (!cm) break;
          const open = ctx.openComments.get(W(c, 'id') ?? '');
          const field: SwPostItField = {
            id: doc.NewAnnotationId(), author: W(cm, 'author') ?? 'Unknown Author', date: W(cm, 'date') ?? '',
            text: kids(cm, 'w:p').map((p) => textOf(p)).join('\n'), resolved: false,
          };
          if (open && open.node === node && open.start < node.Len()) {
            // The anchor goes where the range starts, the range is marked.
            node.InsertText(CH_TXTATR_BREAKWORD, open.start);
            node.SetAttr(open.start, open.start + 1, { RES_TXTATR_ANNOTATION: field });
            node.SetAttr(open.start + 1, node.Len(), { RES_TXTATR_ANNOTMARK: field.id });
          } else append(node, CH_TXTATR_BREAKWORD, { RES_TXTATR_ANNOTATION: field });
          ctx.openComments.delete(W(c, 'id') ?? '');
          break;
        }
        case 'w:rPr': case 'w:lastRenderedPageBreak': case 'w:annotationRef': case 'w:separator': case 'w:continuationSeparator': break;
        default: lost.add(`other content (${c.name})`);
      }
    }
  };

  // GraphicHelpers.cxx PositionHandler: relativeFrom and align values.
  const REL_H: Record<string, number> = { margin: RelOrientation.PAGE_PRINT_AREA, page: RelOrientation.PAGE_FRAME, insideMargin: RelOrientation.PAGE_FRAME, outsideMargin: RelOrientation.PAGE_FRAME, column: RelOrientation.FRAME, character: RelOrientation.CHAR, leftMargin: RelOrientation.PAGE_LEFT, rightMargin: RelOrientation.PAGE_RIGHT };
  const REL_V: Record<string, number> = { margin: RelOrientation.PAGE_PRINT_AREA, page: RelOrientation.PAGE_FRAME, topMargin: RelOrientation.PAGE_PRINT_AREA_TOP, bottomMargin: RelOrientation.PAGE_PRINT_AREA_BOTTOM, paragraph: RelOrientation.FRAME, line: RelOrientation.TEXT_LINE, insideMargin: RelOrientation.PAGE_PRINT_AREA_TOP, outsideMargin: RelOrientation.PAGE_PRINT_AREA_BOTTOM };
  const ALIGN_H: Record<string, number> = { left: HoriOrientation.LEFT, center: HoriOrientation.CENTER, right: HoriOrientation.RIGHT, inside: HoriOrientation.INSIDE, outside: HoriOrientation.OUTSIDE };
  const ALIGN_V: Record<string, number> = { top: VertOrientation.TOP, center: VertOrientation.CENTER, bottom: VertOrientation.BOTTOM, inside: VertOrientation.TOP, outside: VertOrientation.BOTTOM };
  const WRAP_TEXT: Record<string, WrapTextMode> = { bothSides: WrapTextMode.PARALLEL, left: WrapTextMode.LEFT, right: WrapTextMode.RIGHT, largest: WrapTextMode.DYNAMIC };
  const usedNames = new Set<string>();
  const uniqueName = (want: string | undefined, prefix: string): string => {
    let name = want ?? '';
    if (!name || usedNames.has(name)) { let k = 1; while (usedNames.has(`${prefix}${k}`)) k++; name = `${prefix}${k}`; }
    usedNames.add(name);
    return name;
  };
  const colorOf = (fill: XmlElement | undefined): string | null => {
    const c = fill && child(fill, 'a:srgbClr')?.attrs.get('val');
    return c ? `#${c.toLowerCase()}` : null;
  };

  /**
   * GraphicImport: a picture or text box. Inline ones are anchored as characters (text boxes are
   * anchored to the character instead); wp:anchor ones keep their position, wrap and distances,
   * anchored to the character as upstream does. Other shapes are not ported.
   */
  const readDrawing = (d: XmlElement, node: SwTextNode, attrs: SwCharAttrSet, partRels: Map<string, Rel>) => {
    const holder = child(d, 'wp:inline') ?? child(d, 'wp:anchor');
    const ext = child(holder, 'wp:extent');
    if (!holder || !ext) { lost.add('shapes and text boxes'); return; }
    const width = emuToTwips(int(ext.attrs.get('cx')) ?? 0), height = emuToTwips(int(ext.attrs.get('cy')) ?? 0);
    const docPr = child(holder, 'wp:docPr');
    const alt = docPr?.attrs.get('descr') || undefined;
    const blip = findDeep(holder, 'a:blip');
    const txbx = findDeep(holder, 'w:txbxContent');
    // A wps:wsp that is not a plain rectangular text box is a drawing shape.
    const wsp = findDeep(holder, 'wps:wsp');
    const prst = wsp && findDeep(wsp, 'a:prstGeom')?.attrs.get('prst');
    // Groups (wpg:wgp) are not ported: their first picture or text box is kept, as before.
    const group = !!findDeep(holder, 'wpg:wgp');
    if (group) lost.add('grouped shapes (only a picture or text box of the group is kept)');
    const isShape = !group && !!wsp && !blip && (!!findDeep(wsp, 'a:custGeom') || (prst !== undefined && prst !== 'rect') || !txbx);
    let graphic: string | undefined;
    let crop: SwCropGrf | undefined;
    if (blip) {
      const rel = partRels.get(blip.attrs.get('r:embed') ?? '');
      const data = rel && files.get(rel.target);
      const mime = rel && ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' } as Record<string, string>)[rel.target.split('.').pop()!.toLowerCase()];
      if (!data) { lost.add('shapes and text boxes'); return; }
      if (!mime) { lost.add('images in formats a browser cannot show'); return; }
      graphic = doc.AddGraphic(data, mime);
      // GraphicImport: a:srcRect, in thousandths of a percent of the picture.
      const src = findDeep(holder, 'a:srcRect');
      const f = (k: string) => (int(src?.attrs.get(k)) ?? 0) / 100000;
      if (src && (f('l') || f('t') || f('r') || f('b'))) crop = { left: f('l'), top: f('t'), right: f('r'), bottom: f('b') };
    } else if (!txbx && !isShape) { lost.add('shapes (other than pictures and text boxes)'); return; }
    // A shape in the line without text is a shape anchored as character.
    if (holder.name === 'wp:inline' && isShape && !txbx) {
      append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FLYCNT: { graphic: '', width, height, name: uniqueName(docPr?.attrs.get('name'), 'Shape'), shape: readShape(wsp!) } });
      return;
    }
    if (holder.name === 'wp:inline' && graphic !== undefined) {
      append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FLYCNT: { graphic, width, height, name: uniqueName(docPr?.attrs.get('name'), 'Image'), ...(alt ? { alt } : {}), ...(crop ? { crop } : {}) } });
      return;
    }
    const posH = child(holder, 'wp:positionH'), posV = child(holder, 'wp:positionV');
    const orient = (pos: XmlElement | undefined, rel: Record<string, number>, align: Record<string, number>, dfltRel: number) => {
      const a = pos && child(pos, 'wp:align'), off = pos && child(pos, 'wp:posOffset');
      return {
        m_eOrient: a ? align[textOf(a).trim()] ?? 0 : 0,
        m_eRelation: rel[pos?.attrs.get('relativeFrom') ?? ''] ?? dfltRel,
        m_nPos: off ? emuToTwips(parseInt(textOf(off), 10) || 0) : 0,
      };
    };
    // EG_WrapType: no wrap element (inline) or wrapNone runs through; top and bottom is no wrap.
    let wrap: WrapTextMode = WrapTextMode.THROUGH;
    const wrapEl = childElements(holder).find((c) => c.name.startsWith('wp:wrap'));
    if (wrapEl?.name === 'wp:wrapTopAndBottom') wrap = WrapTextMode.NONE;
    else if (wrapEl && wrapEl.name !== 'wp:wrapNone') wrap = WRAP_TEXT[wrapEl.attrs.get('wrapText') ?? 'bothSides'] ?? WrapTextMode.PARALLEL;
    const dist = (k: string) => emuToTwips(int(holder.attrs.get(k)) ?? 0);
    const inline = holder.name === 'wp:inline';
    const fmt: SwFlyFrameFormat = {
      m_aName: uniqueName(docPr?.attrs.get('name'), isShape ? 'Shape' : txbx ? 'Frame' : 'Image'), m_nWidth: width, m_nHeight: height,
      m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_CHAR, m_nPageNumber: 0 },
      m_aHoriOrient: inline ? { m_eOrient: HoriOrientation.LEFT, m_eRelation: RelOrientation.CHAR, m_nPos: 0 } : orient(posH, REL_H, ALIGN_H, RelOrientation.FRAME),
      m_aVertOrient: inline ? { m_eOrient: VertOrientation.TOP, m_eRelation: RelOrientation.TEXT_LINE, m_nPos: 0 } : orient(posV, REL_V, ALIGN_V, RelOrientation.FRAME),
      m_aSurround: { m_eSurround: inline ? WrapTextMode.NONE : wrap },
      m_nLeftSpace: dist('distL'), m_nRightSpace: dist('distR'), m_nUpperSpace: dist('distT'), m_nLowerSpace: dist('distB'),
      m_bOpaque: holder.attrs.get('behindDoc') !== '1',
      ...(alt ? { alt } : {}),
    };
    if (graphic !== undefined) { fmt.graphic = graphic; if (crop) fmt.crop = crop; }
    else if (isShape) {
      fmt.m_pShape = readShape(wsp!);
      const bodyPr = findDeep(holder, 'wps:bodyPr');
      const anchorV = bodyPr?.attrs.get('anchor');
      // wps:bodyPr anchor: t (Word's default) and b; ctr is the model's default.
      if (anchorV !== 'ctr') fmt.m_pShape.m_eTextVertAdjust = anchorV === 'b' ? 'bottom' : 'top';
      if (txbx) {
        // The shape's text, inside its insets.
        fmt.m_sContentId = fmt.m_aName;
        fmt.m_aBox = { top: null, bottom: null, left: null, right: null, padding: emuToTwips(int(bodyPr?.attrs.get('lIns')) ?? 91440) };
        readFlyContent(fmt.m_aName, txbx, partRels);
      }
    } else {
      // A wps:wsp text box: its fill and outline, its insets, and its paragraphs in a frame section.
      const spPr = findDeep(holder, 'wps:spPr');
      const ln = spPr && child(spPr, 'a:ln');
      const lineColor = ln && !child(ln, 'a:noFill') ? colorOf(child(ln, 'a:solidFill')) : null;
      const lineW = Math.max(1, emuToTwips(int(ln?.attrs.get('w')) ?? 9525));
      const bodyPr = findDeep(holder, 'wps:bodyPr');
      const inset = emuToTwips(int(bodyPr?.attrs.get('lIns')) ?? 91440);
      const line = lineColor ? { color: lineColor, width: lineW } : null;
      fmt.m_sContentId = fmt.m_aName;
      fmt.m_bAutoHeight = !!(bodyPr && child(bodyPr, 'a:spAutoFit'));
      fmt.m_aBox = { top: line, bottom: line && { ...line }, left: line && { ...line }, right: line && { ...line }, padding: inset };
      fmt.m_aBackground = spPr && !child(spPr, 'a:noFill') ? colorOf(child(spPr, 'a:solidFill')) : null;
      readFlyContent(fmt.m_aName, txbx!, partRels);
    }
    node.m_aAnchoredFlys.push({ fmt, nContent: node.Len() });
  };

  /**
   * Shape::createAndInsert for a wps:wsp: the preset geometry with its adjustment values, the fill
   * and outline (direct or from the theme through wps:style), mirroring and rotation.
   */
  const readShape = (wsp: XmlElement): SdrShape => {
    const spPr = child(wsp, 'wps:spPr'), style = child(wsp, 'wps:style');
    const geom = child(spPr, 'a:prstGeom');
    let type = `ooxml-${geom?.attrs.get('prst') ?? 'rect'}`;
    const custGeom = child(spPr, 'a:custGeom');
    const ext = child(child(spPr, 'a:xfrm'), 'a:ext');
    const aGeometry = custGeom ? ImportCustGeom(custGeom, Number(ext?.attrs.get('cx') ?? 0), Number(ext?.attrs.get('cy') ?? 0)) : null;
    if (custGeom) type = aGeometry ? 'ooxml-non-primitive' : 'ooxml-rect';
    else if (!GetCustomShapeContent(type)) { lost.add(`shapes of the type "${type.slice(6)}" (shown as rectangles)`); type = 'ooxml-rect'; }
    const shape: SdrShape = { m_sType: type, m_aFill: null, m_aLine: null };
    if (aGeometry) shape.m_aGeometry = aGeometry;
    // a:avLst: each guide sets the adjustment value of its name (adj, adj1, hf, ...).
    const names = GetCustomShapeContent(type)?.adjustNames ?? [];
    for (const gd of kids(child(geom, 'a:avLst'), 'a:gd')) {
      const k = names.indexOf(gd.attrs.get('name') ?? ''), v = /^val\s+(-?\d+)/.exec(gd.attrs.get('fmla') ?? '');
      if (k >= 0 && v) (shape.m_aAdjust ??= [])[k] = parseInt(v[1]!, 10);
    }
    // Fill: noFill, solidFill, the first stop of gradFill, else the style's fill reference.
    const ref = (name: string) => { const r = child(style, name); return r && r.attrs.get('idx') !== '0' ? GetColor(r, themeColors) : null; };
    if (child(spPr, 'a:noFill')) shape.m_aFill = null;
    else if (child(spPr, 'a:solidFill')) shape.m_aFill = GetColor(child(spPr, 'a:solidFill'), themeColors);
    else if (child(spPr, 'a:gradFill')) { shape.m_aFill = GetColor(findDeep(child(spPr, 'a:gradFill')!, 'a:gs'), themeColors); lost.add('gradient fills (shown in their first colour)'); }
    else shape.m_aFill = ref('a:fillRef');
    const ln = child(spPr, 'a:ln');
    const lineColor = ln && child(ln, 'a:noFill') ? null : GetColor(child(ln, 'a:solidFill'), themeColors) ?? ref('a:lnRef');
    if (lineColor) shape.m_aLine = { color: lineColor, width: emuToTwips(int(ln?.attrs.get('w')) ?? 12700) };
    const xfrm = child(spPr, 'a:xfrm');
    if (xfrm?.attrs.get('flipH') === '1') shape.m_bFlipH = true;
    if (xfrm?.attrs.get('flipV') === '1') shape.m_bFlipV = true;
    const rot = int(xfrm?.attrs.get('rot'));
    if (rot) shape.m_nRotate = rot / 60000;
    return shape;
  };

  /** The paragraphs of a text box or frame go into the frame's own section. */
  const readFlyContent = (id: string, content: XmlElement | XmlElement[], partRels: Map<string, Rel>) => {
    const section = nodes.MakeFlySection(id, standard);
    const placeholder = nodes.GoNext(section.GetIndex())!;
    const saved = sectionEnd;
    sectionEnd = section.EndOfSectionNode();
    if (Array.isArray(content)) for (const p of content) readPara(p, partRels);
    else readBlocks(content, partRels);
    sectionEnd = saved;
    if (section.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
  };

  /**
   * DomainMapper_Impl::CheckUnregisteredFrameConversion: paragraphs with equal w:framePr make one
   * text frame, anchored at the paragraph that follows them.
   */
  const FRAME_WRAP: Record<string, WrapTextMode> = { through: WrapTextMode.DYNAMIC, auto: WrapTextMode.DYNAMIC, around: WrapTextMode.PARALLEL, none: WrapTextMode.THROUGH, notBeside: WrapTextMode.NONE, tight: WrapTextMode.PARALLEL };
  const FRAME_REL: Record<string, number> = { text: RelOrientation.FRAME, margin: RelOrientation.PAGE_PRINT_AREA, page: RelOrientation.PAGE_FRAME };
  const framePrFormat = (fp: XmlElement): SwFlyFrameFormat => {
    const a = (k: string) => W(fp, k);
    const w = int(a('w')), h = int(a('h')) ?? 0;
    const hSpace = int(a('hSpace')) ?? 0, vSpace = int(a('vSpace')) ?? 0;
    const xAlign = a('xAlign'), yAlign = a('yAlign');
    return {
      m_aName: uniqueName(undefined, 'Frame'), m_sContentId: '', m_nWidth: w ?? 0, m_nHeight: h,
      ...(w ? {} : { m_bAutoWidth: true }), m_bAutoHeight: a('hRule') !== 'exact',
      m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_PARA, m_nPageNumber: 0 },
      m_aHoriOrient: { m_eOrient: xAlign ? ALIGN_H[xAlign] ?? 0 : 0, m_eRelation: FRAME_REL[a('hAnchor') ?? 'text'] ?? RelOrientation.FRAME, m_nPos: int(a('x')) ?? 0 },
      m_aVertOrient: { m_eOrient: yAlign ? ALIGN_V[yAlign] ?? 0 : 0, m_eRelation: FRAME_REL[a('vAnchor') ?? 'margin'] ?? RelOrientation.FRAME, m_nPos: int(a('y')) ?? 0 },
      m_aSurround: { m_eSurround: FRAME_WRAP[a('wrap') ?? 'around'] ?? WrapTextMode.PARALLEL },
      m_nLeftSpace: hSpace, m_nRightSpace: hSpace, m_nUpperSpace: vSpace, m_nLowerSpace: vSpace, m_bOpaque: true, m_aBox: null, m_aBackground: null,
    };
  };

  let pendingPageBreak = false;
  // Section breaks of the body: the last paragraph of each section and its w:sectPr.
  const sectBreaks: { last: SwTextNode; sectPr: XmlElement }[] = [];
  let bodySectPr: XmlElement | undefined;

  const readPara = (p: XmlElement, partRels: Map<string, Rel>) => {
    const pPr = child(p, 'w:pPr');
    const styleId = val(child(pPr, 'w:pStyle'));
    const node = newNode(resolveColl(styleId));
    Object.assign(node.m_aSet, paraProps(pPr, node.GetTextColl().GetFormatAttr('RES_UL_SPACE'), node.GetTextColl().GetFormatAttr('RES_LR_SPACE')));
    if (pendingPageBreak) { node.m_aSet.RES_BREAK = 'page-before'; pendingPageBreak = false; }
    const numPr = child(pPr, 'w:numPr') ?? styleNumPr(styleId);
    const numId = val(child(numPr, 'w:numId'));
    const list = numId && numId !== '0' ? nums.get(numId) : undefined;
    if (list) {
      Object.assign(node.m_aSet, { RES_PARATR_NUMRULE: list.rule.GetName(), RES_PARATR_LIST_ID: list.listId, RES_PARATR_LIST_LEVEL: int(val(child(numPr, 'w:ilvl'))) ?? 0 } satisfies SwAttrSet);
      // The list's indents apply unless the paragraph sets its own.
      if (!child(pPr, 'w:ind')) delete node.m_aSet.RES_LR_SPACE;
    }
    const sect = child(pPr, 'w:sectPr');
    if (sect && sectionEnd === nodes.GetEndOfContent()) sectBreaks.push({ last: node, sectPr: sect });
    const ctx: RunContext = { link: null, partRels, fields: [], openComments: new Map() };
    // The paragraph mark's own change (w:pPr/w:rPr/w:ins or w:del).
    const markRPr = child(pPr, 'w:rPr');
    const markChange = child(markRPr, 'w:ins') ?? child(markRPr, 'w:moveTo') ?? child(markRPr, 'w:del') ?? child(markRPr, 'w:moveFrom');
    if (markChange) node.m_aSet.RES_PARATR_REDLINE = redlineOf(markChange, markChange.name === 'w:ins' || markChange.name === 'w:moveTo' ? 'Insert' : 'Delete');
    if (child(pPr, 'w:pPrChange') || child(markRPr, 'w:rPrChange')) lost.add('tracked formatting changes (the current formatting is kept)');
    const walk = (parent: XmlElement) => {
      for (const c of childElements(parent)) {
        switch (c.name) {
          case 'w:r': readRun(c, node, {}, ctx); break;
          case 'w:hyperlink': {
            const rel = partRels.get(c.attrs.get('r:id') ?? '');
            const anchor = W(c, 'anchor');
            const saved = ctx.link;
            ctx.link = rel?.target ?? (anchor ? `#${anchor}` : null);
            walk(c);
            ctx.link = saved;
            break;
          }
          case 'w:fldSimple': {
            const instr = (W(c, 'instr') ?? '').trim();
            const type = /^PAGE\b/.test(instr) ? 'PageNumber' : /^NUMPAGES\b/.test(instr) ? 'PageCount' : null;
            if (type) append(node, CH_TXTATR_BREAKWORD, { RES_TXTATR_FIELD: { type } });
            else { lost.add('fields (their current value is kept as text)'); walk(c); }
            break;
          }
          case 'w:smartTag': case 'w:customXml': case 'w:sdt': walk(child(c, 'w:sdtContent') ?? c); break;
          // DomainMapper_Impl::CreateRedline: runs in w:ins and w:del (moves count as such) are tracked changes.
          case 'w:ins': case 'w:moveTo': case 'w:del': case 'w:moveFrom': {
            const saved = ctx.redline;
            ctx.redline = redlineOf(c, c.name === 'w:ins' || c.name === 'w:moveTo' ? 'Insert' : 'Delete');
            walk(c);
            ctx.redline = saved;
            break;
          }
          case 'm:oMath': case 'm:oMathPara': lost.add('formulas'); break;
          case 'w:commentRangeStart': ctx.openComments.set(W(c, 'id') ?? '', { node, start: node.Len(), id: W(c, 'id') ?? '' }); break;
          case 'w:pPr': case 'w:bookmarkStart': case 'w:bookmarkEnd': case 'w:proofErr': case 'w:commentRangeEnd': case 'w:permStart': case 'w:permEnd':
          case 'w:moveFromRangeStart': case 'w:moveFromRangeEnd': case 'w:moveToRangeStart': case 'w:moveToRangeEnd': case 'w:smartTagPr':
          case 'w:customXmlMoveFromRangeStart': case 'w:customXmlMoveFromRangeEnd': case 'w:customXmlMoveToRangeStart': case 'w:customXmlMoveToRangeEnd': break;
          default: lost.add(`other content (${c.name})`);
        }
      }
    };
    walk(p);
    node.m_nVersion++;
    return node;
  };

  // DomainMapperTableHandler: rows of cells over a grid of columns; gridSpan widens a box, vMerge continues one.
  const readTable = (tbl: XmlElement, partRels: Map<string, Rel>) => {
    const tblPr = child(tbl, 'w:tblPr');
    const styles = tableStyle(val(child(tblPr, 'w:tblStyle')));
    const prop = (name: string) => child(tblPr, name) ?? styles.map((s) => child(s.tblPr, name)).filter(Boolean).pop();
    const jc = val(prop('w:jc'));
    const tblW = prop('w:tblW');
    const width = W(tblW, 'type') === 'dxa' ? int(W(tblW, 'w')) ?? 0 : 0;
    const adjust: SwTableAdjust = width ? (jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left') : 'full';
    const table = new SwTable({ name: doc.GetUniqueTableName(), adjust, width, leftSpace: int(W(prop('w:tblInd'), 'w')) ?? 0, upper: 0, lower: 0 });
    const tableNode = new SwTableNode(nodes, table);
    tableNode.m_pStartOfSection = sectionEnd.m_pStartOfSection;
    const at = sectionEnd.GetIndex();
    nodes.Insert(tableNode, at);
    const tableEnd = new SwEndNode(nodes, tableNode);
    nodes.Insert(tableEnd, at + 1);
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
    const grid = kids(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => int(W(g, 'w')) ?? 1000);
    const border = (e: XmlElement | undefined): SvxBorderLine | null | undefined => {
      if (!e) return undefined;
      const v = val(e);
      if (!v || v === 'nil' || v === 'none') return null;
      const color = W(e, 'color');
      return { color: color && color !== 'auto' ? `#${color.toLowerCase()}` : '#000000', width: Math.max(1, Math.round(((int(W(e, 'sz')) ?? 4) * 20) / 8)) };
    };
    const tblBorders = prop('w:tblBorders');
    /** A table border: the outer one on the table's edge, insideH/insideV between cells. */
    const tableBorder = (side: 'left' | 'right' | 'top' | 'bottom', isEdge: boolean): SvxBorderLine | null | undefined => {
      if (!isEdge) return border(child(tblBorders, side === 'top' || side === 'bottom' ? 'w:insideH' : 'w:insideV'));
      return border(child(tblBorders, `w:${side}`) ?? (side === 'left' ? child(tblBorders, 'w:start') : side === 'right' ? child(tblBorders, 'w:end') : undefined));
    };
    const cellMar = prop('w:tblCellMar');
    const padding = int(W(child(cellMar, 'w:left') ?? child(cellMar, 'w:start'), 'w')) ?? 108;
    // CT_TblCellMar: top and bottom default to 0 (Normal Table).
    const dist = { top: int(W(child(cellMar, 'w:top'), 'w')) ?? 0, bottom: int(W(child(cellMar, 'w:bottom'), 'w')) ?? 0 };
    const rows = kids(tbl, 'w:tr');
    // Open vertical merges by column: the top box and the boxes it covers.
    const vmerge = new Map<number, { top: SwTableBox; covered: SwTableBox[] }>();
    const merges: { top: SwTableBox; covered: SwTableBox[] }[] = [];
    const saved = sectionEnd;
    rows.forEach((tr, ri) => {
      const line = new SwTableLine();
      table.m_aLines.push(line);
      const trPr = child(tr, 'w:trPr');
      if (onOff(child(trPr, 'w:tblHeader')) && ri === table.m_nRowsToRepeat) table.m_nRowsToRepeat++;
      line.m_aAttrs.minHeight = int(val(child(trPr, 'w:trHeight'))) ?? 0;
      let col = int(val(child(trPr, 'w:gridBefore'))) ?? 0;
      const cells = kids(tr, 'w:tc');
      cells.forEach((tc, ci) => {
        const tcPr = child(tc, 'w:tcPr');
        const span = Math.max(1, int(val(child(tcPr, 'w:gridSpan'))) ?? 1);
        let w = 0;
        for (let k = 0; k < span; k++) w += grid[col + k] ?? grid[grid.length - 1] ?? 1000;
        const vm = child(tcPr, 'w:vMerge');
        const cont = vm && (val(vm) ?? 'continue') === 'continue';
        const attrs = defaultBoxAttrs(w, false);
        const tcBorders = child(tcPr, 'w:tcBorders');
        const lastRow = ri === rows.length - 1, lastCol = ci === cells.length - 1;
        const side = (s: 'left' | 'right' | 'top' | 'bottom', edge: boolean): SvxBorderLine | null => {
          const own = border(child(tcBorders, `w:${s}`) ?? (s === 'left' ? child(tcBorders, 'w:start') : s === 'right' ? child(tcBorders, 'w:end') : undefined));
          return own !== undefined ? own : tableBorder(s, edge) ?? null;
        };
        attrs.box = { left: side('left', ci === 0), right: side('right', lastCol), top: side('top', ri === 0), bottom: side('bottom', lastRow) } satisfies SvxBoxItem;
        attrs.padding = padding;
        if (dist.top !== padding || dist.bottom !== padding) attrs.dist = dist;
        const fill = W(child(tcPr, 'w:shd'), 'fill');
        if (fill && fill !== 'auto') attrs.background = `#${fill.toLowerCase()}`;
        const box = new SwTableBox(line, attrs);
        const sn = new SwStartNode(nodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
        sn.m_pStartOfSection = tableNode;
        nodes.Insert(sn, tableEnd.GetIndex());
        const en = new SwEndNode(nodes, sn);
        nodes.Insert(en, tableEnd.GetIndex());
        box.m_pStartNode = sn;
        line.m_aBoxes.push(box);
        const merge = cont ? vmerge.get(col) : undefined;
        if (merge) {
          // Continues the merge started above in this column: a covered box.
          merge.top.setRowSpan(merge.top.getRowSpan() + 1);
          merge.covered.push(box);
          box.setRowSpan(-1);
          nodes.MakeTextNode(en.GetIndex(), doc.FindTextFormatCollByName('Table Contents')!);
        } else {
          vmerge.delete(col);
          if (vm) { const m2 = { top: box, covered: [] }; vmerge.set(col, m2); merges.push(m2); }
          sectionEnd = en;
          readBlocks(tc, partRels);
          sectionEnd = saved;
          if (en.GetIndex() === sn.GetIndex() + 1) nodes.MakeTextNode(en.GetIndex(), standard);
        }
        col += span;
      });
    });
    sectionEnd = saved;
    // Covered boxes count down to the merge's end, as upstream's new table model does.
    for (const { top, covered } of merges) covered.forEach((b, i) => b.setRowSpan(-(top.getRowSpan() - 1 - i)));
    if (!table.m_aLines.length) nodes.Remove(tableNode.GetIndex(), 2);
  };

  /**
   * The paragraphs and tables of a body, cell, header or frame. Frames from w:framePr anchor at the
   * next paragraph; a nested call (content controls) hands those still waiting back to its caller.
   */
  const readBlocks = (parent: XmlElement, partRels: Map<string, Rel>, nested = false): SwFlyFrameFormat[] => {
    const els = childElements(parent);
    let last: SwTextNode | null = null;
    let pendingFrames: SwFlyFrameFormat[] = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      switch (el.name) {
        case 'w:p': {
          const fp = child(child(el, 'w:pPr'), 'w:framePr');
          // A drop cap frame (w:dropCap) is not ported: its paragraph stays in the text.
          if (fp && !W(fp, 'dropCap') || (fp && W(fp, 'dropCap') === 'none')) {
            const key = [...fp.attrs].map(([k, v]) => `${k}=${v}`).sort().join(' ');
            const group: XmlElement[] = [el];
            while (els[i + 1]?.name === 'w:p') {
              const nfp = child(child(els[i + 1]!, 'w:pPr'), 'w:framePr');
              if (!nfp || [...nfp.attrs].map(([k, v]) => `${k}=${v}`).sort().join(' ') !== key) break;
              group.push(els[++i]!);
            }
            const fmt = framePrFormat(fp);
            fmt.m_sContentId = fmt.m_aName;
            readFlyContent(fmt.m_aName, group, partRels);
            pendingFrames.push(fmt);
            break;
          }
          last = readPara(el, partRels);
          for (const fmt of pendingFrames) last.m_aAnchoredFlys.push({ fmt, nContent: 0 });
          pendingFrames = [];
          break;
        }
        case 'w:tbl': readTable(el, partRels); break;
        case 'w:sdt': pendingFrames.push(...readBlocks(child(el, 'w:sdtContent') ?? el, partRels, true)); break;
        case 'w:customXml': pendingFrames.push(...readBlocks(el, partRels, true)); break;
        case 'w:sectPr': if (sectionEnd === nodes.GetEndOfContent()) bodySectPr = el; break;
        case 'w:bookmarkStart': case 'w:bookmarkEnd': case 'w:tcPr': case 'w:proofErr': case 'w:permStart': case 'w:permEnd': break;
        case 'm:oMathPara': lost.add('formulas'); break;
        default: lost.add(`other content (${el.name})`);
      }
    }
    if (nested) return pendingFrames;
    // Frames at the end anchor at the last paragraph, or the section's first.
    if (pendingFrames.length) {
      const at = last ?? nodes.GoNext(sectionEnd.m_pStartOfSection!.GetIndex());
      if (at) for (const fmt of pendingFrames) at.m_aAnchoredFlys.push({ fmt, nContent: 0 });
    }
    return [];
  };

  const body = child(child(documentXml, 'w:document'), 'w:body');
  if (!body) throw new Error('This Word document has no body.');
  readBlocks(body, docRels);

  // SectionPropertyMap::CloseSectionGroup: every section is a page style ("Converted1"...) that
  // its first paragraph starts, except continuous sections that keep the page; those with their
  // own columns become Writer sections. Word's header sits at its own distance from the edge and
  // the body starts at the top margin or below the header, whichever is lower: a minimum height
  // and no spacing say that. A section without a header reference keeps the previous one's.
  const settings = child(xml('word/settings.xml'), 'w:settings');
  const evenAndOdd = onOff(child(settings, 'w:evenAndOddHeaders')) ?? false;
  // SettingsTable: w:trackRevisions turns recording on.
  if (onOff(child(settings, 'w:trackRevisions'))) doc.m_pDocumentRedlineManager.m_bRecord = true;
  // DomainMapper_Impl::ApplySettingsTable: AddParaTableSpacing is w:doNotUseHTMLParagraphAutoSpacing.
  // DomainMapper::DomainMapper: the settings of every new document from Word.
  doc.m_bHeaderSpacingBelowLastPara = true;
  // WriterFilter::filter: TabOverSpacing always; SettingsTable::ApplyProperties: TabOverMargin up to Word 2010.
  doc.m_bTabOverSpacing = true;
  const compatMode = int(kids(child(settings, 'w:compat'), 'w:compatSetting').find((e) => W(e, 'name') === 'compatibilityMode')?.attrs.get('w:val')) ?? 12;
  doc.m_bTabOverMargin = compatMode <= 14;
  doc.m_bParaSpaceMax = onOff(child(child(settings, 'w:compat'), 'w:doNotUseHTMLParagraphAutoSpacing')) ?? false;
  const sects = [...sectBreaks, { last: nodes.LastTextNode(), sectPr: bodySectPr }];
  const geometry = (sp: XmlElement | undefined) => {
    const pgSz = child(sp, 'w:pgSz'), pgMar = child(sp, 'w:pgMar');
    const m = (k: string) => int(W(pgMar, k));
    return {
      w: int(W(pgSz, 'w')), h: int(W(pgSz, 'h')), l: m('left'), r: m('right'), t: m('top'), b: m('bottom'), hd: m('header'), fd: m('footer'),
      cols: ((): SwFormatCol | null => {
        const c = child(sp, 'w:cols');
        const n = int(W(c, 'num')) ?? 1;
        return n > 1 ? { m_nCount: n, m_nGutterWidth: int(W(c, 'space')) ?? 720, m_bLine: ['1', 'true', 'on'].includes(W(c, 'sep') ?? ''), m_bBalanced: true } : null;
      })(),
    };
  };
  type HdrRefs = Map<string, string>; // "header/default" -> relationship target
  const refsOf = (sp: XmlElement | undefined, inherited: HdrRefs): HdrRefs => {
    const out = new Map(inherited);
    for (const tag of ['w:headerReference', 'w:footerReference'] as const) {
      for (const ref of kids(sp, tag)) {
        const rel = docRels.get(ref.attrs.get('r:id') ?? '');
        if (rel) out.set(`${tag === 'w:headerReference' ? 'header' : 'footer'}/${W(ref, 'type') ?? 'default'}`, rel.target);
      }
    }
    return out;
  };
  /** One page style from a section's properties, with its headers and footers. */
  const makeDesc = (pd: SwPageDesc, sp: XmlElement | undefined, refs: HdrRefs) => {
    const g = geometry(sp);
    if (g.w) pd.nWidth = g.w;
    if (g.h) pd.nHeight = g.h;
    if (g.l !== undefined) pd.nLeft = g.l;
    if (g.r !== undefined) pd.nRight = g.r;
    if (g.t !== undefined) pd.nTop = Math.abs(g.t);
    if (g.b !== undefined) pd.nBottom = Math.abs(g.b);
    pd.m_aCol = g.cols;
    // The first page's header counts only with w:titlePg, even pages' only with evenAndOddHeaders.
    const titlePg = onOff(child(sp, 'w:titlePg')) ?? false;
    const marginsDone = new Set<number>();
    for (const [part, eTyp, coll, wordType, kind] of [
      ['header', SwStartNodeType.SwHeaderStartNode, 'Header', 'default', 'default'], ['footer', SwStartNodeType.SwFooterStartNode, 'Footer', 'default', 'default'],
      ['header', SwStartNodeType.SwHeaderStartNode, 'Header', 'first', 'first'], ['footer', SwStartNodeType.SwFooterStartNode, 'Footer', 'first', 'first'],
      ['header', SwStartNodeType.SwHeaderStartNode, 'Header', 'even', 'left'], ['footer', SwStartNodeType.SwFooterStartNode, 'Footer', 'even', 'left'],
    ] as const) {
      if ((kind === 'first' && !titlePg) || (kind === 'left' && !evenAndOdd)) continue;
      const target = refs.get(`${part}/${wordType}`);
      const partXml = target ? xml(target) : undefined;
      const root = partXml && childElements(partXml)[0];
      if (!root) continue;
      // A first page variant without a default header still needs the header on.
      if (kind !== 'default' && !nodes.FindAreaSection(eTyp, 'default', pd.m_aName)) nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!, 'default', pd.m_aName);
      const sec = nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!, kind, pd.m_aName);
      const placeholder = nodes.GoNext(sec.GetIndex())!;
      const saved = sectionEnd;
      sectionEnd = sec.EndOfSectionNode();
      readBlocks(root, rels(target!));
      sectionEnd = saved;
      if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
      const isHeader = eTyp === SwStartNodeType.SwHeaderStartNode;
      // The margins change once per header or footer, whichever of its variants comes first.
      if (marginsDone.has(eTyp)) continue;
      marginsDone.add(eTyp);
      const dist = (isHeader ? g.hd : g.fd) ?? 720;
      // SectionPropertyMap::PrepareHeaderFooterProperties: dynamic height and dynamic spacing.
      if (isHeader) { pd.nHeaderMinHeight = Math.max(0, pd.nTop - dist); pd.nHeaderSpacing = 0; pd.nTop = dist; pd.bHeaderEatSpacing = true; }
      else { pd.nFooterMinHeight = Math.max(0, pd.nBottom - dist); pd.nFooterSpacing = 0; pd.nBottom = dist; pd.bFooterEatSpacing = true; }
    }
  };
  /** The first top-level paragraph after a node, where the next section starts. */
  const firstAfter = (n: SwTextNode | null): SwTextNode | null => {
    for (let i = n ? n.GetIndex() + 1 : nodes.BodyStart(); i < nodes.GetEndOfContent().GetIndex(); i++) {
      const k = nodes.node(i);
      if (k.IsTextNode() && k.m_pStartOfSection === nodes.m_pStartOfContent) return k;
    }
    return null;
  };
  let refs: HdrRefs = new Map();
  let prevGeo = '';
  let converted = 0;
  sects.forEach((sect, k) => {
    const sp = sect.sectPr;
    refs = refsOf(sp, refs);
    const g = geometry(sp);
    const geoKey = JSON.stringify({ ...g, cols: undefined, refs: [...refs] });
    const type = val(child(sp, 'w:type')) ?? 'nextPage';
    const start = k === 0 ? firstAfter(null) : firstAfter(sects[k - 1]!.last);
    if (!start) return;
    const pgNum = int(W(child(sp, 'w:pgNumType'), 'start')) ?? null;
    if (k === 0) {
      makeDesc(doc.m_aPageDesc, sp, refs);
      if (pgNum !== null) start.m_aSet.RES_PAGEDESC = { name: DEFAULT_PAGE_DESC, numOffset: pgNum };
    } else if (type === 'continuous' && geoKey === prevGeo && pgNum === null) {
      // The page goes on; own columns make a Writer section of the section's blocks.
      if (g.cols) {
        const last = sect.last;
        let lastBlock: SwNode = last;
        while (lastBlock.m_pStartOfSection !== nodes.m_pStartOfContent && lastBlock.m_pStartOfSection) lastBlock = lastBlock.m_pStartOfSection;
        const from = start.GetIndex(), to = lastBlock.IsStartNode() ? (lastBlock as SwStartNode).EndOfSectionNode().GetIndex() : lastBlock.GetIndex();
        if (to >= from) {
          const sec = new SwSectionNode(nodes, { m_sSectionName: `Section${k}`, m_bHidden: false, m_bProtectFlag: false, m_aCol: { ...g.cols, m_bBalanced: true } });
          sec.m_pStartOfSection = nodes.m_pStartOfContent;
          for (let i = from; i <= to; i++) { const x = nodes.node(i); if (x.m_pStartOfSection === nodes.m_pStartOfContent) x.m_pStartOfSection = sec; }
          nodes.Insert(sec, from);
          nodes.Insert(new SwEndNode(nodes, sec), to + 2);
        }
      }
      return;
    } else {
      const name = `Converted${++converted}`;
      const pd = doc.MakePageDesc(name, new SwPageDesc());
      makeDesc(pd, sp, refs);
      start.m_aSet.RES_PAGEDESC = { name, numOffset: pgNum };
    }
    prevGeo = geoKey;
  });

  if (nodes.node(nodes.GetEndOfContent().GetIndex() - 1).IsEndNode()) nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), standard);
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}

function findDeep(e: XmlElement, name: string): XmlElement | undefined {
  for (const c of childElements(e)) {
    if (c.name === name) return c;
    const f = findDeep(c, name);
    if (f) return f;
  }
  return undefined;
}
