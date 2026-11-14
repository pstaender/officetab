// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/CleanOverlappingFilter.java faithful
import type { Language } from '../Language.ts';
import { Premium } from '../Premium.ts';
import { Tag } from '../Tag.ts';
import type { RuleMatch } from './RuleMatch.ts';
import type { RuleMatchFilter } from './RuleMatchFilter.ts';
import { Character } from '../../../../../jdk/java/lang/Character.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/** Integer.MIN_VALUE */
const Integer_MIN_VALUE = -2147483648;

/*
 * Remove overlapping errors according to the priorities established for the language.
 * (It assumes the input list is ordered by start position)
 *
 * @since 3.6
 */
export class CleanOverlappingFilter implements RuleMatchFilter {

  private static readonly negativeConstant = Integer_MIN_VALUE + 10000;

  private readonly language: Language;
  private readonly hidePremiumMatches: boolean;

  constructor(lang: Language, hidePremiumMatches: boolean) {
    this.language = lang;
    this.hidePremiumMatches = hidePremiumMatches;
  }

  filter(ruleMatches: RuleMatch[]): RuleMatch[] {
    const cleanList: RuleMatch[] = [];
    let prevRuleMatch: RuleMatch | null = null;
    for (const ruleMatch of ruleMatches) {
      if (prevRuleMatch == null) {  // first item
        prevRuleMatch = ruleMatch;
        continue;
      }
      if (ruleMatch.getFromPos() < prevRuleMatch.getFromPos()) {
        throw new Error(
            'IllegalArgumentException: The list of rule matches is not ordered. Make sure it is sorted by start position. RuleMatch: '
              + ruleMatch + '; previous RuleMatch: ' + prevRuleMatch);
      }

      let isDuplicateSuggestion = false;
      if (ruleMatch.getSuggestedReplacements().length > 0
        && prevRuleMatch.getSuggestedReplacements().length > 0) {
        const suggestion = ruleMatch.getSuggestedReplacements()[0]!;
        const prevSuggestion = prevRuleMatch.getSuggestedReplacements()[0]!;
        // juxtaposed errors adding a comma in the same place
        if (ruleMatch.getFromPos() === prevRuleMatch.getToPos()) {
          if (prevSuggestion.endsWith(',') && suggestion.startsWith(', ')) {
            isDuplicateSuggestion = true;
          }
        }
        // duplicate suggestion for the same position
        if (suggestion.indexOf(' ') > 0 && prevSuggestion.indexOf(' ') > 0
          && ruleMatch.getFromPos() === prevRuleMatch.getToPos() + 1) {
          const parts = StringSplit(suggestion, ' ');
          const partsPrev = StringSplit(prevSuggestion, ' ');
          if (partsPrev.length > 1 && parts.length > 1 && partsPrev[1] === parts[0]) {
            isDuplicateSuggestion = true;
          }
        }
      }

      // no overlapping (juxtaposed errors are not removed)
      if (ruleMatch.getFromPos() >= prevRuleMatch.getToPos() && !isDuplicateSuggestion) {
        cleanList.push(prevRuleMatch);
        prevRuleMatch = ruleMatch;
        continue;
      }
      // overlapping
      let currentPriority = this.language.getRulePriority(ruleMatch.getRule());
      if (this.isPremiumRule(ruleMatch) && this.hidePremiumMatches) {
        // non-premium match should win, so the premium match does *not* become a hidden match
        // (we'd show hidden matches for errors covered by an Open Source match)
        currentPriority = Integer_MIN_VALUE;
      }
      if (ruleMatch.getRule().getTags().includes(Tag.picky) && currentPriority !== Integer_MIN_VALUE) {
        currentPriority += CleanOverlappingFilter.negativeConstant;
      }
      let prevPriority = this.language.getRulePriority(prevRuleMatch.getRule());
      if (this.isPremiumRule(prevRuleMatch) && this.hidePremiumMatches) {
        prevPriority = Integer_MIN_VALUE;
      }
      if (prevRuleMatch.getRule().getTags().includes(Tag.picky) && prevPriority !== Integer_MIN_VALUE) {
        prevPriority += CleanOverlappingFilter.negativeConstant;
      }
      // If both matches only change punctuation,
      // prefer the rule that participates in "correct all errors at once".
      const currentIsPunctuationOnly = this.isPunctuationOnlyChange(ruleMatch);
      const prevIsPunctuationOnly = this.isPunctuationOnlyChange(prevRuleMatch);
      if (currentIsPunctuationOnly && prevIsPunctuationOnly) {
        const currentIncludedAllAtOnce = ruleMatch.getRule().isIncludedInErrorsCorrectedAllAtOnce();
        const prevIncludedAllAtOnce = prevRuleMatch.getRule().isIncludedInErrorsCorrectedAllAtOnce();
        if (currentIncludedAllAtOnce !== prevIncludedAllAtOnce) {
          if (currentIncludedAllAtOnce) {
            if (currentPriority < prevPriority) {
              currentPriority = prevPriority + 1;
            }
          } else if (prevPriority < currentPriority) {
            prevPriority = currentPriority + 1;
          }
        }
      }
      if (currentPriority === prevPriority) {
        // take the longest error:
        currentPriority = ruleMatch.getToPos() - ruleMatch.getFromPos();
        prevPriority = prevRuleMatch.getToPos() - prevRuleMatch.getFromPos();
      }
      if (currentPriority === prevPriority) {
        currentPriority++; // take the last one (to keep the current results in the web UI)
      }
      if (currentPriority > prevPriority) {
        prevRuleMatch = ruleMatch;
      }
    }
    //last match
    if (prevRuleMatch != null) {
      cleanList.push(prevRuleMatch);
    }
    return cleanList;
  }

  protected isPremiumRule(ruleMatch: RuleMatch): boolean {
    return Premium.get().isPremiumRule(ruleMatch.getRule());
  }

  private isPunctuationOnlyChange(match: RuleMatch | null): boolean {
    if (match == null) {
      return false;
    }
    const suggestions = match.getSuggestedReplacements();
    if (suggestions == null || suggestions.length === 0) {
      return false;
    }
    const replacement = suggestions[0];
    if (replacement == null) {
      return false;
    }
    let original: string | null = match.getOriginalErrorStr();
    if (original == null || original.length === 0) {
      const sentenceStr = match.getSentence() != null ? match.getSentence()!.getText() : null;
      if (sentenceStr == null || sentenceStr.length === 0) {
        return false;
      }
      let from = match.getFromPosSentence();
      let to = match.getToPosSentence();
      if (from > -1 && to > -1 && to <= sentenceStr.length && from < to) {
        original = sentenceStr.substring(from, to);
      } else {
        from = match.getFromPos();
        to = match.getToPos();
        if (from > -1 && to > -1 && to <= sentenceStr.length && from < to) {
          original = sentenceStr.substring(from, to);
        } else {
          return false;
        }
      }
    }
    // if strings are identical, it's not a change at all
    if (replacement === original) {
      return false;
    }
    const normalizedOriginal = this.keepLettersAndDigits(original);
    const normalizedReplacement = this.keepLettersAndDigits(replacement);
    return normalizedOriginal === normalizedReplacement;
  }

  private keepLettersAndDigits(s: string): string {
    let sb = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (Character.isLetterOrDigit(ch)) {
        sb += ch;
      }
    }
    return sb;
  }

}
