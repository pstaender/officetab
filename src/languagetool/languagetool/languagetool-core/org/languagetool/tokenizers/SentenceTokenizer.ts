// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tokenizers/SentenceTokenizer.java faithful
import type { Tokenizer } from './Tokenizer.ts';

/**
 * Tokenizes text into sentences.
 */
export interface SentenceTokenizer extends Tokenizer {

  /**
   * Tokenize the given string to sentences.
   */
  tokenize(text: string): string[];

  /**
   * @param lineBreakParagraphs if <code>true</code>, single line breaks are assumed to end a paragraph,
   *  with <code>false</code>, only two ore more consecutive line breaks end a paragraph
   */
  setSingleLineBreaksMarksParagraph(lineBreakParagraphs: boolean): void;

  singleLineBreaksMarksPara(): boolean;

}
