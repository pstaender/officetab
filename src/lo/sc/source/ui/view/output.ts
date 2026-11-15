// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/output.hxx reduced
// @upstream sc/source/ui/view/output.cxx reduced
// @upstream sc/source/ui/view/output2.cxx reduced
// ScOutputData: paints a block of cells that ScDocument::FillInfo described (ScTableInfo) on an
// output device: the document background, cell backgrounds, grid lines, cell borders, the cell
// texts with their alignment, clipping and overflow into empty neighbours (GetOutputArea), number
// formats' colours and "###" for numbers that do not fit, wrapped and multi-line text, merged
// cells and the clip marks. The device is a CanvasRenderingContext2D-shaped context in pixels
// (ScRenderContext), so that the same painter serves the screen, and SVG and PDF pages.
// Text is measured in twips (the font sized numerically in twips) and scaled by nPPTX/nPPTY when
// painted, so that a cell's layout does not change with zoom (upstream's reference device).
// Reduced: no edit engine: DrawEdit lays out multi-line and wrapped text itself, line by line,
// without rich text runs, hyphenation or rotated, stacked and asian vertical text; DrawFrame
// draws each cell's own border lines (no svx::frame::Array, so line joins and the priority of
// adjacent borders are simplified, diagonal lines are drawn plainly); conditional formatting,
// data bars, icon sets, sparklines, shadows, change tracking marks, note marks, the page break
// lines of the normal view (the page break mode's gray cells outside the print ranges are kept),
// the syntax highlighting mode, spell check marks, shrink to fit and tagged PDF are left out.
import { ScAddress, type SCCOL, type SCROW, type SCSIZE, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue } from '../../../inc/cellvalue.ts';
import { ScClipMark, type RowInfo, type ScTableInfo } from '../../../inc/fillinfo.ts';
import { HasAttrFlags } from '../../../inc/global.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScMF, type SvxBorderLine, type SvxCellHorJustify, type SvxCellVerJustify, type SvxMarginItem } from '../../../inc/scitems.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { ScCellFormat } from '../../core/tool/cellform.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { GetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import type { FontDesc, TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import { cssFont } from '../../../../vcl/source/outdev/text.ts';
import type { ScPageBreakData } from '../docshell/pagedata.ts';

/** The drawing calls ScOutputData makes: a CanvasRenderingContext2D's (SVGContext and PDFWriterImpl emulate them). */
export interface ScRenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  setLineDash(segments: number[]): void;
}

export const ScOutputType = { OUTTYPE_WINDOW: 0, OUTTYPE_PRINTER: 1 } as const;
export type ScOutputType = (typeof ScOutputType)[keyof typeof ScOutputType];

/** The background of the cells outside the print ranges in the page break mode (svtools::CALCPROTECTEDBACKGROUND). */
const PROTECTED_BACKGROUND = '#c0c0c0';

/** SC_CLIPMARK_SIZE: the clip mark triangle's size in twips. */
const SC_CLIPMARK_SIZE = 64;
/** DRAWTEXT_MAX: the longest text drawn of a cell. */
const DRAWTEXT_MAX = 32767;

/** The area a cell's text is aligned in and clipped to (GetOutputArea's result). */
export interface OutputAreaParam {
  maAlignRect: Rect;
  maClipRect: Rect;
  mnColWidth: number;
  mnLeftClipLength: number;
  mnRightClipLength: number;
  mbLeftClip: boolean;
  mbRightClip: boolean;
}

/** tools::Rectangle with inclusive right and bottom. */
export class Rect {
  nLeft: number;
  nTop: number;
  nRight: number;
  nBottom: number;
  constructor(nLeft = 0, nTop = 0, nRight = 0, nBottom = 0) {
    this.nLeft = nLeft; this.nTop = nTop; this.nRight = nRight; this.nBottom = nBottom;
  }
  Left(): number { return this.nLeft; }
  Top(): number { return this.nTop; }
  Right(): number { return this.nRight; }
  Bottom(): number { return this.nBottom; }
  SetLeft(n: number): void { this.nLeft = n; }
  SetRight(n: number): void { this.nRight = n; }
  SetTop(n: number): void { this.nTop = n; }
  SetBottom(n: number): void { this.nBottom = n; }
  AdjustLeft(n: number): void { this.nLeft += n; }
  AdjustRight(n: number): void { this.nRight += n; }
  GetWidth(): number { return this.nRight - this.nLeft + 1; }
  GetHeight(): number { return this.nBottom - this.nTop + 1; }
  clone(): Rect { return new Rect(this.nLeft, this.nTop, this.nRight, this.nBottom); }
  Normalize(): void {
    if (this.nLeft > this.nRight) [this.nLeft, this.nRight] = [this.nRight, this.nLeft];
    if (this.nTop > this.nBottom) [this.nTop, this.nBottom] = [this.nBottom, this.nTop];
  }
}

/** Whether a colour is dark (Color::IsDark), for the automatic font colour. */
export function IsDark(c: string | null): boolean {
  if (!c || c.length < 7) return false;
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  // Color::GetLuminance
  return (b * 29 + g * 151 + r * 76) >> 8 <= 62;
}

/** The text of a cell with its font and alignment (ScDrawStringsVars, reduced). */
class ScDrawStringsVars {
  private readonly pOutput: ScOutputData;
  pPattern: ScPatternAttr | null = null;
  aFont: FontDesc = { family: 'Liberation Sans', size: 200, bold: false, italic: false };
  /** The font colour; null: automatic. */
  aFontColor: string | null = null;
  /** The colour of the number format's section ([RED]). */
  aFormatColor: string | null = null;
  eAttrHorJust: SvxCellHorJustify = 'Standard';
  eAttrVerJust: SvxCellVerJustify = 'Bottom';
  pMargin: SvxMarginItem = { left: 20, top: 20, right: 20, bottom: 20 };
  nIndent = 0;
  bLineBreak = false;
  bRepeat = false;
  bShrink = false;
  aString = '';
  /** The text width in pixels, and its height (ascent + descent). */
  aTextSize = { Width: 0, Height: 0 };
  nAscentPixel = 0;
  nValueFormat = 'General';
  private maLastCell: ScRefCellValue | null = null;

  constructor(pData: ScOutputData) { this.pOutput = pData; }

  GetHorJust(): SvxCellHorJustify { return this.eAttrHorJust; }
  GetVerJust(): SvxCellVerJustify { return this.eAttrVerJust; }
  GetLineBreak(): boolean { return this.bLineBreak; }
  IsRepeat(): boolean { return this.bRepeat; }
  IsShrink(): boolean { return this.bShrink; }
  GetString(): string { return this.aString; }
  GetTextSize(): { Width: number; Height: number } { return this.aTextSize; }
  GetMargin(): SvxMarginItem { return this.pMargin; }
  GetResultValueFormat(): string { return this.nValueFormat; }
  /** The left margin and indent in twips (GetLeftTotal). */
  GetLeftTotal(): number { return this.pMargin.left + this.nIndent; }
  GetRightTotal(): number { return this.pMargin.right + this.nIndent; }

  SetPattern(pNew: ScPatternAttr): void {
    this.pPattern = pNew;
    // font
    this.aFont = { family: pNew.GetItem('ATTR_FONT'), size: pNew.GetItem('ATTR_FONT_HEIGHT'), bold: pNew.GetItem('ATTR_FONT_WEIGHT'), italic: pNew.GetItem('ATTR_FONT_POSTURE') };
    this.aFontColor = pNew.GetItem('ATTR_FONT_COLOR');

    //  alignment
    this.eAttrHorJust = pNew.GetItem('ATTR_HOR_JUSTIFY');
    this.eAttrVerJust = pNew.GetItem('ATTR_VER_JUSTIFY');
    if (this.eAttrVerJust === 'Standard') this.eAttrVerJust = 'Bottom';

    //  line break
    this.bLineBreak = pNew.GetItem('ATTR_LINEBREAK');

    //  handle "repeat" alignment
    this.bRepeat = this.eAttrHorJust === 'Repeat';
    // #i31843# "repeat" with "line breaks" is treated as default alignment
    if (this.bRepeat && this.bLineBreak) this.eAttrHorJust = 'Standard';

    this.bShrink = pNew.GetItem('ATTR_SHRINKTOFIT');

    //  margins
    this.pMargin = pNew.GetItem('ATTR_MARGIN');
    this.nIndent = this.eAttrHorJust === 'Left' || this.eAttrHorJust === 'Right' ? pNew.GetItem('ATTR_INDENT') : 0;

    this.nValueFormat = pNew.GetNumberFormat();
    this.maLastCell = null;
  }

  SetText(rCell: ScRefCellValue): boolean {
    if (!rCell.isEmpty()) {
      if (rCell !== this.maLastCell) {
        this.maLastCell = rCell; // store cell
        const r = ScCellFormat.GetString(rCell, this.nValueFormat, 'en-US', this.pOutput.mbShowNullValues, this.pOutput.mbShowFormulas);
        this.aString = r.aString;
        if (this.aString.length > DRAWTEXT_MAX) this.aString = this.aString.slice(0, DRAWTEXT_MAX);
        this.aFormatColor = r.pColor;
        this.TextChanged();
      }
      // otherwise keep string/size
    } else {
      this.aString = '';
      this.maLastCell = null;
      this.aTextSize = { Width: 0, Height: 0 };
    }
    return false;
  }

  SetHashText(): void { this.SetAutoText('###'); }

  SetAutoText(rAutoText: string): void {
    this.aString = rAutoText;
    this.TextChanged();
    this.maLastCell = null; // the same cell again must not keep this text
  }

  /** The repeat alignment: the text repeated to fill the column. */
  RepeatToFill(nColWidth: number): void {
    if (!this.bRepeat || !this.aString) return;
    const nCharWidth = this.GetFmtTextWidth(this.aString);
    if (nCharWidth < 1 || nCharWidth > nColWidth) return;
    const nCount = Math.floor(nColWidth / nCharWidth);
    if (nCount > 1) this.SetAutoText(this.aString.repeat(nCount));
  }

  /**
   * #i113045#: a number in the General format reduced to the digits that fit the width, or "###"
   * when it does not fit at all (true).
   */
  SetTextToWidthOrHash(rCell: ScRefCellValue, nWidth: number): boolean {
    const eType = rCell.getType();
    if (eType !== CELLTYPE_VALUE && eType !== CELLTYPE_FORMULA) return false; // must be a value or formula cell.

    if (eType === CELLTYPE_FORMULA) {
      const pFCell = rCell.getFormula()!;
      if (pFCell.GetErrCode() !== FormulaError.NONE || this.pOutput.mbShowFormulas) {
        this.SetHashText(); // If the error string doesn't fit, always use "###". Also for "display formulas" (#i116691#)
        return true;
      }
      // If it's formula, the result must be a value.
      if (!pFCell.IsValue()) return false;
    }

    const nFormat = this.GetResultValueFormat();
    if (!/^\s*General\s*$/i.test(nFormat)) {
      // Not 'General' number format.  Set hash text and bail out.
      this.SetHashText();
      return true;
    }

    const fVal = rCell.getValue();

    const nMaxDigit = this.GetFmtTextWidth('0');
    if (!nMaxDigit) return false;

    let nNumDigits = Math.trunc(nWidth / nMaxDigit);
    this.aString = lcl_GetOutputString(fVal, nNumDigits);
    let nSignCount = 0, nDecimalCount = 0, nExpCount = 0;
    for (const c of this.aString) {
      if (c === '-') ++nSignCount;
      else if (c === '.') ++nDecimalCount;
      else if (c === 'E') ++nExpCount;
    }

    // #i112250# A small value might be formatted as "0" when only counting the digits,
    // but fit into the column when considering the smaller width of the decimal separator.
    if (this.aString === '0' && fVal !== 0.0) nDecimalCount = 1;

    if (nDecimalCount) nWidth += (nMaxDigit - this.GetFmtTextWidth('.')) * nDecimalCount;
    if (nSignCount) nWidth += (nMaxDigit - this.GetFmtTextWidth('-')) * nSignCount;
    if (nExpCount) nWidth += (nMaxDigit - this.GetFmtTextWidth('E')) * nExpCount;

    if (nDecimalCount || nSignCount || nExpCount) {
      // Re-calculate.
      nNumDigits = Math.trunc(nWidth / nMaxDigit);
      this.aString = lcl_GetOutputString(fVal, nNumDigits);
    }

    const nActualTextWidth = this.GetFmtTextWidth(this.aString);
    if (nActualTextWidth > nWidth) {
      // Even after the decimal adjustment the text doesn't fit.  Give up.
      this.SetHashText();
      return true;
    }

    this.TextChanged();
    this.maLastCell = null; // #i113022# equal cell and format in another column may give different string
    return false;
  }

  /** A text's width in pixels at the cell's font. */
  GetFmtTextWidth(rString: string): number {
    return this.pOutput.mpMeasurer.GetTextWidth(this.aFont, rString) * this.pOutput.mnPPTX;
  }

  TextChanged(): void {
    const m = this.pOutput.mpMeasurer.GetFontMetric(this.aFont);
    this.aTextSize = { Width: Math.ceil(this.GetFmtTextWidth(this.aString)), Height: Math.ceil((m.ascent + m.descent) * this.pOutput.mnPPTY) };
    this.nAscentPixel = m.ascent * this.pOutput.mnPPTY;
  }

  /** Whether the text needs the edit engine (DrawEdit): it has line breaks. */
  HasEditCharacters(): boolean { return /[\n\r]/.test(this.aString); }
}

/** SvNumberformat::GetOutputString(fNumber, nCharCount): a General number in at most nCharCount characters. */
function lcl_GetOutputString(fNumber: number, nCharCount: number): string {
  const EXP_LOWER_BOUND = 1.0e-4;
  const scientific = () => {
    // 1.000E+015 (one digit and the decimal point, and the two chars + nExpDigit for the exponential part, totalling 6 or 7).
    let fExp = Math.log10(Math.abs(fNumber));
    if (fExp < 0.0) fExp = 1.0 - fExp;
    const nCharFormat = 6 + (fExp >= 100.0 ? 1 : 0);
    let nPrec = nCharCount > nCharFormat ? nCharCount - nCharFormat : 0;
    if (nPrec && fNumber < 0) --nPrec; // Make room for the negative sign.
    nPrec = Math.min(nPrec, 14); // limit to 14 decimals.
    return fNumber.toExponential(nPrec).replace(/\.?0+e/, 'e').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
  };
  let fTestNum = fNumber;
  const bSign = fTestNum < 0;
  if (bSign) fTestNum = -fTestNum;
  if (fTestNum < EXP_LOWER_BOUND && fTestNum !== 0) return scientific();

  const fExp = fTestNum ? Math.log10(fTestNum) : 0;
  // Values < 1.0 always have one digit before the decimal point.
  const nDigitPre = fExp >= 0.0 ? Math.ceil(fExp) || 1 : 1;

  if (nDigitPre > 15) return scientific();

  let nPrec = nCharCount >= nDigitPre ? nCharCount - nDigitPre : 0;
  if (nPrec && bSign) --nPrec; // Subtract the negative sign.
  if (nPrec) --nPrec; // Subtract the decimal point.
  let s = fNumber.toFixed(Math.min(nPrec, 15));
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  if (s.length > nCharCount) return scientific();
  return s;
}

/** The colour of a border line style for the canvas dash pattern. */
function lcl_Dash(style: SvxBorderLine['style'], w: number): number[] {
  switch (style) {
    case 'dotted': return [w, w];
    case 'dashed': case 'fine-dashed': return [3 * w, 2 * w];
    case 'dash-dot': return [3 * w, w, w, w];
    case 'dash-dot-dot': return [3 * w, w, w, w, w, w];
    default: return [];
  }
}

export class ScOutputData {
  readonly mpDev: ScRenderContext;
  readonly meType: ScOutputType;
  readonly mpRowInfo: RowInfo[];
  readonly mnArrCount: SCSIZE;
  readonly mpDoc: ScDocument;
  readonly mnTab: SCTAB;
  /** Start of the block in pixels */
  readonly mnScrX: number;
  readonly mnScrY: number;
  /** Size of the block in pixels */
  mnScrW = 0;
  mnScrH = 0;
  readonly mnX1: SCCOL;
  readonly mnY1: SCROW;
  readonly mnX2: SCCOL;
  readonly mnY2: SCROW;
  /** the visible part (without the columns and rows FillInfo was asked for before mnX1) */
  readonly mnVisX1: SCCOL;
  readonly mnVisY1: SCROW;
  readonly mnVisX2: SCCOL;
  readonly mnVisY2: SCROW;
  readonly mnPPTX: number;
  readonly mnPPTY: number;
  readonly mpMeasurer: TextMeasurer;

  maGridColor = '#c0c0c0';
  /** The size of a device pixel in output units (pDev->PixelToLogic(Size(1,1))): grid lines are this wide. */
  mnOneX = 1;
  mnOneY = 1;
  /** The document's background (svtools DOCCOLOR). */
  maDocColor = '#ffffff';
  mbShowNullValues = true;
  mbShowFormulas = false;
  mbMarkClipped = false;
  mbAnyClipped = false;
  mbTabProtected: boolean;
  mbLayoutRTL: boolean;
  mbEditMode = false;
  /** The page break mode: the cells outside the print ranges are gray. */
  mbPagebreakMode = false;
  mnEditCol: SCCOL = 0;
  mnEditRow: SCROW = 0;

  constructor(
    pNewDev: ScRenderContext, eNewType: ScOutputType, rNewInfo: ScTableInfo, pNewDoc: ScDocument, nNewTab: SCTAB,
    nNewScrX: number, nNewScrY: number, nNewX1: SCCOL, nNewY1: SCROW, nNewX2: SCCOL, nNewY2: SCROW,
    nPixelPerTwipsX: number, nPixelPerTwipsY: number, pMeasurer: TextMeasurer,
  ) {
    this.mpDev = pNewDev;
    this.meType = eNewType;
    this.mpRowInfo = rNewInfo.mpRowInfo;
    this.mnArrCount = rNewInfo.mnArrCount;
    this.mpDoc = pNewDoc;
    this.mnTab = nNewTab;
    this.mnScrX = nNewScrX;
    this.mnScrY = nNewScrY;
    this.mnX1 = nNewX1;
    this.mnY1 = nNewY1;
    this.mnX2 = nNewX2;
    this.mnY2 = nNewY2;
    this.mnVisX1 = nNewX1;
    this.mnVisY1 = nNewY1;
    this.mnVisX2 = nNewX2;
    this.mnVisY2 = nNewY2;
    this.mnPPTX = nPixelPerTwipsX;
    this.mnPPTY = nPixelPerTwipsY;
    this.mpMeasurer = pMeasurer;
    this.mbTabProtected = pNewDoc.IsTabProtected(nNewTab);
    this.mbLayoutRTL = pNewDoc.IsLayoutRTL(nNewTab);

    // always needed, so call at the end of the constructor
    this.SetCellRotations();
  }

  /** The block's size from the row heights and column widths (upstream computes it in the constructor). */
  private SetCellRotations(): void {
    this.mnScrW = 0;
    for (let nX = this.mnVisX1; nX <= this.mnVisX2; nX++) this.mnScrW += this.mpRowInfo[0]!.basicCellInfo(nX).nWidth;
    this.mnScrH = 0;
    for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) this.mnScrH += this.mpRowInfo[nArrY]!.nHeight;
  }

  SetGridColor(rColor: string): void { this.maGridColor = rColor; }

  /** SetPagebreakMode: marks the cells of the print ranges (bPrinted); the others are drawn gray. */
  SetPagebreakMode(pPageData: ScPageBreakData | null): void {
    this.mbPagebreakMode = true;
    if (!pPageData) return; // not yet initialized -> everything "not printed"

    // mark printed range
    // (everything in FillInfo is already initialized to sal_False)

    const nRangeCount = pPageData.GetCount();
    for (let nPos = 0; nPos < nRangeCount; nPos++) {
      const aRange = pPageData.GetData(nPos).GetPrintRange();

      const nStartX = Math.max(aRange.aStart.Col(), this.mnX1);
      const nEndX = Math.min(aRange.aEnd.Col(), this.mnX2);
      const nStartY = Math.max(aRange.aStart.Row(), this.mnY1);
      const nEndY = Math.min(aRange.aEnd.Row(), this.mnY2);

      for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
        const pThisRowInfo = this.mpRowInfo[nArrY]!;
        if (pThisRowInfo.bChanged && pThisRowInfo.nRowNo >= nStartY && pThisRowInfo.nRowNo <= nEndY) {
          for (let nX = nStartX; nX <= nEndX; nX++) pThisRowInfo.cellInfo(nX).bPrinted = true;
        }
      }
    }
  }
  SetMarkClipped(bSet: boolean): void { this.mbMarkClipped = bSet; }
  SetShowNullValues(bSet: boolean): void { this.mbShowNullValues = bSet; }
  SetShowFormulas(bSet: boolean): void { this.mbShowFormulas = bSet; }
  SetEditCell(nCol: SCCOL, nRow: SCROW): void {
    this.mnEditCol = nCol;
    this.mnEditRow = nRow;
    this.mbEditMode = true;
  }

  /** The width of a column in output units, from the row info or the document. */
  private ColWidth(nCol: SCCOL): number {
    if (this.mpRowInfo[0]!.hasBasicCellInfo(nCol) && nCol <= this.mnX2) return this.mpRowInfo[0]!.basicCellInfo(nCol).nWidth;
    return Math.trunc(this.mpDoc.GetColWidth(nCol, this.mnTab) * this.mnPPTX);
  }

  // --- output.cxx ---------------------------------------------------------------------------

  DrawGrid(bGrid: boolean): void {
    const ctx = this.mpDev;
    const nOneX = this.mnOneX, nOneY = this.mnOneY;
    const nLayoutSign = this.mbLayoutRTL ? -1 : 1;
    const nSignedOneX = nOneX * nLayoutSign;
    if (!bGrid) return; // simple grid only if set that way
    ctx.fillStyle = this.maGridColor;
    const AddVerLine = (nX: number, nY1: number, nY2: number) => ctx.fillRect(nX, nY1, nOneX, nY2 - nY1 + nOneY);
    const AddHorLine = (nX1: number, nX2: number, nY: number) => ctx.fillRect(Math.min(nX1, nX2), nY, Math.abs(nX2 - nX1) + nOneX, nOneY);

    // vertical lines

    let nPosX = this.mnScrX;
    if (this.mbLayoutRTL) nPosX += this.mnScrW - nOneX;

    for (let nX = this.mnX1; nX <= this.mnX2; nX++) {
      const nWidth = this.mpRowInfo[0]!.basicCellInfo(nX).nWidth;
      if (nWidth) {
        nPosX += nWidth * nLayoutSign;

        const nWidthXplus1 = this.mpRowInfo[0]!.basicCellInfo(nX + 1).nWidth;
        let bSingle = false; //! get into Fillinfo !!!!!
        if (nX < this.mpDoc.MaxCol()) {
          bSingle = nWidthXplus1 === 0;
          for (let nArrY = 1; nArrY + 1 < this.mnArrCount && !bSingle; nArrY++) {
            if (this.mpRowInfo[nArrY]!.cellInfo(nX + 1).bHOverlapped) bSingle = true;
            if (this.mpRowInfo[nArrY]!.cellInfo(nX).bHideGrid) bSingle = true;
          }
        }

        if (nX < this.mpDoc.MaxCol() && bSingle) {
          let nVisX = nX + 1;
          while (nVisX < this.mpDoc.MaxCol() && !this.mpDoc.GetColWidth(nVisX, this.mnTab)) ++nVisX;

          let nPosY = this.mnScrY;
          for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
            const pThisRowInfo = this.mpRowInfo[nArrY]!;
            const nNextY = nPosY + pThisRowInfo.nHeight;

            let bHOver = pThisRowInfo.cellInfo(nX).bHideGrid;
            if (!bHOver) {
              if (nWidthXplus1) bHOver = pThisRowInfo.cellInfo(nX + 1).bHOverlapped;
              else {
                if (nVisX <= this.mnX2) bHOver = pThisRowInfo.cellInfo(nVisX).bHOverlapped;
                else bHOver = (this.mpDoc.GetPattern(nVisX, pThisRowInfo.nRowNo, this.mnTab).GetItem('ATTR_MERGE_FLAG') & ScMF.Hor) !== 0;
                if (bHOver) bHOver = (this.mpDoc.GetPattern(nX + 1, pThisRowInfo.nRowNo, this.mnTab).GetItem('ATTR_MERGE_FLAG') & ScMF.Hor) !== 0;
              }
            }

            if (pThisRowInfo.bChanged && !bHOver) AddVerLine(nPosX - nSignedOneX, nPosY, nNextY - nOneY);
            nPosY = nNextY;
          }
        } else AddVerLine(nPosX - nSignedOneX, this.mnScrY, this.mnScrY + this.mnScrH - nOneY);
      }
    }

    // horizontal lines

    let nPosY = this.mnScrY;
    for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
      const nArrYplus1 = nArrY + 1;
      const nY = this.mpRowInfo[nArrY]!.nRowNo;
      const nYplus1 = nY + 1;
      nPosY += this.mpRowInfo[nArrY]!.nHeight;

      if (this.mpRowInfo[nArrY]!.bChanged) {
        const bNextYisNextRow = this.mpRowInfo[nArrYplus1]!.nRowNo === nYplus1;
        let bSingle = !bNextYisNextRow; // Hidden
        for (let i = this.mnX1; i <= this.mnX2 && !bSingle; i++) {
          if (this.mpRowInfo[nArrYplus1]!.cellInfo(i).bVOverlapped) bSingle = true;
        }

        if (bSingle && nY < this.mpDoc.MaxRow()) {
          const nVisY = this.mpRowInfo[nArrYplus1]!.nRowNo;

          let nPosX2 = this.mnScrX;
          if (this.mbLayoutRTL) nPosX2 += this.mnScrW - nOneX;

          for (let i = this.mnX1; i <= this.mnX2; i++) {
            const nNextX = nPosX2 + this.mpRowInfo[0]!.basicCellInfo(i).nWidth * nLayoutSign;
            if (nNextX !== nPosX2) {
              // visible
              let bVOver: boolean;
              if (bNextYisNextRow) bVOver = this.mpRowInfo[nArrYplus1]!.cellInfo(i).bVOverlapped;
              else {
                bVOver = (this.mpDoc.GetPattern(i, nYplus1, this.mnTab).GetItem('ATTR_MERGE_FLAG') & ScMF.Ver) !== 0
                  && (this.mpDoc.GetPattern(i, nVisY, this.mnTab).GetItem('ATTR_MERGE_FLAG') & ScMF.Ver) !== 0;
              }

              if (!bVOver) AddHorLine(nPosX2, nNextX - nSignedOneX, nPosY - nOneY);
            }
            nPosX2 = nNextX;
          }
        } else AddHorLine(this.mnScrX, this.mnScrX + this.mnScrW - nOneX, nPosY - nOneY);
      }
    }
  }

  /** The document's background colour over the whole block. */
  DrawDocumentBackground(): void {
    const ctx = this.mpDev;
    ctx.fillStyle = this.maDocColor;
    ctx.fillRect(this.mnScrX, this.mnScrY, this.mnScrW, this.mnScrH);
  }

  DrawBackground(): void {
    const ctx = this.mpDev;
    const nLayoutSign = this.mbLayoutRTL ? -1 : 1;

    let nPosY = this.mnScrY;

    // iterate through the rows to show
    for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
      const pThisRowInfo = this.mpRowInfo[nArrY]!;
      const nRowHeight = pThisRowInfo.nHeight;

      if (pThisRowInfo.bChanged && (!pThisRowInfo.bEmptyBack || this.mbPagebreakMode)) {
        let nPosX = this.mnScrX;
        if (this.mbLayoutRTL) nPosX += this.mnScrW - 1;

        let nMergedCols = 1;
        let nOldMerged = 0;
        for (let nX = this.mnX1; nX + nMergedCols <= this.mnX2 + 1; nX += nOldMerged) {
          const pInfo = pThisRowInfo.cellInfo(nX - 1 + nMergedCols);

          nOldMerged = nMergedCols;

          let nNewPosX = nPosX;
          // extend for all merged cells
          nMergedCols = 1;
          if (pInfo.bMerged && pInfo.pPatternAttr) {
            const pMerge = pInfo.getPatternAttr()!.GetItem('ATTR_MERGE');
            nMergedCols = Math.max(1, pMerge.nColMerge);
          }

          for (let nMerged = 0; nMerged < nMergedCols; ++nMerged) {
            const nCol = nX + nOldMerged + nMerged;
            if (nCol > this.mnX2 + 2) break;
            nNewPosX += this.mpRowInfo[0]!.basicCellInfo(nCol - 1).nWidth * nLayoutSign;
          }

          if (nNewPosX === nPosX) continue; // Zero width, no need to draw.

          let pBackground = pInfo.maBackground;
          if (this.mbPagebreakMode && !pInfo.bPrinted) pBackground = PROTECTED_BACKGROUND;
          if (pBackground) {
            // The rectangle covers the grid lines around the cell (one pixel above and left).
            ctx.fillStyle = pBackground;
            const x1 = Math.min(nPosX, nNewPosX) - 1, x2 = Math.max(nPosX, nNewPosX) - 1;
            ctx.fillRect(x1, nPosY - 1, x2 - x1 + 1, nRowHeight + 1);
          }

          nPosX = nNewPosX;
        }
      }
      nPosY += nRowHeight;
    }
  }

  /**
   * The cell borders: each cell's lines along its edges, centred on the grid line, at least a pixel
   * wide; double lines as two lines (reduced from svx::frame::Array's merged borders).
   */
  DrawFrame(): void {
    const ctx = this.mpDev;
    const nLayoutSign = this.mbLayoutRTL ? -1 : 1;
    const toPx = (w: number) => Math.max(1, Math.round(w * this.mnPPTX));
    const line = (l: SvxBorderLine, x1: number, y1: number, x2: number, y2: number, bHor: boolean) => {
      const w = toPx(l.width);
      ctx.fillStyle = l.color || '#000000';
      ctx.strokeStyle = l.color || '#000000';
      const dash = lcl_Dash(l.style, w);
      if (l.style === 'double' || l.style === 'double-thin' || l.style === 'thin-thick' || l.style === 'thick-thin') {
        const o = Math.max(1, Math.round(w / 2));
        if (bHor) { ctx.fillRect(x1, y1 - o, x2 - x1 + 1, 1); ctx.fillRect(x1, y1 + o, x2 - x1 + 1, 1); }
        else { ctx.fillRect(x1 - o, y1, 1, y2 - y1 + 1); ctx.fillRect(x1 + o, y1, 1, y2 - y1 + 1); }
        return;
      }
      const off = Math.floor((w - 1) / 2);
      if (!dash.length) {
        if (bHor) ctx.fillRect(x1 - off, y1 - off, x2 - x1 + 1 + 2 * off, w);
        else ctx.fillRect(x1 - off, y1 - off, w, y2 - y1 + 1 + 2 * off);
        return;
      }
      ctx.save();
      ctx.lineWidth = w;
      ctx.setLineDash(dash);
      ctx.beginPath();
      if (bHor) { ctx.moveTo(x1, y1 + w / 2 - off); ctx.lineTo(x2 + 1, y1 + w / 2 - off); }
      else { ctx.moveTo(x1 + w / 2 - off, y1); ctx.lineTo(x1 + w / 2 - off, y2 + 1); }
      ctx.stroke();
      ctx.restore();
    };
    const diag = (l: SvxBorderLine, x1: number, y1: number, x2: number, y2: number) => {
      ctx.save();
      ctx.strokeStyle = l.color || '#000000';
      ctx.lineWidth = toPx(l.width);
      ctx.setLineDash(lcl_Dash(l.style, toPx(l.width)));
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    };

    let nPosY = this.mnScrY;
    for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
      const pThisRowInfo = this.mpRowInfo[nArrY]!;
      let nPosX = this.mnScrX;
      if (this.mbLayoutRTL) nPosX += this.mnScrW - 1;
      for (let nX = this.mnX1; nX <= this.mnX2; nX++) {
        const nWidth = this.mpRowInfo[0]!.basicCellInfo(nX).nWidth;
        const pInfo = pThisRowInfo.cellInfo(nX);
        if (nWidth && !pInfo.bHOverlapped && !pInfo.bVOverlapped) {
          let nW = nWidth, nH = pThisRowInfo.nHeight;
          if (pInfo.bMerged && pInfo.pPatternAttr) {
            // a merged cell's borders go around the merged area
            const pMerge = pInfo.pPatternAttr.GetItem('ATTR_MERGE');
            for (let i = 1; i < pMerge.nColMerge; i++) nW += this.ColWidth(nX + i);
            for (let i = 1; i < pMerge.nRowMerge; i++) nH += Math.trunc(this.mpDoc.GetRowHeight(pThisRowInfo.nRowNo + i, this.mnTab) * this.mnPPTY);
          }
          const xL = this.mbLayoutRTL ? nPosX - nW : nPosX - 1, xR = this.mbLayoutRTL ? nPosX - 1 : nPosX + nW - 1;
          const yT = nPosY - 1, yB = nPosY + nH - 1;
          const box = pInfo.pLinesAttr;
          if (box) {
            if (box.top) line(box.top, xL, yT, xR, yT, true);
            if (box.bottom) line(box.bottom, xL, yB, xR, yB, true);
            if (box.left) line(box.left, xL, yT, xL, yB, false);
            if (box.right) line(box.right, xR, yT, xR, yB, false);
          }
          if (pInfo.mpTLBRLine) diag(pInfo.mpTLBRLine, xL, yT, xR, yB);
          if (pInfo.mpBLTRLine) diag(pInfo.mpBLTRLine, xL, yB, xR, yT);
        }
        nPosX += nWidth * nLayoutSign;
      }
      nPosY += pThisRowInfo.nHeight;
    }
  }

  DrawClipMarks(): void {
    if (!this.mbAnyClipped) return;
    const ctx = this.mpDev;
    // svtools::CALCTEXTOVERFLOW
    ctx.fillStyle = '#ff0000';
    const nLayoutSign = this.mbLayoutRTL ? -1 : 1;
    let nPosY = this.mnScrY;
    for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
      const pThisRowInfo = this.mpRowInfo[nArrY]!;
      let nPosX = this.mnScrX;
      if (this.mbLayoutRTL) nPosX += this.mnScrW - 1;
      for (let nX = this.mnX1; nX <= this.mnX2; nX++) {
        const pInfo = pThisRowInfo.cellInfo(nX);
        const nOutWidth = this.mpRowInfo[0]!.basicCellInfo(nX).nWidth;
        if (pInfo.nClipMark !== ScClipMark.NONE && nOutWidth) {
          const nStartPosX = this.mbLayoutRTL ? nPosX - nOutWidth + 1 : nPosX;
          const nOutHeight = pThisRowInfo.nHeight;
          const nMarkPixel = Math.trunc(SC_CLIPMARK_SIZE * this.mnPPTX);
          const nMiddle = nPosY + nOutHeight / 2;
          const nH = Math.min(nMarkPixel, nOutHeight / 2 - 1);
          if (pInfo.nClipMark & (this.mbLayoutRTL ? ScClipMark.Left : ScClipMark.Right)) {
            const x = nStartPosX + nOutWidth - 2;
            ctx.beginPath(); ctx.moveTo(x, nMiddle); ctx.lineTo(x - nH, nMiddle - nH); ctx.lineTo(x - nH, nMiddle + nH); ctx.closePath(); ctx.fill();
          }
          if (pInfo.nClipMark & (this.mbLayoutRTL ? ScClipMark.Right : ScClipMark.Left)) {
            const x = nStartPosX + 1;
            ctx.beginPath(); ctx.moveTo(x, nMiddle); ctx.lineTo(x + nH, nMiddle - nH); ctx.lineTo(x + nH, nMiddle + nH); ctx.closePath(); ctx.fill();
          }
        }
        nPosX += nOutWidth * nLayoutSign;
      }
      nPosY += pThisRowInfo.nHeight;
    }
  }

  // --- output2.cxx --------------------------------------------------------------------------

  GetMergeOrigin(nX: SCCOL, nY: SCROW, nArrY: SCSIZE, bVisRowChanged: boolean): { bDoMerge: boolean; rOverX: SCCOL; rOverY: SCROW } {
    let bDoMerge = false;
    const bIsLeft = nX === this.mnVisX1;
    const bIsTop = nY === this.mnVisY1 || bVisRowChanged;

    let bHOver: boolean;
    let bVOver: boolean;
    let bHidden: boolean;

    if (!this.mpDoc.ColHidden(nX, this.mnTab) && nX >= this.mnX1 && nX <= this.mnX2 && !this.mpDoc.RowHidden(nY, this.mnTab) && nY >= this.mnY1 && nY <= this.mnY2) {
      const pInfo = this.mpRowInfo[nArrY]!.cellInfo(nX);
      bHOver = pInfo.bHOverlapped;
      bVOver = pInfo.bVOverlapped;
    } else {
      const nOverlap2 = this.mpDoc.GetPattern(nX, nY, this.mnTab).GetItem('ATTR_MERGE_FLAG');
      bHOver = (nOverlap2 & ScMF.Hor) !== 0;
      bVOver = (nOverlap2 & ScMF.Ver) !== 0;
    }

    if (bHOver && bVOver) bDoMerge = bIsLeft && bIsTop;
    else if (bHOver) bDoMerge = bIsLeft;
    else if (bVOver) bDoMerge = bIsTop;

    let rOverX = nX;
    let rOverY = nY;

    while (bHOver) {
      // nY constant
      --rOverX;
      bHidden = this.mpDoc.ColHidden(rOverX, this.mnTab);
      if (!bDoMerge && !bHidden) return { bDoMerge: false, rOverX, rOverY };

      if (rOverX >= this.mnX1 && !bHidden) {
        bHOver = this.mpRowInfo[nArrY]!.cellInfo(rOverX).bHOverlapped;
        bVOver = this.mpRowInfo[nArrY]!.cellInfo(rOverX).bVOverlapped;
      } else {
        const nOverlap = this.mpDoc.GetPattern(rOverX, rOverY, this.mnTab).GetItem('ATTR_MERGE_FLAG');
        bHOver = (nOverlap & ScMF.Hor) !== 0;
        bVOver = (nOverlap & ScMF.Ver) !== 0;
      }
    }

    while (bVOver) {
      --rOverY;
      bHidden = this.mpDoc.RowHidden(rOverY, this.mnTab);
      if (!bDoMerge && !bHidden) return { bDoMerge: false, rOverX, rOverY };

      if (nArrY > 0) --nArrY; // local copy !

      if (rOverX >= this.mnX1 && rOverY >= this.mnY1 && !this.mpDoc.ColHidden(rOverX, this.mnTab) && !this.mpDoc.RowHidden(rOverY, this.mnTab) && this.mpRowInfo[nArrY]!.nRowNo === rOverY) {
        bVOver = this.mpRowInfo[nArrY]!.cellInfo(rOverX).bVOverlapped;
      } else {
        const nOverlap = this.mpDoc.GetPattern(rOverX, rOverY, this.mnTab).GetItem('ATTR_MERGE_FLAG');
        bVOver = (nOverlap & ScMF.Ver) !== 0;
      }
    }

    return { bDoMerge: true, rOverX, rOverY };
  }

  IsEmptyCellText(pThisRowInfo: RowInfo | null, nX: SCCOL, nY: SCROW): boolean {
    // pThisRowInfo may be NULL

    let bEmpty: boolean;
    if (pThisRowInfo && nX <= this.mnX2 && pThisRowInfo.hasBasicCellInfo(nX)) bEmpty = pThisRowInfo.basicCellInfo(nX).bEmptyCellText;
    else bEmpty = this.mpDoc.GetRefCellValue(new ScAddress(nX, nY, this.mnTab)).isEmpty();

    if (!bEmpty && (nX < this.mnX1 || nX > this.mnX2 || !pThisRowInfo)) {
      //  for the range mnX1..mnX2 in RowInfo, cell protection attribute is already evaluated
      //  into bEmptyCellText in ScDocument::FillInfo / lcl_HidePrint (printfun)

      if (this.mbTabProtected) {
        const pAttr = this.mpDoc.GetPattern(nX, nY, this.mnTab).GetItem('ATTR_PROTECTION');
        if (pAttr.bHideCell) bEmpty = true;
        else if (this.mbShowFormulas && pAttr.bHideFormula) {
          if (this.mpDoc.GetCellType(nX, nY, this.mnTab) === CELLTYPE_FORMULA) bEmpty = true;
        }
      }
    }
    return bEmpty;
  }

  GetVisibleCell(nCol: SCCOL, nRow: SCROW, nTabP: SCTAB): ScRefCellValue {
    const rCell = new ScRefCellValue(this.mpDoc.FetchTable(nTabP)?.GetCellData(nCol, nRow));
    if (!rCell.isEmpty() && this.IsEmptyCellText(null, nCol, nRow)) return new ScRefCellValue();
    return rCell;
  }

  IsAvailable(nX: SCCOL, nY: SCROW): boolean {
    //  apply the same logic here as in DrawStrings/DrawEdit:
    //  Stop at non-empty or merged or overlapped cell,
    //  where a note is empty as well as a cell that's hidden by protection settings

    const aCell = new ScRefCellValue(this.mpDoc.FetchTable(this.mnTab)?.GetCellData(nX, nY));
    if (!aCell.isEmpty() && !this.IsEmptyCellText(null, nX, nY)) return false;

    const pPattern = this.mpDoc.GetPattern(nX, nY, this.mnTab);
    return !(pPattern.IsMerged() || pPattern.IsOverlapped());
  }

  /**
   * nX, nArrY: loop variables from DrawStrings / DrawEdit; nPosX, nPosY: corresponding positions
   * for nX, nArrY; nCellX, nCellY: position of the cell that contains the text; nNeeded: Text
   * width, including margin; rPattern: cell format at nCellX, nCellY; nHorJustify: horizontal
   * alignment (visual) to determine which cells to use for long strings; bCellIsValue: if set,
   * don't extend into empty cells; bBreak: if set, don't extend, and don't set clip marks (but
   * rLeftClip/rRightClip is set); bOverwrite: if set, also extend into non-empty cells.
   */
  GetOutputArea(nX: SCCOL, nArrY: SCSIZE, nPosX: number, nPosY: number, nCellX: SCCOL, nCellY: SCROW, nNeeded: number, rPattern: ScPatternAttr,
    nHorJustify: SvxCellHorJustify, bCellIsValue: boolean, bBreak: boolean, bOverwrite: boolean): OutputAreaParam {
    //  rThisRowInfo may be for a different row than nCellY, is still used for clip marks
    const rThisRowInfo = this.mpRowInfo[nArrY]!;

    const nLayoutSign = this.mbLayoutRTL ? -1 : 1;

    let nCellPosX = nPosX; // find nCellX position, starting at nX/nPosX
    let nCompCol = nX;
    while (nCellX > nCompCol) {
      nCellPosX += this.ColWidth(nCompCol) * nLayoutSign;
      ++nCompCol;
    }
    while (nCellX < nCompCol) {
      --nCompCol;
      nCellPosX -= this.ColWidth(nCompCol) * nLayoutSign;
    }

    let nCellPosY = nPosY; // find nCellY position, starting at nArrY/nPosY
    let nCompArr = nArrY;
    let nCompRow = this.mpRowInfo[nCompArr]!.nRowNo;
    while (nCellY > nCompRow) {
      if (nCompArr + 1 < this.mnArrCount) {
        nCellPosY += this.mpRowInfo[nCompArr]!.nHeight;
        ++nCompArr;
        nCompRow = this.mpRowInfo[nCompArr]!.nRowNo;
      } else {
        const nDocHeight = this.mpDoc.GetRowHeight(nCompRow, this.mnTab);
        if (nDocHeight) nCellPosY += Math.trunc(nDocHeight * this.mnPPTY);
        ++nCompRow;
      }
    }
    nCellPosY -= this.GetScaledRowHeight(nCellY, nCompRow - 1);

    const pMerge = rPattern.GetItem('ATTR_MERGE');
    const bMerged = pMerge.nColMerge > 1 || pMerge.nRowMerge > 1;
    const nMergeCols = pMerge.nColMerge || 1;
    const nMergeRows = pMerge.nRowMerge || 1;

    let nMergeSizeX = 0;
    for (let i = 0; i < nMergeCols; i++) nMergeSizeX += this.ColWidth(nCellX + i);
    let nMergeSizeY = 0;
    let nDirect = 0;
    if (rThisRowInfo.nRowNo === nCellY) {
      // take first row's height from row info
      nMergeSizeY += rThisRowInfo.nHeight;
      nDirect = 1; // skip in loop
    }
    // following rows always from document
    nMergeSizeY += this.GetScaledRowHeight(nCellY + nDirect, nCellY + nMergeRows - 1);

    --nMergeSizeX; // leave out the grid horizontally, also for alignment (align between grid lines)

    const rParam: OutputAreaParam = {
      maAlignRect: new Rect(), maClipRect: new Rect(), mnColWidth: nMergeSizeX, // store the actual column width.
      mnLeftClipLength: 0, mnRightClipLength: 0, mbLeftClip: false, mbRightClip: false,
    };

    // construct the rectangles using logical left/right values (justify is called at the end)

    // rAlignRect is the single cell or merged area, used for alignment.

    rParam.maAlignRect.SetLeft(nCellPosX);
    rParam.maAlignRect.SetRight(nCellPosX + (nMergeSizeX - 1) * nLayoutSign);
    rParam.maAlignRect.SetTop(nCellPosY);
    rParam.maAlignRect.SetBottom(nCellPosY + nMergeSizeY - 1);

    //  rClipRect is all cells that are used for output.
    //  For merged cells this is the same as rAlignRect, otherwise neighboring cells can also be used.

    rParam.maClipRect = rParam.maAlignRect.clone();
    if (nNeeded > nMergeSizeX) {
      const eHorJust = nHorJustify;

      const nMissing = nNeeded - nMergeSizeX;
      let nLeftMissing = 0;
      let nRightMissing = 0;
      switch (eHorJust) {
        case 'Left': nRightMissing = nMissing; break;
        case 'Right': nLeftMissing = nMissing; break;
        case 'Center':
          nLeftMissing = Math.trunc(nMissing / 2);
          nRightMissing = nMissing - nLeftMissing;
          break;
        default: break;
      }

      // nLeftMissing, nRightMissing are logical, eHorJust values are visual
      if (this.mbLayoutRTL) [nLeftMissing, nRightMissing] = [nRightMissing, nLeftMissing];

      let nRightX = nCellX;
      let nLeftX = nCellX;
      if (!bMerged && !bCellIsValue && !bBreak) {
        //  look for empty cells into which the text can be extended

        while (nRightMissing > 0 && nRightX < this.mpDoc.MaxCol() && (bOverwrite || this.IsAvailable(nRightX + 1, nCellY))) {
          ++nRightX;
          const nAdd = Math.trunc(this.mpDoc.GetColWidth(nRightX, this.mnTab) * this.mnPPTX);
          nRightMissing -= nAdd;
          rParam.maClipRect.AdjustRight(nAdd * nLayoutSign);

          if (rThisRowInfo.nRowNo === nCellY && nRightX >= this.mnX1 && nRightX <= this.mnX2) rThisRowInfo.cellInfo(nRightX - 1).bHideGrid = true;
        }

        while (nLeftMissing > 0 && nLeftX > 0 && (bOverwrite || this.IsAvailable(nLeftX - 1, nCellY))) {
          if (rThisRowInfo.nRowNo === nCellY && nLeftX >= this.mnX1 && nLeftX <= this.mnX2) rThisRowInfo.cellInfo(nLeftX - 1).bHideGrid = true;

          --nLeftX;
          const nAdd = Math.trunc(this.mpDoc.GetColWidth(nLeftX, this.mnTab) * this.mnPPTX);
          nLeftMissing -= nAdd;
          rParam.maClipRect.AdjustLeft(-(nAdd * nLayoutSign));
        }
      }

      //  Set flag and reserve space for clipping mark triangle,
      //  even if rThisRowInfo isn't for nCellY (merged cells).
      if (nRightMissing > 0 && this.mbMarkClipped && nRightX >= this.mnX1 && nRightX <= this.mnX2 && !bBreak && !bCellIsValue) {
        rThisRowInfo.cellInfo(nRightX).nClipMark |= ScClipMark.Right;
        this.mbAnyClipped = true;
        const nMarkPixel = Math.trunc(SC_CLIPMARK_SIZE * this.mnPPTX);
        rParam.maClipRect.AdjustRight(-(nMarkPixel * nLayoutSign));
      }
      if (nLeftMissing > 0 && this.mbMarkClipped && nLeftX >= this.mnX1 && nLeftX <= this.mnX2 && !bBreak && !bCellIsValue) {
        rThisRowInfo.cellInfo(nLeftX).nClipMark |= ScClipMark.Left;
        this.mbAnyClipped = true;
        const nMarkPixel = Math.trunc(SC_CLIPMARK_SIZE * this.mnPPTX);
        rParam.maClipRect.AdjustLeft(nMarkPixel * nLayoutSign);
      }

      rParam.mbLeftClip = nLeftMissing > 0;
      rParam.mbRightClip = nRightMissing > 0;
      rParam.mnLeftClipLength = nLeftMissing;
      rParam.mnRightClipLength = nRightMissing;
    } else {
      rParam.mbLeftClip = rParam.mbRightClip = false;
    }

    //  justify both rectangles for alignment calculation, use with DrawText etc.

    rParam.maAlignRect.Normalize();
    rParam.maClipRect.Normalize();
    return rParam;
  }

  /** ScDocument::GetScaledRowHeight: the pixel height of rows nStartRow..nEndRow. */
  private GetScaledRowHeight(nStartRow: SCROW, nEndRow: SCROW): number {
    let n = 0;
    for (let nRow = nStartRow; nRow <= nEndRow;) {
      const r = this.mpDoc.GetRowHeightRun(nRow, this.mnTab);
      const nLast = Math.min(r.nEndRow, nEndRow);
      if (r.nHeight) n += Math.trunc(r.nHeight * this.mnPPTY) * (nLast - nRow + 1);
      nRow = nLast + 1;
    }
    return n;
  }

  /** Get left, right or centered alignment from RTL context (getAlignmentFromContext). */
  private static getAlignmentFromContext(eInHorJust: SvxCellHorJustify, bCellIsValue: boolean, rText: string, rPattern: ScPatternAttr, bLayoutRTL: boolean, bNumberFormatIsText: boolean): SvxCellHorJustify {
    const beginsWithRTLCharacter = (s: string) => /^[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(s);
    let eHorJustContext = eInHorJust;
    let bUseWritingDirection = false;
    if (eInHorJust === 'Standard') {
      // fdo#32530: Default alignment depends on value vs
      // string, and the direction of the 1st letter.
      if (beginsWithRTLCharacter(rText)) {
        if (bCellIsValue) eHorJustContext = bNumberFormatIsText ? 'Right' : 'Left';
        else eHorJustContext = 'Right';
      } else if (bCellIsValue) eHorJustContext = bNumberFormatIsText ? 'Left' : 'Right';
      else bUseWritingDirection = true;
    }

    if (bUseWritingDirection || eInHorJust === 'Block' || eInHorJust === 'Repeat') {
      const nDirection = rPattern.GetItem('ATTR_WRITINGDIR');
      if (nDirection === 'Horizontal_LR_TB') eHorJustContext = 'Left';
      else if (nDirection === 'Environment') {
        // fdo#73588: The content of the cell must also begin with a RTL character to be right
        // aligned; otherwise, it should be left aligned.
        eHorJustContext = bLayoutRTL && beginsWithRTLCharacter(rText) ? 'Right' : 'Left';
      } else eHorJustContext = 'Right';
    }
    return eHorJustContext;
  }

  /** The cells whose text needs the edit engine, collected by DrawStrings for DrawEdit. */
  private maEditCells: { nX: SCCOL; nArrY: SCSIZE; nPosX: number; nPosY: number; nCellX: SCCOL; nCellY: SCROW }[] = [];

  /** DrawStrings (LayoutStrings): the one-line texts of the block; the others are left for DrawEdit. */
  DrawStrings(): void {
    const aVars = new ScDrawStringsVars(this);

    const nInitPosX = this.mnScrX + (this.mbLayoutRTL ? this.mnScrW - 1 : 0);
    const nLayoutSign = this.mbLayoutRTL ? -1 : 1;

    let nLastContentCol = this.mpDoc.MaxCol();
    if (this.mnX2 < this.mpDoc.MaxCol()) nLastContentCol = this.mpDoc.GetCellArea(this.mnTab).nEndCol;

    let nLoopStartX = this.mnX1;
    if (this.mnX1 > 0) --nLoopStartX; // start before mnX1 for rest of long text to the left

    let pOldPattern: ScPatternAttr | null = null;
    this.maEditCells = [];

    let nPosY = this.mnScrY;
    for (let nArrY = 1; nArrY + 1 < this.mnArrCount; nArrY++) {
      const pThisRowInfo = this.mpRowInfo[nArrY]!;
      const nY = pThisRowInfo.nRowNo;
      if (pThisRowInfo.bChanged) {
        let nPosX = nInitPosX;
        if (nLoopStartX < this.mnX1) nPosX -= this.mpRowInfo[0]!.basicCellInfo(nLoopStartX).nWidth * nLayoutSign;
        let oFirstNonEmptyCellX: SCCOL | undefined;
        let oLastEmptyCellX: SCCOL | undefined;
        for (let nX = nLoopStartX; nX <= this.mnX2; nX++) {
          // LayoutStringsImpl
          const pInfo = pThisRowInfo.cellInfo(nX);
          let bEmpty = nX < this.mnX1 || pThisRowInfo.basicCellInfo(nX).bEmptyCellText;
          let nCellX = nX; // position where the cell really starts
          let nCellY = nY;
          let bDoCell = false;
          let bUseEditEngine = false;
          let bMergeEmpty = false;

          //  Part of a merged cell?

          const bOverlapped = pInfo.bHOverlapped || pInfo.bVOverlapped;
          if (bOverlapped) {
            bEmpty = true;

            const bVisChanged = !this.mpRowInfo[nArrY - 1]!.bChanged;
            const r = this.GetMergeOrigin(nX, nY, nArrY, bVisChanged);
            if (r.bDoMerge) {
              nCellX = r.rOverX;
              nCellY = r.rOverY;
              bDoCell = true;
            } else bMergeEmpty = true;
          }

          //  Is there a long text further to the left, that overlaps this region?

          if (bEmpty && !bMergeEmpty && nX < this.mnX1 && !bOverlapped) {
            if (oFirstNonEmptyCellX === undefined) {
              let nTempX = this.mnX1;
              while (nTempX > 0 && this.IsEmptyCellText(pThisRowInfo, nTempX, nY)) --nTempX;
              oFirstNonEmptyCellX = nTempX;
            }

            if (oFirstNonEmptyCellX < this.mnX1 && !this.IsEmptyCellText(pThisRowInfo, oFirstNonEmptyCellX, nY) &&
                !this.mpDoc.HasAttrib(oFirstNonEmptyCellX, nY, this.mnTab, this.mnX1, nY, this.mnTab, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
              nCellX = oFirstNonEmptyCellX;
              bDoCell = true;
            }
          }

          //  Is there a long text further to the right, that overlaps this region?

          if (bEmpty && !bMergeEmpty && nX === this.mnX2 && !bOverlapped) {
            if (oLastEmptyCellX === undefined) {
              //  don't have to look further than nLastContentCol
              let nTempX = nX;
              while (nTempX < nLastContentCol && this.IsEmptyCellText(pThisRowInfo, nTempX, nY)) ++nTempX;
              oLastEmptyCellX = nTempX;
            }

            if (oLastEmptyCellX > nX && !this.IsEmptyCellText(pThisRowInfo, oLastEmptyCellX, nY) &&
                !this.mpDoc.HasAttrib(oLastEmptyCellX, nY, this.mnTab, nX, nY, this.mnTab, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
              nCellX = oLastEmptyCellX;
              bDoCell = true;
            }
          }

          //  normal visible cell

          if (!bEmpty) bDoCell = true;

          //  don't output the cell that's being edited

          if (bDoCell && this.mbEditMode && nCellX === this.mnEditCol && nCellY === this.mnEditRow) bDoCell = false;

          //  output the cell text

          let aCell = new ScRefCellValue();
          if (bDoCell) {
            if (nCellY === nY && nCellX === nX && nCellX >= this.mnX1 && nCellX <= this.mnX2) aCell = pThisRowInfo.cellInfo(nCellX).maCell;
            else aCell = this.GetVisibleCell(nCellX, nCellY, this.mnTab); // get from document
            if (aCell.isEmpty()) bDoCell = false;
            else if (aCell.getType() === CELLTYPE_EDIT) bUseEditEngine = true;
          }

          let pPattern: ScPatternAttr | null = null;
          if (bDoCell && !bUseEditEngine) {
            if (nCellY === nY && nCellX >= this.mnX1 && nCellX <= this.mnX2) pPattern = pThisRowInfo.cellInfo(nCellX).getPatternAttr();
            if (!pPattern) pPattern = this.mpDoc.GetPattern(nCellX, nCellY, this.mnTab); // get from document

            if (aCell.hasNumeric() && pPattern.GetItem('ATTR_LINEBREAK')) {
              // Disable line break when the cell content is numeric.
              pPattern = pPattern.PutItems({ ATTR_LINEBREAK: false });
            }

            if (pPattern !== pOldPattern) {
              aVars.SetPattern(pPattern);
              pOldPattern = pPattern;
            }

            //  use edit engine for rotated text
            if (pPattern.GetItem('ATTR_ROTATE_VALUE') !== 0 || pPattern.GetItem('ATTR_STACKED')) bUseEditEngine = true;
          }
          if (bDoCell && !bUseEditEngine) {
            aVars.SetText(aCell);
            bUseEditEngine = aVars.HasEditCharacters();
          }
          let nTotalMargin = 0;
          let eOutHorJust: SvxCellHorJustify = 'Standard';
          let aAreaParam: OutputAreaParam | null = null;
          let bCellIsValue = false;
          if (bDoCell && !bUseEditEngine) {
            const eCellType = aCell.getType();
            bCellIsValue = eCellType === CELLTYPE_VALUE;
            if (eCellType === CELLTYPE_FORMULA) {
              const pFCell = aCell.getFormula()!;
              bCellIsValue = pFCell.IsRunning() || pFCell.IsValue();
            }

            const bNumberFormatIsText = GetType(aVars.GetResultValueFormat(), 'en-US') === SvNumFormatType.TEXT;
            eOutHorJust = ScOutputData.getAlignmentFromContext(aVars.GetHorJust(), bCellIsValue, aVars.GetString(), pPattern!, this.mbLayoutRTL, bNumberFormatIsText);

            let bBreak = aVars.GetLineBreak() || aVars.GetHorJust() === 'Block';
            // #i111387# #o11817313# tdf#121040 disable automatic line breaks for all number formats
            // Must be synchronized with ScColumn::GetNeededSize()
            if (bBreak && bCellIsValue && GetType(aVars.GetResultValueFormat(), 'en-US') === SvNumFormatType.NUMBER) bBreak = false;

            const bRepeat = aVars.IsRepeat() && !bBreak;
            const bShrink = aVars.IsShrink() && !bBreak && !bRepeat;

            nTotalMargin = Math.trunc(aVars.GetLeftTotal() * this.mnPPTX) + Math.trunc(aVars.GetMargin().right * this.mnPPTX);

            const nNeededWidth = aVars.GetTextSize().Width + nTotalMargin;

            // GetOutputArea gives justified rectangles
            aAreaParam = this.GetOutputArea(nX, nArrY, nPosX, nPosY, nCellX, nCellY, nNeededWidth, pPattern!, eOutHorJust, bCellIsValue || bRepeat || bShrink, bBreak, false);

            aVars.RepeatToFill(aAreaParam.mnColWidth - nTotalMargin);

            //  use edit engine if automatic line breaks are needed
            if (bBreak) bUseEditEngine = aAreaParam.mbLeftClip || aAreaParam.mbRightClip;
          }
          if (bUseEditEngine) {
            //  mark the cell to be drawn in DrawEdit
            this.maEditCells.push({ nX, nArrY, nPosX, nPosY, nCellX, nCellY });
            bDoCell = false; // don't draw here
          }
          if (bDoCell && aAreaParam) {
            if (bCellIsValue && (aAreaParam.mbLeftClip || aAreaParam.mbRightClip)) {
              let bHasHashText = false;
              if (this.mbShowFormulas) {
                aVars.SetHashText();
                bHasHashText = true;
              } else bHasHashText = aVars.SetTextToWidthOrHash(aCell, aAreaParam.mnColWidth - nTotalMargin); // Adjust the decimals to fit the available column width.

              if (bHasHashText) {
                const nMarkPixel = SC_CLIPMARK_SIZE * this.mnPPTX;

                if (eOutHorJust === 'Left') {
                  if (nCellY === nY && nCellX >= this.mnX1 && nCellX <= this.mnX2) this.mpRowInfo[nArrY]!.cellInfo(nCellX).nClipMark |= ScClipMark.Right;
                  this.mbAnyClipped = true;
                  aAreaParam.maClipRect.AdjustRight(-(nMarkPixel * nLayoutSign));
                } else if (eOutHorJust === 'Right') {
                  if (nCellY === nY && nCellX >= this.mnX1 && nCellX <= this.mnX2) this.mpRowInfo[nArrY]!.cellInfo(nCellX).nClipMark |= ScClipMark.Left;
                  this.mbAnyClipped = true;
                  aAreaParam.maClipRect.AdjustLeft(nMarkPixel * nLayoutSign);
                } else {
                  if (nCellY === nY && nCellX >= this.mnX1 && nCellX <= this.mnX2) {
                    this.mpRowInfo[nArrY]!.cellInfo(nCellX).nClipMark |= ScClipMark.Right;
                    this.mpRowInfo[nArrY]!.cellInfo(nCellX).nClipMark |= ScClipMark.Left;
                  }
                  this.mbAnyClipped = true;
                  aAreaParam.maClipRect.AdjustRight(-(nMarkPixel * nLayoutSign));
                  aAreaParam.maClipRect.AdjustLeft(nMarkPixel * nLayoutSign);
                }
              }

              const nNeededWidth = aVars.GetTextSize().Width + Math.trunc(aVars.GetLeftTotal() * this.mnPPTX) + Math.trunc(aVars.GetMargin().right * this.mnPPTX);
              if (nNeededWidth <= aAreaParam.maClipRect.GetWidth()) {
                // Cell value is no longer clipped.  Reset relevant parameters.
                aAreaParam.mbLeftClip = aAreaParam.mbRightClip = false;
                aAreaParam.mnLeftClipLength = aAreaParam.mnRightClipLength = 0;
              }
            }

            this.DrawText(aVars, aAreaParam, eOutHorJust, pPattern!, nCellY);
          }
          nPosX += this.mpRowInfo[0]!.basicCellInfo(nX).nWidth * nLayoutSign;
        }
      }
      nPosY += this.mpRowInfo[nArrY]!.nHeight;
    }
  }

  /** The text colour: the format's, the font's, else automatic (white on a dark background). */
  private TextColor(aVars: ScDrawStringsVars, pPattern: ScPatternAttr): string {
    if (aVars.aFormatColor) return aVars.aFormatColor;
    if (aVars.aFontColor) return aVars.aFontColor;
    const back = pPattern.GetItem('ATTR_BACKGROUND') ?? this.maDocColor;
    return IsDark(back) ? '#ffffff' : '#000000';
  }

  /** The part of the inner loop of LayoutStrings that positions, clips and draws the text. */
  private DrawText(aVars: ScDrawStringsVars, aAreaParam: OutputAreaParam, eOutHorJust: SvxCellHorJustify, pPattern: ScPatternAttr, nCellY: SCROW): void {
    let nJustPosX = aAreaParam.maAlignRect.Left(); // "justified" - effect of alignment will be added
    let nJustPosY = aAreaParam.maAlignRect.Top();
    const nAvailWidth = aAreaParam.maAlignRect.GetWidth();
    const nOutHeight = aAreaParam.maAlignRect.GetHeight();

    const bOutside = aAreaParam.maClipRect.Right() < this.mnScrX || aAreaParam.maClipRect.Left() >= this.mnScrX + this.mnScrW;
    let bVClip = false;
    const bHClip = aAreaParam.mbLeftClip || aAreaParam.mbRightClip;

    // check horizontal space

    if (bOutside) return;
    switch (eOutHorJust) {
      case 'Left':
        nJustPosX += Math.trunc(aVars.GetLeftTotal() * this.mnPPTX);
        break;
      case 'Right':
        nJustPosX += nAvailWidth - aVars.GetTextSize().Width - Math.trunc(aVars.GetRightTotal() * this.mnPPTX);
        break;
      case 'Center':
        nJustPosX += Math.trunc((nAvailWidth - aVars.GetTextSize().Width + Math.trunc(aVars.GetLeftTotal() * this.mnPPTX) - Math.trunc(aVars.GetMargin().right * this.mnPPTX)) / 2);
        break;
      default: break;
    }

    let nTestClipHeight = aVars.GetTextSize().Height;
    switch (aVars.GetVerJust()) {
      case 'Top':
      case 'Block': {
        const nTop = Math.trunc(aVars.GetMargin().top * this.mnPPTY);
        nJustPosY += nTop;
        nTestClipHeight += nTop;
        break;
      }
      case 'Bottom': {
        const nBot = Math.trunc(aVars.GetMargin().bottom * this.mnPPTY);
        nJustPosY += nOutHeight - aVars.GetTextSize().Height - nBot;
        nTestClipHeight += nBot;
        break;
      }
      case 'Center': {
        const nTop = Math.trunc(aVars.GetMargin().top * this.mnPPTY);
        const nBot = Math.trunc(aVars.GetMargin().bottom * this.mnPPTY);
        nJustPosY += Math.trunc((nOutHeight + nTop - aVars.GetTextSize().Height - nBot) / 2);
        nTestClipHeight += Math.abs(nTop - nBot);
        break;
      }
      default: break;
    }

    if (nTestClipHeight > nOutHeight) {
      // no vertical clipping when printing cells with optimal height
      if (this.meType !== ScOutputType.OUTTYPE_PRINTER || this.mpDoc.IsManualRowHeight(nCellY, this.mnTab)) bVClip = true;
    }

    const ctx = this.mpDev;
    ctx.save();
    if (bHClip || bVClip) {
      // only clip the affected dimension so that not all right-aligned
      // columns are cut off when performing a non-proportional resize
      const r = aAreaParam.maClipRect.clone();
      if (!bHClip) { r.SetLeft(this.mnScrX); r.SetRight(this.mnScrX + this.mnScrW); }
      if (!bVClip) { r.SetTop(this.mnScrY); r.SetBottom(this.mnScrY + this.mnScrH); }
      ctx.beginPath();
      ctx.rect(r.Left(), r.Top(), r.GetWidth(), r.GetHeight());
      ctx.clip();
    }

    // Standard orientation: the baseline
    nJustPosY += aVars.nAscentPixel;
    this.PaintText(aVars.GetString(), aVars.aFont, this.TextColor(aVars, pPattern), pPattern, nJustPosX, nJustPosY, aVars.GetTextSize().Width);
    ctx.restore();
  }

  /** Draws a line of text at a baseline position in pixels, with underline, overline and strikeout. */
  private PaintText(rText: string, aFont: FontDesc, rColor: string, pPattern: ScPatternAttr, nX: number, nBaseY: number, nWidthPx: number): void {
    const ctx = this.mpDev;
    ctx.save();
    ctx.fillStyle = rColor;
    ctx.translate(nX, nBaseY);
    ctx.scale(this.mnPPTX, this.mnPPTY);
    ctx.font = cssFont(aFont);
    ctx.fillText(rText, 0, 0);
    ctx.restore();
    const eUnder = pPattern.GetItem('ATTR_FONT_UNDERLINE'), eOver = pPattern.GetItem('ATTR_FONT_OVERLINE');
    const bStrike = pPattern.GetItem('ATTR_FONT_CROSSEDOUT');
    if (eUnder !== 'none' || eOver !== 'none' || bStrike) {
      const m = this.mpMeasurer.GetFontMetric(aFont);
      const nLine = Math.max(1, Math.round(aFont.size * this.mnPPTY / 14));
      ctx.fillStyle = rColor;
      const deco = (y: number, style: string) => {
        ctx.fillRect(nX, Math.round(y), nWidthPx, nLine);
        if (style === 'double') ctx.fillRect(nX, Math.round(y) + 2 * nLine, nWidthPx, nLine);
      };
      if (eUnder !== 'none') deco(nBaseY + Math.max(1, m.descent * this.mnPPTY / 3), eUnder);
      if (eOver !== 'none') deco(nBaseY - m.ascent * this.mnPPTY, eOver);
      if (bStrike) deco(nBaseY - m.ascent * this.mnPPTY * 0.32, 'single');
    }
  }

  /**
   * DrawEdit: the cells DrawStrings left for the edit engine (line breaks in the text, wrapped
   * text that does not fit, edit text): each paragraph broken into lines at the cell's width
   * when wrapping, the lines aligned in the cell and clipped to it.
   */
  DrawEdit(): void {
    const aVars = new ScDrawStringsVars(this);
    for (const { nX, nArrY, nPosX, nPosY, nCellX, nCellY } of this.maEditCells) {
      const aCell = nCellY === this.mpRowInfo[nArrY]!.nRowNo && nCellX >= this.mnX1 && nCellX <= this.mnX2 ? this.mpRowInfo[nArrY]!.cellInfo(nCellX).maCell : this.GetVisibleCell(nCellX, nCellY, this.mnTab);
      if (aCell.isEmpty()) continue;
      let pPattern = this.mpDoc.GetPattern(nCellX, nCellY, this.mnTab);
      if (aCell.hasNumeric() && pPattern.GetItem('ATTR_LINEBREAK')) pPattern = pPattern.PutItems({ ATTR_LINEBREAK: false });
      aVars.SetPattern(pPattern);
      const aString = aCell.getType() === CELLTYPE_EDIT || aCell.getType() === CELLTYPE_STRING ? aCell.getString() : (aVars.SetText(aCell), aVars.GetString());
      const bBreak = aVars.GetLineBreak() || aVars.GetHorJust() === 'Block';
      let bCellIsValue = aCell.getType() === CELLTYPE_VALUE;
      if (aCell.getType() === CELLTYPE_FORMULA) bCellIsValue = aCell.getFormula()!.IsValue();
      const eOutHorJust = ScOutputData.getAlignmentFromContext(aVars.GetHorJust(), bCellIsValue, aString, pPattern, this.mbLayoutRTL, false);

      // The width of the longest line without wrapping decides the overflow into neighbours.
      const aParas = aString.split(/\r\n|\r|\n/);
      const nLeft = Math.trunc(aVars.GetLeftTotal() * this.mnPPTX), nRight = Math.trunc(aVars.GetMargin().right * this.mnPPTX);
      let nNeeded = 0;
      if (!bBreak) for (const p of aParas) nNeeded = Math.max(nNeeded, Math.ceil(this.mpMeasurer.GetTextWidth(aVars.aFont, p) * this.mnPPTX));
      const aArea = this.GetOutputArea(nX, nArrY, nPosX, nPosY, nCellX, nCellY, nNeeded + nLeft + nRight, pPattern, eOutHorJust, bCellIsValue, bBreak, false);

      // the lines (in twips widths)
      const nAvailTwips = Math.max(1, (aArea.maAlignRect.GetWidth() - nLeft - nRight) / this.mnPPTX);
      const aLines: string[] = [];
      for (const p of aParas) {
        if (!bBreak) { aLines.push(p); continue; }
        for (const l of BreakLines(p, nAvailTwips, (s) => this.mpMeasurer.GetTextWidth(aVars.aFont, s))) aLines.push(l);
      }
      const m = this.mpMeasurer.GetFontMetric(aVars.aFont);
      const nLineH = (m.ascent + m.descent) * this.mnPPTY;
      const nTextH = nLineH * aLines.length;
      const rAlign = aArea.maAlignRect;
      let nY = rAlign.Top();
      switch (aVars.GetVerJust()) {
        case 'Top': case 'Block': nY += aVars.GetMargin().top * this.mnPPTY; break;
        case 'Center': nY += (rAlign.GetHeight() - nTextH + (aVars.GetMargin().top - aVars.GetMargin().bottom) * this.mnPPTY) / 2; break;
        default: nY += rAlign.GetHeight() - nTextH - aVars.GetMargin().bottom * this.mnPPTY; break;
      }

      const ctx = this.mpDev;
      ctx.save();
      const r = aArea.maClipRect;
      ctx.beginPath();
      ctx.rect(r.Left(), r.Top(), r.GetWidth(), r.GetHeight());
      ctx.clip();
      const color = (() => { aVars.SetText(aCell); return this.TextColor(aVars, pPattern); })();
      for (const l of aLines) {
        const w = this.mpMeasurer.GetTextWidth(aVars.aFont, l) * this.mnPPTX;
        let x = rAlign.Left() + nLeft;
        if (eOutHorJust === 'Right') x = rAlign.Right() + 1 - nRight - w;
        else if (eOutHorJust === 'Center') x = rAlign.Left() + (rAlign.GetWidth() - w + nLeft - nRight) / 2;
        this.PaintText(l, aVars.aFont, color, pPattern, x, nY + m.ascent * this.mnPPTY, w);
        nY += nLineH;
      }
      ctx.restore();
    }
  }
}

/** Breaks a paragraph into lines that fit a width (in the measurer's units): at spaces, else within words. */
export function BreakLines(rText: string, nWidth: number, fnWidth: (s: string) => number): string[] {
  const out: string[] = [];
  let rest = rText;
  while (rest.length) {
    if (fnWidth(rest) <= nWidth) { out.push(rest); break; }
    // the longest prefix that fits
    let lo = 1, hi = rest.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fnWidth(rest.slice(0, mid)) <= nWidth) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    const sp = rest.lastIndexOf(' ', lo);
    if (sp > 0) cut = sp + 1;
    out.push(rest.slice(0, cut).replace(/ +$/, ''));
    rest = rest.slice(cut);
  }
  if (!out.length) out.push('');
  return out;
}
