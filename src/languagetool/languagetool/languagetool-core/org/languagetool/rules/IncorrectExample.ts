// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/IncorrectExample.java faithful
import { ExampleSentence } from './ExampleSentence.ts';

/**
 * A text, typically a sentence, that contains an error.
 * @since 0.9.2
 */
export class IncorrectExample extends ExampleSentence {

  private readonly corrections: string | string[] | null;

  /**
   * @since 2.9 (corrections)
   */
  constructor(example: string, corrections: readonly string[] = []) {
    super(example);
    this.corrections = corrections.length === 0 ? null :
                       corrections.length === 1 ? corrections[0]! :
                       [...corrections];
  }

  /**
   * Return the possible corrections.
   */
  getCorrections(): string[] {
    return this.corrections == null ? [] :
           typeof this.corrections === 'string' ? [this.corrections] :
           [...this.corrections];
  }

  override toString(): string {
    return this.example + ' [' + this.getCorrections().join(', ') + ']';
  }

}
