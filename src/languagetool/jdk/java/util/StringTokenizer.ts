// SPDX-License-Identifier: MPL-2.0
// java.util.StringTokenizer for the LanguageTool ports: not a port, the JDK's API as they use it.
// Delimiters are single UTF-16 code units (no delimiter the ports use is a surrogate pair).

export class StringTokenizer {
  private currentPosition = 0;
  private readonly str: string;
  private readonly delimiters: string;
  private readonly retDelims: boolean;

  constructor(str: string, delim = ' \t\n\r\f', returnDelims = false) {
    this.str = str;
    this.delimiters = delim;
    this.retDelims = returnDelims;
  }

  private skipDelimiters(startPos: number): number {
    let position = startPos;
    while (!this.retDelims && position < this.str.length && this.delimiters.includes(this.str.charAt(position))) position++;
    return position;
  }

  private scanToken(startPos: number): number {
    let position = startPos;
    while (position < this.str.length && !this.delimiters.includes(this.str.charAt(position))) position++;
    if (this.retDelims && startPos === position && position < this.str.length) position++;
    return position;
  }

  hasMoreTokens(): boolean {
    return this.skipDelimiters(this.currentPosition) < this.str.length;
  }

  hasMoreElements(): boolean { return this.hasMoreTokens(); }

  nextToken(): string {
    this.currentPosition = this.skipDelimiters(this.currentPosition);
    if (this.currentPosition >= this.str.length) throw new Error('NoSuchElementException');
    const start = this.currentPosition;
    this.currentPosition = this.scanToken(this.currentPosition);
    return this.str.substring(start, this.currentPosition);
  }

  nextElement(): string { return this.nextToken(); }

  countTokens(): number {
    let count = 0;
    let currpos = this.currentPosition;
    while (currpos < this.str.length) {
      currpos = this.skipDelimiters(currpos);
      if (currpos >= this.str.length) break;
      currpos = this.scanToken(currpos);
      count++;
    }
    return count;
  }
}
