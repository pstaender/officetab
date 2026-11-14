// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanWordRepeatBeginningRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WordRepeatBeginningRule } from '../../../../../../languagetool-core/org/languagetool/rules/WordRepeatBeginningRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const ADVERBS = new Set<string>([
        'Auch', 'Anschließend', 'Außerdem', 'Danach', 'Ferner',
        'Nebenher', 'Nebenbei', 'Überdies', 'Weiterführend', 'Zudem', 'Zusätzlich'
]);

/**
 * Extends {@link WordRepeatBeginningRule} by a list of German adverbs ("Konjunktionaladverbien")
 * for a more precise error message.
 * 
 * @author Markus Brenneis
 */
export class GermanWordRepeatBeginningRule extends WordRepeatBeginningRule {

  constructor(messages: ResourceBundle, language: Language | null) {
    super(messages, language);
    this.addExamplePair(Example.wrong('Dann hatten wir Freizeit. Dann gab es Essen. <marker>Dann</marker> gingen wir schlafen.'),
                   Example.fixed('Dann hatten wir Freizeit. Danach gab es Essen. <marker>Schließlich</marker> gingen wir schlafen.'));
  }

  override getId(): string {
    return 'GERMAN_WORD_REPEAT_BEGINNING_RULE';
  }

  protected override isAdverb(token: AnalyzedTokenReadings): boolean {
    return ADVERBS.has(token.getToken());
  }
}
