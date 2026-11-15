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

// rtl_math_erf / rtl_math_erfc call the C library's erf() and erfc(), which JavaScript lacks. This
// is the fdlibm implementation (s_erf.c, as in FreeBSD's and most other C libraries' libm), so the
// results match the C library to the last bit or so.
const erf_bits = new DataView(new ArrayBuffer(8));
function erf_highWord(x: number): number {
  erf_bits.setFloat64(0, x);
  return erf_bits.getInt32(0);
}
function erf_clearLowWord(x: number): number {
  erf_bits.setFloat64(0, x);
  erf_bits.setUint32(4, 0);
  return erf_bits.getFloat64(0);
}
const erf_tiny = 1e-300;
const erx = 8.45062911510467529297e-01; // 0x3FEB0AC1, 0x60000000
// Coefficients for approximation to  erf on [0,0.84375]
const efx = 1.28379167095512586316e-01; // 0x3FC06EBA, 0x8214DB69
const efx8 = 1.02703333676410069053e+00; // 0x3FF06EBA, 0x8214DB69
const pp0 = 1.28379167095512558561e-01, pp1 = -3.25042107247001499370e-01, pp2 = -2.84817495755985104766e-02, pp3 = -5.77027029648944159157e-03, pp4 = -2.37630166566501626084e-05;
const qq1 = 3.97917223959155352819e-01, qq2 = 6.50222499887672944485e-02, qq3 = 5.08130628187576562776e-03, qq4 = 1.32494738004321644526e-04, qq5 = -3.96022827877536812320e-06;
// Coefficients for approximation to  erf  in [0.84375,1.25]
const pa0 = -2.36211856075265944077e-03, pa1 = 4.14856118683748331666e-01, pa2 = -3.72207876035701323847e-01, pa3 = 3.18346619901161753674e-01, pa4 = -1.10894694282396677476e-01, pa5 = 3.54783043256182359371e-02, pa6 = -2.16637559486879084300e-03;
const qa1 = 1.06420880400844228286e-01, qa2 = 5.40397917702171048937e-01, qa3 = 7.18286544141962662868e-02, qa4 = 1.26171219808761642112e-01, qa5 = 1.36370839120290507362e-02, qa6 = 1.19844998467991074170e-02;
// Coefficients for approximation to  erfc in [1.25,1/0.35]
const ra0 = -9.86494403484714822705e-03, ra1 = -6.93858572707181764372e-01, ra2 = -1.05586262253232909814e+01, ra3 = -6.23753324503260060396e+01, ra4 = -1.62396669462573470355e+02, ra5 = -1.84605092906711035994e+02, ra6 = -8.12874355063065934246e+01, ra7 = -9.81432934416914548592e+00;
const sa1 = 1.96512716674392571292e+01, sa2 = 1.37657754143519042600e+02, sa3 = 4.34565877475229228821e+02, sa4 = 6.45387271733267880336e+02, sa5 = 4.29008140027567833386e+02, sa6 = 1.08635005541779435134e+02, sa7 = 6.57024977031928170135e+00, sa8 = -6.04244152148580987438e-02;
// Coefficients for approximation to  erfc in [1/.35,28]
const rb0 = -9.86494292470009928597e-03, rb1 = -7.99283237680523006574e-01, rb2 = -1.77579549177547519889e+01, rb3 = -1.60636384855821916062e+02, rb4 = -6.37566443368389627722e+02, rb5 = -1.02509513161107724954e+03, rb6 = -4.83519191608651397019e+02;
const sb1 = 3.03380607434824582924e+01, sb2 = 3.25792512996573918826e+02, sb3 = 1.53672958608443695994e+03, sb4 = 3.19985821950859553908e+03, sb5 = 2.55305040643316442583e+03, sb6 = 4.74528541206955367215e+02, sb7 = -2.24409524465858183362e+01;

/** Parent error function (erf) */
export function erf(x: number): number {
  const hx = erf_highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    // erf(nan)=nan
    const i = (hx >>> 31) << 1;
    return 1 - i + 1 / x; // erf(+-inf)=+-1
  }
  if (ix < 0x3feb0000) {
    // |x|<0.84375
    if (ix < 0x3e300000) {
      // |x|<2**-28
      if (ix < 0x00800000) return 0.125 * (8.0 * x + efx8 * x); // avoid underflow
      return x + efx * x;
    }
    const z = x * x;
    const r = pp0 + z * (pp1 + z * (pp2 + z * (pp3 + z * pp4)));
    const s = 1 + z * (qq1 + z * (qq2 + z * (qq3 + z * (qq4 + z * qq5))));
    const y = r / s;
    return x + x * y;
  }
  if (ix < 0x3ff40000) {
    // 0.84375 <= |x| < 1.25
    const s = Math.abs(x) - 1;
    const P = pa0 + s * (pa1 + s * (pa2 + s * (pa3 + s * (pa4 + s * (pa5 + s * pa6)))));
    const Q = 1 + s * (qa1 + s * (qa2 + s * (qa3 + s * (qa4 + s * (qa5 + s * qa6)))));
    if (hx >= 0) return erx + P / Q;
    return -erx - P / Q;
  }
  if (ix >= 0x40180000) {
    // inf>|x|>=6
    if (hx >= 0) return 1 - erf_tiny;
    return erf_tiny - 1;
  }
  x = Math.abs(x);
  const s = 1 / (x * x);
  let R: number, S: number;
  if (ix < 0x4006db6e) {
    // |x| < 1/0.35
    R = ra0 + s * (ra1 + s * (ra2 + s * (ra3 + s * (ra4 + s * (ra5 + s * (ra6 + s * ra7))))));
    S = 1 + s * (sa1 + s * (sa2 + s * (sa3 + s * (sa4 + s * (sa5 + s * (sa6 + s * (sa7 + s * sa8)))))));
  } else {
    // |x| >= 1/0.35
    R = rb0 + s * (rb1 + s * (rb2 + s * (rb3 + s * (rb4 + s * (rb5 + s * rb6)))));
    S = 1 + s * (sb1 + s * (sb2 + s * (sb3 + s * (sb4 + s * (sb5 + s * (sb6 + s * sb7))))));
  }
  const z = erf_clearLowWord(x);
  const r = Math.exp(-z * z - 0.5625) * Math.exp((z - x) * (z + x) + R / S);
  if (hx >= 0) return 1 - r / x;
  return r / x - 1;
}

/** Parent complementary error function (erfc) */
export function erfc(x: number): number {
  const hx = erf_highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x7ff00000) {
    // erfc(nan)=nan, erfc(+-inf)=0,2
    return ((hx >>> 31) << 1) + 1 / x;
  }
  if (ix < 0x3feb0000) {
    // |x|<0.84375
    if (ix < 0x3c700000) return 1 - x; // |x|<2**-56
    const z = x * x;
    const r = pp0 + z * (pp1 + z * (pp2 + z * (pp3 + z * pp4)));
    const s = 1 + z * (qq1 + z * (qq2 + z * (qq3 + z * (qq4 + z * qq5))));
    const y = r / s;
    if (hx < 0x3fd00000) {
      // x<1/4
      return 1 - (x + x * y);
    }
    let rr = x * y;
    rr += x - 0.5;
    return 0.5 - rr;
  }
  if (ix < 0x3ff40000) {
    // 0.84375 <= |x| < 1.25
    const s = Math.abs(x) - 1;
    const P = pa0 + s * (pa1 + s * (pa2 + s * (pa3 + s * (pa4 + s * (pa5 + s * pa6)))));
    const Q = 1 + s * (qa1 + s * (qa2 + s * (qa3 + s * (qa4 + s * (qa5 + s * qa6)))));
    if (hx >= 0) return 1 - erx - P / Q;
    return 1 + (erx + P / Q);
  }
  if (ix < 0x403c0000) {
    // |x|<28
    x = Math.abs(x);
    const s = 1 / (x * x);
    let R: number, S: number;
    if (ix < 0x4006db6d) {
      // |x| < 1/.35 ~ 2.857143
      R = ra0 + s * (ra1 + s * (ra2 + s * (ra3 + s * (ra4 + s * (ra5 + s * (ra6 + s * ra7))))));
      S = 1 + s * (sa1 + s * (sa2 + s * (sa3 + s * (sa4 + s * (sa5 + s * (sa6 + s * (sa7 + s * sa8)))))));
    } else {
      // |x| >= 1/.35 ~ 2.857143
      if (hx < 0 && ix >= 0x40180000) return 2 - erf_tiny; // x < -6
      R = rb0 + s * (rb1 + s * (rb2 + s * (rb3 + s * (rb4 + s * (rb5 + s * rb6)))));
      S = 1 + s * (sb1 + s * (sb2 + s * (sb3 + s * (sb4 + s * (sb5 + s * (sb6 + s * sb7))))));
    }
    const z = erf_clearLowWord(x);
    const r = Math.exp(-z * z - 0.5625) * Math.exp((z - x) * (z + x) + R / S);
    if (hx > 0) return r / x;
    return 2 - r / x;
  }
  if (hx > 0) return erf_tiny * erf_tiny;
  return 2 - erf_tiny;
}

const aNanBits = new DataView(new ArrayBuffer(8));

/** rtl::math::setNan: the NaN with all fraction bits set (an error value of #VALUE!). */
export function setNan(): number {
  aNanBits.setUint32(0, 0xffffffff, true); // lsw
  aNanBits.setUint32(4, 0x7fffffff, true); // msw
  return aNanBits.getFloat64(0, true);
}

/** If a value is a valid argument for sin(), cos(), tan().

    IEEE 754 specifies that absolute values up to 2^64 (=1.844e19) for the
    radian must be supported by trigonometric functions.  Unfortunately, at
    least on x86 architectures, the FPU doesn't generate an error pattern for
    values >2^64 but produces erroneous results instead and sets only the
    "invalid operation" (IM) flag in the status word :-(  Thus the application
    has to handle it itself.
 */
export function isValidArcArg(d: number): boolean {
  return Math.abs(d) <= 2147483648 * 2147483648 * 4;
}

/** Safe sin(), returns NAN if not valid. */
export function sin(d: number): number {
  if (isValidArcArg(d)) return Math.sin(d);
  return setNan();
}

/** Safe cos(), returns NAN if not valid. */
export function cos(d: number): number {
  if (isValidArcArg(d)) return Math.cos(d);
  return setNan();
}

/** Safe tan(), returns NAN if not valid. */
export function tan(d: number): number {
  if (isValidArcArg(d)) return Math.tan(d);
  return setNan();
}

/** rtl_math_asinh */
export function asinh(fX: number): number {
  if (fX === 0.0) return 0.0;

  let fSign = 1.0;
  if (fX < 0.0) {
    fX = -fX;
    fSign = -1.0;
  }

  if (fX < 0.125) return fSign * log1p(fX + (fX * fX) / (1.0 + Math.sqrt(1.0 + fX * fX)));

  if (fX < 1.25e7) return fSign * Math.log(fX + Math.sqrt(1.0 + fX * fX));

  return fSign * Math.log(2.0 * fX);
}

/** improved accuracy of acosh for x large and for x near 1
    @see #i97605# (rtl_math_acosh) */
export function acosh(fX: number): number {
  const fZ = fX - 1.0;
  if (fX < 1.0) return NaN;
  if (fX === 1.0) return 0.0;

  if (fX < 1.1) return log1p(fZ + Math.sqrt(fZ * fZ + 2.0 * fZ));

  if (fX < 1.25e7) return Math.log(fX + Math.sqrt(fX * fX - 1.0));

  return Math.log(2.0 * fX);
}
