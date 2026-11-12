// SPDX-License-Identifier: MPL-2.0
// @upstream sot/source/sdstor/stgelem.cxx reduced
// @upstream sot/source/sdstor/stgstrms.cxx reduced
// @upstream sot/source/sdstor/stgdir.cxx reduced
// @upstream sot/source/sdstor/storage.cxx reduced
// The OLE2 compound document ("structured storage") that holds a Word 97-2003 file's streams.
// Reduced to reading: StgHeader and StgEntry load as upstream does; the FAT, the master FAT and the
// small-block FAT are read whole into tables instead of StgCache's paged access, and the directory
// is a flat list searched by name (StgDirStrm's red-black tree is not needed to find a stream).
// Writing, transacted storages and UCB storages are not ported.

const cStgSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export const STG_FREE = -1;
export const STG_EOF = -2;
export const STG_FAT = -3;
export const STG_MASTER = -4;

export const StgEntryType = { STG_EMPTY: 0, STG_STORAGE: 1, STG_STREAM: 2, STG_ROOT: 5 } as const;

class Reader {
  private v: DataView;
  b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  i32(o: number): number { return o + 4 <= this.b.length ? this.v.getInt32(o, true) : STG_EOF; }
  u16(o: number): number { return o + 2 <= this.b.length ? this.v.getUint16(o, true) : 0; }
  i16(o: number): number { return o + 2 <= this.b.length ? this.v.getInt16(o, true) : 0; }
}

/** StgHeader: the file's first 512 bytes. */
export class StgHeader {
  m_nVersion = 0;
  m_nByteOrder = 0;
  m_nPageSize = 0;
  m_nDataPageSize = 0;
  m_nFATSize = 0;
  m_nTOCstrm = 0;
  m_nThreshold = 0;
  m_nDataFAT = 0;
  m_nDataFATSize = 0;
  m_nMasterChain = 0;
  m_nMaster = 0;
  m_nMasterFAT: number[] = [];
  private m_bSignature = false;

  Load(b: Uint8Array): boolean {
    if (b.length < 512) return false;
    const r = new Reader(b);
    this.m_bSignature = cStgSignature.every((c, i) => b[i] === c);
    this.m_nVersion = r.i32(0x18);
    this.m_nByteOrder = r.u16(0x1c);
    this.m_nPageSize = r.i16(0x1e);
    this.m_nDataPageSize = r.i16(0x20);
    this.m_nFATSize = r.i32(0x2c);
    this.m_nTOCstrm = r.i32(0x30);
    this.m_nThreshold = r.i32(0x38);
    this.m_nDataFAT = r.i32(0x3c);
    this.m_nDataFATSize = r.i32(0x40);
    this.m_nMasterChain = r.i32(0x44);
    this.m_nMaster = r.i32(0x48);
    this.m_nMasterFAT = Array.from({ length: StgHeader.GetFAT1Size() }, (_, i) => r.i32(0x4c + 4 * i));
    return this.Check();
  }

  /**
   * StgHeader::Check: the signature, version 3 and 512-byte pages (as upstream; version 4's
   * 4096-byte pages are accepted too, which upstream rejects).
   */
  Check(): boolean {
    const wontoverflow = (shift: number) => shift >= 0 && shift < 15;
    return this.m_bSignature && ((this.m_nVersion >> 16) === 3 || (this.m_nVersion >> 16) === 4)
      && (this.m_nPageSize === 9 || this.m_nPageSize === 12) && wontoverflow(this.m_nPageSize) && wontoverflow(this.m_nDataPageSize)
      && this.m_nFATSize > 0 && this.m_nTOCstrm >= 0 && this.m_nThreshold > 0 && this.m_nMaster >= 0;
  }

  static GetFAT1Size(): number { return 109; }
}

/** StgEntry: one 128-byte directory entry. */
export class StgEntry {
  m_aName = '';
  m_cType = 0;
  m_nLeft = 0;
  m_nRight = 0;
  m_nChild = 0;
  m_nPage1 = 0;
  m_nSize = 0;

  Load(b: Uint8Array, off: number): boolean {
    if (off + 128 > b.length) return false;
    const r = new Reader(b);
    const nNameLen = r.u16(off + 0x40);
    let n = nNameLen ? (nNameLen >> 1) - 1 : 0;
    if (n > 31) return false;
    n = Math.max(0, n);
    let name = '';
    for (let i = 0; i < n; i++) name += String.fromCharCode(r.u16(off + 2 * i));
    this.m_aName = name;
    this.m_cType = b[off + 0x42]!;
    this.m_nLeft = r.i32(off + 0x44);
    this.m_nRight = r.i32(off + 0x48);
    this.m_nChild = r.i32(off + 0x4c);
    this.m_nPage1 = r.i32(off + 0x74);
    this.m_nSize = r.i32(off + 0x78) >>> 0;
    return true;
  }

  GetType(): number { return this.m_cType; }
}

/**
 * SotStorage over an in-memory compound document: its streams by name, read through the FAT
 * (big streams) or the small-block FAT and the root's mini stream (streams below the threshold).
 */
export class Storage {
  private aHdr = new StgHeader();
  private aFAT: number[] = [];
  private aDataFAT: number[] = [];
  private aEntries: StgEntry[] = [];
  private aMini: Uint8Array = new Uint8Array(0);
  private nPage = 512;
  private nDataPage = 64;

  private b: Uint8Array;

  constructor(b: Uint8Array) {
    this.b = b;
    if (!this.aHdr.Load(b)) throw new Error('not a compound document');
    this.nPage = 1 << this.aHdr.m_nPageSize;
    this.nDataPage = 1 << this.aHdr.m_nDataPageSize;
    const r = new Reader(b);
    // The master FAT: the header's pages, then the chain of master blocks.
    const fatPages = this.aHdr.m_nMasterFAT.slice(0, this.aHdr.m_nFATSize);
    let master = this.aHdr.m_nMasterChain;
    const per = this.nPage / 4 - 1;
    for (let k = 0; k < this.aHdr.m_nMaster && master >= 0 && fatPages.length < this.aHdr.m_nFATSize; k++) {
      const off = this.pageOffset(master);
      for (let i = 0; i < per && fatPages.length < this.aHdr.m_nFATSize; i++) fatPages.push(r.i32(off + 4 * i));
      master = r.i32(off + 4 * per);
    }
    for (const p of fatPages) {
      if (p < 0) break;
      const off = this.pageOffset(p);
      for (let i = 0; i < this.nPage / 4; i++) this.aFAT.push(r.i32(off + 4 * i));
    }
    // The directory (TOC stream).
    const toc = this.readChain(this.aHdr.m_nTOCstrm, -1);
    for (let off = 0; off + 128 <= toc.length; off += 128) {
      const e = new StgEntry();
      if (e.Load(toc, off)) this.aEntries.push(e);
    }
    // The small-block FAT and the root entry's mini stream.
    if (this.aHdr.m_nDataFAT >= 0) {
      const dfat = this.readChain(this.aHdr.m_nDataFAT, -1);
      const dr = new Reader(dfat);
      for (let i = 0; i + 4 <= dfat.length; i += 4) this.aDataFAT.push(dr.i32(i));
    }
    const root = this.aEntries[0];
    if (root && root.m_nPage1 >= 0) this.aMini = this.readChain(root.m_nPage1, root.m_nSize);
  }

  private pageOffset(p: number): number { return (p + 1) * this.nPage; }

  /** StgFATStrm: the pages of a chain, at most `size` bytes (all with -1). */
  private readChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    const seen = new Set<number>();
    for (let p = start; p >= 0 && !seen.has(p) && (size < 0 || total < size); p = this.aFAT[p] ?? STG_EOF) {
      seen.add(p);
      const off = this.pageOffset(p);
      const part = this.b.subarray(off, Math.min(off + this.nPage, this.b.length));
      parts.push(part);
      total += part.length;
    }
    return concat(parts, size < 0 ? total : Math.min(size, total));
  }

  /** StgSmallStrm: a stream below the threshold, in 64-byte blocks of the mini stream. */
  private readSmall(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    const seen = new Set<number>();
    for (let p = start; p >= 0 && !seen.has(p) && total < size; p = this.aDataFAT[p] ?? STG_EOF) {
      seen.add(p);
      const off = p * this.nDataPage;
      const part = this.aMini.subarray(off, Math.min(off + this.nDataPage, this.aMini.length));
      parts.push(part);
      total += part.length;
    }
    return concat(parts, Math.min(size, total));
  }

  /** The entries directly in the root storage (the root's child tree, flattened). */
  private children(of: number): StgEntry[] {
    const out: StgEntry[] = [];
    const seen = new Set<number>();
    const walk = (i: number) => {
      if (i < 0 || i >= this.aEntries.length || seen.has(i)) return;
      seen.add(i);
      const e = this.aEntries[i]!;
      walk(e.m_nLeft);
      out.push(e);
      walk(e.m_nRight);
    };
    walk(this.aEntries[of]?.m_nChild ?? -1);
    return out;
  }

  /** SotStorage::IsStream: whether the root holds a stream of this name (case-insensitive, as upstream). */
  IsStream(name: string): boolean { return !!this.find(name); }

  private find(name: string): StgEntry | undefined {
    const n = name.toUpperCase();
    return this.children(0).find((e) => e.GetType() === StgEntryType.STG_STREAM && e.m_aName.toUpperCase() === n);
  }

  /** SotStorage::OpenSotStream for reading: the stream's bytes, or undefined. */
  OpenStream(name: string): Uint8Array | undefined {
    const e = this.find(name);
    if (!e) return undefined;
    return e.m_nSize < this.aHdr.m_nThreshold ? this.readSmall(e.m_nPage1, e.m_nSize) : this.readChain(e.m_nPage1, e.m_nSize);
  }

  /** The names of the root's streams and storages. */
  GetNames(): string[] { return this.children(0).map((e) => e.m_aName); }
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    if (at >= size) break;
    const n = Math.min(p.length, size - at);
    out.set(p.subarray(0, n), at);
    at += n;
  }
  return out;
}

/** Whether bytes start with the compound document signature (a .doc, .xls, .ppt …). */
export const IsStorageFile = (b: Uint8Array): boolean => b.length >= 8 && cStgSignature.every((c, i) => b[i] === c);
