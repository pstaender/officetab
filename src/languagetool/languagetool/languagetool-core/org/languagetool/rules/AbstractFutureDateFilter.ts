// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractFutureDateFilter.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';
import { TestHackHelper } from './TestHackHelper.ts';
import { Calendar } from '../../../../../jdk/java/util/Calendar.ts';
import { Integer_parseInt, isIllegalArgumentException, StringUtils_isNumeric } from '../../../../../jdk/java/lang/Exceptions.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

const DAY_OF_MONTH_PATTERN = Pattern.compile('(\\d+).*');

/**
 * Checks if a given date is in the future
 * Used for mismatch detection between verb tense and a given date
 * @since 4.3
 */
export abstract class AbstractFutureDateFilter extends RuleFilter {

  /**
   * Implement so that "first" returns {@code 1}, second returns {@code 2} etc.
   * @param localizedDayOfMonth name of day of the month or abbreviation thereof
   */
  protected getDayOfMonth(_localizedDayOfMonth: string): number {
    return 0;
  }

  /**
   * Implement so that January returns {@code 1}, February {@code 2} etc.
   * @param localizedMonth name of a month or abbreviation thereof
   */
  protected abstract getMonth(localizedMonth: string): number;

  protected abstract getCalendar(): Calendar;

  /**
   * @param args           a map with values for {@code year}, {@code month}, {@code day} (day of month), {@code weekDay}
   */
  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const dateFromDate = this.getDate(args);
    let currentDate = this.getCalendar();
    if (TestHackHelper.isJUnitTest()) {
      currentDate = new Calendar.Builder().setDate(2014, 0, 1).build();
    }
    try {
      if (dateFromDate.after(currentDate)) {
        return match;
      } else {
        return null;
      }
    } catch (ignore) {
      if (!isIllegalArgumentException(ignore)) throw ignore;
      // happens with 'dates' like '32.8.2014' - those should be caught by a different rule
      return null;
    }
  }

  private getDate(args: Map<string, string>): Calendar {
    const year = Integer_parseInt(this.getRequired('year', args));
    const month = this.getMonthFromArguments(args);
    const dayOfMonth = this.getDayOfMonthFromArguments(args);

    const calendar = this.getCalendar();
    calendar.setLenient(false);  // be strict about validity of dates
    //noinspection MagicConstant
    calendar.set(year, month, dayOfMonth, 0, 0, 0);
    return calendar;
  }

  private getDayOfMonthFromArguments(args: Map<string, string>): number {
    const dayOfMonthString = this.getRequired('day', args);
    let dayOfMonth: number;
    const matcherDayOfMonth = DAY_OF_MONTH_PATTERN.matcher(dayOfMonthString);
    if (matcherDayOfMonth.matches()) {
      // The day of the month is a number, possibly with a suffix such
      // as "22nd" for example.
      dayOfMonth = Integer_parseInt(matcherDayOfMonth.group(1));
    } else {
      // In some languages, the day of the month can also be written with
      // letters rather than with digits, so parse localized numbers.
      dayOfMonth = this.getDayOfMonth(dayOfMonthString);
    }
    return dayOfMonth;
  }

  private getMonthFromArguments(args: Map<string, string>): number {
    const monthStr = this.getRequired('month', args);
    let month: number;
    if (StringUtils_isNumeric(monthStr)) {
      month = Integer_parseInt(monthStr);
    } else {
      month = this.getMonth(monthStr);
    }
    return month - 1;
  }
}
