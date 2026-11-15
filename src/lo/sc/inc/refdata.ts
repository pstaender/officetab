// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/refdata.hxx faithful
// @upstream sc/source/core/tool/refdata.cxx faithful
// ScSingleRefData and ScComplexRefData: references in formula tokens, each part absolute or
// relative to the formula position. The bit-field flags are plain booleans.
import { MAXTAB, ScAddress, ScRange, ValidTab, type ScAddressDocument, type ScRefAddress, type SCCOL, type SCROW, type SCTAB } from './address.ts';
import type { ScSheetLimits } from './sheetlimits.ts';

export class ScSingleRefData {
  private mnCol: SCCOL = 0;
  private mnRow: SCROW = 0;
  private mnTab: SCTAB = 0;
  bColRel = false;
  bColDeleted = false;
  bRowRel = false;
  bRowDeleted = false;
  bTabRel = false;
  bTabDeleted = false;
  bFlag3D = false; ///< 3D-Ref
  bRelName = false; ///< Reference derived from RangeName with relative values

  clone(): ScSingleRefData {
    const r = new ScSingleRefData();
    r.mnCol = this.mnCol; r.mnRow = this.mnRow; r.mnTab = this.mnTab;
    r.bColRel = this.bColRel; r.bColDeleted = this.bColDeleted; r.bRowRel = this.bRowRel; r.bRowDeleted = this.bRowDeleted;
    r.bTabRel = this.bTabRel; r.bTabDeleted = this.bTabDeleted; r.bFlag3D = this.bFlag3D; r.bRelName = this.bRelName;
    return r;
  }

  InitFlags(): void { ///< all FALSE
    this.bColRel = this.bColDeleted = this.bRowRel = this.bRowDeleted = this.bTabRel = this.bTabDeleted = this.bFlag3D = this.bRelName = false;
  }

  InitAddress(nColP: SCCOL | ScAddress, nRowP?: SCROW, nTabP?: SCTAB): void {
    if (nColP instanceof ScAddress) { this.InitAddress(nColP.Col(), nColP.Row(), nColP.Tab()); return; }
    this.InitFlags();
    this.mnCol = nColP;
    this.mnRow = nRowP!;
    this.mnTab = nTabP!;
  }

  InitAddressRel(rDoc: ScAddressDocument, rAdr: ScAddress, rPos: ScAddress): void {
    this.InitFlags();
    this.SetColRel(true);
    this.SetRowRel(true);
    this.SetTabRel(true);
    this.SetAddress(rDoc.GetSheetLimits(), rAdr, rPos);
  }

  InitFromRefAddress(rDoc: ScAddressDocument, rRef: ScRefAddress, rPos: ScAddress): void {
    this.InitFlags();
    this.SetColRel(rRef.IsRelCol());
    this.SetRowRel(rRef.IsRelRow());
    this.SetTabRel(rRef.IsRelTab());
    this.SetFlag3D(rRef.Tab() !== rPos.Tab());
    this.SetAddress(rDoc.GetSheetLimits(), rRef.GetAddress(), rPos);
  }

  FlagValue(): number {
    return (this.bColRel ? 1 : 0) | (this.bColDeleted ? 2 : 0) | (this.bRowRel ? 4 : 0) | (this.bRowDeleted ? 8 : 0)
      | (this.bTabRel ? 16 : 0) | (this.bTabDeleted ? 32 : 0) | (this.bFlag3D ? 64 : 0) | (this.bRelName ? 128 : 0);
  }

  SetColRel(bVal: boolean): void { this.bColRel = bVal; }
  IsColRel(): boolean { return this.bColRel; }
  SetRowRel(bVal: boolean): void { this.bRowRel = bVal; }
  IsRowRel(): boolean { return this.bRowRel; }
  SetTabRel(bVal: boolean): void { this.bTabRel = bVal; }
  IsTabRel(): boolean { return this.bTabRel; }

  SetAbsCol(nVal: SCCOL): void { this.bColRel = false; this.mnCol = nVal; }
  SetRelCol(nVal: SCCOL): void { this.bColRel = true; this.mnCol = nVal; }
  IncCol(nInc: SCCOL): void { this.mnCol += nInc; }
  SetAbsRow(nVal: SCROW): void { this.bRowRel = false; this.mnRow = nVal; }
  SetRelRow(nVal: SCROW): void { this.bRowRel = true; this.mnRow = nVal; }
  IncRow(nInc: SCROW): void { this.mnRow += nInc; }
  SetAbsTab(nVal: SCTAB): void { this.bTabRel = false; this.mnTab = nVal; }
  SetRelTab(nVal: SCTAB): void { this.bTabRel = true; this.mnTab = nVal; }
  IncTab(nInc: SCTAB): void { this.mnTab += nInc; }

  SetColDeleted(bVal: boolean): void { this.bColDeleted = bVal; }
  IsColDeleted(): boolean { return this.bColDeleted; }
  SetRowDeleted(bVal: boolean): void { this.bRowDeleted = bVal; }
  IsRowDeleted(): boolean { return this.bRowDeleted; }
  SetTabDeleted(bVal: boolean): void { this.bTabDeleted = bVal; }
  IsTabDeleted(): boolean { return this.bTabDeleted; }
  IsDeleted(): boolean { return this.IsColDeleted() || this.IsRowDeleted() || this.IsTabDeleted(); }

  SetFlag3D(bVal: boolean): void { this.bFlag3D = bVal; }
  IsFlag3D(): boolean { return this.bFlag3D; }
  SetRelName(bVal: boolean): void { this.bRelName = bVal; }
  IsRelName(): boolean { return this.bRelName; }

  Valid(rDoc: ScAddressDocument): boolean {
    return !this.IsDeleted() && this.ColValid(rDoc) && this.RowValid(rDoc) && this.TabValid(rDoc);
  }

  ColValid(rDoc: ScAddressDocument): boolean {
    if (this.bColRel) {
      if (this.mnCol < -rDoc.MaxCol() || rDoc.MaxCol() < this.mnCol) return false;
    } else if (this.mnCol < 0 || rDoc.MaxCol() < this.mnCol) return false;
    return true;
  }

  RowValid(rDoc: ScAddressDocument): boolean {
    if (this.bRowRel) {
      if (this.mnRow < -rDoc.MaxRow() || rDoc.MaxRow() < this.mnRow) return false;
    } else if (this.mnRow < 0 || rDoc.MaxRow() < this.mnRow) return false;
    return true;
  }

  TabValid(rDoc: ScAddressDocument): boolean {
    if (this.bTabRel) {
      if (this.mnTab < -MAXTAB || MAXTAB < this.mnTab) return false;
    } else if (this.mnTab < 0 || rDoc.GetTableCount() <= this.mnTab) return false;
    return true;
  }

  /** In external references nTab is -1 if the external document was not
      loaded but the sheet was cached, or >=0 if the external document was
      loaded. */
  ValidExternal(rDoc: ScAddressDocument): boolean {
    return this.ColValid(rDoc) && this.RowValid(rDoc) && this.mnTab >= -1;
  }

  toAbs(rLimits: ScSheetLimits | ScAddressDocument, rPos: ScAddress): ScAddress {
    const lim = 'mnMaxCol' in rLimits ? rLimits : rLimits.GetSheetLimits();
    const nRetCol = this.bColRel ? this.mnCol + rPos.Col() : this.mnCol;
    const nRetRow = this.bRowRel ? this.mnRow + rPos.Row() : this.mnRow;
    const nRetTab = this.bTabRel ? this.mnTab + rPos.Tab() : this.mnTab;
    const aAbs = ScAddress.Invalid();
    if (lim.ValidCol(nRetCol)) aAbs.SetCol(nRetCol);
    if (lim.ValidRow(nRetRow)) aAbs.SetRow(nRetRow);
    if (ValidTab(nRetTab)) aAbs.SetTab(nRetTab);
    return aAbs;
  }

  SetAddress(rLimits: ScSheetLimits, rAddr: ScAddress, rPos: ScAddress): void {
    if (this.bColRel) this.mnCol = rAddr.Col() - rPos.Col();
    else this.mnCol = rAddr.Col();
    if (!rLimits.ValidCol(rAddr.Col())) this.SetColDeleted(true);

    if (this.bRowRel) this.mnRow = rAddr.Row() - rPos.Row();
    else this.mnRow = rAddr.Row();
    if (!rLimits.ValidRow(rAddr.Row())) this.SetRowDeleted(true);

    if (this.bTabRel) this.mnTab = rAddr.Tab() - rPos.Tab();
    else this.mnTab = rAddr.Tab();
    if (!ValidTab(rAddr.Tab(), MAXTAB)) this.SetTabDeleted(true);
  }

  Row(): SCROW { return this.bRowDeleted ? -1 : this.mnRow; }
  Col(): SCCOL { return this.bColDeleted ? -1 : this.mnCol; }
  Tab(): SCTAB { return this.bTabDeleted ? -1 : this.mnTab; }

  /** Adjust ordering (front-top-left/rear-bottom-right) to a new position. */
  static PutInOrder(rRef1: ScSingleRefData, rRef2: ScSingleRefData, rPos: ScAddress): void {
    const kCOL = 1;
    const kROW = 2;
    const kTAB = 4;
    let nRelState1 = rRef1.bRelName ? (rRef1.bTabRel ? kTAB : 0) | (rRef1.bRowRel ? kROW : 0) | (rRef1.bColRel ? kCOL : 0) : 0;
    let nRelState2 = rRef2.bRelName ? (rRef2.bTabRel ? kTAB : 0) | (rRef2.bRowRel ? kROW : 0) | (rRef2.bColRel ? kCOL : 0) : 0;

    const nCol1 = rRef1.bColRel ? rPos.Col() + rRef1.mnCol : rRef1.mnCol;
    const nCol2 = rRef2.bColRel ? rPos.Col() + rRef2.mnCol : rRef2.mnCol;
    if (nCol2 < nCol1) {
      rRef1.mnCol = rRef2.bColRel ? nCol2 - rPos.Col() : nCol2;
      rRef2.mnCol = rRef1.bColRel ? nCol1 - rPos.Col() : nCol1;
      if (rRef1.bRelName && rRef1.bColRel) nRelState2 |= kCOL;
      else nRelState2 &= ~kCOL;
      if (rRef2.bRelName && rRef2.bColRel) nRelState1 |= kCOL;
      else nRelState1 &= ~kCOL;
      [rRef1.bColRel, rRef2.bColRel] = [rRef2.bColRel, rRef1.bColRel];
      [rRef1.bColDeleted, rRef2.bColDeleted] = [rRef2.bColDeleted, rRef1.bColDeleted];
    }

    const nRow1 = rRef1.bRowRel ? rPos.Row() + rRef1.mnRow : rRef1.mnRow;
    const nRow2 = rRef2.bRowRel ? rPos.Row() + rRef2.mnRow : rRef2.mnRow;
    if (nRow2 < nRow1) {
      rRef1.mnRow = rRef2.bRowRel ? nRow2 - rPos.Row() : nRow2;
      rRef2.mnRow = rRef1.bRowRel ? nRow1 - rPos.Row() : nRow1;
      if (rRef1.bRelName && rRef1.bRowRel) nRelState2 |= kROW;
      else nRelState2 &= ~kROW;
      if (rRef2.bRelName && rRef2.bRowRel) nRelState1 |= kROW;
      else nRelState1 &= ~kROW;
      [rRef1.bRowRel, rRef2.bRowRel] = [rRef2.bRowRel, rRef1.bRowRel];
      [rRef1.bRowDeleted, rRef2.bRowDeleted] = [rRef2.bRowDeleted, rRef1.bRowDeleted];
    }

    const nTab1 = rRef1.bTabRel ? rPos.Tab() + rRef1.mnTab : rRef1.mnTab;
    const nTab2 = rRef2.bTabRel ? rPos.Tab() + rRef2.mnTab : rRef2.mnTab;
    if (nTab2 < nTab1) {
      rRef1.mnTab = rRef2.bTabRel ? nTab2 - rPos.Tab() : nTab2;
      rRef2.mnTab = rRef1.bTabRel ? nTab1 - rPos.Tab() : nTab1;
      if (rRef1.bRelName && rRef1.bTabRel) nRelState2 |= kTAB;
      else nRelState2 &= ~kTAB;
      if (rRef2.bRelName && rRef2.bTabRel) nRelState1 |= kTAB;
      else nRelState1 &= ~kTAB;
      [rRef1.bTabRel, rRef2.bTabRel] = [rRef2.bTabRel, rRef1.bTabRel];
      [rRef1.bTabDeleted, rRef2.bTabDeleted] = [rRef2.bTabDeleted, rRef1.bTabDeleted];
    }

    // bFlag3D stays the same on both references.
    rRef1.bRelName = nRelState1 !== 0;
    rRef2.bRelName = nRelState2 !== 0;
  }

  equals(r: ScSingleRefData): boolean {
    return this.FlagValue() === r.FlagValue() && this.mnCol === r.mnCol && this.mnRow === r.mnRow && this.mnTab === r.mnTab;
  }
}

export class ScComplexRefData {
  Ref1 = new ScSingleRefData();
  Ref2 = new ScSingleRefData();
  bTrimToData = false;

  clone(): ScComplexRefData {
    const r = new ScComplexRefData();
    r.Ref1 = this.Ref1.clone();
    r.Ref2 = this.Ref2.clone();
    r.bTrimToData = this.bTrimToData;
    return r;
  }

  InitFlags(): void { this.Ref1.InitFlags(); this.Ref2.InitFlags(); }

  InitRange(rRange: ScRange | SCCOL, nRow1?: SCROW, nTab1?: SCTAB, nCol2?: SCCOL, nRow2?: SCROW, nTab2?: SCTAB): void {
    if (rRange instanceof ScRange) {
      this.Ref1.InitAddress(rRange.aStart);
      this.Ref2.InitAddress(rRange.aEnd);
      return;
    }
    this.Ref1.InitAddress(rRange, nRow1!, nTab1!);
    this.Ref2.InitAddress(nCol2!, nRow2!, nTab2!);
  }

  InitRangeRel(rDoc: ScAddressDocument, rRange: ScRange, rPos: ScAddress): void {
    this.Ref1.InitAddressRel(rDoc, rRange.aStart, rPos);
    this.Ref2.InitAddressRel(rDoc, rRange.aEnd, rPos);
  }

  InitFromRefAddresses(rDoc: ScAddressDocument, rRef1: ScRefAddress, rRef2: ScRefAddress, rPos: ScAddress): void {
    this.InitFlags();
    this.Ref1.SetColRel(rRef1.IsRelCol());
    this.Ref1.SetRowRel(rRef1.IsRelRow());
    this.Ref1.SetTabRel(rRef1.IsRelTab());
    this.Ref1.SetFlag3D(rRef1.Tab() !== rPos.Tab() || rRef1.Tab() !== rRef2.Tab());
    this.Ref2.SetColRel(rRef2.IsRelCol());
    this.Ref2.SetRowRel(rRef2.IsRelRow());
    this.Ref2.SetTabRel(rRef2.IsRelTab());
    this.Ref2.SetFlag3D(rRef1.Tab() !== rRef2.Tab());
    this.SetRange(rDoc.GetSheetLimits(), new ScRange(rRef1.GetAddress(), rRef2.GetAddress()), rPos);
  }

  /** Enlarge range if reference passed is not within existing range.
      ScAddress position is used to calculate absolute references from
      relative references. */
  Extend(rLimits: ScSheetLimits, rRef: ScSingleRefData | ScComplexRefData, rPos: ScAddress): this {
    if (rRef instanceof ScComplexRefData) return this.Extend(rLimits, rRef.Ref1, rPos).Extend(rLimits, rRef.Ref2, rPos);
    const bInherit3D = this.Ref1.IsFlag3D() && !this.Ref2.IsFlag3D() && !rRef.IsFlag3D();
    const aAbsRange = this.toAbs(rLimits, rPos);

    const aRef = rRef.clone();
    // If no sheet was given in the extending part, let it point to the same
    // sheet as this reference's end point, inheriting the absolute/relative
    // mode.
    // [$]Sheet1.A5:A6:A7 on Sheet2 do still reference only Sheet1.
    if (!rRef.IsFlag3D()) {
      if (this.Ref2.IsTabRel()) aRef.SetRelTab(this.Ref2.Tab());
      else aRef.SetAbsTab(this.Ref2.Tab());
    }
    const aAbs = aRef.toAbs(rLimits, rPos);

    if (aAbs.Col() < aAbsRange.aStart.Col()) aAbsRange.aStart.SetCol(aAbs.Col());
    if (aAbs.Row() < aAbsRange.aStart.Row()) aAbsRange.aStart.SetRow(aAbs.Row());
    if (aAbs.Tab() < aAbsRange.aStart.Tab()) aAbsRange.aStart.SetTab(aAbs.Tab());
    if (aAbsRange.aEnd.Col() < aAbs.Col()) aAbsRange.aEnd.SetCol(aAbs.Col());
    if (aAbsRange.aEnd.Row() < aAbs.Row()) aAbsRange.aEnd.SetRow(aAbs.Row());
    if (aAbsRange.aEnd.Tab() < aAbs.Tab()) aAbsRange.aEnd.SetTab(aAbs.Tab());

    // In Ref2 inherit absolute/relative addressing from the extending part.
    // A$5:A5 => A$5:A$5:A5 => A$5:A5, and not A$5:A$5
    // A$6:$A5 => A$6:A$6:$A5 => A5:$A$6
    if (aAbsRange.aEnd.Col() === aAbs.Col()) this.Ref2.SetColRel(rRef.IsColRel());
    if (aAbsRange.aEnd.Row() === aAbs.Row()) this.Ref2.SetRowRel(rRef.IsRowRel());

    // In Ref1 inherit relative sheet from extending part if given.
    if (aAbsRange.aStart.Tab() === aAbs.Tab() && rRef.IsFlag3D()) this.Ref1.SetTabRel(rRef.IsTabRel());

    // In Ref2 inherit relative sheet from either Ref1 or extending part.
    // Use the original 3D flags to determine which.
    // $Sheet1.$A$5:$A$6 => $Sheet1.$A$5:$A$5:$A$6 => $Sheet1.$A$5:$A$6, and
    // not $Sheet1.$A$5:Sheet1.$A$6 (with invisible second 3D, but relative).
    if (aAbsRange.aEnd.Tab() === aAbs.Tab()) this.Ref2.SetTabRel(bInherit3D ? this.Ref1.IsTabRel() : rRef.IsTabRel());

    // Force 3D flag in Ref1 if different sheet or more than one sheet
    // referenced.
    if (aAbsRange.aStart.Tab() !== rPos.Tab() || aAbsRange.aStart.Tab() !== aAbsRange.aEnd.Tab()) this.Ref1.SetFlag3D(true);

    // Force 3D flag in Ref2 if more than one sheet referenced.
    if (aAbsRange.aStart.Tab() !== aAbsRange.aEnd.Tab()) this.Ref2.SetFlag3D(true);

    // Inherit 3D flag in Ref1 from extending part in case range wasn't
    // extended as in A5:A5:Sheet1.A5 if on Sheet1.
    if (rRef.IsFlag3D()) this.Ref1.SetFlag3D(true);

    // Inherit RelNameRef from extending part.
    if (rRef.IsRelName()) this.Ref2.SetRelName(true);

    this.SetRange(rLimits, aAbsRange, rPos);
    return this;
  }

  Valid(rDoc: ScAddressDocument): boolean { return this.Ref1.Valid(rDoc) && this.Ref2.Valid(rDoc); }

  ValidExternal(rDoc: ScAddressDocument): boolean {
    return this.Ref1.ValidExternal(rDoc) && this.Ref2.ColValid(rDoc) && this.Ref2.RowValid(rDoc) && this.Ref1.Tab() <= this.Ref2.Tab();
  }

  toAbs(rLimits: ScSheetLimits | ScAddressDocument, rPos: ScAddress): ScRange {
    const aRange = new ScRange();
    aRange.aStart = this.Ref1.toAbs(rLimits, rPos);
    aRange.aEnd = this.Ref2.toAbs(rLimits, rPos);
    aRange.PutInOrder();
    return aRange;
  }

  /** Set a new range, assuming that the ordering of the range matches the
      ordering of the reference data flags already set. */
  SetRange(rLimits: ScSheetLimits, rRange: ScRange, rPos: ScAddress): void {
    this.Ref1.SetAddress(rLimits, rRange.aStart, rPos);
    this.Ref2.SetAddress(rLimits, rRange.aEnd, rPos);
  }

  /** Adjust ordering (front-top-left/rear-bottom-right) to a new position. */
  PutInOrder(rPos: ScAddress): void { ScSingleRefData.PutInOrder(this.Ref1, this.Ref2, rPos); }

  /** Whether this references entire columns, A:A */
  IsEntireCol(rLimits: ScSheetLimits): boolean {
    // Both row anchors must be absolute.
    return this.Ref1.Row() === 0 && this.Ref2.Row() === rLimits.MaxRow() && !this.Ref1.IsRowRel() && !this.Ref2.IsRowRel();
  }

  /** Whether this references entire rows, 1:1 */
  IsEntireRow(rLimits: ScSheetLimits): boolean {
    // Both column anchors must be absolute.
    return this.Ref1.Col() === 0 && this.Ref2.Col() === rLimits.MaxCol() && !this.Ref1.IsColRel() && !this.Ref2.IsColRel();
  }

  /** Increment or decrement end column unless or until sticky.
      @return TRUE if changed. */
  IncEndColSticky(rDoc: ScAddressDocument, nDelta: SCCOL, rPos: ScAddress): boolean {
    const nCol1 = this.Ref1.IsColRel() ? this.Ref1.Col() + rPos.Col() : this.Ref1.Col();
    const nCol2 = this.Ref2.IsColRel() ? this.Ref2.Col() + rPos.Col() : this.Ref2.Col();
    if (nCol1 >= nCol2) {
      // Less than two columns => not sticky.
      this.Ref2.IncCol(nDelta);
      return true;
    }
    if (nCol2 === rDoc.MaxCol()) return false; // already sticky
    if (nCol2 < rDoc.MaxCol()) {
      const nCol = Math.min(nCol2 + nDelta, rDoc.MaxCol());
      if (this.Ref2.IsColRel()) this.Ref2.SetRelCol(nCol - rPos.Col());
      else this.Ref2.SetAbsCol(nCol);
    } else this.Ref2.IncCol(nDelta); // was greater than rDoc.MaxCol(), caller should know...
    return true;
  }

  /** Increment or decrement end row unless or until sticky.
      @return TRUE if changed. */
  IncEndRowSticky(rDoc: ScAddressDocument, nDelta: SCROW, rPos: ScAddress): boolean {
    const nRow1 = this.Ref1.IsRowRel() ? this.Ref1.Row() + rPos.Row() : this.Ref1.Row();
    const nRow2 = this.Ref2.IsRowRel() ? this.Ref2.Row() + rPos.Row() : this.Ref2.Row();
    if (nRow1 >= nRow2) {
      // Less than two rows => not sticky.
      this.Ref2.IncRow(nDelta);
      return true;
    }
    if (nRow2 === rDoc.MaxRow()) return false; // already sticky
    if (nRow2 < rDoc.MaxRow()) {
      const nRow = Math.min(nRow2 + nDelta, rDoc.MaxRow());
      if (this.Ref2.IsRowRel()) this.Ref2.SetRelRow(nRow - rPos.Row());
      else this.Ref2.SetAbsRow(nRow);
    } else this.Ref2.IncRow(nDelta); // was greater than rDoc.MaxRow(), caller should know...
    return true;
  }

  IsDeleted(): boolean { return this.Ref1.IsDeleted() || this.Ref2.IsDeleted(); }
  IsTrimToData(): boolean { return this.bTrimToData; }
  SetTrimToData(bSet: boolean): void { this.bTrimToData = bSet; }

  equals(r: ScComplexRefData): boolean { return this.Ref1.equals(r.Ref1) && this.Ref2.equals(r.Ref2); }
}
