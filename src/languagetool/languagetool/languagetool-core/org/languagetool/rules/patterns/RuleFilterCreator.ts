// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RuleFilterCreator.java reduced
// Reflection is the class registry in registry.ts (FilterRegistry): a filter class is found by
// its Java class name if its port has registered itself. Java throws a RuntimeException for a
// class it cannot find, which aborts loading the whole rule file; here getFilter throws
// FilterClassNotFound, which the XML handlers catch to skip just that rule, with a warning
// (filters of other languages and modules are ported separately). The constructor checks
// (exactly one constructor, without arguments) do not apply to registered factories.
import { FilterClassNotFound, FilterRegistry } from './registry.ts';
import { RuleFilter } from './RuleFilter.ts';
// The core filters, for their registration:
import './ApostropheTypeFilter.ts';

/**
 * Create a {@link RuleFilter}.
 * @since 2.7 (public since 3.2)
 */
export class RuleFilterCreator {

  private static readonly INSTANCE = new RuleFilterCreator();

  private readonly myFilterCache = new Map<string, RuleFilter>();

  private constructor() {
  }

  /**
   * @param className fully qualified class Name of a class implementing {@link RuleFilter}
   */
  getFilter(className: string): RuleFilter {
    const aClass = FilterRegistry.forName(className);
    if (aClass == null) {
      throw new FilterClassNotFound(className);
    }
    let filter = this.myFilterCache.get(className);
    if (filter === undefined) {
      const created = aClass();
      if (created instanceof RuleFilter) {
        filter = created;
      } else {
        throw new Error("RuntimeException: Filter class '" + className + "' must implement interface RuleFilter");
      }
      this.myFilterCache.set(className, filter);
    }
    return filter;
  }

  static getInstance(): RuleFilterCreator {
    return RuleFilterCreator.INSTANCE;
  }
}
