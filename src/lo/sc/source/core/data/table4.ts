// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/data/table4.cxx partial
// Filling (ScTable::Fill, FillAuto, FillSeries, FillAnalyse and their helpers): AutoFill with
// the fill handle and the Sheet - Fill Cells commands. Kept: copying with attributes, numeric,
// date (day, weekday, month, end of month, year), time and percent series, text with a leading
// or trailing number, ordinal suffixes, the sort lists (day and month names), formulas with their
// relative references moved, and hidden rows and columns being skipped. Left out: the analysis
// of merged source cells (FillAnalyse's bSkipOverlappedCells path, so merged areas are filled
// like unmerged ones), conditional formats and sparklines following the fill, the progress bar,
// GetAutoFillPreview, the superscript ordinal suffix in edit cells (a plain suffix is written),
// AutoFormat and the remaining table4.cxx functions. tools::Duration steps are kept as a number
// of days that is snapped to whole seconds as Duration does.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { approxEqual, round as rtl_math_round } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { Duration } from '../../../../tools/source/datetime/duration.ts';
import { Date as ToolsDate, DateDiff, DayOfWeek } from '../../../../tools/source/datetime/tdate.ts';
import { ScAddress, ScRange, type SCCOL, type SCROW } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue, type CellType } from '../../../inc/cellvalue.ts';
import { FillCmd, FillDateCmd, FillDir, InsertDeleteFlags } from '../../../inc/global.ts';
import { ScUserListData, GetUserList } from '../tool/userlist.ts';
import type { ScColumn } from './column.ts';
import { ScFormulaCell, ScMatrixMode } from './formulacell.ts';
import { ScTable } from './table.ts';

const { FILL_SIMPLE, FILL_LINEAR, FILL_GROWTH, FILL_DATE, FILL_AUTO } = FillCmd;
const { FILL_DAY, FILL_WEEKDAY, FILL_MONTH, FILL_END_OF_MONTH, FILL_YEAR } = FillDateCmd;
const { FILL_TO_BOTTOM, FILL_TO_RIGHT, FILL_TO_TOP } = FillDir;

const D_MAX_LONG_ = 0x7fffffff;
/** MAXDOUBLE (global.hxx) */
export const MAXDOUBLE = 1.7e307;
const LONG_MAX = 0x7fffffff;
const LONG_MIN = -0x80000000;

/** vcl KEY_MOD1: the Ctrl key held while dragging the fill handle (copy instead of a series). */
export const KEY_MOD1 = 0x2000;
/** nScFillModeMouseModifier (global.cxx): the key modifiers of the fill-handle drag. */
export const ScFillMode = { nScFillModeMouseModifier: 0 };

/** The position cursor of the fill loops: rInner is nRow when filling vertically, else nCol. */
interface ColRow { nCol: number; nRow: number }

declare module './table.ts' {
  interface ScTable {
    FillAnalyse(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, bHasFiltered: boolean): FillAnalyseResult;
    FillFormula(pSrcCell: ScFormulaCell, nDestCol: SCCOL, nDestRow: SCROW, bLast: boolean): void;
    FillAuto(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFillCount: number, eFillDir: FillDir): void;
    IncDate(rVal: number, nDayOfMonth: number, nStep: number, eCmd: FillDateCmd): { rVal: number; nDayOfMonth: number };
    FillFormulaVertical(rSrcCell: ScFormulaCell, rPos: ColRow, nCol: SCCOL, nRow1: SCROW, nRow2: SCROW): void;
    FillSeriesSimple(rSrcCell: ScRefCellValue, rPos: ColRow, nIMin: number, nIMax: number, bVertical: boolean): void;
    FillAutoSimple(nISrcStart: number, nISrcEnd: number, nIStart: number, nIEnd: number, rPos: ColRow, bHasFiltered: boolean, bVertical: boolean, bPositive: boolean): void;
    FillSeries(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFillCount: number, eFillDir: FillDir, eFillCmd: FillCmd, eFillDateCmd: FillDateCmd,
      nStepValue: number, fDurationStep: number, nMaxValue: number, nArgMinDigits: number, bAttribs: boolean): void;
    Fill(nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFillCount: number, eFillDir: FillDir, eFillCmd: FillCmd, eFillDateCmd: FillDateCmd,
      nStepValue: number, fDurationStep: number, nMaxValue: number): void;
    IsDataFiltered(rRange: ScRange): boolean;
  }
}

/** The out-parameters of FillAnalyse. */
export interface FillAnalyseResult {
  rCmd: FillCmd;
  rDateCmd: FillDateCmd;
  rInc: number;
  /** tools::Duration as days (0 for none). */
  rDuration: number;
  rMinDigits: number;
  rListData: ScUserListData | null;
  rListIndex: number;
}

const isAsciiNumeric = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** A string with its number split off: the flag is -1 for a number at the beginning, 1 (2 with
    a sign) for a number at the end, 0 for none; rValue is the rest of the string. */
function lcl_DecompValueString(rValue: string, pMinDigits?: { n: number }): { nFlag: number; nVal: number; rValue: string } {
  if (!rValue) return { nFlag: 0, nVal: 0, rValue };
  const p = rValue;
  let nSign = 0;
  let nNum = 0;
  if (p[nNum] === '-' || p[nNum] === '+') nNum = nSign = 1;
  while (nNum < p.length && isAsciiNumeric(p[nNum])) nNum++;

  const cNext = nNum < p.length ? p[nNum] : '\0'; // 0 if at the end
  const cLast = p[p.length - 1];

  // #i5550# If there are numbers at the beginning and the end,
  // prefer the one at the beginning only if it's followed by a space.
  // Otherwise, use the number at the end, to enable things like IP addresses.
  if (nNum > nSign && (cNext === '\0' || cNext === ' ' || !isAsciiNumeric(cLast))) {
    // number at the beginning
    const nVal = toInt32(rValue.substring(0, nNum));
    //  any number with a leading zero sets the minimum number of digits
    if (p[nSign] === '0' && pMinDigits && nNum - nSign > pMinDigits.n) pMinDigits.n = nNum - nSign;
    return { nFlag: -1, nVal, rValue: rValue.substring(nNum) };
  } else {
    nSign = 0;
    const nEnd = (nNum = rValue.length - 1);
    while (nNum && isAsciiNumeric(p[nNum])) nNum--;
    if (p[nNum] === '-' || p[nNum] === '+') {
      nNum--;
      nSign = 1;
    }
    if (nNum < nEnd - nSign) {
      // number at the end
      const nVal = toInt32(rValue.substring(nNum + 1));
      //  any number with a leading zero sets the minimum number of digits
      if (p[nNum + 1 + nSign] === '0' && pMinDigits && nEnd - nNum - nSign > pMinDigits.n) pMinDigits.n = nEnd - nNum - nSign;
      // use the return value = 2 to put back the '+'
      return { nFlag: nSign ? 2 : 1, nVal, rValue: rValue.substring(0, nNum + 1) };
    }
  }
  return { nFlag: 0, nVal: 0, rValue };
}

/** o3tl::toInt32 (rtl_ustr_toInt32: an optional sign and decimal digits, wrapping on overflow). */
function toInt32(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n | 0 : 0;
}

function lcl_ValueString(nValue: number, nMinDigits: number): string {
  if (nMinDigits <= 1) return String(nValue); // simple case...
  let aStr = String(Math.abs(nValue));
  if (aStr.length < nMinDigits) aStr = '0'.repeat(nMinDigits - aStr.length) + aStr;
  //  nMinDigits doesn't include the '-' sign -> add after inserting zeros
  if (nValue < 0) aStr = '-' + aStr;
  return aStr;
}

const aOrdinalRules = new Intl.PluralRules('en-US', { type: 'ordinal' });
const aOrdinalSuffixes: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

/** ScGlobal::GetOrdinalSuffix: "st", "nd", "rd" or "th" in English. */
function GetOrdinalSuffix(nNumber: number): string {
  return aOrdinalSuffixes[aOrdinalRules.select(nNumber)] ?? '';
}

function setSuffixCell(rColumn: ScColumn, nRow: SCROW, nValue: number, nDigits: number, rSuffix: string, _eCellType: CellType, bIsOrdinalSuffix: boolean): void {
  let aValue = lcl_ValueString(nValue, nDigits);
  if (!bIsOrdinalSuffix) {
    aValue += rSuffix;
    rColumn.SetRawString(nRow, aValue);
    return;
  }
  // An edit cell would get the suffix as superscript; here it is plain text in both cases.
  aValue += GetOrdinalSuffix(nValue);
  rColumn.SetRawString(nRow, aValue);
}

/** Calculate a-b trying to diminish precision errors such as for 0.11-0.12
    not return -0.009999999999999995 but -0.01 instead. */
function approxDiff(a: number, b: number): number {
  if (a === b) return 0.0;
  if (a === 0.0) return -b;
  if (b === 0.0) return a;
  const c = a - b;
  const aa = Math.abs(a);
  const ab = Math.abs(b);
  if (aa < 1e-16 || aa > 1e16 || ab < 1e-16 || ab > 1e16)
    // This is going nowhere, live with the result.
    return c;

  const q = aa < ab ? b / a : a / b;
  const d = (a * q - b * q) / q;
  if (d === c)
    // No differing error, live with the result.
    return c;

  // We now have two subtractions with a similar but not equal error. Obtain
  // the exponent of the error magnitude and round accordingly.
  const e = Math.abs(d - c);
  const nExp = Math.floor(Math.log10(e)) + 1;
  // tdf#129606: Limit precision to the 16th significant digit of the least precise argument.
  // Cf. mnMaxGeneralPrecision in sc/source/core/data/column3.cxx.
  const nExpArg = Math.floor(Math.log10(Math.max(aa, ab))) - 15;
  return rtl_math_round(c, -Math.max(nExp, nExpArg));
}

function approxTypedDiff(a: number, b: number, bTime: boolean, rDuration: { d: number }): number {
  if (bTime) {
    rDuration.d = new Duration(a - b).GetInDays();
    return rDuration.d;
  }
  return approxDiff(a, b);
}

/** The null date of the number formatter (30.12.1899). */
const aNullDate = (): ToolsDate => new ToolsDate(30, 12, 1899);
const lcl_DateFromSerial = (nVal: number): ToolsDate => {
  const d = aNullDate();
  d.AddDays(Math.trunc(nVal));
  return d;
};
const IsEndOfMonth = (d: ToolsDate): boolean => d.GetDay() === d.GetDaysInMonth();

/** The number format type of a cell. */
function lcl_FormatType(pTab: ScTable, nCol: SCCOL, nRow: SCROW): SvNumFormatType {
  const pPattern = pTab.GetPattern(nCol, nRow);
  return NFGetType(pPattern.GetNumberFormat(), pPattern.GetItem('ATTR_LANGUAGE_FORMAT') || 'en-US');
}

/** ScCellValue::commit: put a copy of a cell into a column (formulas move their references). */
function lcl_Commit(pTab: ScTable, rCell: ScRefCellValue, nCol: SCCOL, nRow: SCROW): void {
  const rColumn = pTab.CreateColumnIfNotExists(nCol);
  switch (rCell.getType()) {
    case CELLTYPE_STRING: rColumn.SetRawString(nRow, rCell.getSharedString()!); break;
    case CELLTYPE_EDIT: rColumn.SetEditText(nRow, rCell.getEditText()!.Clone()); break;
    case CELLTYPE_VALUE: rColumn.SetValue(nRow, rCell.getDouble()); break;
    case CELLTYPE_FORMULA: rColumn.SetFormulaCell(nRow, rCell.getFormula()!.Clone(new ScAddress(nCol, nRow, pTab.GetTab()))); break;
    default: rColumn.Delete(nRow);
  }
}

/** ScColumn::SetError */
function lcl_SetError(pTab: ScTable, nCol: SCCOL, nRow: SCROW, nError: FormulaError): void {
  const pCell = new ScFormulaCell(pTab.GetDoc(), new ScAddress(nCol, nRow, pTab.GetTab()));
  pCell.SetErrCode(nError);
  pTab.CreateColumnIfNotExists(nCol).SetFormulaCell(nRow, pCell);
}

/** SubTotal::SafePlus / SafeMult: false on overflow. */
function SafePlus(a: number, b: number): { v: number; ok: boolean } {
  const v = a + b;
  return Number.isFinite(v) ? { v, ok: true } : { v: v > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE, ok: false };
}
function SafeMult(a: number, b: number): { v: number; ok: boolean } {
  const v = a * b;
  return Number.isFinite(v) ? { v, ok: true } : { v: v > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE, ok: false };
}

/** ScTable::IsDataFiltered (table2.cxx): whether a row or column of the range is hidden. */
ScTable.prototype.IsDataFiltered = function (this: ScTable, rRange: ScRange): boolean {
  const nRowStart = Math.min(rRange.aStart.Row(), rRange.aEnd.Row());
  const nRowEnd = Math.max(rRange.aStart.Row(), rRange.aEnd.Row());
  const nColStart = Math.min(rRange.aStart.Col(), rRange.aEnd.Col());
  const nColEnd = Math.max(rRange.aStart.Col(), rRange.aEnd.Col());
  for (let i = nRowStart; i <= nRowEnd; ++i) {
    const r = this.RowHiddenRange(i);
    if (r.bHidden) return true;
    i = r.nLastRow;
  }
  for (let i = nColStart; i <= nColEnd; ++i) if (this.ColHidden(i)) return true;
  return false;
};

ScTable.prototype.FillAnalyse = function (this: ScTable, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, bHasFiltered: boolean): FillAnalyseResult {
  void bHasFiltered;
  const r: FillAnalyseResult = { rCmd: FILL_SIMPLE, rDateCmd: FILL_DAY, rInc: 0.0, rDuration: 0, rMinDigits: 0, rListData: null, rListIndex: 0 };
  if (ScFillMode.nScFillModeMouseModifier & KEY_MOD1) return r; // Ctrl-key: Copy

  let nAddX: SCCOL;
  let nAddY: SCROW;
  let nCount: number;
  if (nCol1 === nCol2) {
    nAddX = 0;
    nAddY = 1;
    nCount = nRow2 - nRow1 + 1;
  } else {
    nAddX = 1;
    nAddY = 0;
    nCount = nCol2 - nCol1 + 1;
  }

  // (The analysis of merged source cells is left out: they are analysed the old way.)

  let nCol = nCol1;
  let nRow = nRow1;

  const aFirstCell = this.GetCellValue(nCol, nRow);
  const eCellType = aFirstCell.getType();
  const aMinDigits = { n: 0 };

  if (eCellType === CELLTYPE_VALUE) {
    let fVal: number;
    const nFormatType = lcl_FormatType(this, nCol, nRow);
    const bDate = nFormatType === SvNumFormatType.DATE; // date without time
    const bTime = nFormatType === SvNumFormatType.TIME || nFormatType === SvNumFormatType.DATETIME;
    const bBooleanCell = nFormatType === SvNumFormatType.LOGICAL;
    if (bDate) {
      if (nCount > 1) {
        let nVal = aFirstCell.getDouble();
        let aDate1 = lcl_DateFromSerial(nVal);
        nVal = this.GetValue(nCol + nAddX, nRow + nAddY);
        let aDate2 = lcl_DateFromSerial(nVal);
        if (aDate1.GetDate() !== aDate2.GetDate()) {
          let nCmpInc = 0;
          let eType: FillDateCmd;
          let nDDiff = aDate2.GetDay() - aDate1.GetDay();
          let nMDiff = aDate2.GetMonth() - aDate1.GetMonth();
          let nYDiff = aDate2.GetYear() - aDate1.GetYear();
          if (nMDiff && IsEndOfMonth(aDate1) && IsEndOfMonth(aDate2)) {
            eType = FILL_END_OF_MONTH;
            nCmpInc = nMDiff + 12 * nYDiff;
          } else if (nDDiff) {
            eType = FILL_DAY;
            nCmpInc = DateDiff(aDate2, aDate1);
          } else {
            eType = FILL_MONTH;
            nCmpInc = nMDiff + 12 * nYDiff;
          }

          nCol = nCol + nAddX;
          nRow = nRow + nAddY;
          let bVal = true;
          for (let i = 1; i < nCount && bVal; i++) {
            const aCell = this.GetCellValue(nCol, nRow);
            if (aCell.getType() === CELLTYPE_VALUE) {
              nVal = aCell.getDouble();
              aDate2 = lcl_DateFromSerial(nVal);
              if (eType === FILL_DAY) {
                if (DateDiff(aDate2, aDate1) !== nCmpInc) bVal = false;
              } else {
                nDDiff = aDate2.GetDay() - aDate1.GetDay();
                nMDiff = aDate2.GetMonth() - aDate1.GetMonth();
                nYDiff = aDate2.GetYear() - aDate1.GetYear();
                if ((nDDiff && !IsEndOfMonth(aDate1) && !IsEndOfMonth(aDate2)) || nMDiff + 12 * nYDiff !== nCmpInc) bVal = false;
              }
              aDate1 = aDate2;
              nCol = nCol + nAddX;
              nRow = nRow + nAddY;
            } else bVal = false; // No date is also not ok
          }
          if (bVal) {
            if ((eType === FILL_MONTH || eType === FILL_END_OF_MONTH) && nCmpInc % 12 === 0) {
              eType = FILL_YEAR;
              nCmpInc /= 12;
            }
            r.rCmd = FILL_DATE;
            r.rDateCmd = eType;
            r.rInc = nCmpInc;
          }
        } else {
          // tdf#89754 - don't increment non different consecutive date cells
          r.rCmd = FILL_DATE;
          r.rDateCmd = FILL_DAY;
          r.rInc = 0.0;
        }
      } else {
        // single date -> increment by days
        r.rCmd = FILL_DATE;
        r.rDateCmd = FILL_DAY;
        r.rInc = 1.0;
      }
    } else if (bBooleanCell && ((fVal = aFirstCell.getDouble()) === 0.0 || fVal === 1.0)) {
      // Nothing, rInc stays 0.0, no specific fill mode.
    } else {
      if (nCount > 1) {
        const aDuration = { d: 0 };
        let nVal1 = aFirstCell.getDouble();
        let nVal2 = this.GetValue(nCol + nAddX, nRow + nAddY);
        r.rInc = approxTypedDiff(nVal2, nVal1, bTime, aDuration);
        nCol = nCol + nAddX;
        nRow = nRow + nAddY;
        let bVal = true;
        for (let i = 1; i < nCount && bVal; i++) {
          const aCell = this.GetCellValue(nCol, nRow);
          if (aCell.getType() === CELLTYPE_VALUE) {
            nVal2 = aCell.getDouble();
            const nDiff = approxTypedDiff(nVal2, nVal1, bTime, aDuration);
            if (!approxEqual(nDiff, r.rInc, 13)) bVal = false;
            else if ((nVal2 === 0.0 || nVal2 === 1.0) && lcl_FormatType(this, nCol, nRow) === SvNumFormatType.LOGICAL) bVal = false;
            nVal1 = nVal2;
          } else bVal = false;
          nCol = nCol + nAddX;
          nRow = nRow + nAddY;
          if (bVal && bTime) r.rDuration = aDuration.d;
        }
        if (bVal) r.rCmd = FILL_LINEAR;
      } else if (nFormatType === SvNumFormatType.PERCENT) {
        r.rInc = 0.01; // tdf#89998 increment by 1% at a time
      }
    }
  } else if (eCellType === CELLTYPE_STRING || eCellType === CELLTYPE_EDIT) {
    let aStr = this.GetString(nCol, nRow);

    r.rListData = GetUserList().GetData(aStr);
    if (r.rListData) {
      r.rListIndex = r.rListData.GetSubIndex(aStr)?.rIndex ?? 0;
      const nListStrCount = r.rListData.GetSubCount();
      let nPrevListIndex: number;
      let nInc = 1;
      nCol = nCol + nAddX;
      nRow = nRow + nAddY;
      for (let i = 1; i < nCount && r.rListData; i++) {
        nPrevListIndex = r.rListIndex;
        aStr = this.GetString(nCol, nRow);
        const rIdx = r.rListData.GetSubIndex(aStr);
        if (!rIdx) r.rListData = null;
        else {
          r.rListIndex = rIdx.rIndex;
          let nIncCurr = r.rListIndex - nPrevListIndex;
          if (nIncCurr < 0) nIncCurr += nListStrCount;
          if (i === 1) nInc = nIncCurr;
          else if (nInc !== nIncCurr) r.rListData = null;
        }
        nCol = nCol + nAddX;
        nRow = nRow + nAddY;
      }
      if (r.rListData) r.rInc = nInc;
    } else if (nCount > 1) {
      //  pass rMinDigits to all DecompValueString calls
      //  -> longest number defines rMinDigits

      const d1 = lcl_DecompValueString(aStr, aMinDigits);
      const nFlag1 = d1.nFlag;
      let nVal1 = d1.nVal;
      if (nFlag1) {
        aStr = this.GetString(nCol + nAddX, nRow + nAddY);
        let d2 = lcl_DecompValueString(aStr, aMinDigits);
        let nVal2 = d2.nVal;
        if (nFlag1 === d2.nFlag) {
          r.rInc = approxDiff(nVal2, nVal1);
          nCol = nCol + nAddX;
          nRow = nRow + nAddY;
          let bVal = true;
          for (let i = 1; i < nCount && bVal; i++) {
            const aCell = this.GetCellValue(nCol, nRow);
            const eType = aCell.getType();
            if (eType === CELLTYPE_STRING || eType === CELLTYPE_EDIT) {
              aStr = aCell.getString();
              d2 = lcl_DecompValueString(aStr, aMinDigits);
              nVal2 = d2.nVal;
              if (nFlag1 === d2.nFlag) {
                const nDiff = approxDiff(nVal2, nVal1);
                if (!approxEqual(nDiff, r.rInc, 13)) bVal = false;
                nVal1 = nVal2;
              } else bVal = false;
            } else bVal = false;
            nCol = nCol + nAddX;
            nRow = nRow + nAddY;
          }
          if (bVal) r.rCmd = FILL_LINEAR;
        }
      }
    } else {
      //  call DecompValueString to set rMinDigits
      lcl_DecompValueString(aStr, aMinDigits);
    }
  }
  r.rMinDigits = aMinDigits.n;
  return r;
};

ScTable.prototype.FillFormula = function (this: ScTable, pSrcCell: ScFormulaCell, nDestCol: SCCOL, nDestRow: SCROW, bLast: boolean): void {
  const rDocument = this.GetDoc();
  const aAddr = new ScAddress(nDestCol, nDestRow, this.GetTab());
  const pDestCell = pSrcCell.Clone(aAddr);
  // SetFormulaCell starts the listening of the new cell (upstream does it after SetNoListening).
  this.CreateColumnIfNotExists(nDestCol).SetFormulaCell(nDestRow, pDestCell);

  if (bLast && pDestCell.GetMatrixFlag() !== ScMatrixMode.NONE) {
    const aOrg = pDestCell.GetMatrixOrigin();
    if (aOrg) {
      if (nDestCol >= aOrg.Col() && nDestRow >= aOrg.Row()) {
        const pOrgCell = rDocument.GetFormulaCell(aOrg);
        if (pOrgCell && pOrgCell.GetMatrixFlag() === ScMatrixMode.Formula) pOrgCell.SetMatColsRows(nDestCol - aOrg.Col() + 1, nDestRow - aOrg.Row() + 1);
        // else: FillFormula: MatrixOrigin no formula cell with ScMatrixMode::Formula
      }
      // else: FillFormula: MatrixOrigin bottom right
    }
    // else: FillFormula: no MatrixOrigin
  }
};

ScTable.prototype.FillAuto = function (this: ScTable, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFillCount: number, eFillDir: FillDir): void {
  if (nFillCount === 0 || !this.ValidColRow(nCol1, nRow1) || !this.ValidColRow(nCol2, nRow2)) return;

  //  Detect direction

  const bVertical = eFillDir === FILL_TO_BOTTOM || eFillDir === FILL_TO_TOP;
  const bPositive = eFillDir === FILL_TO_BOTTOM || eFillDir === FILL_TO_RIGHT;

  // loop variables: rInner is nRow when filling vertically, rOuter nCol
  const pos: ColRow = { nCol: 0, nRow: 0 };
  const getInner = () => (bVertical ? pos.nRow : pos.nCol);
  const setInner = (v: number) => { if (bVertical) pos.nRow = v; else pos.nCol = v; };
  const setOuter = (v: number) => { if (bVertical) pos.nCol = v; else pos.nRow = v; };
  let nOStart: number;
  let nOEnd: number;
  let nIStart: number;
  let nIEnd: number;
  let nISrcStart: number;
  let nISrcEnd: number;
  let aFillRange: ScRange;

  if (bVertical) {
    nOStart = nCol1;
    nOEnd = nCol2;
    if (bPositive) {
      nISrcStart = nRow1;
      nISrcEnd = nRow2;
      nIStart = nRow2 + 1;
      nIEnd = nRow2 + nFillCount;
      aFillRange = new ScRange(nCol1, nRow2 + 1, 0, nCol2, nRow2 + nFillCount, 0);
    } else {
      nISrcStart = nRow2;
      nISrcEnd = nRow1;
      nIStart = nRow1 - 1;
      nIEnd = nRow1 - nFillCount;
      aFillRange = new ScRange(nCol1, nRow1 - 1, 0, nCol2, nRow2 - nFillCount, 0);
    }
  } else {
    nOStart = nRow1;
    nOEnd = nRow2;
    if (bPositive) {
      nISrcStart = nCol1;
      nISrcEnd = nCol2;
      nIStart = nCol2 + 1;
      nIEnd = nCol2 + nFillCount;
      aFillRange = new ScRange(nCol2 + 1, nRow1, 0, nCol2 + nFillCount, nRow2, 0);
    } else {
      nISrcStart = nCol2;
      nISrcEnd = nCol1;
      nIStart = nCol1 - 1;
      nIEnd = nCol1 - nFillCount;
      aFillRange = new ScRange(nCol1 - 1, nRow1, 0, nCol1 - nFillCount, nRow2, 0);
    }
  }
  const nIMin = Math.min(nIStart, nIEnd);
  const nIMax = Math.max(nIStart, nIEnd);
  const bHasFiltered = this.IsDataFiltered(aFillRange);

  if (!bHasFiltered) {
    if (bVertical) this.DeleteArea(nCol1, nIMin, nCol2, nIMax, InsertDeleteFlags.AUTOFILL);
    else this.DeleteArea(nIMin, nRow1, nIMax, nRow2, InsertDeleteFlags.AUTOFILL);
  }

  const rDocument = this.GetDoc();
  const pDefPattern = rDocument.GetDefPattern();

  //  execute

  for (let nOuter = nOStart; nOuter <= nOEnd; nOuter++) {
    setOuter(nOuter);

    //  transfer attributes

    let pSrcPattern = pDefPattern;
    let nAtSrc = nISrcStart;
    let pNewItems: ReturnType<typeof pDefPattern.GetItemSet> | null = null;
    let bGetPattern = true;
    setInner(nIStart);
    while (true) {
      // #i53728# with "for (;;)" old solaris/x86 compiler mis-optimizes
      if (!this.ColHidden(pos.nCol) && !this.RowHidden(pos.nRow)) {
        if (bGetPattern) {
          if (bVertical) pSrcPattern = this.GetPattern(pos.nCol, nAtSrc); // rInner&:=nRow, rOuter&:=nCol
          else pSrcPattern = this.GetPattern(nAtSrc, pos.nRow); // rInner&:=nCol, rOuter&:=nRow
          bGetPattern = false;
          // do transfer ATTR_MERGE / ATTR_MERGE_FLAG: keep only the merge flags of
          // ATTR_MERGE_FLAG (other things stored there, like an autofilter button, are dropped)
          const rSet = pSrcPattern.GetItemSet();
          if (rSet.ATTR_MERGE_FLAG !== undefined) {
            const nOldValue = rSet.ATTR_MERGE_FLAG;
            const nOldValueMerge = nOldValue & (1 | 2); // ScMF::Hor | ScMF::Ver
            // keep only the merge flags
            if (nOldValue !== nOldValueMerge) {
              pNewItems = { ...rSet };
              if (nOldValueMerge === 0) delete pNewItems.ATTR_MERGE_FLAG;
              else pNewItems.ATTR_MERGE_FLAG = nOldValueMerge;
            } else pNewItems = null;
          } else pNewItems = null;
        }

        const pStyleSheet = pSrcPattern.GetStyleSheet();

        if (bVertical && nISrcStart === nISrcEnd && !bHasFiltered) {
          //  set all attributes at once (en bloc)
          if (pNewItems || !pSrcPattern.equals(pDefPattern)) {
            //  Default is already present (DeleteArea)
            const nY1 = Math.min(nIStart, nIEnd);
            const nY2 = Math.max(nIStart, nIEnd);
            const rCol = this.CreateColumnIfNotExists(pos.nCol);
            if (pStyleSheet) rCol.ApplyStyleArea(nY1, nY2, pStyleSheet);
            rCol.ApplyPatternArea(nY1, nY2, pNewItems ?? pSrcPattern.GetItemSet());
          }
          break;
        }

        if (bHasFiltered) this.DeleteArea(pos.nCol, pos.nRow, pos.nCol, pos.nRow, InsertDeleteFlags.AUTOFILL);

        if (!pSrcPattern.equals(this.GetPattern(pos.nCol, pos.nRow))) {
          // Transfer template too
          const rCol = this.CreateColumnIfNotExists(pos.nCol);
          if (pStyleSheet) rCol.ApplyStyleArea(pos.nRow, pos.nRow, pStyleSheet);
          //  Use ApplyPattern instead of SetPattern to keep old MergeFlags
          rCol.ApplyPatternArea(pos.nRow, pos.nRow, pNewItems ?? pSrcPattern.GetItemSet());
        }

        if (nAtSrc === nISrcEnd) {
          if (nAtSrc !== nISrcStart) {
            // More than one source cell
            nAtSrc = nISrcStart;
            bGetPattern = true;
          }
        } else if (bPositive) {
          ++nAtSrc;
          bGetPattern = true;
        } else {
          --nAtSrc;
          bGetPattern = true;
        }
      }

      if (getInner() === nIEnd) break;
      if (bPositive) setInner(getInner() + 1);
      else setInner(getInner() - 1);
    }
    pNewItems = null;

    //  Analyse

    const r = bVertical ? this.FillAnalyse(pos.nCol, nRow1, pos.nCol, nRow2, bHasFiltered) : this.FillAnalyse(nCol1, pos.nRow, nCol2, pos.nRow, bHasFiltered);
    const eFillCmd = r.rCmd;
    const eDateCmd = r.rDateCmd;
    let nInc = r.rInc;
    let aDurationInc = r.rDuration;
    const nMinDigits = r.rMinDigits;
    const pListData = r.rListData;
    let nListIndex = r.rListIndex;

    if (pListData) {
      const nListCount = pListData.GetSubCount();
      if (!bPositive) {
        //  nListIndex of FillAnalyse points to the last entry -> adjust
        let nAdjust = nListIndex - (nISrcStart - nISrcEnd) * nInc;
        nAdjust = nAdjust % nListCount;
        if (nAdjust < 0) nAdjust += nListCount;
        nListIndex = nAdjust;
      }

      setInner(nIStart);
      while (true) {
        // #i53728# with "for (;;)" old solaris/x86 compiler mis-optimizes
        if (!this.ColHidden(pos.nCol) && !this.RowHidden(pos.nRow)) {
          if (bPositive) {
            nListIndex += nInc;
            if (nListIndex >= nListCount) nListIndex -= nListCount;
          } else {
            if (nListIndex < nInc) nListIndex += nListCount;
            nListIndex -= nInc;
          }
          this.CreateColumnIfNotExists(pos.nCol).SetRawString(pos.nRow, pListData.GetSubStr(nListIndex));
        }

        if (getInner() === nIEnd) break;
        if (bPositive) setInner(getInner() + 1);
        else setInner(getInner() - 1);
      }
    } else if (eFillCmd === FILL_SIMPLE) {
      // fill with pattern/sample
      this.FillAutoSimple(nISrcStart, nISrcEnd, nIStart, nIEnd, pos, bHasFiltered, bVertical, bPositive);
    } else {
      if (!bPositive) {
        nInc = -nInc;
        aDurationInc = -aDurationInc;
      }
      const nEndVal = nInc >= 0.0 ? MAXDOUBLE : -MAXDOUBLE;
      if (bVertical) this.FillSeries(pos.nCol, nRow1, pos.nCol, nRow2, nFillCount, eFillDir, eFillCmd, eDateCmd, nInc, aDurationInc, nEndVal, nMinDigits, false);
      else this.FillSeries(nCol1, pos.nRow, nCol2, pos.nRow, nFillCount, eFillDir, eFillCmd, eDateCmd, nInc, aDurationInc, nEndVal, nMinDigits, false);
    }
  }
};

ScTable.prototype.IncDate = function (this: ScTable, rVal: number, nDayOfMonth: number, nStep: number, eCmd: FillDateCmd): { rVal: number; nDayOfMonth: number } {
  if (eCmd === FILL_DAY) {
    rVal += nStep;
    return { rVal, nDayOfMonth };
  }

  // class Date limits
  const nMinYear = 1583;
  const nMaxYear = 9956;

  const nInc = Math.trunc(nStep); // upper/lower limits ?
  let aDate = lcl_DateFromSerial(rVal);
  switch (eCmd) {
    case FILL_WEEKDAY:
      {
        aDate.AddDays(nInc);
        const eWeekDay = aDate.GetDayOfWeek();
        if (nInc >= 0) {
          if (eWeekDay === DayOfWeek.SATURDAY) aDate.AddDays(2);
          else if (eWeekDay === DayOfWeek.SUNDAY) aDate.AddDays(1);
        } else {
          if (eWeekDay === DayOfWeek.SATURDAY) aDate.AddDays(-1);
          else if (eWeekDay === DayOfWeek.SUNDAY) aDate.AddDays(-2);
        }
      }
      break;
    case FILL_MONTH:
    case FILL_END_OF_MONTH:
      {
        if (nDayOfMonth === 0) nDayOfMonth = aDate.GetDay(); // init
        let nMonth = aDate.GetMonth();
        let nYear = aDate.GetYear();

        nMonth += nInc;

        if (nInc >= 0) {
          if (nMonth > 12) {
            const nYAdd = Math.trunc((nMonth - 1) / 12);
            nMonth -= nYAdd * 12;
            nYear += nYAdd;
          }
        } else {
          if (nMonth < 1) {
            const nYAdd = 1 - Math.trunc(nMonth / 12); // positive
            nMonth += nYAdd * 12;
            nYear -= nYAdd;
          }
        }

        if (nYear < nMinYear) aDate = new ToolsDate(1, 1, nMinYear);
        else if (nYear > nMaxYear) aDate = new ToolsDate(31, 12, nMaxYear);
        else {
          // Date::SetMonth/SetYear/SetDay; set at once to avoid an invalid intermediate day
          if (eCmd === FILL_END_OF_MONTH) aDate = new ToolsDate(ToolsDate.GetDaysInMonth(nMonth, nYear), nMonth, nYear);
          else aDate = new ToolsDate(Math.min(ToolsDate.GetDaysInMonth(nMonth, nYear), nDayOfMonth), nMonth, nYear);
        }
      }
      break;
    case FILL_YEAR:
      {
        let nYear = aDate.GetYear();
        nYear += nInc;
        if (nYear < nMinYear) aDate = new ToolsDate(1, 1, nMinYear);
        else if (nYear > nMaxYear) aDate = new ToolsDate(31, 12, nMaxYear);
        else aDate.SetYear(nYear);
      }
      break;
    default:
    // added to avoid warnings
  }

  rVal = DateDiff(aDate, aNullDate());
  return { rVal, nDayOfMonth };
};

/** Whether a row (vertical) or column is hidden, with the last position of the hidden run. */
function HiddenRowColumn(pTable: ScTable, nRowColumn: number, bVertical: boolean): { bHidden: boolean; rLastPos: number } {
  if (bVertical) {
    const r = pTable.RowHiddenRange(nRowColumn);
    return { bHidden: r.bHidden, rLastPos: r.nLastRow };
  }
  const bHidden = pTable.ColHidden(nRowColumn);
  return { bHidden, rLastPos: nRowColumn };
}

ScTable.prototype.FillFormulaVertical = function (this: ScTable, rSrcCell: ScFormulaCell, rPos: ColRow, nCol: SCCOL, nRow1: SCROW, nRow2: SCROW): void {
  // rInner is the row position when filling vertically.  Also, when filling
  // across hidden regions, it may create multiple dis-jointed spans of
  // formula cells.

  let bHidden = false;
  let nHiddenLast = -1;

  let nRowStart = -1;
  let nRowEnd = -1;
  const aSpans: { mnRow1: SCROW; mnRow2: SCROW }[] = [];
  if (nRow2 < nRow1) [nRow1, nRow2] = [nRow2, nRow1];
  for (rPos.nRow = nRow1; rPos.nRow <= nRow2; ++rPos.nRow) {
    if (rPos.nRow > nHiddenLast) ({ bHidden, rLastPos: nHiddenLast } = HiddenRowColumn(this, rPos.nRow, true));

    if (bHidden) {
      if (nRowStart >= 0) {
        nRowEnd = rPos.nRow - 1;
        aSpans.push({ mnRow1: nRowStart, mnRow2: nRowEnd });
        nRowStart = -1;
      }
      rPos.nRow = nHiddenLast;
      continue;
    }

    if (nRowStart < 0) nRowStart = rPos.nRow;
  }

  if (nRowStart >= 0) {
    nRowEnd = rPos.nRow - 1;
    aSpans.push({ mnRow1: nRowStart, mnRow2: nRowEnd });
  }

  if (!aSpans.length) return;

  // DeleteRanges and CloneFormulaCell: one clone per row, its references moved.
  const rCol = this.CreateColumnIfNotExists(nCol);
  for (const rSpan of aSpans) {
    rCol.DeleteArea(rSpan.mnRow1, rSpan.mnRow2, InsertDeleteFlags.VALUE | InsertDeleteFlags.DATETIME | InsertDeleteFlags.STRING | InsertDeleteFlags.FORMULA | InsertDeleteFlags.OUTLINE);
    for (let nRow = rSpan.mnRow1; nRow <= rSpan.mnRow2; nRow++) rCol.SetFormulaCell(nRow, rSrcCell.Clone(new ScAddress(nCol, nRow, this.GetTab())));
  }
};

ScTable.prototype.FillSeriesSimple = function (this: ScTable, rSrcCell: ScRefCellValue, rPos: ColRow, nIMin: number, nIMax: number, bVertical: boolean): void {
  let bHidden = false;
  let nHiddenLast = -1;

  if (bVertical) {
    switch (rSrcCell.getType()) {
      case CELLTYPE_FORMULA:
        this.FillFormulaVertical(rSrcCell.getFormula()!, rPos, rPos.nCol, nIMin, nIMax);
        break;
      default:
        for (rPos.nRow = nIMin; rPos.nRow <= nIMax; ++rPos.nRow) {
          if (rPos.nRow > nHiddenLast) ({ bHidden, rLastPos: nHiddenLast } = HiddenRowColumn(this, rPos.nRow, bVertical));

          if (bHidden) {
            rPos.nRow = nHiddenLast;
            continue;
          }

          lcl_Commit(this, rSrcCell, rPos.nCol, rPos.nRow);
        }
    }
  } else {
    switch (rSrcCell.getType()) {
      case CELLTYPE_FORMULA:
        for (rPos.nCol = nIMin; rPos.nCol <= nIMax; ++rPos.nCol) {
          if (rPos.nCol > nHiddenLast) ({ bHidden, rLastPos: nHiddenLast } = HiddenRowColumn(this, rPos.nCol, bVertical));

          if (bHidden) continue;

          this.FillFormula(rSrcCell.getFormula()!, rPos.nCol, rPos.nRow, rPos.nCol === nIMax);
        }
        break;
      default:
        for (rPos.nCol = nIMin; rPos.nCol <= nIMax; ++rPos.nCol) {
          if (rPos.nCol > nHiddenLast) ({ bHidden, rLastPos: nHiddenLast } = HiddenRowColumn(this, rPos.nCol, bVertical));

          if (bHidden) continue;

          lcl_Commit(this, rSrcCell, rPos.nCol, rPos.nRow);
        }
    }
  }
};

ScTable.prototype.FillAutoSimple = function (this: ScTable, nISrcStart: number, nISrcEnd: number, nIStart: number, nIEnd: number, rPos: ColRow, bHasFiltered: boolean, bVertical: boolean, bPositive: boolean): void {
  let nSource = nISrcStart;
  let nDelta: number;
  if (ScFillMode.nScFillModeMouseModifier & KEY_MOD1) nDelta = 0.0;
  else if (bPositive) nDelta = 1.0;
  else nDelta = -1.0;
  let bGetCell = true;
  let bBooleanCell = false;
  let bPercentCell = false;
  let nCellDigits = 0;
  let nHeadNoneTail = 0;
  let nStringValue = 0;
  let aValue = '';
  let aSrcCell = new ScRefCellValue();
  let bIsOrdinalSuffix = false;

  const getInner = () => (bVertical ? rPos.nRow : rPos.nCol);
  const setInner = (v: number) => { if (bVertical) rPos.nRow = v; else rPos.nCol = v; };

  setInner(nIStart);
  while (true) {
    // #i53728# with "for (;;)" old solaris/x86 compiler mis-optimizes
    const bColHidden = this.ColHidden(rPos.nCol);
    const bRowHidden = this.RowHidden(rPos.nRow);

    if (!bColHidden && !bRowHidden) {
      if (bGetCell) {
        if (bVertical) {
          // rInner&:=nRow, rOuter&:=nCol
          aSrcCell = this.GetCellValue(rPos.nCol, nSource);
          if (nISrcStart === nISrcEnd && aSrcCell.getType() === CELLTYPE_FORMULA) {
            this.FillFormulaVertical(aSrcCell.getFormula()!, rPos, rPos.nCol, nIStart, nIEnd);
            return;
          }
          const nFormatType = lcl_FormatType(this, rPos.nCol, nSource);
          bBooleanCell = nFormatType === SvNumFormatType.LOGICAL;
          bPercentCell = nFormatType === SvNumFormatType.PERCENT;
        } else {
          // rInner&:=nCol, rOuter&:=nRow
          aSrcCell = this.GetCellValue(nSource, rPos.nRow);
          const nFormatType = lcl_FormatType(this, nSource, rPos.nRow);
          bBooleanCell = nFormatType === SvNumFormatType.LOGICAL;
          bPercentCell = nFormatType === SvNumFormatType.PERCENT;
        }

        bGetCell = false;
        if (!aSrcCell.isEmpty()) {
          switch (aSrcCell.getType()) {
            case CELLTYPE_STRING:
            case CELLTYPE_EDIT:
              if (aSrcCell.getType() === CELLTYPE_STRING) aValue = aSrcCell.getSharedString()!;
              else aValue = aSrcCell.getEditText()!.GetString();
              if (!(ScFillMode.nScFillModeMouseModifier & KEY_MOD1) && !bHasFiltered) {
                const aDigits = { n: 0 }; // look at each source cell individually
                const d = lcl_DecompValueString(aValue, aDigits);
                nCellDigits = aDigits.n;
                nHeadNoneTail = d.nFlag;
                nStringValue = d.nVal;
                aValue = d.rValue;

                bIsOrdinalSuffix = aValue === GetOrdinalSuffix(nStringValue);
              }
              break;
            default:
            // added to avoid warnings
          }
        }
      }

      switch (aSrcCell.getType()) {
        case CELLTYPE_VALUE:
          {
            let fVal: number;
            const rCol = this.CreateColumnIfNotExists(rPos.nCol);
            if (bBooleanCell && ((fVal = aSrcCell.getDouble()) === 0.0 || fVal === 1.0)) rCol.SetValue(rPos.nRow, aSrcCell.getDouble());
            else if (bPercentCell) rCol.SetValue(rPos.nRow, aSrcCell.getDouble() + nDelta * 0.01); // tdf#89998 increment by 1% at a time
            else rCol.SetValue(rPos.nRow, aSrcCell.getDouble() + nDelta);
          }
          break;
        case CELLTYPE_STRING:
        case CELLTYPE_EDIT:
          if (nHeadNoneTail) {
            let nNextValue: number;
            if (nStringValue < 0) nNextValue = nStringValue - Math.trunc(nDelta);
            else nNextValue = nStringValue + Math.trunc(nDelta);

            if (nHeadNoneTail < 0) {
              setSuffixCell(this.CreateColumnIfNotExists(rPos.nCol), rPos.nRow, nNextValue, nCellDigits, aValue, aSrcCell.getType(), bIsOrdinalSuffix);
            } else {
              let aStr: string;
              if (nHeadNoneTail === 2 && nNextValue >= 0) aStr = aValue + '+' + lcl_ValueString(nNextValue, nCellDigits); // Put back the '+'
              else aStr = aValue + lcl_ValueString(nNextValue, nCellDigits);

              this.CreateColumnIfNotExists(rPos.nCol).SetRawString(rPos.nRow, aStr);
            }
          } else lcl_Commit(this, aSrcCell, rPos.nCol, rPos.nRow);

          break;
        case CELLTYPE_FORMULA:
          this.FillFormula(aSrcCell.getFormula()!, rPos.nCol, rPos.nRow, getInner() === nIEnd);
          break;
        default:
        // added to avoid warnings
      }

      if (nSource === nISrcEnd) {
        if (nSource !== nISrcStart) {
          // More than one source cell
          nSource = nISrcStart;
          bGetCell = true;
        }
        if (!(ScFillMode.nScFillModeMouseModifier & KEY_MOD1)) {
          if (bPositive) nDelta += 1.0;
          else nDelta -= 1.0;
        }
      } else if (bPositive) {
        ++nSource;
        bGetCell = true;
      } else {
        --nSource;
        bGetCell = true;
      }
    }

    if (getInner() === nIEnd) break;
    if (bPositive) setInner(getInner() + 1);
    else setInner(getInner() - 1);
  }
};

/** Target value exceeded? */
function isOverflow(rVal: number, rMax: number, rStep: number, rStartVal: number, eFillCmd: FillCmd): boolean {
  switch (eFillCmd) {
    case FILL_LINEAR:
    case FILL_DATE:
      if (rStep >= 0.0) return rVal > rMax;
      else return rVal < rMax;
    case FILL_GROWTH:
      if (rStep > 0.0) {
        if (rStep >= 1.0) {
          // Growing away from zero, including zero growth (1.0).
          if (rVal >= 0.0) return rVal > rMax;
          else return rVal < rMax;
        } else {
          // Shrinking towards zero.
          if (rVal >= 0.0) return rVal < rMax;
          else return rVal > rMax;
        }
      } else if (rStep < 0.0) {
        // Alternating positive and negative values.
        if (rStep <= -1.0) {
          // Growing away from zero, including zero growth (-1.0).
          if (rVal >= 0.0) {
            if (rMax >= 0.0) return rVal > rMax;
            // Regard negative rMax as lower limit, which will
            // be reached only by a negative rVal.
            else return false;
          } else {
            if (rMax <= 0.0) return rVal < rMax;
            // Regard positive rMax as upper limit, which will
            // be reached only by a positive rVal.
            else return false;
          }
        } else {
          // Shrinking towards zero.
          if (rVal >= 0.0) return rVal < rMax;
          else return rVal > rMax;
        }
      } else {
        // if (rStep == 0.0)
        // All values become zero.
        // Corresponds with bEntireArea in FillSeries().
        if (rMax > 0.0) return rMax < rStartVal;
        else if (rMax < 0.0) return rStartVal < rMax;
      }
      break;
    default:
      throw new Error('eFillCmd');
  }
  return false;
}

ScTable.prototype.FillSeries = function (this: ScTable, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFillCount: number, eFillDir: FillDir, eFillCmd: FillCmd, eFillDateCmd: FillDateCmd,
  nStepValue: number, fDurationStep: number, nMaxValue: number, nArgMinDigits: number, bAttribs: boolean): void {
  // The term 'inner' here refers to the loop in the filling direction i.e.
  // when filling vertically, the inner position is the row position whereas
  // when filling horizontally the column position becomes the inner
  // position. The term 'outer' refers to the column position when filling
  // vertically, or the row position when filling horizontally. The fill is
  // performed once in each 'outer' position e.g. when filling vertically,
  // we perform the fill once in each column.

  //  Detect direction

  const bVertical = eFillDir === FILL_TO_BOTTOM || eFillDir === FILL_TO_TOP;
  const bPositive = eFillDir === FILL_TO_BOTTOM || eFillDir === FILL_TO_RIGHT;

  const pos: ColRow = { nCol: 0, nRow: 0 };
  const getInner = () => (bVertical ? pos.nRow : pos.nCol);
  const setInner = (v: number) => { if (bVertical) pos.nRow = v; else pos.nCol = v; };
  const setOuter = (v: number) => { if (bVertical) pos.nCol = v; else pos.nRow = v; };
  let nOStart: number;
  let nOEnd: number;
  let nIStart: number;
  let nIEnd: number;
  let nISource: number;
  let aFillRange: ScRange;
  const nTab = this.GetTab();

  if (bVertical) {
    nFillCount += nRow2 - nRow1;
    if (nFillCount === 0) return;
    nOStart = nCol1;
    nOEnd = nCol2;
    if (bPositive) {
      // downward fill
      nISource = nRow1; // top row of the source range.
      nIStart = nRow1 + 1; // first row where we start filling.
      nIEnd = nRow1 + nFillCount;
      aFillRange = new ScRange(nCol1, nRow1 + 1, nTab, nCol2, nRow1 + nFillCount, nTab);
    } else {
      // upward fill
      nISource = nRow2;
      nIStart = nRow2 - 1;
      nIEnd = nRow2 - nFillCount;
      aFillRange = new ScRange(nCol1, nRow2 - 1, nTab, nCol2, nRow2 - nFillCount, nTab);
    }
  } else {
    nFillCount += nCol2 - nCol1;
    if (nFillCount === 0) return;
    nOStart = nRow1;
    nOEnd = nRow2;
    if (bPositive) {
      // to the right
      nISource = nCol1;
      nIStart = nCol1 + 1;
      nIEnd = nCol1 + nFillCount;
      aFillRange = new ScRange(nCol1 + 1, nRow1, nTab, nCol1 + nFillCount, nRow2, nTab);
    } else {
      // to the left
      nISource = nCol2;
      nIStart = nCol2 - 1;
      nIEnd = nCol2 - nFillCount;
      aFillRange = new ScRange(nCol2 - 1, nRow1, nTab, nCol2 - nFillCount, nRow2, nTab);
    }
  }

  const nIMin = Math.min(nIStart, nIEnd);
  const nIMax = Math.max(nIStart, nIEnd);

  const bIsFiltered = this.IsDataFiltered(aFillRange);
  let bEntireArea = !bIsFiltered && eFillCmd === FILL_SIMPLE;
  if (!bIsFiltered && !bEntireArea && (eFillCmd === FILL_LINEAR || eFillCmd === FILL_GROWTH) && nOEnd - nOStart === 0) {
    // For the usual case of one col/row determine if a numeric series is
    // at least as long as the area to be filled and does not end earlier,
    // so we can treat it as entire area for performance reasons at least
    // in the vertical case.
    let aSrcCell: ScRefCellValue;
    if (bVertical) aSrcCell = this.GetCellValue(nOStart, nISource);
    else aSrcCell = this.GetCellValue(nISource, nOStart);
    // Same logic as for the actual series.
    if (!aSrcCell.isEmpty() && (aSrcCell.getType() === CELLTYPE_VALUE || aSrcCell.getType() === CELLTYPE_FORMULA)) {
      let nStartVal: number;
      if (aSrcCell.getType() === CELLTYPE_VALUE) nStartVal = aSrcCell.getDouble();
      else nStartVal = aSrcCell.getFormula()!.GetValue();
      if (eFillCmd === FILL_LINEAR) {
        if (nStepValue === 0.0) bEntireArea = nStartVal <= nMaxValue; // fill with same value
        else if ((nMaxValue - nStartVal) / nStepValue >= nFillCount) bEntireArea = true;
      } else if (eFillCmd === FILL_GROWTH) {
        if (nStepValue === 1.0) bEntireArea = nStartVal <= nMaxValue; // fill with same value
        else if (nStepValue === -1.0) bEntireArea = Math.abs(nStartVal) <= Math.abs(nMaxValue); // fill with alternating value
        else if (nStepValue === 0.0) bEntireArea = nStartVal === 0.0 || (nStartVal < 0.0 && nMaxValue >= 0.0) || (nStartVal > 0.0 && nMaxValue <= 0.0); // fill with 0.0
      }
    }
  }
  if (bEntireArea) {
    const nDel = bAttribs ? InsertDeleteFlags.AUTOFILL : InsertDeleteFlags.AUTOFILL & InsertDeleteFlags.CONTENTS;
    if (bVertical) this.DeleteArea(nCol1, nIMin, nCol2, nIMax, nDel);
    else this.DeleteArea(nIMin, nRow1, nIMax, nRow2, nDel);
  }

  // Perform the fill once per each 'outer' position i.e. one per column
  // when filling vertically.

  for (let nOuter = nOStart; nOuter <= nOEnd; nOuter++) {
    setOuter(nOuter);
    setInner(nISource);

    this.CreateColumnIfNotExists(pos.nCol);

    // Source cell value. We need to clone the value since it may be inserted repeatedly.
    const aSrcCell = this.GetCellValue(pos.nCol, pos.nRow);

    const pSrcPattern = this.GetPattern(pos.nCol, pos.nRow);
    const SetPatternAreaCondFormat = (nCol: SCCOL, nRowA: SCROW, nRowB: SCROW) => this.CreateColumnIfNotExists(nCol).SetPatternArea(nRowA, nRowB, pSrcPattern);

    if (bAttribs) {
      if (bVertical) {
        // If entire area (not filtered and simple fill) use the faster
        // method, else hidden cols/rows should be skipped and series
        // fill needs to determine the end row dynamically.
        if (bEntireArea) SetPatternAreaCondFormat(pos.nCol, nIMin, nIMax);
        else if (eFillCmd === FILL_SIMPLE) {
          for (let nAtRow = nIMin; nAtRow <= nIMax; ++nAtRow) if (!this.RowHidden(nAtRow)) SetPatternAreaCondFormat(pos.nCol, nAtRow, nAtRow);
        }
      } else if (bEntireArea || eFillCmd === FILL_SIMPLE) {
        for (let nAtCol = nIMin; nAtCol <= nIMax; nAtCol++) if (!this.ColHidden(nAtCol)) SetPatternAreaCondFormat(nAtCol, pos.nRow, pos.nRow);
      }
    }

    if (!aSrcCell.isEmpty()) {
      const eCellType = aSrcCell.getType();

      if (eFillCmd === FILL_SIMPLE) {
        // copy
        this.FillSeriesSimple(aSrcCell, pos, nIMin, nIMax, bVertical);
      } else if (eCellType === CELLTYPE_VALUE || eCellType === CELLTYPE_FORMULA) {
        const nStartVal = eCellType === CELLTYPE_VALUE ? aSrcCell.getDouble() : aSrcCell.getFormula()!.GetValue();
        let nVal = nStartVal;
        let nIndex = 0;

        let bError = false;
        let bOverflow = false;
        const bNonEmpty = true;

        let nDayOfMonth = 0;
        setInner(nIStart);
        while (true) {
          if (!this.ColHidden(pos.nCol) && !this.RowHidden(pos.nRow)) {
            if (!bError && bNonEmpty) {
              switch (eFillCmd) {
                case FILL_LINEAR:
                  {
                    //  use multiplication instead of repeated addition
                    //  to avoid accumulating rounding errors
                    nVal = nStartVal;
                    if (fDurationStep) {
                      const aDuration = new Duration(fDurationStep * ++nIndex);
                      const s = SafePlus(nVal, aDuration.GetInDays());
                      nVal = s.v;
                      bError = bError || !s.ok;
                    } else {
                      const m = SafeMult(nStepValue, ++nIndex);
                      const s = m.ok ? SafePlus(nVal, m.v) : m;
                      if (!m.ok || !s.ok) bError = true;
                      else nVal = s.v;
                    }
                  }
                  break;
                case FILL_GROWTH: {
                  const m = SafeMult(nVal, nStepValue);
                  if (!m.ok) bError = true;
                  else nVal = m.v;
                  break;
                }
                case FILL_DATE:
                  if (Math.abs(nVal) > D_MAX_LONG_) bError = true;
                  else ({ rVal: nVal, nDayOfMonth } = this.IncDate(nVal, nDayOfMonth, nStepValue, eFillDateCmd));
                  break;
                default:
                // added to avoid warnings
              }

              if (!bError) bOverflow = isOverflow(nVal, nMaxValue, nStepValue, nStartVal, eFillCmd);
            }

            this.CreateColumnIfNotExists(pos.nCol);
            if (bError) lcl_SetError(this, pos.nCol, pos.nRow, FormulaError.NoValue);
            else if (!bOverflow && bNonEmpty) this.CreateColumnIfNotExists(pos.nCol).SetValue(pos.nRow, nVal);

            if (bAttribs && !bEntireArea && !bOverflow) SetPatternAreaCondFormat(pos.nCol, pos.nRow, pos.nRow);
          }

          if (getInner() === nIEnd || bOverflow) break;
          if (bPositive) setInner(getInner() + 1);
          else setInner(getInner() - 1);
        }
      } else if (eCellType === CELLTYPE_STRING || eCellType === CELLTYPE_EDIT) {
        if (nStepValue >= 0) {
          if (nMaxValue >= LONG_MAX) nMaxValue = LONG_MAX - 1;
        } else {
          if (nMaxValue <= LONG_MIN) nMaxValue = LONG_MIN + 1;
        }
        let aValue: string;
        if (eCellType === CELLTYPE_STRING) aValue = aSrcCell.getSharedString()!;
        else aValue = aSrcCell.getEditText()!.GetString();
        const aMinDigits = { n: nArgMinDigits };
        const d = lcl_DecompValueString(aValue, aMinDigits);
        const nHeadNoneTail = d.nFlag;
        let nStringValue = d.nVal;
        aValue = d.rValue;
        const nMinDigits = aMinDigits.n;
        if (nHeadNoneTail) {
          const nStartVal = nStringValue;
          let nVal = nStartVal;
          let nIndex = 0;
          let bError = false;
          let bOverflow = false;
          const bNonEmpty = true;

          const bIsOrdinalSuffix = aValue === GetOrdinalSuffix(Math.trunc(nStartVal));

          setInner(nIStart);
          while (true) {
            if (!this.ColHidden(pos.nCol) && !this.RowHidden(pos.nRow)) {
              if (!bError && bNonEmpty) {
                switch (eFillCmd) {
                  case FILL_LINEAR:
                    {
                      //  use multiplication instead of repeated addition
                      //  to avoid accumulating rounding errors
                      nVal = nStartVal;
                      if (fDurationStep) {
                        const aDuration = new Duration(fDurationStep * ++nIndex);
                        const s = SafePlus(nVal, aDuration.GetInDays());
                        nVal = s.v;
                        bError = bError || !s.ok;
                      } else {
                        const m = SafeMult(nStepValue, ++nIndex);
                        const s = m.ok ? SafePlus(nVal, m.v) : m;
                        if (!m.ok || !s.ok) bError = true;
                        else nVal = s.v;
                      }
                    }
                    break;
                  case FILL_GROWTH: {
                    const m = SafeMult(nVal, nStepValue);
                    if (!m.ok) bError = true;
                    else nVal = m.v;
                    break;
                  }
                  default:
                  // added to avoid warnings
                }

                if (!bError) bOverflow = isOverflow(nVal, nMaxValue, nStepValue, nStartVal, eFillCmd);
              }

              if (bError) lcl_SetError(this, pos.nCol, pos.nRow, FormulaError.NoValue);
              else if (!bOverflow && bNonEmpty) {
                nStringValue = Math.trunc(nVal);
                if (nHeadNoneTail < 0) {
                  setSuffixCell(this.CreateColumnIfNotExists(pos.nCol), pos.nRow, nStringValue, nMinDigits, aValue, eCellType, bIsOrdinalSuffix);
                } else {
                  let aStr: string;
                  if (nHeadNoneTail === 2 && nStringValue >= 0) aStr = aValue + '+'; // Put back the '+'
                  else aStr = aValue;
                  aStr += lcl_ValueString(nStringValue, nMinDigits);
                  this.CreateColumnIfNotExists(pos.nCol).SetRawString(pos.nRow, aStr);
                }
              }

              if (bAttribs && !bEntireArea && !bOverflow) SetPatternAreaCondFormat(pos.nCol, pos.nRow, pos.nRow);
            }

            if (getInner() === nIEnd || bOverflow) break;
            if (bPositive) setInner(getInner() + 1);
            else setInner(getInner() - 1);
          }
        }
      }
    }
  }
};

ScTable.prototype.Fill = function (this: ScTable, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW, nFillCount: number, eFillDir: FillDir, eFillCmd: FillCmd, eFillDateCmd: FillDateCmd,
  nStepValue: number, fDurationStep: number, nMaxValue: number): void {
  if (eFillCmd === FILL_AUTO) this.FillAuto(nCol1, nRow1, nCol2, nRow2, nFillCount, eFillDir);
  else this.FillSeries(nCol1, nRow1, nCol2, nRow2, nFillCount, eFillDir, eFillCmd, eFillDateCmd, nStepValue, fDurationStep, nMaxValue, 0, true);
};

