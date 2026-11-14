// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternTokenMatcher.java faithful
import type { AnalyzedToken } from '../../AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { Language } from '../../Language.ts';
import type { PatternToken } from './PatternToken.ts';

/**
 * @since 2.3
 */
export class PatternTokenMatcher {

  private readonly basePatternToken: PatternToken;

  private patternToken: PatternToken;
  private andGroup: PatternTokenMatcher[] | null = null;
  private andGroupCheck: boolean[] = [];

  constructor(patternToken: PatternToken) {
    this.basePatternToken = patternToken;
    this.patternToken = this.basePatternToken;
    if (this.basePatternToken.hasAndGroup()) {
      const patternTokenAndGroup = this.basePatternToken.getAndGroup();
      this.andGroup = [];
      for (const el of patternTokenAndGroup) {
        const matcher = new PatternTokenMatcher(el);
        this.andGroup.push(matcher);
      }
    }
  }

  resolveReference(firstMatchToken: number,
      tokens: AnalyzedTokenReadings[], language: Language): void {
    if (this.basePatternToken.isReferenceElement()) {
      const refPos = firstMatchToken + this.basePatternToken.getMatch()!.getTokenRef();
      if (refPos < tokens.length) {
        this.patternToken = this.basePatternToken.compile(tokens[refPos]!, language.getSynthesizer());
      }
    }
  }

  getPatternToken(): PatternToken {
    return this.basePatternToken;
  }

  /**
   * Checks whether the rule element matches the token given as a parameter.
   *
   * @param token AnalyzedToken to check matching against
   * @return True if token matches, false otherwise.
   */
  isMatched(token: AnalyzedToken): boolean {
    const matched = this.patternToken.isMatched(token);
    if (this.patternToken.hasAndGroup()) {
      this.andGroupCheck[0] = this.andGroupCheck[0]! || matched;
    }
    return matched;
  }

  prepareAndGroup(firstMatchToken: number, tokens: AnalyzedTokenReadings[], language: Language): void {
    if (this.basePatternToken.hasAndGroup()) {
      for (const andMatcher of this.andGroup!) {
        andMatcher.resolveReference(firstMatchToken, tokens, language);
      }
      this.andGroupCheck = new Array<boolean>(this.patternToken.getAndGroup().length + 1);
      this.andGroupCheck.fill(false);
    }
  }

  /**
   * Enables testing multiple conditions specified by different elements.
   * Doesn't test exceptions.
   *
   * Works as logical AND operator only if preceded with
   * {@link #prepareAndGroup(int, AnalyzedTokenReadings[], Language)}, and followed by {@link #checkAndGroup(boolean)}
   *
   * @param token the token checked.
   */
  addMemberAndGroup(token: AnalyzedToken): void {
    if (this.patternToken.hasAndGroup()) {
      const andGroupList = this.andGroup!;
      for (let i = 0; i < andGroupList.length; i++) {
        if (!this.andGroupCheck[i + 1]) {
          const testAndGroup = andGroupList[i]!;
          if (testAndGroup.isMatched(token)) {
            this.andGroupCheck[i + 1] = true;
          }
        }
      }
    }
  }

  checkAndGroup(previousValue: boolean): boolean {
    if (this.patternToken.hasAndGroup()) {
      let allConditionsMatch = true;
      for (const testValue of this.andGroupCheck) {
        allConditionsMatch = allConditionsMatch && testValue;
      }
      return allConditionsMatch;
    }
    return previousValue;
  }

  isMatchedByScopeNextException(token: AnalyzedToken): boolean {
    return this.patternToken.isMatchedByScopeNextException(token);
  }

  isExceptionMatchedCompletely(token: AnalyzedToken): boolean {
    return this.patternToken.isExceptionMatchedCompletely(token);
  }

  hasPreviousException(): boolean {
    return this.patternToken.hasPreviousException();
  }

  isMatchedByPreviousException(token: AnalyzedTokenReadings): boolean {
    return this.patternToken.isMatchedByPreviousException(token);
  }

  toString(): string {
    return 'PatternTokenMatcher for ' + this.basePatternToken.toString();
  }
}
