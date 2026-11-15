// SPDX-License-Identifier: MPL-2.0
// @upstream svl/source/numbers/zforlist.cxx reduced
// @upstream svl/source/numbers/zforfind.cxx reduced
// SvNumberFormatter, reduced: formats are held by their code (English notation) instead of by
// key, with the built-in formats of a language taken from the en-US locale data (its date and
// currency codes adapted to the language's order and symbol position through Intl, as the
// locale data of other languages would give them). IsNumberFormat is a reduced
// ImpSvNumberInputScan: numbers in the language's notation (with sign, grouping, exponent),
// percent, the currency symbol, booleans, dates of two or three parts in the language's order or
// ISO 8601, and times with AM/PM; month names and eras are not recognized.
import { GetLocaleNotation, SvNumFormatType, SvNumberformat } from './zformat.ts';

export { SvNumFormatType };

const formats = new Map<string, SvNumberformat>();
export function GetFormat(code: string, lang: string): SvNumberformat {
  const key = `${lang}\n${code}`;
  let f = formats.get(key);
  if (!f) { f = new SvNumberformat(code, lang); formats.set(key, f); }
  return f;
}

export const GetType = (code: string, lang: string): SvNumFormatType => GetFormat(code, lang).GetType();
export const IsTextFormat = (code: string, lang: string): boolean => GetFormat(code, lang).IsTextFormat();

/** The text of a value in a format, and the format's colour for it. */
export const GetOutputString = (fNumber: number, code: string, lang: string) => GetFormat(code, lang).GetOutputString(fNumber);

/** Whether the language writes the currency symbol after the number. */
function currencyAfter(lang: string): boolean {
  try {
    const parts = new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).formatToParts(1);
    return parts.findIndex((p) => p.type === 'currency') > parts.findIndex((p) => p.type === 'integer');
  } catch { return false; }
}

/** The short date code of a language: its order and separator. */
function shortDate(lang: string, year: 'YY' | 'YYYY'): string {
  const n = GetLocaleNotation(lang);
  const parts = { D: n.dateOrder === 'MDY' ? 'D' : 'DD', M: n.dateOrder === 'MDY' ? 'M' : 'MM', Y: year };
  return [...n.dateOrder].map((k) => parts[k as 'D']).join(n.dateSep);
}

/** The built-in formats of a language by category (the locale data's FormatCode elements, reduced). */
export function GetBuiltInFormats(lang: string): Record<'NUMBER' | 'PERCENT' | 'CURRENCY' | 'DATE' | 'TIME' | 'SCIENTIFIC' | 'BOOLEAN' | 'TEXT', string[]> {
  const after = currencyAfter(lang);
  const cur = (num: string, red: boolean) => {
    const pos = after ? `${num} [CURRENCY]` : `[CURRENCY]${num}`;
    return `${pos};${red ? '[RED]' : ''}-${pos}`;
  };
  const n = GetLocaleNotation(lang);
  const longDate = n.dateOrder === 'MDY' ? 'MMMM D, YYYY' : 'D. MMMM YYYY';
  return {
    NUMBER: ['General', '0', '0.00', '#,##0', '#,##0.00', '#,###.00', '#,##0_);(#,##0)', '#,##0.00_);(#,##0.00)'],
    PERCENT: ['0%', '0.00%'],
    CURRENCY: [cur('#,##0', false), cur('#,##0.00', false), cur('#,##0', true), cur('#,##0.00', true)],
    DATE: [shortDate(lang, 'YY'), shortDate(lang, 'YYYY'), `NNNN${longDate}`, longDate, 'YYYY-MM-DD', 'MM/YY', 'MMMM', 'QQ YY'],
    TIME: ['HH:MM', 'HH:MM:SS', 'HH:MM AM/PM', 'HH:MM:SS AM/PM', '[HH]:MM:SS', 'MM:SS.00'],
    SCIENTIFIC: ['0.00E+00', '0.00E+000', '##0.00E+00'],
    BOOLEAN: ['BOOLEAN'],
    TEXT: ['@'],
  };
}

/**
 * SvNumberFormatter::GetStandardFormat (ImpGetStandardFormat): General for numbers, the red
 * negative currency with decimals, 0.00 %, the short date, HH:MM:SS and 0.00E+00.
 */
export function GetStandardFormat(eType: SvNumFormatType, lang: string): string {
  const b = GetBuiltInFormats(lang);
  switch (eType) {
    case SvNumFormatType.CURRENCY: return b.CURRENCY[3]!;
    case SvNumFormatType.PERCENT: return b.PERCENT[1]!;
    case SvNumFormatType.DATE: return b.DATE[0]!;
    case SvNumFormatType.TIME: return b.TIME[1]!;
    case SvNumFormatType.DATETIME: return `${b.DATE[0]} HH:MM`;
    case SvNumFormatType.SCIENTIFIC: return b.SCIENTIFIC[0]!;
    case SvNumFormatType.TEXT: return '@';
    case SvNumFormatType.LOGICAL: return 'BOOLEAN';
    default: return 'General';
  }
}
/** NF_NUMBER_1000DEC2 */
export const GetFormatIndex_1000DEC2 = (): string => '#,##0.00';

/** The serial number of a date (days since 1899-12-30). */
export const DateToSerial = (y: number, m: number, d: number): number => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * SvNumberFormatter::IsNumberFormat: the value of a text and the format it was written in, or
 * null when it is no number. `hint` is the format the text is to be read for (its type decides
 * how a bare number is read: a percent format reads "5" as 5 %).
 */
export function IsNumberFormat(text: string, lang: string, hint?: string): { value: number; code: string } | null {
  const s = text.trim();
  if (!s) return null;
  const n = GetLocaleNotation(lang);
  // Booleans
  if (/^true$/i.test(s)) return { value: 1, code: 'BOOLEAN' };
  if (/^false$/i.test(s)) return { value: 0, code: 'BOOLEAN' };
  const group = n.group === ' ' ? '[\\u00a0 ]' : esc(n.group), dec = esc(n.decimal);
  const num = new RegExp(`^([+-])?(\\d{1,3}(?:${group}\\d{3})+|\\d+)?(?:${dec}(\\d*))?(?:[eE]([+-]?\\d+))?$`);
  const parseNum = (t: string): { v: number; grouped: boolean; decimals: number; exp: boolean } | null => {
    const m = num.exec(t);
    if (!m || (m[2] === undefined && !m[3])) return null;
    const int = (m[2] ?? '0').split(new RegExp(group)).join('');
    const v = Number(`${m[1] ?? ''}${int}.${m[3] ?? ''}${m[4] ? `e${m[4]}` : ''}`);
    return Number.isFinite(v) ? { v, grouped: !!m[2] && new RegExp(group).test(m[2]), decimals: (m[3] ?? '').length, exp: !!m[4] } : null;
  };
  const numberCode = (r: { grouped: boolean; decimals: number }) => (r.grouped ? (r.decimals ? '#,##0.00' : '#,##0') : 'General');
  // Percent
  const pm = /^(.*?)\s*%$/.exec(s);
  if (pm) { const r = parseNum(pm[1]!); if (r) return { value: r.v / 100, code: r.decimals ? '0.00%' : '0%' }; }
  // Currency: the language's symbol (or $ € £ ¥) before or after the number.
  const syms = [n.currency, '$', '€', '£', '¥'].map(esc).join('|');
  const cm = new RegExp(`^(-)?\\s*(?:${syms})\\s*(-?[\\d${esc(n.group)}${dec}]+)$|^(-?[\\d${esc(n.group)}${dec}]+)\\s*(?:${syms})$`).exec(s);
  if (cm) { const r = parseNum(cm[2] ?? cm[3]!); if (r) return { value: cm[1] ? -r.v : r.v, code: GetStandardFormat(SvNumFormatType.CURRENCY, lang) }; }
  // Number
  const r = parseNum(s);
  if (r) {
    if (hint && GetType(hint, lang) === SvNumFormatType.PERCENT) return { value: r.v / 100, code: hint };
    return { value: r.v, code: r.exp ? GetStandardFormat(SvNumFormatType.SCIENTIFIC, lang) : numberCode(r) };
  }
  // Time: h:mm[:ss[.fff]] [AM|PM]
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*([AaPp][Mm]?)?$/.exec(s);
  let timeValue: number | null = null;
  if (tm) {
    let h = Number(tm[1]);
    const ap = tm[5]?.[0]?.toUpperCase();
    if (ap === 'P' && h < 12) h += 12;
    if (ap === 'A' && h === 12) h = 0;
    timeValue = (h * 3600 + Number(tm[2]) * 60 + Number(tm[3] ?? 0) + Number(`0.${tm[4] ?? 0}`)) / 86400;
    return { value: timeValue, code: tm[5] ? 'HH:MM AM/PM' : tm[3] ? 'HH:MM:SS' : 'HH:MM' };
  }
  // Date: ISO 8601, or two or three numbers in the language's order.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) { const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]; if (validDate(y, m, d)) return { value: DateToSerial(y, m, d), code: 'YYYY-MM-DD' }; }
  const dm = /^(\d{1,4})\s*([./-])\s*(\d{1,2})(?:\s*\2\s*(\d{1,4}))?\.?$/.exec(s);
  if (dm) {
    const parts = [dm[1], dm[3], dm[4]].filter((x): x is string => x !== undefined).map(Number);
    const order = n.dateOrder;
    let y = new Date().getFullYear(), m = 0, d = 0;
    if (parts.length === 3) {
      const map: Record<string, number> = {};
      [...order].forEach((k, i) => { map[k] = parts[i]!; });
      y = map.Y!; m = map.M!; d = map.D!;
      // Two-digit years: 1930 to 2029 (the default two-digit year start).
      if (y < 100) y += y < 30 ? 2000 : 1900;
    } else {
      const o = order.replace('Y', '');
      d = parts[o.indexOf('D')]!; m = parts[o.indexOf('M')]!;
    }
    if (validDate(y, m, d)) return { value: DateToSerial(y, m, d), code: parts.length === 3 ? GetStandardFormat(SvNumFormatType.DATE, lang) : order === 'MDY' ? 'MM/DD' : `DD${n.dateSep}MM` };
  }
  return null;
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * SvNumberFormatter::GenerateFormat, reduced: a code of the type of `base` with the thousands
 * separator, red negatives, decimal places and leading zeros given.
 */
export function GenerateFormat(base: string, lang: string, bThousand: boolean, bNegRed: boolean, nPrecision: number, nLeadingZeros: number): string {
  const eType = GetType(base, lang);
  if (eType === SvNumFormatType.DATE || eType === SvNumFormatType.TIME || eType === SvNumFormatType.DATETIME || eType === SvNumFormatType.TEXT || eType === SvNumFormatType.LOGICAL) return base;
  const lead = Math.max(0, nLeadingZeros);
  let int = lead ? '0'.repeat(lead) : '#';
  if (bThousand) { const d = int.padStart(4, '#'); int = `${d.slice(0, -3)},${d.slice(-3)}`; }
  let num = int + (nPrecision > 0 ? `.${'0'.repeat(nPrecision)}` : '');
  if (eType === SvNumFormatType.PERCENT) num += '%';
  else if (eType === SvNumFormatType.SCIENTIFIC) num += 'E+00';
  let pos = num, neg = `-${num}`;
  if (eType === SvNumFormatType.CURRENCY) {
    const after = /\[CURRENCY\]\s*$|\[\$[^\]]*\]\s*(;|$)/.test(base.split(';')[0]!) && !/^\s*\[(CURRENCY|\$)/.test(base);
    const sym = /\[\$[^\]]*\]/.exec(base)?.[0] ?? '[CURRENCY]';
    pos = after ? `${num} ${sym}` : `${sym}${num}`;
    neg = `-${pos}`;
  }
  return bNegRed ? `${pos};[RED]${neg}` : eType === SvNumFormatType.CURRENCY ? `${pos};${neg}` : pos;
}

/** SvNumberFormatter::GetFormatSpecialInfo, reduced: the options of a number code. */
export function GetFormatSpecialInfo(code: string, lang: string): { bThousand: boolean; bNegRed: boolean; nPrecision: number; nLeadingZeros: number } {
  const first = code.split(';')[0]!.replace(/"[^"]*"|\[[^\]]*\]/g, '');
  const m = /([#0,]*)(?:\.([0#?]*))?/.exec(first.replace(/^[^#0.,]*/, '')) ?? [];
  void lang;
  return { bThousand: (m[1] ?? '').includes(','), bNegRed: /\[RED\]/i.test(code), nPrecision: (m[2] ?? '').length, nLeadingZeros: ((m[1] ?? '').match(/0/g) ?? []).length };
}

/**
 * SvNumberFormatter::GetInputLineString (SvNFEngine::GetInputLineString with GetEditFormat),
 * reduced: the text of a value for editing in the format's type. Numbers, currencies and
 * scientific values are shown as General with full precision, percentages as a full precision
 * percent, dates with a four-digit year (with the time if not a whole day), times as HH:MM:SS
 * ([HH]:MM:SS beyond a day), booleans as TRUE or FALSE.
 */
export function GetInputLineString(fOutNumber: number, code: string, lang: string): string {
  const eType = GetType(code, lang);
  const n = GetLocaleNotation(lang);
  const full = (v: number) => {
    // INPUTSTRING_PRECISION: up to 15 significant digits, no grouping
    if (!Number.isFinite(v)) return String(v);
    let s = Number(v.toPrecision(15)).toString();
    if (/e/.test(s)) {
      const [m, e] = s.split('e') as [string, string];
      s = `${m}E${Number(e) < 0 ? '-' : '+'}${String(Math.abs(Number(e))).padStart(2, '0')}`;
    }
    return s.replace('.', n.decimal);
  };
  const date4 = shortDate(lang, 'YYYY');
  switch (eType) {
    case SvNumFormatType.PERCENT:
      return `${full(fOutNumber * 100)}%`;
    case SvNumFormatType.DATE: {
      const bIso = /^Y+-M+-D+$/i.test(code.trim());
      if (Math.floor(fOutNumber) !== fOutNumber) return GetOutputString(fOutNumber, bIso ? 'YYYY-MM-DD HH:MM:SS' : `${date4} HH:MM:SS`, lang).text;
      return GetOutputString(fOutNumber, bIso ? 'YYYY-MM-DD' : date4, lang).text;
    }
    case SvNumFormatType.TIME:
      if (fOutNumber < 0.0 || fOutNumber >= 1.0) return GetOutputString(fOutNumber, '[HH]:MM:SS', lang).text;
      return GetOutputString(fOutNumber, 'HH:MM:SS', lang).text;
    case SvNumFormatType.DATETIME:
      return GetOutputString(fOutNumber, /^Y+-M+-D+/i.test(code.trim()) ? 'YYYY-MM-DD HH:MM:SS' : `${date4} HH:MM:SS`, lang).text;
    case SvNumFormatType.LOGICAL:
      return fOutNumber ? 'TRUE' : 'FALSE';
    default:
      return full(fOutNumber);
  }
}
