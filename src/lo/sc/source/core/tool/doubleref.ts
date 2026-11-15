// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/inc/doubleref.hxx faithful
// @upstream sc/source/core/tool/doubleref.cxx faithful
// The database range and query range of the database functions (DSUM, DCOUNT, ...): a range on a
// sheet (ScDBInternalRange) or a matrix (ScDBExternalRange). ScDocument::GetStringForFormula is a
// local function here (lcl_GetStringForFormula), and so is ScDocument::GetInputString
// (lcl_GetInputString): the port's ScColumn::GetInputString is the input line's string (the
// formula of a formula cell), upstream's is the cell's result. The STR_TABLE_AND/STR_TABLE_OR resources are
// their en-US texts.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { doubleToUString, rtl_math_DecimalPlaces_Max, rtl_math_StringFormat } from '../../../../sal/rtl/math.ts';
import { ScAddress, SCSIZE_MAX, type ScRange, type SCCOL, type SCROW, type SCSIZE, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../../inc/cellvalue.ts';
import { ScQueryConnect, ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry } from '../../../inc/queryentry.ts';
import { ScDBQueryParamInternal, ScDBQueryParamMatrix, type ScDBQueryParamBase, type ScQueryParamBase } from '../../../inc/queryparam.ts';
import { SearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import type { ScDocument } from '../data/document.ts';
import type { ScMatrix } from './scmatrix.ts';
import { ScCellFormat } from './cellform.ts';

const STR_TABLE_AND = 'AND';
const STR_TABLE_OR = 'OR';

/** ScGlobal::getCharClass().uppercase(rStr.trim()) */
function lcl_uppercase(rStr: string): string {
  return rStr.trim().toLocaleUpperCase('en-US');
}

/** ScDocument::GetStringForFormula: used in formulas, so it must use the same semantics as
    ScInterpreter::GetCellString: always format values as numbers. Returns the error code. */
function lcl_GetStringForFormula(rDoc: ScDocument, rPos: ScAddress): { nErr: FormulaError; rString: string } {
  const aCell = rDoc.GetRefCellValue(rPos);
  if (aCell.isEmpty()) return { nErr: FormulaError.NONE, rString: '' };

  let nErr: FormulaError = FormulaError.NONE;
  let aStr = '';
  const GetInputLineString = (fVal: number): string => doubleToUString(fVal, rtl_math_StringFormat.Automatic, rtl_math_DecimalPlaces_Max, '.', true);
  switch (aCell.getType()) {
    case CELLTYPE_STRING:
    case CELLTYPE_EDIT:
      aStr = aCell.getString();
      break;
    case CELLTYPE_FORMULA: {
      const pFCell = aCell.getFormula()!;
      nErr = pFCell.GetErrCode();
      if (pFCell.IsValue()) aStr = GetInputLineString(pFCell.GetValue());
      else aStr = pFCell.GetString();
      break;
    }
    case CELLTYPE_VALUE:
      aStr = GetInputLineString(aCell.getDouble());
      break;
    default:
  }
  return { nErr, rString: aStr };
}

/** ScDocument::GetInputString (ScCellFormat::GetInputString of the cell in its number format). */
function lcl_GetInputString(rDoc: ScDocument, nCol: SCCOL, nRow: SCROW, nTab: SCTAB): string {
  const pCol = rDoc.FetchTable(nTab)?.FetchColumn(nCol);
  if (!pCol) return '';
  return ScCellFormat.GetInputString(pCol.GetCellValue(nRow), pCol.GetNumberFormat(nRow), pCol.GetLanguage(nRow));
}

function lcl_createStarQuery(pDoc: ScDocument, pParam: ScQueryParamBase, pDBRef: ScDBRangeBase, pQueryRef: ScDBRangeBase): boolean {
  // A valid StarQuery must be at least 4 columns wide. To be precise it
  // should be exactly 4 columns ...
  // Additionally, if this wasn't checked, a formula pointing to a valid 1-3
  // column Excel style query range immediately left to itself would result
  // in a circular reference when the field name or operator or value (first
  // to third query range column) is obtained (#i58354#). Furthermore, if the
  // range wasn't sufficiently specified data changes wouldn't flag formula
  // cells for recalculation.

  if (pQueryRef.getColSize() < 4) return false;

  let bValid: boolean;
  let aCellStr: string;
  let nIndex = 0;
  let nRow = 0;
  const nRows = pDBRef.getRowSize();
  const nNewEntries = nRows;
  pParam.Resize(nNewEntries);

  do {
    const rEntry = pParam.GetEntry(nIndex);

    bValid = false;

    if (nIndex > 0) {
      // For all entries after the first one, check the and/or connector in the first column.
      aCellStr = pQueryRef.getString(0, nRow);
      aCellStr = lcl_uppercase(aCellStr);
      if (aCellStr === STR_TABLE_AND) {
        rEntry.eConnect = ScQueryConnect.SC_AND;
        bValid = true;
      } else if (aCellStr === STR_TABLE_OR) {
        rEntry.eConnect = ScQueryConnect.SC_OR;
        bValid = true;
      }
    }

    if (nIndex < 1 || bValid) {
      // field name in the 2nd column.
      aCellStr = pQueryRef.getString(1, nRow);
      const nField = pDBRef.findFieldColumn(aCellStr); // TODO: must be case insensitive comparison.
      if (pDoc.ValidCol(nField)) {
        rEntry.nField = nField;
        bValid = true;
      } else bValid = false;
    }

    if (bValid) {
      // equality, non-equality operator in the 3rd column.
      aCellStr = pQueryRef.getString(2, nRow);
      aCellStr = lcl_uppercase(aCellStr);
      const p = aCellStr;
      if (p[0] === '<') {
        if (p[1] === '>') rEntry.eOp = ScQueryOp.SC_NOT_EQUAL;
        else if (p[1] === '=') rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
        else rEntry.eOp = ScQueryOp.SC_LESS;
      } else if (p[0] === '>') {
        if (p[1] === '=') rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
        else rEntry.eOp = ScQueryOp.SC_GREATER;
      } else if (p[0] === '=') rEntry.eOp = ScQueryOp.SC_EQUAL;
    }

    if (bValid) {
      // Finally, the right-hand-side value in the 4th column.
      rEntry.GetQueryItem().maString = pQueryRef.getString(3, nRow);
      rEntry.bDoQuery = true;
    }
    nIndex++;
    nRow++;
  } while (bValid && nRow < nRows /* && (nIndex < MAXQUERY) */);
  return bValid;
}

function lcl_createExcelQuery(pDoc: ScDocument, pParam: ScQueryParamBase, pDBRef: ScDBRangeBase, pQueryRef: ScDBRangeBase): boolean {
  let bValid = true;
  const nCols = pQueryRef.getColSize();
  const nRows = pQueryRef.getRowSize();
  const aFields = new Array<SCCOL>(nCols).fill(0);
  let nCol = 0;
  while (bValid && nCol < nCols) {
    const aQueryStr = pQueryRef.getString(nCol, 0);
    const nField = pDBRef.findFieldColumn(aQueryStr);
    if (pDoc.ValidCol(nField)) aFields[nCol] = nField;
    else bValid = false;
    ++nCol;
  }

  if (bValid) {
    // Count the number of visible cells (excluding the header row).  Each
    // visible cell corresponds with a single query.
    let nVisible = pQueryRef.getVisibleDataCellCount();
    if (nVisible > SCSIZE_MAX / 8) {
      // too many filter criteria
      nVisible = 0;
    }

    const nNewEntries = nVisible;
    pParam.Resize(nNewEntries);

    let nIndex = 0;
    let nRow = 1;
    let aCellStr: string;
    while (nRow < nRows) {
      nCol = 0;
      while (nCol < nCols) {
        aCellStr = pQueryRef.getString(nCol, nRow);
        aCellStr = aCellStr.toLocaleUpperCase('en-US');
        if (aCellStr) {
          if (nIndex < nNewEntries) {
            pParam.GetEntry(nIndex).nField = aFields[nCol]!;
            pParam.FillInExcelSyntax(aCellStr, nIndex, false);
            nIndex++;
            if (nIndex < nNewEntries) pParam.GetEntry(nIndex).eConnect = ScQueryConnect.SC_AND;
          } else bValid = false;
        }
        nCol++;
      }
      nRow++;
      if (nIndex < nNewEntries) pParam.GetEntry(nIndex).eConnect = ScQueryConnect.SC_OR;
    }
  }
  return bValid;
}

function lcl_fillQueryEntries(pDoc: ScDocument, pParam: ScQueryParamBase, pDBRef: ScDBRangeBase, pQueryRef: ScDBRangeBase): boolean {
  let nCount = pParam.GetEntryCount();
  for (let i = 0; i < nCount; ++i) pParam.GetEntry(i).Clear();

  // Standard QueryTabelle
  let bValid = lcl_createStarQuery(pDoc, pParam, pDBRef, pQueryRef);
  // Excel QueryTabelle
  if (!bValid) bValid = lcl_createExcelQuery(pDoc, pParam, pDBRef, pQueryRef);

  nCount = pParam.GetEntryCount();
  if (bValid) {
    //  bQueryByString must be set
    for (let i = 0; i < nCount; ++i) pParam.GetEntry(i).GetQueryItem().meType = ScQueryEntry.ByString;
  } else {
    //  nothing
    for (let i = 0; i < nCount; ++i) pParam.GetEntry(i).Clear();
  }
  return bValid;
}

/** Base class for abstracting range data backends for database functions. */
export abstract class ScDBRangeBase {
  private mpDoc: ScDocument;

  constructor(pDoc: ScDocument) {
    this.mpDoc = pDoc;
  }

  abstract getColSize(): SCCOL;
  abstract getRowSize(): SCROW;
  abstract getVisibleDataCellCount(): SCSIZE;

  /** Get a string value of a specified cell position.  Note that the
      position of the upper left cell of the range is always (0, 0) even if
      the reference type is of internal range. */
  abstract getString(nCol: SCCOL, nRow: SCROW): string;

  abstract getFirstFieldColumn(): SCCOL;

  /** Get a <i>0-based</i> column index that corresponds with the passed field
      index (string or 1-based number). Note that the field index passed as
      a number is 1-based. With a string, pErr receives the error code of the field cell. */
  abstract findFieldColumn(nIndex: SCCOL | string, pErr?: { value: FormulaError } | null): SCCOL;

  abstract createQueryParam(pQueryRef: ScDBRangeBase): ScDBQueryParamBase | null;

  abstract isRangeEqual(rRange: ScRange): boolean;

  /** Populate query options that are always the same for all database queries. */
  protected static fillQueryOptions(pParam: ScQueryParamBase): void {
    pParam.bHasHeader = true;
    pParam.bByRow = true;
    pParam.bInplace = true;
    pParam.bCaseSens = false;
    pParam.eSearchType = SearchType.Normal;
    pParam.bDuplicate = true;
  }

  fillQueryEntries(pParam: ScQueryParamBase, pDBRef: ScDBRangeBase | null): boolean {
    if (!pDBRef) return false;

    return lcl_fillQueryEntries(this.getDoc(), pParam, pDBRef, this);
  }

  protected getDoc(): ScDocument { return this.mpDoc; }
}

export class ScDBInternalRange extends ScDBRangeBase {
  private maRange: ScRange;

  constructor(pDoc: ScDocument, rRange: ScRange) {
    super(pDoc);
    this.maRange = rRange.clone();
  }

  getRange(): ScRange { return this.maRange; }

  override getColSize(): SCCOL {
    return this.maRange.aEnd.Col() - this.maRange.aStart.Col() + 1;
  }

  override getRowSize(): SCROW {
    return this.maRange.aEnd.Row() - this.maRange.aStart.Row() + 1;
  }

  override getVisibleDataCellCount(): SCSIZE {
    const nCols = this.getColSize();
    const nRows = this.getRowSize();
    if (nRows <= 1) return 0;

    return (nRows - 1) * nCols;
  }

  override getString(nCol: SCCOL, nRow: SCROW): string {
    const s = this.maRange.aStart;
    // #i109200# this is used in formula calculation, use GetInputString, not GetString
    // (consistent with ScDBInternalRange::getCellString)
    // GetStringForFormula is not used here, to allow querying for date values.
    return lcl_GetInputString(this.getDoc(), s.Col() + nCol, s.Row() + nRow, this.maRange.aStart.Tab());
  }

  override getFirstFieldColumn(): SCCOL {
    return this.getRange().aStart.Col();
  }

  override findFieldColumn(nIndex: SCCOL | string, pErr: { value: FormulaError } | null = null): SCCOL {
    if (typeof nIndex === 'number') {
      const rRange = this.getRange();
      const s = rRange.aStart;

      const nDBCol1 = s.Col();

      // Don't handle out-of-bound condition here.  We'll do that later.
      return nIndex + nDBCol1 - 1;
    }

    const rStr = nIndex;
    const s = this.maRange.aStart;
    const e = this.maRange.aEnd;
    const aUpper = lcl_uppercase(rStr);

    const nDBCol1 = s.Col();
    const nDBRow1 = s.Row();
    const nDBTab1 = s.Tab();
    const nDBCol2 = e.Col();

    let bFound = false;

    let aCellStr: string;
    const aLook = new ScAddress(nDBCol1, nDBRow1, nDBTab1);
    while (!bFound && aLook.Col() <= nDBCol2) {
      const r = lcl_GetStringForFormula(this.getDoc(), aLook);
      aCellStr = r.rString;
      if (pErr) pErr.value = r.nErr;
      aCellStr = lcl_uppercase(aCellStr);
      // ScGlobal::GetTransliteration().isEqual: both are upper case already.
      bFound = aCellStr === aUpper;
      if (!bFound) aLook.IncCol();
    }
    const nField = aLook.Col();

    return bFound ? nField : -1;
  }

  override createQueryParam(pQueryRef: ScDBRangeBase): ScDBQueryParamBase | null {
    const pParam = new ScDBQueryParamInternal();

    // Set the database range first.
    const s = this.maRange.aStart;
    const e = this.maRange.aEnd;
    pParam.nCol1 = s.Col();
    pParam.nRow1 = s.Row();
    pParam.nCol2 = e.Col();
    pParam.nRow2 = e.Row();
    pParam.nTab = s.Tab();

    ScDBRangeBase.fillQueryOptions(pParam);

    // Now construct the query entries from the query range.
    if (!pQueryRef.fillQueryEntries(pParam, this)) return null;

    return pParam;
  }

  override isRangeEqual(rRange: ScRange): boolean {
    return this.maRange.equals(rRange);
  }
}

export class ScDBExternalRange extends ScDBRangeBase {
  private mpMatrix: ScMatrix;
  private mnCols: SCCOL;
  private mnRows: SCROW;

  constructor(pDoc: ScDocument, pMat: ScMatrix) {
    super(pDoc);
    this.mpMatrix = pMat;
    const { nC, nR } = this.mpMatrix.GetDimensions();
    this.mnCols = nC;
    this.mnRows = nR;
  }

  override getColSize(): SCCOL {
    return this.mnCols;
  }

  override getRowSize(): SCROW {
    return this.mnRows;
  }

  override getVisibleDataCellCount(): SCSIZE {
    const nCols = this.getColSize();
    const nRows = this.getRowSize();
    if (nRows <= 1) return 0;

    return (nRows - 1) * nCols;
  }

  override getString(nCol: SCCOL, nRow: SCROW): string {
    if (nCol >= this.mnCols || nRow >= this.mnRows) return '';

    return this.mpMatrix.GetString(nCol, nRow);
  }

  override getFirstFieldColumn(): SCCOL {
    return 0;
  }

  override findFieldColumn(nIndex: SCCOL | string, pErr: { value: FormulaError } | null = null): SCCOL {
    if (typeof nIndex === 'number') return nIndex - 1;

    if (pErr) pErr.value = FormulaError.NONE;

    const aUpper = lcl_uppercase(nIndex);
    for (let i = 0; i < this.mnCols; ++i) {
      let aUpperVal = this.mpMatrix.GetString(i, 0);
      aUpperVal = lcl_uppercase(aUpperVal);
      if (aUpper === aUpperVal) return i;
    }
    return -1;
  }

  override createQueryParam(pQueryRef: ScDBRangeBase): ScDBQueryParamBase | null {
    const pParam = new ScDBQueryParamMatrix();
    pParam.mpMatrix = this.mpMatrix;
    ScDBRangeBase.fillQueryOptions(pParam);

    // Now construct the query entries from the query range.
    if (!pQueryRef.fillQueryEntries(pParam, this)) return null;

    return pParam;
  }

  override isRangeEqual(_rRange: ScRange): boolean {
    return false;
  }
}
