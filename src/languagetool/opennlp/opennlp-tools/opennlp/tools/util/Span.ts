// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/Span.java partial
// Left out: trim, compareTo, hashCode, equals.

/** Class for storing start and end integer offsets. */
export class Span {
  private readonly start: number;
  private readonly end: number;
  private readonly prob: number; //default is 0
  private readonly type: string | null;

  /**
   * Initializes a new Span: (s, e), (s, e, type), (s, e, prob), (s, e, type, prob),
   * (span, offset) or (span, prob) are Java's overloads; the last two are fromSpan here.
   */
  constructor(s: number, e: number, typeOrProb?: string | number | null, prob = 0) {
    let type: string | null = null;
    if (typeof typeOrProb === 'number') prob = typeOrProb;
    else if (typeOrProb != null) type = typeOrProb;

    if (s < 0) {
      throw new RangeError('start index must be zero or greater: ' + s);
    }
    if (e < 0) {
      throw new RangeError('end index must be zero or greater: ' + e);
    }
    if (s > e) {
      throw new RangeError('start index must not be larger than end index: '
              + 'start=' + s + ', end=' + e);
    }

    this.start = s;
    this.end = e;
    this.prob = prob;
    this.type = type;
  }

  getStart(): number {
    return this.start;
  }

  getEnd(): number {
    return this.end;
  }

  getType(): string | null {
    return this.type;
  }

  length(): number {
    return this.end - this.start;
  }

  /** Returns true if the specified span (or index) is contained by this span. */
  contains(s: Span | number): boolean {
    if (typeof s === 'number') return this.start <= s && s < this.end;
    return this.start <= s.getStart() && s.getEnd() <= this.end;
  }

  startsWith(s: Span): boolean {
    return this.getStart() === s.getStart() && this.contains(s);
  }

  intersects(s: Span): boolean {
    const sstart = s.getStart();
    //either s's start is in this or this' start is in s
    return this.contains(s) || s.contains(this)
            || this.getStart() <= sstart && sstart < this.getEnd()
            || sstart <= this.getStart() && this.getStart() < s.getEnd();
  }

  crosses(s: Span): boolean {
    const sstart = s.getStart();
    //either s's start is in this or this' start is in s
    return !this.contains(s) && !s.contains(this)
            && (this.getStart() <= sstart && sstart < this.getEnd()
            || sstart <= this.getStart() && this.getStart() < s.getEnd());
  }

  getCoveredText(text: string): string {
    if (this.getEnd() > text.length) {
      throw new RangeError('The span ' + this
              + ' is outside the given text which has length ' + text.length + '!');
    }

    return text.substring(this.getStart(), this.getEnd());
  }

  toString(): string {
    let toStringBuffer = '';
    toStringBuffer += '[';
    toStringBuffer += this.getStart();
    toStringBuffer += '..';
    toStringBuffer += this.getEnd();
    toStringBuffer += ')';
    if (this.getType() != null) {
      toStringBuffer += ' ';
      toStringBuffer += this.getType();
    }

    return toStringBuffer;
  }

  /**
   * Converts an array of Spans to an array of Strings: with a text, the covered texts; with
   * tokens, the tokens each span covers joined by spaces.
   */
  static spansToStrings(spans: Span[], s: string | string[]): string[] {
    if (typeof s === 'string') {
      const tokens = new Array<string>(spans.length);

      for (let si = 0, sl = spans.length; si < sl; si++) {
        tokens[si] = spans[si].getCoveredText(s);
      }

      return tokens;
    }
    const chunks = new Array<string>(spans.length);
    for (let si = 0, sl = spans.length; si < sl; si++) {
      let cb = '';
      for (let ti = spans[si].getStart(); ti < spans[si].getEnd(); ti++) {
        cb += s[ti] + ' ';
      }
      chunks[si] = cb.substring(0, cb.length - 1);
    }
    return chunks;
  }

  getProb(): number {
    return this.prob;
  }
}
