// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/DateCheckFilter.java faithful
// The two getDayOfWeek overloads are one overloaded method. getDayOfWeek and getMonth are public
// here (protected in Java, where the test in the same package calls them).
import { AbstractDateCheckWithSuggestionsFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractDateCheckWithSuggestionsFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import type { Calendar } from '../../../../../../../jdk/java/util/Calendar.ts';
import { DateFilterHelper } from './DateFilterHelper.ts';

/**
 * German localization of {@link AbstractDateCheckFilter}.
 * @since 2.7
 */
export class DateCheckFilter extends AbstractDateCheckWithSuggestionsFilter {

  private readonly dateFilterHelper = new DateFilterHelper();

  protected override getCalendar(): Calendar {
    return this.dateFilterHelper.getCalendar();
  }

  override getDayOfWeek(dayStr: string): number;
  override getDayOfWeek(date: Calendar): string;
  override getDayOfWeek(arg: string | Calendar): number | string {
    return typeof arg === 'string' ? this.dateFilterHelper.getDayOfWeek(arg) : this.dateFilterHelper.getDayOfWeek(arg);
  }

  override getMonth(monthStr: string): number {
    return this.dateFilterHelper.getMonth(monthStr);
  }

  protected override getErrorMessageWrongYear(): string {
    return 'Dieses Datum stimmt nicht mit dem Tag überein. Meinten Sie "{currentYear}"?';
  }

  protected override adjustSuggestion(sugg: string): string {
    // So. vs Sonntag
    const dotCommaPos = sugg.indexOf('.,');
    if (dotCommaPos > 5 && dotCommaPos < 12) {
      // remove unnecessary dot
      return sugg.replaceAll('.,', ',');
    }
    const commaPos = sugg.indexOf(',');
    if (dotCommaPos < 0 && commaPos > 0 && commaPos < 5) {
      // add dot
      return sugg.replaceAll(',', '.,');
    }
    return sugg;
  }
}

FilterRegistry.register('org.languagetool.rules.de.DateCheckFilter', () => new DateCheckFilter());
