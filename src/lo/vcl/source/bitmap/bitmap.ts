// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/bitmap.cxx reduced
// @upstream include/vcl/bitmap/BitmapTypes.hxx partial
// @upstream vcl/inc/bitmap/impoctree.hxx faithful
// The parts of Bitmap the graphic filters need, on RGBA buffers: the pixel format (HasAlpha),
// ImplMakeGreyscales and Convert(BmpConversion::N8BitColors), i.e. ImplConvertDown8BPP with its
// error diffusion (ImpErrorQuad). Their results are 8 bit palette bitmaps (PaletteBitmap).
// Left out: backend conversions (SalBitmap), the palette input branches (the input is always
// 24 or 32 bit), the pExtColor parameter, preferred size and map mode, and the other conversions.
// Modify applies a colour modifier stack. GetContour (with DetectEdges) traces a contour polygon.
// A buffer stands for a 24 bit bitmap when it is opaque everywhere and for a 32 bit bitmap with
// alpha otherwise; 24 bit pixels are read as upstream's N24BitTcBgr/Rgb scanlines, 32 bit pixels
// through GetPixelFromData (their colour is not premultiplied here, so no rounding is lost).
import type { BitmapBuffer } from './bitmapfilter.ts';
import { BitmapColor, BitmapPalette, GetGreyPalette256 } from './bitmappalette.ts';
import { InverseColorMap, Octree } from './Octree.ts';
import type { BColorModifierStack } from '../../../basegfx/source/color/bcolormodifier.ts';

export const PixelFormat = {
  N8_BPP: 8,
  N24_BPP: 24,
  N32_BPP: 32,
} as const;
export type PixelFormat = (typeof PixelFormat)[keyof typeof PixelFormat];

export function numberOfColors(ePixelFormat: PixelFormat): number {
  return 2 ** ePixelFormat;
}

export function pixelFormatBitCount(ePixelFormat: PixelFormat): number {
  return ePixelFormat;
}

/** Bitmap::HasAlpha: a 32 bit bitmap with an alpha channel. */
export function HasAlpha(rBitmap: BitmapBuffer): boolean {
  const pData = rBitmap.data;
  for (let i = 3; i < pData.length; i += 4) if (pData[i] !== 255) return true;
  return false;
}

/** Bitmap::getPixelFormat of the bitmap the buffer stands for. */
export function getPixelFormat(rBitmap: BitmapBuffer): PixelFormat {
  return HasAlpha(rBitmap) ? PixelFormat.N32_BPP : PixelFormat.N24_BPP;
}

/** BitmapReadAccess::GetPixel / GetColor of a 24 or 32 bit buffer. */
export function GetPixel(rBitmap: BitmapBuffer, nY: number, nX: number): BitmapColor {
  const p = (nY * rBitmap.width + nX) * 4;
  const pData = rBitmap.data;
  return new BitmapColor(pData[p], pData[p + 1], pData[p + 2], pData[p + 3]);
}

/** A Bitmap with vcl::PixelFormat::N8_BPP: one palette index per pixel. */
export interface PaletteBitmap {
  width: number;
  height: number;
  indices: Uint8Array;
  palette: BitmapPalette;
}

export function CreatePaletteBitmap(nWidth: number, nHeight: number, rPal: BitmapPalette): PaletteBitmap {
  return { width: nWidth, height: nHeight, indices: new Uint8Array(nWidth * nHeight), palette: rPal.clone() };
}

/** The palette bitmap as an RGBA buffer. An 8 bit bitmap has no alpha, so it is opaque. */
export function PaletteBitmapToBuffer(rBitmap: PaletteBitmap): BitmapBuffer {
  const aData = new Uint8ClampedArray(rBitmap.width * rBitmap.height * 4);
  const aPal = rBitmap.palette;
  for (let i = 0, n = rBitmap.indices.length; i < n; i++) {
    const nIndex = rBitmap.indices[i];
    const rCol = nIndex < aPal.GetEntryCount() ? aPal.get(nIndex) : new BitmapColor();
    aData[i * 4] = rCol.GetRed();
    aData[i * 4 + 1] = rCol.GetGreen();
    aData[i * 4 + 2] = rCol.GetBlue();
    aData[i * 4 + 3] = 255;
  }
  return { width: rBitmap.width, height: rBitmap.height, data: aData };
}

/** Bitmap::ImplMakeGreyscales: an 8 bit bitmap with the 256 entry grey palette. */
export function ImplMakeGreyscales(rBitmap: BitmapBuffer): PaletteBitmap | null {
  if (!rBitmap.width || !rBitmap.height) return null;

  const rPal = GetGreyPalette256();
  let nShift = 0;

  const aNewBmp = CreatePaletteBitmap(rBitmap.width, rBitmap.height, rPal);
  const pWrite = aNewBmp.indices;
  const pRead = rBitmap.data;

  const nWidth = aNewBmp.width;
  const nHeight = aNewBmp.height;

  if (getPixelFormat(rBitmap) === PixelFormat.N24_BPP) {
    nShift += 8;

    for (let nY = 0; nY < nHeight; nY++) {
      let pReadScan = nY * nWidth * 4;
      let pWriteScan = nY * nWidth;

      for (let nX = 0; nX < nWidth; nX++) {
        const nR = pRead[pReadScan++];
        const nG = pRead[pReadScan++];
        const nB = pRead[pReadScan++];
        pReadScan++; // the 4th byte of the RGBA buffer; a 24 bit scanline has none

        pWrite[pWriteScan++] = ((nB * 28 + nG * 151 + nR * 77) >>> nShift) & 0xff;
      }
    }
  } else {
    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++)
        pWrite[nY * nWidth + nX] = GetPixel(rBitmap, nY, nX).GetLuminance() >> nShift;
    }
  }

  return aNewBmp;
}

export class ImpErrorQuad {
  nRed: number;
  nGreen: number;
  nBlue: number;

  constructor(rColor?: BitmapColor) {
    this.nRed = rColor ? rColor.GetRed() << 5 : 0;
    this.nGreen = rColor ? rColor.GetGreen() << 5 : 0;
    this.nBlue = rColor ? rColor.GetBlue() << 5 : 0;
  }

  /** operator=(const BitmapColor&) */
  assign(rColor: BitmapColor): void {
    this.nRed = rColor.GetRed() << 5;
    this.nGreen = rColor.GetGreen() << 5;
    this.nBlue = rColor.GetBlue() << 5;
  }

  /** operator-=(const BitmapColor&) */
  subtract(rColor: BitmapColor): ImpErrorQuad {
    this.nRed = int16(this.nRed - (rColor.GetRed() << 5));
    this.nGreen = int16(this.nGreen - (rColor.GetGreen() << 5));
    this.nBlue = int16(this.nBlue - (rColor.GetBlue() << 5));
    return this;
  }

  ImplAddColorError1(rErrQuad: ImpErrorQuad): void {
    this.nRed = int16(this.nRed + (rErrQuad.nRed >> 4));
    this.nGreen = int16(this.nGreen + (rErrQuad.nGreen >> 4));
    this.nBlue = int16(this.nBlue + (rErrQuad.nBlue >> 4));
  }

  ImplAddColorError3(rErrQuad: ImpErrorQuad): void {
    this.nRed = int16(this.nRed + ((rErrQuad.nRed * 3) >> 4));
    this.nGreen = int16(this.nGreen + ((rErrQuad.nGreen * 3) >> 4));
    this.nBlue = int16(this.nBlue + ((rErrQuad.nBlue * 3) >> 4));
  }

  ImplAddColorError5(rErrQuad: ImpErrorQuad): void {
    this.nRed = int16(this.nRed + ((rErrQuad.nRed * 5) >> 4));
    this.nGreen = int16(this.nGreen + ((rErrQuad.nGreen * 5) >> 4));
    this.nBlue = int16(this.nBlue + ((rErrQuad.nBlue * 5) >> 4));
  }

  ImplAddColorError7(rErrQuad: ImpErrorQuad): void {
    this.nRed = int16(this.nRed + ((rErrQuad.nRed * 7) >> 4));
    this.nGreen = int16(this.nGreen + ((rErrQuad.nGreen * 7) >> 4));
    this.nBlue = int16(this.nBlue + ((rErrQuad.nBlue * 7) >> 4));
  }

  ImplGetColor(): BitmapColor {
    return new BitmapColor(
      Math.min(Math.max(this.nRed, 0), 8160) >> 5,
      Math.min(Math.max(this.nGreen, 0), 8160) >> 5,
      Math.min(Math.max(this.nBlue, 0), 8160) >> 5);
  }

  clone(): ImpErrorQuad {
    const aQuad = new ImpErrorQuad();
    aQuad.nRed = this.nRed;
    aQuad.nGreen = this.nGreen;
    aQuad.nBlue = this.nBlue;
    return aQuad;
  }
}

/** The members of ImpErrorQuad are sal_Int16. */
function int16(n: number): number {
  return (n << 16) >> 16;
}

/** Bitmap::Convert(BmpConversion::N8BitColors) of a 24 or 32 bit bitmap: ImplConvertDown8BPP. */
export function ImplConvertDown8BPP(rBitmap: BitmapBuffer): PaletteBitmap | null {
  if (!rBitmap.width || !rBitmap.height) return null;

  let aPalette = new BitmapPalette();
  const aNewBmp = CreatePaletteBitmap(rBitmap.width, rBitmap.height, aPalette);
  const pWriteAcc = aNewBmp;

  const nNewBitCount = PixelFormat.N8_BPP;
  const nCount = 1 << nNewBitCount;
  const nWidth = pWriteAcc.width;
  const nWidth1 = nWidth - 1;
  const nHeight = pWriteAcc.height;
  const aOctree = new Octree(rBitmap, nCount);
  aPalette = aOctree.GetPalette().clone();
  const aColorMap = new InverseColorMap(aPalette);
  let aColor: BitmapColor;
  let aErrQuad: ImpErrorQuad;
  const aErrQuad1 = Array.from({ length: nWidth }, () => new ImpErrorQuad());
  const aErrQuad2 = Array.from({ length: nWidth }, () => new ImpErrorQuad());
  let pQLine1 = aErrQuad1;
  let pQLine2: ImpErrorQuad[] | null = null;
  let nYTmp = 0;
  let cIndex: number;
  let bQ1 = true;

  // set Black/White always, if we have enough space
  if (aPalette.GetEntryCount() < nCount - 1) {
    aPalette.SetEntryCount(aPalette.GetEntryCount() + 2);
    aPalette.set(aPalette.GetEntryCount() - 2, new BitmapColor(0, 0, 0));
    aPalette.set(aPalette.GetEntryCount() - 1, new BitmapColor(255, 255, 255));
  }

  pWriteAcc.palette = aPalette;
  const SetPixel = (nY: number, nX: number, nIndex: number) => { pWriteAcc.indices[nY * nWidth + nX] = nIndex; };

  for (let nY = 0; nY < Math.min(nHeight, 2); nY++, nYTmp++) {
    pQLine2 = !nY ? aErrQuad1 : aErrQuad2;
    for (let nX = 0; nX < nWidth; nX++) {
      pQLine2[nX].assign(GetPixel(rBitmap, nYTmp, nX));
    }
  }

  for (let nY = 0; nY < nHeight; nY++, nYTmp++) {
    // first pixel in the line
    cIndex = aColorMap.GetBestPaletteIndex(pQLine1[0].ImplGetColor());
    SetPixel(nY, 0, cIndex);

    let nX: number;
    for (nX = 1; nX < nWidth1; nX++) {
      aColor = pQLine1[nX].ImplGetColor();
      cIndex = aColorMap.GetBestPaletteIndex(aColor);
      aErrQuad = new ImpErrorQuad(aColor).subtract(pWriteAcc.palette.get(cIndex)).clone();
      pQLine1[++nX].ImplAddColorError7(aErrQuad);
      pQLine2![nX--].ImplAddColorError1(aErrQuad);
      pQLine2![nX--].ImplAddColorError5(aErrQuad);
      pQLine2![nX++].ImplAddColorError3(aErrQuad);
      SetPixel(nY, nX, cIndex);
    }

    // Last RowPixel
    if (nX < nWidth) {
      cIndex = aColorMap.GetBestPaletteIndex(pQLine1[nWidth1].ImplGetColor());
      SetPixel(nY, nX, cIndex);
    }

    // Refill/copy row buffer
    pQLine1 = pQLine2!;
    bQ1 = !bQ1;
    pQLine2 = bQ1 ? aErrQuad2 : aErrQuad1;

    if (nYTmp < nHeight) {
      for (nX = 0; nX < nWidth; nX++) {
        pQLine2[nX].assign(GetPixel(rBitmap, nYTmp, nX));
      }
    }
  }

  return aNewBmp;
}

/**
 * Bitmap::Modify: every pixel's colour through the modifier stack, keeping the alpha. The
 * BColorModifier_replace shortcut and the buffered result are not ported (the caller caches).
 */
export function Modify(rBitmap: BitmapBuffer, rBColorModifierStack: BColorModifierStack): BitmapBuffer {
  // no modifiers, done
  if (0 === rBColorModifierStack.count()) return rBitmap;
  const data = new Uint8ClampedArray(rBitmap.data);
  const fConvertColor = 1.0 / 255.0;
  for (let i = 0; i < data.length; i += 4) {
    const aBDest = rBColorModifierStack.getModifiedColor([data[i]! * fConvertColor, data[i + 1]! * fConvertColor, data[i + 2]! * fConvertColor]);
    // Color(const basegfx::BColor&): rounded to 8 bits.
    data[i] = Math.round(aBDest[0] * 255.0); data[i + 1] = Math.round(aBDest[1] * 255.0); data[i + 2] = Math.round(aBDest[2] * 255.0);
  }
  return { width: rBitmap.width, height: rBitmap.height, data };
}

/**
 * DetectEdges: a Sobel edge image of the bitmap's greys, true (black) where the gradient reaches
 * the threshold; the border starts white. As upstream, a result pixel is written one to the right
 * of its 3x3 window's top left corner and on the window's first row.
 */
function DetectEdges(rBmp: BitmapBuffer): Uint8Array {
  const cEdgeDetectThreshold = 128;
  const nWidth = rBmp.width, nHeight = rBmp.height;
  const aEdge = new Uint8Array(nWidth * nHeight);
  if (nWidth <= 2 || nHeight <= 2) return aEdge;
  const grey = ImplMakeGreyscales(rBmp);
  if (!grey) return aEdge;
  const g = (x: number, y: number) => grey.indices[y * nWidth + x]!;
  const nWidth2 = nWidth - 2, nHeight2 = nHeight - 2;
  const lThres2 = cEdgeDetectThreshold * cEdgeDetectThreshold;
  for (let nY = 0, nY1 = 1, nY2 = 2; nY < nHeight2; nY++, nY1++, nY2++) {
    for (let nX = 0, nXDst = 1; nX < nWidth2; nX++, nXDst++) {
      let nXTmp = nX;
      let nSum2 = g(nXTmp++, nY);
      let nSum1 = -nSum2;
      nSum2 += g(nXTmp++, nY) << 1;
      let lGray = g(nXTmp, nY);
      nSum1 += lGray;
      nSum2 += lGray;
      nSum1 += g(nXTmp, nY1) << 1;
      nXTmp -= 2;
      nSum1 -= g(nXTmp, nY1) << 1;
      lGray = -g(nXTmp++, nY2);
      nSum1 += lGray;
      nSum2 += lGray;
      nSum2 -= g(nXTmp++, nY2) << 1;
      lGray = g(nXTmp, nY2);
      nSum1 += lGray;
      nSum2 -= lGray;
      if (nSum1 * nSum1 + nSum2 * nSum2 >= lThres2) aEdge[nY * nWidth + nXDst] = 1;
    }
  }
  return aEdge;
}

/**
 * Bitmap::GetContour: a polygon through the first and the last pixel with content of every row
 * (down the left side, up the right side), in pixels. Content is an edge pixel when detecting
 * edges, otherwise a pixel that is not fully transparent (the alpha mask, tdf#161833).
 */
export function GetContour(rBmp: BitmapBuffer, bContourEdgeDetect: boolean): [number, number][] {
  const nWidth = rBmp.width, nHeight = rBmp.height;
  if (nWidth <= 4 || nHeight <= 4) return [];
  const aEdge = bContourEdgeDetect ? DetectEdges(rBmp) : null;
  const content = (x: number, y: number) => (aEdge ? aEdge[y * nWidth + x] === 1 : rBmp.data[(y * nWidth + x) * 4 + 3]! !== 0);
  const pPoints1: [number, number][] = [], pPoints2: [number, number][] = [];
  const nStartX1 = 1, nEndX1 = nWidth - 1, nStartX2 = nEndX1 - 1, nStartY1 = 1, nEndY1 = nHeight - 1;
  for (let nY = nStartY1; nY < nEndY1; nY++) {
    // scan row from left to right
    for (let nX = nStartX1; nX < nEndX1; nX++) {
      if (content(nX, nY)) {
        pPoints1.push([nX, nY]);
        // this loop always breaks eventually as there is at least one pixel
        let nX2 = nStartX2;
        while (!content(nX2, nY)) nX2--;
        pPoints2.push([nX2, nY]);
        break;
      }
    }
  }
  if (!pPoints1.length) return [];
  return [...pPoints1, ...pPoints2.reverse(), pPoints1[0]!];
}
