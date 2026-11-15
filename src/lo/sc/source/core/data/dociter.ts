// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/dociter.hxx reduced
// @upstream sc/source/core/data/dociter.cxx reduced
// ScValueIterator (the numeric values of a range, column by column, with the subtotal flags and
// text-as-zero) and ScCellIterator (all non-empty cells of a range). They walk the columns'
// sorted cell arrays, so empty cells cost nothing. The query iterators (ScQueryCellIterator)
// live with the interpreter's criteria functions. ScDBQueryDataIterator (the database functions)
// walks the result column's sorted cells as upstream walks its mdds blocks; left out there: the
// rounding of "precision as shown" (CalcAsShown) and the number format info of the current cell.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { GetType as NFGetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, type ScRange } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue, type ScCellData } from '../../../inc/cellvalue.ts';
import { SubtotalFlags } from '../../../inc/global.ts';
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { ScFormulaCell } from './formulacell.ts';
import type { ScDocument } from './document.ts';
import { approxEqual } from '../../../../sal/rtl/math.ts';
import { IsNumberFormat } from '../../../../svl/source/numbers/zforlist.ts';
import { ScQueryConnect, ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry, type ScQueryEntryItem } from '../../../inc/queryentry.ts';
import { ScDBQueryParamBase, ScQueryParam, type ScDBQueryParamInternal, type ScDBQueryParamMatrix } from '../../../inc/queryparam.ts';
import type { SCCOL, SCROW, SCTAB } from '../../../inc/address.ts';
import type { ScMatrix } from '../tool/scmatrix.ts';
import { GetCollator, getDataIgnoreCase, ScQueryEvaluator } from './queryevaluator.ts';

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

/** The cells of a column (ScDBQueryDataIterator::GetColumnCellStore): its sorted rows and cells. */
interface ColumnCellStore { aRows: number[]; aCells: ScCellData[] }

/** ScDBQueryDataIterator::Value */
export class ScDBQueryDataIteratorValue {
  maString = '';
  mfValue = Number.NaN;
  mnError: FormulaError = FormulaError.NONE;
  mbIsNumber = true;
}

abstract class DataAccess {
  abstract getCurrent(rValue: ScDBQueryDataIteratorValue): boolean;
  abstract getFirst(rValue: ScDBQueryDataIteratorValue): boolean;
  abstract getNext(rValue: ScDBQueryDataIteratorValue): boolean;
}

export class ScDBQueryDataIterator {
  static readonly Value = ScDBQueryDataIteratorValue;

  static GetColumnCellStore(rDoc: ScDocument, nTab: SCTAB, nCol: SCCOL): ColumnCellStore | null {
    const pTab = rDoc.FetchTable(nTab);
    if (!pTab) return null;
    if (nCol >= pTab.GetAllocatedColumnsCount()) return null;
    const pCol = pTab.FetchColumn(nCol);
    if (!pCol) return null;
    return pCol.GetCellsInRange(0, rDoc.MaxRow());
  }

  static IsQueryValid(rDoc: ScDocument, rParam: ScQueryParam, nTab: SCTAB, nRow: SCROW, pCell: ScRefCellValue | null): boolean {
    const queryEvaluator = new ScQueryEvaluator(rDoc, rDoc.FetchTable(nTab)!, rParam);
    return queryEvaluator.ValidQuery(nRow, pCell);
  }

  private mpParam: ScDBQueryParamBase;
  private mpData: DataAccess;

  constructor(rDocument: ScDocument, pParam: ScDBQueryParamBase) {
    this.mpParam = pParam;
    switch (this.mpParam.GetType()) {
      case ScDBQueryParamBase.INTERNAL: {
        const p = this.mpParam as ScDBQueryParamInternal;
        this.mpData = new DataAccessInternal(p, rDocument);
        break;
      }
      case ScDBQueryParamBase.MATRIX:
      default: {
        const p = this.mpParam as ScDBQueryParamMatrix;
        this.mpData = new DataAccessMatrix(p);
      }
    }
  }

  /** Does NOT reset rValue if no value found! */
  GetFirst(rValue: ScDBQueryDataIteratorValue): boolean {
    return this.mpData.getFirst(rValue);
  }

  /** Does NOT reset rValue if no value found! */
  GetNext(rValue: ScDBQueryDataIteratorValue): boolean {
    return this.mpData.getNext(rValue);
  }
}

class DataAccessInternal extends DataAccess {
  private mpCells: ColumnCellStore | null = null;
  /** The mdds position: the index of the current cell in mpCells (empty blocks are skipped). */
  private maCurPos = 0;
  private mpParam: ScDBQueryParamInternal;
  private mrDoc: ScDocument;
  private nCol: SCCOL;
  private nRow: SCROW;
  private nTab: SCTAB;

  constructor(pParam: ScDBQueryParamInternal, rDoc: ScDocument) {
    super();
    this.mpParam = pParam;
    this.mrDoc = rDoc;
    this.nCol = this.mpParam.mnField;
    this.nRow = this.mpParam.nRow1;
    this.nTab = this.mpParam.nTab;
    let i: number;
    const nCount = this.mpParam.GetEntryCount();
    for (i = 0; i < nCount && this.mpParam.GetEntry(i).bDoQuery; i++) {
      const rEntry = this.mpParam.GetEntry(i);
      const rItems = rEntry.GetQueryItems();
      rItems.length = 1;
      const rItem = rItems[0]!;
      const r = IsNumberFormat(rItem.maString, 'en-US');
      if (r) rItem.mfVal = r.value;
      rItem.meType = r ? ScQueryEntry.ByValue : ScQueryEntry.ByString;
    }
  }

  private atEnd(): boolean { return !this.mpCells || this.maCurPos >= this.mpCells.aRows.length; }

  override getCurrent(rValue: ScDBQueryDataIteratorValue): boolean {
    // Start with the current row position, and find the first row position
    // that satisfies the query.

    // If the query starts in the same column as the result vector we can
    // prefetch the cell which saves us one fetch in the success case.
    const nFirstQueryField = this.mpParam.GetEntry(0).nField;
    let aCell = new ScRefCellValue();

    while (true) {
      if (this.atEnd() || this.nRow > this.mpParam.nRow2) {
        // Bottom of the range reached. Bail out.
        rValue.mnError = FormulaError.NONE;
        return false;
      }

      // (Empty blocks are not in the cell array: nRow is always the row of a cell.)
      this.nRow = this.mpCells!.aRows[this.maCurPos]!;
      if (this.nRow > this.mpParam.nRow2) continue;

      let pCell: ScRefCellValue | null = null;
      if (this.nCol === nFirstQueryField) {
        aCell = new ScRefCellValue(this.mpCells!.aCells[this.maCurPos]);
        pCell = aCell;
      }

      if (ScDBQueryDataIterator.IsQueryValid(this.mrDoc, new ScQueryParam(this.mpParam), this.nTab, this.nRow, pCell)) {
        if (!pCell) aCell = new ScRefCellValue(this.mpCells!.aCells[this.maCurPos]);
        switch (aCell.getType()) {
          case CELLTYPE_VALUE: {
            rValue.mfValue = aCell.getDouble();
            rValue.mbIsNumber = true;
            rValue.mnError = FormulaError.NONE;
            return true; // Found it!
          }

          case CELLTYPE_FORMULA: {
            if (aCell.getFormula()!.IsValue()) {
              rValue.mfValue = aCell.getFormula()!.GetValue();
              rValue.mbIsNumber = true;
              rValue.mnError = aCell.getFormula()!.GetErrCode();
              return true; // Found it!
            } else if (this.mpParam.mbSkipString) this.incPos();
            else {
              rValue.maString = aCell.getFormula()!.GetString();
              rValue.mfValue = 0.0;
              rValue.mnError = aCell.getFormula()!.GetErrCode();
              rValue.mbIsNumber = false;
              return true;
            }
            break;
          }
          case CELLTYPE_STRING:
          case CELLTYPE_EDIT:
            if (this.mpParam.mbSkipString) this.incPos();
            else {
              rValue.maString = aCell.getString();
              rValue.mfValue = 0.0;
              rValue.mnError = FormulaError.NONE;
              rValue.mbIsNumber = false;
              return true;
            }
            break;
          default:
            this.incPos();
        }
      } else this.incPos();
    }
    // statement unreachable
  }

  override getFirst(rValue: ScDBQueryDataIteratorValue): boolean {
    if (this.mpParam.bHasHeader) ++this.nRow;

    this.mpCells = ScDBQueryDataIterator.GetColumnCellStore(this.mrDoc, this.nTab, this.nCol);
    if (!this.mpCells) return false;

    // mpCells->position(nRow): the first cell at or after nRow.
    const aRows = this.mpCells.aRows;
    let lo = 0;
    let hi = aRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (aRows[mid]! < this.nRow) lo = mid + 1;
      else hi = mid;
    }
    this.maCurPos = lo;
    return this.getCurrent(rValue);
  }

  override getNext(rValue: ScDBQueryDataIteratorValue): boolean {
    if (this.atEnd()) return false;

    this.incPos();
    return this.getCurrent(rValue);
  }

  private incPos(): void {
    // Move to the next cell (the next block after a run of cells, the empty ones skipped).
    ++this.maCurPos;
    if (!this.atEnd()) this.nRow = this.mpCells!.aRows[this.maCurPos]!;
  }
}

class DataAccessMatrix extends DataAccess {
  private mpParam: ScDBQueryParamMatrix;
  private mnCurRow: SCROW;
  private mnRows: SCROW;

  constructor(pParam: ScDBQueryParamMatrix) {
    super();
    this.mpParam = pParam;
    this.mnCurRow = 0;
    const { nR } = this.mpParam.mpMatrix!.GetDimensions();
    this.mnRows = nR;
  }

  override getCurrent(rValue: ScDBQueryDataIteratorValue): boolean {
    // Starting from row == mnCurRow, get the first row that satisfies all the
    // query parameters.
    for (; this.mnCurRow < this.mnRows; ++this.mnCurRow) {
      const rMat = this.mpParam.mpMatrix!;
      if (rMat.IsEmpty(this.mpParam.mnField, this.mnCurRow))
        // Don't take empty values into account.
        continue;

      const bIsStrVal = rMat.IsStringOrEmpty(this.mpParam.mnField, this.mnCurRow);
      if (bIsStrVal && this.mpParam.mbSkipString) continue;

      if (this.isValidQuery(this.mnCurRow, rMat)) {
        rValue.maString = rMat.GetString(this.mpParam.mnField, this.mnCurRow);
        rValue.mfValue = rMat.GetDouble(this.mpParam.mnField, this.mnCurRow);
        rValue.mbIsNumber = !bIsStrVal;
        rValue.mnError = FormulaError.NONE;
        return true;
      }
    }
    return false;
  }

  override getFirst(rValue: ScDBQueryDataIteratorValue): boolean {
    this.mnCurRow = this.mpParam.bHasHeader ? 1 : 0;
    return this.getCurrent(rValue);
  }

  override getNext(rValue: ScDBQueryDataIteratorValue): boolean {
    ++this.mnCurRow;
    return this.getCurrent(rValue);
  }

  private isValidQuery(nRow: SCROW, rMat: ScMatrix): boolean {
    const nEntryCount = this.mpParam.GetEntryCount();
    const aResults: boolean[] = [];

    const rCollator = GetCollator(this.mpParam.bCaseSens);

    for (let i = 0; i < nEntryCount; ++i) {
      const rEntry = this.mpParam.GetEntry(i);
      const rItem = rEntry.GetQueryItem();
      if (!rEntry.bDoQuery) continue;

      switch (rEntry.eOp) {
        case ScQueryOp.SC_EQUAL:
        case ScQueryOp.SC_LESS:
        case ScQueryOp.SC_GREATER:
        case ScQueryOp.SC_LESS_EQUAL:
        case ScQueryOp.SC_GREATER_EQUAL:
        case ScQueryOp.SC_NOT_EQUAL:
          break;
        default:
          // Only the above operators are supported.
          continue;
      }

      let bValid = false;

      const nField = rEntry.nField;
      if (isQueryByValue(rItem, rMat, nField, nRow)) {
        // By value
        const fMatVal = rMat.GetDouble(nField, nRow);
        const bEqual = approxEqual(fMatVal, rItem.mfVal);
        switch (rEntry.eOp) {
          case ScQueryOp.SC_EQUAL:
            bValid = bEqual;
            break;
          case ScQueryOp.SC_LESS:
            bValid = fMatVal < rItem.mfVal && !bEqual;
            break;
          case ScQueryOp.SC_GREATER:
            bValid = fMatVal > rItem.mfVal && !bEqual;
            break;
          case ScQueryOp.SC_LESS_EQUAL:
            bValid = fMatVal < rItem.mfVal || bEqual;
            break;
          case ScQueryOp.SC_GREATER_EQUAL:
            bValid = fMatVal > rItem.mfVal || bEqual;
            break;
          case ScQueryOp.SC_NOT_EQUAL:
            bValid = !bEqual;
            break;
          default:
        }
      } else if (isQueryByString(rEntry, rItem, rMat, nField, nRow)) {
        // By string
        do {
          // Equality check first.
          const aMatStr = rMat.GetString(nField, nRow);
          const aQueryStr = rEntry.GetQueryItem().maString;
          let bDone = false;
          const p1 = this.mpParam.bCaseSens ? aMatStr : getDataIgnoreCase(aMatStr);
          const p2 = this.mpParam.bCaseSens ? aQueryStr : getDataIgnoreCase(aQueryStr);
          switch (rEntry.eOp) {
            case ScQueryOp.SC_EQUAL:
              bValid = p1 === p2;
              bDone = true;
              break;
            case ScQueryOp.SC_NOT_EQUAL:
              bValid = p1 !== p2;
              bDone = true;
              break;
            default:
          }

          if (bDone) break;

          // Unequality check using collator.
          const nCompare = rCollator.compareString(aMatStr, aQueryStr);
          switch (rEntry.eOp) {
            case ScQueryOp.SC_LESS:
              bValid = nCompare < 0;
              break;
            case ScQueryOp.SC_GREATER:
              bValid = nCompare > 0;
              break;
            case ScQueryOp.SC_LESS_EQUAL:
              bValid = nCompare <= 0;
              break;
            case ScQueryOp.SC_GREATER_EQUAL:
              bValid = nCompare >= 0;
              break;
            default:
          }
        } while (false);
      }

      if (aResults.length === 0)
        // First query entry.
        aResults.push(bValid);
      else if (rEntry.eConnect === ScQueryConnect.SC_AND) {
        // For AND op, tuck the result into the last result value.
        const n = aResults.length;
        aResults[n - 1] = aResults[n - 1]! && bValid;
      }
      // For OR op, store its own result.
      else aResults.push(bValid);
    }

    // Row is valid as long as there is at least one result being true.
    return aResults.includes(true);
  }
}

function isQueryByValue(rItem: ScQueryEntryItem, rMat: ScMatrix, nCol: number, nRow: number): boolean {
  if (rItem.meType === ScQueryEntry.ByString) return false;

  if (!rMat.IsValueOrEmpty(nCol, nRow)) return false;

  return true;
}

function isQueryByString(rEntry: ScQueryEntry, rItem: ScQueryEntryItem, rMat: ScMatrix, nCol: number, nRow: number): boolean {
  switch (rEntry.eOp) {
    case ScQueryOp.SC_EQUAL:
    case ScQueryOp.SC_NOT_EQUAL:
    case ScQueryOp.SC_CONTAINS:
    case ScQueryOp.SC_DOES_NOT_CONTAIN:
    case ScQueryOp.SC_BEGINS_WITH:
    case ScQueryOp.SC_ENDS_WITH:
    case ScQueryOp.SC_DOES_NOT_BEGIN_WITH:
    case ScQueryOp.SC_DOES_NOT_END_WITH:
      return true;
    default:
  }

  return rItem.meType === ScQueryEntry.ByString && rMat.IsStringOrEmpty(nCol, nRow);
}

export { EditTextObject };
