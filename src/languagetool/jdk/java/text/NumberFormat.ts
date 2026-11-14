// SPDX-License-Identifier: MPL-2.0
// java.text.NumberFormat and DecimalFormat for the LanguageTool ports: not a port, the part they
// use: the number instance of English locales (pattern "#,##0.###": grouping by three with ",",
// "." as decimal separator, "-" as negative prefix), setMaximumFractionDigits, setRoundingMode,
// format and parse. Rounding is done on the exact binary value of the double, as Java (8 and later)
// does; a negative number that rounds to zero keeps its sign ("-0"), as in Java. parse reads the
// longest prefix that is a number, skipping grouping separators before the decimal separator, and
// throws ParseException if there is none.
import { Locale } from '../util/Locale.ts';
import { RoundingMode } from '../math/RoundingMode.ts';

/** java.text.ParseException */
export class ParseException extends Error {
  readonly errorOffset: number;
  constructor(message: string, errorOffset: number) {
    super('ParseException: ' + message);
    this.errorOffset = errorOffset;
  }
  getErrorOffset(): number { return this.errorOffset; }
}

/** The decimal digits of |x| rounded to `fraction` digits after the point, by `mode`. */
function roundAbs(x: number, fraction: number, mode: RoundingMode): string {
  const abs = Math.abs(x);
  if (mode === RoundingMode.HALF_UP) {
    // toFixed rounds the exact value, ties away from zero
    return abs.toFixed(fraction);
  }
  // the exact value with enough digits to see a tie
  const exact = abs.toFixed(Math.min(100, fraction + 40));
  const point = exact.indexOf('.');
  const kept = exact.substring(0, point + 1 + fraction).replace(/\.$/, '');
  const rest = exact.substring(point + 1 + fraction);
  let up: boolean;
  switch (mode) {
    case RoundingMode.DOWN: case RoundingMode.FLOOR: up = mode === RoundingMode.FLOOR ? x < 0 && /[1-9]/.test(rest) : false; break;
    case RoundingMode.UP: up = /[1-9]/.test(rest); break;
    case RoundingMode.CEILING: up = x > 0 && /[1-9]/.test(rest); break;
    case RoundingMode.HALF_DOWN: up = /^5\d*[1-9]|^[6-9]/.test(rest); break;
    default: { // HALF_EVEN
      if (/^5[0]*$/.test(rest)) {
        const last = kept.replace('.', '').slice(-1);
        up = (Number(last) % 2) === 1;
      } else {
        up = /^[6-9]|^5/.test(rest);
      }
    }
  }
  if (!up) return kept;
  // add one unit in the last place
  const digits = kept.replace('.', '').split('').map(Number);
  let i = digits.length - 1;
  while (i >= 0) {
    if (digits[i]! < 9) { digits[i]!++; break; }
    digits[i] = 0;
    i--;
  }
  if (i < 0) digits.unshift(1);
  const s = digits.join('');
  return fraction === 0 ? s : s.substring(0, s.length - fraction) + '.' + s.substring(s.length - fraction);
}

export class NumberFormat {
  protected maximumFractionDigits = 3;
  protected minimumFractionDigits = 0;
  protected roundingMode: RoundingMode = RoundingMode.HALF_EVEN;
  protected groupingUsed = true;
  protected readonly locale: Locale;

  protected constructor(locale: Locale) {
    this.locale = locale;
  }

  /** The number instance; all locales use the English symbols here. */
  static getNumberInstance(locale: Locale = Locale.getDefault()): NumberFormat {
    return new DecimalFormat(locale);
  }

  static getInstance(locale: Locale = Locale.getDefault()): NumberFormat {
    return NumberFormat.getNumberInstance(locale);
  }

  setMaximumFractionDigits(n: number): void {
    this.maximumFractionDigits = Math.max(0, n);
    if (this.minimumFractionDigits > this.maximumFractionDigits) this.minimumFractionDigits = this.maximumFractionDigits;
  }

  getMaximumFractionDigits(): number { return this.maximumFractionDigits; }

  setMinimumFractionDigits(n: number): void {
    this.minimumFractionDigits = Math.max(0, n);
    if (this.maximumFractionDigits < this.minimumFractionDigits) this.maximumFractionDigits = this.minimumFractionDigits;
  }

  setRoundingMode(mode: RoundingMode): void { this.roundingMode = mode; }

  setGroupingUsed(b: boolean): void { this.groupingUsed = b; }

  isGroupingUsed(): boolean { return this.groupingUsed; }

  /** format(double) and format(long) */
  format(number: number): string {
    if (Number.isNaN(number)) return 'NaN';
    const negative = number < 0 || Object.is(number, -0);
    if (!Number.isFinite(number)) return (negative ? '-' : '') + '∞';
    let s = roundAbs(number, this.maximumFractionDigits, this.roundingMode);
    let [intPart, frac = ''] = s.split('.');
    frac = frac.replace(/0+$/, '');
    while (frac.length < this.minimumFractionDigits) frac += '0';
    intPart = intPart!.replace(/^0+(?=\d)/, '');
    if (this.groupingUsed) {
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    s = frac.length > 0 ? intPart + '.' + frac : intPart;
    return (negative ? '-' : '') + s;
  }

  /** Parses a number from the start of the text (Number.doubleValue() is the value). */
  parse(text: string): number {
    let position = 0;
    let negative = false;
    if (text.startsWith('-')) {
      negative = true;
      position = 1;
    }
    let digits = '';
    let sawDecimal = false;
    let backup = -1;
    for (; position < text.length; ++position) {
      const ch = text.charAt(position);
      if (ch >= '0' && ch <= '9') {
        digits += ch;
        backup = -1;
      } else if (ch === '.') {
        if (sawDecimal) break;
        digits += '.';
        sawDecimal = true;
      } else if (ch === ',' && this.groupingUsed) {
        if (sawDecimal) break;
        backup = position;
      } else {
        break;
      }
    }
    if (backup !== -1) position = backup;
    if (!/\d/.test(digits)) {
      throw new ParseException('Unparseable number: "' + text + '"', 0);
    }
    const value = parseFloat(digits.startsWith('.') ? '0' + digits : digits);
    return negative ? -value : value;
  }
}

/** java.text.DecimalFormat with the default pattern ("#,##0.###") of a locale. */
export class DecimalFormat extends NumberFormat {
  constructor(locale: Locale = Locale.getDefault()) {
    super(locale);
  }
}
