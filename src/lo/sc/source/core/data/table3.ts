// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/data/table3.cxx partial
// Filtering (Query with TopTenQuery and PrepareQuery, the AutoFilter's column entries, the header
// detection HasColHeader) and sorting (ScTable::Sort, Reorder, CompareCell, QuickSort and the reordering of rows and
// columns). Kept: sorting by rows or by columns with several keys, ascending or descending, with
// a header, case-sensitive or not, by a sort list, with the cell formats and notes moving along,
// hidden and filtered rows kept with their data (bKeepQuery), and Reorder for undo and redo. As
// with "Update references when sorting range of cells" off (the default), moved formulas keep
// their relative references relative to their new position (references to other sheets are kept
// pointing to the same cells) and references from outside the range are not changed. Left out:
// the update-references mode (SortReorderByRowRefUpdate; bUpdateRefs is accepted but sorts as
// without it), sorting by colour, natural sort, the data area extras outside the data range
// (SortReorderAreaExtrasByRow/Column), draw objects, the shared formula groups, and the
// subtotal, query and filter functions of table3.cxx. Listening is re-established for the whole
// document after a reorder instead of collecting the affected listeners.
import { ScAddress, type SCCOL, type SCCOLROW, type SCROW, type SCSIZE, type SCTAB } from '../../../inc/address.ts';
import { ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry } from '../../../inc/queryentry.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import type { ScFilterEntries } from '../../../inc/filterentries.ts';
import { GetType as NFGetType, IsNumberFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScQueryEvaluator } from './queryevaluator.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue, type ScCellData } from '../../../inc/cellvalue.ts';
import { ReorderParam, ScSortInfoArray, ScSortParam, ScColorSortMode } from '../../../inc/sortparam.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { GetUserList } from '../tool/userlist.ts';
import type { ScPostIt } from './column.ts';
import { ScFormulaCell } from './formulacell.ts';
import { ScTable } from './table.ts';

declare module './table.ts' {
  interface ScTable {
    /** The sort parameters of the running sort (ScTable::aSortParam). */
    aSortParam: ScSortParam;
    /** The collator of the running sort (ScTable::pSortCollator). */
    pSortCollator: Intl.Collator | null;
    CreateSortInfoArray(rSortParam: ScSortParam | ReorderParam, nInd1?: SCCOLROW, nInd2?: SCCOLROW, bKeepQuery?: boolean, bUpdateRefs?: boolean): ScSortInfoArray;
    InitSortCollator(rPar: ScSortParam): void;
    DestroySortCollator(): void;
    SortReorderByColumn(pArray: ScSortInfoArray, nRow1: SCROW, nRow2: SCROW, bPattern: boolean): void;
    SortReorderByRow(pArray: ScSortInfoArray, nCol1: SCCOL, nCol2: SCCOL): void;
    CompareCell(nSort: number, rCell1: ScRefCellValue, nCell1Col: SCCOL, nCell1Row: SCROW, rCell2: ScRefCellValue, nCell2Col: SCCOL, nCell2Row: SCROW): number;
    CompareArray(pArray: ScSortInfoArray, nIndex1: SCCOLROW, nIndex2: SCCOLROW): number;
    QuickSort(pArray: ScSortInfoArray, nLo: SCCOLROW, nHi: SCCOLROW): void;
    Compare(nIndex1: SCCOLROW, nIndex2: SCCOLROW): number;
    IsSorted(nStart: SCCOLROW, nEnd: SCCOLROW): boolean;
    DecoladeRow(pArray: ScSortInfoArray, nRow1: SCROW, nRow2: SCROW): void;
    Sort(rSortParam: ScSortParam, bKeepQuery: boolean, bUpdateRefs: boolean, pUndo?: ReorderParam | null): void;
    Reorder(rParam: ReorderParam): void;
    TopTenQuery(rParam: ScQueryParam): void;
    PrepareQuery(rQueryParam: ScQueryParam): void;
    Query(rParamOrg: ScQueryParam, bKeepSub: boolean): SCSIZE;
    CopyData(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nDestCol: SCCOL, nDestRow: SCROW, nDestTab: SCTAB): void;
    RefVisible(pCell: ScFormulaCell): boolean;
    HasColHeader(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): boolean;
    HasRowHeader(nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): boolean;
    GetFilterEntries(nCol: SCCOL, nRow1: SCROW, nRow2: SCROW, rFilterEntries: ScFilterEntries, bFiltering: boolean): void;
    GetFilteredFilterEntries(nCol: SCCOL, nRow1: SCROW, nRow2: SCROW, rParam: ScQueryParam, rFilterEntries: ScFilterEntries, bFiltering: boolean): void;
  }
}

/** The data rows of the sort range: cells, notes, patterns and hidden/filtered flags. */
function initDataRows(rArray: ScSortInfoArray, rTab: ScTable, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, bHiddenFiltered: boolean, bPattern: boolean, bCellNotes: boolean): void {
  // Fill row-wise data table.
  const rRows = rArray.InitDataRows(nRow2 - nRow1 + 1, nCol2 - nCol1 + 1);

  for (let nCol = nCol1; nCol <= nCol2; ++nCol) {
    const rCol = rTab.CreateColumnIfNotExists(nCol);

    // Skip reordering of cell formats if the whole span is on the same pattern entry.
    const bUniformPattern = rCol.pAttrArray.CopyArea(nRow1, nRow2).length < 2;

    for (let nR = nRow1; nR <= nRow2; ++nR) {
      const nRow = nR;
      const rRow = rRows[nR - nRow1]!;
      const rCell = rRow.maCells[nCol - nCol1]!;
      rCell.maCell = rCol.GetCellValue(nRow);
      if (bCellNotes) rCell.mpNote = rCol.GetCellNote(nRow);

      if (!bUniformPattern && bPattern) rCell.maPattern = rCol.GetPattern(nRow);
    }
  }

  if (bHiddenFiltered) {
    for (let nRow = nRow1; nRow <= nRow2; ++nRow) {
      const rRow = rRows[nRow - nRow1]!;
      rRow.mbHidden = rTab.RowHidden(nRow);
      rRow.mbFiltered = rTab.RowFiltered(nRow);
    }
  }
}

ScTable.prototype.CreateSortInfoArray = function (this: ScTable, rParam: ScSortParam | ReorderParam, nInd1?: SCCOLROW, nInd2?: SCCOLROW, bKeepQuery = false, bUpdateRefs = false): ScSortInfoArray {
  let pArray: ScSortInfoArray;

  if (rParam instanceof ReorderParam) {
    if (rParam.mbByRow) {
      // Create a sort info array with just the data table.
      const nRow1 = rParam.maSortRange.aStart.Row();
      const nRow2 = rParam.maSortRange.aEnd.Row();
      const nCol1 = rParam.maSortRange.aStart.Col();
      const nCol2 = rParam.maSortRange.aEnd.Col();

      pArray = new ScSortInfoArray(0, nRow1, nRow2);
      pArray.SetKeepQuery(rParam.mbHiddenFiltered);
      pArray.SetUpdateRefs(rParam.mbUpdateRefs);

      this.CreateColumnIfNotExists(nCol2);
      initDataRows(pArray, this, nCol1, nRow1, nCol2, nRow2, rParam.mbHiddenFiltered, rParam.maDataAreaExtras.mbCellFormats, true);
    } else {
      const nCol1 = rParam.maSortRange.aStart.Col();
      const nCol2 = rParam.maSortRange.aEnd.Col();

      pArray = new ScSortInfoArray(0, nCol1, nCol2);
      pArray.SetKeepQuery(rParam.mbHiddenFiltered);
      pArray.SetUpdateRefs(rParam.mbUpdateRefs);
    }
    return pArray;
  }

  const rSortParam = rParam;
  let nUsedSorts = 1;
  while (nUsedSorts < rSortParam.GetSortKeyCount() && rSortParam.maKeyState[nUsedSorts]!.bDoSort) nUsedSorts++;
  pArray = new ScSortInfoArray(nUsedSorts, nInd1!, nInd2!);
  pArray.SetKeepQuery(bKeepQuery);
  pArray.SetUpdateRefs(bUpdateRefs);

  if (rSortParam.bByRow) {
    for (let nSort = 0; nSort < nUsedSorts; nSort++) {
      const nCol = rSortParam.maKeyState[nSort]!.nField;
      for (let nRow = nInd1!; nRow <= nInd2!; nRow++) pArray.Set(nSort, nRow, { maCell: this.GetCellValue(nCol, nRow), nOrg: nRow });
    }

    this.CreateColumnIfNotExists(rSortParam.nCol2);
    initDataRows(pArray, this, rSortParam.nCol1, nInd1!, rSortParam.nCol2, nInd2!, bKeepQuery, rSortParam.aDataAreaExtras.mbCellFormats, true);
  } else {
    for (let nSort = 0; nSort < nUsedSorts; nSort++) {
      const nRow = rSortParam.maKeyState[nSort]!.nField;
      for (let nCol = nInd1!; nCol <= nInd2!; nCol++) pArray.Set(nSort, nCol, { maCell: this.GetCellValue(nCol, nRow), nOrg: nCol });
    }
  }
  return pArray;
};

/** ScGlobal::GetCollator(bCaseSens): ICU's tertiary (case-sensitive, lower case first) or
    secondary strength collator of the UI locale. */
const aCaseCollator = new Intl.Collator('en-US', { sensitivity: 'variant', caseFirst: 'lower' });
const aCollator = new Intl.Collator('en-US', { sensitivity: 'accent' });

ScTable.prototype.InitSortCollator = function (this: ScTable, rPar: ScSortParam): void {
  if (rPar.aCollatorLocale) this.pSortCollator = new Intl.Collator(rPar.aCollatorLocale, rPar.bCaseSens ? { sensitivity: 'variant', caseFirst: 'lower' } : { sensitivity: 'accent' });
  else {
    // SYSTEM
    this.DestroySortCollator();
    this.pSortCollator = rPar.bCaseSens ? aCaseCollator : aCollator;
  }
};

ScTable.prototype.DestroySortCollator = function (this: ScTable): void {
  this.pSortCollator = null;
};

/** Move a column's cells, notes and (with bPattern) patterns of rows nRow1..nRow2. */
interface ColumnBlock { aRows: number[]; aCells: ScCellData[]; aNotes: Map<number, ScPostIt>; aPatterns: { nStart: number; nEnd: number; pPattern: ReturnType<ScTable['GetPattern']> }[] }

ScTable.prototype.SortReorderByColumn = function (this: ScTable, pArray: ScSortInfoArray, nRow1: SCROW, nRow2: SCROW, bPattern: boolean): void {
  const nStart = pArray.GetStart();
  const nLast = pArray.GetLast();
  const nTab = this.GetTab();

  const aIndices = [...pArray.GetOrderIndices()];
  const nCount = aIndices.length;

  // Take the blocks of all columns out, then put each where it belongs: column nStart+i gets
  // the block of column aIndices[i] (upstream swaps columns pairwise, which is the same).
  const aBlocks = new Map<number, ColumnBlock>();
  for (let nCol = nStart; nCol <= nLast; ++nCol) {
    const rCol = this.CreateColumnIfNotExists(nCol);
    const { aRows, aCells } = rCol.GetCellsInRange(nRow1, nRow2);
    const aNotes = new Map<number, ScPostIt>();
    for (const r of rCol.GetNoteRows()) if (r >= nRow1 && r <= nRow2) aNotes.set(r, rCol.GetCellNote(r)!);
    const aPatterns = bPattern ? rCol.pAttrArray.CopyArea(nRow1, nRow2) : [];
    aBlocks.set(nCol, { aRows, aCells, aNotes, aPatterns });
    for (const r of aRows) rCol.RemoveCellRaw(r);
    for (const r of aNotes.keys()) rCol.SetCellNote(r, null);
  }

  for (let i = 0; i < nCount; ++i) {
    const nDest = nStart + i;
    const nSrc = aIndices[i]!;
    const rBlock = aBlocks.get(nSrc)!;
    const rCol = this.CreateColumnIfNotExists(nDest);
    for (let k = 0; k < rBlock.aRows.length; k++) {
      const p = rBlock.aCells[k]!;
      rCol.SetCellRaw(rBlock.aRows[k]!, p);
      if (p instanceof ScFormulaCell && nSrc !== nDest) {
        // Reset formula cell positions which became out-of-sync after column reordering:
        // ensure that the references still point to the same locations after the position
        // change (ResetFormulaCellPositions without bUpdateRefs).
        const aOldPos = new ScAddress(nSrc, rBlock.aRows[k]!, nTab);
        p.GetCode().AdjustReferenceOnMovedOriginIfOtherSheet(aOldPos, p.aPos);
      }
    }
    for (const [r, n] of rBlock.aNotes) rCol.SetCellNote(r, n);
    if (bPattern) for (const e of rBlock.aPatterns) rCol.SetPatternArea(nRow1 + e.nStart, nRow1 + e.nEnd, e.pPattern);
  }

  // Notify the cells' listeners to (re-)start listening.
  const rDocument = this.GetDoc();
  rDocument.ClearListeners();
  rDocument.StartAllListeners();
};

ScTable.prototype.SortReorderByRow = function (this: ScTable, pArray: ScSortInfoArray, nCol1: SCCOL, nCol2: SCCOL): void {
  if (nCol2 < nCol1) return;

  const nRow1 = pArray.GetStart();
  const pRows = pArray.GetDataRows()!;
  const nTab = this.GetTab();

  // Cells in the data rows only reference values in the document. Make
  // a copy before updating the document.
  for (let j = 0; j < nCol2 - nCol1 + 1; j++) {
    const nThisCol = j + nCol1;
    const rCol = this.CreateColumnIfNotExists(nThisCol);
    const nRow2 = nRow1 + pRows.length - 1;
    // Detach the formula cells in the sorted range; the column's cells of the range are
    // replaced by the sorted ones (CellStoreType::transfer).
    for (const r of rCol.GetCellsInRange(nRow1, nRow2).aRows) rCol.RemoveCellRaw(r);
    for (const r of rCol.GetNoteRows()) if (r >= nRow1 && r <= nRow2) rCol.SetCellNote(r, null);

    for (let i = 0; i < pRows.length; ++i) {
      const nRow = nRow1 + i;
      const rCell = pRows[i]!.maCells[j]!;
      switch (rCell.maCell.getType()) {
        case CELLTYPE_STRING:
        case CELLTYPE_VALUE:
          rCol.SetCellRaw(nRow, rCell.maCell.getData()!);
          break;
        case CELLTYPE_EDIT:
          rCol.SetCellRaw(nRow, rCell.maCell.getEditText()!.Clone());
          break;
        case CELLTYPE_FORMULA: {
          const aOldPos = rCell.maCell.getFormula()!.aPos.clone();
          const aCellPos = new ScAddress(nCol1 + j, nRow, nTab);
          const pNew = rCell.maCell.getFormula()!.Clone(aCellPos);
          pNew.GetCode().AdjustReferenceOnMovedOriginIfOtherSheet(aOldPos, aCellPos);
          rCol.SetCellRaw(nRow, pNew);
          break;
        }
        default:
      }

      // The same with cell note instances ...
      if (rCell.mpNote) rCol.SetCellNote(nRow, rCell.mpNote);

      if (rCell.maPattern) rCol.SetPatternArea(nRow, nRow, rCell.maPattern);
    }
  }

  if (pArray.IsKeepQuery()) {
    const nRow2 = nRow1 + pRows.length - 1;
    // Remove all flags in the range first.
    this.SetRowHidden(nRow1, nRow2, false);
    this.SetRowFiltered(nRow1, nRow2, false);
    for (let i = 0; i < pRows.length; ++i) {
      if (pRows[i]!.mbHidden) this.SetRowHidden(nRow1 + i, nRow1 + i, true);
      if (pRows[i]!.mbFiltered) this.SetRowFiltered(nRow1 + i, nRow1 + i, true);
    }
  }

  // Notify the cells' listeners to (re-)start listening.
  const rDocument = this.GetDoc();
  rDocument.ClearListeners();
  rDocument.StartAllListeners();
};

ScTable.prototype.CompareCell = function (this: ScTable, nSort: number, rCell1: ScRefCellValue, nCell1Col: SCCOL, nCell1Row: SCROW, rCell2: ScRefCellValue, nCell2Col: SCCOL, nCell2Row: SCROW): number {
  let nRes = 0;
  const aSortParam = this.aSortParam;

  const eType1 = rCell1.getType();
  const eType2 = rCell2.getType();

  // (tdf#95520 Sort by color is left out: aColorSortMode is ignored.)
  void ScColorSortMode;

  if (!rCell1.isEmpty()) {
    if (!rCell2.isEmpty()) {
      let bErr1 = false;
      let bStr1 = eType1 !== CELLTYPE_VALUE;
      if (eType1 === CELLTYPE_FORMULA) {
        if (rCell1.getFormula()!.GetErrCode() !== FormulaError.NONE) {
          bErr1 = true;
          bStr1 = false;
        } else if (rCell1.getFormula()!.IsValue()) {
          bStr1 = false;
        }
      }

      let bErr2 = false;
      let bStr2 = eType2 !== CELLTYPE_VALUE;
      if (eType2 === CELLTYPE_FORMULA) {
        if (rCell2.getFormula()!.GetErrCode() !== FormulaError.NONE) {
          bErr2 = true;
          bStr2 = false;
        } else if (rCell2.getFormula()!.IsValue()) {
          bStr2 = false;
        }
      }

      if (bStr1 && bStr2) {
        // only compare strings as strings!
        let aStr1: string;
        let aStr2: string;
        if (eType1 === CELLTYPE_STRING) aStr1 = rCell1.getSharedString()!;
        else aStr1 = this.GetString(nCell1Col, nCell1Row);
        if (eType2 === CELLTYPE_STRING) aStr2 = rCell2.getSharedString()!;
        else aStr2 = this.GetString(nCell2Col, nCell2Row);

        const bUserDef = aSortParam.bUserDef; // custom sort order
        const bCaseSens = aSortParam.bCaseSens; // case sensitivity

        const rList = GetUserList();
        if (bUserDef && rList.size() > aSortParam.nUserIndex) {
          const rData = rList.at(aSortParam.nUserIndex);
          // (Natural sort is left out: all number behaviours compare alpha-numerically.)
          if (bCaseSens) nRes = rData.Compare(aStr1, aStr2);
          else nRes = rData.ICompare(aStr1, aStr2);
        }
        if (!bUserDef) nRes = Math.sign(this.pSortCollator!.compare(aStr1, aStr2));
      } else if (bStr1) {
        // String <-> Number or Error
        if (bErr2) nRes = -1; // String in front of Error
        else nRes = 1; // Number in front of String
      } else if (bStr2) {
        // Number or Error <-> String
        if (bErr1) nRes = 1; // String in front of Error
        else nRes = -1; // Number in front of String
      } else if (bErr1 && bErr2) {
        // nothing, two Errors are equal
      } else if (bErr1) {
        // Error <-> Number
        nRes = 1; // Number in front of Error
      } else if (bErr2) {
        // Number <-> Error
        nRes = -1; // Number in front of Error
      } else {
        // Mixed numbers
        const nVal1 = rCell1.getValue();
        const nVal2 = rCell2.getValue();
        if (nVal1 < nVal2) nRes = -1;
        else if (nVal1 > nVal2) nRes = 1;
      }
      if (!aSortParam.maKeyState[nSort]!.bAscending) nRes = -nRes;
    } else nRes = -1;
  } else {
    if (!rCell2.isEmpty()) nRes = 1;
    else nRes = 0; // both empty
  }
  return nRes;
};

/** ScTable::Compare(ScSortInfoArray*, nIndex1, nIndex2) */
ScTable.prototype.CompareArray = function (this: ScTable, pArray: ScSortInfoArray, nIndex1: SCCOLROW, nIndex2: SCCOLROW): number {
  let nRes: number;
  let nSort = 0;
  const aSortParam = this.aSortParam;
  do {
    const rInfo1 = pArray.Get(nSort, nIndex1);
    const rInfo2 = pArray.Get(nSort, nIndex2);
    if (aSortParam.bByRow)
      nRes = this.CompareCell(nSort, rInfo1.maCell, aSortParam.maKeyState[nSort]!.nField, rInfo1.nOrg, rInfo2.maCell, aSortParam.maKeyState[nSort]!.nField, rInfo2.nOrg);
    else nRes = this.CompareCell(nSort, rInfo1.maCell, rInfo1.nOrg, aSortParam.maKeyState[nSort]!.nField, rInfo2.maCell, rInfo2.nOrg, aSortParam.maKeyState[nSort]!.nField);
  } while (nRes === 0 && ++nSort < pArray.GetUsedSorts());
  if (nRes === 0) {
    const rInfo1 = pArray.Get(0, nIndex1);
    const rInfo2 = pArray.Get(0, nIndex2);
    if (rInfo1.nOrg < rInfo2.nOrg) nRes = -1;
    else if (rInfo1.nOrg > rInfo2.nOrg) nRes = 1;
  }
  return nRes;
};

ScTable.prototype.QuickSort = function (this: ScTable, pArray: ScSortInfoArray, nLo: SCCOLROW, nHi: SCCOLROW): void {
  if (nHi - nLo === 1) {
    if (this.CompareArray(pArray, nLo, nHi) > 0) pArray.Swap(nLo, nHi);
  } else {
    let ni = nLo;
    let nj = nHi;
    do {
      while (ni <= nHi && this.CompareArray(pArray, ni, nLo) < 0) ni++;
      while (nj >= nLo && this.CompareArray(pArray, nLo, nj) < 0) nj--;
      if (ni <= nj) {
        if (ni !== nj) pArray.Swap(ni, nj);
        ni++;
        nj--;
      }
    } while (ni < nj);
    if (nj - nLo < nHi - ni) {
      if (nLo < nj) this.QuickSort(pArray, nLo, nj);
      if (ni < nHi) this.QuickSort(pArray, ni, nHi);
    } else {
      if (ni < nHi) this.QuickSort(pArray, ni, nHi);
      if (nLo < nj) this.QuickSort(pArray, nLo, nj);
    }
  }
};

ScTable.prototype.Compare = function (this: ScTable, nIndex1: SCCOLROW, nIndex2: SCCOLROW): number {
  let nRes: number;
  let nSort = 0;
  const aSortParam = this.aSortParam;
  const nMaxSorts = aSortParam.GetSortKeyCount();
  if (aSortParam.bByRow) {
    do {
      const nCol = aSortParam.maKeyState[nSort]!.nField;
      nRes = 0;
      if (nCol < this.GetAllocatedColumnsCount()) {
        const aCell1 = this.GetCellValue(nCol, nIndex1);
        const aCell2 = this.GetCellValue(nCol, nIndex2);
        nRes = this.CompareCell(nSort, aCell1, nCol, nIndex1, aCell2, nCol, nIndex2);
      }
    } while (nRes === 0 && ++nSort < nMaxSorts && aSortParam.maKeyState[nSort]!.bDoSort);
  } else {
    do {
      const nRow = aSortParam.maKeyState[nSort]!.nField;
      let aCell1 = new ScRefCellValue();
      let aCell2 = new ScRefCellValue();
      if (nIndex1 < this.GetAllocatedColumnsCount()) aCell1 = this.GetCellValue(nIndex1, nRow);
      if (nIndex2 < this.GetAllocatedColumnsCount()) aCell2 = this.GetCellValue(nIndex2, nRow);
      nRes = this.CompareCell(nSort, aCell1, nIndex1, nRow, aCell2, nIndex2, nRow);
    } while (nRes === 0 && ++nSort < nMaxSorts && aSortParam.maKeyState[nSort]!.bDoSort);
  }
  return nRes;
};

ScTable.prototype.IsSorted = function (this: ScTable, nStart: SCCOLROW, nEnd: SCCOLROW): boolean {
  // over aSortParam
  for (let i = nStart; i < nEnd; i++) {
    if (this.Compare(i, i + 1) > 0) return false;
  }
  return true;
};

ScTable.prototype.DecoladeRow = function (this: ScTable, pArray: ScSortInfoArray, nRow1: SCROW, nRow2: SCROW): void {
  const nMax = nRow2 - nRow1;
  for (let i = nRow1; i + 4 <= nRow2; i += 4) {
    const nRow = Math.floor(Math.random() * nMax); // comphelper::rng::uniform_int_distribution(0, nMax-1)
    pArray.Swap(i, nRow1 + nRow);
  }
};

ScTable.prototype.Sort = function (this: ScTable, rSortParam: ScSortParam, bKeepQuery: boolean, bUpdateRefs: boolean, pUndo?: ReorderParam | null): void {
  // (The update-references mode is not ported: it sorts as without.)
  bUpdateRefs = false;
  this.InitSortCollator(rSortParam);

  if (pUndo) {
    // Copy over the basic sort parameters.
    pUndo.maDataAreaExtras = rSortParam.aDataAreaExtras.clone();
    pUndo.mbByRow = rSortParam.bByRow;
    pUndo.mbHiddenFiltered = bKeepQuery;
    pUndo.mbUpdateRefs = bUpdateRefs;
    pUndo.mbHasHeaders = rSortParam.bHasHeader;
  }

  // It is assumed that the data area has already been trimmed as necessary.

  this.aSortParam = rSortParam.clone(); // must be assigned before calling IsSorted()
  const nTab = this.GetTab();
  if (rSortParam.bByRow) {
    const nLastRow = rSortParam.nRow2;
    const nRow1 = rSortParam.bHasHeader ? rSortParam.nRow1 + 1 : rSortParam.nRow1;
    if (nRow1 < nLastRow && !this.IsSorted(nRow1, nLastRow)) {
      const pArray = this.CreateSortInfoArray(this.aSortParam, nRow1, nLastRow, bKeepQuery, bUpdateRefs);

      if (nLastRow - nRow1 > 255) this.DecoladeRow(pArray, nRow1, nLastRow);

      this.QuickSort(pArray, nRow1, nLastRow);
      this.SortReorderByRow(pArray, this.aSortParam.nCol1, this.aSortParam.nCol2);

      if (pUndo) {
        // Stored is the first data row without header row.
        pUndo.maSortRange.aStart.Set(rSortParam.nCol1, nRow1, nTab);
        pUndo.maSortRange.aEnd.Set(rSortParam.nCol2, nLastRow, nTab);
        pUndo.maDataAreaExtras.mnStartRow = nRow1;
        pUndo.maOrderIndices = [...pArray.GetOrderIndices()];
      }
    }
  } else {
    const nLastCol = rSortParam.nCol2;
    const nCol1 = rSortParam.bHasHeader ? rSortParam.nCol1 + 1 : rSortParam.nCol1;
    if (nCol1 < nLastCol && !this.IsSorted(nCol1, nLastCol)) {
      const pArray = this.CreateSortInfoArray(this.aSortParam, nCol1, nLastCol, bKeepQuery, bUpdateRefs);

      this.QuickSort(pArray, nCol1, nLastCol);
      this.SortReorderByColumn(pArray, rSortParam.nRow1, rSortParam.nRow2, rSortParam.aDataAreaExtras.mbCellFormats);

      if (pUndo) {
        // Stored is the first data column without header column.
        pUndo.maSortRange.aStart.Set(nCol1, this.aSortParam.nRow1, nTab);
        pUndo.maSortRange.aEnd.Set(nLastCol, this.aSortParam.nRow2, nTab);
        pUndo.maDataAreaExtras.mnStartCol = nCol1;
        pUndo.maOrderIndices = [...pArray.GetOrderIndices()];
      }
    }
  }
  this.DestroySortCollator();
};

ScTable.prototype.Reorder = function (this: ScTable, rParam: ReorderParam): void {
  if (!rParam.maOrderIndices.length) return;

  const pArray = this.CreateSortInfoArray(rParam);
  if (!pArray) return;

  if (rParam.mbByRow) {
    // Re-play sorting from the known sort indices.
    pArray.ReorderByRow(rParam.maOrderIndices);
    this.SortReorderByRow(pArray, rParam.maSortRange.aStart.Col(), rParam.maSortRange.aEnd.Col());
  } else {
    // Ordering by column is much simpler.  Just set the order indices and we are done.
    pArray.SetOrderIndices([...rParam.maOrderIndices]);
    this.SortReorderByColumn(pArray, rParam.maSortRange.aStart.Row(), rParam.maSortRange.aEnd.Row(), rParam.maDataAreaExtras.mbCellFormats);
  }
};


// --- filtering (TopTenQuery, PrepareQuery, Query, CreateQueryParam helpers, filter entries) ---

ScTable.prototype.TopTenQuery = function (this: ScTable, rParam: ScQueryParam): void {
  let bSortCollatorInitialized = false;
  const nEntryCount = rParam.GetEntryCount();
  const nRow1 = rParam.bHasHeader ? rParam.nRow1 + 1 : rParam.nRow1;
  const nCount = rParam.nRow2 - nRow1 + 1;
  for (let i = 0; i < nEntryCount && rParam.GetEntry(i).bDoQuery; i++) {
    const rEntry = rParam.GetEntry(i);
    const rItems = rEntry.GetQueryItems();

    for (const rItem of rItems) {
      switch (rEntry.eOp) {
        case ScQueryOp.SC_TOPVAL:
        case ScQueryOp.SC_BOTVAL:
        case ScQueryOp.SC_TOPPERC:
        case ScQueryOp.SC_BOTPERC: {
          const aLocalSortParam = new ScSortParam(rParam, rEntry.nField);
          this.aSortParam = aLocalSortParam; // used in CreateSortInfoArray, Compare
          if (!bSortCollatorInitialized) {
            bSortCollatorInitialized = true;
            this.InitSortCollator(aLocalSortParam);
          }
          const pArray = this.CreateSortInfoArray(this.aSortParam, nRow1, rParam.nRow2, false, false);
          this.DecoladeRow(pArray, nRow1, rParam.nRow2);
          this.QuickSort(pArray, nRow1, rParam.nRow2);
          const ppInfo = (n: number) => pArray.Get(0, nRow1 + n);
          let nValidCount = nCount;
          // Don't count note or blank cells, they are sorted to the end
          while (nValidCount > 0 && ppInfo(nValidCount - 1).maCell.isEmpty()) nValidCount--;
          // Don't count Strings, they are between Value and blank
          while (nValidCount > 0 && ppInfo(nValidCount - 1).maCell.hasString()) nValidCount--;
          if (nValidCount > 0) {
            if (rItem.meType === ScQueryEntry.ByString) {
              // by string ain't going to work
              rItem.meType = ScQueryEntry.ByValue;
              rItem.mfVal = 10; // 10 and 10% respectively
            }
            let nVal = rItem.mfVal >= 1 ? Math.trunc(rItem.mfVal) : 1;
            let nOffset = 0;
            switch (rEntry.eOp) {
              case ScQueryOp.SC_TOPVAL:
                rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
                if (nVal > nValidCount) nVal = nValidCount;
                nOffset = nValidCount - nVal; // 1 <= nVal <= nValidCount
                break;
              case ScQueryOp.SC_BOTVAL:
                rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
                if (nVal > nValidCount) nVal = nValidCount;
                nOffset = nVal - 1; // 1 <= nVal <= nValidCount
                break;
              case ScQueryOp.SC_TOPPERC:
                rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
                if (nVal > 100) nVal = 100;
                nOffset = nValidCount - Math.trunc((nValidCount * nVal) / 100);
                if (nOffset >= nValidCount) nOffset = nValidCount - 1;
                break;
              case ScQueryOp.SC_BOTPERC:
                rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
                if (nVal > 100) nVal = 100;
                nOffset = Math.trunc((nValidCount * nVal) / 100);
                if (nOffset >= nValidCount) nOffset = nValidCount - 1;
                break;
              default:
              // added to avoid warnings
            }
            const aCell = ppInfo(nOffset).maCell;
            if (aCell.hasNumeric()) rItem.mfVal = aCell.getValue();
            else {
              // TopTenQuery: pCell no ValueData
              rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
              rItem.mfVal = 0;
            }
          } else {
            rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
            rItem.meType = ScQueryEntry.ByValue;
            rItem.mfVal = 0;
          }
          break;
        }
        default:
        // added to avoid warnings
      }
    }
  }
  if (bSortCollatorInitialized) this.DestroySortCollator();
};

/** CanOptimizeQueryStringToNumber: query by value only for formats where no change of the value
    should occur (tdf#105629). */
function CanOptimizeQueryStringToNumber(nFormat: string): { bOk: boolean; bDateFormat: boolean } {
  switch (NFGetType(nFormat, 'en-US')) {
    case SvNumFormatType.NUMBER:
    case SvNumFormatType.SCIENTIFIC:
      return { bOk: true, bDateFormat: false };
    case SvNumFormatType.DATE:
    case SvNumFormatType.DATETIME:
      return { bOk: false, bDateFormat: true };
    default:
      return { bOk: false, bDateFormat: false };
  }
}

function lcl_PrepareQuery(pTab: ScTable, rParam: ScQueryParam, bRoundForFilter: boolean): void {
  let bTopTen = false;
  const nEntryCount = rParam.GetEntryCount();

  for (let i = 0; i < nEntryCount; ++i) {
    const rEntry = rParam.GetEntry(i);
    if (!rEntry.bDoQuery) continue;

    for (const rItem of rEntry.GetQueryItems()) {
      // PrepareQueryItem
      rItem.mbRoundForFilter = bRoundForFilter;
      if (rItem.meType !== ScQueryEntry.ByString && rItem.meType !== ScQueryEntry.ByDate) continue;

      const r = IsNumberFormat(rItem.maString, 'en-US');
      const bNumber = r !== null;
      if (r) rItem.mfVal = r.value;

      // Advanced Filter creates only ByString queries that need to be
      // converted to ByValue if appropriate. rItem.mfVal now holds the value
      // if bNumber==true.

      if (rItem.meType === ScQueryEntry.ByString) {
        let bDateFormat = false;
        if (bNumber) {
          const c = CanOptimizeQueryStringToNumber(r.code);
          bDateFormat = c.bDateFormat;
          if (c.bOk) rItem.meType = ScQueryEntry.ByValue;
        }
        if (!bDateFormat) continue;
      }

      // Double-check if the query by date is really appropriate.

      if (bNumber && r.code && !/^\s*General\s*$/i.test(r.code)) {
        const nNumFmtType = NFGetType(r.code, 'en-US');
        // (the port's format types are not flags: a date only format is DATE)
        if (nNumFmtType !== SvNumFormatType.DATE) rItem.meType = ScQueryEntry.ByValue; // not a date only
        else rItem.meType = ScQueryEntry.ByDate; // date only
      } else rItem.meType = ScQueryEntry.ByValue; // not a date
    }

    if (!bTopTen) {
      switch (rEntry.eOp) {
        case ScQueryOp.SC_TOPVAL:
        case ScQueryOp.SC_BOTVAL:
        case ScQueryOp.SC_TOPPERC:
        case ScQueryOp.SC_BOTPERC:
          bTopTen = true;
          break;
        default:
      }
    }
  }

  if (bTopTen) pTab.TopTenQuery(rParam);
}

ScTable.prototype.PrepareQuery = function (this: ScTable, rQueryParam: ScQueryParam): void {
  lcl_PrepareQuery(this, rQueryParam, false);
};

ScTable.prototype.Query = function (this: ScTable, rParamOrg: ScQueryParam, bKeepSub: boolean): SCSIZE {
  const aParam = new ScQueryParam(rParamOrg);
  const aStrSet = new Set<string>();

  let bStarted = false;
  let bOldResult = true;
  let nOldStart = 0;
  let nOldEnd = 0;

  let nCount = 0;
  let nOutRow = 0;
  const nHeader = aParam.bHasHeader ? 1 : 0;

  lcl_PrepareQuery(this, aParam, true);

  if (!aParam.bInplace) {
    nOutRow = aParam.nDestRow + nHeader;
    if (nHeader > 0) this.CopyData(aParam.nCol1, aParam.nRow1, aParam.nCol2, aParam.nRow1, aParam.nDestCol, aParam.nDestRow, aParam.nDestTab);
  }

  const queryEvaluator = new ScQueryEvaluator(this.GetDoc(), this, aParam);

  const nRealRow2 = aParam.nRow2;
  for (let j = aParam.nRow1 + nHeader; j <= nRealRow2; ++j) {
    let bResult: boolean; // Filter result
    let bValid = queryEvaluator.ValidQuery(j, null);
    if (!bValid && bKeepSub) {
      // Keep subtotals
      for (let nCol = aParam.nCol1; nCol <= aParam.nCol2 && !bValid; nCol++) {
        const aCell = this.GetCellValue(nCol, j);
        if (aCell.getType() !== CELLTYPE_FORMULA) continue;
        if (!aCell.getFormula()!.IsSubTotal()) continue;
        if (this.RefVisible(aCell.getFormula()!)) bValid = true;
      }
    }
    if (bValid) {
      if (aParam.bDuplicate) bResult = true;
      else {
        let aStr = '';
        for (let k = aParam.nCol1; k <= aParam.nCol2; k++) {
          const aCellStr = this.GetString(k, j);
          aStr += aCellStr + '\x01';
        }
        bResult = !aStrSet.has(aStr); // unique if inserted.
        aStrSet.add(aStr);
      }
    } else bResult = false;

    if (aParam.bInplace) {
      if (bResult === bOldResult && bStarted) nOldEnd = j;
      else {
        if (bStarted) this.DBShowRows(nOldStart, nOldEnd, bOldResult);
        nOldStart = nOldEnd = j;
        bOldResult = bResult;
      }
      bStarted = true;
    } else if (bResult) {
      this.CopyData(aParam.nCol1, j, aParam.nCol2, j, aParam.nDestCol, nOutRow, aParam.nDestTab);
      ++nOutRow;
    }
    if (bResult) ++nCount;
  }

  if (aParam.bInplace && bStarted) this.DBShowRows(nOldStart, nOldEnd, bOldResult);

  return nCount;
};

/** Copy cells with their patterns to another place (CopyData, table2.cxx); formulas keep their
    relative references. */
ScTable.prototype.CopyData = function (this: ScTable, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW, nDestCol: SCCOL, nDestRow: SCROW, nDestTab: SCTAB): void {
  const rDocument = this.GetDoc();
  let nDestY = nDestRow;
  for (let nRow = nStartRow; nRow <= nEndRow; nRow++) {
    let nDestX = nDestCol;
    for (let nCol = nStartCol; nCol <= nEndCol; nCol++) {
      const aDest = new ScAddress(nDestX, nDestY, nDestTab);
      const aCell = this.GetCellValue(nCol, nRow);
      if (aCell.getType() === CELLTYPE_FORMULA) rDocument.SetFormulaCell(aDest, aCell.getFormula()!.Clone(aDest));
      else rDocument.SetCellData(aDest, aCell.isEmpty() ? undefined : this.FetchColumn(nCol)!.GetCellData(nRow));
      rDocument.SetPatternAreaTab(nDestX, nDestY, nDestX, nDestY, nDestTab, this.GetPattern(nCol, nRow));
      ++nDestX;
    }
    ++nDestY;
  }
};

ScTable.prototype.RefVisible = function (this: ScTable, pCell: ScFormulaCell): boolean {
  const aRef = pCell.HasOneReference();
  if (aRef) {
    if (aRef.aStart.Col() === aRef.aEnd.Col() && aRef.aStart.Tab() === aRef.aEnd.Tab()) {
      const r = this.RowFilteredRange(aRef.aStart.Row());
      // row not filtered.
      const nEndRow = r.bFiltered ? r.nLastRow : Number.MAX_SAFE_INTEGER;
      if (!this.GetDoc().ValidRow(nEndRow) || nEndRow < aRef.aEnd.Row()) return true; // at least partly visible
      return false; // not visible
    }
  }
  return true; // somehow different
};

ScTable.prototype.HasColHeader = function (this: ScTable, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): boolean {
  if (nStartRow === nEndRow)
    // Assume only data.
    /* XXX NOTE: previous behavior still checked this one row and could
     * evaluate it has header row, but that doesn't make much sense. */
    return false;

  for (let nCol = nStartCol; nCol <= nEndCol; nCol++) {
    const eType = this.GetCellType(nCol, nStartRow);
    // Any non-text cell in first row => not headers.
    if (eType !== CELLTYPE_STRING && eType !== CELLTYPE_EDIT) return false;
  }

  // First row all text cells, any non-text cell in second row => headers.
  const nTestRow = nStartRow + 1;
  for (let nCol = nStartCol; nCol <= nEndCol; nCol++) {
    const eType = this.GetCellType(nCol, nTestRow);
    if (eType !== CELLTYPE_STRING && eType !== CELLTYPE_EDIT) return true;
  }

  // Also second row all text cells => first row not headers.
  return false;
};

ScTable.prototype.HasRowHeader = function (this: ScTable, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): boolean {
  if (nStartCol === nEndCol)
    // Assume only data.
    return false;

  for (let nRow = nStartRow; nRow <= nEndRow; nRow++) {
    const eType = this.GetCellType(nStartCol, nRow);
    // Any non-text cell in first column => not headers.
    if (eType !== CELLTYPE_STRING && eType !== CELLTYPE_EDIT) return false;
  }

  // First column all text cells, any non-text cell in second column => headers.
  const nTestCol = nStartCol + 1;
  for (let nRow = nStartRow; nRow <= nEndRow; nRow++) {
    const eType = this.GetCellType(nTestCol, nRow);
    if (eType !== CELLTYPE_STRING && eType !== CELLTYPE_EDIT) return true;
  }

  // Also second column all text cells => first column not headers.
  return false;
};

ScTable.prototype.GetFilterEntries = function (this: ScTable, nCol: SCCOL, nRow1: SCROW, nRow2: SCROW, rFilterEntries: ScFilterEntries, bFiltering: boolean): void {
  this.CreateColumnIfNotExists(nCol).GetFilterEntries(nRow1, nRow2, rFilterEntries, bFiltering, false /*bFilteredRow*/);
};

ScTable.prototype.GetFilteredFilterEntries = function (this: ScTable, nCol: SCCOL, nRow1: SCROW, nRow2: SCROW, rParam: ScQueryParam, rFilterEntries: ScFilterEntries, bFiltering: boolean): void {
  const pCol = this.CreateColumnIfNotExists(nCol);

  // remove the entry for this column from the query parameter
  const aParam = new ScQueryParam(rParam);
  aParam.RemoveEntryByField(nCol);

  lcl_PrepareQuery(this, aParam, true);
  const queryEvaluator = new ScQueryEvaluator(this.GetDoc(), this, aParam);
  for (let j = nRow1; j <= nRow2; ++j) {
    if (queryEvaluator.ValidQuery(j)) pCol.GetFilterEntries(j, j, rFilterEntries, bFiltering, false /*bFilteredRow*/);
    else pCol.GetFilterEntries(j, j, rFilterEntries, bFiltering, true /*bFilteredRow*/);
  }
};
