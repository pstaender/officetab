// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/Chunker.java faithful
import type { Sequence } from '../util/Sequence.ts';
import type { Span } from '../util/Span.ts';

/**
 * The interface for chunkers which provide chunk tags for a sequence of tokens.
 */
export interface Chunker {
  /**
   * Generates chunk tags for the given sequence returning the result in an array.
   */
  chunk(toks: string[], tags: string[]): string[];

  /**
   * Generates tagged chunk spans for the given sequence returning the result in a span array.
   */
  chunkAsSpans(toks: string[], tags: string[]): Span[];

  /**
   * Returns the top k chunk sequences for the specified sentence with the specified pos-tags
   * (and, optionally, a minimum score).
   */
  topKSequences(sentence: string[], tags: string[], minSequenceScore?: number): Sequence[];
}
