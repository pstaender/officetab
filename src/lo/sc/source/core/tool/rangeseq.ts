// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/rangeseq.cxx partial
// ScRangeToSequence: a cell range or a matrix as the sequence<sequence<…>> an add-in function
// receives (arrays of rows here, see sc/inc/addincol.ts). Each Fill* returns the sequence and
// whether it is free of errors (null for no matrix). ScSequenceToMatrix and the API's
// ScApiTypeConversion are in ScUnoAddInCall::SetResult (addincol.ts).
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { approxCeil, approxFloor } from '../../../../sal/rtl/math.ts';
import { ScAddress, type ScRange } from '../../../inc/address.ts';
import { CELLTYPE_FORMULA } from '../../../inc/cellvalue.ts';
import type { ScDocument } from '../data/document.ts';
import type { ScMatrix } from './scmatrix.ts';

export interface FillResult<T> { aRowSeq: T[][]; bOk: boolean }

function lcl_HasErrors(rDoc: ScDocument, rRange: ScRange): boolean {
  // no need to look at empty cells - just use ScCellIterator
  // (the columns' cells directly: ScCellIterator's module would import the interpreter)
  const pTab = rDoc.FetchTable(rRange.aStart.Tab());
  if (!pTab) return false;
  let bErr = false;
  for (let nCol = rRange.aStart.Col(); nCol <= Math.min(rRange.aEnd.Col(), pTab.GetAllocatedColumnsCount() - 1) && !bErr; nCol++) {
    pTab.FetchColumn(nCol)?.ForEachCell(rRange.aStart.Row(), rRange.aEnd.Row(), (nRow) => {
      const aCell = pTab.GetCellValue(nCol, nRow);
      if (aCell.getType() === CELLTYPE_FORMULA && aCell.getFormula()!.GetErrCode() !== FormulaError.NONE) bErr = true;
    });
  }
  return bErr; // no error found
}

function lcl_DoubleToLong(fVal: number): number {
  const fInt = fVal >= 0.0 ? approxFloor(fVal) : approxCeil(fVal);
  if (fInt >= -2147483648 && fInt <= 2147483647) return fInt;
  return 0; // out of range
}

function rangeSize(rRange: ScRange): { nTab: number; nStartCol: number; nStartRow: number; nColCount: number; nRowCount: number } {
  return {
    nTab: rRange.aStart.Tab(),
    nStartCol: rRange.aStart.Col(),
    nStartRow: rRange.aStart.Row(),
    nColCount: rRange.aEnd.Col() + 1 - rRange.aStart.Col(),
    nRowCount: rRange.aEnd.Row() + 1 - rRange.aStart.Row(),
  };
}

export const ScRangeToSequence = {
  FillLongArray(rDocOrMatrix: ScDocument | ScMatrix | null, rRange?: ScRange): FillResult<number> | null {
    if (rRange) {
      const rDoc = rDocOrMatrix as ScDocument;
      const { nTab, nStartCol, nStartRow, nColCount, nRowCount } = rangeSize(rRange);
      const aRowSeq: number[][] = [];
      for (let nRow = 0; nRow < nRowCount; nRow++) {
        const aColSeq: number[] = [];
        for (let nCol = 0; nCol < nColCount; nCol++) aColSeq.push(lcl_DoubleToLong(rDoc.GetValue(new ScAddress(nStartCol + nCol, nStartRow + nRow, nTab))));
        aRowSeq.push(aColSeq);
      }
      return { aRowSeq, bOk: !lcl_HasErrors(rDoc, rRange) };
    }
    const pMatrix = rDocOrMatrix as ScMatrix | null;
    if (!pMatrix) return null;
    const { nC: nColCount, nR: nRowCount } = pMatrix.GetDimensions();
    const aRowSeq: number[][] = [];
    for (let nRow = 0; nRow < nRowCount; nRow++) {
      const aColSeq: number[] = [];
      for (let nCol = 0; nCol < nColCount; nCol++) aColSeq.push(pMatrix.IsStringOrEmpty(nCol, nRow) ? 0 : lcl_DoubleToLong(pMatrix.GetDouble(nCol, nRow)));
      aRowSeq.push(aColSeq);
    }
    return { aRowSeq, bOk: true };
  },

  FillDoubleArray(rDocOrMatrix: ScDocument | ScMatrix | null, rRange?: ScRange): FillResult<number> | null {
    if (rRange) {
      const rDoc = rDocOrMatrix as ScDocument;
      const { nTab, nStartCol, nStartRow, nColCount, nRowCount } = rangeSize(rRange);
      const aRowSeq: number[][] = [];
      for (let nRow = 0; nRow < nRowCount; nRow++) {
        const aColSeq: number[] = [];
        for (let nCol = 0; nCol < nColCount; nCol++) aColSeq.push(rDoc.GetValue(new ScAddress(nStartCol + nCol, nStartRow + nRow, nTab)));
        aRowSeq.push(aColSeq);
      }
      return { aRowSeq, bOk: !lcl_HasErrors(rDoc, rRange) };
    }
    const pMatrix = rDocOrMatrix as ScMatrix | null;
    if (!pMatrix) return null;
    const { nC: nColCount, nR: nRowCount } = pMatrix.GetDimensions();
    const aRowSeq: number[][] = [];
    for (let nRow = 0; nRow < nRowCount; nRow++) {
      const aColSeq: number[] = [];
      for (let nCol = 0; nCol < nColCount; nCol++) aColSeq.push(pMatrix.IsStringOrEmpty(nCol, nRow) ? 0.0 : pMatrix.GetDouble(nCol, nRow));
      aRowSeq.push(aColSeq);
    }
    return { aRowSeq, bOk: true };
  },

  /** Strings of a range (values as displayed) or of a matrix (values in the standard format,
      given by fmt). */
  FillStringArray(rDocOrMatrix: ScDocument | ScMatrix | null, rRange?: ScRange, fmt?: (fVal: number) => string): FillResult<string> | null {
    if (rRange) {
      const rDoc = rDocOrMatrix as ScDocument;
      const { nTab, nStartCol, nStartRow, nColCount, nRowCount } = rangeSize(rRange);
      let bHasErrors = false;
      const aRowSeq: string[][] = [];
      for (let nRow = 0; nRow < nRowCount; nRow++) {
        const aColSeq: string[] = [];
        for (let nCol = 0; nCol < nColCount; nCol++) {
          // ScDocument::GetStringForFormula
          const aPos = new ScAddress(nStartCol + nCol, nStartRow + nRow, nTab);
          const aCell = rDoc.GetRefCellValue(aPos);
          if (aCell.getType() === CELLTYPE_FORMULA && aCell.getFormula()!.GetErrCode() !== FormulaError.NONE) {
            bHasErrors = true;
            aColSeq.push('');
          } else aColSeq.push(rDoc.GetString(aPos));
        }
        aRowSeq.push(aColSeq);
      }
      return { aRowSeq, bOk: !bHasErrors };
    }
    const pMatrix = rDocOrMatrix as ScMatrix | null;
    if (!pMatrix) return null;
    const { nC: nColCount, nR: nRowCount } = pMatrix.GetDimensions();
    const aRowSeq: string[][] = [];
    for (let nRow = 0; nRow < nRowCount; nRow++) {
      const aColSeq: string[] = [];
      for (let nCol = 0; nCol < nColCount; nCol++) {
        let aStr = '';
        if (pMatrix.IsStringOrEmpty(nCol, nRow)) {
          if (!pMatrix.IsEmpty(nCol, nRow)) aStr = pMatrix.GetString(nCol, nRow);
        } else {
          const fVal = pMatrix.GetDouble(nCol, nRow);
          aStr = fmt ? fmt(fVal) : String(fVal);
        }
        aColSeq.push(aStr);
      }
      aRowSeq.push(aColSeq);
    }
    return { aRowSeq, bOk: true };
  },

  FillMixedArray(rDocOrMatrix: ScDocument | ScMatrix | null, rRange?: ScRange, bAllowNV = false): FillResult<number | string | boolean | undefined> | null {
    if (rRange) {
      const rDoc = rDocOrMatrix as ScDocument;
      const { nTab, nStartCol, nStartRow, nColCount, nRowCount } = rangeSize(rRange);
      let bHasErrors = false;
      const aRowSeq: (number | string | undefined)[][] = [];
      for (let nRow = 0; nRow < nRowCount; nRow++) {
        const aColSeq: (number | string | undefined)[] = [];
        for (let nCol = 0; nCol < nColCount; nCol++) {
          const aPos = new ScAddress(nStartCol + nCol, nStartRow + nRow, nTab);
          const aCell = rDoc.GetRefCellValue(aPos);
          if (aCell.isEmpty()) {
            aColSeq.push('');
            continue;
          }
          if (aCell.getType() === CELLTYPE_FORMULA && aCell.getFormula()!.GetErrCode() !== FormulaError.NONE) {
            // if NV is allowed, leave empty for errors
            bHasErrors = true;
            aColSeq.push(undefined);
          } else if (aCell.hasNumeric()) aColSeq.push(aCell.getValue());
          else aColSeq.push(aCell.getString());
        }
        aRowSeq.push(aColSeq);
      }
      return { aRowSeq, bOk: bAllowNV || !bHasErrors };
    }
    const pMatrix = rDocOrMatrix as ScMatrix | null;
    if (!pMatrix) return null;
    const bDataTypes = bAllowNV; // the matrix variant's second parameter
    const { nC: nColCount, nR: nRowCount } = pMatrix.GetDimensions();
    const aRowSeq: (number | string | boolean)[][] = [];
    for (let nRow = 0; nRow < nRowCount; nRow++) {
      const aColSeq: (number | string | boolean)[] = [];
      for (let nCol = 0; nCol < nColCount; nCol++) {
        if (pMatrix.IsStringOrEmpty(nCol, nRow)) {
          let aStr = '';
          if (!pMatrix.IsEmpty(nCol, nRow)) aStr = pMatrix.GetString(nCol, nRow);
          aColSeq.push(aStr);
        } else {
          const fVal = pMatrix.GetDouble(nCol, nRow);
          if (bDataTypes && pMatrix.IsBoolean(nCol, nRow)) aColSeq.push(fVal !== 0.0);
          else aColSeq.push(fVal);
        }
      }
      aRowSeq.push(aColSeq);
    }
    return { aRowSeq, bOk: true };
  },
};
