// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/CheckResults.java faithful
import type { RuleMatch } from './rules/RuleMatch.ts';
import type { Range } from './Range.ts';
import type { ExtendedSentenceRange } from './ExtendedSentenceRange.ts';
import type { SentenceRange } from './SentenceRange.ts';
import { Objects_requireNonNull } from '../../../../jdk/java/util/Objects.ts';

/**
 * @since 5.3
 */
export class CheckResults {

  private ruleMatches: RuleMatch[];
  private readonly ignoredRanges: Range[];
  private readonly extendedSentenceRanges: ExtendedSentenceRange[];
  private readonly sentenceRanges: SentenceRange[] = [];


  constructor(ruleMatches: RuleMatch[], ignoredRanges: Range[], extendedSentenceRanges: ExtendedSentenceRange[] = []) {
    this.ruleMatches = Objects_requireNonNull(ruleMatches);
    this.ignoredRanges = Objects_requireNonNull(ignoredRanges);
    this.extendedSentenceRanges = Objects_requireNonNull([...extendedSentenceRanges].sort((a, b) => a.compareTo(b)));
  }

  getSentenceRanges(): readonly SentenceRange[] {
    return this.sentenceRanges;
  }

  addSentenceRanges(sentenceRanges: readonly SentenceRange[]): void {
    this.sentenceRanges.push(...sentenceRanges);
  }

  getRuleMatches(): RuleMatch[] { return this.ruleMatches; }

  getIgnoredRanges(): Range[] { return this.ignoredRanges; }

  getExtendedSentenceRanges(): ExtendedSentenceRange[] { return this.extendedSentenceRanges; }

  setRuleMatches(ruleMatches: RuleMatch[]): void {
    this.ruleMatches = Objects_requireNonNull(ruleMatches);
  }
}
