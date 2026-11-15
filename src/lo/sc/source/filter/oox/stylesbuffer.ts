// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/stylesbuffer.cxx reduced
// @upstream sc/source/filter/oox/stylesfragment.cxx reduced
// @upstream sc/source/filter/oox/themebuffer.cxx reduced
// StylesBuffer: the colours, fonts, number formats, borders, fills, style and cell XFs and cell
// styles of styles.xml, converted to Calc's cell items and cell styles as stylesbuffer.cxx does.
// Reduced: the BIFF12 records and the differential formats (dxf, only used by conditional
// formatting, which is not imported) are left out; theme colours are resolved with the theme's
// colour scheme (the complex colours that remember the theme reference are not modelled); the
// font's Asian and complex script variants, its family, character set and the scheme (theme font)
// attribute are not kept; the font classification by the glyphs a font has is not done.
// Patterned fills other than solid and gradient fills are mixed into one colour as upstream does
// and reported as lost.
import { childElements, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { AttributeList } from '../../../../oox/source/helper/attributelist.ts';
import { GetColor, ReadThemeColors, type ThemeColors } from '../../../../oox/source/drawingml/color.ts';
import { SC_POOL_DEFAULTS, ItemEquals, type ScItemId, type ScItemSet, type SvxBorderLine, type SvxBorderLineStyle, type SvxBoxItem, type SvxCellHorJustify, type SvxCellVerJustify, type FontLineStyle } from '../../../inc/scitems.ts';
import type { EditCharAttribs } from '../../../../editeng/source/editeng/editobj.ts';
import type { ScDocument } from '../../core/data/document.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScStyleSheet, SfxStyleFamily } from '../../../inc/stlsheet.ts';
import { STR_STYLENAME_STANDARD } from '../../../inc/stlpool.ts';
import { NumberFormatsBuffer } from './numberformatsbuffer.ts';
import { Unit, UnitConverter } from './unitconverter.ts';

// OOXML predefined color indexes (stylesbuffer.hxx)
export const OOX_COLOR_WINDOWTEXT3 = 24;
export const OOX_COLOR_WINDOWBACK3 = 25;
export const OOX_COLOR_WINDOWTEXT = 64;
export const OOX_COLOR_WINDOWBACK = 65;
export const OOX_COLOR_BUTTONBACK = 67;
export const OOX_COLOR_CHWINDOWTEXT = 77;
export const OOX_COLOR_CHWINDOWBACK = 78;
export const OOX_COLOR_CHBORDERAUTO = 79;
export const OOX_COLOR_NOTEBACK = 80;
export const OOX_COLOR_NOTETEXT = 81;
export const OOX_COLOR_FONTAUTO = 0x7fff;

export const API_LINE_NONE = 0;
export const API_LINE_HAIR = 1;
export const API_LINE_THIN = 15;
export const API_LINE_MEDIUM = 35;
export const API_LINE_THICK = 50;

// OOXML cell rotation
const OOX_XF_ROTATION_NONE = 0;
const OOX_XF_ROTATION_STACKED = 255;
// OOXML cell text direction
const OOX_XF_TEXTDIR_CONTEXT = 0;
const OOX_XF_TEXTDIR_LTR = 1;
const OOX_XF_TEXTDIR_RTL = 2;
// OOXML built-in cell styles
const OOX_STYLE_NORMAL = 0; /// Default cell style.
const OOX_STYLE_ROWLEVEL = 1; /// RowLevel_x cell style.
const OOX_STYLE_COLLEVEL = 2; /// ColLevel_x cell style.

/** The system colours of oox's GraphicHelper. */
const SYSTEM_COLORS = { windowText: '#000000', window: '#ffffff', btnFace: '#ece9d8', infoBk: '#ffffe1', infoText: '#000000' };

/** An element's local name (SpreadsheetML elements are unprefixed or 'x:'). */
export const ln = (e: XmlElement): string => (e.name.startsWith('x:') ? e.name.slice(2) : e.name);
/** The child elements by local name. */
export const kids = (e: XmlElement | undefined, name?: string): XmlElement[] => (e ? childElements(e).filter((c) => name === undefined || ln(c) === name) : []);
export const kid = (e: XmlElement | undefined, name: string): XmlElement | undefined => (e ? childElements(e).find((c) => ln(c) === name) : undefined);
export const attrs = (e: XmlElement): AttributeList => new AttributeList(e.attrs);

/** XlsColor: an automatic, RGB, theme or palette colour with a tint. */
export class XlsColor {
  meType: 'auto' | 'rgb' | 'theme' | 'indexed' = 'auto';
  mnValue = 0;
  mfTint = 0;

  setAuto(): void { this.meType = 'auto'; this.mfTint = 0; }
  setRgb(nRgbValue: number, fTint = 0): void { this.meType = 'rgb'; this.mnValue = nRgbValue & 0xffffff; this.mfTint = fTint; }
  setTheme(nThemeIdx: number, fTint = 0): void { this.meType = 'theme'; this.mnValue = nThemeIdx; this.mfTint = fTint; }
  setIndexed(nPaletteIdx: number, fTint = 0): void { this.meType = 'indexed'; this.mnValue = nPaletteIdx; this.mfTint = fTint; }
  isAuto(): boolean { return this.meType === 'auto'; }

  importColor(rAttribs: AttributeList): void {
    // tdf#113271 The order of import color is very important in case of more than one color attributes was provided.
    // This order (theme -> rgb -> indexed -> auto) is not documented and was gathered experimentally based on MS Excel 2013.
    if (rAttribs.hasAttribute('theme')) {
      const nTheme = rAttribs.getInteger('theme', -1);
      const fTint = rAttribs.getDouble('tint', 0.0);
      this.setTheme(nTheme, fTint);
    } else if (rAttribs.hasAttribute('rgb')) this.setRgb(rAttribs.getIntegerHex('rgb', 0xffffffff), rAttribs.getDouble('tint', 0.0));
    else if (rAttribs.hasAttribute('indexed')) this.setIndexed(rAttribs.getInteger('indexed', -1), rAttribs.getDouble('tint', 0.0));
    else if (rAttribs.getBool('auto', false)) this.setAuto();
    else this.setAuto();
  }

  equals(r: XlsColor): boolean { return this.meType === r.meType && this.mnValue === r.mnValue && this.mfTint === r.mfTint; }
}

const hex6 = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** Default color table for BIFF8/BIFF12/OOXML (spnDefColors8). */
const PALETTE_EGA_COLORS_LIGHT = [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];
const PALETTE_EGA_COLORS_DARK = [0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xc0c0c0, 0x808080];
export const spnDefColors8: readonly number[] = [
  /*  0 */ ...PALETTE_EGA_COLORS_LIGHT,
  /*  8 */ ...PALETTE_EGA_COLORS_LIGHT,
  /* 16 */ ...PALETTE_EGA_COLORS_DARK,
  /* 24 */ 0x9999ff, 0x993366, 0xffffcc, 0xccffff, 0x660066, 0xff8080, 0x0066cc, 0xccccff,
  /* 32 */ 0x000080, 0xff00ff, 0xffff00, 0x00ffff, 0x800080, 0x800000, 0x008080, 0x0000ff,
  /* 40 */ 0x00ccff, 0xccffff, 0xccffcc, 0xffff99, 0x99ccff, 0xff99cc, 0xcc99ff, 0xffcc99,
  /* 48 */ 0x3366ff, 0x33cccc, 0x99cc00, 0xffcc00, 0xff9900, 0xff6600, 0x666699, 0x969696,
  /* 56 */ 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333,
];

export class ColorPalette {
  private maColors: number[] = [...spnDefColors8];
  private mnAppendIndex = 0;

  importPaletteColor(rAttribs: AttributeList): void {
    this.appendColor(rAttribs.getIntegerHex('rgb', 0xffffff));
  }

  /** The colour of a palette index (null: transparent). */
  getColor(nPaletteIdx: number): string | null {
    const c = this.maColors[nPaletteIdx];
    if (c !== undefined && nPaletteIdx >= 0) return hex6(c);
    switch (nPaletteIdx) {
      case OOX_COLOR_WINDOWTEXT3:
      case OOX_COLOR_WINDOWTEXT:
      case OOX_COLOR_CHWINDOWTEXT: return SYSTEM_COLORS.windowText;
      case OOX_COLOR_WINDOWBACK3:
      case OOX_COLOR_WINDOWBACK:
      case OOX_COLOR_CHWINDOWBACK: return SYSTEM_COLORS.window;
      case OOX_COLOR_BUTTONBACK: return SYSTEM_COLORS.btnFace;
      case OOX_COLOR_CHBORDERAUTO: return '#000000'; /* really always black? */
      case OOX_COLOR_NOTEBACK: return SYSTEM_COLORS.infoBk;
      case OOX_COLOR_NOTETEXT: return SYSTEM_COLORS.infoText;
      case OOX_COLOR_FONTAUTO: return null;
      default: return null;
    }
  }

  private appendColor(nRGBValue: number): void {
    if (this.mnAppendIndex < this.maColors.length) this.maColors[this.mnAppendIndex] = nRGBValue & 0xffffff;
    else this.maColors.push(nRGBValue & 0xffffff);
    ++this.mnAppendIndex;
  }
}

/** ThemeBuffer, reduced to the colour scheme. */
export class ThemeBuffer {
  maColors: ThemeColors = {};
  importTheme(rTheme: XmlElement | undefined): void { this.maColors = ReadThemeColors(rTheme); }
}

/** Color::addExcelTintTransformation and getColor: a colour with the tint as lumMod/lumOff. */
function applyTint(rHex: string, fTint: number): string {
  if (!fTint) return rHex;
  const nValue = Math.max(0, Math.min(100000, Math.round(Math.abs(fTint) * 100000)));
  const children: XmlElement[] = [{ name: 'a:lumMod', attrs: new Map([['val', String(100000 - nValue)]]), children: [] }];
  if (fTint > 0) children.push({ name: 'a:lumOff', attrs: new Map([['val', String(nValue)]]), children: [] });
  return GetColor({ name: 'a:srgbClr', attrs: new Map([['val', rHex.slice(1)]]), children }, {}) ?? rHex;
}

// FontModel ------------------------------------------------------------------

export interface FontModel {
  maName: string;
  maColor: XlsColor;
  mnScheme: string;
  mnFamily: number;
  mfHeight: number; // points
  mnUnderline: string;
  mnEscapement: string;
  mbBold: boolean;
  mbItalic: boolean;
  mbStrikeout: boolean;
  mbOutline: boolean;
  mbShadow: boolean;
}
export const newFontModel = (): FontModel => ({
  maName: '', maColor: new XlsColor(), mnScheme: 'none', mnFamily: 0, mfHeight: 0, mnUnderline: 'none', mnEscapement: 'baseline',
  mbBold: false, mbItalic: false, mbStrikeout: false, mbOutline: false, mbShadow: false,
});

interface ApiFontUsedFlags {
  mbNameUsed: boolean; mbColorUsed: boolean; mbSchemeUsed: boolean; mbHeightUsed: boolean; mbUnderlineUsed: boolean;
  mbEscapementUsed: boolean; mbWeightUsed: boolean; mbPostureUsed: boolean; mbStrikeoutUsed: boolean; mbOutlineUsed: boolean; mbShadowUsed: boolean;
}
const fontUsedFlags = (b: boolean): ApiFontUsedFlags => ({
  mbNameUsed: b, mbColorUsed: b, mbSchemeUsed: b, mbHeightUsed: b, mbUnderlineUsed: b, mbEscapementUsed: b, mbWeightUsed: b,
  mbPostureUsed: b, mbStrikeoutUsed: b, mbOutlineUsed: b, mbShadowUsed: b,
});

/** ScfTools::PutItem with bSkipPoolDefs: an item equal to the pool default is not put. */
function PutItem<K extends ScItemId>(rItemSet: ScItemSet, nWhich: K, rItem: ScItemSet[K], bSkipPoolDefs: boolean): void {
  if (bSkipPoolDefs && ItemEquals(rItem, SC_POOL_DEFAULTS[nWhich])) return;
  (rItemSet as Record<string, unknown>)[nWhich] = rItem;
}

export class Font {
  maModel: FontModel;
  maUsedFlags: ApiFontUsedFlags;
  private readonly mrStyles: StylesBuffer;
  // the API data of finalizeImport
  mnColor: string | null = null;
  mnHeight = 0;
  meUnderline: FontLineStyle = 'none';
  mnEscapement = 0;

  constructor(rStyles: StylesBuffer, bDxf: boolean, aModel?: FontModel) {
    this.mrStyles = rStyles;
    this.maModel = aModel ? { ...aModel } : newFontModel();
    this.maUsedFlags = fontUsedFlags(!bDxf || !!aModel);
  }

  importAttribs(nElement: string, rAttribs: AttributeList): void {
    const rDefModel = this.mrStyles.getDefaultFontModel();
    switch (nElement) {
      case 'name': // when in <font> element
      case 'rFont': // when in <rPr> element
        if (rAttribs.hasAttribute('val')) {
          this.maModel.maName = rAttribs.getXString('val', '')!;
          this.maUsedFlags.mbNameUsed = true;
        }
        break;
      case 'scheme':
        this.maModel.mnScheme = rAttribs.getToken('val', rDefModel.mnScheme);
        break;
      case 'family':
        this.maModel.mnFamily = rAttribs.getInteger('val', rDefModel.mnFamily);
        break;
      case 'charset':
        break;
      case 'sz':
        this.maModel.mfHeight = rAttribs.getDouble('val', rDefModel.mfHeight);
        this.maUsedFlags.mbHeightUsed = true;
        break;
      case 'color':
        this.maModel.maColor.importColor(rAttribs);
        this.maUsedFlags.mbColorUsed = true;
        break;
      case 'u':
        this.maModel.mnUnderline = rAttribs.getToken('val', 'single');
        this.maUsedFlags.mbUnderlineUsed = true;
        break;
      case 'vertAlign':
        this.maModel.mnEscapement = rAttribs.getToken('val', 'baseline');
        this.maUsedFlags.mbEscapementUsed = true;
        break;
      case 'b':
        this.maModel.mbBold = rAttribs.getBool('val', true);
        this.maUsedFlags.mbWeightUsed = true;
        break;
      case 'i':
        this.maModel.mbItalic = rAttribs.getBool('val', true);
        this.maUsedFlags.mbPostureUsed = true;
        break;
      case 'strike':
        this.maModel.mbStrikeout = rAttribs.getBool('val', true);
        this.maUsedFlags.mbStrikeoutUsed = true;
        break;
      case 'outline':
        this.maModel.mbOutline = rAttribs.getBool('val', true);
        this.maUsedFlags.mbOutlineUsed = true;
        break;
      case 'shadow':
        this.maModel.mbShadow = rAttribs.getBool('val', true);
        this.maUsedFlags.mbShadowUsed = true;
        break;
    }
  }

  /** importFont: the children of a font or rPr element. */
  importFont(rFont: XmlElement): void {
    for (const e of childElements(rFont)) this.importAttribs(ln(e), attrs(e));
  }

  finalizeImport(): void {
    // color, height, weight, slant, strikeout, outline, shadow
    this.mnColor = this.mrStyles.getColor(this.maModel.maColor, null);
    this.mnHeight = Math.trunc(this.maModel.mfHeight * 20.0);
    // underline
    switch (this.maModel.mnUnderline) {
      case 'double': case 'doubleAccounting': this.meUnderline = 'double'; break;
      case 'none': this.meUnderline = 'none'; break;
      case 'single': case 'singleAccounting': this.meUnderline = 'single'; break;
    }
    // escapement
    switch (this.maModel.mnEscapement) {
      case 'baseline': this.mnEscapement = 0; break;
      case 'superscript': this.mnEscapement = 33; break;
      case 'subscript': this.mnEscapement = -33; break;
    }
  }

  needsRichTextFormat(): boolean { return this.mnEscapement !== 0; }

  /** fillToItemSet for the cell items. */
  fillToItemSet(rItemSet: ScItemSet, bSkipPoolDefs: boolean): void {
    const f = this.maUsedFlags;
    if (f.mbNameUsed && this.maModel.maName) PutItem(rItemSet, 'ATTR_FONT', this.maModel.maName, bSkipPoolDefs);
    // font height
    if (f.mbHeightUsed) PutItem(rItemSet, 'ATTR_FONT_HEIGHT', this.mnHeight, bSkipPoolDefs);
    // font weight
    if (f.mbWeightUsed) PutItem(rItemSet, 'ATTR_FONT_WEIGHT', this.maModel.mbBold, bSkipPoolDefs);
    // font posture
    if (f.mbPostureUsed) PutItem(rItemSet, 'ATTR_FONT_POSTURE', this.maModel.mbItalic, bSkipPoolDefs);
    // character color
    if (f.mbColorUsed) PutItem(rItemSet, 'ATTR_FONT_COLOR', this.mnColor, bSkipPoolDefs);
    // underline style
    if (f.mbUnderlineUsed) PutItem(rItemSet, 'ATTR_FONT_UNDERLINE', this.meUnderline, bSkipPoolDefs);
    // strike out style
    if (f.mbStrikeoutUsed) PutItem(rItemSet, 'ATTR_FONT_CROSSEDOUT', this.maModel.mbStrikeout, bSkipPoolDefs);
    // outline style
    if (f.mbOutlineUsed) PutItem(rItemSet, 'ATTR_FONT_CONTOUR', this.maModel.mbOutline, bSkipPoolDefs);
    // shadow style
    if (f.mbShadowUsed) PutItem(rItemSet, 'ATTR_FONT_SHADOWED', this.maModel.mbShadow, bSkipPoolDefs);
  }

  /** fillToItemSet with bEditEngineText: the character attributes of a text portion. */
  fillToEditAttribs(): EditCharAttribs {
    const f = this.maUsedFlags, a: EditCharAttribs = {};
    if (f.mbNameUsed && this.maModel.maName) a.ATTR_FONT = this.maModel.maName;
    if (f.mbHeightUsed) a.ATTR_FONT_HEIGHT = this.mnHeight;
    if (f.mbWeightUsed) a.ATTR_FONT_WEIGHT = this.maModel.mbBold;
    if (f.mbPostureUsed) a.ATTR_FONT_POSTURE = this.maModel.mbItalic;
    if (f.mbColorUsed) a.ATTR_FONT_COLOR = this.mnColor;
    if (f.mbUnderlineUsed) a.ATTR_FONT_UNDERLINE = this.meUnderline;
    if (f.mbStrikeoutUsed) a.ATTR_FONT_CROSSEDOUT = this.maModel.mbStrikeout;
    if (f.mbEscapementUsed) a.ESCAPEMENT = this.mnEscapement;
    return a;
  }
}

// Alignment ------------------------------------------------------------------

export interface AlignmentModel {
  mnHorAlign: string; mnVerAlign: string; mnTextDir: number; mnRotation: number; mnIndent: number;
  mbWrapText: boolean; mbShrink: boolean; mbJustLastLine: boolean;
}

export class Alignment {
  maModel: AlignmentModel = { mnHorAlign: 'general', mnVerAlign: 'bottom', mnTextDir: OOX_XF_TEXTDIR_CONTEXT, mnRotation: OOX_XF_ROTATION_NONE, mnIndent: 0, mbWrapText: false, mbShrink: false, mbJustLastLine: false };
  // ApiAlignmentData
  meHorJustify: SvxCellHorJustify = 'Standard';
  mbHorDistribute = false;
  meVerJustify: SvxCellVerJustify = 'Standard';
  mbVerDistribute = false;
  mnIndent = 0;
  meFrameDir: 'Environment' | 'Horizontal_LR_TB' | 'Horizontal_RL_TB' = 'Environment';
  mnRotation = 0;
  mbStacked = false;
  mbWrapText = false;
  mbShrink = false;
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer) { this.mrStyles = rStyles; }

  importAlignment(rAttribs: AttributeList): void {
    this.maModel.mnVerAlign = rAttribs.getToken('vertical', 'bottom');
    this.maModel.mnTextDir = rAttribs.getInteger('readingOrder', OOX_XF_TEXTDIR_CONTEXT);
    this.maModel.mnRotation = rAttribs.getInteger('textRotation', OOX_XF_ROTATION_NONE);
    let nDefaultHorAlign = 'general';
    if (this.maModel.mnRotation !== OOX_XF_ROTATION_NONE) {
      if (this.maModel.mnRotation < 90 || this.maModel.mnRotation === 180) nDefaultHorAlign = 'left';
      else nDefaultHorAlign = 'right';
    }
    this.maModel.mnHorAlign = rAttribs.getToken('horizontal', nDefaultHorAlign);
    this.maModel.mnIndent = rAttribs.getInteger('indent', 0);
    this.maModel.mbWrapText = rAttribs.getBool('wrapText', false);
    this.maModel.mbShrink = rAttribs.getBool('shrinkToFit', false);
    this.maModel.mbJustLastLine = rAttribs.getBool('justifyLastLine', false);
  }

  finalizeImport(): void {
    // horizontal alignment
    switch (this.maModel.mnHorAlign) {
      case 'center': this.meHorJustify = 'Center'; break;
      case 'centerContinuous': this.meHorJustify = 'Center'; break;
      case 'distributed': this.meHorJustify = 'Block'; break;
      case 'fill': this.meHorJustify = 'Repeat'; break;
      case 'general': this.meHorJustify = 'Standard'; break;
      case 'justify': this.meHorJustify = 'Block'; break;
      case 'left': this.meHorJustify = 'Left'; break;
      case 'right': this.meHorJustify = 'Right'; break;
    }
    if (this.maModel.mnHorAlign === 'distributed') this.mbHorDistribute = true;

    // vertical alignment
    switch (this.maModel.mnVerAlign) {
      case 'bottom': this.meVerJustify = 'Bottom'; break;
      case 'center': this.meVerJustify = 'Center'; break;
      case 'distributed': this.meVerJustify = 'Block'; break;
      case 'justify': this.meVerJustify = 'Block'; break;
      case 'top': this.meVerJustify = 'Top'; break;
    }
    if (this.maModel.mnVerAlign === 'distributed') this.mbVerDistribute = true;

    /*  indentation: expressed as number of blocks of 3 space characters in
        OOXML. */
    // Note: indents are stored in twips
    const nIndent = Math.trunc(this.mrStyles.getUnitConverter().scaleValue(3.0 * this.maModel.mnIndent, Unit.Space, Unit.Twip));
    if ((0 <= nIndent) && (nIndent <= 0x7fff)) this.mnIndent = nIndent;

    // complex text direction
    switch (this.maModel.mnTextDir) {
      case OOX_XF_TEXTDIR_CONTEXT: this.meFrameDir = 'Environment'; break;
      case OOX_XF_TEXTDIR_LTR: this.meFrameDir = 'Horizontal_LR_TB'; break;
      case OOX_XF_TEXTDIR_RTL: this.meFrameDir = 'Horizontal_RL_TB'; break;
    }

    // rotation: 0-90 means 0 to 90 degrees ccw, 91-180 means 1 to 90 degrees cw, 255 means stacked
    const nOoxRot = this.maModel.mnRotation;
    this.mnRotation = ((0 <= nOoxRot) && (nOoxRot <= 90)) ? (100 * nOoxRot) : (((91 <= nOoxRot) && (nOoxRot <= 180)) ? (100 * (450 - nOoxRot)) : 0);

    // "Orientation" property used for character stacking
    this.mbStacked = nOoxRot === OOX_XF_ROTATION_STACKED;

    // alignment flags (#i84960 automatic line break, if vertically justified/distributed)
    this.mbWrapText = this.maModel.mbWrapText || (this.maModel.mnVerAlign === 'distributed') || (this.maModel.mnVerAlign === 'justify');
    this.mbShrink = this.maModel.mbShrink;
  }

  /** operator== of ApiAlignmentData */
  equalsApi(r: Alignment): boolean {
    return this.meHorJustify === r.meHorJustify && this.mbHorDistribute === r.mbHorDistribute && this.meVerJustify === r.meVerJustify
      && this.mbVerDistribute === r.mbVerDistribute && this.mnIndent === r.mnIndent && this.meFrameDir === r.meFrameDir
      && this.mnRotation === r.mnRotation && this.mbStacked === r.mbStacked && this.mbWrapText === r.mbWrapText && this.mbShrink === r.mbShrink;
  }

  fillToItemSet(rItemSet: ScItemSet, bSkipPoolDefs: boolean): void {
    // horizontal alignment
    PutItem(rItemSet, 'ATTR_HOR_JUSTIFY', this.meHorJustify, bSkipPoolDefs);
    PutItem(rItemSet, 'ATTR_HOR_JUSTIFY_METHOD', this.mbHorDistribute ? 'Distribute' : 'Auto', bSkipPoolDefs);
    PutItem(rItemSet, 'ATTR_VER_JUSTIFY', this.meVerJustify, bSkipPoolDefs);
    // vertical alignment
    PutItem(rItemSet, 'ATTR_VER_JUSTIFY_METHOD', this.mbVerDistribute ? 'Distribute' : 'Auto', bSkipPoolDefs);
    // CTL text direction
    PutItem(rItemSet, 'ATTR_WRITINGDIR', this.meFrameDir, bSkipPoolDefs);
    // set an angle in the range from -90 to 90 degrees
    PutItem(rItemSet, 'ATTR_ROTATE_VALUE', this.mnRotation, bSkipPoolDefs);
    // Orientation
    PutItem(rItemSet, 'ATTR_STACKED', this.mbStacked, bSkipPoolDefs);
    // indent
    PutItem(rItemSet, 'ATTR_INDENT', this.mnIndent, bSkipPoolDefs);
    // line wrap
    PutItem(rItemSet, 'ATTR_LINEBREAK', this.mbWrapText, bSkipPoolDefs);
    PutItem(rItemSet, 'ATTR_SHRINKTOFIT', this.mbShrink, bSkipPoolDefs);
  }
}

// Protection -----------------------------------------------------------------

export class Protection {
  mbLocked = true;
  mbHidden = false;

  importProtection(rAttribs: AttributeList): void {
    this.mbLocked = rAttribs.getBool('locked', true);
    this.mbHidden = rAttribs.getBool('hidden', false);
  }

  equalsApi(r: Protection): boolean { return this.mbLocked === r.mbLocked && this.mbHidden === r.mbHidden; }

  fillToItemSet(rItemSet: ScItemSet, bSkipPoolDefs: boolean): void {
    PutItem(rItemSet, 'ATTR_PROTECTION', { bProtection: this.mbLocked, bHideFormula: this.mbHidden, bHideCell: false, bHidePrint: false }, bSkipPoolDefs);
  }
}

// Border ---------------------------------------------------------------------

interface BorderLineModel { maColor: XlsColor; mnStyle: string; mbUsed: boolean }
const newBorderLine = (bDxf: boolean): BorderLineModel => { const c = new XlsColor(); c.setIndexed(OOX_COLOR_WINDOWTEXT); return { maColor: c, mnStyle: 'none', mbUsed: !bDxf }; };

export class Border {
  maLeft: BorderLineModel;
  maRight: BorderLineModel;
  maTop: BorderLineModel;
  maBottom: BorderLineModel;
  maDiagonal: BorderLineModel;
  mbDiagTLtoBR = false;
  mbDiagBLtoTR = false;
  // ApiBorderData
  mbBorderUsed = false;
  mbDiagUsed = false;
  maApi: { left: SvxBorderLine | null; right: SvxBorderLine | null; top: SvxBorderLine | null; bottom: SvxBorderLine | null; tlbr: SvxBorderLine | null; bltr: SvxBorderLine | null } = { left: null, right: null, top: null, bottom: null, tlbr: null, bltr: null };
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer, bDxf: boolean) {
    this.mrStyles = rStyles;
    this.maLeft = newBorderLine(bDxf); this.maRight = newBorderLine(bDxf); this.maTop = newBorderLine(bDxf);
    this.maBottom = newBorderLine(bDxf); this.maDiagonal = newBorderLine(bDxf);
  }

  importBorder(rBorder: XmlElement): void {
    const a = attrs(rBorder);
    this.mbDiagTLtoBR = a.getBool('diagonalDown', false);
    this.mbDiagBLtoTR = a.getBool('diagonalUp', false);
    for (const e of childElements(rBorder)) {
      const pBorderLine = this.getBorderLine(ln(e));
      if (!pBorderLine) continue;
      // importStyle
      pBorderLine.mnStyle = attrs(e).getToken('style', 'none');
      pBorderLine.mbUsed = true;
      // importColor
      const c = kid(e, 'color');
      if (c) pBorderLine.maColor.importColor(attrs(c));
    }
  }

  finalizeImport(bRTL: boolean): void {
    if (bRTL) [this.maLeft, this.maRight] = [this.maRight, this.maLeft];
    this.mbBorderUsed = this.maLeft.mbUsed || this.maRight.mbUsed || this.maTop.mbUsed || this.maBottom.mbUsed;
    this.mbDiagUsed = this.maDiagonal.mbUsed;
    this.maApi.left = this.convertBorderLine(this.maLeft);
    this.maApi.right = this.convertBorderLine(this.maRight);
    this.maApi.top = this.convertBorderLine(this.maTop);
    this.maApi.bottom = this.convertBorderLine(this.maBottom);
    if (this.mbDiagTLtoBR) this.maApi.tlbr = this.convertBorderLine(this.maDiagonal);
    if (this.mbDiagBLtoTR) this.maApi.bltr = this.convertBorderLine(this.maDiagonal);
  }

  /** hasAnyOuterBorder */
  hasAnyOuterBorder(): boolean { return !!(this.maApi.top || this.maApi.bottom || this.maApi.left || this.maApi.right); }

  fillToItemSet(rItemSet: ScItemSet, bSkipPoolDefs: boolean): void {
    if (this.mbBorderUsed) {
      const aBoxItem: SvxBoxItem = { top: this.maApi.top, bottom: this.maApi.bottom, left: this.maApi.left, right: this.maApi.right };
      PutItem(rItemSet, 'ATTR_BORDER', aBoxItem, bSkipPoolDefs);
    }
    if (!this.mbDiagUsed) return;
    PutItem(rItemSet, 'ATTR_BORDER_TLBR', this.maApi.tlbr, bSkipPoolDefs);
    PutItem(rItemSet, 'ATTR_BORDER_BLTR', this.maApi.bltr, bSkipPoolDefs);
  }

  private getBorderLine(nElement: string): BorderLineModel | null {
    switch (nElement) {
      case 'left': case 'start': return this.maLeft;
      case 'right': case 'end': return this.maRight;
      case 'top': return this.maTop;
      case 'bottom': return this.maBottom;
      case 'diagonal': return this.maDiagonal;
    }
    return null;
  }

  /** convertBorderLine with SvxBoxItem::LineToSvxLine (no unit conversion): null for no line. */
  private convertBorderLine(rModel: BorderLineModel): SvxBorderLine | null {
    // Document: sc/qa/unit/data/README.cellborders
    const color = this.mrStyles.getColor(rModel.maColor, '#000000') ?? '#000000';
    let width = API_LINE_NONE;
    let style: SvxBorderLineStyle = 'solid';
    switch (rModel.mnStyle) {
      case 'dashDot': width = API_LINE_THIN; style = 'dash-dot'; break;
      case 'dashDotDot': width = API_LINE_THIN; style = 'dash-dot-dot'; break;
      case 'dashed': width = API_LINE_THIN; style = 'fine-dashed'; break;
      case 'dotted': width = API_LINE_THIN; style = 'dotted'; break;
      // lclSetBorderLineWidth( rBorderLine, 10, 15, 10 ): the lines and the distance
      case 'double': width = 10 + 15 + 10; style = 'double-thin'; break;
      case 'hair': width = API_LINE_HAIR; break;
      case 'medium': width = API_LINE_MEDIUM; break;
      case 'mediumDashDot': width = API_LINE_MEDIUM; style = 'dash-dot'; break;
      case 'mediumDashDotDot': width = API_LINE_MEDIUM; style = 'dash-dot-dot'; break;
      case 'mediumDashed': width = API_LINE_MEDIUM; style = 'dashed'; break;
      case 'none': width = API_LINE_NONE; break;
      case 'slantDashDot': width = API_LINE_MEDIUM; style = 'fine-dashed'; break;
      case 'thick': width = API_LINE_THICK; break;
      case 'thin': width = API_LINE_THIN; break;
      default: width = API_LINE_NONE; break;
    }
    if (!rModel.mbUsed || width <= 0) return null;
    return { color, width, style };
  }
}

// Fill -----------------------------------------------------------------------

interface PatternFillModel { maPatternColor: XlsColor; maFillColor: XlsColor; mnPattern: string; mbPattColorUsed: boolean; mbFillColorUsed: boolean; mbPatternUsed: boolean }

const lclGetMixedColorComp = (nPatt: number, nFill: number, nAlpha: number) => Math.trunc(((nPatt - nFill) * nAlpha) / 0x80) + nFill;
function lclGetMixedColor(nPattColor: string, nFillColor: string, nAlpha: number): string {
  const p = parseInt(nPattColor.slice(1), 16), f = parseInt(nFillColor.slice(1), 16);
  const c = [16, 8, 0].map((s) => lclGetMixedColorComp((p >> s) & 0xff, (f >> s) & 0xff, nAlpha));
  return hex6((c[0]! << 16) | (c[1]! << 8) | c[2]!);
}

export class Fill {
  private mxPatternModel: PatternFillModel | null = null;
  private maGradientColors: { pos: number; color: XlsColor }[] | null = null;
  // ApiSolidFillData
  mbUsed = false;
  mnColor: string | null = null;
  mbTransparent = true;
  /** Not a plain or solid fill: the cell background is an approximation. */
  mbApproximated = false;
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer) { this.mrStyles = rStyles; }

  importFill(rFill: XmlElement): void {
    const p = kid(rFill, 'patternFill');
    if (p) {
      // importPatternFill
      const fg = new XlsColor(); fg.setIndexed(OOX_COLOR_WINDOWTEXT);
      const bg = new XlsColor(); bg.setIndexed(OOX_COLOR_WINDOWBACK);
      this.mxPatternModel = { maPatternColor: fg, maFillColor: bg, mnPattern: attrs(p).getToken('patternType', 'none'), mbPattColorUsed: true, mbFillColorUsed: true, mbPatternUsed: true };
      const f = kid(p, 'fgColor'), b = kid(p, 'bgColor');
      if (f) { this.mxPatternModel.maPatternColor.importColor(attrs(f)); this.mxPatternModel.mbPattColorUsed = true; }
      if (b) { this.mxPatternModel.maFillColor.importColor(attrs(b)); this.mxPatternModel.mbFillColorUsed = true; }
    }
    const g = kid(rFill, 'gradientFill');
    if (g) {
      this.maGradientColors = [];
      for (const s of kids(g, 'stop')) {
        const fPosition = attrs(s).getDouble('position', -1);
        const c = kid(s, 'color');
        if (c && fPosition >= 0) { const x = new XlsColor(); x.importColor(attrs(c)); this.maGradientColors.push({ pos: fPosition, color: x }); }
      }
      this.maGradientColors.sort((a, b) => a.pos - b.pos);
    }
  }

  finalizeImport(): void {
    if (this.mxPatternModel) {
      const rModel = this.mxPatternModel;
      // convert to API fill settings
      this.mbUsed = rModel.mbPatternUsed;
      if (rModel.mnPattern === 'none') {
        this.mnColor = null;
        this.mbTransparent = true;
      } else {
        let nAlpha = 0x80;
        switch (rModel.mnPattern) {
          case 'darkDown': nAlpha = 0x40; break;
          case 'darkGray': nAlpha = 0x60; break;
          case 'darkGrid': nAlpha = 0x40; break;
          case 'darkHorizontal': nAlpha = 0x40; break;
          case 'darkTrellis': nAlpha = 0x60; break;
          case 'darkUp': nAlpha = 0x40; break;
          case 'darkVertical': nAlpha = 0x40; break;
          case 'gray0625': nAlpha = 0x08; break;
          case 'gray125': nAlpha = 0x10; break;
          case 'lightDown': nAlpha = 0x20; break;
          case 'lightGray': nAlpha = 0x20; break;
          case 'lightGrid': nAlpha = 0x38; break;
          case 'lightHorizontal': nAlpha = 0x20; break;
          case 'lightTrellis': nAlpha = 0x30; break;
          case 'lightUp': nAlpha = 0x20; break;
          case 'lightVertical': nAlpha = 0x20; break;
          case 'mediumGray': nAlpha = 0x40; break;
          case 'solid': nAlpha = 0x80; break;
        }
        if (!rModel.mbPattColorUsed) rModel.maPatternColor.setAuto();
        const nPattColor = this.mrStyles.getColor(rModel.maPatternColor, SYSTEM_COLORS.windowText) ?? SYSTEM_COLORS.windowText;
        if (!rModel.mbFillColorUsed) rModel.maFillColor.setAuto();
        const nFillColor = this.mrStyles.getColor(rModel.maFillColor, SYSTEM_COLORS.window) ?? SYSTEM_COLORS.window;
        this.mnColor = lclGetMixedColor(nPattColor, nFillColor, nAlpha);
        this.mbTransparent = false;
        this.mbApproximated = rModel.mnPattern !== 'solid';
      }
    } else if (this.maGradientColors && this.maGradientColors.length) {
      this.mbUsed = true; // no support for differential attributes
      const [a, b] = this.maGradientColors;
      this.mnColor = this.mrStyles.getColor(a!.color, '#ffffff') ?? '#ffffff';
      if (b) {
        const nEndColor = this.mrStyles.getColor(b.color, '#ffffff') ?? '#ffffff';
        this.mnColor = lclGetMixedColor(this.mnColor, nEndColor, 0x40);
        this.mbTransparent = false;
      }
      this.mbApproximated = true;
    }
  }

  fillToItemSet(rItemSet: ScItemSet, bSkipPoolDefs: boolean): void {
    if (!this.mbUsed) return;
    PutItem(rItemSet, 'ATTR_BACKGROUND', this.mbTransparent ? null : this.mnColor, bSkipPoolDefs);
  }
}

// Xf -------------------------------------------------------------------------

export interface XfModel {
  mnStyleXfId: number; mnFontId: number; mnNumFmtId: number; mnBorderId: number; mnFillId: number; mbCellXf: boolean;
  mbFontUsed: boolean; mbNumFmtUsed: boolean; mbAlignUsed: boolean; mbProtUsed: boolean; mbBorderUsed: boolean; mbAreaUsed: boolean;
}

export class Xf {
  maModel: XfModel = { mnStyleXfId: -1, mnFontId: -1, mnNumFmtId: -1, mnBorderId: -1, mnFillId: -1, mbCellXf: true, mbFontUsed: false, mbNumFmtUsed: false, mbAlignUsed: false, mbProtUsed: false, mbBorderUsed: false, mbAreaUsed: false };
  maAlignment: Alignment;
  maProtection = new Protection();
  private mpPattern: ScItemSet | null = null;
  private mpStyleSheet: ScStyleSheet | null = null;
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer) {
    this.mrStyles = rStyles;
    this.maAlignment = new Alignment(rStyles);
  }

  importXf(rXf: XmlElement, bCellXf: boolean): void {
    const rAttribs = attrs(rXf);
    this.maModel.mbCellXf = bCellXf;
    // tdf#70565 Set proper default value to "0" of xfId attribute
    // When xfId is not exist during .xlsx import
    // it must have values set to "0".
    let bApplyDefault: boolean;
    if (this.maModel.mbCellXf) {
      const xfId = rAttribs.getInteger('xfId', -1);
      // No xfId => no cellStyleXfs that could overwrite this on change, thus
      // has to be applied.
      bApplyDefault = (xfId < 0);
      this.maModel.mnStyleXfId = Math.max(0, xfId);
    } else {
      this.maModel.mnStyleXfId = rAttribs.getInteger('xfId', -1);
      bApplyDefault = true;
    }
    this.maModel.mnFontId = rAttribs.getInteger('fontId', -1);
    this.maModel.mnNumFmtId = rAttribs.getInteger('numFmtId', -1);
    this.maModel.mnBorderId = rAttribs.getInteger('borderId', -1);
    this.maModel.mnFillId = rAttribs.getInteger('fillId', -1);

    // So for reading documents this is all crap and effectively xf records
    // apply their explicit properties by default unless denied.
    // bApplyDefault==false only for cellXf xf with xfId.

    // For cellXf xf, mbAlignUsed and mbProtUsed will be set when actually
    // importing the element.
    this.maModel.mbAlignUsed = rAttribs.getBool('applyAlignment', bApplyDefault);
    this.maModel.mbProtUsed = rAttribs.getBool('applyProtection', bApplyDefault);

    this.maModel.mbFontUsed = rAttribs.getBool('applyFont', bApplyDefault || this.maModel.mnFontId > 0);
    this.maModel.mbNumFmtUsed = rAttribs.getBool('applyNumberFormat', bApplyDefault || this.maModel.mnNumFmtId > 0);
    this.maModel.mbBorderUsed = rAttribs.getBool('applyBorder', bApplyDefault || this.maModel.mnBorderId > 0);
    this.maModel.mbAreaUsed = rAttribs.getBool('applyFill', bApplyDefault || this.maModel.mnFillId > 0);

    for (const e of childElements(rXf)) {
      if (ln(e) === 'alignment') {
        this.maAlignment.importAlignment(attrs(e));
        if (this.maModel.mbCellXf) this.maModel.mbAlignUsed = true;
      } else if (ln(e) === 'protection') {
        this.maProtection.importProtection(attrs(e));
        if (this.maModel.mbCellXf) this.maModel.mbProtUsed = true;
      }
    }
  }

  finalizeImport(): void {
    // alignment and protection
    this.maAlignment.finalizeImport();
  }

  isCellXf(): boolean { return this.maModel.mbCellXf; }
  getFont(): Font | null { return this.mrStyles.getFont(this.maModel.mnFontId); }
  getAlignment(): Alignment { return this.maAlignment; }

  /** The cell style of a cell XF (created on demand). */
  getStyleSheet(): ScStyleSheet | null {
    if (this.isCellXf() && !this.mpStyleSheet) {
      this.mrStyles.createCellStyle(this.maModel.mnStyleXfId);
      this.mpStyleSheet = this.mrStyles.getCellStyleSheet(this.maModel.mnStyleXfId) ?? this.mrStyles.getDoc().GetStyleSheetPool().Find(STR_STYLENAME_STANDARD, SfxStyleFamily.Para);
    }
    return this.mpStyleSheet;
  }

  /** createPattern: the item set of the XF. */
  createPattern(bSkipPoolDefs = false): ScItemSet {
    if (this.mpPattern) return this.mpPattern;
    const rItemSet: ScItemSet = {};
    this.mpPattern = rItemSet;
    /*  Enables the used flags, if the formatting attributes differ from the
        style XF. In cell XFs Excel uses the cell attributes, if they differ
        from the parent style XF (even if the used flag is switched off).
        #109899# ...or if the respective flag is not set in parent style XF.
     */
    const rStyles = this.mrStyles;
    const pStyleXf = this.isCellXf() ? rStyles.getStyleXf(this.maModel.mnStyleXfId) : null;
    if (pStyleXf && !this.mpStyleSheet) {
      this.getStyleSheet();
      const rStyleData = pStyleXf.maModel;
      if (!this.maModel.mbFontUsed) this.maModel.mbFontUsed = !rStyleData.mbFontUsed || (this.maModel.mnFontId !== rStyleData.mnFontId);
      if (!this.maModel.mbNumFmtUsed) this.maModel.mbNumFmtUsed = !rStyleData.mbNumFmtUsed || (this.maModel.mnNumFmtId !== rStyleData.mnNumFmtId);
      if (!this.maModel.mbAlignUsed) this.maModel.mbAlignUsed = !rStyleData.mbAlignUsed || !this.maAlignment.equalsApi(pStyleXf.maAlignment);
      if (!this.maModel.mbProtUsed) this.maModel.mbProtUsed = !rStyleData.mbProtUsed || !this.maProtection.equalsApi(pStyleXf.maProtection);
      if (!this.maModel.mbBorderUsed) this.maModel.mbBorderUsed = !rStyleData.mbBorderUsed || this.maModel.mnBorderId !== rStyleData.mnBorderId;
      if (!this.maModel.mbAreaUsed) this.maModel.mbAreaUsed = !rStyleData.mbAreaUsed || this.maModel.mnFillId !== rStyleData.mnFillId;
    }
    // cell protection
    if (this.maModel.mbProtUsed) this.maProtection.fillToItemSet(rItemSet, bSkipPoolDefs);
    // font
    if (this.maModel.mbFontUsed) rStyles.writeFontToItemSet(rItemSet, this.maModel.mnFontId, bSkipPoolDefs);
    // value format
    if (this.maModel.mbNumFmtUsed) rStyles.writeNumFmtToItemSet(rItemSet, this.maModel.mnNumFmtId, bSkipPoolDefs);
    // alignment
    if (this.maModel.mbAlignUsed) this.maAlignment.fillToItemSet(rItemSet, bSkipPoolDefs);
    // border
    if (this.maModel.mbBorderUsed) rStyles.writeBorderToItemSet(rItemSet, this.maModel.mnBorderId, bSkipPoolDefs);
    // area
    if (this.maModel.mbAreaUsed) rStyles.writeFillToItemSet(rItemSet, this.maModel.mnFillId, bSkipPoolDefs);

    /*  #i38709# Decide which rotation reference mode to use. If any outer
        border line of the cell is set (either explicitly or via cell style),
        and the cell contents are rotated, set rotation reference to bottom of
        cell. This causes the borders to be painted rotated with the text. */
    const pAlignment = this.maModel.mbAlignUsed ? this.maAlignment : (pStyleXf ? pStyleXf.maAlignment : null);
    if (pAlignment) {
      let eRotateMode: 'STANDARD' | 'BOTTOM' = 'STANDARD';
      const nBorderId = this.maModel.mbBorderUsed ? this.maModel.mnBorderId : (pStyleXf ? pStyleXf.maModel.mnBorderId : -1);
      const pBorder = rStyles.getBorder(nBorderId);
      if (pBorder && pAlignment.mnRotation && pBorder.hasAnyOuterBorder()) eRotateMode = 'BOTTOM';
      PutItem(rItemSet, 'ATTR_ROTATE_MODE', eRotateMode, bSkipPoolDefs);
    }
    return rItemSet;
  }
}

// Cell styles ----------------------------------------------------------------

const sppcStyleNames: (string | null)[] = [
  'Normal',
  'RowLevel_', // outline level will be appended
  'ColLevel_', // outline level will be appended
  'Comma',
  'Currency',
  'Percent',
  'Comma [0]', // new in BIFF4
  'Currency [0]',
  'Hyperlink', // new in BIFF8
  'Followed Hyperlink',
  'Note', // new in OOX
  'Warning Text',
  null,
  null,
  null,
  'Title',
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Heading 4',
  'Input',
  'Output',
  'Calculation',
  'Check Cell',
  'Linked Cell',
  'Total',
  'Good',
  'Bad',
  'Neutral',
  'Accent1',
  '20% - Accent1',
  '40% - Accent1',
  '60% - Accent1',
  'Accent2',
  '20% - Accent2',
  '40% - Accent2',
  '60% - Accent2',
  'Accent3',
  '20% - Accent3',
  '40% - Accent3',
  '60% - Accent3',
  'Accent4',
  '20% - Accent4',
  '40% - Accent4',
  '60% - Accent4',
  'Accent5',
  '20% - Accent5',
  '40% - Accent5',
  '60% - Accent5',
  'Accent6',
  '20% - Accent6',
  '40% - Accent6',
  '60% - Accent6',
  'Explanatory Text',
];

export function lclGetBuiltinStyleName(nBuiltinId: number, rName: string, nLevel = 0): string {
  let aStyleName = 'Excel Built-in ';
  if ((0 <= nBuiltinId) && (nBuiltinId < sppcStyleNames.length) && (sppcStyleNames[nBuiltinId] !== null)) aStyleName += sppcStyleNames[nBuiltinId];
  else if (rName) aStyleName += rName;
  else aStyleName += String(nBuiltinId);
  if ((nBuiltinId === OOX_STYLE_ROWLEVEL) || (nBuiltinId === OOX_STYLE_COLLEVEL)) aStyleName += String(nLevel);
  return aStyleName;
}

interface CellStyleModel { maName: string; mnXfId: number; mnBuiltinId: number; mnLevel: number; mbBuiltin: boolean; mbCustom: boolean; mbHidden: boolean }
const isBuiltin = (m: CellStyleModel) => m.mbBuiltin && (m.mnBuiltinId >= 0);
const isDefaultStyle = (m: CellStyleModel) => m.mbBuiltin && (m.mnBuiltinId === OOX_STYLE_NORMAL);
const lclCreateStyleName = (rModel: CellStyleModel) => (rModel.mbBuiltin ? lclGetBuiltinStyleName(rModel.mnBuiltinId, rModel.maName, rModel.mnLevel) : rModel.maName);

export class CellStyle {
  maModel: CellStyleModel;
  private maFinalName = '';
  private mbCreated = false;
  private mpStyleSheet: ScStyleSheet | null = null;
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer, rAttribs: AttributeList) {
    this.mrStyles = rStyles;
    this.maModel = {
      maName: rAttribs.getXString('name', '')!,
      mnXfId: rAttribs.getInteger('xfId', -1),
      mnBuiltinId: rAttribs.getInteger('builtinId', -1),
      mnLevel: rAttribs.getInteger('iLevel', 0),
      mbBuiltin: rAttribs.hasAttribute('builtinId'),
      mbCustom: rAttribs.getBool('customBuiltin', false),
      mbHidden: rAttribs.getBool('hidden', false),
    };
  }

  getFinalStyleName(): string { return this.maFinalName; }
  getStyleSheet(): ScStyleSheet | null { return this.mpStyleSheet; }

  createCellStyle(): void {
    // #i1624# #i1768# ignore unnamed user styles
    const bDefStyle = isDefaultStyle(this.maModel);
    if (!this.mbCreated) {
      if (bDefStyle && !this.maFinalName) this.maFinalName = STR_STYLENAME_STANDARD;
      this.mbCreated = !this.maFinalName;
    }
    if (this.mbCreated || this.mpStyleSheet) return;

    let bCreatePattern = false;
    const pXF = this.mrStyles.getStyleXf(this.maModel.mnXfId);
    const rPool = this.mrStyles.getDoc().GetStyleSheetPool();

    if (bDefStyle) {
      // use existing "Default" style sheet
      this.mpStyleSheet = rPool.Find(STR_STYLENAME_STANDARD, SfxStyleFamily.Para);
      bCreatePattern = true;
    } else {
      this.mpStyleSheet = rPool.Find(this.maFinalName, SfxStyleFamily.Para);
      if (!this.mpStyleSheet) {
        this.mpStyleSheet = rPool.Make(this.maFinalName, SfxStyleFamily.Para);
        bCreatePattern = true;
      }
    }

    // bDefStyle==true omits default pool items in CreatePattern()
    if (bCreatePattern && this.mpStyleSheet && pXF) this.mpStyleSheet.SetItemSet({ ...this.mpStyleSheet.GetItemSet(), ...pXF.createPattern(bDefStyle) });
  }

  finalizeImport(rFinalName: string): void {
    this.maFinalName = rFinalName;
    if (!isBuiltin(this.maModel) || this.maModel.mbCustom) this.createCellStyle();
  }
}

export class CellStyleBuffer {
  private maBuiltinStyles: CellStyle[] = [];
  private maUserStyles: CellStyle[] = [];
  private maStylesByXf = new Map<number, CellStyle>();
  private mxDefStyle: CellStyle | null = null;
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer) { this.mrStyles = rStyles; }

  importCellStyle(rAttribs: AttributeList): CellStyle {
    const xCellStyle = new CellStyle(this.mrStyles, rAttribs);
    this.insertCellStyle(xCellStyle);
    return xCellStyle;
  }

  finalizeImport(): void {
    // calculate final names of all styles
    const aCellStyles = new Map<string, { key: string; style: CellStyle | null }>(); // by upper case name
    const aConflictNameStyles: CellStyle[] = [];

    /*  First, reserve style names that are built-in in Calc. This causes that
        imported cell styles get different unused names and thus do not try to
        overwrite these built-in styles. */
    for (const xStyle of this.mrStyles.getDoc().GetStyleSheetPool().GetStyles(SfxStyleFamily.Para)) {
      if (!xStyle.IsUserDefined()) aCellStyles.set(xStyle.GetName().toUpperCase(), { key: xStyle.GetName(), style: null });
    }

    /*  Calculate names of built-in styles. Store styles with reserved names
        in the aConflictNameStyles list. */
    for (const rxStyle of this.maBuiltinStyles) {
      const rModel = rxStyle.maModel;
      if (isDefaultStyle(rModel)) continue;
      const aStyleName = lclCreateStyleName(rModel);
      /*  If a builtin style entry already exists,
          we just stick with the last definition and ignore
          the preceding ones. */
      aCellStyles.set(aStyleName.toUpperCase(), { key: aStyleName, style: rxStyle });
    }

    /*  Calculate names of user defined styles. Store styles with reserved
        names in the aConflictNameStyles list. */
    for (const rxStyle of this.maUserStyles) {
      const aStyleName = lclCreateStyleName(rxStyle.maModel);
      // #i1624# #i1768# ignore unnamed user styles
      if (aStyleName.length > 0) {
        if (aCellStyles.has(aStyleName.toUpperCase())) aConflictNameStyles.push(rxStyle);
        else aCellStyles.set(aStyleName.toUpperCase(), { key: aStyleName, style: rxStyle });
      }
    }

    // find unused names for all styles with conflicting names
    // having the index counter outside the loop prevents performance problems with opening some pathological documents (tdf#62095)
    let nIndex = 0;
    for (const rxStyle of aConflictNameStyles) {
      const aStyleName = lclCreateStyleName(rxStyle.maModel);
      let aUnusedName: string;
      do {
        aUnusedName = `${aStyleName} ${++nIndex}`;
      } while (aCellStyles.has(aUnusedName.toUpperCase()));
      aCellStyles.set(aUnusedName.toUpperCase(), { key: aUnusedName, style: rxStyle });
    }

    // set final names and create user-defined and modified built-in cell styles
    for (const e of [...aCellStyles.values()].sort((a, b) => (a.key.toUpperCase() < b.key.toUpperCase() ? -1 : 1))) e.style?.finalizeImport(e.key);
  }

  getDefaultXfId(): number { return this.mxDefStyle ? this.mxDefStyle.maModel.mnXfId : -1; }

  /** getDefaultStyleName: creates the default cell style ("Default" with Normal's attributes). */
  getDefaultStyleName(): string { return this.mxDefStyle ? this.createCellStyle(this.mxDefStyle.maModel.mnXfId) : lclGetBuiltinStyleName(OOX_STYLE_NORMAL, ''); }

  createCellStyle(nXfId: number): string {
    const rxCellStyle = this.maStylesByXf.get(nXfId);
    if (rxCellStyle) {
      rxCellStyle.createCellStyle();
      const rStyleName = rxCellStyle.getFinalStyleName();
      if (rStyleName) return rStyleName;
    }
    // on error: fallback to default style
    return lclGetBuiltinStyleName(OOX_STYLE_NORMAL, '');
  }

  getCellStyleSheet(nXfId: number): ScStyleSheet | null {
    return this.maStylesByXf.get(nXfId)?.getStyleSheet() ?? null;
  }

  private insertCellStyle(xCellStyle: CellStyle): void {
    const rModel = xCellStyle.maModel;
    if (rModel.mnXfId < 0) return;
    // insert into the built-in map or user defined map
    (isBuiltin(rModel) ? this.maBuiltinStyles : this.maUserStyles).push(xCellStyle);
    // insert into the XF identifier map
    this.maStylesByXf.set(rModel.mnXfId, xCellStyle);
    // remember default cell style
    if (isDefaultStyle(rModel)) this.mxDefStyle = xCellStyle;
  }
}

// StylesBuffer ---------------------------------------------------------------

export class StylesBuffer {
  private readonly mrDoc: ScDocument;
  private readonly mrUnitConverter: UnitConverter;
  private readonly mrTheme: ThemeBuffer;
  private maPalette = new ColorPalette();
  private maNumFmts = new NumberFormatsBuffer();
  private maFonts: Font[] = [];
  private maBorders: Border[] = [];
  private maFills: Fill[] = [];
  private maCellXfs: Xf[] = [];
  private maStyleXfs: Xf[] = [];
  private maCellStyles: CellStyleBuffer;
  /** What the styles could not keep (reported by the caller). */
  readonly maLost = new Set<string>();
  private maPatternCache = new Map<number, ScPatternAttr>();
  private readonly maDefFontModel = { ...newFontModel(), maName: 'Calibri', mfHeight: 11, mnScheme: 'minor', mnFamily: 2 };

  constructor(rDoc: ScDocument, rUnitConverter: UnitConverter, rTheme: ThemeBuffer) {
    this.mrDoc = rDoc;
    this.mrUnitConverter = rUnitConverter;
    this.mrTheme = rTheme;
    this.maCellStyles = new CellStyleBuffer(this);
  }

  getDoc(): ScDocument { return this.mrDoc; }
  getUnitConverter(): UnitConverter { return this.mrUnitConverter; }

  /** StylesFragment: the elements of styles.xml. */
  importStyles(rStyleSheet: XmlElement | undefined): void {
    for (const e of kids(rStyleSheet)) {
      switch (ln(e)) {
        case 'colors':
          for (const c of kids(kid(e, 'indexedColors'), 'rgbColor')) this.maPalette.importPaletteColor(attrs(c));
          break;
        case 'numFmts':
          for (const c of kids(e, 'numFmt')) this.maNumFmts.importNumFmt(c.attrs);
          break;
        case 'fonts':
          for (const c of kids(e, 'font')) { const x = new Font(this, false); this.maFonts.push(x); x.importFont(c); }
          break;
        case 'borders':
          for (const c of kids(e, 'border')) { const x = new Border(this, false); this.maBorders.push(x); x.importBorder(c); }
          break;
        case 'fills':
          for (const c of kids(e, 'fill')) { const x = new Fill(this); this.maFills.push(x); x.importFill(c); }
          break;
        case 'cellXfs':
          for (const c of kids(e, 'xf')) { const x = new Xf(this); this.maCellXfs.push(x); x.importXf(c, true); }
          break;
        case 'cellStyleXfs':
          for (const c of kids(e, 'xf')) { const x = new Xf(this); this.maStyleXfs.push(x); x.importXf(c, false); }
          break;
        case 'cellStyles':
          for (const c of kids(e, 'cellStyle')) this.maCellStyles.importCellStyle(attrs(c));
          break;
        case 'dxfs':
          // differential formats are used by conditional formatting and table styles only
          break;
      }
    }
  }

  finalizeImport(): void {
    // fonts first, are needed to finalize unit converter and XFs below
    for (const f of this.maFonts) f.finalizeImport();
    // finalize unit coefficients after default font is known
    const pDefFont = this.getDefaultFont();
    if (pDefFont) this.mrUnitConverter.finalizeImport(pDefFont.maModel.maName, pDefFont.mnHeight);
    // borders and fills
    // is there a document wide RTL setting that we
    // would/could need to pass to finalizeImport here ?
    for (const b of this.maBorders) b.finalizeImport(false);
    for (const f of this.maFills) f.finalizeImport();
    // style XFs and cell XFs
    for (const x of this.maStyleXfs) x.finalizeImport();
    for (const x of this.maCellXfs) x.finalizeImport();
    // built-in and user defined cell styles
    this.maCellStyles.finalizeImport();
  }

  /** The colour of an XlsColor (Color::getColor): nAuto for automatic colours. */
  getColor(rColor: XlsColor, nAuto: string | null): string | null {
    let c: string | null;
    switch (rColor.meType) {
      case 'auto': return nAuto;
      case 'rgb': c = hex6(rColor.mnValue); break;
      case 'theme': {
        const spnColorTokens = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
        const tok = spnColorTokens[rColor.mnValue];
        c = (tok && this.mrTheme.maColors[tok]) ?? null;
        if (!c) return nAuto;
        break;
      }
      case 'indexed': c = this.maPalette.getColor(rColor.mnValue); if (c === null) return nAuto; break;
    }
    return applyTint(c, rColor.mfTint);
  }

  /** The registered cell pattern of a cell XF (ScPatternCache), made once. */
  getCellPattern(nXfId: number, fCreate: () => ScPatternAttr): ScPatternAttr {
    let p = this.maPatternCache.get(nXfId);
    if (!p) this.maPatternCache.set(nXfId, p = fCreate());
    return p;
  }

  getFont(nFontId: number): Font | null { return this.maFonts[nFontId] ?? null; }
  getBorder(nBorderId: number): Border | null { return this.maBorders[nBorderId] ?? null; }
  getCellXf(nXfId: number): Xf | null { return this.maCellXfs[nXfId] ?? null; }
  getStyleXf(nXfId: number): Xf | null { return this.maStyleXfs[nXfId] ?? null; }
  getFontFromCellXf(nXfId: number): Font | null { return this.getCellXf(nXfId)?.getFont() ?? null; }

  getDefaultFont(): Font | null {
    let xDefFont = this.getStyleXf(this.maCellStyles.getDefaultXfId())?.getFont() ?? null;
    // no font from styles - try first loaded font (e.g. BIFF2)
    if (!xDefFont) xDefFont = this.maFonts[0] ?? null;
    return xDefFont;
  }

  getDefaultFontModel(): FontModel {
    const xDefFont = this.getDefaultFont();
    return xDefFont ? xDefFont.maModel : this.maDefFontModel;
  }

  createCellStyle(nXfId: number): string { return this.maCellStyles.createCellStyle(nXfId); }
  getDefaultStyleName(): string { return this.maCellStyles.getDefaultStyleName(); }
  getCellStyleSheet(nXfId: number): ScStyleSheet | null { return this.maCellStyles.getCellStyleSheet(nXfId); }

  writeFontToItemSet(rItemSet: ScItemSet, nFontId: number, bSkipPoolDefs: boolean): void {
    this.maFonts[nFontId]?.fillToItemSet(rItemSet, bSkipPoolDefs);
  }

  writeNumFmtToItemSet(rItemSet: ScItemSet, nNumFmtId: number, bSkipPoolDefs: boolean): void {
    const aCode = this.maNumFmts.getFormatCode(nNumFmtId);
    if (aCode === undefined) return;
    PutItem(rItemSet, 'ATTR_VALUE_FORMAT', aCode, bSkipPoolDefs);
  }

  writeBorderToItemSet(rItemSet: ScItemSet, nBorderId: number, bSkipPoolDefs: boolean): void {
    this.maBorders[nBorderId]?.fillToItemSet(rItemSet, bSkipPoolDefs);
  }

  writeFillToItemSet(rItemSet: ScItemSet, nFillId: number, bSkipPoolDefs: boolean): void {
    const pFill = this.maFills[nFillId];
    if (!pFill) return;
    if (pFill.mbApproximated) this.maLost.add('Patterned and gradient cell backgrounds (shown as one colour)');
    pFill.fillToItemSet(rItemSet, bSkipPoolDefs);
  }
}
