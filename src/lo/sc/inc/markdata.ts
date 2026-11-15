// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/markdata.hxx reduced
// @upstream sc/source/core/data/markdata.cxx reduced
// ScMarkData: the selection of a view: a simple marked range, a multi-selection (kept as a range
// list instead of upstream's per-column ScMultiSel mark arrays), the selected sheets, and the
// negative marking used for deselecting.
import { ScAddress, ScRange, type SCCOL, type SCROW, type SCTAB } from './address.ts';
import { ScRangeList } from './rangelst.ts';
import type { ScSheetLimits } from './sheetlimits.ts';

export class ScMarkData {
  private maTabMarked = new Set<SCTAB>();
  private aMarkRange: ScRange; // area
  private aMultiRange: ScRange; // maximum area altogether
  private maMulti = new ScRangeList(); // multi-selection
  private readonly mrSheetLimits: ScSheetLimits;
  private bMarked = false; // rectangle marked
  private bMultiMarked = false;
  private bMarking = false; // area is being marked -> no MarkToMulti
  private bMarkIsNeg = false; // cancel if multi selection

  constructor(rSheetLimits: ScSheetLimits, rList?: ScRangeList) {
    this.mrSheetLimits = rSheetLimits;
    this.aMarkRange = ScRange.Invalid();
    this.aMultiRange = ScRange.Invalid();
    if (rList) {
      for (const r of rList) this.maTabMarked.add(r.aStart.Tab());
      if (rList.size() > 1) {
        this.bMultiMarked = true;
        this.aMultiRange = rList.Combine();
        this.maMulti = rList.clone();
      } else if (rList.size() === 1) {
        const rRange = rList.at(0);
        this.SetMarkArea(rRange);
      }
    }
  }

  clone(): ScMarkData {
    const r = new ScMarkData(this.mrSheetLimits);
    r.maTabMarked = new Set(this.maTabMarked);
    r.aMarkRange = this.aMarkRange.clone();
    r.aMultiRange = this.aMultiRange.clone();
    r.maMulti = this.maMulti.clone();
    r.bMarked = this.bMarked; r.bMultiMarked = this.bMultiMarked; r.bMarking = this.bMarking; r.bMarkIsNeg = this.bMarkIsNeg;
    return r;
  }

  ResetMark(): void {
    this.maMulti = new ScRangeList();
    this.bMarked = this.bMultiMarked = false;
    this.bMarking = this.bMarkIsNeg = false;
    this.aMarkRange = ScRange.Invalid();
    this.aMultiRange = ScRange.Invalid();
  }

  SetMarkArea(rRange: ScRange): void {
    this.aMarkRange = rRange.clone();
    this.aMarkRange.PutInOrder();
    if (!this.bMarked) {
      // Upon creation of a document ScFormatShell GetTextAttrState
      // may query (default) attributes although no sheet is marked yet.
      // => mark that one.
      if (!this.GetSelectCount()) this.maTabMarked.add(this.aMarkRange.aStart.Tab());
      this.bMarked = true;
    }
  }

  SetMultiMarkArea(rRange: ScRange, bMark = true, bSetupMulti = false): void {
    if (this.aMultiRange.IsValid() === false || !this.bMultiMarked) {
      this.maMulti = new ScRangeList();
      // if simple mark range is set, copy to multi marks
      if (this.bMarked && !this.bMarkIsNeg && !bSetupMulti) {
        this.bMarked = false;
        this.SetMultiMarkArea(this.aMarkRange, true, true);
      }
    }
    const aMultiRange = rRange.clone();
    aMultiRange.PutInOrder();
    if (bMark) this.maMulti.Join(aMultiRange);
    else this.maMulti.DeleteArea(aMultiRange);
    if (!this.bMultiMarked) {
      this.aMultiRange = aMultiRange.clone();
      this.bMultiMarked = true;
    } else this.aMultiRange = this.maMulti.empty() ? aMultiRange.clone() : this.maMulti.Combine();
  }

  /** Converts the simple mark to a multi mark. */
  MarkToMulti(): void {
    if (this.bMarked && !this.bMarking) {
      this.SetMultiMarkArea(this.aMarkRange, !this.bMarkIsNeg);
      this.bMarked = false;
      //  check if all multi mark ranges have been removed
      if (this.bMarkIsNeg && !this.HasAnyMultiMarks()) this.ResetMark();
    }
  }

  /** Converts a multi mark of one rectangle to a simple mark. */
  MarkToSimple(): void {
    if (this.bMarking) return;
    if (this.bMultiMarked && this.bMarked) this.MarkToMulti(); // may result in bMarked and bMultiMarked reset
    if (!this.bMultiMarked) return;
    if (this.maMulti.size() === 1) {
      this.aMarkRange = this.maMulti.at(0).clone();
      this.bMarked = true;
      this.bMultiMarked = false;
      this.maMulti = new ScRangeList();
    } else if (this.maMulti.empty()) this.ResetMark();
  }

  IsMarked(): boolean { return this.bMarked; }
  IsMultiMarked(): boolean { return this.bMultiMarked; }
  GetMarkArea(): ScRange { return this.aMarkRange; }
  GetMultiMarkArea(): ScRange { return this.aMultiRange; }
  GetArea(): ScRange { return this.bMultiMarked ? this.aMultiRange : this.aMarkRange; }

  SetAreaTab(nTab: SCTAB): void {
    this.aMarkRange.aStart.SetTab(nTab);
    this.aMarkRange.aEnd.SetTab(nTab);
    this.aMultiRange.aStart.SetTab(nTab);
    this.aMultiRange.aEnd.SetTab(nTab);
  }

  SelectTable(nTab: SCTAB, bNew: boolean): void {
    if (bNew) this.maTabMarked.add(nTab);
    else this.maTabMarked.delete(nTab);
  }
  GetTableSelect(nTab: SCTAB): boolean { return this.maTabMarked.has(nTab); }
  SelectOneTable(nTab: SCTAB): void { this.maTabMarked = new Set([nTab]); }
  GetSelectCount(): SCTAB { return this.maTabMarked.size; }
  GetFirstSelected(): SCTAB { return this.maTabMarked.size ? Math.min(...this.maTabMarked) : 0; }
  GetLastSelected(): SCTAB { return this.maTabMarked.size ? Math.max(...this.maTabMarked) : 0; }
  GetSelectedTabs(): SCTAB[] { return [...this.maTabMarked].sort((a, b) => a - b); }
  SetSelectedTabs(rTabs: Iterable<SCTAB>): void { this.maTabMarked = new Set(rTabs); }
  /** Iterate the selected sheets in order. */
  [Symbol.iterator](): Iterator<SCTAB> { return this.GetSelectedTabs()[Symbol.iterator](); }

  SetMarkNegative(bFlag: boolean): void { this.bMarkIsNeg = bFlag; }
  IsMarkNegative(): boolean { return this.bMarkIsNeg; }
  SetMarking(bFlag: boolean): void { this.bMarking = bFlag; }
  GetMarkingFlag(): boolean { return this.bMarking; }

  IsCellMarked(nCol: SCCOL, nRow: SCROW, bNoSimple = false): boolean {
    if (this.bMarked && !bNoSimple && !this.bMarkIsNeg)
      if (this.aMarkRange.aStart.Col() <= nCol && this.aMarkRange.aEnd.Col() >= nCol && this.aMarkRange.aStart.Row() <= nRow && this.aMarkRange.aEnd.Row() >= nRow) return true;
    if (this.bMultiMarked) {
      //TODO: test here for negative Marking ?
      for (const r of this.maMulti) if (r.aStart.Col() <= nCol && nCol <= r.aEnd.Col() && r.aStart.Row() <= nRow && nRow <= r.aEnd.Row()) return true;
    }
    return false;
  }

  IsColumnMarked(nCol: SCCOL): boolean {
    const nMaxRow = this.mrSheetLimits.MaxRow();
    if (this.bMarked && !this.bMarkIsNeg && this.aMarkRange.aStart.Col() <= nCol && this.aMarkRange.aEnd.Col() >= nCol && this.aMarkRange.aStart.Row() === 0 && this.aMarkRange.aEnd.Row() === nMaxRow) return true;
    if (this.bMultiMarked) for (const r of this.maMulti) if (r.aStart.Col() <= nCol && nCol <= r.aEnd.Col() && r.aStart.Row() === 0 && r.aEnd.Row() === nMaxRow) return true;
    return false;
  }

  IsRowMarked(nRow: SCROW): boolean {
    const nMaxCol = this.mrSheetLimits.MaxCol();
    if (this.bMarked && !this.bMarkIsNeg && this.aMarkRange.aStart.Col() === 0 && this.aMarkRange.aEnd.Col() === nMaxCol && this.aMarkRange.aStart.Row() <= nRow && this.aMarkRange.aEnd.Row() >= nRow) return true;
    if (this.bMultiMarked) for (const r of this.maMulti) if (r.aStart.Col() === 0 && r.aEnd.Col() === nMaxCol && r.aStart.Row() <= nRow && nRow <= r.aEnd.Row()) return true;
    return false;
  }

  /** The marked ranges as a list, for one sheet or the first marked sheet's range (FillRangeListWithMarks). */
  FillRangeListWithMarks(pList: ScRangeList, bClear: boolean, nForTab: SCTAB = -1): void {
    if (bClear) pList.RemoveAll();
    //TODO: for multiple selected tables enter multiple ranges !!!
    if (this.bMultiMarked) {
      for (const r of this.maMulti) {
        const a = r.clone();
        if (nForTab >= 0) { a.aStart.SetTab(nForTab); a.aEnd.SetTab(nForTab); }
        pList.push_back(a);
      }
    }
    if (this.bMarked) {
      const a = this.aMarkRange.clone();
      if (nForTab >= 0) { a.aStart.SetTab(nForTab); a.aEnd.SetTab(nForTab); }
      if (!this.bMultiMarked) pList.push_back(a);
    }
  }

  /** Add the ranges of all selected sheets (ExtendRangeListTables). */
  ExtendRangeListTables(pList: ScRangeList): void {
    const aOldList = pList.clone();
    pList.RemoveAll();
    for (const nTab of this.GetSelectedTabs()) {
      for (const r of aOldList) {
        const a = r.clone();
        a.aStart.SetTab(nTab);
        a.aEnd.SetTab(nTab);
        pList.push_back(a);
      }
    }
  }

  GetMarkedRanges(): ScRangeList {
    const aRet = new ScRangeList();
    this.FillRangeListWithMarks(aRet, false);
    return aRet;
  }

  /** The marked ranges of one sheet (GetMarkedRangesForTab). */
  GetMarkedRangesForTab(nTab: SCTAB): ScRangeList {
    const aRet = new ScRangeList();
    this.FillRangeListWithMarks(aRet, false, nTab);
    return aRet;
  }

  HasAnyMultiMarks(): boolean { return this.bMultiMarked && !this.maMulti.empty(); }
  HasMultiMarks(nCol: SCCOL): boolean { return this.bMultiMarked && [...this.maMulti].some((r) => r.aStart.Col() <= nCol && nCol <= r.aEnd.Col()); }

  /**
   * The next marked row in a column from nRow (GetNextMarked, ScMarkArray::GetNextMarked): nRow
   * itself when it is marked or nothing is multi-marked; going up -1, going down past the last
   * row when no marked row follows.
   */
  GetNextMarked(nCol: SCCOL, nRow: SCROW, bUp: boolean): SCROW {
    if (!this.bMultiMarked) return nRow;
    if (nRow < 0 || nRow > this.mrSheetLimits.mnMaxRow) return nRow;
    const rows: number[] = [];
    for (const r of this.maMulti) if (r.aStart.Col() <= nCol && nCol <= r.aEnd.Col()) for (let i = r.aStart.Row(); i <= r.aEnd.Row(); i++) rows.push(i);
    rows.sort((a, b) => a - b);
    if (bUp) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i]! <= nRow) return rows[i]!; return -1; }
    for (const r of rows) if (r >= nRow) return r;
    return this.mrSheetLimits.mnMaxRow + 1;
  }

  /** Adjust the selection to inserted or deleted sheets. */
  InsertTab(nTab: SCTAB): void {
    this.maTabMarked = new Set([...this.maTabMarked].map((t) => (t >= nTab ? t + 1 : t)));
  }
  DeleteTab(nTab: SCTAB): void {
    this.maTabMarked = new Set([...this.maTabMarked].filter((t) => t !== nTab).map((t) => (t > nTab ? t - 1 : t)));
  }

  /** Whether all cells of a range are marked (IsAllMarked). */
  IsAllMarked(rRange: ScRange): boolean {
    if (!this.bMultiMarked) return this.bMarked && this.aMarkRange.Contains(rRange);
    for (let c = rRange.aStart.Col(); c <= rRange.aEnd.Col(); c++)
      for (let r = rRange.aStart.Row(); r <= rRange.aEnd.Row(); r++) if (!this.IsCellMarked(c, r)) return false;
    return true;
  }

  /** The address of a marked cell (for tests). */
  static Pos(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): ScAddress { return new ScAddress(nCol, nRow, nTab); }
}
