// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/ErrorTriggeringExample.java faithful
import { ExampleSentence } from './ExampleSentence.ts';

/**
 * A text, typically a sentence, that doesn't contain an error,
 * but still leads to an error. In other words, this marks a known issue.
 * @since 3.5
 */
export class ErrorTriggeringExample extends ExampleSentence {

  constructor(example: string) {
    super(example);
  }

}
