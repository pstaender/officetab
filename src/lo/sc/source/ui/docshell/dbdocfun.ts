// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/dbdocfun.hxx partial
// @upstream sc/source/ui/docshell/dbdocfun.cxx partial
// ScDBDocFunc, reduced to Sort (Data - Sort) with undo. The model has no database ranges, so
// the sort parameters are not remembered at an (anonymous) database range and a repeated filter
// is not re-applied; sorting to another position (bInplace false) moves the block first as
// upstream does, with ScDocument::MoveBlock instead of ScDocFunc::MoveBlock (whose undo is not
// ported, so that move has no undo). The "update references when sorting" option is false
// (the default), cell formats move with their cells.
import { HasAttrFlags } from '../../../inc/global.ts';
import { ScRange, type SCTAB } from '../../../inc/address.ts';
import { ReorderParam, ScSortParam } from '../../../inc/sortparam.ts';
import { UndoSort } from '../undo/undosort.ts';
import { PaintPartFlags, ScDocShellModificator, type ScDocShell } from './docsh.ts';

const STR_PROTECTIONERR = 'Protected cells can not be modified.';
const STR_SORT_ERR_MERGED = 'The range contains merged cells and cannot be sorted.';

export class ScDBDocFunc {
  private rDocShell: ScDocShell;

  constructor(rDocSh: ScDocShell) {
    this.rDocShell = rDocSh;
  }

  Sort(nTab: SCTAB, rSortParam: ScSortParam, bRecord = true, bPaint = true, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();
    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    let bCopy = !rSortParam.bInplace;
    if (bCopy && rSortParam.nDestCol === rSortParam.nCol1 && rSortParam.nDestRow === rSortParam.nRow1 && rSortParam.nDestTab === nTab) bCopy = false;

    const aLocalParam = new ScSortParam(rSortParam);
    if (bCopy) {
      // Copy the data range to the destination then move the sort range to it.
      const aSrcRange = new ScRange(rSortParam.nCol1, rSortParam.nRow1, nTab, rSortParam.nCol2, rSortParam.nRow2, nTab);
      rDoc.MoveBlock(aSrcRange, rSortParam.nDestCol - rSortParam.nCol1, rSortParam.nDestRow - rSortParam.nRow1, rSortParam.nDestTab - nTab);

      aLocalParam.MoveToDest();
      nTab = aLocalParam.nDestTab;
    }

    // tdf#119804: If there is a header row/column, it won't be affected by
    // sorting; so we can exclude it from the test.
    if (rDoc.IsTabProtected(nTab)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    const bUpdateRefs = false; // ScInputOptions::GetSortRefUpdate, default off

    // Adjust aLocalParam cols/rows to used data area. Keep sticky top row or
    // column (depending on direction) in any case, not just if it has headers,
    // so empty leading cells will be sorted to the end.
    // aLocalParam.nCol/Row will encompass data content only, extras in
    // aLocalParam.aDataAreaExtras.
    aLocalParam.aDataAreaExtras.resetArea();
    const aShrunk = rDoc.ShrinkToUsedDataArea(nTab, aLocalParam.nCol1, aLocalParam.nRow1, aLocalParam.nCol2, aLocalParam.nRow2, false, aLocalParam.bByRow, !aLocalParam.bByRow);
    aLocalParam.nCol1 = aShrunk.nStartCol;
    aLocalParam.nRow1 = aShrunk.nStartRow;
    aLocalParam.nCol2 = aShrunk.nEndCol;
    aLocalParam.nRow2 = aShrunk.nEndRow;

    let nStartRow = aLocalParam.nRow1;
    if (aLocalParam.bByRow && aLocalParam.bHasHeader && nStartRow < aLocalParam.nRow2) ++nStartRow;

    const nOverallCol1 = aLocalParam.nCol1;
    const nOverallRow1 = aLocalParam.nRow1;
    const nOverallCol2 = aLocalParam.nCol2;
    const nOverallRow2 = aLocalParam.nRow2;

    if (aLocalParam.aDataAreaExtras.mbCellFormats && rDoc.HasAttrib(nOverallCol1, nStartRow, nTab, nOverallCol2, nOverallRow2, nTab, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
      // Merge attributes would be mixed up during sorting.
      if (!bApi) this.rDocShell.ErrorMessage(STR_SORT_ERR_MERGED);
      return false;
    }

    //      execute

    let bRepeatQuery = false; // repeat existing filter?

    const aUndoParam = new ReorderParam();

    // don't call ScDocument::Sort with an empty SortParam (may be empty here if bCopy is set)
    if (aLocalParam.GetSortKeyCount() && aLocalParam.maKeyState[0]!.bDoSort) {
      for (let nRow = aLocalParam.nRow1; nRow <= aLocalParam.nRow2 && !bRepeatQuery; nRow++) if (rDoc.RowHidden(nRow, nTab)) bRepeatQuery = true;
      rDoc.Sort(nTab, aLocalParam, bRepeatQuery, bUpdateRefs, aUndoParam);
    }

    if (bRecord) {
      // Set up an undo object.
      this.rDocShell.GetUndoManager().AddUndoAction(new UndoSort(this.rDocShell, aUndoParam));
    }

    if (nStartRow <= aLocalParam.nRow2) {
      const aDirtyRange = new ScRange(aLocalParam.nCol1, nStartRow, nTab, aLocalParam.nCol2, aLocalParam.nRow2, nTab);
      rDoc.SetDirty(aDirtyRange, true);
    }

    if (bPaint) {
      let nPaint: number = PaintPartFlags.Grid;
      let nStartX = nOverallCol1;
      const nStartY = nOverallRow1;
      let nEndX = nOverallCol2;
      const nEndY = nOverallRow2;
      if (bRepeatQuery) {
        nPaint |= PaintPartFlags.Left;
        nStartX = 0;
        nEndX = rDoc.MaxCol();
      }
      this.rDocShell.PostPaint(new ScRange(nStartX, nStartY, nTab, nEndX, nEndY, nTab), nPaint);
    }

    if (nStartRow <= nOverallRow2) this.rDocShell.AdjustRowHeight(nStartRow, nOverallRow2, nTab);

    aModificator.SetDocumentModified();

    return true;
  }
}
