// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/DateCheckFilter.java faithful
// The two getDayOfWeek overloads are one overloaded method. getDayOfWeek and getMonth are public
// here (protected in Java, where the test in the same package calls them).
import { AbstractDateCheckWithSuggestionsFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractDateCheckWithSuggestionsFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import type { Calendar } from '../../../../../../../jdk/java/util/Calendar.ts';
import { Integer_parseInt } from '../../../../../../../jdk/java/lang/Exceptions.ts';
import { DateFilterHelper } from './DateFilterHelper.ts';

/**
 * English localization of {@link AbstractDateCheckFilter}.
 * @since 2.7
 */
export class DateCheckFilter extends AbstractDateCheckWithSuggestionsFilter {

  private readonly dateFilterHelper = new DateFilterHelper();

  protected override getCalendar(): Calendar {
    return this.dateFilterHelper.getCalendar();
  }

  protected override getErrorMessageWrongYear(): string {
    return 'This date is wrong. Did you mean "{currentYear}"?';
  }

  override getDayOfWeek(dayStr: string): number;
  override getDayOfWeek(date: Calendar): string;
  override getDayOfWeek(arg: string | Calendar): number | string {
    return typeof arg === 'string' ? this.dateFilterHelper.getDayOfWeek(arg) : this.dateFilterHelper.getDayOfWeek(arg);
  }

  override getMonth(monthStr: string): number {
    return this.dateFilterHelper.getMonth(monthStr);
  }

  protected override getDayStrLikeOriginal(day: string, original: string): string {
    if (StringTools.isNumeric(original)) {
      return day;
    }
    const number = Integer_parseInt(day);
    if (number >= 11 && number <= 13) {
      return number + 'th';
    }
    switch (number % 10) {
      case 1:
        return number + 'st';
      case 2:
        return number + 'nd';
      case 3:
        return number + 'rd';
      default:
        return number + 'th';
    }
  }
}

FilterRegistry.register('org.languagetool.rules.en.DateCheckFilter', () => new DateCheckFilter());
