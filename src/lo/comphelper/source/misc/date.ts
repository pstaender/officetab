// SPDX-License-Identifier: MPL-2.0
// @upstream include/comphelper/date.hxx faithful
// @upstream comphelper/source/misc/date.cxx faithful
// comphelper::date: the proleptic Gregorian calendar helpers behind tools' Date. Days are
// counted from 0001-01-01 (day 1); years are 16-bit and never 0. Out-params are returned as
// objects; the C integer divisions are truncated with Math.trunc.

const kYearMax = 32767; // SAL_MAX_INT16
const kYearMin = -32768; // SAL_MIN_INT16

/** Days until start of year from zero, so month and day of month can be added.

    year 1 => 0 days, year 2 => 365 days, ...
    year -1 => -366 days, year -2 => -731 days, ...

    @param  nYear
            MUST be != 0.
 */
export function YearToDays(nYear: number): number {
  const val = (off: number, y: number): number => off + y * 365 + Math.trunc(y / 4) - Math.trunc(y / 100) + Math.trunc(y / 400);
  return nYear < 0 ? val(-366, nYear + 1) : val(0, nYear - 1);
}

/** Whether year is a leap year.

    Leap years BCE are -1, -5, -9, ...
    See
    https://en.wikipedia.org/wiki/Proleptic_Gregorian_calendar#Usage
    https://en.wikipedia.org/wiki/0_(year)#History_of_astronomical_usage

    @param  nYear
            MUST be != 0.
 */
export function isLeapYear(nYear: number): boolean {
  if (nYear < 0) nYear = -nYear - 1;
  return (nYear % 4 === 0 && nYear % 100 !== 0) || nYear % 400 === 0;
}

const aDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Get number of days in month of year.

    @param  nYear
            MUST be != 0.
 */
export function getDaysInMonth(nMonth: number, nYear: number): number {
  if (nMonth < 1 || 12 < nMonth) return 0;

  const n = aDaysInMonth[nMonth - 1]!;
  return nMonth === 2 && isLeapYear(nYear) ? n + 1 : n;
}

/** Obtain days from zero for a given date, without normalizing.

    nDay, nMonth, nYear MUST form a valid proleptic Gregorian calendar date.
 */
export function convertDateToDays(nDay: number, nMonth: number, nYear: number): number {
  let nDays = YearToDays(nYear);
  for (let i = 1; i < nMonth; ++i) nDays += getDaysInMonth(i, nYear);
  nDays += nDay;
  return nDays;
}

// Once upon a time the number of days we internally handled in tools' class
// Date was limited to MAX_DAYS 3636532. That changed with a full 16-bit year.
// Assuming the first valid positive date in a proleptic Gregorian calendar is
// 0001-01-01, this resulted in an end date of 9957-06-26.
// Hence we documented that years up to and including 9956 are handled.

const MIN_DAYS = convertDateToDays(1, 1, kYearMin); // -32768-01-01
const MAX_DAYS = convertDateToDays(31, 12, kYearMax); // 32767-12-31

const nNullDateDays = convertDateToDays(30, 12, 1899);

/** Obtain days from zero for a given date, with normalizing.

    nDay, nMonth, nYear may be out-of-bounds and are adjusted/normalized.

    @param  nYear
            Must be != 0, unless nMonth > 12.
 */
export function convertDateToDaysNormalizing(nDay: number, nMonth: number, nYear: number): number {
  // Speed-up the common null-date 1899-12-30.
  if (nYear === 1899 && nMonth === 12 && nDay === 30) return nNullDateDays;

  const r = normalize(nDay, nMonth, nYear);
  return convertDateToDays(r.rDay, r.rMonth, r.rYear);
}

/** Whether date is a valid date. */
export function isValidDate(nDay: number, nMonth: number, nYear: number): boolean {
  if (nYear === 0) return false;
  if (nMonth < 1 || 12 < nMonth) return false;
  if (nDay < 1 || nDay > getDaysInMonth(nMonth, nYear)) return false;
  return true;
}

/** Obtain date for a days from zero value. */
export function convertDaysToDate(nDays: number): { rDay: number; rMonth: number; rYear: number } {
  if (nDays <= MIN_DAYS) return { rDay: 1, rMonth: 1, rYear: kYearMin };
  if (nDays >= MAX_DAYS) return { rDay: 31, rMonth: 12, rYear: kYearMax };

  // Day 0 is -0001-12-31, day 1 is 0001-01-01
  const nSign = nDays <= 0 ? -1 : 1;
  let nTempDays: number;
  let i = 0;
  let bCalc: boolean;
  let rYear: number;

  do {
    rYear = Math.trunc(nDays / 365) - i * nSign;
    if (rYear === 0) rYear = nSign;
    nTempDays = nDays - YearToDays(rYear);
    bCalc = false;
    if (nTempDays < 1) {
      i += nSign;
      bCalc = true;
    } else {
      if (nTempDays > 365) {
        if (nTempDays !== 366 || !isLeapYear(rYear)) {
          i -= nSign;
          bCalc = true;
        }
      }
    }
  } while (bCalc);

  let rMonth = 1;
  while (nTempDays > getDaysInMonth(rMonth, rYear)) {
    nTempDays -= getDaysInMonth(rMonth, rYear);
    ++rMonth;
  }

  return { rDay: nTempDays, rMonth, rYear };
}

/** Normalize date, i.e. add days or months to form a proper proleptic
    Gregorian calendar date, unless all values are 0.

    @param  rYear
            Must be != 0, unless rMonth > 12.

    @return bNormalized <TRUE/> if date was normalized, <FALSE/> if it was valid already
    or empty (all values 0).
 */
export function normalize(rDay: number, rMonth: number, rYear: number): { bNormalized: boolean; rDay: number; rMonth: number; rYear: number } {
  if (isValidDate(rDay, rMonth, rYear)) return { bNormalized: false, rDay, rMonth, rYear };

  if (rDay === 0 && rMonth === 0 && rYear === 0) return { bNormalized: false, rDay, rMonth, rYear }; // empty date

  if (rDay === 0) {
    if (rMonth === 0) {
      // nothing, handled below
    } else --rMonth;
    // Last day of month is determined at the end.
  }

  if (rMonth > 12) {
    rYear += Math.trunc(rMonth / 12);
    rMonth = rMonth % 12;
    if (rYear === 0) rYear = 1;
  }
  if (rMonth === 0) {
    --rYear;
    if (rYear === 0) rYear = -1;
    rMonth = 12;
  }

  if (rYear < 0) {
    let nDays: number;
    while (rDay > (nDays = getDaysInMonth(rMonth, rYear))) {
      rDay -= nDays;
      if (rMonth > 1) --rMonth;
      else {
        if (rYear === kYearMin) {
          rDay = 1;
          rMonth = 1;
          return { bNormalized: true, rDay, rMonth, rYear };
        }
        --rYear;
        rMonth = 12;
      }
    }
  } else {
    let nDays: number;
    while (rDay > (nDays = getDaysInMonth(rMonth, rYear))) {
      rDay -= nDays;
      if (rMonth < 12) ++rMonth;
      else {
        if (rYear === kYearMax) {
          rDay = 31;
          rMonth = 12;
          return { bNormalized: true, rDay, rMonth, rYear };
        }
        ++rYear;
        rMonth = 1;
      }
    }
  }

  if (rDay === 0) rDay = getDaysInMonth(rMonth, rYear);

  return { bNormalized: true, rDay, rMonth, rYear };
}
