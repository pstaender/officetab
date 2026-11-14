// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RegexAntiPatternFilter.java faithful
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { RuleMatch } from '../RuleMatch.ts';
import { type Matcher, Pattern, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { RegexRuleFilter } from './RegexRuleFilter.ts';
import { FilterRegistry } from './registry.ts';

/**
 * Filters matches that match a regex. Limitations: 1. antipatterns cannot contain spaces,
 * 2. The pipe (|) is used to delimit several patterns and cannot be used inside a pattern.
 * @since 5.2
 */
export class RegexAntiPatternFilter extends RegexRuleFilter {

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, sentenceObj: AnalyzedSentence, _patternMatcher: Matcher): RuleMatch | null {
    const antiPatternStr = args.get('antipatterns');
    if (antiPatternStr == null) {
      throw new Error("RuntimeException: Missing 'antiPatterns:' in 'args' in <filter> of rule " + match.getRule().getFullId());
    }
    const antiPatterns = StringSplit(antiPatternStr, '\\|');
    for (const antiPattern of antiPatterns) {
      const p = Pattern.compile(antiPattern);
      const matcher = p.matcher(sentenceObj.getText());
      while (matcher.find()) {
        // partial overlap is enough to filter out a match:
        if (matcher.start() <= match.getToPos() && matcher.end() >= match.getToPos() ||
            matcher.start() <= match.getFromPos() && matcher.end() >= match.getFromPos()) {
          return null;
        }
      }
    }
    return match;
  }
}

FilterRegistry.register('org.languagetool.rules.patterns.RegexAntiPatternFilter', () => new RegexAntiPatternFilter());
