// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/xx/DemoDisambiguator.java faithful
import type { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import { AbstractDisambiguator } from '../AbstractDisambiguator.ts';

/**
 * Trivial disambiguator.
 * Does nothing at all. Just copies input to output.
 */
export class DemoDisambiguator extends AbstractDisambiguator {

  override disambiguate(input: AnalyzedSentence): AnalyzedSentence {
    return input;
  }

}
