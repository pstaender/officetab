// SPDX-License-Identifier: MPL-2.0
// @upstream include/rtl/math.hxx partial
// @upstream sal/rtl/math.cxx partial
// @upstream sal/rtl/strtmpl.hxx partial
// rtl::math: the approximate comparisons and rounding Calc's interpreter relies on, and the
// double <-> string conversions (doubleToString with the Automatic, F and E formats, the shortest
// round-trip digits that dragonbox gives being JavaScript's own), stringToDouble.

export const rtl_math_StringFormat = { E: 0, F: 1, G: 2, Automatic: 3, E1: 4, E2: 5, G1: 6, G2: 7 } as const;
export type rtl_math_StringFormat = (typeof rtl_math_StringFormat)[keyof typeof rtl_math_StringFormat];
export const rtl_math_DecimalPlaces_Max = 0x7ffffff;
export const rtl_math_DecimalPlaces_DefaultSignificance = 0x7ffffff - 1;

export const rtl_math_RoundingMode = { Corrected: 0, Down: 1, Up: 2, Floor: 3, Ceiling: 4, HalfDown: 5, HalfUp: 6, HalfEven: 7 } as const;
export type rtl_math_RoundingMode = (typeof rtl_math_RoundingMode)[keyof typeof rtl_math_RoundingMode];

export const rtl_math_ConversionStatus = { Ok: 0, OutOfRange: 1 } as const;

const n10s = Array.from({ length: 309 }, (_, i) => Number(`1e${i}`));
/** 10^n with n >= 0 (exact for the powers JavaScript represents exactly). */
export function getN10Exp(n: number): number {
  if (n < 0) return 1 / getN10Exp(-n);
  return n < n10s.length ? n10s[n]! : Infinity;
}

export function isRepresentableInteger(fAbsValue: number): boolean {
  return fAbsValue < 9007199254740992 && Number.isInteger(fAbsValue);
}

/** The count of bits of the fraction part that are set (getBitsInFracPart). */
function getBitsInFracPart(fAbsValue: number): number {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, fAbsValue);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const nExponent = ((hi >>> 20) & 0x7ff) - 1023;
  if (nExponent >= 52) return 0; // All bits in fraction are in integer part of the number
  let nMaskBits = 0;
  // mantissa bits: 20 in hi, 32 in lo; count the trailing set range
  const mant = BigInt(hi & 0xfffff) << 32n | BigInt(lo);
  let m = mant;
  let nLeastSignificant = 0;
  if (m === 0n) nLeastSignificant = 53;
  else while ((m & 1n) === 0n) { m >>= 1n; nLeastSignificant++; }
  const nFracSignificant = 53 - nLeastSignificant;
  nMaskBits = nFracSignificant - 1 - nExponent;
  return nMaskBits > 0 ? nMaskBits : 0;
}

export function approxEqual(a: number, b: number, nPrec?: number): boolean {
  if (nPrec !== undefined) {
    if (a === b) return true;
    const x = a - b;
    return (x < 0.0 ? -x : x) < (a < 0.0 ? -a : a) * (1.0 / 2 ** nPrec);
  }
  // threshold is last four bits of mantissa:
  const e48 = 3.552713678800501e-15;
  // threshold is half of the 15th significant decimal (see doubleToString):
  const half15thSignificand = 5e-15;
  if (a === b) return true;
  if (a === 0.0 || b === 0.0 || (a < 0) !== (b < 0)) return false;
  const d = Math.abs(a - b);
  if (!Number.isFinite(d)) return false; // Nan or Inf involved
  a = Math.abs(a);
  b = Math.abs(b);
  const min_ab = Math.min(a, b);
  const threshold1 = min_ab * e48;
  const threshold2 = getN10Exp(Math.floor(Math.log10(min_ab))) * half15thSignificand;
  if (d >= Math.max(threshold1, threshold2)) return false;
  if (isRepresentableInteger(a) && isRepresentableInteger(b)) return false; // special case for representable integers.
  return true;
}

export function approxValue(fValue: number): number {
  const fBigInt = 2199023255552; // 2^41 -> only 11 bits left for fractional part, fine as decimal
  if (fValue === 0.0 || !Number.isFinite(fValue) || fValue > fBigInt) {
    // We don't handle these conditions.  Bail out.
    return fValue;
  }
  const fOrigValue = fValue;
  const bSign = fValue < 0 || Object.is(fValue, -0);
  if (bSign) fValue = -fValue;
  // If the value is either integer representable as double,
  // or only has small number of bits in fraction part, then we need not do any approximation
  if (isRepresentableInteger(fValue) || getBitsInFracPart(fValue) <= 11) return fOrigValue;
  let nExp = Math.floor(Math.log10(fValue));
  nExp = 14 - nExp;
  const fExpValue = getN10Exp(Math.abs(nExp));
  if (nExp < 0) fValue /= fExpValue;
  else fValue *= fExpValue;
  // If the original value was near DBL_MIN we got an overflow. Restore and
  // bail out.
  if (!Number.isFinite(fValue)) return fOrigValue;
  fValue = Math.round(fValue);
  if (nExp < 0) fValue *= fExpValue;
  else fValue /= fExpValue;
  // If the original value was near DBL_MAX we got an overflow. Restore and
  // bail out.
  if (!Number.isFinite(fValue)) return fOrigValue;
  return bSign ? -fValue : fValue;
}

export const approxFloor = (a: number): number => Math.floor(approxValue(a));
export const approxCeil = (a: number): number => Math.ceil(approxValue(a));

/** Add two values. If signs differ and the absolute values are equal according to approxEqual()
    the method returns 0.0 instead of calculating the sum. */
export function approxAdd(a: number, b: number): number {
  if (((a < 0.0 && b > 0.0) || (b < 0.0 && a > 0.0)) && approxEqual(a, -b)) return 0.0;
  return a + b;
}

/** Subtract two values (a-b). If signs are identical and the values are equal according to
    approxEqual() the method returns 0.0 instead of calculating the subtraction. */
export function approxSub(a: number, b: number): number {
  if (((a < 0.0 && b < 0.0) || (a > 0.0 && b > 0.0)) && approxEqual(a, b)) return 0.0;
  return a - b;
}

export function round(fValue: number, nDecPlaces = 0, eMode: rtl_math_RoundingMode = rtl_math_RoundingMode.Corrected): number {
  if (!Number.isFinite(fValue)) return fValue;
  if (fValue === 0.0) return fValue;
  const fOrigValue = fValue;
  // sign adjustment
  const bSign = fValue < 0;
  if (bSign) fValue = -fValue;
  // Rounding to decimals between integer distance precision (gaps) does not
  // make sense, do not even try to multiply/divide and introduce inaccuracy.
  // For same reasons, do not attempt to round integers to decimals.
  if (nDecPlaces >= 0 && (fValue >= 4503599627370496 || isRepresentableInteger(fValue))) return fOrigValue;

  let fFac = 0;
  if (nDecPlaces !== 0) {
    if (nDecPlaces > 0) {
      // Determine how many decimals are representable in the precision.
      const nDec = 52 - Math.floor(Math.log2(fValue));
      if (nDec <= 0) return fOrigValue;
      if (nDec < nDecPlaces) nDecPlaces = nDec;
    }
    // Avoid 1e-5 (1.0000000000000001e-05) and such inaccurate fractional
    // factors that later when dividing back spoil things. For negative
    // decimals divide first with the inverse, then multiply the rounded
    // value back.
    fFac = getN10Exp(Math.abs(nDecPlaces));
    if (fFac === 0.0 || (nDecPlaces < 0 && !Number.isFinite(fFac))) return 0.0; // Underflow, rounding to that many integer positions would be 0.
    if (!Number.isFinite(fFac)) return fOrigValue; // Overflow with very small values and high number of decimals.
    if (nDecPlaces < 0) fValue /= fFac;
    else fValue *= fFac;
    if (!Number.isFinite(fValue)) return fOrigValue;
  }

  // Round only if not already in distance precision gaps of integers, where
  // for [2^52,2^53) adding 0.5 would even yield the next representable
  // integer.
  if (fValue < 4503599627370496) {
    switch (eMode) {
      case rtl_math_RoundingMode.Corrected:
        fValue = approxFloor(fValue + 0.5);
        break;
      case rtl_math_RoundingMode.Down:
        fValue = approxFloor(fValue);
        break;
      case rtl_math_RoundingMode.Up:
        fValue = approxCeil(fValue);
        break;
      case rtl_math_RoundingMode.Floor:
        fValue = bSign ? approxCeil(fValue) : approxFloor(fValue);
        break;
      case rtl_math_RoundingMode.Ceiling:
        fValue = bSign ? approxFloor(fValue) : approxCeil(fValue);
        break;
      case rtl_math_RoundingMode.HalfDown: {
        const f = Math.floor(fValue);
        fValue = fValue - f <= 0.5 ? f : Math.ceil(fValue);
        break;
      }
      case rtl_math_RoundingMode.HalfUp: {
        const f = Math.floor(fValue);
        fValue = fValue - f < 0.5 ? f : Math.ceil(fValue);
        break;
      }
      case rtl_math_RoundingMode.HalfEven: {
        const f = Math.floor(fValue);
        if (fValue - f !== 0.5) fValue = Math.floor(fValue + 0.5);
        else fValue = f % 2 === 0 ? f : f + 1;
        break;
      }
    }
  }

  if (nDecPlaces !== 0) {
    if (nDecPlaces < 0) fValue *= fFac;
    else fValue /= fFac;
  }

  if (!Number.isFinite(fValue)) return fOrigValue;
  return bSign ? -fValue : fValue;
}

/** The shortest round-trip decimal digits of a positive finite value and its exponent
    (value = 0.d1d2d3... * 10^(nExp+1)), dragonbox's to_decimal. */
function shortestDigits(fValue: number): { digits: string; nExp: number } {
  const s = fValue.toExponential(); // shortest round-trip digits
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s)!;
  return { digits: (m[1]! + (m[2] ?? '')).replace(/0+$/, '') || '0', nExp: Number(m[3]) };
}

/** Rounds a digit string to n significant digits (half up), adjusting the exponent on carry. */
function roundDigits(digits: string, nExp: number, n: number): { digits: string; nExp: number } {
  if (n <= 0) {
    // everything is rounded away: maybe a carry to the next power of ten
    if (n === 0 && digits.charCodeAt(0) >= 53) return { digits: '1', nExp: nExp + 1 };
    return { digits: '0', nExp };
  }
  if (digits.length <= n) return { digits, nExp };
  const a = digits.slice(0, n).split('').map(Number);
  if (digits.charCodeAt(n) >= 53) {
    let i = n - 1;
    while (i >= 0) {
      if (a[i]! < 9) { a[i]!++; break; }
      a[i] = 0;
      i--;
    }
    if (i < 0) { a.unshift(1); a.pop(); nExp++; }
  }
  return { digits: a.join('').replace(/0+$/, '') || '0', nExp };
}

/** rtl::math::doubleToUString */
export function doubleToUString(fValue: number, eFormat: rtl_math_StringFormat, nDecPlaces: number, cDecSeparator = '.', bEraseTrailingDecZeros = false): string {
  if (Number.isNaN(fValue)) return 'NaN';
  const bSign = fValue < 0 || Object.is(fValue, -0);
  if (!Number.isFinite(fValue)) return bSign ? '-INF' : 'INF';
  if (bSign) fValue = -fValue;

  let { digits, nExp } = fValue ? shortestDigits(fValue) : { digits: '0', nExp: 0 };
  const nOrigDigits = digits.length;
  let nRoundDigits = 15;

  // Use integer representation for integer values that fit into the
  // mantissa (1.((2^53)-1)) with a precision of 1 for highest accuracy.
  if ((eFormat === rtl_math_StringFormat.Automatic || eFormat === rtl_math_StringFormat.F) && Number.isInteger(fValue) && fValue < 9007199254740992) {
    eFormat = rtl_math_StringFormat.F;
    if (nDecPlaces === rtl_math_DecimalPlaces_Max) nDecPlaces = 0;
    else nDecPlaces = Math.max(-15, Math.min(15, nDecPlaces));
    if (bEraseTrailingDecZeros && nDecPlaces > 0) nDecPlaces = 0;
    nRoundDigits = Math.max(nOrigDigits, nExp + 1); // no rounding
  }

  switch (eFormat) {
    case rtl_math_StringFormat.Automatic:
      // E or F depending on exponent magnitude
      if (nExp <= -15 || nExp >= 15) {
        if (nDecPlaces === rtl_math_DecimalPlaces_Max) nDecPlaces = 14;
        eFormat = rtl_math_StringFormat.E;
      } else {
        if (nDecPlaces === rtl_math_DecimalPlaces_Max) nDecPlaces = nExp < 14 ? 15 - nExp - 1 : 15;
        eFormat = rtl_math_StringFormat.F;
      }
      break;
    case rtl_math_StringFormat.G:
    case rtl_math_StringFormat.G1:
    case rtl_math_StringFormat.G2:
      // G-Point, similar to sprintf %G
      if (nDecPlaces === rtl_math_DecimalPlaces_DefaultSignificance) nDecPlaces = 6;
      if (nExp < -4 || nExp >= nDecPlaces) {
        nDecPlaces = Math.max(1, nDecPlaces - 1);
        eFormat = eFormat === rtl_math_StringFormat.G ? rtl_math_StringFormat.E : eFormat === rtl_math_StringFormat.G2 ? rtl_math_StringFormat.E2 : rtl_math_StringFormat.E1;
      } else {
        nDecPlaces = Math.max(0, nDecPlaces - nExp - 1);
        eFormat = rtl_math_StringFormat.F;
      }
      break;
    default:
      break;
  }

  // Too large values for nDecPlaces make no sense; it might also be
  // rtl_math_DecimalPlaces_Max was passed with rtl_math_StringFormat_F or
  // others, but we don't want to allocate/deallocate 2GB just to fill it
  // with trailing '0' characters..
  nDecPlaces = Math.max(-309, Math.min(309, nDecPlaces));

  const isE = eFormat === rtl_math_StringFormat.E || eFormat === rtl_math_StringFormat.E1 || eFormat === rtl_math_StringFormat.E2;
  // significant digits to keep
  let nDigits = isE ? nDecPlaces + 1 : nExp + 1 + nDecPlaces;
  nDigits = Math.min(nDigits, nRoundDigits);
  ({ digits, nExp } = roundDigits(digits, nExp, nDigits));
  if (nDigits <= 0 && digits === '0') { digits = '0'; if (!isE) nExp = 0; }

  let out = bSign ? '-' : '';
  if (isE) {
    let frac = digits.slice(1).padEnd(nDecPlaces, '0').slice(0, Math.max(0, nDecPlaces));
    if (bEraseTrailingDecZeros) frac = frac.replace(/0+$/, '');
    out += digits[0] + (frac ? cDecSeparator + frac : '');
    out += 'E';
    let e = nExp;
    if (e < 0) { e = -e; out += '-'; } else out += '+';
    if (eFormat === rtl_math_StringFormat.E || e >= 100) out += String(Math.floor(e / 100));
    e %= 100;
    if (eFormat === rtl_math_StringFormat.E || eFormat === rtl_math_StringFormat.E2 || e >= 10) out += String(Math.floor(e / 10));
    out += String(e % 10);
    return out;
  }
  // F format
  let int: string, frac: string;
  if (digits === '0') { int = '0'; frac = ''; }
  else if (nExp >= 0) {
    int = digits.slice(0, nExp + 1).padEnd(nExp + 1, '0');
    frac = digits.slice(nExp + 1);
  } else {
    int = '0';
    frac = '0'.repeat(-nExp - 1) + digits;
  }
  if (nDecPlaces > 0) frac = frac.padEnd(nDecPlaces, '0').slice(0, nDecPlaces);
  else frac = '';
  if (bEraseTrailingDecZeros) frac = frac.replace(/0+$/, '');
  if (int === '0' && !frac && bSign && digits === '0') out = '-';
  out += int + (frac ? cDecSeparator + frac : '');
  if (out === '-0') out = '-0';
  return out;
}

/** rtl::math::stringToDouble: the value, the conversion status and the end of the parsed number. */
export function stringToDouble(s: string, cDecSeparator = '.', cGroupSeparator = '\0'): { fVal: number; eStatus: number; nParseEnd: number } {
  let p = 0;
  while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p++;
  let bSign = false, explicitSign = false;
  if (s[p] === '-') { bSign = true; explicitSign = true; p++; }
  else if (s[p] === '+') { explicitSign = true; p++; }
  if (!explicitSign && s.startsWith('NaN', p)) return { fVal: NaN, eStatus: rtl_math_ConversionStatus.Ok, nParseEnd: p + 3 };
  if (s.startsWith('INF', p)) return { fVal: bSign ? -Infinity : Infinity, eStatus: rtl_math_ConversionStatus.OutOfRange, nParseEnd: p + 3 };
  const p0 = p;
  let buf = '';
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  for (; p < s.length; p++) {
    const c = s[p]!;
    if (digit(c)) buf += c;
    else if (c !== cGroupSeparator || p === p0 || !digit(s[p + 1])) break;
  }
  let bHadDigits = buf.length > 0;
  if (s[p] === cDecSeparator) {
    let q = p + 1, frac = '';
    while (digit(s[q])) frac += s[q++];
    if (frac || bHadDigits) { buf += `.${frac}`; p = q; bHadDigits = bHadDigits || !!frac; }
  }
  if (!bHadDigits) return { fVal: 0, eStatus: rtl_math_ConversionStatus.Ok, nParseEnd: 0 };
  if (s[p] === 'e' || s[p] === 'E') {
    let q = p + 1;
    let e = '';
    if (s[q] === '+' || s[q] === '-') e += s[q++];
    if (digit(s[q])) {
      while (digit(s[q])) e += s[q++];
      buf += `e${e}`;
      p = q;
    }
  }
  let fVal = Number(buf);
  let eStatus: number = rtl_math_ConversionStatus.Ok;
  if (!Number.isFinite(fVal)) eStatus = rtl_math_ConversionStatus.OutOfRange;
  if (bSign) fVal = -fVal;
  return { fVal, eStatus, nParseEnd: p };
}

export const expm1 = Math.expm1;
export const log1p = Math.log1p;
export const atanh = Math.atanh;

/** The error function (Abramowitz/Stegun 7.1.26 is not precise enough; this is the W. J. Cody
    rational approximation as in the C library). */
export function erf(x: number): number {
  if (Number.isNaN(x)) return x;
  const ax = Math.abs(x);
  if (ax < 0.5) {
    // series expansion
    const t = x * x;
    let sum = x, term = x, n = 0;
    do { n++; term *= -t / n; sum += term / (2 * n + 1); } while (Math.abs(term / (2 * n + 1)) > 1e-17 * Math.abs(sum) && n < 100);
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  const r = 1 - erfc(ax);
  return x < 0 ? -r : r;
}

/** The complementary error function (continued fraction for large x, series otherwise). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return x;
  if (x < 0.5) return 1 - erf(x);
  if (x > 27) return 0;
  // Lentz's continued fraction for erfc
  const a = (n: number) => n / 2;
  let f = x, C = x, D = 0;
  for (let n = 1; n < 500; n++) {
    D = x + a(n) * D;
    D = D === 0 ? 1e-300 : 1 / D;
    C = x + a(n) / C;
    if (C === 0) C = 1e-300;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}
