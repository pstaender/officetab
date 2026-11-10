// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapMosaicFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapMosaicFilter.hxx faithful
// As upstream, on a copy of the RGBA buffer, which is never a palette bitmap: the branch writing
// into a new 24 bit bitmap is left out. Each tile gets the average colour of its pixels; since
// upstream reuses the BitmapColor of the last pixel read, a 32 bit bitmap's tile takes the alpha
// of its bottom right pixel.
import { BitmapFilter, CopyBitmap, type BitmapBuffer } from './bitmapfilter.ts';
import { BitmapColor } from './bitmappalette.ts';

export class BitmapMosaicFilter extends BitmapFilter {
  private mnTileWidth: number;
  private mnTileHeight: number;

  constructor(nTileWidth: number, nTileHeight: number) {
    super();
    this.mnTileWidth = Math.max(nTileWidth, 1);
    this.mnTileHeight = Math.max(nTileHeight, 1);
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    if (!(this.mnTileWidth > 1 || this.mnTileHeight > 1)) return null;

    const aBitmap = CopyBitmap(rBitmap);
    const pData = aBitmap.data;

    let bConditionsMet = false;
    let nWidth = 0;
    let nHeight = 0;

    nWidth = aBitmap.width;
    nHeight = aBitmap.height;
    bConditionsMet = nWidth > 0 && nHeight > 0;

    let bRet = false;

    if (bConditionsMet) {
      const aCol = new BitmapColor();
      let nX: number, nY: number, nX1: number, nX2: number, nY1: number, nY2: number;
      let nSumR: number, nSumG: number, nSumB: number;
      let fArea_1: number;

      nY1 = 0;
      nY2 = this.mnTileHeight - 1;

      if (nY2 >= nHeight) nY2 = nHeight - 1;

      do {
        nX1 = 0;
        nX2 = this.mnTileWidth - 1;

        if (nX2 >= nWidth) nX2 = nWidth - 1;

        fArea_1 = 1.0 / ((nX2 - nX1 + 1) * (nY2 - nY1 + 1));

        do {
          for (nY = nY1, nSumR = nSumG = nSumB = 0; nY <= nY2; nY++) {
            for (nX = nX1; nX <= nX2; nX++) {
              // aCol = pReadAcc->GetPixelFromData(pScanlineRead, nX);
              const p = (nY * nWidth + nX) * 4;
              aCol.SetRed(pData[p]);
              aCol.SetGreen(pData[p + 1]);
              aCol.SetBlue(pData[p + 2]);
              aCol.SetAlpha(pData[p + 3]);
              nSumR += aCol.GetRed();
              nSumG += aCol.GetGreen();
              nSumB += aCol.GetBlue();
            }
          }

          aCol.SetRed(Math.trunc(nSumR * fArea_1));
          aCol.SetGreen(Math.trunc(nSumG * fArea_1));
          aCol.SetBlue(Math.trunc(nSumB * fArea_1));

          for (nY = nY1; nY <= nY2; nY++) {
            for (nX = nX1; nX <= nX2; nX++) {
              // pWriteAcc->SetPixelOnData(pScanline, nX, aCol);
              const p = (nY * nWidth + nX) * 4;
              pData[p] = aCol.GetRed();
              pData[p + 1] = aCol.GetGreen();
              pData[p + 2] = aCol.GetBlue();
              pData[p + 3] = aCol.GetAlpha();
            }
          }

          nX1 += this.mnTileWidth;
          nX2 += this.mnTileWidth;

          if (nX2 >= nWidth) {
            nX2 = nWidth - 1;
            fArea_1 = 1.0 / ((nX2 - nX1 + 1) * (nY2 - nY1 + 1));
          }
        } while (nX1 < nWidth);

        nY1 += this.mnTileHeight;
        nY2 += this.mnTileHeight;

        if (nY2 >= nHeight) nY2 = nHeight - 1;
      } while (nY1 < nHeight);

      bRet = true;
    }

    if (bRet) return aBitmap;

    return null;
  }
}
