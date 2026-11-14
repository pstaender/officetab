// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractDateCheckWithSuggestionsFilter.java faithful
// The two getDayOfWeek overloads (String → int, Calendar → String) are one overloaded method.
// catch (IllegalArgumentException) rethrows, catch (RuntimeException) returns null: see
// isIllegalArgumentException.
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { RuleFilter } from './patterns/RuleFilter.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TestHackHelper } from './TestHackHelper.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Tools } from '../tools/Tools.ts';
import { Calendar } from '../../../../../jdk/java/util/Calendar.ts';
import { Integer_parseInt, isIllegalArgumentException, StringUtils_isNumeric } from '../../../../../jdk/java/lang/Exceptions.ts';
import { Pattern, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Accepts rule matches if a date doesn't match the accompanying weekday, e.g. if {@code Monday, 8 November 2003}
 * isn't actually a Monday. Replaces {@code {realDay}} with the real day of the date in the rule's message,
 * and {@code {day}} with the claimed day from the text (might be useful in case the text uses an abbreviation).
 * @since 2.7
 */
export abstract class AbstractDateCheckWithSuggestionsFilter extends RuleFilter {

  // The day of the month may contain not only digits but also extra letters
  // such as"22nd" in English or "22-an" in Esperanto. The regexp extracts
  // the numerical part.
  protected static readonly DAY_OF_MONTH_PATTERN = Pattern.compile('(\\d+).*');

  /**
   * Implement so that Sunday returns {@code 1}, Monday {@code 2} etc.
   * @param localizedWeekDayString a week day name or abbreviation thereof
   */
  protected abstract getDayOfWeek(localizedWeekDayString: string): number;

  /**
   * Get the localized name of the day of week for the given date.
   */
  protected abstract getDayOfWeek(date: Calendar): string;

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

  protected abstract getErrorMessageWrongYear(): string;

  /**
   * @param args           a map with values for {@code year}, {@code month}, {@code day} (day of month), {@code weekDay}
   */
  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], tokenPositions: number[]): RuleMatch | null {
    try {
      const dayOfWeekPos = this.getSkipCorrectedReference(tokenPositions, Integer_parseInt(this.getRequired('weekDay', args)));
      const dayOfWeekStr = patternTokens[dayOfWeekPos]!.getToken().replaceAll('­', '');  // replace soft hyphen
      let dayPos: number;
      let monthPos: number;
      let yearPos: number;
      let dayStr: string;
      let monthStr: string;
      let yearStr: string | null;
      let isFullDateToken = false;
      const fullDatePos = this.getSkipCorrectedReference(tokenPositions, Integer_parseInt(this.getOptional('date', args, '-1'))); // format yyyy-mm-dd
      if (fullDatePos > -1) {
        const parts = StringSplit(patternTokens[fullDatePos]!.getToken(), '-');
        isFullDateToken = true;
        dayPos = fullDatePos;
        monthPos = fullDatePos;
        yearPos = fullDatePos;
        dayStr = parts[2]!;
        monthStr = parts[1]!;
        yearStr = parts[0]!;
      } else {
        dayPos = this.getSkipCorrectedReference(tokenPositions, Integer_parseInt(this.getRequired('day', args)));
        monthPos = this.getSkipCorrectedReference(tokenPositions, Integer_parseInt(this.getRequired('month', args)));
        yearPos = this.getSkipCorrectedReference(tokenPositions, Integer_parseInt(this.getOptional('year', args, '-1')));
        dayStr = patternTokens[dayPos]!.getToken();
        monthStr = patternTokens[monthPos]!.getToken();
        yearStr = (yearPos > -1 ? patternTokens[yearPos]!.getToken() : null);
      }
      const dayOfWeekFromString = this.getDayOfWeek(dayOfWeekStr);
      const day = this.getDayOfMonthFromStr(dayStr);
      const month = this.getMonthFromStr(monthStr);
      const year = this.getYearFromStr(yearStr);
      const dateFromDate = this.getDate(day, month, year);
      const dayOfWeekFromDate = this.getDayOfWeekFromDate(dateFromDate);
      if (dayOfWeekFromDate === -1) {
        return null;
      }
      if (dayOfWeekFromString !== dayOfWeekFromDate) {
        const calFromDateString = Calendar.getInstance();
        calFromDateString.set(Calendar.DAY_OF_WEEK, dayOfWeekFromString);
        let message: string;
        // suggest changing the year (to current year)
        const currentYear = this.getYearFromStr(null);
        const dateFromDateChangeYear = this.getDate(day, month, currentYear);
        const dayOfWeekFromDateChangeYear = this.getDayOfWeekFromDate(dateFromDateChangeYear);
        if (dayOfWeekFromString === dayOfWeekFromDateChangeYear) {
          message = this.getErrorMessageWrongYear().replaceAll('{currentYear}', String(currentYear));
          const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(),
            patternTokens[yearPos]!.getStartPos(), patternTokens[yearPos]!.getEndPos(), message, match.getShortMessage());
          ruleMatch.setType(match.getType());
          ruleMatch.setUrl(Tools.getUrl('https://www.timeanddate.com/calendar/?year=' + dateFromDateChangeYear.get(Calendar.YEAR)));
          if (isFullDateToken) {
            ruleMatch.setSuggestedReplacement(currentYear + '-' + monthStr + '-' + dayStr);
          } else {
            ruleMatch.setSuggestedReplacement(String(currentYear));
          }
          return ruleMatch;
        }
        // suggest changing day of week or day of month
        message = match.getMessage()
          .replaceAll('{realDay}', this.getDayOfWeek(dateFromDate))
          .replaceAll('{day}', this.getDayOfWeek(calFromDateString))
          .replaceAll('{currentYear}', String(Calendar.getInstance().get(Calendar.YEAR)));
        let startIndex: number;
        let endIndex: number;
        if (dayOfWeekPos < dayPos) {
          startIndex = dayOfWeekPos;
          endIndex = dayPos;
        } else {
          startIndex = dayPos;
          endIndex = dayOfWeekPos;
        }
        const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(), patternTokens[startIndex]!.getStartPos(), patternTokens[endIndex]!.getEndPos(), message, match.getShortMessage());
        ruleMatch.setType(match.getType());
        ruleMatch.setUrl(Tools.getUrl('https://www.timeanddate.com/calendar/?year=' + dateFromDate.get(Calendar.YEAR)));
        // suggest changing day of week
        let suggestion = '';
        let isFirst = true;
        for (let j = startIndex; j <= endIndex; j++) {
          if (isFirst) {
            isFirst = false;
          } else if (patternTokens[j]!.isWhitespaceBefore()) {
            suggestion += ' ';
          }
          if (j === dayOfWeekPos) {
            suggestion += StringTools.preserveCase(this.getDayOfWeek(dateFromDate), dayOfWeekStr);
          } else {
            suggestion += patternTokens[j]!.getToken();
          }
        }
        if (suggestion.length !== 0) {
          ruleMatch.setSuggestedReplacement(this.adjustSuggestion(suggestion));
        }
        // suggest changing day of month
        const correctedDayofMonth = this.findNewDayOfMonth(day, month, year, dayOfWeekFromString);
        if (correctedDayofMonth.length !== 0) {
          suggestion = '';
          isFirst = true;
          for (let j = startIndex; j <= endIndex; j++) {
            if (isFirst) {
              isFirst = false;
            } else if (patternTokens[j]!.isWhitespaceBefore()) {
              suggestion += ' ';
            }
            if (j === dayPos) {
              if (isFullDateToken) {
                suggestion += yearStr + '-' + monthStr + '-' + correctedDayofMonth;
              } else {
                suggestion += this.getDayStrLikeOriginal(correctedDayofMonth, dayStr);
              }
            } else {
              suggestion += patternTokens[j]!.getToken();
            }
          }
          if (suggestion.length !== 0) {
            ruleMatch.addSuggestedReplacement(this.adjustSuggestion(suggestion));
          }
        }
        return ruleMatch;
      } else {
        return null;
      }
    } catch (e) {
      if (isIllegalArgumentException(e)) {
        throw e;
      }
      // this can happen with some special characters which the Java regex matches but which the Java code
      // cannot map to days, e.g. German "Dıenstag" vs "Dienstag" (note the difference on the second character -
      // the first word is not valid, but it should not crash LT):
      //logger.warn("Skipping potential match for " + match.getRule().getFullId(), e);
      return null;
    }
  }

  private findNewDayOfMonth(day: number, month: number, year: number, dayOfWeekFromString: number): string {
    let difference = 1;
    while (difference < 7) {
      if (day - difference > 0) {
        const dateFromDate = this.getDate(day - difference, month, year);
        const dayOfWeekFromDate = this.getDayOfWeekFromDate(dateFromDate);
        if (dayOfWeekFromString === dayOfWeekFromDate) {
          return String(day - difference);
        }
      }
      if (day + difference < 32) {
        const dateFromDate = this.getDate(day + difference, month, year);
        const dayOfWeekFromDate = this.getDayOfWeekFromDate(dateFromDate);
        if (dayOfWeekFromString === dayOfWeekFromDate) {
          return String(day + difference);
        }
      }
      difference++;
    }
    return '';
  }

  private getDayOfWeekFromDate(dateFromDate: Calendar): number {
    let dayOfWeekFromDate: number;
    try {
      dayOfWeekFromDate = dateFromDate.get(Calendar.DAY_OF_WEEK);
    } catch (ignore) {
      if (!isIllegalArgumentException(ignore)) throw ignore;
      // happens with 'dates' like '32.8.2014' - those should be caught by a different rule
      return -1;
    }
    return dayOfWeekFromDate;
  }

  protected getDate(dayOfMonth: number, month: number, year: number): Calendar {
    const calendar = this.getCalendar();
    calendar.setLenient(false);  // be strict about validity of dates
    //noinspection MagicConstant
    calendar.set(year, month, dayOfMonth, 0, 0, 0);
    return calendar;
  }

  private getYearFromStr(yearArg: string | null): number {
    let year: number;
    if (yearArg == null && TestHackHelper.isJUnitTest()) {
      // Volkswagen-style testing
      // Hack for tests of date - weekday match with missing year
      // in production, we assume the current year
      // For xml tests, we use weekdays of the year 2014
      year = 2014;
    } else if (yearArg == null) {
      // assume current year for rule DATUM_WOCHENTAG_OHNE_JAHR etc.
      year = this.getCalendar().get(Calendar.YEAR);
    } else {
      year = Integer_parseInt(yearArg);
    }
    return year;
  }

  private getDayOfMonthFromStr(dayOfMonthString: string): number {
    let dayOfMonth: number;
    const matcherDayOfMonth = AbstractDateCheckWithSuggestionsFilter.DAY_OF_MONTH_PATTERN.matcher(dayOfMonthString);
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

  private getMonthFromStr(monthStr: string): number {
    let month: number;
    if (StringUtils_isNumeric(monthStr)) {
      month = Integer_parseInt(monthStr);
    } else {
      month = this.getMonth(StringTools.trimSpecialCharacters(monthStr));
    }
    return month - 1;
  }

  protected getDayStrLikeOriginal(day: string, _original: string): string {
    return day;
  }

  // typographical adjusments needed in some language
  protected adjustSuggestion(sugg: string): string {
    return sugg;
  }

}
