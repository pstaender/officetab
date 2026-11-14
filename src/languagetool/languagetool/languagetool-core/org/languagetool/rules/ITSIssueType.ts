// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/ITSIssueType.java faithful
// An enum with a field: a class with static instances.

/**
 * Some constants for Localization Quality Issue Type from the
 * Internationalization Tag Set (ITS) Version 2.0. Note that this class is
 * internal to LanguageTool, it is public only for technical reasons.
 *
 * @see <a href="http://www.w3.org/International/multilingualweb/lt/drafts/its20/its20.html#lqissue-typevalues">ITS 2.0</a>
 * @since 2.5
 */
export class ITSIssueType {

  private static readonly VALUES: ITSIssueType[] = [];

  static readonly Terminology = new ITSIssueType('Terminology');
  static readonly Mistranslation = new ITSIssueType('Mistranslation');
  static readonly Omission = new ITSIssueType('Omission');
  static readonly Untranslated = new ITSIssueType('Untranslated');
  static readonly Addition = new ITSIssueType('Addition');
  static readonly Duplication = new ITSIssueType('Duplication');
  static readonly Inconsistency = new ITSIssueType('Inconsistency');
  static readonly Grammar = new ITSIssueType('Grammar');
  static readonly Legal = new ITSIssueType('Legal');
  static readonly Register = new ITSIssueType('Register');
  static readonly LocaleSpecificContent = new ITSIssueType('LocaleSpecificContent', 'locale-specific-content');
  static readonly LocaleViolation = new ITSIssueType('LocaleViolation', 'locale-violation');
  static readonly Style = new ITSIssueType('Style');
  static readonly Characters = new ITSIssueType('Characters');
  static readonly Misspelling = new ITSIssueType('Misspelling');
  static readonly Typographical = new ITSIssueType('Typographical');
  static readonly Formatting = new ITSIssueType('Formatting');
  static readonly InconsistentEntities = new ITSIssueType('InconsistentEntities', 'inconsistent-entities');
  static readonly Numbers = new ITSIssueType('Numbers');
  static readonly Markup = new ITSIssueType('Markup');
  static readonly PatternProblem = new ITSIssueType('PatternProblem', 'pattern-problem');
  static readonly Whitespace = new ITSIssueType('Whitespace');
  static readonly Internationalization = new ITSIssueType('Internationalization');
  static readonly Length = new ITSIssueType('Length');
  static readonly NonConformance = new ITSIssueType('NonConformance', 'non-conformance');
  static readonly Uncategorized = new ITSIssueType('Uncategorized');
  static readonly Other = new ITSIssueType('Other');

  static values(): ITSIssueType[] {
    return [...ITSIssueType.VALUES];
  }

  static getIssueType(name: string): ITSIssueType {
    for (const issueType of ITSIssueType.values()) {
      if (issueType.toString() === name) {
        return issueType;
      }
    }
    throw new Error("IllegalArgumentException: No IssueType found for name '" + name + "'. Valid values: [" + ITSIssueType.values().join(', ') + ']');
  }

  private readonly constantName: string;
  private readonly name: string;

  private constructor(constantName: string, name: string = constantName) {
    this.constantName = constantName;
    this.name = name;
    ITSIssueType.VALUES.push(this);
  }

  /** Enum.name() */
  getName(): string {
    return this.constantName;
  }

  /**
   * Use this to get the name as it is used in the ITS 2.0 standard
   * (namely lowercase and with hyphens, not camel case)
   */
  toString(): string {
    return this.name.toLowerCase();
  }

}
