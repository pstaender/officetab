// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/LanguageDependentRuleMatchFilter.java faithful
import type { Language } from '../Language.ts';
import type { AnnotatedText } from '../markup/AnnotatedText.ts';
import type { RuleSet } from './patterns/RuleSet.ts';
import type { RuleMatch } from './RuleMatch.ts';
import type { RuleMatchFilter } from './RuleMatchFilter.ts';

export class LanguageDependentRuleMatchFilter implements RuleMatchFilter {

  private readonly language: Language;
  private readonly enabledRules: ReadonlySet<string>;
  constructor(language: Language, rules: RuleSet) {
    this.language = language;
    this.enabledRules = rules.allRuleIds();
  }

  filter(ruleMatches: RuleMatch[], text?: AnnotatedText | null): RuleMatch[] {
    return this.language.filterRuleMatches(ruleMatches, text!, this.enabledRules);
  }
}
