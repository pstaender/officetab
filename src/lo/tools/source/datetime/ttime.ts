// SPDX-License-Identifier: MPL-2.0
// @upstream include/tools/time.hxx partial
// @upstream tools/source/datetime/ttime.cxx partial
// tools::Time: only the unit constants and the static GetClock(), which splits a time of day
// (a fraction of a day) into hours, minutes, seconds and the fraction of a second. The Time
// value class itself (encoded HHMMSSnnnnnnnnn) is not ported.
import { approxFloor, round } from '../../../sal/rtl/math.ts';

export const Time = {
  hourPerDay: 24,
  minutePerHour: 60,
  secondPerMinute: 60,
  nanoSecPerSec: 1000000000,
  nanoSecPerMinute: 1000000000 * 60,
  nanoSecPerHour: 1000000000 * 60 * 60,
  nanoSecPerDay: 1000000000 * 60 * 60 * 24,
  secondPerHour: 60 * 60,
  secondPerDay: 60 * 60 * 24,
  minutePerDay: 60 * 24,

  /** Get the wall clock time particles for a (date+)time value.

      Does the necessary rounding and truncating to obtain hour, minute,
      second and fraction of second from a double time value (time in days,
      0.5 == 12h) such that individual values are not rounded up, i.e.
      x:59:59.999 does not yield x+1:0:0.00

      A potential date component (fTimeInDays >= 1.0) is discarded.

      @param  nFractionDecimals
              If > 0 fFractionOfSecond is truncated to that amount of
              decimals.
              Else fFractionOfSecond returns the full remainder of the
              fractional second.
   */
  GetClock(fTimeInDays: number, nFractionDecimals: number): { nHour: number; nMinute: number; nSecond: number; fFractionOfSecond: number } {
    const fTime = fTimeInDays - approxFloor(fTimeInDays); // date part absent

    // If 0 then full day (or no day), shortcut.
    // If < 0 then approxFloor() effectively returned the ceiling (note this
    // also holds for negative fTimeInDays values) because of a near identical
    // value, shortcut this to a full day as well.
    // If >= 1.0 (actually == 1.0) then fTimeInDays is a negative small value
    // not significant for a representable time and approxFloor() returned -1,
    // shortcut to 0:0:0, otherwise it would become 24:0:0.
    if (fTime <= 0.0 || fTime >= 1.0) {
      return { nHour: 0, nMinute: 0, nSecond: 0, fFractionOfSecond: 0.0 };
    }

    // In seconds, including milli and nano.
    const fRawSeconds = fTime * Time.secondPerDay;

    // Round to nanoseconds most, which is the highest resolution this could be
    // influenced by, but if the original value included a date round to at
    // most 14 significant digits (including adding 4 for *86400), otherwise we
    // might end up with a fake precision of h:m:s.999999986 which in fact
    // should had been h:m:s+1
    // BUT, leave at least 2 decimals to round. Which shouldn't be a problem in
    // practice because class Date can calculate only 8-digit days for it's
    // sal_Int16 year range, which exactly leaves us with 14-4-8=2.
    let nDec = 9;
    const fAbsTimeInDays = Math.abs(fTimeInDays);
    if (fAbsTimeInDays >= 1.0) {
      const nDig = Math.trunc(Math.ceil(Math.log10(fAbsTimeInDays)));
      nDec = Math.min(Math.max(10 - nDig, 2), 9);
    }
    let fSeconds = round(fRawSeconds, nDec);

    // If this ended up as a full day the original value was very very close
    // but not quite. Take that.
    if (fSeconds >= Time.secondPerDay) fSeconds = fRawSeconds;

    // Now do not round values (specifically not up), but truncate to the next
    // magnitude, so 23:59:59.99 is still 23:59:59 and not 24:00:00 (or even
    // 00:00:00 which Excel does).
    const nHour = Math.trunc(fSeconds / Time.secondPerHour);
    fSeconds -= nHour * Time.secondPerHour;
    const nMinute = Math.trunc(fSeconds / Time.secondPerMinute);
    fSeconds -= nMinute * Time.secondPerMinute;
    const nSecond = Math.trunc(fSeconds);
    fSeconds -= nSecond;

    let fFractionOfSecond: number;
    if (nFractionDecimals > 0) {
      // Do not simply round the fraction, otherwise .999 would end up as .00
      // again. Truncate instead if rounding would round up into an integer
      // value.
      fFractionOfSecond = round(fSeconds, nFractionDecimals);
      if (fFractionOfSecond >= 1.0) fFractionOfSecond = Math.trunc(fSeconds * Math.pow(10, nFractionDecimals)) / Math.pow(10, nFractionDecimals);
    } else fFractionOfSecond = fSeconds;
    return { nHour, nMinute, nSecond, fFractionOfSecond };
  },
} as const;
