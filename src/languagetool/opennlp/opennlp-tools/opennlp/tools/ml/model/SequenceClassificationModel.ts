// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/SequenceClassificationModel.java faithful
import type { Sequence } from '../../util/Sequence.ts';
import type { BeamSearchContextGenerator } from '../../util/BeamSearchContextGenerator.ts';
import type { SequenceValidator } from '../../util/SequenceValidator.ts';

/**
 * A classification model that can label an input sequence.
 */
export interface SequenceClassificationModel<T> {
  /** Finds the sequence with the highest probability. */
  bestSequence(sequence: T[], additionalContext: unknown[] | null,
      cg: BeamSearchContextGenerator<T>, validator: SequenceValidator<T>): Sequence | null;

  /**
   * Finds the n most probable sequences (with or without a minSequenceScore: the two Java
   * overloads; pass the score as a number before cg).
   */
  bestSequences(numSequences: number, sequence: T[], additionalContext: unknown[] | null,
      minSequenceScoreOrCg: number | BeamSearchContextGenerator<T>,
      cgOrValidator: BeamSearchContextGenerator<T> | SequenceValidator<T>,
      validator?: SequenceValidator<T>): Sequence[];

  /** Returns all possible outcomes. */
  getOutcomes(): string[];
}
