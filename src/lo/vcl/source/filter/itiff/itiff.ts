// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/filter/itiff/itiff.cxx reduced
// ImportTiffGraphicImport reads TIFF through libtiff upstream (TIFFReadRGBAImageOriented). libtiff
// is not part of LibreOffice, so this reduced port decodes baseline TIFF itself into the same RGBA
// raster: strips and tiles, chunky and planar layouts, no compression, LZW, PackBits and Deflate,
// the horizontal predictor, and bilevel, grey, RGB, palette, CMYK and separated alpha samples.
// Only the first image of the file is read (upstream makes an Animation of several); CCITT fax,
// JPEG, YCbCr, floating point samples and the floating point predictor are not decoded, and such
// files are rejected as libtiff would fail on a broken file. Alpha comes out straight (the image's
// own colours), where libtiff's raster is premultiplied.

/** The decoded image: RGBA rows from the top left, and the resolution in pixels per inch, if any. */
export interface TiffImage { width: number; height: number; data: Uint8ClampedArray; dpiX?: number; dpiY?: number }

const COMPRESSION_NONE = 1, COMPRESSION_LZW = 5, COMPRESSION_ADOBE_DEFLATE = 8, COMPRESSION_DEFLATE = 32946, COMPRESSION_PACKBITS = 32773;
const PHOTOMETRIC_MINISWHITE = 0, PHOTOMETRIC_MINISBLACK = 1, PHOTOMETRIC_RGB = 2, PHOTOMETRIC_PALETTE = 3, PHOTOMETRIC_SEPARATED = 5;
const ORIENTATION_TOPLEFT = 1, ORIENTATION_LEFTBOT = 8;
const RESUNIT_NONE = 1, RESUNIT_INCH = 2, RESUNIT_CENTIMETER = 3;

/** Whether the data starts as a TIFF file does (GraphicFormatDetector::checkTIF). */
export function IsTiff(d: Uint8Array): boolean {
  return d.length >= 8 && ((d[0] === 0x49 && d[1] === 0x49 && d[2] === 42 && d[3] === 0) || (d[0] === 0x4d && d[1] === 0x4d && d[2] === 0 && d[3] === 42));
}

/** The tags of the first image file directory, each as its list of values. */
function ReadDirectory(d: Uint8Array): { tags: Map<number, number[]>; le: boolean } | null {
  if (!IsTiff(d)) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const le = d[0] === 0x49;
  const u16 = (o: number) => v.getUint16(o, le), u32 = (o: number) => v.getUint32(o, le);
  const ifd = u32(4);
  if (ifd + 2 > d.length) return null;
  const n = u16(ifd);
  const tags = new Map<number, number[]>();
  const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > d.length) return null;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = SIZE[type];
    if (!size || count > 1 << 24) continue;
    const at = size * count <= 4 ? e + 8 : u32(e + 8);
    if (at + size * count > d.length) continue;
    const vals: number[] = [];
    for (let k = 0; k < count; k++) {
      const o = at + k * size;
      switch (type) {
        case 1: case 2: case 7: vals.push(d[o]!); break;
        case 6: vals.push(v.getInt8(o)); break;
        case 3: vals.push(u16(o)); break;
        case 8: vals.push(v.getInt16(o, le)); break;
        case 4: vals.push(u32(o)); break;
        case 9: vals.push(v.getInt32(o, le)); break;
        case 5: { const den = u32(o + 4); vals.push(den ? u32(o) / den : 0); break; }
        case 10: { const den = v.getInt32(o + 4, le); vals.push(den ? v.getInt32(o, le) / den : 0); break; }
        case 11: vals.push(v.getFloat32(o, le)); break;
        case 12: vals.push(v.getFloat64(o, le)); break;
      }
    }
    tags.set(tag, vals);
  }
  return { tags, le };
}

/** The size in pixels and resolution of a TIFF file, from its first directory (GraphicFormatDetector::checkTIF). */
export function GetTiffSize(d: Uint8Array): { width: number; height: number; dpiX?: number; dpiY?: number } | null {
  const dir = ReadDirectory(d);
  const w = dir?.tags.get(256)?.[0], h = dir?.tags.get(257)?.[0];
  if (!w || !h) return null;
  const unit = dir!.tags.get(296)?.[0] ?? RESUNIT_INCH, xres = dir!.tags.get(282)?.[0], yres = dir!.tags.get(283)?.[0];
  if (unit === RESUNIT_NONE || !xres || !yres) return { width: w, height: h };
  const f = unit === RESUNIT_CENTIMETER ? 2.54 : 1;
  return { width: w, height: h, dpiX: xres * f, dpiY: yres * f };
}

/** LZWDecode (tif_lzw.c): MSB-first codes of 9 to 12 bits, widened one code early. */
function LZWDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let op = 0;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { suffix[i] = i; length[i] = 1; prefix[i] = -1; }
  let next = 258, width = 9, old = -1;
  let bitBuf = 0, bitCnt = 0, sp = 0;
  const readCode = (): number => {
    while (bitCnt < width) { if (sp >= src.length) return 257; bitBuf = ((bitBuf << 8) | src[sp++]!) >>> 0; bitCnt += 8; }
    bitCnt -= width;
    return (bitBuf >>> bitCnt) & ((1 << width) - 1);
  };
  const emit = (code: number) => {
    const len = length[code]!;
    let end = op + len;
    if (end > expected) end = expected;
    for (let p = op + len - 1, c = code; c >= 0 && p >= op; p--, c = prefix[c]!) if (p < expected) out[p] = suffix[c]!;
    op = end;
  };
  const first = (code: number) => { let c = code; while (prefix[c]! >= 0) c = prefix[c]!; return suffix[c]!; };
  for (;;) {
    const code = readCode();
    if (code === 257 || op >= expected) break;
    if (code === 256) { next = 258; width = 9; old = -1; continue; }
    if (old < 0) { if (code > 255) break; emit(code); old = code; continue; }
    if (code < next) {
      emit(code);
      if (next < 4096) { prefix[next] = old; suffix[next] = first(code); length[next] = length[old]! + 1; next++; }
    } else if (code === next && next < 4096) {
      prefix[next] = old; suffix[next] = first(old); length[next] = length[old]! + 1; next++;
      emit(code);
    } else break;
    old = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

/** PackBitsDecode (tif_packbits.c) */
function PackBitsDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let op = 0, sp = 0;
  while (sp < src.length && op < expected) {
    const n = (src[sp++]! << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n && sp < src.length && op < expected; k++) out[op++] = src[sp++]!; }
    else if (n !== -128) { const b = src[sp++] ?? 0; for (let k = 0; k < 1 - n && op < expected; k++) out[op++] = b; }
  }
  return out;
}

/** ZIPDecode (tif_zip.c), through the platform's zlib stream. */
async function DeflateDecode(src: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = new Uint8Array(expected);
  out.set(buf.subarray(0, expected));
  return out;
}

/**
 * ImportTiffGraphicImport: the first image of a TIFF file as an RGBA raster, oriented top left;
 * null when it cannot be read.
 */
export async function ImportTiffGraphicImport(d: Uint8Array): Promise<TiffImage | null> {
  const dir = ReadDirectory(d);
  if (!dir) return null;
  const { tags, le } = dir;
  const one = (t: number, def: number) => tags.get(t)?.[0] ?? def;
  const w = one(256, 0), h = one(257, 0);
  if (!w || !h || w > 0x7fffffff / 32 || h > 0x7fffffff / 32 || w * h > 0x7fffffff / 8) return null;
  const Compression = one(259, COMPRESSION_NONE);
  const Photometric = one(262, PHOTOMETRIC_MINISBLACK);
  const spp = one(277, 1);
  const bps = one(258, 1);
  const planar = one(284, 1);
  const predictor = one(317, 1);
  const sampleFormat = one(339, 1);
  if (![1, 2, 4, 8, 16].includes(bps) || sampleFormat === 3 || predictor === 3) return null;
  if (![COMPRESSION_NONE, COMPRESSION_LZW, COMPRESSION_PACKBITS, COMPRESSION_ADOBE_DEFLATE, COMPRESSION_DEFLATE].includes(Compression)) return null;
  if (![PHOTOMETRIC_MINISWHITE, PHOTOMETRIC_MINISBLACK, PHOTOMETRIC_RGB, PHOTOMETRIC_PALETTE, PHOTOMETRIC_SEPARATED].includes(Photometric)) return null;
  const extra = tags.get(338) ?? [];
  const tiled = tags.has(322);
  const bw = tiled ? one(322, w) : w;
  const bh = tiled ? one(323, h) : Math.min(one(278, h), h);
  const offsets = tags.get(tiled ? 324 : 273) ?? [];
  const counts = tags.get(tiled ? 325 : 279) ?? [];
  if (!offsets.length || !bw || !bh) return null;
  const across = Math.ceil(w / bw), down = Math.ceil(h / bh);
  const planes = planar === 2 ? spp : 1;
  const sppBlock = planar === 2 ? 1 : spp;
  const rowBytes = Math.ceil((bw * sppBlock * bps) / 8);
  // The samples of the whole image, one array per plane, row by row.
  const imgRow = Math.ceil((w * sppBlock * bps) / 8);
  const planesData = Array.from({ length: planes }, () => new Uint8Array(imgRow * h));
  for (let p = 0; p < planes; p++) {
    for (let by = 0; by < down; by++) {
      for (let bx = 0; bx < across; bx++) {
        const idx = p * across * down + by * across + bx;
        const off = offsets[idx], cnt = counts[idx] ?? d.length - (off ?? 0);
        if (off === undefined || off >= d.length) continue;
        const raw = d.subarray(off, Math.min(d.length, off + cnt));
        const rows = tiled ? bh : Math.min(bh, h - by * bh);
        const expected = rowBytes * rows;
        let block: Uint8Array;
        if (Compression === COMPRESSION_LZW) block = LZWDecode(raw, expected);
        else if (Compression === COMPRESSION_PACKBITS) block = PackBitsDecode(raw, expected);
        else if (Compression === COMPRESSION_NONE) { block = new Uint8Array(expected); block.set(raw.subarray(0, expected)); }
        else { try { block = await DeflateDecode(raw, expected); } catch { return null; } }
        // horAcc8 / horAcc16 (tif_predict.c)
        if (predictor === 2) {
          for (let r = 0; r < rows; r++) {
            const base = r * rowBytes;
            if (bps === 8) for (let i = sppBlock; i < bw * sppBlock; i++) block[base + i] = (block[base + i]! + block[base + i - sppBlock]!) & 0xff;
            else if (bps === 16) {
              const dv = new DataView(block.buffer, block.byteOffset + base, rowBytes);
              for (let i = sppBlock; i < bw * sppBlock; i++) dv.setUint16(i * 2, (dv.getUint16(i * 2, le) + dv.getUint16((i - sppBlock) * 2, le)) & 0xffff, le);
            }
          }
        }
        // Copy the block into the image (bit packed rows copy whole when the block spans the width).
        for (let r = 0; r < rows; r++) {
          const y = by * bh + r;
          if (y >= h) break;
          if (bx === 0 && bw >= w) planesData[p]!.set(block.subarray(r * rowBytes, r * rowBytes + imgRow), y * imgRow);
          else if (bps >= 8) {
            const bpp = (sppBlock * bps) / 8;
            const n = Math.min(bw, w - bx * bw) * bpp;
            planesData[p]!.set(block.subarray(r * rowBytes, r * rowBytes + n), y * imgRow + bx * bw * bpp);
          } else {
            for (let x = 0; x < bw && bx * bw + x < w; x++) for (let s = 0; s < sppBlock; s++) {
              const bit = (x * sppBlock + s) * bps;
              const val = (block[r * rowBytes + (bit >> 3)]! >> (8 - bps - (bit & 7))) & ((1 << bps) - 1);
              const dbit = ((bx * bw + x) * sppBlock + s) * bps;
              const di = y * imgRow + (dbit >> 3);
              planesData[p]![di] = planesData[p]![di]! | (val << (8 - bps - (dbit & 7)));
            }
          }
        }
      }
    }
  }
  const max = (1 << bps) - 1;
  const sample = (x: number, y: number, s: number): number => {
    const p = planar === 2 ? s : 0, k = planar === 2 ? 0 : s;
    const row = planesData[p]!, i = (x * sppBlock + k);
    if (bps === 8) return row[y * imgRow + i]!;
    if (bps === 16) { const o = y * imgRow + i * 2; return le ? row[o]! | (row[o + 1]! << 8) : (row[o]! << 8) | row[o + 1]!; }
    const bit = i * bps;
    return (row[y * imgRow + (bit >> 3)]! >> (8 - bps - (bit & 7))) & max;
  };
  const to8 = (v: number) => (bps === 8 ? v : Math.round((v * 255) / max));
  const colorMap = tags.get(320);
  const color = Photometric === PHOTOMETRIC_RGB ? 3 : Photometric === PHOTOMETRIC_SEPARATED ? 4 : 1;
  const alphaAt = spp > color && (extra[0] === 1 || extra[0] === 2) ? color : -1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r: number, g: number, b: number;
      switch (Photometric) {
        case PHOTOMETRIC_RGB: r = to8(sample(x, y, 0)); g = to8(sample(x, y, 1)); b = to8(sample(x, y, 2)); break;
        case PHOTOMETRIC_PALETTE: {
          const i = sample(x, y, 0), n = 1 << bps;
          r = (colorMap?.[i] ?? 0) >> 8; g = (colorMap?.[n + i] ?? 0) >> 8; b = (colorMap?.[2 * n + i] ?? 0) >> 8;
          break;
        }
        case PHOTOMETRIC_SEPARATED: {
          const k = 255 - to8(sample(x, y, 3));
          r = ((255 - to8(sample(x, y, 0))) * k) / 255; g = ((255 - to8(sample(x, y, 1))) * k) / 255; b = ((255 - to8(sample(x, y, 2))) * k) / 255;
          break;
        }
        default: {
          const v = to8(sample(x, y, 0));
          r = g = b = Photometric === PHOTOMETRIC_MINISWHITE ? 255 - v : v;
        }
      }
      let a = alphaAt >= 0 ? to8(sample(x, y, alphaAt)) : 255;
      // Associated alpha is premultiplied (extra sample 1).
      if (alphaAt >= 0 && extra[0] === 1 && a) { r = (r * 255) / a; g = (g * 255) / a; b = (b * 255) / a; }
      if (a > 255) a = 255;
      const o = (y * w + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  const nOrientation = one(274, ORIENTATION_TOPLEFT);
  let img: TiffImage = { width: w, height: h, data: out };
  if (nOrientation === ORIENTATION_LEFTBOT) {
    // Mirrored horizontally, then bitmap.Rotate(2700_deg10).
    const rot = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = w - 1 - x;
      const nx = h - 1 - y, ny = x;
      rot.set(out.subarray((y * w + sx) * 4, (y * w + sx) * 4 + 4), (ny * h + nx) * 4);
    }
    img = { width: h, height: w, data: rot };
  }
  const ResolutionUnit = one(296, RESUNIT_INCH);
  const xres = one(282, 0), yres = one(283, 0);
  if (ResolutionUnit !== RESUNIT_NONE && xres && yres) {
    const f = ResolutionUnit === RESUNIT_CENTIMETER ? 2.54 : 1;
    img.dpiX = xres * f; img.dpiY = yres * f;
  }
  return img;
}
