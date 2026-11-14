// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/DefaultChunkerSequenceValidator.java faithful
import type { SequenceValidator } from '../util/SequenceValidator.ts';
import type { TokenTag } from '../util/TokenTag.ts';

export class DefaultChunkerSequenceValidator implements SequenceValidator<TokenTag> {
  /** validOutcome(String outcome, String prevOutcome) and validOutcome(String outcome, String[] sequence) */
  protected validOutcome(outcome: string, prevOutcomeOrSequence: string | string[] | null): boolean {
    if (Array.isArray(prevOutcomeOrSequence)) {
      const sequence = prevOutcomeOrSequence;
      let prevOutcome: string | null = null;
      if (sequence.length > 0) {
        prevOutcome = sequence[sequence.length - 1];
      }
      return this.validOutcome(outcome, prevOutcome);
    }
    const prevOutcome = prevOutcomeOrSequence;
    if (outcome.startsWith('I-')) {
      if (prevOutcome == null) {
        return false;
      }
      else {
        if (prevOutcome === 'O') {
          return false;
        }
        return prevOutcome.substring(2) === outcome.substring(2);
      }
    }
    return true;
  }

  validSequence(i: number, sequence: TokenTag[], s: string[], outcome: string): boolean {
    return this.validOutcome(outcome, s);
  }
}
