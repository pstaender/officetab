// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractSuppressMisspelledSuggestionsFilter.java faithful
// Language.getDefaultSpellingRule() is typed as Rule (see Language.ts): it is a SpellingCheckRule.
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import type { PatternRule } from './patterns/PatternRule.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';
import type { SpellingCheckRule } from './spelling/SpellingCheckRule.ts';
import { StringEqualsIgnoreCase } from '../../../../../jdk/java/lang/String.ts';

export abstract class AbstractSuppressMisspelledSuggestionsFilter extends RuleFilter {

  protected constructor() {
    super();
  }

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const ruleMatch = match;
    const language = (match.getRule() as PatternRule).getLanguage();
    const tagger = language.getTagger();
    const replacements = match.getSuggestedReplacements();
    const newReplacements: string[] = [];
    const suppressMatch = this.getRequired('suppressMatch', args);
    const suppressPostag = this.getOptional('SuppressPostag', args);
    let atrs: AnalyzedTokenReadings[] = [];
    if (tagger != null && suppressPostag != null) {
      atrs = tagger.tag(replacements);
    }
    for (let i = 0; i < replacements.length; i++) {
      if (!this.isMisspelled(replacements[i]!, language)) {
        if (tagger != null && suppressPostag != null) {
          if (!atrs[i]!.matchesPosTagRegex(suppressPostag)) {
            newReplacements.push(replacements[i]!);
          }
        } else {
          newReplacements.push(replacements[i]!);
        }
      }
    }
    let bSuppressMatch = true;
    if (suppressMatch != null && StringEqualsIgnoreCase(suppressMatch, 'false')) {
      bSuppressMatch = false;
    }
    if (newReplacements.length === 0 && bSuppressMatch) {
      return null;
    } else {
      ruleMatch.setSuggestedReplacements(newReplacements);
      return ruleMatch;
    }
  }

  isMisspelled(s: string, language: Language): boolean {
    const spellerRule = language.getDefaultSpellingRule() as SpellingCheckRule | null;
    if (spellerRule == null) {
      return false;
    }
    const tokens = language.getWordTokenizer().tokenize(s);
    for (const token of tokens) {
      if (spellerRule.isMisspelled(token)) {
        return true;
      }
    }
    return false;
  }

}
