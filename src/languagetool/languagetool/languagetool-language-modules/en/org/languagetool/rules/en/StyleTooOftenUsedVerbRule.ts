// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/StyleTooOftenUsedVerbRule.java faithful
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

  sentenceMessage: string | null = null;

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
    return "The verb is used more than " + limit + "% times of all verbs. " +
        "It may be better to replace it with a synonym.";
  }

  override getId(): string {
    return 'TOO_OFTEN_USED_VERB_EN';
  }

  override getDescription(): string {
    return 'Statistical Style Analysis: Overused Verb';
  }

  override getConfigureText(): string {
    return 'Show when a verb is used more often than ...% of all verbs:';
  }

  protected override isToCountedWord(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith('VB');
  }

  protected override isException(tokens: AnalyzedTokenReadings[], n: number): boolean {
    const token = tokens[n]!;
    return token.hasAnyLemma('be', 'have', 'do') || token.hasPosTagStartingWith('IN') ||
        token.hasPosTagStartingWith('NN');
  }

  protected override toAddedLemma(token: AnalyzedTokenReadings): string | null {
    return this.getLemmaForPosTagStartsWith('VB', token);
  }

}
