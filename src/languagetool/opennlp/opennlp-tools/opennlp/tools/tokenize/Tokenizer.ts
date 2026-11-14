// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/Tokenizer.java faithful
import type { Span } from '../util/Span.ts';

/**
 * The interface for tokenizers, which segment a string into its tokens.
 */
export interface Tokenizer {
  /** Splits a string into its atomic parts */
  tokenize(s: string): string[];

  /** Finds the boundaries of atomic parts in a string. */
  tokenizePos(s: string): Span[];
}
