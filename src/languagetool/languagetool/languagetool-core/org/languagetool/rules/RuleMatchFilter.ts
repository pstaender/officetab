// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/RuleMatchFilter.java faithful
// The two filter methods (the deprecated one without the text, and the one with it, which calls
// the other by default) are one method with an optional text.
import type { AnnotatedText } from '../markup/AnnotatedText.ts';
import type { RuleMatch } from './RuleMatch.ts';

/**
 * Filter rule matches.
 *
 * @since 1.8
 */
export interface RuleMatchFilter {

  /**
   * @since 4.7
   * post-processing of rule matches
   * @param ruleMatches matches to transform/filter
   * @param text corresponding text
   * @return transformed matches
   */
  filter(ruleMatches: RuleMatch[], text?: AnnotatedText | null): RuleMatch[];

}
