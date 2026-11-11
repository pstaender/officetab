// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/rect.cxx partial
// @upstream starmath/inc/rect.hxx partial
// SmRect: a node's rectangle with its baseline, the alignment lines (top, middle, bottom), the
// glyph's ink top and bottom, italic spaces and the fences attributes are placed against.
// Coordinates are twips; right and bottom are inclusive as in tools::Rectangle. The printer
// branch of the text constructor (internal leading below 5) does not apply to the web device.
import type { SmDevice, SmFormat } from './format.ts';
import { DIS_ORNAMENTSIZE } from './format.ts';
import {
  MS_ALEPH, MS_EMPTYSET, MS_HBAR, MS_IM, MS_LAMBDABAR, MS_RE, MS_SETC, MS_SETN, MS_SETQ, MS_SETR, MS_SETZ, MS_WP,
  FONTNAME_MATH,
} from '../inc/types.ts';

export const SmFromTo = (nFrom: number, nTo: number, fRelDist: number): number => nFrom + Math.trunc(fRelDist * (nTo - nFrom));

export const RectPos = { Left: 0, Right: 1, Top: 2, Bottom: 3, Attribute: 4 } as const;
export type RectPos = (typeof RectPos)[keyof typeof RectPos];
export const RectHorAlign = { Left: 0, Center: 1, Right: 2 } as const;
export type RectHorAlign = (typeof RectHorAlign)[keyof typeof RectHorAlign];
export const RectVerAlign = { Top: 0, Mid: 1, Bottom: 2, Baseline: 3, CenterY: 4, AttributeHi: 5, AttributeMid: 6, AttributeLo: 7 } as const;
export type RectVerAlign = (typeof RectVerAlign)[keyof typeof RectVerAlign];
export const RectCopyMBL = {
  This: 0, // keep baseline of current object even if it has none
  Arg: 1, // as above but for the argument
  None: 2, // result will have no baseline
  Xor: 3, // if current object has a baseline keep it else copy
} as const;
export type RectCopyMBL = (typeof RectCopyMBL)[keyof typeof RectCopyMBL];

export interface Point { x: number; y: number }

/** SmGetGlyphBoundRect: the ink of rText, or its text cell. */
function SmGetGlyphBoundRect(rDev: SmDevice, rText: string): { left: number; top: number; right: number; bottom: number } {
  const nTextWidth = rDev.GetTextWidth(rText);
  const b = rDev.GetTextBoundRect(rText);
  if (b && b.right > b.left && b.bottom > b.top) return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right) - 1, bottom: Math.ceil(b.bottom) - 1 };
  return { left: 0, top: 0, right: nTextWidth - 1, bottom: rDev.GetTextHeight() - 1 };
}

const aMathAlpha = new Set([
  MS_ALEPH, MS_IM, MS_RE, MS_WP, 0xE070, MS_EMPTYSET, 0x2113, 0xE0D6, 0x2107, 0x2127, 0x210A, MS_HBAR,
  MS_LAMBDABAR, MS_SETN, MS_SETZ, MS_SETQ, MS_SETR, MS_SETC, 0x2373, 0xE0A5, 0x2112, 0x2130, 0x2131,
]);

function SmIsMathAlpha(aText: string): boolean {
  if (!aText) return false;
  const cChar = aText.charCodeAt(0);
  if (0xE0AC <= cChar && cChar <= 0xE0D4) return true;
  return aMathAlpha.has(cChar);
}

export class SmRect {
  aTopLeft: Point = { x: 0, y: 0 };
  aSize = { width: 0, height: 0 };
  nBaseline = 0;
  nAlignT = 0;
  nAlignM = 0;
  nAlignB = 0;
  nGlyphTop = 0;
  nGlyphBottom = 0;
  nItalicLeftSpace = 0;
  nItalicRightSpace = 0;
  nLoAttrFence = 0;
  nHiAttrFence = 0;
  nBorderWidth = 0;
  bHasBaseline = false;
  bHasAlignInfo = false;

  /** SmRect(nWidth, nHeight) */
  static Sized(nWidth: number, nHeight: number): SmRect {
    const r = new SmRect();
    r.aSize = { width: nWidth, height: nHeight };
    r.bHasAlignInfo = true;
    r.nAlignT = r.nGlyphTop = r.nHiAttrFence = r.GetTop();
    r.nAlignB = r.nGlyphBottom = r.nLoAttrFence = r.GetBottom();
    r.nAlignM = Math.trunc((r.nAlignT + r.nAlignB) / 2); // this is the default
    return r;
  }

  /** SmRect(const OutputDevice &rDev, const SmFormat *pFormat, const OUString &rText, sal_uInt16 nBorder) */
  static Text(rDev: SmDevice, pFormat: SmFormat | null, rText: string, nBorder: number): SmRect {
    const r = new SmRect();
    r.aSize = { width: rDev.GetTextWidth(rText), height: rDev.GetTextHeight() };
    const aFM = rDev.GetFontMetric();
    const bIsMath = rDev.font.name.toLowerCase() === FONTNAME_MATH.toLowerCase();
    const bAllowSmaller = bIsMath && !SmIsMathAlpha(rText);
    const nFontHeight = rDev.font.height;

    r.nBorderWidth = nBorder;
    r.bHasAlignInfo = true;
    r.bHasBaseline = true;
    r.nBaseline = aFM.ascent;
    r.nAlignT = r.nBaseline - Math.trunc((nFontHeight * 750) / 1000);
    r.nAlignM = r.nBaseline - Math.trunc((nFontHeight * 121) / 422);
    // that's where the horizontal bars of '+', '-', ... are
    // (1/3 of ascent over baseline)
    // (121 = 1/3 of 12pt ascent, 422 = 12pt fontheight)
    r.nAlignB = r.nBaseline;

    const aGlyphRect = SmGetGlyphBoundRect(rDev, rText);
    r.nItalicLeftSpace = r.GetLeft() - aGlyphRect.left + r.nBorderWidth;
    r.nItalicRightSpace = aGlyphRect.right - r.GetRight() + r.nBorderWidth;
    if (r.nItalicLeftSpace < 0 && !bAllowSmaller) r.nItalicLeftSpace = 0;
    if (r.nItalicRightSpace < 0 && !bAllowSmaller) r.nItalicRightSpace = 0;

    let nDist = 0;
    if (pFormat) nDist = Math.trunc((rDev.font.height * pFormat.GetDistance(DIS_ORNAMENTSIZE)) / 100);

    r.nHiAttrFence = aGlyphRect.top - 1 - r.nBorderWidth - nDist;
    r.nLoAttrFence = SmFromTo(r.GetAlignB(), r.GetBottom(), 0.0);

    r.nGlyphTop = aGlyphRect.top - r.nBorderWidth;
    r.nGlyphBottom = aGlyphRect.bottom + r.nBorderWidth;

    if (bAllowSmaller) {
      // for symbols and operators from the StarMath Font
      // we adjust upper and lower margin of the symbol
      r.SetTop(r.nGlyphTop);
      r.SetBottom(r.nGlyphBottom);
    }

    if (r.nHiAttrFence < r.GetTop()) r.nHiAttrFence = r.GetTop();
    if (r.nLoAttrFence > r.GetBottom()) r.nLoAttrFence = r.GetBottom();
    return r;
  }

  /** The copy assignment (SmRect::operator=). */
  assign(r: SmRect): this {
    this.aTopLeft = { ...r.aTopLeft };
    this.aSize = { ...r.aSize };
    this.nBaseline = r.nBaseline; this.nAlignT = r.nAlignT; this.nAlignM = r.nAlignM; this.nAlignB = r.nAlignB;
    this.nGlyphTop = r.nGlyphTop; this.nGlyphBottom = r.nGlyphBottom;
    this.nItalicLeftSpace = r.nItalicLeftSpace; this.nItalicRightSpace = r.nItalicRightSpace;
    this.nLoAttrFence = r.nLoAttrFence; this.nHiAttrFence = r.nHiAttrFence;
    this.nBorderWidth = r.nBorderWidth; this.bHasBaseline = r.bHasBaseline; this.bHasAlignInfo = r.bHasAlignInfo;
    return this;
  }

  /** A copy of the rectangle part (slicing a node to its SmRect). */
  GetRect(): SmRect { return new SmRect().assign(this); }

  CopyAlignInfo(rRect: SmRect): void {
    this.nBaseline = rRect.nBaseline;
    this.bHasBaseline = rRect.bHasBaseline;
    this.nAlignT = rRect.nAlignT;
    this.nAlignM = rRect.nAlignM;
    this.nAlignB = rRect.nAlignB;
    this.bHasAlignInfo = rRect.bHasAlignInfo;
    this.nLoAttrFence = rRect.nLoAttrFence;
    this.nHiAttrFence = rRect.nHiAttrFence;
  }

  CopyMBL(rRect: SmRect): void {
    this.nBaseline = rRect.nBaseline;
    this.bHasBaseline = rRect.bHasBaseline;
    this.nAlignM = rRect.nAlignM;
  }

  GetBorderWidth(): number { return this.nBorderWidth; }
  SetItalicSpaces(nLeftSpace: number, nRightSpace: number): void { this.nItalicLeftSpace = nLeftSpace; this.nItalicRightSpace = nRightSpace; }
  SetWidth(nWidth: number): void { this.aSize.width = nWidth; }

  SetLeft(nLeft: number): void {
    if (nLeft <= this.GetRight()) {
      this.aSize.width = this.GetRight() - nLeft + 1;
      this.aTopLeft.x = nLeft;
    }
  }
  SetRight(nRight: number): void { if (nRight >= this.GetLeft()) this.aSize.width = nRight - this.GetLeft() + 1; }
  SetBottom(nBottom: number): void { if (nBottom >= this.GetTop()) this.aSize.height = nBottom - this.GetTop() + 1; }
  SetTop(nTop: number): void {
    if (nTop <= this.GetBottom()) {
      this.aSize.height = this.GetBottom() - nTop + 1;
      this.aTopLeft.y = nTop;
    }
  }

  GetTopLeft(): Point { return this.aTopLeft; }
  GetTop(): number { return this.aTopLeft.y; }
  GetLeft(): number { return this.aTopLeft.x; }
  GetBottom(): number { return this.GetTop() + this.GetHeight() - 1; }
  GetRight(): number { return this.GetLeft() + this.GetWidth() - 1; }
  GetCenterY(): number { return Math.trunc((this.GetTop() + this.GetBottom()) / 2); }
  GetWidth(): number { return this.aSize.width; }
  GetHeight(): number { return this.aSize.height; }
  GetItalicLeftSpace(): number { return this.nItalicLeftSpace; }
  GetItalicRightSpace(): number { return this.nItalicRightSpace; }
  GetHiAttrFence(): number { return this.nHiAttrFence; }
  GetLoAttrFence(): number { return this.nLoAttrFence; }
  GetItalicLeft(): number { return this.GetLeft() - this.GetItalicLeftSpace(); }
  GetItalicCenterX(): number { return Math.trunc((this.GetItalicLeft() + this.GetItalicRight()) / 2); }
  GetItalicRight(): number { return this.GetRight() + this.GetItalicRightSpace(); }
  GetItalicWidth(): number { return this.GetWidth() + this.GetItalicLeftSpace() + this.GetItalicRightSpace(); }
  HasBaseline(): boolean { return this.bHasBaseline; }
  GetBaseline(): number { return this.nBaseline; }
  GetBaselineOffset(): number { return this.GetBaseline() - this.GetTop(); }
  GetAlignT(): number { return this.nAlignT; }
  GetAlignM(): number { return this.nAlignM; }
  GetAlignB(): number { return this.nAlignB; }
  GetSize(): { width: number; height: number } { return this.aSize; }
  IsEmpty(): boolean { return this.GetWidth() === 0 || this.GetHeight() === 0; }
  HasAlignInfo(): boolean { return this.bHasAlignInfo; }

  Move(rPosition: Point): void {
    this.aTopLeft = { x: this.aTopLeft.x + rPosition.x, y: this.aTopLeft.y + rPosition.y };
    const nDelta = rPosition.y;
    this.nBaseline += nDelta;
    this.nAlignT += nDelta;
    this.nAlignM += nDelta;
    this.nAlignB += nDelta;
    this.nGlyphTop += nDelta;
    this.nGlyphBottom += nDelta;
    this.nHiAttrFence += nDelta;
    this.nLoAttrFence += nDelta;
  }

  MoveTo(rPosition: Point): void { this.Move({ x: rPosition.x - this.aTopLeft.x, y: rPosition.y - this.aTopLeft.y }); }

  AlignTo(rRect: SmRect, ePos: RectPos, eHor: RectHorAlign, eVer: RectVerAlign): Point {
    const aPos = { ...this.GetTopLeft() };
    // will be the topleft point of the new rectangle position

    // set horizontal or vertical new rectangle position depending on ePos
    switch (ePos) {
      case RectPos.Left: aPos.x = rRect.GetItalicLeft() - this.GetItalicRightSpace() - this.GetWidth(); break;
      case RectPos.Right: aPos.x = rRect.GetItalicRight() + 1 + this.GetItalicLeftSpace(); break;
      case RectPos.Top: aPos.y = rRect.GetTop() - this.GetHeight(); break;
      case RectPos.Bottom: aPos.y = rRect.GetBottom() + 1; break;
      case RectPos.Attribute: aPos.x = rRect.GetItalicCenterX() - Math.trunc(this.GetItalicWidth() / 2) + this.GetItalicLeftSpace(); break;
    }

    // check if horizontal position is already set
    if (ePos === RectPos.Left || ePos === RectPos.Right || ePos === RectPos.Attribute) {
      // correct error in current vertical position
      switch (eVer) {
        case RectVerAlign.Top: aPos.y += rRect.GetAlignT() - this.GetAlignT(); break;
        case RectVerAlign.Mid: aPos.y += rRect.GetAlignM() - this.GetAlignM(); break;
        case RectVerAlign.Baseline:
          // align baselines if possible else align mid's
          if (this.HasBaseline() && rRect.HasBaseline()) aPos.y += rRect.GetBaseline() - this.GetBaseline();
          else aPos.y += rRect.GetAlignM() - this.GetAlignM();
          break;
        case RectVerAlign.Bottom: aPos.y += rRect.GetAlignB() - this.GetAlignB(); break;
        case RectVerAlign.CenterY: aPos.y += rRect.GetCenterY() - this.GetCenterY(); break;
        case RectVerAlign.AttributeHi: aPos.y += rRect.GetHiAttrFence() - this.GetBottom(); break;
        case RectVerAlign.AttributeMid: aPos.y += SmFromTo(rRect.GetAlignB(), rRect.GetAlignT(), 0.4) - this.GetCenterY(); break;
        case RectVerAlign.AttributeLo: aPos.y += rRect.GetLoAttrFence() - this.GetTop(); break;
      }
    }

    // check if vertical position is already set
    if (ePos === RectPos.Top || ePos === RectPos.Bottom) {
      // correct error in current horizontal position
      switch (eHor) {
        case RectHorAlign.Left: aPos.x += rRect.GetItalicLeft() - this.GetItalicLeft(); break;
        case RectHorAlign.Center: aPos.x += rRect.GetItalicCenterX() - this.GetItalicCenterX(); break;
        case RectHorAlign.Right: aPos.x += rRect.GetItalicRight() - this.GetItalicRight(); break;
      }
    }
    return aPos;
  }

  // set current rectangle to the union of itself and the rectangle 'rRect'.
  //! Italic correction is NOT taken into account here!
  Union(rRect: SmRect): void {
    if (rRect.IsEmpty()) return;
    let nL = rRect.GetLeft(), nR = rRect.GetRight(), nT = rRect.GetTop(), nB = rRect.GetBottom(), nGT = rRect.nGlyphTop, nGB = rRect.nGlyphBottom;
    if (!this.IsEmpty()) {
      let nTmp: number;
      if ((nTmp = this.GetLeft()) < nL) nL = nTmp;
      if ((nTmp = this.GetRight()) > nR) nR = nTmp;
      if ((nTmp = this.GetTop()) < nT) nT = nTmp;
      if ((nTmp = this.GetBottom()) > nB) nB = nTmp;
      if ((nTmp = this.nGlyphTop) < nGT) nGT = nTmp;
      if ((nTmp = this.nGlyphBottom) > nGB) nGB = nTmp;
    }
    this.SetLeft(nL);
    this.SetRight(nR);
    this.SetTop(nT);
    this.SetBottom(nB);
    this.nGlyphTop = nGT;
    this.nGlyphBottom = nGB;
  }

  /**
   * ExtendBy: the union of itself and 'rRect' with align values, baseline and italic spaces
   * adapted. With nNewAlignM the middle line is set to it; with bKeepVerAlignParams the vertical
   * alignment values and baseline are kept.
   */
  ExtendBy(rRect: SmRect, eCopyMode: RectCopyMBL, arg?: number | boolean): this {
    if (typeof arg === 'number') {
      this.ExtendBy(rRect, eCopyMode);
      this.nAlignM = arg;
      return this;
    }
    if (arg === true) {
      const nOldAlignT = this.GetAlignT(), nOldAlignM = this.GetAlignM(), nOldAlignB = this.GetAlignB(), nOldBaseline = this.nBaseline; //! depends not on 'HasBaseline'
      const bOldHasAlignInfo = this.HasAlignInfo();
      this.ExtendBy(rRect, eCopyMode);
      this.nAlignT = nOldAlignT;
      this.nAlignM = nOldAlignM;
      this.nAlignB = nOldAlignB;
      this.nBaseline = nOldBaseline;
      this.bHasAlignInfo = bOldHasAlignInfo;
      return this;
    }
    // get some values used for (italic) spaces adaptation
    // ! (need to be done before changing current SmRect) !
    const nL = Math.min(this.GetItalicLeft(), rRect.GetItalicLeft()), nR = Math.max(this.GetItalicRight(), rRect.GetItalicRight());

    this.Union(rRect);

    this.SetItalicSpaces(this.GetLeft() - nL, nR - this.GetRight());

    if (!this.HasAlignInfo()) this.CopyAlignInfo(rRect);
    else if (rRect.HasAlignInfo()) {
      this.nAlignT = Math.min(this.GetAlignT(), rRect.GetAlignT());
      this.nAlignB = Math.max(this.GetAlignB(), rRect.GetAlignB());
      this.nHiAttrFence = Math.min(this.GetHiAttrFence(), rRect.GetHiAttrFence());
      this.nLoAttrFence = Math.max(this.GetLoAttrFence(), rRect.GetLoAttrFence());
      switch (eCopyMode) {
        case RectCopyMBL.This: break; // already done
        case RectCopyMBL.Arg: this.CopyMBL(rRect); break;
        case RectCopyMBL.None:
          this.bHasBaseline = false;
          this.nAlignM = Math.trunc((this.nAlignT + this.nAlignB) / 2);
          break;
        case RectCopyMBL.Xor: if (!this.HasBaseline()) this.CopyMBL(rRect); break;
      }
    }
    return this;
  }

  IsInsideRect(rPoint: Point): boolean {
    return rPoint.y >= this.GetTop() && rPoint.y <= this.GetBottom() && rPoint.x >= this.GetLeft() && rPoint.x <= this.GetRight();
  }

  IsInsideItalicRect(rPoint: Point): boolean {
    return rPoint.y >= this.GetTop() && rPoint.y <= this.GetBottom() && rPoint.x >= this.GetItalicLeft() && rPoint.x <= this.GetItalicRight();
  }

  /** AsRectangle: the italic rectangle as left, top, width, height. */
  AsRectangle(): { x: number; y: number; width: number; height: number } {
    return { x: this.GetItalicLeft(), y: this.GetTop(), width: this.GetItalicWidth(), height: this.GetHeight() };
  }

  AsGlyphRect(): SmRect {
    const aRect = new SmRect().assign(this);
    aRect.SetTop(this.nGlyphTop);
    aRect.SetBottom(this.nGlyphBottom);
    return aRect;
  }
}
