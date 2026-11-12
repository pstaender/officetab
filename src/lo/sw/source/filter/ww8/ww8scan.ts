// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ww8/ww8scan.cxx reduced
// Reading a Word 97-2003 (WW8) file's structures: WW8Fib, the piece table (WW8PLCFpcd), the
// character and paragraph property FKPs (WW8PLCFx_Fc_FKP::WW8Fkp), the sprm sizes
// (wwSprmParser), the style sheet (WW8Style), the font table (WW8Fonts) and the section table
// (PlcfSed with its SEPX). Reduced: Word 6/95 and earlier (WW6-, with their one-byte sprms) are not
// read, the piece table's single-sprm Prm variant is skipped, and the structures are read whole
// into arrays instead of upstream's iterators over the PLCFs.

/** Little-endian reads that stay in range (0 past the end, as a short stream reads). */
export class WW8Bytes {
  private v: DataView;
  b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u8(o: number): number { return o >= 0 && o < this.b.length ? this.b[o]! : 0; }
  u16(o: number): number { return o >= 0 && o + 2 <= this.b.length ? this.v.getUint16(o, true) : 0; }
  i16(o: number): number { return o >= 0 && o + 2 <= this.b.length ? this.v.getInt16(o, true) : 0; }
  u32(o: number): number { return o >= 0 && o + 4 <= this.b.length ? this.v.getUint32(o, true) : 0; }
  i32(o: number): number { return o >= 0 && o + 4 <= this.b.length ? this.v.getInt32(o, true) : 0; }
  slice(o: number, n: number): Uint8Array { return this.b.subarray(Math.max(0, o), Math.max(0, Math.min(this.b.length, o + n))); }
}

/** WW8Fib: the File Information Block at the start of the WordDocument stream (Word 97+ layout). */
export class WW8Fib {
  wIdent = 0;
  nFib = 0;
  lid = 0;
  fComplex = false;
  fEncrypted = false;
  fWhichTblStm = false;
  ccpText = 0;
  ccpFtn = 0;
  ccpHdr = 0;
  ccpMcr = 0;
  ccpAtn = 0;
  ccpEdn = 0;
  ccpTxbx = 0;
  ccpHdrTxbx = 0;
  /** The fc/lcb pairs read here, by name. */
  fcStshf = 0; lcbStshf = 0;
  fcPlcffndRef = 0; lcbPlcffndRef = 0;
  fcPlcffndTxt = 0; lcbPlcffndTxt = 0;
  fcPlcfendTxt = 0; lcbPlcfendTxt = 0;
  fcPlcfsed = 0; lcbPlcfsed = 0;
  fcPlcfHdd = 0; lcbPlcfHdd = 0;
  fcPlcfbteChpx = 0; lcbPlcfbteChpx = 0;
  fcPlcfbtePapx = 0; lcbPlcfbtePapx = 0;
  fcSttbfffn = 0; lcbSttbfffn = 0;
  fcPlcfLst = 0; lcbPlcfLst = 0;
  fcPlfLfo = 0; lcbPlfLfo = 0;
  fcClx = 0; lcbClx = 0;
  fcDop = 0; lcbDop = 0;
  fcPlcfandRef = 0; lcbPlcfandRef = 0;
  fcPlcfandTxt = 0; lcbPlcfandTxt = 0;
  fcGrpXstAtnOwners = 0; lcbGrpXstAtnOwners = 0;
  fcSttbfAtnBkmk = 0; lcbSttbfAtnBkmk = 0;
  fcPlcfAtnBkf = 0; lcbPlcfAtnBkf = 0;
  fcPlcfAtnBkl = 0; lcbPlcfAtnBkl = 0;
  fcAtrdExtra = 0; lcbAtrdExtra = 0;
  fcPlcfendRef = 0; lcbPlcfendRef = 0;
  fcPlcfspaMom = 0; lcbPlcfspaMom = 0;
  fcDggInfo = 0; lcbDggInfo = 0;
  fcPlcfspaHdr = 0; lcbPlcfspaHdr = 0;
  fcPlcftxbxTxt = 0; lcbPlcftxbxTxt = 0;
  fcPlcfHdrtxbxTxt = 0; lcbPlcfHdrtxbxTxt = 0;

  constructor(b: WW8Bytes) {
    this.wIdent = b.u16(0);
    this.nFib = b.u16(2);
    this.lid = b.u16(6);
    const flags = b.u16(10);
    this.fComplex = !!(flags & 0x0004);
    this.fEncrypted = !!(flags & 0x0100);
    this.fWhichTblStm = !!(flags & 0x0200);
    // fibRgLw97 starts after csw and fibRgW97 (14 shorts) and cslw: at 0x40.
    this.ccpText = b.i32(0x4c);
    this.ccpFtn = b.i32(0x50);
    this.ccpHdr = b.i32(0x54);
    this.ccpMcr = b.i32(0x58);
    this.ccpAtn = b.i32(0x5c);
    this.ccpEdn = b.i32(0x60);
    this.ccpTxbx = b.i32(0x64);
    this.ccpHdrTxbx = b.i32(0x68);
    // fibRgFcLcb97 starts at 0x9a: pairs of fc and lcb.
    const pair = (i: number): [number, number] => [b.u32(0x9a + 8 * i), b.u32(0x9a + 8 * i + 4)];
    [this.fcStshf, this.lcbStshf] = pair(1);
    [this.fcPlcffndRef, this.lcbPlcffndRef] = pair(2);
    [this.fcPlcffndTxt, this.lcbPlcffndTxt] = pair(3);
    [this.fcPlcfandRef, this.lcbPlcfandRef] = pair(4);
    [this.fcPlcfandTxt, this.lcbPlcfandTxt] = pair(5);
    [this.fcGrpXstAtnOwners, this.lcbGrpXstAtnOwners] = pair(36);
    [this.fcSttbfAtnBkmk, this.lcbSttbfAtnBkmk] = pair(37);
    [this.fcPlcfAtnBkf, this.lcbPlcfAtnBkf] = pair(42);
    [this.fcPlcfAtnBkl, this.lcbPlcfAtnBkl] = pair(43);
    // Word 2002 and later (more than 113 pairs, as upstream): the comments' dates.
    if (b.u16(0x98) > 113) [this.fcAtrdExtra, this.lcbAtrdExtra] = pair(112);
    [this.fcPlcfsed, this.lcbPlcfsed] = pair(6);
    [this.fcPlcfHdd, this.lcbPlcfHdd] = pair(11);
    [this.fcPlcfbteChpx, this.lcbPlcfbteChpx] = pair(12);
    [this.fcPlcfbtePapx, this.lcbPlcfbtePapx] = pair(13);
    [this.fcSttbfffn, this.lcbSttbfffn] = pair(15);
    [this.fcDop, this.lcbDop] = pair(31);
    [this.fcClx, this.lcbClx] = pair(33);
    [this.fcPlcfspaMom, this.lcbPlcfspaMom] = pair(40);
    [this.fcDggInfo, this.lcbDggInfo] = pair(50);
    [this.fcPlcfspaHdr, this.lcbPlcfspaHdr] = pair(41);
    [this.fcPlcftxbxTxt, this.lcbPlcftxbxTxt] = pair(56);
    [this.fcPlcfHdrtxbxTxt, this.lcbPlcfHdrtxbxTxt] = pair(58);
    [this.fcPlcfendRef, this.lcbPlcfendRef] = pair(46);
    [this.fcPlcfendTxt, this.lcbPlcfendTxt] = pair(47);
    [this.fcPlcfLst, this.lcbPlcfLst] = pair(73);
    [this.fcPlfLfo, this.lcbPlfLfo] = pair(74);
  }

  /** ww::IsEightPlus: Word 97 or later (nFib 0xC1 and up). */
  IsEightPlus(): boolean { return this.wIdent === 0xa5ec && this.nFib >= 0xc1; }
}

/** WW8PLCFpcd's pieces: the text from cp to cp + n is at fc, one byte per character (cp1252) when compressed. */
export interface WW8Piece { cpStart: number; cpEnd: number; fc: number; compressed: boolean; prm: number }

/** WW8ScannerBase::OpenPieceTable: the Clx's Prc grpprls and the piece table. */
export function ReadClx(table: WW8Bytes, fib: WW8Fib): { pieces: WW8Piece[]; prcs: Uint8Array[] } {
  const prcs: Uint8Array[] = [];
  let o = fib.fcClx;
  const end = fib.fcClx + fib.lcbClx;
  while (o < end) {
    const clxt = table.u8(o);
    if (clxt === 1) { const cb = table.u16(o + 1); prcs.push(table.slice(o + 3, cb)); o += 3 + cb; }
    else if (clxt === 2) {
      const lcb = table.u32(o + 1);
      const p = o + 5, n = Math.floor((lcb - 4) / 12);
      const pieces: WW8Piece[] = [];
      for (let i = 0; i < n; i++) {
        const fcRaw = table.u32(p + 4 * (n + 1) + 8 * i + 2);
        const compressed = !!(fcRaw & 0x40000000);
        pieces.push({ cpStart: table.i32(p + 4 * i), cpEnd: table.i32(p + 4 * (i + 1)), fc: compressed ? (fcRaw & ~0x40000000) / 2 : fcRaw, compressed, prm: table.u16(p + 4 * (n + 1) + 8 * i + 6) });
      }
      return { pieces, prcs };
    } else break;
  }
  return { pieces: [], prcs };
}

/** A run of the FKPs: the properties of the file positions [fcStart, fcEnd). */
export interface WW8FkpRun { fcStart: number; fcEnd: number; grpprl: Uint8Array; istd?: number }

/** WW8PLCFx_Fc_FKP over the bin table: every run of every FKP page (CHPX or PAPX). */
export function ReadFkps(word: WW8Bytes, table: WW8Bytes, fc: number, lcb: number, papx: boolean, data?: WW8Bytes): WW8FkpRun[] {
  const n = Math.floor((lcb - 4) / 8);
  const runs: WW8FkpRun[] = [];
  for (let i = 0; i < n; i++) {
    const pn = table.u32(fc + 4 * (n + 1) + 4 * i) & 0x3fffff;
    const page = pn * 512;
    const crun = word.u8(page + 511);
    for (let k = 0; k < crun; k++) {
      const fcStart = word.u32(page + 4 * k), fcEnd = word.u32(page + 4 * (k + 1));
      if (!papx) {
        const off = word.u8(page + 4 * (crun + 1) + k) * 2;
        const cb = off ? word.u8(page + off) : 0;
        runs.push({ fcStart, fcEnd, grpprl: off ? word.slice(page + off + 1, cb) : new Uint8Array(0) });
      } else {
        // BX: a word offset to the PAPX and the PHE.
        const off = word.u8(page + 4 * (crun + 1) + 13 * k) * 2;
        if (!off) { runs.push({ fcStart, fcEnd, grpprl: new Uint8Array(0), istd: 0 }); continue; }
        let cb = word.u8(page + off), at = page + off + 1;
        let size = 2 * cb - 1;
        if (cb === 0) { cb = word.u8(page + off + 1); size = 2 * cb; at = page + off + 2; }
        let grpprl = word.slice(at + 2, size - 2);
        // WW8Fkp: sprmPHugePapx replaces the sprms by those in the Data stream (properties too large
        // for the FKP), 0x646B puts those before the FKP's own.
        const id = grpprl.length >= 6 ? grpprl[0]! | (grpprl[1]! << 8) : 0;
        if ((id === 0x6646 || id === 0x646b) && data) {
          const pos = (grpprl[2]! | (grpprl[3]! << 8) | (grpprl[4]! << 16) | (grpprl[5]! << 24)) >>> 0;
          const len = data.u16(pos);
          if (pos + 2 + len <= data.b.length) {
            const huge = data.slice(pos + 2, len);
            grpprl = id === 0x646b ? new Uint8Array([...huge, ...grpprl]) : huge;
          }
        }
        runs.push({ fcStart, fcEnd, istd: word.u16(at), grpprl });
      }
    }
  }
  runs.sort((a, b) => a.fcStart - b.fcStart);
  return runs;
}

/** The run containing a file position (binary search). */
export function FindRun(runs: WW8FkpRun[], fc: number): WW8FkpRun | undefined {
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, r = runs[mid]!;
    if (fc < r.fcStart) hi = mid - 1;
    else if (fc >= r.fcEnd) lo = mid + 1;
    else return r;
  }
  return undefined;
}

/**
 * wwSprmParser::GetSprmSize for WW8: the operand size by the sprm's spra (its top three bits);
 * variable operands have a length byte, sprmTDefTable a two-byte one, and sprmPChgTabs its own
 * format when the length byte is 255.
 */
export function GetSprmSize(id: number, g: Uint8Array, at: number): { size: number; data: number } {
  const spra = id >> 13;
  if (id === 0xd608 || id === 0xd606) {
    const count = (g[at + 2] ?? 0) | ((g[at + 3] ?? 0) << 8);
    return { size: 4 + Math.max(0, count - 1), data: at + 4 };
  }
  if (id === 0xc615 && g[at + 2] === 255) {
    const nDel = g[at + 3] ?? 0, nIns = g[at + 4 + 4 * nDel] ?? 0;
    return { size: 3 + 2 + 4 * nDel + 3 * nIns, data: at + 3 };
  }
  switch (spra) {
    case 0: case 1: return { size: 3, data: at + 2 };
    case 2: case 4: case 5: return { size: 4, data: at + 2 };
    case 3: return { size: 6, data: at + 2 };
    case 7: return { size: 5, data: at + 2 };
    default: { const n = g[at + 2] ?? 0; return { size: 3 + n, data: at + 3 }; }
  }
}

/** Calls `f` with each sprm of a grpprl: its id and its operand bytes. */
export function ForEachSprm(g: Uint8Array, f: (id: number, op: Uint8Array) => void): void {
  for (let at = 0; at + 2 <= g.length;) {
    const id = g[at]! | (g[at + 1]! << 8);
    const { size, data } = GetSprmSize(id, g, at);
    if (size <= 0 || at + size > g.length + 1) break;
    f(id, g.subarray(data, Math.min(g.length, at + size)));
    at += size;
  }
}

/** A style of WW8Style: its kind (1 paragraph, 2 character), base, next, name and property UPXs. */
export interface WW8Std { istd: number; sti: number; sgc: number; istdBase: number; istdNext: number; name: string; papx?: Uint8Array; chpx?: Uint8Array }

/** WW8Style: the style sheet (STSH): the STSHI's default fonts and every STD. */
export function ReadStyles(table: WW8Bytes, fib: WW8Fib): { styles: (WW8Std | null)[]; ftcAscii: number } {
  const base = fib.fcStshf;
  const cbStshi = table.u16(base);
  const cstd = table.u16(base + 2), cbSTDBaseInFile = table.u16(base + 4);
  const ftcAscii = table.u16(base + 2 + 12);
  const styles: (WW8Std | null)[] = [];
  let o = base + 2 + cbStshi;
  for (let istd = 0; istd < cstd && o < base + fib.lcbStshf; istd++) {
    const cbStd = table.u16(o);
    const s = o + 2;
    o = s + cbStd;
    if (!cbStd) { styles.push(null); continue; }
    const w0 = table.u16(s), w1 = table.u16(s + 2), w2 = table.u16(s + 4);
    const sti = w0 & 0xfff, sgc = w1 & 0xf, istdBase = w1 >> 4, cupx = w2 & 0xf, istdNext = w2 >> 4;
    // xstzName: a length and UTF-16 characters, then a null.
    const nameAt = s + cbSTDBaseInFile, cch = table.u16(nameAt);
    let name = '';
    for (let i = 0; i < cch; i++) name += String.fromCharCode(table.u16(nameAt + 2 + 2 * i));
    let u = nameAt + 2 + 2 * (cch + 1);
    const upx: Uint8Array[] = [];
    for (let k = 0; k < cupx && u < o; k++) {
      if ((u - s) & 1) u++;
      const cb = table.u16(u);
      upx.push(table.slice(u + 2, cb));
      u += 2 + cb;
    }
    const std: WW8Std = { istd, sti, sgc, istdBase, istdNext, name };
    // A paragraph style's first UPX is its PAPX (an istd and a grpprl), the second its CHPX.
    if (sgc === 1) { std.papx = upx[0]?.subarray(2); std.chpx = upx[1]; }
    else if (sgc === 2) std.chpx = upx[0];
    styles.push(std);
  }
  return { styles, ftcAscii };
}

/** WW8Fonts: the font names of the SttbfFfn, by ftc; `families` gets each FFN's ff (0 to 5). */
export function ReadFonts(table: WW8Bytes, fib: WW8Fib, families?: Map<string, number>): string[] {
  const out: string[] = [];
  let o = fib.fcSttbfffn;
  const end = o + fib.lcbSttbfffn;
  const n = table.u16(o);
  o += 4;
  for (let i = 0; i < n && o < end; i++) {
    const cb = table.u8(o);
    // FFN: prq/ff, wWeight, chs, ixchSzAlt, panose (10), fs (24), then the name.
    let name = '';
    for (let at = o + 1 + 39; at + 1 < o + 1 + cb; at += 2) {
      const c = table.u16(at);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    out.push(name);
    if (families && name) families.set(name, (table.u8(o + 1) >> 4) & 7);
    o += 1 + cb;
  }
  return out;
}

/** The section table: each section's end cp and its SEPX grpprl. */
export function ReadSections(word: WW8Bytes, table: WW8Bytes, fib: WW8Fib): { cpEnd: number; grpprl: Uint8Array }[] {
  const n = Math.floor((fib.lcbPlcfsed - 4) / 16);
  const out: { cpEnd: number; grpprl: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const cpEnd = table.i32(fib.fcPlcfsed + 4 * (i + 1));
    const fcSepx = table.u32(fib.fcPlcfsed + 4 * (n + 1) + 12 * i + 2);
    const grpprl = fcSepx === 0xffffffff ? new Uint8Array(0) : word.slice(fcSepx + 2, word.u16(fcSepx));
    out.push({ cpEnd, grpprl });
  }
  return out;
}

/** The header and footer stories (PlcfHdd): each story's cp range, relative to the header text. */
export function ReadHdd(table: WW8Bytes, fib: WW8Fib): [number, number][] {
  const n = Math.floor(fib.lcbPlcfHdd / 4) - 1;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([table.i32(fib.fcPlcfHdd + 4 * i), table.i32(fib.fcPlcfHdd + 4 * (i + 1))]);
  return out;
}

/** WW8LSTInfo with its levels (WW8ListManager::ReadLVL's raw values). */
export interface WW8Lvl { nStartAt: number; nNFC: number; nAlign: number; aOfsNumsXCH: number[]; ixchFollow: number; papx: Uint8Array; chpx: Uint8Array; sNumString: string }
export interface WW8Lst { nIdLst: number; bSimpleList: boolean; levels: WW8Lvl[] }

/** WW8ListManager: the list definitions (PlcfLst with their LVLs) and the overrides' lsids (PlfLfo). */
export function ReadLists(table: WW8Bytes, fib: WW8Fib): { lists: WW8Lst[]; lfos: number[] } {
  const lists: WW8Lst[] = [];
  const lfos: number[] = [];
  if (fib.lcbPlcfLst > 2) {
    // At most what the table's size holds (damaged files claim more).
    const n = Math.min(table.u16(fib.fcPlcfLst), Math.floor((fib.lcbPlcfLst - 2) / 28));
    const lstfAt = fib.fcPlcfLst + 2;
    // The LSTFs (28 bytes each), then all levels in the lists' order.
    let o = lstfAt + 28 * n;
    for (let i = 0; i < n; i++) {
      const at = lstfAt + 28 * i;
      const bSimpleList = !!(table.u8(at + 26) & 1);
      const lst: WW8Lst = { nIdLst: table.u32(at), bSimpleList, levels: [] };
      for (let k = 0; k < (bSimpleList ? 1 : 9); k++) {
        // LVLF: iStartAt, nfc, alignment bits, rgbxchNums[9], ixchFollow, two Word 6 values,
        // cbGrpprlChpx, cbGrpprlPapx, then 2 bytes; the PAPX, the CHPX, the number text.
        const nStartAt = table.i32(o), nNFC = table.u8(o + 4), nAlign = table.u8(o + 5) & 3, ixchFollow = table.u8(o + 15);
        const aOfsNumsXCH = Array.from({ length: 9 }, (_, b) => table.u8(o + 6 + b));
        const cbChpx = table.u8(o + 24), cbPapx = table.u8(o + 25);
        o += 28;
        const papx = table.slice(o, cbPapx); o += cbPapx;
        const chpx = table.slice(o, cbChpx); o += cbChpx;
        const cch = table.u16(o);
        let s = '';
        for (let c = 0; c < cch; c++) s += String.fromCharCode(table.u16(o + 2 + 2 * c));
        o += 2 + 2 * cch;
        lst.levels.push({ nStartAt, nNFC, nAlign, aOfsNumsXCH, ixchFollow, papx, chpx, sNumString: s });
      }
      lists.push(lst);
    }
  }
  if (fib.lcbPlfLfo > 4) {
    const n = Math.min(table.u32(fib.fcPlfLfo), Math.floor((fib.lcbPlfLfo - 4) / 16));
    for (let i = 0; i < n; i++) lfos.push(table.u32(fib.fcPlfLfo + 4 + 16 * i));
  }
  return { lists, lfos };
}

/** WW8_FSPA: a floating shape's anchor cp, shape id, rectangle and wrapping. */
export interface WW8Fspa { cp: number; nSpId: number; nXaLeft: number; nYaTop: number; nXaRight: number; nYaBottom: number; nbx: number; nby: number; nwr: number; nwrk: number; bBelowText: boolean }

/** The PlcfSpa (main text or headers): FSPAs by their anchors' cps. */
export function ReadFspas(table: WW8Bytes, fc: number, lcb: number): WW8Fspa[] {
  const n = Math.floor((lcb - 4) / 30);
  const out: WW8Fspa[] = [];
  for (let i = 0; i < n; i++) {
    const o = fc + 4 * (n + 1) + 26 * i;
    const bits = table.u16(o + 20);
    out.push({
      cp: table.i32(fc + 4 * i), nSpId: table.i32(o), nXaLeft: table.i32(o + 4), nYaTop: table.i32(o + 8), nXaRight: table.i32(o + 12), nYaBottom: table.i32(o + 16),
      nbx: (bits >> 1) & 3, nby: (bits >> 3) & 3, nwr: (bits >> 5) & 0xf, nwrk: (bits >> 9) & 0xf, bBelowText: !!(bits & 0x4000),
    });
  }
  return out;
}

/** The text box stories (PlcftxbxTxt or PlcfHdrtxbxTxt): cp ranges, and whether each is reusable (FTXBXS). */
export function ReadTxbxStories(table: WW8Bytes, fc: number, lcb: number): { cpStart: number; cpEnd: number; reusable: boolean }[] {
  const n = Math.floor((lcb - 4) / 26);
  const out: { cpStart: number; cpEnd: number; reusable: boolean }[] = [];
  for (let i = 0; i < n; i++) out.push({ cpStart: table.i32(fc + 4 * i), cpEnd: table.i32(fc + 4 * (i + 1)), reusable: table.i32(fc + 4 * (n + 1) + 22 * i + 4) !== 0 });
  return out;
}

/** A PLC's cps (the n + 1 positions before its data of `cbStruct` bytes each). */
export function ReadPlcCps(table: WW8Bytes, fc: number, lcb: number, cbStruct: number): number[] {
  if (lcb < 4) return [];
  const n = Math.floor((lcb - 4) / (4 + cbStruct));
  return Array.from({ length: n + 1 }, (_, i) => table.i32(fc + 4 * i));
}

/** WW8_ATRD: a comment's author (initials, index into GrpXstAtnOwners) and its range bookmark tag. */
export interface WW8Atrd { cp: number; sInitials: string; ibst: number; lTagBkmk: number }

/** The PlcfandRef: the comment references' cps and their ATRDs (30 bytes each). */
export function ReadAtrds(table: WW8Bytes, fc: number, lcb: number): WW8Atrd[] {
  if (lcb < 4) return [];
  const n = Math.floor((lcb - 4) / 34);
  const out: WW8Atrd[] = [];
  for (let i = 0; i < n; i++) {
    const o = fc + 4 * (n + 1) + 30 * i;
    const len = Math.min(table.u16(o), 9);
    let sInitials = '';
    for (let k = 1; k <= len; k++) sInitials += String.fromCharCode(table.u16(o + 2 * k));
    out.push({ cp: table.i32(fc + 4 * i), sInitials, ibst: table.u16(o + 20), lTagBkmk: table.i32(o + 26) });
  }
  return out;
}

/** GrpXstAtnOwners: the comment authors, Xsts (a count and UTF-16 characters) one after another. */
export function ReadXsts(table: WW8Bytes, fc: number, lcb: number): string[] {
  const out: string[] = [];
  for (let o = fc; o + 2 <= fc + lcb;) {
    const n = table.u16(o);
    let s = '';
    for (let k = 0; k < n && o + 2 + 2 * k + 2 <= fc + lcb; k++) s += String.fromCharCode(table.u16(o + 2 + 2 * k));
    out.push(s);
    o += 2 + 2 * n;
  }
  return out;
}

/**
 * The comments' ranges (WW8PLCFx_AtnBook): for each annotation bookmark its tag (from the
 * SttbfAtnBkmk's ATNBE extra data) and its start and end cps (PlcfAtnBkf, PlcfAtnBkl).
 */
export function ReadAtnBookmarks(table: WW8Bytes, fib: WW8Fib): Map<number, { cpStart: number; cpEnd: number }> {
  const out = new Map<number, { cpStart: number; cpEnd: number }>();
  if (fib.lcbSttbfAtnBkmk < 6 || fib.lcbPlcfAtnBkf < 4 || fib.lcbPlcfAtnBkl < 4) return out;
  // An extended STTB: 0xFFFF, the count, the extra data's size; each string empty, then its ATNBE.
  let o = fib.fcSttbfAtnBkmk;
  if (table.u16(o) !== 0xffff) return out;
  const c = table.u16(o + 2), cbExtra = table.u16(o + 4);
  o += 6;
  const tags: number[] = [];
  for (let i = 0; i < c && o < fib.fcSttbfAtnBkmk + fib.lcbSttbfAtnBkmk; i++) {
    o += 2 + 2 * table.u16(o);
    tags.push(table.i32(o + 2));
    o += cbExtra;
  }
  const nf = Math.floor((fib.lcbPlcfAtnBkf - 4) / 8), nl = Math.floor((fib.lcbPlcfAtnBkl - 4) / 4);
  for (let i = 0; i < Math.min(nf, tags.length); i++) {
    const ibkl = table.u16(fib.fcPlcfAtnBkf + 4 * (nf + 1) + 4 * i);
    if (ibkl >= nl) continue;
    out.set(tags[i]!, { cpStart: table.i32(fib.fcPlcfAtnBkf + 4 * i), cpEnd: table.i32(fib.fcPlcfAtnBkl + 4 * ibkl) });
  }
  return out;
}

/** msfilter::util::DTTM2DateTime: a DTTM as an ISO date and time, '' for none. */
export function DTTM2DateTime(l: number): string {
  if (!l) return '';
  const min = l & 0x3f, hour = (l >>> 6) & 0x1f, day = (l >>> 11) & 0x1f, mon = (l >>> 16) & 0xf, year = ((l >>> 20) & 0x1ff) + 1900;
  if (!day || !mon) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(mon)}-${p(day)}T${p(hour)}:${p(min)}:00`;
}
