// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/filter/GraphicFormatDetector.cxx reduced
// The pixel size and resolution of PNG, JPEG and GIF data, read from their headers
// (checkPNG, checkJPG, checkGIF with extended info), and the graphic's preferred size from them.
// Other formats are not ported; a graphic without a resolution counts as 96 DPI, the
// resolution LibreOffice assumes for pixel-mapped graphics on screen.

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
  return null;
}

/** Graphic::GetPrefSize in twips. */
export function GetPrefSizeTwips(d: Uint8Array): { width: number; height: number } | null {
  const m = DetectGraphic(d);
  return m && m.mnPixWidth && m.mnPixHeight ? { width: (m.mnPixWidth * 1440) / m.mnDpiX, height: (m.mnPixHeight * 1440) / m.mnDpiY } : null;
}
