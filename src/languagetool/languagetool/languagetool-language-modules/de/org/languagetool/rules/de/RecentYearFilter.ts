// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/RecentYearFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { parseJavaInt, RuleFilter } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/RuleFilter.ts';
import { Calendar } from '../../../../../../../jdk/java/util/Calendar.ts';

/**
 * Keep only those matches whose 'year' value is last year or in
 * recent years (up to {@code maxYearsBack} years ago).
 * @since 2.7
 */
export class RecentYearFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, arguments_: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const thisYear = Calendar.getInstance().get(Calendar.YEAR);
    const maxYear = thisYear - parseJavaInt(arguments_.get('maxYearsBack')!);
    const year = parseJavaInt(arguments_.get('year')!);
    if (year < thisYear && year >= maxYear) {
      return match;
    }
    return null;
  }
}

FilterRegistry.register('org.languagetool.rules.de.RecentYearFilter', () => new RecentYearFilter());
