// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapColorQuantizationFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapColorQuantizationFilter.hxx faithful
// As upstream, on RGBA buffers: the palette input branches are left out (the input never has a
// palette). std::qsort is not stable; here colours counted equally often keep their order in the
// table, upstream's order among them depends on the C library. The result is an 8 bit bitmap,
// which has no alpha: it is opaque.
import { BitmapFilter, CopyBitmap, type BitmapBuffer } from './bitmapfilter.ts';
import { CreatePaletteBitmap, GetPixel, PaletteBitmapToBuffer, getPixelFormat, numberOfColors } from './bitmap.ts';
import { BitmapColor, BitmapPalette } from './bitmappalette.ts';

interface PopularColorCount {
  mnIndex: number;
  mnCount: number;
}

export class BitmapColorQuantizationFilter extends BitmapFilter {
  private mnNewColorCount: number;

  /** Reduce number of colors for the bitmap using the POPULAR algorithm

      @param nNewColorCount
      Maximal number of bitmap colors after the reduce operation */
  constructor(nNewColorCount: number) {
    super();
    this.mnNewColorCount = nNewColorCount & 0xffff;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = rBitmap;

    if (numberOfColors(getPixelFormat(aBitmap)) <= this.mnNewColorCount) return CopyBitmap(aBitmap);

    if (!aBitmap.width || !aBitmap.height) return null;

    const nValidBits = 4;
    const nColorsPerComponent = 1 << nValidBits;
    const nColorOffset = 256 / nColorsPerComponent;
    const nTotalColors = nColorsPerComponent * nColorsPerComponent * nColorsPerComponent;
    const pCountTable: PopularColorCount[] = new Array<PopularColorCount>(nTotalColors);

    for (let nR = 0, nIndex = 0; nR < 256; nR += nColorOffset) {
      for (let nG = 0; nG < 256; nG += nColorOffset) {
        for (let nB = 0; nB < 256; nB += nColorOffset) {
          pCountTable[nIndex] = { mnIndex: nIndex, mnCount: 0 };
          nIndex++;
        }
      }
    }

    const nRightShiftBits = 8 - nValidBits;
    const nLeftShiftBits1 = nValidBits;
    const nLeftShiftBits2 = nValidBits << 1;
    const nWidth = aBitmap.width;
    const nHeight = aBitmap.height;

    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++) {
        const aCol = GetPixel(aBitmap, nY, nX);
        pCountTable[((aCol.GetRed() >> nRightShiftBits) << nLeftShiftBits2)
          | ((aCol.GetGreen() >> nRightShiftBits) << nLeftShiftBits1)
          | (aCol.GetBlue() >> nRightShiftBits)].mnCount++;
      }
    }

    const cappedNewColorCount = Math.min(this.mnNewColorCount, 256);

    const aNewPal = new BitmapPalette(cappedNewColorCount);

    pCountTable.sort((p1, p2) => {
      let nRet: number;

      if (p1.mnCount < p2.mnCount) nRet = 1;
      else if (p1.mnCount === p2.mnCount) nRet = 0;
      else nRet = -1;

      return nRet;
    });

    for (let n = 0; n < cappedNewColorCount; n++) {
      const rPop = pCountTable[n];
      aNewPal.set(n, new BitmapColor(
        (rPop.mnIndex >> nLeftShiftBits2) << nRightShiftBits,
        ((rPop.mnIndex >> nLeftShiftBits1) & (nColorsPerComponent - 1)) << nRightShiftBits,
        (rPop.mnIndex & (nColorsPerComponent - 1)) << nRightShiftBits));
    }

    const aNewBmp = CreatePaletteBitmap(aBitmap.width, aBitmap.height, aNewPal);
    const pWAcc = aNewBmp;

    const pIndexMap = new Uint8Array(nTotalColors);

    for (let nR = 0, nIndex = 0; nR < 256; nR += nColorOffset) {
      for (let nG = 0; nG < 256; nG += nColorOffset) {
        for (let nB = 0; nB < 256; nB += nColorOffset) {
          pIndexMap[nIndex++] = aNewPal.GetBestIndex(new BitmapColor(nR, nG, nB));
        }
      }
    }

    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++) {
        const aCol = GetPixel(aBitmap, nY, nX);
        pWAcc.indices[nY * nWidth + nX] = pIndexMap[((aCol.GetRed() >> nRightShiftBits) << nLeftShiftBits2)
          | ((aCol.GetGreen() >> nRightShiftBits) << nLeftShiftBits1)
          | (aCol.GetBlue() >> nRightShiftBits)];
      }
    }

    return PaletteBitmapToBuffer(aNewBmp);
  }
}
