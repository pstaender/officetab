// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/StringMatcher.java faithful
// The anonymous subclasses are local classes; Java's streams in getPossibleRegexpValues are arrays
// (evaluated eagerly, which gives the same result: an unknown part throws in both). String
// interning and InterruptibleCharSequence are left out.
import { Character } from '../../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase, String_CASE_INSENSITIVE_ORDER } from '../../../../../../jdk/java/lang/String.ts';
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { Substrings } from './Substrings.ts';

/**
 * An object encapsulating a text pattern and the way it's matched (case-sensitivity / regular expression),
 * plus some optimizations over standard regular expression matching.
 * @since 5.3
 */
export abstract class StringMatcher {

  readonly pattern: string;
  readonly caseSensitive: boolean;
  readonly isRegExp: boolean;

  static readonly MAX_MATCH_LENGTH = 250;

  protected constructor(pattern: string, isRegExp: boolean, caseSensitive: boolean) {
    this.pattern = pattern;
    this.caseSensitive = caseSensitive;
    this.isRegExp = isRegExp;
  }

  /**
   * @return all values that this matcher can possibly accept (e.g. extracted from regexps like "foo|bar"),
   * or {@code null} if it's not possible to determine those.
   */
  abstract getPossibleValues(): Set<string> | null;

  /**
   * @return whether the given string is accepted by this matcher.
   */
  abstract matches(s: string): boolean;

  /**
   * Create a case-sensitive regexp matcher.
   * @since 5.6
   */
  static regexp(pattern: string): StringMatcher {
    return StringMatcher.create(pattern, true, true);
  }

  static create(pattern: string, isRegExp: boolean, caseSensitive: boolean): StringMatcher {
    if (!isRegExp || '\\0' === pattern) {
      return StringMatcher.stringEquals(pattern, isRegExp, caseSensitive);
    }

    // always compile the pattern to check it's well-formed
    const compiled = Pattern.compile(pattern, caseSensitive ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    const possibleRegexpValues = StringMatcher.getPossibleRegexpValues(pattern);
    if (possibleRegexpValues != null) {
      const set = new Set(possibleRegexpValues);
      if (set.size === 1) {
        return StringMatcher.stringEquals(set.values().next().value!, true, caseSensitive);
      }
      if (!caseSensitive) {
        const sorted = [...set].sort(String_CASE_INSENSITIVE_ORDER);
        return new class extends StringMatcher {
          getPossibleValues(): Set<string> {
            return new Set(sorted);
          }

          matches(s: string): boolean {
            if (s.length > StringMatcher.MAX_MATCH_LENGTH) {
              return false;
            }
            return binarySearch(sorted, s, String_CASE_INSENSITIVE_ORDER) >= 0;
          }
        }(pattern, true, false);
      }
      return new class extends StringMatcher {
        getPossibleValues(): Set<string> {
          return set;
        }

        matches(s: string): boolean {
          if (s.length > StringMatcher.MAX_MATCH_LENGTH) {
            return false;
          }
          return set.has(s);
        }
      }(pattern, true, true);
    }

    const required = StringMatcher.getRequiredSubstrings(pattern);
    const exhaustive = required == null ? null : required.checkCanReplaceRegex(pattern);
    const substringsAreSufficient = exhaustive != null;
    const substrings = substringsAreSufficient ? exhaustive : required;

    return new class extends StringMatcher {
      getPossibleValues(): Set<string> | null {
        return null;
      }

      matches(s: string): boolean {
        if (s.length > StringMatcher.MAX_MATCH_LENGTH) {
          return false;
        }
        if (substrings != null && !substrings.matches(s, caseSensitive)) return false;
        if (substringsAreSufficient) return true;
        return compiled.matcher(s).matches();
      }
    }(pattern, true, caseSensitive);
  }

  private static stringEquals(pattern: string, isRegExp: boolean, caseSensitive: boolean): StringMatcher {
    return new class extends StringMatcher {
      getPossibleValues(): Set<string> {
        return new Set([pattern]);
      }

      matches(s: string): boolean {
        if (s.length > StringMatcher.MAX_MATCH_LENGTH) {
          return false;
        }
        return caseSensitive ? s === pattern : StringEqualsIgnoreCase(s, pattern);
      }
    }(pattern, isRegExp, caseSensitive);
  }

  /**
   * @return the substrings that any text would necessarily contain or start/end with if it matches the given regexp,
   * or {@code null} if no such substrings can be found
   */
  static getRequiredSubstrings(regexp: string): Substrings | null {
    const UNKNOWN = new Substrings(false, false, []);

    const parser = new class extends RegexpParser<Substrings> {
      handleConcatenation(left: Substrings, right: Substrings): Substrings {
        return left.concat(right);
      }

      handleOr(_components: Substrings[]): Substrings {
        return UNKNOWN;
      }

      protected optional(_groupResults: Substrings, _op: string): Substrings {
        return UNKNOWN;
      }

      protected unknown(): Substrings {
        return UNKNOWN;
      }

      protected literal(literal: string): Substrings {
        return new Substrings(true, true, [literal]);
      }
    }(regexp);
    try {
      const result = parser.disjunction();
      return result.substrings.length === 0 ? null : result;
    } catch (e) {
      if (e === TooComplexRegexp) return null;
      throw e;
    }
  }

  /**
   * @return all strings that the given regexp can ever match, or {@code null} if such set couldn't be enumerated
   */
  static getPossibleRegexpValues(regexp: string): Set<string> | null {
    const parser = new class extends RegexpParser<string[]> {
      handleConcatenation(left: string[], right: string[]): string[] {
        const groupResults = right;
        return left.flatMap((s1) => groupResults.map((s2) => s1 + s2));
      }

      handleOr(components: string[][]): string[] {
        return components.flat();
      }

      protected optional(groupResults: string[], op: string): string[] {
        return op === '?' ? ['', ...groupResults] : this.unknown();
      }

      protected unknown(): string[] {
        throw TooComplexRegexp;
      }

      protected literal(literal: string): string[] {
        return [literal];
      }
    }(regexp);
    try {
      return new Set(parser.disjunction());
    } catch (e) {
      if (e === TooComplexRegexp) return null;
      throw e;
    }
  }
}

/** Arrays.binarySearch with a comparator. */
function binarySearch(a: string[], key: string, c: (x: string, y: string) => number): number {
  let low = 0, high = a.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const cmp = c(a[mid]!, key);
    if (cmp < 0) low = mid + 1;
    else if (cmp > 0) high = mid - 1;
    else return mid;
  }
  return -(low + 1);
}

/** private static class TooComplexRegexp extends RuntimeException: its INSTANCE. */
const TooComplexRegexp = { TooComplexRegexp: true } as const;

abstract class RegexpParser<T> {
  private static readonly unsupported = '?$^{}*+';
  private static readonly finishing = ')|';
  private static readonly starting = '([\\';
  private static readonly nonLiteral = RegexpParser.finishing + RegexpParser.unsupported + RegexpParser.starting + '.';

  private readonly regexp: string;
  private pos = 0;

  constructor(regexp: string) {
    if (regexp.startsWith('\\b')) {
      regexp = regexp.substring(2);
    }
    if (regexp.startsWith('^')) {
      regexp = regexp.substring(1);
    }
    if (regexp.endsWith('\\b') && !regexp.endsWith('\\\\b')) {
      regexp = regexp.substring(0, regexp.length - 2);
    }
    if (regexp.endsWith('$') && !regexp.endsWith('\\$')) {
      regexp = regexp.substring(0, regexp.length - 1);
    }
    this.regexp = regexp;
  }

  /** String.charAt, which throws outside the string as Java's does. */
  private charAt(i: number): string {
    if (i < 0 || i >= this.regexp.length) throw new Error(`StringIndexOutOfBoundsException: index ${i}, length ${this.regexp.length}`);
    return this.regexp.charAt(i);
  }

  disjunction(): T {
    const components: T[] = [];
    components.push(this.concatenation());
    while (true) {
      if (this.pos >= this.regexp.length || this.charAt(this.pos) !== '|') {
        return components.length === 1 ? components[0]! : this.handleOr(components);
      }
      this.pos++;
      components.push(this.concatenation());
    }
  }

  abstract handleOr(components: T[]): T;

  abstract handleConcatenation(left: T, right: T): T;

  protected abstract optional(groupResults: T, op: string): T;

  protected abstract literal(literal: string): T;

  protected abstract unknown(): T;

  private concatenation(): T {
    let result = this.postfix();

    while (this.pos < this.regexp.length) {
      const c = this.charAt(this.pos);
      if (RegexpParser.finishing.indexOf(c) >= 0) break;
      if (RegexpParser.unsupported.indexOf(c) >= 0) throw TooComplexRegexp;

      result = this.handleConcatenation(result, this.postfix());
    }
    return result;
  }

  private postfix(): T {
    let groupResults = this.atom();
    if (this.pos < this.regexp.length) {
      let next = this.charAt(this.pos);
      if (next === '{') {
        const closing = this.regexp.indexOf('}', this.pos + 1);
        if (closing < 0) throw new Error('AssertionError: Closing } expected after ' + this.pos);
        this.pos = closing + 1;
        groupResults = this.unknown();
        if (this.pos >= this.regexp.length) {
          return groupResults;
        }
        next = this.charAt(this.pos);
      }
      if ('*+?'.indexOf(next) >= 0) {
        this.pos++;
        return this.optional(groupResults, next);
      }
    }
    return groupResults;
  }

  private atom(): T {
    if (this.pos >= this.regexp.length) return this.literal('');

    switch (this.charAt(this.pos)) {
      case '(': {
        if (this.charAt(++this.pos) === '?') {
          if (this.charAt(++this.pos) !== ':') {
            throw TooComplexRegexp;
          }
          this.pos++;
        }
        const group = this.disjunction();
        if (this.charAt(this.pos++) !== ')') throw TooComplexRegexp;
        return group;
      }
      case '[':
        return this.squareBracketGroup();
      case '\\':
        this.pos++;
        return this.charLiteral(this.escape());
      case '.':
        this.pos++;
        return this.unknown();
      default: {
        const literalStart = this.pos;
        while (this.pos < this.regexp.length && RegexpParser.nonLiteral.indexOf(this.charAt(this.pos)) < 0) this.pos++;
        if (literalStart + 1 < this.pos && this.pos < this.regexp.length && this.charAt(this.pos) === '?') this.pos--;
        return this.literal(this.regexp.substring(literalStart, this.pos));
      }
    }
  }

  private squareBracketGroup(): T {
    const start = ++this.pos;
    let options: (string | null)[] | null = [];
    while (true) {
      const c1 = this.charAt(this.pos++);
      if (c1 === ']') break;

      if (c1 === '-' && this.pos !== start + 1 && this.charAt(this.pos) !== ']') {
        const last: string | null = options == null ? null : options[options.length - 1]!;
        const next = this.charAt(this.pos++);
        if (last == null || next === '\\' || next.charCodeAt(0) - last.charCodeAt(0) > 10) {
          options = null;
        }
        if (options != null) {
          for (let c = last!.charCodeAt(0) + 1; c <= next.charCodeAt(0); c++) {
            options.push(String.fromCharCode(c));
          }
        }
      } else if (c1 === '^') {
        options = null;
      } else if (c1 === '[') {
        throw TooComplexRegexp;
      } else {
        const simpleChar = c1 === '\\' ? this.escape() : c1;
        if (options != null) {
          options.push(simpleChar);
        }
      }
    }
    if (options == null) return this.unknown();
    const components = options.map((c) => this.charLiteral(c));
    if (components.length === 0) throw TooComplexRegexp;
    return components.length === 1 ? components[0]! : this.handleOr(components);
  }

  private charLiteral(c: string | null): T {
    return c == null ? this.unknown() : this.literal(c);
  }

  private escape(): string | null {
    const next = this.charAt(this.pos++);
    if ('0xucpP'.indexOf(next) >= 0) throw TooComplexRegexp;
    if (Character.isLetterOrDigit(next)) return null;
    return next;
  }

}
