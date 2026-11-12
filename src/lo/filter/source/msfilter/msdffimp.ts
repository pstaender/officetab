// SPDX-License-Identifier: MPL-2.0
// @upstream filter/source/msfilter/msdffimp.cxx reduced
// The Office Drawing (Escher, OfficeArt) records of Word 97-2003 files: the common record header,
// a walk over nested records, and SvxMSDffManager::GetBLIPDirect, which takes the image out of a
// BLIP record. Reduced: the images are returned as file bytes with their media type instead of a
// Graphic (a DIB gets a BMP file header; metafiles are inflated); PICT is not read. The shape
// import (SvxMSDffManager::ImportObj) is in ww8par's reduced reading of the drawing.

/** DFF_COMMON_RECORD_HEADER: version, instance, type and length of a record at `o`. */
export interface DffRecordHeader { nRecVer: number; nRecInstance: number; nRecType: number; nRecLen: number; nFilePos: number }

export function ReadCommonRecordHeader(b: Uint8Array, o: number): DffRecordHeader | null {
  if (o + 8 > b.length) return null;
  const v = new DataView(b.buffer, b.byteOffset + o, 8);
  const verInst = v.getUint16(0, true);
  return { nRecVer: verInst & 0xf, nRecInstance: verInst >> 4, nRecType: v.getUint16(2, true), nRecLen: v.getUint32(4, true), nFilePos: o };
}

/** Calls `f` for every record from `start` to `end`, descending into containers (version 0xF). */
export function WalkEscher(b: Uint8Array, start: number, end: number, f: (h: DffRecordHeader) => boolean | void, depth = 0): void {
  for (let o = start; o + 8 <= end;) {
    const h = ReadCommonRecordHeader(b, o);
    if (!h) break;
    const bodyEnd = Math.min(end, o + 8 + h.nRecLen);
    if (f(h) === true) return;
    if (h.nRecVer === 0xf && depth < 16) WalkEscher(b, o + 8, bodyEnd, f, depth + 1);
    if (h.nRecLen === 0 && h.nRecVer !== 0xf) { o += 8; continue; }
    o = o + 8 + h.nRecLen;
  }
}

/** OfficeArtBlipRecInstance, without the lowest bit (which marks a second UID). */
const BLIP = { EMF: 0x3d4, WMF: 0x216, PICT: 0x542, JPEG_RGB: 0x46a, JPEG_CMYK: 0x6e2, PNG: 0x6e0, DIB: 0x7a8, TIFF: 0x6e4 } as const;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A DIB (BITMAPINFOHEADER and pixels) as a BMP file: the 14-byte BITMAPFILEHEADER in front. */
function DibToBmp(dib: Uint8Array): Uint8Array {
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const biSize = dib.length >= 4 ? v.getUint32(0, true) : 40;
  const bitCount = dib.length >= 16 ? v.getUint16(14, true) : 24;
  const compression = dib.length >= 20 ? v.getUint32(16, true) : 0;
  const clrUsed = dib.length >= 36 ? v.getUint32(32, true) : 0;
  const colors = clrUsed || (bitCount <= 8 ? 1 << bitCount : 0);
  const masks = compression === 3 && biSize === 40 ? 12 : 0;
  const out = new Uint8Array(14 + dib.length);
  const w = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  w.setUint32(2, out.length, true);
  w.setUint32(10, 14 + biSize + masks + 4 * colors, true);
  out.set(dib, 14);
  return out;
}

/** SvxMSDffManager::GetBLIPDirect: the image of the BLIP record at `o`, or null. */
export async function GetBLIPDirect(b: Uint8Array, o: number): Promise<{ data: Uint8Array; mime: string } | null> {
  const h = ReadCommonRecordHeader(b, o);
  if (!h || h.nRecType < 0xf018 || h.nRecType > 0xf117) return null;
  const body = b.subarray(o + 8, Math.min(b.length, o + 8 + h.nRecLen));
  const inst = h.nRecInstance & 0xfffe;
  let nSkip = h.nRecInstance & 1 ? 32 : 16;
  switch (inst) {
    case BLIP.EMF: case BLIP.WMF: {
      // The metafile header (34 bytes) after the UIDs, then the zlib-compressed metafile.
      try {
        const data = await inflate(body.subarray(nSkip + 34));
        return { data, mime: inst === BLIP.EMF ? 'image/x-emf' : 'image/x-wmf' };
      } catch { return null; }
    }
    case BLIP.JPEG_RGB: case BLIP.JPEG_CMYK: nSkip += 1; return { data: body.slice(nSkip), mime: 'image/jpeg' };
    case BLIP.PNG: nSkip += 1; return { data: body.slice(nSkip), mime: 'image/png' };
    case BLIP.TIFF: nSkip += 1; return { data: body.slice(nSkip), mime: 'image/tiff' };
    case BLIP.DIB: nSkip += 1; return { data: DibToBmp(body.subarray(nSkip)), mime: 'image/bmp' };
    default: return null; // PICT and unknown kinds
  }
}

/**
 * The picture of the shape between `start` and `end`: a BLIP there (directly or in an FBSE), else
 * the BStore entry its pib names, as GetBLIPDirect reads it.
 */
export async function FindBLIP(b: Uint8Array, start: number, end: number, bstore?: BStore): Promise<{ data: Uint8Array; mime: string } | null> {
  let at = -1;
  WalkEscher(b, start, end, (h) => {
    if (h.nRecType >= 0xf018 && h.nRecType <= 0xf117) { at = h.nFilePos; return true; }
    // OfficeArtFBSE: 36 bytes of its own, then the embedded BLIP.
    if (h.nRecType === 0xf007 && h.nRecLen > 36) {
      const inner = ReadCommonRecordHeader(b, h.nFilePos + 8 + 36);
      if (inner && inner.nRecType >= 0xf018 && inner.nRecType <= 0xf117) { at = h.nFilePos + 8 + 36; return true; }
    }
    return false;
  });
  if (at >= 0) return GetBLIPDirect(b, at);
  const pib = bstore ? GetPib(b, start, end) : 0;
  const entry = pib ? bstore![pib - 1] : null;
  return entry ? GetBLIPDirect(entry.stream, entry.at) : null;
}

/**
 * SvxMSDffManager's BLIP store: the drawing group's OfficeArtBStoreContainer entries (FBSE), each
 * with its BLIP embedded or at foDelay in the delay stream (the WordDocument stream).
 */
export type BStore = ({ stream: Uint8Array; at: number } | null)[];

export function ReadBStore(dgg: Uint8Array, start: number, end: number, delay: Uint8Array): BStore {
  const out: BStore = [];
  WalkEscher(dgg, start, end, (h) => {
    if (h.nRecType !== 0xf007) return false;
    const o = h.nFilePos + 8;
    const v = new DataView(dgg.buffer, dgg.byteOffset, dgg.byteLength);
    const size = o + 28 <= dgg.length ? v.getUint32(o + 20, true) : 0;
    const foDelay = o + 32 <= dgg.length ? v.getUint32(o + 28, true) : 0;
    const cbName = dgg[o + 33] ?? 0;
    if (h.nRecLen > 36 + cbName) out.push({ stream: dgg, at: o + 36 + cbName });
    else if (size && foDelay < delay.length) out.push({ stream: delay, at: foDelay });
    else out.push(null);
    return false;
  });
  return out;
}

/** OfficeArtFOPT's pib (property 0x104): the 1-based BStore index of a shape's picture, or 0. */
export function GetPib(b: Uint8Array, start: number, end: number): number {
  let pib = 0;
  WalkEscher(b, start, end, (h) => {
    if (h.nRecType !== 0xf00b) return false;
    const n = h.nRecInstance, o = h.nFilePos + 8;
    for (let i = 0; i < n && o + 6 * i + 6 <= b.length; i++) {
      const id = (b[o + 6 * i]! | (b[o + 6 * i + 1]! << 8)) & 0x3fff;
      if (id === 0x104) pib = new DataView(b.buffer, b.byteOffset + o + 6 * i + 2, 4).getUint32(0, true);
    }
    return true;
  });
  return pib;
}

/**
 * A shape of a drawing (SvxMSDffManager::ImportObj's record, reduced): its type and id, flags
 * (FSP), properties (FOPT, simple values by id), anchor in its group (FChildAnchor), and for a
 * group its coordinate rectangle (FSPGR) and children.
 */
export interface DffShape {
  nShapeType: number; nShapeId: number; nFlags: number; aProps: Map<number, number>;
  aChildAnchor?: [number, number, number, number];
  aGroupRect?: [number, number, number, number];
  aChildren?: DffShape[];
}
export const SP_FGROUP = 0x1, SP_FCHILD = 0x2, SP_FFLIPH = 0x40, SP_FFLIPV = 0x80;

function readProps(b: Uint8Array, o: number, n: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < n && o + 6 * i + 6 <= b.length; i++) {
    const id = (b[o + 6 * i]! | (b[o + 6 * i + 1]! << 8)) & 0x3fff;
    // Values are signed (positions, distances); colours read them unsigned (>>> 0).
    out.set(id, new DataView(b.buffer, b.byteOffset + o + 6 * i + 2, 4).getInt32(0, true));
  }
  return out;
}
const rect = (b: Uint8Array, o: number): [number, number, number, number] => {
  const v = new DataView(b.buffer, b.byteOffset + o, 16);
  return [v.getInt32(0, true), v.getInt32(4, true), v.getInt32(8, true), v.getInt32(12, true)];
};

/** One SpContainer's own records (not its nested containers). */
function readSp(b: Uint8Array, start: number, end: number): DffShape {
  const sh: DffShape = { nShapeType: 0, nShapeId: 0, nFlags: 0, aProps: new Map() };
  for (let o = start; o + 8 <= end;) {
    const h = ReadCommonRecordHeader(b, o);
    if (!h) break;
    const body = o + 8;
    switch (h.nRecType) {
      case 0xf00a: { const v = new DataView(b.buffer, b.byteOffset + body, 8); sh.nShapeType = h.nRecInstance; sh.nShapeId = v.getUint32(0, true); sh.nFlags = v.getUint32(4, true); break; } // FSP
      case 0xf00b: for (const [k, v] of readProps(b, body, h.nRecInstance)) sh.aProps.set(k, v); break; // FOPT
      case 0xf122: for (const [k, v] of readProps(b, body, h.nRecInstance)) if (!sh.aProps.has(k)) sh.aProps.set(k, v); break; // tertiary FOPT
      case 0xf00f: if (h.nRecLen >= 16) sh.aChildAnchor = rect(b, body); break; // FChildAnchor
      case 0xf009: if (h.nRecLen >= 16) sh.aGroupRect = rect(b, body); break; // FSPGR
      default: break;
    }
    o = body + h.nRecLen;
  }
  return sh;
}

/** An SpgrContainer: its first SpContainer is the group, the rest its children. */
function readSpgr(b: Uint8Array, start: number, end: number, out: Map<number, DffShape>): DffShape | null {
  let group: DffShape | null = null;
  for (let o = start; o + 8 <= end;) {
    const h = ReadCommonRecordHeader(b, o);
    if (!h) break;
    const bEnd = Math.min(end, o + 8 + h.nRecLen);
    let sh: DffShape | null = null;
    if (h.nRecType === 0xf004) sh = readSp(b, o + 8, bEnd);
    else if (h.nRecType === 0xf003) sh = readSpgr(b, o + 8, bEnd, out);
    if (sh) {
      if (!group) { group = sh; group.aChildren = []; }
      else group.aChildren!.push(sh);
      if (sh.nShapeId) out.set(sh.nShapeId, sh);
    }
    o = bEnd;
  }
  return group;
}

/**
 * The drawings after the drawing group in a Word document's OfficeArtContent: for each, its
 * dgglbl (0 the main text, 1 the headers) and its shapes by id (SvxMSDffManager's shape infos).
 */
export function ReadDrawings(b: Uint8Array, start: number, end: number): Map<number, Map<number, DffShape>> {
  const out = new Map<number, Map<number, DffShape>>();
  let o = start;
  const first = ReadCommonRecordHeader(b, o);
  if (first?.nRecType === 0xf000) o += 8 + first.nRecLen;
  while (o + 9 <= end) {
    const dgglbl = b[o]!;
    const h = ReadCommonRecordHeader(b, o + 1);
    if (!h || h.nRecType !== 0xf002) break;
    const shapes = out.get(dgglbl) ?? new Map<number, DffShape>();
    out.set(dgglbl, shapes);
    WalkEscher(b, o + 9, Math.min(end, o + 9 + h.nRecLen), (r) => {
      // The patriarch SpgrContainer holds everything; its shapes and groups are read from there.
      if (r.nRecType === 0xf003) { const g = readSpgr(b, r.nFilePos + 8, r.nFilePos + 8 + r.nRecLen, shapes); if (g?.nShapeId) shapes.set(g.nShapeId, g); return true; }
      return false;
    });
    o += 9 + h.nRecLen;
  }
  return out;
}
