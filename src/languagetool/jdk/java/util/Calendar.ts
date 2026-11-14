// SPDX-License-Identifier: MPL-2.0
// java.util.Calendar (a GregorianCalendar) for the LanguageTool ports: not a port, the part of the
// JDK's API the date filters use. Fields are kept as set and the date is computed when a field is
// read, as Java does: a non-lenient calendar with an invalid date (32 August, 29 February 2023)
// throws IllegalArgumentException on get(), after() or getTimeInMillis(), a lenient one rolls
// over. Dates are computed in the proleptic Gregorian calendar (Java switches to the Julian
// calendar before October 1582) and in the local time zone. set(DAY_OF_WEEK, d) moves the date
// to that day within the same week (the week starts on Sunday, or on Monday for a European
// locale such as Locale.UK). Display names come from Intl.DateTimeFormat.
import { Locale } from './Locale.ts';

type Field = number;

/** Locales whose week starts on Sunday (Java's firstDayOfWeek from the CLDR data). */
const SUNDAY_FIRST_COUNTRIES = new Set(['', 'US', 'CA', 'JP', 'BR', 'IL', 'PH', 'ZA', 'MX', 'IN', 'AU']);

export class Calendar {
  static readonly ERA = 0;
  static readonly YEAR = 1;
  static readonly MONTH = 2;
  static readonly DAY_OF_MONTH = 5;
  static readonly DAY_OF_YEAR = 6;
  static readonly DAY_OF_WEEK = 7;
  static readonly HOUR_OF_DAY = 11;
  static readonly MINUTE = 12;
  static readonly SECOND = 13;
  static readonly MILLISECOND = 14;

  static readonly SUNDAY = 1;
  static readonly MONDAY = 2;
  static readonly TUESDAY = 3;
  static readonly WEDNESDAY = 4;
  static readonly THURSDAY = 5;
  static readonly FRIDAY = 6;
  static readonly SATURDAY = 7;

  static readonly JANUARY = 0;
  static readonly FEBRUARY = 1;
  static readonly DECEMBER = 11;

  static readonly SHORT = 1;
  static readonly LONG = 2;

  private year: number;
  private month: number;
  private dayOfMonth: number;
  private hour: number;
  private minute: number;
  private second: number;
  private millis: number;
  /** A DAY_OF_WEEK set after the date, applied when the date is computed. */
  private pendingDayOfWeek: number | null = null;
  private lenient = true;
  private readonly firstDayOfWeek: number;

  private constructor(date: Date, locale: Locale) {
    this.year = date.getFullYear();
    this.month = date.getMonth();
    this.dayOfMonth = date.getDate();
    this.hour = date.getHours();
    this.minute = date.getMinutes();
    this.second = date.getSeconds();
    this.millis = date.getMilliseconds();
    this.firstDayOfWeek = SUNDAY_FIRST_COUNTRIES.has(locale.getCountry()) ? Calendar.SUNDAY : Calendar.MONDAY;
  }

  /** Calendar.getInstance([locale]): now, in the local time zone. */
  static getInstance(locale: Locale = Locale.getDefault()): Calendar {
    return new Calendar(new Date(), locale);
  }

  setLenient(lenient: boolean): void {
    this.lenient = lenient;
  }

  isLenient(): boolean {
    return this.lenient;
  }

  /** set(field, value) or set(year, month, date[, hourOfDay, minute, second]). */
  set(fieldOrYear: Field, valueOrMonth: number, date?: number, hourOfDay?: number, minute?: number, second?: number): void {
    if (date === undefined) {
      this.setField(fieldOrYear, valueOrMonth);
      return;
    }
    this.normalizeDayOfWeek();
    this.year = fieldOrYear;
    this.month = valueOrMonth;
    this.dayOfMonth = date;
    if (hourOfDay !== undefined) this.hour = hourOfDay;
    if (minute !== undefined) this.minute = minute;
    if (second !== undefined) this.second = second;
  }

  private setField(field: Field, value: number): void {
    switch (field) {
      case Calendar.YEAR: this.normalizeDayOfWeek(); this.year = value; break;
      case Calendar.MONTH: this.normalizeDayOfWeek(); this.month = value; break;
      case Calendar.DAY_OF_MONTH: this.pendingDayOfWeek = null; this.dayOfMonth = value; break;
      case Calendar.DAY_OF_WEEK: this.pendingDayOfWeek = value; break;
      case Calendar.HOUR_OF_DAY: this.hour = value; break;
      case Calendar.MINUTE: this.minute = value; break;
      case Calendar.SECOND: this.second = value; break;
      case Calendar.MILLISECOND: this.millis = value; break;
      default: throw new Error('IllegalArgumentException: unsupported Calendar field ' + field);
    }
  }

  /** Applies a pending DAY_OF_WEEK to the date fields (before other date fields change). */
  private normalizeDayOfWeek(): void {
    if (this.pendingDayOfWeek != null) {
      const d = this.compute();
      this.year = d.getUTCFullYear();
      this.month = d.getUTCMonth();
      this.dayOfMonth = d.getUTCDate();
      this.pendingDayOfWeek = null;
    }
  }

  /** The date (as a UTC Date holding the local fields), validated if not lenient. */
  private compute(): Date {
    if (!this.lenient) {
      if (this.year < 1 || this.month < 0 || this.month > 11 || this.dayOfMonth < 1
          || this.dayOfMonth > daysInMonth(this.year, this.month)
          || this.hour < 0 || this.hour > 23 || this.minute < 0 || this.minute > 59 || this.second < 0 || this.second > 59
          || this.millis < 0 || this.millis > 999
          || (this.pendingDayOfWeek != null && (this.pendingDayOfWeek < 1 || this.pendingDayOfWeek > 7))) {
        throw new Error('IllegalArgumentException: invalid date ' + this.year + '-' + (this.month + 1) + '-' + this.dayOfMonth);
      }
    }
    const d = new Date(0);
    d.setUTCFullYear(this.year, this.month, this.dayOfMonth);
    d.setUTCHours(this.hour, this.minute, this.second, this.millis);
    if (this.pendingDayOfWeek != null) {
      const dow = d.getUTCDay() + 1;
      const offsetInWeek = (dow - this.firstDayOfWeek + 7) % 7;
      const targetOffset = (this.pendingDayOfWeek - this.firstDayOfWeek + 7) % 7;
      d.setUTCDate(d.getUTCDate() + targetOffset - offsetInWeek);
    }
    return d;
  }

  get(field: Field): number {
    const d = this.compute();
    switch (field) {
      case Calendar.ERA: return d.getUTCFullYear() > 0 ? 1 : 0;
      case Calendar.YEAR: return d.getUTCFullYear();
      case Calendar.MONTH: return d.getUTCMonth();
      case Calendar.DAY_OF_MONTH: return d.getUTCDate();
      case Calendar.DAY_OF_WEEK: return d.getUTCDay() + 1;
      case Calendar.DAY_OF_YEAR: {
        const start = new Date(0);
        start.setUTCFullYear(d.getUTCFullYear(), 0, 1);
        return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
      }
      case Calendar.HOUR_OF_DAY: return d.getUTCHours();
      case Calendar.MINUTE: return d.getUTCMinutes();
      case Calendar.SECOND: return d.getUTCSeconds();
      case Calendar.MILLISECOND: return d.getUTCMilliseconds();
      default: throw new Error('IllegalArgumentException: unsupported Calendar field ' + field);
    }
  }

  /** Milliseconds since the epoch (of the local date). */
  getTimeInMillis(): number {
    const d = this.compute();
    return localMillis(d);
  }

  after(when: unknown): boolean {
    return when instanceof Calendar && this.getTimeInMillis() > when.getTimeInMillis();
  }

  before(when: unknown): boolean {
    return when instanceof Calendar && this.getTimeInMillis() < when.getTimeInMillis();
  }

  /** getDisplayName(field, style, locale) for DAY_OF_WEEK and MONTH. */
  getDisplayName(field: Field, style: number, locale: Locale): string | null {
    const d = this.compute();
    const tag = locale.getCountry() !== '' ? locale.getLanguage() + '-' + locale.getCountry() : locale.getLanguage();
    const width = style === Calendar.SHORT ? 'short' : 'long';
    if (field === Calendar.DAY_OF_WEEK) {
      return new Intl.DateTimeFormat(tag, { weekday: width, timeZone: 'UTC' }).format(d);
    }
    if (field === Calendar.MONTH) {
      return new Intl.DateTimeFormat(tag, { month: width, timeZone: 'UTC' }).format(d);
    }
    return null;
  }

  /** Calendar.Builder: only setDate(year, month, dayOfMonth) and build(). */
  static readonly Builder = class Builder {
    private y = 1970;
    private m = 0;
    private d = 1;
    setDate(year: number, month: number, dayOfMonth: number): Builder {
      this.y = year;
      this.m = month;
      this.d = dayOfMonth;
      return this;
    }
    build(): Calendar {
      const cal = Calendar.getInstance();
      cal.set(this.y, this.m, this.d, 0, 0, 0);
      cal.set(Calendar.MILLISECOND, 0);
      return cal;
    }
  };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]!;
}

/** The epoch milliseconds of a local date whose fields are held by a UTC Date. */
function localMillis(d: Date): number {
  const local = new Date(0);
  local.setFullYear(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  local.setHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return local.getTime();
}
