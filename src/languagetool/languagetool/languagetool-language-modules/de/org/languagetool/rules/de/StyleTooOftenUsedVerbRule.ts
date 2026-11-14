// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/StyleTooOftenUsedVerbRule.java faithful
// LinguServices (the office extension's services) is not ported: UserConfig gives it untyped.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractStyleTooOftenUsedWordRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractStyleTooOftenUsedWordRule.ts';
import type { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DEFAULT_MIN_PERCENT = 5;

/**
 * A rule that gives Hints about too often used Verbs
 * @author Fred Kruse
 * @since 6.2
 */
export class StyleTooOftenUsedVerbRule extends AbstractStyleTooOftenUsedWordRule {

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
    return 'Das Verb wird häufiger verwendet als ' + limit + '% aller Verben. ' +
           'Möglicherweise ist es besser es durch ein Synonym zu ersetzen.';
  }

  override getId(): string {
    return 'TOO_OFTEN_USED_VERB_DE';
  }

  override getDescription(): string {
    return 'Statistische Stilanalyse: Zu häufig genutztes Verb';
  }

  override getConfigureText(): string {
    return 'Anzeigen wenn ein Verb häufiger verwendet wird als ...% aller Verben:';
  }

  protected override isToCountedWord(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith('VER:');
  }

  protected override isException(tokens: AnalyzedTokenReadings[], n: number): boolean {
    const token = tokens[n]!;
    return token.hasPosTagStartingWith('VER:MOD') || token.hasPosTagStartingWith('VER:AUX') ||
        token.hasPosTagStartingWith('ART') || token.hasPosTagStartingWith('ADJ');
  }

  protected override toAddedLemma(token: AnalyzedTokenReadings): string | null {
    return this.getLemmaForPosTagStartsWith('VER:', token);
  }

}
