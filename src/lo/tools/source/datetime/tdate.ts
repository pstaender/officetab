// SPDX-License-Identifier: MPL-2.0
// @upstream include/tools/date.hxx partial
// @upstream tools/source/datetime/tdate.cxx partial
// tools' Date: a date encoded as YYYYMMDD (negative for BCE) in a 32-bit integer. Ported are
// the parts the spreadsheet functions use: day arithmetic, the calendar queries and
// normalization. Left out: the system date constructor (the caller takes "now" from the
// document), the UNO conversions, AddYears/AddMonths and the comparison operators. The
// operators become functions: `aDate1 - aDate2` is DateDiff(aDate1, aDate2).
import {
  convertDateToDays, convertDateToDaysNormalizing, convertDaysToDate, getDaysInMonth as comphelper_getDaysInMonth,
  isLeapYear as comphelper_isLeapYear, isValidDate as comphelper_isValidDate, normalize as comphelper_normalize,
} from '../../../comphelper/source/misc/date.ts';

export const DayOfWeek = { MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6 } as const;
export type DayOfWeek = (typeof DayOfWeek)[keyof typeof DayOfWeek];
const { MONDAY } = DayOfWeek;

export class Date {
  private mnDate = 0;

  /** Date(nDay, nMonth, nYear), or a copy of a date. */
  constructor(nDay: number | Date = 0, nMonth = 0, nYear = 0) {
    if (nDay instanceof Date) this.mnDate = nDay.mnDate;
    else this.setDateFromDMY(nDay, nMonth, nYear);
  }

  private setDateFromDMY(nDay: number, nMonth: number, nYear: number): void {
    if (nYear < 0) this.mnDate = nYear * 10000 - (nMonth % 100) * 100 - (nDay % 100);
    else this.mnDate = nYear * 10000 + (nMonth % 100) * 100 + (nDay % 100);
  }

  SetDate(nNewDate: number): void { this.mnDate = nNewDate; }
  GetDate(): number { return this.mnDate; }

  GetDay(): number { return Math.abs(this.mnDate) % 100; }
  GetMonth(): number { return Math.trunc(Math.abs(this.mnDate) / 100) % 100; }
  GetYear(): number { return Math.trunc(this.mnDate / 10000); }
  GetNextYear(): number { const nY = this.GetYear(); return nY === -1 ? 1 : nY + 1; }
  GetPrevYear(): number { const nY = this.GetYear(); return nY === 1 ? -1 : nY - 1; }

  /** GetDaysInMonth(nMonth, nYear) (static) or the days of this date's month. */
  static GetDaysInMonth(nMonth: number, nYear: number): number {
    if (nMonth < 1) nMonth = 1;
    else if (12 < nMonth) nMonth = 12;
    return comphelper_getDaysInMonth(nMonth, nYear);
  }

  GetAsNormalizedDays(): number {
    // This is a very common datum we often calculate from.
    if (this.mnDate === 18991230) {
      return convertDateToDays(30, 12, 1899);
    }
    // Not calling comphelper::date::convertDateToDaysNormalizing() here just
    // avoids a second check on null-date handling like above.
    const r = comphelper_normalize(this.GetDay(), this.GetMonth(), this.GetYear());
    return convertDateToDays(r.rDay, r.rMonth, r.rYear);
  }

  static DateToDays(nDay: number, nMonth: number, nYear: number): number {
    return convertDateToDaysNormalizing(nDay, nMonth, nYear);
  }

  SetDay(nNewDay: number): void { this.setDateFromDMY(nNewDay, this.GetMonth(), this.GetYear()); }
  SetMonth(nNewMonth: number): void { this.setDateFromDMY(this.GetDay(), nNewMonth, this.GetYear()); }
  SetYear(nNewYear: number): void { this.setDateFromDMY(this.GetDay(), this.GetMonth(), nNewYear); }

  GetDayOfWeek(): DayOfWeek {
    return ((this.GetAsNormalizedDays() - 1) % 7) as DayOfWeek;
  }

  GetDayOfYear(): number {
    const r = comphelper_normalize(this.GetDay(), this.GetMonth(), this.GetYear());
    let nDay = r.rDay;
    for (let i = 1; i < r.rMonth; i++) nDay += comphelper_getDaysInMonth(i, r.rYear);
    return nDay;
  }

  GetWeekOfYear(eStartDay: DayOfWeek = MONDAY, nMinimumNumberOfDaysInWeek = 4): number {
    let n1WDay: number = new Date(1, 1, this.GetYear()).GetDayOfWeek();
    let nDayOfYear = this.GetDayOfYear();

    // weekdays start at 0, thus decrement one
    nDayOfYear--;
    // account for StartDay
    n1WDay = (n1WDay + (7 - eStartDay)) % 7;

    if (nMinimumNumberOfDaysInWeek < 1 || 7 < nMinimumNumberOfDaysInWeek) {
      nMinimumNumberOfDaysInWeek = 4;
    }

    let nWeek: number;
    if (nMinimumNumberOfDaysInWeek === 1) {
      nWeek = Math.trunc((n1WDay + nDayOfYear) / 7) + 1;
      // Set to 53rd week only if we're not in the
      // first week of the new year
      if (nWeek === 54) nWeek = 1;
      else if (nWeek === 53) {
        const nDaysInYear = this.GetDaysInYear();
        let nDaysNextYear: number = new Date(1, 1, this.GetNextYear()).GetDayOfWeek();
        nDaysNextYear = (nDaysNextYear + (7 - eStartDay)) % 7;
        if (nDayOfYear > nDaysInYear - nDaysNextYear - 1) nWeek = 1;
      }
    } else if (nMinimumNumberOfDaysInWeek === 7) {
      nWeek = Math.trunc((n1WDay + nDayOfYear) / 7);
      // First week of a year is equal to the last week of the previous year
      if (nWeek === 0) {
        const aLastDatePrevYear = new Date(31, 12, this.GetPrevYear());
        nWeek = aLastDatePrevYear.GetWeekOfYear(eStartDay, nMinimumNumberOfDaysInWeek);
      }
    } else {
      // ( nMinimumNumberOfDaysInWeek == something_else, commentary examples for 4 )
      // x_monday - thursday
      if (n1WDay < nMinimumNumberOfDaysInWeek) nWeek = 1;
      // Friday
      else if (n1WDay === nMinimumNumberOfDaysInWeek) nWeek = 53;
      // Saturday
      else if (n1WDay === nMinimumNumberOfDaysInWeek + 1) {
        // Year after leap year
        if (new Date(1, 1, this.GetPrevYear()).IsLeapYear()) nWeek = 53;
        else nWeek = 52;
      }
      // Sunday
      else nWeek = 52;

      if (nWeek === 1 || nDayOfYear + n1WDay > 6) {
        if (nWeek === 1) nWeek += Math.trunc((nDayOfYear + n1WDay) / 7);
        else nWeek = Math.trunc((nDayOfYear + n1WDay) / 7);
        if (nWeek === 53) {
          // next x_Sunday == first x_Sunday in the new year
          // == still the same week!
          let nTempDays = this.GetAsNormalizedDays();

          nTempDays += 6 - ((this.GetDayOfWeek() + (7 - eStartDay)) % 7);
          nWeek = lcl_DaysToDate(nTempDays).GetWeekOfYear(eStartDay, nMinimumNumberOfDaysInWeek);
        }
      }
    }

    return nWeek;
  }

  GetDaysInMonth(): number {
    const r = comphelper_normalize(this.GetDay(), this.GetMonth(), this.GetYear());
    return comphelper_getDaysInMonth(r.rMonth, r.rYear);
  }

  GetDaysInYear(): number { return this.IsLeapYear() ? 366 : 365; }

  IsLeapYear(): boolean {
    const nYear = this.GetYear();
    return comphelper_isLeapYear(nYear);
  }

  IsValidAndGregorian(): boolean {
    const nDay = this.GetDay();
    const nMonth = this.GetMonth();
    const nYear = this.GetYear();

    if (!nMonth || nMonth > 12) return false;
    if (!nDay || nDay > comphelper_getDaysInMonth(nMonth, nYear)) return false;
    else if (nYear <= 1582) {
      if (nYear < 1582) return false;
      else if (nMonth < 10) return false;
      else if (nMonth === 10 && nDay < 15) return false;
    }

    return true;
  }

  IsValidDate(): boolean {
    return comphelper_isValidDate(this.GetDay(), this.GetMonth(), this.GetYear());
  }

  Normalize(): void {
    const r = comphelper_normalize(this.GetDay(), this.GetMonth(), this.GetYear());
    if (!r.bNormalized) return;

    this.setDateFromDMY(r.rDay, r.rMonth, r.rYear);
  }

  AddDays(nDays: number): void {
    if (nDays !== 0) this.mnDate = lcl_DaysToDate(this.GetAsNormalizedDays() + nDays).mnDate;
  }

  CheckedAddDays(nDays: number): boolean {
    if (nDays === 0) return true;
    const nTotalDays = this.GetAsNormalizedDays() + nDays;
    // o3tl::checked_add on sal_Int32
    if (nTotalDays > 2147483647 || nTotalDays < -2147483648) return false;
    this.mnDate = lcl_DaysToDate(nTotalDays).mnDate;
    return true;
  }
}

function lcl_DaysToDate(nDays: number): Date {
  const r = convertDaysToDate(nDays);
  return new Date(r.rDay, r.rMonth, r.rYear);
}

/** operator-(const Date&, const Date&): the days between two dates. */
export function DateDiff(rDate1: Date, rDate2: Date): number {
  return rDate1.GetAsNormalizedDays() - rDate2.GetAsNormalizedDays();
}
