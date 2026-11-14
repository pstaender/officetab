// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RegexRuleFilterCreator.java reduced
// Reflection is the class registry in registry.ts (FilterRegistry); a class that is not
// registered throws FilterClassNotFound (see RuleFilterCreator). The constructor checks do not
// apply to registered factories.
import { FilterClassNotFound, FilterRegistry } from './registry.ts';
import { RegexRuleFilter } from './RegexRuleFilter.ts';
// The core filters, for their registration:
import './RegexAntiPatternFilter.ts';

/**
 * Create a {@link RegexRuleFilter}.
 * @since 5.2
 */
export class RegexRuleFilterCreator {

  /**
   * @param className fully qualified class Name of a class implementing {@link RegexRuleFilter}
   */
  getFilter(className: string): RegexRuleFilter {
    const aClass = FilterRegistry.forName(className);
    if (aClass == null) {
      throw new FilterClassNotFound(className);
    }
    const filter = aClass();
    if (filter instanceof RegexRuleFilter) {
      return filter;
    } else {
      throw new Error("RuntimeException: Filter class '" + className + "' must implement interface RegexRuleFilter");
    }
  }

}
