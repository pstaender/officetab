// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/InputTooLongException.java faithful
// An IllegalArgumentException: the message starts with "IllegalArgumentException: " as the
// ports' IllegalArgumentExceptions do (see jdk isIllegalArgumentException); catch it by instanceof.

/**
 * @since 4.2
 */
export class InputTooLongException extends Error {

  constructor(s: string) {
    super("IllegalArgumentException: " + s);
    this.name = "InputTooLongException";
  }

}
