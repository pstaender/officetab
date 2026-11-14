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
// - a pattern Oniguruma refuses (e.g. a lookahead inside a lookbehind, which Java and
//   JavaScript accept) is rewritten for JavaScript by JavaToJavaScript; if even that fails, it
//   is compiled as a JavaScript pattern directly (without the u flag when it has identity
//   escapes such as \!).
import { toRegExp } from 'oniguruma-to-es';

const POSIX: Record<string, string> = {
  Lower: 'a-z', Upper: 'A-Z', ASCII: '\\x00-\\x7F', Alpha: 'a-zA-Z', Digit: '0-9', Alnum: 'a-zA-Z0-9',
  Punct: '!-\\/:-@\\[-`{-~', Graph: '!-~', Print: ' -~', Blank: ' \\t', Cntrl: '\\x00-\\x1F\\x7F', XDigit: '0-9a-fA-F', Space: ' \\t\\n\\x0B\\f\\r',
};
/** Unicode blocks (\p{InX}; JavaScript has none): the ones LanguageTool's patterns use. */
const BLOCKS: Record<string, string> = {
  CombiningDiacriticalMarks: '\\u0300-\\u036F', BasicLatin: '\\u0000-\\u007F', Latin1Supplement: '\\u0080-\\u00FF',
  LatinExtendedA: '\\u0100-\\u017F', LatinExtendedB: '\\u0180-\\u024F', GeneralPunctuation: '\\u2000-\\u206F',
  Greek: '\\u0370-\\u03FF', Cyrillic: '\\u0400-\\u04FF', Arabic: '\\u0600-\\u06FF',
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
        else if (/^In[A-Z]/.test(name) && BLOCKS[name.slice(2)]) rep = inClass ? (neg ? undefined : BLOCKS[name.slice(2)]) : `[${neg ? '^' : ''}${BLOCKS[name.slice(2)]}]`;
        if (rep !== undefined) { out += rep; i += m[0].length - 1; continue; }
      }
      out += ch + regex[i + 1]!;
      i++;
      continue;
    }
    if (ch === '(' && regex[i + 1] === '?') {
      const m = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(regex.slice(i));
      // Java accepts an empty flag group "(?)": it changes nothing.
      if (m && !m[1] && m[2] === undefined && m[3] === ')') { i += m[0].length - 1; continue; }
      if (m && (m[1] || m[2] !== undefined)) {
        const conv = (f: string) => [...f].map((c) => (c === 's' ? 'm' : c === 'i' || c === 'x' ? c : '')).join('');
        const on = conv(m[1]!), off = m[2] !== undefined ? conv(m[2]) : undefined;
        if (!on && !off) out += m[3] === ':' ? '(?:' : '';
        else out += `(?${on}${off ? `-${off}` : ''}${m[3]}`;
        i += m[0].length - 1;
        continue;
      }
    }
    // An optional anchor ("PRP$?", which Java accepts) matches with or without it: drop it.
    if ((ch === '$' || ch === '^') && /^[?*]/.test(regex[i + 1] ?? '') && !isInClass(regex, i)) { i++; continue; }
    out += ch;
  }
  return out;
}

const JS_WORD = '[\\p{L}\\p{Nd}_]';
const JS_SPACE = ' \\t\\n\\x0B\\f\\r';
const JS_HSPACE = ' \\t\\xA0\\u1680\\u180E\\u2000-\\u200A\\u202F\\u205F\\u3000';
const JS_VSPACE = '\\n\\x0B\\f\\r\\x85\\u2028\\u2029';
/** \\w with UNICODE_CHARACTER_CLASS */
const JS_UWORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}';
const JS_LINE_END = '\\n\\r\\u0085\\u2028\\u2029';
const JS_SYNTAX = '^$\\.*+?()[]{}|/';

/** The other cases of a character, for case-insensitive matching by expansion. */
function caseVariants(ch: string): string {
  let out = '';
  for (const v of new Set([ch.toLowerCase(), ch.toUpperCase()])) if (v !== ch && [...v].length === 1) out += v;
  return out;
}

/**
 * Rewrites a Java pattern as a JavaScript one (for the u flag), for the patterns oniguruma-to-es
 * refuses. Java's semantics are kept where JavaScript differs: \s and \d are ASCII, \b is
 * Unicode-aware (Java 17), . ^ $ \A \z \Z follow Java's line terminators, nested classes and
 * intersections ([a-z&&[^aeiou]]) become lookaheads, and inline flags ((?i), (?s), (?m), scoped to
 * their group as in Java) are applied by rewriting: case-insensitive letters are expanded to
 * [aA] (ranges only for ASCII letters), as JavaScript's own modifiers are not everywhere yet;
 * (?U) (UNICODE_CHARACTER_CLASS) makes \\s \\d \\w Unicode-aware (\\b is anyway).
 * Possessive quantifiers, atomic groups, \G and comments mode are not supported and throw.
 */
export function JavaToJavaScript(regex: string, flags = 0): string {
  const unsupported = (what: string): never => { throw new Error(`${what} not supported in JavaScript`); };
  if (flags & Pattern.COMMENTS) unsupported('Comments mode');
  type State = { ci: boolean; dotall: boolean; multiline: boolean; uc: boolean };
  let st: State = {
    ci: !!(flags & Pattern.CASE_INSENSITIVE), dotall: !!(flags & Pattern.DOTALL), multiline: !!(flags & Pattern.MULTILINE),
    uc: !!(flags & Pattern.UNICODE_CHARACTER_CLASS),
  };
  const stack: State[] = [];
  let i = 0;
  const esc = (ch: string, inClass: boolean) => (JS_SYNTAX.includes(ch) || (inClass && ch === '-') ? `\\${ch}` : ch);
  const swapCase = (x: string) => (x === x.toLowerCase() ? x.toUpperCase() : x.toLowerCase());
  // 'char': one character (ch: the character itself, for case variants); 'content': a set that
  // can stand inside [...]; 'expr': a set that cannot, as an expression; 'other': no set.
  type Atom = { kind: 'char' | 'content' | 'expr' | 'other'; js: string; ch?: string };
  const plain = (inClass: boolean): Atom => {
    const ch = String.fromCodePoint(regex.codePointAt(i)!);
    i += ch.length;
    return { kind: 'char', js: esc(ch, inClass), ch };
  };
  /** The escape at regex[i] (a backslash); i is moved past it. */
  const escape = (inClass: boolean): Atom => {
    const n = regex[i + 1];
    if (n === undefined) return unsupported('Trailing backslash');
    i += 2;
    const set = (js: string, neg: boolean): Atom => {
      const content = js.startsWith('[') ? js.slice(1, -1) : js;
      return neg ? { kind: 'expr', js: `[^${content}]` } : { kind: 'content', js: content };
    };
    switch (n) {
      case 'Q': {
        const end = regex.indexOf('\\E', i);
        const s = regex.slice(i, end < 0 ? regex.length : end);
        i = end < 0 ? regex.length : end + 2;
        if (inClass) return { kind: 'content', js: [...s].map((ch) => esc(ch, true) + (st.ci ? caseVariants(ch) : '')).join('') };
        return { kind: 'other', js: [...s].map((ch) => literal({ kind: 'char', js: esc(ch, false), ch })).join('') };
      }
      case 'p': case 'P': {
        const neg = n === 'P';
        let name: string;
        if (regex[i] === '{') { const close = regex.indexOf('}', i); name = regex.slice(i + 1, close); i = close + 1; } else name = regex[i++]!;
        if (POSIX[name] !== undefined) return set(POSIX[name], neg);
        if (/^In[A-Z]/.test(name)) return set(BLOCKS[name.slice(2)] ?? unsupported(`\\p{${name}}`), neg);
        if (JAVA_PROPS[name]) return set(JAVA_PROPS[name], neg);
        const prop = /^Is[A-Z]/.test(name) ? name.slice(2) : name;
        let js = `\\${n}{${prop}}`;
        try { new RegExp(js, 'u'); } catch { js = `\\${n}{Script=${prop}}`; }
        return { kind: 'content', js };
      }
      case 's': case 'S': return set(st.uc ? '\\s' : JS_SPACE, n === 'S');
      case 'd': case 'D': return set(st.uc ? '\\p{Nd}' : '0-9', n === 'D');
      case 'w': case 'W': return st.uc ? set(JS_UWORD, n === 'W') : { kind: 'content', js: `\\${n}` };
      case 'h': case 'H': return set(JS_HSPACE, n === 'H');
      case 'v': case 'V': return set(JS_VSPACE, n === 'V');
      case 't': case 'n': case 'r': case 'f': return { kind: 'char', js: `\\${n}` };
      case 'e': return { kind: 'char', js: '\\x1B' };
      case 'a': return { kind: 'char', js: '\\x07' };
      case 'c': return { kind: 'char', js: `\\c${regex[i++]}` };
      case 'u': { const h = regex.slice(i, i + 4); i += 4; return { kind: 'char', js: `\\u${h}` }; }
      case 'x': {
        let h: string;
        if (regex[i] === '{') { const close = regex.indexOf('}', i); h = regex.slice(i + 1, close); i = close + 1; } else { h = regex.slice(i, i + 2); i += 2; }
        return { kind: 'char', js: `\\u{${h}}` };
      }
      case '0': {
        const m = /^(?:[0-3][0-7]{2}|[0-7]{1,2})/.exec(regex.slice(i))!;
        i += m[0].length;
        return { kind: 'char', js: `\\u{${parseInt(m[0], 8).toString(16)}}` };
      }
    }
    if (!inClass) {
      switch (n) {
        case 'b': return { kind: 'other', js: `(?:(?<=${JS_WORD})(?!${JS_WORD})|(?<!${JS_WORD})(?=${JS_WORD}))` };
        case 'B': return { kind: 'other', js: `(?:(?<=${JS_WORD})(?=${JS_WORD})|(?<!${JS_WORD})(?!${JS_WORD}))` };
        case 'A': return { kind: 'other', js: '(?<![\\s\\S])' };
        case 'z': return { kind: 'other', js: '(?![\\s\\S])' };
        case 'Z': return { kind: 'other', js: `(?=(?:\\r\\n|[${JS_LINE_END}])?(?![\\s\\S]))` };
        case 'R': return { kind: 'other', js: `(?:\\r\\n|[${JS_LINE_END}\\x0B\\f])` };
        case 'k': { const close = regex.indexOf('>', i); const js = `\\k${regex.slice(i, close + 1)}`; i = close + 1; return { kind: 'other', js }; }
      }
      if (/[1-9]/.test(n)) {
        let js = `\\${n}`;
        while (/[0-9]/.test(regex[i] ?? '')) js += regex[i++];
        return { kind: 'other', js };
      }
    }
    if (/[a-zA-Z0-9]/.test(n)) return unsupported(`\\${n}`);
    i -= 1; // an escaped character: as it is
    return plain(inClass);
  };
  /** A character outside a class, with its case variants. */
  const literal = (a: Atom): string => {
    const v = st.ci && a.ch ? caseVariants(a.ch) : '';
    return v ? `[${a.js}${v}]` : a.js;
  };
  /** The class at regex[i] ('['), as an expression; i is moved past it. */
  const parseClass = (): string => {
    i++;
    let neg = false;
    if (regex[i] === '^') { neg = true; i++; }
    const operands: string[] = []; // of an intersection
    let content = '';
    const exprs: string[] = [];
    let simple = true;
    const finishOperand = () => {
      if (exprs.length) simple = false;
      const parts = [...(content || !exprs.length ? [`[${content}]`] : []), ...exprs];
      operands.push(parts.length === 1 ? parts[0]! : `(?:${parts.join('|')})`);
      content = '';
      exprs.length = 0;
    };
    let first = true;
    for (;;) {
      const c = regex[i];
      if (c === undefined) unsupported('Unclosed character class');
      if (c === ']' && !first) { i++; break; }
      first = false;
      if (c === '[') { exprs.push(parseClass()); continue; }
      if (c === '&' && regex[i + 1] === '&') { i += 2; finishOperand(); continue; }
      const atom = c === '\\' ? escape(true) : plain(true);
      if (atom.kind === 'char' && regex[i] === '-' && regex[i + 1] !== undefined && regex[i + 1] !== ']' && regex[i + 1] !== '[') {
        const save = i;
        i++;
        const hi = regex[i] === '\\' ? escape(true) : plain(true);
        if (hi.kind === 'char') {
          content += `${atom.js}-${hi.js}`;
          if (st.ci && atom.ch && hi.ch && /^[a-zA-Z]$/.test(atom.ch) && /^[a-zA-Z]$/.test(hi.ch) && (atom.ch <= 'Z') === (hi.ch <= 'Z')) content += `${swapCase(atom.ch)}-${swapCase(hi.ch)}`;
          continue;
        }
        i = save; // a literal '-'
      }
      if (atom.kind === 'char') content += atom.js + (st.ci && atom.ch ? caseVariants(atom.ch) : '');
      else if (atom.kind === 'content') content += atom.js;
      else if (atom.kind === 'expr') exprs.push(atom.js);
      else unsupported('This escape in a class');
    }
    const wasSimple = simple && operands.length === 0 && !exprs.length;
    if (wasSimple) return `[${neg ? '^' : ''}${content}]`;
    finishOperand();
    const e = operands.length === 1 ? operands[0]! : `(?:${operands.slice(0, -1).map((o) => `(?=${o})`).join('')}${operands[operands.length - 1]})`;
    return neg ? `(?:(?!${e})[\\s\\S])` : e;
  };
  const quantified = () => { if (regex[i] === '+') unsupported('Possessive quantifier'); };
  let out = '';
  while (i < regex.length) {
    const c = regex[i]!;
    switch (c) {
      case '\\': {
        const atom = escape(false);
        out += atom.kind === 'char' ? literal(atom) : atom.kind === 'content' ? `[${atom.js}]` : atom.js;
        break;
      }
      case '[': out += parseClass(); break;
      case '(': {
        stack.push({ ...st });
        if (regex[i + 1] !== '?') { out += '('; i++; break; }
        const m = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(regex.slice(i));
        if (m && (m[1] || m[2] !== undefined)) {
          const next = { ...st };
          const apply = (f: string, on: boolean) => {
            for (const ch of f) {
              if (ch === 'i') next.ci = on;
              else if (ch === 's') next.dotall = on;
              else if (ch === 'm') next.multiline = on;
              else if (ch === 'U') next.uc = on;
              else if (ch === 'x' && on) unsupported('Comments mode');
            }
          };
          apply(m[1]!, true);
          if (m[2] !== undefined) apply(m[2], false);
          i += m[0].length;
          if (m[3] === ':') out += '(?:';
          else stack.pop(); // (?i): for the rest of the enclosing group
          st = next;
          break;
        }
        if (regex[i + 2] === '>') unsupported('Atomic group');
        out += '(';
        i++;
        break;
      }
      case ')': st = stack.pop() ?? st; out += ')'; i++; break;
      case '.': out += st.dotall ? '[\\s\\S]' : `[^${JS_LINE_END}]`; i++; break;
      case '^': out += st.multiline ? `(?<![^${JS_LINE_END}])` : '(?<![\\s\\S])'; i++; break;
      case '$': out += st.multiline ? `(?=[${JS_LINE_END}]|(?![\\s\\S]))` : `(?=(?:\\r\\n|[${JS_LINE_END}])?(?![\\s\\S]))`; i++; break;
      case '|': out += '|'; i++; break;
      case '*': case '+': case '?':
        out += c;
        i++;
        if (regex[i] === '?') { out += '?'; i++; } else quantified();
        break;
      case '{': {
        const m = /^\{\d+(?:,\d*)?\}/.exec(regex.slice(i));
        if (m) {
          out += m[0];
          i += m[0].length;
          if (regex[i] === '?') { out += '?'; i++; } else quantified();
        } else { out += '\\{'; i++; }
        break;
      }
      default: out += literal(plain(false));
    }
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
    // Oniguruma refuses some patterns JavaScript takes (lookahead inside lookbehind).
    try {
      re = new RegExp(JavaToJavaScript(anchored ? `\\A(?:${src})\\z` : src, flags), 'gdu');
    } catch { /* below */ }
    if (!re) try {
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
  private m_aSticky: RegExp | null = null;

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

  /** @internal The find RegExp, sticky: a match at lastIndex only. */
  stickyRegExp(): RegExp {
    if (!this.m_aSticky) {
      const re = this.findRegExp();
      // oniguruma-to-es's EmulatedRegExp copies its options when constructed from an instance.
      const Ctor = re.constructor as RegExpConstructor;
      this.m_aSticky = new Ctor(re, `${re.flags.replace('g', '')}y`);
    }
    return this.m_aSticky;
  }

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
  // The region (Java's from/to): with opaque bounds (Java's default) the RegExp runs on the
  // region alone (m_sInput, at m_nOffset in the text), so lookaround, \b and ^ cannot see
  // past it; with transparent bounds it runs on the whole text. Anchoring bounds are always on.
  private m_nRegionStart = 0;
  private m_nRegionEnd: number;
  private m_bTransparentBounds = false;
  private m_sInput: string;
  private m_nOffset = 0;
  private m_nMatchOffset = 0;

  constructor(p: Pattern, text: string) {
    this.m_pPattern = p;
    this.m_sText = text;
    this.m_nRegionEnd = text.length;
    this.m_sInput = text;
  }

  pattern(): Pattern { return this.m_pPattern; }

  reset(input?: string): this {
    if (input !== undefined) this.m_sText = input;
    this.m_aMatch = null;
    this.m_nFrom = 0;
    this.m_nAppendPos = 0;
    this.m_nRegionStart = 0;
    this.m_nRegionEnd = this.m_sText.length;
    this.updateInput();
    return this;
  }

  /** Limits matching to [start, end) (and resets the matcher, as Java's does). */
  region(start: number, end: number): this {
    if (start < 0 || start > end || end > this.m_sText.length) throw new Error('IndexOutOfBoundsException: region');
    this.reset();
    this.m_nRegionStart = start;
    this.m_nRegionEnd = end;
    this.m_nFrom = start;
    this.updateInput();
    return this;
  }

  regionStart(): number { return this.m_nRegionStart; }
  regionEnd(): number { return this.m_nRegionEnd; }

  /**
   * Transparent bounds let lookaround and \b see the text outside the region. A match itself
   * must still end inside it: one that ends after the region's end is rejected here, where Java
   * would look for a shorter one (the ports only use transparent bounds on regions that end at
   * the end of the text). Also, ^ and \A match at the start of the text here; with Java's
   * anchoring bounds they match at the region's start only.
   */
  useTransparentBounds(b: boolean): this {
    this.m_bTransparentBounds = b;
    this.updateInput();
    return this;
  }

  hasTransparentBounds(): boolean { return this.m_bTransparentBounds; }

  private updateInput(): void {
    const whole = this.m_nRegionStart === 0 && this.m_nRegionEnd === this.m_sText.length;
    if (whole || this.m_bTransparentBounds) {
      this.m_sInput = this.m_sText;
      this.m_nOffset = 0;
    } else {
      this.m_sInput = this.m_sText.slice(this.m_nRegionStart, this.m_nRegionEnd);
      this.m_nOffset = this.m_nRegionStart;
    }
  }

  /** Runs a RegExp from text position `from` on the input; a match past the region's end is none. */
  private exec(re: RegExp, from: number): RegExpExecArray | null {
    re.lastIndex = from - this.m_nOffset;
    const m = re.exec(this.m_sInput);
    if (m && this.m_nOffset + m.index + m[0].length > this.m_nRegionEnd) return null;
    return m;
  }

  usePattern(p: Pattern): this { this.m_pPattern = p; this.m_aMatch = null; return this; }

  /** The whole input (region) matches. With transparent bounds, the region is matched as with opaque ones. */
  matches(): boolean {
    const re = this.m_pPattern.wholeRegExp();
    const input = this.m_bTransparentBounds ? this.m_sText.slice(this.m_nRegionStart, this.m_nRegionEnd) : this.m_sInput;
    re.lastIndex = 0;
    this.m_aMatch = re.exec(input);
    this.m_nMatchOffset = this.m_nRegionStart;
    return !!this.m_aMatch;
  }

  /** The input (region) starts with a match. */
  lookingAt(): boolean {
    this.m_aMatch = this.exec(this.m_pPattern.stickyRegExp(), this.m_nRegionStart);
    this.m_nMatchOffset = this.m_nOffset;
    return !!this.m_aMatch;
  }

  /** The next match (after the previous one), or the first one from `start`. */
  find(start?: number): boolean {
    if (start !== undefined) { this.reset(); this.m_nFrom = start; }
    if (this.m_nFrom > this.m_nRegionEnd) { this.m_aMatch = null; return false; }
    const m = this.exec(this.m_pPattern.findRegExp(), this.m_nFrom);
    this.m_aMatch = m;
    this.m_nMatchOffset = this.m_nOffset;
    if (!m) { this.m_nFrom = this.m_nRegionEnd + 1; return false; }
    // An empty match moves on by one, as Java's does.
    const index = this.m_nOffset + m.index;
    this.m_nFrom = m[0].length ? index + m[0].length : index + 1;
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
    if (group === 0) return this.m_nMatchOffset + m.index;
    const s = m.indices?.[group]?.[0];
    return s === undefined ? -1 : this.m_nMatchOffset + s;
  }

  end(group = 0): number {
    const m = this.ensure();
    if (group === 0) return this.m_nMatchOffset + m.index + m[0].length;
    const e = m.indices?.[group]?.[1];
    return e === undefined ? -1 : this.m_nMatchOffset + e;
  }

  hitEnd(): boolean { return this.m_aMatch ? this.end() === this.m_nRegionEnd : true; }

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
