// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/BitmapPopArtFilter.cxx reduced
// @upstream include/vcl/bitmap/BitmapPopArtFilter.hxx faithful
// As upstream, on RGBA buffers, which are never palette bitmaps: the bitmap is converted to 8 bit
// colours (Convert(BmpConversion::N8BitColors)), then the palette is rotated by one entry in the
// order of how often each entry is used. std::sort is not stable; here entries used equally often
// keep their palette order, upstream's order among them depends on the C++ library. The result
// is an 8 bit bitmap, which has no alpha: it is opaque.
import { BitmapFilter, type BitmapBuffer } from './bitmapfilter.ts';
import { ImplConvertDown8BPP, PaletteBitmapToBuffer, PixelFormat } from './bitmap.ts';

interface PopArtEntry {
  mnIndex: number;
  mnCount: number;
}

export class BitmapPopArtFilter extends BitmapFilter {
  override execute(rBitmap: BitmapBuffer): BitmapBuffer | null {
    const aBitmap = ImplConvertDown8BPP(rBitmap);
    const bConvert = aBitmap !== null;

    if (!bConvert) return null;

    const pWriteAcc = aBitmap;

    const nWidth = pWriteAcc.width;
    const nHeight = pWriteAcc.height;
    const nEntryCount = 1 << PixelFormat.N8_BPP;
    let n = 0;
    const aPopArtTable: PopArtEntry[] = new Array<PopArtEntry>(nEntryCount);

    for (n = 0; n < nEntryCount; n++) {
      aPopArtTable[n] = { mnIndex: n, mnCount: 0 };
    }

    // get pixel count for each palette entry
    for (let nY = 0; nY < nHeight; nY++) {
      for (let nX = 0; nX < nWidth; nX++) {
        aPopArtTable[pWriteAcc.indices[nY * nWidth + nX]].mnCount++;
      }
    }

    // sort table
    aPopArtTable.sort((lhs, rhs) => rhs.mnCount - lhs.mnCount);

    // get last used entry
    let nFirstEntry: number;
    let nLastEntry = 0;

    for (n = 0; n < nEntryCount; n++) {
      if (aPopArtTable[n].mnCount) nLastEntry = n;
    }

    // rotate palette (one entry)
    const rPal = pWriteAcc.palette;
    const aFirstCol = rPal.get(aPopArtTable[0].mnIndex).clone();
    for (nFirstEntry = 0; nFirstEntry < nLastEntry; nFirstEntry++) {
      rPal.set(aPopArtTable[nFirstEntry].mnIndex, rPal.get(aPopArtTable[nFirstEntry + 1].mnIndex));
    }
    rPal.set(aPopArtTable[nLastEntry].mnIndex, aFirstCol);

    return PaletteBitmapToBuffer(aBitmap);
  }
}
