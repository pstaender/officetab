// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/MatchPosition.java faithful
// hashCode is left out.

/**
 * @since 2.9
 */
export class MatchPosition {

  private readonly start: number;
  private readonly end: number;

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  getStart(): number {
    return this.start;
  }

  getEnd(): number {
    return this.end;
  }

  toString(): string {
    return this.start + '-' + this.end;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof MatchPosition) || o.constructor !== this.constructor) return false;
    const other = o;
    return this.start === other.start && this.end === other.end;
  }

}
