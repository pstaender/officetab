// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/ExtendedSentenceRange.java faithful
// The two constructors are one (a language code or a map of rates); hashCode is left out.

export class ExtendedSentenceRange {

  private readonly fromPos: number;
  private readonly toPos: number;
  private readonly languageConfidenceRates: Map<string, number>; //languageCode;0-1 confidenceRate from LanguageDetectionService

  constructor(fromPos: number, toPos: number, languageConfidenceRates: string | Map<string, number>) {
    this.fromPos = fromPos;
    this.toPos = toPos;
    this.languageConfidenceRates = typeof languageConfidenceRates === 'string'
      ? new Map([[languageConfidenceRates, 1.0]])
      : new Map(languageConfidenceRates);
  }

  getFromPos(): number { return this.fromPos; }

  getToPos(): number { return this.toPos; }

  getLanguageConfidenceRates(): Map<string, number> { return this.languageConfidenceRates; }

  updateLanguageConfidenceRates(languageConfidenceRates: Map<string, number>): void {
    this.languageConfidenceRates.clear();
    for (const [k, v] of languageConfidenceRates) this.languageConfidenceRates.set(k, v);
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof ExtendedSentenceRange)) return false;
    const extendedSentenceRange = o;
    return this.fromPos === extendedSentenceRange.fromPos && this.toPos === extendedSentenceRange.toPos;
  }

  toString(): string {
    return this.fromPos + '-' + this.toPos + ':{' + [...this.languageConfidenceRates].map(([k, v]) => k + '=' + v).join(', ') + '}';
  }

  compareTo(o: ExtendedSentenceRange): number {
    return Math.sign(this.fromPos - o.fromPos);
  }
}
