// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/dociter.hxx reduced
// @upstream sc/source/core/data/dociter.cxx reduced
// ScValueIterator (the numeric values of a range, column by column, with the subtotal flags and
// text-as-zero) and ScCellIterator (all non-empty cells of a range). They walk the columns'
// sorted cell arrays, so empty cells cost nothing. The query iterators (ScQueryCellIterator)
// live with the interpreter's criteria functions.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { GetType as NFGetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, type ScRange } from '../../../inc/address.ts';
import { ScRefCellValue, type ScCellData } from '../../../inc/cellvalue.ts';
import { SubtotalFlags } from '../../../inc/global.ts';
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { ScFormulaCell } from './formulacell.ts';
import type { ScDocument } from './document.ts';

export interface ScValueIteratorItem { fVal: number; nErr: FormulaError; nCol: number; nRow: number; nTab: number }

export class ScValueIterator {
  private mrDoc: ScDocument;
  private maRange: ScRange;
  private mnSubTotalFlags: SubtotalFlags;
  private mbTextAsZero: boolean;
  private mnCurCol = -1;
  private mnCurRow = -1;
  private mnCurTab = -1;
  private mnNumFmtType: SvNumFormatType = SvNumFormatType.NUMBER;
  private maNumFmtCode = 'General';

  constructor(rDoc: ScDocument, rRange: ScRange, nSubTotalFlags: SubtotalFlags = SubtotalFlags.NONE, bTextAsZero = false) {
    this.mrDoc = rDoc;
    this.maRange = rRange.clone();
    this.mnSubTotalFlags = nSubTotalFlags;
    this.mbTextAsZero = bTextAsZero;
  }

  /** All values of the range (the loop of GetFirst/GetNext). */
  *values(): Generator<ScValueIteratorItem> {
    const r = this.maRange;
    for (let nTab = r.aStart.Tab(); nTab <= r.aEnd.Tab(); nTab++) {
      const pTab = this.mrDoc.FetchTable(nTab);
      if (!pTab) continue;
      const nEndCol = Math.min(r.aEnd.Col(), pTab.GetAllocatedColumnsCount() - 1);
      for (let nCol = r.aStart.Col(); nCol <= nEndCol; nCol++) {
        const pCol = pTab.FetchColumn(nCol);
        if (!pCol || pCol.IsEmptyData()) continue;
        const { aRows, aCells } = pCol.GetCellsInRange(r.aStart.Row(), r.aEnd.Row());
        for (let i = 0; i < aRows.length; i++) {
          const nRow = aRows[i]!;
          if ((this.mnSubTotalFlags & SubtotalFlags.IgnoreHidden && pTab.RowHidden(nRow)) || (this.mnSubTotalFlags & SubtotalFlags.IgnoreFiltered && pTab.RowFiltered(nRow))) continue;
          const p = aCells[i]!;
          let fVal: number;
          let nErr: FormulaError = FormulaError.NONE;
          if (typeof p === 'number') fVal = p;
          else if (p instanceof ScFormulaCell) {
            if (this.mnSubTotalFlags & SubtotalFlags.IgnoreNestedStAg && p.IsSubTotal()) continue;
            nErr = p.GetErrCode();
            if (nErr !== FormulaError.NONE) {
              if (this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal) continue;
              fVal = 0;
            } else if (p.IsValue()) fVal = p.GetValue();
            else if (this.mbTextAsZero) fVal = 0;
            else continue;
          } else if (this.mbTextAsZero) fVal = 0; // string and edit cells
          else continue;
          this.mnCurCol = nCol;
          this.mnCurRow = nRow;
          this.mnCurTab = nTab;
          yield { fVal, nErr, nCol, nRow, nTab };
        }
      }
    }
  }

  /** The number format type and code of the current cell (GetCurNumFmtInfo). */
  GetCurNumFmtInfo(): { nType: SvNumFormatType; aCode: string } {
    if (this.mnCurCol < 0) return { nType: this.mnNumFmtType, aCode: this.maNumFmtCode };
    const aCode = this.mrDoc.GetNumberFormat(this.mnCurCol, this.mnCurRow, this.mnCurTab);
    const pF = this.mrDoc.GetFormulaCell(new ScAddress(this.mnCurCol, this.mnCurRow, this.mnCurTab));
    let nType = NFGetType(aCode, 'en-US');
    if (pF && /^General$/i.test(aCode)) nType = pF.GetFormatType();
    this.mnNumFmtType = nType;
    this.maNumFmtCode = aCode;
    return { nType, aCode };
  }
}

export interface ScCellIteratorItem { nCol: number; nRow: number; nTab: number; aCell: ScRefCellValue; pData: ScCellData }

/** Walk through all non-empty cells in an area (ScCellIterator). */
export class ScCellIterator {
  private mrDoc: ScDocument;
  private maRange: ScRange;
  private mnSubTotalFlags: SubtotalFlags;

  constructor(rDoc: ScDocument, rRange: ScRange, nSubTotalFlags: SubtotalFlags = SubtotalFlags.NONE) {
    this.mrDoc = rDoc;
    this.maRange = rRange.clone();
    this.mnSubTotalFlags = nSubTotalFlags;
  }

  *cells(): Generator<ScCellIteratorItem> {
    const r = this.maRange;
    for (let nTab = r.aStart.Tab(); nTab <= r.aEnd.Tab(); nTab++) {
      const pTab = this.mrDoc.FetchTable(nTab);
      if (!pTab) continue;
      const nEndCol = Math.min(r.aEnd.Col(), pTab.GetAllocatedColumnsCount() - 1);
      for (let nCol = r.aStart.Col(); nCol <= nEndCol; nCol++) {
        const pCol = pTab.FetchColumn(nCol);
        if (!pCol || pCol.IsEmptyData()) continue;
        const { aRows, aCells } = pCol.GetCellsInRange(r.aStart.Row(), r.aEnd.Row());
        for (let i = 0; i < aRows.length; i++) {
          const nRow = aRows[i]!;
          if ((this.mnSubTotalFlags & SubtotalFlags.IgnoreHidden && pTab.RowHidden(nRow)) || (this.mnSubTotalFlags & SubtotalFlags.IgnoreFiltered && pTab.RowFiltered(nRow))) continue;
          const p = aCells[i]!;
          // Skip formula cells with Subtotal formulae or errors, depending on mnSubTotalFlags
          if (p instanceof ScFormulaCell && ((this.mnSubTotalFlags & SubtotalFlags.IgnoreNestedStAg && p.IsSubTotal()) || (this.mnSubTotalFlags & SubtotalFlags.IgnoreErrVal && p.GetErrCode() !== FormulaError.NONE))) continue;
          yield { nCol, nRow, nTab, aCell: new ScRefCellValue(p), pData: p };
        }
      }
    }
  }
}

export { EditTextObject };
