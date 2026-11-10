// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapSeparableUnsharpenFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapSeparableUnsharpenFilter.hxx faithful
// Statement by statement on RGBA buffers, with pixel access as array indexing. The result is a
// new 24 bit bitmap, so it is opaque.
import { BitmapFilter, CopyBitmap, type BitmapBuffer } from './bitmapfilter.ts';
import { BitmapGaussianSeparableBlurFilter } from './BitmapGaussianSeparableBlurFilter.ts';

export class BitmapSeparableUnsharpenFilter extends BitmapFilter {
  private mfRadius: number;

  constructor(fRadius: number) {
    super();
    this.mfRadius = fRadius;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = rBitmap;
    if (!aBitmap.width || !aBitmap.height) return null;

    const nWidth = aBitmap.width;
    const nHeight = aBitmap.height;

    const aBlur = CopyBitmap(aBitmap);
    BitmapFilter.Filter(aBlur, new BitmapGaussianSeparableBlurFilter(-this.mfRadius));

    // Amount of unsharpening effect on image - currently set to a fixed value
    const aAmount = 2.0;

    const aResultBitmap: BitmapBuffer = { width: nWidth, height: nHeight, data: new Uint8ClampedArray(nWidth * nHeight * 4) };

    const pReadAccBlur = aBlur.data;
    const pReadAcc = aBitmap.data;
    const pWriteAcc = aResultBitmap.data;

    const clamp = (v: number) => Math.trunc(Math.min(Math.max(v, 0.0), 255.0));

    // For all pixels in original image subtract pixels values from blurred image
    for (let y = 0; y < nHeight; y++) {
      for (let x = 0; x < nWidth; x++) {
        const p = (y * nWidth + x) * 4;
        // aColorBlur = pReadAccBlur->GetColor(y, x); aColor = pReadAcc->GetColor(y, x);
        pWriteAcc[p] = clamp(pReadAcc[p] + (pReadAcc[p] - pReadAccBlur[p]) * aAmount);
        pWriteAcc[p + 1] = clamp(pReadAcc[p + 1] + (pReadAcc[p + 1] - pReadAccBlur[p + 1]) * aAmount);
        pWriteAcc[p + 2] = clamp(pReadAcc[p + 2] + (pReadAcc[p + 2] - pReadAccBlur[p + 2]) * aAmount);
        pWriteAcc[p + 3] = 255;
      }
    }

    return aResultBitmap;
  }
}
