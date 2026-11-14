// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tokenizers/Tokenizer.java faithful

/**
 * Interface for classes that tokenize text into smaller units.
 *
 * @author Daniel Naber
 */
export interface Tokenizer {

  tokenize(text: string): string[];

}
