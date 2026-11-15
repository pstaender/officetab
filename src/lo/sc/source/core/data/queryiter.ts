// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/queryiter.hxx reduced
// @upstream sc/source/core/data/queryiter.cxx reduced
// @upstream sc/inc/lookupsearchmode.hxx faithful
// The query cell iterators of the interpreter: ScQueryCellIterator (the cells of a range that
// pass a query, e.g. for VLOOKUP and SUMIF, with FindEqualOrSortedLastInRange for sorted range
// lookups and the binary search) and ScCountIfCellIterator (COUNTIF, COUNTIFS). Only the direct
// (linear) access is ported: the mdds block position is the row in the column's sorted cell
// array, an "empty block" is a run of rows without cells. Left out: the ScSortedRangeCache access
// (upstream only uses it for the binary search modes of XLOOKUP/XMATCH; the interpreter searches
// linearly there), the binary search in a row (upstream has no direct implementation either).
// Iterating does not create columns. COUNTIF counts a run of empty cells at once.
import * as OC from '../../../../include/formula/opcode.ts';
import { approxEqual } from '../../../../sal/rtl/math.ts';
import { IsNumberFormat } from '../../../../svl/source/numbers/zforlist.ts';
import { SearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import { ScAddress, SCCOL_MAX, SCROW_MAX, type SCCOL, type SCCOLROW, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue } from '../../../inc/cellvalue.ts';
import { ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry } from '../../../inc/queryentry.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScCellFormat } from '../tool/cellform.ts';
import type { ScColumn } from './column.ts';
import type { ScDocument } from './document.ts';
import { GetCollator, ScQueryEvaluator } from './queryevaluator.ts';

/** Mode used with interpreter functions such as VLOOKUP and MATCH. */
export const LookupSearchMode = {
  Forward: 1, // Perform a search starting at the first item. This is the default.
  Reverse: -1, // Perform a reverse search starting at the last item.
  BinaryAscending: 2, // Perform a binary search that relies on lookup_array being sorted in ascending order.
  BinaryDescending: -2, // Perform a binary search that relies on lookup_array being sorted in descending order.
} as const;
export type LookupSearchMode = (typeof LookupSearchMode)[keyof typeof LookupSearchMode];

export const ScQueryCellIteratorType = { Generic: 0, CountIf: 1 } as const;
export type ScQueryCellIteratorType = (typeof ScQueryCellIteratorType)[keyof typeof ScQueryCellIteratorType];

const nStopOnMismatchDisabled = 0x00;
const nStopOnMismatchEnabled = 0x01;
const nStopOnMismatchOccurred = 0x02;
const nStopOnMismatchExecuted = nStopOnMismatchEnabled | nStopOnMismatchOccurred;

const nTestEqualConditionDisabled = 0x00;
const nTestEqualConditionEnabled = 0x01;
const nTestEqualConditionMatched = 0x02;
const nTestEqualConditionFulfilled = nTestEqualConditionEnabled | nTestEqualConditionMatched;

const nBinarySearchDisabled = 0x00;
const nSearchbAscd = 0x01;
const nSearchbDesc = 0x02;

/** The position in a column (sc::CellStoreType::const_position_type): the row is nRow; at the
    end of the column storage mbEnd is set. */
interface PositionType { nRow: SCROW; mbEnd: boolean }

/** Shared code for query-based iterators. The main class (ScQueryCellIteratorBase). */
export class ScQueryCellIteratorBase {
  // ScQueryCellIteratorAccessSpecific< Direct >
  protected maCurPos: PositionType = { nRow: 0, mbEnd: false };
  protected maParam: ScQueryParam;
  protected rDoc: ScDocument;
  protected mbReverseSearch: boolean;
  protected nTab: SCTAB;
  protected nCol: SCCOL;
  protected nRow: SCROW;

  protected nStopOnMismatch = nStopOnMismatchDisabled;
  protected nTestEqualCondition = nTestEqualConditionDisabled;
  protected nSortedBinarySearch = nBinarySearchDisabled;
  protected bAdvanceQuery = false;
  protected bIgnoreMismatchOnLeadingStrings = false;
  protected nSearchOpCode: number = OC.ocNone;
  protected nBestFitCol: SCCOL = SCCOL_MAX;
  protected nBestFitRow: SCROW = SCROW_MAX;

  // ScQueryCellIteratorTypeSpecific
  private readonly meQueryType: ScQueryCellIteratorType;
  protected getThisResult = false;
  protected countIfCount = 0;

  constructor(queryType: ScQueryCellIteratorType, rDocument: ScDocument, nTable: SCTAB, rParam: ScQueryParam, bMod: boolean, bReverse: boolean) {
    this.meQueryType = queryType;
    this.maParam = new ScQueryParam(rParam);
    this.rDoc = rDocument;
    this.mbReverseSearch = bReverse;
    this.nTab = nTable;
    this.nCol = !bReverse ? this.maParam.nCol1 : this.maParam.nCol2;
    this.nRow = !bReverse ? this.maParam.nRow1 : this.maParam.nRow2;
    if (!bMod) // Or else it's already inserted
      return;

    const nCount = this.maParam.GetEntryCount();
    for (let i = 0; i < nCount && this.maParam.GetEntry(i).bDoQuery; ++i) {
      const rEntry = this.maParam.GetEntry(i);
      const rItem = rEntry.GetQueryItem();
      const r = IsNumberFormat(rItem.maString, 'en-US');
      if (r) rItem.mfVal = r.value;
      rItem.meType = r ? ScQueryEntry.ByValue : ScQueryEntry.ByString;
    }
  }

  // --- the direct access ---------------------------------------------------------------------------

  /** The column, null if it is not allocated (then it is all empty). */
  protected GetColumn(nColP: SCCOL): ScColumn | null { return this.rDoc.FetchTable(this.nTab)?.FetchColumn(nColP) ?? null; }

  /** Whether the current position is in an empty block. */
  private IsEmptyPos(): boolean {
    const pCol = this.GetColumn(this.nCol);
    return !pCol || !pCol.HasDataAt(this.nRow);
  }

  protected InitPosDirect(): void {
    if (!this.mbReverseSearch) {
      this.nRow = this.maParam.nRow1;
      if (this.maParam.bHasHeader && this.maParam.bByRow) ++this.nRow;
    } else this.nRow = this.maParam.nRow2;
    this.maCurPos = { nRow: this.nRow, mbEnd: false };
  }

  protected IncPos(): void {
    ++this.nRow;
    this.maCurPos = { nRow: this.nRow, mbEnd: this.nRow > this.rDoc.MaxRow() };
  }

  protected DecPos(): void {
    if (this.nRow > 0) {
      --this.nRow;
      this.maCurPos = { nRow: this.nRow, mbEnd: false };
    } else this.SetEndBackward();
  }

  /** From an empty block to the next block (the next cell, or the end). */
  protected IncBlock(): void {
    const pCol = this.GetColumn(this.nCol);
    const nNext = pCol ? pCol.GetNextDataPos(this.nRow) : -1;
    if (nNext >= 0) {
      this.nRow = nNext;
      this.maCurPos = { nRow: this.nRow, mbEnd: false };
    } else {
      this.nRow = this.rDoc.MaxRow() + 1;
      this.maCurPos = { nRow: this.nRow, mbEnd: true };
    }
  }

  /** From an empty block to the last cell of the previous block. */
  protected DecBlock(): void {
    const pCol = this.GetColumn(this.nCol);
    const nPrev = pCol ? pCol.GetNextDataPos(this.nRow, false) : -1;
    if (nPrev >= 0) {
      this.nRow = nPrev;
      this.maCurPos = { nRow: this.nRow, mbEnd: false };
    } else this.SetEndBackward();
  }

  private SetEndBackward(): void {
    // No rows, set to end. This will make PerformQuery() go to next column.
    this.nRow = this.maParam.nRow1 - 1;
    this.maCurPos = { nRow: this.nRow, mbEnd: true };
  }

  // --- the type specific part ------------------------------------------------------------------------

  /** HandleItemFound(): Generic stops at the first match, CountIf counts nCount matches. */
  protected HandleItemFound(nCount = 1): boolean {
    if (this.meQueryType === ScQueryCellIteratorType.Generic) {
      this.getThisResult = true;
      return true; // Return from PerformQuery().
    }
    this.countIfCount += nCount;
    return false; // Continue searching.
  }

  // --- the base -------------------------------------------------------------------------------------

  protected InitPos(): void { this.InitPosDirect(); }

  // The actual query function. It will call HandleItemFound() for any matching type
  // and return if HandleItemFound() returns true.
  protected PerformQuery(): void {
    const rEntry = this.maParam.GetEntry(0);
    const rItem = rEntry.GetQueryItem();
    const pTab = this.rDoc.FetchTable(this.nTab)!;

    const bSingleQueryItem = rEntry.GetQueryItems().length === 1;
    let nFirstQueryField: SCCOLROW = rEntry.nField;
    const bAllStringIgnore = this.bIgnoreMismatchOnLeadingStrings && rItem.meType !== ScQueryEntry.ByString;
    let bFirstStringIgnore = this.bIgnoreMismatchOnLeadingStrings && !this.maParam.bHasHeader && rItem.meType === ScQueryEntry.ByString
      && ((this.maParam.bByRow && this.nRow === this.maParam.nRow1) || (!this.maParam.bByRow && this.nCol === this.maParam.nCol1));
    const bTestEqualCondition = { value: false };
    const bNewSearchFunction = this.nSearchOpCode === OC.ocXLookup || this.nSearchOpCode === OC.ocXMatch;
    const queryEvaluator = new ScQueryEvaluator(this.rDoc, pTab, this.maParam, this.nTestEqualCondition ? bTestEqualCondition : null, bNewSearchFunction);

    let pCol = this.GetColumn(this.nCol);
    for (;;) {
      let bNextColumn = this.maCurPos.mbEnd;
      if (!bNextColumn) {
        if ((!this.mbReverseSearch && this.nRow > this.maParam.nRow2) || (this.mbReverseSearch && this.nRow < this.maParam.nRow1)) bNextColumn = true;
      }

      if (bNextColumn) {
        do {
          if (!this.mbReverseSearch) {
            ++this.nCol;
            if (this.nCol > this.maParam.nCol2) return;
            else if (!rItem.mbMatchEmpty && this.nCol >= pTab.GetAllocatedColumnsCount()) return;
          } else {
            --this.nCol;
            if (this.nCol < this.maParam.nCol1 || this.nCol < 0) return;
          }
          if (this.bAdvanceQuery) {
            this.AdvanceQueryParamEntryField();
            nFirstQueryField = rEntry.nField;
          }
          pCol = this.GetColumn(this.nCol);
        } while (!rItem.mbMatchEmpty && (!pCol || pCol.IsEmptyData()));

        this.InitPos();

        bFirstStringIgnore = this.bIgnoreMismatchOnLeadingStrings && !this.maParam.bHasHeader && rItem.meType === ScQueryEntry.ByString && this.maParam.bByRow;
      }

      if (this.IsEmptyPos()) {
        if (rItem.mbMatchEmpty && bSingleQueryItem) {
          // This shortcut, instead of determining if any SC_OR query
          // exists or this query is SC_AND'ed (which wouldn't make
          // sense, but..) and evaluating them in ValidQuery(), is
          // possible only because the interpreter is the only caller
          // that sets mbMatchEmpty and there is only one item in those
          // cases.
          // XXX this would have to be reworked if other filters used it
          // in different manners and evaluation would have to be done in
          // ValidQuery().
          let nRun = 1;
          if (this.meQueryType === ScQueryCellIteratorType.CountIf && !this.mbReverseSearch) {
            // Count the empty block up to the range end at once.
            const nNext = pCol ? pCol.GetNextDataPos(this.nRow) : -1;
            const nLast = Math.min(nNext >= 0 ? nNext - 1 : this.rDoc.MaxRow(), this.maParam.nRow2);
            nRun = nLast - this.nRow + 1;
            if (this.HandleItemFound(nRun)) return;
            this.nRow = nLast;
            this.IncPos();
            continue;
          }
          if (this.HandleItemFound(nRun)) return;
          if (!this.mbReverseSearch) this.IncPos();
          else this.DecPos();
          continue;
        } else {
          if (!this.mbReverseSearch) this.IncBlock();
          else this.DecBlock();
          continue;
        }
      }

      const aCell = pCol!.GetCellValue(this.nRow);

      if (bAllStringIgnore && aCell.hasString()) {
        if (!this.mbReverseSearch) this.IncPos();
        else this.DecPos();
      } else {
        if (queryEvaluator.ValidQuery(this.nRow, this.nCol === nFirstQueryField ? aCell : null)) {
          if (this.nTestEqualCondition && bTestEqualCondition.value) this.nTestEqualCondition |= nTestEqualConditionMatched;
          if (aCell.isEmpty()) return;

          // XLookUp/XMatch: Forward/asc/backward/desc search for best fit value, except if we have an exact match
          if (bNewSearchFunction && (rEntry.eOp === ScQueryOp.SC_LESS_EQUAL || rEntry.eOp === ScQueryOp.SC_GREATER_EQUAL)
            && (this.nBestFitCol !== this.nCol || this.nBestFitRow !== this.nRow)) {
            const bNumSearch = rItem.meType === ScQueryEntry.ByValue && aCell.hasNumeric();
            const bStringSearch = rItem.meType === ScQueryEntry.ByString && aCell.hasString();
            if (bNumSearch || bStringSearch) {
              if (this.nTestEqualCondition === nTestEqualConditionFulfilled || (this.nBestFitCol === SCCOL_MAX && this.nBestFitRow === SCROW_MAX)) this.HandleBestFitItemFound(this.nCol, this.nRow);
              else {
                const aBFAddr = new ScAddress(this.nBestFitCol, this.nBestFitRow, this.nTab);
                const aBFCell = this.rDoc.GetRefCellValue(aBFAddr);
                const aParamTmp = new ScQueryParam(this.maParam);
                const rEntryTmp = aParamTmp.GetEntry(0);

                if (rEntry.eOp === ScQueryOp.SC_LESS_EQUAL) rEntryTmp.eOp = ScQueryOp.SC_GREATER;
                else if (rEntry.eOp === ScQueryOp.SC_GREATER_EQUAL) rEntryTmp.eOp = ScQueryOp.SC_LESS;

                const rItemTmp = rEntryTmp.GetQueryItem();
                if (bNumSearch) rItemTmp.mfVal = aBFCell.getValue();
                else if (bStringSearch) rItemTmp.maString = aBFCell.getString();

                const queryEvaluatorTmp = new ScQueryEvaluator(this.rDoc, pTab, aParamTmp, null, bNewSearchFunction);
                if (queryEvaluatorTmp.ValidQuery(this.nRow, this.nCol === nFirstQueryField ? aCell : null)) this.HandleBestFitItemFound(this.nCol, this.nRow);
                else {
                  if (!this.mbReverseSearch) this.IncPos();
                  else this.DecPos();
                  continue;
                }
              }
            } else {
              if (!this.mbReverseSearch) this.IncPos();
              else this.DecPos();
              continue;
            }
          }
          if (this.HandleItemFound()) return;
          if (!this.mbReverseSearch) this.IncPos();
          else this.DecPos();
          continue;
        } else if (this.nStopOnMismatch) {
          // Yes, even a mismatch may have a fulfilled equal
          // condition if regular expressions were involved and
          // SC_LESS_EQUAL or SC_GREATER_EQUAL were queried.
          if (this.nTestEqualCondition && bTestEqualCondition.value) {
            this.nTestEqualCondition |= nTestEqualConditionMatched;
            this.nStopOnMismatch |= nStopOnMismatchOccurred;
            return;
          }
          let bStop: boolean;
          if (bFirstStringIgnore) {
            if (aCell.hasString()) {
              if (!this.mbReverseSearch) this.IncPos();
              else this.DecPos();
              bStop = false;
            } else bStop = true;
          } else bStop = true;
          if (bStop) {
            this.nStopOnMismatch |= nStopOnMismatchOccurred;
            return;
          }
        } else {
          if (!this.mbReverseSearch) this.IncPos();
          else this.DecPos();
        }
      }
      bFirstStringIgnore = false;
    }
  }

  AdvanceQueryParamEntryField(): void {
    const nEntries = this.maParam.GetEntryCount();
    for (let j = 0; j < nEntries; j++) {
      const rEntry = this.maParam.GetEntry(j);
      if (rEntry.bDoQuery) {
        if (!this.mbReverseSearch && rEntry.nField < this.rDoc.MaxCol()) rEntry.nField++;
        else if (this.mbReverseSearch && rEntry.nField > 0) rEntry.nField--;
      } else break; // for
    }
  }

  AdvanceQueryParamEntryFieldForBinarySearch(): void {
    const nEntries = this.maParam.GetEntryCount();
    for (let j = 0; j < nEntries; j++) {
      const rEntry = this.maParam.GetEntry(j);
      if (rEntry.bDoQuery) {
        if (rEntry.nField < this.rDoc.MaxCol()) rEntry.nField = this.nCol;
      } else break; // for
    }
  }

  /* Only works if no regular expression is involved, only searches for rows in one column, and
     only the first query entry is considered with simple conditions SC_LESS,SC_LESS_EQUAL,
     SC_EQUAL (sorted ascending) or SC_GREATER,SC_GREATER_EQUAL (sorted descending). It delivers a
     starting point set to nRow, i.e. the last row that either matches the searched for value, or
     the last row that matches the condition. Continue with e.g. GetThis() and GetNext()
     afterwards. Returns false if the searched for value is not in the search range or if the
     range is not properly sorted, with nRow in that case set to the first row or after the last
     row. In that case use GetFirst(). The search in a row (by column) is not ported. */
  protected BinarySearch(col_row: SCCOLROW, forEqual = false): boolean {
    const pTab = this.rDoc.FetchTable(this.nTab)!;
    this.nCol = this.maParam.bByRow ? col_row : this.maParam.nCol1;
    this.nRow = this.maParam.bByRow ? this.maParam.nRow1 : col_row;

    if (!this.maParam.bByRow) return false;
    if (this.nCol >= pTab.GetAllocatedColumnsCount()) return false;

    const pCol = this.GetColumn(this.nCol);
    if (!pCol || pCol.IsEmptyData()) return false;

    const rCollator = GetCollator(this.maParam.bCaseSens);
    const rEntry = this.maParam.GetEntry(0);
    const rItem = rEntry.GetQueryItem();
    const bAscending = rEntry.eOp === ScQueryOp.SC_LESS || rEntry.eOp === ScQueryOp.SC_LESS_EQUAL || rEntry.eOp === ScQueryOp.SC_EQUAL;
    const bByString = rItem.meType === ScQueryEntry.ByString;
    const bForceStr = bByString && (rEntry.eOp === ScQueryOp.SC_EQUAL || forEqual);
    const bAllStringIgnore = this.bIgnoreMismatchOnLeadingStrings && !bByString;
    const bFirstStringIgnore = this.bIgnoreMismatchOnLeadingStrings && !this.maParam.bHasHeader && bByString;

    if (this.maParam.bHasHeader) ++this.nRow;

    const isStringCell = (nR: SCROW): boolean => {
      const t = pCol.GetCellType(nR);
      return t === CELLTYPE_STRING || t === CELLTYPE_EDIT;
    };
    const getInputString = (aCell: ScRefCellValue, nR: SCROW): string => ScCellFormat.GetInputString(aCell, pCol.GetNumberFormat(nR));

    if (bFirstStringIgnore) {
      if (isStringCell(this.nRow)) {
        const aCell = pCol.GetCellValue(this.nRow);
        const aCellStr = getInputString(aCell, this.nRow);
        const nTmp = rCollator.compareString(aCellStr, rEntry.GetQueryItem().maString);
        if ((rEntry.eOp === ScQueryOp.SC_LESS_EQUAL && nTmp > 0) || (rEntry.eOp === ScQueryOp.SC_GREATER_EQUAL && nTmp < 0) || (rEntry.eOp === ScQueryOp.SC_EQUAL && nTmp !== 0)
          || (rEntry.eOp === ScQueryOp.SC_LESS && nTmp >= 0) || (rEntry.eOp === ScQueryOp.SC_GREATER && nTmp <= 0)) ++this.nRow;
      }
    }

    // Skip leading empty block, if any.
    let nStartRow: SCROW = this.nRow;
    if (!pCol.HasDataAt(nStartRow)) nStartRow = pCol.GetNextDataPos(nStartRow);

    if (bAllStringIgnore) {
      // Skip all leading string or empty blocks.
      while (nStartRow >= 0 && isStringCell(nStartRow)) nStartRow = pCol.GetNextDataPos(nStartRow);
    }

    if (nStartRow < 0) return false;
    this.nRow = nStartRow;
    if (this.nRow > this.maParam.nRow2) return false;

    // The NonEmptyCellIndexer: the non-empty cells of nRow..nRow2.
    const aIndexer = pCol.GetCellsInRange(this.nRow, this.maParam.nRow2);
    if (!aIndexer.aRows.length) return false;
    const getCell = (i: number): [ScRefCellValue, SCROW] => [new ScRefCellValue(aIndexer.aCells[i]), aIndexer.aRows[i]!];

    let nLo = 0;
    let nHi = aIndexer.aRows.length - 1;
    let aCellData: [ScRefCellValue, SCROW];

    // Bookkeeping values for breaking up the binary search in case the data
    // range isn't strictly sorted.
    let nLastInRange = nLo;
    let fLastInRangeValue = bAscending ? -Number.MAX_VALUE : Number.MAX_VALUE;
    let aLastInRangeString = '';
    if (!bAscending) aLastInRangeString = '￿';

    aCellData = getCell(nLastInRange);

    let aCell = aCellData[0];
    if (bForceStr || aCell.hasString()) aLastInRangeString = getInputString(aCell, aCellData[1]);
    else {
      switch (aCell.getType()) {
        case CELLTYPE_VALUE:
          fLastInRangeValue = aCell.getDouble();
          break;
        case CELLTYPE_FORMULA:
          fLastInRangeValue = aCell.getFormula()!.GetValue();
          break;
        default:
        // added to avoid warnings
      }
    }

    let nRes = 0;
    let found: number | null = null;
    let bDone = false;
    let orderBroken = false;
    while (nLo <= nHi && !bDone) {
      const nMid = Math.floor((nLo + nHi) / 2);
      const i = nMid;

      aCellData = getCell(i);
      aCell = aCellData[0];
      const bStr = bForceStr || aCell.hasString();
      nRes = 0;

      // compares are content<query:-1, content>query:1
      // Cell value comparison similar to ScTable::ValidQuery()
      if (!bStr && !bByString) {
        let nCellVal: number;
        switch (aCell.getType()) {
          case CELLTYPE_VALUE:
          case CELLTYPE_FORMULA:
            nCellVal = aCell.getValue();
            break;
          default:
            nCellVal = 0.0;
        }
        if (nCellVal < rItem.mfVal && !approxEqual(nCellVal, rItem.mfVal)) {
          nRes = -1;
          if (bAscending) {
            if (fLastInRangeValue <= nCellVal) {
              fLastInRangeValue = nCellVal;
              nLastInRange = i;
            } else if (fLastInRangeValue >= nCellVal) {
              // not strictly sorted, continue with GetThis()
              orderBroken = true;
              bDone = true;
            }
          }
        } else if (nCellVal > rItem.mfVal && !approxEqual(nCellVal, rItem.mfVal)) {
          nRes = 1;
          if (!bAscending) {
            if (fLastInRangeValue >= nCellVal) {
              fLastInRangeValue = nCellVal;
              nLastInRange = i;
            } else if (fLastInRangeValue <= nCellVal) {
              // not strictly sorted, continue with GetThis()
              orderBroken = true;
              bDone = true;
            }
          }
        }
      } else if (bStr && bByString) {
        const aCellStr = getInputString(aCell, aCellData[1]);

        nRes = rCollator.compareString(aCellStr, rEntry.GetQueryItem().maString);
        if (nRes < 0 && bAscending) {
          const nTmp = rCollator.compareString(aLastInRangeString, aCellStr);
          if (nTmp <= 0) {
            aLastInRangeString = aCellStr;
            nLastInRange = i;
          } else if (nTmp > 0) {
            // not strictly sorted, continue with GetThis()
            orderBroken = true;
            bDone = true;
          }
        } else if (nRes > 0 && !bAscending) {
          const nTmp = rCollator.compareString(aLastInRangeString, aCellStr);
          if (nTmp >= 0) {
            aLastInRangeString = aCellStr;
            nLastInRange = i;
          } else if (nTmp < 0) {
            // not strictly sorted, continue with GetThis()
            orderBroken = true;
            bDone = true;
          }
        }
      } else if (!bStr && bByString) {
        nRes = -1; // numeric < string
        if (bAscending) nLastInRange = i;
      } else {
        // if (bStr && !bByString)
        nRes = 1; // string > numeric
        if (!bAscending) nLastInRange = i;
      }
      if (nRes < 0) {
        if (bAscending) nLo = nMid + 1;
        else {
          // assumed to be SC_GREATER_EQUAL
          if (nMid > 0) nHi = nMid - 1;
          else bDone = true;
        }
      } else if (nRes > 0) {
        if (bAscending) {
          if (nMid > 0) nHi = nMid - 1;
          else bDone = true;
        } else nLo = nMid + 1; // assumed to be SC_GREATER_EQUAL
      } else {
        if (rEntry.eOp === ScQueryOp.SC_LESS_EQUAL || rEntry.eOp === ScQueryOp.SC_GREATER_EQUAL || rEntry.eOp === ScQueryOp.SC_EQUAL) {
          found = i;
          nLastInRange = i;
          nLo = nMid + 1;
        } else {
          if (nMid > 0) nHi = nMid - 1;
          else bDone = true;
        }
      }
    }

    let isInRange: boolean;
    if (orderBroken) {
      // Reset position to the first row in range and force caller
      // to search from start.
      nLo = 0;
      isInRange = false;
    } else if (found !== null) {
      nLo = found;
      isInRange = true;
    } else {
      // Not nothing was found and the search position is at the start,
      // then the possible match would need to be before the data range.
      // In that case return false to force the caller to search from the start
      // and detect this.
      isInRange = nLo !== 0;
      // If nothing was found, that is either because there is no value
      // that would match exactly, or the data range is not properly sorted
      // and we failed to detect (doing so reliably would require a linear scan).
      // Set the position to the last one that was in matching range (i.e. before
      // where the exact match would be), and leave sorting it out to GetThis()
      // or whatever the caller uses.
      nLo = nLastInRange;
    }

    if (nLo <= nHi && nLo < aIndexer.aRows.length && aIndexer.aRows[nLo]! <= this.maParam.nRow2) {
      this.nRow = aIndexer.aRows[nLo]!;
      this.maCurPos = { nRow: this.nRow, mbEnd: false };
      return isInRange;
    }
    this.nRow = this.maParam.nRow2 + 1;
    // Set current position to the last possible row.
    this.maCurPos = { nRow: this.rDoc.MaxRow(), mbEnd: false };
    return false;
  }

  /** If set, iterator stops on first non-matching cell content. May be used in SC_LESS_EQUAL
      queries where a cell range is assumed to be sorted; stops on first value being greater than
      the queried value and GetFirst()/GetNext() return NULL. StoppedOnMismatch() returns true
      then. However, the iterator's conditions are not set to end all queries, GetCol() and
      GetRow() return values for the non-matching cell, further GetNext() calls may be
      executed. */
  protected SetStopOnMismatch(bVal: boolean): void { this.nStopOnMismatch = bVal ? nStopOnMismatchEnabled : nStopOnMismatchDisabled; }
  protected StoppedOnMismatch(): boolean { return this.nStopOnMismatch === nStopOnMismatchExecuted; }

  /** If set, an additional test for SC_EQUAL condition is executed in ScTable::ValidQuery() if
      SC_LESS_EQUAL or SC_GREATER_EQUAL conditions are to be tested. May be used where a cell
      range is assumed to be sorted to stop if an equal match is found. */
  protected SetTestEqualCondition(bVal: boolean): void { this.nTestEqualCondition = bVal ? nTestEqualConditionEnabled : nTestEqualConditionDisabled; }
  protected IsEqualConditionFulfilled(): boolean { return this.nTestEqualCondition === nTestEqualConditionFulfilled; }

  protected HandleBestFitItemFound(nBFitCol: SCCOL, nBFitRow: SCROW): void {
    this.nBestFitCol = nBFitCol;
    this.nBestFitRow = nBFitRow;
  }

  // increments all Entry.nField, if column
  // changes, for ScInterpreter ScHLookup()
  SetAdvanceQueryParamEntryField(bVal: boolean): void { this.bAdvanceQuery = bVal; }

  SetSortedBinarySearchMode(nSearchMode: LookupSearchMode): void {
    this.nSortedBinarySearch = nSearchMode === LookupSearchMode.BinaryAscending ? nSearchbAscd : nSearchMode === LookupSearchMode.BinaryDescending ? nSearchbDesc : nBinarySearchDisabled;
  }

  SetLookupMode(nVal: number): void { this.nSearchOpCode = nVal; }

  GetCol(): SCCOL { return this.nCol; }
  GetRow(): SCROW { return this.nRow; }
}

/** The generic query iterator, used e.g. by VLOOKUP (ScQueryCellIterator< Direct >). */
export class ScQueryCellIterator extends ScQueryCellIteratorBase {
  constructor(rDocument: ScDocument, nTable: SCTAB, rParam: ScQueryParam, bMod: boolean, bReverse: boolean) {
    super(ScQueryCellIteratorType.Generic, rDocument, nTable, rParam, bMod, bReverse);
  }

  GetThis(): boolean {
    this.getThisResult = false;
    this.PerformQuery();
    return this.getThisResult;
  }

  /// Get first cell that matches the query
  GetFirst(): boolean {
    if (!this.mbReverseSearch) this.nCol = this.maParam.nCol1;
    else this.nCol = this.maParam.nCol2;
    this.InitPos();
    return this.GetThis();
  }

  GetNext(): boolean {
    if (!this.mbReverseSearch) this.IncPos();
    else this.DecPos();
    if (this.nStopOnMismatch) this.nStopOnMismatch = nStopOnMismatchEnabled;
    if (this.nTestEqualCondition) this.nTestEqualCondition = nTestEqualConditionEnabled;
    return this.GetThis();
  }

  /** In a range assumed to be sorted find either the last of a sequence of entries that are
      equal to the search value, or the last entry less than (greater than for descending) it.
      Returns the found column and row in nFoundCol/nFoundRow, or MaxCol()+1/MaxRow()+1 and
      false if there is none. */
  FindEqualOrSortedLastInRange(): { bFound: boolean; nFoundCol: SCCOL; nFoundRow: SCROW } {
    // Set and automatically reset mpParam->mbRangeLookup when returning.
    const bSaveRangeLookup = this.maParam.mbRangeLookup;
    this.maParam.mbRangeLookup = true;
    try {
      return this.FindEqualOrSortedLastInRangeImpl();
    } finally {
      this.maParam.mbRangeLookup = bSaveRangeLookup;
    }
  }

  private FindEqualOrSortedLastInRangeImpl(): { bFound: boolean; nFoundCol: SCCOL; nFoundRow: SCROW } {
    let nFoundCol = this.rDoc.MaxCol() + 1;
    let nFoundRow = this.rDoc.MaxRow() + 1;

    if ((this.nSearchOpCode === OC.ocXLookup || this.nSearchOpCode === OC.ocXMatch) && this.nSortedBinarySearch === nBinarySearchDisabled)
      this.SetStopOnMismatch(false); // assume not sorted keys for XLookup/XMatch
    else this.SetStopOnMismatch(true); // assume sorted keys

    this.SetTestEqualCondition(true);
    this.bIgnoreMismatchOnLeadingStrings = true;

    const bLiteral = this.maParam.eSearchType === SearchType.Normal && this.maParam.GetEntry(0).GetQueryItem().meType === ScQueryEntry.ByString;
    let bBinary = this.maParam.bByRow && (bLiteral || this.maParam.GetEntry(0).GetQueryItem().meType === ScQueryEntry.ByValue)
      && (this.maParam.GetEntry(0).eOp === ScQueryOp.SC_LESS_EQUAL || this.maParam.GetEntry(0).eOp === ScQueryOp.SC_GREATER_EQUAL);

    // assume not sorted properly if we are using XLookup/XMatch with forward or backward search
    if (bBinary && (this.nSearchOpCode === OC.ocXLookup || this.nSearchOpCode === OC.ocXMatch) && this.nSortedBinarySearch === nBinarySearchDisabled) bBinary = false;

    let bFound = false;
    if (bBinary) {
      if (this.BinarySearch(this.maParam.nCol1)) {
        // BinarySearch() already positions correctly and only needs real
        // query comparisons afterwards, skip the verification check below.
        this.maParam.mbRangeLookup = false;
        bFound = this.GetThis();
      } // Not sorted properly, or before the range (in which case GetFirst() will be simple).
      else bFound = this.GetFirst();
    } else bFound = this.GetFirst();
    if (bFound) {
      // First equal entry or last smaller than (greater than) entry.
      let aPosSave: PositionType;
      let bNext = false;
      const nEntries = this.maParam.GetEntryCount();
      const aFoundFieldPositions: SCCOLROW[] = new Array<SCCOLROW>(nEntries).fill(0);
      do {
        nFoundCol = this.GetCol();
        nFoundRow = this.GetRow();
        aPosSave = { ...this.maCurPos };
        // If we might need to rewind below, save the position to rewind to
        // rather than calculate it as a diff between nCol and nFoundCol as
        // PerformQuery can return early if nCol is greater than
        // maParam.nCol2 or AllocatedColumns
        if (this.maParam.mbRangeLookup && this.bAdvanceQuery) {
          for (let j = 0; j < nEntries; ++j) {
            const rEntry = this.maParam.GetEntry(j);
            if (rEntry.bDoQuery) aFoundFieldPositions[j] = this.maParam.GetEntry(j).nField;
            else break; // for
          }
        }
        if (this.IsEqualConditionFulfilled()) break;
        bNext = this.GetNext();
      } while (bNext);

      // There may be no pNext but equal condition fulfilled if regular
      // expressions are involved. Keep the found entry and proceed.
      if (!bNext && !this.IsEqualConditionFulfilled()) {
        // Step back to last in range and adjust position markers for
        // GetNumberFormat() or similar.
        const bColDiff = this.nCol !== nFoundCol;
        this.nCol = nFoundCol;
        this.nRow = nFoundRow;
        this.maCurPos = aPosSave;
        if (this.maParam.mbRangeLookup) {
          // Verify that the found entry does not only fulfill the range
          // lookup but also the real query, i.e. not numeric was found
          // if query is ByString and vice versa.
          this.maParam.mbRangeLookup = false;
          // Step back the last field advance if GetNext() did one.
          if (this.bAdvanceQuery && bColDiff) {
            for (let j = 0; j < nEntries; ++j) {
              const rEntry = this.maParam.GetEntry(j);
              if (rEntry.bDoQuery) rEntry.nField = aFoundFieldPositions[j]!;
              else break; // for
            }
          }
          // Check it.
          if (!this.GetThis()) {
            nFoundCol = this.rDoc.MaxCol() + 1;
            nFoundRow = this.rDoc.MaxRow() + 1;
          }
        }
      }
    }
    if (this.IsEqualConditionFulfilled() && this.nSearchOpCode !== OC.ocXLookup && this.nSearchOpCode !== OC.ocXMatch) {
      // Position on last equal entry, except for XLOOKUP,
      // which looking for the first equal entry
      const nEntries = this.maParam.GetEntryCount();
      for (let j = 0; j < nEntries; j++) {
        const rEntry = this.maParam.GetEntry(j);
        if (rEntry.bDoQuery) {
          switch (rEntry.eOp) {
            case ScQueryOp.SC_LESS_EQUAL:
            case ScQueryOp.SC_GREATER_EQUAL:
              rEntry.eOp = ScQueryOp.SC_EQUAL;
              break;
            default:
            // added to avoid warnings
          }
        } else break; // for
      }
      let aPosSave: PositionType;
      this.bIgnoreMismatchOnLeadingStrings = false;
      this.SetTestEqualCondition(false);
      do {
        nFoundCol = this.GetCol();
        nFoundRow = this.GetRow();
        aPosSave = { ...this.maCurPos };
      } while (this.GetNext());

      // Step back conditions are the same as above
      this.nCol = nFoundCol;
      this.nRow = nFoundRow;
      this.maCurPos = aPosSave;
      return { bFound: true, nFoundCol, nFoundRow };
    }
    if (this.maParam.eSearchType !== SearchType.Normal && this.StoppedOnMismatch()) {
      // Assume found entry to be the last value less than respectively
      // greater than the query. But keep on searching for an equal match.
      const nEntries = this.maParam.GetEntryCount();
      for (let j = 0; j < nEntries; j++) {
        const rEntry = this.maParam.GetEntry(j);
        if (rEntry.bDoQuery) {
          switch (rEntry.eOp) {
            case ScQueryOp.SC_LESS_EQUAL:
            case ScQueryOp.SC_GREATER_EQUAL:
              rEntry.eOp = ScQueryOp.SC_EQUAL;
              break;
            default:
            // added to avoid warnings
          }
        } else break; // for
      }
      this.SetStopOnMismatch(false);
      this.SetTestEqualCondition(false);
      if (this.GetNext()) {
        // Last of a consecutive area, avoid searching the entire parameter
        // range as it is a real performance bottleneck in case of regular
        // expressions.
        let aPosSave: PositionType;
        do {
          nFoundCol = this.GetCol();
          nFoundRow = this.GetRow();
          aPosSave = { ...this.maCurPos };
          this.SetStopOnMismatch(true);
        } while (this.GetNext());
        this.nCol = nFoundCol;
        this.nRow = nFoundRow;
        this.maCurPos = aPosSave;
      }
    }
    return { bFound: nFoundCol <= this.rDoc.MaxCol() && nFoundRow <= this.rDoc.MaxRow(), nFoundCol, nFoundRow };
  }
}

/** The COUNTIF iterator (ScCountIfCellIterator< Direct >). */
export class ScCountIfCellIterator extends ScQueryCellIteratorBase {
  constructor(rDocument: ScDocument, nTable: SCTAB, rParam: ScQueryParam, bMod: boolean, bReverse: boolean) {
    super(ScQueryCellIteratorType.CountIf, rDocument, nTable, rParam, bMod, bReverse);
  }

  GetCount(): number {
    // Keep Entry.nField in iterator on column change
    this.SetAdvanceQueryParamEntryField(true);
    const pTab = this.rDoc.FetchTable(this.nTab);
    if (!pTab) return 0;
    if (!this.maParam.GetEntry(0).GetQueryItem().mbMatchEmpty) {
      const nMaxCol = pTab.GetAllocatedColumnsCount() - 1;
      this.maParam.nCol1 = Math.min(this.maParam.nCol1, nMaxCol);
      this.maParam.nCol2 = Math.min(this.maParam.nCol2, nMaxCol);
    }
    this.nCol = this.maParam.nCol1;
    this.InitPos();
    this.countIfCount = 0;
    this.PerformQuery();
    return this.countIfCount;
  }
}

export { ScQueryCellIterator as ScQueryCellIteratorDirect, ScCountIfCellIterator as ScCountIfCellIteratorDirect };
