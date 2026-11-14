// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/Example.java faithful
import { IncorrectExample } from './IncorrectExample.ts';
import { CorrectExample } from './CorrectExample.ts';

/**
 * Helper class to create error examples. For internal use by LanguageTool only.
 * @since 2.5
 */
export class Example {

  private constructor() {
  }

  /**
   * Create an example text (usually just one sentence) with an error - the error must be marked with {@code <marker>...</marker>}.
   * @throws IllegalArgumentException if the {@code <marker>...</marker>} is missing
   * @since 2.5
   */
  static wrong(example: string): IncorrectExample {
    Example.requireMarkup(example);
    return new IncorrectExample(example);
  }

  /**
   * Create an example text (usually just one sentence) without an error - the fixed error (compared to the text created
   * with {@link #wrong(String)}) can be marked with {@code <marker>...</marker>}.
   * @since 2.5, return type modified in 3.5
   */
  static fixed(example: string): CorrectExample {
    return new CorrectExample(example);
  }

  private static requireMarkup(example: string): void {
    if (!example.includes('<marker>') || !example.includes('</marker>')) {
      throw new Error("IllegalArgumentException: Example text must contain '<marker>...</marker>': " + example);
    }
  }

}
