// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/DateRangeChecker.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { FilterRegistry } from './patterns/registry.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';
import { Integer_parseInt, isIllegalArgumentException } from '../../../../../jdk/java/lang/Exceptions.ts';

/**
 * Checks whether the date range is valid, i.e., that the starting
 * date happens before the end date. The check is trivial: simply check
 * whether the first integer number is smaller than the second, so this
 * can be implemented for any language.
 *
 * The parameters used in the XML file are called 'x' and 'y'.
 */
export class DateRangeChecker extends RuleFilter {
  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    try {
      const x = Integer_parseInt(args.get('x'));
      const y = Integer_parseInt(args.get('y'));
      if (x >= y) {
        return match;
      }
    } catch (ignore) {
      if (!isIllegalArgumentException(ignore)) throw ignore;
      // if something's fishy with the number – ignore it silently,
      // it's not a date range
      return null;
    }
    return null;
  }
}

FilterRegistry.register('org.languagetool.rules.DateRangeChecker', () => new DateRangeChecker());
