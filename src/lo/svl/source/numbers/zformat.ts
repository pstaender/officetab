// SPDX-License-Identifier: MPL-2.0
// @upstream svl/source/numbers/zformat.cxx reduced
// @upstream svl/source/numbers/zforscan.cxx reduced
// SvNumberformat: a number format code in its English notation (as ODF and the locale data's
// en-US codes write it) and GetOutputString. Supported: up to four sections (positive; negative;
// zero; text) with [COLOR] and [<, >, = n] conditions left out, quoted and \ escaped text, the
// digit placeholders 0 # ?, grouping, decimals, %, scientific E+/E-, [$symbol-lcid] and [CURRENCY]
// currency, @ for the text, "General", and dates and times (Y M D N Q WW H M S AM/PM, [HH], .00
// fractions of seconds). The locale's separators, month and day names come from Intl. Not
// supported: fractions (# ?/?), NatNum modifiers, calendars other than the Gregorian one, fill
// characters (*x, dropped) and spacing (_x, a blank).

export const SvNumFormatType = { NUMBER: 1, CURRENCY: 2, PERCENT: 3, SCIENTIFIC: 4, DATE: 5, TIME: 6, DATETIME: 7, TEXT: 8, LOGICAL: 9 } as const;
export type SvNumFormatType = (typeof SvNumFormatType)[keyof typeof SvNumFormatType];

/** The locale's number notation (LocaleDataWrapper, from Intl). */
export interface LocaleNotation { decimal: string; group: string; currency: string; dateOrder: 'DMY' | 'MDY' | 'YMD'; dateSep: string }

const cache = new Map<string, LocaleNotation>();
export function GetLocaleNotation(lang: string): LocaleNotation {
  let n = cache.get(lang);
  if (n) return n;
  let loc = lang;
  try { new Intl.NumberFormat(loc); } catch { loc = 'en-US'; }
  const parts = new Intl.NumberFormat(loc).formatToParts(12345.6);
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const region = /-([A-Z]{2})\b/.exec(loc)?.[1];
  const CUR: Record<string, string> = { US: 'USD', GB: 'GBP', DE: 'EUR', AT: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', CH: 'CHF', JP: 'JPY', CN: 'CNY', IN: 'INR', RU: 'RUB', BR: 'BRL', CA: 'CAD', AU: 'AUD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK' };
  const code = CUR[region ?? ''] ?? (loc.startsWith('de') || loc.startsWith('fr') || loc.startsWith('es') || loc.startsWith('it') || loc.startsWith('nl') ? 'EUR' : 'USD');
  const currency = new Intl.NumberFormat(loc, { style: 'currency', currency: code }).formatToParts(1).find((p) => p.type === 'currency')?.value ?? '$';
  const dparts = new Intl.DateTimeFormat(loc, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(2000, 10, 22));
  const order = dparts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type[0]!.toUpperCase()).join('');
  const dateSep = dparts.find((p) => p.type === 'literal')?.value.trim() || '/';
  n = { decimal, group: group === ' ' || group === ' ' ? ' ' : group, currency, dateOrder: order === 'DMY' || order === 'YMD' ? order : 'MDY', dateSep };
  cache.set(lang, n);
  return n;
}

type Token =
  | { t: 'lit'; s: string } | { t: 'digit'; c: '0' | '#' | '?' } | { t: 'dec' } | { t: 'group' } | { t: 'percent' } | { t: 'exp'; sign: '+' | '-' }
  | { t: 'text' } | { t: 'currency'; s: string } | { t: 'date'; k: string } | { t: 'ampm'; s: string } | { t: 'general' };

interface Section { tokens: Token[]; color: string | null; type: SvNumFormatType }

const COLORS: Record<string, string> = { BLACK: '#000000', BLUE: '#0000ff', GREEN: '#00ff00', CYAN: '#00ffff', RED: '#ff0000', MAGENTA: '#ff00ff', BROWN: '#808000', GREY: '#808080', GRAY: '#808080', YELLOW: '#ffff00', WHITE: '#ffffff' };

/** ImpSvNumberformatScan::ScanFormat, reduced: the tokens of one section. */
function ScanSection(code: string, notation: LocaleNotation): Section {
  const tokens: Token[] = [];
  let color: string | null = null;
  let i = 0;
  const up = code.toUpperCase();
  let hasDate = false, hasTime = false;
  while (i < code.length) {
    const c = code[i]!;
    if (c === '"') { const e = code.indexOf('"', i + 1); tokens.push({ t: 'lit', s: code.slice(i + 1, e < 0 ? undefined : e) }); i = e < 0 ? code.length : e + 1; continue; }
    if (c === '\\') { tokens.push({ t: 'lit', s: code[i + 1] ?? '' }); i += 2; continue; }
    if (c === '_') { tokens.push({ t: 'lit', s: ' ' }); i += 2; continue; }
    if (c === '*') { i += 2; continue; }
    if (c === '[') {
      const e = code.indexOf(']', i);
      const inner = code.slice(i + 1, e < 0 ? undefined : e);
      const U = inner.toUpperCase();
      if (COLORS[U]) color = COLORS[U]!;
      else if (inner.startsWith('$')) tokens.push({ t: 'currency', s: inner.slice(1).split('-')[0] || notation.currency });
      else if (U === 'CURRENCY') tokens.push({ t: 'currency', s: notation.currency });
      else if (/^H+$|^M+$|^S+$/.test(U)) { tokens.push({ t: 'date', k: `[${U}]` }); hasTime = true; }
      i = e < 0 ? code.length : e + 1;
      continue;
    }
    if (up.startsWith('GENERAL', i)) { tokens.push({ t: 'general' }); i += 7; continue; }
    if (up.startsWith('BOOLEAN', i)) { tokens.push({ t: 'lit', s: '\u0000BOOLEAN' }); i += 7; continue; }
    if (up.startsWith('AM/PM', i)) { tokens.push({ t: 'ampm', s: 'AM/PM' }); hasTime = true; i += 5; continue; }
    if (up.startsWith('A/P', i)) { tokens.push({ t: 'ampm', s: 'A/P' }); hasTime = true; i += 3; continue; }
    if (c === '0' || c === '#' || c === '?') { tokens.push({ t: 'digit', c }); i++; continue; }
    if (c === '.') { tokens.push({ t: 'dec' }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'group' }); i++; continue; }
    if (c === '%') { tokens.push({ t: 'percent' }); i++; continue; }
    if (c === '@') { tokens.push({ t: 'text' }); i++; continue; }
    if ((c === 'E' || c === 'e') && (code[i + 1] === '+' || code[i + 1] === '-')) { tokens.push({ t: 'exp', sign: code[i + 1] as '+' | '-' }); i += 2; continue; }
    const U = c.toUpperCase();
    if ('YMDNQWHS'.includes(U)) {
      let j = i;
      while (j < code.length && code[j]!.toUpperCase() === U) j++;
      tokens.push({ t: 'date', k: up.slice(i, j) });
      if ('YDNQW'.includes(U)) hasDate = true;
      if ('HS'.includes(U)) hasTime = true;
      i = j;
      continue;
    }
    tokens.push({ t: 'lit', s: c });
    i++;
  }
  // A month after hours or before seconds is minutes (ImpSvNumberformatScan's MM resolution).
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]!;
    if (tk.t !== 'date' || tk.k[0] !== 'M') continue;
    const prev = tokens.slice(0, k).reverse().find((x) => x.t === 'date');
    const next = tokens.slice(k + 1).find((x) => x.t === 'date');
    if ((prev && prev.t === 'date' && (prev.k[0] === 'H' || prev.k.startsWith('[H'))) || (next && next.t === 'date' && next.k[0] === 'S')) { tokens[k] = { t: 'date', k: tk.k === 'M' ? 'm' : 'mm' }; hasTime = true; }
    else if (tk.k.length <= 2) hasDate = true;
    else hasDate = true;
  }
  let type: SvNumFormatType = SvNumFormatType.NUMBER;
  if (tokens.some((x) => x.t === 'lit' && x.s === '\u0000BOOLEAN')) type = SvNumFormatType.LOGICAL;
  else if (hasDate && hasTime) type = SvNumFormatType.DATETIME;
  else if (hasDate) type = SvNumFormatType.DATE;
  else if (hasTime) type = SvNumFormatType.TIME;
  else if (tokens.some((x) => x.t === 'currency')) type = SvNumFormatType.CURRENCY;
  else if (tokens.some((x) => x.t === 'percent')) type = SvNumFormatType.PERCENT;
  else if (tokens.some((x) => x.t === 'exp')) type = SvNumFormatType.SCIENTIFIC;
  else if (tokens.some((x) => x.t === 'text') && !tokens.some((x) => x.t === 'digit' || x.t === 'general')) type = SvNumFormatType.TEXT;
  return { tokens, color, type };
}

/** Splits a code at its unquoted semicolons. */
function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '"') q = !q;
    if (c === '\\' && !q) { cur += c + (code[i + 1] ?? ''); i++; continue; }
    if (c === ';' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export class SvNumberformat {
  readonly m_aCode: string;
  readonly m_aSections: Section[];
  private readonly m_aNotation: LocaleNotation;
  private readonly m_sLang: string;

  constructor(code: string, lang: string) {
    this.m_aCode = code;
    this.m_sLang = lang;
    this.m_aNotation = GetLocaleNotation(lang);
    this.m_aSections = splitSections(code || 'General').map((s) => ScanSection(s, this.m_aNotation));
  }

  /** SvNumberformat::GetType: the first section's type. */
  GetType(): SvNumFormatType { return this.m_aSections[0]!.type; }
  IsTextFormat(): boolean { return this.GetType() === SvNumFormatType.TEXT; }

  /** SvNumberformat::GetOutputString for a number: the text and the section's colour. */
  GetOutputString(fNumber: number): { text: string; color: string | null } {
    if (!Number.isFinite(fNumber)) return { text: '#VALUE!', color: null };
    const n = this.m_aSections.length;
    let sec = this.m_aSections[0]!, value = fNumber, sign = '';
    if (fNumber < 0 && n >= 2 && this.m_aSections[1]!.type !== SvNumFormatType.TEXT) { sec = this.m_aSections[1]!; value = -fNumber; }
    else if (fNumber === 0 && n >= 3 && this.m_aSections[2]!.type !== SvNumFormatType.TEXT) sec = this.m_aSections[2]!;
    else if (fNumber < 0) { value = -fNumber; sign = '-'; }
    if (sec.type === SvNumFormatType.TEXT) return { text: String(fNumber), color: sec.color };
    // BOOLEAN: TRUE for anything but 0
    if (sec.type === SvNumFormatType.LOGICAL) return { text: fNumber ? 'TRUE' : 'FALSE', color: sec.color };
    const isDate = sec.type === SvNumFormatType.DATE || sec.type === SvNumFormatType.TIME || sec.type === SvNumFormatType.DATETIME;
    const text = isDate ? this.formatDate(sec, fNumber) : sign + this.formatNumber(sec, value);
    return { text, color: sec.color };
  }

  /** SvNumberformat::GetOutputString for text: the text section, @ replaced. */
  GetTextOutput(s: string): string {
    const sec = this.m_aSections.find((x) => x.type === SvNumFormatType.TEXT) ?? (this.m_aSections.length >= 4 ? this.m_aSections[3] : null);
    if (!sec) return s;
    return sec.tokens.map((t) => (t.t === 'text' ? s : t.t === 'lit' ? t.s : '')).join('');
  }

  private formatGeneral(v: number): string {
    // ImpGetOutputStandard: up to 10 significant digits, scientific beyond.
    if (v === 0) return '0';
    const a = Math.abs(v);
    let s = a >= 1e15 || a < 1e-9 ? v.toExponential(9).replace(/\.?0+e/, 'E').replace(/E\+?/, 'E+').replace('E+-', 'E-') : String(Number(v.toPrecision(10)));
    s = s.replace('.', this.m_aNotation.decimal);
    return s;
  }

  private formatNumber(sec: Section, value: number): string {
    const tk = sec.tokens;
    if (tk.some((t) => t.t === 'general')) return tk.map((t) => (t.t === 'general' ? this.formatGeneral(value) : t.t === 'lit' ? t.s : t.t === 'currency' ? t.s : '')).join('');
    const percents = tk.filter((t) => t.t === 'percent').length;
    value *= 100 ** percents;
    const expAt = tk.findIndex((t) => t.t === 'exp');
    const decAt = tk.findIndex((t, k) => t.t === 'dec' && (expAt < 0 || k < expAt));
    const mant = expAt < 0 ? tk : tk.slice(0, expAt);
    const intDigits = (decAt < 0 ? mant : mant.slice(0, decAt)).filter((t) => t.t === 'digit') as { t: 'digit'; c: string }[];
    const fracDigits = (decAt < 0 ? [] : mant.slice(decAt + 1)).filter((t) => t.t === 'digit') as { t: 'digit'; c: string }[];
    // A group separator between integer digit placeholders groups thousands; after the last one it scales.
    const lastDigit = (() => { let k = -1; (decAt < 0 ? mant : mant.slice(0, decAt)).forEach((t, j) => { if (t.t === 'digit') k = j; }); return k; })();
    const firstDigit = mant.findIndex((t) => t.t === 'digit');
    const intPart = decAt < 0 ? mant : mant.slice(0, decAt);
    const grouping = intPart.some((t, j) => t.t === 'group' && j > firstDigit && j < lastDigit);
    let trailingGroups = 0;
    for (let j = lastDigit + 1; j < intPart.length && intPart[j]!.t === 'group'; j++) trailingGroups++;
    if (!fracDigits.length && decAt < 0) value /= 1000 ** trailingGroups;
    let exponent = 0;
    if (expAt >= 0 && value !== 0) {
      const step = intDigits.length > 1 && intDigits.length <= 3 && intDigits.some((d) => d.c === '#') ? intDigits.length : 1;
      exponent = Math.floor(Math.log10(value));
      exponent = Math.floor(exponent / step) * step;
      value /= 10 ** exponent;
    }
    const nFrac = fracDigits.length;
    let fixed = value.toFixed(nFrac);
    if (expAt >= 0 && Number(fixed) >= 10) { exponent += 1; value /= 10; fixed = value.toFixed(nFrac); }
    let [ip, fp = ''] = fixed.split('.') as [string, string?];
    // Optional decimals: # drops a trailing zero, ? shows a blank instead.
    let frac = [...fp];
    for (let k = nFrac - 1; k >= 0 && frac[k] === '0'; k--) {
      if (fracDigits[k]!.c === '0') break;
      if (fracDigits[k]!.c === '?') frac[k] = ' ';
      else frac = frac.slice(0, k);
    }
    fp = frac.join('');
    const minInt = intDigits.filter((d) => d.c === '0').length;
    if (ip === '0' && minInt === 0) ip = intDigits.some((d) => d.c === '?') ? ' ' : '';
    ip = ip.padStart(minInt, '0');
    if (grouping) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, this.m_aNotation.group);
    // Assemble: literals keep their place before, between and after the number.
    let out = '', numberDone = false, expDone = false;
    for (let k = 0; k < tk.length; k++) {
      const t = tk[k]!;
      if (t.t === 'lit') out += t.s;
      else if (t.t === 'currency') out += t.s;
      else if (t.t === 'percent') out += '%';
      else if ((t.t === 'digit' || t.t === 'dec' || t.t === 'group') && (expAt < 0 || k < expAt)) {
        if (!numberDone) { out += ip + (decAt >= 0 ? this.m_aNotation.decimal + fp : ''); numberDone = true; }
      } else if (t.t === 'exp' && !expDone) {
        const expDigits = tk.slice(k + 1).filter((x) => x.t === 'digit').length;
        out += `E${exponent < 0 ? '-' : t.sign === '+' ? '+' : ''}${String(Math.abs(exponent)).padStart(expDigits, '0')}`;
        expDone = true;
      }
    }
    return out;
  }

  private formatDate(sec: Section, serial: number): string {
    // Day 0 is 1899-12-30 (the null date of Writer's and Calc's documents).
    const ms = Math.round(serial * 86400000);
    const d = new Date(Date.UTC(1899, 11, 30) + ms);
    const lang = this.m_sLang;
    const hasAmPm = sec.tokens.some((t) => t.t === 'ampm');
    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...o }).format(d);
    const p2 = (n: number) => String(n).padStart(2, '0');
    let out = '';
    const tk = sec.tokens;
    for (let k = 0; k < tk.length; k++) {
      const t = tk[k]!;
      if (t.t === 'lit') { out += t.s; continue; }
      if (t.t === 'ampm') { const pm = d.getUTCHours() >= 12; out += t.s === 'A/P' ? (pm ? 'P' : 'A') : pm ? 'PM' : 'AM'; continue; }
      if (t.t === 'group') { out += ','; continue; }
      if (t.t === 'dec' && !(tk[k - 1]?.t === 'date' && (tk[k - 1] as { k: string }).k[0] === 'S' && tk[k + 1]?.t === 'digit')) { out += '.'; continue; }
      if (t.t === 'digit' || t.t === 'percent') { out += t.t === 'percent' ? '%' : t.c; continue; }
      if (t.t === 'dec') {
        // Fractions of seconds: .00 after seconds.
        let n = 0; while (tk[k + 1 + n]?.t === 'digit') n++;
        out += this.m_aNotation.decimal + String(Math.trunc(((ms % 1000) + 1000) % 1000 / 10 ** (3 - Math.min(3, n)))).padStart(n, '0').slice(0, n);
        k += n;
        continue;
      }
      if (t.t !== 'date') continue;
      const h = d.getUTCHours();
      switch (t.k) {
        case 'YY': out += p2(d.getUTCFullYear() % 100); break;
        case 'Y': case 'YYY': case 'YYYY': out += String(d.getUTCFullYear()); break;
        case 'M': out += String(d.getUTCMonth() + 1); break;
        case 'MM': out += p2(d.getUTCMonth() + 1); break;
        case 'MMM': out += fmt({ month: 'short' }).replace(/\.$/, ''); break;
        case 'MMMM': out += fmt({ month: 'long' }); break;
        case 'MMMMM': out += fmt({ month: 'narrow' }); break;
        case 'D': out += String(d.getUTCDate()); break;
        case 'DD': out += p2(d.getUTCDate()); break;
        case 'NN': case 'DDD': out += fmt({ weekday: 'short' }); break;
        case 'NNN': case 'DDDD': out += fmt({ weekday: 'long' }); break;
        case 'NNNN': out += `${fmt({ weekday: 'long' })}, `; break;
        case 'Q': out += `Q${Math.floor(d.getUTCMonth() / 3) + 1}`; break;
        case 'QQ': out += `${Math.floor(d.getUTCMonth() / 3) + 1}. quarter`; break;
        case 'WW': { const day = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000); out += String(Math.floor(day / 7) + 1); break; }
        case 'H': out += String(hasAmPm ? (h % 12 || 12) : h); break;
        case 'HH': out += p2(hasAmPm ? (h % 12 || 12) : h); break;
        case '[HH]': case '[H]': out += String(Math.floor(ms / 3600000)).padStart(t.k.length - 2, '0'); break;
        case 'm': out += String(d.getUTCMinutes()); break;
        case 'mm': out += p2(d.getUTCMinutes()); break;
        case '[MM]': case '[M]': out += String(Math.floor(ms / 60000)); break;
        case 'S': out += String(d.getUTCSeconds()); break;
        case 'SS': out += p2(d.getUTCSeconds()); break;
        default: out += t.k;
      }
    }
    return out;
  }
}
