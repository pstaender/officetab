// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ww8/ww8par.cxx reduced
// @upstream sw/source/filter/ww8/ww8par2.cxx reduced
// @upstream sw/source/filter/ww8/ww8par3.cxx reduced
// @upstream sw/source/filter/ww8/ww8graf2.cxx reduced
// @upstream sw/source/filter/ww8/ww8graf.cxx reduced
// @upstream sw/source/filter/ww8/ww8par6.cxx reduced
// SwWW8ImplReader for Word 97-2003 documents (.doc, .dot): the text of the main story and of the
// headers and footers, in paragraphs and tables (WW8TabDesc: cell widths, borders, shading,
// vertical alignment, merges, row heights, heading rows); the style sheet; character and
// paragraph properties (the common sprms of ww8par6.cxx's SprmReadId table); the sections' page
// geometry with headers and footers (first page and even pages, linked to the previous section
// when empty); PAGE and NUMPAGES fields; lists (WW8ListManager: one rule per list override, its
// levels' types, number texts, bullets, alignment, indents; the overrides' own levels and start
// values are not read); the fonts' families; inline pictures (ImportGraf: the PICF's goal size,
// scaling and cropping, the BLIP of its shape or of the drawing group's BLIP store). Reduced
// floating objects (Read_GrafLayer, ProcessEscherAlign: the FSPA's rectangle, its relations and
// wrapping, posh and posv alignment, wrap distances; pictures, text boxes with their stories,
// custom shapes with fill and line, groups split into their shapes). Reduced (reported through
// ImportResult.lost): fields other than PAGE, NUMPAGES, SEQ, HYPERLINK and TOC (Read_Field,
// reduced: their results are kept as text), drawing objects without a
// custom shape (arcs, freeforms), OLE objects, Word 6 pictures, comments, tracked changes;
// nested tables (their cells become paragraphs of the outer cell); footnotes and endnotes are read
// (Read_Ftn: their PLCs' references and text ranges); floating tables are positioned in the text, kept apart from their
// neighbours by their position (InEqualApo, reduced). Toggle sprms that refer to the style (0x80,
// 0x81) are resolved against the paragraph style only. Language ids map through a reduced table
// of isolang.cxx.

import { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwTextFormatColl, SwCharFormat } from '../../../inc/format.ts';
import { POOL_DEFAULTS, type SwAttrSet, type SwCharAttrSet, type SvxTabStop, type FontLineStyle } from '../../../inc/hintids.ts';
import { SwPageDesc } from '../../../inc/pagedesc.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { RecodeBullet } from '../../../../unotools/source/misc/fontcvt.ts';
import { Storage } from '../../../../sot/source/sdstor/storage.ts';
import type { ImportResult } from '../xml/odt.ts';
import { FindRun, ForEachSprm, ReadClx, ReadPlcCps, ReadFkps, ReadFonts, ReadFspas, ReadHdd, ReadLists, ReadSections, ReadStyles, ReadTxbxStories, type WW8Fspa, WW8Bytes, WW8Fib, type WW8Piece, type WW8Std } from './ww8scan.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SvxBoxItem, type SwTableAdjust } from '../../../inc/swtable.ts';
import { SwEndNode, SwStartNode, SwTableNode, type SwNode, type SwAreaKind } from '../../../inc/node.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { CH_TXTATR_BREAKWORD, type SvxBorderLine, type SwField, type SwFlyCnt } from '../../../inc/hintids.ts';
import { SimpleField } from '../../writerfilter/dmapper/DomainMapper.ts';
import { FindBLIP, GetBLIPDirect, GetPib, ReadBStore, ReadDrawings, SP_FFLIPH, SP_FFLIPV, SP_FGROUP, WalkEscher, type DffShape } from '../../../../filter/source/msfilter/msdffimp.ts';
import { HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SdrShape, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import sptNames from '../../../../svx/source/customshapes/generated/mso-spt-names.json';

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
  const dataStrm = stg.OpenStream('Data');
  const papRuns = ReadFkps(word, table, fib.fcPlcfbtePapx, fib.lcbPlcfbtePapx, true, dataStrm && new WW8Bytes(dataStrm));
  const { styles, ftcAscii } = ReadStyles(table, fib);
  const ffs = new Map<string, number>();
  const fonts = ReadFonts(table, fib, ffs);
  const sections = ReadSections(word, table, fib);

  // The main text, character by character, with each character's file position.
  const cp1252 = new TextDecoder('windows-1252');
  const piece = (cp: number): WW8Piece | undefined => pieces.find((p) => cp >= p.cpStart && cp < p.cpEnd);
  const fcOf = (cp: number): number => { const p = piece(cp); return p ? p.fc + (cp - p.cpStart) * (p.compressed ? 1 : 2) : -1; };
  let text = '';
  // All the stories: main text, footnotes, headers and footers, comments, endnotes, text boxes.
  for (const p of pieces) {
    const n = p.cpEnd - p.cpStart;
    if (p.compressed) text += cp1252.decode(word.slice(p.fc, n));
    else { const s = word.slice(p.fc, 2 * n); for (let i = 0; i + 1 < s.length; i += 2) text += String.fromCharCode(s[i]! | (s[i + 1]! << 8)); }
  }
  /** The Prc grpprl a piece's Prm points to (its properties apply to all of the piece's text). */
  const prmGrpprl = (p: WW8Piece | undefined): Uint8Array | undefined => (p && p.prm & 1 ? prcs[p.prm >> 1] : undefined);

  if (fib.ccpAtn > 0) lost.add('comments');

  const doc = new SwDoc();
  // WW8Fonts: the FFN's ff is the family (1 roman, 2 swiss, 3 modern, 4 script, 5 decorative).
  for (const [name, ff] of ffs) { const fam = ([undefined, 'roman', 'swiss', 'modern', 'script', 'decorative'] as const)[ff]; if (fam) doc.m_aFontFamilies.set(name, fam); }
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
  let inList = false;
  let tables = 0;
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
        case 0x460b: { // sprmPIlfo: the paragraph's list override, 0 for none
          const ilfo = u16(op), rule = ruleOfLfo.get(ilfo);
          if (rule) Object.assign(set, { RES_PARATR_NUMRULE: rule, RES_PARATR_LIST_ID: `ww8list${ilfo}` });
          else if (!ilfo) set.RES_PARATR_NUMRULE = '';
          else if (ilfo !== 2047) inList = true;
          break;
        }
        case 0x260a: set.RES_PARATR_LIST_LEVEL = Math.min(MAXLEVEL - 1, op[0] ?? 0); break; // sprmPIlvl
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

  // Lists (WW8ListManager): a numbering rule and a list for every list override (LFO), as
  // upstream names them (WWNum), from its list definition's levels.
  const { lists, lfos } = ReadLists(table, fib);
  /** WW8ListManager::GetSvxNumTypeFromMSONFC, reduced to the numbering types of this port. */
  const NFC: Record<number, NumberingType> = { 0: NumberingType.ARABIC, 1: NumberingType.ROMAN_UPPER, 2: NumberingType.ROMAN_LOWER, 3: NumberingType.CHARS_UPPER_LETTER_N, 4: NumberingType.CHARS_LOWER_LETTER_N, 22: NumberingType.ARABIC, 23: NumberingType.CHAR_SPECIAL, 255: NumberingType.NUMBER_NONE };
  const ruleOfLfo = new Map<number, string>();
  lfos.forEach((lsid, i) => {
    const lst = lists.find((l) => l.nIdLst === lsid);
    if (!lst) return;
    const rule = new SwNumRule(`WWNum${i + 1}`);
    lst.levels.forEach((lvl, k) => {
      if (k >= MAXLEVEL) return;
      const f = new SwNumFormat();
      const type = NFC[lvl.nNFC];
      if (type === undefined) lost.add('list numbering of other kinds (shown as 1, 2, 3)');
      f.SetNumberingType(type ?? NumberingType.ARABIC);
      f.SetStart(lvl.nStartAt);
      if (type === NumberingType.CHAR_SPECIAL) {
        // The bullet is the number text's character; symbol font glyphs become Unicode.
        f.SetBulletChar(RecodeBullet(lvl.sNumString.slice(0, 1)) || '\u2022');
        ForEachSprm(lvl.chpx, (id, op) => { if (id === 0x4a4f) { const fn = fonts[u16(op)]; if (fn) f.SetBulletFont(fn); } });
      } else {
        // ReadLVL: the characters at the aOfsNumsXCH offsets (1-based) stand for a level's number.
        let sListFormat = lvl.sNumString, nExtraOffset = 0;
        for (let b = 0; b < 9 && lvl.aOfsNumsXCH[b]; b++) {
          const nOffset = lvl.aOfsNumsXCH[b]! + nExtraOffset - 1;
          if (nOffset >= sListFormat.length) continue;
          const sReplacement = `%${sListFormat.charCodeAt(nOffset) + 1}%`;
          sListFormat = sListFormat.slice(0, nOffset) + sReplacement + sListFormat.slice(nOffset + 1);
          nExtraOffset += sReplacement.length - 1;
        }
        f.SetListFormatString(sListFormat);
      }
      f.SetNumAdjust(lvl.nAlign === 1 ? 'center' : lvl.nAlign === 2 ? 'right' : 'left');
      f.SetLabelFollowedBy(lvl.ixchFollow === 1 ? 'space' : lvl.ixchFollow === 2 ? 'nothing' : 'listtab');
      // The level's paragraph sprms: its indents and the list's tab stop.
      let left = 720 * (k + 1), first = -360, tab: number | undefined;
      ForEachSprm(lvl.papx, (id, op) => {
        if (id === 0x845e || id === 0x840f) left = s16(op);
        else if (id === 0x8460 || id === 0x8411) first = s16(op);
        else if (id === 0xc60d) { const nDel = op[0] ?? 0, nAdd = op[1 + 2 * nDel] ?? 0; if (nAdd) tab = s16(op, 2 + 2 * nDel); }
      });
      f.SetIndentAt(left);
      f.SetFirstLineIndent(first);
      f.SetListtabPos(tab ?? left);
      rule.Set(k, f);
    });
    doc.PutNumRule(rule);
    ruleOfLfo.set(i + 1, rule.GetName());
  });

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
  inList = false;

  // Inline pictures (SwWW8ImplReader::ImportGraf, reduced): each picture character's PICF in the
  // Data stream (sprmCPicLocation) with its goal size, scaling and cropping, then its OfficeArt
  // record with the image (an FBSE's BLIP). Read before the text is built, as images inflate
  // asynchronously.
  // The drawing group's BLIP store (OfficeArtContent at fcDggInfo).
  const bstore = fib.lcbDggInfo ? ReadBStore(tableStrm, fib.fcDggInfo, fib.fcDggInfo + fib.lcbDggInfo, wordStrm) : [];
  const pictures = new Map<number, SwFlyCnt>();
  let nPictures = 0;
  for (let cp = 0; cp < text.length; cp++) {
    if (text.charCodeAt(cp) !== 0x01) continue;
    let spec = false, ole = false, data = false, fcPic = -1;
    for (const g of [FindRun(chpRuns, fcOf(cp))?.grpprl, prmGrpprl(piece(cp))]) {
      if (g) ForEachSprm(g, (id, op) => {
        if (id === 0x0855) spec = !!op[0]; // sprmCFSpec
        else if (id === 0x080a) ole = !!op[0]; // sprmCFOle2
        else if (id === 0x0806) data = !!op[0]; // sprmCFData: a form field's data, not a picture
        else if (id === 0x6a03) fcPic = (op[0] ?? 0) | ((op[1] ?? 0) << 8) | ((op[2] ?? 0) << 16) | ((op[3] ?? 0) << 24); // sprmCPicLocation
      });
    }
    if (!spec || data || fcPic < 0) continue;
    if (ole) { lost.add('OLE objects'); continue; }
    if (!dataStrm) { lost.add('pictures and drawing objects'); continue; }
    const d = new WW8Bytes(dataStrm);
    const lcb = d.i32(fcPic), cbHeader = d.u16(fcPic + 4), mm = d.i16(fcPic + 6);
    const dxaGoal = d.i16(fcPic + 0x1c), dyaGoal = d.i16(fcPic + 0x1e), mx = d.u16(fcPic + 0x20) || 1000, my = d.u16(fcPic + 0x22) || 1000;
    const cl = d.i16(fcPic + 0x24), ct = d.i16(fcPic + 0x26), cr = d.i16(fcPic + 0x28), cb = d.i16(fcPic + 0x2a);
    if (mm !== 0x64 && mm !== 0x66) { lost.add('pictures of Word 6 and older documents'); continue; }
    // MM_SHAPEFILE (0x66): a file name before the shape.
    let at = fcPic + cbHeader;
    if (mm === 0x66) at += 1 + d.u8(at);
    const blip = await FindBLIP(dataStrm, at, Math.min(dataStrm.length, fcPic + lcb), bstore);
    if (!blip) {
      // A shape with a picture that cannot be read; an empty picture frame has none.
      let hasPicture = GetPib(dataStrm, at, fcPic + lcb) > 0;
      WalkEscher(dataStrm, at, Math.min(dataStrm.length, fcPic + lcb), (h) => { if (h.nRecType >= 0xf018 && h.nRecType <= 0xf117) hasPicture = true; });
      if (hasPicture) lost.add('pictures in formats a browser cannot show');
      continue;
    }
    const graphic = doc.AddGraphic(blip.data, blip.mime);
    const fly: SwFlyCnt = {
      graphic, name: `Image${++nPictures}`,
      width: Math.max(1, Math.round(((dxaGoal - cl - cr) * mx) / 1000)), height: Math.max(1, Math.round(((dyaGoal - ct - cb) * my) / 1000)),
    };
    if ((cl || ct || cr || cb) && dxaGoal > 0 && dyaGoal > 0) fly.crop = { left: cl / dxaGoal, top: ct / dyaGoal, right: cr / dxaGoal, bottom: cb / dyaGoal };
    pictures.set(cp, fly);
  }

  // Floating objects (SwWW8ImplReader::Read_GrafLayer, reduced): the FSPAs of the main text and
  // the headers, their shapes in the drawings, the pictures those name (decoded beforehand), and
  // the text box stories.
  const fspas = { main: ReadFspas(table, fib.fcPlcfspaMom, fib.lcbPlcfspaMom), hdr: ReadFspas(table, fib.fcPlcfspaHdr, fib.lcbPlcfspaHdr) };
  const drawings = fib.lcbDggInfo ? ReadDrawings(tableStrm, fib.fcDggInfo, fib.fcDggInfo + fib.lcbDggInfo) : new Map<number, Map<number, DffShape>>();
  const pibGraphics = new Map<number, string>();
  for (const shapes of drawings.values()) {
    for (const sh of shapes.values()) {
      const pib = sh.aProps.get(0x104);
      if (!pib || pibGraphics.has(pib)) continue;
      const entry = bstore[pib - 1];
      const blip = entry ? await GetBLIPDirect(entry.stream, entry.at) : null;
      if (blip) pibGraphics.set(pib, doc.AddGraphic(blip.data, blip.mime));
    }
  }
  const txbxStart = fib.ccpText + fib.ccpFtn + fib.ccpHdr + fib.ccpMcr + fib.ccpAtn + fib.ccpEdn;
  const stories = { main: ReadTxbxStories(table, fib.fcPlcftxbxTxt, fib.lcbPlcftxbxTxt), hdr: ReadTxbxStories(table, fib.fcPlcfHdrtxbxTxt, fib.lcbPlcfHdrtxbxTxt) };

  // --- Reading text ranges (SwWW8ImplReader::ReadText): paragraph records, then nodes. ---

  /** A paragraph of a text range: its characters and the mark that ends it. */
  interface Para { cpMark: number; mark: 'para' | 'cell' | 'section'; chars: Char[]; breakBefore: boolean; tocId?: string }
  interface Char { ch: string; cp: number; field?: SwField; fly?: SwFlyCnt; obj?: boolean; note?: { endnote: boolean; index: number }; link?: string }

  // Footnotes and endnotes (SwWW8ImplReader::Read_Ftn): the reference marks' cps, and each note's
  // text range in the footnote or endnote story.
  const ftnRefs = ReadPlcCps(table, fib.fcPlcffndRef, fib.lcbPlcffndRef, 2);
  const ftnTxt = ReadPlcCps(table, fib.fcPlcffndTxt, fib.lcbPlcffndTxt, 0);
  const ednRefs = ReadPlcCps(table, fib.fcPlcfendRef, fib.lcbPlcfendRef, 2);
  const ednTxt = ReadPlcCps(table, fib.fcPlcfendTxt, fib.lcbPlcfendTxt, 0);
  /** A note's section with its text, as the DOCX import builds them; returns the anchor's attribute. */
  const makeNote = (endnote: boolean, index: number) => {
    const id = doc.NewFootnoteId();
    const sec = nodes.MakeFootnoteSection(id, doc.FindTextFormatCollByName(endnote ? 'Endnote' : 'Footnote')!);
    const placeholder = nodes.GoNext(sec.GetIndex())!;
    const base = endnote ? fib.ccpText + fib.ccpFtn + fib.ccpHdr + fib.ccpMcr + fib.ccpAtn : fib.ccpText;
    const range = endnote ? ednTxt : ftnTxt;
    buildBlocks(parseRange(base + range[index]!, base + range[index + 1]!), sec.EndOfSectionNode());
    if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
    return endnote ? { id, endnote: true } : { id };
  };

  /** The paragraphs of the text from cpFrom to cpTo. */
  const parseRange = (cpFrom: number, cpTo: number): Para[] => {
    const out: Para[] = [];
    const sectionEnds = new Set(sections.map((s) => s.cpEnd));
    // Fields (SwWW8ImplReader::Read_Field, reduced): the instruction between 0x13 and 0x14. PAGE,
    // NUMPAGES and SEQ become fields, HYPERLINK a link on its result, TOC marks its result's
    // paragraphs as the index; of the others the result is kept.
    const fields: { instr: string; sep: boolean; kind?: SwField; link?: string; toc?: string }[] = [];
    let chars: Char[] = [];
    let breakBefore = false;
    const tocOf = () => fields.find((f) => f.toc)?.toc;
    const end = (cpMark: number, mark: Para['mark']) => { out.push({ cpMark, mark, chars, breakBefore, ...(tocOf() ? { tocId: tocOf() } : {}) }); chars = []; breakBefore = false; };
    const push = (c: Char) => {
      const link = [...fields].reverse().find((f) => f.sep && f.link)?.link;
      chars.push(link ? { ...c, link } : c);
    };
    for (let cp = Math.max(0, cpFrom); cp < cpTo && cp < text.length; cp++) {
      const c = text[cp]!;
      const code = c.charCodeAt(0);
      if (code === 0x13) { fields.push({ instr: '', sep: false }); continue; }
      const top = fields[fields.length - 1];
      if (code === 0x14 || code === 0x15) {
        if (top && !top.sep) {
          const instr = top.instr.trim();
          const fld = SimpleField(instr);
          const href = /^HYPERLINK\s+(\\l\s+)?"([^"]*)"(?:\s+\\l\s+"([^"]*)")?/i.exec(instr);
          if (fld) top.kind = fld;
          else if (href) top.link = href[1] ? `#${href[2]}` : href[3] ? `${href[2]}#${href[3]}` : href[2]!;
          else if (/^TOC\b/i.test(instr) && !tocOf()) {
            // DomainMapper_Impl::handleToc, as for DOCX: the result's paragraphs are the index.
            top.toc = doc.NewTocId();
            const levels = /\\o\s+"(\d+)-(\d+)"/.exec(instr);
            doc.m_aTocSettings.set(top.toc, { title: '', levels: levels ? parseInt(levels[2]!, 10) : 3 });
          }
          // An index's page numbers are its text (as upstream keeps PAGEREF in an index).
          else if (instr && !(tocOf() && /^PAGEREF\b/i.test(instr))) lost.add('fields (their current value is kept as text)');
          top.sep = true;
        }
        if (code === 0x15) { fields.pop(); if (top?.kind && !fields.some((f) => !f.sep || f.kind)) push({ ch: CH_TXTATR_BREAKWORD, cp, field: top.kind }); }
        continue;
      }
      if (top && !top.sep) { top.instr += c; continue; }
      if (fields.some((f) => f.kind)) continue; // the result of a field that is kept as a field
      switch (code) {
        case 0x0d: end(cp, 'para'); break;
        case 0x07: end(cp, 'cell'); break;
        case 0x0c:
          // A section break ends its section's last paragraph; otherwise a page break.
          if (sectionEnds.has(cp + 1)) end(cp, 'section');
          else if (chars.length) { end(cp, 'para'); breakBefore = true; }
          else breakBefore = true;
          break;
        case 0x0e: if (chars.length) end(cp, 'para'); break; // a column break, reduced to a paragraph end
        case 0x0b: push({ ch: '\n', cp }); break;
        case 0x01: {
          // An inline picture (read beforehand); other special characters 1 are not ported.
          const fly = pictures.get(cp);
          if (fly) push({ ch: CH_TXTATR_BREAKWORD, cp, fly });
          break;
        }
        case 0x08: push({ ch: '', cp, obj: true }); break; // a floating object's anchor
        case 0x02: {
          // A footnote or endnote reference of the main text (its PLC's position); in a note's own
          // text the mark is the note's number, which Writer adds.
          const f = ftnRefs.indexOf(cp), e = ednRefs.indexOf(cp);
          if (f >= 0 && f < ftnTxt.length - 1) push({ ch: CH_TXTATR_BREAKWORD, cp, note: { endnote: false, index: f } });
          else if (e >= 0 && e < ednTxt.length - 1) push({ ch: CH_TXTATR_BREAKWORD, cp, note: { endnote: true, index: e } });
          break;
        }
        case 0x05: break; // comment references (not ported)
        case 0x1e: push({ ch: '‑', cp }); break;
        case 0x1f: push({ ch: '­', cp }); break;
        default: push({ ch: c, cp });
      }
    }
    if (chars.length) end(Math.max(cpFrom, cpTo - 1), 'para');
    return out;
  };

  /** The table sprms of a paragraph (WW8TabDesc): whether it is in a table, ends a row, nesting. */
  const tableInfo = (cpMark: number) => {
    const run = FindRun(papRuns, fcOf(cpMark));
    // The FKP run's sprms, then the piece's Prm (fast-saved files put row definitions there).
    const prm = prmGrpprl(piece(cpMark));
    const all = prm?.length ? new Uint8Array([...(run?.grpprl ?? []), ...prm]) : run?.grpprl;
    const info = { inTable: false, ttp: false, itap: 0, innerTtp: false, grpprl: all };
    for (const g of [run?.grpprl, prm]) {
      if (!g) continue;
      ForEachSprm(g, (id, op) => {
        if (id === 0x2416) info.inTable = !!op[0]; // sprmPFInTable
        else if (id === 0x2417) info.ttp = !!op[0]; // sprmPFTtp
        else if (id === 0x6649) info.itap = (op[0] ?? 0) | ((op[1] ?? 0) << 8); // sprmPItap
        else if (id === 0x244c) info.innerTtp = !!op[0]; // sprmPFInnerTtp
      });
    }
    if (info.inTable && !info.itap) info.itap = 1;
    return info;
  };

  const usedNames = new Set<string>();
  const uniqueName = (prefix: string) => { let k = 1; while (usedNames.has(`${prefix}${k}`)) k++; usedNames.add(`${prefix}${k}`); return `${prefix}${k}`; };
  /** An Escher COLORREF (red in the low byte); system and scheme colours are not resolved. */
  const cref = (v: number | undefined, dflt: string | null): string | null => (v === undefined || ((v >>> 0) >>> 24) & 0x10 ? dflt : hex(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff));
  /** EMUs as twips, within what a page can hold (damaged values are clamped). */
  const emu = (v: number | undefined, dflt: number) => Math.max(0, Math.min(31680, Math.round((v ?? dflt) / 635)));
  let objectDepth = 0;

  /**
   * SwWW8ImplReader::ProcessEscherAlign and the shape's import: a floating object anchored at
   * position `pos` of `node`, from the FSPA at `cp` and its shape.
   */
  const makeObject = (cp: number, node: SwTextNode, pos: number) => {
    const inHdr = cp >= fib.ccpText + fib.ccpFtn && cp < fib.ccpText + fib.ccpFtn + fib.ccpHdr;
    const list = inHdr ? fspas.hdr : fspas.main;
    const rel = inHdr ? cp - (fib.ccpText + fib.ccpFtn) : cp;
    const fspa = list.find((f) => f.cp === rel);
    const shape = fspa && drawings.get(inHdr ? 1 : 0)?.get(fspa.nSpId);
    if (!fspa || !shape) { lost.add('drawing objects'); return; }
    placeShape(fspa, shape, [fspa.nXaLeft, fspa.nYaTop, fspa.nXaRight, fspa.nYaBottom], node, pos, inHdr);
  };

  /** One shape (or each shape of a group, placed through its coordinates) at `r` (twips). */
  const placeShape = (fspa: WW8Fspa, sh: DffShape, r: [number, number, number, number], node: SwTextNode, pos: number, inHdr: boolean) => {
    if (sh.nFlags & SP_FGROUP && sh.aChildren) {
      const g = sh.aGroupRect ?? [0, 0, 1, 1];
      const fx = (r[2] - r[0]) / Math.max(1, g[2] - g[0]), fy = (r[3] - r[1]) / Math.max(1, g[3] - g[1]);
      for (const c of sh.aChildren) {
        const a = c.aChildAnchor ?? c.aGroupRect ?? g;
        placeShape(fspa, c, [r[0] + (a[0] - g[0]) * fx, r[1] + (a[1] - g[1]) * fy, r[0] + (a[2] - g[0]) * fx, r[1] + (a[3] - g[1]) * fy].map(Math.round) as [number, number, number, number], node, pos, inHdr);
      }
      return;
    }
    const p = sh.aProps;
    // FSPA nbx and nby; OfficeArt's posh and posv align on top of them.
    const REL = [RelOrientation.PAGE_PRINT_AREA, RelOrientation.PAGE_FRAME, RelOrientation.FRAME];
    const posh = p.get(0x38f) ?? 0, posv = p.get(0x391) ?? 0;
    const HORI = [HoriOrientation.NONE, HoriOrientation.LEFT, HoriOrientation.CENTER, HoriOrientation.RIGHT, HoriOrientation.LEFT, HoriOrientation.RIGHT];
    const VERT = [VertOrientation.NONE, VertOrientation.TOP, VertOrientation.CENTER, VertOrientation.BOTTOM, VertOrientation.TOP, VertOrientation.BOTTOM];
    // The wrap (wr, wrk), as the FSPA says.
    let wrap: WrapTextMode = WrapTextMode.PARALLEL;
    if (fspa.nwr === 1) wrap = WrapTextMode.NONE;
    else if (fspa.nwr === 3) wrap = WrapTextMode.THROUGH;
    if (fspa.nwr === 2 || fspa.nwr === 4) wrap = ([WrapTextMode.PARALLEL, WrapTextMode.LEFT, WrapTextMode.RIGHT, WrapTextMode.DYNAMIC] as const)[fspa.nwrk] ?? WrapTextMode.PARALLEL;
    const fmt: SwFlyFrameFormat = {
      m_aName: '', m_nWidth: Math.max(1, r[2] - r[0]), m_nHeight: Math.max(1, r[3] - r[1]),
      m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_CHAR, m_nPageNumber: 0 },
      m_aHoriOrient: { m_eOrient: HORI[posh] ?? HoriOrientation.NONE, m_eRelation: REL[fspa.nbx] ?? RelOrientation.FRAME, m_nPos: r[0] },
      m_aVertOrient: { m_eOrient: VERT[posv] ?? VertOrientation.NONE, m_eRelation: REL[fspa.nby] ?? RelOrientation.FRAME, m_nPos: r[1] },
      m_aSurround: { m_eSurround: wrap, ...(fspa.nwr === 4 || fspa.nwr === 5 ? { m_bContour: true, m_bOutside: true } : {}) },
      m_nLeftSpace: emu(p.get(0x384), 114300), m_nRightSpace: emu(p.get(0x386), 114300), m_nUpperSpace: emu(p.get(0x385), 0), m_nLowerSpace: emu(p.get(0x387), 0),
      m_bOpaque: !fspa.bBelowText,
    };
    // Fill and line: fFilled and fLine with their use bits; Word's defaults are a white fill and a black line.
    const fillBits = p.get(0x1bf), lineBits = p.get(0x1ff);
    const filled = fillBits !== undefined && fillBits & 0x100000 ? !!(fillBits & 0x10) : true;
    const lined = lineBits !== undefined && lineBits & 0x80000 ? !!(lineBits & 0x8) : true;
    const fill = filled ? cref(p.get(0x181), '#ffffff') : null;
    const line = lined ? { color: cref(p.get(0x1c0), '#000000') ?? '#000000', width: Math.max(1, emu(p.get(0x1cb), 9525)) } : null;
    const pib = p.get(0x104), lTxid = p.get(0x80);
    const name = sptNames[sh.nShapeType] ?? '';
    const readText = (id: string) => {
      // The text box story: lTxid's high word numbers it from 1; reusable stories are skipped.
      const list = inHdr ? stories.hdr : stories.main;
      let k = (lTxid! >>> 16) - 1;
      while (list[k]?.reusable) k++;
      const st = list[k];
      if (!st || objectDepth > 4) return;
      const base = txbxStart + (inHdr ? fib.ccpTxbx : 0);
      const section = nodes.MakeFlySection(id, standard);
      const placeholder = nodes.GoNext(section.GetIndex())!;
      objectDepth++;
      buildBlocks(parseRange(base + st.cpStart, base + st.cpEnd), section.EndOfSectionNode());
      objectDepth--;
      if (section.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
    };
    if (pib) {
      const graphic = pibGraphics.get(pib);
      if (!graphic) { lost.add('pictures in formats a browser cannot show'); return; }
      fmt.m_aName = uniqueName('Image');
      fmt.graphic = graphic;
      if (sh.nFlags & (SP_FFLIPH | SP_FFLIPV)) fmt.m_eMirror = sh.nFlags & SP_FFLIPH && sh.nFlags & SP_FFLIPV ? 'both' : sh.nFlags & SP_FFLIPH ? 'vertical' : 'horizontal';
    } else if (sh.nShapeType === 202 || (lTxid !== undefined && sh.nShapeType === 1)) {
      // A text box: a text frame with the shape's fill, line and text insets.
      fmt.m_aName = uniqueName('Frame');
      fmt.m_sContentId = fmt.m_aName;
      fmt.m_aBox = { top: line, bottom: line && { ...line }, left: line && { ...line }, right: line && { ...line }, padding: emu(p.get(0x81), 91440) };
      fmt.m_aBackground = fill;
      if (lTxid !== undefined) readText(fmt.m_aName);
    } else {
      const type = sh.nShapeType === 20 ? 'line' : name;
      if (!type || !GetCustomShapeContent(type)) { lost.add('drawing objects of other kinds'); return; }
      fmt.m_aName = uniqueName('Shape');
      const shape: SdrShape = { m_sType: type, m_aFill: type === 'line' ? null : fill, m_aLine: line };
      if (sh.nFlags & SP_FFLIPH) shape.m_bFlipH = true;
      if (sh.nFlags & SP_FFLIPV) shape.m_bFlipV = true;
      fmt.m_pShape = shape;
      if (lTxid !== undefined) {
        fmt.m_sContentId = fmt.m_aName;
        fmt.m_aBox = { top: null, bottom: null, left: null, right: null, padding: emu(p.get(0x81), 91440) };
        readText(fmt.m_aName);
      }
    }
    node.m_aAnchoredFlys.push({ fmt, nContent: pos });
  };

  /** A paragraph node before `before`, with its style, properties and text. */
  const makePara = (p: Para, before: SwNode): SwTextNode => {
    const run = FindRun(papRuns, fcOf(p.cpMark));
    const coll = resolveColl(run?.istd ?? 0);
    const node = nodes.MakeTextNode(before.GetIndex(), coll, '');
    inList = false;
    const set: SwAttrSet = {};
    const inherited = (): SwAttrSet => ({ RES_LR_SPACE: coll.GetFormatAttr('RES_LR_SPACE'), RES_UL_SPACE: coll.GetFormatAttr('RES_UL_SPACE'), RES_PARATR_TABSTOP: coll.GetFormatAttr('RES_PARATR_TABSTOP') });
    applyPap(run?.grpprl, set, inherited);
    applyPap(prmGrpprl(piece(p.cpMark)), set, inherited);
    if (inList) lost.add('lists and numbering');
    if (p.breakBefore) set.RES_BREAK = 'page-before';
    if (p.tocId) set.RES_PARATR_TOX_ID = p.tocId;
    Object.assign(node.m_aSet, set);
    let s = '';
    const ranges: { start: number; end: number; attrs: SwCharAttrSet; key: string }[] = [];
    const anchors: { cp: number; pos: number }[] = [];
    for (const { ch, cp, field, fly, obj, note, link } of p.chars) {
      if (obj) { anchors.push({ cp, pos: s.length }); continue; }
      const crun = FindRun(chpRuns, fcOf(cp));
      const pc = piece(cp);
      const key = field || fly || note ? `object${cp}` : `${crun ? chpRuns.indexOf(crun) : -1}|${pc?.prm ?? 0}|${link ?? ''}`;
      const last = ranges[ranges.length - 1];
      if (last && last.key === key && last.end === s.length && !field && !fly && !note) last.end += ch.length;
      else {
        const attrs: SwCharAttrSet = {};
        const extra: { charStyle?: number } = {};
        applyChp(crun?.grpprl, attrs, (k) => coll.GetFormatAttr(k), extra);
        applyChp(prmGrpprl(pc), attrs, (k) => coll.GetFormatAttr(k), extra);
        if (extra.charStyle !== undefined && charFormats.has(extra.charStyle)) attrs.RES_TXTATR_CHARFMT = charFormats.get(extra.charStyle)!;
        if (field) attrs.RES_TXTATR_FIELD = field;
        if (fly) attrs.RES_TXTATR_FLYCNT = fly;
        if (note) attrs.RES_TXTATR_FTN = makeNote(note.endnote, note.index);
        if (link) { attrs.RES_TXTATR_INETFMT = link; if (p.tocId) attrs.RES_TXTATR_INETFMT_CHARFMT = doc.GetIndexLinkFormat(); }
        ranges.push({ start: s.length, end: s.length + ch.length, attrs, key });
      }
      s += ch;
    }
    node.InsertText(s, 0);
    for (const a of anchors) makeObject(a.cp, node, a.pos);
    for (const r of ranges) if (Object.keys(r.attrs).length && r.end > r.start) node.SetAttr(r.start, r.end, r.attrs);
    return node;
  };

  /** A BRC80 (4 bytes) or BRC (8 bytes) as a border line; null for none. */
  const brc = (op: Uint8Array, o: number, wide: boolean): SvxBorderLine | null => {
    const dpt = op[o + (wide ? 4 : 0)] ?? 0, type = op[o + (wide ? 5 : 1)] ?? 0;
    if (!type || type === 0xff || !dpt) return null;
    const color = wide ? (op[o + 3] === 0xff ? '#000000' : hex(op[o] ?? 0, op[o + 1] ?? 0, op[o + 2] ?? 0)) : (ICO[op[o + 2] ?? 0] ?? '#000000');
    // dptLineWidth is in eighths of a point; double lines (type 3) count twice.
    return { color, width: Math.max(1, Math.round((dpt * 20) / 8) * (type === 3 ? 3 : 1)) };
  };

  /**
   * WW8TabDesc: a table from the rows of paragraph records `rows` (each row's cells, the cells'
   * paragraphs, and the row end's PAPX with sprmTDefTable), before `before`.
   */
  const makeTable = (rows: { cells: Para[][]; grpprl: Uint8Array | undefined }[], before: SwNode) => {
    tables++;
    const first = rows[0]!;
    let centers: number[] = [];
    let jc = 0;
    ForEachSprm(first.grpprl ?? new Uint8Array(0), (id, op) => {
      if (id === 0xd608) { const n = op[0] ?? 0; centers = Array.from({ length: n + 1 }, (_, i) => s16(op, 1 + 2 * i)); }
      else if (id === 0x5400 || id === 0x548a) jc = u16(op) & 3; // sprmTJc90, sprmTJc
    });
    const left = centers[0] ?? 0, width = centers.length > 1 ? centers[centers.length - 1]! - left : 9000;
    const adjust: SwTableAdjust = jc === 1 ? 'center' : jc === 2 ? 'right' : 'left';
    const table = new SwTable({ name: doc.GetUniqueTableName(), adjust, width, leftSpace: adjust === 'left' ? left : 0, upper: 0, lower: 0 });
    const tableNode = new SwTableNode(nodes, table);
    tableNode.m_pStartOfSection = before.m_pStartOfSection;
    const at = before.GetIndex();
    nodes.Insert(tableNode, at);
    const tableEnd = new SwEndNode(nodes, tableNode);
    nodes.Insert(tableEnd, at + 1);
    const vmerge = new Map<number, { top: SwTableBox; covered: SwTableBox[] }>();
    const merges: { top: SwTableBox; covered: SwTableBox[] }[] = [];
    rows.forEach((row, ri) => {
      const line = new SwTableLine();
      table.m_aLines.push(line);
      let cx: number[] = centers, tcs: Uint8Array | undefined, gap = 108;
      let tblBorders: (SvxBorderLine | null)[] | undefined;
      const shd: (string | null)[] = [];
      const setBrc: { from: number; to: number; sides: number; line: SvxBorderLine | null }[] = [];
      const vAlign = new Map<number, number>();
      const vMergeOp = new Map<number, number>();
      ForEachSprm(row.grpprl ?? new Uint8Array(0), (id, op) => {
        switch (id) {
          case 0xd608: { const n = op[0] ?? 0; cx = Array.from({ length: n + 1 }, (_, i) => s16(op, 1 + 2 * i)); tcs = op.subarray(1 + 2 * (n + 1)); break; } // sprmTDefTable
          case 0x9602: gap = s16(op); break; // sprmTDxaGapHalf
          case 0x9407: { const h = s16(op); if (h > 0) line.m_aAttrs.minHeight = h; else if (h < 0) { line.m_aAttrs.minHeight = -h; line.m_aAttrs.fixHeight = true; } break; } // sprmTDyaRowHeight
          case 0x3404: if (op[0] && ri === table.m_nRowsToRepeat) table.m_nRowsToRepeat++; break; // sprmTTableHeader
          case 0x3403: case 0x3466: if (op[0]) line.m_aAttrs.cantSplit = true; break; // sprmTFCantSplit(90)
          case 0xd605: tblBorders = Array.from({ length: 6 }, (_, i) => brc(op, 4 * i, false)); break; // sprmTTableBorders80
          case 0xd613: tblBorders = Array.from({ length: 6 }, (_, i) => brc(op, 8 * i, true)); break; // sprmTTableBorders
          case 0xd609: for (let i = 0; 2 * i + 1 < op.length; i++) shd[i] = ICO[(u16(op, 2 * i) >> 5) & 0x1f] ?? null; break; // sprmTDefTableShd80
          case 0xd612: for (let i = 0; 10 * i + 9 < op.length; i++) shd[i] = op[10 * i + 7] === 0xff ? null : hex(op[10 * i + 4] ?? 0, op[10 * i + 5] ?? 0, op[10 * i + 6] ?? 0); break; // sprmTDefTableShd
          case 0xd620: setBrc.push({ from: op[0] ?? 0, to: op[1] ?? 0, sides: op[2] ?? 0, line: brc(op, 3, false) }); break; // sprmTSetBrc80
          case 0xd62f: setBrc.push({ from: op[0] ?? 0, to: op[1] ?? 0, sides: op[2] ?? 0, line: brc(op, 3, true) }); break; // sprmTSetBrc
          case 0xd62c: for (let i = op[0] ?? 0; i < (op[1] ?? 0); i++) vAlign.set(i, op[2] ?? 0); break; // sprmTVertAlign
          case 0xd62b: vMergeOp.set(op[0] ?? 0, op[1] ?? 0); break; // sprmTVertMerge
          default: break;
        }
      });
      const n = Math.max(0, cx.length - 1);
      let col = 0;
      row.cells.forEach((paras, ci) => {
        if (ci >= Math.max(n, 1) && n) { lost.add('tables with irregular rows (some cells are missing)'); return; }
        // TC80: grf (merges, vertical alignment), then four BRC80 borders.
        const tc = tcs && tcs.length >= 20 * (ci + 1) ? tcs.subarray(20 * ci, 20 * ci + 20) : undefined;
        const grf = tc ? u16(tc) : 0;
        const fMerged = !!(grf & 0x2), fVertMerge = !!(grf & 0x20) || (vMergeOp.get(ci) ?? 0) !== 0, fVertRestart = !!(grf & 0x40) || vMergeOp.get(ci) === 3;
        const w = n ? (cx[ci + 1] ?? cx[n]!) - (cx[ci] ?? 0) : width;
        if (fMerged && line.m_aBoxes.length) {
          // A horizontally merged cell: its width goes to the cell before.
          line.m_aBoxes[line.m_aBoxes.length - 1]!.m_aAttrs.width += w;
          col++;
          return;
        }
        const attrs = defaultBoxAttrs(Math.max(1, w), false);
        attrs.padding = Math.max(0, gap);
        const edge = (side: number, outer: boolean, tcAt: number): SvxBorderLine | null => {
          const own = tc ? brc(tc, tcAt, false) : null;
          let l = own ?? (tblBorders ? tblBorders[outer ? side : side === 0 || side === 2 ? 4 : 5] ?? null : null);
          for (const sb of setBrc) if (ci >= sb.from && ci < sb.to && sb.sides & [1, 2, 4, 8][side]!) l = sb.line;
          return l;
        };
        attrs.box = { top: edge(0, ri === 0, 4), left: edge(1, ci === 0, 8), bottom: edge(2, ri === rows.length - 1, 12), right: edge(3, ci === row.cells.length - 1, 16) } satisfies SvxBoxItem;
        if (shd[ci]) attrs.background = shd[ci]!;
        const va = vAlign.get(ci) ?? ((grf >> 7) & 3);
        if (va === 1) attrs.vertOrient = 'center'; else if (va === 2) attrs.vertOrient = 'bottom';
        if (grf & 0x4) attrs.frameDir = 'tb-rl';
        const box = new SwTableBox(line, attrs);
        const sn = new SwStartNode(nodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
        sn.m_pStartOfSection = tableNode;
        nodes.Insert(sn, tableEnd.GetIndex());
        const en = new SwEndNode(nodes, sn);
        nodes.Insert(en, tableEnd.GetIndex());
        box.m_pStartNode = sn;
        line.m_aBoxes.push(box);
        const merge = fVertMerge && !fVertRestart ? vmerge.get(col) : undefined;
        if (merge) {
          merge.top.setRowSpan(merge.top.getRowSpan() + 1);
          merge.covered.push(box);
          box.setRowSpan(-1);
          nodes.MakeTextNode(en.GetIndex(), standard);
        } else {
          vmerge.delete(col);
          if (fVertMerge) { const m2 = { top: box, covered: [] as SwTableBox[] }; vmerge.set(col, m2); merges.push(m2); }
          // The cell's paragraphs (their sprmPFInTable must not start another table).
          for (const q of paras) makePara(q, en);
          if (en.GetIndex() === sn.GetIndex() + 1) nodes.MakeTextNode(en.GetIndex(), standard);
        }
        col++;
      });
    });
    for (const { top, covered } of merges) covered.forEach((b, i) => b.setRowSpan(-(top.getRowSpan() - 1 - i)));
    if (!table.m_aLines.length || !table.m_aLines.some((l) => l.m_aBoxes.length)) nodes.Remove(tableNode.GetIndex(), tableEnd.GetIndex() - tableNode.GetIndex() + 1);
  };

  /** A row's floating table position (sprmTPc, sprmTDxaAbs, sprmTDyaAbs and the distances to the text). */
  const apoKey = (g: Uint8Array | undefined): string => {
    const k: string[] = [];
    if (g) ForEachSprm(g, (id, op) => { if ([0x360d, 0x940e, 0x940f, 0x9410, 0x9411, 0x941e, 0x941f].includes(id)) k.push(`${id}:${[...op].join(',')}`); });
    return k.join('|');
  };

  /** Paragraph records as paragraphs and tables before `before`; returns the first node of each record. */
  const buildBlocks = (paras: Para[], before: SwNode): { node: SwNode; cp: number }[] => {
    const firsts: { node: SwNode; cp: number }[] = [];
    let i = 0;
    while (i < paras.length) {
      const p = paras[i]!;
      const info = tableInfo(p.cpMark);
      if (!info.inTable) {
        const node = makePara(p, before);
        firsts.push({ node, cp: p.chars[0]?.cp ?? p.cpMark });
        i++;
        continue;
      }
      // Rows up to the last row end of this table level.
      const rows: { cells: Para[][]; grpprl: Uint8Array | undefined }[] = [];
      let cell: Para[] = [], cells: Para[][] = [];
      const startCp = p.chars[0]?.cp ?? p.cpMark;
      let rowStart = i;
      while (i < paras.length) {
        const q = paras[i]!;
        const qi = tableInfo(q.cpMark);
        if (!qi.inTable) break;
        i++;
        if (qi.itap > 1) {
          // Nested tables are kept as paragraphs of the outer cell.
          lost.add('nested tables (their cells are kept as paragraphs)');
          if (!qi.innerTtp) cell.push(q);
          continue;
        }
        if (q.mark === 'cell' && qi.ttp) {
          // InEqualApo, reduced: a row positioned differently (another floating table) starts a new table.
          if (rows.length && apoKey(qi.grpprl) !== apoKey(rows[rows.length - 1]!.grpprl)) { i = rowStart; cells = []; cell = []; break; }
          rows.push({ cells, grpprl: qi.grpprl }); cells = []; cell = []; rowStart = i; continue;
        }
        cell.push(q);
        if (q.mark === 'cell') { cells.push(cell); cell = []; }
      }
      if (cells.length || cell.length) rows.push({ cells: cell.length ? [...cells, cell] : cells, grpprl: rows[rows.length - 1]?.grpprl });
      const startIdx = before.GetIndex();
      if (rows.length) makeTable(rows, before);
      firsts.push({ node: nodes.node(startIdx), cp: startCp });
    }
    return firsts;
  };

  // The main text in the body, after which the new document's empty paragraph goes.
  const initial = nodes.FirstTextNode();
  const mainParas = parseRange(0, fib.ccpText);
  const firsts = buildBlocks(mainParas, nodes.GetEndOfContent());
  if (firsts.length) nodes.Remove(initial.GetIndex());
  if (tables) lost.delete('tables (their cells are kept as paragraphs)');

  // Sections (SwWW8ImplReader::CreateSep): page size, margins, the header and footer distances,
  // headers and footers; the first section's page style is the default one, each further one a
  // page style of its own.
  const hdd = ReadHdd(table, fib);
  const hdrStart = fib.ccpText + fib.ccpFtn;
  const facingPages = fib.lcbDop > 0 && !!(table.u8(fib.fcDop) & 1); // DOP fFacingPages
  /** A section's stories by kind; an empty one is the previous section's (Word's link to previous). */
  let prevStories: ([number, number] | null)[] = [null, null, null, null, null, null];
  sections.forEach((sec, k) => {
    const pd = k === 0 ? doc.m_aPageDesc : doc.MakePageDesc(`Converted${k}`, new SwPageDesc());
    let w = 12240, h = 15840, l = 1800, r = 1800, t = 1440, b = 1440, bkc = 2, pgnStart: number | null = null, restart = false;
    let hdrTop = 720, hdrBottom = 720, titlePg = false;
    ForEachSprm(sec.grpprl, (id, op) => {
      switch (id) {
        case 0xb01f: w = u16(op); break; // sprmSXaPage
        case 0xb020: h = u16(op); break; // sprmSYaPage
        case 0xb021: l = u16(op); break; // sprmSDxaLeft
        case 0xb022: r = u16(op); break; // sprmSDxaRight
        case 0x9023: t = Math.abs(s16(op)); break; // sprmSDyaTop
        case 0x9024: b = Math.abs(s16(op)); break; // sprmSDyaBottom
        case 0xb017: hdrTop = u16(op); break; // sprmSDyaHdrTop
        case 0xb018: hdrBottom = u16(op); break; // sprmSDyaHdrBottom
        case 0x300a: titlePg = !!op[0]; break; // sprmSFTitlePage
        case 0x3009: bkc = op[0] ?? 2; break; // sprmSBkc
        case 0x501c: pgnStart = u16(op); break; // sprmSPgnStart97
        case 0x3011: restart = !!op[0]; break; // sprmSFPgnRestart
        default: break;
      }
    });
    Object.assign(pd, { nWidth: w, nHeight: h, nLeft: l, nRight: r, nTop: t, nBottom: b });
    // Stories: even header, odd header, even footer, odd footer, first header, first footer.
    const stories = prevStories.map((prev, j) => {
      const s = hdd[6 + 6 * k + j];
      return s && s[1] > s[0] ? s : prev;
    });
    prevStories = stories;
    const variants: [number, SwStartNodeType, string, SwAreaKind][] = [
      [1, SwStartNodeType.SwHeaderStartNode, 'Header', 'default'], [3, SwStartNodeType.SwFooterStartNode, 'Footer', 'default'],
      [4, SwStartNodeType.SwHeaderStartNode, 'Header', 'first'], [5, SwStartNodeType.SwFooterStartNode, 'Footer', 'first'],
      [0, SwStartNodeType.SwHeaderStartNode, 'Header', 'left'], [2, SwStartNodeType.SwFooterStartNode, 'Footer', 'left'],
    ];
    const done = new Set<SwStartNodeType>();
    for (const [j, eTyp, coll, kind] of variants) {
      if ((kind === 'first' && !titlePg) || (kind === 'left' && !facingPages)) continue;
      const story = stories[j];
      if (!story) continue;
      // A story's last paragraph mark ends the story (Word writes one more after the last story).
      const paras = parseRange(hdrStart + story[0], hdrStart + story[1]);
      if (!paras.length) continue;
      if (kind !== 'default' && !nodes.FindAreaSection(eTyp, 'default', pd.m_aName)) nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!, 'default', pd.m_aName);
      const area = nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!, kind, pd.m_aName);
      const placeholder = nodes.GoNext(area.GetIndex())!;
      buildBlocks(paras, area.EndOfSectionNode());
      if (area.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
      // SectionPropertyMap::PrepareHeaderFooterProperties: the margin holds the header or footer.
      if (done.has(eTyp)) continue;
      done.add(eTyp);
      if (eTyp === SwStartNodeType.SwHeaderStartNode) { pd.nHeaderMinHeight = Math.max(0, t - hdrTop); pd.nHeaderSpacing = 0; pd.nTop = hdrTop; pd.bHeaderEatSpacing = true; }
      else { pd.nFooterMinHeight = Math.max(0, b - hdrBottom); pd.nFooterSpacing = 0; pd.nBottom = hdrBottom; pd.bFooterEatSpacing = true; }
    }
    if (k === 0) {
      // The first section's page numbers may start elsewhere than 1 (sprmSFPgnRestart).
      if (restart && pgnStart !== null && firsts[0]) {
        const pdAttr = { name: pd.m_aName, numOffset: pgnStart };
        if (firsts[0].node.IsTableNode()) (firsts[0].node as SwTableNode).m_pTable.GetFrameFormat().pageDesc = pdAttr;
        else if (firsts[0].node.IsTextNode()) (firsts[0].node as SwTextNode).m_aSet.RES_PAGEDESC = pdAttr;
      }
      return;
    }
    // A continuous section break (bkc 0) keeps the page; the page style waits for the next page.
    if (bkc === 0) return;
    const start = firsts.find((p) => p.cp >= sections[k - 1]!.cpEnd);
    if (!start) return;
    const pdAttr = { name: pd.m_aName, numOffset: restart ? pgnStart ?? 1 : null };
    if (start.node.IsTableNode()) (start.node as SwTableNode).m_pTable.GetFrameFormat().pageDesc = pdAttr;
    else if (start.node.IsTextNode()) (start.node as SwTextNode).m_aSet.RES_PAGEDESC = pdAttr;
  });
  if (!sections.length) Object.assign(doc.m_aPageDesc, { nWidth: 12240, nHeight: 15840, nLeft: 1800, nRight: 1800, nTop: 1440, nBottom: 1440 });

  // Word layout, as for DOCX.
  doc.m_bTabOverSpacing = true;
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}
