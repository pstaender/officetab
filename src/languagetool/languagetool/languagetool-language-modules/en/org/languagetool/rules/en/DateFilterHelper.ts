// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/DateFilterHelper.java faithful
// The two getDayOfWeek overloads (String → int, Calendar → String) are one overloaded method.
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Calendar } from '../../../../../../../jdk/java/util/Calendar.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';

/**
 * @since 4.3
 */
export class DateFilterHelper {

  getCalendar(): Calendar {
    return Calendar.getInstance(Locale.UK);
  }

  getDayOfWeek(dayStr: string): number;
  getDayOfWeek(date: Calendar): string;
  getDayOfWeek(arg: string | Calendar): number | string {
    if (arg instanceof Calendar) {
      const date = arg;
      return date.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.LONG, Locale.UK)!;
    }
    const dayStr = arg;
    const day = StringTools.trimSpecialCharacters(dayStr).toLowerCase();
    if (day.startsWith('su')) return Calendar.SUNDAY;
    if (day.startsWith('mo')) return Calendar.MONDAY;
    if (day.startsWith('tu')) return Calendar.TUESDAY;
    if (day.startsWith('we')) return Calendar.WEDNESDAY;
    if (day.startsWith('th')) return Calendar.THURSDAY;
    if (day.startsWith('fr')) return Calendar.FRIDAY;
    if (day.startsWith('sa')) return Calendar.SATURDAY;
    throw new Error("RuntimeException: Could not find day of week for '" + dayStr + "'");
  }

  getMonth(monthStr: string): number {
    const mon = StringTools.trimSpecialCharacters(monthStr).toLowerCase();
    if (mon.startsWith('jan')) return 1;
    if (mon.startsWith('feb')) return 2;
    if (mon.startsWith('mar')) return 3;
    if (mon.startsWith('apr')) return 4;
    if (mon.startsWith('may')) return 5;
    if (mon.startsWith('jun')) return 6;
    if (mon.startsWith('jul')) return 7;
    if (mon.startsWith('aug')) return 8;
    if (mon.startsWith('sep')) return 9;
    if (mon.startsWith('oct')) return 10;
    if (mon.startsWith('nov')) return 11;
    if (mon.startsWith('dec')) return 12;
    throw new Error("RuntimeException: Could not find month '" + monthStr + "'");
  }
}
