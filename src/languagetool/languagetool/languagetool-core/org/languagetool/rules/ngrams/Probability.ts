// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/ngrams/Probability.java faithful
// The two constructors are one (occurrences defaults to -1).

/**
 * Probability, but doesn't check for a range of 0 to 1.
 * @since 3.2
 */
export class Probability {

  private readonly prob: number;
  private readonly coverage: number;
  private readonly occurrences: number;

  constructor(prob: number, coverage: number, occurrences = -1) {
    if (prob < 0.0) {
      throw new Error('RuntimeException: Probability must be >= 0: ' + prob);
    }
    //if (prob > 1.0) {
    //  throw new RuntimeException("Probability must be 0.0 to 1.0: " + prob);
    //}
    this.prob = prob;
    this.coverage = coverage;
    this.occurrences = occurrences;
  }

  /**
   * A probability-like value, but can be filled with any float &gt;= 0.
   */
  getProb(): number {
    return this.prob;
  }

  getLogProb(): number {
    return Math.log(this.prob);
  }

  /**
   * The fraction of lookups that had occurrence counts &gt; 0. This
   * might be used to ignore the whole probability for low coverage items.
   */
  getCoverage(): number {
    return this.coverage;
  }

  /**
   * The number the longest ngram occurs in the corpus. Maybe be -1 if not known.
   */
  getOccurrences(): number {
    return this.occurrences;
  }

  toString(): string {
    return this.prob + ', coverage=' + this.coverage;
  }
}
