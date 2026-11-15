// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/queryparam.hxx partial
// @upstream sc/source/core/tool/queryparam.cxx partial
// ScQueryParamBase, ScQueryParamTable and ScQueryParam: the entries of a query and the range it
// applies to. Left out: the database query params (ScDBQueryParamBase, ScDBQueryParamInternal,
// ScDBQueryParamMatrix) and the move-to-destination helpers of the standard filter. The
// interpreter context of FillInExcelSyntax is a flag here: number recognition uses the en-US
// formatter.
import { IsNumberFormat } from '../../svl/source/numbers/zforlist.ts';
import { SearchType } from '../../unotools/source/i18n/textsearch.ts';
import { SCTAB_MAX, type SCCOL, type SCCOLROW, type SCROW, type SCSIZE, type SCTAB } from './address.ts';
import { ScQueryOp } from './global.ts';
import { ScQueryEntry } from './queryentry.ts';

const MAXQUERY = 8;

export class ScQueryParamBase {
  eSearchType: SearchType = SearchType.Normal;
  bHasHeader = true;
  bHasTotals = false;
  bByRow = true;
  bInplace = true;
  bCaseSens = false;
  bDuplicate = false;
  mbRangeLookup = false; ///< for spreadsheet functions like MATCH, LOOKUP, HLOOKUP, VLOOKUP

  protected m_Entries: ScQueryEntry[] = [];

  constructor() {
    for (let i = 0; i < MAXQUERY; i++) this.m_Entries.push(new ScQueryEntry());
  }

  protected assignBase(r: ScQueryParamBase): void {
    this.eSearchType = r.eSearchType;
    this.bHasHeader = r.bHasHeader;
    this.bHasTotals = r.bHasTotals;
    this.bByRow = r.bByRow;
    this.bInplace = r.bInplace;
    this.bCaseSens = r.bCaseSens;
    this.bDuplicate = r.bDuplicate;
    this.mbRangeLookup = r.mbRangeLookup;
    this.m_Entries = r.m_Entries.map((e) => e.clone());
  }

  IsValidFieldIndex(): boolean { return true; }

  GetEntryCount(): SCSIZE { return this.m_Entries.length; }

  GetEntry(n: SCSIZE): ScQueryEntry { return this.m_Entries[n]!; }

  /** The entries (begin()/end()). */
  [Symbol.iterator](): IterableIterator<ScQueryEntry> { return this.m_Entries[Symbol.iterator](); }

  AppendEntry(): ScQueryEntry {
    // Find the first unused entry.
    const itr = this.m_Entries.find((e) => !e.bDoQuery);

    if (itr)
      // Found!
      return itr;

    // Add a new entry to the end.
    const e = new ScQueryEntry();
    this.m_Entries.push(e);
    return e;
  }

  FindEntryByField(nField: SCCOLROW, bNew: boolean): ScQueryEntry | null {
    const itr = this.m_Entries.find((e) => e.bDoQuery && e.nField === nField);

    if (itr) {
      // existing entry found!
      return itr;
    }

    if (!bNew)
      // no existing entry found, and we are not creating a new one.
      return null;

    return this.AppendEntry();
  }

  FindAllEntriesByField(nField: SCCOLROW): ScQueryEntry[] {
    return this.m_Entries.filter((e) => e.bDoQuery && e.nField === nField);
  }

  RemoveEntryByField(nField: SCCOLROW): boolean {
    const i = this.m_Entries.findIndex((e) => e.bDoQuery && e.nField === nField);
    let bRet = false;

    if (i >= 0) {
      this.m_Entries.splice(i, 1);
      if (this.m_Entries.length < MAXQUERY)
        // Make sure that we have at least MAXQUERY number of entries at
        // all times.
        this.Resize(MAXQUERY);
      bRet = true;
    }

    return bRet;
  }

  RemoveAllEntriesByField(nField: SCCOLROW): void {
    while (this.RemoveEntryByField(nField)) {
      // nothing
    }
  }

  Resize(nNew: number): void {
    if (nNew < MAXQUERY) nNew = MAXQUERY; // never less than MAXQUERY

    if (nNew < this.m_Entries.length) this.m_Entries.length = nNew;
    while (this.m_Entries.length < nNew) this.m_Entries.push(new ScQueryEntry());
  }

  /** pContext is a flag here: true when called from the interpreter. */
  FillInExcelSyntax(rCellStr: string, nIndex: SCSIZE, pContext: boolean): void {
    if (nIndex >= this.m_Entries.length) this.Resize(nIndex + 1);

    const rEntry = this.GetEntry(nIndex);
    const rItem = rEntry.GetQueryItem();
    let bByEmpty = false;
    let bByNonEmpty = false;

    if (!rCellStr) rItem.maString = '';
    else {
      rEntry.bDoQuery = true;
      // Operatoren herausfiltern
      if (rCellStr[0] === '<') {
        if (rCellStr.length > 1 && rCellStr[1] === '>') {
          rItem.maString = rCellStr.slice(2);
          rEntry.eOp = ScQueryOp.SC_NOT_EQUAL;
          if (rCellStr.length === 2) bByNonEmpty = true;
        } else if (rCellStr.length > 1 && rCellStr[1] === '=') {
          rItem.maString = rCellStr.slice(2);
          rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
        } else {
          rItem.maString = rCellStr.slice(1);
          rEntry.eOp = ScQueryOp.SC_LESS;
        }
      } else if (rCellStr[0] === '>') {
        if (rCellStr.length > 1 && rCellStr[1] === '=') {
          rItem.maString = rCellStr.slice(2);
          rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
        } else {
          rItem.maString = rCellStr.slice(1);
          rEntry.eOp = ScQueryOp.SC_GREATER;
        }
      } else {
        if (rCellStr[0] === '=') {
          rItem.maString = rCellStr.slice(1);
          if (rCellStr.length === 1) bByEmpty = true;
        } else rItem.maString = rCellStr;
        rEntry.eOp = ScQueryOp.SC_EQUAL;
      }
    }

    if (!pContext) return;

    /* TODO: pContext currently is also used as a flag whether matching
     * empty cells with an empty string is triggered from the interpreter.
     * This could be handled independently if all queries should support
     * it, needs to be evaluated if that actually is desired. */

    // Interpreter queries have only one query, also QueryByEmpty and
    // QueryByNonEmpty rely on that.
    if (nIndex !== 0) return;

    // (empty = empty) is a match, and (empty <> not-empty) also is a
    // match. (empty = 0) is not a match.
    rItem.mbMatchEmpty = (rEntry.eOp === ScQueryOp.SC_EQUAL && !rItem.maString) || (rEntry.eOp === ScQueryOp.SC_NOT_EQUAL && !!rItem.maString);

    // SetQueryBy override item members with special values, so do this last.
    if (bByEmpty) rEntry.SetQueryByEmpty();
    else if (bByNonEmpty) rEntry.SetQueryByNonEmpty();
    else {
      const r = IsNumberFormat(rItem.maString, 'en-US');
      if (r) rItem.mfVal = r.value;
      rItem.meType = r ? ScQueryEntry.ByValue : ScQueryEntry.ByString;
    }
  }
}

export class ScQueryParamTable {
  nCol1: SCCOL = 0;
  nRow1: SCROW = 0;
  nCol2: SCCOL = 0;
  nRow2: SCROW = 0;
  nTab: SCTAB = 0;
}

/** ScQueryParam: ScQueryParamBase and ScQueryParamTable (multiple inheritance flattened). */
export class ScQueryParam extends ScQueryParamBase {
  nCol1: SCCOL = 0;
  nRow1: SCROW = 0;
  nCol2: SCCOL = 0;
  nRow2: SCROW = 0;
  nTab: SCTAB = 0;

  bDestPers = true; // not saved
  nDestTab: SCTAB = 0;
  nDestCol: SCCOL = 0;
  nDestRow: SCROW = 0;

  constructor(r?: ScQueryParam) {
    super();
    if (r) this.assign(r);
    else this.Clear();
  }

  clone(): ScQueryParam { return new ScQueryParam(this); }

  assign(r: ScQueryParam): this {
    this.assignBase(r);
    this.nCol1 = r.nCol1;
    this.nRow1 = r.nRow1;
    this.nCol2 = r.nCol2;
    this.nRow2 = r.nRow2;
    this.nTab = r.nTab;
    this.bDestPers = r.bDestPers;
    this.nDestTab = r.nDestTab;
    this.nDestCol = r.nDestCol;
    this.nDestRow = r.nDestRow;
    return this;
  }

  Clear(): void {
    this.nCol1 = this.nCol2 = 0;
    this.nRow1 = this.nRow2 = 0;
    this.nTab = SCTAB_MAX;
    this.eSearchType = SearchType.Normal;
    this.bHasHeader = this.bHasTotals = this.bCaseSens = false;
    this.bInplace = this.bByRow = this.bDuplicate = true;

    for (const itr of this.m_Entries) itr.Clear();

    this.ClearDestParams();
  }

  ClearDestParams(): void {
    this.bDestPers = true;
    this.nDestTab = 0;
    this.nDestCol = 0;
    this.nDestRow = 0;
  }
}
