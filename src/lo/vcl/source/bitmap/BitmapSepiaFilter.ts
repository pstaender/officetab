// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapSepiaFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapSepiaFilter.hxx faithful
// As upstream, on an RGBA buffer: the palette input branch is left out (the input never has one).
// The result is an 8 bit bitmap with the sepia palette, which has no alpha: it is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';
import { CreatePaletteBitmap, GetPixel, PaletteBitmapToBuffer } from './bitmap.ts';
import { BitmapColor, BitmapPalette } from './bitmappalette.ts';

export class BitmapSepiaFilter extends BitmapFilter {
  private mnSepiaPercent: number;

  constructor(nSepiaPercent: number) {
    super();
    // clamp value to 100%
    if (nSepiaPercent <= 100) this.mnSepiaPercent = Math.trunc(nSepiaPercent) & 0xffff;
    else this.mnSepiaPercent = 100;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = rBitmap;
    if (!aBitmap.width || !aBitmap.height) return null;

    const nSepia = 10000 - 100 * Math.min(Math.max(this.mnSepiaPercent, 0), 100);
    const aSepiaPal = new BitmapPalette(256);

    for (let i = 0; i < 256; i++) {
      const rCol = new BitmapColor();
      const cSepiaValue = Math.trunc((nSepia * i) / 10000) & 0xff;

      rCol.SetRed(i);
      rCol.SetGreen(cSepiaValue);
      rCol.SetBlue(cSepiaValue);
      aSepiaPal.set(i, rCol);
    }

    const aNewBmp = CreatePaletteBitmap(aBitmap.width, aBitmap.height, aSepiaPal);
    const pWriteAcc = aNewBmp.indices;

    const nWidth = aNewBmp.width;
    const nHeight = aNewBmp.height;

    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++) {
        // aCol.SetIndex(pReadAcc->GetPixelFromData(pScanlineRead, nX).GetLuminance());
        pWriteAcc[nY * nWidth + nX] = GetPixel(aBitmap, nY, nX).GetLuminance();
      }
    }

    return PaletteBitmapToBuffer(aNewBmp);
  }
}
