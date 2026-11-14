// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SameRuleGroupFilter.java faithful
import type { RuleMatch } from './RuleMatch.ts';
import type { RuleMatchFilter } from './RuleMatchFilter.ts';

/**
 * Filter rule matches so that only the first match is kept from overlapping
 * matches with the same rule group (actually: the same id).
 * @since 1.8
 */
export class SameRuleGroupFilter implements RuleMatchFilter {

  /**
   * @param ruleMatches list of matches
   */
  filter(ruleMatches: RuleMatch[]): RuleMatch[] {
    ruleMatches.sort((a, b) => a.compareTo(b));
    const filteredRules: RuleMatch[] = [];
    for (let i = 0; i < ruleMatches.length; i++) {
      const match = ruleMatches[i]!;
      while (i < ruleMatches.length - 1 && this.overlapAndMatch(match, ruleMatches[i + 1]!)) {
        i++;  // skip next match
      }
      filteredRules.push(match);
    }
    return filteredRules;
  }

  private overlapAndMatch(match: RuleMatch, nextMatch: RuleMatch): boolean {
    return this.overlaps(match, nextMatch) && this.haveSameRuleGroup(match, nextMatch);
  }

  overlaps(match: RuleMatch, nextMatch: RuleMatch): boolean {
    if (match.getFromPos() <= nextMatch.getToPos() && match.getToPos() >= nextMatch.getFromPos()) {
      return true;
    }
    return false;
  }

  private haveSameRuleGroup(match: RuleMatch, nextMatch: RuleMatch): boolean {
    const id1 = match.getRule().getId();
    return id1 != null && id1 === nextMatch.getRule().getId();
  }

}
