// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/viewdata.hxx reduced
// @upstream sc/source/ui/view/viewdata.cxx reduced
// ScViewData: the state of a spreadsheet view: per sheet (ScViewDataTable) the cell cursor, the
// first visible column and row of each pane, the zoom, freeze/split mode and position; for the
// view the selection (ScMarkData), the reference input mode (formula references picked with the
// mouse), the fill mode (the AutoFill handle) and the view options; and the conversion between
// twips sizes and screen pixels (nPPTX/nPPTY, ToPixel, GetScrPos, GetPosFromPixel, CellsAtX/Y).
// Pixels are CSS pixels: ScGlobal::nScreenPPTX is 96 DPI's pixels per twip; the canvas is scaled
// to the device pixel ratio when painting. Left out: the LibreOfficeKit position helpers (tiled
// rendering), the edit views (the web shell edits in a DOM editor over the cell), the page break
// preview, the drawing layer's map modes, non-proportional (X/Y) zoom, the user data settings
// (settings.xml is read by the ODS filter into ScViewSettings), and sheet views.
import { ScAddress, ScRange, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { ScMarkData } from '../../../inc/markdata.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import { ScViewOptions } from '../../../inc/viewopti.ts';
import type { ScDocument } from '../../core/data/document.ts';
import type { ScDocShell } from '../docshell/docsh.ts';

/** ScGlobal::nScreenPPTX/nScreenPPTY: screen pixels per twip at 96 DPI (1/15). */
export const nScreenPPTX = 96 / 1440;
export const nScreenPPTY = 96 / 1440;

/** SC_SIZE_NONE: no screen size given to CellsAtX/Y. */
export const SC_SIZE_NONE = Number.MAX_SAFE_INTEGER;

export const ScFillMode = { NONE: 0, FILL: 1, EMBED_LT: 2, EMBED_RB: 3, MATRIX: 4 } as const;
export type ScFillMode = (typeof ScFillMode)[keyof typeof ScFillMode];

export const ScSplitMode = { SC_SPLIT_NONE: 0, SC_SPLIT_NORMAL: 1, SC_SPLIT_FIX: 2 } as const;
export type ScSplitMode = (typeof ScSplitMode)[keyof typeof ScSplitMode];

export const ScSplitPos = { SC_SPLIT_TOPLEFT: 0, SC_SPLIT_TOPRIGHT: 1, SC_SPLIT_BOTTOMLEFT: 2, SC_SPLIT_BOTTOMRIGHT: 3 } as const;
export type ScSplitPos = (typeof ScSplitPos)[keyof typeof ScSplitPos];
export const ScHSplitPos = { SC_SPLIT_LEFT: 0, SC_SPLIT_RIGHT: 1 } as const;
export type ScHSplitPos = (typeof ScHSplitPos)[keyof typeof ScHSplitPos];
export const ScVSplitPos = { SC_SPLIT_TOP: 0, SC_SPLIT_BOTTOM: 1 } as const;
export type ScVSplitPos = (typeof ScVSplitPos)[keyof typeof ScVSplitPos];

export const { SC_SPLIT_TOPLEFT, SC_SPLIT_TOPRIGHT, SC_SPLIT_BOTTOMLEFT, SC_SPLIT_BOTTOMRIGHT } = ScSplitPos;
export const { SC_SPLIT_LEFT, SC_SPLIT_RIGHT } = ScHSplitPos;
export const { SC_SPLIT_TOP, SC_SPLIT_BOTTOM } = ScVSplitPos;

export function WhichH(ePos: ScSplitPos): ScHSplitPos {
  return ePos === SC_SPLIT_TOPLEFT || ePos === SC_SPLIT_BOTTOMLEFT ? SC_SPLIT_LEFT : SC_SPLIT_RIGHT;
}
export function WhichV(ePos: ScSplitPos): ScVSplitPos {
  return ePos === SC_SPLIT_TOPLEFT || ePos === SC_SPLIT_TOPRIGHT ? SC_SPLIT_TOP : SC_SPLIT_BOTTOM;
}

/** Screen behavior related to cursor movements */
export const ScFollowMode = { SC_FOLLOW_NONE: 0, SC_FOLLOW_LINE: 1, SC_FOLLOW_FIX: 2, SC_FOLLOW_JUMP: 3, SC_FOLLOW_JUMP_END: 4 } as const;
export type ScFollowMode = (typeof ScFollowMode)[keyof typeof ScFollowMode];

/** Mouse mode to select areas */
export const ScRefType = { SC_REFTYPE_NONE: 0, SC_REFTYPE_REF: 1, SC_REFTYPE_FILL: 2, SC_REFTYPE_EMBED_LT: 3, SC_REFTYPE_EMBED_RB: 4 } as const;
export type ScRefType = (typeof ScRefType)[keyof typeof ScRefType];

/** States GetSimpleArea() returns for the underlying selection marks. */
export const ScMarkType = { SC_MARK_NONE: 0, SC_MARK_SIMPLE: 1, SC_MARK_FILTERED: 2, SC_MARK_SIMPLE_FILTERED: 3, SC_MARK_MULTI: 4 } as const;
export type ScMarkType = (typeof ScMarkType)[keyof typeof ScMarkType];

export interface Point { X: number; Y: number }

/** per-sheet data */
export class ScViewDataTable {
  /** selected zoom (normal view), as a fraction (1 = 100%) */
  aZoomX = 1;
  aZoomY = 1;

  /** MapMode - Offset (Twips) */
  nTPosX: [number, number] = [0, 0];
  nTPosY: [number, number] = [0, 0];
  /** Offset in Pixels */
  nPixPosX: [number, number] = [0, 0];
  nPixPosY: [number, number] = [0, 0];
  nHSplitPos = 0;
  nVSplitPos = 0;

  eHSplitMode: ScSplitMode = ScSplitMode.SC_SPLIT_NONE;
  eVSplitMode: ScSplitMode = ScSplitMode.SC_SPLIT_NONE;
  eWhichActive: ScSplitPos = SC_SPLIT_BOTTOMLEFT;

  /** Cell position of the splitter when freeze pane */
  nFixPosX: SCCOL = 0;
  nFixPosY: SCROW = 0;

  nCurX: SCCOL = 0;
  nCurY: SCROW = 0;
  nOldCurX: SCCOL = 0;
  nOldCurY: SCROW = 0;

  /** X position of the top left cell of the visible area. */
  nPosX: [SCCOL, SCCOL] = [0, 0];
  /** Y position of the top left cell of the visible area. */
  nPosY: [SCROW, SCROW] = [0, 0];

  /** per sheet show grid lines option. */
  bShowGrid = true;
  /** "virtual" Cursor position when combined */
  mbOldCursorValid = false;

  clone(): ScViewDataTable {
    const r = new ScViewDataTable();
    Object.assign(r, this);
    r.nTPosX = [...this.nTPosX]; r.nTPosY = [...this.nTPosY];
    r.nPixPosX = [...this.nPixPosX]; r.nPixPosY = [...this.nPixPosY];
    r.nPosX = [...this.nPosX]; r.nPosY = [...this.nPosY];
    return r;
  }

  /**
   * Sanitize the active split range value to not point into a grid window that would never be
   * initialized due to non-matching split modes.
   */
  SanitizeWhichActive(): ScSplitPos {
    if ((WhichH(this.eWhichActive) === SC_SPLIT_RIGHT && this.eHSplitMode === ScSplitMode.SC_SPLIT_NONE) ||
        (WhichV(this.eWhichActive) === SC_SPLIT_TOP && this.eVSplitMode === ScSplitMode.SC_SPLIT_NONE)) {
      return SC_SPLIT_BOTTOMLEFT;
    }
    return this.eWhichActive;
  }
}

/**
 * The row height of a row and the last row with the same height and visibility, as
 * ScDocument::GetRowHeight(nRow, nTab, nullptr, &nLastRow) gives it (the run of the row height
 * and hidden segment trees).
 */
export function GetRowHeightRun(rDoc: ScDocument, nRow: SCROW, nTab: SCTAB): { nHeight: number; nEndRow: SCROW } {
  return rDoc.GetRowHeightRun(nRow, nTab);
}

export class ScViewData {
  /** Scaling factors */
  private nPPTX = nScreenPPTX;
  private nPPTY = nScreenPPTY;

  private maTabData: (ScViewDataTable | null)[] = [];
  private maMarkData: ScMarkData;
  /** Data of the displayed sheet */
  private pThisTab!: ScViewDataTable;
  private readonly pDocShell: ScDocShell;
  private readonly mrDoc: ScDocument;
  private maOptions = new ScViewOptions();

  /** The size of the whole grid area (all panes), in pixels. */
  private aScrSize = { Width: 0, Height: 0 };

  /** default zoom for missing TabData */
  private aDefZoomX = 1;
  private aDefZoomY = 1;

  private eRefType: ScRefType = ScRefType.SC_REFTYPE_NONE;

  /** displayed sheet */
  private mnTabNumber: SCTAB = 0;
  /** sheet which contains RefInput */
  private nRefTabNo: SCTAB = 0;
  private nRefStartX: SCCOL = 0;
  private nRefStartY: SCROW = 0;
  private nRefStartZ: SCTAB = 0;
  private nRefEndX: SCCOL = 0;
  private nRefEndY: SCROW = 0;
  private nRefEndZ: SCTAB = 0;
  /** Fill Cursor */
  private nFillStartX: SCCOL = 0;
  private nFillStartY: SCROW = 0;
  private nFillEndX: SCCOL = 0;
  private nFillEndY: SCROW = 0;
  /** Related position */
  private nEditCol: SCCOL = 0;
  private nEditRow: SCROW = 0;
  /** for Enter after Tab */
  private nTabStartCol: SCCOL = -1;
  /** for delete AutoFill */
  private aDelRange: ScRange | null = null;

  private nFillMode: ScFillMode = ScFillMode.NONE;
  /** Active? */
  private bEditActive = false;
  /** Reference input */
  private bIsRefMode = false;

  constructor(rDocSh: ScDocShell) {
    this.pDocShell = rDocSh;
    this.mrDoc = rDocSh.GetDocument();
    this.maMarkData = new ScMarkData(this.mrDoc.GetSheetLimits());
    this.mnTabNumber = 0;
    this.CreateTabData(0);
    this.pThisTab = this.maTabData[0]!;
    this.maMarkData.SelectOneTable(0);
    this.CalcPPT();
  }

  GetDocument(): ScDocument { return this.mrDoc; }
  GetDocShell(): ScDocShell { return this.pDocShell; }
  GetDocFunc() { return this.pDocShell.GetDocFunc(); }
  GetMarkData(): ScMarkData { return this.maMarkData; }
  SetMarkData(rNew: ScMarkData): void { this.maMarkData = rNew; }
  GetOptions(): ScViewOptions { return this.maOptions; }
  SetOptions(rOpt: ScViewOptions): void { this.maOptions = new ScViewOptions(rOpt); }

  // --- sheets ---

  /** The sheet whose data is shown (upstream's CurrentTabForData, without sheet views). */
  CurrentTabForData(): SCTAB { return this.mnTabNumber; }
  GetTabNo(): SCTAB { return this.mnTabNumber; }
  GetTabNumber(): SCTAB { return this.mnTabNumber; }
  GetRefTabNo(): SCTAB { return this.nRefTabNo; }
  SetRefTabNo(nNewTab: SCTAB): void { this.nRefTabNo = nNewTab; }

  private EnsureTabDataSize(nSize: number): void {
    while (this.maTabData.length < nSize) this.maTabData.push(null);
  }

  private CreateTabData(nNewTab: SCTAB): void {
    this.EnsureTabDataSize(nNewTab + 1);
    if (!this.maTabData[nNewTab]) {
      const t = new ScViewDataTable();
      t.aZoomX = this.aDefZoomX;
      t.aZoomY = this.aDefZoomY;
      this.maTabData[nNewTab] = t;
    }
  }

  private UpdateCurrentTab(): void {
    this.CreateTabData(this.mnTabNumber);
    this.pThisTab = this.maTabData[this.mnTabNumber]!;
  }

  /** The view data of a sheet (created on demand). */
  GetTabData(nTab: SCTAB): ScViewDataTable {
    this.CreateTabData(nTab);
    return this.maTabData[nTab]!;
  }

  SetTabNo(nNewTab: SCTAB): void {
    if (nNewTab < 0) return;
    this.mnTabNumber = nNewTab;
    this.CreateTabData(this.mnTabNumber);
    this.pThisTab = this.maTabData[this.mnTabNumber]!;

    this.CalcPPT(); //  for common column width correction
    this.RecalcPixPos(); //! not always needed!
  }

  InsertTab(nTab: SCTAB): void {
    if (nTab >= this.maTabData.length) this.EnsureTabDataSize(nTab + 1);
    else this.maTabData.splice(nTab, 0, null);
    this.CreateTabData(nTab);

    this.UpdateCurrentTab();
    this.maMarkData.InsertTab(nTab);
  }

  DeleteTab(nTab: SCTAB): void {
    this.maTabData.splice(nTab, 1);

    if (this.GetTabNumber() >= this.maTabData.length) {
      this.EnsureTabDataSize(1);
      this.mnTabNumber = this.maTabData.length - 1;
    }
    this.UpdateCurrentTab();
    this.maMarkData.DeleteTab(nTab);
  }

  CopyTab(nSrcTab: SCTAB, nDestTab: SCTAB): void {
    this.EnsureTabDataSize(nDestTab);
    const pSrc = this.maTabData[nSrcTab];
    this.maTabData.splice(nDestTab, 0, pSrc ? pSrc.clone() : null);

    this.UpdateCurrentTab();
    this.maMarkData.InsertTab(nDestTab);
  }

  MoveTab(nSrcTab: SCTAB, nDestTab: SCTAB): void {
    let pTab: ScViewDataTable | null = null;
    if (nSrcTab < this.maTabData.length) {
      pTab = this.maTabData[nSrcTab]!;
      this.maTabData.splice(nSrcTab, 1);
    }

    if (nDestTab < this.maTabData.length) this.maTabData.splice(nDestTab, 0, pTab);
    else {
      this.EnsureTabDataSize(nDestTab + 1);
      this.maTabData[nDestTab] = pTab;
    }

    this.UpdateCurrentTab();
    this.maMarkData.DeleteTab(nSrcTab);
    this.maMarkData.InsertTab(nDestTab); // adapted if needed
  }

  // --- cursor ---

  GetCurX(): SCCOL { return this.pThisTab.nCurX; }
  GetCurY(): SCROW { return this.pThisTab.nCurY; }
  GetCurXForTab(nTab: SCTAB): SCCOL { return this.GetTabData(nTab).nCurX; }
  GetCurYForTab(nTab: SCTAB): SCROW { return this.GetTabData(nTab).nCurY; }
  SetCurX(nNewCurX: SCCOL): void { this.pThisTab.nCurX = nNewCurX; }
  SetCurY(nNewCurY: SCROW): void { this.pThisTab.nCurY = nNewCurY; }
  SetCurXForTab(nNewCurX: SCCOL, nTabIndex: SCTAB): void { this.GetTabData(nTabIndex).nCurX = nNewCurX; }
  SetCurYForTab(nNewCurY: SCROW, nTabIndex: SCTAB): void { this.GetTabData(nTabIndex).nCurY = nNewCurY; }

  GetOldCurX(): SCCOL { return this.pThisTab.mbOldCursorValid ? this.pThisTab.nOldCurX : this.pThisTab.nCurX; }
  GetOldCurY(): SCROW { return this.pThisTab.mbOldCursorValid ? this.pThisTab.nOldCurY : this.pThisTab.nCurY; }
  SetOldCursor(nNewX: SCCOL, nNewY: SCROW): void {
    this.pThisTab.nOldCurX = nNewX;
    this.pThisTab.nOldCurY = nNewY;
    this.pThisTab.mbOldCursorValid = true;
  }
  ResetOldCursor(): void { this.pThisTab.mbOldCursorValid = false; }

  /** GetMoveCursor: the reference end in reference mode, else the cursor. */
  GetMoveCursor(): { nCurX: SCCOL; nCurY: SCROW } {
    if (this.bIsRefMode) return { nCurX: this.nRefEndX, nCurY: this.nRefEndY };
    return { nCurX: this.GetCurX(), nCurY: this.GetCurY() };
  }

  GetTabStartCol(): SCCOL { return this.nTabStartCol; }
  SetTabStartCol(nNew: SCCOL): void { this.nTabStartCol = nNew; }

  // --- panes ---

  GetPosX(eWhich: ScHSplitPos, nForTab = -1): SCCOL {
    if (nForTab === -1) return this.pThisTab.nPosX[eWhich];
    return this.GetTabData(nForTab).nPosX[eWhich];
  }
  GetPosY(eWhich: ScVSplitPos, nForTab = -1): SCROW {
    if (nForTab === -1) return this.pThisTab.nPosY[eWhich];
    return this.GetTabData(nForTab).nPosY[eWhich];
  }
  /** The pixel offset of the first visible column (negative: the width scrolled away). */
  GetPixPosX(eWhich: ScHSplitPos): number { return this.pThisTab.nPixPosX[eWhich]; }
  GetPixPosY(eWhich: ScVSplitPos): number { return this.pThisTab.nPixPosY[eWhich]; }

  GetHSplitMode(): ScSplitMode { return this.pThisTab.eHSplitMode; }
  GetVSplitMode(): ScSplitMode { return this.pThisTab.eVSplitMode; }
  GetHSplitPos(): number { return this.pThisTab.nHSplitPos; }
  GetVSplitPos(): number { return this.pThisTab.nVSplitPos; }
  GetFixPosX(): SCCOL { return this.pThisTab.nFixPosX; }
  GetFixPosY(): SCROW { return this.pThisTab.nFixPosY; }
  SetHSplitMode(eMode: ScSplitMode): void { this.pThisTab.eHSplitMode = eMode; }
  SetVSplitMode(eMode: ScSplitMode): void { this.pThisTab.eVSplitMode = eMode; }
  SetHSplitPos(nPos: number): void { this.pThisTab.nHSplitPos = nPos; }
  SetVSplitPos(nPos: number): void { this.pThisTab.nVSplitPos = nPos; }
  SetFixPosX(nPos: SCCOL): void { this.pThisTab.nFixPosX = nPos; }
  SetFixPosY(nPos: SCROW): void { this.pThisTab.nFixPosY = nPos; }
  GetActivePart(): ScSplitPos { return this.pThisTab.eWhichActive; }
  SetActivePart(eNewActive: ScSplitPos): void { this.pThisTab.eWhichActive = eNewActive; }

  /** The grid area's size in pixels (the window the view gives). */
  SetScrSize(nWidth: number, nHeight: number): void { this.aScrSize = { Width: nWidth, Height: nHeight }; }
  GetScrSize(): { Width: number; Height: number } {
    const eActive = this.GetActivePart();
    return { Width: this.GetGridWidth(WhichH(eActive)), Height: this.GetGridHeight(WhichV(eActive)) };
  }

  /**
   * ScTabView::GetGridWidth: a pane's width. Split, the left pane is nHSplitPos wide and the right
   * one the rest; unsplit, the left pane is the whole window.
   */
  GetGridWidth(eWhich: ScHSplitPos): number {
    if (this.pThisTab.eHSplitMode !== ScSplitMode.SC_SPLIT_NONE) {
      const nSplit = Math.min(this.pThisTab.nHSplitPos, this.aScrSize.Width);
      return eWhich === SC_SPLIT_LEFT ? nSplit : Math.max(0, this.aScrSize.Width - nSplit);
    }
    return eWhich === SC_SPLIT_LEFT ? this.aScrSize.Width : 0;
  }
  /** ScTabView::GetGridHeight: a pane's height (the top pane is nVSplitPos high when split). */
  GetGridHeight(eWhich: ScVSplitPos): number {
    if (this.pThisTab.eVSplitMode !== ScSplitMode.SC_SPLIT_NONE) {
      const nSplit = Math.min(this.pThisTab.nVSplitPos, this.aScrSize.Height);
      return eWhich === SC_SPLIT_TOP ? nSplit : Math.max(0, this.aScrSize.Height - nSplit);
    }
    return eWhich === SC_SPLIT_BOTTOM ? this.aScrSize.Height : 0;
  }

  // --- zoom ---

  GetZoomX(): number { return this.pThisTab.aZoomX; }
  GetZoomY(): number { return this.pThisTab.aZoomY; }
  GetPPTX(): number { return this.nPPTX; }
  GetPPTY(): number { return this.nPPTY; }

  /** SetZoom for the displayed sheet or all (bAll); the zoom is clamped to 20%–400% (MINZOOM, MAXZOOM). */
  SetZoom(rNewX: number, rNewY: number, bAll = false): void {
    const clamp = (z: number) => Math.min(4, Math.max(0.2, z));
    const tabs = bAll ? this.maTabData.map((_, i) => i) : [this.GetTabNumber()];
    for (const i of tabs) {
      const t = this.GetTabData(i);
      t.aZoomX = clamp(rNewX);
      t.aZoomY = clamp(rNewY);
    }
    if (bAll) { this.aDefZoomX = clamp(rNewX); this.aDefZoomY = clamp(rNewY); }
    this.RefreshZoom();
  }

  RefreshZoom(): void {
    this.CalcPPT();
    this.RecalcPixPos();
  }

  CalcPPT(): void {
    this.nPPTX = nScreenPPTX * this.GetZoomX();
    this.nPPTY = nScreenPPTY * this.GetZoomY();
  }

  /** after zoom changes */
  RecalcPixPos(): void {
    const nTab = this.CurrentTabForData();
    for (let eWhich = 0; eWhich < 2; eWhich++) {
      let nPixPosX = 0, nTPosX = 0;
      const nPosX = this.pThisTab.nPosX[eWhich]!;
      for (let i = 0; i < nPosX; i++) {
        const nThis = this.mrDoc.GetColWidth(i, nTab);
        nTPosX -= nThis;
        nPixPosX -= ScViewData.ToPixel(nThis, this.nPPTX);
      }
      this.pThisTab.nPixPosX[eWhich] = nPixPosX;
      this.pThisTab.nTPosX[eWhich] = nTPosX;

      let nPixPosY = 0, nTPosY = 0;
      const nPosY = this.pThisTab.nPosY[eWhich]!;
      for (let j = 0; j < nPosY;) {
        const { nHeight, nEndRow } = GetRowHeightRun(this.mrDoc, j, nTab);
        const nRows = Math.min(nPosY, nEndRow + 1) - j;
        nTPosY -= nHeight * nRows;
        nPixPosY -= ScViewData.ToPixel(nHeight, this.nPPTY) * nRows;
        j += nRows;
      }
      this.pThisTab.nPixPosY[eWhich] = nPixPosY;
      this.pThisTab.nTPosY[eWhich] = nTPosY;
    }
  }

  static ToPixel(nTwips: number, nFactor: number): number {
    let nRet = Math.trunc(nTwips * nFactor);
    if (!nRet && nTwips) nRet = 1;
    return nRet;
  }

  /**
   * while (rScrY <= nEndPixels && rPosY <= nEndRow) add pixels of row heights converted with
   * nPPTY to rScrY, optimized for row height segments. Upon return rPosY is the last row
   * evaluated <= nEndRow, rScrY may be > nEndPixels!
   */
  static AddPixelsWhile(rScrY: number, nEndPixels: number, rPosY: SCROW, nEndRow: SCROW, nPPTY: number, pDoc: ScDocument, nTab: SCTAB): { rScrY: number; rPosY: SCROW } {
    let nRow = rPosY;
    while (rScrY <= nEndPixels && nRow <= nEndRow) {
      const r = GetRowHeightRun(pDoc, nRow, nTab);
      const nHeight = r.nHeight;
      let nHeightEndRow = r.nEndRow;
      if (nHeightEndRow > nEndRow) nHeightEndRow = nEndRow;
      if (!nHeight) {
        if (nTab >= 0 && nTab < pDoc.GetTableCount()) nRow = nHeightEndRow + 1;
        else break;
      } else {
        let nRows = nHeightEndRow - nRow + 1;
        const nPixel = ScViewData.ToPixel(nHeight, nPPTY);
        let nAdd = nPixel * nRows;
        if (nAdd + rScrY > nEndPixels) {
          const nDiff = rScrY + nAdd - nEndPixels;
          nRows -= Math.trunc(nDiff / nPixel);
          nAdd = nPixel * nRows;
          // We're looking for a value that satisfies loop condition.
          if (nAdd + rScrY <= nEndPixels) {
            ++nRows;
            nAdd += nPixel;
          }
        }
        rScrY += nAdd;
        nRow += nRows;
      }
    }
    if (nRow > rPosY) --nRow;
    return { rScrY, rPosY: nRow };
  }

  /**
   * The pixel offset of a row from row 0 (or of a column), summing ToPixel per row: the
   * scroll position of the web shell's scroll bars.
   */
  GetRowPixelOffset(nRow: SCROW, nTab = this.CurrentTabForData()): number {
    let nPix = 0;
    for (let j = 0; j < nRow;) {
      const { nHeight, nEndRow } = GetRowHeightRun(this.mrDoc, j, nTab);
      const nRows = Math.min(nRow, nEndRow + 1) - j;
      nPix += ScViewData.ToPixel(nHeight, this.nPPTY) * nRows;
      j += nRows;
    }
    return nPix;
  }
  GetColPixelOffset(nCol: SCCOL, nTab = this.CurrentTabForData()): number {
    let nPix = 0;
    for (let i = 0; i < nCol; i++) nPix += ScViewData.ToPixel(this.mrDoc.GetColWidth(i, nTab), this.nPPTX);
    return nPix;
  }
  /** The row at a pixel offset from row 0 (the row that contains it), for the scroll bars. */
  GetRowAtPixelOffset(nPix: number, nTab = this.CurrentTabForData()): SCROW {
    let nPos = 0;
    for (let j = 0; j <= this.mrDoc.MaxRow();) {
      const { nHeight, nEndRow } = GetRowHeightRun(this.mrDoc, j, nTab);
      const nPixel = ScViewData.ToPixel(nHeight, this.nPPTY);
      const nRows = nEndRow - j + 1;
      if (nPixel && nPos + nPixel * nRows > nPix) return j + Math.floor((nPix - nPos) / nPixel);
      nPos += nPixel * nRows;
      j = nEndRow + 1;
    }
    return this.mrDoc.MaxRow();
  }
  GetColAtPixelOffset(nPix: number, nTab = this.CurrentTabForData()): SCCOL {
    let nPos = 0;
    for (let i = 0; i <= this.mrDoc.MaxCol(); i++) {
      const w = ScViewData.ToPixel(this.mrDoc.GetColWidth(i, nTab), this.nPPTX);
      if (w && nPos + w > nPix) return i;
      nPos += w;
    }
    return this.mrDoc.MaxCol();
  }

  /** The screen position of a cell's top left corner in a pane (relative to the pane's origin). */
  GetScrPos(nWhereX: SCCOL, nWhereY: SCROW, eWhich: ScSplitPos, bAllowNeg = false, nForTab: SCTAB = -1): Point {
    const eWhichX = WhichH(eWhich);
    const eWhichY = WhichV(eWhich);

    if (nForTab === -1) nForTab = this.CurrentTabForData();
    const aScrSizeW = this.GetGridWidth(eWhichX), aScrSizeH = this.GetGridHeight(eWhichY);

    const nPosX = this.GetPosX(eWhichX, nForTab);
    let nScrPosX = 0;

    if (bAllowNeg || nWhereX >= nPosX) {
      const nStartPosX = nPosX;
      if (nWhereX >= nStartPosX) {
        for (let nX = nStartPosX; nX < nWhereX && (bAllowNeg || nScrPosX <= aScrSizeW); nX++) {
          if (nX > this.mrDoc.MaxCol()) nScrPosX = 0x7fffffff;
          else {
            const nTSize = this.mrDoc.GetColWidth(nX, nForTab);
            if (nTSize) nScrPosX += ScViewData.ToPixel(nTSize, this.nPPTX);
          }
        }
      } else {
        for (let nX = nStartPosX; nX > nWhereX;) {
          --nX;
          const nTSize = this.mrDoc.GetColWidth(nX, nForTab);
          if (nTSize) nScrPosX -= ScViewData.ToPixel(nTSize, this.nPPTX);
        }
      }
    }

    const nPosY = this.GetPosY(eWhichY, nForTab);
    let nScrPosY = 0;

    if (bAllowNeg || nWhereY >= nPosY) {
      const nStartPosY = nPosY;
      if (nWhereY >= nStartPosY) {
        if (bAllowNeg) {
          for (let nY = nStartPosY; nY < nWhereY;) {
            const { nHeight, nEndRow } = GetRowHeightRun(this.mrDoc, nY, nForTab);
            const nRows = Math.min(nWhereY, nEndRow + 1) - nY;
            nScrPosY += ScViewData.ToPixel(nHeight, this.nPPTY) * nRows;
            nY += nRows;
          }
        } else {
          for (let nY = nStartPosY; nY < nWhereY && nScrPosY <= aScrSizeH;) {
            if (nY > this.mrDoc.MaxRow()) { nScrPosY = 0x7fffffff; break; }
            const { nHeight, nEndRow } = GetRowHeightRun(this.mrDoc, nY, nForTab);
            // Whole runs while they stay within the screen.
            const nPixel = ScViewData.ToPixel(nHeight, this.nPPTY);
            let nRows = Math.min(nWhereY, nEndRow + 1) - nY;
            if (nPixel) nRows = Math.min(nRows, Math.floor((aScrSizeH - nScrPosY) / nPixel) + 1);
            nScrPosY += nPixel * nRows;
            nY += nRows;
          }
        }
      } else {
        for (let nY = nStartPosY; nY > nWhereY;) {
          --nY;
          const nTSize = this.mrDoc.GetRowHeight(nY, nForTab);
          if (nTSize) nScrPosY -= ScViewData.ToPixel(nTSize, this.nPPTY);
        }
      }
    }

    if (this.mrDoc.IsLayoutRTL(nForTab)) {
      //  mirror horizontal position
      nScrPosX = aScrSizeW - 1 - nScrPosX;
    }

    return { X: nScrPosX, Y: nScrPosY };
  }

  /** Number of cells on a screen */
  CellsAtX(nPosX: SCCOL, nDir: SCCOL, eWhichX: ScHSplitPos, nScrSizeX = SC_SIZE_NONE): SCCOL {
    if (nScrSizeX === SC_SIZE_NONE) nScrSizeX = this.GetGridWidth(eWhichX);

    let nX: SCCOL;
    let nScrPosX = 0;
    if (nDir === 1) nX = nPosX; // forwards
    else nX = nPosX - 1; // backwards

    let bOut = false;
    for (; nScrPosX <= nScrSizeX && !bOut; nX = nX + nDir) {
      const nColNo = nX;
      if (nColNo < 0 || nColNo > this.mrDoc.MaxCol()) bOut = true;
      else {
        const nTSize = this.mrDoc.GetColWidth(nColNo, this.CurrentTabForData());
        if (nTSize) nScrPosX = nScrPosX + ScViewData.ToPixel(nTSize, this.nPPTX);
      }
    }

    if (nDir === 1) nX = nX - nPosX;
    else nX = nPosX - 1 - nX;

    if (nX > 0) --nX;
    return nX;
  }

  CellsAtY(nPosY: SCROW, nDir: SCROW, eWhichY: ScVSplitPos, nScrSizeY = SC_SIZE_NONE): SCROW {
    if (nScrSizeY === SC_SIZE_NONE) nScrSizeY = this.GetGridHeight(eWhichY);

    let nY: SCROW;

    if (nDir === 1) {
      // forward
      const r = ScViewData.AddPixelsWhile(0, nScrSizeY, nPosY, this.mrDoc.MaxRow(), this.nPPTY, this.mrDoc, this.CurrentTabForData());
      nY = r.rPosY;
      // Original loop ended on last evaluated +1 or if that was MaxRow even on MaxRow+2.
      nY += nY === this.mrDoc.MaxRow() ? 2 : 1;
      nY -= nPosY;
    } else {
      // backward
      nY = nPosY - 1;
      let nScrPosY = 0;
      while (nScrPosY <= nScrSizeY && nY >= 0) {
        const nTSize = this.mrDoc.GetRowHeight(nY, this.CurrentTabForData());
        if (nTSize) nScrPosY += ScViewData.ToPixel(nTSize, this.nPPTY);
        if (nScrPosY > nScrSizeY) break;
        --nY;
      }
      // Original loop ended on last evaluated -1 or if that was 0 even on -2.
      nY -= nY === 0 ? 2 : 1;
      nY = nPosY - 1 - nY;
    }

    if (nY > 0) --nY;
    return nY;
  }

  VisibleCellsX(eWhichX: ScHSplitPos): SCCOL { return this.CellsAtX(this.GetPosX(eWhichX), 1, eWhichX); }
  VisibleCellsY(eWhichY: ScVSplitPos): SCROW { return this.CellsAtY(this.GetPosY(eWhichY), 1, eWhichY); }
  PrevCellsX(eWhichX: ScHSplitPos): SCCOL { return this.CellsAtX(this.GetPosX(eWhichX), -1, eWhichX); }
  PrevCellsY(eWhichY: ScVSplitPos): SCROW { return this.CellsAtY(this.GetPosY(eWhichY), -1, eWhichY); }

  /** The pixel size of a cell, or of the merged area it starts; true when merged. */
  GetMergeSizePixel(nX: SCCOL, nY: SCROW): { rSizeXPix: number; rSizeYPix: number; bMerged: boolean } {
    const nCurrentTab = this.CurrentTabForData();
    const rMerge = this.mrDoc.GetPattern(nX, nY, nCurrentTab).GetItem('ATTR_MERGE');
    if (rMerge.nColMerge > 1 || rMerge.nRowMerge > 1) {
      let nOutWidth = 0;
      let nOutHeight = 0;
      const nCountX = rMerge.nColMerge;
      for (let i = 0; i < nCountX; i++) nOutWidth += ScViewData.ToPixel(this.mrDoc.GetColWidth(nX + i, nCurrentTab), this.nPPTX);
      const nCountY = rMerge.nRowMerge;
      for (let nRow = nY; nRow <= nY + nCountY - 1; ++nRow) {
        if (this.mrDoc.RowHidden(nRow, nCurrentTab)) continue;
        nOutHeight += ScViewData.ToPixel(this.mrDoc.GetRowHeight(nRow, nCurrentTab), this.nPPTY);
      }
      return { rSizeXPix: nOutWidth, rSizeYPix: nOutHeight, bMerged: true };
    }
    return {
      rSizeXPix: ScViewData.ToPixel(this.mrDoc.GetColWidth(nX, nCurrentTab), this.nPPTX),
      rSizeYPix: ScViewData.ToPixel(this.mrDoc.GetRowHeight(nY, nCurrentTab), this.nPPTY),
      bMerged: false,
    };
  }

  /** The cell at a pixel position of a pane; bTestMerge moves into the merged cell's origin. */
  GetPosFromPixel(nClickX: number, nClickY: number, eWhich: ScSplitPos, bTestMerge = true): { rPosX: SCCOL; rPosY: SCROW } {
    const nForTab = this.CurrentTabForData();
    const eHWhich = WhichH(eWhich);
    const eVWhich = WhichV(eWhich);

    if (this.mrDoc.IsLayoutRTL(nForTab)) {
      //  mirror horizontal position
      nClickX = this.GetGridWidth(eHWhich) - 1 - nClickX;
    }

    const nStartPosX = this.GetPosX(eHWhich, nForTab);
    const nStartPosY = this.GetPosY(eVWhich, nForTab);
    let rPosX = nStartPosX;
    let rPosY = nStartPosY;
    let nScrX = 0;
    let nScrY = 0;

    if (nClickX > 0) {
      while (rPosX <= this.mrDoc.MaxCol() && nClickX >= nScrX) {
        nScrX += ScViewData.ToPixel(this.mrDoc.GetColWidth(rPosX, nForTab), this.nPPTX);
        ++rPosX;
      }
      --rPosX;
    } else {
      while (rPosX > 0 && nClickX < nScrX) {
        --rPosX;
        nScrX -= ScViewData.ToPixel(this.mrDoc.GetColWidth(rPosX, nForTab), this.nPPTX);
      }
    }

    if (nClickY > 0) rPosY = ScViewData.AddPixelsWhile(nScrY, nClickY, rPosY, this.mrDoc.MaxRow(), this.nPPTY, this.mrDoc, nForTab).rPosY;
    else {
      while (rPosY > 0 && nClickY < nScrY) {
        --rPosY;
        nScrY -= ScViewData.ToPixel(this.mrDoc.GetRowHeight(rPosY, nForTab), this.nPPTY);
      }
    }

    //  cells too big?
    if (rPosX === nStartPosX && nClickX > 0) {
      if (nClickX > this.GetGridWidth(eHWhich)) ++rPosX;
    }
    if (rPosY === nStartPosY && nClickY > 0) {
      if (nClickY > this.GetGridHeight(eVWhich)) ++rPosY;
    }

    rPosX = Math.min(Math.max(rPosX, 0), this.mrDoc.MaxCol());
    rPosY = Math.min(Math.max(rPosY, 0), this.mrDoc.MaxRow());

    if (bTestMerge) {
      // public method to adapt position
      const r = this.mrDoc.SkipOverlapped(rPosX, rPosY, nForTab);
      rPosX = r.rCol;
      rPosY = r.rRow;
    }
    return { rPosX, rPosY };
  }

  /** Whether a click is in the left and top half of the cell. */
  GetMouseQuadrant(rClickPos: Point, eWhich: ScSplitPos, nPosX: SCCOL, nPosY: SCROW): { rLeft: boolean; rTop: boolean } {
    const bLayoutRTL = this.mrDoc.IsLayoutRTL(this.CurrentTabForData());
    const nLayoutSign = bLayoutRTL ? -1 : 1;

    const aCellStart = this.GetScrPos(nPosX, nPosY, eWhich, true);
    const { rSizeXPix: nSizeX, rSizeYPix: nSizeY } = this.GetMergeSizePixel(nPosX, nPosY);
    return { rLeft: (rClickPos.X - aCellStart.X) * nLayoutSign <= nSizeX / 2, rTop: rClickPos.Y - aCellStart.Y <= nSizeY / 2 };
  }

  SetPosX(eWhich: ScHSplitPos, nNewPosX: SCCOL): void {
    const nTab = this.CurrentTabForData();
    if (nNewPosX !== 0) {
      const nOldPosX = this.pThisTab.nPosX[eWhich];
      let nTPosX = this.pThisTab.nTPosX[eWhich];
      let nPixPosX = this.pThisTab.nPixPosX[eWhich];
      if (nNewPosX > nOldPosX) {
        for (let i = nOldPosX; i < nNewPosX; i++) {
          const nThis = this.mrDoc.GetColWidth(i, nTab);
          nTPosX -= nThis;
          nPixPosX -= ScViewData.ToPixel(nThis, this.nPPTX);
        }
      } else {
        for (let i = nNewPosX; i < nOldPosX; i++) {
          const nThis = this.mrDoc.GetColWidth(i, nTab);
          nTPosX += nThis;
          nPixPosX += ScViewData.ToPixel(nThis, this.nPPTX);
        }
      }

      this.pThisTab.nPosX[eWhich] = nNewPosX;
      this.pThisTab.nTPosX[eWhich] = nTPosX;
      this.pThisTab.nPixPosX[eWhich] = nPixPosX;
    } else {
      this.pThisTab.nPixPosX[eWhich] = this.pThisTab.nTPosX[eWhich] = this.pThisTab.nPosX[eWhich] = 0;
    }
  }

  SetPosY(eWhich: ScVSplitPos, nNewPosY: SCROW): void {
    const nTab = this.CurrentTabForData();
    if (nNewPosY !== 0) {
      const nOldPosY = this.pThisTab.nPosY[eWhich];
      let nTPosY = this.pThisTab.nTPosY[eWhich];
      let nPixPosY = this.pThisTab.nPixPosY[eWhich];
      if (nNewPosY > nOldPosY) {
        for (let i = nOldPosY; i < nNewPosY;) {
          const { nHeight: nThis, nEndRow: nHeightEndRow } = GetRowHeightRun(this.mrDoc, i, nTab);
          const nRows = Math.min(nNewPosY, nHeightEndRow + 1) - i;
          nTPosY -= nThis * nRows;
          nPixPosY -= ScViewData.ToPixel(nThis, this.nPPTY) * nRows;
          i += nRows;
        }
      } else {
        for (let i = nNewPosY; i < nOldPosY;) {
          const { nHeight: nThis, nEndRow: nHeightEndRow } = GetRowHeightRun(this.mrDoc, i, nTab);
          const nRows = Math.min(nOldPosY, nHeightEndRow + 1) - i;
          nTPosY += nThis * nRows;
          nPixPosY += ScViewData.ToPixel(nThis, this.nPPTY) * nRows;
          i += nRows;
        }
      }

      this.pThisTab.nPosY[eWhich] = nNewPosY;
      this.pThisTab.nTPosY[eWhich] = nTPosY;
      this.pThisTab.nPixPosY[eWhich] = nPixPosY;
    } else {
      this.pThisTab.nPixPosY[eWhich] = this.pThisTab.nTPosY[eWhich] = this.pThisTab.nPosY[eWhich] = 0;
    }
  }

  // --- selection ---

  /** The selection as one range: a simple mark, else the cursor's cell (or its merged area). */
  GetSimpleArea(): { eMarkType: ScMarkType; rRange: ScRange } {
    const rNewMark = this.maMarkData.clone(); // use a local copy for MarkToSimple
    let eMarkType: ScMarkType = ScMarkType.SC_MARK_NONE;
    let rRange: ScRange = new ScRange(this.GetCurX(), this.GetCurY(), this.GetTabNumber());

    if (rNewMark.IsMarked() || rNewMark.IsMultiMarked()) {
      if (rNewMark.IsMultiMarked()) rNewMark.MarkToSimple();

      if (rNewMark.IsMarked() && !rNewMark.IsMultiMarked()) {
        rRange = rNewMark.GetMarkArea().clone();
        eMarkType = ScMarkType.SC_MARK_SIMPLE;
      } else eMarkType = ScMarkType.SC_MARK_MULTI;
    }
    if (eMarkType !== ScMarkType.SC_MARK_SIMPLE) {
      if (eMarkType === ScMarkType.SC_MARK_NONE) eMarkType = ScMarkType.SC_MARK_SIMPLE;
      const pMarkPattern = this.mrDoc.GetPattern(this.GetCurX(), this.GetCurY(), this.CurrentTabForData());
      const pMergeItem = pMarkPattern.GetItemSet().ATTR_MERGE;
      if (pMergeItem) {
        const nRow = pMergeItem.nRowMerge;
        const nCol = pMergeItem.nColMerge;
        if (nRow < 1 || nCol < 1) rRange = new ScRange(this.GetCurX(), this.GetCurY(), this.GetTabNumber());
        else rRange = new ScRange(this.GetCurX(), this.GetCurY(), this.GetTabNumber(), this.GetCurX() + nCol - 1, this.GetCurY() + nRow - 1, this.GetTabNumber());
      } else rRange = new ScRange(this.GetCurX(), this.GetCurY(), this.GetTabNumber());
    }
    return { eMarkType, rRange };
  }

  /** The selection as ranges (a multi selection, else the simple area). */
  GetMultiArea(): ScRangeList {
    const aNewMark = this.maMarkData.clone(); // use a local copy for MarkToSimple

    let bMulti = aNewMark.IsMultiMarked();
    if (bMulti) {
      aNewMark.MarkToSimple();
      bMulti = aNewMark.IsMultiMarked();
    }
    if (bMulti) {
      const rRange = new ScRangeList();
      aNewMark.FillRangeListWithMarks(rRange, false);
      return rRange;
    }
    const rRange = new ScRangeList();
    rRange.push_back(this.GetSimpleArea().rRange);
    return rRange;
  }

  SimpleColMarked(): boolean {
    const { eMarkType, rRange } = this.GetSimpleArea();
    return eMarkType === ScMarkType.SC_MARK_SIMPLE && rRange.aStart.Row() === 0 && rRange.aEnd.Row() === this.mrDoc.MaxRow();
  }
  SimpleRowMarked(): boolean {
    const { eMarkType, rRange } = this.GetSimpleArea();
    return eMarkType === ScMarkType.SC_MARK_SIMPLE && rRange.aStart.Col() === 0 && rRange.aEnd.Col() === this.mrDoc.MaxCol();
  }

  // --- reference input mode ---

  IsRefMode(): boolean { return this.bIsRefMode; }
  GetRefType(): ScRefType { return this.eRefType; }
  SetRefMode(bNewMode: boolean, eNewType: ScRefType): void {
    this.bIsRefMode = bNewMode;
    this.eRefType = eNewType;
  }
  SetRefStart(nNewX: SCCOL, nNewY: SCROW, nNewZ: SCTAB): void {
    this.nRefStartX = nNewX; this.nRefStartY = nNewY; this.nRefStartZ = nNewZ;
  }
  SetRefEnd(nNewX: SCCOL, nNewY: SCROW, nNewZ: SCTAB): void {
    this.nRefEndX = nNewX; this.nRefEndY = nNewY; this.nRefEndZ = nNewZ;
  }
  GetRefStartX(): SCCOL { return this.nRefStartX; }
  GetRefStartY(): SCROW { return this.nRefStartY; }
  GetRefStartZ(): SCTAB { return this.nRefStartZ; }
  GetRefEndX(): SCCOL { return this.nRefEndX; }
  GetRefEndY(): SCROW { return this.nRefEndY; }
  GetRefEndZ(): SCTAB { return this.nRefEndZ; }

  // --- fill mode (the AutoFill handle) ---

  SetFillMode(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): void {
    this.nFillMode = ScFillMode.FILL;
    this.nFillStartX = nStartCol;
    this.nFillStartY = nStartRow;
    this.nFillEndX = nEndCol;
    this.nFillEndY = nEndRow;
  }
  ResetFillMode(): void { this.nFillMode = ScFillMode.NONE; }
  GetFillMode(): ScFillMode { return this.nFillMode; }
  GetFillData(): { rStartCol: SCCOL; rStartRow: SCROW; rEndCol: SCCOL; rEndRow: SCROW } {
    return { rStartCol: this.nFillStartX, rStartRow: this.nFillStartY, rEndCol: this.nFillEndX, rEndRow: this.nFillEndY };
  }
  SetDelMark(rRange: ScRange | null): void { this.aDelRange = rRange; }
  GetDelMark(): ScRange | null { return this.aDelRange; }

  // --- edit mode ---

  /** The cell being edited (the DOM editor over it), and whether editing is on. */
  SetEditEngine(nNewCol: SCCOL, nNewRow: SCROW): void {
    this.nEditCol = nNewCol;
    this.nEditRow = nNewRow;
    this.bEditActive = true;
  }
  ResetEditView(): void { this.bEditActive = false; }
  HasEditView(): boolean { return this.bEditActive; }
  GetEditViewCol(): SCCOL { return this.nEditCol; }
  GetEditViewRow(): SCROW { return this.nEditRow; }

  /** The cursor as an address (for convenience of the view functions). */
  GetCurPos(): ScAddress { return new ScAddress(this.GetCurX(), this.GetCurY(), this.CurrentTabForData()); }

  IsGridMode(): boolean { return this.pThisTab.bShowGrid; }
  /** View > Page Break: the page break preview (bPagebreak). */
  IsPagebreakMode(): boolean { return this.bPagebreak; }
  SetPagebreakMode(bSet: boolean): void { this.bPagebreak = bSet; }
  private bPagebreak = false;
  SetShowGrid(bShow: boolean): void { this.pThisTab.bShowGrid = bShow; }
}
