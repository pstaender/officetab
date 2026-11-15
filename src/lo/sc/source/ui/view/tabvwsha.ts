// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/view/tabvwsha.cxx partial
// @upstream sc/source/core/data/documen4.cxx partial
// ScTabViewShell::GetFunction: the status bar's selection functions (Sum, Average, Count …,
// chosen by ScAppOptions::GetStatusFunc), with ScDocument::GetSelectionFunction's result over
// the selected cells (or the cursor's), skipping hidden and filtered rows. The values are shown
// in the cursor cell's number format, counts as plain numbers.
import { ScAddress, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_VALUE } from '../../../inc/cellvalue.ts';
import { ScSubTotalFunc } from '../../../inc/global.ts';
import { GetOutputString } from '../../../../svl/source/numbers/zforlist.ts';
import { ScGlobal } from '../../../inc/global.ts';
import type { ScViewData } from './viewdata.ts';
import type { FormulaError } from '../../../../include/formula/errorcodes.ts';

/** The functions of the status bar's menu, in its order (ScSubTotalFunc ids). */
export const STATUS_FUNCS: { id: number; key: string }[] = [
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_AVE, key: 'average' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_CNT2, key: 'counta' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_CNT, key: 'count' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_MAX, key: 'max' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_MIN, key: 'min' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_SUM, key: 'sum' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_SELECTION_COUNT, key: 'selectioncount' },
  { id: ScSubTotalFunc.SUBTOTAL_FUNC_NONE, key: 'none' },
];

/** ScDocument::GetSelectionFunction: the function over the marked cells, or the cursor's cell. */
export function GetSelectionFunction(rViewData: ScViewData, eFunc: number): { nVal: number; nErr: number } | null {
  const rDoc = rViewData.GetDocument();
  const nTab: SCTAB = rViewData.GetTabNo();
  const ranges = rViewData.GetMultiArea();
  let fSum = 0, nCount = 0, nCount2 = 0, fMin = Infinity, fMax = -Infinity, nSel = 0;
  let nErr = 0;
  for (const r of ranges) {
    const pTab = rDoc.FetchTable(nTab);
    if (!pTab) continue;
    for (let nRow = r.aStart.Row(); nRow <= r.aEnd.Row(); nRow++) {
      if (rDoc.RowHidden(nRow, nTab) || rDoc.RowFiltered(nRow, nTab)) continue;
      nSel += r.aEnd.Col() - r.aStart.Col() + 1;
    }
    for (let nCol = r.aStart.Col(); nCol <= Math.min(r.aEnd.Col(), pTab.GetAllocatedColumnsCount() - 1); nCol++) {
      if (rDoc.ColHidden(nCol, nTab)) continue;
      pTab.FetchColumn(nCol)?.ForEachCell(r.aStart.Row(), r.aEnd.Row(), (nRow) => {
        if (rDoc.RowHidden(nRow, nTab) || rDoc.RowFiltered(nRow, nTab)) return;
        const aPos = new ScAddress(nCol, nRow, nTab);
        const eType = rDoc.GetCellType(aPos);
        if (eType === CELLTYPE_NONE) return;
        nCount2++;
        let bValue = eType === CELLTYPE_VALUE;
        if (eType === CELLTYPE_FORMULA) {
          const f = rDoc.GetFormulaCell(aPos)!;
          if (f.GetErrCode()) { if (!nErr) nErr = f.GetErrCode(); return; }
          bValue = f.IsValue();
        }
        if (!bValue) return;
        const v = rDoc.GetValue(aPos);
        nCount++;
        fSum += v;
        fMin = Math.min(fMin, v);
        fMax = Math.max(fMax, v);
      });
    }
  }
  switch (eFunc) {
    case ScSubTotalFunc.SUBTOTAL_FUNC_SUM: return { nVal: fSum, nErr };
    case ScSubTotalFunc.SUBTOTAL_FUNC_AVE: return nCount ? { nVal: fSum / nCount, nErr } : null;
    case ScSubTotalFunc.SUBTOTAL_FUNC_CNT: return { nVal: nCount, nErr: 0 };
    case ScSubTotalFunc.SUBTOTAL_FUNC_CNT2: return { nVal: nCount2, nErr: 0 };
    case ScSubTotalFunc.SUBTOTAL_FUNC_MIN: return nCount ? { nVal: fMin, nErr } : null;
    case ScSubTotalFunc.SUBTOTAL_FUNC_MAX: return nCount ? { nVal: fMax, nErr } : null;
    case ScSubTotalFunc.SUBTOTAL_FUNC_SELECTION_COUNT: return { nVal: nSel, nErr: 0 };
    default: return null;
  }
}

/** GetFunction: the status bar's texts, one per chosen function (label key and value). */
export function GetFunction(rViewData: ScViewData, nFuncs: number): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const rMark = rViewData.GetMarkData();
  const bIgnoreError = rMark.IsMarked() || rMark.IsMultiMarked();
  const rDoc = rViewData.GetDocument();
  for (const f of STATUS_FUNCS) {
    if (f.id === ScSubTotalFunc.SUBTOTAL_FUNC_NONE || !(nFuncs & (1 << f.id))) continue;
    const r = GetSelectionFunction(rViewData, f.id);
    if (!r) continue;
    if (r.nErr && !bIgnoreError) { out.push({ key: f.key, value: ScGlobal.GetErrorString(r.nErr as FormulaError) }); continue; }
    let value: string;
    if (r.nVal === 0) value = '0';
    else if (f.id === ScSubTotalFunc.SUBTOTAL_FUNC_CNT || f.id === ScSubTotalFunc.SUBTOTAL_FUNC_CNT2 || f.id === ScSubTotalFunc.SUBTOTAL_FUNC_SELECTION_COUNT) value = String(r.nVal);
    else {
      // Number in the standard format, the other on the cursor position
      const code = rDoc.GetNumberFormat(rViewData.GetCurX(), rViewData.GetCurY(), rViewData.GetTabNo());
      value = /^\s*General\s*$/i.test(code) ? String(Math.round(r.nVal * 1e10) / 1e10) : GetOutputString(r.nVal, code, 'en-US').text;
    }
    out.push({ key: f.key, value });
  }
  return out;
}
