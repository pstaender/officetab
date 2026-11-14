// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RegexRuleFilterEvaluator.java faithful
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { RuleMatch } from '../RuleMatch.ts';
import { type Matcher, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import type { RegexRuleFilter } from './RegexRuleFilter.ts';

/**
 * Evaluates a {@link RegexRuleFilter} for {@link RegexPatternRule}s.
 * @since 5.2
 */
export class RegexRuleFilterEvaluator {

  private readonly filter: RegexRuleFilter;

  constructor(filter: RegexRuleFilter) {
    this.filter = filter;
  }

  runFilter(filterArgs: string, ruleMatch: RuleMatch, sentenceObj: AnalyzedSentence, patternMatcher: Matcher): RuleMatch | null {
    const args = this.getResolvedArguments(filterArgs);
    return this.filter.acceptRuleMatch(ruleMatch, args, sentenceObj, patternMatcher);
  }

  private getResolvedArguments(filterArgs: string): Map<string, string> {
    const result = new Map<string, string>();
    const args = StringSplit(filterArgs, '\\s+');
    for (const arg of args) {
      const delimPos = arg.indexOf(':');
      if (delimPos === -1) {
        throw new Error("RuntimeException: Invalid syntax for key/value, expected 'key:value', got: '" + arg + "'");
      }
      const key = arg.substring(0, delimPos);
      const val = arg.substring(delimPos + 1);
      result.set(key, val);
    }
    return result;
  }
}
