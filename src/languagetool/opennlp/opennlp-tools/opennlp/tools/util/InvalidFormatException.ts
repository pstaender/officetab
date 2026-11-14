// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/InvalidFormatException.java faithful

/**
 * This exception indicates that a resource violates the expected data format.
 */
export class InvalidFormatException extends Error {
  constructor(message?: string, t?: unknown) {
    super(message, t === undefined ? undefined : { cause: t });
  }
}
