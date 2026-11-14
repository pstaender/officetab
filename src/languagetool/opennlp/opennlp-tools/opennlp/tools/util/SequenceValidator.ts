// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/SequenceValidator.java faithful

export interface SequenceValidator<T> {
  /**
   * Determines whether a particular continuation of a sequence is valid.
   * This is used to restrict invalid sequences such as those used in start/continue tag-based chunking
   * or could be used to implement tag dictionary restrictions.
   */
  validSequence(i: number, inputSequence: T[], outcomesSequence: string[], outcome: string): boolean;
}
