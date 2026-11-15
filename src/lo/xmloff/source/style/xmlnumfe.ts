// SPDX-License-Identifier: MPL-2.0
// @upstream xmloff/source/style/xmlnumfe.cxx reduced
// @upstream xmloff/source/style/xmlnumfi.cxx reduced
// Number formats as ODF data styles: SvXMLNumFmtExport writes a format code (the reduced
// SvNumberformat's sections) as number:number-style, percentage-, currency-, scientific-, date-,
// time-, boolean- and text-style elements, the sections after the first through style:map with
// conditions; SvXMLNumFormatContext reads them back into a code. Not supported: fractions,
// embedded text in numbers, calendars, the transliteration attributes.
import { childElements, escapeXml, type XmlElement } from '../core/xmlparse.ts';
import { SvNumFormatType, SvNumberformat } from '../../../svl/source/numbers/zformat.ts';

const FAMILY: Record<number, string> = {
  [SvNumFormatType.NUMBER]: 'number-style', [SvNumFormatType.PERCENT]: 'percentage-style', [SvNumFormatType.CURRENCY]: 'currency-style',
  [SvNumFormatType.SCIENTIFIC]: 'number-style', [SvNumFormatType.DATE]: 'date-style', [SvNumFormatType.TIME]: 'time-style',
  [SvNumFormatType.DATETIME]: 'date-style', [SvNumFormatType.TEXT]: 'text-style', [SvNumFormatType.LOGICAL]: 'boolean-style',
};

/** The ODF value type of a format (office:value-type). */
export function ValueTypeOf(code: string, lang: string): 'float' | 'percentage' | 'currency' | 'date' | 'time' | 'boolean' | 'string' {
  switch (new SvNumberformat(code, lang).GetType()) {
    case SvNumFormatType.PERCENT: return 'percentage';
    case SvNumFormatType.CURRENCY: return 'currency';
    case SvNumFormatType.DATE: case SvNumFormatType.DATETIME: return 'date';
    case SvNumFormatType.TIME: return 'time';
    case SvNumFormatType.LOGICAL: return 'boolean';
    case SvNumFormatType.TEXT: return 'string';
    default: return 'float';
  }
}

/** One section's elements (SvXMLNumFmtExport::ExportPart_Impl). */
function ExportPart(sec: SvNumberformat['m_aSections'][number], currency: string): string {
  let out = '';
  const text = (s: string) => { if (s) out += `<number:text>${escapeXml(s)}</number:text>`; };
  if (sec.color) out += `<style:text-properties fo:color="${sec.color}"/>`;
  const tk = sec.tokens;
  let lit = '';
  const flush = () => { text(lit); lit = ''; };
  if (sec.type === SvNumFormatType.LOGICAL) return `${out}<number:boolean/>`;
  if (sec.type === SvNumFormatType.TEXT) {
    for (const t of tk) { if (t.t === 'lit') lit += t.s; else if (t.t === 'text') { flush(); out += '<number:text-content/>'; } }
    flush();
    return out;
  }
  const isDate = sec.type === SvNumFormatType.DATE || sec.type === SvNumFormatType.TIME || sec.type === SvNumFormatType.DATETIME;
  if (isDate) {
    for (let k = 0; k < tk.length; k++) {
      const t = tk[k]!;
      if (t.t === 'lit') { lit += t.s; continue; }
      if (t.t === 'group') { lit += ','; continue; }
      if (t.t === 'dec' && !(tk[k - 1]?.t === 'date' && (tk[k - 1] as { k: string }).k[0] === 'S')) { lit += '.'; continue; }
      flush();
      if (t.t === 'ampm') { out += '<number:am-pm/>'; continue; }
      if (t.t !== 'date') continue;
      const long = ' number:style="long"';
      switch (t.k) {
        case 'YY': out += '<number:year/>'; break;
        case 'Y': case 'YYY': case 'YYYY': out += `<number:year${long}/>`; break;
        case 'M': out += '<number:month/>'; break;
        case 'MM': out += `<number:month${long}/>`; break;
        case 'MMM': out += '<number:month number:textual="true"/>'; break;
        case 'MMMM': out += `<number:month${long} number:textual="true"/>`; break;
        case 'D': out += '<number:day/>'; break;
        case 'DD': out += `<number:day${long}/>`; break;
        case 'NN': case 'DDD': out += '<number:day-of-week/>'; break;
        case 'NNN': case 'DDDD': out += `<number:day-of-week${long}/>`; break;
        case 'NNNN': out += `<number:day-of-week${long}/><number:text>, </number:text>`; break;
        case 'Q': out += '<number:quarter/>'; break;
        case 'QQ': out += `<number:quarter${long}/>`; break;
        case 'WW': out += '<number:week-of-year/>'; break;
        case 'H': out += '<number:hours/>'; break;
        case 'HH': out += `<number:hours${long}/>`; break;
        case '[H]': case '[HH]': out += `<number:hours${t.k === '[HH]' ? long : ''}/>`; break;
        case 'm': out += '<number:minutes/>'; break;
        case 'mm': out += `<number:minutes${long}/>`; break;
        case 'S': case 'SS': {
          let n = 0;
          if (tk[k + 1]?.t === 'dec') { while (tk[k + 2 + n]?.t === 'digit') n++; k += 1 + n; }
          out += `<number:seconds${t.k === 'SS' ? long : ''}${n ? ` number:decimal-places="${n}"` : ''}/>`;
          break;
        }
        default: break;
      }
    }
    flush();
    return out;
  }
  // Numbers: the literals before and after the number, the number itself as one element.
  const expAt = tk.findIndex((t) => t.t === 'exp');
  const decAt = tk.findIndex((t, k) => t.t === 'dec' && (expAt < 0 || k < expAt));
  const mant = expAt < 0 ? tk : tk.slice(0, expAt);
  const intPart = decAt < 0 ? mant : mant.slice(0, decAt);
  const intDigits = intPart.filter((t) => t.t === 'digit') as { c: string }[];
  const fracDigits = (decAt < 0 ? [] : mant.slice(decAt + 1)).filter((t) => t.t === 'digit') as { c: string }[];
  const firstD = tk.findIndex((t) => t.t === 'digit' || t.t === 'general');
  let lastD = -1;
  tk.forEach((t, k) => { if (t.t === 'digit' || t.t === 'dec' || t.t === 'group' || t.t === 'general' || (t.t === 'exp')) lastD = k; });
  for (let k = 0; k < tk.length; k++) {
    const t = tk[k]!;
    if (k === firstD) {
      flush();
      if (t.t === 'general') { out += '<number:number number:min-integer-digits="1"/>'; continue; }
      const grouping = intPart.some((x) => x.t === 'group');
      const minInt = intDigits.filter((d) => d.c === '0').length;
      const dec = fracDigits.length, minDec = fracDigits.filter((d) => d.c === '0').length;
      if (expAt >= 0) {
        const expDigits = tk.slice(expAt + 1).filter((x) => x.t === 'digit').length;
        out += `<number:scientific-number number:decimal-places="${dec}" number:min-decimal-places="${minDec}" number:min-integer-digits="${minInt}" number:min-exponent-digits="${expDigits}"${grouping ? ' number:grouping="true"' : ''}/>`;
      } else out += `<number:number number:decimal-places="${dec}" number:min-decimal-places="${minDec}" number:min-integer-digits="${minInt}"${grouping ? ' number:grouping="true"' : ''}/>`;
      k = lastD;
      continue;
    }
    if (t.t === 'lit') lit += t.s;
    else if (t.t === 'percent') lit += '%';
    else if (t.t === 'currency') { flush(); out += `<number:currency-symbol>${escapeXml(t.s || currency)}</number:currency-symbol>`; }
  }
  flush();
  return out;
}

/**
 * SvXMLNumFmtExport::ExportFormat_Impl: the data style of a code, and those of its sections after
 * the first (named name + "P0", "P1", …), mapped by their conditions.
 */
export function ExportNumberStyle(name: string, code: string, lang: string): string {
  const f = new SvNumberformat(code, lang);
  const secs = f.m_aSections;
  const fam = (s: (typeof secs)[number]) => FAMILY[s.type] ?? 'number-style';
  // [HH]: hours past a day (number:truncate-on-overflow="false").
  const attrs = (s: (typeof secs)[number]) => (s.tokens.some((t) => t.t === 'date' && t.k.startsWith('[H')) ? ' number:truncate-on-overflow="false"' : '');
  const currency = '$';
  const parts: string[] = [];
  // The first section takes positive numbers, the second negative ones, the third zero.
  const conds = secs.length >= 3 ? ['value()&gt;0', 'value()&lt;0', 'value()=0'] : ['value()&gt;=0', 'value()&lt;0'];
  if (secs.length === 1) return `<number:${fam(secs[0]!)} style:name="${name}"${attrs(secs[0]!)}>${ExportPart(secs[0]!, currency)}</number:${fam(secs[0]!)}>`;
  // The last section is the main style; the others are mapped (as upstream, the positive part first).
  secs.slice(0, -1).forEach((s, i) => parts.push(`<number:${fam(s)} style:name="${name}P${i}" style:volatile="true"${attrs(s)}>${ExportPart(s, currency)}</number:${fam(s)}>`));
  const main = secs[secs.length - 1]!;
  const maps = secs.slice(0, -1).map((_s, i) => `<style:map style:condition="${conds[i]}" style:apply-style-name="${name}P${i}"/>`).join('');
  parts.push(`<number:${fam(main)} style:name="${name}"${attrs(main)}>${ExportPart(main, currency)}${maps}</number:${fam(main)}>`);
  return parts.join('');
}

const quoted = (s: string) => (/^[\s\-()/:.,]*$/.test(s) && !s.includes('"') ? s.replace(/([^\s\-()/:.,])/g, '\\$1') : `"${s.replace(/"/g, '')}"`);

/** SvXMLNumFormatContext: the code of one data style element (without its maps). */
function ImportPart(el: XmlElement): string {
  let code = '';
  const long = (e: XmlElement) => e.attrs.get('number:style') === 'long';
  for (const e of childElements(el)) {
    const n = e.name.replace(/^number:/, '');
    const a = (k: string) => e.attrs.get(`number:${k}`);
    switch (n) {
      case 'text': {
        const tx = e.children.map((c) => (typeof c === 'string' ? c : '')).join('');
        // The percent sign of a percentage style is the % of the code.
        code += el.name === 'number:percentage-style' && tx.includes('%') ? tx.split('%').map(quoted).join('%').replace(/""/g, '') : quoted(tx);
        break;
      }
      case 'text-content': code += '@'; break;
      case 'boolean': code += 'BOOLEAN'; break;
      case 'currency-symbol': {
        const sym = e.children.map((c) => (typeof c === 'string' ? c : '')).join('');
        code += sym ? `[$${sym}]` : '[CURRENCY]';
        break;
      }
      case 'number': case 'scientific-number': {
        // Without number:decimal-places the number has the standard precision: the General format
        // (SvXMLNumFmtElementContext, nDecimals -1).
        if (n === 'number' && a('decimal-places') === undefined && a('grouping') !== 'true' && Number(a('min-integer-digits') ?? 1) <= 1) { code += 'General'; break; }
        const dec = Number(a('decimal-places') ?? 0), minDec = Number(a('min-decimal-places') ?? dec), minInt = Number(a('min-integer-digits') ?? 1);
        let int = minInt ? '0'.repeat(minInt) : '#';
        if (a('grouping') === 'true') { const d = int.padStart(4, '#'); int = `${d.slice(0, -3)},${d.slice(-3)}`; }
        code += int + (dec ? `.${'0'.repeat(minDec)}${'#'.repeat(Math.max(0, dec - minDec))}` : '');
        if (n === 'scientific-number') code += `E+${'0'.repeat(Number(a('min-exponent-digits') ?? 2))}`;
        break;
      }
      case 'year': code += long(e) ? 'YYYY' : 'YY'; break;
      case 'month': code += a('textual') === 'true' ? (long(e) ? 'MMMM' : 'MMM') : long(e) ? 'MM' : 'M'; break;
      case 'day': code += long(e) ? 'DD' : 'D'; break;
      case 'day-of-week': code += long(e) ? 'NNN' : 'NN'; break;
      case 'quarter': code += long(e) ? 'QQ' : 'Q'; break;
      case 'week-of-year': code += 'WW'; break;
      case 'hours': code += el.attrs.get('number:truncate-on-overflow') === 'false' ? (long(e) ? '[HH]' : '[H]') : long(e) ? 'HH' : 'H'; break;
      case 'minutes': code += long(e) ? 'MM' : 'M'; break;
      case 'seconds': { const d = Number(a('decimal-places') ?? 0); code += (long(e) ? 'SS' : 'S') + (d ? `.${'0'.repeat(d)}` : ''); break; }
      case 'am-pm': code += 'AM/PM'; break;
      default: break;
    }
  }
  const color = childElements(el).find((c) => c.name === 'style:text-properties')?.attrs.get('fo:color');
  const NAMES: Record<string, string> = { '#ff0000': 'RED', '#0000ff': 'BLUE', '#00ff00': 'GREEN', '#000000': 'BLACK', '#ffffff': 'WHITE', '#ffff00': 'YELLOW', '#00ffff': 'CYAN', '#ff00ff': 'MAGENTA' };
  if (color && NAMES[color.toLowerCase()]) code = `[${NAMES[color.toLowerCase()]}]${code}`;
  if (el.name === 'number:percentage-style' && !code.includes('%')) code += '%';
  // NNNN is the long day of the week with its separator.
  code = code.replace(/^NNN, /, 'NNNN').replace(/NNN", "/g, 'NNNN');
  return code;
}

/** The data styles of a styles element by name, as codes (their style:map sections first, as written). */
export function ImportNumberStyles(roots: (XmlElement | undefined)[]): Map<string, string> {
  const els = new Map<string, XmlElement>();
  for (const root of roots) for (const e of root ? childElements(root) : []) if (/^number:.*-style$/.test(e.name) && e.attrs.get('style:name')) els.set(e.attrs.get('style:name')!, e);
  const out = new Map<string, string>();
  for (const [name, el] of els) {
    const maps = childElements(el).filter((c) => c.name === 'style:map');
    const mapped = maps.map((m) => { const s = els.get(m.attrs.get('style:apply-style-name') ?? ''); return s ? ImportPart(s) : ''; }).filter(Boolean);
    out.set(name, [...mapped, ImportPart(el)].join(';'));
  }
  return out;
}
