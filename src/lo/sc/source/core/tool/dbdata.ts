// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/dbdata.hxx reduced
// @upstream sc/source/core/tool/dbdata.cxx reduced
// Database ranges (Data - Define Range): ScDBData, a named or anonymous range with its sort,
// filter (query) and subtotal parameters and the AutoFilter flag, and ScDBCollection, the
// document's named and global anonymous ranges. The sheet-local anonymous range (the one an
// AutoFilter or a sort on an unnamed area creates) lives at the sheet (ScTable::pDBDataNoName).
// Reduced: no import parameters (database import), no refresh timer, no table column names and
// attributes (structured references and table styles are not ported), no listening for header
// changes.
import { ScRange, SCSIZE_MAX, type SCCOL, type SCROW, type SCSIZE, type SCTAB } from '../../../inc/address.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScSortParam } from '../../../inc/sortparam.ts';
import { ScSubTotalParam } from '../../../inc/subtotalparam.ts';
import type { UpdateRefMode } from '../../../inc/refupdatecontext.ts';
import type { ScDocument } from '../data/document.ts';
import { ScRefUpdate, ScRefUpdateRes } from './refupdat.ts';

/** The name of the sheet-local anonymous database range (STR_DB_LOCAL_NONAME). */
export const STR_DB_LOCAL_NONAME = '__Anonymous_Sheet_DB__';
/** The name of the document global temporary anonymous range (STR_DB_GLOBAL_NONAME). */
export const STR_DB_GLOBAL_NONAME = '__Anonymous_DB__';

export const ScDBDataPortion = {
  TOP_LEFT: 0, ///< top left cell of area
  AREA: 1, ///< entire area
} as const;
export type ScDBDataPortion = (typeof ScDBDataPortion)[keyof typeof ScDBDataPortion];

export class ScDBData {
  private mpSortParam: ScSortParam;
  private mpQueryParam: ScQueryParam;
  private mpSubTotal: ScSubTotalParam;

  private readonly aName: string;
  private aUpper: string;
  private nTable: SCTAB;
  private nStartCol: SCCOL;
  private nStartRow: SCROW;
  private nEndCol: SCCOL;
  private nEndRow: SCROW;
  private bByRow: boolean;
  private bHasHeader: boolean;
  private bHasTotals: boolean;
  private bDoSize = false;
  private bKeepFmt = false;
  private bStripData = false;
  private bIsAdvanced = false; ///< true if created by advanced filter
  private aAdvSource = new ScRange(); ///< source range
  private bDBSelection = false; ///< not in Param: if selection, block update
  private nIndex = 0; ///< unique index formulas
  private bAutoFilter = false; ///< AutoFilter? (not saved)
  private bModified = false; ///< is set/cleared for/by(?) UpdateReference
  private nFilteredRowCount: SCSIZE = SCSIZE_MAX;

  /** A new range (rName, nTab, area, bByR, bHasH, bTotals), or a copy of rData under rName. */
  constructor(rName: string, nTab: SCTAB | ScDBData, nCol1 = 0, nRow1 = 0, nCol2 = 0, nRow2 = 0, bByR = true, bHasH = true, bTotals = false) {
    this.aName = rName;
    this.aUpper = rName.toUpperCase();
    if (nTab instanceof ScDBData) {
      const rData = nTab;
      this.mpSortParam = new ScSortParam(rData.mpSortParam);
      this.mpQueryParam = new ScQueryParam(rData.mpQueryParam);
      this.mpSubTotal = new ScSubTotalParam(rData.mpSubTotal);
      this.nTable = rData.nTable;
      this.nStartCol = rData.nStartCol;
      this.nStartRow = rData.nStartRow;
      this.nEndCol = rData.nEndCol;
      this.nEndRow = rData.nEndRow;
      this.bByRow = rData.bByRow;
      this.bHasHeader = rData.bHasHeader;
      this.bHasTotals = rData.bHasTotals;
      this.bDoSize = rData.bDoSize;
      this.bKeepFmt = rData.bKeepFmt;
      this.bStripData = rData.bStripData;
      this.bIsAdvanced = rData.bIsAdvanced;
      this.aAdvSource = rData.aAdvSource.clone();
      this.bDBSelection = rData.bDBSelection;
      this.nIndex = rData.nIndex;
      this.bAutoFilter = rData.bAutoFilter;
      this.bModified = rData.bModified;
      this.nFilteredRowCount = rData.nFilteredRowCount;
    } else {
      this.mpSortParam = new ScSortParam();
      this.mpQueryParam = new ScQueryParam();
      this.mpSubTotal = new ScSubTotalParam();
      this.nTable = nTab;
      this.nStartCol = nCol1;
      this.nStartRow = nRow1;
      this.nEndCol = nCol2;
      this.nEndRow = nRow2;
      this.bByRow = bByR;
      this.bHasHeader = bHasH;
      this.bHasTotals = bTotals;
    }
  }

  /** A copy under the same name (the copy constructor). */
  clone(): ScDBData { return new ScDBData(this.aName, this); }

  /** Take over the settings of rData, keeping the name (operator=). */
  assign(rData: ScDBData): this {
    this.mpSortParam = new ScSortParam(rData.mpSortParam);
    this.mpQueryParam = new ScQueryParam(rData.mpQueryParam);
    this.mpSubTotal = new ScSubTotalParam(rData.mpSubTotal);
    this.nTable = rData.nTable;
    this.nStartCol = rData.nStartCol;
    this.nStartRow = rData.nStartRow;
    this.nEndCol = rData.nEndCol;
    this.nEndRow = rData.nEndRow;
    this.bByRow = rData.bByRow;
    this.bHasHeader = rData.bHasHeader;
    this.bHasTotals = rData.bHasTotals;
    this.bDoSize = rData.bDoSize;
    this.bKeepFmt = rData.bKeepFmt;
    this.bStripData = rData.bStripData;
    this.bIsAdvanced = rData.bIsAdvanced;
    this.aAdvSource = rData.aAdvSource.clone();
    this.bDBSelection = rData.bDBSelection;
    this.nIndex = rData.nIndex;
    this.bAutoFilter = rData.bAutoFilter;
    this.nFilteredRowCount = rData.nFilteredRowCount;
    return this;
  }

  GetName(): string { return this.aName; }
  GetUpperName(): string { return this.aUpper; }
  GetTab(): SCTAB { return this.nTable; }

  /** The area: as a range, or its coordinates (GetArea(rTab, rCol1, …)). */
  GetArea(): ScRange {
    const nNewEndRow = this.nEndRow;
    return new ScRange(this.nStartCol, this.nStartRow, this.nTable, this.nEndCol, nNewEndRow, this.nTable);
  }
  GetAreaVars(): { nTab: SCTAB; nCol1: SCCOL; nRow1: SCROW; nCol2: SCCOL; nRow2: SCROW } {
    return { nTab: this.nTable, nCol1: this.nStartCol, nRow1: this.nStartRow, nCol2: this.nEndCol, nRow2: this.nEndRow };
  }

  /** Returns header row range if has headers, else invalid range. */
  GetHeaderArea(): ScRange {
    if (this.HasHeader()) return new ScRange(this.nStartCol, this.nStartRow, this.nTable, this.nEndCol, this.nStartRow, this.nTable);
    return ScRange.Invalid();
  }

  SetArea(nTab: SCTAB, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW): void {
    this.nTable = nTab;
    this.nStartCol = nCol1;
    this.nStartRow = nRow1;
    this.nEndCol = nCol2;
    this.nEndRow = nRow2;
  }

  MoveTo(nTab: SCTAB, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nUpdateCol = -1): void {
    const nDifX = nCol1 - this.nStartCol;
    const nDifY = nRow1 - this.nStartRow;

    const nSortDif = this.bByRow ? nDifX : nDifY;
    const nSortEnd = this.bByRow ? nCol2 : nRow2;

    for (let i = 0; i < this.mpSortParam.GetSortKeyCount(); i++) {
      const k = this.mpSortParam.maKeyState[i]!;
      k.nField += nSortDif;
      if (k.nField > nSortEnd) {
        k.nField = 0;
        k.bDoSort = false;
      }
    }

    const nCount = this.mpQueryParam.GetEntryCount();
    for (let i = 0; i < nCount; ++i) {
      const rEntry = this.mpQueryParam.GetEntry(i);
      rEntry.nField += nDifX;

      // tdf#48025, tdf#141946: update the column index of the filter criteria,
      // when the deleted/inserted columns are inside the data range
      if (nUpdateCol !== -1) {
        nUpdateCol += nDifX;
        const nDifX2 = nCol2 - this.nEndCol;
        if (rEntry.nField >= nUpdateCol) rEntry.nField += nDifX2;
        else if (rEntry.nField >= nUpdateCol + nDifX2) rEntry.Clear();
      }

      if (rEntry.nField > nCol2) {
        rEntry.nField = 0;
        rEntry.bDoQuery = false;
      }
    }
    for (const group of this.mpSubTotal.aGroups) {
      group.nField += nDifX;
      if (group.nField > nCol2) {
        group.nField = 0;
        group.bActive = false;
      }
    }

    this.SetArea(nTab, nCol1, nRow1, nCol2, nRow2);
  }

  SetByRow(bByR: boolean): void { this.bByRow = bByR; }
  HasHeader(): boolean { return this.bHasHeader; }
  SetHeader(bHasH: boolean): void { this.bHasHeader = bHasH; }
  HasTotals(): boolean { return this.bHasTotals; }
  SetTotals(bTotals: boolean): void { this.bHasTotals = bTotals; }
  SetIndex(nInd: number): void { this.nIndex = nInd; }
  GetIndex(): number { return this.nIndex; }
  IsDoSize(): boolean { return this.bDoSize; }
  SetDoSize(bSet: boolean): void { this.bDoSize = bSet; }
  IsKeepFmt(): boolean { return this.bKeepFmt; }
  SetKeepFmt(bSet: boolean): void { this.bKeepFmt = bSet; }
  IsStripData(): boolean { return this.bStripData; }
  SetStripData(bSet: boolean): void { this.bStripData = bSet; }

  GetSortParam(): ScSortParam {
    const rSortParam = new ScSortParam(this.mpSortParam);
    rSortParam.nCol1 = this.nStartCol;
    rSortParam.nRow1 = this.nStartRow;
    rSortParam.nCol2 = this.nEndCol;
    rSortParam.nRow2 = this.nEndRow;
    rSortParam.bByRow = this.bByRow;
    rSortParam.bHasHeader = this.bHasHeader;
    /* TODO: add Totals to ScSortParam? */
    return rSortParam;
  }

  SetSortParam(rSortParam: ScSortParam): void {
    this.mpSortParam = new ScSortParam(rSortParam);
    this.bByRow = rSortParam.bByRow;
  }

  /** Remember some more settings of ScSortParam, only to be called at
      anonymous DB ranges as it at least overwrites bHasHeader. */
  UpdateFromSortParam(rSortParam: ScSortParam): void {
    this.bHasHeader = rSortParam.bHasHeader;
  }

  GetQueryParam(): ScQueryParam {
    const rQueryParam = new ScQueryParam(this.mpQueryParam);
    rQueryParam.nCol1 = this.nStartCol;
    rQueryParam.nRow1 = this.nStartRow;
    rQueryParam.nCol2 = this.nEndCol;
    rQueryParam.nRow2 = this.nEndRow;
    rQueryParam.nTab = this.nTable;
    rQueryParam.bByRow = this.bByRow;
    rQueryParam.bHasHeader = this.bHasHeader;
    rQueryParam.bHasTotals = this.bHasTotals;
    return rQueryParam;
  }

  SetQueryParam(rQueryParam: ScQueryParam): void {
    this.mpQueryParam = new ScQueryParam(rQueryParam);

    //  set bIsAdvanced to false for everything that is not from the
    //  advanced filter dialog
    this.bIsAdvanced = false;
  }

  SetAdvancedQuerySource(pSource: ScRange | null): void {
    if (pSource) {
      this.aAdvSource = pSource.clone();
      this.bIsAdvanced = true;
    } else this.bIsAdvanced = false;
  }

  /** The advanced filter's criteria range, or null. */
  GetAdvancedQuerySource(): ScRange | null { return this.bIsAdvanced ? this.aAdvSource.clone() : null; }

  GetSubTotalParam(): ScSubTotalParam {
    const rSubTotalParam = new ScSubTotalParam(this.mpSubTotal);

    // Share the data range with the parent db data.  The range in the subtotal
    // param struct is not used.
    rSubTotalParam.nCol1 = this.nStartCol;
    rSubTotalParam.nRow1 = this.nStartRow;
    rSubTotalParam.nCol2 = this.nEndCol;
    rSubTotalParam.nRow2 = this.nEndRow;
    return rSubTotalParam;
  }

  SetSubTotalParam(rSubTotalParam: ScSubTotalParam): void {
    this.mpSubTotal = new ScSubTotalParam(rSubTotalParam);
  }

  IsDBAtCursor(nCol: SCCOL, nRow: SCROW, nTab: SCTAB, ePortion: ScDBDataPortion): boolean {
    if (nTab === this.nTable) {
      switch (ePortion) {
        case ScDBDataPortion.TOP_LEFT:
          return nCol === this.nStartCol && nRow === this.nStartRow;
        case ScDBDataPortion.AREA:
          return nCol >= this.nStartCol && nCol <= this.nEndCol && nRow >= this.nStartRow && nRow <= this.nEndRow;
      }
    }
    return false;
  }

  IsDBAtArea(nTab: SCTAB, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW): boolean {
    return nTab === this.nTable && nCol1 === this.nStartCol && nRow1 === this.nStartRow && nCol2 === this.nEndCol && nRow2 === this.nEndRow;
  }

  HasImportParam(): boolean { return false; }

  HasQueryParam(): boolean {
    if (!this.mpQueryParam) return false;
    if (!this.mpQueryParam.GetEntryCount()) return false;
    return this.mpQueryParam.GetEntry(0).bDoQuery;
  }

  HasSortParam(): boolean {
    return !!this.mpSortParam && this.mpSortParam.maKeyState.length > 0 && this.mpSortParam.maKeyState[0]!.bDoSort;
  }

  HasSubTotalParam(): boolean {
    return !!this.mpSubTotal && this.mpSubTotal.aGroups[0]!.bActive;
  }

  HasImportSelection(): boolean { return this.bDBSelection; }
  SetImportSelection(bSet: boolean): void { this.bDBSelection = bSet; }
  HasAutoFilter(): boolean { return this.bAutoFilter; }
  SetAutoFilter(bSet: boolean): void { this.bAutoFilter = bSet; }
  IsModified(): boolean { return this.bModified; }
  SetModified(bMod: boolean): void { this.bModified = bMod; }

  UpdateMoveTab(nOldPos: SCTAB, nNewPos: SCTAB): void {
    const aRange = this.GetArea();
    let nTab = aRange.aStart.Tab(); // a database range is only on one sheet

    //  customize as the current table as ScTablesHint (tabvwsh5.cxx)

    if (nTab === nOldPos) {
      // moved sheet
      nTab = nNewPos;
    } else if (nOldPos < nNewPos) {
      // moved to the back
      if (nTab > nOldPos && nTab <= nNewPos) {
        // move this sheet
        --nTab;
      }
    } else {
      // moved to the front
      if (nTab >= nNewPos && nTab < nOldPos) {
        // move this sheet
        ++nTab;
      }
    }

    const bChanged = nTab !== aRange.aStart.Tab();
    if (bChanged) {
      // SetArea() invalidates column names, but it is the same column range
      // just on a different sheet; remember and set new.
      this.MoveTo(nTab, aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row());
    }

    //  MoveTo() invalidates column names via SetArea(); adjust, remember and set new.
    this.SetModified(bChanged);
  }

  /** @returns true if the range became invalid (is to be deleted). */
  UpdateReference(rDoc: ScDocument, eUpdateRefMode: UpdateRefMode, nCol1: SCCOL, nRow1: SCROW, nTab1: SCTAB, nCol2: SCCOL, nRow2: SCROW, nTab2: SCTAB, nDx: SCCOL, nDy: SCROW, nDz: SCTAB): boolean {
    const a = this.GetAreaVars();
    const r = { theCol1: a.nCol1, theRow1: a.nRow1, theTab1: a.nTab, theCol2: a.nCol2, theRow2: a.nRow2, theTab2: a.nTab };
    const nOldCol1 = r.theCol1, nOldCol2 = r.theCol2;

    const eRet = ScRefUpdate.Update(rDoc, eUpdateRefMode, nCol1, nRow1, nTab1, nCol2, nRow2, nTab2, nDx, nDy, nDz, r);

    let bDoUpdate = eRet !== ScRefUpdateRes.UR_NOTHING;

    if (bDoUpdate && eRet !== ScRefUpdateRes.UR_INVALID) {
      // tdf#48025, tdf#141946: update the column index of the filter criteria,
      // when the deleted/inserted columns are inside the data range
      if (this.HasAutoFilter() && r.theCol1 - nOldCol1 !== r.theCol2 - nOldCol2) this.MoveTo(r.theTab1, r.theCol1, r.theRow1, r.theCol2, r.theRow2, nCol1);
      else this.MoveTo(r.theTab1, r.theCol1, r.theRow1, r.theCol2, r.theRow2);
    }

    const aRangeAdvSource = this.GetAdvancedQuerySource();
    if (aRangeAdvSource) {
      const s = { theCol1: aRangeAdvSource.aStart.Col(), theRow1: aRangeAdvSource.aStart.Row(), theTab1: aRangeAdvSource.aStart.Tab(), theCol2: aRangeAdvSource.aEnd.Col(), theRow2: aRangeAdvSource.aEnd.Row(), theTab2: aRangeAdvSource.aEnd.Tab() };
      if (ScRefUpdate.Update(rDoc, eUpdateRefMode, nCol1, nRow1, nTab1, nCol2, nRow2, nTab2, nDx, nDy, nDz, s)) {
        aRangeAdvSource.aStart.Set(s.theCol1, s.theRow1, s.theTab1);
        aRangeAdvSource.aEnd.Set(s.theCol2, s.theRow2, s.theTab2);
        this.SetAdvancedQuerySource(aRangeAdvSource);

        bDoUpdate = true; // DBData is modified
      }
    }

    this.SetModified(bDoUpdate);

    return eRet === ScRefUpdateRes.UR_INVALID;

    //TODO: check if something was deleted/inserted with-in the range !!!
  }

  /** Extend the DB area to include data rows immediately below. */
  ExtendDataArea(rDoc: ScDocument): void {
    const nOldEndRow = this.nEndRow;
    const r = rDoc.GetDataArea(this.nTable, this.nStartCol, this.nStartRow, this.nEndCol, this.nEndRow, false, true);
    this.nStartCol = r.nStartCol;
    this.nStartRow = r.nStartRow;
    this.nEndCol = r.nEndCol;
    this.nEndRow = r.nEndRow;
    // nOldEndRow==rDoc.MaxRow() may easily happen when selecting whole columns and
    // setting an AutoFilter (i.e. creating an anonymous database-range). We
    // certainly don't want to iterate over nearly a million empty cells, but
    // keep only an intentionally user selected range.
    if (nOldEndRow < rDoc.MaxRow() && this.nEndRow < nOldEndRow) this.nEndRow = nOldEndRow;
  }

  CalcSaveFilteredCount(nNonFilteredRowCount: SCSIZE): void {
    let nTotal = this.nEndRow - this.nStartRow + 1;
    if (this.bHasHeader) nTotal -= 1;
    this.nFilteredRowCount = nTotal - nNonFilteredRowCount;
  }

  /** The records shown and the records of the range (the status bar's "x of y records found"). */
  GetFilterSelCount(): { nSelected: SCSIZE; nTotal: SCSIZE } {
    let nTotal = this.nEndRow - this.nStartRow + 1;
    if (this.bHasHeader) nTotal -= 1;
    let nSelected: SCSIZE;
    if (this.nFilteredRowCount !== SCSIZE_MAX) nSelected = nTotal - this.nFilteredRowCount;
    else nSelected = this.nFilteredRowCount;
    return { nSelected, nTotal };
  }

  equals(rData: ScDBData): boolean {
    //  Data that is not in sort or query param
    if (this.nTable !== rData.nTable || this.bDoSize !== rData.bDoSize || this.bKeepFmt !== rData.bKeepFmt || this.bIsAdvanced !== rData.bIsAdvanced
      || this.bStripData !== rData.bStripData || this.bAutoFilter !== rData.bAutoFilter || this.bHasHeader !== rData.bHasHeader
      || this.nStartCol !== rData.nStartCol || this.nStartRow !== rData.nStartRow || this.nEndCol !== rData.nEndCol || this.nEndRow !== rData.nEndRow)
      return false;
    if (this.bIsAdvanced && !this.aAdvSource.equals(rData.aAdvSource)) return false;
    return this.GetSortParam().equals(rData.GetSortParam()) && this.mpSubTotal.equals(rData.mpSubTotal);
  }
}

/** The global named database ranges (ScDBCollection::NamedDBs), ordered by name. */
export class NamedDBs {
  private m_DBs: ScDBData[] = [];
  private mrParent: ScDBCollection;

  constructor(rParent: ScDBCollection, r?: NamedDBs) {
    this.mrParent = rParent;
    if (r) for (const it of r.m_DBs) this.insert(it.clone());
  }

  [Symbol.iterator](): Iterator<ScDBData> { return this.m_DBs[Symbol.iterator](); }

  private initInserted(p: ScDBData): void {
    p.SetIndex(this.mrParent.nEntryIndex++);
  }

  findByIndex(nIndex: number): ScDBData | null { return this.m_DBs.find((p) => p.GetIndex() === nIndex) ?? null; }
  findByUpperName(rName: string): ScDBData | null { return this.m_DBs.find((p) => p.GetUpperName() === rName) ?? null; }
  findByName(rName: string): ScDBData | null { return this.m_DBs.find((p) => p.GetName() === rName) ?? null; }

  /** Takes ownership of p and attempts to insert it into the collection.
      @return <TRUE/> if inserted, else <FALSE/> (duplicate name). */
  insert(pData: ScDBData): boolean {
    if (!pData.GetIndex()) this.initInserted(pData);
    if (this.findByUpperName(pData.GetUpperName())) return false;
    const i = this.m_DBs.findIndex((p) => p.GetUpperName() > pData.GetUpperName());
    if (i < 0) this.m_DBs.push(pData);
    else this.m_DBs.splice(i, 0, pData);
    return true;
  }

  erase(p: ScDBData): void {
    const i = this.m_DBs.indexOf(p);
    if (i >= 0) this.m_DBs.splice(i, 1);
  }

  empty(): boolean { return this.m_DBs.length === 0; }
  size(): number { return this.m_DBs.length; }
  /** The ranges as an array (for iteration with erasing). */
  list(): ScDBData[] { return [...this.m_DBs]; }
}

/** The global anonymous database ranges (ScDBCollection::AnonDBs). */
export class AnonDBs {
  private m_DBs: ScDBData[] = [];

  constructor(r?: AnonDBs) {
    if (r) this.m_DBs = r.m_DBs.map((p) => p.clone());
  }

  [Symbol.iterator](): Iterator<ScDBData> { return this.m_DBs[Symbol.iterator](); }

  findAtCursor(nCol: SCCOL, nRow: SCROW, nTab: SCTAB, ePortion: ScDBDataPortion): ScDBData | null {
    return this.m_DBs.find((p) => p.IsDBAtCursor(nCol, nRow, nTab, ePortion)) ?? null;
  }

  findByRange(rRange: ScRange): ScDBData | null {
    return this.m_DBs.find((p) => p.IsDBAtArea(rRange.aStart.Tab(), rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row())) ?? null;
  }

  deleteOnTab(nTab: SCTAB): void {
    this.m_DBs = this.m_DBs.filter((p) => p.GetArea().aStart.Tab() !== nTab);
  }

  getByRange(rRange: ScRange): ScDBData {
    let pData = this.findByRange(rRange);
    if (!pData) {
      // Insert a new db data.  They all have identical names.
      const bHasHeader = false;
      pData = new ScDBData(STR_DB_GLOBAL_NONAME, rRange.aStart.Tab(), rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), true, bHasHeader, false);
      this.m_DBs.push(pData);
    }
    return pData;
  }

  insert(p: ScDBData): void { this.m_DBs.push(p); }
  erase(p: ScDBData): void { this.m_DBs = this.m_DBs.filter((q) => q !== p); }
  empty(): boolean { return this.m_DBs.length === 0; }
  has(p: ScDBData): boolean { return this.m_DBs.includes(p); }
  list(): ScDBData[] { return [...this.m_DBs]; }
}

export class ScDBCollection {
  private rDoc: ScDocument;
  /** counter for unique indices */
  nEntryIndex = 1;
  private maNamedDBs: NamedDBs;
  private maAnonDBs: AnonDBs;

  constructor(rDocument: ScDocument, r?: ScDBCollection) {
    this.rDoc = rDocument;
    if (r) this.nEntryIndex = r.nEntryIndex;
    this.maNamedDBs = new NamedDBs(this, r?.maNamedDBs);
    this.maAnonDBs = new AnonDBs(r?.maAnonDBs);
  }

  clone(): ScDBCollection { return new ScDBCollection(this.rDoc, this); }

  getNamedDBs(): NamedDBs { return this.maNamedDBs; }
  getAnonDBs(): AnonDBs { return this.maAnonDBs; }

  GetDBAtCursor(nCol: SCCOL, nRow: SCROW, nTab: SCTAB, ePortion: ScDBDataPortion): ScDBData | null {
    // First, search the global named db ranges.
    for (const it of this.maNamedDBs) if (it.IsDBAtCursor(nCol, nRow, nTab, ePortion)) return it;

    // Check for the sheet-local anonymous db range.
    const pNoNameData = this.rDoc.GetAnonymousDBData(nTab);
    if (pNoNameData) if (pNoNameData.IsDBAtCursor(nCol, nRow, nTab, ePortion)) return pNoNameData;

    // Check the global anonymous db ranges.
    const pData = this.getAnonDBs().findAtCursor(nCol, nRow, nTab, ePortion);
    if (pData) return pData;

    // Do NOT check for the document global temporary anonymous db range here.

    return null;
  }

  GetDBAtArea(nTab: SCTAB, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW): ScDBData | null {
    // First, search the global named db ranges.
    const aRange = new ScRange(nCol1, nRow1, nTab, nCol2, nRow2, nTab);
    for (const it of this.maNamedDBs) if (it.IsDBAtArea(nTab, nCol1, nRow1, nCol2, nRow2)) return it;

    // Check for the sheet-local anonymous db range.
    let pNoNameData = this.rDoc.GetAnonymousDBData(nTab);
    if (pNoNameData) if (pNoNameData.IsDBAtArea(nTab, nCol1, nRow1, nCol2, nRow2)) return pNoNameData;

    // Lastly, check the global anonymous db ranges.
    const pData = this.getAnonDBs().findByRange(aRange);
    if (pData) return pData;

    // As a last resort, check for the document global temporary anonymous db range.
    pNoNameData = this.rDoc.GetAnonymousDBData();
    if (pNoNameData) if (pNoNameData.IsDBAtArea(nTab, nCol1, nRow1, nCol2, nRow2)) return pNoNameData;

    return null;
  }

  DeleteOnTab(nTab: SCTAB): void {
    for (const p of this.maNamedDBs.list()) if (p.GetArea().aStart.Tab() === nTab) this.maNamedDBs.erase(p);
    this.maAnonDBs.deleteOnTab(nTab);
  }

  UpdateReference(eUpdateRefMode: UpdateRefMode, nCol1: SCCOL, nRow1: SCROW, nTab1: SCTAB, nCol2: SCCOL, nRow2: SCROW, nTab2: SCTAB, nDx: SCCOL, nDy: SCROW, nDz: SCTAB): void {
    const pData = this.rDoc.GetAnonymousDBData(nTab1);
    if (pData) {
      if (nTab1 === nTab2 && nDz === 0) {
        // Delete the database range, if some part of the reference became invalid.
        if (pData.UpdateReference(this.rDoc, eUpdateRefMode, nCol1, nRow1, nTab1, nCol2, nRow2, nTab2, nDx, nDy, nDz)) this.rDoc.SetAnonymousDBData(nTab1, null);
      } else {
        //this will perhaps break undo
      }
    }

    for (const it of this.maNamedDBs.list()) {
      // Delete the database range, if some part of the reference became invalid.
      if (it.UpdateReference(this.rDoc, eUpdateRefMode, nCol1, nRow1, nTab1, nCol2, nRow2, nTab2, nDx, nDy, nDz)) this.maNamedDBs.erase(it);
    }
    for (const it of this.maAnonDBs.list()) {
      // Delete the database range, if some part of the reference became invalid.
      if (it.UpdateReference(this.rDoc, eUpdateRefMode, nCol1, nRow1, nTab1, nCol2, nRow2, nTab2, nDx, nDy, nDz)) this.maAnonDBs.erase(it);
    }
  }

  UpdateMoveTab(nOldPos: SCTAB, nNewPos: SCTAB): void {
    for (const p of this.maNamedDBs) p.UpdateMoveTab(nOldPos, nNewPos);
    for (const p of this.maAnonDBs) p.UpdateMoveTab(nOldPos, nNewPos);
  }

  GetDBNearCursor(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): ScDBData | null {
    let pNearData: ScDBData | null = null;
    for (const rxNamedDB of this.maNamedDBs) {
      const { nTab: nAreaTab, nCol1: nStartCol, nRow1: nStartRow, nCol2: nEndCol, nRow2: nEndRow } = rxNamedDB.GetAreaVars();
      if (nTab === nAreaTab && nCol + 1 >= nStartCol && nCol <= nEndCol + 1 && nRow + 1 >= nStartRow && nRow <= nEndRow + 1) {
        if (nCol < nStartCol || nCol > nEndCol || nRow < nStartRow || nRow > nEndRow) {
          if (!pNearData) pNearData = rxNamedDB; // remember first adjacent area
        } else return rxNamedDB; // not "unbenannt"/"unnamed" and cursor within
      }
    }
    if (pNearData) return pNearData; // adjacent, if no direct hit
    return this.rDoc.GetAnonymousDBData(nTab); // "unbenannt"/"unnamed" only if nothing else
  }

  GetAllDBsFromTab(nTab: SCTAB): ScDBData[] {
    const pTabData: ScDBData[] = [];
    for (const rxNamedDB of this.maNamedDBs) if (rxNamedDB.GetTab() === nTab) pTabData.push(rxNamedDB);
    const pAnonDBData = this.rDoc.GetAnonymousDBData(nTab);
    if (pAnonDBData) pTabData.push(pAnonDBData);
    return pTabData;
  }

  empty(): boolean { return this.maNamedDBs.empty() && this.maAnonDBs.empty(); }
}
