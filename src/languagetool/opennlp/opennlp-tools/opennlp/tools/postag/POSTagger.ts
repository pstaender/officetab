// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/POSTagger.java faithful
import type { Sequence } from '../util/Sequence.ts';

/**
 * The interface for part of speech taggers.
 */
export interface POSTagger {
  /**
   * Assigns the sentence of tokens pos tags (with additional context, optionally).
   */
  tag(sentence: string[], additionaContext?: unknown[] | null): string[];

  topKSequences(sentence: string[], additionaContext?: unknown[] | null): Sequence[];
}
