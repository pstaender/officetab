// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/LongSentenceRule.java faithful
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { LongSentenceRule as org_languagetool_rules_LongSentenceRule } from '../../../../../../languagetool-core/org/languagetool/rules/LongSentenceRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * A rule that warns on long sentences.
 * @since 3.9
 */
export class LongSentenceRule extends org_languagetool_rules_LongSentenceRule {

  constructor(messages: ResourceBundle, userConfig: UserConfig | null, defaultWords: number) {
    super(messages, userConfig, defaultWords);
    this.addExamplePair(Example.wrong('<marker>Dies ist ein Bandwurmsatz, der immer weiter geht, obwohl das kein guter Stil ist, den man eigentlich berücksichtigen sollte, obwohl es auch andere Meinungen gibt, die aber in der Minderzahl sind, weil die meisten Autoren sich doch an die Stilvorgaben halten, wenn auch nicht alle, was aber letztendlich wiederum eine Sache des Geschmacks ist</marker>.'),
                   Example.fixed('<marker>Dies ist ein kurzer Satz.</marker>'));
  }

  override getDescription(): string {
    return 'Findet lange Sätze';
  }

  override getId(): string {
    return 'TOO_LONG_SENTENCE_DE';
  }

  getShortMessage(): string {
    return 'Langer Satz';
  }

}
