// SPDX-License-Identifier: MPL-2.0
// java.util.regex.Pattern and Matcher for the LanguageTool ports: not a port, but the part of the
// JDK's API they use, so that the ports read like the Java. Java patterns are translated by
// oniguruma-to-es (Oniguruma's syntax is close to Java's: possessive quantifiers, atomic groups,
// inline flags, \p{...} and POSIX classes); what differs is rewritten first:
// - Java's inline flags: s (DOTALL) is Oniguruma's m; u, U, d have no counterpart and are dropped
//   (case-insensitive matching is always Unicode-aware here, as with UNICODE_CASE);
// - Java's POSIX classes (\p{Punct}, \p{Alpha}, ...) are US-ASCII, as in Java;
// - \d and \s are ASCII (Java's default) through Oniguruma's D and S options; \w and \b are
//   Unicode-aware unless the pattern is compiled with... never: Java 17's \b is Unicode-aware
//   already, and a Unicode \w only accepts more words in LanguageTool's rules;
// - ^ and $ match at the ends of the input only (Oniguruma's singleline), as without MULTILINE;
// - a pattern Oniguruma refuses (e.g. a lookbehind of variable length, which Java and
//   JavaScript accept) is compiled as a JavaScript pattern directly (without the u flag when it
//   has identity escapes such as \!).
import { toRegExp } from 'oniguruma-to-es';

const POSIX: Record<string, string> = {
  Lower: 'a-z', Upper: 'A-Z', ASCII: '\\x00-\\x7F', Alpha: 'a-zA-Z', Digit: '0-9', Alnum: 'a-zA-Z0-9',
  Punct: '!-\\/:-@\\[-`{-~', Graph: '!-~', Print: ' -~', Blank: ' \\t', Cntrl: '\\x00-\\x1F\\x7F', XDigit: '0-9a-fA-F', Space: ' \\t\\n\\x0B\\f\\r',
};
const JAVA_PROPS: Record<string, string> = {
  javaLowerCase: '\\p{Ll}', javaUpperCase: '\\p{Lu}', javaWhitespace: '\\s', javaMirrored: '\\p{Bidi_M}',
  javaLetter: '\\p{L}', javaDigit: '\\p{Nd}', javaLetterOrDigit: '[\\p{L}\\p{Nd}]', javaAlphabetic: '\\p{Alphabetic}',
};

/** Rewrites what Java and Oniguruma read differently (see the header). */
export function JavaToOniguruma(regex: string): string {
  let out = '';
  for (let i = 0; i < regex.length; i++) {
    const ch = regex[i]!;
    if (ch === '\\' && regex[i + 1] === 'Q') {
      // \Q...\E: a literal
      const end = regex.indexOf('\\E', i + 2);
      out += Pattern.quote(regex.slice(i + 2, end < 0 ? regex.length : end));
      i = end < 0 ? regex.length : end + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < regex.length) {
      const m = /^\\([pP])\{(\w+)\}/.exec(regex.slice(i));
      if (m) {
        const neg = m[1] === 'P', name = m[2]!;
        const inClass = isInClass(regex, i);
        let rep: string | undefined;
        if (POSIX[name] !== undefined) rep = inClass ? (neg ? undefined : POSIX[name]) : `[${neg ? '^' : ''}${POSIX[name]}]`;
        else if (JAVA_PROPS[name] && !neg) rep = JAVA_PROPS[name];
        else if (/^Is[A-Z]/.test(name)) rep = `\\${m[1]}{${name.slice(2)}}`;
        else if (/^In[A-Z]/.test(name)) rep = `\\${m[1]}{In_${name.slice(2)}}`;
        if (rep !== undefined) { out += rep; i += m[0].length - 1; continue; }
      }
      out += ch + regex[i + 1]!;
      i++;
      continue;
    }
    if (ch === '(' && regex[i + 1] === '?') {
      const m = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(regex.slice(i));
      if (m && (m[1] || m[2] !== undefined)) {
        const conv = (f: string) => [...f].map((c) => (c === 's' ? 'm' : c === 'i' || c === 'x' ? c : '')).join('');
        const on = conv(m[1]!), off = m[2] !== undefined ? conv(m[2]) : undefined;
        if (!on && !off) out += m[3] === ':' ? '(?:' : '';
        else out += `(?${on}${off ? `-${off}` : ''}${m[3]}`;
        i += m[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Whether position i is inside a character class [...]. */
function isInClass(s: string, i: number): boolean {
  let depth = 0;
  for (let k = 0; k < i; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '[') depth++;
    else if (s[k] === ']' && depth) depth--;
  }
  return depth > 0;
}

const cache = new Map<string, RegExp>();

/** A JavaScript RegExp for a Java pattern: global and with indices, for Matcher. */
function compileJava(regex: string, flags: number, anchored: boolean): RegExp {
  const key = `${flags}\u0000${anchored ? 1 : 0}\u0000${regex}`;
  let re = cache.get(key);
  if (re) return re;
  let oflags = 'DS';
  if (flags & Pattern.CASE_INSENSITIVE) oflags += 'i';
  if (flags & Pattern.DOTALL) oflags += 'm';
  if (flags & Pattern.COMMENTS) oflags += 'x';
  const src = flags & Pattern.LITERAL ? Pattern.quote(regex) : regex;
  const body = anchored ? `\\A(?:${JavaToOniguruma(src)})\\z` : JavaToOniguruma(src);
  try {
    re = toRegExp(body, { flags: oflags, global: true, hasIndices: true, rules: { singleline: !(flags & Pattern.MULTILINE), allowOrphanBackrefs: true } });
  } catch (e) {
    // Oniguruma refuses some patterns JavaScript takes (lookbehind of variable length).
    try {
      const js = anchored ? `^(?:${src})$` : src;
      const jsFlags = `gd${flags & Pattern.CASE_INSENSITIVE ? 'i' : ''}${flags & Pattern.DOTALL ? 's' : ''}${flags & Pattern.MULTILINE ? 'm' : ''}`;
      // Without the u flag, identity escapes (\!) are allowed, as in Java.
      try { re = new RegExp(js, `${jsFlags}u`); } catch { re = new RegExp(js, jsFlags); }
    } catch {
      throw new PatternSyntaxException((e as Error).message, regex);
    }
  }
  cache.set(key, re);
  return re;
}

export class PatternSyntaxException extends Error {
  readonly pattern: string;
  constructor(desc: string, regex: string) { super(`${desc} in "${regex}"`); this.pattern = regex; }
  getPattern(): string { return this.pattern; }
}

export class Pattern {
  static readonly UNIX_LINES = 0x01;
  static readonly CASE_INSENSITIVE = 0x02;
  static readonly COMMENTS = 0x04;
  static readonly MULTILINE = 0x08;
  static readonly LITERAL = 0x10;
  static readonly DOTALL = 0x20;
  static readonly UNICODE_CASE = 0x40;
  static readonly CANON_EQ = 0x80;
  static readonly UNICODE_CHARACTER_CLASS = 0x100;

  private readonly m_sPattern: string;
  private readonly m_nFlags: number;
  private m_aFind: RegExp | null = null;
  private m_aWhole: RegExp | null = null;

  private constructor(regex: string, flags: number) {
    this.m_sPattern = regex;
    this.m_nFlags = flags;
  }

  /** Compiles (and checks) a pattern; the JavaScript RegExps are made on first use. */
  static compile(regex: string, flags = 0): Pattern {
    const p = new Pattern(regex, flags);
    p.findRegExp();
    return p;
  }

  static matches(regex: string, input: string): boolean { return Pattern.compile(regex).matcher(input).matches(); }

  /** A literal pattern for a string (Java writes \\Q...\\E). */
  static quote(s: string): string { return s.replace(/[\\^$.*+?()[\]{}|\-]/g, '\\$&'); }

  pattern(): string { return this.m_sPattern; }
  toString(): string { return this.m_sPattern; }
  flags(): number { return this.m_nFlags; }

  /** @internal */
  findRegExp(): RegExp { return (this.m_aFind ??= compileJava(this.m_sPattern, this.m_nFlags, false)); }
  /** @internal */
  wholeRegExp(): RegExp { return (this.m_aWhole ??= compileJava(this.m_sPattern, this.m_nFlags, true)); }

  matcher(input: string): Matcher { return new Matcher(this, input); }

  /** Pattern.split: trailing empty strings removed (limit 0), as Java does. */
  split(input: string, limit = 0): string[] {
    const out: string[] = [];
    const m = this.matcher(input);
    let index = 0;
    while (m.find()) {
      if (limit > 0 && out.length >= limit - 1) break;
      if (m.end() === 0) continue; // no leading empty string for a zero-width match at 0
      out.push(input.slice(index, m.start()));
      index = m.end();
    }
    if (index === 0 && out.length === 0) return [input];
    out.push(input.slice(index));
    if (limit === 0) while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }
}

export class Matcher {
  private m_pPattern: Pattern;
  private m_sText: string;
  private m_aMatch: RegExpExecArray | null = null;
  private m_nFrom = 0;
  private m_nAppendPos = 0;

  constructor(p: Pattern, text: string) {
    this.m_pPattern = p;
    this.m_sText = text;
  }

  pattern(): Pattern { return this.m_pPattern; }

  reset(input?: string): this {
    if (input !== undefined) this.m_sText = input;
    this.m_aMatch = null;
    this.m_nFrom = 0;
    this.m_nAppendPos = 0;
    return this;
  }

  usePattern(p: Pattern): this { this.m_pPattern = p; this.m_aMatch = null; return this; }

  /** The whole input matches. */
  matches(): boolean {
    const re = this.m_pPattern.wholeRegExp();
    re.lastIndex = 0;
    this.m_aMatch = re.exec(this.m_sText);
    return !!this.m_aMatch;
  }

  /** The input starts with a match. */
  lookingAt(): boolean {
    const re = this.m_pPattern.findRegExp();
    re.lastIndex = 0;
    const m = re.exec(this.m_sText);
    this.m_aMatch = m && m.index === 0 ? m : null;
    return !!this.m_aMatch;
  }

  /** The next match (after the previous one), or the first one from `start`. */
  find(start?: number): boolean {
    if (start !== undefined) { this.reset(); this.m_nFrom = start; }
    if (this.m_nFrom > this.m_sText.length) { this.m_aMatch = null; return false; }
    const re = this.m_pPattern.findRegExp();
    re.lastIndex = this.m_nFrom;
    const m = re.exec(this.m_sText);
    this.m_aMatch = m;
    if (!m) { this.m_nFrom = this.m_sText.length + 1; return false; }
    // An empty match moves on by one, as Java's does.
    this.m_nFrom = m[0].length ? m.index + m[0].length : m.index + 1;
    return true;
  }

  private ensure(): RegExpExecArray {
    if (!this.m_aMatch) throw new Error('IllegalStateException: No match available');
    return this.m_aMatch;
  }

  groupCount(): number {
    const re = this.m_pPattern.findRegExp();
    return new RegExp(`${re.source}|`, re.flags.replace(/[gyd]/g, '')).exec('')!.length - 1;
  }

  group(group: number | string = 0): string | null {
    const m = this.ensure();
    const v = typeof group === 'string' ? m.groups?.[group] : m[group];
    if (typeof group === 'number' && (group < 0 || group >= m.length)) throw new Error(`IndexOutOfBoundsException: No group ${group}`);
    return v ?? null;
  }

  start(group = 0): number {
    const m = this.ensure();
    return group === 0 ? m.index : (m.indices?.[group]?.[0] ?? -1);
  }

  end(group = 0): number {
    const m = this.ensure();
    return group === 0 ? m.index + m[0].length : (m.indices?.[group]?.[1] ?? -1);
  }

  hitEnd(): boolean { return this.m_aMatch ? this.end() === this.m_sText.length : true; }

  /** Expands a Java replacement string ($n, ${name}, \x) for the current match. */
  private expand(replacement: string): string {
    let out = '';
    for (let i = 0; i < replacement.length; i++) {
      const c = replacement[i]!;
      if (c === '\\') { out += replacement[++i] ?? ''; continue; }
      if (c === '$') {
        if (replacement[i + 1] === '{') {
          const close = replacement.indexOf('}', i);
          out += this.group(replacement.slice(i + 2, close)) ?? '';
          i = close;
          continue;
        }
        // Java takes as many digits as still name an existing group.
        let n = Number(replacement[i + 1]);
        if (Number.isNaN(n)) throw new Error('IllegalArgumentException: Illegal group reference');
        i++;
        const count = this.ensure().length - 1;
        while (i + 1 < replacement.length && /\d/.test(replacement[i + 1]!) && n * 10 + Number(replacement[i + 1]) <= count) n = n * 10 + Number(replacement[++i]);
        out += this.group(n) ?? '';
        continue;
      }
      out += c;
    }
    return out;
  }

  appendReplacement(sb: { s: string }, replacement: string): this {
    sb.s += this.m_sText.slice(this.m_nAppendPos, this.start()) + this.expand(replacement);
    this.m_nAppendPos = this.end();
    return this;
  }

  appendTail(sb: { s: string }): { s: string } {
    sb.s += this.m_sText.slice(this.m_nAppendPos);
    return sb;
  }

  replaceAll(replacement: string | ((m: Matcher) => string)): string {
    this.reset();
    const sb = { s: '' };
    while (this.find()) this.appendReplacement(sb, typeof replacement === 'string' ? replacement : Matcher.quoteReplacement(replacement(this)));
    return this.appendTail(sb).s;
  }

  replaceFirst(replacement: string): string {
    this.reset();
    const sb = { s: '' };
    if (this.find()) this.appendReplacement(sb, replacement);
    return this.appendTail(sb).s;
  }

  static quoteReplacement(s: string): string { return s.replace(/[\\$]/g, (c) => `\\${c}`); }
}

/** String.matches(regex) */
export const StringMatches = (s: string, regex: string): boolean => Pattern.compile(regex).matcher(s).matches();
/** String.replaceAll(regex, replacement) */
export const StringReplaceAll = (s: string, regex: string, replacement: string): string => Pattern.compile(regex).matcher(s).replaceAll(replacement);
/** String.replaceFirst(regex, replacement) */
export const StringReplaceFirst = (s: string, regex: string, replacement: string): string => Pattern.compile(regex).matcher(s).replaceFirst(replacement);
/** String.split(regex, limit) */
export const StringSplit = (s: string, regex: string, limit = 0): string[] => Pattern.compile(regex).split(s, limit);
