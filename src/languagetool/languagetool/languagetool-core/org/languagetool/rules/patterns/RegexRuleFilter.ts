// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RegexRuleFilter.java faithful
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { RuleMatch } from '../RuleMatch.ts';
import type { Matcher } from '../../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Filter rule matches after a RegexPatternRule has matched already.
 * Can be used from the XML using the {@code filter} element.
 * @since 5.2
 */
export abstract class RegexRuleFilter {

  /**
   * Returns the original rule match or a modified one, or {@code null}
   * if the rule match is filtered out.
   * @param arguments the resolved argument from the {@code args} attribute in the XML.
   * @return {@code null} if this rule match should be removed, or any other RuleMatch (e.g. the one from
   *         the arguments) that properly describes the detected error
   */
  abstract acceptRuleMatch(match: RuleMatch, args: Map<string, string>, sentenceObj: AnalyzedSentence, patternMatcher: Matcher): RuleMatch | null;

}
