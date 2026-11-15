// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/dbfunc.hxx reduced
// @upstream sc/source/ui/view/dbfunc.cxx partial
// ScDBFunc: the view's database functions, reduced to sorting the selection (Sort, through
// ScDBDocFunc with undo) and the data area a sort takes when only a cell is selected
// (GetDBData's automatic area). Database ranges, filters, subtotals, outlines and pivot tables
// are left out.
import { ScRange } from '../../../inc/address.ts';
import type { ScInputOptions } from '../../../inc/inputopt.ts';
import { ScSortParam } from '../../../inc/sortparam.ts';
import { ScDBDocFunc } from '../docshell/dbdocfun.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScViewFunc } from './viewfunc.ts';
import { ScMarkType } from './viewdata.ts';

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
}
