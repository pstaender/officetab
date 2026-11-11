// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/dibtools.cxx reduced
// @upstream vcl/source/bitmap/BitmapTools.cxx partial
// ReadDIB reads a device independent bitmap (a BMP file without, or with, its file header) into a
// Bitmap. Here the pixels are not decoded: the DIB is wrapped in a BMP file header, as the EMF
// reader does before it calls ReadDIB, and kept as a data URL that the browser decodes when it
// shows the metafile. Its header gives the size. JPEG and PNG compressed DIBs (BI_JPEG, BI_PNG)
// keep their embedded file. Palette indices into a logical palette (DIB_PAL_COLORS) are not
// resolved. CreateFromData makes a bitmap of raw rows (a WMF device dependent bitmap) the same way,
// as a top-down DIB.

import type { MtfBitmap } from '../gdi/gdimtf.ts';

const BI_BITFIELDS = 3, BI_JPEG = 4, BI_PNG = 5, BI_ALPHABITFIELDS = 6;
const DIBCOREHEADERSIZE = 12, DIBINFOHEADERSIZE = 40;

/** Base64 of bytes, in chunks small enough for String.fromCharCode. */
export function Base64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The DIB's header fields, and the size of its header with masks and palette. */
function ReadHeader(d: Uint8Array): { width: number; height: number; nBitCount: number; nCompression: number; nInfoSize: number } | null {
  if (d.length < 4) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const nSize = v.getUint32(0, true);
  if (nSize === DIBCOREHEADERSIZE) {
    if (d.length < 12) return null;
    const width = v.getUint16(4, true), height = v.getUint16(6, true), nBitCount = v.getUint16(10, true);
    const nColors = nBitCount <= 8 ? 1 << nBitCount : 0;
    return { width, height, nBitCount, nCompression: 0, nInfoSize: nSize + nColors * 3 };
  }
  if (nSize < DIBINFOHEADERSIZE || d.length < DIBINFOHEADERSIZE) return null;
  const width = v.getInt32(4, true), height = Math.abs(v.getInt32(8, true));
  const nBitCount = v.getUint16(14, true), nCompression = v.getUint32(16, true), nColsUsed = v.getUint32(32, true);
  // The colour masks follow a BITMAPINFOHEADER; later headers hold them.
  const nMasks = nSize === DIBINFOHEADERSIZE ? (nCompression === BI_BITFIELDS ? 12 : nCompression === BI_ALPHABITFIELDS ? 16 : 0) : 0;
  const nColors = nColsUsed || (nBitCount && nBitCount <= 8 ? 1 << nBitCount : 0);
  return { width, height, nBitCount, nCompression, nInfoSize: nSize + nMasks + nColors * 4 };
}

/**
 * ReadDIB for a DIB in two parts, its BITMAPINFO (header, masks and palette) and its bits, as the
 * EMF bitmap records store them. Null when the header is broken.
 */
export function ReadDIBParts(aBmi: Uint8Array, aBits: Uint8Array): MtfBitmap | null {
  const h = ReadHeader(aBmi);
  if (!h || h.width <= 0 || h.height <= 0) return null;
  if (h.nCompression === BI_JPEG || h.nCompression === BI_PNG) {
    return { width: h.width, height: h.height, href: `data:image/${h.nCompression === BI_JPEG ? 'jpeg' : 'png'};base64,${Base64(aBits)}` };
  }
  // The BMP file header: 'BM', the file size, two reserved words and the offset of the bits.
  const out = new Uint8Array(14 + aBmi.length + aBits.length);
  const v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, 14 + aBmi.length, true);
  out.set(aBmi, 14);
  out.set(aBits, 14 + aBmi.length);
  return { width: h.width, height: h.height, href: `data:image/bmp;base64,${Base64(out)}` };
}

/** ReadDIB( rTarget, rIStm, bFileHeader = false ): a packed DIB, its bits right after the palette. */
export function ReadDIB(aDIB: Uint8Array): MtfBitmap | null {
  const h = ReadHeader(aDIB);
  if (!h || h.nInfoSize > aDIB.length) return null;
  return ReadDIBParts(aDIB.subarray(0, h.nInfoSize), aDIB.subarray(h.nInfoSize));
}

/** The bit count of a DIB's header (0 for JPEG or PNG data), as the WMF reader checks it. */
export function GetDIBBitCount(aDIB: Uint8Array): number {
  return ReadHeader(aDIB)?.nBitCount ?? 0;
}

/**
 * vcl::bitmap::CreateFromData( pData, nWidth, nHeight, nStride, nBitCount, bReversColors = true ):
 * rows from the top of 1 (black and white), 24 or 32 bit pixels in B, G, R order.
 */
export function CreateFromData(pData: Uint8Array, nWidth: number, nHeight: number, nStride: number, nBitCount: number): MtfBitmap | null {
  if (nBitCount !== 1 && nBitCount !== 24 && nBitCount !== 32) return null;
  // A DIB's rows are padded to 4 bytes.
  const nDIBStride = (((nWidth * nBitCount + 31) >> 5) << 2);
  const nColors = nBitCount === 1 ? 2 : 0;
  const aBmi = new Uint8Array(DIBINFOHEADERSIZE + nColors * 4);
  const v = new DataView(aBmi.buffer);
  v.setUint32(0, DIBINFOHEADERSIZE, true);
  v.setInt32(4, nWidth, true);
  v.setInt32(8, -nHeight, true); // top-down
  v.setUint16(12, 1, true);
  v.setUint16(14, nBitCount, true);
  if (nColors) aBmi.set([0, 0, 0, 0, 255, 255, 255, 0], DIBINFOHEADERSIZE); // COL_BLACK, COL_WHITE
  const aBits = new Uint8Array(nDIBStride * nHeight);
  const nRow = Math.min(nStride, nDIBStride);
  for (let y = 0; y < nHeight; y++) aBits.set(pData.subarray(y * nStride, y * nStride + nRow), y * nDIBStride);
  return ReadDIBParts(aBmi, aBits);
}
