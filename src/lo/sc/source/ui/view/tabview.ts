// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/tabview.hxx reduced
// @upstream sc/source/ui/view/tabview.cxx partial
// @upstream sc/source/ui/view/tabview2.cxx partial
// @upstream sc/source/ui/view/tabview3.cxx partial
// ScTabView: the view's cursor and selection logic: moving the cell cursor (MoveCursorRel,
// MoveCursorArea with Ctrl, MoveCursorPage, MoveCursorEnd, MoveCursorEnter), keeping it visible
// (AlignToCursor, ScrollX/ScrollY), the block selection (InitBlockMode, MarkCursor, ExpandBlock),
// marking whole columns, rows, the data area or everything, the reference input mode (formula
// references picked with the mouse or keyboard), switching sheets (SetTabNo, SelectNextTab), and
// freezing panes (FreezeSplitters). The windows (grid windows, headers, tab bar, scroll bars,
// overlays) are the web shell's: ScTabView tells them through its listeners that the cursor, the
// selection or the visible area changed (CursorPosChanged, SelectionChanged, the paint calls).
// Left out: sheet protection's locked/unlocked cell options when moving, split windows that are
// not frozen (SC_SPLIT_NORMAL), the LibreOfficeKit paths, drawing objects, the hint windows of
// validation and the auto-fill mark's position caches. The page break preview keeps its page break
// data (UpdatePageBreakData); the grid window paints it.
import { ScRange, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { ScDirection, ScMoveDirection } from '../../../inc/global.ts';
import type { ScInputOptions } from '../../../inc/inputopt.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import type { ScDocument } from '../../core/data/document.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScPageBreakData } from '../docshell/pagedata.ts';
import { ScPrintFunc } from './printfun.ts';
import {
  SC_SPLIT_BOTTOM, SC_SPLIT_BOTTOMLEFT, SC_SPLIT_BOTTOMRIGHT, SC_SPLIT_LEFT, SC_SPLIT_RIGHT, SC_SPLIT_TOP, SC_SPLIT_TOPLEFT, SC_SPLIT_TOPRIGHT,
  ScFollowMode, ScRefType, ScSplitMode, ScViewData, WhichH, WhichV, type ScHSplitPos, type ScSplitPos, type ScVSplitPos,
} from './viewdata.ts';

const { SC_FOLLOW_NONE, SC_FOLLOW_LINE, SC_FOLLOW_FIX, SC_FOLLOW_JUMP, SC_FOLLOW_JUMP_END } = ScFollowMode;

/** The block mode: none, a selection being marked (Normal), or one set from outside (Own). */
const BlockMode = { None: 0, Normal: 1, Own: 2 } as const;
type BlockMode = (typeof BlockMode)[keyof typeof BlockMode];

/** The modifier keys of MarkColumns/MarkRows (KEY_SHIFT, KEY_MOD1). */
export const KEY_SHIFT = 0x1000;
export const KEY_MOD1 = 0x2000;

/** SplitMethod of FreezeSplitters. */
export const SplitMethod = { SC_SPLIT_METHOD_COL: 0, SC_SPLIT_METHOD_ROW: 1, SC_SPLIT_METHOD_CURSOR: 2 } as const;
export type SplitMethod = (typeof SplitMethod)[keyof typeof SplitMethod];

// tabview2.cxx's helpers (sheet protection's selection options are not modelled).

function moveCursorByProtRule(rCol: SCCOL, rRow: SCROW, nMovX: SCCOL, nMovY: SCROW, nTab: SCTAB, pDoc: ScDocument): { rCol: SCCOL; rRow: SCROW } {
  if (nMovX > 0) {
    for (let i = 0; i < nMovX && rCol < pDoc.MaxCol(); ++i) {
      let nNewUnhiddenCol = rCol + 1;
      while (pDoc.ColHidden(nNewUnhiddenCol, nTab)) {
        if (nNewUnhiddenCol >= pDoc.MaxCol()) return { rCol, rRow };
        ++nNewUnhiddenCol;
        ++i;
      }
      rCol = nNewUnhiddenCol;
    }
  } else if (nMovX < 0) {
    for (let i = 0; i > nMovX && rCol > 0; --i) {
      let nNewUnhiddenCol = rCol - 1;
      while (pDoc.ColHidden(nNewUnhiddenCol, nTab)) {
        if (nNewUnhiddenCol <= 0) return { rCol, rRow };
        --nNewUnhiddenCol;
        --i;
      }
      rCol = nNewUnhiddenCol;
    }
  }

  if (nMovY > 0) {
    for (let i = 0; i < nMovY && rRow < pDoc.MaxRow(); ++i) {
      let nNewUnhiddenRow = rRow + 1;
      while (pDoc.RowHidden(nNewUnhiddenRow, nTab)) {
        if (nNewUnhiddenRow >= pDoc.MaxRow()) return { rCol, rRow };
        const nEndRow = pDoc.FetchTable(nTab)!.RowHiddenRange(nNewUnhiddenRow).nLastRow;
        i += nEndRow - nNewUnhiddenRow + 1;
        nNewUnhiddenRow = nEndRow + 1;
      }
      rRow = nNewUnhiddenRow;
    }
  } else if (nMovY < 0) {
    for (let i = 0; i > nMovY && rRow > 0; --i) {
      let nNewUnhiddenRow = rRow - 1;
      while (pDoc.RowHidden(nNewUnhiddenRow, nTab)) {
        if (nNewUnhiddenRow <= 0) return { rCol, rRow };
        const nStartRow = pDoc.FetchTable(nTab)!.RowHiddenRange(nNewUnhiddenRow).nFirstRow;
        i -= nNewUnhiddenRow - nStartRow + 1;
        nNewUnhiddenRow = nStartRow - 1;
      }
      rRow = nNewUnhiddenRow;
    }
  }
  return { rCol, rRow };
}

function checkBoundary(pDoc: ScDocument, r: { rCol: SCCOL; rRow: SCROW }): boolean {
  let bGood = true;
  if (r.rCol < 0) { r.rCol = 0; bGood = false; } else if (r.rCol > pDoc.MaxCol()) { r.rCol = pDoc.MaxCol(); bGood = false; }
  if (r.rRow < 0) { r.rRow = 0; bGood = false; } else if (r.rRow > pDoc.MaxRow()) { r.rRow = pDoc.MaxRow(); bGood = false; }
  return bGood;
}

function moveRefByCell(rNewX: SCCOL, rNewY: SCROW, nMovX: SCCOL, nMovY: SCROW, nRefTab: SCTAB, rDoc: ScDocument): { rCol: SCCOL; rRow: SCROW } {
  const nOldX = rNewX;
  const nOldY = rNewY;
  const r = moveCursorByProtRule(rNewX, rNewY, nMovX, nMovY, nRefTab, rDoc);
  checkBoundary(rDoc, r);

  if (nMovX) {
    const t = { rCol: r.rCol, rRow: r.rRow };
    while (rDoc.IsHorOverlapped(t.rCol, r.rRow, nRefTab)) {
      t.rCol = nMovX > 0 ? t.rCol + 1 : t.rCol - 1;
      if (!checkBoundary(rDoc, t)) break;
    }
    r.rCol = t.rCol;
    if (nMovX < 0 && r.rCol > 0) {
      const rMergeAttr = rDoc.GetPattern(r.rCol, r.rRow, nRefTab).GetItem('ATTR_MERGE');
      if ((rMergeAttr.nColMerge > 1 || rMergeAttr.nRowMerge > 1) && nOldX >= r.rCol && nOldX <= r.rCol + rMergeAttr.nRowMerge - 1) r.rCol = r.rCol - 1;
    }
  }

  if (nMovY) {
    const t = { rCol: r.rCol, rRow: r.rRow };
    while (rDoc.IsVerOverlapped(r.rCol, t.rRow, nRefTab)) {
      t.rRow = nMovY > 0 ? t.rRow + 1 : t.rRow - 1;
      if (!checkBoundary(rDoc, t)) break;
    }
    r.rRow = t.rRow;
    if (nMovY < 0 && r.rRow > 0) {
      const rMergeAttr = rDoc.GetPattern(r.rCol, r.rRow, nRefTab).GetItem('ATTR_MERGE');
      if ((rMergeAttr.nColMerge > 1 || rMergeAttr.nRowMerge > 1) && nOldY >= r.rRow && nOldY <= r.rRow + rMergeAttr.nRowMerge - 1) r.rRow = r.rRow - 1;
    }
  }

  return rDoc.SkipOverlapped(r.rCol, r.rRow, nRefTab);
}

export interface ScTabViewListener {
  /** The cell cursor moved. */
  CursorPosChanged?(): void;
  /** The selection changed. */
  SelectionChanged?(): void;
  /** The visible area (scroll position, panes, sheet, zoom) changed. */
  VisAreaChanged?(): void;
  /** The reference input mode's range changed (UpdateRef). */
  RefChanged?(): void;
  /** Another sheet is shown. */
  TabChanged?(): void;
}

export class ScTabView {
  protected aViewData: ScViewData;
  /** The input options (Enter's direction …), the module's (ScModule::GetInputOptions). */
  protected maInputOptions: () => ScInputOptions;

  private meBlockMode: BlockMode = BlockMode.None;
  private bBlockNeg = false;
  private bBlockCols = false;
  private bBlockRows = false;
  private nBlockStartX: SCCOL = 0;
  private nBlockStartXOrig: SCCOL = 0;
  private nBlockEndX: SCCOL = 0;
  private nBlockStartY: SCROW = 0;
  private nBlockStartYOrig: SCROW = 0;
  private nBlockEndY: SCROW = 0;
  private nBlockStartZ: SCTAB = 0;
  private nOldCurX: SCCOL = 0;
  private nOldCurY: SCROW = 0;
  /** in ScTabView, true while a Shift movement must not cancel the selection */
  protected bMoveIsShift = false;

  private maListeners: ScTabViewListener[] = [];
  /** The input handler's formula reference mode (ScModule::IsFormulaMode / IsRefInputMode). */
  fnIsFormulaMode: () => boolean = () => false;

  constructor(rDocSh: ScDocShell, fnInputOptions: () => ScInputOptions) {
    this.aViewData = new ScViewData(rDocSh);
    this.maInputOptions = fnInputOptions;
  }

  GetViewData(): ScViewData { return this.aViewData; }

  AddListener(l: ScTabViewListener): () => void {
    this.maListeners.push(l);
    return () => { this.maListeners = this.maListeners.filter((x) => x !== l); };
  }
  private fire(k: keyof ScTabViewListener): void { for (const l of [...this.maListeners]) l[k]?.(); }

  CursorPosChanged(): void { this.fire('CursorPosChanged'); }
  SelectionChanged(): void { this.fire('SelectionChanged'); }
  /** The visible area changed: the windows repaint (UpdateScrollBars, Paint…). */
  VisAreaChanged(): void { this.fire('VisAreaChanged'); }

  // --- page break preview (tabview2.cxx) -----------------------------------------------------------

  protected pPageBreakData: ScPageBreakData | null = null;
  GetPageBreakData(): ScPageBreakData | null { return this.pPageBreakData; }

  /** UpdatePageBreakData: in the page break mode, the print ranges and pages of the shown sheet. */
  UpdatePageBreakData(bForcePaint = false): void {
    let pNewData: ScPageBreakData | null = null;

    if (this.aViewData.IsPagebreakMode()) {
      const pDocSh = this.aViewData.GetDocShell();
      const rDoc = pDocSh.GetDocument();
      const nTab = this.aViewData.CurrentTabForData();

      let nCount = rDoc.GetPrintRangeCount(nTab);
      if (!nCount) nCount = 1;
      pNewData = new ScPageBreakData(nCount);

      const aPrintFunc = new ScPrintFunc(null, pDocSh, nTab, 0, 0, null, null, pNewData);
      // ScPrintFunc fills the PageBreakData in ctor
      if (nCount > 1) {
        aPrintFunc.ResetBreaks(nTab);
        pNewData.AddPages();
      }

      // print area changed?
      if (bForcePaint || (this.pPageBreakData && !this.pPageBreakData.equals(pNewData))) this.VisAreaChanged();
    }

    this.pPageBreakData = pNewData;
  }

  // --- block mode (tabview2.cxx) ---

  IsBlockMode(): boolean { return this.meBlockMode !== BlockMode.None; }

  IsMarking(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean {
    return this.IsBlockMode() && this.nBlockStartX === nCol && this.nBlockStartY === nRow && this.nBlockStartZ === nTab;
  }

  InitOwnBlockMode(rMarkRange: ScRange): void {
    if (this.IsBlockMode()) return;

    this.meBlockMode = BlockMode.Own;
    this.nBlockStartX = rMarkRange.aStart.Col();
    this.nBlockStartY = rMarkRange.aStart.Row();
    this.nBlockStartZ = rMarkRange.aStart.Tab();
    this.nBlockEndX = rMarkRange.aEnd.Col();
    this.nBlockEndY = rMarkRange.aEnd.Row();

    this.SelectionChanged(); // status is checked with mark set
  }

  InitBlockMode(nCurX: SCCOL, nCurY: SCROW, nCurZ: SCTAB, bTestNeg = false, bCols = false, bRows = false, bForceNeg = false): void {
    if (this.IsBlockMode()) return;

    const rDoc = this.aViewData.GetDocument();
    if (!rDoc.ValidCol(nCurX)) nCurX = rDoc.MaxCol();
    if (!rDoc.ValidRow(nCurY)) nCurY = rDoc.MaxRow();

    const rMark = this.aViewData.GetMarkData();
    const nTab = this.aViewData.CurrentTabForData();

    //  unmark part?
    if (bForceNeg) this.bBlockNeg = true;
    else if (bTestNeg) {
      if (bCols) this.bBlockNeg = rMark.IsColumnMarked(nCurX);
      else if (bRows) this.bBlockNeg = rMark.IsRowMarked(nCurY);
      else this.bBlockNeg = rMark.IsCellMarked(nCurX, nCurY);
    } else this.bBlockNeg = false;
    rMark.SetMarkNegative(this.bBlockNeg);

    this.meBlockMode = BlockMode.Normal;
    this.bBlockCols = bCols;
    this.bBlockRows = bRows;
    this.nBlockStartX = this.nBlockStartXOrig = nCurX;
    this.nBlockStartY = this.nBlockStartYOrig = nCurY;
    this.nBlockStartZ = nCurZ;
    this.nBlockEndX = this.nOldCurX = this.nBlockStartX;
    this.nBlockEndY = this.nOldCurY = this.nBlockStartY;

    if (this.bBlockCols) {
      this.nBlockStartY = this.nBlockStartYOrig = 0;
      this.nBlockEndY = rDoc.MaxRow();
    }

    if (this.bBlockRows) {
      this.nBlockStartX = this.nBlockStartXOrig = 0;
      this.nBlockEndX = rDoc.MaxCol();
    }

    rMark.SetMarkArea(new ScRange(this.nBlockStartX, this.nBlockStartY, nTab, this.nBlockEndX, this.nBlockEndY, nTab));
  }

  DoneBlockMode(bContinue = false): void {
    // When switching between sheet and header SelectionEngine DeselectAll may be called,
    // because the other engine does not have any anchor.
    // bMoveIsShift prevents the selection to be canceled.

    if (!this.IsBlockMode() || this.bMoveIsShift) return;

    const rMark = this.aViewData.GetMarkData();
    const bFlag = rMark.GetMarkingFlag();
    rMark.SetMarking(false);

    if (this.bBlockNeg && !bContinue) rMark.MarkToMulti();

    if (bContinue) rMark.MarkToMulti();
    else {
      // PaintBlock(true): the block is deleted
      rMark.ResetMark();
    }
    this.meBlockMode = BlockMode.None;

    rMark.SetMarking(bFlag);
    rMark.SetMarkNegative(false);
  }

  MarkCursor(nCurX: SCCOL, nCurY: SCROW, nCurZ: SCTAB, bCols = false, bRows = false, bCellSelection = false): void {
    const rDocument = this.aViewData.GetDocument();
    if (!rDocument.ValidCol(nCurX)) nCurX = rDocument.MaxCol();
    if (!rDocument.ValidRow(nCurY)) nCurY = rDocument.MaxRow();

    if (!this.IsBlockMode()) this.InitBlockMode(nCurX, nCurY, nCurZ, false, bCols, bRows);

    if (bCols) nCurY = rDocument.MaxRow();
    if (bRows) nCurX = rDocument.MaxCol();

    const rMark = this.aViewData.GetMarkData();
    const aMarkRange = rMark.GetMarkArea();
    if ((aMarkRange.aStart.Col() !== this.nBlockStartX && aMarkRange.aEnd.Col() !== this.nBlockStartX) ||
        (aMarkRange.aStart.Row() !== this.nBlockStartY && aMarkRange.aEnd.Row() !== this.nBlockStartY) ||
        this.meBlockMode === BlockMode.Own) {
      //  Mark has been changed
      // (Eg MarkToSimple if by negative everything was erased, except for a rectangle)
      // or after InitOwnBlockMode is further marked with shift-
      const bOldShift = this.bMoveIsShift;
      this.bMoveIsShift = false; //  really move
      this.DoneBlockMode(); //! Set variables directly? (-> no flicker)
      this.bMoveIsShift = bOldShift;

      this.InitBlockMode(aMarkRange.aStart.Col(), aMarkRange.aStart.Row(), this.nBlockStartZ, rMark.IsMarkNegative(), bCols, bRows);
    }

    if (nCurX !== this.nOldCurX || nCurY !== this.nOldCurY) {
      // Current cursor has moved

      const nTab = nCurZ;

      if (bCellSelection) {
        // Expand selection area accordingly when the current selection cuts
        // through a merged cell.
        let cellSel = new ScRange(this.nBlockStartXOrig, this.nBlockStartYOrig, nTab, nCurX, nCurY, nTab);
        cellSel.PutInOrder();
        let oldSel: ScRange;
        do {
          oldSel = cellSel.clone();
          rDocument.ExtendOverlapped(cellSel);
          const r = rDocument.ExtendMerge(cellSel);
          cellSel = new ScRange(cellSel.aStart.Col(), cellSel.aStart.Row(), nTab, Math.max(r.nEndCol, cellSel.aEnd.Col()), Math.max(r.nEndRow, cellSel.aEnd.Row()), nTab);
        } while (!oldSel.equals(cellSel));

        // Preserve the directionality of the selection
        if (nCurX >= this.nBlockStartXOrig) {
          this.nBlockStartX = cellSel.aStart.Col();
          this.nBlockEndX = cellSel.aEnd.Col();
        } else {
          this.nBlockStartX = cellSel.aEnd.Col();
          this.nBlockEndX = cellSel.aStart.Col();
        }
        if (nCurY >= this.nBlockStartYOrig) {
          this.nBlockStartY = cellSel.aStart.Row();
          this.nBlockEndY = cellSel.aEnd.Row();
        } else {
          this.nBlockStartY = cellSel.aEnd.Row();
          this.nBlockEndY = cellSel.aStart.Row();
        }
      } else {
        this.nBlockEndX = nCurX;
        this.nBlockEndY = nCurY;
      }

      // Set new selection area
      const aNew = new ScRange(this.nBlockStartX, this.nBlockStartY, nTab, this.nBlockEndX, this.nBlockEndY, nTab);
      aNew.PutInOrder();
      rMark.SetMarkArea(aNew);

      this.SelectionChanged();

      this.nOldCurX = this.nBlockEndX;
      this.nOldCurY = this.nBlockEndY;
    }
  }

  /** The block's moving end (nBlockEndX/Y), for the status and the keyboard. */
  GetBlockEnd(): { nBlockEndX: SCCOL; nBlockEndY: SCROW } { return { nBlockEndX: this.nBlockEndX, nBlockEndY: this.nBlockEndY }; }

  GetPageMoveEndPosition(nMovX: SCCOL, nMovY: SCROW): { rPageX: SCCOL; rPageY: SCROW } {
    let nCurX: SCCOL;
    let nCurY: SCROW;
    if (this.aViewData.IsRefMode()) {
      nCurX = this.aViewData.GetRefEndX();
      nCurY = this.aViewData.GetRefEndY();
    } else if (this.IsBlockMode()) {
      // block end position.
      nCurX = this.nBlockEndX;
      nCurY = this.nBlockEndY;
    } else {
      // cursor position
      nCurX = this.aViewData.GetCurX();
      nCurY = this.aViewData.GetCurY();
    }

    const eWhich = this.aViewData.GetActivePart();
    const eWhichX = WhichH(eWhich);
    const eWhichY = WhichV(eWhich);

    let nPageX: SCCOL;
    let nPageY: SCROW;
    if (nMovX >= 0) nPageX = this.aViewData.CellsAtX(nCurX, 1, eWhichX) * nMovX;
    else nPageX = this.aViewData.CellsAtX(nCurX, -1, eWhichX) * nMovX;

    if (nMovY >= 0) nPageY = this.aViewData.CellsAtY(nCurY, 1, eWhichY) * nMovY;
    else nPageY = this.aViewData.CellsAtY(nCurY, -1, eWhichY) * nMovY;

    if (nMovX !== 0 && nPageX === 0) nPageX = nMovX > 0 ? 1 : -1;
    if (nMovY !== 0 && nPageY === 0) nPageY = nMovY > 0 ? 1 : -1;

    return { rPageX: nPageX, rPageY: nPageY };
  }

  GetAreaMoveEndPosition(nMovX: SCCOL, nMovY: SCROW, eMode: ScFollowMode): { rAreaX: SCCOL; rAreaY: SCROW; rMode: ScFollowMode } {
    let nNewX = -1;
    let nNewY = -1;

    // current cursor position.
    let nCurX = this.aViewData.GetCurX();
    let nCurY = this.aViewData.GetCurY();

    const bLegacyCellSelection = this.maInputOptions().GetLegacyCellSelection();

    if (this.aViewData.IsRefMode()) {
      nNewX = this.aViewData.GetRefEndX();
      nNewY = this.aViewData.GetRefEndY();
      nCurX = this.aViewData.GetRefStartX();
      nCurY = this.aViewData.GetRefStartY();
    } else if (this.IsBlockMode()) {
      // block end position.
      nNewX = this.nBlockEndX;
      nNewY = this.nBlockEndY;
    } else {
      nNewX = nCurX;
      nNewY = nCurY;
    }

    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();

    // FindAreaPos knows only -1 or 1 as direction
    const nVirtualX = bLegacyCellSelection ? nNewX : nCurX;
    const nVirtualY = bLegacyCellSelection ? nNewY : nCurY;

    if (nMovX > 0) for (let i = 0; i < nMovX; i++) nNewX = rDoc.FindAreaPos(nNewX, nVirtualY, nTab, ScMoveDirection.SC_MOVE_RIGHT).rCol;
    if (nMovX < 0) for (let i = 0; i < -nMovX; i++) nNewX = rDoc.FindAreaPos(nNewX, nVirtualY, nTab, ScMoveDirection.SC_MOVE_LEFT).rCol;
    if (nMovY > 0) for (let i = 0; i < nMovY; i++) nNewY = rDoc.FindAreaPos(nVirtualX, nNewY, nTab, ScMoveDirection.SC_MOVE_DOWN).rRow;
    if (nMovY < 0) for (let i = 0; i < -nMovY; i++) nNewY = rDoc.FindAreaPos(nVirtualX, nNewY, nTab, ScMoveDirection.SC_MOVE_UP).rRow;

    if (eMode === SC_FOLLOW_JUMP) {
      // bottom right do not show too much grey
      if (nMovX !== 0 && nNewX === rDoc.MaxCol()) eMode = SC_FOLLOW_LINE;
      if (nMovY !== 0 && nNewY === rDoc.MaxRow()) eMode = SC_FOLLOW_LINE;
    }

    let rAreaX: SCCOL, rAreaY: SCROW;
    if (this.aViewData.IsRefMode()) {
      rAreaX = nNewX - this.aViewData.GetRefEndX();
      rAreaY = nNewY - this.aViewData.GetRefEndY();
    } else if (this.IsBlockMode()) {
      rAreaX = nNewX - this.nBlockEndX;
      rAreaY = nNewY - this.nBlockEndY;
    } else {
      rAreaX = nNewX - nCurX;
      rAreaY = nNewY - nCurY;
    }
    return { rAreaX, rAreaY, rMode: eMode };
  }

  SkipCursorHorizontal(rCurX: SCCOL, rCurY: SCROW, nOldX: SCCOL, nMovX: SCCOL): { rCurX: SCCOL; rCurY: SCROW } {
    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();

    let bSkipCell = false;
    let bHFlip = false;
    // If a number of last columns are hidden, search up to and including the first of them,
    // because after it nothing changes.
    let nMaxCol = rDoc.MaxCol();
    if (rDoc.ColHidden(rDoc.MaxCol(), nTab)) nMaxCol = rDoc.FetchTable(nTab)!.ColHiddenRange(rDoc.MaxCol()).nFirstCol + 1;
    // Search also at least up to and including the first unallocated column (all unallocated columns
    // share a set of attrs).
    nMaxCol = Math.max(nMaxCol, Math.min(rDoc.GetAllocatedColumnsCount(nTab) + 1, rDoc.MaxCol()));
    do {
      bSkipCell = rDoc.ColHidden(rCurX, nTab) || rDoc.IsHorOverlapped(rCurX, rCurY, nTab);

      if (bSkipCell) {
        if (rCurX <= 0 || rCurX >= nMaxCol) {
          if (bHFlip) {
            rCurX = nOldX;
            bSkipCell = false;
          } else {
            nMovX = -nMovX;
            if (nMovX > 0) ++rCurX;
            else --rCurX;
            bHFlip = true;
          }
        } else if (nMovX > 0) ++rCurX;
        else --rCurX;
      }
    } while (bSkipCell);

    if (rDoc.IsVerOverlapped(rCurX, rCurY, nTab)) {
      this.aViewData.SetOldCursor(rCurX, rCurY);
      while (rDoc.IsVerOverlapped(rCurX, rCurY, nTab)) --rCurY;
    }
    return { rCurX, rCurY };
  }

  SkipCursorVertical(rCurX: SCCOL, rCurY: SCROW, nOldY: SCROW, nMovY: SCROW): { rCurX: SCCOL; rCurY: SCROW } {
    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();

    let bSkipCell = false;
    let bVFlip = false;
    do {
      bSkipCell = rDoc.RowHidden(rCurY, nTab) || rDoc.IsVerOverlapped(rCurX, rCurY, nTab);

      if (bSkipCell) {
        if (rCurY <= 0 || rCurY >= rDoc.MaxRow()) {
          if (bVFlip) {
            rCurY = nOldY;
            bSkipCell = false;
          } else {
            nMovY = -nMovY;
            if (nMovY > 0) ++rCurY;
            else --rCurY;
            bVFlip = true;
          }
        } else if (nMovY > 0) ++rCurY;
        else --rCurY;
      }
    } while (bSkipCell);

    if (rDoc.IsHorOverlapped(rCurX, rCurY, nTab)) {
      this.aViewData.SetOldCursor(rCurX, rCurY);
      while (rDoc.IsHorOverlapped(rCurX, rCurY, nTab)) --rCurX;
    }
    return { rCurX, rCurY };
  }

  ExpandBlock(nMovX: SCCOL, nMovY: SCROW, eMode: ScFollowMode): void {
    if (!nMovX && !nMovY) return; // Nothing to do.  Bail out.

    const bRefInputMode = this.fnIsFormulaMode();
    if (bRefInputMode && !this.aViewData.IsRefMode()) {
      // initialize formula reference mode if it hasn't already.
      this.InitRefMode(this.aViewData.GetCurX(), this.aViewData.GetCurY(), this.aViewData.CurrentTabForData(), ScRefType.SC_REFTYPE_REF);
    }

    const rDoc = this.aViewData.GetDocument();

    if (this.aViewData.IsRefMode()) {
      // formula reference mode

      const nRefTab = this.aViewData.GetRefEndZ();
      const r = moveRefByCell(this.aViewData.GetRefEndX(), this.aViewData.GetRefEndY(), nMovX, nMovY, nRefTab, rDoc);
      const nNewX = r.rCol, nNewY = r.rRow;

      this.UpdateRef(nNewX, nNewY, nRefTab);
      let nTargetCol = nNewX;
      let nTargetRow = nNewY;
      if ((this.aViewData.GetRefStartX() === 0 || this.aViewData.GetRefStartY() === 0) && (nNewX !== rDoc.MaxCol() || nNewY !== rDoc.MaxRow())) {
        // Row selection
        if (this.aViewData.GetRefStartX() === 0 && nNewX === rDoc.MaxCol()) nTargetCol = this.aViewData.GetCurX();
        // Column selection
        if (this.aViewData.GetRefStartY() === 0 && nNewY === rDoc.MaxRow()) nTargetRow = this.aViewData.GetCurY();
      }
      this.AlignToCursor(nTargetCol, nTargetRow, eMode);
    } else {
      // normal selection mode

      const nTab = this.aViewData.CurrentTabForData();
      const nOrigX = this.aViewData.GetCurX();
      const nOrigY = this.aViewData.GetCurY();

      // Note that the origin position *never* moves during selection.

      if (!this.IsBlockMode()) {
        this.InitBlockMode(nOrigX, nOrigY, nTab, true);
        const rMergeAttr = rDoc.GetPattern(nOrigX, nOrigY, nTab).GetItem('ATTR_MERGE');
        if (rMergeAttr.nColMerge > 1 || rMergeAttr.nRowMerge > 1) {
          this.nBlockEndX = nOrigX + rMergeAttr.nColMerge - 1;
          this.nBlockEndY = nOrigY + rMergeAttr.nRowMerge - 1;
        }
      }

      const r = moveCursorByProtRule(this.nBlockEndX, this.nBlockEndY, nMovX, nMovY, nTab, rDoc);
      checkBoundary(rDoc, r);
      this.MarkCursor(r.rCol, r.rRow, nTab, false, false, true);

      // Check if the entire row(s) or column(s) are selected.
      const eActive = this.aViewData.GetActivePart();
      const bRowSelected = this.nBlockStartX === 0 && this.nBlockEndX === rDoc.MaxCol();
      const bColSelected = this.nBlockStartY === 0 && this.nBlockEndY === rDoc.MaxRow();
      const nAlignX = bRowSelected ? this.aViewData.GetPosX(WhichH(eActive)) : this.nBlockEndX;
      const nAlignY = bColSelected ? this.aViewData.GetPosY(WhichV(eActive)) : this.nBlockEndY;
      this.AlignToCursor(nAlignX, nAlignY, eMode);

      this.SelectionChanged();
    }
  }

  ExpandBlockPage(nMovX: SCCOL, nMovY: SCROW): void {
    const { rPageX, rPageY } = this.GetPageMoveEndPosition(nMovX, nMovY);
    this.ExpandBlock(rPageX, rPageY, SC_FOLLOW_FIX);
  }

  ExpandBlockArea(nMovX: SCCOL, nMovY: SCROW): void {
    const { rAreaX, rAreaY, rMode } = this.GetAreaMoveEndPosition(nMovX, nMovY, SC_FOLLOW_JUMP);
    this.ExpandBlock(rAreaX, rAreaY, rMode);
  }

  SelectAll(bContinue = false): void {
    const rDoc = this.aViewData.GetDocument();
    const rMark = this.aViewData.GetMarkData();
    const nTab = this.aViewData.CurrentTabForData();

    if (rMark.IsMarked()) {
      if (rMark.GetMarkArea().equals(new ScRange(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab))) return;
    }

    this.DoneBlockMode(bContinue);
    this.InitBlockMode(0, 0, nTab);
    this.MarkCursor(rDoc.MaxCol(), rDoc.MaxRow(), nTab);

    this.SelectionChanged();
  }

  // --- reference input mode (tabview4.cxx) ---

  InitRefMode(nCurX: SCCOL, nCurY: SCROW, nCurZ: SCTAB, eType: ScRefType): void {
    const rDoc = this.aViewData.GetDocument();
    if (!this.aViewData.IsRefMode()) {
      this.aViewData.SetRefMode(true, eType);
      this.aViewData.SetRefStart(nCurX, nCurY, nCurZ);
      this.aViewData.SetRefEnd(nCurX, nCurY, nCurZ);

      // A merged cell is referenced as its whole area.
      const r = rDoc.ExtendMerge(nCurX, nCurY, nCurX, nCurY, nCurZ);
      if (r.nEndCol !== nCurX || r.nEndRow !== nCurY) this.aViewData.SetRefEnd(r.nEndCol, r.nEndRow, nCurZ);
      this.fire('RefChanged');
    }
  }

  UpdateRef(nCurX: SCCOL, nCurY: SCROW, nCurZ: SCTAB): void {
    const rDoc = this.aViewData.GetDocument();
    if (!this.aViewData.IsRefMode()) {
      //  This will happen, when first at a reference dialog with Control in
      //  the table is clicked. Then append the new reference to the old content:
      this.InitRefMode(nCurX, nCurY, nCurZ, ScRefType.SC_REFTYPE_REF);
      this.fire('RefChanged');
      return;
    }

    if (nCurX !== this.aViewData.GetRefEndX() || nCurY !== this.aViewData.GetRefEndY() || nCurZ !== this.aViewData.GetRefEndZ()) {
      const aRange = new ScRange(this.aViewData.GetRefStartX(), this.aViewData.GetRefStartY(), nCurZ, nCurX, nCurY, nCurZ);
      aRange.PutInOrder();
      // ExtendMerge: a reference that cuts through a merged cell takes all of it.
      rDoc.ExtendOverlapped(aRange);
      const r = rDoc.ExtendMerge(aRange);
      if (this.aViewData.GetRefType() === ScRefType.SC_REFTYPE_REF && (r.nEndCol > aRange.aEnd.Col() || r.nEndRow > aRange.aEnd.Row() || aRange.aStart.Col() < Math.min(this.aViewData.GetRefStartX(), nCurX))) {
        // keep the drag direction
        if (nCurX >= this.aViewData.GetRefStartX()) nCurX = Math.max(nCurX, r.nEndCol);
        if (nCurY >= this.aViewData.GetRefStartY()) nCurY = Math.max(nCurY, r.nEndRow);
      }
      this.aViewData.SetRefEnd(nCurX, nCurY, nCurZ);
      this.fire('RefChanged');
    }
  }

  DoneRefMode(bContinue = false): void {
    void bContinue;
    if (this.aViewData.IsRefMode()) {
      this.aViewData.SetRefMode(false, ScRefType.SC_REFTYPE_NONE);
      this.fire('RefChanged');
    }
  }

  // --- tabview3.cxx ---

  /** The cursor is set where the mouse was clicked (ClickCursor). */
  ClickCursor(nPosX: SCCOL, nPosY: SCROW): void {
    const rDoc = this.aViewData.GetDocument();
    const r = rDoc.SkipOverlapped(nPosX, nPosY, this.aViewData.CurrentTabForData());
    this.aViewData.ResetOldCursor();
    this.SetCursor(r.rCol, r.rRow);
  }

  SetCursor(nPosX: SCCOL, nPosY: SCROW, bNew = false): void {
    const nOldX = this.aViewData.GetCurX();
    const nOldY = this.aViewData.GetCurY();

    if (!(nPosX !== nOldX || nPosY !== nOldY || bNew)) return;

    this.aViewData.SetCurX(nPosX);
    this.aViewData.SetCurY(nPosY);

    this.CursorPosChanged();
  }

  AlignToCursor(nCurX: SCCOL, nCurY: SCROW, eMode: ScFollowMode, pWhich?: ScSplitPos): void {
    // now switch active part here

    const eActive = this.aViewData.GetActivePart();
    let eActiveX = WhichH(eActive);
    let eActiveY = WhichV(eActive);
    const bHFix = this.aViewData.GetHSplitMode() === ScSplitMode.SC_SPLIT_FIX;
    const bVFix = this.aViewData.GetVSplitMode() === ScSplitMode.SC_SPLIT_FIX;
    if (bHFix && eActiveX === SC_SPLIT_LEFT && nCurX >= this.aViewData.GetFixPosX()) {
      this.ActivatePart(eActiveY === SC_SPLIT_TOP ? SC_SPLIT_TOPRIGHT : SC_SPLIT_BOTTOMRIGHT);
      eActiveX = SC_SPLIT_RIGHT;
    }
    if (bVFix && eActiveY === SC_SPLIT_TOP && nCurY >= this.aViewData.GetFixPosY()) {
      this.ActivatePart(eActiveX === SC_SPLIT_LEFT ? SC_SPLIT_BOTTOMLEFT : SC_SPLIT_BOTTOMRIGHT);
      eActiveY = SC_SPLIT_BOTTOM;
    }

    // actual align

    if (eMode !== SC_FOLLOW_NONE) {
      const eAlign = pWhich ?? this.aViewData.GetActivePart();
      const eAlignX = WhichH(eAlign);
      const eAlignY = WhichV(eAlign);

      const nDeltaX = this.aViewData.GetPosX(eAlignX);
      const nDeltaY = this.aViewData.GetPosY(eAlignY);
      let nSizeX = this.aViewData.VisibleCellsX(eAlignX);
      let nSizeY = this.aViewData.VisibleCellsY(eAlignY);

      let nCellSizeX: number;
      let nCellSizeY: number;
      if (nCurX >= 0 && nCurY >= 0) {
        const s = this.aViewData.GetMergeSizePixel(nCurX, nCurY);
        nCellSizeX = s.rSizeXPix;
        nCellSizeY = s.rSizeYPix;
      } else nCellSizeX = nCellSizeY = 0;
      const aScrSize = { Width: this.aViewData.GetGridWidth(eAlignX), Height: this.aViewData.GetGridHeight(eAlignY) };

      let nDenom: number;
      if (eMode === SC_FOLLOW_JUMP_END && nCurX > this.aViewData.GetRefStartX() && nCurY > this.aViewData.GetRefStartY())
        nDenom = 1; // tdf#154271 Selected cell will be at the bottom corner to maximize the visible/usable area
      else nDenom = 2; // Selected cell will be at the center of the screen, so that it will be visible.
      const nSpaceX = Math.trunc((aScrSize.Width - nCellSizeX) / nDenom);
      const nSpaceY = Math.trunc((aScrSize.Height - nCellSizeY) / nDenom);
      //  nSpaceY: desired start position of cell for FOLLOW_JUMP, modified if dialog interferes

      let nNewDeltaX = nDeltaX;
      let nNewDeltaY = nDeltaY;
      let bDoLine = false;

      switch (eMode) {
        case SC_FOLLOW_JUMP:
        case SC_FOLLOW_JUMP_END:
          if (nCurX < nDeltaX || nCurX >= nDeltaX + nSizeX) {
            nNewDeltaX = nCurX - this.aViewData.CellsAtX(nCurX, -1, eAlignX, nSpaceX);
            if (nNewDeltaX < 0) nNewDeltaX = 0;
            nSizeX = this.aViewData.CellsAtX(nNewDeltaX, 1, eAlignX);
          }
          if (nCurY < nDeltaY || nCurY >= nDeltaY + nSizeY) {
            nNewDeltaY = nCurY - this.aViewData.CellsAtY(nCurY, -1, eAlignY, nSpaceY);
            if (nNewDeltaY < 0) nNewDeltaY = 0;
            nSizeY = this.aViewData.CellsAtY(nNewDeltaY, 1, eAlignY);
          }
          bDoLine = true;
          break;

        case SC_FOLLOW_LINE:
          bDoLine = true;
          break;

        case SC_FOLLOW_FIX:
          if (nCurX < nDeltaX || nCurX >= nDeltaX + nSizeX) {
            nNewDeltaX = nDeltaX + nCurX - this.aViewData.GetCurX();
            if (nNewDeltaX < 0) nNewDeltaX = 0;
            nSizeX = this.aViewData.CellsAtX(nNewDeltaX, 1, eAlignX);
          }
          if (nCurY < nDeltaY || nCurY >= nDeltaY + nSizeY) {
            nNewDeltaY = nDeltaY + nCurY - this.aViewData.GetCurY();
            if (nNewDeltaY < 0) nNewDeltaY = 0;
            nSizeY = this.aViewData.CellsAtY(nNewDeltaY, 1, eAlignY);
          }

          //  like old version of SC_FOLLOW_JUMP:

          if (nCurX < nNewDeltaX || nCurX >= nNewDeltaX + nSizeX) {
            nNewDeltaX = nCurX - Math.trunc(nSizeX / 2);
            if (nNewDeltaX < 0) nNewDeltaX = 0;
            nSizeX = this.aViewData.CellsAtX(nNewDeltaX, 1, eAlignX);
          }
          if (nCurY < nNewDeltaY || nCurY >= nNewDeltaY + nSizeY) {
            nNewDeltaY = nCurY - Math.trunc(nSizeY / 2);
            if (nNewDeltaY < 0) nNewDeltaY = 0;
            nSizeY = this.aViewData.CellsAtY(nNewDeltaY, 1, eAlignY);
          }

          bDoLine = true;
          break;

        default:
          break;
      }

      const rDoc = this.aViewData.GetDocument();
      const nTab = this.aViewData.CurrentTabForData();
      if (bDoLine) {
        while (nCurX >= nNewDeltaX + nSizeX && nSizeX >= 0) {
          nNewDeltaX = nCurX - nSizeX + 1;
          while (nNewDeltaX < rDoc.MaxCol() && !rDoc.GetColWidth(nNewDeltaX, nTab)) ++nNewDeltaX;
          nSizeX = this.aViewData.CellsAtX(nNewDeltaX, 1, eAlignX);
          if (nSizeX === 0) break;
        }
        while (nCurY >= nNewDeltaY + nSizeY && nSizeY >= 0) {
          nNewDeltaY = nCurY - nSizeY + 1;
          while (nNewDeltaY < rDoc.MaxRow() && !rDoc.GetRowHeight(nNewDeltaY, nTab)) ++nNewDeltaY;
          nSizeY = this.aViewData.CellsAtY(nNewDeltaY, 1, eAlignY);
          if (nSizeY === 0) break;
        }
        if (nCurX < nNewDeltaX) nNewDeltaX = nCurX;
        if (nCurY < nNewDeltaY) nNewDeltaY = nCurY;
      }

      if (nNewDeltaX !== nDeltaX) nSizeX = this.aViewData.CellsAtX(nNewDeltaX, 1, eAlignX);
      if (nNewDeltaX + nSizeX - 1 > rDoc.MaxCol()) nNewDeltaX = rDoc.MaxCol() - nSizeX + 1;
      if (nNewDeltaX < 0) nNewDeltaX = 0;

      if (nNewDeltaY !== nDeltaY) nSizeY = this.aViewData.CellsAtY(nNewDeltaY, 1, eAlignY);
      if (nNewDeltaY + nSizeY - 1 > rDoc.MaxRow()) nNewDeltaY = rDoc.MaxRow() - nSizeY + 1;
      if (nNewDeltaY < 0) nNewDeltaY = 0;

      if (nNewDeltaX !== nDeltaX) this.ScrollX(nNewDeltaX - nDeltaX, eAlignX);
      if (nNewDeltaY !== nDeltaY) this.ScrollY(nNewDeltaY - nDeltaY, eAlignY);
    }

    // switch active part again

    if (bHFix && eActiveX === SC_SPLIT_RIGHT && nCurX < this.aViewData.GetFixPosX()) {
      this.ActivatePart(eActiveY === SC_SPLIT_TOP ? SC_SPLIT_TOPLEFT : SC_SPLIT_BOTTOMLEFT);
      eActiveX = SC_SPLIT_LEFT;
    }
    if (bVFix && eActiveY === SC_SPLIT_BOTTOM && nCurY < this.aViewData.GetFixPosY()) {
      this.ActivatePart(eActiveX === SC_SPLIT_LEFT ? SC_SPLIT_TOPLEFT : SC_SPLIT_TOPRIGHT);
    }
  }

  ActivatePart(eWhich: ScSplitPos): void {
    this.aViewData.SetActivePart(eWhich);
  }

  ScrollX(nDeltaX: number, eWhich: ScHSplitPos): void {
    const rDoc = this.aViewData.GetDocument();
    const nOldX = this.aViewData.GetPosX(eWhich);
    let nNewX = nOldX + nDeltaX;
    if (nNewX < 0) {
      nDeltaX -= nNewX;
      nNewX = 0;
    }
    if (nNewX > rDoc.MaxCol()) {
      nDeltaX -= nNewX - rDoc.MaxCol();
      nNewX = rDoc.MaxCol();
    }

    const nDir = nDeltaX > 0 ? 1 : -1;
    const nTab = this.aViewData.CurrentTabForData();
    while (rDoc.ColHidden(nNewX, nTab) && nNewX + nDir >= 0 && nNewX + nDir <= rDoc.MaxCol()) nNewX = nNewX + nDir;

    // freeze

    if (this.aViewData.GetHSplitMode() === ScSplitMode.SC_SPLIT_FIX) {
      if (eWhich === SC_SPLIT_LEFT) nNewX = nOldX; // always keep the left part
      else {
        const nFixX = this.aViewData.GetFixPosX();
        if (nNewX < nFixX) nNewX = nFixX;
      }
    }
    if (nNewX === nOldX) return;

    this.aViewData.SetPosX(eWhich, nNewX);
    this.VisAreaChanged();
  }

  ScrollY(nDeltaY: number, eWhich: ScVSplitPos): void {
    const rDoc = this.aViewData.GetDocument();
    const nOldY = this.aViewData.GetPosY(eWhich);
    let nNewY = nOldY + nDeltaY;
    if (nNewY < 0) {
      nDeltaY -= nNewY;
      nNewY = 0;
    }
    if (nNewY > rDoc.MaxRow()) {
      nDeltaY -= nNewY - rDoc.MaxRow();
      nNewY = rDoc.MaxRow();
    }

    const nDir = nDeltaY > 0 ? 1 : -1;
    const nTab = this.aViewData.CurrentTabForData();
    while (rDoc.RowHidden(nNewY, nTab) && nNewY + nDir >= 0 && nNewY + nDir <= rDoc.MaxRow()) nNewY += nDir;

    // freeze

    if (this.aViewData.GetVSplitMode() === ScSplitMode.SC_SPLIT_FIX) {
      if (eWhich === SC_SPLIT_TOP) nNewY = nOldY; // always keep the upper part
      else {
        const nFixY = this.aViewData.GetFixPosY();
        if (nNewY < nFixY) nNewY = nFixY;
      }
    }
    if (nNewY === nOldY) return;

    this.aViewData.SetPosY(eWhich, nNewY);
    this.VisAreaChanged();
  }

  /** ScrollLines: scrolls the active part (the mouse wheel, the scroll bars). */
  ScrollLines(nDeltaX: number, nDeltaY: number): void {
    const eWhich = this.aViewData.GetActivePart();
    if (nDeltaX) this.ScrollX(nDeltaX, WhichH(eWhich));
    if (nDeltaY) this.ScrollY(nDeltaY, WhichV(eWhich));
  }

  MoveCursorAbs(nCurX: SCCOL, nCurY: SCROW, eMode: ScFollowMode, bShift: boolean, bControl: boolean, bKeepOld = false, bKeepSel = false): void {
    void bControl;
    if (!bKeepOld) this.aViewData.ResetOldCursor();

    const rDoc = this.aViewData.GetDocument();

    if (nCurX < 0) nCurX = 0;
    if (nCurY < 0) nCurY = 0;
    if (nCurX > rDoc.MaxCol()) nCurX = rDoc.MaxCol();
    if (nCurY > rDoc.MaxRow()) nCurY = rDoc.MaxRow();

    // switch of active now in AlignToCursor

    this.AlignToCursor(nCurX, nCurY, eMode);

    if (bKeepSel) {
      this.SetCursor(nCurX, nCurY); // keep selection

      // If the cursor is in existing selection, it's a cursor movement by
      // ENTER or TAB.  If not, then it's a new selection during ADD
      // selection mode.

      const rMark = this.aViewData.GetMarkData();
      const aSelList = new ScRangeList();
      rMark.FillRangeListWithMarks(aSelList, false);
      if (!aSelList.Contains(new ScRange(nCurX, nCurY, this.aViewData.CurrentTabForData()))) {
        // Cursor not in existing selection.  Start a new selection.
        this.DoneBlockMode(true);
      }
    } else {
      if (!bShift) {
        // Remove all marked data on cursor movement unless the Shift is
        // locked or while editing a formula. It is cheaper to check for
        // marks first and then formula mode.
        const rMark = this.aViewData.GetMarkData();
        const bMarked = rMark.IsMarked() || rMark.IsMultiMarked();
        if (bMarked && !this.fnIsFormulaMode()) {
          rMark.ResetMark();
          this.DoneBlockMode();
          this.InitOwnBlockMode(new ScRange(nCurX, nCurY, this.aViewData.CurrentTabForData()));
          this.MarkDataChanged();
        }
        this.meBlockMode = BlockMode.None;
      }

      const bSame = nCurX === this.aViewData.GetCurX() && nCurY === this.aViewData.GetCurY();
      this.bMoveIsShift = bShift;
      // pSelEngine->CursorPosChanging and aFunctionSet.SetCursorAtCell: with Shift, the block
      // follows the cursor from the anchor.
      if (bShift) {
        const nTab = this.aViewData.CurrentTabForData();
        if (!this.IsBlockMode()) this.InitBlockMode(this.aViewData.GetCurX(), this.aViewData.GetCurY(), nTab, true);
        this.MarkCursor(nCurX, nCurY, nTab, false, false, true);
      }
      this.bMoveIsShift = false;
      this.SetCursor(nCurX, nCurY);

      // If the cursor has not been moved, the SelectionChanged for canceling the
      // selection has to happen here individually:
      if (bSame) this.SelectionChanged();
    }
  }

  MoveCursorRel(nMovX: SCCOL, nMovY: SCROW, eMode: ScFollowMode, bShift: boolean, bKeepSel = false): void {
    let nOldX: SCCOL;
    let nOldY: SCROW;
    let nCurX: SCCOL;
    let nCurY: SCROW;
    if (this.aViewData.IsRefMode()) {
      nOldX = this.aViewData.GetRefEndX();
      nOldY = this.aViewData.GetRefEndY();
      nCurX = nOldX + nMovX;
      nCurY = nOldY + nMovY;
    } else {
      nOldX = this.aViewData.GetCurX();
      nOldY = this.aViewData.GetCurY();
      nCurX = nMovX !== 0 ? nOldX + nMovX : this.aViewData.GetOldCurX();
      nCurY = nMovY !== 0 ? nOldY + nMovY : this.aViewData.GetOldCurY();
    }

    if (nMovX < 0 && nOldX === 0) {
      // trying to go left from 1st column
      if (nMovY === 0) return; // done, because no vertical move is requested
    }
    if (nMovY < 0 && nOldY === 0) {
      // trying to go up from 1st row
      if (nMovX === 0) return; // done, because no horizontal move is requested
    }

    this.aViewData.ResetOldCursor();

    const rDoc = this.aViewData.GetDocument();
    if (nMovX !== 0 && rDoc.ValidColRow(nCurX, nCurY)) ({ rCurX: nCurX, rCurY: nCurY } = this.SkipCursorHorizontal(nCurX, nCurY, nOldX, nMovX));

    if (nMovY !== 0 && rDoc.ValidColRow(nCurX, nCurY)) ({ rCurX: nCurX, rCurY: nCurY } = this.SkipCursorVertical(nCurX, nCurY, nOldY, nMovY));

    this.MoveCursorAbs(nCurX, nCurY, eMode, bShift, false, true, bKeepSel);
  }

  MoveCursorPage(nMovX: SCCOL, nMovY: SCROW, eMode: ScFollowMode, bShift: boolean, bKeepSel = false): void {
    const { rPageX, rPageY } = this.GetPageMoveEndPosition(nMovX, nMovY);
    this.MoveCursorRel(rPageX, rPageY, eMode, bShift, bKeepSel);
  }

  MoveCursorArea(nMovX: SCCOL, nMovY: SCROW, eMode: ScFollowMode, bShift: boolean, bKeepSel = false): void {
    const { rAreaX, rAreaY } = this.GetAreaMoveEndPosition(nMovX, nMovY, eMode);
    this.MoveCursorRel(rAreaX, rAreaY, eMode, bShift, bKeepSel);
  }

  MoveCursorEnd(nMovX: SCCOL, nMovY: SCROW, eMode: ScFollowMode, bShift: boolean, bKeepSel = false): void {
    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();

    const { nCurX, nCurY } = this.aViewData.GetMoveCursor();
    let nNewX = nCurX;
    let nNewY = nCurY;

    let nUsedX = 0;
    let nUsedY = 0;
    if (nMovX > 0 || nMovY > 0) {
      const a = rDoc.GetPrintArea(nTab); // get end
      nUsedX = a.nEndCol;
      nUsedY = a.nEndRow;
    }

    if (nMovX < 0) nNewX = 0;
    else if (nMovX > 0) nNewX = nUsedX; // last used range

    if (nMovY < 0) nNewY = 0;
    else if (nMovY > 0) nNewY = nUsedY;

    this.aViewData.ResetOldCursor();
    this.MoveCursorRel(nNewX - nCurX, nNewY - nCurY, eMode, bShift, bKeepSel);
  }

  /** bShift -> up/down */
  MoveCursorEnter(bShift: boolean): boolean {
    const rOpt = this.maInputOptions();
    if (!rOpt.GetMoveSelection()) return false;

    let nMoveX = 0;
    let nMoveY = 0;
    switch (rOpt.GetMoveDir()) {
      case ScDirection.DIR_BOTTOM: nMoveY = bShift ? -1 : 1; break;
      case ScDirection.DIR_RIGHT: nMoveX = bShift ? -1 : 1; break;
      case ScDirection.DIR_TOP: nMoveY = bShift ? 1 : -1; break;
      case ScDirection.DIR_LEFT: nMoveX = bShift ? 1 : -1; break;
    }

    const { nCurX, nCurY } = this.aViewData.GetMoveCursor();
    const nTab = this.aViewData.CurrentTabForData();

    const rMark = this.aViewData.GetMarkData();
    const rDoc = this.aViewData.GetDocument();

    if (rMark.IsMarked() || rMark.IsMultiMarked()) {
      const r = rDoc.GetNextPos(nCurX, nCurY, nTab, nMoveX, nMoveY, true, false, rMark);
      this.MoveCursorRel(r.rCol - nCurX, r.rRow - nCurY, SC_FOLLOW_LINE, false, true);
    } else {
      // After Tab and Enter back to the starting column again.
      const nTabStartCol = nMoveY !== 0 && !nMoveX && this.aViewData.GetTabStartCol() >= 0 ? this.aViewData.GetTabStartCol() : 0x7fff;
      const r = rDoc.GetNextPos(nCurX, nCurY, nTab, nMoveX, nMoveY, false, true, rMark, nTabStartCol);
      this.MoveCursorRel(r.rCol - nCurX, r.rRow - nCurY, SC_FOLLOW_LINE, false);
    }
    return true;
  }

  /** ScCellShell's SID_CURSORENTERUP/DOWN with Tab (FindNextUnprot's bShift): Tab and Shift+Tab. */
  MoveCursorTab(bShift: boolean): void {
    const { nCurX, nCurY } = this.aViewData.GetMoveCursor();
    const nTab = this.aViewData.CurrentTabForData();
    const rMark = this.aViewData.GetMarkData();
    const rDoc = this.aViewData.GetDocument();
    const nMoveX = bShift ? -1 : 1;
    if (rMark.IsMarked() || rMark.IsMultiMarked()) {
      const r = rDoc.GetNextPos(nCurX, nCurY, nTab, nMoveX, 0, true, false, rMark);
      this.MoveCursorRel(r.rCol - nCurX, r.rRow - nCurY, SC_FOLLOW_LINE, false, true);
    } else {
      // Remember where Tab started, for Enter back to that column.
      if (this.aViewData.GetTabStartCol() < 0) this.aViewData.SetTabStartCol(nCurX);
      const r = rDoc.GetNextPos(nCurX, nCurY, nTab, nMoveX, 0, false, true, rMark);
      this.MoveCursorRel(r.rCol - nCurX, r.rRow - nCurY, SC_FOLLOW_LINE, false);
    }
  }

  MarkColumns(nCol: SCCOL, nModifier = 0): void {
    const rDoc = this.aViewData.GetDocument();
    const nStartCol = nCol;
    const nTab = this.aViewData.CurrentTabForData();

    if ((nModifier & KEY_SHIFT) === KEY_SHIFT) this.bMoveIsShift = true;

    if (this.fnIsFormulaMode()) {
      this.DoneRefMode(nModifier !== 0);
      this.InitRefMode(nCol, 0, nTab, ScRefType.SC_REFTYPE_REF);
      this.UpdateRef(nCol, rDoc.MaxRow(), nTab);
      this.bMoveIsShift = false;
    } else {
      this.DoneBlockMode(nModifier !== 0);
      this.InitBlockMode(nStartCol, 0, nTab, true, true);
      this.MarkCursor(nCol, rDoc.MaxRow(), nTab);
      this.bMoveIsShift = false;
      this.SetCursor(nCol, 0);
      this.SelectionChanged();
    }
  }

  MarkRows(nRow: SCROW, nModifier = 0): void {
    const rDoc = this.aViewData.GetDocument();
    const nStartRow = nRow;
    const nTab = this.aViewData.CurrentTabForData();

    if ((nModifier & KEY_SHIFT) === KEY_SHIFT) this.bMoveIsShift = true;

    if (this.fnIsFormulaMode()) {
      this.DoneRefMode(nModifier !== 0);
      this.InitRefMode(0, nRow, nTab, ScRefType.SC_REFTYPE_REF);
      this.UpdateRef(rDoc.MaxCol(), nRow, nTab);
      this.bMoveIsShift = false;
    } else {
      this.DoneBlockMode(nModifier !== 0);
      this.InitBlockMode(0, nStartRow, nTab, true, false, true);
      this.MarkCursor(rDoc.MaxCol(), nRow, nTab);
      this.bMoveIsShift = false;
      this.SetCursor(0, nRow);
      this.SelectionChanged();
    }
  }

  /** MarkColumns() and MarkRows() without arguments: the selection's columns or rows (Ctrl+Space, Shift+Space). */
  MarkSelectionColumns(bColumns: boolean): void {
    const rMark = this.aViewData.GetMarkData();
    const rDoc = this.aViewData.GetDocument();
    let nStart: number, nEnd: number;
    if (rMark.IsMarked()) {
      const aMarkRange = rMark.GetMarkArea();
      nStart = bColumns ? aMarkRange.aStart.Col() : aMarkRange.aStart.Row();
      nEnd = bColumns ? aMarkRange.aEnd.Col() : aMarkRange.aEnd.Row();
    } else {
      const { nCurX, nCurY } = this.aViewData.GetMoveCursor();
      nStart = nEnd = bColumns ? nCurX : nCurY;
    }
    const nTab = this.aViewData.CurrentTabForData();
    this.DoneBlockMode();
    if (bColumns) {
      this.InitBlockMode(nStart, 0, nTab);
      this.MarkCursor(nEnd, rDoc.MaxRow(), nTab);
    } else {
      this.InitBlockMode(0, nStart, nTab);
      this.MarkCursor(rDoc.MaxCol(), nEnd, nTab);
    }
    this.SelectionChanged();
  }

  MarkDataArea(bIncludeCursor = true): void {
    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();
    const nStartCol = this.aViewData.GetCurX();
    const nStartRow = this.aViewData.GetCurY();
    const r = rDoc.GetDataArea(nTab, nStartCol, nStartRow, nStartCol, nStartRow, bIncludeCursor, false);

    this.DoneBlockMode();
    this.InitBlockMode(r.nStartCol, r.nStartRow, nTab);
    this.MarkCursor(r.nEndCol, r.nEndRow, nTab);
    this.SelectionChanged();
  }

  MarkRange(rRange: ScRange, bSetCursor = true, bContinue = false): void {
    const rDoc = this.aViewData.GetDocument();
    const nTab = rRange.aStart.Tab();
    this.SetTabNo(nTab);

    this.DoneBlockMode(bContinue); // bContinue==true -> clear old mark
    if (bSetCursor) {
      // if Cursor is set, also always align
      let nAlignX = rRange.aStart.Col();
      let nAlignY = rRange.aStart.Row();
      const bCol = rRange.aStart.Col() === 0 && rRange.aEnd.Col() === rDoc.MaxCol();
      const bRow = rRange.aStart.Row() === 0 && rRange.aEnd.Row() === rDoc.MaxRow();
      if (bCol) nAlignX = this.aViewData.GetPosX(WhichH(this.aViewData.GetActivePart()));
      if (bRow) nAlignY = this.aViewData.GetPosY(WhichV(this.aViewData.GetActivePart()));
      this.AlignToCursor(nAlignX, nAlignY, SC_FOLLOW_JUMP);
    }
    this.InitBlockMode(rRange.aStart.Col(), rRange.aStart.Row(), nTab);
    this.MarkCursor(rRange.aEnd.Col(), rRange.aEnd.Row(), nTab);
    if (bSetCursor) {
      const r = rDoc.SkipOverlapped(rRange.aStart.Col(), rRange.aStart.Row(), nTab);
      this.aViewData.ResetOldCursor();
      this.SetCursor(r.rCol, r.rRow);
    }
    this.SelectionChanged();
  }

  Unmark(): void {
    const rMark = this.aViewData.GetMarkData();
    if (rMark.IsMarked() || rMark.IsMultiMarked()) {
      const { nCurX, nCurY } = this.aViewData.GetMoveCursor();
      this.MoveCursorAbs(nCurX, nCurY, SC_FOLLOW_NONE, false, false);
      this.SelectionChanged();
    }
  }

  SetMarkData(rNew: import('../../../inc/markdata.ts').ScMarkData): void {
    this.DoneBlockMode();
    this.InitOwnBlockMode(rNew.GetMarkArea());
    this.aViewData.SetMarkData(rNew.clone());
    this.MarkDataChanged();
  }

  /** has to be called after making direct changes to mark data (not via MarkCursor etc) */
  MarkDataChanged(): void { this.SelectionChanged(); }

  SelectNextTab(nDir: number, bExtendSelection = false): void {
    if (!nDir) return;

    const rDoc = this.aViewData.GetDocument();
    const nTab = this.aViewData.CurrentTabForData();
    let nNextTab = nTab;
    const nCount = rDoc.GetTableCount();
    if (nDir < 0) {
      do {
        --nNextTab;
        if (nNextTab < 0) return; // Input::WrapNextPrevSheetTab is off by default
        if (rDoc.IsVisible(nNextTab)) break;
      } while (nNextTab !== nTab);
    } else {
      do {
        ++nNextTab;
        if (nNextTab >= nCount) return;
        if (rDoc.IsVisible(nNextTab)) break;
      } while (nNextTab !== nTab);
    }
    if (nNextTab === nTab) return;

    this.SetTabNo(nNextTab, false, bExtendSelection);
  }

  /** SetTabNo - set the displayed sheet */
  SetTabNo(nTab: SCTAB, bNew = false, bExtendSelection = false): void {
    const rDoc = this.aViewData.GetDocument();
    if (nTab < 0 || nTab >= rDoc.GetTableCount()) return;
    if (nTab === this.aViewData.GetTabNo() && !bNew) return;

    if (!rDoc.IsVisible(nTab)) {
      // a hidden sheet: the next visible one
      let nNext = nTab;
      while (nNext < rDoc.GetTableCount() && !rDoc.IsVisible(nNext)) ++nNext;
      if (nNext >= rDoc.GetTableCount()) { nNext = nTab; while (nNext >= 0 && !rDoc.IsVisible(nNext)) --nNext; }
      if (nNext < 0) return;
      nTab = nNext;
    }

    this.DoneBlockMode();
    this.aViewData.SetTabNo(nTab);
    const rMark = this.aViewData.GetMarkData();
    if (bExtendSelection) rMark.SelectTable(nTab, true);
    else {
      rMark.ResetMark();
      rMark.SelectOneTable(nTab);
    }
    this.fire('TabChanged');
    this.VisAreaChanged();
    this.CursorPosChanged();
    this.SelectionChanged();
  }

  // --- tabview.cxx ---

  FreezeSplitters(bFreeze: boolean, eSplitMethod: SplitMethod = SplitMethod.SC_SPLIT_METHOD_CURSOR, nFreezeIndex = -1): void {
    if ((eSplitMethod === SplitMethod.SC_SPLIT_METHOD_COL || eSplitMethod === SplitMethod.SC_SPLIT_METHOD_ROW) && nFreezeIndex < 0) nFreezeIndex = 0;

    const eOldH = this.aViewData.GetHSplitMode();
    const eOldV = this.aViewData.GetVSplitMode();

    let ePos: ScSplitPos = SC_SPLIT_BOTTOMLEFT;
    if (eOldV !== ScSplitMode.SC_SPLIT_NONE) ePos = SC_SPLIT_TOPLEFT;

    if (bFreeze) {
      this.aViewData.GetDocShell().SetDocumentModified();

      let nPosX: SCCOL = 1;
      let nPosY: SCROW = 1;
      switch (eSplitMethod) {
        case SplitMethod.SC_SPLIT_METHOD_ROW:
          nPosX = 0;
          nPosY = nFreezeIndex;
          break;
        case SplitMethod.SC_SPLIT_METHOD_COL:
          nPosX = nFreezeIndex;
          nPosY = 0;
          break;
        case SplitMethod.SC_SPLIT_METHOD_CURSOR:
          nPosX = this.aViewData.GetCurX();
          nPosY = this.aViewData.GetCurY();
          break;
      }

      const nTopPos = this.aViewData.GetPosY(SC_SPLIT_BOTTOM);
      const nBottomPos = nPosY;
      const nLeftPos = this.aViewData.GetPosX(SC_SPLIT_LEFT);
      let nRightPos = nPosX;

      if (eSplitMethod === SplitMethod.SC_SPLIT_METHOD_ROW || eSplitMethod === SplitMethod.SC_SPLIT_METHOD_CURSOR) {
        const aSplit = this.aViewData.GetScrPos(nPosX, nPosY, ePos, true);
        if (aSplit.Y > 0) {
          this.aViewData.SetVSplitMode(ScSplitMode.SC_SPLIT_FIX);
          this.aViewData.SetVSplitPos(aSplit.Y);
          this.aViewData.SetFixPosY(nPosY);
          this.aViewData.SetPosY(SC_SPLIT_TOP, nTopPos);
          this.aViewData.SetPosY(SC_SPLIT_BOTTOM, nBottomPos);
        } else this.aViewData.SetVSplitMode(ScSplitMode.SC_SPLIT_NONE);
      }

      if (eSplitMethod === SplitMethod.SC_SPLIT_METHOD_COL || eSplitMethod === SplitMethod.SC_SPLIT_METHOD_CURSOR) {
        if (eOldH !== ScSplitMode.SC_SPLIT_NONE && this.aViewData.GetPosX(SC_SPLIT_RIGHT) > nRightPos) nRightPos = this.aViewData.GetPosX(SC_SPLIT_RIGHT);
        const aSplit = this.aViewData.GetScrPos(nPosX, nPosY, ePos, true);
        if (nPosX > this.aViewData.GetPosX(SC_SPLIT_LEFT)) {
          this.aViewData.SetHSplitMode(ScSplitMode.SC_SPLIT_FIX);
          this.aViewData.SetHSplitPos(aSplit.X);
          this.aViewData.SetFixPosX(nPosX);
          this.aViewData.SetPosX(SC_SPLIT_LEFT, nLeftPos);
          this.aViewData.SetPosX(SC_SPLIT_RIGHT, nRightPos);
        } else this.aViewData.SetHSplitMode(ScSplitMode.SC_SPLIT_NONE);
      }
    } else {
      // unfreeze: the web shell has no movable split (SC_SPLIT_NORMAL), so unfreezing removes it
      this.RemoveSplit();
      return;
    }

    this.aViewData.SetActivePart(this.aViewData.GetTabData(this.aViewData.GetTabNo()).SanitizeWhichActive());
    //  SC_FOLLOW_NONE: only update active part
    this.AlignToCursor(this.aViewData.GetCurX(), this.aViewData.GetCurY(), SC_FOLLOW_NONE);
    this.VisAreaChanged();
  }

  RemoveSplit(): void {
    const v = this.aViewData;
    if (v.GetHSplitMode() === ScSplitMode.SC_SPLIT_FIX || v.GetVSplitMode() === ScSplitMode.SC_SPLIT_FIX) v.GetDocShell().SetDocumentModified();
    // DoHSplit(0) and DoVSplit(0): the left/top position is kept for the whole window.
    if (v.GetHSplitMode() !== ScSplitMode.SC_SPLIT_NONE) {
      const nLeft = v.GetPosX(SC_SPLIT_LEFT);
      v.SetHSplitMode(ScSplitMode.SC_SPLIT_NONE);
      v.SetPosX(SC_SPLIT_RIGHT, nLeft);
      v.SetPosX(SC_SPLIT_LEFT, nLeft);
    }
    if (v.GetVSplitMode() !== ScSplitMode.SC_SPLIT_NONE) {
      const nTop = v.GetPosY(SC_SPLIT_TOP);
      v.SetVSplitMode(ScSplitMode.SC_SPLIT_NONE);
      v.SetPosY(SC_SPLIT_BOTTOM, nTop);
      v.SetPosY(SC_SPLIT_TOP, nTop);
    }
    v.SetActivePart(SC_SPLIT_BOTTOMLEFT);
    this.VisAreaChanged();
  }

  /** Whether panes are frozen (FN_FREEZE's state). */
  HasFrozenPanes(): boolean {
    return this.aViewData.GetHSplitMode() === ScSplitMode.SC_SPLIT_FIX || this.aViewData.GetVSplitMode() === ScSplitMode.SC_SPLIT_FIX;
  }

  /** ZoomChanged: the pixel positions follow the new scale. */
  ZoomChanged(): void {
    const v = this.aViewData;
    // the split positions are pixels: recompute them from the fixed cells
    if (v.GetHSplitMode() === ScSplitMode.SC_SPLIT_FIX) v.SetHSplitPos(v.GetScrPos(v.GetFixPosX(), 0, SC_SPLIT_TOPLEFT, true).X);
    if (v.GetVSplitMode() === ScSplitMode.SC_SPLIT_FIX) v.SetVSplitPos(v.GetScrPos(0, v.GetFixPosY(), SC_SPLIT_TOPLEFT, true).Y);
    this.AlignToCursor(v.GetCurX(), v.GetCurY(), SC_FOLLOW_LINE);
    this.VisAreaChanged();
  }

  /** The panes that are shown (one, two or four). */
  GetVisibleParts(): ScSplitPos[] {
    const v = this.aViewData;
    const bH = v.GetHSplitMode() !== ScSplitMode.SC_SPLIT_NONE, bV = v.GetVSplitMode() !== ScSplitMode.SC_SPLIT_NONE;
    const out: ScSplitPos[] = [SC_SPLIT_BOTTOMLEFT];
    if (bH) out.push(SC_SPLIT_BOTTOMRIGHT);
    if (bV) out.push(SC_SPLIT_TOPLEFT);
    if (bH && bV) out.push(SC_SPLIT_TOPRIGHT);
    return out;
  }
}

export { SC_FOLLOW_FIX, SC_FOLLOW_JUMP, SC_FOLLOW_JUMP_END, SC_FOLLOW_LINE, SC_FOLLOW_NONE };
