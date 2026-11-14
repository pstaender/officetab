// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanRepeatedWordsRule.java faithful
// The static wordsToCheck (/de/synonyms.txt) is loaded on first use. GermanyGerman.getInstance()
// is Languages.getLanguageForShortCode('de-DE') (what it does): German imports this rule, so a
// value import of GermanyGerman (a subclass of German) would be an import cycle.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { AbstractRepeatedWordsRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractRepeatedWordsRule.ts';
import type { SynonymsData } from '../../../../../../languagetool-core/org/languagetool/rules/SynonymsData.ts';
import type { Synthesizer } from '../../../../../../languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import { GermanSynthesizer } from '../../synthesis/GermanSynthesizer.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let wordsToCheck: Map<string, SynonymsData> | null = null;

export class GermanRepeatedWordsRule extends AbstractRepeatedWordsRule {

  constructor(messages: ResourceBundle) {
    super(messages, Languages.getLanguageForShortCode('de-DE'));  // GermanyGerman.getInstance()
    //super.setDefaultTempOff();
  }

  protected override getMessage(): string {
    return 'Dieses Wort kommt in einem nahe gelegenen vorherigen Satz bereits vor. Verwenden Sie ein Synonym, um Ihren Text abwechslungsreicher zu gestalten, außer die Wiederholung ist beabsichtigt.';
  }

  override getDescription(): string {
    return ('Synonyme für wiederholte Wörter.');
  }

  protected override getWordsToCheck(): Map<string, SynonymsData> {
    return (wordsToCheck ??= AbstractRepeatedWordsRule.loadWords('/de/synonyms.txt'));
  }

  protected override getShortMessage(): string {
    return 'Stil: Wortwiederholung';
  }

  protected override getSynthesizer(): Synthesizer {
    return GermanSynthesizer.INSTANCE;
  }

  protected override isException(tokens: AnalyzedTokenReadings[], i: number, sentStart: boolean, isCapitalized: boolean,
      isAllUppercase: boolean): boolean {
    if (isAllUppercase || (isCapitalized && !sentStart)) {
      return true;
    }
    return tokens[i]!.hasPosTagStartingWith('EIG:');
  }
}
