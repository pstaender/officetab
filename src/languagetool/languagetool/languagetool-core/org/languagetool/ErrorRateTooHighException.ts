// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/ErrorRateTooHighException.java faithful

export class ErrorRateTooHighException extends Error {

  constructor(message: string) {
    super(message);
    this.name = 'ErrorRateTooHighException';
  }

}
