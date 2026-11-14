// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/Substrings.java faithful
// The private constructor with minLength is an optional parameter.
import { Character } from '../../../../../../jdk/java/lang/Character.ts';
import { StringRegionMatches } from '../../../../../../jdk/java/lang/String.ts';

/**
 * A list of strings that are expected to occur in a larger string in the given order,
 * with optional requirements for them to start/end the text.
 * This class is used to avoid more expensive regular expression matching where possible.
 */
export class Substrings {
  readonly substrings: string[];
  private readonly minLength: number;

  /** Whether the first of {@link #substrings} must occur at the matched fragment start */
  readonly mustStart: boolean;

  /** Whether the last of {@link #substrings} must occur at the matched fragment end */
  readonly mustEnd: boolean;

  constructor(mustStart: boolean, mustEnd: boolean, substrings: string[], minLength?: number) {
    this.substrings = substrings;
    this.mustStart = mustStart;
    this.mustEnd = mustEnd;
    this.minLength = minLength ?? substrings.reduce((sum, s) => sum + s.length, 0);
  }

  /**
   * @return a version of this {@code Substrings} object
   * whose {@link #matches} could completely replace the given regexp,
   * or {@code null} if that's not feasible.
   */
  checkCanReplaceRegex(regexp: string): Substrings | null {
    if (this.mustStart || this.mustEnd) {
      const prefix = this.mustStart ? this.substrings[0]! : '';
      const suffix = this.mustEnd ? this.substrings[this.substrings.length - 1]! : '';
      if (regexp.startsWith(prefix) &&
          regexp.endsWith(suffix) &&
          regexp.length === prefix.length + suffix.length + 2 &&
          regexp.charAt(prefix.length) === '.') {
        switch (regexp.charAt(prefix.length + 1)) {
          case '*': return this;
          case '+': return new Substrings(this.mustStart, this.mustEnd, this.substrings, this.minLength + 1);
        }
      }
    }
    if (regexp === (this.mustStart ? '' : '.*') + this.substrings.join('.*') + (this.mustEnd ? '' : '.*')) {
      return this;
    }
    return null;
  }

  toString(): string {
    return (this.mustStart ? '[' : '(') + this.substrings.join(', ') + (this.mustEnd ? ']' : ')');
  }

  concat(another: Substrings): Substrings {
    let substrings: string[];
    if (another.substrings.length === 0) {
      substrings = this.substrings;
    } else if (this.substrings.length === 0) {
      substrings = another.substrings;
    } else if (this.mustEnd && another.mustStart) {
      substrings = [
        ...this.substrings.slice(0, this.substrings.length - 1),
        this.substrings[this.substrings.length - 1]! + another.substrings[0]!,
        ...another.substrings.slice(1),
      ];
    } else {
      substrings = [...this.substrings, ...another.substrings];
    }
    return new Substrings(this.mustStart, another.mustEnd, substrings);
  }

  /**
   * Check whether {@code text} contains all required substrings and returns the index of the first of them,
   * or -1 if the text doesn't contain these substrings.
   */
  find(text: string, caseSensitive: boolean): number {
    if (text.length < this.minLength) {
      return -1;
    }

    const start = Substrings.indexOf(text, this.substrings[0]!, caseSensitive, 0);
    if (start < 0) {
      return -1;
    }

    if (this.substrings.length > 1 && !this.containsSubstrings(text, caseSensitive, start + this.substrings[0]!.length, 1)) {
      return -1;
    }
    return start;
  }

  /**
   * @return whether the given text contains all the required substrings
   */
  matches(text: string, caseSensitive: boolean): boolean {
    if (text.length < this.minLength) {
      return false;
    }
    if (this.mustStart && !StringRegionMatches(text, !caseSensitive, 0, this.substrings[0]!, 0, this.substrings[0]!.length)) {
      return false;
    }
    if (this.mustEnd) {
      const last = this.substrings[this.substrings.length - 1]!;
      if (!StringRegionMatches(text, !caseSensitive, text.length - last.length, last, 0, last.length)) {
        return false;
      }
    }

    if (this.substrings.length === 1 && (this.mustStart || this.mustEnd)) {
      return true;
    }
    return this.containsSubstrings(text, caseSensitive, this.mustStart ? this.substrings[0]!.length : 0, this.mustStart ? 1 : 0);
  }

  private containsSubstrings(text: string, caseSensitive: boolean, textPos: number, firstSubstringIndex: number): boolean {
    for (let i = firstSubstringIndex; i < this.substrings.length; i++) {
      textPos = Substrings.indexOf(text, this.substrings[i]!, caseSensitive, textPos);
      if (textPos < 0) {
        return false;
      }
      textPos += this.substrings[i]!.length;
    }
    return true;
  }

  private static indexOf(text: string, substring: string, caseSensitive: boolean, from: number): number {
    return caseSensitive ? text.indexOf(substring, from) : Substrings.indexOfIgnoreCase(text, substring, from);
  }

  // a bit more optimized than Apache StringUtil.indexOfIgnoreCase
  private static indexOfIgnoreCase(text: string, substring: string, from: number): number {
    const first = substring.charAt(0);
    const up = Character.toUpperCase(first);
    const low = Character.toLowerCase(first);
    const cased = up !== first || low !== first;
    while (true) {
      from = cased ? Substrings.findNext(text, from, up, low) : text.indexOf(first, from);
      if (from < 0) {
        return -1;
      }

      if (StringRegionMatches(text, true, from, substring, 0, substring.length)) {
        return from;
      }
      from++;
    }
  }

  private static findNext(text: string, from: number, up: string, low: string): number {
    for (let i = from; i < text.length; i++) {
      const c = text.charAt(i);
      if (c === up || c === low || Character.toUpperCase(c) === up || Character.toLowerCase(c) === low) {
        return i;
      }
    }
    return -1;
  }
}
