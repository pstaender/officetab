// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractNumberInWordFilter.java faithful
// The field language is _language: RuleFilter has a private field of that name (Java's subclass
// field hides it, TypeScript does not allow that).
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import { RuleMatch } from './RuleMatch.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

export abstract class AbstractNumberInWordFilter extends RuleFilter {

  protected readonly _language: Language;

  static readonly typoPattern = Pattern.compile('[0-9]');

  protected constructor(language: Language) {
    super();
    this._language = language;
  }

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[] | null): RuleMatch | null {
    const word = args.get('word')!;
    const wordReplacingZeroO = word.replaceAll('0', 'o');
    const wordWithoutNumberCharacter = AbstractNumberInWordFilter.typoPattern.matcher(word).replaceAll('');
    const replacements: string[] = [];

    if (!this.isMisspelled(wordReplacingZeroO) && !(word === wordReplacingZeroO) ) {
      replacements.push(wordReplacingZeroO);
    }
    if (!this.isMisspelled(wordWithoutNumberCharacter)) {
      replacements.push(wordWithoutNumberCharacter);
    }
    if (replacements.length === 0) {
      const suggestions = this.getSuggestions(wordWithoutNumberCharacter);
      replacements.push(...suggestions);
    }
    if (replacements.length !== 0) {
      const ruleMatch = new RuleMatch(match);
      ruleMatch.setSuggestedReplacements(replacements);
      return ruleMatch;
    }
    return null;
  }

  protected abstract isMisspelled(word: string): boolean;

  protected abstract getSuggestions(word: string): string[];

}
