// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/WordCoherencyRule.java faithful
// The static word map (/de/coherency.txt) is loaded on first use.
import { AbstractWordCoherencyRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractWordCoherencyRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WordCoherencyDataLoader } from '../../../../../../languagetool-core/org/languagetool/rules/WordCoherencyDataLoader.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let wordMap: ReadonlyMap<string, Set<string>> | null = null;

/**
 * German version of {@link AbstractWordCoherencyRule}.
 * 
 * @author Daniel Naber
 */
export class WordCoherencyRule extends AbstractWordCoherencyRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    this.addExamplePair(Example.wrong('Die Delfine gehören zu den Zahnwalen. <marker>Delphine</marker> sind in allen Meeren verbreitet.'),
                   Example.fixed('Die Delfine gehören zu den Zahnwalen. <marker>Delfine</marker> sind in allen Meeren verbreitet.'));
  }

  protected override getWordMap(): ReadonlyMap<string, Set<string>> {
    return wordMap ??= new WordCoherencyDataLoader().loadWords('/de/coherency.txt');
  }

  protected override getMessage(word1: string, word2: string): string {
    return "'" + word1 + "' und '" + word2 + "' sollten nicht gleichzeitig benutzt werden.";
  }
  
  override getId(): string {
    return 'DE_WORD_COHERENCY';
  }

  override getDescription(): string {
    return 'Einheitliche Schreibweise für Wörter mit mehr als einer korrekten Schreibweise';
  }
}
