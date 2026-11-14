// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/StringList.java faithful
// Strings need no intern() in JavaScript; hashCode is left out (Dictionary hashes toString()).

/** The StringList is an immutable list of Strings. */
export class StringList implements Iterable<string> {
  private tokens: string[];

  /** Initializes the current instance with one token or several. */
  constructor(...tokens: string[]) {
    if (tokens == null) throw new TypeError('tokens must not be null');

    if (tokens.length === 0) {
      throw new RangeError('tokens must not be empty');
    }

    this.tokens = tokens.slice();
  }

  getToken(index: number): string {
    return this.tokens[index];
  }

  size(): number {
    return this.tokens.length;
  }

  [Symbol.iterator](): Iterator<string> {
    return this.tokens[Symbol.iterator]();
  }

  /** Compares to tokens list and ignores the case of the tokens (String.compareToIgnoreCase). */
  compareToIgnoreCase(tokens: StringList): boolean {
    if (this.size() === tokens.size()) {
      for (let i = 0; i < this.size(); i++) {
        const a = this.getToken(i), b = tokens.getToken(i);
        if (a.length !== b.length) return false;
        for (let k = 0; k < a.length; k++) {
          const x = a[k], y = b[k];
          if (x !== y && x.toUpperCase() !== y.toUpperCase() && x.toLowerCase() !== y.toLowerCase()) return false;
        }
      }
    }
    else {
      return false;
    }

    return true;
  }

  equals(obj: unknown): boolean {
    if (this === obj) {
      return true;
    }

    if (obj instanceof StringList) {
      const tokenList = obj;
      if (this.tokens.length !== tokenList.tokens.length) return false;
      return this.tokens.every((t, i) => t === tokenList.tokens[i]);
    }

    return false;
  }

  toString(): string {
    let string = '';

    string += '[';

    for (let i = 0; i < this.size(); i++) {
      string += this.getToken(i);

      if (i < this.size() - 1) {
        string += ',';
      }
    }

    string += ']';

    return string;
  }
}
