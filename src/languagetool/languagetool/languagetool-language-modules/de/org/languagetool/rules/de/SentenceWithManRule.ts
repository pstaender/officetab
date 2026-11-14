// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SentenceWithManRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStatisticSentenceStyleRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStatisticSentenceStyleRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 15;

/**
 * A rule that gives Hints about the use of German filler words.
 * The Hints are only given when the percentage of filler words per chapter/text exceeds the given limit.
 * A limit of 0 shows all used filler words. Direct speech or citation is excluded otherwise. 
 * This rule detects no grammar error but gives stylistic hints (default off).
 * @author Fred Kruse
 * @since 4.2
 */
export class SentenceWithManRule extends AbstractStatisticSentenceStyleRule {

  sentenceMessage: string | null = null;

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PERCENT);
  }

  /**
   * Word is 'man'
   */
  private static isWordMan(token: AnalyzedTokenReadings): boolean {
    return (token.hasLemma('man'));
  }

  /**
   * Is sentence with verb man
   */
  protected override conditionFulfilled(sentence: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null {
    for (let i = 0; i < sentence.length; i++) {
      if (SentenceWithManRule.isWordMan(sentence[i]!)) {
        return sentence[i]!;
      }
    }
    return null;
  }

  protected override excludeDirectSpeech(): boolean {
    return true;
  }

  /**
   * Minimal value is given in per mil
   */
  override denominator(): number {
    return 1000.0;
  }

  protected override getLimitMessage(limit: number, percent: number): string {
    if (limit === 0) {
      return "Sätze mit der indirekten Leseransprache 'man' sind stilistisch wenig elegant formuliert. Lässt sich das Wort vermeiden?";
    }
    return 'Mehr als ' + limit + "‰ Sätze mit der indirekten Leseransprache 'man' {" + Math.trunc(percent + 0.5) + '‰} gefunden. Lässt sich das Wort vermeiden?';
  }

  override getId(): string {
    return 'SENTENCE_WITH_MAN_DE';
  }

  override getDescription(): string {
    return "Statistische Stilanalyse: Sätze mit indirekter Leseransprache 'man'";
  }

  override getConfigureText(): string {
    return "Anzeigen wenn mehr als ...‰ Sätze eines Kapitels 'man' enthalten:";
  }

}
