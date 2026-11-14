// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/Range.java faithful
// hashCode is left out.
import { Objects_requireNonNull } from '../../../../jdk/java/util/Objects.ts';

/**
 * A range in a text with its (potential/guessed) language.
 * @since 5.3
 */
export class Range {

  private readonly fromPos: number;
  private readonly toPos: number;
  private readonly lang: string;

  constructor(fromPos: number, toPos: number, lang: string) {
    this.fromPos = fromPos;
    this.toPos = toPos;
    this.lang = Objects_requireNonNull(lang);
  }

  getFromPos(): number {
    return this.fromPos;
  }

  getToPos(): number {
    return this.toPos;
  }

  getLang(): string {
    return this.lang;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof Range) || o.constructor !== this.constructor) return false;
    const range = o;
    return this.fromPos === range.fromPos && this.toPos === range.toPos && this.lang === range.lang;
  }
}
