// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/dbfunc.hxx reduced
// @upstream sc/source/ui/view/dbfunc.cxx partial
// ScDBFunc: the view's database functions: the database range of the selection (GetDBData),
// sorting (Sort), filtering (Query), the AutoFilter buttons (ToggleAutoFilter, HideAutoFilter,
// ClearAutoFilter), through ScDBDocFunc with undo. The question whether the first row is a header
// and the "no data" message are handed to the caller (fnQueryHeader, ErrorMessage) instead of
// message boxes. Subtotals, outlines, pivot tables and database import are left out.
import { ScRange, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { ScGetDBMode, ScGetDBSelection } from '../../../inc/global.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { SearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import { ScDBDataPortion, type ScDBData } from '../../core/tool/dbdata.ts';
import { ScUndoAutoFilter } from '../undo/undodat.ts';
import { PaintPartFlags, ScDocShellModificator } from '../docshell/docsh.ts';
import type { ScInputOptions } from '../../../inc/inputopt.ts';
import { ScSortParam } from '../../../inc/sortparam.ts';
import { ScDBDocFunc } from '../docshell/dbdocfun.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScViewFunc } from './viewfunc.ts';
import { ScMarkType, type ScViewData } from './viewdata.ts';

const STR_UNDO_QUERY = 'Filter';
const STR_ERR_AUTOFILTER = 'The range does not contain column headers.\nDo you want the first line to be used as column header?';
const STR_ERR_AUTOFILTER_NODATA = 'Range does not contain data.';

/** Asks whether the first row of the range is a header (STR_MSSG_MAKEAUTOFILTER_0); calls back with the answer. */
export type ScQueryHeaderFn = (fnDone: (bYes: boolean) => void) => void;
export { STR_ERR_AUTOFILTER };

export class ScDBFunc extends ScViewFunc {
  constructor(rDocSh: ScDocShell, fnInputOptions: () => ScInputOptions) {
    super(rDocSh, fnInputOptions);
  }

  /**
   * GetDBData's area for sorting: the selection, or, with only a cell selected, the contiguous
   * data area around the cursor (ScDocument::GetDataArea).
   */
  GetSortArea(): ScRange {
    const v = this.aViewData;
    const { eMarkType, rRange } = v.GetSimpleArea();
    const bOnlyCursor = eMarkType === ScMarkType.SC_MARK_SIMPLE && !v.GetMarkData().IsMarked();
    if (!bOnlyCursor) return rRange;
    const nTab = v.GetTabNo();
    const r = v.GetDocument().GetDataArea(nTab, v.GetCurX(), v.GetCurY(), v.GetCurX(), v.GetCurY(), false, false);
    return new ScRange(r.nStartCol, r.nStartRow, nTab, r.nEndCol, r.nEndRow, nTab);
  }

  /** Sort the area by the param (with undo). */
  Sort(rSortParam: ScSortParam, bRecord = true): boolean {
    const nTab = this.aViewData.GetTabNo();
    const bSuccess = new ScDBDocFunc(this.aViewData.GetDocShell()).Sort(nTab, rSortParam, bRecord, true, false);
    if (bSuccess) {
      this.MarkRange(new ScRange(rSortParam.nCol1, rSortParam.nRow1, nTab, rSortParam.nCol2, rSortParam.nRow2, nTab), false);
      this.CellContentChanged();
    }
    return bSuccess;
  }

  /** The database range of the selection or the cursor (GetDBData): with bMark the range gets
      selected. */
  GetDBData(bMark = true, eMode: ScGetDBMode = ScGetDBMode.SC_DB_MAKE, eSel: ScGetDBSelection = ScGetDBSelection.Keep): ScDBData | null {
    const pDocSh = this.GetViewData().GetDocShell();
    let pData: ScDBData | null = null;
    const { eMarkType, rRange } = this.GetViewData().GetSimpleArea();
    const aRange = rRange.clone();
    if (eMarkType === ScMarkType.SC_MARK_SIMPLE || eMarkType === ScMarkType.SC_MARK_SIMPLE_FILTERED) {
      let bShrinkColumnsOnly = false;
      if (eSel === ScGetDBSelection.RowDown) {
        // Don't alter row range, additional rows may have been selected on
        // purpose to append data, or to have a fake header row.
        bShrinkColumnsOnly = true;
        // Select further rows only if only one row or a portion thereof is
        // selected.
        if (aRange.aStart.Row() !== aRange.aEnd.Row()) {
          // If an area is selected shrink that to the actual used
          // columns, don't draw filter buttons for empty columns.
          eSel = ScGetDBSelection.ShrinkToUsedData;
        } else if (aRange.aStart.Col() === aRange.aEnd.Col()) {
          // One cell only, if it is not marked obtain entire used data
          // area.
          const rMarkData = this.GetViewData().GetMarkData();
          if (!(rMarkData.IsMarked() || rMarkData.IsMultiMarked())) eSel = ScGetDBSelection.Keep;
        }
      }
      switch (eSel) {
        case ScGetDBSelection.ShrinkToUsedData:
        case ScGetDBSelection.RowDown: {
          // Shrink the selection to actual used area.
          const rDoc = pDocSh.GetDocument();
          const r = rDoc.ShrinkToUsedDataArea(aRange.aStart.Tab(), aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row(), bShrinkColumnsOnly);
          if (r.bShrunk) {
            aRange.aStart.SetCol(r.nStartCol);
            aRange.aEnd.SetCol(r.nEndCol);
            aRange.aStart.SetRow(r.nStartRow);
            aRange.aEnd.SetRow(r.nEndRow);
          }
          break;
        }
        default:
        // nothing
      }
      pData = pDocSh.GetDBData(aRange, eMode, eSel);
    } else if (eMode !== ScGetDBMode.SC_DB_OLD) {
      const v = this.GetViewData();
      pData = pDocSh.GetDBData(new ScRange(v.GetCurX(), v.GetCurY(), v.GetTabNo()), eMode, ScGetDBSelection.Keep);
    }

    if (!pData) return null;

    if (bMark) {
      const aFound = pData.GetArea();
      this.MarkRange(aFound, false);
    }
    return pData;
  }

  /** The global anonymous database range of the selection (GetAnonymousDBData). */
  GetAnonymousDBData(): ScDBData | null {
    const pDocSh = this.GetViewData().GetDocShell();
    const { eMarkType, rRange } = this.GetViewData().GetSimpleArea();
    const aRange = rRange.clone();
    if (eMarkType !== ScMarkType.SC_MARK_SIMPLE && eMarkType !== ScMarkType.SC_MARK_SIMPLE_FILTERED) return null;

    // Expand to used data area if not explicitly marked.
    const rMarkData = this.GetViewData().GetMarkData();
    if (!rMarkData.IsMarked() && !rMarkData.IsMultiMarked()) {
      const r = pDocSh.GetDocument().GetDataArea(aRange.aStart.Tab(), aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row(), false, false);
      aRange.aStart.SetCol(r.nStartCol);
      aRange.aStart.SetRow(r.nStartRow);
      aRange.aEnd.SetCol(r.nEndCol);
      aRange.aEnd.SetRow(r.nEndRow);
    }

    return pDocSh.GetAnonymousDBData(aRange);
  }

  //  filters

  Query(rQueryParam: ScQueryParam, pAdvSource: ScRange | null = null, bRecord = true): void {
    const pDocSh = this.GetViewData().GetDocShell();
    const nTab = this.GetViewData().GetTabNo();
    const aDBDocFunc = new ScDBDocFunc(pDocSh);
    const bSuccess = aDBDocFunc.Query(nTab, rQueryParam, pAdvSource, bRecord, false);

    if (!bSuccess) return;

    const bCopy = !rQueryParam.bInplace;
    if (bCopy) {
      //  mark target range (data base range has been set up if applicable)
      const rDoc = pDocSh.GetDocument();
      const pDestData = rDoc.GetDBAtCursor(rQueryParam.nDestCol, rQueryParam.nDestRow, rQueryParam.nDestTab, ScDBDataPortion.TOP_LEFT);
      if (pDestData) {
        const aDestRange = pDestData.GetArea();
        this.MarkRange(aDestRange);
      }
    }

    if (!bCopy) {
      this.VisAreaChanged();
      this.SelectionChanged(); // for attribute states (filtered rows are ignored)
    }
  }

  //  autofilter-buttons show / hide

  ToggleAutoFilter(fnQueryHeader?: ScQueryHeaderFn): void {
    const rViewData = this.GetViewData();
    const pDocSh = rViewData.GetDocShell();

    const rDoc = rViewData.GetDocument();
    const pDBData = this.GetDBData(false, ScGetDBMode.SC_DB_AUTOFILTER, ScGetDBSelection.RowDown);

    if (!pDBData) return;

    pDBData.SetByRow(true); //! undo, retrieve beforehand ??
    const aParam = pDBData.GetQueryParam();

    const nRow = aParam.nRow1;
    const nTab = rViewData.GetTabNo();
    let bHasAuto = true;
    const bHeader = pDBData.HasHeader();

    //!     instead retrieve from DB-range?

    for (let nCol = aParam.nCol1; nCol <= aParam.nCol2 && bHasAuto; nCol++) {
      const nFlag = rDoc.GetAttr(nCol, nRow, nTab, 'ATTR_MERGE_FLAG');
      if (!(nFlag & ScMF.Auto)) bHasAuto = false;
    }

    if (bHasAuto) {
      // remove
      //  hide filter buttons

      for (let nCol = aParam.nCol1; nCol <= aParam.nCol2; nCol++) {
        const nFlag = rDoc.GetAttr(nCol, nRow, nTab, 'ATTR_MERGE_FLAG');
        rDoc.ApplyAttr(nCol, nRow, nTab, { ATTR_MERGE_FLAG: nFlag & ~ScMF.Auto });
        aParam.RemoveAllEntriesByField(nCol);
      }

      // use a list action for the AutoFilter buttons (ScUndoAutoFilter) and the filter operation

      const aUndo = STR_UNDO_QUERY;
      pDocSh.GetUndoManager().EnterListAction(aUndo, aUndo, 0);

      const aRange = pDBData.GetArea();
      pDocSh.GetUndoManager().AddUndoAction(new ScUndoAutoFilter(pDocSh, aRange, pDBData.GetName(), false));

      pDBData.SetAutoFilter(false);

      aParam.bDuplicate = true;
      this.Query(aParam, null, true);

      pDocSh.GetUndoManager().LeaveListAction();

      ScDBFunc.ModifiedAutoFilter(pDocSh);
    } else {
      // show filter buttons
      if (!rDoc.IsBlockEmpty(aParam.nCol1, aParam.nRow1, aParam.nCol2, aParam.nRow2, nTab)) {
        if (!bHeader) {
          const fnApply = (nResult: boolean) => {
            if (nResult) pDBData.SetHeader(true); //! Undo ??
            ScDBFunc.ApplyAutoFilter(pDocSh, rViewData, pDBData, nRow, nTab, aParam);
            this.VisAreaChanged();
          };
          // header from first row?
          if (fnQueryHeader) fnQueryHeader(fnApply);
          else fnApply(true);
        } else ScDBFunc.ApplyAutoFilter(pDocSh, rViewData, pDBData, nRow, nTab, aParam);
      } else pDocSh.ErrorMessage(STR_ERR_AUTOFILTER_NODATA);
    }
    this.VisAreaChanged();
  }

  static ApplyAutoFilter(rDocSh: ScDocShell, rViewData: ScViewData, pDBData: ScDBData, nRow: SCROW, nTab: SCTAB, aParam: ScQueryParam): void {
    const rDoc = rViewData.GetDocument();
    const aRange = pDBData.GetArea();
    rDocSh.GetUndoManager().AddUndoAction(new ScUndoAutoFilter(rDocSh, aRange, pDBData.GetName(), true));

    pDBData.SetAutoFilter(true);

    for (let nCol = aParam.nCol1; nCol <= aParam.nCol2; nCol++) {
      const nFlag = rDoc.GetAttr(nCol, nRow, nTab, 'ATTR_MERGE_FLAG');
      rDoc.ApplyAttr(nCol, nRow, nTab, { ATTR_MERGE_FLAG: nFlag | ScMF.Auto });
    }
    rDocSh.PostPaint(new ScRange(aParam.nCol1, nRow, nTab, aParam.nCol2, nRow, nTab), PaintPartFlags.Grid);

    ScDBFunc.ModifiedAutoFilter(rDocSh);
  }

  static ModifiedAutoFilter(rDocSh: ScDocShell): void {
    const aModificator = new ScDocShellModificator(rDocSh);
    aModificator.SetDocumentModified();
  }

  //      just hide, no data change

  HideAutoFilter(): void {
    const pDocSh = this.GetViewData().GetDocShell();
    const aModificator = new ScDocShellModificator(pDocSh);

    const rDoc = pDocSh.GetDocument();

    const pDBData = this.GetDBData(false);
    if (!pDBData) return;

    const { nTab, nCol1, nRow1, nCol2 } = pDBData.GetAreaVars();

    for (let nCol = nCol1; nCol <= nCol2; nCol++) {
      const nFlag = rDoc.GetAttr(nCol, nRow1, nTab, 'ATTR_MERGE_FLAG');
      rDoc.ApplyAttr(nCol, nRow1, nTab, { ATTR_MERGE_FLAG: nFlag & ~ScMF.Auto });
    }

    const aRange = pDBData.GetArea();
    pDocSh.GetUndoManager().AddUndoAction(new ScUndoAutoFilter(pDocSh, aRange, pDBData.GetName(), false));

    pDBData.SetAutoFilter(false);

    pDocSh.PostPaint(new ScRange(nCol1, nRow1, nTab, nCol2, nRow1, nTab), PaintPartFlags.Grid);
    aModificator.SetDocumentModified();
  }

  /** Remove the filter of the cursor's column (ClearAutoFilter). */
  ClearAutoFilter(): void {
    const pDocSh = this.GetViewData().GetDocShell();
    const rDoc = pDocSh.GetDocument();

    const nCol = this.GetViewData().GetCurX();
    const nRow = this.GetViewData().GetCurY();
    const nTab = this.GetViewData().GetTabNo();

    const pDBData = rDoc.GetDBAtCursor(nCol, nRow, nTab, ScDBDataPortion.AREA);
    if (!pDBData) return;

    const aParam = pDBData.GetQueryParam();

    aParam.RemoveAllEntriesByField(nCol);
    aParam.eSearchType = SearchType.Normal;
    aParam.bCaseSens = false;
    aParam.bDuplicate = true;
    aParam.bInplace = true;

    this.Query(aParam, null, true);
  }
}
