// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RuleFilterEvaluator.java faithful
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../RuleMatch.ts';
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { parseJavaInt, type RuleFilter } from './RuleFilter.ts';

let WHITESPACE: Pattern | null = null;

/**
 * Evaluates a {@link RuleFilter}.
 * @since 2.7 (public since 3.2)
 */
export class RuleFilterEvaluator {

  private readonly filter: RuleFilter;

  constructor(filter: RuleFilter) {
    this.filter = filter;
  }

  runFilter(filterArgs: string, ruleMatch: RuleMatch, patternTokens: AnalyzedTokenReadings[], patternTokenPos: number, tokenPositions: number[]): RuleMatch | null {
    const args = this.getResolvedArguments(filterArgs, patternTokens, patternTokenPos, tokenPositions);
    return this.filter.acceptRuleMatch(ruleMatch, args, patternTokenPos, patternTokens, tokenPositions);
  }

  /**
   * Resolves the backref arguments, e.g. replaces {@code \1} by the value of the first token in the pattern.
   */
  getResolvedArguments(filterArgs: string, patternTokens: AnalyzedTokenReadings[], _patternTokenPos: number, tokenPositions: number[]): Map<string, string> {
    const result = new Map<string, string>();
    const args = (WHITESPACE ??= Pattern.compile('\\s+')).split(filterArgs);
    for (const arg of args) {
      const delimPos = arg.indexOf(':');
      if (delimPos === -1) {
        throw new Error("RuntimeException: Invalid syntax for key/value, expected 'key:value', got: '" + arg + "'");
      }
      const key = arg.substring(0, delimPos);
      const val = arg.substring(delimPos + 1);
      if (val.startsWith('\\')) {
        const refNumber = parseJavaInt(val.replaceAll('\\', ''));
        if (refNumber > tokenPositions.length) {
          throw new Error('RuntimeException: Your reference number ' + refNumber + ' is bigger than the number of tokens: ' + tokenPositions.length);
        }
        const correctedRef = this.getSkipCorrectedReference(tokenPositions, refNumber);
        if (correctedRef >= patternTokens.length) {
          throw new Error('RuntimeException: Your reference number ' + refNumber +
                  ' is bigger than number of matching tokens: ' + patternTokens.length);
        }
        if (result.has(key)) {
          throw new Error("RuntimeException: Duplicate key '" + key + "'");
        }
        result.set(key, patternTokens[correctedRef]!.getToken());
      } else {
        result.set(key, val);
      }
    }
    return result;
  }

  // when there's a 'skip', we need to adapt the reference number
  private getSkipCorrectedReference(tokenPositions: number[], refNumber: number): number {
    let correctedRef = 0;
    let i = 0;
    for (const tokenPosition of tokenPositions) {
      if (i++ >= refNumber) {
        break;
      }
      correctedRef += tokenPosition;
    }
    return correctedRef - 1;
  }
}
