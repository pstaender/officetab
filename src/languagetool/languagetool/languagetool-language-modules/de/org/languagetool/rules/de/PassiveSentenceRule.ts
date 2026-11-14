// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/PassiveSentenceRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticSentenceStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticSentenceStyleRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 8;

/**
 * A rule that gives Hints about the use of German filler words.
 * The Hints are only given when the percentage of filler words per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 4.2
 */
export class PassiveSentenceRule extends AbstractStatisticSentenceStyleRule {

  sentenceMessage: string | null = null;

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PERCENT);
  }

  /**
   * Is passive sentence
   */
  protected override conditionFulfilled(sentence: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null {
    for (let i = 0; i < sentence.length; i++) {
      if (sentence[i]!.hasLemma('werden')) {
        const token = sentence[i]!;
        for (i++; i < sentence.length; i++) {
          if (sentence[i]!.hasPosTagStartingWith('VER:PA2:')) {
            return token;
          } else if (this.isMark(sentence[i]!)) {
            return null;
          }
        }
      } else if (sentence[i]!.hasPosTagStartingWith('VER:PA2:')) {
        for (i++; i < sentence.length; i++) {
          if (sentence[i]!.hasLemma('werden')) {
            return sentence[i]!;
          } else if (this.isMark(sentence[i]!)) {
            return null;
          }
        }
      }
    }
    return null;
  }

  protected override excludeDirectSpeech(): boolean {
    return true;
  }

  protected override getLimitMessage(limit: number, percent: number): string {
    if (limit === 0) {
      return 'Passivsatz: Aktiv formulierte Sätze sprechen im Regelfall den Leser stärker an.';
    }
    return 'Mehr als ' + limit + '% Passivsätze {' + Math.trunc(percent + 0.5) + '%} gefunden. Aktiv formulierte Sätze sprechen im Regelfall den Leser stärker an.';
  }

  override getId(): string {
    return 'PASSIVE_SENTENCE_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Passivsätze';
  }

  override getConfigureText(): string {
    return 'Anzeigen wenn mehr als ...% Sätze eines Kapitels Passivsätze sind:';
  }

}
