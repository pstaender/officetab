// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/WordCoherencyRule.java faithful
// The static word map (/en/coherency.txt) is loaded on first use.
import { AbstractWordCoherencyRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractWordCoherencyRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WordCoherencyDataLoader } from '../../../../../../languagetool-core/org/languagetool/rules/WordCoherencyDataLoader.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let wordMap: ReadonlyMap<string, Set<string>> | null = null;

/**
 * English version of {@link AbstractWordCoherencyRule}
 */
export class WordCoherencyRule extends AbstractWordCoherencyRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    this.addExamplePair(Example.wrong('He likes archaeology. Really? She likes <marker>archeology</marker>, too.'),
                   Example.fixed('He likes archaeology. Really? She likes <marker>archaeology</marker>, too.'));
  }

  protected override getWordMap(): ReadonlyMap<string, Set<string>> {
    return wordMap ??= new WordCoherencyDataLoader().loadWords('/en/coherency.txt');
  }

  protected override getMessage(word1: string, word2: string): string {
    return "Do not mix variants of the same word ('" + word1 + "' and '" + word2 + "') within a single text.";
  }

  override getId(): string {
    return 'EN_WORD_COHERENCY';
  }

  override getDescription(): string {
    return 'Coherent spelling of words with two admitted variants.';
  }

}
