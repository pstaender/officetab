// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/YMDDateCheckFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { YMDDateHelper } from '../../../../../../languagetool-core/org/languagetool/rules/YMDDateHelper.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { DateCheckFilter } from './DateCheckFilter.ts';

/**
 * Date filter that expects a 'date' argument in the format 'yyyy-mm-dd'.
 * @since 3.2
 */
export class YMDDateCheckFilter extends DateCheckFilter {

  private readonly ymdDateHelper = new YMDDateHelper();

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], tokenPositions: number[]): RuleMatch | null {
    if (args.has('year') || args.has('month') || args.has('day')) {
      throw new Error("RuntimeException: Set only 'weekDay' and 'date' for " + 'YMDDateCheckFilter');  // YMDDateCheckFilter.class.getSimpleName()
    }
    return super.acceptRuleMatch(match, this.ymdDateHelper.parseDate(args), patternTokenPos, patternTokens, tokenPositions);
  }

}

FilterRegistry.register('org.languagetool.rules.de.YMDDateCheckFilter', () => new YMDDateCheckFilter());
