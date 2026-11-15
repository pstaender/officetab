// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/pagesettings.cxx reduced
// @upstream filter/source/msfilter/util.cxx partial
// PageSettings: a sheet's printOptions, pageMargins, pageSetup and headerFooter, converted
// (PageSettingsConverter) into the page style "PageStyle_<sheet name>" that the sheet uses, with
// the HeaderFooterParser for Excel's header and footer codes (&L &C &R, &P &N &A &F &Z &D &T,
// font name, style, size, colour and the bold, italic, underline, strikeout, super- and subscript,
// outline and shadow toggles). Reduced: the property sets become page style items directly; the
// header and footer runs carry only the attributes that differ from the default font; the
// background picture of the sheet (picture) and the printer settings part are not imported
// (reported by the caller); the BIFF12 records are not read. From msfilter/util.cxx the paper
// size table (PaperSizeConv) is ported.
import { EditTextObject, type EditCharAttribs, type EditParagraph, type SvxFieldKind } from '../../../../editeng/source/editeng/editobj.ts';
import type { ScItemSet, ScPageHFItem, ScPageHFSetItem } from '../../../inc/scitems.ts';
import { SC_POOL_DEFAULTS } from '../../../inc/scitems.ts';
import type { AttributeList } from '../../../../oox/source/helper/attributelist.ts';
import { SfxStyleFamily } from '../../../inc/stlsheet.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { Font, newFontModel, XlsColor, type FontModel, type StylesBuffer } from './stylesbuffer.ts';

const OOX_MARGIN_DEFAULT_LR = 0.748; /// Left/right default margin in inches.
const OOX_MARGIN_DEFAULT_TB = 0.984; /// Top/bottom default margin in inches.
const OOX_MARGIN_DEFAULT_HF = 0.512; /// Header/footer default margin in inches.

const IN2MM100 = (v: number) => Math.trunc(v * 2540 + 0.5);
const MM2MM100 = (v: number) => Math.trunc(v * 100 + 0.5);
/** mm100 to twips (o3tl::convert) */
export const mm100ToTwip = (n: number) => Math.round((n * 72) / 127);
/** inches to 1/100 mm, rounded */
const inToMm100 = (f: number) => Math.round(f * 2540);

// see XclPaperSize pPaperSizeTable in calc and aDinTab in i18nutil
const spPaperSizeTable: readonly [number, number][] = [
  [0, 0], //  0 - (undefined)
  [IN2MM100(8.5), IN2MM100(11)], //  1 - Letter paper
  [IN2MM100(8.5), IN2MM100(11)], //  2 - Letter small paper
  [IN2MM100(11), IN2MM100(17)], //  3 - Tabloid paper
  [IN2MM100(17), IN2MM100(11)], //  4 - Ledger paper
  [IN2MM100(8.5), IN2MM100(14)], //  5 - Legal paper
  [IN2MM100(5.5), IN2MM100(8.5)], //  6 - Statement paper
  [IN2MM100(7.25), IN2MM100(10.5)], //  7 - Executive paper
  [MM2MM100(297), MM2MM100(420)], //  8 - A3 paper
  [MM2MM100(210), MM2MM100(297)], //  9 - A4 paper
  [MM2MM100(210), MM2MM100(297)], // 10 - A4 small paper
  [MM2MM100(148), MM2MM100(210)], // 11 - A5 paper
  [MM2MM100(257), MM2MM100(364)], // 12 - B4 (JIS) paper
  [MM2MM100(182), MM2MM100(257)], // 13 - B5 (JIS) paper
  [IN2MM100(8.5), IN2MM100(13)], // 14 - Folio paper
  [MM2MM100(215), MM2MM100(275)], // 15 - Quarto paper
  [IN2MM100(10), IN2MM100(14)], // 16 - Standard paper
  [IN2MM100(11), IN2MM100(17)], // 17 - Standard paper
  [IN2MM100(8.5), IN2MM100(11)], // 18 - Note paper
  [IN2MM100(3.875), IN2MM100(8.875)], // 19 - #9 envelope
  [IN2MM100(4.125), IN2MM100(9.5)], // 20 - #10 envelope
  [IN2MM100(4.5), IN2MM100(10.375)], // 21 - #11 envelope
  [IN2MM100(4.75), IN2MM100(11)], // 22 - #12 envelope
  [IN2MM100(5), IN2MM100(11.5)], // 23 - #14 envelope
  [IN2MM100(17), IN2MM100(22)], // 24 - C paper
  [IN2MM100(22), IN2MM100(34)], // 25 - D paper
  [IN2MM100(34), IN2MM100(44)], // 26 - E paper
  [MM2MM100(110), MM2MM100(220)], // 27 - DL envelope
  [MM2MM100(162), MM2MM100(229)], // 28 - C5 envelope
  [MM2MM100(324), MM2MM100(458)], // 29 - C3 envelope
  [MM2MM100(229), MM2MM100(324)], // 30 - C4 envelope
  [MM2MM100(114), MM2MM100(162)], // 31 - C6 envelope
  [MM2MM100(114), MM2MM100(229)], // 32 - C65 envelope
  [MM2MM100(250), MM2MM100(353)], // 33 - B4 envelope
  [MM2MM100(176), MM2MM100(250)], // 34 - B5 envelope
  [MM2MM100(176), MM2MM100(125)], // 35 - B6 envelope
  [MM2MM100(110), MM2MM100(230)], // 36 - Italy envelope
  [IN2MM100(3.875), IN2MM100(7.5)], // 37 - Monarch envelope
  [IN2MM100(3.625), IN2MM100(6.5)], // 38 - 6 3/4 envelope
  [IN2MM100(14.875), IN2MM100(11)], // 39 - US standard fanfold
  [IN2MM100(8.5), IN2MM100(12)], // 40 - German standard fanfold
  [IN2MM100(8.5), IN2MM100(13)], // 41 - German legal fanfold
  [MM2MM100(250), MM2MM100(353)], // 42 - ISO B4
  [MM2MM100(200), MM2MM100(148)], // 43 - Japanese double postcard
  [IN2MM100(9), IN2MM100(11)], // 44 - Standard paper
  [IN2MM100(10), IN2MM100(11)], // 45 - Standard paper
  [IN2MM100(15), IN2MM100(11)], // 46 - Standard paper
  [MM2MM100(220), MM2MM100(220)], // 47 - Invite envelope
  [0, 0], // 48 - (undefined)
  [0, 0], // 49 - (undefined)
  [IN2MM100(9.5), IN2MM100(12)], // 50 - Letter extra paper
  [IN2MM100(9.5), IN2MM100(15)], // 51 - Legal extra paper
  [IN2MM100(11.69), IN2MM100(18)], // 52 - Tabloid extra paper
  [MM2MM100(235), MM2MM100(322)], // 53 - A4 extra paper
  [IN2MM100(8.5), IN2MM100(11)], // 54 - Letter transverse paper
  [MM2MM100(210), MM2MM100(297)], // 55 - A4 transverse paper
  [IN2MM100(9.5), IN2MM100(12)], // 56 - Letter extra transverse paper
  [MM2MM100(227), MM2MM100(356)], // 57 - SuperA/SuperA/A4 paper
  [MM2MM100(305), MM2MM100(487)], // 58 - SuperB/SuperB/A3 paper
  [IN2MM100(8.5), IN2MM100(12.69)], // 59 - Letter plus paper
  [MM2MM100(210), MM2MM100(330)], // 60 - A4 plus paper
  [MM2MM100(148), MM2MM100(210)], // 61 - A5 transverse paper
  [MM2MM100(182), MM2MM100(257)], // 62 - JIS B5 transverse paper
  [MM2MM100(322), MM2MM100(445)], // 63 - A3 extra paper
  [MM2MM100(174), MM2MM100(235)], // 64 - A5 extra paper
  [MM2MM100(201), MM2MM100(276)], // 65 - ISO B5 extra paper
  [MM2MM100(420), MM2MM100(594)], // 66 - A2 paper
  [MM2MM100(297), MM2MM100(420)], // 67 - A3 transverse paper
  [MM2MM100(322), MM2MM100(445)], // 68 - A3 extra transverse paper
  [MM2MM100(200), MM2MM100(148)], // 69 - Japanese double postcard
  [MM2MM100(105), MM2MM100(148)], // 70 - A6 paper
  [0, 0], // 71 - Japanese Envelope Kaku #2
  [0, 0], // 72 - Japanese Envelope Kaku #3
  [0, 0], // 73 - Japanese Envelope Chou #3
  [0, 0], // 74 - Japanese Envelope Chou #4
  [IN2MM100(11), IN2MM100(8.5)], // 75 - Letter Rotated
  [MM2MM100(420), MM2MM100(297)], // 76 - A3 Rotated
  [MM2MM100(297), MM2MM100(210)], // 77 - A4 Rotated
  [MM2MM100(210), MM2MM100(148)], // 78 - A5 Rotated
  [MM2MM100(364), MM2MM100(257)], // 79 - B4 (JIS) Rotated
  [MM2MM100(257), MM2MM100(182)], // 80 - B5 (JIS) Rotated
  [MM2MM100(148), MM2MM100(100)], // 81 - Japanese Postcard Rotated
  [MM2MM100(148), MM2MM100(200)], // 82 - Double Japanese Postcard Rotated
  [MM2MM100(148), MM2MM100(105)], // 83 - A6 Rotated
  [0, 0], // 84 - Japanese Envelope Kaku #2 Rotated
  [0, 0], // 85 - Japanese Envelope Kaku #3 Rotated
  [0, 0], // 86 - Japanese Envelope Chou #3 Rotated
  [0, 0], // 87 - Japanese Envelope Chou #4 Rotated
  [MM2MM100(128), MM2MM100(182)], // 88 - B6 (JIS)
  [MM2MM100(182), MM2MM100(128)], // 89 - B6 (JIS) Rotated
  [IN2MM100(12), IN2MM100(11)], // 90 - 12x11
];

/** PaperSizeConv::getMSPaperSizeIndex: the best matching paper index for a size in 1/100 mm. */
export function getMSPaperSizeIndex(nWidth: number, nHeight: number): number {
  // Need to find the best match for current size
  let nDeltaWidth = nWidth;
  let nDeltaHeight = nHeight;
  const nTol = 10; // hmm not sure is this the best way
  let nPaperSizeIndex = 0; // Undefined
  for (let i = 1; i < spPaperSizeTable.length; ++i) {
    const nCurDeltaHeight = Math.abs(spPaperSizeTable[i]![1] - nHeight);
    const nCurDeltaWidth = Math.abs(spPaperSizeTable[i]![0] - nWidth);
    if (nCurDeltaWidth <= nTol && nCurDeltaHeight <= nTol && nCurDeltaWidth + nCurDeltaHeight < nDeltaWidth + nDeltaHeight) {
      nDeltaWidth = nCurDeltaWidth;
      nDeltaHeight = nCurDeltaHeight;
      nPaperSizeIndex = i;
    }
  }
  return nPaperSizeIndex;
}

/** PaperSizeConv::getApiSizeForMSPaperSizeIndex, 1/100 mm */
export function getApiSizeForMSPaperSizeIndex(nMSOPaperIndex: number): [number, number] {
  if (nMSOPaperIndex < 0 || nMSOPaperIndex >= spPaperSizeTable.length) nMSOPaperIndex = 0;
  return spPaperSizeTable[nMSOPaperIndex]!;
}

export interface PageSettingsModel {
  mfLeftMargin: number; mfRightMargin: number; mfTopMargin: number; mfBottomMargin: number; mfHeaderMargin: number; mfFooterMargin: number;
  mnPaperSize: number; mnPaperWidth: number; mnPaperHeight: number; mnScale: number; mnFirstPage: number; mnFitToWidth: number; mnFitToHeight: number;
  mnOrientation: string; mnPageOrder: string; mnCellComments: string;
  maOddHeader: string; maOddFooter: string; maEvenHeader: string; maEvenFooter: string; maFirstHeader: string; maFirstFooter: string;
  mbUseEvenHF: boolean; mbUseFirstHF: boolean; mbValidSettings: boolean; mbUseFirstPage: boolean;
  mbFitToPages: boolean; mbHorCenter: boolean; mbVerCenter: boolean; mbPrintGrid: boolean; mbPrintHeadings: boolean;
}

export const newPageSettingsModel = (): PageSettingsModel => ({
  mfLeftMargin: OOX_MARGIN_DEFAULT_LR, mfRightMargin: OOX_MARGIN_DEFAULT_LR, mfTopMargin: OOX_MARGIN_DEFAULT_TB, mfBottomMargin: OOX_MARGIN_DEFAULT_TB,
  mfHeaderMargin: OOX_MARGIN_DEFAULT_HF, mfFooterMargin: OOX_MARGIN_DEFAULT_HF, mnPaperSize: 1, mnPaperWidth: 0, mnPaperHeight: 0, mnScale: 100,
  mnFirstPage: 1, mnFitToWidth: 1, mnFitToHeight: 1, mnOrientation: 'default', mnPageOrder: 'downThenOver', mnCellComments: 'none',
  maOddHeader: '', maOddFooter: '', maEvenHeader: '', maEvenFooter: '', maFirstHeader: '', maFirstFooter: '',
  mbUseEvenHF: false, mbUseFirstHF: false, mbValidSettings: true, mbUseFirstPage: false, mbFitToPages: false,
  mbHorCenter: false, mbVerCenter: false, mbPrintGrid: false, mbPrintHeadings: false,
});

/** sax::Converter::convertMeasure of paperWidth/paperHeight ("210mm", "8.5in"), 1/100 mm. */
function convertMeasure(s: string | undefined): number {
  const m = /^\s*([0-9.]+)\s*(mm|cm|in|pt|pc)?\s*$/.exec(s ?? '');
  if (!m) return 0;
  const f = parseFloat(m[1]!);
  switch (m[2]) {
    case 'cm': return Math.round(f * 1000);
    case 'in': return Math.round(f * 2540);
    case 'pt': return Math.round((f * 2540) / 72);
    case 'pc': return Math.round((f * 2540) / 6);
    default: return Math.round(f * 100);
  }
}

export class PageSettings {
  maModel = newPageSettingsModel();

  importPrintOptions(rAttribs: AttributeList): void {
    this.maModel.mbHorCenter = rAttribs.getBool('horizontalCentered', false);
    this.maModel.mbVerCenter = rAttribs.getBool('verticalCentered', false);
    this.maModel.mbPrintGrid = rAttribs.getBool('gridLines', false);
    this.maModel.mbPrintHeadings = rAttribs.getBool('headings', false);
  }

  importPageMargins(rAttribs: AttributeList): void {
    this.maModel.mfLeftMargin = rAttribs.getDouble('left', OOX_MARGIN_DEFAULT_LR);
    this.maModel.mfRightMargin = rAttribs.getDouble('right', OOX_MARGIN_DEFAULT_LR);
    this.maModel.mfTopMargin = rAttribs.getDouble('top', OOX_MARGIN_DEFAULT_TB);
    this.maModel.mfBottomMargin = rAttribs.getDouble('bottom', OOX_MARGIN_DEFAULT_TB);
    this.maModel.mfHeaderMargin = rAttribs.getDouble('header', OOX_MARGIN_DEFAULT_HF);
    this.maModel.mfFooterMargin = rAttribs.getDouble('footer', OOX_MARGIN_DEFAULT_HF);
  }

  importPageSetup(rAttribs: AttributeList): void {
    this.maModel.mnPaperSize = rAttribs.getInteger('paperSize', 1);
    this.maModel.mnPaperWidth = convertMeasure(rAttribs.getString('paperWidth', ''));
    this.maModel.mnPaperHeight = convertMeasure(rAttribs.getString('paperHeight', ''));
    this.maModel.mnScale = rAttribs.getInteger('scale', 100);
    this.maModel.mnFirstPage = rAttribs.getInteger('firstPageNumber', 1);
    this.maModel.mnFitToWidth = rAttribs.getInteger('fitToWidth', 1);
    this.maModel.mnFitToHeight = rAttribs.getInteger('fitToHeight', 1);
    this.maModel.mnOrientation = rAttribs.getToken('orientation', 'default');
    this.maModel.mnPageOrder = rAttribs.getToken('pageOrder', 'downThenOver');
    this.maModel.mnCellComments = rAttribs.getToken('cellComments', 'none');
    this.maModel.mbValidSettings = rAttribs.getBool('usePrinterDefaults', false);
    this.maModel.mbUseFirstPage = rAttribs.getBool('useFirstPageNumber', false);
  }

  importHeaderFooter(rAttribs: AttributeList): void {
    this.maModel.mbUseEvenHF = rAttribs.getBool('differentOddEven', false);
    this.maModel.mbUseFirstHF = rAttribs.getBool('differentFirst', false);
  }

  importHeaderFooterCharacters(rChars: string, nElement: string): void {
    switch (nElement) {
      case 'oddHeader': this.maModel.maOddHeader += rChars; break;
      case 'oddFooter': this.maModel.maOddFooter += rChars; break;
      case 'evenHeader': this.maModel.maEvenHeader += rChars; break;
      case 'evenFooter': this.maModel.maEvenFooter += rChars; break;
      case 'firstHeader': this.maModel.maFirstHeader += rChars; break;
      case 'firstFooter': this.maModel.maFirstFooter += rChars; break;
    }
  }

  setFitToPagesMode(bFitToPages: boolean): void { this.maModel.mbFitToPages = bFitToPages; }

  /** finalizeImport: create the sheet's page style and set it. */
  finalizeImport(rDoc: ScDocument, nTab: number, rStyles: StylesBuffer): void {
    const aStyleName = `PageStyle_${rDoc.GetName(nTab) ?? String(nTab + 1)}`;
    const rPool = rDoc.GetStyleSheetPool();
    // createStyleObject( aStyleName, true ): a new style replaces one of the same name
    const pOld = rPool.Find(aStyleName, SfxStyleFamily.Page);
    if (pOld) rPool.Remove(pOld);
    const xStyle = rPool.Make(aStyleName, SfxStyleFamily.Page);
    xStyle.SetItemSet(new PageSettingsConverter(rStyles).writePageSettingsProperties(this.maModel));
    // Set page style name to the sheet.
    rDoc.SetPageStyle(nTab, aStyleName);
  }
}

// HeaderFooterParser ---------------------------------------------------------

const HF_LEFT = 0, HF_CENTER = 1, HF_RIGHT = 2;

/** The text a field shows when it is read or written (as stlpool's HFText). */
export const HF_FIELD_TEXT: Record<SvxFieldKind, string> = { PAGE: '1', PAGES: '99', TABLE: '???', DATE: '00/00/0000', TIME: '00:00:00', FILE: '???', TITLE: '???' };

interface HFPortionInfo { maParas: EditParagraph[]; mnStart: number; mfTotalHeight: number; mfCurrHeight: number }

// different names for bold font style (lowercase)
const sppcBoldNames = ['bold', 'fett', 'demibold', 'halbfett', 'black', 'heavy', 'félkövér'];
// different names for italic font style (lowercase)
const sppcItalicNames = ['italic', 'kursiv', 'oblique', 'schräg', 'dőlt'];

export class HeaderFooterParser {
  private maPortions: HFPortionInfo[] = [];
  private meCurrPortion = HF_CENTER;
  private maBuffer = '';
  private maFontModel: FontModel = newFontModel();
  private readonly mrStyles: StylesBuffer;

  constructor(rStyles: StylesBuffer) { this.mrStyles = rStyles; }

  /** Parses the passed string and creates the header/footer contents; returns the contents
      and the total height of the converted header or footer in points. */
  parse(rData: string): { aItem: ScPageHFItem; fHeight: number } {
    this.maPortions = [0, 1, 2].map(() => ({ maParas: [{ aText: '', maCharAttribs: [] }], mnStart: 0, mfTotalHeight: 0, mfCurrHeight: 0 }));
    this.meCurrPortion = HF_CENTER;
    this.maBuffer = '';
    this.maFontModel = { ...this.mrStyles.getDefaultFontModel() };

    let aFontName = ''; // current font name
    let aFontStyle = ''; // current font style
    let nFontHeight = 0; // current font height

    /** State of the parser. */
    const STATE_TEXT = 0, STATE_TOKEN = 1, STATE_FONTNAME = 2, STATE_FONTSTYLE = 3, STATE_FONTHEIGHT = 4;
    let eState = STATE_TEXT;

    for (let i = 0; i < rData.length && rData[i] !== '\u0000'; ++i) {
      let cChar = rData[i]!;
      switch (eState) {
        case STATE_TEXT:
          switch (cChar) {
            case '&': // new token
              this.appendText();
              eState = STATE_TOKEN;
              break;
            case '\n': // line break
              this.appendText();
              this.appendLineBreak();
              break;
            default:
              this.maBuffer += cChar;
          }
          break;
        case STATE_TOKEN:
          // default: back to text mode, may be changed in specific cases
          eState = STATE_TEXT;
          // ignore case of token codes
          if (cChar >= 'a' && cChar <= 'z') cChar = cChar.toUpperCase();
          switch (cChar) {
            case '&': this.maBuffer += cChar; break; // the '&' character
            case 'L': this.setNewPortion(HF_LEFT); break; // left portion
            case 'C': this.setNewPortion(HF_CENTER); break; // center portion
            case 'R': this.setNewPortion(HF_RIGHT); break; // right portion
            case 'P': this.appendField('PAGE'); break; // page number
            case 'N': this.appendField('PAGES'); break; // total page count
            case 'A': this.appendField('TABLE'); break; // current sheet name
            case 'F': this.appendField('FILE'); break; // file name
            case 'Z': // file path (without file name), OOXML, BIFF12, and BIFF8 only
              this.appendField('FILE');
              /*  path only is not supported -- if we find a '&Z&F'
                  combination for path/name, skip the '&F' part */
              if ((i + 2 < rData.length) && (rData[i + 1] === '&') && ((rData[i + 2] === 'f') || (rData[i + 2] === 'F'))) i += 2;
              break;
            case 'D': this.appendField('DATE'); break; // date
            case 'T': this.appendField('TIME'); break; // time
            case 'B': this.setAttributes(); this.maFontModel.mbBold = !this.maFontModel.mbBold; break; // bold
            case 'I': this.setAttributes(); this.maFontModel.mbItalic = !this.maFontModel.mbItalic; break; // italic
            case 'U': // underline
              this.setAttributes();
              this.maFontModel.mnUnderline = (this.maFontModel.mnUnderline === 'single') ? 'none' : 'single';
              break;
            case 'E': // double underline
              this.setAttributes();
              this.maFontModel.mnUnderline = (this.maFontModel.mnUnderline === 'double') ? 'none' : 'double';
              break;
            case 'S': this.setAttributes(); this.maFontModel.mbStrikeout = !this.maFontModel.mbStrikeout; break; // strikeout
            case 'X': // superscript
              this.setAttributes();
              this.maFontModel.mnEscapement = (this.maFontModel.mnEscapement === 'superscript') ? 'baseline' : 'superscript';
              break;
            case 'Y': // subscript
              this.setAttributes();
              this.maFontModel.mnEscapement = (this.maFontModel.mnEscapement === 'subscript') ? 'baseline' : 'subscript';
              break;
            case 'O': this.setAttributes(); this.maFontModel.mbOutline = !this.maFontModel.mbOutline; break; // outlined
            case 'H': this.setAttributes(); this.maFontModel.mbShadow = !this.maFontModel.mbShadow; break; // shadow
            case 'K': // text color (not in BIFF)
              if (i + 6 < rData.length) {
                this.setAttributes();
                // eat the following 6 characters
                this.convertFontColor(rData.slice(i + 1, i + 7));
                i += 6;
              }
              break;
            case '"': // font name
              aFontName = '';
              aFontStyle = '';
              eState = STATE_FONTNAME;
              break;
            default:
              if (cChar >= '0' && cChar <= '9') { // font size
                nFontHeight = cChar.charCodeAt(0) - 48;
                eState = STATE_FONTHEIGHT;
              }
          }
          break;
        case STATE_FONTNAME:
          switch (cChar) {
            case '"':
              this.setAttributes();
              this.convertFontName(aFontName);
              aFontName = '';
              eState = STATE_TEXT;
              break;
            case ',':
              eState = STATE_FONTSTYLE;
              break;
            default:
              aFontName += cChar;
          }
          break;
        case STATE_FONTSTYLE:
          switch (cChar) {
            case '"':
              this.setAttributes();
              this.convertFontName(aFontName);
              aFontName = '';
              this.convertFontStyle(aFontStyle);
              aFontStyle = '';
              eState = STATE_TEXT;
              break;
            default:
              aFontStyle += cChar;
          }
          break;
        case STATE_FONTHEIGHT:
          if (cChar >= '0' && cChar <= '9') {
            if (nFontHeight >= 0) {
              nFontHeight *= 10;
              nFontHeight += cChar.charCodeAt(0) - 48;
              if (nFontHeight > 1000) nFontHeight = -1;
            }
          } else {
            if (nFontHeight > 0) {
              this.setAttributes();
              this.maFontModel.mfHeight = nFontHeight;
            }
            --i;
            eState = STATE_TEXT;
          }
          break;
      }
    }

    // finalize
    this.finalizePortion();
    for (const p of [HF_LEFT, HF_CENTER, HF_RIGHT]) this.maPortions[p]!.mfTotalHeight += this.getCurrHeight(p);
    const fHeight = Math.max(this.maPortions[HF_LEFT]!.mfTotalHeight, this.maPortions[HF_CENTER]!.mfTotalHeight, this.maPortions[HF_RIGHT]!.mfTotalHeight);
    const area = (p: number) => {
      const paras = this.maPortions[p]!.maParas;
      return paras.length === 1 && !paras[0]!.aText ? new EditTextObject() : new EditTextObject(paras);
    };
    return { aItem: { pLeftArea: area(HF_LEFT), pCenterArea: area(HF_CENTER), pRightArea: area(HF_RIGHT) }, fHeight };
  }

  private getPortion(): HFPortionInfo { return this.maPortions[this.meCurrPortion]!; }
  private lastPara(): EditParagraph { const p = this.getPortion().maParas; return p[p.length - 1]!; }

  private getCurrHeight(ePortion: number): number {
    const fMaxHt = this.maPortions[ePortion]!.mfCurrHeight;
    return (fMaxHt === 0.0) ? this.maFontModel.mfHeight : fMaxHt;
  }

  private updateCurrHeight(): void {
    const p = this.getPortion();
    p.mfCurrHeight = Math.max(p.mfCurrHeight, this.maFontModel.mfHeight);
  }

  /** setAttributes: the current font for the text since the last change (as far as it differs
      from the default font). */
  private setAttributes(): void {
    const p = this.getPortion();
    const para = this.lastPara();
    if (p.mnStart < para.aText.length) {
      const aFont = new Font(this.mrStyles, false, this.maFontModel);
      aFont.finalizeImport();
      const aDef = new Font(this.mrStyles, false, this.mrStyles.getDefaultFontModel());
      aDef.finalizeImport();
      const a = aFont.fillToEditAttribs(), d = aDef.fillToEditAttribs();
      const out: EditCharAttribs = {};
      for (const k of Object.keys(a) as (keyof EditCharAttribs)[]) if (a[k] !== d[k]) (out as Record<string, unknown>)[k] = a[k];
      if (Object.keys(out).length) {
        // fields keep their own run: put the attributes on each run in the range
        let nPos = p.mnStart;
        for (const r of para.maCharAttribs.filter((x) => x.aAttribs.FIELD && x.nStart >= p.mnStart).sort((x, y) => x.nStart - y.nStart)) {
          if (r.nStart > nPos) para.maCharAttribs.push({ nStart: nPos, nEnd: r.nStart, aAttribs: { ...out } });
          Object.assign(r.aAttribs, out);
          nPos = r.nEnd;
        }
        if (nPos < para.aText.length) para.maCharAttribs.push({ nStart: nPos, nEnd: para.aText.length, aAttribs: { ...out } });
        para.maCharAttribs.sort((x, y) => x.nStart - y.nStart);
      }
    }
    p.mnStart = para.aText.length;
  }

  /** Appends and clears internal string buffer. */
  private appendText(): void {
    if (this.maBuffer) {
      this.lastPara().aText += this.maBuffer;
      this.maBuffer = '';
      this.updateCurrHeight();
    }
  }

  /** Appends a line break and adjusts internal text height data. */
  private appendLineBreak(): void {
    this.setAttributes();
    const p = this.getPortion();
    p.maParas.push({ aText: '', maCharAttribs: [] });
    p.mnStart = 0;
    p.mfTotalHeight += this.getCurrHeight(this.meCurrPortion); // add the current line height.
    p.mfCurrHeight = 0;
  }

  private appendField(eKind: SvxFieldKind): void {
    const para = this.lastPara();
    const t = HF_FIELD_TEXT[eKind];
    para.maCharAttribs.push({ nStart: para.aText.length, nEnd: para.aText.length + t.length, aAttribs: { FIELD: eKind } });
    para.aText += t;
    this.updateCurrHeight();
  }

  private convertFontName(rName: string): void {
    if (rName) {
      // single dash is document default font
      if (rName === '-') this.maFontModel.maName = this.mrStyles.getDefaultFontModel().maName;
      else this.maFontModel.maName = rName;
    }
  }

  private convertFontStyle(rStyle: string): void {
    this.maFontModel.mbBold = this.maFontModel.mbItalic = false;
    if (!rStyle) return;
    for (const t of rStyle.split(' ')) {
      const aToken = t.toLowerCase();
      if (!aToken) continue;
      if (sppcBoldNames.includes(aToken)) this.maFontModel.mbBold = true;
      else if (sppcItalicNames.includes(aToken)) this.maFontModel.mbItalic = true;
    }
  }

  private convertFontColor(aColor: string): void {
    // a new colour object: the model's colour may be shared with the default font
    const c = this.maFontModel.maColor = new XlsColor();
    if ((aColor[2] === '+') || (aColor[2] === '-'))
      // theme color: TTSNNN (TT = decimal theme index, S = +/-, NNN = decimal tint/shade in percent)
      c.setTheme(parseInt(aColor.slice(0, 2), 10) || 0, (parseInt(aColor.slice(2), 10) || 0) / 100.0);
    // RGB color: RRGGBB
    else c.setRgb(parseInt(aColor, 16) || 0);
  }

  /** Finalizes current portion: sets font attributes and updates text height data. */
  private finalizePortion(): void {
    this.appendText();
    this.setAttributes();
  }

  /** Changes current header/footer portion. */
  private setNewPortion(ePortion: number): void {
    if (ePortion !== this.meCurrPortion) {
      this.finalizePortion();
      this.meCurrPortion = ePortion;
      this.maFontModel = { ...this.mrStyles.getDefaultFontModel() };
    }
  }
}

// PageSettingsConverter ------------------------------------------------------

interface HFHelperData { mnHeight: number; mnBodyDist: number; mbHasContent: boolean; mbShareOddEven: boolean; mbShareFirst: boolean; mbDynamicHeight: boolean }

export class PageSettingsConverter {
  private readonly mxHFParser: HeaderFooterParser;

  constructor(rStyles: StylesBuffer) { this.mxHFParser = new HeaderFooterParser(rStyles); }

  /** writePageSettingsProperties: the page style's items. */
  writePageSettingsProperties(rModel: PageSettingsModel): ScItemSet {
    const rPropSet: ScItemSet = {};
    // printout scaling
    if (rModel.mbFitToPages) {
      // fit to number of pages
      rPropSet.ATTR_PAGE_SCALETO = { nWidth: Math.max(0, Math.min(1000, rModel.mnFitToWidth)), nHeight: Math.max(0, Math.min(1000, rModel.mnFitToHeight)) };
    } else {
      // scale may be 0 which indicates uninitialized
      rPropSet.ATTR_PAGE_SCALE = (rModel.mnScale > 0) ? Math.max(10, Math.min(400, rModel.mnScale)) : 100;
    }

    // paper orientation
    const bLandscape = rModel.mnOrientation === 'landscape';

    // paper size
    if (!rModel.mbValidSettings) {
      let aSize: [number, number] = [0, 0];
      let bValid = false;
      if (0 < rModel.mnPaperSize) {
        aSize = getApiSizeForMSPaperSizeIndex(rModel.mnPaperSize);
        bValid = (aSize[0] !== 0 && aSize[1] !== 0);
      }
      if (rModel.mnPaperWidth > 0 && rModel.mnPaperHeight > 0) {
        aSize = [rModel.mnPaperWidth, rModel.mnPaperHeight];
        bValid = true;
      }
      if (bValid) {
        if (bLandscape) aSize = [aSize[1], aSize[0]];
        rPropSet.ATTR_PAGE_SIZE = { nWidth: mm100ToTwip(aSize[0]), nHeight: mm100ToTwip(aSize[1]) };
      }
    }

    // header/footer
    const maHeaderData = this.convertHeaderFooterData(rPropSet, ['ATTR_PAGE_HEADERLEFT', 'ATTR_PAGE_HEADERRIGHT', 'ATTR_PAGE_HEADERFIRST'], rModel.maOddHeader, rModel.maEvenHeader, rModel.maFirstHeader, rModel.mbUseEvenHF, rModel.mbUseFirstHF, rModel.mfTopMargin, rModel.mfHeaderMargin);
    const maFooterData = this.convertHeaderFooterData(rPropSet, ['ATTR_PAGE_FOOTERLEFT', 'ATTR_PAGE_FOOTERRIGHT', 'ATTR_PAGE_FOOTERFIRST'], rModel.maOddFooter, rModel.maEvenFooter, rModel.maFirstFooter, rModel.mbUseEvenHF, rModel.mbUseFirstHF, rModel.mfBottomMargin, rModel.mfFooterMargin);

    // write all properties to property set
    rPropSet.ATTR_PAGE = { ...SC_POOL_DEFAULTS.ATTR_PAGE, bLandscape };
    rPropSet.ATTR_PAGE_FIRSTPAGENO = Math.max(0, Math.min(9999, rModel.mbUseFirstPage ? rModel.mnFirstPage : 0));
    rPropSet.ATTR_PAGE_TOPDOWN = rModel.mnPageOrder === 'downThenOver';
    rPropSet.ATTR_PAGE_NOTES = rModel.mnCellComments === 'asDisplayed';
    rPropSet.ATTR_PAGE_HORCENTER = rModel.mbHorCenter;
    rPropSet.ATTR_PAGE_VERCENTER = rModel.mbVerCenter;
    rPropSet.ATTR_PAGE_GRID = rModel.mbPrintGrid;
    rPropSet.ATTR_PAGE_HEADERS = rModel.mbPrintHeadings;
    rPropSet.ATTR_LRSPACE = { nLeft: mm100ToTwip(inToMm100(rModel.mfLeftMargin)), nRight: mm100ToTwip(inToMm100(rModel.mfRightMargin)) };
    // #i23296# In Calc, "TopMargin" property is distance to top of header if enabled
    // #i23296# In Calc, "BottomMargin" property is distance to bottom of footer if enabled
    rPropSet.ATTR_ULSPACE = {
      nUpper: mm100ToTwip(inToMm100(maHeaderData.mbHasContent ? rModel.mfHeaderMargin : rModel.mfTopMargin)),
      nLower: mm100ToTwip(inToMm100(maFooterData.mbHasContent ? rModel.mfFooterMargin : rModel.mfBottomMargin)),
    };
    const hfSet = (d: HFHelperData, bHeader: boolean): ScPageHFSetItem => ({
      ...SC_POOL_DEFAULTS.ATTR_PAGE_HEADERSET,
      bOn: d.mbHasContent, bShared: d.mbShareOddEven, bSharedFirst: d.mbShareFirst, bDynamic: d.mbDynamicHeight,
      nHeight: mm100ToTwip(d.mnHeight),
      // the body distance is a header's lower and a footer's upper spacing
      nUpper: bHeader ? 0 : mm100ToTwip(d.mnBodyDist), nLower: bHeader ? mm100ToTwip(d.mnBodyDist) : 0,
    });
    rPropSet.ATTR_PAGE_HEADERSET = hfSet(maHeaderData, true);
    rPropSet.ATTR_PAGE_FOOTERSET = hfSet(maFooterData, false);
    return rPropSet;
  }

  private convertHeaderFooterData(rPropSet: ScItemSet, aIds: ['ATTR_PAGE_HEADERLEFT' | 'ATTR_PAGE_FOOTERLEFT', 'ATTR_PAGE_HEADERRIGHT' | 'ATTR_PAGE_FOOTERRIGHT', 'ATTR_PAGE_HEADERFIRST' | 'ATTR_PAGE_FOOTERFIRST'],
    rOddContent: string, rEvenContent: string, rFirstContent: string, bUseEvenContent: boolean, bUseFirstContent: boolean, fPageMargin: number, fContentMargin: number): HFHelperData {
    const bHasOddContent = !!rOddContent;
    const bHasEvenContent = bUseEvenContent && !!rEvenContent;
    const bHasFirstContent = bUseFirstContent && !!rFirstContent;

    const nOddHeight = bHasOddContent ? this.writeHeaderFooter(rPropSet, aIds[1], rOddContent) : 0;
    const nEvenHeight = bHasEvenContent ? this.writeHeaderFooter(rPropSet, aIds[0], rEvenContent) : 0;
    const nFirstHeight = bHasFirstContent ? this.writeHeaderFooter(rPropSet, aIds[2], rFirstContent) : 0;

    const orHFData: HFHelperData = {
      mnHeight: 750, mnBodyDist: 250, mbHasContent: bHasOddContent || bHasEvenContent || bHasFirstContent,
      mbShareOddEven: !bUseEvenContent, mbShareFirst: !bUseFirstContent, mbDynamicHeight: true,
    };
    if (!orHFData.mbHasContent) return orHFData;

    // use maximum height of odd/even/first header/footer
    orHFData.mnHeight = Math.max(nOddHeight, nEvenHeight, nFirstHeight);
    /*  Calc contains distance between bottom of header and top of page
        body in "HeaderBodyDistance" property, and distance between bottom
        of page body and top of footer in "FooterBodyDistance" property */
    orHFData.mnBodyDist = inToMm100(fPageMargin - fContentMargin) - orHFData.mnHeight;
    /*  #i23296# Distance less than 0 means, header or footer overlays page
        body. As this is not possible in Calc, set fixed header or footer
        height (crop header/footer) to get correct top position of page body. */
    orHFData.mbDynamicHeight = orHFData.mnBodyDist >= 0;
    /*  "HeaderHeight" property is in fact distance from top of header to
        top of page body (including "HeaderBodyDistance").
        "FooterHeight" property is in fact distance from bottom of page
        body to bottom of footer (including "FooterBodyDistance"). */
    orHFData.mnHeight += orHFData.mnBodyDist;
    // negative body distance not allowed
    orHFData.mnBodyDist = Math.max(orHFData.mnBodyDist, 0);
    return orHFData;
  }

  private writeHeaderFooter(rPropSet: ScItemSet, nPropId: 'ATTR_PAGE_HEADERLEFT' | 'ATTR_PAGE_HEADERRIGHT' | 'ATTR_PAGE_HEADERFIRST' | 'ATTR_PAGE_FOOTERLEFT' | 'ATTR_PAGE_FOOTERRIGHT' | 'ATTR_PAGE_FOOTERFIRST', rContent: string): number {
    if (!rContent) return 0;
    const { aItem, fHeight } = this.mxHFParser.parse(rContent);
    rPropSet[nPropId] = aItem;
    return Math.round((fHeight * 2540) / 72);
  }
}
