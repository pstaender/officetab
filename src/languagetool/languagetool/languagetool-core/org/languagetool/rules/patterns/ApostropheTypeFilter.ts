// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/ApostropheTypeFilter.java faithful
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../RuleMatch.ts';
import { StringEqualsIgnoreCase } from '../../../../../../jdk/java/lang/String.ts';
import { FilterRegistry } from './registry.ts';
import { parseJavaInt, RuleFilter } from './RuleFilter.ts';

export class ApostropheTypeFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const wordFrom = this.getRequired('wordFrom', args);
    const hasTypographicalApostrophe = StringEqualsIgnoreCase(this.getRequired('hasTypographicalApostrophe', args), 'true');
    if (wordFrom != null) {
      let posWord = 0;
      if (wordFrom === 'marker') {
        while (posWord < patternTokens.length && patternTokens[posWord]!.getStartPos() < match.getFromPos()) {
          posWord++;
        }
        posWord++;
      } else {
        posWord = parseJavaInt(wordFrom);
      }
      if (posWord < 1 || posWord > patternTokens.length) {
        throw new Error('IllegalArgumentException: ApostropheTypeFilter: Index out of bounds in '
            + match.getRule().getFullId() + ', wordFrom: ' + posWord);
      }
      const atrWord = patternTokens[posWord - 1]!;
      if (hasTypographicalApostrophe === atrWord.hasTypographicApostrophe()) {
        return match;
      }
    }
    return null;
  }
}

FilterRegistry.register('org.languagetool.rules.patterns.ApostropheTypeFilter', () => new ApostropheTypeFilter());
