// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/format.cxx partial
// @upstream starmath/inc/format.hxx partial
// @upstream starmath/source/utility.cxx partial
// @upstream starmath/inc/utility.hxx partial
// @upstream starmath/source/tmpdevice.cxx reduced
// SmFormat (the font, size and distance settings of a formula), SmFace (a font with a border width)
// and the reference device the formula is arranged on. The device measures with the layout's
// TextMeasurer in twips (SmMapUnit is MapTwip). A font with a width other than 0 is stretched
// horizontally by width / height, as vcl's text backends do.
import type { FontDesc, TextMeasurer } from '../../vcl/source/outdev/text.ts';
import { FONTNAME_MATH } from '../inc/types.ts';

export const FNTNAME_TIMES = 'Times New Roman';
export const FNTNAME_HELV = 'Helvetica';
export const FNTNAME_COUR = 'Courier';
export const FNTNAME_MATH = FONTNAME_MATH;

// symbolic names used as array indices
export const SIZ_TEXT = 0, SIZ_INDEX = 1, SIZ_FUNCTION = 2, SIZ_OPERATOR = 3, SIZ_LIMITS = 4;
// symbolic names used as array indices
export const FNT_VARIABLE = 0, FNT_FUNCTION = 1, FNT_NUMBER = 2, FNT_TEXT = 3, FNT_SERIF = 4, FNT_SANS = 5, FNT_FIXED = 6, FNT_MATH = 7;
export const FNT_END = 7;
// symbolic names used as array indices
export const DIS_HORIZONTAL = 0, DIS_VERTICAL = 1, DIS_ROOT = 2, DIS_SUPERSCRIPT = 3, DIS_SUBSCRIPT = 4,
  DIS_NUMERATOR = 5, DIS_DENOMINATOR = 6, DIS_FRACTION = 7, DIS_STROKEWIDTH = 8, DIS_UPPERLIMIT = 9,
  DIS_LOWERLIMIT = 10, DIS_BRACKETSIZE = 11, DIS_BRACKETSPACE = 12, DIS_MATRIXROW = 13, DIS_MATRIXCOL = 14,
  DIS_ORNAMENTSIZE = 15, DIS_ORNAMENTSPACE = 16, DIS_OPERATORSIZE = 17, DIS_OPERATORSPACE = 18,
  DIS_LEFTSPACE = 19, DIS_RIGHTSPACE = 20, DIS_TOPSPACE = 21, DIS_BOTTOMSPACE = 22, DIS_NORMALBRACKETSIZE = 23;

export const SmHorAlign = { Left: 0, Center: 1, Right: 2 } as const;
export type SmHorAlign = (typeof SmHorAlign)[keyof typeof SmHorAlign];

/** o3tl::convert(n, pt, twip) */
export const PtToTwip = (n: number): number => Math.round(n * 20);

/** vcl::Font with SmFace's border width; sizes in twips, color null for COL_AUTO. */
export class SmFace {
  name: string;
  width = 0;
  height: number;
  bold = false;
  italic = false;
  color: string | null = null;
  nBorderWidth = -1;

  constructor(rName = '', nHeight = 0) {
    this.name = rName;
    this.height = nHeight;
    this.SetSize(this.width, this.height);
  }

  clone(): SmFace {
    const f = new SmFace(this.name, this.height);
    f.width = this.width; f.bold = this.bold; f.italic = this.italic; f.color = this.color;
    return f; // operator= resets the border width
  }

  GetFontSize(): { width: number; height: number } { return { width: this.width, height: this.height }; }

  SetSize(nWidth: number, nHeight: number): void {
    // check the requested size against minimum value
    const nMinVal = PtToTwip(2);
    if (nHeight < nMinVal) nHeight = nMinVal;
    //! we don't force a maximum value here because this may prevent eg the
    //! parentheses in "left ( ... right )" from matching up with large
    //! bodies (eg stack{...} with many entries).
    this.width = nWidth;
    this.height = nHeight;
  }

  SetBorderWidth(nWidth: number): void { this.nBorderWidth = nWidth; }
  GetBorderWidth(): number { return this.nBorderWidth < 0 ? this.GetDefaultBorderWidth() : this.nBorderWidth; }
  GetDefaultBorderWidth(): number { return Math.trunc(this.height / 20); }
  FreezeBorderWidth(): void { this.nBorderWidth = this.GetDefaultBorderWidth(); }

  /** operator *= (SmFace&, const Fraction&): scales width and height. */
  scale(rFrac: number): this {
    this.SetSize(Math.trunc(this.width * rFrac), Math.trunc(this.height * rFrac));
    return this;
  }
}

export const IsItalic = (rFont: SmFace): boolean => rFont.italic;
export const IsBold = (rFont: SmFace): boolean => rFont.bold;

export class SmFormat {
  vFont: SmFace[] = [];
  aBaseSize = { width: 0, height: PtToTwip(12) };
  vSize: number[] = [];
  vDist: number[] = [];
  eHorAlign: SmHorAlign = SmHorAlign.Center;
  nGreekCharStyle = 0;
  bIsTextmode = false;
  bIsRightToLeft = false;
  bScaleNormalBrackets = false;

  constructor() {
    this.vSize[SIZ_TEXT] = 100;
    this.vSize[SIZ_INDEX] = 60;
    this.vSize[SIZ_FUNCTION] = this.vSize[SIZ_OPERATOR] = 100;
    this.vSize[SIZ_LIMITS] = 60;

    const d = this.vDist;
    d[DIS_HORIZONTAL] = 10;
    d[DIS_VERTICAL] = 5;
    d[DIS_ROOT] = 0;
    d[DIS_SUPERSCRIPT] = d[DIS_SUBSCRIPT] = 20;
    d[DIS_NUMERATOR] = d[DIS_DENOMINATOR] = 0;
    d[DIS_FRACTION] = 10;
    d[DIS_STROKEWIDTH] = 5;
    d[DIS_UPPERLIMIT] = d[DIS_LOWERLIMIT] = 0;
    d[DIS_BRACKETSIZE] = d[DIS_BRACKETSPACE] = 5;
    d[DIS_MATRIXROW] = 3;
    d[DIS_MATRIXCOL] = 30;
    d[DIS_ORNAMENTSIZE] = d[DIS_ORNAMENTSPACE] = 0;
    d[DIS_OPERATORSIZE] = 50;
    d[DIS_OPERATORSPACE] = 20;
    d[DIS_LEFTSPACE] = d[DIS_RIGHTSPACE] = 0;
    d[DIS_TOPSPACE] = d[DIS_BOTTOMSPACE] = d[DIS_NORMALBRACKETSIZE] = 0;

    const h = this.aBaseSize.height;
    for (const i of [FNT_VARIABLE, FNT_FUNCTION, FNT_NUMBER, FNT_TEXT, FNT_SERIF]) this.vFont[i] = new SmFace(FNTNAME_TIMES, h);
    this.vFont[FNT_SANS] = new SmFace(FNTNAME_HELV, h);
    this.vFont[FNT_FIXED] = new SmFace(FNTNAME_COUR, h);
    this.vFont[FNT_MATH] = new SmFace(FNTNAME_MATH, h);
    this.vFont[FNT_VARIABLE]!.italic = true;
  }

  GetBaseSize(): { width: number; height: number } { return this.aBaseSize; }
  /** SetBaseSize, with the fonts' sizes as SmDocShell's "BaseFontHeight" property sets them. */
  SetBaseSize(nHeight: number): void {
    this.aBaseSize = { width: 0, height: nHeight };
    for (const f of this.vFont) f.SetSize(0, nHeight);
  }
  GetFont(nIdent: number): SmFace { return this.vFont[nIdent]!; }
  GetRelSize(nIdent: number): number { return this.vSize[nIdent]!; }
  GetDistance(nIdent: number): number { return this.vDist[nIdent]!; }
  GetHorAlign(): SmHorAlign { return this.eHorAlign; }
  IsTextmode(): boolean { return this.bIsTextmode; }
  IsRightToLeft(): boolean { return this.bIsRightToLeft; }
  GetGreekCharStyle(): number { return this.nGreekCharStyle; }
  IsScaleNormalBrackets(): boolean { return this.bScaleNormalBrackets; }
}

/** A glyph bound rectangle relative to the text's top left corner (vcl's ALIGN_TOP). */
export interface BoundRect { left: number; top: number; right: number; bottom: number }

/**
 * The OutputDevice the formula is arranged on (SmTmpDevice): it holds a font and measures text
 * with it.
 */
export class SmDevice {
  readonly m: TextMeasurer;
  font = new SmFace();
  constructor(m: TextMeasurer) { this.m = m; }

  SetFont(rFont: SmFace): void { this.font = rFont.clone(); this.font.nBorderWidth = rFont.nBorderWidth; }

  /** The font as the measurer takes it, and the horizontal stretch of its width. */
  desc(): { d: FontDesc; sx: number } {
    const f = this.font;
    return { d: { family: f.name, size: f.height, bold: f.bold, italic: f.italic }, sx: f.width ? f.width / f.height : 1 };
  }

  GetTextWidth(rText: string): number {
    const { d, sx } = this.desc();
    return Math.round(this.m.GetTextWidth(d, rText) * sx);
  }

  GetFontMetric(): { ascent: number; descent: number } { return this.m.GetFontMetric(this.desc().d); }
  GetTextHeight(): number { const fm = this.GetFontMetric(); return fm.ascent + fm.descent; }

  /** GetTextBoundRect: the glyphs' ink, relative to the top left of the text cell. */
  GetTextBoundRect(rText: string): BoundRect | null {
    const { d, sx } = this.desc();
    const asc = this.GetFontMetric().ascent;
    const b = this.m.GetTextBoundRect?.(d, rText);
    if (!b) return null;
    return { left: Math.round(b.left * sx), right: Math.round(b.right * sx), top: asc + Math.round(b.top), bottom: asc + Math.round(b.bottom) };
  }
}
