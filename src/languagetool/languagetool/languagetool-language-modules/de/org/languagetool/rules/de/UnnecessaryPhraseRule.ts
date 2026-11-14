// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/UnnecessaryPhraseRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticStyleRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PER_MILL = 8;

const unnecessaryPhrases: string[][] = [ [ 'dann', 'und', 'wann' ],
                                         [ 'des', 'Ungeachtet' ],
                                         [ 'ganz', 'und', 'gar' ],
                                         [ 'hie', 'und', 'da' ],
                                         [ 'im', 'Allgemeinen' ],
                                         [ 'in', 'der', 'Tat' ],
                                         [ 'in', 'diesem', 'Zusammenhang' ],
                                         [ 'mehr', 'oder', 'weniger' ],
                                         [ 'meines', 'Erachtens' ],
                                         [ 'ohne', 'weiteres' ],
                                         [ 'ohne', 'Zweifel' ],
                                         [ 'samt', 'und', 'sonders' ],
                                         [ 'sowohl', 'als', 'auch' ],
                                         [ 'voll', 'und', 'ganz' ],
                                         [ 'von', 'Neuem' ],
                                         [ 'allem', 'Anschein', 'nach' ],
                                         [ 'aufs', 'Neue' ],
                                         [ 'ein', 'bisschen' ],
                                         [ 'ein', 'wenig' ],
                                         [ 'des', 'Öfteren' ],
                                         [ 'bei', 'weitem' ],
                                         [ 'an', 'sich' ]
];

/**
 * A rule that gives Hints about the use of German phrases.
 * The Hints are only given when the percentage of phrases per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 5.3
 */
export class UnnecessaryPhraseRule extends AbstractStatisticStyleRule {

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PER_MILL);
    this.addExamplePair(Example.wrong('Das ist <marker>allem Anschein nach</marker> eine Phrase.'),
        Example.fixed('Das ist eine Phrase.'));
  }

  /**
   * Minimal value is given in per mil
   */
  override denominator(): number {
    return 10000.0;
  }

  /**
   * changes first char to upper as sentence begin
   */
  private static firstCharToLower(tokens: AnalyzedTokenReadings[], nToken: number): string {
    const token = tokens[nToken]!.getToken();
    return ((nToken !== 1 || token.length < 2) ? token : token.substring(0, 1).toLowerCase() + token.substring(1));
  }

  private static isException(tokens: AnalyzedTokenReadings[], phrase: string[]): boolean {
    if (phrase.length === 2) {
      if (phrase[0] === 'an' && phrase[1] === 'sich') {
        for (let j = 1; j < tokens.length; j++) {
          if (tokens[j]!.hasLemma('drücken')) {
            return true;
          }
        }
      }
    }
    return false;
  }


  protected override conditionFulfilled(tokens: AnalyzedTokenReadings[], nAnalysedToken: number): number {
    for (let i = 0; i < unnecessaryPhrases.length; i++) {
      let j: number;
      for (j = 0; j < unnecessaryPhrases[i]!.length && nAnalysedToken + j < tokens.length &&
          unnecessaryPhrases[i]![j] === UnnecessaryPhraseRule.firstCharToLower(tokens, nAnalysedToken + j); j++);
      if (j === unnecessaryPhrases[i]!.length) {
        if (UnnecessaryPhraseRule.isException(tokens, unnecessaryPhrases[i]!)) {
          return -1;
        } else {
          return nAnalysedToken + unnecessaryPhrases[i]!.length - 1;
        }
      }
    }
    return -1;
  }

  protected override sentenceConditionFulfilled(_tokens: AnalyzedTokenReadings[], _nToken: number): boolean {
    return false;
  }

  protected override excludeDirectSpeech(): boolean {
    return true;
  }

  protected override getLimitMessage(limit: number, percent: number): string {
    if (limit === 0) {
      return 'Der Ausdruck gilt als Phrase. Es wird empfohlen ihn zu löschen, falls möglich.';
    }
    return 'Mehr als ' + limit + '‱ potenzielle Phrasen {' + Math.trunc(percent + 0.5) +
        '‱} gefunden. Es wird empfohlen den Ausdruck zu löschen, falls möglich.';
  }

  protected override getSentenceMessage(): string | null {
    return null;
  }

  override getId(): string {
    return 'UNNECESSARY_PHRASES_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Potenzielle Phrasen';
  }

  override getConfigurePercentText(): string {
    return 'Anzeigen wenn mehr als ...‱ eines Kapitels potenzielle Phrasen sind:';
  }

  override getConfigureWithoutDirectSpeachText(): string {
    return 'Keine direkte Rede und Zitate berücksichtigen';
  }

}
