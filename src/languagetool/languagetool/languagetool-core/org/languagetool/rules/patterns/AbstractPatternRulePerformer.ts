// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/AbstractPatternRulePerformer.java faithful
// Java's non-short-circuit &= and |= keep evaluating their right side here too. The maps keyed by
// PatternToken use identity, as Java's (PatternToken has no equals).
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { AnalyzedToken } from '../../AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import { List_contains, Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';
import { StringMatches } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import type { AbstractTokenBasedRule } from './AbstractTokenBasedRule.ts';
import type { PatternToken } from './PatternToken.ts';
import { PatternTokenMatcher } from './PatternTokenMatcher.ts';
import type { Unifier } from './Unifier.ts';

export type MatchConsumer = (tokenPositions: number[],
                             firstMatchToken: number,
                             lastMatchToken: number, firstMarkerMatchToken: number, lastMarkerMatchToken: number) => void;

/**
 * @since 2.3
 */
export abstract class AbstractPatternRulePerformer {

  protected prevMatched = false;
  protected rule: AbstractTokenBasedRule;
  protected unifier: Unifier;
  protected unifiedTokens: AnalyzedTokenReadings[] | null = null;
  private readonly patternTokenMatchers: PatternTokenMatcher[];
  private readonly patternSize: number;
  private readonly minOccurCorrection: number;
  private readonly toUnify: Map<PatternToken, AnalyzedToken[][]> | null;
  private readonly neutralReadings: Map<PatternToken, AnalyzedTokenReadings[]> | null;

  protected constructor(rule: AbstractTokenBasedRule, unifier: Unifier) {
    this.rule = Objects_requireNonNull(rule);
    this.unifier = Objects_requireNonNull(unifier);
    this.patternTokenMatchers = this.createElementMatchers();
    this.patternSize = this.patternTokenMatchers.length;
    this.minOccurCorrection = this.getMinOccurrenceCorrection();
    this.toUnify = rule.isTestUnification() ? new Map() : null;
    this.neutralReadings = rule.isTestUnification() ? new Map() : null;
  }

  private createElementMatchers(): PatternTokenMatcher[] {
    const patternTokenMatchers: PatternTokenMatcher[] = [];
    for (const pToken of this.rule.patternTokens!) {
      const matcher = new PatternTokenMatcher(pToken);
      patternTokenMatchers.push(matcher);
    }
    return patternTokenMatchers;
  }

  protected doMatch(sentence: AnalyzedSentence, tokens: AnalyzedTokenReadings[], consumer: MatchConsumer): void {
    const anchor = this.rule.anchorHint;
    const anchorIndices = anchor == null || this.isInterpretPosTagsPreDisambiguation() ? null : anchor.getPossibleIndices(sentence);

    const tokenPositions: number[] = new Array<number>(this.patternTokenMatchers.length).fill(0);
    const limit = this.rule.isSentStart() ? 1 : Math.max(0, tokens.length - this.patternSize + 1) + this.minOccurCorrection;
    if (anchorIndices != null) {
      for (const anchorIndex of anchorIndices) {
        const i = anchorIndex - anchor!.tokenIndex;
        if (i >= 0 && i < limit) {
          this.matchFrom(i, tokens, consumer, tokenPositions);
        }
      }
    } else {
      for (let i = 0; i < limit; i++) {
        this.matchFrom(i, tokens, consumer, tokenPositions);
      }
    }
  }

  private matchFrom(startIndex: number, tokens: AnalyzedTokenReadings[], consumer: MatchConsumer, tokenPositions: number[]): void {
    let pTokenMatcher: PatternTokenMatcher | null = null;
    let skipShiftTotal = 0;
    let allElementsMatch = false;
    this.unifiedTokens = null;
    let matchingTokens = 0;
    let firstMatchToken = -1;
    let lastMatchToken = -1;
    let firstMarkerMatchToken = -1;
    let lastMarkerMatchToken = -1;
    let prevSkipNext = 0;
    if (this.toUnify != null) {
      this.toUnify.clear();
      Objects_requireNonNull(this.neutralReadings).clear();
    }
    let minOccurSkip = 0;
    for (let k = 0; k < this.patternSize; k++) {
      const prevTokenMatcher = pTokenMatcher;
      pTokenMatcher = this.patternTokenMatchers[k]!;
      pTokenMatcher.resolveReference(firstMatchToken, tokens, this.rule.getLanguage());
      const nextPos = startIndex + k + skipShiftTotal - minOccurSkip;
      this.prevMatched = false;
      if (prevSkipNext + nextPos >= tokens.length || prevSkipNext < 0) { // SENT_END?
        prevSkipNext = tokens.length - (nextPos + 1);
      }
      const maxTok = Math.min(nextPos + prevSkipNext, tokens.length - (this.patternSize - k) + this.minOccurCorrection);
      for (let m = nextPos; m <= maxTok; m++) {
        allElementsMatch = this.testAllReadings(tokens, pTokenMatcher, prevTokenMatcher, m, firstMatchToken, prevSkipNext);

        if (pTokenMatcher.getPatternToken().getMinOccurrence() === 0) {
          let foundNext = false;
          for (let k2 = k + 1; k2 < this.patternSize; k2++) {
            const nextElement = this.patternTokenMatchers[k2]!;
            const nextElementMatch = this.testAllReadings(tokens, nextElement, pTokenMatcher, m,
              firstMatchToken, prevSkipNext);
            if (nextElementMatch) {
              // this element doesn't match, but it's optional so accept this and continue
              allElementsMatch = true;
              minOccurSkip++;
              tokenPositions[matchingTokens++] = 0;
              foundNext = true;
              break;
            } else if (nextElement.getPatternToken().getMinOccurrence() > 0) {
              break;
            }
          }
          if (foundNext) {
            break;
          }
        }

        if (allElementsMatch) {
          const skipForMax = this.skipMaxTokens(tokens, pTokenMatcher, firstMatchToken, prevSkipNext,
            prevTokenMatcher, m, this.patternSize - k - 1);
          lastMatchToken = m + skipForMax;
          const skipShift = lastMatchToken - nextPos;
          tokenPositions[matchingTokens++] = skipShift + 1;
          prevSkipNext = this.translateElementNo(pTokenMatcher.getPatternToken().getSkipNext());
          skipShiftTotal += skipShift;
          if (firstMatchToken === -1) {
            firstMatchToken = lastMatchToken - skipForMax;
          }
          if (firstMarkerMatchToken === -1 && pTokenMatcher.getPatternToken().isInsideMarker()) {
            firstMarkerMatchToken = lastMatchToken - skipForMax;
          }
          if (pTokenMatcher.getPatternToken().isInsideMarker()) {
            lastMarkerMatchToken = lastMatchToken;
          }
          break;
        }
      }
      if (!allElementsMatch) {
        break;
      }
    }
    if (allElementsMatch && matchingTokens === this.patternSize && this.testUnification()) {
      consumer(tokenPositions, firstMatchToken, lastMatchToken, firstMarkerMatchToken, lastMarkerMatchToken);
    }
  }

  protected isInterpretPosTagsPreDisambiguation(): boolean {
    const rule = this.rule as AbstractTokenBasedRule & { isInterpretPosTagsPreDisambiguation?: () => boolean };
    // rule instanceof PatternRule && ((PatternRule) rule).isInterpretPosTagsPreDisambiguation()
    return typeof rule.isInterpretPosTagsPreDisambiguation === 'function' && rule.isInterpretPosTagsPreDisambiguation();
  }

  protected testAllReadings(tokens: AnalyzedTokenReadings[],
                            matcher: PatternTokenMatcher, prevElement: PatternTokenMatcher | null,
                            tokenNo: number, firstMatchToken: number, prevSkipNext: number): boolean {
    let anyMatched = false;
    const numberOfReadings = tokens[tokenNo]!.getReadingsLength();
    matcher.prepareAndGroup(firstMatchToken, tokens, this.rule.getLanguage());

    const readingsToUnify: AnalyzedToken[] | null = this.toUnify == null ? null : [];

    for (let i = 0; i < numberOfReadings; i++) {
      const matchToken = tokens[tokenNo]!.getAnalyzedToken(i);
      this.prevMatched = this.prevMatched || prevSkipNext > 0
          && prevElement != null
          && prevElement.isMatchedByScopeNextException(matchToken);

      // a workaround to allow exception with scope="next" without "skip" in previous token
      // this allows to check for exception in the next token even if the current one is the last one in the sentence
      this.prevMatched = this.prevMatched || prevSkipNext === 0
          && tokenNo <= tokens.length - 2
          && matcher.isMatchedByScopeNextException(tokens[tokenNo + 1]!.getAnalyzedToken(0));

      if (this.prevMatched) {
        return false;
      }

      let readingTested = false;
      let readingMatches = false;

      if (!anyMatched) {
        anyMatched = readingMatches = matcher.isMatched(matchToken);
        readingTested = true;
      }

      //short-circuit when the search cannot possibly match
      if (!anyMatched && (prevElement == null || !prevElement.getPatternToken().hasCurrentOrNextExceptions())) {
        if (matcher.getPatternToken().getPOStag() == null) {
          if (matcher.getPatternToken().isInflected()) {
            if (tokens[tokenNo]!.hasSameLemmas()) {
              return false; // same lemmas everywhere
            }
          } else {
            return false; // the token is the same, we will not get a match
          }
        } else if (!matcher.getPatternToken().getPOSNegation() // postag =! null
            && !tokens[tokenNo]!.isTagged()) {
          return false; // we won't find any postag here anyway
        }
      }
      if (this.rule.isGroupsOrUnification()) {
        if (!readingTested) {
          readingMatches = matcher.isMatched(matchToken);
        }

        const isLastReading = i + 1 === numberOfReadings;
        const elem = matcher.getPatternToken();
        if (readingMatches && readingsToUnify != null && elem.isUnified() && !elem.isUnificationNeutral()) {
          readingsToUnify.push(matchToken);
        }
        const andGroupMatches = AbstractPatternRulePerformer.testAndGroup(isLastReading, matchToken, matcher);
        anyMatched = anyMatched && andGroupMatches;
      }
    }
    if (anyMatched) {
      for (let i = 0; i < numberOfReadings; i++) {
        if (matcher.isExceptionMatchedCompletely(tokens[tokenNo]!.getAnalyzedToken(i))) {
          return false;
        }
      }
      if (tokenNo > 0 && matcher.hasPreviousException()) {
        if (matcher.isMatchedByPreviousException(tokens[tokenNo - 1]!)) {
          return false;
        }
      }
      if (matcher.getPatternToken().isUnificationNeutral() && this.neutralReadings != null) {
        computeIfAbsent(this.neutralReadings, matcher.getPatternToken()).push(tokens[tokenNo]!);
      }
    }
    const chunkTag = matcher.getPatternToken().getChunkTag();
    if (chunkTag != null) {
      if (chunkTag.isRegexp()) {
        anyMatched = anyMatched && (tokens[tokenNo]!.getChunkTags().some((k) => StringMatches(k.getChunkTag(), chunkTag.getChunkTag()))
                        !== matcher.getPatternToken().getNegation());
      } else {
        anyMatched = anyMatched && (List_contains(tokens[tokenNo]!.getChunkTags(), chunkTag)
                        !== matcher.getPatternToken().getNegation());
      }
    }
    if (matcher.getPatternToken().hasAndGroup()) {
      for (const e of matcher.getPatternToken().getAndGroup()) {
        if (e.getChunkTag() != null) {
          anyMatched = anyMatched && (List_contains(tokens[tokenNo]!.getChunkTags(), e.getChunkTag())
              !== e.getNegation());
        }
      }
    }
    if (anyMatched && readingsToUnify != null && readingsToUnify.length !== 0) {
      computeIfAbsent(this.toUnify!, matcher.getPatternToken()).push(readingsToUnify);
    }
    return anyMatched;
  }

  private testUnification(): boolean {
    if (this.toUnify == null || this.neutralReadings == null) return true;

    this.unifier.reset();

    for (const matcher of this.patternTokenMatchers) {
      const patternToken = matcher.getPatternToken();
      const neutral = this.neutralReadings.get(patternToken);
      if (neutral != null) {
        for (const atr of neutral) {
          this.unifier.addNeutralElement(atr);
        }
        continue;
      }

      const readingSets = this.toUnify.get(patternToken);
      if (readingSets == null) continue;

      for (const readings of readingSets) {
        let anyMatched = false;
        for (let i = 0; i < readings.length; i++) {
          const unified = this.unifier.isUnified(readings[i]!, patternToken.getUniFeatures(), i === readings.length - 1);
          anyMatched = anyMatched || unified;
        }
        if (patternToken.isUniNegated() && anyMatched) {
          return false;
        }
        if (patternToken.isLastInUnification() && readings === readingSets[readingSets.length - 1]) {
          if (!anyMatched && !patternToken.isUniNegated()) {
            return false;
          }
          if (this.rule.isGetUnified()) {
            this.unifiedTokens = this.unifier.getFinalUnified();
            //try {
            //  unifiedTokens = unifier.getFinalUnified();
            //} catch (Exception e) {
            //  System.out.println("Crashing rule: " + rule.getFullId());
            //  throw e;
            //}
          }
          this.unifier.reset();
        }
      }
    }

    return true;
  }

  private static testAndGroup(lastReading: boolean, matchToken: AnalyzedToken, elemMatcher: PatternTokenMatcher): boolean {
    elemMatcher.addMemberAndGroup(matchToken);
    return !lastReading || elemMatcher.checkAndGroup(true);
  }

  private getMinOccurrenceCorrection(): number {
    let minOccurCorrection = 0;
    for (const patternToken of this.rule.getPatternTokens()!) {
      if (patternToken.getMinOccurrence() === 0) {
        minOccurCorrection++;
      }
    }
    return minOccurCorrection;
  }

  private skipMaxTokens(tokens: AnalyzedTokenReadings[], elem: PatternTokenMatcher, firstMatchToken: number, prevSkipNext: number, prevElement: PatternTokenMatcher | null, m: number, remainingElems: number): number {
    let maxSkip = 0;
    const maxOccurrences = elem.getPatternToken().getMaxOccurrence() === -1 ? Number.MAX_SAFE_INTEGER : elem.getPatternToken().getMaxOccurrence();
    for (let j = 1; j < maxOccurrences && m + j < tokens.length - remainingElems; j++) {
      const nextAllElementsMatch = this.testAllReadings(tokens, elem, prevElement, m + j, firstMatchToken, prevSkipNext);
      if (nextAllElementsMatch) {
        maxSkip++;
      } else {
        break;
      }
    }
    return maxSkip;
  }

  translateElementNo(i: number): number {
    return i;
  }
}

/** Map.computeIfAbsent(key, __ -> new ArrayList<>()) */
function computeIfAbsent<K, V>(map: Map<K, V[]>, key: K): V[] {
  let list = map.get(key);
  if (list === undefined) {
    list = [];
    map.set(key, list);
  }
  return list;
}
