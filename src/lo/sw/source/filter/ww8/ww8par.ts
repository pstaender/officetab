// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ww8/ww8par.cxx reduced
// @upstream sw/source/filter/ww8/ww8par2.cxx reduced
// @upstream sw/source/filter/ww8/ww8par6.cxx reduced
// SwWW8ImplReader for Word 97-2003 documents (.doc, .dot): the main text with its paragraphs,
// the style sheet, character and paragraph properties (the common sprms of ww8par6.cxx's
// SprmReadId table) and the sections' page geometry. Reduced (reported through
// ImportResult.lost): tables (their cells become paragraphs), lists, fields (their results are
// kept as text), pictures and drawing objects, footnotes, endnotes, headers and footers, comments,
// text boxes and tracked changes. Toggle sprms that refer to the style (0x80, 0x81) are resolved
// against the paragraph style only. Language ids map through a reduced table of isolang.cxx.

import { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwTextFormatColl, SwCharFormat } from '../../../inc/format.ts';
import { POOL_DEFAULTS, type SwAttrSet, type SwCharAttrSet, type SvxTabStop, type FontLineStyle } from '../../../inc/hintids.ts';
import { SwPageDesc } from '../../../inc/pagedesc.ts';
import { Storage } from '../../../../sot/source/sdstor/storage.ts';
import type { ImportResult } from '../xml/odt.ts';
import { FindRun, ForEachSprm, ReadClx, ReadFkps, ReadFonts, ReadSections, ReadStyles, WW8Bytes, WW8Fib, type WW8Piece, type WW8Std } from './ww8scan.ts';

/** The 16 colours of Word's ico (sw/source/filter/ww8/ww8par6.cxx's GetCol). */
const ICO = [null, '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0'] as const;

/** isolang.cxx, reduced: Windows language ids of the common languages. */
const LCID: Record<number, string> = {
  0x0400: 'zxx', 0x0401: 'ar-SA', 0x0403: 'ca-ES', 0x0405: 'cs-CZ', 0x0406: 'da-DK', 0x0407: 'de-DE', 0x0408: 'el-GR', 0x0409: 'en-US',
  0x040a: 'es-ES', 0x040b: 'fi-FI', 0x040c: 'fr-FR', 0x040d: 'he-IL', 0x040e: 'hu-HU', 0x0410: 'it-IT', 0x0411: 'ja-JP', 0x0412: 'ko-KR',
  0x0413: 'nl-NL', 0x0414: 'nb-NO', 0x0415: 'pl-PL', 0x0416: 'pt-BR', 0x0418: 'ro-RO', 0x0419: 'ru-RU', 0x041a: 'hr-HR', 0x041b: 'sk-SK',
  0x041d: 'sv-SE', 0x041f: 'tr-TR', 0x0422: 'uk-UA', 0x0424: 'sl-SI', 0x0425: 'et-EE', 0x0426: 'lv-LV', 0x0427: 'lt-LT', 0x0804: 'zh-CN',
  0x0807: 'de-CH', 0x0809: 'en-GB', 0x080a: 'es-MX', 0x080c: 'fr-BE', 0x0813: 'nl-BE', 0x0816: 'pt-PT', 0x0c07: 'de-AT', 0x0c09: 'en-AU',
  0x0c0a: 'es-ES', 0x0c0c: 'fr-CA', 0x1009: 'en-CA', 0x100c: 'fr-CH', 0x1409: 'en-NZ', 0x0404: 'zh-TW',
};

/** Builtin style names (sti) that map to Writer's pool styles, as the name in the file says otherwise. */
const STI_NAMES: Record<number, string> = { 0: 'Standard', 29: 'Footnote', 31: 'Header', 32: 'Footer', 34: 'Caption', 62: 'Title', 74: 'Subtitle' };

const toggle = (v: number, style: boolean): boolean => (v === 0x80 ? style : v === 0x81 ? !style : v !== 0);
const s16 = (op: Uint8Array, o = 0) => { const v = (op[o] ?? 0) | ((op[o + 1] ?? 0) << 8); return v & 0x8000 ? v - 0x10000 : v; };
const u16 = (op: Uint8Array, o = 0) => (op[o] ?? 0) | ((op[o + 1] ?? 0) << 8);
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;

/** Word's underline kinds (kul) as the model's line styles. */
function Kul(k: number): FontLineStyle {
  if (!k) return 'none';
  if (k === 3) return 'double';
  if (k === 4 || k === 20) return 'dotted';
  if ([7, 9, 10, 23, 25, 26, 39, 55].includes(k)) return 'dash';
  if ([11, 27, 43].includes(k)) return 'wave';
  return 'single';
}

export async function ImportDOC(bytes: Uint8Array): Promise<ImportResult> {
  const lost = new Set<string>();
  let stg: Storage;
  // Word 1.x and 2.x files are no compound documents.
  try { stg = new Storage(bytes); } catch { throw new Error('This is not a Word 97-2003 document (older Word formats are not supported yet).'); }
  const wordStrm = stg.OpenStream('WordDocument');
  if (!wordStrm) throw new Error('This is not a Word document.');
  const word = new WW8Bytes(wordStrm);
  const fib = new WW8Fib(word);
  if (fib.wIdent !== 0xa5ec && fib.wIdent !== 0xa5dc) throw new Error('This is not a Word document.');
  if (!fib.IsEightPlus()) throw new Error('Documents of Word 6.0/95 and earlier are not supported yet.');
  if (fib.fEncrypted) throw new Error('This document is password protected, which is not supported.');
  const tableStrm = stg.OpenStream(fib.fWhichTblStm ? '1Table' : '0Table');
  if (!tableStrm) throw new Error('The document\'s table stream is missing.');
  const table = new WW8Bytes(tableStrm);

  const { pieces, prcs } = ReadClx(table, fib);
  if (!pieces.length) pieces.push({ cpStart: 0, cpEnd: fib.ccpText, fc: 0x400, compressed: false, prm: 0 });
  const chpRuns = ReadFkps(word, table, fib.fcPlcfbteChpx, fib.lcbPlcfbteChpx, false);
  const papRuns = ReadFkps(word, table, fib.fcPlcfbtePapx, fib.lcbPlcfbtePapx, true);
  const { styles, ftcAscii } = ReadStyles(table, fib);
  const fonts = ReadFonts(table, fib);
  const sections = ReadSections(word, table, fib);

  // The main text, character by character, with each character's file position.
  const cp1252 = new TextDecoder('windows-1252');
  const piece = (cp: number): WW8Piece | undefined => pieces.find((p) => cp >= p.cpStart && cp < p.cpEnd);
  const fcOf = (cp: number): number => { const p = piece(cp); return p ? p.fc + (cp - p.cpStart) * (p.compressed ? 1 : 2) : -1; };
  let text = '';
  for (const p of pieces) {
    if (p.cpStart >= fib.ccpText) break;
    const n = Math.min(p.cpEnd, fib.ccpText) - p.cpStart;
    if (p.compressed) text += cp1252.decode(word.slice(p.fc, n));
    else { const s = word.slice(p.fc, 2 * n); for (let i = 0; i + 1 < s.length; i += 2) text += String.fromCharCode(s[i]! | (s[i + 1]! << 8)); }
  }
  /** The Prc grpprl a piece's Prm points to (its properties apply to all of the piece's text). */
  const prmGrpprl = (p: WW8Piece | undefined): Uint8Array | undefined => (p && p.prm & 1 ? prcs[p.prm >> 1] : undefined);

  if (fib.ccpFtn > 0) lost.add('footnotes');
  if (fib.ccpEdn > 0) lost.add('endnotes');
  if (fib.ccpHdr > 0) lost.add('headers and footers');
  if (fib.ccpAtn > 0) lost.add('comments');
  if (fib.ccpTxbx > 0 || fib.ccpHdrTxbx > 0) lost.add('text boxes');

  const doc = new SwDoc();
  const nodes = doc.GetNodes();
  const standard = doc.FindTextFormatCollByName('Standard')!;
  // The defaults: Word's 10 pt and the style sheet's default font; the document language.
  doc.m_aDefaults.RES_CHRATR_FONTSIZE = 200;
  if (fonts[ftcAscii]) doc.m_aDefaults.RES_CHRATR_FONT = fonts[ftcAscii];
  if (LCID[fib.lid]) doc.m_aDefaults.RES_CHRATR_LANGUAGE = LCID[fib.lid];
  // Word's default paragraph has no spacing and single lines.
  doc.m_aDefaults.RES_UL_SPACE = { upper: 0, lower: 0 };
  doc.m_aDefaults.RES_PARATR_LINESPACING = { rule: 'proportional', value: 100 };

  /** SwWW8ImplReader's character sprms (ww8par6.cxx Read_*), on top of `base`. */
  const applyChp = (g: Uint8Array | undefined, set: SwCharAttrSet, base: (k: keyof SwCharAttrSet) => unknown, extra?: { charStyle?: number; special?: boolean }) => {
    if (!g) return;
    const tog = (op: Uint8Array, k: 'RES_CHRATR_WEIGHT' | 'RES_CHRATR_POSTURE' | 'RES_CHRATR_CROSSEDOUT' | 'RES_CHRATR_CONTOUR' | 'RES_CHRATR_SHADOWED') => { set[k] = toggle(op[0] ?? 0, !!(set[k] ?? base(k))); };
    ForEachSprm(g, (id, op) => {
      switch (id) {
        case 0x0835: tog(op, 'RES_CHRATR_WEIGHT'); break; // sprmCFBold
        case 0x0836: tog(op, 'RES_CHRATR_POSTURE'); break; // sprmCFItalic
        case 0x0837: case 0x2a53: tog(op, 'RES_CHRATR_CROSSEDOUT'); break; // sprmCFStrike, sprmCFDStrike
        case 0x0838: tog(op, 'RES_CHRATR_CONTOUR'); break; // sprmCFOutline
        case 0x0839: tog(op, 'RES_CHRATR_SHADOWED'); break; // sprmCFShadow
        case 0x083a: if (toggle(op[0] ?? 0, set.RES_CHRATR_CASEMAP === 'smallcaps')) set.RES_CHRATR_CASEMAP = 'smallcaps'; else if (set.RES_CHRATR_CASEMAP === 'smallcaps') set.RES_CHRATR_CASEMAP = 'none'; break;
        case 0x083b: if (toggle(op[0] ?? 0, set.RES_CHRATR_CASEMAP === 'uppercase')) set.RES_CHRATR_CASEMAP = 'uppercase'; else if (set.RES_CHRATR_CASEMAP === 'uppercase') set.RES_CHRATR_CASEMAP = 'none'; break;
        case 0x2a3e: set.RES_CHRATR_UNDERLINE = Kul(op[0] ?? 0); break; // sprmCKul
        case 0x2a42: set.RES_CHRATR_COLOR = ICO[op[0] ?? 0] ?? null; break; // sprmCIco
        case 0x6870: set.RES_CHRATR_COLOR = op[3] === 0xff ? null : hex(op[0] ?? 0, op[1] ?? 0, op[2] ?? 0); break; // sprmCCv
        case 0x4a43: set.RES_CHRATR_FONTSIZE = u16(op) * 10; break; // sprmCHps (half points)
        case 0x4a4f: { const f = fonts[u16(op)]; if (f) set.RES_CHRATR_FONT = f; break; } // sprmCRgFtc0
        case 0x2a48: set.RES_CHRATR_ESCAPEMENT = op[0] === 1 ? 33 : op[0] === 2 ? -33 : 0; break; // sprmCIss
        case 0x2a0c: set.RES_CHRATR_BACKGROUND = ICO[op[0] ?? 0] ?? null; break; // sprmCHighlight
        case 0x486d: case 0x4873: { const l = LCID[u16(op)]; if (l) set.RES_CHRATR_LANGUAGE = l; break; } // sprmCRgLid0(_80)
        case 0x4a30: if (extra) extra.charStyle = u16(op); break; // sprmCIstd
        case 0x0855: if (extra) extra.special = (op[0] ?? 0) !== 0; break; // sprmCFSpec
        default: break;
      }
    });
  };

  /** The paragraph sprms (ww8par6.cxx), on top of `set`. */
  let inTable = false, inList = false;
  const applyPap = (g: Uint8Array | undefined, set: SwAttrSet, inherited: () => SwAttrSet) => {
    if (!g) return;
    const lr = () => (set.RES_LR_SPACE ??= { ...(inherited().RES_LR_SPACE ?? POOL_DEFAULTS.RES_LR_SPACE) });
    const ul = () => (set.RES_UL_SPACE ??= { ...(inherited().RES_UL_SPACE ?? POOL_DEFAULTS.RES_UL_SPACE) });
    ForEachSprm(g, (id, op) => {
      switch (id) {
        case 0x2403: case 0x2461: set.RES_PARATR_ADJUST = (['left', 'center', 'right', 'block'] as const)[op[0] ?? 0] ?? 'block'; break; // sprmPJc80, sprmPJc
        case 0x840f: case 0x845e: lr().left = s16(op); break; // sprmPDxaLeft80, sprmPDxaLeft
        case 0x840e: case 0x845d: lr().right = s16(op); break; // sprmPDxaRight80, sprmPDxaRight
        case 0x8411: case 0x8460: lr().firstLine = s16(op); break; // sprmPDxaLeft180, sprmPDxaLeft1
        case 0xa413: ul().upper = u16(op); break; // sprmPDyaBefore
        case 0xa414: ul().lower = u16(op); break; // sprmPDyaAfter
        case 0x6412: { // sprmPDyaLine (LSPD): proportional in 240ths, else at least or (negative) exactly
          const dya = s16(op), mult = s16(op, 2);
          set.RES_PARATR_LINESPACING = mult ? { rule: 'proportional', value: Math.round((dya * 100) / 240) } : dya < 0 ? { rule: 'fix', value: -dya } : { rule: 'min', value: dya };
          break;
        }
        case 0x2405: case 0x2406: if (op[0]) set.RES_KEEP = true; break; // sprmPFKeep, sprmPFKeepFollow
        case 0x2407: if (op[0]) set.RES_BREAK = 'page-before'; break; // sprmPFPageBreakBefore
        case 0x2431: set.RES_PARATR_WIDOWS = op[0] ? 2 : 0; set.RES_PARATR_ORPHANS = op[0] ? 2 : 0; break; // sprmPFWidowControl
        case 0x2416: if (op[0]) inTable = true; break; // sprmPFInTable
        case 0x460b: if (u16(op)) inList = true; break; // sprmPIlfo
        case 0x442d: { const ico = (u16(op) >> 5) & 0x1f; set.RES_BACKGROUND = ICO[ico] ?? null; break; } // sprmPShd80: icoBack
        case 0xc64d: set.RES_BACKGROUND = op[7] === 0xff ? null : hex(op[4] ?? 0, op[5] ?? 0, op[6] ?? 0); break; // sprmPShd: cvBack
        case 0xc60d: { // sprmPChgTabsPapx: deleted and added tab stops
          const tabs = [...(set.RES_PARATR_TABSTOP ?? inherited().RES_PARATR_TABSTOP ?? [])];
          const nDel = op[0] ?? 0;
          const del = new Set(Array.from({ length: nDel }, (_, i) => s16(op, 1 + 2 * i)));
          const nAdd = op[1 + 2 * nDel] ?? 0, addAt = 2 + 2 * nDel;
          const out = tabs.filter((t) => !del.has(t.pos));
          for (let i = 0; i < nAdd; i++) {
            const pos = s16(op, addAt + 2 * i), tbd = op[addAt + 2 * nAdd + i] ?? 0;
            const jc = tbd & 7, tlc = (tbd >> 3) & 7;
            if (jc === 4) continue; // bar tabs are not ported
            const t: SvxTabStop = { pos, adjust: (['left', 'center', 'right', 'decimal'] as const)[jc] ?? 'left', fill: ['', '.', '-', '_', '_', '·'][tlc] ?? '', decimal: ',' };
            out.splice(0, out.length, ...out.filter((x) => x.pos !== pos), t);
          }
          set.RES_PARATR_TABSTOP = out.sort((a, b) => a.pos - b.pos);
          break;
        }
        default: break;
      }
    });
  };

  // The style sheet: paragraph styles as format collections (bases first), character styles.
  const colls = new Map<number, SwTextFormatColl>();
  const charFormats = new Map<number, SwCharFormat>();
  const resolving = new Set<number>();
  const styleName = (s: WW8Std): string => {
    if (STI_NAMES[s.sti]) return STI_NAMES[s.sti]!;
    if (s.sti >= 1 && s.sti <= 9) return `Heading ${s.sti}`;
    return s.name || `Style ${s.istd}`;
  };
  const resolveColl = (istd: number): SwTextFormatColl => {
    const got = colls.get(istd);
    if (got) return got;
    const s = styles[istd];
    if (!s || s.sgc !== 1 || resolving.has(istd)) return standard;
    resolving.add(istd);
    const parent = s.istdBase !== 0xfff && s.istd !== 0 ? resolveColl(s.istdBase) : null;
    const set: SwAttrSet = {};
    const inherited = (): SwAttrSet => ({ ...(parent ? { RES_LR_SPACE: parent.GetFormatAttr('RES_LR_SPACE'), RES_UL_SPACE: parent.GetFormatAttr('RES_UL_SPACE'), RES_PARATR_TABSTOP: parent.GetFormatAttr('RES_PARATR_TABSTOP') } : {}) });
    applyPap(s.papx, set, inherited);
    applyChp(s.chpx, set, (k) => (parent ? parent.GetFormatAttr(k) : doc.m_aDefaults[k]));
    let c: SwTextFormatColl;
    const name = styleName(s);
    if (s.istd === 0) { Object.assign(standard.m_aSet, set); c = standard; }
    else {
      const existing = doc.FindTextFormatCollByName(name);
      if (existing) { existing.m_aSet = set; existing.m_pDerivedFrom = parent; c = existing; }
      else c = doc.MakeColl(name, parent, set);
    }
    colls.set(istd, c);
    return c;
  };
  styles.forEach((s, i) => { if (s?.sgc === 1) resolveColl(i); });
  styles.forEach((s, i) => { if (s?.sgc === 1 && styles[s.istdNext]?.sgc === 1) colls.get(i)!.m_pNextTextFormatColl = colls.get(s.istdNext)!; });
  styles.forEach((s, i) => {
    // Character styles, without Word's "Default Paragraph Font" (sti 65).
    if (s?.sgc !== 2 || s.sti === 65) return;
    const set: SwCharAttrSet = {};
    applyChp(s.chpx, set, (k) => doc.m_aDefaults[k]);
    charFormats.set(i, doc.MakeCharFormat(s.name || `Character Style ${i}`, set));
  });
  inTable = false; inList = false;

  // Paragraphs: the text up to each paragraph mark (or cell mark, or section break).
  const sectionEnds = new Set(sections.map((s) => s.cpEnd));
  const fieldStack: { sep: boolean }[] = [];
  let node: SwTextNode = nodes.FirstTextNode();
  let firstPara = true;
  let pendingBreak = false;
  let tables = false, lists = false;
  const paraStarts: { node: SwTextNode; cp: number }[] = [];
  let paraStart = 0;
  /** Characters of the current paragraph and the file position of each. */
  let chars: { ch: string; cp: number }[] = [];
  const finishPara = (cpMark: number) => {
    // Paragraph properties from the PAPX run of the paragraph mark, and the piece's Prm.
    const run = FindRun(papRuns, fcOf(cpMark));
    const coll = resolveColl(run?.istd ?? 0);
    if (!firstPara) node = nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), coll, '');
    else node.m_pColl = coll;
    firstPara = false;
    inTable = false; inList = false;
    const set: SwAttrSet = {};
    const inherited = (): SwAttrSet => ({ RES_LR_SPACE: coll.GetFormatAttr('RES_LR_SPACE'), RES_UL_SPACE: coll.GetFormatAttr('RES_UL_SPACE'), RES_PARATR_TABSTOP: coll.GetFormatAttr('RES_PARATR_TABSTOP') });
    applyPap(run?.grpprl, set, inherited);
    applyPap(prmGrpprl(piece(cpMark)), set, inherited);
    if (inTable) tables = true;
    if (inList) lists = true;
    if (pendingBreak) { set.RES_BREAK = 'page-before'; pendingBreak = false; }
    Object.assign(node.m_aSet, set);
    // The text, with its character properties run by run.
    let s = '';
    const ranges: { start: number; end: number; attrs: SwCharAttrSet; key: string }[] = [];
    for (const { ch, cp } of chars) {
      const fc = fcOf(cp);
      const crun = FindRun(chpRuns, fc);
      const p = piece(cp);
      const key = `${chpRuns.indexOf(crun!)}|${p?.prm ?? 0}`;
      const last = ranges[ranges.length - 1];
      if (last && last.key === key && last.end === s.length) { last.end += ch.length; }
      else {
        const attrs: SwCharAttrSet = {};
        const extra: { charStyle?: number } = {};
        applyChp(crun?.grpprl, attrs, (k) => coll.GetFormatAttr(k), extra);
        applyChp(prmGrpprl(p), attrs, (k) => coll.GetFormatAttr(k), extra);
        if (extra.charStyle !== undefined && charFormats.has(extra.charStyle)) attrs.RES_TXTATR_CHARFMT = charFormats.get(extra.charStyle)!;
        ranges.push({ start: s.length, end: s.length + ch.length, attrs, key });
      }
      s += ch;
    }
    node.InsertText(s, 0);
    for (const r of ranges) if (Object.keys(r.attrs).length && r.end > r.start) node.SetAttr(r.start, r.end, r.attrs);
    paraStarts.push({ node, cp: paraStart });
    chars = [];
    paraStart = cpMark + 1;
  };

  for (let cp = 0; cp < text.length; cp++) {
    const c = text[cp]!;
    const code = c.charCodeAt(0);
    // Fields: the instruction between 0x13 and 0x14 is dropped, the result kept.
    if (code === 0x13) { fieldStack.push({ sep: false }); lost.add('fields (their current value is kept as text)'); continue; }
    if (code === 0x14) { if (fieldStack.length) fieldStack[fieldStack.length - 1]!.sep = true; continue; }
    if (code === 0x15) { fieldStack.pop(); continue; }
    if (fieldStack.some((f) => !f.sep)) continue;
    switch (code) {
      case 0x0d: finishPara(cp); break;
      case 0x07: finishPara(cp); break; // a cell or row end
      case 0x0c:
        // A section break ends its section's last paragraph; otherwise a page break.
        if (sectionEnds.has(cp + 1)) finishPara(cp);
        else if (chars.length) { finishPara(cp); pendingBreak = true; }
        else pendingBreak = true;
        break;
      case 0x0e: if (chars.length) finishPara(cp); break; // a column break, reduced to a paragraph end
      case 0x0b: chars.push({ ch: '\n', cp }); break;
      case 0x01: case 0x08: lost.add('pictures and drawing objects'); break;
      case 0x02: case 0x05: break; // footnote and comment references (not ported)
      case 0x1e: chars.push({ ch: '‑', cp }); break;
      case 0x1f: chars.push({ ch: '­', cp }); break;
      default: chars.push({ ch: c, cp });
    }
  }
  if (chars.length || firstPara) finishPara(Math.max(0, text.length - 1));
  if (tables) lost.add('tables (their cells are kept as paragraphs)');
  if (lists) lost.add('lists and numbering');

  // Sections (SwWW8ImplReader::CreateSep): page size, margins and header distance; the first
  // section's page style is the default one, each further one a page style of its own.
  sections.forEach((sec, k) => {
    const pd = k === 0 ? doc.m_aPageDesc : doc.MakePageDesc(`Converted${k}`, new SwPageDesc());
    let w = 12240, h = 15840, l = 1800, r = 1800, t = 1440, b = 1440, bkc = 2, pgnStart: number | null = null, restart = false;
    ForEachSprm(sec.grpprl, (id, op) => {
      switch (id) {
        case 0xb01f: w = u16(op); break; // sprmSXaPage
        case 0xb020: h = u16(op); break; // sprmSYaPage
        case 0xb021: l = u16(op); break; // sprmSDxaLeft
        case 0xb022: r = u16(op); break; // sprmSDxaRight
        case 0x9023: t = Math.abs(s16(op)); break; // sprmSDyaTop
        case 0x9024: b = Math.abs(s16(op)); break; // sprmSDyaBottom
        case 0x3009: bkc = op[0] ?? 2; break; // sprmSBkc
        case 0x501c: pgnStart = u16(op); break; // sprmSPgnStart97
        case 0x3011: restart = !!op[0]; break; // sprmSFPgnRestart
        default: break;
      }
    });
    Object.assign(pd, { nWidth: w, nHeight: h, nLeft: l, nRight: r, nTop: t, nBottom: b });
    if (k === 0) return;
    // A continuous section break (bkc 0) keeps the page; the page style waits for the next page.
    if (bkc === 0) return;
    const start = paraStarts.find((p) => p.cp >= sections[k - 1]!.cpEnd);
    if (start) start.node.m_aSet.RES_PAGEDESC = { name: pd.m_aName, numOffset: restart ? pgnStart ?? 1 : null };
  });
  if (!sections.length) Object.assign(doc.m_aPageDesc, { nWidth: 12240, nHeight: 15840, nLeft: 1800, nRight: 1800, nTop: 1440, nBottom: 1440 });

  // Word layout, as for DOCX.
  doc.m_bTabOverSpacing = true;
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}
