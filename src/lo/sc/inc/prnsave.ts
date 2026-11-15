// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/prnsave.hxx faithful
// @upstream sc/source/core/tool/prnsave.cxx partial
// ScPrintRangeSaver: the print ranges and repeated rows and columns of every sheet, for the undo
// of print range changes. GetPrintRangesInfo (for LibreOfficeKit) is left out.
import type { ScRange, SCTAB } from './address.ts';

export class ScPrintSaverTab {
  /** Array */
  private maPrintRanges: ScRange[] = [];
  /** single */
  private moRepeatCol: ScRange | null = null;
  /** single */
  private moRepeatRow: ScRange | null = null;
  private mbEntireSheet = false;

  SetAreas(rRanges: ScRange[], bEntireSheet: boolean): void {
    this.maPrintRanges = rRanges.map((r) => r.clone());
    this.mbEntireSheet = bEntireSheet;
  }

  SetRepeat(oCol: ScRange | null, oRow: ScRange | null): void {
    this.moRepeatCol = oCol ? oCol.clone() : null;
    this.moRepeatRow = oRow ? oRow.clone() : null;
  }

  GetPrintRanges(): readonly ScRange[] { return this.maPrintRanges; }
  IsEntireSheet(): boolean { return this.mbEntireSheet; }
  GetRepeatCol(): ScRange | null { return this.moRepeatCol; }
  GetRepeatRow(): ScRange | null { return this.moRepeatRow; }

  equals(rCmp: ScPrintSaverTab): boolean {
    const eq = (a: ScRange | null, b: ScRange | null) => (a === null ? b === null : b !== null && a.equals(b));
    return eq(this.moRepeatCol, rCmp.moRepeatCol) && eq(this.moRepeatRow, rCmp.moRepeatRow) && this.mbEntireSheet === rCmp.mbEntireSheet
      && this.maPrintRanges.length === rCmp.maPrintRanges.length && this.maPrintRanges.every((r, i) => r.equals(rCmp.maPrintRanges[i]!));
  }
}

export class ScPrintRangeSaver {
  private readonly nTabCount: SCTAB;
  private readonly pData: ScPrintSaverTab[];

  constructor(nCount: SCTAB) {
    this.nTabCount = nCount;
    this.pData = Array.from({ length: nCount }, () => new ScPrintSaverTab());
  }

  GetTabCount(): SCTAB { return this.nTabCount; }
  GetTabData(nTab: SCTAB): ScPrintSaverTab {
    if (nTab >= this.nTabCount) throw new Error('ScPrintRangeSaver Tab too big');
    return this.pData[nTab]!;
  }

  equals(rCmp: ScPrintRangeSaver): boolean {
    let bEqual = this.nTabCount === rCmp.nTabCount;
    if (bEqual) for (let i = 0; i < this.nTabCount; i++) if (!this.pData[i]!.equals(rCmp.pData[i]!)) { bEqual = false; break; }
    return bEqual;
  }
}
