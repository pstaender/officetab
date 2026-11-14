// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/FutureDateFilter.java faithful
import { AbstractFutureDateFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractFutureDateFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import type { Calendar } from '../../../../../../../jdk/java/util/Calendar.ts';
import { DateFilterHelper } from './DateFilterHelper.ts';

/**
 * @since 4.3
 */
export class FutureDateFilter extends AbstractFutureDateFilter {

  private readonly dateFilterHelper = new DateFilterHelper();

  protected override getMonth(localizedMonth: string): number {
    return this.dateFilterHelper.getMonth(localizedMonth);
  }

  protected override getCalendar(): Calendar {
    return this.dateFilterHelper.getCalendar();
  }
}

FilterRegistry.register('org.languagetool.rules.de.FutureDateFilter', () => new FutureDateFilter());
