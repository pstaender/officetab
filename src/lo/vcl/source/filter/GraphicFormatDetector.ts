// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/filter/GraphicFormatDetector.cxx reduced
// The pixel size and resolution of PNG, JPEG, GIF, BMP, WebP and TIFF data, read from their headers
// (checkPNG, checkJPG, checkGIF, checkBMP, checkWEBP, checkTIF with extended info), and the graphic's
// preferred size from them. WebP sizes are read from the VP8, VP8L or VP8X chunk directly rather
// than through libwebp (ReadWebpInfo); a top-down BMP's negative height counts as its size.
// Other formats are not ported; a graphic without a resolution counts as 96 DPI, the
// resolution LibreOffice assumes for pixel-mapped graphics on screen.

import { GetTiffSize, IsTiff } from './itiff/itiff.ts';

export interface GraphicMetadata { mnPixWidth: number; mnPixHeight: number; mnDpiX: number; mnDpiY: number }

export function DetectGraphic(d: Uint8Array): GraphicMetadata | null {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (o: number) => (o + 4 <= d.length ? v.getUint32(o) : 0);
  // checkPNG: the IHDR chunk, then pHYs (pixels per metre when its unit is 1).
  if (d.length > 24 && u32(0) === 0x89504e47 && u32(4) === 0x0d0a1a0a) {
    const out = { mnPixWidth: u32(16), mnPixHeight: u32(20), mnDpiX: 96, mnDpiY: 96 };
    for (let o = 8; o + 8 <= d.length;) {
      const len = u32(o), type = String.fromCharCode(...d.subarray(o + 4, o + 8));
      if (type === 'pHYs' && d[o + 16] === 1) {
        const x = u32(o + 8), y = u32(o + 12);
        if (x && y) { out.mnDpiX = (x * 254) / 10000; out.mnDpiY = (y * 254) / 10000; }
      }
      if (type === 'IDAT' || type === 'IEND') break;
      o += 12 + len;
    }
    return out;
  }
  // checkJPG: the JFIF density (APP0) and the frame header (SOFn).
  if (d.length > 4 && d[0] === 0xff && d[1] === 0xd8) {
    const out = { mnPixWidth: 0, mnPixHeight: 0, mnDpiX: 96, mnDpiY: 96 };
    for (let o = 2; o + 4 <= d.length;) {
      if (d[o] !== 0xff) { o++; continue; }
      const marker = d[o + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = v.getUint16(o + 2);
      if (marker === 0xe0 && String.fromCharCode(...d.subarray(o + 4, o + 9)) === 'JFIF\0') {
        const unit = d[o + 11], x = v.getUint16(o + 12), y = v.getUint16(o + 14);
        if (x && y && unit === 1) { out.mnDpiX = x; out.mnDpiY = y; }
        else if (x && y && unit === 2) { out.mnDpiX = x * 2.54; out.mnDpiY = y * 2.54; }
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        out.mnPixHeight = v.getUint16(o + 5); out.mnPixWidth = v.getUint16(o + 7);
        return out;
      }
      o += 2 + len;
    }
    return null;
  }
  // checkGIF: the logical screen size.
  if (d.length > 10 && String.fromCharCode(...d.subarray(0, 3)) === 'GIF') {
    return { mnPixWidth: v.getUint16(6, true), mnPixHeight: v.getUint16(8, true), mnDpiX: 96, mnDpiY: 96 };
  }
  // checkBMP: 'BM' (or an OS/2 bitmap array 'BA' before it), sizes and pixels per metre.
  {
    const nOffset = d[0] === 0x42 && d[1] === 0x41 ? 14 : 0;
    if (d.length >= nOffset + 46 && d[nOffset] === 0x42 && d[nOffset + 1] === 0x4d
      && ((d[6 + nOffset] === 0 && d[7 + nOffset] === 0 && d[8 + nOffset] === 0 && d[9 + nOffset] === 0) || d[14 + nOffset] === 0x28 || d[14 + nOffset] === 0x0c)) {
      const o = nOffset + 2 + 0x10;
      const bits = v.getUint16(o + 10, true), nCompression = v.getUint32(o + 12, true);
      // further validation, check for rational values
      if (bits > 24 || nCompression > 3) return null;
      const x = v.getUint32(o + 20, true), y = v.getUint32(o + 24, true);
      return { mnPixWidth: v.getUint32(o, true), mnPixHeight: Math.abs(v.getInt32(o + 4, true)), mnDpiX: x && y ? (x * 254) / 10000 : 96, mnDpiY: x && y ? (y * 254) / 10000 : 96 };
    }
  }
  // checkWEBP: RIFF....WEBP, then the first chunk.
  if (d.length >= 30 && String.fromCharCode(...d.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...d.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...d.subarray(12, 16));
    const u24 = (o: number) => d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16);
    if (chunk === 'VP8X') return { mnPixWidth: u24(24) + 1, mnPixHeight: u24(27) + 1, mnDpiX: 96, mnDpiY: 96 };
    if (chunk === 'VP8 ') return { mnPixWidth: v.getUint16(26, true) & 0x3fff, mnPixHeight: v.getUint16(28, true) & 0x3fff, mnDpiX: 96, mnDpiY: 96 };
    if (chunk === 'VP8L' && d[20] === 0x2f) {
      const b = v.getUint32(21, true);
      return { mnPixWidth: (b & 0x3fff) + 1, mnPixHeight: ((b >>> 14) & 0x3fff) + 1, mnDpiX: 96, mnDpiY: 96 };
    }
    return null;
  }
  // checkTIF: the first image file directory.
  if (IsTiff(d)) {
    const t = GetTiffSize(d);
    return t ? { mnPixWidth: t.width, mnPixHeight: t.height, mnDpiX: t.dpiX ?? 96, mnDpiY: t.dpiY ?? 96 } : null;
  }
  return null;
}

/** Graphic::GetPrefSize in twips. */
export function GetPrefSizeTwips(d: Uint8Array): { width: number; height: number } | null {
  const m = DetectGraphic(d);
  return m && m.mnPixWidth && m.mnPixHeight ? { width: (m.mnPixWidth * 1440) / m.mnDpiX, height: (m.mnPixHeight * 1440) / m.mnDpiY } : null;
}
