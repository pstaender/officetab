// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/printfun.hxx reduced
// @upstream sc/source/ui/view/printfun.cxx reduced
// ScPrintFunc: the pages of one sheet as the page style lays them out: paper size, margins,
// orientation, centring, scaling (a percentage, fitting into pages wide and high, or into a
// number of pages), page order, print ranges, repeated rows and columns, manual and automatic
// page breaks (through ScTable::UpdatePageBreaks), empty pages left out, headers and footers with
// their left, centre and right areas and fields, the page border and background, the grid and the
// row and column headers; and each page painted through ScOutputData onto a canvas-like device
// (an SVG or PDF page, or a canvas), without the screen's decorations.
// Reduced: the device is in twips of the page and is given no map modes: everything is painted in
// document twips (nScaleX = nScaleY = 1) under a scale of the zoom (InitModes), where upstream
// paints in 1/100 mm through aLogicMode, aOffsetMode and aTwipMode. Headers and footers are laid
// out without an edit engine (HFLayout below: each paragraph is one line of runs in the cell
// fonts, without wrapping). Left out: notes pages (CountNotePages, PrintNotes), the drawing layer
// (objects, charts and form controls), the page shadow, background graphics, the preview
// location data, the printer's page offset, tagged PDF, the print dialog's paper size override
// and DrawToDev.
import { ScRange, SCCOL_REPEAT_NONE, SCROW_REPEAT_NONE, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { ScTableInfo } from '../../../inc/fillinfo.ts';
import { ScRefCellValue } from '../../../inc/cellvalue.ts';
import type { ScPrintOptions } from '../../../inc/printopt.ts';
import { SfxStyleFamily } from '../../../inc/stlsheet.ts';
import type { ScItemId, ScItems, ScItemSet, ScPageHFItem, ScPageHFSetItem, SvxBorderLine, SvxBoxItem } from '../../../inc/scitems.ts';
import { ScColToAlpha } from '../../../inc/address.ts';
import type { EditTextObject, EditCharAttribs } from '../../../../editeng/source/editeng/editobj.ts';
import { cssFont, type FontDesc, type TextMeasurer } from '../../../../vcl/source/outdev/text.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { FillInfo } from '../../core/data/fillinfo.ts';
import { CalcFieldValue, ScHeaderFieldData } from '../../core/tool/editutil.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import type { ScPageBreakData } from '../docshell/pagedata.ts';
import { ScOutputData, ScOutputType, type ScRenderContext } from './output.ts';

const RANGENO_NORANGE = 0xffff;
/** 1 cm */
export const PRINT_HEADER_WIDTH = 567;
/** 12.8 pt */
export const PRINT_HEADER_HEIGHT = 256;
const ZOOM_MIN = 10;
/** The size of a device pixel in page twips: a 300 dpi printer's (pDev->PixelToLogic(Size(1,1))). */
const PRINTER_PIXEL_TWIPS = 1440 / 300;

/** A measurer for when the document has no reference device: widths and heights from the font size. */
const ROUGH_MEASURER: TextMeasurer = {
  GetTextWidth: (f, t) => t.length * f.size * 0.5,
  GetFontMetric: (f) => ({ ascent: f.size * 0.905, descent: f.size * 0.212 }),
};

/** Settings for headers/footers */
export interface ScPrintHFParam {
  bEnable: boolean;
  bDynamic: boolean;
  bShared: boolean;
  bSharedFirst: boolean;
  /** in total (height + distance + frames) */
  nHeight: number;
  /** set size (min when dynamic) */
  nManHeight: number;
  nDistance: number;
  /** edges */
  nLeft: number;
  nRight: number;
  pLeft: ScPageHFItem | null;
  pRight: ScPageHFItem | null;
  pFirst: ScPageHFItem | null;
  pBorder: SvxBoxItem | null;
  pBack: string | null;
}

const NewHFParam = (): ScPrintHFParam => ({
  bEnable: false, bDynamic: false, bShared: false, bSharedFirst: false, nHeight: 0, nManHeight: 0, nDistance: 0,
  nLeft: 0, nRight: 0, pLeft: null, pRight: null, pFirst: null, pBorder: null, pBack: null,
});

/** ScPageTableParam (pagepar.hxx) */
export interface ScPageTableParam {
  bCellContent: boolean; bNotes: boolean; bGrid: boolean; bHeaders: boolean; bCharts: boolean; bObjects: boolean; bDrawings: boolean;
  bFormulas: boolean; bNullVals: boolean; bTopDown: boolean; bLeftRight: boolean; bSkipEmpty: boolean;
  bScaleNone: boolean; bScaleAll: boolean; bScaleTo: boolean; bScalePageNum: boolean; bForceBreaks: boolean;
  nScaleAll: number; nScaleWidth: number; nScaleHeight: number; nScalePageNum: number; nFirstPageNo: number;
}

/** ScPageAreaParam (pagepar.hxx) */
export interface ScPageAreaParam { bPrintArea: boolean; bRepeatRow: boolean; bRepeatCol: boolean; aPrintArea: ScRange; aRepeatRow: ScRange; aRepeatCol: ScRange }

export class ScPageRowEntry {
  private nStartRow: SCROW = 0;
  private nEndRow: SCROW = 0;
  private nPagesX = 0;
  private aHidden: boolean[] = [];
  //!     Cache Number of really visible?

  clone(): ScPageRowEntry {
    const r = new ScPageRowEntry();
    r.nStartRow = this.nStartRow;
    r.nEndRow = this.nEndRow;
    r.nPagesX = this.nPagesX;
    r.aHidden = this.aHidden.slice(0, this.nPagesX);
    return r;
  }

  GetStartRow(): SCROW { return this.nStartRow; }
  GetEndRow(): SCROW { return this.nEndRow; }
  GetPagesX(): number { return this.nPagesX; }
  SetStartRow(n: SCROW): void { this.nStartRow = n; }
  SetEndRow(n: SCROW): void { this.nEndRow = n; }

  SetPagesX(nNew: number): void {
    this.nPagesX = nNew;
    this.aHidden.length = this.nPagesX;
    this.aHidden.fill(false);
  }

  SetHidden(nX: number): void {
    if (nX < this.nPagesX) {
      if (nX + 1 === this.nPagesX) // last page?
        --this.nPagesX;
      else {
        this.aHidden[nX] = true;
      }
    }
  }

  IsHidden(nX: number): boolean { return nX >= this.nPagesX || !!this.aHidden[nX]; }

  CountVisible(): number {
    let nVis = 0;
    for (let i = 0; i < this.nPagesX; i++) if (!this.aHidden[i]) ++nVis;
    return nVis;
  }
}

/** sc::PrintPageRangesInput */
export class PrintPageRangesInput {
  m_bSkipEmpty = false;
  m_bPrintArea = false;
  m_aRange = new ScRange();
  m_aDocSize = { Width: 0, Height: 0 };

  constructor(bSkipEmpty = false, bPrintArea = false, rRange: ScRange = new ScRange(), rDocSize = { Width: 0, Height: 0 }) {
    this.m_bSkipEmpty = bSkipEmpty;
    this.m_bPrintArea = bPrintArea;
    this.m_aRange = rRange;
    this.m_aDocSize = rDocSize;
  }

  equals(rInput: PrintPageRangesInput): boolean {
    return this.m_bSkipEmpty === rInput.m_bSkipEmpty && this.m_bPrintArea === rInput.m_bPrintArea && this.m_aRange.equals(rInput.m_aRange)
      && this.m_aDocSize.Width === rInput.m_aDocSize.Width && this.m_aDocSize.Height === rInput.m_aDocSize.Height;
  }

  getStartRow(): SCROW { return this.m_aRange.aStart.Row(); }
  getEndRow(): SCROW { return this.m_aRange.aEnd.Row(); }
  getStartColumn(): SCCOL { return this.m_aRange.aStart.Col(); }
  getEndColumn(): SCCOL { return this.m_aRange.aEnd.Col(); }
  getPrintTab(): SCTAB { return this.m_aRange.aStart.Tab(); }
}

function lcl_SetHidden(rDoc: ScDocument, nPrintTab: SCTAB, rPageRowEntry: ScPageRowEntry, nStartCol: SCCOL, rPageEndX: readonly SCCOL[]): void {
  const nPagesX = rPageRowEntry.GetPagesX();
  const nStartRow = rPageRowEntry.GetStartRow();
  const nEndRow = rPageRowEntry.GetEndRow();

  let bLeftIsEmpty = false;

  for (let i = 0; i < nPagesX; i++) {
    const nEndCol = rPageEndX[i]!;
    if (rDoc.IsPrintEmpty(nStartCol, nStartRow, nEndCol, nEndRow, nPrintTab, bLeftIsEmpty, rDoc.GetRefDevice())) {
      rPageRowEntry.SetHidden(i);
      bLeftIsEmpty = true;
    } else bLeftIsEmpty = false;

    nStartCol = nEndCol + 1;
  }
}

/** sc::PrintPageRanges: the columns and rows where the pages of a print range end. */
export class PrintPageRanges {
  m_xPageEndX: SCCOL[] = [];
  m_xPageEndY: SCROW[] = [];
  m_xPageRows = new Map<number, ScPageRowEntry>();
  m_nPagesX = 0;
  m_nPagesY = 0;
  m_nTotalY = 0;
  m_aInput = new PrintPageRangesInput();
  /** Whether m_aInput was set (upstream compares with the default input). */
  private m_bCalculated = false;

  clone(): PrintPageRanges {
    const r = new PrintPageRanges();
    r.m_xPageEndX = this.m_xPageEndX;
    r.m_xPageEndY = this.m_xPageEndY;
    r.m_xPageRows = this.m_xPageRows;
    r.m_nPagesX = this.m_nPagesX;
    r.m_nPagesY = this.m_nPagesY;
    r.m_nTotalY = this.m_nTotalY;
    r.m_aInput = this.m_aInput;
    r.m_bCalculated = this.m_bCalculated;
    return r;
  }

  /** The page row nY (std::map's operator[] creates it). */
  PageRow(nY: number): ScPageRowEntry {
    let r = this.m_xPageRows.get(nY);
    if (!r) { r = new ScPageRowEntry(); this.m_xPageRows.set(nY, r); }
    return r;
  }

  calculate(rDoc: ScDocument, rInput: PrintPageRangesInput): void {
    // Already calculated?
    if (this.m_bCalculated && this.m_aInput.equals(rInput)) return;

    this.m_aInput = rInput;
    this.m_bCalculated = true;

    rDoc.SetPageSize(this.m_aInput.getPrintTab(), this.m_aInput.m_aDocSize);

    // Clear the map to prevent any outdated values to "survive" when
    // we have to recalculate the new values anyway
    this.m_xPageRows = new Map();
    this.m_xPageEndX = [];
    this.m_xPageEndY = [];

    if (this.m_aInput.m_bPrintArea) {
      const aRange = new ScRange(this.m_aInput.getStartColumn(), this.m_aInput.getStartRow(), this.m_aInput.getPrintTab(), this.m_aInput.getEndColumn(), this.m_aInput.getEndRow(), this.m_aInput.getPrintTab());
      rDoc.UpdatePageBreaks(this.m_aInput.getPrintTab(), aRange);
    } else {
      rDoc.UpdatePageBreaks(this.m_aInput.getPrintTab()); // else, end is marked
    }

    //  Page alignment/splitting after breaks in Col/RowFlags
    //  Of several breaks in a hidden area, only one counts.

    this.m_nPagesX = 0;
    this.m_nPagesY = 0;
    this.m_nTotalY = 0;

    let bVisCol = false;
    for (let i = this.m_aInput.getStartColumn(); i <= this.m_aInput.getEndColumn(); i++) {
      const bHidden = rDoc.ColHidden(i, this.m_aInput.getPrintTab());
      const bPageBreak = (rDoc.HasColBreak(i, this.m_aInput.getPrintTab()) & 0x01 /* ScBreakType::Page */) !== 0;
      if (i > this.m_aInput.getStartColumn() && bVisCol && bPageBreak) {
        this.m_xPageEndX[this.m_nPagesX] = i - 1;
        ++this.m_nPagesX;
        bVisCol = false;
      }
      if (!bHidden) bVisCol = true;
    }
    if (bVisCol) { // also at the end, no empty pages
      this.m_xPageEndX[this.m_nPagesX] = this.m_aInput.getEndColumn();
      ++this.m_nPagesX;
    }

    let bVisRow = false;
    let nPageStartRow = this.m_aInput.getStartRow();
    let nLastVisibleRow = -1;

    const aRowBreaks = rDoc.GetAllRowBreaks(this.m_aInput.getPrintTab(), true, false);
    let nBreakIdx = 0;
    const NOT_FOUND = -1;
    let nNextPageBreak = aRowBreaks.length ? aRowBreaks[0]! : NOT_FOUND;
    while (nNextPageBreak !== NOT_FOUND && nNextPageBreak < this.m_aInput.getStartRow())
      // Skip until the page break position is at the start row or greater.
      nNextPageBreak = ++nBreakIdx < aRowBreaks.length ? aRowBreaks[nBreakIdx]! : NOT_FOUND;

    for (let nRow = this.m_aInput.getStartRow(); nRow <= this.m_aInput.getEndRow(); ++nRow) {
      const bPageBreak = nNextPageBreak === nRow;
      if (bPageBreak) nNextPageBreak = ++nBreakIdx < aRowBreaks.length ? aRowBreaks[nBreakIdx]! : NOT_FOUND;

      if (nRow > this.m_aInput.getStartRow() && bVisRow && bPageBreak) {
        this.m_xPageEndY[this.m_nTotalY] = nRow - 1;
        ++this.m_nTotalY;

        if (!this.m_aInput.m_bSkipEmpty || !rDoc.IsPrintEmpty(this.m_aInput.getStartColumn(), nPageStartRow, this.m_aInput.getEndColumn(), nRow - 1, this.m_aInput.getPrintTab(), false, rDoc.GetRefDevice())) {
          const rPageRow = this.PageRow(this.m_nPagesY);
          rPageRow.SetStartRow(nPageStartRow);
          rPageRow.SetEndRow(nRow - 1);
          rPageRow.SetPagesX(this.m_nPagesX);
          if (this.m_aInput.m_bSkipEmpty) lcl_SetHidden(rDoc, this.m_aInput.getPrintTab(), rPageRow, this.m_aInput.getStartColumn(), this.m_xPageEndX);
          ++this.m_nPagesY;
        }

        nPageStartRow = nRow;
        bVisRow = false;
      }

      if (nRow <= nLastVisibleRow) {
        // This row is still visible.  Don't bother calling RowHidden() to
        // find out, for speed optimization.
        bVisRow = true;
        continue;
      }

      const t = rDoc.FetchTable(this.m_aInput.getPrintTab());
      const r = t ? t.RowHiddenRange(nRow) : { bHidden: false, nFirstRow: nRow, nLastRow: rDoc.MaxRow() };
      const nLastRow = r.nLastRow;
      if (!r.bHidden) {
        bVisRow = true;
        nLastVisibleRow = nLastRow;
      } else {
        // Skip all hidden rows until next pagebreak.
        nRow = nNextPageBreak === NOT_FOUND ? nLastRow : Math.min(nLastRow, nNextPageBreak - 1);
      }
    }

    if (!bVisRow) return;

    this.m_xPageEndY[this.m_nTotalY] = this.m_aInput.getEndRow();
    ++this.m_nTotalY;

    if (!this.m_aInput.m_bSkipEmpty || !rDoc.IsPrintEmpty(this.m_aInput.getStartColumn(), nPageStartRow, this.m_aInput.getEndColumn(), this.m_aInput.getEndRow(), this.m_aInput.getPrintTab(), false, rDoc.GetRefDevice())) {
      const rPageRow = this.PageRow(this.m_nPagesY);
      rPageRow.SetStartRow(nPageStartRow);
      rPageRow.SetEndRow(this.m_aInput.getEndRow());
      rPageRow.SetPagesX(this.m_nPagesX);
      if (this.m_aInput.m_bSkipEmpty) lcl_SetHidden(rDoc, this.m_aInput.getPrintTab(), rPageRow, this.m_aInput.getStartColumn(), this.m_xPageEndX);
      ++this.m_nPagesY;
    }
  }
}

/** Used to save expensive-to-compute data from ScPrintFunc in between uses of ScPrintFunc */
export class ScPrintState {
  nPrintTab: SCTAB = 0;
  nStartCol: SCCOL = 0;
  nStartRow: SCROW = 0;
  nEndCol: SCCOL = 0;
  nEndRow: SCROW = 0;
  /** the 4 variables above are set */
  bPrintAreaValid = false;
  nZoom = 0;
  nTabPages = 0;
  nTotalPages = 0;
  nPageStart = 0;
  nDocPages = 0;
  // Additional state of page ranges
  m_aRanges = new PrintPageRanges();
}

/** A selection of pages (MultiSelection): IsSelected(n) for 1-based page numbers. */
export interface ScPageSelection { IsSelected(nPage: number): boolean; GetMax(): number }
/** MultiSelection of the pages nFirst..nLast (1-based). */
export function PageRange(nFirst: number, nLast: number = nFirst): ScPageSelection {
  return { IsSelected: (n) => n >= nFirst && n <= nLast, GetMax: () => nLast };
}

/** A run of a header or footer line: its text in a font and colour. */
interface HFRun { aText: string; aFont: FontDesc; aColor: string; eUnderline: string; bStrike: boolean; nWidth: number }
interface HFLine { aRuns: HFRun[]; nWidth: number; nAscent: number; nDescent: number }

/**
 * The header and footer text of one area laid out (ScHeaderEditEngine, reduced): each paragraph
 * is a line of runs in their fonts, fields replaced by their values (CalcFieldValue).
 */
class HFLayout {
  readonly aLines: HFLine[] = [];
  readonly nHeight: number;

  constructor(rObject: EditTextObject, rData: ScHeaderFieldData, aDefault: FontDesc, rMeasurer: TextMeasurer) {
    let nHeight = 0;
    for (const p of rObject.GetParagraphs()) {
      const aRuns: HFRun[] = [];
      // the boundaries of the attribute runs
      const aBounds = new Set<number>([0, p.aText.length]);
      for (const a of p.maCharAttribs) { aBounds.add(Math.max(0, Math.min(p.aText.length, a.nStart))); aBounds.add(Math.max(0, Math.min(p.aText.length, a.nEnd))); }
      const aSorted = [...aBounds].sort((a, b) => a - b);
      for (let i = 0; i + 1 < aSorted.length; i++) {
        const nStart = aSorted[i]!, nEnd = aSorted[i + 1]!;
        const aAttr: EditCharAttribs = {};
        for (const a of p.maCharAttribs) if (a.nStart <= nStart && a.nEnd >= nEnd) Object.assign(aAttr, a.aAttribs);
        const aText = aAttr.FIELD ? CalcFieldValue(aAttr.FIELD, rData) : p.aText.slice(nStart, nEnd);
        // a field covers its representation: the next run starts after it
        const aFont: FontDesc = {
          family: aAttr.ATTR_FONT ?? aDefault.family, size: aAttr.ATTR_FONT_HEIGHT ?? aDefault.size,
          bold: aAttr.ATTR_FONT_WEIGHT ?? aDefault.bold, italic: aAttr.ATTR_FONT_POSTURE ?? aDefault.italic,
        };
        aRuns.push({ aText, aFont, aColor: aAttr.ATTR_FONT_COLOR ?? '#000000', eUnderline: aAttr.ATTR_FONT_UNDERLINE ?? 'none', bStrike: !!aAttr.ATTR_FONT_CROSSEDOUT, nWidth: aText ? rMeasurer.GetTextWidth(aFont, aText) : 0 });
      }
      let nAscent = 0, nDescent = 0, nWidth = 0;
      const aMetricFonts = aRuns.length ? aRuns.map((r) => r.aFont) : [aDefault];
      for (const f of aMetricFonts) {
        const m = rMeasurer.GetFontMetric(f);
        nAscent = Math.max(nAscent, m.ascent);
        nDescent = Math.max(nDescent, m.descent);
      }
      for (const r of aRuns) nWidth += r.nWidth;
      this.aLines.push({ aRuns, nWidth, nAscent, nDescent });
      nHeight += Math.ceil(nAscent + nDescent);
    }
    this.nHeight = nHeight;
  }

  /** DrawText_ToPosition: the lines aligned in the paper width from aPos. */
  Draw(pDev: ScRenderContext, nX: number, nY: number, nPaperWidth: number, eAdjust: 'Left' | 'Center' | 'Right'): void {
    for (const l of this.aLines) {
      let x = nX;
      if (eAdjust === 'Center') x += (nPaperWidth - l.nWidth) / 2;
      else if (eAdjust === 'Right') x += nPaperWidth - l.nWidth;
      const nBaseY = nY + l.nAscent;
      for (const r of l.aRuns) {
        if (r.aText) {
          pDev.fillStyle = r.aColor;
          pDev.font = cssFont(r.aFont);
          pDev.fillText(r.aText, x, nBaseY);
          const nLine = Math.max(1, Math.round(r.aFont.size / 14));
          if (r.eUnderline !== 'none') pDev.fillRect(x, nBaseY + l.nDescent / 3, r.nWidth, nLine);
          if (r.bStrike) pDev.fillRect(x, nBaseY - l.nAscent * 0.32, r.nWidth, nLine);
        }
        x += r.nWidth;
      }
      nY += Math.ceil(l.nAscent + l.nDescent);
    }
  }
}

const lcl_LineTotal = (pLine: SvxBorderLine | null | undefined): number => (pLine ? pLine.width : 0);

function lcl_HidePrint(rTabInfo: ScTableInfo, nX1: SCCOL, nX2: SCCOL): void {
  for (let nArrY = 1; nArrY + 1 < rTabInfo.mnArrCount; nArrY++) {
    const pThisRowInfo = rTabInfo.mpRowInfo[nArrY]!;
    for (let nX = nX1; nX <= nX2; nX++) {
      const rCellInfo = pThisRowInfo.cellInfo(nX);
      const rBasicCellInfo = pThisRowInfo.basicCellInfo(nX);
      if (!rBasicCellInfo.bEmptyCellText) {
        if (rCellInfo.pPatternAttr?.GetItem('ATTR_PROTECTION').bHidePrint) {
          rCellInfo.maCell = new ScRefCellValue();
          rBasicCellInfo.bEmptyCellText = true;
        }
      }
    }
  }
}

function lcl_FillHFParam(rParam: ScPrintHFParam, pHFSet: ScPageHFSetItem | null): void {
  //  nDistance must be initialized differently before
  if (pHFSet === null) {
    rParam.bEnable = false;
    rParam.pBorder = null;
    rParam.pBack = null;
  } else {
    rParam.bEnable = pHFSet.bOn;
    rParam.bDynamic = pHFSet.bDynamic;
    rParam.bShared = pHFSet.bShared;
    rParam.bSharedFirst = pHFSet.bSharedFirst;
    rParam.nHeight = pHFSet.nHeight;
    rParam.nLeft = Math.max(0, pHFSet.nLeft);
    rParam.nRight = Math.max(0, pHFSet.nRight);
    rParam.pBorder = pHFSet.aBorder;
    rParam.pBack = pHFSet.aBackground;

    //   now back in the dialog:
    //      rParam.nHeight += rParam.nDistance;             // not in the dialog any more ???

    rParam.nHeight += lcl_LineTotal(rParam.pBorder.top) + lcl_LineTotal(rParam.pBorder.bottom);

    rParam.nManHeight = rParam.nHeight;
  }

  if (!rParam.bEnable) rParam.nHeight = 0;
}

/** tools::Rectangle in document twips (inclusive right and bottom). */
interface TwipRect { nLeft: number; nTop: number; nRight: number; nBottom: number }
const RectWidth = (r: TwipRect) => r.nRight - r.nLeft + 1;
const RectHeight = (r: TwipRect) => r.nBottom - r.nTop + 1;

export class ScPrintFunc {
  private readonly rDocShell: ScDocShell;
  private readonly rDoc: ScDocument;
  private pDev: ScRenderContext | null;
  private readonly pMeasurer: TextMeasurer;
  /** Zoom in Preview (percent) */
  private nManualZoom = 100;
  /** Clear output before */
  private bClearWin = false;
  private bUseStyleColor = false;
  private bIsRender = false;

  private nPrintTab: SCTAB;
  /** Offset for the first page */
  private nPageStart: number;
  /** Number of Pages in Document */
  private nDocPages: number;
  /** Selection, if set in dialog */
  private readonly pUserArea: ScRange | null;
  /** Selected template */
  private pParamSet: ScItemSet | null = null;
  private readonly pStyleGet: (<K extends ScItemId>(k: K) => ScItems[K]) | null = null;
  /** created from State-struct */
  private readonly bFromPrintState: boolean;

  //  Parameter from template:
  private nLeftMargin = 0;
  private nTopMargin = 0;
  private nRightMargin = 0;
  private nBottomMargin = 0;
  private bCenterHor = false;
  private bCenterVer = false;
  private bLandscape = false;
  private bSourceRangeValid = false;

  private nPageUsage: 'All' | 'Left' | 'Right' | 'Mirror' = 'All';
  /** Printer Twips */
  private aPageSize = { Width: 0, Height: 0 };
  private pBorderItem: SvxBoxItem | null = null;
  private pBackgroundItem: string | null = null;

  private aLastSourceRange = new ScRange();
  private aHdr = NewHFParam();
  private aFtr = NewHFParam();
  private aTableParam = {} as ScPageTableParam;
  private aAreaParam: ScPageAreaParam = { bPrintArea: false, bRepeatRow: false, bRepeatCol: false, aPrintArea: new ScRange(), aRepeatRow: new ScRange(), aRepeatCol: new ScRange() };

  // Calculated values:
  private nZoom = 100;
  private bPrintCurrentTable = false;
  private bMultiArea = false;
  private mbHasPrintRange = true;
  private nTabPages = 0;
  private nTotalPages = 0;

  /** Document Twips */
  private aPageRect: TwipRect = { nLeft: 0, nTop: 0, nRight: 0, nBottom: 0 };
  /** The zoom the page is painted with (aLogicMode, aOffsetMode and aTwipMode). */
  private mfZoom = 1;
  private nScaleX = 1;
  private nScaleY = 1;

  private nRepeatStartCol: SCCOL = SCCOL_REPEAT_NONE;
  private nRepeatEndCol: SCCOL = SCCOL_REPEAT_NONE;
  private nRepeatStartRow: SCROW = SCROW_REPEAT_NONE;
  private nRepeatEndRow: SCROW = SCROW_REPEAT_NONE;

  private nStartCol: SCCOL = 0;
  private nStartRow: SCROW = 0;
  private nEndCol: SCCOL = 0;
  private nEndRow: SCROW = 0;
  /** the 4 variables above are set */
  private bPrintAreaValid = false;

  private m_aRanges = new PrintPageRanges();

  private aFieldData = new ScHeaderFieldData();
  /** for recording the breaks etc. */
  private pPageData: ScPageBreakData | null;

  /**
   * ScPrintFunc(pOutDev, rShell, nTab, nPage, nDocP, pArea, pOptions), or with a ScPrintState
   * for rTab (the ctor from a state). pData records the breaks (the printer ctor's argument).
   * pOutDev is null for counting pages only.
   */
  constructor(pOutDev: ScRenderContext | null, rShell: ScDocShell, rTab: SCTAB | ScPrintState, nPage = 0, nDocP = 0, pArea: ScRange | null = null, pOptions: ScPrintOptions | null = null, pData: ScPageBreakData | null = null) {
    this.rDocShell = rShell;
    this.rDoc = rShell.GetDocument();
    this.pDev = pOutDev;
    this.pMeasurer = this.rDoc.GetRefDevice() ?? ROUGH_MEASURER;
    this.pUserArea = pArea;
    this.pPageData = pData;
    if (rTab instanceof ScPrintState) {
      const rState = rTab;
      this.nPrintTab = rState.nPrintTab;
      this.nStartCol = rState.nStartCol;
      this.nStartRow = rState.nStartRow;
      this.nEndCol = rState.nEndCol;
      this.nEndRow = rState.nEndRow;
      this.bPrintAreaValid = rState.bPrintAreaValid;
      this.nZoom = rState.nZoom;
      this.m_aRanges = rState.m_aRanges.clone();
      this.nTabPages = rState.nTabPages;
      this.nTotalPages = rState.nTotalPages;
      this.nPageStart = rState.nPageStart;
      this.nDocPages = rState.nDocPages;
      this.bFromPrintState = true;
    } else {
      this.nPrintTab = rTab;
      this.nPageStart = nPage;
      this.nDocPages = nDocP;
      this.bFromPrintState = false;
    }
    const pStyleSheet = this.rDoc.GetStyleSheetPool().Find(this.rDoc.GetPageStyle(this.nPrintTab), SfxStyleFamily.Page);
    if (pStyleSheet) {
      this.pParamSet = pStyleSheet.GetItemSet();
      this.pStyleGet = (k) => pStyleSheet.GetItem(k);
    }
    this.Construct(pOptions);
  }

  private Construct(pOptions: ScPrintOptions | null): void {
    if (!this.bFromPrintState) this.nZoom = 100;
    this.nManualZoom = 100;
    this.bClearWin = false;
    this.bUseStyleColor = false;
    this.bIsRender = false;

    this.InitParam(pOptions);

    this.pPageData = null; // is only needed for initialisation
  }

  private Get<K extends ScItemId>(k: K): ScItems[K] { return this.pStyleGet!(k); }

  GetPrintState(rState: ScPrintState = new ScPrintState()): ScPrintState {
    rState.nPrintTab = this.nPrintTab;
    rState.nStartCol = this.nStartCol;
    rState.nStartRow = this.nStartRow;
    rState.nEndCol = this.nEndCol;
    rState.nEndRow = this.nEndRow;
    rState.bPrintAreaValid = this.bPrintAreaValid;
    rState.nZoom = this.nZoom;
    rState.nTabPages = this.nTabPages;
    rState.nTotalPages = this.nTotalPages;
    rState.nPageStart = this.nPageStart;
    rState.nDocPages = this.nDocPages;
    rState.m_aRanges = this.m_aRanges.clone();
    return rState;
  }

  GetLastSourceRange(): ScRange | null { return this.bSourceRangeValid ? this.aLastSourceRange : null; }

  private FillPageData(): void {
    if (!this.pPageData) return;

    const nCount = this.pPageData.GetCount();
    const rData = this.pPageData.GetData(nCount); // count up

    rData.SetPrintRange(new ScRange(this.nStartCol, this.nStartRow, this.nPrintTab, this.nEndCol, this.nEndRow, this.nPrintTab));
    // #i123672#
    if (this.m_aRanges.m_xPageEndX.length) rData.SetPagesX(this.m_aRanges.m_nPagesX, this.m_aRanges.m_xPageEndX);

    // #i123672#
    if (this.m_aRanges.m_xPageEndY.length) rData.SetPagesY(this.m_aRanges.m_nTotalY, this.m_aRanges.m_xPageEndY);

    //  Settings
    rData.SetTopDown(this.aTableParam.bTopDown);
    rData.SetAutomatic(!this.aAreaParam.bPrintArea);
  }

  //  bNew = TRUE:    search for used part of the document
  //  bNew = FALSE:   only limit whole lines/columns

  private AdjustPrintArea(bNew: boolean): boolean {
    const nOldEndCol = this.nEndCol; // only important for !bNew
    const nOldEndRow = this.nEndRow;
    let bChangeCol = true; // at bNew both are being adjusted
    let bChangeRow = true;

    const bNotes = this.aTableParam.bNotes;
    if (bNew) {
      this.nStartCol = 0;
      this.nStartRow = 0;
      const a = this.rDoc.GetPrintArea(this.nPrintTab, bNotes);
      this.nEndCol = a.nEndCol;
      this.nEndRow = a.nEndRow;
      if (!a.bFound && this.aTableParam.bSkipEmpty) return false; // nothing
      this.bPrintAreaValid = true;
    } else {
      let bFound = true;
      bChangeCol = this.nStartCol === 0 && this.nEndCol === this.rDoc.MaxCol();
      bChangeRow = this.nStartRow === 0 && this.nEndRow === this.rDoc.MaxRow();
      let bForcedChangeRow = false;

      // #i53558# Crop entire column of old row limit to real print area with
      // some fuzzyness.
      if (!bChangeRow && this.nStartRow === 0) {
        const r = this.rDoc.GetPrintAreaVer(this.nPrintTab, this.nStartCol, this.nEndCol, bNotes);
        bFound = r.bFound;
        const nPAEndRow = r.rEndRow;
        // Say we don't want to print more than ~1000 empty rows, which are
        // about 14 pages intentionally left blank...
        const nFuzzy = 23 * 42;
        if (nPAEndRow + nFuzzy < this.nEndRow) {
          bForcedChangeRow = true;
          this.nEndRow = nPAEndRow;
        } else bFound = true; // user seems to _want_ to print some empty rows
      }
      // TODO: in case we extend the number of columns we may have to do the
      // same for horizontal cropping.

      if (bChangeCol && bChangeRow) {
        const a = this.rDoc.GetPrintArea(this.nPrintTab, bNotes);
        bFound = a.bFound; this.nEndCol = a.nEndCol; this.nEndRow = a.nEndRow;
      } else if (bChangeCol) {
        const a = this.rDoc.GetPrintAreaHor(this.nPrintTab, this.nStartRow, this.nEndRow);
        bFound = a.bFound; this.nEndCol = a.rEndCol;
      } else if (bChangeRow) {
        const a = this.rDoc.GetPrintAreaVer(this.nPrintTab, this.nStartCol, this.nEndCol, bNotes);
        bFound = a.bFound; this.nEndRow = a.rEndRow;
      }

      if (!bFound) return false; // empty

      this.bPrintAreaValid = true;
      if (bForcedChangeRow) bChangeRow = true;
    }

    const m = this.rDoc.ExtendMerge(this.nStartCol, this.nStartRow, this.nEndCol, this.nEndRow, this.nPrintTab); // no Refresh, incl. Attrs
    this.nEndCol = m.nEndCol;
    this.nEndRow = m.nEndRow;

    if (bChangeCol) {
      this.nEndCol = this.rDoc.ExtendPrintArea(this.pMeasurer, this.nPrintTab, this.nStartCol, this.nStartRow, this.nEndCol, this.nEndRow);
      // changing nEndCol
    }

    // the shadow attributes (HasAttrFlags::ShadowRight / ShadowDown) are not modelled

    if (!bChangeCol) this.nEndCol = nOldEndCol;
    if (!bChangeRow) this.nEndRow = nOldEndRow;

    return true;
  }

  private DefaultFont(): FontDesc {
    const p = this.rDoc.getCellAttributeHelper().getDefaultCellAttribute();
    return { family: p.GetItem('ATTR_FONT'), size: p.GetItem('ATTR_FONT_HEIGHT'), bold: p.GetItem('ATTR_FONT_WEIGHT'), italic: p.GetItem('ATTR_FONT_POSTURE') };
  }

  private TextHeight(pObject: EditTextObject | null): number {
    if (!pObject) return 0;
    return new HFLayout(pObject, this.aFieldData, this.DefaultFont(), this.pMeasurer).nHeight;
  }

  //  nZoom must be set !!!
  //  and the respective Twip-MapMode configured
  private UpdateHFHeight(rParam: ScPrintHFParam): void {
    if (!(rParam.bEnable && rParam.bDynamic)) return;

    //  calculate nHeight from content
    let nPaperWidth = Math.trunc(((this.aPageSize.Width - this.nLeftMargin - this.nRightMargin - rParam.nLeft - rParam.nRight) * 100) / this.nZoom);
    if (rParam.pBorder) nPaperWidth -= Math.trunc(((lcl_LineTotal(rParam.pBorder.left) + lcl_LineTotal(rParam.pBorder.right)) * 100) / this.nZoom);

    if (nPaperWidth <= 0) return; // Header/Footer unreasonably narrow width, cannot calculate height

    let nMaxHeight = 0;
    for (const p of [rParam.pLeft, rParam.pRight, rParam.pFirst]) {
      if (!p) continue;
      nMaxHeight = Math.max(nMaxHeight, this.TextHeight(p.pLeftArea));
      nMaxHeight = Math.max(nMaxHeight, this.TextHeight(p.pCenterArea));
      nMaxHeight = Math.max(nMaxHeight, this.TextHeight(p.pRightArea));
    }

    rParam.nHeight = nMaxHeight + rParam.nDistance;
    if (rParam.pBorder) rParam.nHeight += lcl_LineTotal(rParam.pBorder.top) + lcl_LineTotal(rParam.pBorder.bottom);

    if (rParam.nHeight < rParam.nManHeight) rParam.nHeight = rParam.nManHeight; // configured minimum
  }

  private InitParam(pOptions: ScPrintOptions | null): void {
    if (!this.pParamSet) return;

    // TabPage "Page"
    const pLRItem = this.Get('ATTR_LRSPACE');
    this.nLeftMargin = Math.max(0, pLRItem.nLeft);
    this.nRightMargin = Math.max(0, pLRItem.nRight);
    const pULItem = this.Get('ATTR_ULSPACE');
    this.nTopMargin = pULItem.nUpper;
    this.nBottomMargin = pULItem.nLower;

    const pPageItem = this.Get('ATTR_PAGE');
    this.nPageUsage = pPageItem.eUse;
    this.bLandscape = pPageItem.bLandscape;
    this.aFieldData.eNumType = pPageItem.eNumType;

    this.bCenterHor = this.Get('ATTR_PAGE_HORCENTER');
    this.bCenterVer = this.Get('ATTR_PAGE_VERCENTER');

    const aSize = this.Get('ATTR_PAGE_SIZE');
    this.aPageSize = { Width: aSize.nWidth, Height: aSize.nHeight };
    if (!this.aPageSize.Width || !this.aPageSize.Height) this.aPageSize = { Width: 11906, Height: 16838 }; // PAPER_A4

    const pBorder = this.Get('ATTR_BORDER');
    this.pBorderItem = pBorder.top || pBorder.bottom || pBorder.left || pBorder.right ? pBorder : null;
    this.pBackgroundItem = this.Get('ATTR_BACKGROUND');

    // TabPage "Headline"

    this.aHdr.pLeft = this.Get('ATTR_PAGE_HEADERLEFT'); // Content
    this.aHdr.pRight = this.Get('ATTR_PAGE_HEADERRIGHT');
    this.aHdr.pFirst = this.Get('ATTR_PAGE_HEADERFIRST');

    const pHeaderSet = this.Get('ATTR_PAGE_HEADERSET');
    // Headline has space below
    this.aHdr.nDistance = pHeaderSet.nLower;
    lcl_FillHFParam(this.aHdr, pHeaderSet);

    // TabPage "Footline"

    this.aFtr.pLeft = this.Get('ATTR_PAGE_FOOTERLEFT'); // Content
    this.aFtr.pRight = this.Get('ATTR_PAGE_FOOTERRIGHT');
    this.aFtr.pFirst = this.Get('ATTR_PAGE_FOOTERFIRST');

    const pFooterSet = this.Get('ATTR_PAGE_FOOTERSET');
    // Footline has space above
    this.aFtr.nDistance = pFooterSet.nUpper;
    lcl_FillHFParam(this.aFtr, pFooterSet);

    // Compile Table-/Area-Params from single Items

    // TabPage "Table"

    const nScaleAll = this.Get('ATTR_PAGE_SCALE');
    const pScaleToItem = this.Get('ATTR_PAGE_SCALETO');
    const nScaleToPages = this.Get('ATTR_PAGE_SCALETOPAGES');

    const t = this.aTableParam;
    t.bCellContent = true;
    t.bNotes = this.Get('ATTR_PAGE_NOTES');
    t.bGrid = this.Get('ATTR_PAGE_GRID');
    t.bHeaders = this.Get('ATTR_PAGE_HEADERS');
    t.bFormulas = this.Get('ATTR_PAGE_FORMULAS');
    t.bNullVals = this.Get('ATTR_PAGE_NULLVALS');
    t.bCharts = this.Get('ATTR_PAGE_CHARTS') === 'Show';
    t.bObjects = this.Get('ATTR_PAGE_OBJECTS') === 'Show';
    t.bDrawings = this.Get('ATTR_PAGE_DRAWINGS') === 'Show';
    t.bTopDown = this.Get('ATTR_PAGE_TOPDOWN');
    t.bLeftRight = !t.bLeftRight;
    t.nFirstPageNo = this.Get('ATTR_PAGE_FIRSTPAGENO');
    if (!t.nFirstPageNo) t.nFirstPageNo = this.nPageStart; // from previous table

    t.bScaleNone = nScaleAll === 100;
    t.bScaleAll = nScaleAll > 0;
    t.bScaleTo = pScaleToItem.nWidth > 0 || pScaleToItem.nHeight > 0; // ScPageScaleToItem::IsValid
    t.bScalePageNum = nScaleToPages > 0;
    t.nScaleAll = nScaleAll;
    t.nScaleWidth = pScaleToItem.nWidth;
    t.nScaleHeight = pScaleToItem.nHeight;
    t.nScalePageNum = nScaleToPages;

    //  skip empty pages only if options with that flag are passed
    t.bSkipEmpty = !!pOptions && pOptions.GetSkipEmpty();
    if (this.pPageData) t.bSkipEmpty = false;
    // If pPageData is set, only the breaks are interesting for the
    // pagebreak preview, empty pages are not addressed separately.

    t.bForceBreaks = !!pOptions && pOptions.GetForceBreaks();

    // TabPage "Parts":

    //! walk through all PrintAreas of the table !!!
    const pPrintArea = this.rDoc.GetPrintRange(this.nPrintTab, 0);
    const oRepeatCol = this.rDoc.GetRepeatColRange(this.nPrintTab);
    const oRepeatRow = this.rDoc.GetRepeatRowRange(this.nPrintTab);

    //  ignoring ATTR_PAGE_PRINTTABLES

    const bHasPrintRange = this.rDoc.HasPrintRange();
    const nPrintRangeCount = this.rDoc.GetPrintRangeCount(this.nPrintTab);
    const bPrintEntireSheet = this.rDoc.IsPrintEntireSheet(this.nPrintTab);

    if (!bPrintEntireSheet && !nPrintRangeCount) this.mbHasPrintRange = false;

    const a = this.aAreaParam;
    if (this.pUserArea) { // UserArea (selection) has priority
      this.bPrintCurrentTable = a.bPrintArea = true; // Selection
      a.aPrintArea = this.pUserArea.clone();

      //  The table-query is already in DocShell::Print, here always
      a.aPrintArea.aStart.SetTab(this.nPrintTab);
      a.aPrintArea.aEnd.SetTab(this.nPrintTab);
    } else if (bHasPrintRange) {
      if (pPrintArea) { // at least one set?
        this.bPrintCurrentTable = a.bPrintArea = true;
        a.aPrintArea = pPrintArea.clone();

        this.bMultiArea = nPrintRangeCount > 1;
      } else {
        // do not print hidden sheets with "Print entire sheet" flag
        this.bPrintCurrentTable = this.rDoc.IsPrintEntireSheet(this.nPrintTab) && this.rDoc.IsVisible(this.nPrintTab);
        a.bPrintArea = !this.bPrintCurrentTable; // otherwise the table is always counted
      }
    } else {
      //  don't print hidden tables if there's no print range defined there
      if (this.rDoc.IsVisible(this.nPrintTab)) {
        a.bPrintArea = false;
        this.bPrintCurrentTable = true;
      } else {
        a.bPrintArea = true; // otherwise the table is always counted
        this.bPrintCurrentTable = false;
      }
    }

    if (oRepeatCol) {
      a.bRepeatCol = true;
      this.nRepeatStartCol = oRepeatCol.aStart.Col();
      this.nRepeatEndCol = oRepeatCol.aEnd.Col();
    } else {
      a.bRepeatCol = false;
      this.nRepeatStartCol = this.nRepeatEndCol = SCCOL_REPEAT_NONE;
    }

    if (oRepeatRow) {
      a.bRepeatRow = true;
      this.nRepeatStartRow = oRepeatRow.aStart.Row();
      this.nRepeatEndRow = oRepeatRow.aEnd.Row();
    } else {
      a.bRepeatRow = false;
      this.nRepeatStartRow = this.nRepeatEndRow = SCROW_REPEAT_NONE;
    }

    //  Split pages

    if (!this.bPrintAreaValid) {
      this.nTabPages = this.CountPages(); // also calculates zoom
      this.nTotalPages = this.nTabPages;
      this.nTotalPages += this.CountNotePages();
    } else {
      this.CalcPages(); // search breaks only
      this.CountNotePages(); // Count notes, even if number of pages is already known
    }

    if (this.nDocPages) this.aFieldData.nTotalPages = this.nDocPages;
    else this.aFieldData.nTotalPages = this.nTotalPages;

    this.SetDateTime(new Date());

    const aTitle = this.rDocShell.m_xDocProps.getTitle();
    if (aTitle.length !== 0) this.aFieldData.aTitle = aTitle;
    else this.aFieldData.aTitle = this.rDocShell.GetTitle();

    this.aFieldData.aLongDocName = this.rDocShell.GetTitle();
    if (this.aFieldData.aLongDocName.length) this.aFieldData.aShortDocName = this.aFieldData.aLongDocName;
    else this.aFieldData.aShortDocName = this.aFieldData.aLongDocName = this.aFieldData.aTitle;

    //  Printer settings (Orientation, Paper) at DoPrint
  }

  GetPageSize(): { Width: number; Height: number } { return this.aPageSize; }
  IsLandscape(): boolean { return this.bLandscape; }

  GetDataSize(): { Width: number; Height: number } {
    return {
      Width: this.aPageSize.Width - (this.nLeftMargin + this.nRightMargin),
      Height: this.aPageSize.Height - (this.nTopMargin + this.nBottomMargin) - (this.aHdr.nHeight + this.aFtr.nHeight),
    };
  }

  GetFirstPageNo(): number { return this.aTableParam.nFirstPageNo; }
  GetTotalPages(): number { return this.nTotalPages; }
  GetZoom(): number { return this.nZoom; }
  GetLeftMargin(): number { return this.nLeftMargin; }
  GetRightMargin(): number { return this.nRightMargin; }
  GetTopMargin(): number { return this.nTopMargin; }
  GetBottomMargin(): number { return this.nBottomMargin; }
  GetHeader(): ScPrintHFParam { return this.aHdr; }
  GetFooter(): ScPrintHFParam { return this.aFtr; }
  HasPrintRange(): boolean { return this.mbHasPrintRange; }

  SetDateTime(rDateTime: Date): void { this.aFieldData.aDateTime = rDateTime; }

  /**
   * DrawBorder (reduced): the background colour and the border lines of the page or of a header
   * or footer, drawn directly instead of through a one-cell border document and ScOutputData.
   */
  private DrawBorder(nScrX: number, nScrY: number, nScrW: number, nScrH: number, pBorderData: SvxBoxItem | null, pBackground: string | null): void {
    const pDev = this.pDev!;
    //!     direct output from SvxBoxItem !!!

    if (pBorderData) if (!pBorderData.top && !pBorderData.bottom && !pBorderData.left && !pBorderData.right) pBorderData = null;

    if (!pBorderData && !pBackground) return; // nothing to do

    //  aFrameRect - outside around frame, without shadow
    const aFrame = { x: nScrX, y: nScrY, w: nScrW, h: nScrH };

    if (pBackground) {
      pDev.fillStyle = pBackground;
      pDev.fillRect(aFrame.x, aFrame.y, aFrame.w, aFrame.h);
    }

    if (!pBorderData) return;

    const nL = Math.trunc(lcl_LineTotal(pBorderData.left) * this.nScaleX), nR = Math.trunc(lcl_LineTotal(pBorderData.right) * this.nScaleX);
    const nT = Math.trunc(lcl_LineTotal(pBorderData.top) * this.nScaleY), nB = Math.trunc(lcl_LineTotal(pBorderData.bottom) * this.nScaleY);
    const line = (l: SvxBorderLine | null, x: number, y: number, w: number, h: number) => {
      if (!l) return;
      pDev.fillStyle = l.color || '#000000';
      pDev.fillRect(x, y, w, h);
    };
    line(pBorderData.top, aFrame.x, aFrame.y, aFrame.w, nT);
    line(pBorderData.bottom, aFrame.x, aFrame.y + aFrame.h - nB, aFrame.w, nB);
    line(pBorderData.left, aFrame.x, aFrame.y, nL, aFrame.h);
    line(pBorderData.right, aFrame.x + aFrame.w - nR, aFrame.y, nR, aFrame.h);
  }

  /** One device pixel in output units (pDev->PixelToLogic(Size(1,1))). */
  private OnePixel(): number { return PRINTER_PIXEL_TWIPS / this.mfZoom; }

  /** pDev->DrawRect with a line colour and no fill: the outline of the rectangle (inclusive corners). */
  private DrawRectOutline(nLeft: number, nTop: number, nRight: number, nBottom: number, aColor: string): void {
    const pDev = this.pDev!;
    const n = this.OnePixel();
    const l = Math.min(nLeft, nRight), r = Math.max(nLeft, nRight), t = Math.min(nTop, nBottom), b = Math.max(nTop, nBottom);
    pDev.fillStyle = aColor;
    pDev.fillRect(l, t, r - l + n, n);
    pDev.fillRect(l, b, r - l + n, n);
    pDev.fillRect(l, t, n, b - t + n);
    pDev.fillRect(r, t, n, b - t + n);
  }

  private PrintColHdr(nX1: SCCOL, nX2: SCCOL, nScrX: number, nScrY: number, aFont: FontDesc, aColor: string): void {
    const pDev = this.pDev!;
    const bLayoutRTL = this.rDoc.IsLayoutRTL(this.nPrintTab);
    const nLayoutSign = bLayoutRTL ? -1 : 1;

    const nOneX = this.OnePixel();
    const nOneY = this.OnePixel();
    let nCol: SCCOL;

    const nHeight = Math.trunc(PRINT_HEADER_HEIGHT * this.nScaleY);
    const nEndY = nScrY + nHeight - nOneY;

    let nPosX = nScrX;
    if (bLayoutRTL) {
      for (nCol = nX1; nCol <= nX2; nCol++) nPosX += Math.trunc(this.rDoc.GetColWidth(nCol, this.nPrintTab) * this.nScaleX);
    } else nPosX -= nOneX;
    const nPosY = nScrY - nOneY;
    const m = this.pMeasurer.GetFontMetric(aFont);

    for (nCol = nX1; nCol <= nX2; nCol++) {
      const nDocW = this.rDoc.GetColWidth(nCol, this.nPrintTab);
      if (nDocW) {
        const nWidth = Math.trunc(nDocW * this.nScaleX);
        const nEndX = nPosX + nWidth * nLayoutSign;

        this.DrawRectOutline(nPosX, nPosY, nEndX, nEndY, aColor);

        const aText = ScColToAlpha(nCol);
        const nTextWidth = this.pMeasurer.GetTextWidth(aFont, aText);
        const nTextHeight = m.ascent + m.descent;
        const nAddX = (nWidth - nTextWidth) / 2;
        const nAddY = (nHeight - nTextHeight) / 2;
        let nTextPosX = nPosX + nAddX;
        if (bLayoutRTL) nTextPosX -= nWidth;
        pDev.fillStyle = aColor;
        pDev.font = cssFont(aFont);
        pDev.fillText(aText, nTextPosX, nPosY + nAddY + m.ascent);

        nPosX = nEndX;
      }
    }
  }

  private PrintRowHdr(nY1: SCROW, nY2: SCROW, nScrX: number, nScrY: number, aFont: FontDesc, aColor: string): void {
    const pDev = this.pDev!;
    const nOneX = this.OnePixel();
    const nOneY = this.OnePixel();

    const bLayoutRTL = this.rDoc.IsLayoutRTL(this.nPrintTab);

    const nWidth = Math.trunc(PRINT_HEADER_WIDTH * this.nScaleX);
    let nEndX = nScrX + nWidth;
    let nPosX = nScrX;
    if (!bLayoutRTL) {
      nEndX -= nOneX;
      nPosX -= nOneX;
    }
    let nPosY = nScrY - nOneY;
    const m = this.pMeasurer.GetFontMetric(aFont);

    for (let nRow = nY1; nRow <= nY2; nRow++) {
      const nDocH = this.rDoc.GetRowHeight(nRow, this.nPrintTab);
      if (nDocH) {
        const nHeight = Math.trunc(nDocH * this.nScaleY);
        const nEndY = nPosY + nHeight;

        this.DrawRectOutline(nPosX, nPosY, nEndX, nEndY, aColor);

        const aText = String(nRow + 1);
        const nTextWidth = this.pMeasurer.GetTextWidth(aFont, aText);
        const nTextHeight = m.ascent + m.descent;
        const nAddX = (nWidth - nTextWidth) / 2;
        const nAddY = (nHeight - nTextHeight) / 2;
        pDev.fillStyle = aColor;
        pDev.font = cssFont(aFont);
        pDev.fillText(aText, nPosX + nAddX, nPosY + nAddY + m.ascent);

        nPosY = nEndY;
      }
    }
  }

  private PrintArea(nX1: SCCOL, nY1: SCROW, nX2: SCCOL, nY2: SCROW, nScrX: number, nScrY: number, bShLeft: boolean, bShTop: boolean, bShRight: boolean, bShBottom: boolean): void {
    void bShLeft; void bShTop; void bShRight; void bShBottom; // the extra shadow is not ported
    // #i47547# nothing to do if the end of the print area is before the end of
    // the repeat columns/rows (don't use negative size for ScOutputData)
    if (nX2 < nX1 || nY2 < nY1) return;
    const pDev = this.pDev!;

    //  Assemble data

    const aTabInfo = new ScTableInfo(nY1, nY2, true);
    FillInfo(this.rDoc, aTabInfo, nX1, nY1, nX2, nY2, this.nPrintTab, this.nScaleX, this.nScaleY, true, this.aTableParam.bFormulas);
    lcl_HidePrint(aTabInfo, nX1, nX2);

    const aOutputData = new ScOutputData(pDev, ScOutputType.OUTTYPE_PRINTER, aTabInfo, this.rDoc, this.nPrintTab, nScrX, nScrY, nX1, nY1, nX2, nY2, this.nScaleX, this.nScaleY, this.pMeasurer);
    aOutputData.mnOneX = aOutputData.mnOneY = this.OnePixel();

    aOutputData.SetShowFormulas(this.aTableParam.bFormulas);
    aOutputData.SetShowNullValues(this.aTableParam.bNullVals);

    const aGridColor = '#000000';
    aOutputData.SetGridColor(aGridColor);

    if (this.aTableParam.bCellContent) aOutputData.DrawBackground();

    if (this.aTableParam.bCellContent) {
      aOutputData.DrawFrame();
      aOutputData.DrawStrings();
      aOutputData.DrawEdit();
    }

    if (this.aTableParam.bGrid) aOutputData.DrawGrid(true); // no page breaks
  }

  /** Mirror margins? */
  private IsMirror(nPageNo: number): boolean { return this.nPageUsage === 'Mirror' && (nPageNo & 1) !== 0; }

  /** left foot notes? */
  private IsLeft(nPageNo: number): boolean {
    let bLeft: boolean;
    if (this.nPageUsage === 'Left') bLeft = true;
    else if (this.nPageUsage === 'Right') bLeft = false;
    else bLeft = (nPageNo & 1) !== 0;
    return bLeft;
  }

  private MakeTableString(): void { this.aFieldData.aTabName = this.rDoc.GetName(this.nPrintTab) ?? ''; }

  //  nStartY = logic
  private PrintHF(nPageNo: number, bHeader: boolean, nStartY: number, bDoPrint: boolean): void {
    const rParam = bHeader ? this.aHdr : this.aFtr;

    const bFirst = nPageNo === 0 && !rParam.bSharedFirst;
    const bLeft = this.IsLeft(nPageNo) && !rParam.bShared;
    const pHFItem = (bFirst ? rParam.pFirst : bLeft ? rParam.pLeft : rParam.pRight)!;

    const nLineStartX = this.aPageRect.nLeft + rParam.nLeft;
    const nLineEndX = this.aPageRect.nRight - rParam.nRight;
    const nLineWidth = nLineStartX <= nLineEndX ? nLineEndX - nLineStartX + 1 : 0;

    //  Edit-Engine

    const aStart = { X: nLineStartX, Y: nStartY };
    const aPaperSize = { Width: nLineWidth, Height: rParam.nHeight - rParam.nDistance };
    if (rParam.pBorder) {
      const nLeft = lcl_LineTotal(rParam.pBorder.left);
      const nTop = lcl_LineTotal(rParam.pBorder.top);
      aStart.X += nLeft;
      aStart.Y += nTop;
      aPaperSize.Width -= nLeft + lcl_LineTotal(rParam.pBorder.right);
      aPaperSize.Height -= nTop + lcl_LineTotal(rParam.pBorder.bottom);
    }

    this.aFieldData.nPageNo = nPageNo + this.aTableParam.nFirstPageNo;

    //  Frame / Background

    const aBorderStart = { X: nLineStartX, Y: nStartY };
    const aBorderSize = { Width: nLineWidth, Height: rParam.nHeight - rParam.nDistance };
    if (rParam.bDynamic) {
      //  adjust here again, for even/odd head-/footlines
      //  and probably other breaks by variable (page number etc.)

      let nMaxHeight = 0;
      nMaxHeight = Math.max(nMaxHeight, this.TextHeight(pHFItem.pLeftArea));
      nMaxHeight = Math.max(nMaxHeight, this.TextHeight(pHFItem.pCenterArea));
      nMaxHeight = Math.max(nMaxHeight, this.TextHeight(pHFItem.pRightArea));
      if (rParam.pBorder) nMaxHeight += lcl_LineTotal(rParam.pBorder.top) + lcl_LineTotal(rParam.pBorder.bottom);

      if (nMaxHeight < rParam.nManHeight - rParam.nDistance) nMaxHeight = rParam.nManHeight - rParam.nDistance; // configured Minimum

      aBorderSize.Height = nMaxHeight;
    }

    if (bDoPrint) {
      const pDev = this.pDev!;
      const nOldScaleX = this.nScaleX;
      const nOldScaleY = this.nScaleY;
      this.nScaleX = this.nScaleY = 1.0; // output directly in Twips
      this.DrawBorder(aBorderStart.X, aBorderStart.Y, aBorderSize.Width, aBorderSize.Height, rParam.pBorder, rParam.pBack);
      this.nScaleX = nOldScaleX;
      this.nScaleY = nOldScaleY;

      //  Clipping for Text

      pDev.save();
      pDev.beginPath();
      pDev.rect(aStart.X, aStart.Y, aPaperSize.Width, aPaperSize.Height);
      pDev.clip();

      const aDefault = this.DefaultFont();
      const areas: [EditTextObject | null, 'Left' | 'Center' | 'Right'][] = [[pHFItem.pLeftArea, 'Left'], [pHFItem.pCenterArea, 'Center'], [pHFItem.pRightArea, 'Right']];
      for (const [pObject, eAdjust] of areas) {
        if (!pObject) continue;
        const aLayout = new HFLayout(pObject, this.aFieldData, aDefault, this.pMeasurer);
        let nDrawY = aStart.Y;
        const nDif = aPaperSize.Height - aLayout.nHeight;
        if (nDif > 0) nDrawY += Math.trunc(nDif / 2);
        aLayout.Draw(pDev, aStart.X, nDrawY, aPaperSize.Width, eAdjust);
      }

      pDev.restore();
    }
  }

  private CountNotePages(): number {
    // notes pages are not ported
    return 0;
  }

  private PrintPage(nPageNo: number, nX1: SCCOL, nY1: SCROW, nX2: SCCOL, nY2: SCROW, bDoPrint: boolean): void {
    const bLayoutRTL = this.rDoc.IsLayoutRTL(this.nPrintTab);
    const nLayoutSign = bLayoutRTL ? -1 : 1;
    const pDev = this.pDev;

    //  nPageNo is the page number within all sheets of one "start page" setting

    if (pDev && bDoPrint) {
      // the zoom of aOffsetMode and aTwipMode
      pDev.save();
      pDev.scale(this.mfZoom, this.mfZoom);
    }

    if (this.bClearWin && bDoPrint && pDev) {
      //  must exactly fit to painting the frame in preview.cxx !!!
      pDev.fillStyle = '#ffffff';
      pDev.fillRect(0, 0, (this.aPageSize.Width * this.nScaleX * 100) / this.nZoom, (this.aPageSize.Height * this.nScaleY * 100) / this.nZoom);
    }

    //      adjust aPageRect for left/right page

    if (this.IsMirror(nPageNo)) {
      this.aPageRect.nLeft = Math.trunc((0 + this.nRightMargin) * 100 / this.nZoom);
      this.aPageRect.nRight = Math.trunc((this.aPageSize.Width - 1 - this.nLeftMargin) * 100 / this.nZoom);
    } else {
      this.aPageRect.nLeft = Math.trunc((0 + this.nLeftMargin) * 100 / this.nZoom);
      this.aPageRect.nRight = Math.trunc((this.aPageSize.Width - 1 - this.nRightMargin) * 100 / this.nZoom);
    }

    const a = this.aAreaParam;
    if (a.bRepeatCol) if (nX1 > this.nRepeatStartCol && nX1 <= this.nRepeatEndCol) nX1 = this.nRepeatEndCol + 1;
    const bDoRepCol = a.bRepeatCol && nX1 > this.nRepeatEndCol;
    if (a.bRepeatRow) if (nY1 > this.nRepeatStartRow && nY1 <= this.nRepeatEndRow) nY1 = this.nRepeatEndRow + 1;
    const bDoRepRow = a.bRepeatRow && nY1 > this.nRepeatEndRow;

    //  head and foot lines (without centering)

    if (this.aHdr.bEnable) {
      const nHeaderY = this.aPageRect.nTop - this.aHdr.nHeight;
      this.PrintHF(nPageNo, true, nHeaderY, bDoPrint);
    }
    if (this.aFtr.bEnable) {
      const nFooterY = this.aPageRect.nBottom + this.aFtr.nDistance;
      this.PrintHF(nPageNo, false, nFooterY, bDoPrint);
    }

    //  Position ( margins / centering )

    let nLeftSpace = this.aPageRect.nLeft; // Document-Twips
    let nTopSpace = this.aPageRect.nTop;
    if (this.bCenterHor || bLayoutRTL) {
      let nDataWidth = 0;
      let i: SCCOL;
      for (i = nX1; i <= nX2; i++) nDataWidth += this.rDoc.GetColWidth(i, this.nPrintTab);
      if (bDoRepCol) for (i = this.nRepeatStartCol; i <= this.nRepeatEndCol; i++) nDataWidth += this.rDoc.GetColWidth(i, this.nPrintTab);
      if (this.aTableParam.bHeaders) nDataWidth += PRINT_HEADER_WIDTH;
      if (this.bCenterHor) {
        nLeftSpace += Math.trunc((RectWidth(this.aPageRect) - nDataWidth) / 2); // LTR or RTL
        if (this.pBorderItem) nLeftSpace -= lcl_LineTotal(this.pBorderItem.left);
      } else if (bLayoutRTL) nLeftSpace += RectWidth(this.aPageRect) - nDataWidth; // align to the right edge of the page
    }
    if (this.bCenterVer) {
      let nDataHeight = this.rDoc.GetRowHeightRange(nY1, nY2, this.nPrintTab);
      if (bDoRepRow) nDataHeight += this.rDoc.GetRowHeightRange(this.nRepeatStartRow, this.nRepeatEndRow, this.nPrintTab);
      if (this.aTableParam.bHeaders) nDataHeight += PRINT_HEADER_HEIGHT;
      nTopSpace += Math.trunc((RectHeight(this.aPageRect) - nDataHeight) / 2);
      if (this.pBorderItem) nTopSpace -= lcl_LineTotal(this.pBorderItem.top);
    }

    //  calculate sizes of the elements for partitioning
    //  (header, repeat, data)

    let nHeaderWidth = 0;
    let nHeaderHeight = 0;
    let nRepeatWidth = 0;
    let nRepeatHeight = 0;
    let nContentWidth = 0; // scaled - not the same as nDataWidth above
    let nContentHeight = 0;
    if (this.aTableParam.bHeaders) {
      nHeaderWidth = Math.trunc(PRINT_HEADER_WIDTH * this.nScaleX);
      nHeaderHeight = Math.trunc(PRINT_HEADER_HEIGHT * this.nScaleY);
    }
    if (bDoRepCol) for (let i = this.nRepeatStartCol; i <= this.nRepeatEndCol; i++) nRepeatWidth += Math.trunc(this.rDoc.GetColWidth(i, this.nPrintTab) * this.nScaleX);
    if (bDoRepRow) nRepeatHeight += this.GetScaledRowHeight(this.nRepeatStartRow, this.nRepeatEndRow, this.nScaleY);
    for (let i = nX1; i <= nX2; i++) nContentWidth += Math.trunc(this.rDoc.GetColWidth(i, this.nPrintTab) * this.nScaleX);
    nContentHeight += this.GetScaledRowHeight(nY1, nY2, this.nScaleY);

    //  partition the page

    const nStartX = Math.trunc(nLeftSpace * this.nScaleX);
    const nStartY = Math.trunc(nTopSpace * this.nScaleY);
    let nInnerStartX = nStartX;
    let nInnerStartY = nStartY;
    if (this.pBorderItem) {
      nInnerStartX += Math.trunc(lcl_LineTotal(this.pBorderItem.left) * this.nScaleX);
      nInnerStartY += Math.trunc(lcl_LineTotal(this.pBorderItem.top) * this.nScaleY);
    }

    if (bLayoutRTL) {
      //  arrange elements starting from the right edge
      nInnerStartX += nHeaderWidth + nRepeatWidth + nContentWidth;

      //  make rounding easier so the elements are really next to each other in preview
      nInnerStartX += this.OnePixel() / 2;
    }

    const nFrameStartX = nInnerStartX;
    const nFrameStartY = nInnerStartY;

    let nRepStartX = nInnerStartX + nHeaderWidth * nLayoutSign; // widths/heights are 0 if not used
    const nRepStartY = nInnerStartY + nHeaderHeight;
    let nDataX = nRepStartX + nRepeatWidth * nLayoutSign;
    const nDataY = nRepStartY + nRepeatHeight;
    let nEndX = nDataX + nContentWidth * nLayoutSign;
    const nEndY = nDataY + nContentHeight;
    const nFrameEndX = nEndX;
    const nFrameEndY = nEndY;

    if (bLayoutRTL) {
      //  each element's start position is its left edge
      //! subtract one pixel less?
      nInnerStartX -= nHeaderWidth; // used for header
      nRepStartX -= nRepeatWidth;
      nDataX -= nContentWidth;

      //  continue right of the main elements again
      nEndX += nHeaderWidth + nRepeatWidth + nContentWidth;
    }

    //  Page frame / background

    //! adjust nEndX/Y

    let nBorderEndX = nEndX;
    let nBorderEndY = nEndY;
    if (this.pBorderItem) {
      nBorderEndX += Math.trunc(lcl_LineTotal(this.pBorderItem.right) * this.nScaleX);
      nBorderEndY += Math.trunc(lcl_LineTotal(this.pBorderItem.bottom) * this.nScaleY);
    }

    if (bDoPrint) this.DrawBorder(nStartX, nStartY, nBorderEndX - nStartX, nBorderEndY - nStartY, this.pBorderItem, this.pBackgroundItem);

    //  Output repeating rows/columns

    if (bDoRepCol && bDoRepRow) {
      if (bDoPrint) this.PrintArea(this.nRepeatStartCol, this.nRepeatStartRow, this.nRepeatEndCol, this.nRepeatEndRow, nRepStartX, nRepStartY, true, true, false, false);
    }
    if (bDoRepCol) {
      if (bDoPrint) this.PrintArea(this.nRepeatStartCol, nY1, this.nRepeatEndCol, nY2, nRepStartX, nDataY, true, !bDoRepRow, false, true);
    }
    if (bDoRepRow) {
      if (bDoPrint) this.PrintArea(nX1, this.nRepeatStartRow, nX2, this.nRepeatEndRow, nDataX, nRepStartY, !bDoRepCol, true, true, false);
    }

    //  output data

    if (bDoPrint) this.PrintArea(nX1, nY1, nX2, nY2, nDataX, nDataY, !bDoRepCol, !bDoRepRow, true, true);

    //  output column/row headers
    //  after data (through probably shadow)

    const aGridColor = '#000000';

    if (this.aTableParam.bHeaders && bDoPrint) {
      const aFont = this.DefaultFont();

      if (bDoRepCol) this.PrintColHdr(this.nRepeatStartCol, this.nRepeatEndCol, nRepStartX, nInnerStartY, aFont, aGridColor);
      this.PrintColHdr(nX1, nX2, nDataX, nInnerStartY, aFont, aGridColor);
      if (bDoRepRow) this.PrintRowHdr(this.nRepeatStartRow, this.nRepeatEndRow, nInnerStartX, nRepStartY, aFont, aGridColor);
      this.PrintRowHdr(nY1, nY2, nInnerStartX, nDataY, aFont, aGridColor);
    }

    //  simple frame

    if (bDoPrint && (this.aTableParam.bGrid || this.aTableParam.bHeaders)) {
      const nOneX = this.OnePixel();
      const nOneY = this.OnePixel();

      let nLeftX = nFrameStartX;
      const nTopY = nFrameStartY - nOneY;
      let nRightX = nFrameEndX;
      const nBottomY = nFrameEndY - nOneY;
      if (!bLayoutRTL) {
        nLeftX -= nOneX;
        nRightX -= nOneX;
      }
      this.DrawRectOutline(nLeftX, nTopY, nRightX, nBottomY, aGridColor);
      //  nEndX/Y without frame-adaptation
    }

    if (pDev && bDoPrint) pDev.restore();

    this.aLastSourceRange = new ScRange(nX1, nY1, this.nPrintTab, nX2, nY2, this.nPrintTab);
    this.bSourceRangeValid = true;
  }

  /** ScDocument::GetScaledRowHeight: the rows' heights each scaled and truncated. */
  private GetScaledRowHeight(nStartRow: SCROW, nEndRow: SCROW, fScale: number): number {
    if (fScale === 1) return this.rDoc.GetRowHeightRange(nStartRow, nEndRow, this.nPrintTab);
    let n = 0;
    for (let r = nStartRow; r <= nEndRow;) {
      const run = this.rDoc.GetRowHeightRun(r, this.nPrintTab);
      const nLast = Math.min(run.nEndRow, nEndRow);
      n += Math.trunc(run.nHeight * fScale) * (nLast - r + 1);
      r = nLast + 1;
    }
    return n;
  }

  SetManualZoom(nNewZoom: number): void { this.nManualZoom = nNewZoom; }
  SetClearFlag(bFlag: boolean): void { this.bClearWin = bFlag; }
  SetUseStyleColor(bFlag: boolean): void { this.bUseStyleColor = bFlag; }
  SetRenderFlag(bFlag: boolean): void { this.bIsRender = bFlag; }
  /** The device the next DoPrint paints on (a new page of an SVG or PDF). */
  SetDevice(pNewDev: ScRenderContext | null): void { this.pDev = pNewDev; }

  /** UpdatePages: the breaks of all sheets with this page style, for the view. */
  UpdatePages(): boolean {
    if (!this.pParamSet) return false;

    //  Zoom

    this.nZoom = 100;
    if (this.aTableParam.bScalePageNum || this.aTableParam.bScaleTo) this.nZoom = ZOOM_MIN; // correct for breaks
    else if (this.aTableParam.bScaleAll) {
      this.nZoom = this.aTableParam.nScaleAll;
      if (this.nZoom <= ZOOM_MIN) this.nZoom = ZOOM_MIN;
    }

    const aName = this.rDoc.GetPageStyle(this.nPrintTab);
    const nTabCount = this.rDoc.GetTableCount();
    for (let nTab = 0; nTab < nTabCount; nTab++) {
      if (nTab === this.nPrintTab || this.rDoc.GetPageStyle(nTab) === aName) {
        //  Repeating rows/columns
        this.rDoc.SetRepeatArea(nTab, this.nRepeatStartCol, this.nRepeatEndCol, this.nRepeatStartRow, this.nRepeatEndRow);

        //  set breaks
        this.ResetBreaks(nTab);
      }
    }

    return true;
  }

  /** sets also nPagesX, nPagesY */
  private CountPages(): number {
    let bAreaOk = false;

    if (this.rDoc.HasTable(this.nPrintTab)) {
      if (this.aAreaParam.bPrintArea) { // Specify print area?
        if (this.bPrintCurrentTable) {
          const rRange = this.aAreaParam.aPrintArea;

          //  Here, no comparison of the tables any more. Area is always valid for this table
          //  If comparison should be done here, the table of print ranges must be adjusted
          //  when inserting tables etc.!

          this.nStartCol = rRange.aStart.Col();
          this.nStartRow = rRange.aStart.Row();
          this.nEndCol = rRange.aEnd.Col();
          this.nEndRow = rRange.aEnd.Row();
          bAreaOk = this.AdjustPrintArea(false); // limit
        } else bAreaOk = false;
      } else { // search from document
        bAreaOk = this.AdjustPrintArea(true);
      }
    }

    if (bAreaOk) {
      let nPages = 0;
      let nY: number;
      if (this.bMultiArea) {
        const nRCount = this.rDoc.GetPrintRangeCount(this.nPrintTab);
        for (let i = 0; i < nRCount; i++) {
          this.CalcZoom(i);
          if (this.aTableParam.bSkipEmpty) for (nY = 0; nY < this.m_aRanges.m_nPagesY; nY++) nPages += this.m_aRanges.PageRow(nY).CountVisible();
          else nPages += this.m_aRanges.m_nPagesX * this.m_aRanges.m_nPagesY;
          if (this.pPageData) this.FillPageData();
        }
      } else {
        this.CalcZoom(RANGENO_NORANGE); // calculate Zoom
        if (this.aTableParam.bSkipEmpty) for (nY = 0; nY < this.m_aRanges.m_nPagesY; nY++) nPages += this.m_aRanges.PageRow(nY).CountVisible();
        else nPages += this.m_aRanges.m_nPagesX * this.m_aRanges.m_nPagesY;
        if (this.pPageData) this.FillPageData();
      }
      return nPages;
    } else {
      this.m_aRanges.m_nPagesX = this.m_aRanges.m_nPagesY = this.m_aRanges.m_nTotalY = 0;
      return 0;
    }
  }

  /** set MapModes from nZoom etc. */
  private InitModes(): void {
    const nEffZoom = this.nZoom * this.nManualZoom;
    this.nScaleX = this.nScaleY = 1; // output in document twips
    this.mfZoom = nEffZoom / 10000;
  }

  //  rPageRanges   = range for all tables
  //  nStartPage    = rPageRanges starts at nStartPage
  //  nDisplayStart = continuous number for displaying the page number

  DoPrint(rPageRanges: ScPageSelection, nStartPage: number, nDisplayStart: number, bDoPrint: boolean): number {
    if (!this.pParamSet) return 0;

    this.InitModes();

    this.MakeTableString();

    let nPageNo = 0;
    let nPrinted = 0;

    let nRepeats = 1;
    if (this.bMultiArea) nRepeats = this.rDoc.GetPrintRangeCount(this.nPrintTab);
    for (let nStep = 0; nStep < nRepeats; nStep++) {
      if (this.bMultiArea) { // replace area
        this.CalcZoom(nStep); // also sets nStartCol etc. new
        this.InitModes();
      }

      let nX1: SCCOL;
      let nY1: SCROW;
      let nX2: SCCOL;
      let nY2: SCROW;
      let nCountX: number;
      let nCountY: number;

      if (this.aTableParam.bTopDown) { // top-bottom
        nX1 = this.nStartCol;
        for (nCountX = 0; nCountX < this.m_aRanges.m_nPagesX; nCountX++) {
          nX2 = this.m_aRanges.m_xPageEndX[nCountX]!;
          for (nCountY = 0; nCountY < this.m_aRanges.m_nPagesY; nCountY++) {
            const rPageRow = this.m_aRanges.PageRow(nCountY);
            nY1 = rPageRow.GetStartRow();
            nY2 = rPageRow.GetEndRow();
            if (!this.aTableParam.bSkipEmpty || !rPageRow.IsHidden(nCountX)) {
              if (rPageRanges.IsSelected(nPageNo + nStartPage + 1)) {
                this.PrintPage(nPageNo + nDisplayStart, nX1, nY1, nX2, nY2, bDoPrint);
                ++nPrinted;
              }
              ++nPageNo;
            }
          }
          nX1 = nX2 + 1;
        }
      } else { // left to right
        for (nCountY = 0; nCountY < this.m_aRanges.m_nPagesY; nCountY++) {
          const rPageRow = this.m_aRanges.PageRow(nCountY);
          nY1 = rPageRow.GetStartRow();
          nY2 = rPageRow.GetEndRow();
          nX1 = this.nStartCol;
          for (nCountX = 0; nCountX < this.m_aRanges.m_nPagesX; nCountX++) {
            nX2 = this.m_aRanges.m_xPageEndX[nCountX]!;
            if (!this.aTableParam.bSkipEmpty || !rPageRow.IsHidden(nCountX)) {
              if (rPageRanges.IsSelected(nPageNo + nStartPage + 1)) {
                this.PrintPage(nPageNo + nDisplayStart, nX1, nY1, nX2, nY2, bDoPrint);
                ++nPrinted;
              }
              ++nPageNo;
            }
            nX1 = nX2 + 1;
          }
        }
      }
    }

    // notes pages (PrintNotes) are not ported

    if (this.bMultiArea) this.ResetBreaks(this.nPrintTab); //breaks correct for displaying

    return nPrinted;
  }

  /** calculate zoom */
  private CalcZoom(nRangeNo: number): void {
    const nRCount = this.rDoc.GetPrintRangeCount(this.nPrintTab);
    let pThisRange: ScRange | null = null;
    if (nRangeNo !== RANGENO_NORANGE && nRangeNo < nRCount) pThisRange = this.rDoc.GetPrintRange(this.nPrintTab, nRangeNo);
    if (pThisRange) {
      this.nStartCol = pThisRange.aStart.Col();
      this.nStartRow = pThisRange.aStart.Row();
      this.nEndCol = pThisRange.aEnd.Col();
      this.nEndRow = pThisRange.aEnd.Row();
    }

    if (!this.AdjustPrintArea(false)) { // empty
      this.nZoom = 100;
      this.m_aRanges.m_nPagesX = this.m_aRanges.m_nPagesY = this.m_aRanges.m_nTotalY = 0;
      return;
    }

    this.rDoc.SetRepeatArea(this.nPrintTab, this.nRepeatStartCol, this.nRepeatEndCol, this.nRepeatStartRow, this.nRepeatEndRow);

    const t = this.aTableParam;
    if (t.bScalePageNum) {
      this.nZoom = 100;
      let nPagesToFit = t.nScalePageNum;

      // If manual breaks are forced, calculate minimum # pages required
      if (t.bForceBreaks) {
        const aRowBreaks = this.rDoc.GetAllRowBreaks(this.nPrintTab, false, true);
        const aColBreaks = this.rDoc.GetAllColBreaks(this.nPrintTab, false, true);
        const nMinPages = (aRowBreaks.length + 1) * (aColBreaks.length + 1);

        // #i54993# use min forced by breaks if it's > # pages in
        // scale parameter to avoid bottoming out at <= ZOOM_MIN
        nPagesToFit = Math.max(nMinPages, nPagesToFit);
      }

      let nLastFitZoom = 0, nLastNonFitZoom = 0;
      for (;;) {
        if (this.nZoom <= ZOOM_MIN) break;

        this.CalcPages();
        const bFitsPage = this.m_aRanges.m_nPagesX * this.m_aRanges.m_nPagesY <= nPagesToFit;

        if (bFitsPage) {
          if (this.nZoom === 100)
            // If it fits at 100%, it's good enough for me.
            break;

          nLastFitZoom = this.nZoom;
          this.nZoom = Math.trunc((nLastNonFitZoom + this.nZoom) / 2);

          if (nLastFitZoom === this.nZoom)
            // It converged.  Use this zoom level.
            break;
        } else {
          if (this.nZoom - nLastFitZoom <= 1) {
            this.nZoom = nLastFitZoom;
            this.CalcPages();
            break;
          }

          nLastNonFitZoom = this.nZoom;
          this.nZoom = Math.trunc((nLastFitZoom + this.nZoom) / 2);
        }
      }
    } else if (t.bScaleTo) {
      this.nZoom = 100;
      let nW = t.nScaleWidth;
      let nH = t.nScaleHeight;

      // If manual breaks are forced, calculate minimum # pages required
      if (t.bForceBreaks) {
        const aRowBreaks = this.rDoc.GetAllRowBreaks(this.nPrintTab, false, true);
        const aColBreaks = this.rDoc.GetAllColBreaks(this.nPrintTab, false, true);
        const nMinPagesW = aColBreaks.length + 1;
        const nMinPagesH = aRowBreaks.length + 1;

        // #i54993# use min forced by breaks if it's > # pages in
        // scale parameters to avoid bottoming out at <= ZOOM_MIN
        nW = Math.max(nMinPagesW, nW);
        nH = Math.max(nMinPagesH, nH);
      }

      let nLastFitZoom = 0, nLastNonFitZoom = 0;
      for (;;) {
        if (this.nZoom <= ZOOM_MIN) break;

        this.CalcPages();
        const bFitsPage = (!nW || this.m_aRanges.m_nPagesX <= nW) && (!nH || this.m_aRanges.m_nPagesY <= nH);

        if (bFitsPage) {
          if (this.nZoom === 100)
            // If it fits at 100%, it's good enough for me.
            break;

          nLastFitZoom = this.nZoom;
          this.nZoom = Math.trunc((nLastNonFitZoom + this.nZoom) / 2);

          if (nLastFitZoom === this.nZoom)
            // It converged.  Use this zoom level.
            break;
        } else {
          if (this.nZoom - nLastFitZoom <= 1) {
            this.nZoom = nLastFitZoom;
            this.CalcPages();
            break;
          }

          nLastNonFitZoom = this.nZoom;
          this.nZoom = Math.trunc((nLastFitZoom + this.nZoom) / 2);
        }
      }
      // tdf#103516 remove the almost blank page(s) for better
      // interoperability by using slightly smaller zoom
      if (nW > 0 && nH === 0 && this.m_aRanges.m_nPagesY > 1) {
        const nLastPagesY = this.m_aRanges.m_nPagesY;
        nLastFitZoom = this.nZoom;
        this.nZoom = Math.trunc(this.nZoom * 0.98);
        if (this.nZoom < nLastFitZoom) {
          this.CalcPages();
          // same page count with smaller zoom: use the original zoom
          if (this.m_aRanges.m_nPagesY === nLastPagesY) {
            this.nZoom = nLastFitZoom;
            this.CalcPages();
          }
        }
      }
    } else if (t.bScaleAll) {
      this.nZoom = t.nScaleAll;
      if (this.nZoom <= ZOOM_MIN) this.nZoom = ZOOM_MIN;
      this.CalcPages();
    } else {
      this.nZoom = 100;
      this.CalcPages();
    }
  }

  private GetDocPageSize(): { Width: number; Height: number } {
    // Adjust height of head/foot line

    this.InitModes(); // initialize aTwipMode from nZoom
    this.UpdateHFHeight(this.aHdr);
    this.UpdateHFHeight(this.aFtr);

    //  Page size in Document-Twips
    //  Calculating Left / Right also in PrintPage

    const nZ = this.nZoom;
    this.aPageRect = {
      nLeft: Math.trunc((0 + this.nLeftMargin) * 100 / nZ),
      nRight: Math.trunc((this.aPageSize.Width - 1 - this.nRightMargin) * 100 / nZ),
      nTop: Math.trunc((0 + this.nTopMargin) * 100 / nZ) + this.aHdr.nHeight,
      nBottom: Math.trunc((this.aPageSize.Height - 1 - this.nBottomMargin) * 100 / nZ) - this.aFtr.nHeight,
    };

    const aDocPageSize = { Width: RectWidth(this.aPageRect), Height: RectHeight(this.aPageRect) };
    if (this.aTableParam.bHeaders) {
      aDocPageSize.Width -= PRINT_HEADER_WIDTH;
      aDocPageSize.Height -= PRINT_HEADER_HEIGHT;
    }
    if (this.pBorderItem) {
      aDocPageSize.Width -= lcl_LineTotal(this.pBorderItem.left) + lcl_LineTotal(this.pBorderItem.right);
      aDocPageSize.Height -= lcl_LineTotal(this.pBorderItem.top) + lcl_LineTotal(this.pBorderItem.bottom);
    }
    return aDocPageSize;
  }

  /** Set Breaks correctly for view */
  ResetBreaks(nTab: SCTAB): void {
    this.rDoc.SetPageSize(nTab, this.GetDocPageSize());
    this.rDoc.UpdatePageBreaks(nTab);
  }

  /** calculates aPageRect and pages from nZoom */
  private CalcPages(): void {
    const aInput = new PrintPageRangesInput(this.aTableParam.bSkipEmpty, this.aAreaParam.bPrintArea, new ScRange(this.nStartCol, this.nStartRow, this.nPrintTab, this.nEndCol, this.nEndRow, this.nPrintTab), this.GetDocPageSize());
    this.m_aRanges.calculate(this.rDoc, aInput);
  }
}
