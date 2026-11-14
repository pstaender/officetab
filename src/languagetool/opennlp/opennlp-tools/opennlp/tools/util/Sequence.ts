// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/Sequence.java partial
// Left out: hashCode and equals.

/** Represents a weighted sequence of outcomes. */
export class Sequence {
  private score: number;
  private outcomes: string[];
  private probs: number[];
  private static readonly ONE = 1.0;

  /**
   * Creates a new sequence; with s, a copy of it; with s, outcome and p, a copy of s extended
   * by outcome with probability p; with a list of outcomes, a sequence of them with probability 1.
   */
  constructor(s?: Sequence | string[], outcome?: string, p?: number) {
    if (s === undefined) {
      this.outcomes = [];
      this.probs = [];
      this.score = 0;
    } else if (Array.isArray(s)) {
      this.outcomes = s;
      this.probs = s.map(() => Sequence.ONE);
      this.score = 0;
    } else if (outcome === undefined) {
      this.outcomes = s.outcomes.slice();
      this.probs = s.probs.slice();
      this.score = s.score;
    } else {
      this.outcomes = s.outcomes.slice();
      this.outcomes.push(outcome);
      this.probs = s.probs.slice();
      this.probs.push(p as number);
      this.score = s.score + Math.log(p as number);
    }
  }

  compareTo(s: Sequence): number {
    // Double.compare(s.score, score)
    return s.score < this.score ? -1 : s.score > this.score ? 1 : 0;
  }

  /**
   * Adds an outcome and probability to this sequence.
   * @param outcome the outcome to be added.
   * @param p the probability associated with this outcome.
   */
  add(outcome: string, p: number): void {
    this.outcomes.push(outcome);
    this.probs.push(p);
    this.score += Math.log(p);
  }

  /** Returns a list of outcomes for this sequence. */
  getOutcomes(): string[] {
    return this.outcomes;
  }

  /**
   * Returns an array of probabilities associated with the outcomes of this sequence; with ps,
   * populates it with them instead.
   */
  getProbs(): number[];
  getProbs(ps: number[] | Float64Array): void;
  getProbs(ps?: number[] | Float64Array): number[] | void {
    if (ps === undefined) {
      const out = new Array<number>(this.probs.length);
      this.getProbs(out);
      return out;
    }
    for (let pi = 0, pl = this.probs.length; pi < pl; pi++) {
      ps[pi] = this.probs[pi];
    }
  }

  /** Returns the score of this sequence. */
  getScore(): number {
    return this.score;
  }

  toString(): string {
    return this.score + ' [' + this.outcomes.join(', ') + ']';
  }
}
