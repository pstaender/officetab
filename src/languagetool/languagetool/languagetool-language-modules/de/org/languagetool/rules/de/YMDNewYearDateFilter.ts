// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/YMDNewYearDateFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { YMDDateHelper } from '../../../../../../languagetool-core/org/languagetool/rules/YMDDateHelper.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { NewYearDateFilter } from './NewYearDateFilter.ts';

/**
 * New year date filter that expects a 'date' argument in the format 'yyyy-mm-dd'.
 *
 * @since 4.3
 */
export class YMDNewYearDateFilter extends NewYearDateFilter {

  private readonly ymdDateHelper = new YMDDateHelper();

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], tokenPositions: number[]): RuleMatch | null {
    if (args.has('year') || args.has('month') || args.has('day')) {
      throw new Error("RuntimeException: Set only 'weekDay' and 'date' for " + 'YMDDateCheckFilter');  // YMDDateCheckFilter.class.getSimpleName()
    }
    args = this.ymdDateHelper.parseDate(args);
    return super.acceptRuleMatch(this.ymdDateHelper.correctDate(match, args), args, patternTokenPos, patternTokens, tokenPositions);
  }
}

FilterRegistry.register('org.languagetool.rules.de.YMDNewYearDateFilter', () => new YMDNewYearDateFilter());
