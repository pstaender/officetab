// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ww8/ww8scan.cxx reduced
// Reading a Word 97-2003 (WW8) file's structures: WW8Fib, the piece table (WW8PLCFpcd), the
// character and paragraph property FKPs (WW8PLCFx_Fc_FKP::WW8Fkp), the sprm sizes
// (wwSprmParser), the style sheet (WW8Style), the font table (WW8Fonts) and the section table
// (PlcfSed with its SEPX). Word 6 and 95 files (nFib 101 to 105, bVer67) are read too: their FIB
// layout, 8-bit text, two-byte bin table entries, 7-byte BXs, 8-bit style and font names. Their
// one-byte sprms (NS_sprm::v6, sized by GetWW6SprmSearcher) are translated into the Word 97 sprms
// the reader handles (TranslateSprms6), converting BRCVer6 borders and Ver6 TCs on the way, where
// upstream dispatches the old ids to the same handlers. Reduced: Word 2 and earlier are not read,
// the Word 97 piece table's single-sprm Prm variant is skipped, and the structures are read whole
// into arrays instead of upstream's iterators over the PLCFs.

const CP1252 = new TextDecoder('windows-1252');
const decoder = (label: string): TextDecoder => { try { return new TextDecoder(label); } catch { return CP1252; } };

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
  /** An lcb clipped to what the stream holds after fc (damaged FIBs claim more). */
  lcb(fc: number, lcb: number): number { return Math.max(0, Math.min(lcb, this.b.length - fc)); }
  slice(o: number, n: number): Uint8Array { return this.b.subarray(Math.max(0, o), Math.max(0, Math.min(this.b.length, o + n))); }
}

/** WW8Fib: the File Information Block at the start of the WordDocument stream (Word 97+ layout). */
export class WW8Fib {
  wIdent = 0;
  nFib = 0;
  /** Word 6 or 95 (m_nVersion 6 or 7): one stream, one-byte sprms, 8-bit text. */
  bVer67 = false;
  fcMin = 0;
  fcMac = 0;
  /** The text's and the structures' (style and font names) character sets (Word 6: 8-bit text). */
  chse = 0;
  chseTables = 0;
  pnChpFirst = 0; cpnBteChp = 0;
  pnPapFirst = 0; cpnBtePap = 0;
  lid = 0;
  fComplex = false;
  fEncrypted = false;
  /** Word 6 (Asian versions): the text is 16-bit (WW8ScannerBase::WW8Cp2Fc). */
  fExtChar = false;
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
  fcSttbfRMark = 0; lcbSttbfRMark = 0;
  fcSttbfBkmk = 0; lcbSttbfBkmk = 0; fcPlcfBkf = 0; lcbPlcfBkf = 0; fcPlcfBkl = 0; lcbPlcfBkl = 0;
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
    this.fExtChar = !!(flags & 0x1000);
    this.bVer67 = this.nFib >= 0x65 && this.nFib <= 0x69;
    this.chse = b.u16(0x14);
    this.chseTables = b.u16(0x16);
    this.fcMin = b.i32(0x18);
    this.fcMac = b.i32(0x1c);
    // The rglw: in Word 97 after csw, the rgw (14 shorts) and cslw, at 0x40; in Word 6 at 0x20,
    // with two more longs before the ccps and one after them.
    const ccp = this.bVer67 ? 0x34 : 0x4c;
    this.ccpText = b.i32(ccp);
    this.ccpFtn = b.i32(ccp + 4);
    this.ccpHdr = b.i32(ccp + 8);
    this.ccpMcr = b.i32(ccp + 12);
    this.ccpAtn = b.i32(ccp + 16);
    this.ccpEdn = b.i32(ccp + 20);
    this.ccpTxbx = b.i32(ccp + 24);
    this.ccpHdrTxbx = b.i32(ccp + 28);
    if (this.bVer67) {
      // After fcSttbfAtnbkmk (pair 37): a short, the bin tables' first pages and counts, then the
      // pairs from fcPlcfdoaMom (38) on, up to fcSttbttmbd (61).
      this.pnChpFirst = b.i16(0x18a); this.pnPapFirst = b.i16(0x18c);
      this.cpnBteChp = b.i16(0x18e); this.cpnBtePap = b.i16(0x190);
    } else {
      this.pnChpFirst = b.i32(0x70); this.cpnBteChp = b.i32(0x74);
      this.pnPapFirst = b.i32(0x7c); this.cpnBtePap = b.i32(0x80);
    }
    // The rgfclcb: pairs of fc and lcb, from 0x9a (Word 97) or 0x58 (Word 6).
    const pairAt = (i: number): number => (!this.bVer67 ? 0x9a + 8 * i : i < 38 ? 0x58 + 8 * i : i <= 61 ? 0x192 + 8 * (i - 38) : -1);
    const pair = (i: number): [number, number] => { const o = pairAt(i); return o < 0 ? [0, 0] : [b.u32(o), b.u32(o + 4)]; };
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
    if (!this.bVer67 && b.u16(0x98) > 113) [this.fcAtrdExtra, this.lcbAtrdExtra] = pair(112);
    [this.fcPlcfsed, this.lcbPlcfsed] = pair(6);
    [this.fcPlcfHdd, this.lcbPlcfHdd] = pair(11);
    [this.fcPlcfbteChpx, this.lcbPlcfbteChpx] = pair(12);
    [this.fcPlcfbtePapx, this.lcbPlcfbtePapx] = pair(13);
    [this.fcSttbfffn, this.lcbSttbfffn] = pair(15);
    [this.fcDop, this.lcbDop] = pair(31);
    [this.fcClx, this.lcbClx] = pair(33);
    [this.fcPlcfspaMom, this.lcbPlcfspaMom] = pair(40);
    [this.fcDggInfo, this.lcbDggInfo] = pair(50);
    [this.fcSttbfRMark, this.lcbSttbfRMark] = pair(51);
    [this.fcSttbfBkmk, this.lcbSttbfBkmk] = pair(21);
    [this.fcPlcfBkf, this.lcbPlcfBkf] = pair(22);
    [this.fcPlcfBkl, this.lcbPlcfBkl] = pair(23);
    [this.fcPlcfspaHdr, this.lcbPlcfspaHdr] = pair(41);
    [this.fcPlcftxbxTxt, this.lcbPlcftxbxTxt] = pair(56);
    [this.fcPlcfHdrtxbxTxt, this.lcbPlcfHdrtxbxTxt] = pair(58);
    [this.fcPlcfendRef, this.lcbPlcfendRef] = pair(46);
    [this.fcPlcfendTxt, this.lcbPlcfendTxt] = pair(47);
    [this.fcPlcfLst, this.lcbPlcfLst] = pair(73);
    [this.fcPlfLfo, this.lcbPlfLfo] = pair(74);
  }

  /** WW8Fib::GetFIBCharset: the encoding of a Windows charset, or for none the locale's best guess. */
  static GetFIBCharset(chs: number, lid: number): string {
    if (chs === 0x100) return 'macintosh';
    if (chs === 0 && lid >= 999) {
      // msfilter::util::getBestTextEncodingFromLocale, by the lid's primary language.
      const lang = lid & 0x3ff;
      if (lang === 0x05 || lang === 0x0e || lang === 0x15) return 'windows-1250'; // cs, hu, pl
      if (lang === 0x19 || lang === 0x22) return 'windows-1251'; // ru, uk
      if (lang === 0x08) return 'windows-1253'; // el
      if (lang === 0x1f) return 'windows-1254'; // tr
      if (lang === 0x27) return 'windows-1257'; // lt
      if (lang === 0x1e) return 'windows-874'; // th
      if (lang === 0x2a) return 'windows-1258'; // vi
      return 'windows-1252';
    }
    // rtl_getTextEncodingFromWindowsCharset
    const WIN: Record<number, string> = { 0: 'windows-1252', 1: 'windows-1252', 2: 'windows-1252', 77: 'macintosh', 128: 'shift_jis', 129: 'euc-kr', 134: 'gbk', 136: 'big5', 161: 'windows-1253', 162: 'windows-1254', 163: 'windows-1258', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250', 255: 'ibm866' };
    return WIN[chs & 0xff] ?? 'windows-1252';
  }

  /** Decoders for 8-bit text (m_eTextCharSet) and structures (m_eStructCharSet), SwWW8ImplReader::CoreLoad. */
  TextDecoder(): TextDecoder { return decoder(WW8Fib.GetFIBCharset(this.chse, this.lid)); }
  StructDecoder(): TextDecoder { return decoder(WW8Fib.GetFIBCharset(this.chseTables, this.lid)); }

  /** Word 6 of the Asian versions (wwSprmSearcher::patchCJKVariant): sprms 111 to 113 are fonts. */
  IsCJKVariant(): boolean { return this.wIdent >= 0xa697 && this.wIdent <= 0xa699; }

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
    if (clxt === 1) { const cb = table.u16(o + 1); const g = table.slice(o + 3, cb); prcs.push(fib.bVer67 ? TranslateSprms6(g, fib.IsCJKVariant()) : g); o += 3 + cb; }
    else if (clxt === 2) {
      const lcb = table.u32(o + 1);
      const p = o + 5, n = Math.floor((table.lcb(p, lcb) - 4) / 12);
      const pieces: WW8Piece[] = [];
      for (let i = 0; i < n; i++) {
        const fcRaw = table.u32(p + 4 * (n + 1) + 8 * i + 2);
        // Word 6 pieces are at their fc (no TransformPieceAddress), 8-bit unless fExtChar.
        const compressed = fib.bVer67 ? !fib.fExtChar : !!(fcRaw & 0x40000000);
        pieces.push({ cpStart: table.i32(p + 4 * i), cpEnd: table.i32(p + 4 * (i + 1)), fc: fib.bVer67 ? fcRaw : compressed ? (fcRaw & ~0x40000000) / 2 : fcRaw, compressed, prm: table.u16(p + 4 * (n + 1) + 8 * i + 6) });
      }
      return { pieces, prcs };
    } else break;
  }
  return { pieces: [], prcs };
}

/** A run of the FKPs: the properties of the file positions [fcStart, fcEnd). */
export interface WW8FkpRun { fcStart: number; fcEnd: number; grpprl: Uint8Array; istd?: number }

/** WW8PLCFx_Fc_FKP over the bin table: every run of every FKP page (CHPX or PAPX). */
export function ReadFkps(word: WW8Bytes, table: WW8Bytes, fib: WW8Fib, papx: boolean, data?: WW8Bytes): WW8FkpRun[] {
  const fc = papx ? fib.fcPlcfbtePapx : fib.fcPlcfbteChpx, lcb = papx ? fib.lcbPlcfbtePapx : fib.lcbPlcfbteChpx;
  const v6 = fib.bVer67;
  // The bin table's PNs (2 bytes in Word 6); WW8PLCF::GeneratePLCF: a table shorter than the FIB's
  // count (Word 6 short of resources, WordPad) means consecutive pages from the first one.
  const nStruct = v6 ? 2 : 4;
  const n = Math.max(0, Math.floor((table.lcb(fc, lcb) - 4) / (4 + nStruct)));
  const cpnBte = papx ? fib.cpnBtePap : fib.cpnBteChp, pnFirst = papx ? fib.pnPapFirst : fib.pnChpFirst;
  const pns: number[] = n >= cpnBte || cpnBte > 0xffff
    ? Array.from({ length: n }, (_, i) => (v6 ? table.u16(fc + 4 * (n + 1) + 2 * i) : table.u32(fc + 4 * (n + 1) + 4 * i) & 0x3fffff))
    : Array.from({ length: cpnBte }, (_, i) => pnFirst + i);
  const runs: WW8FkpRun[] = [];
  for (const pn of pns) {
    const page = pn * 512;
    const crun = word.u8(page + 511);
    for (let k = 0; k < crun; k++) {
      const fcStart = word.u32(page + 4 * k), fcEnd = word.u32(page + 4 * (k + 1));
      if (!papx) {
        const off = word.u8(page + 4 * (crun + 1) + k) * 2;
        const cb = off ? word.u8(page + off) : 0;
        const g = off ? word.slice(page + off + 1, cb) : new Uint8Array(0);
        runs.push({ fcStart, fcEnd, grpprl: v6 ? TranslateSprms6(g, fib.IsCJKVariant()) : g });
      } else {
        // BX: a word offset to the PAPX and the PHE (13 bytes; 7 in Word 6).
        const off = word.u8(page + 4 * (crun + 1) + (v6 ? 7 : 13) * k) * 2;
        if (!off) { runs.push({ fcStart, fcEnd, grpprl: new Uint8Array(0), istd: 0 }); continue; }
        if (v6) {
          // Word 6: the count of words, the istd, the sprms.
          const cb = word.u8(page + off);
          runs.push({ fcStart, fcEnd, istd: word.u16(page + off + 1), grpprl: TranslateSprms6(word.slice(page + off + 3, Math.max(0, 2 * cb - 2)), fib.IsCJKVariant()) });
          continue;
        }
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
    // xstzName: a length and UTF-16 characters, then a null (Word 6: a length byte and 8-bit characters).
    const nameAt = s + cbSTDBaseInFile, cch = fib.bVer67 ? table.u8(nameAt) : table.u16(nameAt);
    let name = '';
    if (fib.bVer67) name = fib.StructDecoder().decode(table.slice(nameAt + 1, cch));
    else for (let i = 0; i < cch; i++) name += String.fromCharCode(table.u16(nameAt + 2 + 2 * i));
    let u = fib.bVer67 ? nameAt + 1 + cch + 1 : nameAt + 2 + 2 * (cch + 1);
    const upx: Uint8Array[] = [];
    for (let k = 0; k < cupx && u < o; k++) {
      if ((u - s) & 1) u++;
      const cb = table.u16(u);
      // A paragraph UPX starts with its istd, which the translation must keep.
      const raw = table.slice(u + 2, cb);
      upx.push(!fib.bVer67 ? raw : sgc === 1 && k === 0 ? new Uint8Array([...raw.subarray(0, 2), ...TranslateSprms6(raw.subarray(2), fib.IsCJKVariant())]) : TranslateSprms6(raw, fib.IsCJKVariant()));
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

/** WW8Fonts: the font names of the SttbfFfn, by ftc; `families` gets each FFN's ff (0 to 5), `charsets` each chs. */
export function ReadFonts(table: WW8Bytes, fib: WW8Fib, families?: Map<string, number>, charsets?: number[]): string[] {
  const out: string[] = [];
  let o = fib.fcSttbfffn;
  const end = o + fib.lcbSttbfffn;
  // Word 97: the count and the extra data's size; Word 6: the table's size, fonts up to its end.
  const n = fib.bVer67 ? 0xffff : table.u16(o);
  o += fib.bVer67 ? 2 : 4;
  for (let i = 0; i < n && o < end; i++) {
    const cb = table.u8(o);
    // FFN: prq/ff, wWeight, chs, ixchSzAlt, (Word 97: panose (10), fs (24)), then the name.
    let name = '';
    if (fib.bVer67) {
      const z = table.slice(o + 6, Math.max(0, cb - 5));
      const nul = z.indexOf(0);
      // The name is in the font's own character set (its chs), else the structures'.
      const chs = table.u8(o + 4);
      name = (chs ? decoder(WW8Fib.GetFIBCharset(chs, fib.lid)) : fib.StructDecoder()).decode(nul >= 0 ? z.subarray(0, nul) : z);
    } else for (let at = o + 1 + 39; at + 1 < o + 1 + cb; at += 2) {
      const c = table.u16(at);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    out.push(name);
    if (families && name) families.set(name, (table.u8(o + 1) >> 4) & 7);
    charsets?.push(table.u8(o + 4)); // chs
    o += 1 + cb;
  }
  return out;
}

/** The section table: each section's end cp and its SEPX grpprl. */
export function ReadSections(word: WW8Bytes, table: WW8Bytes, fib: WW8Fib): { cpEnd: number; grpprl: Uint8Array }[] {
  const n = Math.floor((table.lcb(fib.fcPlcfsed, fib.lcbPlcfsed) - 4) / 16);
  const out: { cpEnd: number; grpprl: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const cpEnd = table.i32(fib.fcPlcfsed + 4 * (i + 1));
    const fcSepx = table.u32(fib.fcPlcfsed + 4 * (n + 1) + 12 * i + 2);
    const raw = fcSepx === 0xffffffff ? new Uint8Array(0) : word.slice(fcSepx + 2, word.u16(fcSepx));
    const grpprl = fib.bVer67 ? TranslateSprms6(raw, fib.IsCJKVariant()) : raw;
    out.push({ cpEnd, grpprl });
  }
  return out;
}

/** The header and footer stories (PlcfHdd): each story's cp range, relative to the header text. */
export function ReadHdd(table: WW8Bytes, fib: WW8Fib): [number, number][] {
  const n = Math.floor(table.lcb(fib.fcPlcfHdd, fib.lcbPlcfHdd) / 4) - 1;
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
  lcb = table.lcb(fc, lcb);
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
  lcb = table.lcb(fc, lcb);
  const n = Math.floor((lcb - 4) / 26);
  const out: { cpStart: number; cpEnd: number; reusable: boolean }[] = [];
  for (let i = 0; i < n; i++) out.push({ cpStart: table.i32(fc + 4 * i), cpEnd: table.i32(fc + 4 * (i + 1)), reusable: table.i32(fc + 4 * (n + 1) + 22 * i + 4) !== 0 });
  return out;
}

/** A PLC's cps (the n + 1 positions before its data of `cbStruct` bytes each). */
export function ReadPlcCps(table: WW8Bytes, fc: number, lcb: number, cbStruct: number): number[] {
  lcb = table.lcb(fc, lcb);
  if (lcb < 4) return [];
  const n = Math.floor((lcb - 4) / (4 + cbStruct));
  return Array.from({ length: n + 1 }, (_, i) => table.i32(fc + 4 * i));
}

/** WW8_ATRD: a comment's author (initials, index into GrpXstAtnOwners) and its range bookmark tag. */
export interface WW8Atrd { cp: number; sInitials: string; ibst: number; lTagBkmk: number }

/** The PlcfandRef: the comment references' cps and their ATRDs (30 bytes each). */
export function ReadAtrds(table: WW8Bytes, fc: number, lcb: number, bVer67 = false): WW8Atrd[] {
  lcb = table.lcb(fc, lcb);
  if (lcb < 4) return [];
  // WW67_ATRD (20 bytes): 8-bit initials (a length byte and 9 characters), ibst, ak, grfbmc, lTagBkmk.
  const n = Math.floor((lcb - 4) / (bVer67 ? 24 : 34));
  const out: WW8Atrd[] = [];
  for (let i = 0; i < n; i++) {
    if (bVer67) {
      const o = fc + 4 * (n + 1) + 20 * i;
      out.push({ cp: table.i32(fc + 4 * i), sInitials: CP1252.decode(table.slice(o + 1, Math.min(table.u8(o), 9))), ibst: table.u16(o + 10), lTagBkmk: table.i32(o + 16) });
      continue;
    }
    const o = fc + 4 * (n + 1) + 30 * i;
    const len = Math.min(table.u16(o), 9);
    let sInitials = '';
    for (let k = 1; k <= len; k++) sInitials += String.fromCharCode(table.u16(o + 2 * k));
    out.push({ cp: table.i32(fc + 4 * i), sInitials, ibst: table.u16(o + 20), lTagBkmk: table.i32(o + 26) });
  }
  return out;
}

/** GrpXstAtnOwners: the comment authors, Xsts (a count and UTF-16 characters) one after another. */
export function ReadXsts(table: WW8Bytes, fc: number, lcb: number, bVer67 = false): string[] {
  lcb = table.lcb(fc, lcb);
  const out: string[] = [];
  // Word 6: Pascal strings (a length byte and 8-bit characters).
  if (bVer67) {
    for (let o = fc; o < fc + lcb;) { const n = table.u8(o); out.push(CP1252.decode(table.slice(o + 1, n))); o += 1 + n; }
    return out;
  }
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

/** An STTB's strings (WW8ReadSTTBF): extended (0xFFFF, UTF-16) or not (8-bit), extra data skipped. */
export function ReadSttb(table: WW8Bytes, fc: number, lcb: number, bVer67 = false): string[] {
  lcb = table.lcb(fc, lcb);
  if (lcb < 4) return [];
  if (bVer67) {
    // Word 6: the table's size, then Pascal strings.
    const out: string[] = [];
    const end = fc + Math.min(lcb, table.u16(fc));
    for (let o = fc + 2; o < end;) { const n = table.u8(o); out.push(CP1252.decode(table.slice(o + 1, n))); o += 1 + n; }
    return out;
  }
  let o = fc;
  const ext = table.u16(o) === 0xffff;
  if (ext) o += 2;
  const c = table.u16(o), cbExtra = table.u16(o + 2);
  o += 4;
  const out: string[] = [];
  for (let i = 0; i < c && o < fc + lcb; i++) {
    let s = '';
    if (ext) { const n = table.u16(o); for (let k = 0; k < n; k++) s += String.fromCharCode(table.u16(o + 2 + 2 * k)); o += 2 + 2 * n; }
    else { const n = table.u8(o); for (let k = 0; k < n; k++) s += String.fromCharCode(table.u8(o + 1 + k)); o += 1 + n; }
    out.push(s);
    o += cbExtra;
  }
  return out;
}

/**
 * GetWW6SprmSearcher's sizes of the Word 6 sprms: [length, kind], kind 0 fixed, 1 a length byte,
 * 2 a two-byte length (sprmTDefTable); ids it does not know are variable (L_VAR), as upstream.
 */
const WW6_SPRM_SIZES: Record<number, [number, number]> = {
  0: [0, 0], 2: [2, 0], 3: [3, 1], 4: [1, 0], 5: [1, 0], 6: [1, 0], 7: [1, 0], 8: [1, 0], 9: [1, 0], 10: [1, 0], 11: [1, 0],
  12: [0, 1], 13: [1, 0], 14: [1, 0], 15: [0, 1], 16: [2, 0], 17: [2, 0], 18: [2, 0], 19: [2, 0], 20: [4, 0], 21: [2, 0],
  22: [2, 0], 23: [0, 1], 24: [1, 0], 25: [1, 0], 26: [2, 0], 27: [2, 0], 28: [2, 0], 29: [1, 0], 30: [2, 0], 31: [2, 0],
  32: [2, 0], 33: [2, 0], 34: [2, 0], 35: [2, 0], 36: [2, 0], 37: [1, 0], 38: [2, 0], 39: [2, 0], 40: [2, 0], 41: [2, 0],
  42: [2, 0], 43: [2, 0], 44: [1, 0], 45: [2, 0], 46: [2, 0], 47: [2, 0], 48: [2, 0], 49: [2, 0], 50: [1, 0], 51: [1, 0],
  64: [0, 1], 65: [1, 0], 66: [1, 0], 67: [1, 0], 68: [0, 1], 69: [2, 0], 70: [4, 0], 71: [1, 0], 72: [2, 0], 73: [3, 0],
  74: [0, 1], 75: [1, 0], 77: [0, 1], 79: [0, 1], 80: [2, 0], 81: [0, 1], 82: [0, 1], 83: [0, 0], 85: [1, 0], 86: [1, 0],
  87: [1, 0], 88: [1, 0], 89: [1, 0], 90: [1, 0], 91: [1, 0], 92: [1, 0], 93: [2, 0], 94: [1, 0], 95: [3, 0], 96: [2, 0],
  97: [2, 0], 98: [1, 0], 99: [2, 0], 100: [1, 0], 101: [2, 0], 102: [1, 0], 103: [0, 1], 104: [1, 0], 105: [0, 1],
  106: [0, 1], 107: [2, 0], 108: [0, 1], 109: [2, 0], 110: [2, 0], 111: [0, 1], 112: [0, 1], 113: [0, 1], 114: [0, 1],
  115: [0, 1], 116: [0, 1], 117: [1, 0], 118: [1, 0], 119: [1, 0], 120: [12, 1], 121: [2, 0], 122: [2, 0], 123: [2, 0],
  124: [2, 0], 131: [1, 0], 132: [1, 0], 133: [0, 1], 136: [3, 0], 137: [3, 0], 138: [1, 0], 139: [1, 0], 140: [2, 0],
  141: [2, 0], 142: [1, 0], 143: [1, 0], 144: [2, 0], 145: [2, 0], 146: [1, 0], 147: [1, 0], 148: [2, 0], 149: [2, 0],
  150: [1, 0], 151: [1, 0], 152: [1, 0], 153: [1, 0], 154: [2, 0], 155: [2, 0], 156: [2, 0], 157: [2, 0], 158: [1, 0],
  159: [1, 0], 160: [2, 0], 161: [2, 0], 162: [1, 0], 164: [2, 0], 165: [2, 0], 166: [2, 0], 167: [2, 0], 168: [2, 0],
  169: [2, 0], 170: [2, 0], 171: [2, 0], 179: [0, 1], 181: [0, 1], 182: [2, 0], 183: [2, 0], 184: [2, 0], 185: [1, 0],
  186: [1, 0], 187: [12, 0], 188: [0, 2], 189: [2, 0], 190: [0, 2], 191: [1, 1], 192: [4, 0], 193: [5, 0], 194: [4, 0],
  195: [2, 0], 196: [4, 0], 197: [2, 0], 198: [2, 0], 199: [5, 0], 200: [4, 0], 207: [0, 1],
};

/** WW8_BRC(const WW8_BRCVer6&): a Word 6 border (2 bytes) as a BRC80 (4 bytes). */
function brcVer6(op: Uint8Array, o: number): number[] {
  const b0 = op[o] ?? 0, b1 = op[o + 1] ?? 0;
  let w = b0 & 7, type = (b0 & 0x18) >> 3;
  if (w > 5) { type = w; w = 1; } // dotted (6) or dashed (7)
  return [w * 6, type, ((b0 & 0xc0) >> 6) | ((b1 & 7) << 2), (b1 >> 3) | (b0 & 0x20)];
}

/** The Word 97 sprm each translated Word 6 sprm becomes, with its operand converted where it differs. */
const WW6_TO_WW8: Record<number, number | [number, (op: Uint8Array) => number[]]> = {
  2: 0x4600, 5: 0x2403, 7: 0x2405, 8: 0x2406, 9: 0x2407, 12: 0xc63e, 13: 0x240a, 14: 0x240c, 15: 0xc60d, 16: 0x840e,
  17: 0x840f, 18: 0x4610, 19: 0x8411, 20: 0x6412, 21: 0xa413, 22: 0xa414, 23: 0xc615, 24: 0x2416, 25: 0x2417, 26: 0x8418,
  27: 0x8419, 28: 0x841a, 29: 0x261b, 37: 0x2423, 44: 0x242a, 45: 0x442b, 46: 0x442c, 47: 0x442d, 48: 0x842e, 49: 0x842f,
  51: 0x2431,
  38: [0x6424, (op) => brcVer6(op, 0)], 39: [0x6425, (op) => brcVer6(op, 0)], 40: [0x6426, (op) => brcVer6(op, 0)],
  41: [0x6427, (op) => brcVer6(op, 0)], 42: [0x6428, (op) => brcVer6(op, 0)], 43: [0x6629, (op) => brcVer6(op, 0)],
  65: 0x0800, 66: 0x0801, 67: 0x0802, 68: 0x6a03, 69: 0x4804, 70: 0x6805, 71: 0x0806, 75: 0x080a,
  // sprmCSymbol: the font and an 8-bit character (Word 97: a 16-bit one).
  74: [0x6a09, (op) => [op[0] ?? 0, op[1] ?? 0, op[2] ?? 0, 0]],
  80: 0x4a30, 83: [0x2a33, () => [0]], 85: 0x0835, 86: 0x0836, 87: 0x0837, 88: 0x0838, 89: 0x0839, 90: 0x083a, 91: 0x083b,
  92: 0x083c, 93: 0x4a4f, 94: 0x2a3e, 96: 0x8840, 97: 0x4873, 98: 0x2a42, 99: 0x4a43, 101: 0x4845, 104: 0x2a48,
  107: 0x484b, 117: 0x0855, 118: 0x0856,
  133: 0xd202, 132: 0x3001, 136: 0xf203, 137: 0xf204, 138: 0x3005, 139: 0x3006, 140: 0x5007, 141: 0x5008, 142: 0x3009, 143: 0x300a,
  144: 0x500b, 145: 0x900c, 147: 0x300e, 150: 0x3011, 151: 0x3012, 152: 0x3013, 153: 0x3014, 154: 0x5015, 155: 0x9016,
  156: 0xb017, 157: 0xb018, 158: 0x3019, 159: 0x301a, 160: 0x501b, 161: 0x501c, 162: 0x301d, 164: 0xb01f, 165: 0xb020,
  166: 0xb021, 167: 0xb022, 168: 0x9023, 169: 0x9024, 170: 0xb025,
  182: 0x5400, 183: 0x9601, 184: 0x9602, 185: 0x3403, 186: 0x3404, 189: 0x9407, 191: 0xd609, 197: 0x5624, 198: 0x5625,
  // sprmTTableBorders: six BRCVer6.
  187: [0xd605, (op) => [0, 2, 4, 6, 8, 10].flatMap((o) => brcVer6(op, o))],
  // sprmTDefTable: the cells' count and edges as in Word 97, the TCs (10 bytes: two flag bytes and
  // four BRCVer6) as TC80 (20 bytes), as WW8TabBandDesc::ReadDef reads them.
  190: [0xd608, (op) => {
    const n = op[0] ?? 0;
    const head = [...op.subarray(0, 1 + 2 * (n + 1))];
    const tcs: number[] = [];
    for (let at = 1 + 2 * (n + 1); at + 10 <= op.length; at += 10) tcs.push(op[at] ?? 0, 0, 0, 0, ...[0, 2, 4, 6].flatMap((k) => brcVer6(op, at + 2 + k)));
    return [...head, ...tcs];
  }],
  // sprmTSetBrc: the cells, the sides, a BRCVer6.
  193: [0xd620, (op) => [op[0] ?? 0, op[1] ?? 0, op[2] ?? 0, ...brcVer6(op, 3)]],
};

/**
 * A Word 6 grpprl as Word 97 sprms: each sprm sized as wwSprmParser does for Word 6 (one-byte
 * id, GetSprmTailLen), translated by WW6_TO_WW8 and encoded as Word 97 (two-byte id, the operand's
 * size by its spra). Sprms without a Word 97 counterpart here are dropped.
 */
export function TranslateSprms6(g: Uint8Array, bCJK = false): Uint8Array {
  const out: number[] = [];
  for (let at = 0; at < g.length;) {
    const id = g[at]!;
    const [nLen, kind] = bCJK && id >= 111 && id <= 113 ? [2, 0] : WW6_SPRM_SIZES[id] ?? [0, 1];
    let size: number, data: number;
    if (id === 23 && g[at + 1] === 255) {
      // sprmPChgTabs with its deletions and insertions counted.
      const nDel = g[at + 2] ?? 0, nIns = g[at + 3 + 4 * nDel] ?? 0;
      size = 2 + 2 + 4 * nDel + 3 * nIns; data = at + 2;
    } else if (kind === 0) { size = 1 + nLen; data = at + 1; }
    else if (kind === 1) { size = (g[at + 1] ?? 0) + nLen + 2; data = at + 2; }
    else { const c = (g[at + 1] ?? 0) | ((g[at + 2] ?? 0) << 8); size = Math.max(0, c - 1) + nLen + 3; data = at + 3; }
    const op = g.subarray(Math.min(data, g.length), Math.min(at + size, g.length));
    at += size;
    // Read_AmbiguousSPRM, Read_FontCode: in the Asian variant 111 to 113 are the western, Asian and other fonts.
    const map = bCJK && id >= 111 && id <= 113 ? [0x4a4f, 0x4a50, 0x4a51][id - 111]! : WW6_TO_WW8[id];
    if (map === undefined) continue;
    const [nid, conv] = typeof map === 'number' ? [map, undefined] : map;
    const bytes = conv ? conv(op) : [...op];
    out.push(nid & 0xff, nid >> 8);
    const spra = nid >> 13;
    if (nid === 0xd608) { const c = bytes.length + 1; out.push(c & 0xff, c >> 8, ...bytes); }
    else if (nid === 0xc615 && id === 23 && g[data - 1] === 255) out.push(255, ...bytes);
    else if (spra === 6) out.push(bytes.length & 0xff, ...bytes.slice(0, 255));
    else {
      const len = spra === 0 || spra === 1 ? 1 : spra === 3 ? 4 : spra === 7 ? 3 : 2;
      for (let k = 0; k < len; k++) out.push(bytes[k] ?? 0);
    }
  }
  return new Uint8Array(out);
}

/** SwWw8ControlType: the kinds of form field (ww8par.hxx). */
export const WW8_CT_EDIT = 0, WW8_CT_CHECKBOX = 1, WW8_CT_DROPDOWN = 2;

/** WW8FormulaControl's members, as FormulaRead fills them. */
export interface WW8FormulaControl {
  mfType: number; mnMaxLen: number; mnChecked: number; mfDropdownIndex: number;
  msTitle: string; msDefault: string; msFormatting: string; msHelp: string; msToolTip: string;
  msEntryMcr: string; msExitMcr: string; maListEntries: string[];
}

/**
 * WW8FormulaControl::FormulaRead: the FFData structure (MS-DOC 2.9.78) at `o` of the Data stream,
 * or null where its header or type is not as expected.
 */
export function FormulaRead(d: WW8Bytes, o: number, nWhich: number): WW8FormulaControl | null {
  const end = d.b.length;
  // read_uInt16_PascalString; read_uInt16_BeltAndBracesString skips the null after it.
  const pascal = (belt: boolean): string => {
    const n = d.u16(o); o += 2;
    let s = '';
    for (let i = 0; i < n && o + 2 <= end; i++, o += 2) s += String.fromCharCode(d.u16(o));
    if (belt) o += 2;
    return s;
  };
  // An unsigned integer that MUST be 0xFFFFFFFF
  if (d.u32(o) !== 0xffffffff) return null;
  o += 4;
  const bits1 = d.u8(o), bits2 = d.u8(o + 1);
  o += 2;
  const iType = bits1 & 0x3;
  // we should verify that bits.iType & nWhich concur
  if (iType !== nWhich) return null;
  const iRes = (bits1 & 0x7c) >> 2;
  const f: WW8FormulaControl = { mfType: 0, mnMaxLen: d.u16(o), mnChecked: 0, mfDropdownIndex: 0, msTitle: '', msDefault: '', msFormatting: '', msHelp: '', msToolTip: '', msEntryMcr: '', msExitMcr: '', maListEntries: [] };
  o += 4; // mnMaxLen, hps
  f.msTitle = pascal(true); // xstzName
  if (nWhich === WW8_CT_EDIT) {
    // Field is a textbox: default text (xstzTextDef)
    f.msDefault = pascal(true);
  } else {
    // CheckBox or ComboBox
    const wDef = d.u16(o); o += 2;
    f.mnChecked = wDef; // default
    if (nWhich === WW8_CT_CHECKBOX) {
      if (iRes !== 25) f.mnChecked = iRes;
      f.msDefault = wDef === 0 ? '0' : '1';
    }
  }
  f.msFormatting = pascal(true); // xstzTextFormat
  f.msHelp = pascal(true); // xstzHelpText
  f.msToolTip = pascal(true); // xstzStatText
  f.msEntryMcr = pascal(true); // xstzEntryMcr
  f.msExitMcr = pascal(true); // xstzExitMcr
  if (nWhich === WW8_CT_DROPDOWN) {
    // SSTB (see Spec. 2.2.4)
    const fExtend = d.u16(o);
    let nStringsCnt = d.u16(o + 2);
    o += 6; // fExtend, cData, cbExtra
    if (fExtend !== 0xffff) nStringsCnt = 0; // Not as expected, don't risk it at all.
    nStringsCnt = Math.min(nStringsCnt, Math.max(0, Math.floor((end - o) / 2)));
    for (let i = 0; i < nStringsCnt; i++) f.maListEntries.push(pascal(false));
  }
  f.mfDropdownIndex = iRes;
  f.mfType = (bits2 & 0x38) >> 3;
  return f;
}

/** WW8PLCFx_Book's tables: each bookmark's name with its start and end CP (SttbfBkmk, PlcfBkf, PlcfBkl). */
export interface WW8Bookmark { name: string; cpStart: number; cpEnd: number }
export function ReadBookmarks(table: WW8Bytes, fib: WW8Fib): WW8Bookmark[] {
  const names = ReadSttb(table, fib.fcSttbfBkmk, fib.lcbSttbfBkmk, fib.bVer67);
  const lf = table.lcb(fib.fcPlcfBkf, fib.lcbPlcfBkf), ll = table.lcb(fib.fcPlcfBkl, fib.lcbPlcfBkl);
  // WW8PLCFspecial with 4 bytes of data (the FBKF, whose first word is the end's index).
  const nf = lf >= 4 ? Math.floor((lf - 4) / 8) : 0, nl = ll >= 4 ? Math.floor((ll - 4) / 4) : 0;
  const out: WW8Bookmark[] = [];
  for (let i = 0; i < Math.min(nf, names.length); i++) {
    let nEndIdx = table.u16(fib.fcPlcfBkf + 4 * (nf + 1) + 4 * i);
    if (nEndIdx > nl) nEndIdx = i;
    out.push({ name: names[i]!, cpStart: table.i32(fib.fcPlcfBkf + 4 * i), cpEnd: table.i32(fib.fcPlcfBkl + 4 * nEndIdx) });
  }
  return out;
}
