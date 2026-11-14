// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SentenceWithModalVerbRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticSentenceStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticSentenceStyleRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 18;

/**
 * A rule that gives Hints about the use of German filler words.
 * The Hints are only given when the percentage of filler words per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 4.2
 */
export class SentenceWithModalVerbRule extends AbstractStatisticSentenceStyleRule {

  sentenceMessage: string | null = null;

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PERCENT);
  }

  /**
   * Word is a modal verb
   */
  private static isModalVerb(token: AnalyzedTokenReadings): boolean {
    return (token.hasPosTagStartingWith('VER:MOD'));
  }

  /**
   * Is sentence with modal verb
   */
  protected override conditionFulfilled(sentence: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null {
    for (let i = 0; i < sentence.length; i++) {
      if (SentenceWithModalVerbRule.isModalVerb(sentence[i]!)) {
        const token = sentence[i]!;
        for (i++; i < sentence.length; i++) {
          if (sentence[i]!.hasPosTagStartingWith('VER:INF')) {
            return token;
          } else if (this.isMark(sentence[i]!)) {
            return null;
          }
        }
      } else if (sentence[i]!.hasPosTagStartingWith('VER:INF')) {
        for (i++; i < sentence.length; i++) {
          if (SentenceWithModalVerbRule.isModalVerb(sentence[i]!)) {
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
      return 'Modalverb: Modalverben blähen den Text häufig auf und sollten vermieden werden.';
    }
    return 'Mehr als ' + limit + '% Sätze mit Modalverben {' + Math.trunc(percent + 0.5) + '%} gefunden. Modalverben blähen den Text häufig auf und sollten vermieden werden.';
  }

  override getId(): string {
    return 'SENTENCE_WITH_MODAL_VERB_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Sätze mit Modalverben';
  }

  override getConfigureText(): string {
    return 'Anzeigen wenn mehr als ...% Sätze eines Kapitels Modalverben enthalten:';
  }

}
