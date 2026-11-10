// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/bitmappaint.cxx reduced
// Bitmap::Invert on an RGBA buffer, in place. The SalBitmap fast path and the palette branches are
// left out (the buffer never has a palette); the colour is inverted and the alpha is kept, as
// BitmapColor::Invert does when written back to a 32 bit scanline.
import type { BitmapBuffer } from './bitmapfilter.ts';

export function Invert(rBitmap: BitmapBuffer): boolean {
  if (!rBitmap.width || !rBitmap.height) return false;

  const nWidth = rBitmap.width;
  const nHeight = rBitmap.height;
  const pData = rBitmap.data;

  for (let nY = 0; nY < nHeight; nY++) {
    for (let nX = 0; nX < nWidth; nX++) {
      const p = (nY * nWidth + nX) * 4;
      // aBmpColor.Invert();
      pData[p] = ~pData[p] & 0xff;
      pData[p + 1] = ~pData[p + 1] & 0xff;
      pData[p + 2] = ~pData[p + 2] & 0xff;
    }
  }

  return true;
}
