// SPDX-License-Identifier: MPL-2.0
// Not a port: the class registry standing in for Java's reflection
// (JLanguageTool.getClassBroker().forName(className) and Constructor.newInstance()) where rule
// files name a class, as <filter class="org.languagetool.rules.en.DateCheckFilter" args="..."/>.
// Every ported filter class registers itself at the end of its file:
//   FilterRegistry.register('org.languagetool.rules.patterns.ApostropheTypeFilter', () => new ApostropheTypeFilter());
// and must be imported (for that side effect) before rule files naming it are loaded: the core
// filters are imported by RuleFilterCreator / RegexRuleFilterCreator, a language's filters by the
// language module. A class that is not registered is reported by RuleFilterCreator as
// FilterClassNotFound, and the XML handlers skip the rule with a warning (see XMLRuleHandler).

const factories = new Map<string, () => object>();

export const FilterRegistry = {
  /** Registers a filter class under its fully qualified Java class name. */
  register(className: string, factory: () => object): void {
    factories.set(className, factory);
  },
  /** Class.forName(className) and newInstance(): null if the class is not registered (ported). */
  forName(className: string): (() => object) | null {
    return factories.get(className) ?? null;
  },
  /** The registered class names. */
  classNames(): string[] {
    return [...factories.keys()];
  },
};

/** ClassNotFoundException for a filter class nobody registered. */
export class FilterClassNotFound extends Error {
  readonly className: string;
  constructor(className: string) {
    super("Could not find filter class: '" + className + "' - make sure to use a fully qualified class name like 'org.languagetool.rules.MyFilter'");
    this.className = className;
  }
}
