// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/rules/DisambiguatedExample.java faithful
// The two constructors are one with optional input and output.

/**
 * Disambiguated example. Used for testing
 * disambiguator rules.
 * @author Marcin Milkowski
 * @since 0.9.8
 */
export class DisambiguatedExample {

  private readonly example: string;
  private readonly input: string | null;
  private readonly output: string | null;

  /**
   * @param example Example sentence
   * @param input Ambiguous forms of a token (specify in 'word[lemma/POS]' format)
   * @param output Disambiguated forms of a token (specify in 'word[lemma/POS]' format)
   */
  constructor(example: string, input: string | null = null, output: string | null = null) {
    this.example = example;
    this.input = input;
    this.output = output;
  }

  /**
   * Return the example that contains the error.
   */
  getExample(): string {
    return this.example;
  }

  getAmbiguous(): string | null {
    return this.input;
  }

  /**
   * Return the possible corrections. May be {@code null}.
   */
  getDisambiguated(): string | null {
    return this.output;
  }

  toString(): string {
    return this.example + ': ' + this.input + ' -> ' + this.output;
  }

}
