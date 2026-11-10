// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapSobelGreyFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapSobelGreyFilter.hxx faithful
// Statement by statement on RGBA buffers, with scanline access as array indexing. The result is
// an 8 bit bitmap with the grey palette, which has no alpha: it is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';
import { CreatePaletteBitmap, ImplMakeGreyscales, PaletteBitmapToBuffer } from './bitmap.ts';

export class BitmapSobelGreyFilter extends BitmapFilter {
  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = ImplMakeGreyscales(rBitmap);
    if (!aBitmap) return null;

    const pReadAcc = aBitmap;
    const aNewBmp = CreatePaletteBitmap(aBitmap.width, aBitmap.height, pReadAcc.palette);
    const pWriteAcc = aNewBmp;

    let aGrey = 0;
    const nWidth = pWriteAcc.width;
    const nHeight = pWriteAcc.height;
    const nMask111 = -1, nMask121 = 0, nMask131 = 1;
    const nMask211 = -2, nMask221 = 0, nMask231 = 2;
    const nMask311 = -1, nMask321 = 0, nMask331 = 1;
    const nMask112 = 1, nMask122 = 2, nMask132 = 1;
    const nMask212 = 0, nMask222 = 0, nMask232 = 0;
    const nMask312 = -1, nMask322 = -2, nMask332 = -1;
    let nGrey11: number, nGrey12: number, nGrey13: number;
    let nGrey21: number, nGrey22: number, nGrey23: number;
    let nGrey31: number, nGrey32: number, nGrey33: number;
    const pHMap = new Int32Array(nWidth + 2);
    const pVMap = new Int32Array(nHeight + 2);
    let nX: number, nY: number, nSum1: number, nSum2: number;
    const GetPixel = (nRow: number, nCol: number) => pReadAcc.indices[nRow * nWidth + nCol];

    // fill mapping tables
    pHMap[0] = 0;

    for (nX = 1; nX <= nWidth; nX++) {
      pHMap[nX] = nX - 1;
    }

    pHMap[nWidth + 1] = nWidth - 1;

    pVMap[0] = 0;

    for (nY = 1; nY <= nHeight; nY++) {
      pVMap[nY] = nY - 1;
    }

    pVMap[nHeight + 1] = nHeight - 1;

    for (nY = 0; nY < nHeight; nY++) {
      nGrey11 = GetPixel(pVMap[nY], pHMap[0]);
      nGrey12 = GetPixel(pVMap[nY], pHMap[1]);
      nGrey13 = GetPixel(pVMap[nY], pHMap[2]);
      nGrey21 = GetPixel(pVMap[nY + 1], pHMap[0]);
      nGrey22 = GetPixel(pVMap[nY + 1], pHMap[1]);
      nGrey23 = GetPixel(pVMap[nY + 1], pHMap[2]);
      nGrey31 = GetPixel(pVMap[nY + 2], pHMap[0]);
      nGrey32 = GetPixel(pVMap[nY + 2], pHMap[1]);
      nGrey33 = GetPixel(pVMap[nY + 2], pHMap[2]);

      for (nX = 0; nX < nWidth; nX++) {
        nSum1 = nSum2 = 0;

        nSum1 += nMask111 * nGrey11;
        nSum2 += nMask112 * nGrey11;

        nSum1 += nMask121 * nGrey12;
        nSum2 += nMask122 * nGrey12;

        nSum1 += nMask131 * nGrey13;
        nSum2 += nMask132 * nGrey13;

        nSum1 += nMask211 * nGrey21;
        nSum2 += nMask212 * nGrey21;

        nSum1 += nMask221 * nGrey22;
        nSum2 += nMask222 * nGrey22;

        nSum1 += nMask231 * nGrey23;
        nSum2 += nMask232 * nGrey23;

        nSum1 += nMask311 * nGrey31;
        nSum2 += nMask312 * nGrey31;

        nSum1 += nMask321 * nGrey32;
        nSum2 += nMask322 * nGrey32;

        nSum1 += nMask331 * nGrey33;
        nSum2 += nMask332 * nGrey33;

        nSum1 = Math.trunc(Math.hypot(nSum1, nSum2));

        aGrey = ~Math.min(Math.max(nSum1, 0), 255) & 0xff;
        pWriteAcc.indices[nY * nWidth + nX] = aGrey;

        if (nX < nWidth - 1) {
          const nNextX = pHMap[nX + 3];

          nGrey11 = nGrey12;
          nGrey12 = nGrey13;
          nGrey13 = GetPixel(pVMap[nY], nNextX);
          nGrey21 = nGrey22;
          nGrey22 = nGrey23;
          nGrey23 = GetPixel(pVMap[nY + 1], nNextX);
          nGrey31 = nGrey32;
          nGrey32 = nGrey33;
          nGrey33 = GetPixel(pVMap[nY + 2], nNextX);
        }
      }
    }

    return PaletteBitmapToBuffer(aNewBmp);
  }
}
