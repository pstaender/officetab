// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/RuleWithMaxFilter.java faithful
// Collections.sort(ruleMatches) uses RuleMatch.compareTo (by fromPos), a stable sort as Java's.
import type { AnnotatedText } from '../markup/AnnotatedText.ts';
import { AbstractPatternRule } from './patterns/AbstractPatternRule.ts';
import type { RuleMatch } from './RuleMatch.ts';
import type { RuleMatchFilter } from './RuleMatchFilter.ts';

/**
 * Filter rule matches so that only the longest match is kept for matches
 * of the same rule (and sub rule) that overlap.
 */
export class RuleWithMaxFilter implements RuleMatchFilter {

  filter(ruleMatches: RuleMatch[], _text?: AnnotatedText | null): RuleMatch[] {
    ruleMatches.sort((a, b) => a.compareTo(b));
    const filteredRules: RuleMatch[] = [];
    for (let i = 0; i < ruleMatches.length; i++) {
      const match = ruleMatches[i]!;
      if (i < ruleMatches.length - 1) {
        let nextMatch = ruleMatches[i + 1]!;
        while (this.includes(match, nextMatch) && this.haveSameRule(match, nextMatch)
            && i < ruleMatches.length) {
          i++;  // skip next match
          if (i < ruleMatches.length - 1) {
            nextMatch = ruleMatches[i + 1]!;
          }
        }
      }
      filteredRules.push(match);
    }
    return filteredRules;
  }

  includes(match: RuleMatch, nextMatch: RuleMatch): boolean {
    if (match.getFromPos() <= nextMatch.getFromPos() && match.getToPos() >= nextMatch.getToPos()) {
      return true;
    }
    return false;
  }

  private haveSameRule(match: RuleMatch, nextMatch: RuleMatch): boolean {
    const rule = match.getRule(), nextRule = nextMatch.getRule();
    if (!(rule instanceof AbstractPatternRule) || !(nextRule instanceof AbstractPatternRule)) {
      return false;
    }
    const id1 = rule.getId();
    const subId1 = rule.getSubId();
    const subId2 = nextRule.getSubId();
    if (subId1 == null && subId2 != null) {
      return false;
    }
    if (subId1 != null && subId2 == null) {
      return false;
    }
    return id1 != null && id1 === nextRule.getId() &&
        (subId1 == null && subId2 == null || subId1 != null && subId1 === subId2);
  }

}
