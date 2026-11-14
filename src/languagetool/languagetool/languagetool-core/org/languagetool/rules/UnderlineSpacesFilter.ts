// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/UnderlineSpacesFilter.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { FilterRegistry } from './patterns/registry.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';
import { StringTools } from '../tools/StringTools.ts';

export class UnderlineSpacesFilter extends RuleFilter {

  /*
   * Underline the whitespaces before and/or after the marker in the pattern
   */
  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const underlineSpaces = this.getRequired('underlineSpaces', args); // before/after/both
    const sentence = match.getSentence()!.getText();
    if (underlineSpaces === 'before' || underlineSpaces === 'both') {
      if (match.getFromPos() - 1 >= 0
        && StringTools.isWhitespace(sentence.substring(match.getFromPos() - 1, match.getFromPos()))) {
        match.setOffsetPosition(match.getFromPos() - 1, match.getToPos());
      }
    }
    if (underlineSpaces === 'after' || underlineSpaces === 'both') {
      if (match.getToPos() + 1 < sentence.length
        && StringTools.isWhitespace(sentence.substring(match.getToPos(), match.getToPos() + 1))) {
        match.setOffsetPosition(match.getFromPos(), match.getToPos() + 1);
      }
    }
    return match;
  }
}

FilterRegistry.register('org.languagetool.rules.UnderlineSpacesFilter', () => new UnderlineSpacesFilter());
