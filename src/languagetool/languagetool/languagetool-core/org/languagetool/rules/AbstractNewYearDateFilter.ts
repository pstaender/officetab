// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractNewYearDateFilter.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TestHackHelper } from './TestHackHelper.ts';
import { Calendar } from '../../../../../jdk/java/util/Calendar.ts';
import { Integer_parseInt, isIllegalArgumentException, StringUtils_isNumeric } from '../../../../../jdk/java/lang/Exceptions.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

// The day of the month may contain not only digits but also extra letters
// such as "22nd" in English or "22-an" in Esperanto. The regexp extracts
// the numerical part.
const DAY_OF_MONTH_PATTERN = Pattern.compile('(\\d+).*');

/**
 * Accepts rule matches if we are in the first days of a new year and the user
 * may have entered a date with the old year (but not a date in December).
 * @since 4.3
 */
export abstract class AbstractNewYearDateFilter extends RuleFilter {

  /**
   * Return true if the year recently changed (= it is January)
  */
  protected isJanuary(): boolean {
    if (TestHackHelper.isJUnitTest()) {
      return true;
    }
    return this.getCalendar().get(Calendar.MONTH) === Calendar.JANUARY;
  }

  protected getCurrentYear(): number {
    if (TestHackHelper.isJUnitTest()) {
      return 2014;
    }
    return this.getCalendar().get(Calendar.YEAR);
  }

  /**
   * Implement so that January returns {@code 1}, February {@code 2} etc.
   * @param localizedMonth name of a month or abbreviation thereof
   */
  protected abstract getMonth(localizedMonth: string): number;

  protected abstract getCalendar(): Calendar;

  /**
   * Implement so that "first" returns {@code 1}, second returns {@code 2} etc.
   * @param localizedDayOfMonth name of day of the month or abbreviation thereof
   */
  protected getDayOfMonth(_localizedDayOfMonth: string): number {
    return 0;
  }

  /**
   * @param args           a map with values for {@code year}, {@code month}, {@code day} (day of month)
   */
  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const dateFromText = this.getDate(args);
    let monthFromText: number;
    let yearFromText: number;
    try {
      monthFromText = dateFromText.get(Calendar.MONTH);
      yearFromText = dateFromText.get(Calendar.YEAR);
    } catch (e) {
      if (!isIllegalArgumentException(e)) throw e;
      return null; // date is not valid; another rule is responsible
    }
    const currentYear = this.getCurrentYear();
    if (this.isJanuary() && monthFromText !== 11 /*December*/ && yearFromText + 1 === currentYear) {
      const message = match.getMessage()
              .replaceAll('{year}', String(yearFromText))
              .replaceAll('{realYear}', String(currentYear));
      const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(), match.getFromPos(), match.getToPos(), message, match.getShortMessage());
      ruleMatch.setType(match.getType());
      return ruleMatch;
    } else {
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
    const dayOfMonthString = this.getRequired('day', args).replaceAll('­', '');  // replace soft hyphen
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
    const monthStr = this.getRequired('month', args).replaceAll('­', '');  // replace soft hyphen
    let month: number;
    if (StringUtils_isNumeric(monthStr)) {
      month = Integer_parseInt(monthStr);
    } else {
      month = this.getMonth(monthStr);
    }
    return month - 1;
  }

}
