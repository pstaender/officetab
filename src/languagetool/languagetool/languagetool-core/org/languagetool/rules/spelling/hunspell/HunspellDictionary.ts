// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/hunspell/HunspellDictionary.java faithful
// Closeable's close() is part of the interface.

export interface HunspellDictionary {
  /**
   * Spellcheck the word
   * @param word the word to check
   * @return true if the word is spelled correctly
   */
  spell(word: string): boolean;

  /**
   * Add word to the run-time dictionary
   * @param word the word to add
   */
  add(word: string): void;

  /**
   * Search suggestions for the word
   * @param word the word to get suggestions for
   * @return the list of suggestions
   */
  suggest(word: string): string[];

  /**
   * Indicate resource is closed.
   * @return true when closed, otherwise false.
   */
  isClosed(): boolean;

  /** Closeable.close() */
  close(): void;
}
