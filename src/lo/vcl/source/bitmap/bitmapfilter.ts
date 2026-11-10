// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/bitmapfilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapFilter.hxx reduced
// Filters work on plain RGBA buffers laid out like ImageData (4 bytes per pixel, row-major, not
// premultiplied) instead of vcl Bitmaps. An empty Bitmap, the result of a failed filter, is null.
// Left out: Filter(Animation&, ...) (animated graphics are filtered as their current frame by
// the caller) and generateStripRanges, which only the multithreaded scalers use.

/** The pixels of a Bitmap. A buffer whose alpha is 255 everywhere stands for a 24 bit bitmap, any
    other for a 32 bit bitmap with alpha (see getPixelFormat in bitmap.ts). */
export interface BitmapBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A copy of the buffer, as `Bitmap aBitmap(rBitmap)` before a filter modifies it in place. */
export function CopyBitmap(rBitmap: BitmapBuffer): BitmapBuffer {
  return { width: rBitmap.width, height: rBitmap.height, data: new Uint8ClampedArray(rBitmap.data) };
}

/** BitmapFilter transforms (or "filters") a given bitmap based on a provided filter.

    The execute function takes the Bitmap that you want to apply the filter to, and
    returns a brand new, filtered, Bitmap instance.

    The BitmapFilter class has a static convenience Filter function that takes a Bitmap
    and the desired filter, which filters the Bitmap parameter, then overwrite this Bitmap
    instance. If the filter fails (Bitmap is empty) then it returns false. */
export abstract class BitmapFilter {
  abstract execute(rBitmap: BitmapBuffer): BitmapBuffer | null;

  static Filter(rBmp: BitmapBuffer, rFilter: BitmapFilter): boolean {
    const aTmpBmp = rFilter.execute(rBmp);

    if (aTmpBmp === null) {
      // SAL_WARN("vcl.gdi", "Bitmap filter failed " << typeid(rFilter).name());
      return false;
    }

    rBmp.width = aTmpBmp.width;
    rBmp.height = aTmpBmp.height;
    rBmp.data = aTmpBmp.data;
    return true;
  }
}
