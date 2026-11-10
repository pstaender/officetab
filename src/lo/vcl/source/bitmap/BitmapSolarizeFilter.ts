// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapSolarizeFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapSolarizeFilter.hxx faithful
// As upstream, on a copy of the RGBA buffer: the palette branch is left out (the input never has
// one). The bitmap is modified in place, so the alpha of a 32 bit bitmap is kept.
import { BitmapFilter, CopyBitmap, type BitmapBuffer } from './bitmapfilter.ts';
import { GetPixel } from './bitmap.ts';

export class BitmapSolarizeFilter extends BitmapFilter {
  private mcSolarGreyThreshold: number;

  constructor(cSolarGreyThreshold: number) {
    super();
    // sal_uInt8 from double
    this.mcSolarGreyThreshold = Math.trunc(cSolarGreyThreshold) & 0xff;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = CopyBitmap(rBitmap);
    if (!aBitmap.width || !aBitmap.height) return null;

    const pData = aBitmap.data;
    const nWidth = aBitmap.width;
    const nHeight = aBitmap.height;

    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++) {
        const aCol = GetPixel(aBitmap, nY, nX);

        if (aCol.GetLuminance() >= this.mcSolarGreyThreshold) {
          aCol.Invert();
          const p = (nY * nWidth + nX) * 4;
          pData[p] = aCol.GetRed();
          pData[p + 1] = aCol.GetGreen();
          pData[p + 2] = aCol.GetBlue();
        }
      }
    }

    return aBitmap;
  }
}
