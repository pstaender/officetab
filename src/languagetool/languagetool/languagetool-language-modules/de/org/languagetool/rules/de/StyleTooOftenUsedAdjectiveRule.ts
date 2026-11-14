// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/StyleTooOftenUsedAdjectiveRule.java faithful
// LinguServices (the office extension's services) is not ported: UserConfig gives it untyped.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStyleTooOftenUsedWordRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStyleTooOftenUsedWordRule.ts';
import type { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 5;

/**
 * A rule that gives Hints about too often used Adjectives
 * @author Fred Kruse
 * @since 6.2
 */
export class StyleTooOftenUsedAdjectiveRule extends AbstractStyleTooOftenUsedWordRule {

  constructor(messages: ResourceBundle, lang: Language | null, userConfig: UserConfig | null) {
    super(messages, lang, userConfig, DEFAULT_MIN_PERCENT);
    if (userConfig != null) {
      const linguServices = userConfig.getLinguServices() as { setThesaurusRelevantRule(rule: Rule): void } | null;
      if (linguServices != null) {
        linguServices.setThesaurusRelevantRule(this);
      }
    }
  }

  protected override getLimitMessage(limit: number): string {
    return 'Das Adjektiv wird häufiger verwendet als ' + limit + '% aller Adjektive . ' +
           'Möglicherweise ist es besser es durch ein Synonym zu ersetzen.';
  }

  override getId(): string {
    return 'TOO_OFTEN_USED_ADJECTIVE_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Zu häufig genutztes Adjektiv';
  }

  override getConfigureText(): string {
    return 'Anzeigen wenn ein Adjektiv häufiger verwendet wird als ...% aller Adjektive:';
  }

  protected override isToCountedWord(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith('ADJ:');
  }

  protected override isException(tokens: AnalyzedTokenReadings[], n: number): boolean {
    const token = tokens[n]!;
    return token.hasPosTagStartingWith('PRO:') || token.hasPosTagStartingWith('ADV:') ||
        token.hasPosTagStartingWith('ZUS');
  }

  protected override toAddedLemma(token: AnalyzedTokenReadings): string | null {
    return this.getLemmaForPosTagStartsWith('ADJ:', token);
  }

}
