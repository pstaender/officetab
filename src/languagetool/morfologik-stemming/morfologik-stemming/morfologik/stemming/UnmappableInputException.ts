// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/UnmappableInputException.java faithful
import type { CharacterCodingException } from '../../../../jdk/java/nio/charset/Charset.ts';

/**
 * Thrown when some input cannot be mapped using the declared charset (bytes
 * to characters or the other way around).
 */
export class UnmappableInputException extends Error {
  constructor(message: string, cause: CharacterCodingException) {
    super(message, { cause });
  }
}
