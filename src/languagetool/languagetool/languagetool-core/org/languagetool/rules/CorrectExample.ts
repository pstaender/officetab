// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/CorrectExample.java faithful
import { ExampleSentence } from './ExampleSentence.ts';

/**
 * A text, typically a sentence, that doesn't contain an error,
 * at least not one for a specific rule.
 * @since 3.5
 */
export class CorrectExample extends ExampleSentence {

  constructor(example: string) {
    super(example);
  }

}
