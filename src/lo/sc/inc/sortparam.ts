// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/sortparam.hxx reduced
// @upstream sc/source/core/data/sortparam.cxx reduced
// ScSortParam (what Data - Sort sorts: the range, header, direction, keys, case sensitivity,
// sort list), ScSortInfoArray (the keys and data rows being sorted) and sc::ReorderParam (a done
// sort, for undo and redo). Left out: sorting by colour (ScColorSortMode is kept but not
// evaluated), the collator locale and algorithm (the en-US collator is used), the SubTotals
// constructor, cell text attributes and draw objects of the sorted cells, and the
// natural sort ("embedded number behavior" other than alpha-numeric is accepted but sorts
// alpha-numerically).
import type { ScPostIt } from '../source/core/data/column.ts';
import { ScRange, type SCCOL, type SCCOLROW, type SCROW, type SCTAB } from './address.ts';
import type { ScRefCellValue } from './cellvalue.ts';
import type { ScPatternAttr } from './patattr.ts';
import type { ScQueryParam } from './queryparam.ts';

export const DEFSORT = 3;

const SCCOL_MAX = 0x7fff;
const SCROW_MAX = 0x7fffffff;

export const ScColorSortMode = { None: 0, TextColor: 1, BackgroundColor: 2 } as const;
export type ScColorSortMode = (typeof ScColorSortMode)[keyof typeof ScColorSortMode];

export interface ScSortKeyState {
  nField: SCCOLROW;
  bDoSort: boolean;
  bAscending: boolean;
  aColorSortMode: ScColorSortMode;
  aColorSortColor: string | null;
}

/** Struct to hold non-data extended area, used with ScDocument::ShrinkToUsedDataArea(). */
export class ScDataAreaExtras {
  /** If TRUE, consider the presence of cell notes besides data. */
  mbCellNotes = false;
  /** If TRUE, consider the presence of draw objects anchored to the cell. */
  mbCellDrawObjects = false;
  /** If TRUE, consider the presence of cell formats. */
  mbCellFormats = false;
  mnStartCol: SCCOL = SCCOL_MAX;
  mnStartRow: SCROW = SCROW_MAX;
  mnEndCol: SCCOL = -1;
  mnEndRow: SCROW = -1;

  clone(): ScDataAreaExtras { return Object.assign(new ScDataAreaExtras(), this); }
  anyExtrasWanted(): boolean { return this.mbCellNotes || this.mbCellDrawObjects || this.mbCellFormats; }
  resetArea(): void { this.mnStartCol = SCCOL_MAX; this.mnStartRow = SCROW_MAX; this.mnEndCol = -1; this.mnEndRow = -1; }
  equals(rOther: ScDataAreaExtras): boolean {
    // Ignore area range, this is used in ScSortParam::operator==().
    return this.mbCellNotes === rOther.mbCellNotes && this.mbCellDrawObjects === rOther.mbCellDrawObjects && this.mbCellFormats === rOther.mbCellFormats;
  }
}

/** Specifies how numbers embedded in text are treated in text comparisons. */
export const ScSortNumberBehavior = { ALPHA_NUMERIC: 0, DOUBLE: 1, INTEGER: 2 } as const;
export type ScSortNumberBehavior = (typeof ScSortNumberBehavior)[keyof typeof ScSortNumberBehavior];

export class ScSortParam {
  nCol1: SCCOL = 0;
  nRow1: SCROW = 0;
  nCol2: SCCOL = 0;
  nRow2: SCROW = 0;
  nSourceTab: SCTAB = 0;
  aDataAreaExtras = new ScDataAreaExtras();
  nUserIndex = 0;
  bHasHeader = false;
  bByRow = true;
  bCaseSens = false;
  eSortNumberBehavior: ScSortNumberBehavior = ScSortNumberBehavior.ALPHA_NUMERIC;
  bUserDef = false;
  bInplace = true;
  nDestTab: SCTAB = 0;
  nDestCol: SCCOL = 0;
  nDestRow: SCROW = 0;
  maKeyState: ScSortKeyState[] = [];
  /** css::lang::Locale's language; empty for the system collator. */
  aCollatorLocale = '';
  aCollatorAlgorithm = '';
  nCompatHeader = 2;

  /** A copy of r, the sort of a query's column nCol (TopTen), or the default parameter. */
  constructor(r?: ScSortParam | ScQueryParam, nCol?: SCCOL) {
    if (r instanceof ScSortParam) this.assign(r);
    else if (r) {
      // ScSortParam( const ScQueryParam& rParam, SCCOL nCol )
      const rParam = r;
      this.Clear();
      this.nCol1 = nCol!;
      this.nRow1 = rParam.nRow1;
      this.nCol2 = nCol!;
      this.nRow2 = rParam.nRow2;
      this.nSourceTab = rParam.nTab;
      this.nUserIndex = 0;
      this.bHasHeader = rParam.bHasHeader;
      this.bByRow = true;
      this.bCaseSens = rParam.bCaseSens;
      this.eSortNumberBehavior = ScSortNumberBehavior.ALPHA_NUMERIC;
      //TODO: what about Locale and Algorithm?
      this.bUserDef = false;
      this.bInplace = true;
      this.nDestTab = 0;
      this.nDestCol = 0;
      this.nDestRow = 0;
      this.nCompatHeader = 2;
      this.aDataAreaExtras = new ScDataAreaExtras();
      this.aDataAreaExtras.mbCellDrawObjects = true;

      this.maKeyState = [{ bDoSort: true, nField: nCol!, bAscending: true, aColorSortMode: ScColorSortMode.None, aColorSortColor: null }];

      // Set the rest
      for (let i = 1; i < DEFSORT; i++) this.maKeyState.push({ bDoSort: false, nField: 0, bAscending: true, aColorSortMode: ScColorSortMode.None, aColorSortColor: null });
    } else this.Clear();
  }

  clone(): ScSortParam { return new ScSortParam(this); }

  assign(r: ScSortParam): this {
    this.nCol1 = r.nCol1;
    this.nRow1 = r.nRow1;
    this.nCol2 = r.nCol2;
    this.nRow2 = r.nRow2;
    this.nSourceTab = r.nSourceTab;
    this.aDataAreaExtras = r.aDataAreaExtras.clone();
    this.nUserIndex = r.nUserIndex;
    this.bHasHeader = r.bHasHeader;
    this.bByRow = r.bByRow;
    this.bCaseSens = r.bCaseSens;
    this.eSortNumberBehavior = r.eSortNumberBehavior;
    this.bUserDef = r.bUserDef;
    this.bInplace = r.bInplace;
    this.nDestTab = r.nDestTab;
    this.nDestCol = r.nDestCol;
    this.nDestRow = r.nDestRow;
    this.maKeyState = r.maKeyState.map((k) => ({ ...k }));
    this.aCollatorLocale = r.aCollatorLocale;
    this.aCollatorAlgorithm = r.aCollatorAlgorithm;
    this.nCompatHeader = r.nCompatHeader;
    return this;
  }

  Clear(): void {
    this.nCol1 = this.nCol2 = this.nDestCol = 0;
    this.nRow1 = this.nRow2 = this.nDestRow = 0;
    this.nSourceTab = 0;
    this.aDataAreaExtras = new ScDataAreaExtras();
    this.aDataAreaExtras.mbCellDrawObjects = true;
    this.aDataAreaExtras.mbCellFormats = true;
    this.nCompatHeader = 2;
    this.nDestTab = 0;
    this.nUserIndex = 0;
    this.bHasHeader = this.bCaseSens = this.bUserDef = false;
    this.eSortNumberBehavior = ScSortNumberBehavior.ALPHA_NUMERIC;
    this.bByRow = this.bInplace = true;
    this.aCollatorLocale = '';
    this.aCollatorAlgorithm = '';
    // Initialize to default size
    this.maKeyState = [];
    for (let i = 0; i < DEFSORT; i++) this.maKeyState.push({ bDoSort: false, nField: 0, bAscending: true, aColorSortMode: ScColorSortMode.None, aColorSortColor: null });
  }

  equals(rOther: ScSortParam): boolean {
    let bEqual = false;
    // Number of Sorts the same?
    let nLast = 0;
    let nOtherLast = 0;
    const nSortSize = this.GetSortKeyCount();
    if (this.maKeyState.length) {
      while (this.maKeyState[nLast++]!.bDoSort && nLast < nSortSize);
      nLast--;
    }
    if (rOther.maKeyState.length) {
      while (rOther.maKeyState[nOtherLast++]!.bDoSort && nOtherLast < nSortSize);
      nOtherLast--;
    }
    if (nLast === nOtherLast && this.nCol1 === rOther.nCol1 && this.nRow1 === rOther.nRow1 && this.nCol2 === rOther.nCol2 && this.nRow2 === rOther.nRow2
      && this.nSourceTab === rOther.nSourceTab && this.aDataAreaExtras.equals(rOther.aDataAreaExtras) && this.bHasHeader === rOther.bHasHeader
      && this.bByRow === rOther.bByRow && this.bCaseSens === rOther.bCaseSens && this.eSortNumberBehavior === rOther.eSortNumberBehavior
      && this.bUserDef === rOther.bUserDef && this.nUserIndex === rOther.nUserIndex && this.bInplace === rOther.bInplace && this.nDestTab === rOther.nDestTab
      && this.nDestCol === rOther.nDestCol && this.nDestRow === rOther.nDestRow && this.aCollatorLocale === rOther.aCollatorLocale
      && this.aCollatorAlgorithm === rOther.aCollatorAlgorithm && (this.maKeyState.length > 0 || rOther.maKeyState.length > 0)) {
      bEqual = true;
      for (let i = 0; i <= nLast && bEqual; i++) bEqual = this.maKeyState[i]!.nField === rOther.maKeyState[i]!.nField && this.maKeyState[i]!.bAscending === rOther.maKeyState[i]!.bAscending;
    }
    if (!this.maKeyState.length && !rOther.maKeyState.length) bEqual = true;
    return bEqual;
  }

  MoveToDest(): void {
    if (!this.bInplace) {
      const nDifX = this.nDestCol - this.nCol1;
      const nDifY = this.nDestRow - this.nRow1;

      this.nCol1 = this.nCol1 + nDifX;
      this.nRow1 = this.nRow1 + nDifY;
      this.nCol2 = this.nCol2 + nDifX;
      this.nRow2 = this.nRow2 + nDifY;
      for (let i = 0; i < this.GetSortKeyCount(); i++) {
        if (this.bByRow) this.maKeyState[i]!.nField += nDifX;
        else this.maKeyState[i]!.nField += nDifY;
      }

      this.bInplace = true;
    }
    // else: MoveToDest, bInplace == TRUE
  }

  GetSortKeyCount(): number { return this.maKeyState.length; }
}

export interface ScSortInfo {
  maCell: ScRefCellValue;
  nOrg: SCCOLROW;
}

/** ScSortInfoArray::Cell */
export interface ScSortInfoArrayCell {
  maCell: ScRefCellValue;
  mpNote: ScPostIt | null;
  /** The cell's pattern, null when the column's pattern is uniform over the range. */
  maPattern: ScPatternAttr | null;
}
/** ScSortInfoArray::Row */
export interface ScSortInfoArrayRow {
  maCells: ScSortInfoArrayCell[];
  mbHidden: boolean;
  mbFiltered: boolean;
}
/** ScSortInfoArray::RowsType */
export type ScSortInfoArrayRowsType = ScSortInfoArrayRow[];

export class ScSortInfoArray {
  /** row-wise data table for sort by row operation. */
  private mpRows: ScSortInfoArrayRowsType | null = null;
  private mvppInfo: ScSortInfo[][];
  private nStart: SCCOLROW;
  /** index of last non-empty cell position. */
  private mnLastIndex: SCCOLROW;
  private maOrderIndices: SCCOLROW[] = [];
  private mbKeepQuery = false;
  private mbUpdateRefs = false;

  constructor(nSorts: number, nInd1: SCCOLROW, nInd2: SCCOLROW) {
    this.nStart = nInd1;
    this.mnLastIndex = nInd2;
    this.mvppInfo = [];
    const nCount = nInd2 - nInd1 + 1;
    for (let nSort = 0; nSort < nSorts; nSort++) this.mvppInfo.push(new Array<ScSortInfo>(nCount));
    for (let i = 0; i < nCount; ++i) this.maOrderIndices.push(i + this.nStart);
  }

  SetKeepQuery(b: boolean): void { this.mbKeepQuery = b; }
  IsKeepQuery(): boolean { return this.mbKeepQuery; }
  SetUpdateRefs(b: boolean): void { this.mbUpdateRefs = b; }
  IsUpdateRefs(): boolean { return this.mbUpdateRefs; }

  /** Call this only during normal sorting, not from reordering. */
  Get(nSort: number, nInd: SCCOLROW): ScSortInfo { return this.mvppInfo[nSort]![nInd - this.nStart]!; }
  Set(nSort: number, nInd: SCCOLROW, rInfo: ScSortInfo): void { this.mvppInfo[nSort]![nInd - this.nStart] = rInfo; }

  /** Call this only during normal sorting, not from reordering. */
  Swap(nInd1: SCCOLROW, nInd2: SCCOLROW): void {
    if (nInd1 === nInd2) return; // avoid self-move-assign
    const n1 = nInd1 - this.nStart;
    const n2 = nInd2 - this.nStart;
    for (const ppInfo of this.mvppInfo) [ppInfo[n1], ppInfo[n2]] = [ppInfo[n2]!, ppInfo[n1]!];
    [this.maOrderIndices[n1], this.maOrderIndices[n2]] = [this.maOrderIndices[n2]!, this.maOrderIndices[n1]!];
    if (this.mpRows) {
      // Swap rows in data table.
      const rRows = this.mpRows;
      [rRows[n1], rRows[n2]] = [rRows[n2]!, rRows[n1]!];
    }
  }

  SetOrderIndices(rIndices: SCCOLROW[]): void { this.maOrderIndices = rIndices; }

  /** @param rIndices indices are actual row positions on the sheet, not an offset from the top row. */
  ReorderByRow(rIndices: readonly SCCOLROW[]): void {
    if (!this.mpRows) return;
    const rRows = this.mpRows;
    const aOrderIndices2: SCCOLROW[] = [];
    const aRows2: ScSortInfoArrayRowsType = [];
    for (const rIndex of rIndices) {
      const nPos = rIndex - this.nStart; // switch to an offset to top row.
      aRows2.push(rRows[nPos]!);
      aOrderIndices2.push(this.maOrderIndices[nPos]!);
    }
    this.mpRows = aRows2;
    this.maOrderIndices = aOrderIndices2;
  }

  GetUsedSorts(): number { return this.mvppInfo.length; }
  GetStart(): SCCOLROW { return this.nStart; }
  GetLast(): SCCOLROW { return this.mnLastIndex; }
  GetOrderIndices(): readonly SCCOLROW[] { return this.maOrderIndices; }

  InitDataRows(nRowSize: number, nColSize: number): ScSortInfoArrayRowsType {
    this.mpRows = [];
    for (let i = 0; i < nRowSize; i++) {
      const maCells: ScSortInfoArrayCell[] = [];
      for (let j = 0; j < nColSize; j++) maCells.push({ maCell: undefined!, mpNote: null, maPattern: null });
      this.mpRows.push({ maCells, mbHidden: false, mbFiltered: false });
    }
    return this.mpRows;
  }

  GetDataRows(): ScSortInfoArrayRowsType | null { return this.mpRows; }
}

/** sc::ReorderParam */
export class ReorderParam {
  /** This sort range already takes into account the presence or absence of header row / column
      i.e. if a header row / column is present, it excludes that row / column. */
  maSortRange = new ScRange();
  maDataAreaExtras = new ScDataAreaExtras();
  /** List of original column / row positions after reordering. */
  maOrderIndices: SCCOLROW[] = [];
  mbByRow = false;
  mbHiddenFiltered = false;
  mbUpdateRefs = false;
  mbHasHeaders = false;

  clone(): ReorderParam {
    const r = new ReorderParam();
    r.maSortRange = this.maSortRange.clone();
    r.maDataAreaExtras = this.maDataAreaExtras.clone();
    r.maOrderIndices = [...this.maOrderIndices];
    r.mbByRow = this.mbByRow;
    r.mbHiddenFiltered = this.mbHiddenFiltered;
    r.mbUpdateRefs = this.mbUpdateRefs;
    r.mbHasHeaders = this.mbHasHeaders;
    return r;
  }

  /** Reorder the position indices such that it can be used to undo the original reordering. */
  reverse(): void {
    let nStart: SCCOLROW;
    if (this.mbByRow) nStart = this.maSortRange.aStart.Row();
    else nStart = this.maSortRange.aStart.Col();

    const n = this.maOrderIndices.length;
    const aBucket: { mnPos1: SCCOLROW; mnPos2: SCCOLROW }[] = [];
    for (let i = 0; i < n; ++i) {
      const nPos1 = i + nStart;
      const nPos2 = this.maOrderIndices[i]!;
      aBucket.push({ mnPos1: nPos1, mnPos2: nPos2 });
    }

    aBucket.sort((r1, r2) => r1.mnPos2 - r2.mnPos2); // ReorderIndex::LessByPos2
    this.maOrderIndices = aBucket.map((r) => r.mnPos1);
  }
}

