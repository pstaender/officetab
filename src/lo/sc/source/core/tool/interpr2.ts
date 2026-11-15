// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/interpr2.cxx partial
// Date and time, the rounding functions and other math, the financial functions and the
// reference operators (intersection, range, union). Function families are added between the
// section markers below.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import { svDoubleRef, svRefList, svSingleRef, svUnknown, type FormulaToken } from '../../../../formula/source/core/api/token.ts';
import { ScComplexRefData } from '../../../inc/refdata.ts';
import { ScInterpreter } from './interpr4.ts';
import { approxCeil, approxFloor, approxSub, round as rtl_math_round, rtl_math_RoundingMode as eMathRoundingMode } from '../../../../sal/rtl/math.ts';
import { GetUnitConverter } from './unitconv.ts';
import { svDouble, svMatrix } from '../../../../formula/source/core/api/token.ts';
import { approxEqual } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, IsNumberFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { Date, DateDiff, DayOfWeek } from '../../../../tools/source/datetime/tdate.ts';
import { Duration } from '../../../../tools/source/datetime/duration.ts';
import { Time } from '../../../../tools/source/datetime/ttime.ts';
import type { ScRange } from '../../../inc/address.ts';
import { div } from '../../../inc/math.ts';
import { ScValueIterator } from '../data/dociter.ts';
import { KahanSum } from './kahan.ts';
import type { ScMatrix } from './scmatrix.ts';
import { ScDoubleRefToken, ScRefListToken, ScSingleRefToken, extendRangeReference, type ScRefList } from './token.ts';

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScIntersect(): void;
    ScRangeFunc(): void;
    ScUnionFunc(): void;
    ScCurrent(): void;
    ValidateRef(rRefList: ScRefList): void;
  }
}

// --- Date and Time --------------------------------------------------------------------------------
// The interpreter context's number formatter calls (NFGetNullDate, NFExpandTwoDigitYear,
// NFIsNumberFormat) read the document's options and the reduced en-US input scanner.

declare module './interpr4.ts' {
  interface ScInterpreter {
    GetDateSerial(nYear: number, nMonth: number, nDay: number, bStrict: boolean): number;
    ScGetActDate(): void;
    ScGetActTime(): void;
    ScGetYear(): void;
    ScGetMonth(): void;
    ScGetDay(): void;
    ScGetMin(): void;
    ScGetSec(): void;
    ScGetHour(): void;
    ScGetDateValue(): void;
    ScGetDayOfWeek(): void;
    ScWeeknumOOo(): void;
    ScGetWeekOfYear(): void;
    ScGetIsoWeekOfYear(): void;
    ScEasterSunday(): void;
    GetWeekendAndHolidayMasks(nParamCount: number, nNullDate: number, rSortArray: number[], bWeekendMask: boolean[]): FormulaError;
    GetWeekendAndHolidayMasks_MS(nParamCount: number, nNullDate: number, rSortArray: number[], bWeekendMask: boolean[], bWorkdayFunction: boolean): FormulaError;
    ScNetWorkdays(bOOXML_Version: boolean): void;
    ScWorkday_MS(): void;
    ScGetDate(): void;
    ScGetTime(): void;
    ScGetDiffDate(): void;
    ScGetDiffDate360(): void;
    ScGetDateDif(): void;
    ScGetTimeValue(): void;
  }
}

const SAL_MAX_INT32 = 2147483647;
const { MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY } = DayOfWeek;

/** sc/inc/globalnames.hxx */
const DATE_TIME_FACTOR = 86400.0;

/** static_cast<sal_Int16>: wrap to 16 bits. */
const sal_Int16 = (n: number): number => ((Math.trunc(n) + 32768) & 0xffff) - 32768;

/** ScInterpreterContext::NFGetNullDate: the document's null date. */
function NFGetNullDate(self: ScInterpreter): Date {
  const d = self.mrDoc.GetDocOptions().GetDate();
  return new Date(d.nDay, d.nMonth, d.nYear);
}

/** ScInterpreterContext::NFExpandTwoDigitYear (SvNumberFormatter::ExpandTwoDigitYear with the
    document's two-digit year start). The year is a sal_uInt16 there: a negative year is
    returned unchanged. */
function NFExpandTwoDigitYear(self: ScInterpreter, nYear: number): number {
  const nTwoDigitYearStart = self.mrDoc.GetDocOptions().GetYear2000();
  if (nYear >= 0 && nYear < 100) {
    if (nYear < nTwoDigitYearStart % 100) return nYear + (Math.trunc(nTwoDigitYearStart / 100) + 1) * 100;
    else return nYear + Math.trunc(nTwoDigitYearStart / 100) * 100;
  }
  return nYear;
}

/** ScInterpreter::GetDayOfWeek: monday = 0, ..., sunday = 6 */
function GetDayOfWeek(n: number): number {
  return (n - 1) % 7;
}

ScInterpreter.prototype.GetDateSerial = function (this: ScInterpreter, nYear: number, nMonth: number, nDay: number, bStrict: boolean): number {
  if (nYear < 100 && !bStrict) nYear = NFExpandTwoDigitYear(this, nYear);
  // Do not use a default Date ctor here because it asks system time with a
  // performance penalty.
  let nY: number, nM: number, nD: number;
  if (bStrict) {
    nY = nYear;
    nM = nMonth;
    nD = nDay;
  } else {
    if (nMonth > 0) {
      nY = sal_Int16(nYear + Math.trunc((nMonth - 1) / 12));
      nM = ((nMonth - 1) % 12) + 1;
    } else {
      nY = sal_Int16(nYear + Math.trunc((nMonth - 12) / 12));
      nM = 12 - (-nMonth % 12);
    }
    nD = 1;
  }
  const aDate = new Date(nD, nM, nY);
  if (!bStrict) aDate.AddDays(nDay - 1);
  if (aDate.IsValidAndGregorian()) return DateDiff(aDate, NFGetNullDate(this));
  else {
    this.SetError(FormulaError.NoValue);
    return 0;
  }
};

ScInterpreter.prototype.ScGetActDate = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.DATE;
  const aNow = this.mrDoc.GetCalcNow();
  const aActDate = new Date(aNow.getDate(), aNow.getMonth() + 1, aNow.getFullYear()); // Date::SYSTEM
  const nDiff = DateDiff(aActDate, NFGetNullDate(this));
  this.PushDouble(nDiff);
};

ScInterpreter.prototype.ScGetActTime = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.DATETIME;
  const aActTime = this.mrDoc.GetCalcNow(); // DateTime::SYSTEM
  const nDiff = DateDiff(new Date(aActTime.getDate(), aActTime.getMonth() + 1, aActTime.getFullYear()), NFGetNullDate(this));
  const fTime = aActTime.getHours() / Time.hourPerDay + aActTime.getMinutes() / Time.minutePerDay + aActTime.getSeconds() / Time.secondPerDay + (aActTime.getMilliseconds() * 1000000) / Time.nanoSecPerDay;
  this.PushDouble(nDiff + fTime);
};

ScInterpreter.prototype.ScGetYear = function (this: ScInterpreter): void {
  const aDate = NFGetNullDate(this);
  aDate.AddDays(this.GetFloor32());
  this.PushDouble(aDate.GetYear());
};

ScInterpreter.prototype.ScGetMonth = function (this: ScInterpreter): void {
  const aDate = NFGetNullDate(this);
  aDate.AddDays(this.GetFloor32());
  this.PushDouble(aDate.GetMonth());
};

ScInterpreter.prototype.ScGetDay = function (this: ScInterpreter): void {
  const aDate = NFGetNullDate(this);
  if (aDate.CheckedAddDays(this.GetFloor32())) this.PushDouble(aDate.GetDay());
  else {
    this.SetError(FormulaError.IllegalArgument);
    this.PushDouble(Infinity);
  }
};

ScInterpreter.prototype.ScGetMin = function (this: ScInterpreter): void {
  const { nMinute } = Time.GetClock(this.GetDouble(), 0);
  this.PushDouble(nMinute);
};

ScInterpreter.prototype.ScGetSec = function (this: ScInterpreter): void {
  const r = Time.GetClock(this.GetDouble(), 0);
  let nSecond = r.nSecond;
  if (r.fFractionOfSecond >= 0.5) nSecond = (nSecond + 1) % 60;
  this.PushDouble(nSecond);
};

ScInterpreter.prototype.ScGetHour = function (this: ScInterpreter): void {
  const { nHour } = Time.GetClock(this.GetDouble(), 0);
  this.PushDouble(nHour);
};

ScInterpreter.prototype.ScGetDateValue = function (this: ScInterpreter): void {
  const aInputString = this.GetString();
  // for a default country/language
  const r = IsNumberFormat(aInputString, 'en-US');
  if (r) {
    const fVal = r.value;
    const eType = NFGetType(r.code, 'en-US');
    if (eType === SvNumFormatType.DATE || eType === SvNumFormatType.DATETIME) {
      this.nFuncFmtType = SvNumFormatType.DATE;
      this.PushDouble(approxFloor(fVal));
    } else this.PushIllegalArgument();
  } else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScGetDayOfWeek = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let nFlag: number;
  if (nParamCount === 2) nFlag = this.GetInt16();
  else nFlag = 1;

  const aDate = NFGetNullDate(this);
  aDate.AddDays(this.GetFloor32());
  let nVal: number = aDate.GetDayOfWeek(); // MONDAY = 0
  switch (nFlag) {
    case 1: // Sunday = 1
      if (nVal === 6) nVal = 1;
      else nVal += 2;
      break;
    case 2: // Monday = 1
      nVal += 1;
      break;
    case 3: // Monday = 0
      // nothing
      break;
    case 11: // Monday = 1
    case 12: // Tuesday = 1
    case 13: // Wednesday = 1
    case 14: // Thursday = 1
    case 15: // Friday = 1
    case 16: // Saturday = 1
    case 17: // Sunday = 1
      if (nVal < nFlag - 11)
        // x = nFlag - 11 = 0,1,2,3,4,5,6
        nVal += 19 - nFlag; // nVal += (8 - (nFlag - 11) = 8 - x = 8,7,6,5,4,3,2)
      else nVal -= nFlag - 12; // nVal -= ((nFlag - 11) - 1 = x - 1 = -1,0,1,2,3,4,5)
      break;
    default:
      this.SetError(FormulaError.IllegalArgument);
  }
  this.PushInt(nVal);
};

ScInterpreter.prototype.ScWeeknumOOo = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const nFlag = this.GetInt16();

    const aDate = NFGetNullDate(this);
    aDate.AddDays(this.GetFloor32());
    this.PushInt(aDate.GetWeekOfYear(nFlag === 1 ? SUNDAY : MONDAY));
  }
};

ScInterpreter.prototype.ScGetWeekOfYear = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  const nFlag = nParamCount === 1 ? 1 : this.GetInt16WithDefault(1);

  const aDate = NFGetNullDate(this);
  aDate.AddDays(this.GetFloor32());

  let nMinimumNumberOfDaysInWeek: number;
  let eFirstDayOfWeek: DayOfWeek;
  switch (nFlag) {
    case 1:
      eFirstDayOfWeek = SUNDAY;
      nMinimumNumberOfDaysInWeek = 1;
      break;
    case 2:
      eFirstDayOfWeek = MONDAY;
      nMinimumNumberOfDaysInWeek = 1;
      break;
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
      eFirstDayOfWeek = (nFlag - 11) as DayOfWeek; // MONDAY := 0
      nMinimumNumberOfDaysInWeek = 1; //the week containing January 1 is week 1
      break;
    case 21:
    case 150:
      // ISO 8601
      eFirstDayOfWeek = MONDAY;
      nMinimumNumberOfDaysInWeek = 4;
      break;
    default:
      this.PushIllegalArgument();
      return;
  }
  this.PushInt(aDate.GetWeekOfYear(eFirstDayOfWeek, nMinimumNumberOfDaysInWeek));
};

ScInterpreter.prototype.ScGetIsoWeekOfYear = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 1)) {
    const aDate = NFGetNullDate(this);
    aDate.AddDays(this.GetFloor32());
    this.PushInt(aDate.GetWeekOfYear());
  }
};

ScInterpreter.prototype.ScEasterSunday = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.DATE;
  if (!this.MustHaveParamCount(this.GetByte(), 1)) return;

  let nYear = this.GetInt16();
  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }
  if (nYear < 100) nYear = NFExpandTwoDigitYear(this, nYear);
  if (nYear < 1583 || nYear > 9956) {
    // Valid Gregorian and maximum year constraints not met.
    this.PushIllegalArgument();
    return;
  }
  // don't worry, be happy :)
  const N = nYear % 19;
  const B = Math.trunc(nYear / 100);
  const C = nYear % 100;
  const D = Math.trunc(B / 4);
  const E = B % 4;
  const F = Math.trunc((B + 8) / 25);
  const G = Math.trunc((B - F + 1) / 3);
  const H = (19 * N + B - D - G + 15) % 30;
  const I = Math.trunc(C / 4);
  const K = C % 4;
  const L = (32 + 2 * E + 2 * I - H - K) % 7;
  const M = Math.trunc((N + 11 * H + 22 * L) / 451);
  const O = H + L - 7 * M + 114;
  const nDay = (O % 31) + 1;
  const nMonth = Math.trunc(O / 31);
  this.PushDouble(this.GetDateSerial(nYear, nMonth, nDay, true));
};

ScInterpreter.prototype.GetWeekendAndHolidayMasks = function (this: ScInterpreter, nParamCount: number, nNullDate: number, rSortArray: number[], bWeekendMask: boolean[]): FormulaError {
  if (nParamCount === 4) {
    const nWeekendDays: number[] = [];
    this.GetNumberSequenceArray(1, nWeekendDays, false);
    if (this.nGlobalError !== FormulaError.NONE) return this.nGlobalError;
    else {
      if (nWeekendDays.length !== 7) return FormulaError.IllegalArgument;

      // Weekend days defined by string, Sunday...Saturday
      for (let i = 0; i < 7; i++) bWeekendMask[i] = !!nWeekendDays[i === 6 ? 0 : i + 1];
    }
  } else {
    for (let i = 0; i < 7; i++) bWeekendMask[i] = false;

    bWeekendMask[SATURDAY] = true;
    bWeekendMask[SUNDAY] = true;
  }

  if (nParamCount >= 3) {
    this.GetSortArray(1, rSortArray, null, true, true);
    const nMax = rSortArray.length;
    for (let i = 0; i < nMax; i++) rSortArray[i] = approxFloor(rSortArray[i]!) + nNullDate;
  }

  return this.nGlobalError;
};

ScInterpreter.prototype.GetWeekendAndHolidayMasks_MS = function (this: ScInterpreter, nParamCount: number, nNullDate: number, rSortArray: number[], bWeekendMask: boolean[], bWorkdayFunction: boolean): FormulaError {
  let nErr: FormulaError = FormulaError.NONE;
  let aWeekendDays = '';
  if (nParamCount === 4) {
    this.GetSortArray(1, rSortArray, null, true, true);
    const nMax = rSortArray.length;
    for (let i = 0; i < nMax; i++) rSortArray[i] = approxFloor(rSortArray[i]!) + nNullDate;
  }

  if (nParamCount >= 3) {
    if (this.IsMissing()) this.Pop();
    else {
      switch (this.GetStackType()) {
        case svDoubleRef:
          return FormulaError.NoValue;

        default: {
          const { bDouble, fVal: fDouble, aStr: aSharedString } = this.GetDoubleOrString();
          if (bDouble) {
            if (fDouble >= 1.0 && fDouble <= 17) aWeekendDays = String(fDouble);
            else return FormulaError.NoValue;
          } else {
            if (!aSharedString || aSharedString.length !== 7 || (bWorkdayFunction && aSharedString === '1111111')) return FormulaError.NoValue;
            else aWeekendDays = aSharedString;
          }
          break;
        }
      }
    }
  }

  for (let i = 0; i < 7; i++) bWeekendMask[i] = false;

  if (!aWeekendDays) {
    bWeekendMask[SATURDAY] = true;
    bWeekendMask[SUNDAY] = true;
  } else {
    switch (aWeekendDays.length) {
      case 1:
        // Weekend days defined by code
        switch (aWeekendDays[0]) {
          case '1': bWeekendMask[SATURDAY] = true; bWeekendMask[SUNDAY] = true; break;
          case '2': bWeekendMask[SUNDAY] = true; bWeekendMask[MONDAY] = true; break;
          case '3': bWeekendMask[MONDAY] = true; bWeekendMask[TUESDAY] = true; break;
          case '4': bWeekendMask[TUESDAY] = true; bWeekendMask[WEDNESDAY] = true; break;
          case '5': bWeekendMask[WEDNESDAY] = true; bWeekendMask[THURSDAY] = true; break;
          case '6': bWeekendMask[THURSDAY] = true; bWeekendMask[FRIDAY] = true; break;
          case '7': bWeekendMask[FRIDAY] = true; bWeekendMask[SATURDAY] = true; break;
          default: nErr = FormulaError.IllegalArgument; break;
        }
        break;
      case 2:
        // Weekend day defined by code
        if (aWeekendDays[0] === '1') {
          switch (aWeekendDays[1]) {
            case '1': bWeekendMask[SUNDAY] = true; break;
            case '2': bWeekendMask[MONDAY] = true; break;
            case '3': bWeekendMask[TUESDAY] = true; break;
            case '4': bWeekendMask[WEDNESDAY] = true; break;
            case '5': bWeekendMask[THURSDAY] = true; break;
            case '6': bWeekendMask[FRIDAY] = true; break;
            case '7': bWeekendMask[SATURDAY] = true; break;
            default: nErr = FormulaError.IllegalArgument; break;
          }
        } else nErr = FormulaError.IllegalArgument;
        break;
      case 7:
        // Weekend days defined by string
        for (let i = 0; i < 7 && nErr === FormulaError.NONE; i++) {
          switch (aWeekendDays[i]) {
            case '0': bWeekendMask[i] = false; break;
            case '1': bWeekendMask[i] = true; break;
            default: nErr = FormulaError.IllegalArgument; break;
          }
        }
        break;
      default:
        nErr = FormulaError.IllegalArgument;
        break;
    }
  }
  return nErr;
};

ScInterpreter.prototype.ScNetWorkdays = function (this: ScInterpreter, bOOXML_Version: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 4)) return;

  const nSortArray: number[] = [];
  const bWeekendMask: boolean[] = new Array<boolean>(7).fill(false);
  const rNullDate = NFGetNullDate(this);
  const nNullDate = rNullDate.GetAsNormalizedDays();
  let nErr: FormulaError;
  if (bOOXML_Version) {
    nErr = this.GetWeekendAndHolidayMasks_MS(nParamCount, nNullDate, nSortArray, bWeekendMask, false);
  } else {
    nErr = this.GetWeekendAndHolidayMasks(nParamCount, nNullDate, nSortArray, bWeekendMask);
  }
  if (nErr !== FormulaError.NONE) this.PushError(nErr);
  else {
    let nDate2 = this.GetFloor32();
    let nDate1 = this.GetFloor32();
    if (this.nGlobalError !== FormulaError.NONE || nDate1 > SAL_MAX_INT32 - nNullDate || nDate2 > SAL_MAX_INT32 - nNullDate) {
      this.PushIllegalArgument();
      return;
    }
    nDate2 += nNullDate;
    nDate1 += nNullDate;

    let nCnt = 0;
    let nRef = 0;
    const bReverse = nDate1 > nDate2;
    if (bReverse) [nDate1, nDate2] = [nDate2, nDate1];
    const nMax = nSortArray.length;
    while (nDate1 <= nDate2) {
      if (!bWeekendMask[GetDayOfWeek(nDate1)]) {
        while (nRef < nMax && nSortArray[nRef]! < nDate1) nRef++;
        if (nRef >= nMax || nSortArray[nRef] !== nDate1) nCnt++;
      }
      ++nDate1;
    }
    this.PushDouble(bReverse ? -nCnt : nCnt);
  }
};

ScInterpreter.prototype.ScWorkday_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 4)) return;

  this.nFuncFmtType = SvNumFormatType.DATE;
  const nSortArray: number[] = [];
  const bWeekendMask: boolean[] = new Array<boolean>(7).fill(false);
  const rNullDate = NFGetNullDate(this);
  const nNullDate = rNullDate.GetAsNormalizedDays();
  const nErr = this.GetWeekendAndHolidayMasks_MS(nParamCount, nNullDate, nSortArray, bWeekendMask, true);
  if (nErr !== FormulaError.NONE) this.PushError(nErr);
  else {
    let nDays = this.GetFloor32();
    let nDate = this.GetFloor32();
    if (this.nGlobalError !== FormulaError.NONE || nDate > SAL_MAX_INT32 - nNullDate) {
      this.PushIllegalArgument();
      return;
    }
    nDate += nNullDate;

    if (!nDays) this.PushDouble(nDate - nNullDate);
    else {
      const nMax = nSortArray.length;
      if (nDays > 0) {
        let nRef = 0;
        while (nDays) {
          do {
            ++nDate;
          } while (bWeekendMask[GetDayOfWeek(nDate)]); //jump over weekend day(s)

          while (nRef < nMax && nSortArray[nRef]! < nDate) nRef++;

          if (nRef >= nMax || nSortArray[nRef] !== nDate) nDays--;
        }
      } else {
        let nRef = nMax - 1;
        while (nDays) {
          do {
            --nDate;
          } while (bWeekendMask[GetDayOfWeek(nDate)]); //jump over weekend day(s)

          while (nRef >= 0 && nSortArray[nRef]! > nDate) nRef--;

          if (nRef < 0 || nSortArray[nRef] !== nDate) nDays++;
        }
      }
      this.PushDouble(nDate - nNullDate);
    }
  }
};

ScInterpreter.prototype.ScGetDate = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.DATE;
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const nDay = this.GetInt16();
  const nMonth = this.GetInt16();
  if (this.IsMissing()) this.SetError(FormulaError.ParameterExpected); // Year must be given.
  const nYear = this.GetInt16();
  if (this.nGlobalError !== FormulaError.NONE || nYear < 0) this.PushIllegalArgument();
  else this.PushDouble(this.GetDateSerial(nYear, nMonth, nDay, false));
};

ScInterpreter.prototype.ScGetTime = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.TIME;
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const fSec = this.GetDouble();
    const fMin = this.GetDouble();
    const fHour = this.GetDouble();
    const fTime = ((fHour * Time.secondPerHour + fMin * Time.secondPerMinute + fSec) % DATE_TIME_FACTOR) / DATE_TIME_FACTOR;
    if (fTime < 0) this.PushIllegalArgument();
    else this.PushDouble(fTime);
  }
};

ScInterpreter.prototype.ScGetDiffDate = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const fDate2 = this.GetDouble();
    const fDate1 = this.GetDouble();
    this.PushDouble(fDate1 - fDate2);
  }
};

ScInterpreter.prototype.ScGetDiffDate360 = function (this: ScInterpreter): void {
  /* Implementation follows
   * http://www.bondmarkets.com/eCommerce/SMD_Fields_030802.pdf
   * Appendix B: Day-Count Bases, there are 7 different ways to calculate the
   * 30-days count. That document also claims that Excel implements the "PSA
   * 30" or "NASD 30" method (funny enough they also state that Excel is the
   * only tool that does so).
   *
   * Note that the definition given in
   * http://msdn.microsoft.com/library/en-us/office97/html/SEB7C.asp
   * is _not_ the way how it is actually calculated by Excel (that would not
   * even match any of the 7 methods mentioned above) and would result in the
   * following test cases producing wrong results according to that appendix B:
   *
   * 28-Feb-95  31-Aug-95  181 instead of 180
   * 29-Feb-96  31-Aug-96  181 instead of 180
   * 30-Jan-96  31-Mar-96   61 instead of  60
   * 31-Jan-96  31-Mar-96   61 instead of  60
   *
   * Still, there is a difference between OOoCalc and Excel:
   * In Excel:
   * 02-Feb-99 31-Mar-00 results in  419
   * 31-Mar-00 02-Feb-99 results in -418
   * In Calc the result is 419 respectively -419. I consider the -418 a bug in Excel.
   */

  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  const bFlag = nParamCount === 3 && this.GetBool();
  let nDate2 = this.GetFloor32();
  let nDate1 = this.GetFloor32();
  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else {
    let nSign: number;
    // #i84934# only for non-US European algorithm swap dates. Else
    // follow Excel's meaningless extrapolation for "interoperability".
    if (bFlag && nDate2 < nDate1) {
      nSign = nDate1;
      nDate1 = nDate2;
      nDate2 = nSign;
      nSign = -1;
    } else nSign = 1;
    const aDate1 = NFGetNullDate(this);
    aDate1.AddDays(nDate1);
    const aDate2 = NFGetNullDate(this);
    aDate2.AddDays(nDate2);
    if (aDate1.GetDay() === 31) aDate1.AddDays(-1);
    else if (!bFlag) {
      if (aDate1.GetMonth() === 2) {
        switch (aDate1.GetDay()) {
          case 28:
            if (!aDate1.IsLeapYear()) aDate1.SetDay(30);
            break;
          case 29:
            aDate1.SetDay(30);
            break;
        }
      }
    }
    if (aDate2.GetDay() === 31) {
      if (!bFlag) {
        if (aDate1.GetDay() === 30) aDate2.AddDays(-1);
      } else aDate2.SetDay(30);
    }
    this.PushDouble(nSign * (aDate2.GetDay() + aDate2.GetMonth() * 30.0 + aDate2.GetYear() * 360.0 - aDate1.GetDay() - aDate1.GetMonth() * 30.0 - aDate1.GetYear() * 360.0));
  }
};

// fdo#44456 function DATEDIF as defined in ODF1.2 (Par. 6.10.3)
ScInterpreter.prototype.ScGetDateDif = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const aInterval = this.GetString().toLowerCase(); // compared with equalsIgnoreAsciiCase
  const nDate2 = this.GetFloor32();
  const nDate1 = this.GetFloor32();

  if (this.nGlobalError !== FormulaError.NONE) {
    this.PushError(this.nGlobalError);
    return;
  }

  // Excel doesn't swap dates or return negative numbers, so don't we.
  if (nDate1 > nDate2) {
    this.PushIllegalArgument();
    return;
  }

  const dd = nDate2 - nDate1;
  // Zero difference or number of days can be returned immediately.
  if (dd === 0.0 || aInterval === 'd') {
    this.PushDouble(dd);
    return;
  }

  // split dates in day, month, year for use with formats other than "d"
  const aDate1 = NFGetNullDate(this);
  aDate1.AddDays(nDate1);
  let y1 = aDate1.GetYear();
  const m1 = aDate1.GetMonth();
  const d1 = aDate1.GetDay();
  const aDate2 = NFGetNullDate(this);
  aDate2.AddDays(nDate2);
  let y2 = aDate2.GetYear();
  const m2 = aDate2.GetMonth();
  const d2 = aDate2.GetDay();

  // Close the year 0 gap to calculate year difference.
  if (y1 < 0 && y2 > 0) ++y1;
  else if (y1 > 0 && y2 < 0) ++y2;

  if (aInterval === 'm') {
    // Return number of months.
    let md = m2 - m1 + 12 * (y2 - y1);
    if (d1 > d2) --md;
    this.PushInt(md);
  } else if (aInterval === 'y') {
    // Return number of years.
    let yd: number;
    if (y2 > y1) {
      if (m2 > m1 || (m2 === m1 && d2 >= d1)) yd = y2 - y1; // complete years between dates
      else yd = y2 - y1 - 1; // one incomplete year
    } else {
      // Year is equal as we don't allow reversed arguments, no
      // complete year between dates.
      yd = 0;
    }
    this.PushInt(yd);
  } else if (aInterval === 'md') {
    // Return number of days, excluding months and years.
    // This is actually the remainder of days when subtracting years
    // and months from the difference of dates. Birthday-like 23 years
    // and 10 months and 19 days.

    // Algorithm's roll-over behavior extracted from Excel by try and
    // error...
    // If day1 <= day2 then simply day2 - day1.
    // If day1 > day2 then set month1 to month2-1 and year1 to
    // year2(-1) and subtract dates, e.g. for 2012-01-28,2012-03-01 set
    // 2012-02-28 and then (2012-03-01)-(2012-02-28) => 2 days (leap
    // year).
    // For 2011-01-29,2011-03-01 the non-existent 2011-02-29 rolls over
    // to 2011-03-01 so the result is 0. Same for day 31 in months with
    // only 30 days.

    let nd: number;
    if (d1 <= d2) nd = d2 - d1;
    else {
      if (m2 === 1) {
        aDate1.SetYear(y2 === 1 ? -1 : y2 - 1);
        aDate1.SetMonth(12);
      } else {
        aDate1.SetYear(y2);
        aDate1.SetMonth(m2 - 1);
      }
      aDate1.Normalize();
      nd = DateDiff(aDate2, aDate1);
    }
    this.PushDouble(nd);
  } else if (aInterval === 'ym') {
    // Return number of months, excluding years.
    let md = m2 - m1 + 12 * (y2 - y1);
    if (d1 > d2) --md;
    md %= 12;
    this.PushInt(md);
  } else if (aInterval === 'yd') {
    // Return number of days, excluding years.

    // Condition corresponds with "y".
    if (m2 > m1 || (m2 === m1 && d2 >= d1)) aDate1.SetYear(y2);
    else aDate1.SetYear(y2 - 1);
    // XXX NOTE: Excel for the case 1988-06-22,2012-05-11 returns
    // 323, whereas the result here is 324. Don't they use the leap
    // year of 2012?
    // http://www.cpearson.com/excel/datedif.aspx "DATEDIF And Leap
    // Years" is not correct and Excel 2010 correctly returns 0 in
    // both cases mentioned there. Also using year1 as mentioned
    // produces incorrect results in other cases and different from
    // Excel 2010. Apparently they fixed some calculations.
    aDate1.Normalize();
    const fd = DateDiff(aDate2, aDate1);
    this.PushDouble(fd);
  } else this.PushIllegalArgument(); // unsupported format
};

ScInterpreter.prototype.ScGetTimeValue = function (this: ScInterpreter): void {
  const aInputString = this.GetString();
  // for a default country/language (SvNumInputOptions::LAX_TIME)
  const r = IsNumberFormat(aInputString, 'en-US');
  if (r) {
    const fVal = r.value;
    const eType = NFGetType(r.code, 'en-US');
    if (eType === SvNumFormatType.TIME || eType === SvNumFormatType.DATETIME) {
      this.nFuncFmtType = SvNumFormatType.TIME;
      const fDateVal = approxFloor(fVal);
      let fTimeVal = fVal - fDateVal;
      fTimeVal = new Duration(fTimeVal).GetInDays(); // force corrected
      this.PushDouble(fTimeVal);
    } else this.PushIllegalArgument();
  } else this.PushIllegalArgument();
};

ScInterpreter.Register(OC.ocGetActDate, ScInterpreter.prototype.ScGetActDate);
ScInterpreter.Register(OC.ocGetActTime, ScInterpreter.prototype.ScGetActTime);
ScInterpreter.Register(OC.ocGetYear, ScInterpreter.prototype.ScGetYear);
ScInterpreter.Register(OC.ocGetMonth, ScInterpreter.prototype.ScGetMonth);
ScInterpreter.Register(OC.ocGetDay, ScInterpreter.prototype.ScGetDay);
ScInterpreter.Register(OC.ocGetDayOfWeek, ScInterpreter.prototype.ScGetDayOfWeek);
ScInterpreter.Register(OC.ocWeek, ScInterpreter.prototype.ScGetWeekOfYear);
ScInterpreter.Register(OC.ocIsoWeeknum, ScInterpreter.prototype.ScGetIsoWeekOfYear);
ScInterpreter.Register(OC.ocWeeknumOOo, ScInterpreter.prototype.ScWeeknumOOo);
ScInterpreter.Register(OC.ocEasterSunday, ScInterpreter.prototype.ScEasterSunday);
ScInterpreter.Register(OC.ocNetWorkdays, function (this: ScInterpreter) { this.ScNetWorkdays(false); });
ScInterpreter.Register(OC.ocNetWorkdays_MS, function (this: ScInterpreter) { this.ScNetWorkdays(true); });
ScInterpreter.Register(OC.ocWorkday_MS, ScInterpreter.prototype.ScWorkday_MS);
ScInterpreter.Register(OC.ocGetHour, ScInterpreter.prototype.ScGetHour);
ScInterpreter.Register(OC.ocGetMin, ScInterpreter.prototype.ScGetMin);
ScInterpreter.Register(OC.ocGetSec, ScInterpreter.prototype.ScGetSec);
ScInterpreter.Register(OC.ocGetDateValue, ScInterpreter.prototype.ScGetDateValue);
ScInterpreter.Register(OC.ocGetTimeValue, ScInterpreter.prototype.ScGetTimeValue);
ScInterpreter.Register(OC.ocGetDate, ScInterpreter.prototype.ScGetDate);
ScInterpreter.Register(OC.ocGetTime, ScInterpreter.prototype.ScGetTime);
ScInterpreter.Register(OC.ocGetDiffDate, ScInterpreter.prototype.ScGetDiffDate);
ScInterpreter.Register(OC.ocGetDiffDate360, ScInterpreter.prototype.ScGetDiffDate360);
ScInterpreter.Register(OC.ocGetDateDif, ScInterpreter.prototype.ScGetDateDif);

// @@ DATETIME @@

// --- math (rounding, ABS, INT, MOD, LOG, BASE, ROMAN, CONVERT_OOO, EUROCONVERT) ----------------

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScPlusMinus(): void;
    ScAbs(): void;
    ScInt(): void;
    RoundNumber(eMode: eMathRoundingMode): void;
    ScRound(): void;
    ScRoundDown(): void;
    ScRoundUp(): void;
    RoundSignificant(fX: number, fDigits: number): number;
    ScRoundSignificant(): void;
    ScCeil(bODFF: boolean): void;
    ScCeil_MS(): void;
    ScCeil_Precise(): void;
    ScFloor(bODFF: boolean): void;
    ScFloor_MS(): void;
    ScFloor_Precise(): void;
    ScEven(): void;
    ScOdd(): void;
    ScArcTan2(): void;
    ScLog(): void;
    ScLn(): void;
    ScLog10(): void;
    ScMod(): void;
    ScBase(): void;
    ScDecimal(): void;
    ScConvertOOo(): void;
    ScRoman(): void;
    ScArabic(): void;
    ScEuroConvert(): void;
  }
}

const SAL_MAX_INT16 = 32767;
const SAL_MIN_INT16 = -32768;
const SAL_MAX_UINT16 = 65535;

ScInterpreter.prototype.ScPlusMinus = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  let n = 0;
  if (fVal < 0.0) n = -1;
  else if (fVal > 0.0) n = 1;
  this.PushInt(n);
};

ScInterpreter.prototype.ScAbs = function (this: ScInterpreter): void {
  this.PushDouble(Math.abs(this.GetDouble()));
};

ScInterpreter.prototype.ScInt = function (this: ScInterpreter): void {
  this.PushDouble(approxFloor(this.GetDouble()));
};

ScInterpreter.prototype.RoundNumber = function (this: ScInterpreter, eMode: eMathRoundingMode): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let fVal = 0.0;
  if (nParamCount === 1) fVal = rtl_math_round(this.GetDouble(), 0, eMode);
  else {
    let fDec = this.GetDouble();
    if (fDec > SAL_MAX_INT16) fDec = SAL_MAX_INT16;
    else if (fDec < SAL_MIN_INT16) fDec = SAL_MIN_INT16;
    else {
      if (fDec < 0.0) fDec = approxCeil(fDec);
      else fDec = approxFloor(fDec);
    }
    const nDec = Math.trunc(fDec);
    const fX = this.GetDouble();
    if (this.nGlobalError === FormulaError.NONE) {
      // A quite aggressive approach with 12 significant digits.
      // However, using 14 or some other doesn't work because other
      // values may fail, like =ROUNDDOWN(2-5E-015;13) would produce
      // 2 (another example in tdf#124286).
      const kSigDig = 12;

      if ((eMode === eMathRoundingMode.Down || eMode === eMathRoundingMode.Up) && nDec < kSigDig && fX % 1.0 !== 0.0) {
        // tdf124286 : round to significant digits before rounding
        //             down or up to avoid unexpected rounding errors
        //             caused by decimal -> binary -> decimal conversion

        let fRes = fX;
        // Similar to RoundSignificant() but omitting the back-scaling
        // and interim integer rounding before the final rounding,
        // which would result in double rounding. Instead, adjust the
        // decimals and round into integer part before scaling back.
        const fTemp = Math.floor(Math.log10(Math.abs(fRes))) + 1.0 - kSigDig;
        // Avoid inaccuracy of negative powers of 10.
        if (fTemp < 0.0) fRes *= Math.pow(10.0, -fTemp);
        else fRes /= Math.pow(10.0, fTemp);
        if (Number.isFinite(fRes)) {
          // fRes is now at a decimal normalized scale.
          // Truncate up-rounding to opposite direction for values
          // like 0.0600000000000005 =ROUNDUP(8.06-8;2) that here now
          // is 600000000000.005 and otherwise would yield 0.07
          if (eMode === eMathRoundingMode.Up) fRes = approxFloor(fRes);
          fVal = rtl_math_round(fRes, Math.trunc(nDec + fTemp), eMode);
          if (fTemp < 0.0) fVal /= Math.pow(10.0, -fTemp);
          else fVal *= Math.pow(10.0, fTemp);
        } else {
          // Overflow. Let our round() decide if and how to round.
          fVal = rtl_math_round(fX, nDec, eMode);
        }
      } else fVal = rtl_math_round(fX, nDec, eMode);
    }
  }
  this.PushDouble(fVal);
};

ScInterpreter.prototype.ScRound = function (this: ScInterpreter): void {
  this.RoundNumber(eMathRoundingMode.Corrected);
};

ScInterpreter.prototype.ScRoundDown = function (this: ScInterpreter): void {
  this.RoundNumber(eMathRoundingMode.Down);
};

ScInterpreter.prototype.ScRoundUp = function (this: ScInterpreter): void {
  this.RoundNumber(eMathRoundingMode.Up);
};

/** The out-parameter fRes is the return value. */
ScInterpreter.prototype.RoundSignificant = function (this: ScInterpreter, fX: number, fDigits: number): number {
  const fTemp = Math.floor(Math.log10(Math.abs(fX))) + 1.0 - fDigits;
  let fIn = fX;
  // Avoid inaccuracy of negative powers of 10.
  if (fTemp < 0.0) fIn *= Math.pow(10.0, -fTemp);
  else fIn /= Math.pow(10.0, fTemp);
  // For very large fX there might be an overflow in fIn resulting in
  // non-finite. rtl::math::round() handles that and it will be propagated as
  // usual.
  let fRes = rtl_math_round(fIn);
  if (fTemp < 0.0) fRes /= Math.pow(10.0, -fTemp);
  else fRes *= Math.pow(10.0, fTemp);
  return fRes;
};

// tdf#105931
ScInterpreter.prototype.ScRoundSignificant = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const fDigits = approxFloor(this.GetDouble());
  const fX = this.GetDouble();
  if (this.nGlobalError !== FormulaError.NONE || fDigits < 1.0) {
    this.PushIllegalArgument();
    return;
  }

  if (fX === 0.0) this.PushDouble(0.0);
  else {
    const fRes = this.RoundSignificant(fX, fDigits);
    this.PushDouble(fRes);
  }
};

/** tdf69552 ODFF1.2 function CEILING and Excel function CEILING.MATH
    In essence, the difference between the two is that ODFF-CEILING needs to
    have arguments value and significance of the same sign and with
    CEILING.MATH the sign of argument significance is irrevelevant.
    This is why ODFF-CEILING is exported to Excel as CEILING.MATH and
    CEILING.MATH is imported in Calc as CEILING.MATH
 */
ScInterpreter.prototype.ScCeil = function (this: ScInterpreter, bODFF: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 3)) return;

  const bAbs = nParamCount === 3 && this.GetBool();
  let fDec: number, fVal: number;
  if (nParamCount === 1) {
    fVal = this.GetDouble();
    fDec = fVal < 0 ? -1 : 1;
  } else {
    const bArgumentMissing = this.IsMissing();
    fDec = this.GetDouble();
    fVal = this.GetDouble();
    if (bArgumentMissing) fDec = fVal < 0 ? -1 : 1;
  }
  if (fVal === 0 || fDec === 0.0) this.PushInt(0);
  else {
    if (bODFF && fVal * fDec < 0) this.PushIllegalArgument();
    else {
      if (fVal * fDec < 0.0) fDec = -fDec;

      if (!bAbs && fVal < 0.0) this.PushDouble(approxFloor(fVal / fDec) * fDec);
      else this.PushDouble(approxCeil(fVal / fDec) * fDec);
    }
  }
};

ScInterpreter.prototype.ScCeil_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2)) return;

  const fDec = this.GetDouble();
  const fVal = this.GetDouble();
  if (fVal === 0 || fDec === 0.0) this.PushInt(0);
  else if (fVal * fDec > 0) this.PushDouble(approxCeil(fVal / fDec) * fDec);
  else if (fVal < 0.0) this.PushDouble(approxFloor(fVal / -fDec) * -fDec);
  else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScCeil_Precise = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  let fDec: number, fVal: number;
  if (nParamCount === 1) {
    fVal = this.GetDouble();
    fDec = 1.0;
  } else {
    fDec = Math.abs(this.GetDoubleWithDefault(1.0));
    fVal = this.GetDouble();
  }
  if (fDec === 0.0 || fVal === 0.0) this.PushInt(0);
  else this.PushDouble(approxCeil(fVal / fDec) * fDec);
};

/** tdf69552 ODFF1.2 function FLOOR and Excel function FLOOR.MATH
    In essence, the difference between the two is that ODFF-FLOOR needs to
    have arguments value and significance of the same sign and with
    FLOOR.MATH the sign of argument significance is irrevelevant.
    This is why ODFF-FLOOR is exported to Excel as FLOOR.MATH and
    FLOOR.MATH is imported in Calc as FLOOR.MATH
 */
ScInterpreter.prototype.ScFloor = function (this: ScInterpreter, bODFF: boolean): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 3)) return;

  const bAbs = nParamCount === 3 && this.GetBool();
  let fDec: number, fVal: number;
  if (nParamCount === 1) {
    fVal = this.GetDouble();
    fDec = fVal < 0 ? -1 : 1;
  } else {
    const bArgumentMissing = this.IsMissing();
    fDec = this.GetDouble();
    fVal = this.GetDouble();
    if (bArgumentMissing) fDec = fVal < 0 ? -1 : 1;
  }
  if (fDec === 0.0 || fVal === 0.0) this.PushInt(0);
  else {
    if (bODFF && fVal * fDec < 0.0) this.PushIllegalArgument();
    else {
      if (fVal * fDec < 0.0) fDec = -fDec;

      if (!bAbs && fVal < 0.0) this.PushDouble(approxCeil(fVal / fDec) * fDec);
      else this.PushDouble(approxFloor(fVal / fDec) * fDec);
    }
  }
};

ScInterpreter.prototype.ScFloor_MS = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2)) return;

  const fDec = this.GetDouble();
  const fVal = this.GetDouble();

  if (fVal === 0) this.PushInt(0);
  else if (fVal * fDec > 0) this.PushDouble(approxFloor(fVal / fDec) * fDec);
  else if (fDec === 0) this.PushIllegalArgument();
  else if (fVal < 0.0) this.PushDouble(approxCeil(fVal / -fDec) * -fDec);
  else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScFloor_Precise = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  const fDec = nParamCount === 1 ? 1.0 : Math.abs(this.GetDoubleWithDefault(1.0));
  const fVal = this.GetDouble();
  if (fDec === 0.0 || fVal === 0.0) this.PushInt(0);
  else this.PushDouble(approxFloor(fVal / fDec) * fDec);
};

ScInterpreter.prototype.ScEven = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (fVal < 0.0) this.PushDouble(approxFloor(fVal / 2.0) * 2.0);
  else this.PushDouble(approxCeil(fVal / 2.0) * 2.0);
};

ScInterpreter.prototype.ScOdd = function (this: ScInterpreter): void {
  let fVal = this.GetDouble();
  if (fVal >= 0.0) {
    fVal = approxCeil(fVal);
    if (fVal % 2.0 === 0.0) ++fVal;
  } else {
    fVal = approxFloor(fVal);
    if (fVal % 2.0 === 0.0) --fVal;
  }
  this.PushDouble(fVal);
};

ScInterpreter.prototype.ScArcTan2 = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    const fVal2 = this.GetDouble();
    const fVal1 = this.GetDouble();
    this.PushDouble(Math.atan2(fVal2, fVal1));
  }
};

ScInterpreter.prototype.ScLog = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  const fBase = nParamCount === 2 ? this.GetDouble() : 10.0;
  const fVal = this.GetDouble();
  if (fVal > 0.0 && fBase > 0.0 && fBase !== 1.0) this.PushDouble(Math.log(fVal) / Math.log(fBase));
  else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScLn = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (fVal > 0.0) this.PushDouble(Math.log(fVal));
  else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScLog10 = function (this: ScInterpreter): void {
  const fVal = this.GetDouble();
  if (fVal > 0.0) this.PushDouble(Math.log10(fVal));
  else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScMod = function (this: ScInterpreter): void {
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const fDenom = this.GetDouble(); // Denominator
  if (fDenom === 0.0) {
    this.PushError(FormulaError.DivisionByZero);
    return;
  }
  const fNum = this.GetDouble(); // Numerator
  const fRes = approxSub(fNum, approxFloor(fNum / fDenom) * fDenom);
  if ((fDenom > 0 && fRes >= 0 && fRes < fDenom) || (fDenom < 0 && fRes <= 0 && fRes > fDenom)) this.PushDouble(fRes);
  else this.PushError(FormulaError.NoValue);
};

ScInterpreter.prototype.ScBase = function (this: ScInterpreter): void {
  // Value, Base [, MinLen]
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 2, 3)) return;

  const pDigits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nDigits = pDigits.length;
  let nMinLen: number;
  if (nParamCount === 3) {
    const fLen = approxFloor(this.GetDouble());
    if (1.0 <= fLen && fLen < SAL_MAX_UINT16) nMinLen = fLen;
    else nMinLen = fLen === 0.0 ? 1 : 0; // 0 means error
  } else nMinLen = 1;
  const fBase = approxFloor(this.GetDouble());
  let fVal = approxFloor(this.GetDouble());
  const fChars = fVal > 0.0 && fBase > 0.0 ? Math.ceil(Math.log(fVal) / Math.log(fBase)) + 2.0 : 2.0;
  if (fChars >= SAL_MAX_UINT16) nMinLen = 0; // Error

  if (this.nGlobalError === FormulaError.NONE && nMinLen && 2 <= fBase && fBase <= nDigits && 0 <= fVal) {
    const nBuf = Math.max(Math.trunc(fChars), nMinLen + 1);
    const pBuf: string[] = new Array<string>(nBuf).fill('0');
    let p = nBuf - 1; // the terminating 0
    if (fVal < 18446744073709551616 /* sal_uLong(~0) + 1 */) {
      let nVal = BigInt(fVal);
      const nBase = BigInt(fBase);
      while (nVal && p > 0) {
        pBuf[--p] = pDigits[Number(nVal % nBase)]!;
        nVal /= nBase;
      }
      fVal = Number(nVal);
    } else {
      let bDirt = false;
      while (fVal && p > 0) {
        //TODO: roundoff error starting with numbers greater than 2**48
        //                  double fDig = ::rtl::math::approxFloor( fmod( fVal, fBase ) );
        // a little bit better:
        const fInt = approxFloor(fVal / fBase);
        const fMult = fInt * fBase;
        let nDig: number;
        if (fVal < fMult) {
          // something is wrong there
          bDirt = true;
          nDig = 0;
        } else {
          let fDig = approxFloor(approxSub(fVal, fMult));
          if (bDirt) {
            bDirt = false;
            --fDig;
          }
          if (fDig <= 0.0) nDig = 0;
          else if (fDig >= fBase) nDig = fBase - 1;
          else nDig = fDig;
        }
        pBuf[--p] = pDigits[nDig]!;
        fVal = fInt;
      }
    }
    if (fVal) this.PushError(FormulaError.StringOverflow);
    else {
      if (nBuf - p <= nMinLen) p = nBuf - 1 - nMinLen;
      this.PushString(pBuf.slice(p, nBuf - 1).join(''));
    }
  } else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScDecimal = function (this: ScInterpreter): void {
  // Text, Base
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  const fBase = approxFloor(this.GetDouble());
  const aStr = this.GetString();
  if (this.nGlobalError === FormulaError.NONE && 2 <= fBase && fBase <= 36) {
    let fVal = 0.0;
    const nBase = fBase;
    // the characters of the string, '' past its end (the terminating 0)
    const c = (i: number): string => aStr.charAt(i);
    let p = 0;
    while (c(p) === ' ' || c(p) === '\t') p++; // strip leading white space
    if (nBase === 16) {
      // evtl. hex-prefix stripped
      if (c(p) === 'x' || c(p) === 'X') p++;
      else if (c(p) === '0' && (c(p + 1) === 'x' || c(p + 1) === 'X')) p += 2;
    }
    while (c(p)) {
      let n: number;
      const ch = c(p);
      if ('0' <= ch && ch <= '9') n = ch.charCodeAt(0) - 48;
      else if ('A' <= ch && ch <= 'Z') n = 10 + (ch.charCodeAt(0) - 65);
      else if ('a' <= ch && ch <= 'z') n = 10 + (ch.charCodeAt(0) - 97);
      else n = nBase;
      if (nBase <= n) {
        if (c(p + 1) === '' && ((nBase === 2 && (ch === 'b' || ch === 'B')) || (nBase === 16 && (ch === 'h' || ch === 'H')))) {
          // 101b and F00Dh are ok
        } else {
          this.PushIllegalArgument();
          return;
        }
      } else fVal = fVal * fBase + n;
      p++;
    }
    this.PushDouble(fVal);
  } else this.PushIllegalArgument();
};

ScInterpreter.prototype.ScConvertOOo = function (this: ScInterpreter): void {
  // Value, FromUnit, ToUnit
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const aToUnit = this.GetString();
  const aFromUnit = this.GetString();
  const fVal = this.GetDouble();
  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else {
    // first of all search for the given order; if it can't be found then search for the inverse
    let fConv: number | null;
    if ((fConv = GetUnitConverter().GetValue(aFromUnit, aToUnit)) !== null) this.PushDouble(fVal * fConv);
    else if ((fConv = GetUnitConverter().GetValue(aToUnit, aFromUnit)) !== null) this.PushDouble(fVal / fConv);
    else this.PushNA();
  }
};

ScInterpreter.prototype.ScRoman = function (this: ScInterpreter): void {
  // Value [Mode]
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;

  const fMode = nParamCount === 2 ? approxFloor(this.GetDouble()) : 0.0;
  const fVal = approxFloor(this.GetDouble());
  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else if (fMode >= 0.0 && fMode < 5.0 && fVal >= 0.0 && fVal < 4000.0) {
    const pChars = ['M', 'D', 'C', 'L', 'X', 'V', 'I'];
    const pValues = [1000, 500, 100, 50, 10, 5, 1];
    const nMaxIndex = pValues.length - 1;

    let aRoman = '';
    let nVal = fVal;
    const nMode = fMode;

    for (let i = 0; i <= nMaxIndex / 2; i++) {
      let nIndex = 2 * i;
      const nDigit = Math.trunc(nVal / pValues[nIndex]!);

      if (nDigit % 5 === 4) {
        // assert can't happen with nVal<4000 precondition
        const nIndex2 = nDigit === 4 ? nIndex - 1 : nIndex - 2;
        let nSteps = 0;
        while (nSteps < nMode && nIndex < nMaxIndex) {
          nSteps++;
          if (pValues[nIndex2]! - pValues[nIndex + 1]! <= nVal) nIndex++;
          else nSteps = nMode;
        }
        aRoman += pChars[nIndex]! + pChars[nIndex2]!;
        nVal = nVal + pValues[nIndex]!;
        nVal = nVal - pValues[nIndex2]!;
      } else {
        if (nDigit > 4) {
          // assert can't happen with nVal<4000 precondition
          aRoman += pChars[nIndex - 1]!;
        }
        const nPad = nDigit % 5;
        if (nPad) aRoman += pChars[nIndex]!.repeat(nPad);
        nVal %= pValues[nIndex]!;
      }
    }

    this.PushString(aRoman);
  } else this.PushIllegalArgument();
};

/** The value of a Roman digit and whether it is a power of ten, or null (upstream: false). */
function lcl_GetArabicValue(cChar: string): { rnValue: number; rbIsDec: boolean } | null {
  switch (cChar) {
    case 'M': return { rnValue: 1000, rbIsDec: true };
    case 'D': return { rnValue: 500, rbIsDec: false };
    case 'C': return { rnValue: 100, rbIsDec: true };
    case 'L': return { rnValue: 50, rbIsDec: false };
    case 'X': return { rnValue: 10, rbIsDec: true };
    case 'V': return { rnValue: 5, rbIsDec: false };
    case 'I': return { rnValue: 1, rbIsDec: true };
    default: return null;
  }
}

ScInterpreter.prototype.ScArabic = function (this: ScInterpreter): void {
  let aRoman = this.GetString();
  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else {
    aRoman = aRoman.replace(/[a-z]+/g, (s) => s.toUpperCase()); // toAsciiUpperCase

    let nValue = 0;
    let nValidRest = 3999;
    let nCharIndex = 0;
    const nCharCount = aRoman.length;
    let bValid = true;

    while (bValid && nCharIndex < nCharCount) {
      let nDigit1 = 0;
      let nDigit2 = 0;
      let bIsDec1 = false;
      const r1 = lcl_GetArabicValue(aRoman[nCharIndex]!);
      bValid = r1 !== null;
      if (r1) {
        nDigit1 = r1.rnValue;
        bIsDec1 = r1.rbIsDec;
      }
      if (bValid && nCharIndex + 1 < nCharCount) {
        const r2 = lcl_GetArabicValue(aRoman[nCharIndex + 1]!);
        bValid = r2 !== null;
        if (r2) nDigit2 = r2.rnValue;
      }
      if (bValid) {
        if (nDigit1 >= nDigit2) {
          nValue = (nValue + nDigit1) & 0xffff;
          nValidRest %= nDigit1 * (bIsDec1 ? 5 : 2);
          bValid = nValidRest >= nDigit1;
          if (bValid) nValidRest = (nValidRest - nDigit1) & 0xffff;
          nCharIndex++;
        } else if (nDigit1 * 2 !== nDigit2) {
          const nDiff = nDigit2 - nDigit1;
          nValue = (nValue + nDiff) & 0xffff;
          bValid = nValidRest >= nDiff;
          if (bValid) nValidRest = nDigit1 - 1;
          nCharIndex += 2;
        } else bValid = false;
      }
    }
    if (bValid) this.PushInt(nValue);
    else this.PushIllegalArgument();
  }
};

/** Resources at the website of the European Commission:
    http://ec.europa.eu/economy_finance/euro/adoption/conversion/
    http://ec.europa.eu/economy_finance/euro/countries/
    Returns the rate and decimals, or null (upstream: false). */
function lclConvertMoney(aSearchUnit: string): { rfRate: number; rnDec: number } | null {
  const aConvertTable: readonly (readonly [string, number, number])[] = [
    ['EUR', 1.0, 2],
    ['ATS', 13.7603, 2],
    ['BEF', 40.3399, 0],
    ['DEM', 1.95583, 2],
    ['ESP', 166.386, 0],
    ['FIM', 5.94573, 2],
    ['FRF', 6.55957, 2],
    ['IEP', 0.787564, 2],
    ['ITL', 1936.27, 0],
    ['LUF', 40.3399, 0],
    ['NLG', 2.20371, 2],
    ['PTE', 200.482, 2],
    ['GRD', 340.75, 2],
    ['SIT', 239.64, 2],
    ['MTL', 0.4293, 2],
    ['CYP', 0.585274, 2],
    ['SKK', 30.126, 2],
    ['EEK', 15.6466, 2],
    ['LVL', 0.702804, 2],
    ['LTL', 3.4528, 2],
    ['HRK', 7.5345, 2],
    ['BGN', 1.95583, 2],
  ];

  for (const [pCurrText, fRate, nDec] of aConvertTable) if (equalsIgnoreAsciiCase(aSearchUnit, pCurrText)) return { rfRate: fRate, rnDec: nDec };
  return null;
}

/** OUString::equalsIgnoreAsciiCase */
function equalsIgnoreAsciiCase(a: string, b: string): boolean {
  const up = (s: string): string => s.replace(/[a-z]+/g, (t) => t.toUpperCase());
  return a.length === b.length && up(a) === up(b);
}

ScInterpreter.prototype.ScEuroConvert = function (this: ScInterpreter): void {
  //Value, FromUnit, ToUnit[, FullPrecision, [TriangulationPrecision]]
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;

  let fPrecision = 0.0;
  if (nParamCount === 5) {
    fPrecision = approxFloor(this.GetDouble());
    if (fPrecision < 3) {
      this.PushIllegalArgument();
      return;
    }
  }

  const bFullPrecision = nParamCount >= 4 && this.GetBool();
  const aToUnit = this.GetString();
  const aFromUnit = this.GetString();
  const fVal = this.GetDouble();
  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else {
    const rFrom = lclConvertMoney(aFromUnit);
    const rTo = rFrom ? lclConvertMoney(aToUnit) : null;
    if (rFrom && rTo) {
      const fFromRate = rFrom.rfRate;
      const fToRate = rTo.rfRate;
      const nToDec = rTo.rnDec;
      let fRes: number;
      if (equalsIgnoreAsciiCase(aFromUnit, aToUnit)) fRes = fVal;
      else {
        if (equalsIgnoreAsciiCase(aFromUnit, 'EUR')) fRes = fVal * fToRate;
        else {
          let fIntermediate = fVal / fFromRate;
          if (fPrecision) fIntermediate = rtl_math_round(fIntermediate, Math.trunc(fPrecision));
          fRes = fIntermediate * fToRate;
        }
        if (!bFullPrecision) fRes = rtl_math_round(fRes, nToDec);
      }
      this.PushDouble(fRes);
    } else this.PushIllegalArgument();
  }
};

ScInterpreter.Register(OC.ocPlusMinus, ScInterpreter.prototype.ScPlusMinus);
ScInterpreter.Register(OC.ocAbs, ScInterpreter.prototype.ScAbs);
ScInterpreter.Register(OC.ocInt, ScInterpreter.prototype.ScInt);
ScInterpreter.Register(OC.ocEven, ScInterpreter.prototype.ScEven);
ScInterpreter.Register(OC.ocOdd, ScInterpreter.prototype.ScOdd);
ScInterpreter.Register(OC.ocArcTan2, ScInterpreter.prototype.ScArcTan2);
ScInterpreter.Register(OC.ocMod, ScInterpreter.prototype.ScMod);
ScInterpreter.Register(OC.ocRound, ScInterpreter.prototype.ScRound);
ScInterpreter.Register(OC.ocRoundSig, ScInterpreter.prototype.ScRoundSignificant);
ScInterpreter.Register(OC.ocRoundUp, ScInterpreter.prototype.ScRoundUp);
ScInterpreter.Register(OC.ocTrunc, ScInterpreter.prototype.ScRoundDown);
ScInterpreter.Register(OC.ocRoundDown, ScInterpreter.prototype.ScRoundDown);
ScInterpreter.Register(OC.ocCeil, function (this: ScInterpreter) { this.ScCeil(true); });
ScInterpreter.Register(OC.ocCeil_MS, ScInterpreter.prototype.ScCeil_MS);
ScInterpreter.Register(OC.ocCeil_Precise, ScInterpreter.prototype.ScCeil_Precise);
ScInterpreter.Register(OC.ocCeil_ISO, ScInterpreter.prototype.ScCeil_Precise);
ScInterpreter.Register(OC.ocCeil_Math, function (this: ScInterpreter) { this.ScCeil(false); });
ScInterpreter.Register(OC.ocFloor, function (this: ScInterpreter) { this.ScFloor(true); });
ScInterpreter.Register(OC.ocFloor_MS, ScInterpreter.prototype.ScFloor_MS);
ScInterpreter.Register(OC.ocFloor_Precise, ScInterpreter.prototype.ScFloor_Precise);
ScInterpreter.Register(OC.ocFloor_Math, function (this: ScInterpreter) { this.ScFloor(false); });
ScInterpreter.Register(OC.ocLog, ScInterpreter.prototype.ScLog);
ScInterpreter.Register(OC.ocLn, ScInterpreter.prototype.ScLn);
ScInterpreter.Register(OC.ocLog10, ScInterpreter.prototype.ScLog10);
ScInterpreter.Register(OC.ocBase, ScInterpreter.prototype.ScBase);
ScInterpreter.Register(OC.ocDecimal, ScInterpreter.prototype.ScDecimal);
ScInterpreter.Register(OC.ocConvertOOo, ScInterpreter.prototype.ScConvertOOo);
ScInterpreter.Register(OC.ocEuroConvert, ScInterpreter.prototype.ScEuroConvert);
ScInterpreter.Register(OC.ocRoman, ScInterpreter.prototype.ScRoman);
ScInterpreter.Register(OC.ocArabic, ScInterpreter.prototype.ScArabic);

// @@ MATH (rounding, ABS, INT, MOD, LOG, ...) @@

// --- financial functions ------------------------------------------------------------------------
// The static helpers of upstream (ScGetPV, ScGetDDB, ScInterVDB, ScGetPMT, ScGetFV,
// RateIteration) are methods here; out-parameters are returned.

declare module './interpr4.ts' {
  interface ScInterpreter {
    ScNPV(): void;
    ScIRR(): void;
    ScMIRR(): void;
    ScISPMT(): void;
    ScGetPV(fRate: number, fNper: number, fPmt: number, fFv: number, bPayInAdvance: boolean): number;
    ScPV(): void;
    ScSYD(): void;
    ScGetDDB(fCost: number, fSalvage: number, fLife: number, fPeriod: number, fFactor: number): number;
    ScDDB(): void;
    ScDB(): void;
    ScInterVDB(fCost: number, fSalvage: number, fLife: number, fLife1: number, fPeriod: number, fFactor: number): number;
    ScVDB(): void;
    ScPDuration(): void;
    ScSLN(): void;
    ScGetPMT(fRate: number, fNper: number, fPv: number, fFv: number, bPayInAdvance: boolean): number;
    ScPMT(): void;
    ScRRI(): void;
    ScGetFV(fRate: number, fNper: number, fPmt: number, fPv: number, bPayInAdvance: boolean): number;
    ScFV(): void;
    ScNper(): void;
    /** Returns whether a root was found and the approximate root (in-out fGuess). */
    RateIteration(fNper: number, fPayment: number, fPv: number, fFv: number, bPayType: boolean, fGuess: number): { bValid: boolean; fGuess: number };
    ScRate(): void;
    /** Returns the interest and the payment (out-parameter fPmt). */
    ScGetIpmt(fRate: number, fPer: number, fNper: number, fPv: number, fFv: number, bPayInAdvance: boolean): { fIpmt: number; fPmt: number };
    ScIpmt(): void;
    ScPpmt(): void;
    ScCumIpmt(): void;
    ScCumPrinc(): void;
    ScEffect(): void;
    ScNominal(): void;
  }
}

const SCdEpsilon = 1.0e-7;

/** ScHorizontalValueIterator: the numeric values (and errors) of a range row by row. Reduced:
    the column-wise ScValueIterator's values ordered by sheet, row and column. */
function* ScHorizontalValueIterator(rDoc: ScInterpreter['mrDoc'], rRange: ScRange): Generator<{ fVal: number; nErr: FormulaError }> {
  const aItems = [...new ScValueIterator(rDoc, rRange).values()];
  aItems.sort((a, b) => a.nTab - b.nTab || a.nRow - b.nRow || a.nCol - b.nCol);
  for (const it of aItems) yield { fVal: it.fVal, nErr: it.nErr };
}

/** KahanSum operator-(double): a copy minus a value. */
function KahanMinus(rSum: KahanSum, fVal: number): KahanSum {
  const k = new KahanSum();
  k.add(rSum);
  k.subtract(fVal);
  return k;
}

ScInterpreter.prototype.ScNPV = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCountMin(nParamCount, 2)) return;

  const fVal = new KahanSum(0.0);
  // We turn the stack upside down!
  this.ReverseStack(nParamCount);
  if (this.nGlobalError === FormulaError.NONE) {
    let fCount = 1.0;
    const fRate = this.GetDouble();
    const st = { nParam: nParamCount - 1, nRefInList: 0 };
    while (st.nParam-- > 0) {
      switch (this.GetStackType()) {
        case svDouble: {
          fVal.add(this.GetDouble() / Math.pow(1.0 + fRate, fCount));
          fCount++;
          break;
        }
        case svSingleRef: {
          const aAdr = this.PopSingleRef();
          const aCell = this.mrDoc.GetRefCellValue(aAdr);
          if (!aCell.hasEmptyValue() && aCell.hasNumeric()) {
            const fCellVal = this.GetCellValue(aAdr, aCell);
            fVal.add(fCellVal / Math.pow(1.0 + fRate, fCount));
            fCount++;
          }
          break;
        }
        case svDoubleRef:
        case svRefList: {
          let nErr: FormulaError = FormulaError.NONE;
          const aRange = this.PopDoubleRef(st);
          for (const it of ScHorizontalValueIterator(this.mrDoc, aRange)) {
            nErr = it.nErr;
            if (nErr !== FormulaError.NONE) break;
            fVal.add(it.fVal / Math.pow(1.0 + fRate, fCount));
            fCount++;
          }
          if (nErr !== FormulaError.NONE) this.SetError(nErr);
          break;
        }
        case svMatrix: {
          const pMat = this.GetMatrix();
          if (pMat) {
            const { nC, nR } = pMat.GetDimensions();
            if (nC === 0 || nR === 0) {
              this.PushIllegalArgument();
              return;
            } else {
              let fx: number;
              for (let j = 0; j < nC; j++) {
                for (let k = 0; k < nR; ++k) {
                  if (!pMat.IsValue(j, k)) {
                    this.PushIllegalArgument();
                    return;
                  }
                  fx = pMat.GetDouble(j, k);
                  fVal.add(fx / Math.pow(1.0 + fRate, fCount));
                  fCount++;
                }
              }
            }
          }
          break;
        }
        default:
          this.SetError(FormulaError.IllegalParameter);
          break;
      }
    }
  }
  this.PushDouble(fVal.get());
};

ScInterpreter.prototype.ScIRR = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 1, 2)) return;
  const fEstimated = nParamCount === 2 ? this.GetDouble() : 0.1;
  let fEps = 1.0;
  // If it's -1 the default result for division by zero else startvalue
  let x = fEstimated === -1.0 ? 0.1 : fEstimated;
  let fValue: number;

  let aRange: ScRange | null = null;
  let pMat: ScMatrix | null = null;
  let nC = 0;
  let nR = 0;
  let bIsMatrix = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
      aRange = this.PopDoubleRef();
      break;
    case svMatrix:
      pMat = this.GetMatrix();
      if (pMat) {
        ({ nC, nR } = pMat.GetDimensions());
        if (nC === 0 || nR === 0) {
          this.PushIllegalParameter();
          return;
        }
        bIsMatrix = true;
      } else {
        this.PushIllegalParameter();
        return;
      }
      break;
    default: {
      this.PushIllegalParameter();
      return;
    }
  }
  const nIterationsMax = 20;
  let nItCount = 0;
  let nIterError: FormulaError = FormulaError.NONE;
  while (fEps > SCdEpsilon && nItCount < nIterationsMax && this.nGlobalError === FormulaError.NONE) {
    // Newtons method:
    const fNom = new KahanSum(0.0);
    const fDenom = new KahanSum(0.0);
    let fCount = 0.0;
    if (bIsMatrix) {
      for (let j = 0; j < nC && this.nGlobalError === FormulaError.NONE; j++) {
        for (let k = 0; k < nR; k++) {
          if (!pMat!.IsValue(j, k)) continue;
          fValue = pMat!.GetDouble(j, k);
          if (this.nGlobalError !== FormulaError.NONE) break;

          fNom.add(fValue / Math.pow(1.0 + x, fCount));
          fDenom.add((-fCount * fValue) / Math.pow(1.0 + x, fCount + 1.0));
          fCount++;
        }
      }
    } else {
      for (const it of new ScValueIterator(this.mrDoc, aRange!, this.mnSubTotalFlags).values()) {
        nIterError = it.nErr;
        if (nIterError !== FormulaError.NONE) break;
        fValue = it.fVal;
        fNom.add(fValue / Math.pow(1.0 + x, fCount));
        fDenom.add((-fCount * fValue) / Math.pow(1.0 + x, fCount + 1.0));
        fCount++;
      }
      this.SetError(nIterError);
    }
    const xNew = x - fNom.get() / fDenom.get(); // x(i+1) = x(i)-f(x(i))/f'(x(i))
    nItCount++;
    fEps = Math.abs(xNew - x);
    x = xNew;
  }
  if (fEstimated === 0.0 && Math.abs(x) < SCdEpsilon) x = 0.0; // adjust to zero
  if (fEps < SCdEpsilon) this.PushDouble(x);
  else this.PushError(FormulaError.NoConvergence);
};

ScInterpreter.prototype.ScMIRR = function (this: ScInterpreter): void {
  // range_of_values ; rate_invest ; rate_reinvest
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  if (!this.MustHaveParamCount(this.GetByte(), 3)) return;

  const fRate1_reinvest = this.GetDouble() + 1;
  const fRate1_invest = this.GetDouble() + 1;

  let aRange: ScRange | null = null;
  let pMat: ScMatrix | null = null;
  let nC = 0;
  let nR = 0;
  let bIsMatrix = false;
  switch (this.GetStackType()) {
    case svDoubleRef:
      aRange = this.PopDoubleRef();
      break;
    case svMatrix:
      {
        pMat = this.GetMatrix();
        if (pMat) {
          ({ nC, nR } = pMat.GetDimensions());
          if (nC === 0 || nR === 0) this.SetError(FormulaError.IllegalArgument);
          bIsMatrix = true;
        } else this.SetError(FormulaError.IllegalArgument);
      }
      break;
    default:
      this.SetError(FormulaError.IllegalParameter);
      break;
  }

  if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
  else {
    const fNPV_reinvest = new KahanSum(0.0);
    let fPow_reinvest = 1.0;
    const fNPV_invest = new KahanSum(0.0);
    let fPow_invest = 1.0;
    let nCount = 0;
    let bHasPosValue = false;
    let bHasNegValue = false;

    if (bIsMatrix) {
      let fX: number;
      for (let j = 0; j < nC; j++) {
        for (let k = 0; k < nR; ++k) {
          if (!pMat!.IsValue(j, k)) continue;
          fX = pMat!.GetDouble(j, k);
          if (this.nGlobalError !== FormulaError.NONE) break;

          if (fX > 0.0) {
            // reinvestments
            bHasPosValue = true;
            fNPV_reinvest.add(fX * fPow_reinvest);
          } else if (fX < 0.0) {
            // investments
            bHasNegValue = true;
            fNPV_invest.add(fX * fPow_invest);
          }
          fPow_reinvest /= fRate1_reinvest;
          fPow_invest /= fRate1_invest;
          nCount++;
        }
      }
    } else {
      let nIterError: FormulaError = FormulaError.NONE;

      for (const it of new ScValueIterator(this.mrDoc, aRange!, this.mnSubTotalFlags).values()) {
        const fCellValue = it.fVal;
        nIterError = it.nErr;
        if (fCellValue > 0.0) {
          // reinvestments
          bHasPosValue = true;
          fNPV_reinvest.add(fCellValue * fPow_reinvest);
        } else if (fCellValue < 0.0) {
          // investments
          bHasNegValue = true;
          fNPV_invest.add(fCellValue * fPow_invest);
        }
        fPow_reinvest /= fRate1_reinvest;
        fPow_invest /= fRate1_invest;
        nCount++;
      }

      if (nIterError !== FormulaError.NONE) this.SetError(nIterError);
    }
    if (!(bHasPosValue && bHasNegValue)) this.SetError(FormulaError.IllegalArgument);

    if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
    else {
      let fResult = -(fNPV_reinvest.get() / fNPV_invest.get());
      fResult *= Math.pow(fRate1_reinvest, nCount - 1);
      fResult = Math.pow(fResult, div(1.0, nCount - 1));
      this.PushDouble(fResult - 1.0);
    }
  }
};

ScInterpreter.prototype.ScISPMT = function (this: ScInterpreter): void {
  // rate ; period ; total_periods ; invest
  if (this.MustHaveParamCount(this.GetByte(), 4)) {
    const fInvest = this.GetDouble();
    const fTotal = this.GetDouble();
    const fPeriod = this.GetDouble();
    const fRate = this.GetDouble();

    if (this.nGlobalError !== FormulaError.NONE) this.PushError(this.nGlobalError);
    else this.PushDouble(fInvest * fRate * (fPeriod / fTotal - 1.0));
  }
};

// financial functions
ScInterpreter.prototype.ScGetPV = function (this: ScInterpreter, fRate: number, fNper: number, fPmt: number, fFv: number, bPayInAdvance: boolean): number {
  let fPv: number;
  if (fRate === 0.0) fPv = fFv + fPmt * fNper;
  else {
    if (bPayInAdvance) fPv = fFv * Math.pow(1.0 + fRate, -fNper) + (fPmt * (1.0 - Math.pow(1.0 + fRate, -fNper + 1.0))) / fRate + fPmt;
    else fPv = fFv * Math.pow(1.0 + fRate, -fNper) + (fPmt * (1.0 - Math.pow(1.0 + fRate, -fNper))) / fRate;
  }
  return -fPv;
};

ScInterpreter.prototype.ScPV = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;

  const bPayInAdvance = nParamCount === 5 && this.GetBool();
  const fFv = nParamCount >= 4 ? this.GetDouble() : 0;
  const fPmt = this.GetDouble();
  const fNper = this.GetDouble();
  const fRate = this.GetDouble();
  this.PushDouble(this.ScGetPV(fRate, fNper, fPmt, fFv, bPayInAdvance));
};

ScInterpreter.prototype.ScSYD = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  if (this.MustHaveParamCount(this.GetByte(), 4)) {
    const fPer = this.GetDouble();
    const fLife = this.GetDouble();
    const fSalvage = this.GetDouble();
    const fCost = this.GetDouble();
    const fSyd = ((fCost - fSalvage) * (fLife - fPer + 1.0)) / ((fLife * (fLife + 1.0)) / 2.0);
    this.PushDouble(fSyd);
  }
};

ScInterpreter.prototype.ScGetDDB = function (this: ScInterpreter, fCost: number, fSalvage: number, fLife: number, fPeriod: number, fFactor: number): number {
  let fRate: number, fOldValue: number;
  fRate = fFactor / fLife;
  if (fRate >= 1.0) {
    fRate = 1.0;
    fOldValue = fPeriod === 1.0 ? fCost : 0;
  } else fOldValue = fCost * Math.pow(1.0 - fRate, fPeriod - 1.0);
  const fNewValue = fCost * Math.pow(1.0 - fRate, fPeriod);

  const fDdb = fNewValue < fSalvage ? fOldValue - fSalvage : fOldValue - fNewValue;
  return fDdb < 0 ? 0 : fDdb;
};

ScInterpreter.prototype.ScDDB = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 4, 5)) return;

  const fFactor = nParamCount === 5 ? this.GetDouble() : 2.0;
  const fPeriod = this.GetDouble();
  const fLife = this.GetDouble();
  const fSalvage = this.GetDouble();
  const fCost = this.GetDouble();
  if (fCost < 0.0 || fSalvage < 0.0 || fFactor <= 0.0 || fSalvage > fCost || fPeriod < 1.0 || fPeriod > fLife) this.PushIllegalArgument();
  else this.PushDouble(this.ScGetDDB(fCost, fSalvage, fLife, fPeriod, fFactor));
};

ScInterpreter.prototype.ScDB = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 4, 5)) return;
  const fMonths = nParamCount === 4 ? 12.0 : approxFloor(this.GetDouble());
  const fPeriod = this.GetDouble();
  const fLife = this.GetDouble();
  const fSalvage = this.GetDouble();
  const fCost = this.GetDouble();
  if (fMonths < 1.0 || fMonths > 12.0 || fLife > 1200.0 || fSalvage < 0.0 || fPeriod > fLife + 1.0 || fSalvage > fCost || fCost <= 0.0 || fLife <= 0 || fPeriod <= 0) {
    this.PushIllegalArgument();
    return;
  }
  let fOffRate = 1.0 - Math.pow(fSalvage / fCost, 1.0 / fLife);
  fOffRate = approxFloor(fOffRate * 1000.0 + 0.5) / 1000.0;
  const fFirstOffRate = (fCost * fOffRate * fMonths) / 12.0;
  let fDb = 0.0;
  if (approxFloor(fPeriod) === 1) fDb = fFirstOffRate;
  else {
    const fSumOffRate = new KahanSum(fFirstOffRate);
    let fMin = fLife;
    if (fMin > fPeriod) fMin = fPeriod;
    const iMax = approxFloor(fMin) & 0xffff;
    for (let i = 2; i <= iMax; i++) {
      fDb = -KahanMinus(fSumOffRate, fCost).get() * fOffRate;
      fSumOffRate.add(fDb);
    }
    if (fPeriod > fLife) fDb = (-KahanMinus(fSumOffRate, fCost).get() * fOffRate * (12.0 - fMonths)) / 12.0;
  }
  this.PushDouble(fDb);
};

ScInterpreter.prototype.ScInterVDB = function (this: ScInterpreter, fCost: number, fSalvage: number, fLife: number, fLife1: number, fPeriod: number, fFactor: number): number {
  const fVdb = new KahanSum(0.0);
  const fIntEnd = approxCeil(fPeriod);
  const nLoopEnd = fIntEnd;

  let fTerm: number,
    fSln = 0; // SLN: Straight-Line Depreciation
  let fSalvageValue = fCost - fSalvage;
  let bNowSln = false;

  let fDdb: number;
  let i: number;
  for (i = 1; i <= nLoopEnd; i++) {
    if (!bNowSln) {
      fDdb = this.ScGetDDB(fCost, fSalvage, fLife, i, fFactor);
      fSln = fSalvageValue / (fLife1 - (i - 1));

      if (fSln > fDdb) {
        fTerm = fSln;
        bNowSln = true;
      } else {
        fTerm = fDdb;
        fSalvageValue -= fDdb;
      }
    } else {
      fTerm = fSln;
    }

    if (i === nLoopEnd) fTerm *= fPeriod + 1.0 - fIntEnd;

    fVdb.add(fTerm);
  }
  return fVdb.get();
};

ScInterpreter.prototype.ScVDB = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 5, 7)) return;

  let fVdb = new KahanSum(0.0);
  const bNoSwitch = nParamCount === 7 && this.GetBool();
  const fFactor = nParamCount >= 6 ? this.GetDouble() : 2.0;
  const fEnd = this.GetDouble();
  const fStart = this.GetDouble();
  const fLife = this.GetDouble();
  const fSalvage = this.GetDouble();
  let fCost = this.GetDouble();
  if (fStart < 0.0 || fEnd < fStart || fEnd > fLife || fCost < 0.0 || fSalvage > fCost || fFactor <= 0.0) this.PushIllegalArgument();
  else {
    const fIntStart = approxFloor(fStart);
    const fIntEnd = approxCeil(fEnd);
    const nLoopStart = fIntStart;
    const nLoopEnd = fIntEnd;

    if (bNoSwitch) {
      for (let i = nLoopStart + 1; i <= nLoopEnd; i++) {
        let fTerm = this.ScGetDDB(fCost, fSalvage, fLife, i, fFactor);

        //respect partial period in the Beginning/ End:
        if (i === nLoopStart + 1) fTerm *= Math.min(fEnd, fIntStart + 1.0) - fStart;
        else if (i === nLoopEnd) fTerm *= fEnd + 1.0 - fIntEnd;

        fVdb.add(fTerm);
      }
    } else {
      let fPart = 0.0;
      // respect partial period in the Beginning / End:
      if (!approxEqual(fStart, fIntStart) || !approxEqual(fEnd, fIntEnd)) {
        if (!approxEqual(fStart, fIntStart)) {
          // part to be subtracted at the beginning
          const fTempIntEnd = fIntStart + 1.0;
          const fTempValue = fCost - this.ScInterVDB(fCost, fSalvage, fLife, fLife, fIntStart, fFactor);
          fPart += (fStart - fIntStart) * this.ScInterVDB(fTempValue, fSalvage, fLife, fLife - fIntStart, fTempIntEnd - fIntStart, fFactor);
        }
        if (!approxEqual(fEnd, fIntEnd)) {
          // part to be subtracted at the end
          const fTempIntStart = fIntEnd - 1.0;
          const fTempValue = fCost - this.ScInterVDB(fCost, fSalvage, fLife, fLife, fTempIntStart, fFactor);
          fPart += (fIntEnd - fEnd) * this.ScInterVDB(fTempValue, fSalvage, fLife, fLife - fTempIntStart, fIntEnd - fTempIntStart, fFactor);
        }
      }
      // calculate depreciation for whole periods
      fCost -= this.ScInterVDB(fCost, fSalvage, fLife, fLife, fIntStart, fFactor);
      fVdb = new KahanSum(this.ScInterVDB(fCost, fSalvage, fLife, fLife - fIntStart, fIntEnd - fIntStart, fFactor));
      fVdb.subtract(fPart);
    }
  }
  this.PushDouble(fVdb.get());
};

ScInterpreter.prototype.ScPDuration = function (this: ScInterpreter): void {
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const fFuture = this.GetDouble();
    const fPresent = this.GetDouble();
    const fRate = this.GetDouble();
    if (fFuture <= 0.0 || fPresent <= 0.0 || fRate <= 0.0) this.PushIllegalArgument();
    else this.PushDouble(Math.log(fFuture / fPresent) / Math.log1p(fRate));
  }
};

ScInterpreter.prototype.ScSLN = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const fLife = this.GetDouble();
    const fSalvage = this.GetDouble();
    const fCost = this.GetDouble();
    this.PushDouble(div(fCost - fSalvage, fLife));
  }
};

ScInterpreter.prototype.ScGetPMT = function (this: ScInterpreter, fRate: number, fNper: number, fPv: number, fFv: number, bPayInAdvance: boolean): number {
  let fPayment: number;
  if (fRate === 0.0) fPayment = (fPv + fFv) / fNper;
  else {
    if (bPayInAdvance)
      // payment in advance
      fPayment = ((fFv + fPv * Math.exp(fNper * Math.log1p(fRate))) * fRate) / (Math.expm1((fNper + 1) * Math.log1p(fRate)) - fRate);
    // payment in arrear
    else fPayment = ((fFv + fPv * Math.exp(fNper * Math.log1p(fRate))) * fRate) / Math.expm1(fNper * Math.log1p(fRate));
  }
  return -fPayment;
};

ScInterpreter.prototype.ScPMT = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;
  const bPayInAdvance = nParamCount === 5 && this.GetBool();
  const fFv = nParamCount >= 4 ? this.GetDouble() : 0;
  const fPv = this.GetDouble();
  const fNper = this.GetDouble();
  const fRate = this.GetDouble();
  this.PushDouble(this.ScGetPMT(fRate, fNper, fPv, fFv, bPayInAdvance));
};

ScInterpreter.prototype.ScRRI = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  if (this.MustHaveParamCount(this.GetByte(), 3)) {
    const fFutureValue = this.GetDouble();
    const fPresentValue = this.GetDouble();
    const fNrOfPeriods = this.GetDouble();
    if (fNrOfPeriods <= 0.0 || fPresentValue === 0.0) this.PushIllegalArgument();
    else this.PushDouble(Math.pow(fFutureValue / fPresentValue, 1.0 / fNrOfPeriods) - 1.0);
  }
};

ScInterpreter.prototype.ScGetFV = function (this: ScInterpreter, fRate: number, fNper: number, fPmt: number, fPv: number, bPayInAdvance: boolean): number {
  let fFv: number;
  if (fRate === 0.0) fFv = fPv + fPmt * fNper;
  else {
    const fTerm = Math.pow(1.0 + fRate, fNper);
    if (bPayInAdvance) fFv = fPv * fTerm + (fPmt * (1.0 + fRate) * (fTerm - 1.0)) / fRate;
    else fFv = fPv * fTerm + (fPmt * (fTerm - 1.0)) / fRate;
  }
  return -fFv;
};

ScInterpreter.prototype.ScFV = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;
  const bPayInAdvance = nParamCount === 5 && this.GetBool();
  const fPv = nParamCount >= 4 ? this.GetDouble() : 0;
  const fPmt = this.GetDouble();
  const fNper = this.GetDouble();
  const fRate = this.GetDouble();
  this.PushDouble(this.ScGetFV(fRate, fNper, fPmt, fPv, bPayInAdvance));
};

ScInterpreter.prototype.ScNper = function (this: ScInterpreter): void {
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 5)) return;
  const bPayInAdvance = nParamCount === 5 && this.GetBool();
  const fFV = nParamCount >= 4 ? this.GetDouble() : 0;
  const fPV = this.GetDouble(); // Present Value
  const fPmt = this.GetDouble(); // Payment
  const fRate = this.GetDouble();
  // Note that due to the function specification in ODFF1.2 (and Excel) the
  // amount to be paid to get from fPV to fFV is fFV_+_fPV.
  if (fPV + fFV === 0.0) this.PushDouble(0.0);
  else if (fRate === 0.0) this.PushDouble(-((fPV + fFV) / fPmt));
  else if (bPayInAdvance) this.PushDouble(Math.log(-((fRate * fFV - fPmt * (1.0 + fRate)) / (fRate * fPV + fPmt * (1.0 + fRate)))) / Math.log1p(fRate));
  else this.PushDouble(Math.log(-(fRate * fFV - fPmt) / (fRate * fPV + fPmt)) / Math.log1p(fRate));
};

ScInterpreter.prototype.RateIteration = function (this: ScInterpreter, fNper: number, fPayment: number, fPv: number, fFv: number, bPayType: boolean, fGuess: number): { bValid: boolean; fGuess: number } {
  // See also #i15090#
  // Newton-Raphson method: x(i+1) = x(i) - f(x(i)) / f'(x(i))
  // This solution handles integer and non-integer values of Nper different.
  // If ODFF will constraint Nper to integer, the distinction of cases can be
  // removed; only the integer-part is needed then.
  let bValid = true,
    bFound = false;
  let fX: number, fXnew: number, fTerm: number, fTermDerivation: number;
  let fGeoSeries: number, fGeoSeriesDerivation: number;
  const nIterationsMax = 150;
  let nCount = 0;
  const fEpsilonSmall = 1.0e-14;
  if (bPayType) {
    // payment at beginning of each period
    fFv = fFv - fPayment;
    fPv = fPv + fPayment;
  }
  if (fNper === rtl_math_round(fNper)) {
    // Nper is an integer value
    fX = fGuess;
    while (!bFound && nCount < nIterationsMax) {
      // for (1.0+fX)^Nper and (1.0+fX)^(Nper-1)
      const fPowNminus1 = Math.pow(1.0 + fX, fNper - 1.0);
      const fPowN = fPowNminus1 * (1.0 + fX);
      if (fX === 0.0) {
        fGeoSeries = fNper;
        fGeoSeriesDerivation = (fNper * (fNper - 1.0)) / 2.0;
      } else {
        fGeoSeries = (fPowN - 1.0) / fX;
        fGeoSeriesDerivation = (fNper * fPowNminus1) / fX - fGeoSeries / fX;
      }
      fTerm = fFv + fPv * fPowN + fPayment * fGeoSeries;
      fTermDerivation = fPv * fNper * fPowNminus1 + fPayment * fGeoSeriesDerivation;
      if (Math.abs(fTerm) < fEpsilonSmall) bFound = true; // will catch root which is at an extreme
      else {
        if (fTermDerivation === 0.0) fXnew = fX + 1.1 * SCdEpsilon; // move away from zero slope
        else fXnew = fX - fTerm / fTermDerivation;
        nCount++;
        // more accuracy not possible in oscillating cases
        bFound = Math.abs(fXnew - fX) < SCdEpsilon;
        fX = fXnew;
      }
    }
    // Gnumeric returns roots < -1, Excel gives an error in that cases,
    // ODFF says nothing about it. Enable the statement, if you want Excel's
    // behavior.
    //bValid =(fX >=-1.0);
    // Update 2013-06-17: Gnumeric (v1.12.2) doesn't return roots <= -1
    // anymore.
    bValid = fX > -1.0;
  } else {
    // Nper is not an integer value.
    fX = fGuess < -1.0 ? -1.0 : fGuess; // start with a valid fX
    while (bValid && !bFound && nCount < nIterationsMax) {
      if (fX === 0.0) {
        fGeoSeries = fNper;
        fGeoSeriesDerivation = (fNper * (fNper - 1.0)) / 2.0;
      } else {
        fGeoSeries = (Math.pow(1.0 + fX, fNper) - 1.0) / fX;
        fGeoSeriesDerivation = (fNper * Math.pow(1.0 + fX, fNper - 1.0)) / fX - fGeoSeries / fX;
      }
      fTerm = fFv + fPv * Math.pow(1.0 + fX, fNper) + fPayment * fGeoSeries;
      fTermDerivation = fPv * fNper * Math.pow(1.0 + fX, fNper - 1.0) + fPayment * fGeoSeriesDerivation;
      if (Math.abs(fTerm) < fEpsilonSmall) bFound = true; // will catch root which is at an extreme
      else {
        if (fTermDerivation === 0.0) fXnew = fX + 1.1 * SCdEpsilon; // move away from zero slope
        else fXnew = fX - fTerm / fTermDerivation;
        nCount++;
        // more accuracy not possible in oscillating cases
        bFound = Math.abs(fXnew - fX) < SCdEpsilon;
        fX = fXnew;
        bValid = fX >= -1.0; // otherwise pow(1.0+fX,fNper) will fail
      }
    }
  }
  fGuess = fX; // return approximate root
  return { bValid: bValid && bFound, fGuess };
};

// In Calc UI it is the function RATE(Nper;Pmt;Pv;Fv;Type;Guess)
ScInterpreter.prototype.ScRate = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 3, 6)) return;

  // defaults for missing arguments, see ODFF spec
  let fGuess = nParamCount === 6 ? this.GetDouble() : 0.1;
  const bDefaultGuess = nParamCount !== 6;
  const bPayType = nParamCount >= 5 && this.GetBool();
  const fFv = nParamCount >= 4 ? this.GetDouble() : 0;
  const fPv = this.GetDouble();
  const fPayment = this.GetDouble();
  const fNper = this.GetDouble();
  const fOrigGuess = fGuess;

  if (fNper <= 0.0) {
    // constraint from ODFF spec
    this.PushIllegalArgument();
    return;
  }
  let r = this.RateIteration(fNper, fPayment, fPv, fFv, bPayType, fGuess);
  let bValid = r.bValid;
  fGuess = r.fGuess;

  if (!bValid) {
    /* TODO: try also for specified guess values, not only default? As is,
     * a specified 0.1 guess may be error result but a default 0.1 guess
     * may succeed. On the other hand, using a different guess value than
     * the specified one may not be desired, even if that didn't match. */
    if (bDefaultGuess) {
      /* TODO: this is rather ugly, instead of looping over different
       * guess values and doing a Newton goal seek for each we could
       * first insert the values into the RATE equation to obtain a set
       * of y values and then do a bisecting goal seek, possibly using
       * different algorithms. */
      const fX = fOrigGuess;
      for (let nStep = 2; nStep <= 10 && !bValid; ++nStep) {
        fGuess = fX * nStep;
        r = this.RateIteration(fNper, fPayment, fPv, fFv, bPayType, fGuess);
        bValid = r.bValid;
        fGuess = r.fGuess;
        if (!bValid) {
          fGuess = fX / nStep;
          r = this.RateIteration(fNper, fPayment, fPv, fFv, bPayType, fGuess);
          bValid = r.bValid;
          fGuess = r.fGuess;
        }
      }
    }
    if (!bValid) this.SetError(FormulaError.NoConvergence);
  }
  this.PushDouble(fGuess);
};

ScInterpreter.prototype.ScGetIpmt = function (this: ScInterpreter, fRate: number, fPer: number, fNper: number, fPv: number, fFv: number, bPayInAdvance: boolean): { fIpmt: number; fPmt: number } {
  const fPmt = this.ScGetPMT(fRate, fNper, fPv, fFv, bPayInAdvance); // for PPMT also if fPer == 1
  let fIpmt: number;
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  if (fPer === 1.0) fIpmt = bPayInAdvance ? 0.0 : -fPv;
  else {
    if (bPayInAdvance) fIpmt = this.ScGetFV(fRate, fPer - 2.0, fPmt, fPv, true) - fPmt;
    else fIpmt = this.ScGetFV(fRate, fPer - 1.0, fPmt, fPv, false);
  }
  return { fIpmt: fIpmt * fRate, fPmt };
};

ScInterpreter.prototype.ScIpmt = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 4, 6)) return;
  const bPayInAdvance = nParamCount === 6 && this.GetBool();
  const fFv = nParamCount >= 5 ? this.GetDouble() : 0;
  const fPv = this.GetDouble();
  const fNper = this.GetDouble();
  const fPer = this.GetDouble();
  const fRate = this.GetDouble();
  if (fPer < 1.0 || fPer > fNper) this.PushIllegalArgument();
  else {
    this.PushDouble(this.ScGetIpmt(fRate, fPer, fNper, fPv, fFv, bPayInAdvance).fIpmt);
  }
};

ScInterpreter.prototype.ScPpmt = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  const nParamCount = this.GetByte();
  if (!this.MustHaveParamCount(nParamCount, 4, 6)) return;
  const bPayInAdvance = nParamCount === 6 && this.GetBool();
  const fFv = nParamCount >= 5 ? this.GetDouble() : 0;
  const fPv = this.GetDouble();
  const fNper = this.GetDouble();
  const fPer = this.GetDouble();
  const fRate = this.GetDouble();
  if (fPer < 1.0 || fPer > fNper) this.PushIllegalArgument();
  else {
    const { fIpmt: fInterestPer, fPmt } = this.ScGetIpmt(fRate, fPer, fNper, fPv, fFv, bPayInAdvance);
    this.PushDouble(fPmt - fInterestPer);
  }
};

ScInterpreter.prototype.ScCumIpmt = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  if (!this.MustHaveParamCount(this.GetByte(), 6)) return;

  const fFlag = this.GetDoubleWithDefault(-1.0);
  const fEnd = approxFloor(this.GetDouble());
  const fStart = approxFloor(this.GetDouble());
  const fPv = this.GetDouble();
  const fNper = this.GetDouble();
  const fRate = this.GetDouble();
  if (fStart < 1.0 || fEnd < fStart || fRate <= 0.0 || fEnd > fNper || fNper <= 0.0 || fPv <= 0.0 || (fFlag !== 0.0 && fFlag !== 1.0)) this.PushIllegalArgument();
  else {
    const bPayInAdvance = !!fFlag;
    let nStart = fStart;
    const nEnd = fEnd;
    const fPmt = this.ScGetPMT(fRate, fNper, fPv, 0.0, bPayInAdvance);
    const fIpmt = new KahanSum(0.0);
    if (nStart === 1) {
      if (!bPayInAdvance) fIpmt.assign(-fPv);
      nStart++;
    }
    for (let i = nStart; i <= nEnd; i++) {
      if (bPayInAdvance) fIpmt.add(this.ScGetFV(fRate, i - 2, fPmt, fPv, true) - fPmt);
      else fIpmt.add(this.ScGetFV(fRate, i - 1, fPmt, fPv, false));
    }
    fIpmt.mul(fRate);
    this.PushDouble(fIpmt.get());
  }
};

ScInterpreter.prototype.ScCumPrinc = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.CURRENCY;
  if (!this.MustHaveParamCount(this.GetByte(), 6)) return;

  const fFlag = this.GetDoubleWithDefault(-1.0);
  const fEnd = approxFloor(this.GetDouble());
  const fStart = approxFloor(this.GetDouble());
  const fPv = this.GetDouble();
  const fNper = this.GetDouble();
  const fRate = this.GetDouble();
  if (fStart < 1.0 || fEnd < fStart || fRate <= 0.0 || fEnd > fNper || fNper <= 0.0 || fPv <= 0.0 || (fFlag !== 0.0 && fFlag !== 1.0)) this.PushIllegalArgument();
  else {
    const bPayInAdvance = !!fFlag;
    const fPmt = this.ScGetPMT(fRate, fNper, fPv, 0.0, bPayInAdvance);
    const fPpmt = new KahanSum(0.0);
    let nStart = fStart;
    const nEnd = fEnd;
    if (nStart === 1) {
      fPpmt.assign(bPayInAdvance ? fPmt : fPmt + fPv * fRate);
      nStart++;
    }
    for (let i = nStart; i <= nEnd; i++) {
      if (bPayInAdvance) fPpmt.add(fPmt - (this.ScGetFV(fRate, i - 2, fPmt, fPv, true) - fPmt) * fRate);
      else fPpmt.add(fPmt - this.ScGetFV(fRate, i - 1, fPmt, fPv, false) * fRate);
    }
    this.PushDouble(fPpmt.get());
  }
};

ScInterpreter.prototype.ScEffect = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  if (!this.MustHaveParamCount(this.GetByte(), 2)) return;

  let fPeriods = this.GetDouble();
  const fNominal = this.GetDouble();
  if (fPeriods < 1.0 || fNominal < 0.0) this.PushIllegalArgument();
  else if (fNominal === 0.0) this.PushDouble(0.0);
  else {
    fPeriods = approxFloor(fPeriods);
    this.PushDouble(Math.pow(1.0 + fNominal / fPeriods, fPeriods) - 1.0);
  }
};

ScInterpreter.prototype.ScNominal = function (this: ScInterpreter): void {
  this.nFuncFmtType = SvNumFormatType.PERCENT;
  if (this.MustHaveParamCount(this.GetByte(), 2)) {
    let fPeriods = this.GetDouble();
    const fEffective = this.GetDouble();
    if (fPeriods < 1.0 || fEffective <= 0.0) this.PushIllegalArgument();
    else {
      fPeriods = approxFloor(fPeriods);
      this.PushDouble((Math.pow(fEffective + 1.0, 1.0 / fPeriods) - 1.0) * fPeriods);
    }
  }
};

ScInterpreter.Register(OC.ocNPV, ScInterpreter.prototype.ScNPV);
ScInterpreter.Register(OC.ocIRR, ScInterpreter.prototype.ScIRR);
ScInterpreter.Register(OC.ocMIRR, ScInterpreter.prototype.ScMIRR);
ScInterpreter.Register(OC.ocISPMT, ScInterpreter.prototype.ScISPMT);
ScInterpreter.Register(OC.ocPV, ScInterpreter.prototype.ScPV);
ScInterpreter.Register(OC.ocSYD, ScInterpreter.prototype.ScSYD);
ScInterpreter.Register(OC.ocDDB, ScInterpreter.prototype.ScDDB);
ScInterpreter.Register(OC.ocDB, ScInterpreter.prototype.ScDB);
ScInterpreter.Register(OC.ocVBD, ScInterpreter.prototype.ScVDB);
ScInterpreter.Register(OC.ocPDuration, ScInterpreter.prototype.ScPDuration);
ScInterpreter.Register(OC.ocSLN, ScInterpreter.prototype.ScSLN);
ScInterpreter.Register(OC.ocPMT, ScInterpreter.prototype.ScPMT);
ScInterpreter.Register(OC.ocRRI, ScInterpreter.prototype.ScRRI);
ScInterpreter.Register(OC.ocFV, ScInterpreter.prototype.ScFV);
ScInterpreter.Register(OC.ocNper, ScInterpreter.prototype.ScNper);
ScInterpreter.Register(OC.ocRate, ScInterpreter.prototype.ScRate);
ScInterpreter.Register(OC.ocIpmt, ScInterpreter.prototype.ScIpmt);
ScInterpreter.Register(OC.ocPpmt, ScInterpreter.prototype.ScPpmt);
ScInterpreter.Register(OC.ocCumIpmt, ScInterpreter.prototype.ScCumIpmt);
ScInterpreter.Register(OC.ocCumPrinc, ScInterpreter.prototype.ScCumPrinc);
ScInterpreter.Register(OC.ocEffect, ScInterpreter.prototype.ScEffect);
ScInterpreter.Register(OC.ocNominal, ScInterpreter.prototype.ScNominal);

// @@ FINANCIAL @@

// --- reference operators ------------------------------------------------------------------------

ScInterpreter.prototype.ScIntersect = function (this: ScInterpreter): void {
  const p2nd = this.PopToken();
  const p1st = this.PopToken();
  if (this.nGlobalError !== FormulaError.NONE || !p2nd || !p1st) {
    this.PushIllegalArgument();
    return;
  }
  const sv1 = p1st.GetType();
  const sv2 = p2nd.GetType();
  if ((sv1 !== svSingleRef && sv1 !== svDoubleRef && sv1 !== svRefList) || (sv2 !== svSingleRef && sv2 !== svDoubleRef && sv2 !== svRefList)) {
    this.PushIllegalArgument();
    return;
  }
  if (sv1 === svRefList || sv2 === svRefList) {
    // Now this is a bit nasty but it simplifies things, and having
    // intersections with lists isn't too common, if at all...
    // Convert a reference to list.
    const toList = (t: FormulaToken, sv: number): ScRefList => {
      if (sv === svSingleRef) {
        const aRef = new ScComplexRefData();
        aRef.Ref1 = t.GetSingleRef().clone();
        aRef.Ref2 = t.GetSingleRef().clone();
        return [aRef];
      }
      if (sv === svDoubleRef) return [t.GetDoubleRef() as ScComplexRefData];
      return t.GetRefList() as ScRefList;
    };
    const l1 = toList(p1st, sv1), l2 = toList(p2nd, sv2);
    const xRes = new ScRefListToken();
    const pRefList = xRes.GetRefList();
    for (const rRef1 of l1) {
      const r11 = rRef1.Ref1.toAbs(this.mrDoc, this.aPos);
      const r12 = rRef1.Ref2.toAbs(this.mrDoc, this.aPos);
      for (const rRef2 of l2) {
        const r21 = rRef2.Ref1.toAbs(this.mrDoc, this.aPos);
        const r22 = rRef2.Ref2.toAbs(this.mrDoc, this.aPos);
        const nCol1 = Math.max(r11.Col(), r21.Col());
        const nRow1 = Math.max(r11.Row(), r21.Row());
        const nTab1 = Math.max(r11.Tab(), r21.Tab());
        const nCol2 = Math.min(r12.Col(), r22.Col());
        const nRow2 = Math.min(r12.Row(), r22.Row());
        const nTab2 = Math.min(r12.Tab(), r22.Tab());
        if (nCol2 < nCol1 || nRow2 < nRow1 || nTab2 < nTab1) {
          // nothing
        } else {
          const aRef = new ScComplexRefData();
          aRef.InitRange(nCol1, nRow1, nTab1, nCol2, nRow2, nTab2);
          pRefList.push(aRef);
        }
      }
    }
    const n = pRefList.length;
    if (!n) this.PushError(FormulaError.NoCode);
    else if (n === 1) {
      const rRef = pRefList[0]!;
      if (rRef.Ref1.equals(rRef.Ref2)) this.PushTempToken(new ScSingleRefToken(this.mrDoc.GetSheetLimits(), rRef.Ref1));
      else this.PushTempToken(new ScDoubleRefToken(this.mrDoc.GetSheetLimits(), rRef));
    } else this.PushTokenRef(xRes);
  } else {
    const pt = [p1st, p2nd];
    const sv = [sv1, sv2];
    const nC1 = [0, 0], nC2 = [0, 0], nR1 = [0, 0], nR2 = [0, 0], nT1 = [0, 0], nT2 = [0, 0];
    for (let i = 0; i < 2; ++i) {
      const r = (sv[i] === svSingleRef ? pt[i]!.GetSingleRef() : (pt[i]!.GetDoubleRef() as ScComplexRefData).Ref1).toAbs(this.mrDoc, this.aPos);
      nC1[i] = r.Col();
      nR1[i] = r.Row();
      nT1[i] = r.Tab();
      if (sv[i] === svDoubleRef) {
        const r2 = (pt[i]!.GetDoubleRef() as ScComplexRefData).Ref2.toAbs(this.mrDoc, this.aPos);
        nC2[i] = r2.Col();
        nR2[i] = r2.Row();
        nT2[i] = r2.Tab();
      } else {
        nC2[i] = nC1[i]!;
        nR2[i] = nR1[i]!;
        nT2[i] = nT1[i]!;
      }
    }
    const nCol1 = Math.max(nC1[0]!, nC1[1]!);
    const nRow1 = Math.max(nR1[0]!, nR1[1]!);
    const nTab1 = Math.max(nT1[0]!, nT1[1]!);
    const nCol2 = Math.min(nC2[0]!, nC2[1]!);
    const nRow2 = Math.min(nR2[0]!, nR2[1]!);
    const nTab2 = Math.min(nT2[0]!, nT2[1]!);
    if (nCol2 < nCol1 || nRow2 < nRow1 || nTab2 < nTab1) this.PushError(FormulaError.NoCode);
    else if (nCol2 === nCol1 && nRow2 === nRow1 && nTab2 === nTab1) this.PushSingleRef(nCol1, nRow1, nTab1);
    else this.PushDoubleRef(nCol1, nRow1, nTab1, nCol2, nRow2, nTab2);
  }
};

ScInterpreter.prototype.ScRangeFunc = function (this: ScInterpreter): void {
  const x2 = this.PopToken();
  const x1 = this.PopToken();
  if (this.nGlobalError !== FormulaError.NONE || !x2 || !x1) {
    this.PushIllegalArgument();
    return;
  }
  // We explicitly tell extendRangeReference() to not reuse the token,
  // casting const away spares two clones.
  const xRes = extendRangeReference(this.mrDoc.GetSheetLimits(), x1, x2, this.aPos, false);
  if (!xRes) this.PushIllegalArgument();
  else this.PushTokenRef(xRes);
};

ScInterpreter.prototype.ValidateRef = function (this: ScInterpreter, rRefList: ScRefList): void {
  for (const rRef of rRefList) this.DoubleRefToRange(rRef);
};

ScInterpreter.prototype.ScUnionFunc = function (this: ScInterpreter): void {
  const p2nd = this.PopToken();
  const p1st = this.PopToken();
  if (this.nGlobalError !== FormulaError.NONE || !p2nd || !p1st) {
    this.PushIllegalArgument();
    return;
  }
  let sv1 = p1st.GetType();
  let sv2 = p2nd.GetType();
  if ((sv1 !== svSingleRef && sv1 !== svDoubleRef && sv1 !== svRefList) || (sv2 !== svSingleRef && sv2 !== svDoubleRef && sv2 !== svRefList)) {
    this.PushIllegalArgument();
    return;
  }
  let xRes: FormulaToken;
  // Append to an existing RefList if there is one.
  if (sv1 === svRefList) {
    xRes = p1st.Clone();
    sv1 = svUnknown; // mark as handled
  } else if (sv2 === svRefList) {
    xRes = p2nd.Clone();
    sv2 = svUnknown; // mark as handled
  } else xRes = new ScRefListToken();
  const pRes = xRes.GetRefList() as ScRefList;
  const pt = [p1st, p2nd];
  const sv = [sv1, sv2];
  for (let i = 0; i < 2; ++i) {
    switch (sv[i]) {
      case svSingleRef: {
        const aRef = new ScComplexRefData();
        aRef.Ref1 = pt[i]!.GetSingleRef().clone();
        aRef.Ref2 = pt[i]!.GetSingleRef().clone();
        pRes.push(aRef);
        break;
      }
      case svDoubleRef:
        pRes.push((pt[i]!.GetDoubleRef() as ScComplexRefData).clone());
        break;
      case svRefList:
        for (const rRef of pt[i]!.GetRefList() as ScRefList) pRes.push(rRef.clone());
        break;
      default:
      // nothing, prevent compiler warning
    }
  }
  this.ValidateRef(pRes); // set #REF! if needed
  this.PushTokenRef(xRes);
};

ScInterpreter.prototype.ScCurrent = function (this: ScInterpreter): void {
  const xTok = this.PopToken();
  if (xTok) {
    this.PushTokenRef(xTok);
    this.PushTokenRef(xTok);
  } else this.PushError(FormulaError.UnknownStackVariable);
};

ScInterpreter.Register(OC.ocIntersect, ScInterpreter.prototype.ScIntersect);
ScInterpreter.Register(OC.ocRange, ScInterpreter.prototype.ScRangeFunc);
ScInterpreter.Register(OC.ocUnion, ScInterpreter.prototype.ScUnionFunc);
ScInterpreter.Register(OC.ocCurrent, ScInterpreter.prototype.ScCurrent);
