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
// @upstream oox/source/drawingml/shape.cxx reduced
// Upstream tokenises OOXML into sprms that DomainMapper turns into UNO API calls. This reads the
// WordprocessingML elements directly into the document model, with the same conversions:
// half-points, twips, EMU, lvlText list formats, gridSpan and vMerge, the default header and
// footer of the last section. Content the model cannot hold is reported in `lost`.
import { RefFieldFormat, ReferencesSubtype } from '../../core/fields/reffld.ts';
import { SwPosition } from '../../../inc/pam.ts';
import { MarkType } from '../../core/doc/docbm.ts';
import { ImportGradFill } from '../../../../oox/source/drawingml/fillproperties.ts';
import { ImportCustGeom } from '../../../../oox/source/drawingml/customshapegeometry.ts';
import { readZip } from '../../../../package/source/zipapi/zip.ts';
import { RecodeBullet } from '../../../../unotools/source/misc/fontcvt.ts';
import { GetColor, ReadThemeColors } from '../../../../oox/source/drawingml/color.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { child, childElements, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { GraphicDrawMode } from '../../../../drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import { NormalizeGrfAttr, type SwGrfAttr } from '../../../inc/hintids.ts';
import { ReadAppProperties, ReadCoreProperties } from '../../../../oox/source/docprop/docprophandler.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { SwEndNode, SwSectionNode, SwStartNode, SwTableNode, type SwNode } from '../../../inc/node.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { CH_TXTATR_BREAKWORD, ODF_FORMCHECKBOX, ODF_FORMCHECKBOX_RESULT, ODF_FORMDROPDOWN, ODF_FORMDROPDOWN_LISTENTRY, ODF_FORMDROPDOWN_RESULT, ODF_FORMTEXT, POOL_DEFAULTS, type SvxLRSpace, type SvxULSpace, type SwCropGrf, type SwRedlineData, type FontLineStyle, type SvxTabStop, type SwAttrSet, type SwCharAttrSet, type SwPostItField, type SwField } from '../../../inc/hintids.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SvxBorderLine, type SvxBoxItem, type SwTableAdjust } from '../../../inc/swtable.ts';
import type { SwTextFormatColl } from '../../../inc/format.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { ImportResult } from '../../filter/xml/odt.ts';
import { HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SdrShape, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { DEFAULT_PAGE_DESC, SwPageDesc } from '../../../inc/pagedesc.ts';
import { SmOoxmlImport } from '../../../../starmath/source/ooxmlimport.ts';
import type { SwFormatCol } from '../../../inc/fmtclds.ts';

const W = (e: XmlElement | undefined, k: string): string | undefined => e?.attrs.get(`w:${k}`);
const val = (e: XmlElement | undefined): string | undefined => W(e, 'val');
const kids = (e: XmlElement | undefined, name: string): XmlElement[] => (e ? childElements(e).filter((c) => c.name === name) : []);
const int = (s: string | undefined): number | undefined => (s === undefined || s === '' ? undefined : Math.round(parseFloat(s)));
/** ST_OnOff: present means on, unless val says otherwise. */
/**
 * DomainMapper_Impl::CloseFieldCommand for the fields ported: PAGE, NUMPAGES, SEQ as a number
 * range (SetExpression with its numbering switch), and REF and PAGEREF as references to a bookmark
 * (GetReference with \p above/below, \r, \n and \w the paragraph number), except in an index
 * (`bInIndex`), whose page numbers stay text.
 */
export function SimpleField(instr: string, bInIndex = false): SwField | null {
  const ref = bInIndex ? null : /^(PAGEREF|REF)\s+("[^"]+"|[^\s\\]+)(.*)$/.exec(instr);
  if (ref) {
    const sw = ref[3]!;
    const format = ref[1] === 'PAGEREF' ? RefFieldFormat.Page : /\\p\b/.test(sw) ? RefFieldFormat.UpDown : /\\r\b/.test(sw) ? RefFieldFormat.Number
      : /\\n\b/.test(sw) ? RefFieldFormat.NumberNoContext : /\\w\b/.test(sw) ? RefFieldFormat.NumberFullContext : RefFieldFormat.Content;
    return { type: 'GetRef', subType: ReferencesSubtype.Bookmark, format, name: ref[2]!.replace(/^"|"$/g, '') };
  }
  if (/^PAGE\b/.test(instr)) return { type: 'PageNumber' };
  if (/^NUMPAGES\b/.test(instr)) return { type: 'PageCount' };
  const seq = /^SEQ\s+("[^"]+"|\S+)(.*)$/.exec(instr);
  if (seq && !/\\[crs]\b/.test(seq[2]!)) {
    const f: SwField = { type: 'Sequence', name: seq[1]!.replace(/^"|"$/g, '') };
    const sw = /\\\*\s*(\w+)/.exec(seq[2]!)?.[1];
    const t = sw === 'ROMAN' ? NumberingType.ROMAN_UPPER : sw === 'roman' ? NumberingType.ROMAN_LOWER : sw === 'ALPHABETIC' ? NumberingType.CHARS_UPPER_LETTER : sw === 'alphabetic' ? NumberingType.CHARS_LOWER_LETTER : undefined;
    if (t !== undefined) f.numType = t;
    return f;
  }
  return null;
}
const onOff = (e: XmlElement | undefined): boolean | undefined => (e ? !['0', 'false', 'off'].includes(val(e) ?? 'true') : undefined);
/** EMU to twips: 914400 EMU per inch, 1440 twips per inch. */
const emuToTwips = (emu: number): number => Math.round(emu / 635);
/** The graphic formats of media parts, by file extension (WMF and EMF are drawn by emfio). */
const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', wmf: 'image/x-wmf', emf: 'image/x-emf' };

// ConversionHelper::ConvertNumberingType
const NUM_FMT: Record<string, NumberingType> = {
  decimal: NumberingType.ARABIC, upperRoman: NumberingType.ROMAN_UPPER, lowerRoman: NumberingType.ROMAN_LOWER,
  ordinal: NumberingType.TEXT_NUMBER, bullet: NumberingType.CHAR_SPECIAL, none: NumberingType.NUMBER_NONE,
  upperLetter: NumberingType.CHARS_UPPER_LETTER_N, lowerLetter: NumberingType.CHARS_LOWER_LETTER_N,
  iroha: NumberingType.IROHA_HALFWIDTH_JA, irohaFullWidth: NumberingType.IROHA_FULLWIDTH_JA,
  aiueo: NumberingType.AIU_HALFWIDTH_JA, aiueoFullWidth: NumberingType.AIU_FULLWIDTH_JA,
  hebrew2: NumberingType.CHARS_HEBREW, thaiLetters: NumberingType.CHARS_THAI,
  russianLower: NumberingType.CHARS_CYRILLIC_LOWER_LETTER_RU, russianUpper: NumberingType.CHARS_CYRILLIC_UPPER_LETTER_RU,
  decimalEnclosedCircleChinese: NumberingType.CIRCLE_NUMBER, decimalEnclosedCircle: NumberingType.CIRCLE_NUMBER,
  ideographEnclosedCircle: NumberingType.CIRCLE_NUMBER,
  ideographTraditional: NumberingType.TIAN_GAN_ZH, ideographZodiac: NumberingType.DI_ZI_ZH,
  ganada: NumberingType.HANGUL_SYLLABLE_KO, chosung: NumberingType.HANGUL_JAMO_KO,
  koreanLegal: NumberingType.NUMBER_LEGAL_KO, koreanDigital: NumberingType.NUMBER_DIGITAL_KO,
  koreanCounting: NumberingType.NUMBER_HANGUL_KO, koreanDigital2: NumberingType.NUMBER_DIGITAL2_KO,
  ideographLegalTraditional: NumberingType.NUMBER_UPPER_ZH_TW,
  arabicAlpha: NumberingType.CHARS_ARABIC, arabicAbjad: NumberingType.CHARS_ARABIC_ABJAD, hindiVowels: NumberingType.CHARS_NEPALI,
  japaneseLegal: NumberingType.NUMBER_TRADITIONAL_JA,
  chineseCounting: NumberingType.NUMBER_LOWER_ZH, japaneseCounting: NumberingType.NUMBER_LOWER_ZH,
  taiwaneseCounting: NumberingType.NUMBER_LOWER_ZH, taiwaneseCountingThousand: NumberingType.NUMBER_LOWER_ZH,
  ideographDigital: NumberingType.NUMBER_LOWER_ZH, chineseCountingThousand: NumberingType.NUMBER_LOWER_ZH,
  chineseLegalSimplified: NumberingType.NUMBER_UPPER_ZH, hebrew1: NumberingType.NUMBER_HEBREW,
  decimalFullWidth: NumberingType.FULLWIDTH_ARABIC, decimalFullWidth2: NumberingType.FULLWIDTH_ARABIC,
  cardinalText: NumberingType.TEXT_CARDINAL, ordinalText: NumberingType.TEXT_ORDINAL,
  chicago: NumberingType.SYMBOL_CHICAGO, decimalZero: NumberingType.ARABIC_ZERO,
};
// ConversionHelper::ConvertCustomNumberFormat
const ConvertCustomNumberFormat = (rFormat: string): NumberingType | undefined =>
  rFormat === '001, 002, 003, ...' ? NumberingType.ARABIC_ZERO3 : rFormat === '0001, 0002, 0003, ...' ? NumberingType.ARABIC_ZERO4
    : rFormat === '00001, 00002, 00003, ...' ? NumberingType.ARABIC_ZERO5 : undefined;


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

/**
 * oox BlipContext and GraphicProperties::pushToPropMap: a:grayscl and a:biLevel as the image mode,
 * a:lum as brightness and contrast (MSO's washout, 70 and -70, as Watermark), a:alphaModFix as the
 * transparency. Upstream bakes a biLevel threshold other than 50% and brightness together with
 * contrast into the image (with Word's formula); here the threshold is taken as 50% and both are
 * kept, so they round-trip but show with LibreOffice's formula.
 */
function ReadBlipEffects(blip: XmlElement, lost: Set<string>): SwGrfAttr | undefined {
  const a: SwGrfAttr = {};
  const per = (v: string | undefined) => Math.max(-100, Math.min(100, Math.trunc((parseInt(v ?? '0', 10) || 0) / 1000)));
  for (const e of childElements(blip)) {
    if (e.name === 'a:grayscl') a.m_eDrawMode = GraphicDrawMode.Greys;
    else if (e.name === 'a:biLevel') {
      a.m_eDrawMode = GraphicDrawMode.Mono;
      if ((e.attrs.get('thresh') ?? '50000') !== '50000') lost.add('black and white images with a threshold other than 50% (shown at 50%)');
    } else if (e.name === 'a:lum') { a.m_nLuminance = per(e.attrs.get('bright')); a.m_nContrast = per(e.attrs.get('contrast')); }
    else if (e.name === 'a:alphaModFix') a.m_nTransparency = Math.max(0, Math.min(100, 100 - Math.round((parseInt(e.attrs.get('amt') ?? '100000', 10) || 0) / 1000)));
  }
  // map MSO 'washout' to our Watermark colormode
  if (!a.m_eDrawMode && a.m_nLuminance === 70 && a.m_nContrast === -70) { a.m_eDrawMode = GraphicDrawMode.Watermark; a.m_nLuminance = 0; a.m_nContrast = 0; }
  return NormalizeGrfAttr(a);
}

/** bRepairPackage: the MediaDescriptor's RepairPackage, which reads a broken package's entries from their local headers. */
export async function ImportDOCX(bytes: Uint8Array, bRepairPackage = false): Promise<ImportResult> {
  // An encrypted document is an OLE compound file, not a zip.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('This Word document is password-protected. Encrypted documents cannot be opened yet.');
  const files = await readZip(bytes, bRepairPackage);
  const text = (path: string) => { const b = files.get(path); return b ? new TextDecoder().decode(b) : undefined; };
  const xml = (path: string) => { const t = text(path); return t ? parseXml(t) : undefined; };
  // SettingsTable: the Word version the document was made for (-1 for none given), and whether the
  // table style gives way to the default style's font size and left alignment.
  const compatSetting = (name: string) => kids(child(child(xml('word/settings.xml'), 'w:settings'), 'w:compat'), 'w:compatSetting').find((e) => W(e, 'name') === name)?.attrs.get('w:val');
  const nWordCompatibilityMode = int(compatSetting('compatibilityMode')) ?? -1;
  const bOverrideTableStyleFontSizeAndJustification = ['1', 'true'].includes(compatSetting('overrideTableStyleFontSizeAndJustification') ?? '');
  let nTableDepth = 0;
  // The main part is the package's officeDocument relationship, usually word/document.xml.
  const pkgRoot = xml('_rels/.rels');
  const mainRel = pkgRoot && childElements(childElements(pkgRoot)[0] ?? pkgRoot).find((e) => /officeDocument$/.test(e.attrs.get('Type') ?? ''));
  const mainPart = mainRel?.attrs.get('Target')?.replace(/^\//, '') ?? 'word/document.xml';
  const documentXml = xml(mainPart) ?? xml('word/document.xml');
  if (!documentXml) throw new Error('This file has no word/document.xml, so it is not a Word document.');
  const doc = new SwDoc();
  const lost = new Set<string>();
  const nodes = doc.GetNodes();
  // OOXMLDocumentPropertiesImporter: the package's core and extended properties.
  const pkgRels = pkgRoot ? childElements(childElements(pkgRoot)[0] ?? pkgRoot) : [];
  const propsPart = (type: RegExp) => { const t = pkgRels.find((e) => type.test(e.attrs.get('Type') ?? ''))?.attrs.get('Target'); return t ? xml(t.replace(/^\//, '')) : undefined; };
  const core = propsPart(/\/metadata\/core-properties$/), app = propsPart(/\/extended-properties$/);
  if (core) ReadCoreProperties(doc.m_xDocProps, childElements(core)[0] ?? core);
  if (app) ReadAppProperties(doc.m_xDocProps, childElements(app)[0] ?? app);

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
    // LN_EG_RPrBase_bdr: the character border (one line for every side).
    const bdr = child(rPr, 'w:bdr');
    if (bdr) {
      const v = val(bdr), c = W(bdr, 'color');
      out.RES_CHRATR_BOX = !v || v === 'nil' || v === 'none' ? null : { color: c && c !== 'auto' ? `#${c.toLowerCase()}` : '#000000', width: Math.max(1, Math.round(((int(W(bdr, 'sz')) ?? 4) * 20) / 8)) };
    }
    const va = val(child(rPr, 'w:vertAlign'));
    if (va) out.RES_CHRATR_ESCAPEMENT = va === 'superscript' ? 33 : va === 'subscript' ? -33 : 0;
    const caps = onOff(child(rPr, 'w:caps'));
    if (caps !== undefined) out.RES_CHRATR_CASEMAP = caps ? 'uppercase' : 'none';
    // NS_ooxml::LN_EG_RPrBase_smallCaps: SvxCaseMap::SmallCaps.
    const smallCaps = onOff(child(rPr, 'w:smallCaps'));
    if (smallCaps) out.RES_CHRATR_CASEMAP = 'smallcaps';
    else if (smallCaps === false && caps === undefined) out.RES_CHRATR_CASEMAP = 'none';
    const shadow = onOff(child(rPr, 'w:shadow')); if (shadow !== undefined) out.RES_CHRATR_SHADOWED = shadow;
    const outline = onOff(child(rPr, 'w:outline')); if (outline !== undefined) out.RES_CHRATR_CONTOUR = outline;
    // w:lang: the text language (Western script).
    const lang = W(child(rPr, 'w:lang'), 'val');
    if (lang) out.RES_CHRATR_LANGUAGE = lang;
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
  // StyleSheetTable::applyDefaults: w:docDefaults are the defaults every style inherits from, also
  // the styles that are not based on Normal.
  // StyleSheetTable::StyleSheetTable: set font height default to 10pt (Word's), before w:docDefaults.
  doc.m_aDefaults.RES_CHRATR_FONTSIZE = 200;
  Object.assign(doc.m_aDefaults, runProps(child(child(defaults, 'w:rPrDefault'), 'w:rPr')), paraProps(child(child(defaults, 'w:pPrDefault'), 'w:pPr')));
  const fromDefaults = <K extends keyof SwAttrSet>(c: SwTextFormatColl | null, k: K) => (c ? c.GetFormatAttr(k) : (doc.m_aDefaults[k] ?? standard.GetFormatAttr(k)));
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
    // An imported style without basedOn has no inheritance (but the defaults).
    const parent = isDefault || !parentId ? null : resolveColl(parentId);
    const set = { ...paraProps(child(el, 'w:pPr'), fromDefaults(parent, 'RES_UL_SPACE'), fromDefaults(parent, 'RES_LR_SPACE')), ...runProps(child(el, 'w:rPr')) };
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
  const tableStyle = (id: string | undefined): { tblPr?: XmlElement; tcPr?: XmlElement; pPr?: XmlElement; rPr?: XmlElement; cond: XmlElement[] }[] => {
    const el = id ? styleEls.get(`table/${id}`) : undefined;
    if (!el) return [];
    return [...tableStyle(val(child(el, 'w:basedOn'))), { tblPr: child(el, 'w:tblPr'), tcPr: child(el, 'w:tcPr'), pPr: child(el, 'w:pPr'), rPr: child(el, 'w:rPr'), cond: kids(el, 'w:tblStylePr') }];
  };
  /** The paragraph style a paragraph has (its w:pStyle, else the default one) and its parents. */
  const defaultParaStyleId = [...styleEls].find(([k, e]) => k.startsWith('paragraph/') && ['1', 'true', 'on'].includes(W(e, 'default') ?? ''))?.[0].slice(10);
  const paraStyleChain = (id: string | undefined): XmlElement[] => {
    const out: XmlElement[] = [];
    for (let el = styleEls.get(`paragraph/${id ?? defaultParaStyleId}`); el && out.length < 50; el = styleEls.get(`paragraph/${val(child(el, 'w:basedOn'))}`)) out.push(el);
    return out;
  };
  /** The table style's paragraph and character properties of the cell being read, weakest first. */
  const cellStyleProps: { pPr: XmlElement[]; rPr: XmlElement[] }[] = [];
  /**
   * DomainMapperTableHandler::ApplyParagraphPropertiesFromTableStyle: each paragraph and character
   * property of the table style applies to a cell's paragraph unless the paragraph or its style sets
   * it (the document defaults do not count). As upstream's compatibility rule, the default style's
   * 11 or 12 pt and left alignment give way to the table style. Returns the paragraph's w:pPr with
   * those properties added, and the character properties to apply.
   */
  const ApplyParagraphPropertiesFromTableStyle = (pPr: XmlElement | undefined, styleId: string | undefined): { pPr: XmlElement | undefined; rPr: XmlElement | undefined } => {
    const ctx = cellStyleProps[cellStyleProps.length - 1];
    if (!ctx || (!ctx.pPr.length && !ctx.rPr.length)) return { pPr, rPr: undefined };
    const chain = paraStyleChain(styleId);
    const isDefault = (styleId ?? defaultParaStyleId) === defaultParaStyleId;
    const chainEl = (part: 'w:pPr' | 'w:rPr', name: string) => chain.map((st) => child(child(st, part), name)).find((x) => x);
    const compat = (part: 'w:pPr' | 'w:rPr', name: string, e: XmlElement | undefined) =>
      !bOverrideTableStyleFontSizeAndJustification && isDefault && e && ((part === 'w:rPr' && name === 'w:sz' && ['22', '24'].includes(val(e) ?? '')) || (part === 'w:pPr' && name === 'w:jc' && ['left', 'start'].includes(val(e) ?? '')));
    // The attributes of these elements are separate properties (top and bottom margin, line spacing, indents).
    const ATTR_WISE = new Set(['w:spacing', 'w:ind']);
    const merge = (part: 'w:pPr' | 'w:rPr', layers: XmlElement[], own: XmlElement | undefined): XmlElement | undefined => {
      const table = new Map<string, XmlElement>();
      for (const layer of layers) for (const e of childElements(layer)) {
        const prev = table.get(e.name);
        table.set(e.name, prev && ATTR_WISE.has(e.name) ? { ...e, attrs: new Map([...prev.attrs, ...e.attrs]) } : e);
      }
      if (!table.size) return own;
      const out: XmlElement = { name: part, attrs: new Map(own?.attrs ?? []), children: [...(own?.children ?? [])] };
      for (const [name, e] of table) {
        const direct = child(own, name), inStyle = chainEl(part, name);
        if (ATTR_WISE.has(name)) {
          const attrs = new Map<string, string>();
          for (const [k, v] of e.attrs) {
            const keys = k === 'w:line' || k === 'w:lineRule' ? ['w:line'] : [k];
            if (keys.some((kk) => direct?.attrs.has(kk) || chain.some((st) => child(child(st, part), name)?.attrs.has(kk)))) continue;
            attrs.set(k, v);
          }
          if (!attrs.size) continue;
          const merged: XmlElement = { name, attrs: new Map([...attrs, ...(direct?.attrs ?? [])]), children: [] };
          out.children = out.children.filter((c) => typeof c === 'string' || c.name !== name);
          out.children.push(merged);
        } else if (part === 'w:rPr' ? !inStyle || compat(part, name, inStyle) : !direct && (!inStyle || compat(part, name, inStyle))) {
          if (part === 'w:pPr') out.children.push(e);
          else out.children.push(e);
        }
      }
      return out;
    };
    const rPr = merge('w:rPr', ctx.rPr, undefined);
    return { pPr: merge('w:pPr', ctx.pPr, pPr), rPr };
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
      // w14's custom formats come in mc:AlternateContent, with a decimal fallback.
      const numFmt = child(src, 'w:numFmt') ?? child(child(child(src, 'mc:AlternateContent'), 'mc:Choice'), 'w:numFmt');
      const fmt = val(numFmt) ?? 'decimal';
      const custom = fmt === 'custom' ? ConvertCustomNumberFormat(W(numFmt!, 'format') ?? '') : undefined;
      f.SetNumberingType(custom ?? NUM_FMT[fmt] ?? NumberingType.ARABIC);
      if (custom === undefined && !(fmt in NUM_FMT)) lost.add(`list numbering of type "${fmt}" (shown as 1, 2, 3)`);
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
  interface FieldState { instr: string; inResult: boolean; replaced: boolean; savedLink: string | null; toc?: boolean; ffData?: XmlElement; fieldmark?: SwField }
  /**
   * FFDataHandler and FormControlHelper::processField: a legacy form field (w:ffData) as a
   * fieldmark with its parameters; a text form field's result becomes its content.
   */
  const formField = (instr: string, ff: XmlElement | undefined): SwField | null => {
    const kind = /^(FORMTEXT|FORMCHECKBOX|FORMDROPDOWN)\b/.exec(instr)?.[1];
    if (!kind) return null;
    const params: NonNullable<SwField['params']> = {};
    const v = (name: string, e: XmlElement | undefined = ff) => val(child(e, name));
    if (v('w:entryMacro')) params.EntryMacro = v('w:entryMacro')!;
    if (v('w:exitMacro')) params.ExitMacro = v('w:exitMacro')!;
    if (v('w:helpText')) params.Help = v('w:helpText')!;
    if (v('w:statusText')) params.Hint = v('w:statusText')!;
    const f: SwField = { type: 'Fieldmark', name: v('w:name') ?? '', params };
    if (kind === 'FORMTEXT') {
      const ti = child(ff, 'w:textInput');
      f.fieldType = ODF_FORMTEXT;
      f.content = '';
      if (v('w:type', ti)) params.Type = v('w:type', ti)!;
      const nMaxLength = int(v('w:maxLength', ti)) ?? 0;
      if (nMaxLength) params.MaxLength = nMaxLength;
      if (v('w:default', ti)) params.Content = v('w:default', ti)!;
      if (v('w:format', ti)) params.Format = v('w:format', ti)!;
    } else if (kind === 'FORMCHECKBOX') {
      const cb = child(ff, 'w:checkBox');
      f.fieldType = ODF_FORMCHECKBOX;
      // FFDataHandler::getCheckboxChecked: w:checked, else w:default.
      const checked = child(cb, 'w:checked'), dflt = child(cb, 'w:default');
      params[ODF_FORMCHECKBOX_RESULT] = checked ? onOff(checked)! : dflt ? onOff(dflt)! : false;
    } else {
      const dd = child(ff, 'w:ddList');
      f.fieldType = ODF_FORMDROPDOWN;
      const rEntries = kids(dd, 'w:listEntry').map((e) => val(e) ?? '');
      if (rEntries.length) {
        params[ODF_FORMDROPDOWN_LISTENTRY] = rEntries;
        const nResult = int(v('w:result', dd)) ?? 0;
        if (nResult >= 0 && nResult < rEntries.length) params[ODF_FORMDROPDOWN_RESULT] = nResult;
      }
    }
    return f;
  };
  /** The index whose result paragraphs are being read (DomainMapper_Impl::IsInTOC). */
  let tocId: string | null = null;
  interface RunContext { link: string | null; partRels: Map<string, Rel>; fields: FieldState[]; openComments: Map<string, { node: SwTextNode; start: number; id: string }>; redline?: SwRedlineData | null }
  /** w:ins and w:del (CT_TrackChange): author and date. */
  const redlineOf = (e: XmlElement, type: SwRedlineData['type']): SwRedlineData => ({ type, author: W(e, 'author') || 'Unknown Author', date: W(e, 'date') ?? '' });

  const readRun = (r: XmlElement, node: SwTextNode, base: SwCharAttrSet, ctx: RunContext) => {
    const rPr = child(r, 'w:rPr');
    // DomainMapper::sprmWithProps (LN_EG_RPrBase_rStyle): no character style in an index, whose
    // links take "Index Link" (DomainMapper_Impl::PopFieldContext).
    const attrs: SwCharAttrSet = { ...base, ...(tocId ? {} : charStyle(val(child(rPr, 'w:rStyle')))), ...runProps(rPr), ...(ctx.redline ? { RES_TXTATR_REDLINE: ctx.redline } : {}) };
    for (const c of childElements(r)) {
      if (ctx.link) attrs.RES_TXTATR_INETFMT = ctx.link; else delete attrs.RES_TXTATR_INETFMT;
      if (ctx.link && tocId) attrs.RES_TXTATR_INETFMT_CHARFMT = doc.GetIndexLinkFormat(); else delete attrs.RES_TXTATR_INETFMT_CHARFMT;
      // Complex fields: begin, instruction, separate, result, end. PAGE and NUMPAGES become fields,
      // HYPERLINK a link; other fields keep their last result as text.
      const field = ctx.fields[ctx.fields.length - 1];
      if (c.name === 'w:fldChar') {
        const t = W(c, 'fldCharType');
        if (t === 'begin') ctx.fields.push({ instr: '', inResult: false, replaced: false, savedLink: ctx.link, ffData: child(c, 'w:ffData') });
        else if (t === 'separate' && field) {
          field.inResult = true;
          const instr = field.instr.trim();
          const fld = SimpleField(instr, !!tocId);
          const fm = formField(instr, field.ffData);
          if (fm) { field.fieldmark = fm; field.replaced = true; continue; }
          const href = /^HYPERLINK\s+"([^"]*)"/.exec(instr);
          const toc = /^TOC\b/.exec(instr);
          if (fld) { append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FIELD: fld }); field.replaced = true; }
          else if (href) ctx.link = href[1]!;
          else if (toc && !tocId) {
            // DomainMapper_Impl::handleToc: the field's result paragraphs are the index (its
            // section), whose outline levels \o names.
            tocId = doc.NewTocId();
            const levels = /\\o\s+"(\d+)-(\d+)"/.exec(instr);
            doc.m_aTocSettings.set(tocId, { title: '', levels: levels ? parseInt(levels[2]!, 10) : 3 });
            node.m_aSet.RES_PARATR_TOX_ID = tocId;
            field.toc = true;
          }
          // An index's page numbers are its text (upstream too keeps PAGEREF in an index as text).
          else if (instr && !(tocId && /^PAGEREF\b/.test(instr))) lost.add('fields (their current value is kept as text)');
        } else if (t === 'end' && field) {
          // A form field (a check box has no result) is its fieldmark's placeholder.
          const fm = field.fieldmark ?? (field.inResult ? null : formField(field.instr.trim(), field.ffData));
          if (fm) append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FIELD: fm });
          ctx.link = field.savedLink; ctx.fields.pop();
          if (field.toc) tocId = null;
        } else if (t === 'end' && tocId) {
          // The end of the index, in a later paragraph than its start; an otherwise empty last
          // paragraph is not part of it.
          if (node.Len() === 0) delete node.m_aSet.RES_PARATR_TOX_ID;
          tocId = null;
        }
        continue;
      }
      if (c.name === 'w:instrText') { if (field && !field.inResult) field.instr += textOf(c); continue; }
      // A field's instruction is never shown, nor a result that became a field of its own.
      if (field && (!field.inResult || field.replaced)) {
        if (field.fieldmark?.fieldType === ODF_FORMTEXT && field.inResult) field.fieldmark.content += c.name === 'w:t' ? textOf(c) : c.name === 'w:tab' ? '\t' : '';
        continue;
      }
      switch (c.name) {
        case 'w:t': case 'w:delText': if (textOf(c)) takeDeferredBreak(node); append(node, textOf(c), attrs); break;
        case 'w:delInstrText': break;
        case 'w:tab': takeDeferredBreak(node); append(node, '\t', attrs); break;
        case 'w:br':
          // DomainMapper::lcl_utext: page and column breaks are deferred. Text after one in its
          // paragraph splits the paragraph there (m_bIsSplitPara), the rest breaking before; text
          // first in a paragraph breaks before it; a paragraph that ends first passes the break to
          // the next one (lcl_startParagraphGroup), whose upper spacing becomes 0. Not ported: the
          // split at the paragraph mark with w:splitPgBreakAndParaMark.
          if (W(c, 'type') === 'page') pendingBreak = 'page-before';
          else if (W(c, 'type') === 'column') pendingBreak = 'column-before';
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
          const pict = findDeep(c, 'w:pict');
          if (drawing) readDrawing(drawing, node, attrs, ctx.partRels);
          else if (!pict || !readPict(pict, node, attrs, ctx.partRels)) lost.add('shapes and text boxes');
          break;
        }
        case 'w:pict': if (!readPict(c, node, attrs, ctx.partRels)) lost.add('shapes, text boxes and embedded objects'); break;
        // An embedded object shows its preview picture (v:imagedata, often WMF or EMF); the object itself is not ported.
        case 'w:object':
          if (readPict(c, node, attrs, ctx.partRels)) lost.add('embedded objects (their preview picture is kept)');
          else lost.add('shapes, text boxes and embedded objects');
          break;
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
  const appendStarMath = (node: SwTextNode, oMath: XmlElement) => {
    const m_sText = new SmOoxmlImport(oMath).ConvertToStarMath();
    append(node, CH_TXTATR_BREAKWORD, { RES_TXTATR_FLYCNT: { graphic: '', width: 0, height: 0, name: uniqueName(undefined, 'Object'), math: { m_sText, m_bBaseline: true } } });
  };
  const uniqueName = (want: string | undefined, prefix: string): string => {
    let name = want ?? '';
    if (!name || usedNames.has(name)) { let k = 1; while (usedNames.has(`${prefix}${k}`)) k++; name = `${prefix}${k}`; }
    usedNames.add(name);
    return name;
  };
  // oox Color::getColor: any colour of a fill, theme colours (bg1, tx1, accent1 …) through the theme.
  const colorOf = (fill: XmlElement | undefined): string | null => GetColor(fill, themeColors)?.toLowerCase() ?? null;

  /**
   * oox Shape::createAndInsert for the children of a group (reduced: this model has no group
   * object, so each child becomes a frame of its own). A child's a:xfrm is in the group's child
   * coordinates: translated by -chOff and scaled by the group's size over chExt, then placed in the
   * group's frame. Each child goes through readDrawing as a wp:anchor of its own, with the group's
   * anchor, wrap and distances; nested groups recurse that way. Rotated and flipped groups, and
   * groups positioned by alignment rather than offsets, are left to the caller.
   */
  const readGroup = (holder: XmlElement, wgp: XmlElement, node: SwTextNode, attrs: SwCharAttrSet, partRels: Map<string, Rel>): boolean => {
    const ext = child(holder, 'wp:extent');
    const offOf = (pos: XmlElement | undefined) => { const o = pos && child(pos, 'wp:posOffset'); return o ? parseInt(textOf(o), 10) || 0 : undefined; };
    const x0 = offOf(child(holder, 'wp:positionH')), y0 = offOf(child(holder, 'wp:positionV'));
    const gx = child(child(wgp, 'wpg:grpSpPr'), 'a:xfrm');
    if (!ext || x0 === undefined || y0 === undefined || !gx || int(gx.attrs.get('rot')) || gx.attrs.get('flipH') === '1' || gx.attrs.get('flipV') === '1') return false;
    const w = int(ext.attrs.get('cx')) ?? 0, h = int(ext.attrs.get('cy')) ?? 0;
    const chOff = child(gx, 'a:chOff'), chExt = child(gx, 'a:chExt');
    const cx0 = int(chOff?.attrs.get('x')) ?? 0, cy0 = int(chOff?.attrs.get('y')) ?? 0;
    // oox allows a zero or missing chExt: the factor is then 1.
    const cw = int(chExt?.attrs.get('cx')) || w, ch = int(chExt?.attrs.get('cy')) || h;
    const fx = cw ? w / cw : 1, fy = ch ? h / ch : 1;
    const el = (name: string, a: Record<string, string> = {}, children: (XmlElement | string)[] = []): XmlElement => ({ name, attrs: new Map(Object.entries(a)), children });
    const URI: Record<string, string> = {
      'pic:pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
      'wps:wsp': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
      'wpg:grpSp': 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
    };
    for (const c of childElements(wgp)) {
      if (!URI[c.name]) continue;
      const xf = c.name === 'pic:pic' ? child(child(c, 'pic:spPr'), 'a:xfrm') : c.name === 'wps:wsp' ? child(child(c, 'wps:spPr'), 'a:xfrm') : child(child(c, 'wpg:grpSpPr'), 'a:xfrm');
      const off = child(xf, 'a:off'), cext = child(xf, 'a:ext');
      if (!off || !cext) continue;
      const x = Math.round(x0 + ((int(off.attrs.get('x')) ?? 0) - cx0) * fx), y = Math.round(y0 + ((int(off.attrs.get('y')) ?? 0) - cy0) * fy);
      const cxw = Math.round((int(cext.attrs.get('cx')) ?? 0) * fx), cyh = Math.round((int(cext.attrs.get('cy')) ?? 0) * fy);
      const name = (c.name === 'pic:pic' ? findDeep(c, 'pic:cNvPr') : c.name === 'wps:wsp' ? child(c, 'wps:cNvPr') : child(c, 'wpg:cNvPr'))?.attrs.get('name');
      // A nested group's element is wpg:grpSp; as the content of an anchor it is a wpg:wgp.
      const content = c.name === 'wpg:grpSp' ? { ...c, name: 'wpg:wgp' } : c;
      const pos = (tag: string, value: number) => {
        const p = child(holder, tag)!;
        return el(tag, Object.fromEntries(p.attrs), [el('wp:posOffset', {}, [String(value)])]);
      };
      const part = el('wp:anchor', Object.fromEntries(holder.attrs), [
        ...childElements(holder).flatMap((k): XmlElement[] => {
          switch (k.name) {
            case 'wp:positionH': return [pos('wp:positionH', x)];
            case 'wp:positionV': return [pos('wp:positionV', y)];
            case 'wp:extent': return [el('wp:extent', { cx: String(cxw), cy: String(cyh) })];
            case 'wp:docPr': return [el('wp:docPr', { ...Object.fromEntries(k.attrs), ...(name ? { name } : {}) })];
            case 'a:graphic': return [el('a:graphic', {}, [el('a:graphicData', { uri: URI[c.name]! }, [content])])];
            default: return [k];
          }
        }),
      ]);
      readDrawing(el('w:drawing', {}, [part]), node, attrs, partRels);
    }
    return true;
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
    const title = docPr?.attrs.get('title') || undefined;
    const blip = findDeep(holder, 'a:blip');
    const txbx = findDeep(holder, 'w:txbxContent');
    // A wps:wsp that is not a plain rectangular text box is a drawing shape.
    const wsp = findDeep(holder, 'wps:wsp');
    const prst = wsp && findDeep(wsp, 'a:prstGeom')?.attrs.get('prst');
    // An anchored group (wpg:wgp) is split into its pictures, text boxes and shapes (and those of
    // its nested groups), each anchored on its own where the group places it.
    const wgp = findDeep(holder, 'wpg:wgp');
    if (wgp && holder.name === 'wp:anchor' && readGroup(holder, wgp, node, attrs, partRels)) return;
    // Inline and aligned groups are not ported: their first picture or text box is kept, as before.
    const group = !!wgp;
    if (group) lost.add('grouped shapes (only a picture or text box of the group is kept)');
    // A linked text box (wps:linkedTxbx) continues the text of the text box with its id.
    const linked = wsp ? findDeep(wsp, 'wps:linkedTxbx') : undefined;
    const isShape = !group && !!wsp && !blip && (!!findDeep(wsp, 'a:custGeom') || (prst !== undefined && prst !== 'rect') || (!txbx && !linked));
    let graphic: string | undefined;
    let crop: SwCropGrf | undefined;
    let grfRotation: number | undefined, grfMirror: 'vertical' | 'horizontal' | 'both' | undefined;
    let grfAttr: SwGrfAttr | undefined;
    if (blip) {
      const rel = partRels.get(blip.attrs.get('r:embed') ?? '');
      const data = rel && files.get(rel.target);
      const mime = rel && MIME_BY_EXT[rel.target.split('.').pop()!.toLowerCase()];
      if (!data) { lost.add('shapes and text boxes'); return; }
      if (!mime) { lost.add('images in formats a browser cannot show'); return; }
      graphic = doc.AddGraphic(data, mime);
      // GraphicImport: a:srcRect, in thousandths of a percent of the picture.
      const src = findDeep(holder, 'a:srcRect');
      const f = (k: string) => (int(src?.attrs.get(k)) ?? 0) / 100000;
      if (src && (f('l') || f('t') || f('r') || f('b'))) crop = { left: f('l'), top: f('t'), right: f('r'), bottom: f('b') };
      // GraphicImport: pic:spPr's a:xfrm rotation (clockwise, 60000ths of a degree) and flips.
      const xf = findDeep(findDeep(holder, 'pic:pic') ?? holder, 'a:xfrm');
      const r = int(xf?.attrs.get('rot'));
      if (r) grfRotation = ((3600 - Math.round(r / 6000)) % 3600 + 3600) % 3600 || undefined;
      const fh = xf?.attrs.get('flipH') === '1', fv = xf?.attrs.get('flipV') === '1';
      if (fh || fv) grfMirror = fh && fv ? 'both' : fh ? 'vertical' : 'horizontal';
      grfAttr = ReadBlipEffects(blip, lost);
    } else if (!txbx && !linked && !isShape) { lost.add('shapes (other than pictures and text boxes)'); return; }
    // A shape in the line without text is a shape anchored as character.
    if (holder.name === 'wp:inline' && isShape && !txbx) {
      append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FLYCNT: { graphic: '', width, height, name: uniqueName(docPr?.attrs.get('name'), 'Shape'), shape: readShape(wsp!) } });
      return;
    }
    if (holder.name === 'wp:inline' && graphic !== undefined) {
      append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FLYCNT: { graphic, width, height, name: uniqueName(docPr?.attrs.get('name'), 'Image'), ...(alt ? { alt } : {}), ...(title ? { title } : {}), ...(crop ? { crop } : {}), ...(grfRotation ? { rotation: grfRotation } : {}), ...(grfMirror ? { mirror: grfMirror } : {}), ...(grfAttr ? { m_aGrfAttr: grfAttr } : {}) } });
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
      ...(alt ? { alt } : {}), ...(title ? { m_sTitle: title } : {}),
    };
    if (graphic !== undefined) {
      fmt.graphic = graphic;
      // GraphicImport: wrapTight and wrapThrough wrap around a contour (outside only for tight),
      // their wp:wrapPolygon in 21600ths of the graphic (WrapPolygon::correctWordWrapPolygon).
      if (!inline && (wrapEl?.name === 'wp:wrapTight' || wrapEl?.name === 'wp:wrapThrough')) {
        fmt.m_aSurround = { ...fmt.m_aSurround, m_bContour: true, ...(wrapEl.name === 'wp:wrapTight' ? { m_bOutside: true } : {}) };
        const wp = child(wrapEl, 'wp:wrapPolygon');
        const pts = wp ? childElements(wp).filter((p) => p.name === 'wp:start' || p.name === 'wp:lineTo').map((p) => [int(p.attrs.get('x')) ?? 0, int(p.attrs.get('y')) ?? 0] as [number, number]) : [];
        if (pts.length > 2 && width > 0) {
          const nWrap100Percent = 21600, nMove = Math.round((nWrap100Percent * 15) / width);
          fmt.m_aContour = [pts.map(([x, y]) => [(x + nMove) / (nWrap100Percent + nMove), y / (nWrap100Percent - nMove)] as [number, number])];
        }
      }
      if (crop) fmt.crop = crop;
      if (grfRotation) fmt.m_nGrfRotation = grfRotation;
      if (grfMirror) fmt.m_eMirror = grfMirror;
      if (grfAttr) fmt.m_aGrfAttr = grfAttr;
    } else if (isShape) {
      fmt.m_pShape = readShape(wsp!);
      const bodyPr = findDeep(holder, 'wps:bodyPr');
      const anchorV = bodyPr?.attrs.get('anchor');
      // wps:bodyPr anchor: t (Word's default) and b; ctr is the model's default.
      if (anchorV !== 'ctr') fmt.m_pShape.m_eTextVertAdjust = anchorV === 'b' ? 'bottom' : 'top';
      // wps:bodyPr vert: vertical writing; a:spAutoFit: the shape grows with its text.
      const vert = bodyPr?.attrs.get('vert');
      if (vert === 'vert' || vert === 'eaVert') fmt.m_pShape.m_bVerticalWriting = true;
      if (bodyPr && child(bodyPr, 'a:spAutoFit')) { if (fmt.m_pShape.m_bVerticalWriting) fmt.m_bAutoWidth = true; else fmt.m_bAutoHeight = true; }
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
      // wps:bodyPr vert: the text box's frame direction (vert270 bottom to top, vert and eaVert top to bottom).
      const vert = bodyPr?.attrs.get('vert');
      if (vert === 'vert270') fmt.m_eFrameDir = 'bt-lr';
      else if (vert === 'vert' || vert === 'eaVert') fmt.m_eFrameDir = 'tb-rl';
      // The shape's outline is centred on its edge (the text box's shape draws it, the frame has
      // none): the frame grows by half the line on each side, so its border lies where the
      // outline does and the text starts half a line inside the shape.
      if (line) {
        const half = Math.round(lineW / 2);
        fmt.m_nWidth += 2 * half;
        fmt.m_nHeight += 2 * half;
        if (fmt.m_aHoriOrient.m_eOrient === HoriOrientation.NONE) fmt.m_aHoriOrient = { ...fmt.m_aHoriOrient, m_nPos: fmt.m_aHoriOrient.m_nPos - half };
        if (fmt.m_aVertOrient.m_eOrient === VertOrientation.NONE) fmt.m_aVertOrient = { ...fmt.m_aVertOrient, m_nPos: fmt.m_aVertOrient.m_nPos - half };
      }
      readFlyContent(fmt.m_aName, txbx ?? { name: 'w:txbxContent', attrs: new Map(), children: [{ name: 'w:p', attrs: new Map(), children: [] }] }, partRels);
      // DomainMapper_Impl::m_vTextFramesForChaining: the chain of a text box id, by sequence.
      const id = linked?.attrs.get('id') ?? findDeep(holder, 'wps:txbx')?.attrs.get('id');
      if (id !== undefined) linkedBoxes.push({ id, seq: linked ? int(linked.attrs.get('seq')) ?? 0 : -1, fmt });
    }
    node.m_aAnchoredFlys.push({ fmt, nContent: node.Len() });
  };

  /**
   * Shape::createAndInsert for a wps:wsp: the preset geometry with its adjustment values, the fill
   * and outline (direct or from the theme through wps:style), mirroring and rotation.
   */
  /**
   * oox::vml's text path shapes (VML type 136, as Word's watermarks are), which writerfilter turns
   * into Fontwork custom shapes (fontwork-plain-text). Other VML is not ported: false then.
   */
  const readPict = (pict: XmlElement, node: SwTextNode, attrs: SwCharAttrSet, partRels: Map<string, Rel>): boolean => {
    const vs = findDeep(pict, 'v:shape');
    const tp = vs && findDeep(vs, 'v:textpath');
    const imagedata = vs && !tp && !findDeep(vs, 'v:textbox') ? findDeep(vs, 'v:imagedata') : undefined;
    if (!vs || (!tp && !imagedata)) return false;
    const css = (st: string | undefined) => new Map((st ?? '').split(';').map((d) => d.split(':').map((x) => x.trim()) as [string, string]).filter(([k, v]) => k && v !== undefined));
    const st = css(vs.attrs.get('style'));
    const len = (v: string | undefined): number => {
      const m = /^(-?[\d.]+)(pt|in|cm|mm|px)?$/.exec(v ?? '');
      if (!m) return 0;
      const n = parseFloat(m[1]!);
      return Math.round(n * ({ pt: 20, in: 1440, cm: 567, mm: 56.7, px: 15 } as Record<string, number>)[m[2] ?? 'pt']!);
    };
    if (imagedata) {
      // oox::vml::ShapeBase for a picture (v:imagedata): the graphic in the shape's size. A shape
      // in the line is anchored as character; a positioned one is not ported.
      const rel = partRels.get(imagedata.attrs.get('r:id') ?? '');
      const data = rel && files.get(rel.target);
      const mime = rel && MIME_BY_EXT[rel.target.split('.').pop()!.toLowerCase()];
      if (!data || !mime || st.get('position') === 'absolute') return false;
      const width = len(st.get('width')), height = len(st.get('height'));
      if (width <= 0 || height <= 0) return false;
      const graphic = doc.AddGraphic(data, mime);
      const alt = imagedata.attrs.get('o:title') || vs.attrs.get('alt') || undefined;
      append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FLYCNT: { graphic, width, height, name: uniqueName(undefined, 'Image'), ...(alt ? { alt } : {}) } });
      return true;
    }
    if (!tp) return false;
    // VML colours: #rrggbb (maybe followed by a palette index) or a name.
    const NAMED: Record<string, string> = { silver: '#c0c0c0', gray: '#808080', grey: '#808080', black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', maroon: '#800000', navy: '#000080', olive: '#808000', purple: '#800080', teal: '#008080', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff' };
    const fc = (vs.attrs.get('fillcolor') ?? 'white').split(/\s/)[0]!.toLowerCase();
    const fill = /^#[0-9a-f]{6}$/.test(fc) ? fc : /^#[0-9a-f]{3}$/.test(fc) ? `#${[...fc.slice(1)].map((ch) => ch + ch).join('')}` : NAMED[fc] ?? '#c0c0c0';
    // opacity: a fraction, or 16.16 fixed point ("32768f").
    const op = child(vs, 'v:fill')?.attrs.get('opacity');
    const opacity = op === undefined ? 1 : op.endsWith('f') ? parseFloat(op) / 65536 : parseFloat(op);
    const font = css(tp.attrs.get('style')).get('font-family')?.replace(/^["']|["']$/g, '').replace(/^&quot;|&quot;$/g, '');
    const REL: Record<string, number> = { margin: RelOrientation.PAGE_PRINT_AREA, page: RelOrientation.PAGE_FRAME, text: RelOrientation.FRAME, char: RelOrientation.CHAR, line: RelOrientation.TEXT_LINE };
    const HA: Record<string, number> = { center: HoriOrientation.CENTER, left: HoriOrientation.LEFT, right: HoriOrientation.RIGHT };
    const VA: Record<string, number> = { center: VertOrientation.CENTER, top: VertOrientation.TOP, bottom: VertOrientation.BOTTOM };
    const ha = HA[st.get('mso-position-horizontal') ?? ''], va = VA[st.get('mso-position-vertical') ?? ''];
    const zIndex = parseInt(st.get('z-index') ?? '0', 10) || 0;
    const fmt: SwFlyFrameFormat = {
      m_aName: uniqueName(vs.attrs.get('id'), 'Shape'), m_nWidth: Math.max(1, len(st.get('width'))), m_nHeight: Math.max(1, len(st.get('height'))),
      m_pShape: {
        m_sType: 'fontwork-plain-text', m_bTextPath: true, m_sText: tp.attrs.get('string') ?? '', ...(font ? { m_sFontName: font } : {}),
        m_aFill: vs.attrs.get('filled') === 'f' ? null : fill, m_aLine: null,
        ...(opacity < 1 ? { m_nFillTransparence: Math.round((1 - opacity) * 100) } : {}),
        ...(parseFloat(st.get('rotation') ?? '0') ? { m_nRotate: ((parseFloat(st.get('rotation')!) % 360) + 360) % 360 } : {}),
      },
      m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_CHAR, m_nPageNumber: 0 },
      m_aHoriOrient: { m_eOrient: ha ?? HoriOrientation.NONE, m_eRelation: REL[st.get('mso-position-horizontal-relative') ?? 'text'] ?? RelOrientation.FRAME, m_nPos: len(st.get('margin-left')) },
      m_aVertOrient: { m_eOrient: va ?? VertOrientation.NONE, m_eRelation: REL[st.get('mso-position-vertical-relative') ?? 'text'] ?? RelOrientation.FRAME, m_nPos: len(st.get('margin-top')) },
      m_aSurround: { m_eSurround: WrapTextMode.THROUGH },
      m_nLeftSpace: 0, m_nRightSpace: 0, m_nUpperSpace: 0, m_nLowerSpace: 0,
      // A negative z-index puts the shape behind the text.
      m_bOpaque: zIndex >= 0,
    };
    node.m_aAnchoredFlys.push({ fmt, nContent: node.Len() });
    return true;
  };

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
    else if (child(spPr, 'a:gradFill')) {
      const g = ImportGradFill(child(spPr, 'a:gradFill')!, themeColors);
      if (g) { shape.m_aGradient = g; shape.m_aFill = g.aColorStops[0]!.aStopColor; }
    }
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
  const linkedBoxes: { id: string; seq: number; fmt: SwFlyFrameFormat }[] = [];
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

  let pendingBreak: 'page-before' | 'column-before' | null = null;
  /** Where text after a break splits the paragraph being read, as positions in it. */
  let paraSplits: { pos: number; brk: 'page-before' | 'column-before' }[] = [];
  // DomainMapper_Impl::StartOrEndBookmark: a bookmark starts where the text appended so far ends,
  // and ends likewise. Between paragraphs, it starts at the next paragraph and ends at the end of
  // the previous one (IsOutsideAParagraph).
  const bookmarkStarts = new Map<string, { name: string; node: SwTextNode | null; nContent: number }>();
  let lastParaNode: SwTextNode | null = null;
  const StartBookmark = (e: XmlElement, node: SwTextNode | null) => {
    bookmarkStarts.set(W(e, 'id') ?? '', { name: W(e, 'name') ?? '', node, nContent: node?.Len() ?? 0 });
  };
  const EndBookmark = (e: XmlElement, node: SwTextNode | null) => {
    const id = W(e, 'id') ?? '';
    const start = bookmarkStarts.get(id);
    bookmarkStarts.delete(id);
    const end = node ?? lastParaNode;
    // A paragraph the import dropped again (a placeholder) holds no bookmark.
    const alive = (n: SwTextNode) => { try { return nodes.node(n.GetIndex()) === n; } catch { return false; } };
    if (!start?.name || !start.node || !end || !alive(start.node) || !alive(end)) return;
    const p1 = new SwPosition(start.node, start.nContent), p2 = new SwPosition(end, end.Len());
    doc.getIDocumentMarkAccess().makeMark({ GetPoint: () => p1, GetMark: () => p2, HasMark: () => p1.compare(p2) !== 0 }, start.name, MarkType.BOOKMARK);
    p1.Release(); p2.Release();
  };
  const takeDeferredBreak = (node: SwTextNode) => {
    if (!pendingBreak) return;
    if (node.Len() > 0) paraSplits.push({ pos: node.Len(), brk: pendingBreak });
    else {
      node.m_aSet.RES_BREAK = pendingBreak;
      if (nWordCompatibilityMode > 14) node.m_aSet.RES_UL_SPACE = { ...node.GetAttr('RES_UL_SPACE'), upper: 0 };
    }
    pendingBreak = null;
  };
  // Section breaks of the body: the last paragraph of each section and its w:sectPr.
  const sectBreaks: { last: SwTextNode; sectPr: XmlElement }[] = [];
  let bodySectPr: XmlElement | undefined;

  const readPara = (p: XmlElement, partRels: Map<string, Rel>) => {
    const styleId = val(child(child(p, 'w:pPr'), 'w:pStyle'));
    const fromTable = ApplyParagraphPropertiesFromTableStyle(child(p, 'w:pPr'), styleId);
    const pPr = fromTable.pPr;
    const node = newNode(resolveColl(styleId));
    if (fromTable.rPr) Object.assign(node.m_aSet, runProps(fromTable.rPr));
    lastParaNode = node;
    if (tocId) node.m_aSet.RES_PARATR_TOX_ID = tocId;
    for (const b of bookmarkStarts.values()) if (!b.node) { b.node = node; b.nContent = 0; }
    Object.assign(node.m_aSet, paraProps(pPr, node.GetTextColl().GetFormatAttr('RES_UL_SPACE'), node.GetTextColl().GetFormatAttr('RES_LR_SPACE')));
    paraSplits = [];
    if (pendingBreak) {
      node.m_aSet.RES_BREAK = pendingBreak;
      node.m_aSet.RES_UL_SPACE = { ...node.GetAttr('RES_UL_SPACE'), upper: 0 };
      pendingBreak = null;
    }
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
            const fld = SimpleField(instr);
            if (fld) append(node, CH_TXTATR_BREAKWORD, { RES_TXTATR_FIELD: fld });
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
          // DomainMapper_Impl::appendStarMath: a formula anchored as character, aligned to the
          // baseline (new documents have MathBaselineAlignment). In m:oMathPara, the paragraph
          // takes the math justification (centred by default, adjustLastPara).
          case 'm:oMath': appendStarMath(node, c); break;
          case 'm:oMathPara': {
            for (const m of kids(c, 'm:oMath')) appendStarMath(node, m);
            const jc = child(child(c, 'm:oMathParaPr'), 'm:jc')?.attrs.get('m:val');
            (node.m_aSet as Record<string, unknown>).RES_PARATR_ADJUST = jc === 'left' ? 'left' : jc === 'right' ? 'right' : 'center';
            break;
          }
          case 'w:commentRangeStart': ctx.openComments.set(W(c, 'id') ?? '', { node, start: node.Len(), id: W(c, 'id') ?? '' }); break;
          case 'w:bookmarkStart': StartBookmark(c, node); break;
          case 'w:bookmarkEnd': EndBookmark(c, node); break;
          case 'w:pPr': case 'w:proofErr': case 'w:commentRangeEnd': case 'w:permStart': case 'w:permEnd':
          case 'w:moveFromRangeStart': case 'w:moveFromRangeEnd': case 'w:moveToRangeStart': case 'w:moveToRangeEnd': case 'w:smartTagPr':
          case 'w:customXmlMoveFromRangeStart': case 'w:customXmlMoveFromRangeEnd': case 'w:customXmlMoveToRangeStart': case 'w:customXmlMoveToRangeEnd': break;
          default: lost.add(`other content (${c.name})`);
        }
      }
    };
    walk(p);
    // finishParagraph: the paragraph mark's character properties are the paragraph's ("font size
    // in rPr must affect the paragraph size", tdf#64222). Upstream sets them on every paragraph;
    // here only on empty ones, where they decide the height, so that runs without their own
    // properties keep the style's, as in Word.
    if (!node.Len() && markRPr) {
      const mark = runProps(markRPr) as Record<string, unknown>;
      for (const k of Object.keys(mark)) if (k.startsWith('RES_CHRATR_')) (node.m_aSet as Record<string, unknown>)[k] = mark[k];
    }
    node.m_nVersion++;
    // DomainMapper::lcl_utext (bRemove): a paragraph holding only the section's properties is not
    // a paragraph in Writer, unless it is all its section has.
    if (sect && sectionEnd === nodes.GetEndOfContent() && !node.Len() && !node.m_aAnchoredFlys.length && !node.m_aIndices.size
      && ![...bookmarkStarts.values()].some((b) => b.node === node)
      && !node.m_aSet.RES_BREAK && !node.m_aSet.RES_PAGEDESC) {
      const prev = nodes.node(node.GetIndex() - 1);
      const prevSect = sectBreaks[sectBreaks.length - 2];
      if (prev.IsTextNode() && prev.m_pStartOfSection === node.m_pStartOfSection && (!prevSect || prevSect.last.GetIndex() < prev.GetIndex())) {
        sectBreaks[sectBreaks.length - 1]!.last = prev;
        nodes.Remove(node.GetIndex());
        lastParaNode = prev;
        return prev;
      }
    }
    // The parts after breaks within the paragraph become paragraphs of their own.
    let lastPart = node;
    for (const sp of [...paraSplits].reverse()) {
      const next = node.SplitContentNode(sp.pos);
      next.m_aSet.RES_BREAK = sp.brk;
      delete next.m_aSet.RES_PAGEDESC;
      if (lastPart === node) lastPart = next;
    }
    paraSplits = [];
    if (lastPart !== node) {
      for (const b of sectBreaks) if (b.last === node) b.last = lastPart;
      lastParaNode = lastPart;
    }
    return lastPart;
  };

  // DomainMapperTableHandler: rows of cells over a grid of columns; gridSpan widens a box, vMerge continues one.
  const readTable = (tbl: XmlElement, partRels: Map<string, Rel>) => {
    const tblPr = child(tbl, 'w:tblPr');
    const styles = tableStyle(val(child(tblPr, 'w:tblStyle')));
    const prop = (name: string) => child(tblPr, name) ?? styles.map((s) => child(s.tblPr, name)).filter(Boolean).pop();
    const jc = val(prop('w:jc'));
    const tblW = prop('w:tblW');
    const grid = kids(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => int(W(g, 'w')) ?? 1000);
    // DomainMapperTableManager (LN_CT_TblPrBase_tblW, endOfRowAction): a fixed width, a percentage
    // (a full width table here), or else the sum of the grid's columns.
    // A percentage is the table's relative width (PROP_RELATIVE_WIDTH, in fiftieths of a percent
    // or with a percent sign); 100% fills the area.
    const pctRaw = W(tblW, 'type') === 'pct' ? W(tblW, 'w') ?? '' : '';
    const pct = pctRaw ? (pctRaw.endsWith('%') ? parseFloat(pctRaw) : (int(pctRaw) ?? 0) / 50) : 0;
    const relWidth = pct > 0 && pct < 100 ? Math.round(pct) : 0;
    const width = W(tblW, 'type') === 'pct' ? 0 : (int(W(tblW, 'w')) || grid.reduce((a, b) => a + b, 0));
    const adjust: SwTableAdjust = width || relWidth ? (jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left') : 'full';
    const table = new SwTable({ name: doc.GetUniqueTableName(), adjust, width, ...(relWidth ? { relWidth } : {}), leftSpace: int(W(prop('w:tblInd'), 'w')) ?? 0, upper: 0, lower: 0 });
    const tableNode = new SwTableNode(nodes, table);
    tableNode.m_pStartOfSection = sectionEnd.m_pStartOfSection;
    // A document that starts with a table has no paragraph before it: the new document's empty
    // paragraph goes.
    if (!initialUsed && sectionEnd === nodes.GetEndOfContent() && !initial.Len()) { nodes.Remove(initial.GetIndex()); initialUsed = true; }
    const at = sectionEnd.GetIndex();
    nodes.Insert(tableNode, at);
    const tableEnd = new SwEndNode(nodes, tableNode);
    nodes.Insert(tableEnd, at + 1);
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
 const border = (e: XmlElement | undefined): SvxBorderLine | null | undefined => {
      if (!e) return undefined;
      const v = val(e);
      if (!v || v === 'nil' || v === 'none') return null;
      const color = W(e, 'color');
      return { color: color && color !== 'auto' ? `#${color.toLowerCase()}` : '#000000', width: Math.max(1, Math.round(((int(W(e, 'sz')) ?? 4) * 20) / 8)) };
    };
    /** A table border: the outer one on the table's edge, insideH/insideV between cells. */
    // Each side on its own: the table's w:tblBorders, else the table style's (along basedOn).
    const allBorders = [child(tblPr, 'w:tblBorders'), ...styles.map((x) => child(x.tblPr, 'w:tblBorders')).reverse()].filter((b): b is XmlElement => !!b);
    const tableBorder = (side: 'left' | 'right' | 'top' | 'bottom', isEdge: boolean): SvxBorderLine | null | undefined => {
      const names = !isEdge ? [side === 'top' || side === 'bottom' ? 'w:insideH' : 'w:insideV'] : [`w:${side}`, ...(side === 'left' ? ['w:start'] : side === 'right' ? ['w:end'] : [])];
      for (const b of allBorders) for (const n of names) { const e = child(b, n); if (e) return border(e); }
      return undefined;
    };
    const cellMar = prop('w:tblCellMar');
    const padding = int(W(child(cellMar, 'w:left') ?? child(cellMar, 'w:start'), 'w')) ?? 108;
    // CT_TblCellMar: top and bottom default to 0 (Normal Table).
    const dist = { top: int(W(child(cellMar, 'w:top'), 'w')) ?? 0, bottom: int(W(child(cellMar, 'w:bottom'), 'w')) ?? 0 };
    const rows = kids(tbl, 'w:tr');
    // DomainMapperTableHandler::endTableGetTableStyle: up to Word 2010 (and without a version), a
    // top level table's indent is to its first cell's text, so the table starts that cell's left
    // margin (at least half its left border) further left; later versions add half the border.
    if (nTableDepth === 0 && adjust === 'left') {
      const tblInd = prop('w:tblInd');
      const leftBorder = tableBorder('left', true)?.width ?? 0;
      if (nWordCompatibilityMode < 0 || nWordCompatibilityMode <= 14) {
        const firstTcMar = child(child(kids(rows[0], 'w:tc')[0], 'w:tcPr'), 'w:tcMar');
        const nMin = Math.floor(leftBorder / 2);
        const cellLeft = int(W(child(firstTcMar, 'w:left') ?? child(firstTcMar, 'w:start'), 'w')) ?? padding;
        const nLeftBorderDistance = Math.max(nMin, tblInd ? cellLeft : nMin);
        table.m_aAttrs.leftSpace = (int(W(tblInd, 'w')) ?? 0) - nLeftBorderDistance;
      } else table.m_aAttrs.leftSpace = (int(W(tblInd, 'w')) ?? 0) + Math.floor(leftBorder / 2);
    }
    // DomainMapperTableManager::finishTableLook: the parts of the table style in use; the
    // attributes, where any is given, over w:val (the documented default 0x4A0).
    const look = prop('w:tblLook');
    let nTblLook = 0x4a0;
    const lookAttr = (k: string) => { const v = look?.attrs.get(`w:${k}`); return v === undefined ? undefined : v === '1' || v === 'true' || v === 'on'; };
    if (['firstRow', 'lastRow', 'firstColumn', 'lastColumn', 'noHBand', 'noVBand'].some((k) => lookAttr(k) !== undefined)) {
      nTblLook = 0;
      ([['firstRow', 0x020], ['lastRow', 0x040], ['firstColumn', 0x080], ['lastColumn', 0x100], ['noHBand', 0x200], ['noVBand', 0x400]] as const)
        .forEach(([k, bit]) => { if (lookAttr(k) ?? true) nTblLook |= bit; });
    } else if (W(look, 'val')) nTblLook = parseInt(W(look, 'val')!, 16);
    // TableStyleSheetEntry::GetLocalPropertiesFromMask: the conditional formats of a cell's mask,
    // from the weakest to the strongest.
    const CNF_ORDER = [[0x010, 'band2Horz'], [0x020, 'band1Horz'], [0x040, 'band2Vert'], [0x080, 'band1Vert'], [0x100, 'lastCol'], [0x200, 'firstCol'],
      [0x400, 'lastRow'], [0x800, 'firstRow'], [0x001, 'swCell'], [0x002, 'seCell'], [0x004, 'nwCell'], [0x008, 'neCell']] as const;
    const condTcPr = (nMask: number): XmlElement[] => {
      const out: XmlElement[] = [];
      for (const [mask, type] of CNF_ORDER) {
        if (!(nMask & mask)) continue;
        for (const st of styles) for (const c of st.cond) if (W(c, 'type') === type) { const tc = child(c, 'w:tcPr'); if (tc) out.push(tc); }
      }
      return out;
    };
    /** DomainMapperTableHandler::endTableGetCellProperties: the mask of a cell. */
    const cnfMask = (ri: number, ci: number, nCells: number, header: boolean): number => {
      let nRowStyleMask = 0;
      if (ri === 0) { if (nTblLook & 0x20) nRowStyleMask |= 0x800; }
      else if (ri === rows.length - 1) { if (nTblLook & 0x40) nRowStyleMask |= 0x400; }
      else if (header) nRowStyleMask |= 0x800;
      if (!nRowStyleMask && !(nTblLook & 0x200)) {
        let n = ri + 1;
        if (nTblLook & 0x20) n++;
        nRowStyleMask = n & 1 ? 0x020 : 0x010;
      }
      let nCellStyleMask = 0;
      if (ci === 0) { if (nTblLook & 0x80) nCellStyleMask = 0x200; }
      else if (ci === nCells - 1) { if (nTblLook & 0x100) nCellStyleMask = 0x100; }
      if (!nCellStyleMask && !(nTblLook & 0x400)) {
        let n = ci + 1;
        if (nTblLook & 0x80) n++;
        nCellStyleMask = n & 1 ? 0x080 : 0x040;
      }
      let nCnf = nCellStyleMask + nRowStyleMask;
      if (nCnf === 0x200 + 0x800) nCnf |= 0x004;
      else if (nCnf === 0x200 + 0x400) nCnf |= 0x001;
      else if (nCnf === 0x100 + 0x800) nCnf |= 0x008;
      else if (nCnf === 0x100 + 0x400) nCnf |= 0x002;
      return nCnf;
    };
    // The table style's own cell properties (rInfo.pTableDefaults), along basedOn.
    const styleTcPr = styles.map((x) => x.tcPr).filter((x): x is XmlElement => !!x);
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
      // TablePropertiesHandler: w:hRule="exact" is a fixed height; w:cantSplit keeps the row whole.
      if (line.m_aAttrs.minHeight && W(child(trPr, 'w:trHeight'), 'hRule') === 'exact') line.m_aAttrs.fixHeight = true;
      if (onOff(child(trPr, 'w:cantSplit'))) line.m_aAttrs.cantSplit = true;
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
        // The cell's own properties over its conditional formats over the table style's.
        const layers = [tcPr, ...condTcPr(cnfMask(ri, ci, cells.length, !!onOff(child(trPr, 'w:tblHeader')))).reverse(), ...[...styleTcPr].reverse()];
        const lastRow = ri === rows.length - 1, lastCol = ci === cells.length - 1;
        const side = (s: 'left' | 'right' | 'top' | 'bottom', edge: boolean): SvxBorderLine | null => {
          for (const layer of layers) {
            const tcBorders = child(layer, 'w:tcBorders');
            const own = border(child(tcBorders, `w:${s}`) ?? (s === 'left' ? child(tcBorders, 'w:start') : s === 'right' ? child(tcBorders, 'w:end') : undefined));
            if (own !== undefined) return own;
          }
          return tableBorder(s, edge) ?? null;
        };
        attrs.box = { left: side('left', ci === 0), right: side('right', lastCol), top: side('top', ri === 0), bottom: side('bottom', lastRow) } satisfies SvxBoxItem;
        // CellMarginHandler: the cell's w:tcMar over the table's margins (one horizontal padding here,
        // from the left or start margin).
        const tcMar = child(tcPr, 'w:tcMar');
        const mar = (n: string) => int(W(child(tcMar, n), 'w'));
        const cellPadding = mar('w:left') ?? mar('w:start') ?? padding;
        const cellDist = { top: mar('w:top') ?? dist.top, bottom: mar('w:bottom') ?? dist.bottom };
        attrs.padding = cellPadding;
        if (cellDist.top !== cellPadding || cellDist.bottom !== cellPadding) attrs.dist = cellDist;
        const fill = W(layers.map((l) => child(l, 'w:shd')).find((x) => x), 'fill');
        if (fill && fill !== 'auto') attrs.background = `#${fill.toLowerCase()}`;
        // CellProperties: w:vAlign and w:textDirection (btLr, tbRl and their Word 2010 names).
        const va = W(child(tcPr, 'w:vAlign'), 'val');
        if (va === 'center' || va === 'bottom') attrs.vertOrient = va;
        const td = W(child(tcPr, 'w:textDirection'), 'val');
        if (td === 'btLr' || td === 'lrTbV' || td === 'lr') attrs.frameDir = 'bt-lr';
        else if (td === 'tbRl' || td === 'tbRlV' || td === 'rl') attrs.frameDir = 'tb-rl';
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
          const nMask = cnfMask(ri, ci, cells.length, !!onOff(child(trPr, 'w:tblHeader')));
          const condParts = (part: 'w:pPr' | 'w:rPr') => CNF_ORDER.filter(([mask]) => nMask & mask)
            .flatMap(([, type]) => styles.flatMap((st) => st.cond.filter((c) => W(c, 'type') === type).map((c) => child(c, part)))).filter((x): x is XmlElement => !!x);
          cellStyleProps.push({
            pPr: [...styles.map((x) => x.pPr).filter((x): x is XmlElement => !!x), ...condParts('w:pPr')],
            rPr: [...styles.map((x) => x.rPr).filter((x): x is XmlElement => !!x), ...condParts('w:rPr')],
          });
          nTableDepth++;
          readBlocks(tc, partRels);
          nTableDepth--;
          cellStyleProps.pop();
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
        case 'w:bookmarkStart': StartBookmark(el, null); break;
        case 'w:bookmarkEnd': EndBookmark(el, null); break;
        case 'w:tcPr': case 'w:proofErr': case 'w:permStart': case 'w:permEnd': break;
        // A display formula between paragraphs is a paragraph of its own.
        case 'm:oMathPara': {
          last = readPara({ name: 'w:p', attrs: new Map(), children: [el] }, partRels);
          for (const fmt of pendingFrames) last.m_aAnchoredFlys.push({ fmt, nContent: 0 });
          pendingFrames = [];
          break;
        }
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
    // w:pgNumType w:fmt: the page style's numbering type (SectionPropertyMap's PROP_NUMBERING_TYPE).
    const pgFmt = W(child(sp, 'w:pgNumType'), 'fmt');
    if (pgFmt && NUM_FMT[pgFmt] !== undefined) pd.m_nNumType = NUM_FMT[pgFmt];
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
  /**
   * The first top-level paragraph or table after a node, where the next section starts: a section
   * beginning with a table puts its page style on the table's format, as Writer does.
   */
  const firstAfter = (n: SwTextNode | null): SwTextNode | SwTableNode | null => {
    for (let i = n ? n.GetIndex() + 1 : nodes.BodyStart(); i < nodes.GetEndOfContent().GetIndex(); i++) {
      const k = nodes.node(i);
      if ((k.IsTextNode() || k.IsTableNode()) && k.m_pStartOfSection === nodes.m_pStartOfContent) return k as SwTextNode | SwTableNode;
    }
    return null;
  };
  const setPageDesc = (start: SwTextNode | SwTableNode, pd: { name: string; numOffset: number | null }) => {
    if (start.IsTableNode()) (start as SwTableNode).m_pTable.GetFrameFormat().pageDesc = pd;
    else (start as SwTextNode).m_aSet.RES_PAGEDESC = pd;
  };
  let refs: HdrRefs = new Map();
  let prevGeo = '';
  /** PROP_IS_LANDSCAPE: w:orient, else a page wider than high. */
  const isLandscape = (g: { w?: number; h?: number }) => !!g.w && !!g.h && g.w > g.h;
  let prevLandscape = false;
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
      if (pgNum !== null) setPageDesc(start, { name: DEFAULT_PAGE_DESC, numOffset: pgNum });
    } else if (type === 'continuous' && isLandscape(g) === prevLandscape && pgNum === null) {
      // SectionPropertyMap::CloseSectionGroup: a continuous break stays one unless the orientation
      // changes (other page properties wait for the next page break). The page goes on; own
      // columns make a Writer section of the section's blocks.
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
      setPageDesc(start, { name, numOffset: pgNum });
    }
    prevGeo = geoKey;
    prevLandscape = isLandscape(g);
  });

  if (nodes.node(nodes.GetEndOfContent().GetIndex() - 1).IsEndNode()) nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), standard);
  doc.SetUnmodified();
  // DomainMapper_Impl::ChainTextFrames: the text boxes of one id, in their sequence.
  for (const id of new Set(linkedBoxes.map((b) => b.id))) {
    const chain = linkedBoxes.filter((b) => b.id === id).sort((a, b) => a.seq - b.seq);
    for (let k = 0; k + 1 < chain.length; k++) {
      chain[k]!.fmt.m_aChain = { ...chain[k]!.fmt.m_aChain, m_sNext: chain[k + 1]!.fmt.m_aName };
      chain[k + 1]!.fmt.m_aChain = { ...chain[k + 1]!.fmt.m_aChain, m_sPrev: chain[k]!.fmt.m_aName };
    }
  }
  // SwSetExpFieldType::SetSeqRefNo: the number range fields get their sequence numbers.
  doc.SetSeqRefNos();
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
