// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapSmoothenFilter.cxx faithful
// @upstream include/vcl/bitmap/BitmapSmoothenFilter.hxx faithful
import { BitmapFilter, CopyBitmap, type BitmapBuffer } from './bitmapfilter.ts';
import { BitmapGaussianSeparableBlurFilter } from './BitmapGaussianSeparableBlurFilter.ts';
import { BitmapSeparableUnsharpenFilter } from './BitmapSeparableUnsharpenFilter.ts';

export class BitmapSmoothenFilter extends BitmapFilter {
  private mfRadius: number;

  constructor(fRadius: number) {
    super();
    this.mfRadius = fRadius;
  }

  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = CopyBitmap(rBitmap);
    let bRet = false;

    if (this.mfRadius > 0.0) // Blur for positive values of mnRadius
      bRet = BitmapFilter.Filter(aBitmap, new BitmapGaussianSeparableBlurFilter(this.mfRadius));
    else if (this.mfRadius < 0.0) // Unsharpen mask for negative values of mnRadius
      bRet = BitmapFilter.Filter(aBitmap, new BitmapSeparableUnsharpenFilter(this.mfRadius));

    if (bRet) return aBitmap;

    return null;
  }
}
