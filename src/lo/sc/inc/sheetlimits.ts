// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/sheetlimits.hxx faithful
import { MAXCOL, MAXCOL_JUMBO_STRING, MAXCOL_STRING, MAXROW, MAXROW_JUMBO_STRING, MAXROW_STRING, ValidAddress, ValidCol, ValidColRow, ValidColRowTab, ValidRange, ValidRow, SanitizeCol, SanitizeRow, type ScAddress, type ScRange, type SCCOL, type SCROW, type SCTAB } from './address.ts';

// Because some stuff needs this info, and those objects lifetimes sometimes exceeds the lifetime
// of the ScDocument.
export class ScSheetLimits {
  readonly mnMaxCol: SCCOL; /// Maximum addressable column
  readonly mnMaxRow: SCROW; /// Maximum addressable row

  constructor(nMaxCol: SCCOL, nMaxRow: SCROW) {
    this.mnMaxCol = nMaxCol;
    this.mnMaxRow = nMaxRow;
  }

  /** ScSheetLimits::CreateDefault (documen2.cxx): no jumbo sheets. */
  static CreateDefault(): ScSheetLimits { return new ScSheetLimits(MAXCOL, MAXROW); }

  ValidCol(nCol: SCCOL): boolean { return ValidCol(nCol, this.mnMaxCol); }
  ValidRow(nRow: SCROW): boolean { return ValidRow(nRow, this.mnMaxRow); }
  ValidColRow(nCol: SCCOL, nRow: SCROW): boolean { return ValidColRow(nCol, nRow, this.mnMaxCol, this.mnMaxRow); }
  ValidColRowTab(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): boolean { return ValidColRowTab(nCol, nRow, nTab, this.mnMaxCol, this.mnMaxRow); }
  ValidRange(rRange: ScRange): boolean { return ValidRange(rRange, this.mnMaxCol, this.mnMaxRow); }
  ValidAddress(rAddress: ScAddress): boolean { return ValidAddress(rAddress, this.mnMaxCol, this.mnMaxRow); }
  SanitizeCol(nCol: SCCOL): SCCOL { return SanitizeCol(nCol, this.mnMaxCol); }
  SanitizeRow(nRow: SCROW): SCROW { return SanitizeRow(nRow, this.mnMaxRow); }

  // equivalent of MAXROW in address.hxx
  MaxRow(): SCROW { return this.mnMaxRow; }
  // equivalent of MAXCOL in address.hxx
  MaxCol(): SCCOL { return this.mnMaxCol; }
  // equivalent of MAXROWCOUNT in address.hxx
  GetMaxRowCount(): SCROW { return this.mnMaxRow + 1; }
  // equivalent of MAXCOLCOUNT in address.hxx
  GetMaxColCount(): SCCOL { return this.mnMaxCol + 1; }
  // max row number as string
  MaxRowAsString(): string { return this.mnMaxRow === MAXROW ? MAXROW_STRING : MAXROW_JUMBO_STRING; }
  // mac col as string ("AMJ" or "XFD")
  MaxColAsString(): string { return this.mnMaxCol === MAXCOL ? MAXCOL_STRING : MAXCOL_JUMBO_STRING; }
}
