// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/CheckResults.java partial
// Left out: the sentence ranges (getSentenceRanges, addSentenceRanges), which only check2 fills.
import type { RuleMatch } from './rules/RuleMatch.ts';
import type { Range } from './Range.ts';
import type { ExtendedSentenceRange } from './ExtendedSentenceRange.ts';
import { Objects_requireNonNull } from '../../../../jdk/java/util/Objects.ts';

/**
 * @since 5.3
 */
export class CheckResults {

  private ruleMatches: RuleMatch[];
  private readonly ignoredRanges: Range[];
  private readonly extendedSentenceRanges: ExtendedSentenceRange[];

  constructor(ruleMatches: RuleMatch[], ignoredRanges: Range[], extendedSentenceRanges: ExtendedSentenceRange[] = []) {
    this.ruleMatches = Objects_requireNonNull(ruleMatches);
    this.ignoredRanges = Objects_requireNonNull(ignoredRanges);
    this.extendedSentenceRanges = Objects_requireNonNull([...extendedSentenceRanges].sort((a, b) => a.compareTo(b)));
  }

  getRuleMatches(): RuleMatch[] { return this.ruleMatches; }

  getIgnoredRanges(): Range[] { return this.ignoredRanges; }

  getExtendedSentenceRanges(): ExtendedSentenceRange[] { return this.extendedSentenceRanges; }

  setRuleMatches(ruleMatches: RuleMatch[]): void {
    this.ruleMatches = Objects_requireNonNull(ruleMatches);
  }
}
