// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/BeamSearch.java faithful
// The two bestSequences overloads are one method: a number before cg is minSequenceScore.
import { PriorityQueue } from '../../../../../jdk/java/util/PriorityQueue.ts';
import type { MaxentModel } from './model/MaxentModel.ts';
import type { SequenceClassificationModel } from './model/SequenceClassificationModel.ts';
import type { BeamSearchContextGenerator } from '../util/BeamSearchContextGenerator.ts';
import { Cache } from '../util/Cache.ts';
import { Sequence } from '../util/Sequence.ts';
import type { SequenceValidator } from '../util/SequenceValidator.ts';

/**
 * Performs k-best search over sequence.  This is based on the description in
 * Ratnaparkhi (1998), PhD diss, Univ. of Pennsylvania.
 *
 * @see Sequence
 * @see SequenceValidator
 * @see BeamSearchContextGenerator
 */
export class BeamSearch<T> implements SequenceClassificationModel<T> {
  static readonly BEAM_SIZE_PARAMETER = 'BeamSize';

  private static readonly EMPTY_ADDITIONAL_CONTEXT: unknown[] = [];

  protected size: number;
  protected model: MaxentModel;

  private probs: Float64Array;
  private contextsCache: Cache<string[], Float64Array> | null = null;
  private static readonly zeroLog = -100000;

  /**
   * Creates new search object.
   *
   * @param size The size of the beam (k).
   * @param model the model for assigning probabilities to the sequence outcomes.
   * @param cacheSize size of the cache (default 0, none)
   */
  constructor(size: number, model: MaxentModel, cacheSize = 0) {
    this.size = size;
    this.model = model;

    if (cacheSize > 0) {
      this.contextsCache = new Cache(cacheSize);
    }

    this.probs = new Float64Array(model.getNumOutcomes());
  }

  /**
   * Returns the best sequence of outcomes based on model for this object.
   *
   * @param numSequences The maximum number of sequences to be returned.
   * @param sequence The input sequence.
   * @param additionalContext An Object[] of additional context.
   *     This is passed to the context generator blindly with the assumption that the context are appropiate.
   * @param minSequenceScore A lower bound on the score of a returned sequence (optional, before cg).
   * @return An array of the top ranked sequences of outcomes.
   */
  bestSequences(numSequences: number, sequence: T[], additionalContext: unknown[] | null,
      minSequenceScoreOrCg: number | BeamSearchContextGenerator<T>,
      cgOrValidator: BeamSearchContextGenerator<T> | SequenceValidator<T>,
      validator?: SequenceValidator<T>): Sequence[] {
    let minSequenceScore: number;
    let cg: BeamSearchContextGenerator<T>;
    if (typeof minSequenceScoreOrCg === 'number') {
      minSequenceScore = minSequenceScoreOrCg;
      cg = cgOrValidator as BeamSearchContextGenerator<T>;
    } else {
      minSequenceScore = BeamSearch.zeroLog;
      cg = minSequenceScoreOrCg;
      validator = cgOrValidator as SequenceValidator<T>;
    }
    const validator_ = validator as SequenceValidator<T>;

    let prev = new PriorityQueue<Sequence>(this.size);
    let next = new PriorityQueue<Sequence>(this.size);
    let tmp: PriorityQueue<Sequence>;
    prev.add(new Sequence());

    if (additionalContext == null) {
      additionalContext = BeamSearch.EMPTY_ADDITIONAL_CONTEXT;
    }

    for (let i = 0; i < sequence.length; i++) {
      const sz = Math.min(this.size, prev.size());

      for (let sc = 0; prev.size() > 0 && sc < sz; sc++) {
        const top = prev.remove();
        const tmpOutcomes = top.getOutcomes();
        const outcomes = tmpOutcomes.slice();
        const contexts = cg.getContext(i, sequence, outcomes, additionalContext);
        let scores: Float64Array;
        if (this.contextsCache != null) {
          scores = this.contextsCache.computeIfAbsent(contexts, (c) => this.model.eval(c, this.probs));
        } else {
          scores = this.model.eval(contexts, this.probs);
        }

        const temp_scores = scores.slice();

        temp_scores.sort();

        const min = temp_scores[Math.max(0, scores.length - this.size)];

        for (let p = 0; p < scores.length; p++) {
          if (scores[p] >= min) {
            const out = this.model.getOutcome(p);
            if (validator_.validSequence(i, sequence, outcomes, out)) {
              const ns = new Sequence(top, out, scores[p]);
              if (ns.getScore() > minSequenceScore) {
                next.add(ns);
              }
            }
          }
        }

        if (next.size() === 0) { //if no advanced sequences, advance all valid
          for (let p = 0; p < scores.length; p++) {
            const out = this.model.getOutcome(p);
            if (validator_.validSequence(i, sequence, outcomes, out)) {
              const ns = new Sequence(top, out, scores[p]);
              if (ns.getScore() > minSequenceScore) {
                next.add(ns);
              }
            }
          }
        }
      }

      //    make prev = next; and re-init next (we reuse existing prev set once we clear it)
      prev.clear();
      tmp = prev;
      prev = next;
      next = tmp;
    }

    const numSeq = Math.min(numSequences, prev.size());
    const topSequences = new Array<Sequence>(numSeq);

    for (let seqIndex = 0; seqIndex < numSeq; seqIndex++) {
      topSequences[seqIndex] = prev.remove();
    }

    return topSequences;
  }

  /**
   * Returns the best sequence of outcomes based on model for this object.
   *
   * @return The top ranked sequence of outcomes or null if no sequence could be found
   */
  bestSequence(sequence: T[], additionalContext: unknown[] | null,
      cg: BeamSearchContextGenerator<T>, validator: SequenceValidator<T>): Sequence | null {
    const sequences = this.bestSequences(1, sequence, additionalContext, cg, validator);

    if (sequences.length > 0)
      return sequences[0];
    else
      return null;
  }

  getOutcomes(): string[] {
    const outcomes = new Array<string>(this.model.getNumOutcomes());

    for (let i = 0; i < this.model.getNumOutcomes(); i++) {
      outcomes[i] = this.model.getOutcome(i);
    }

    return outcomes;
  }
}
