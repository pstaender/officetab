// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WhitespaceCheckFilter.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { FilterRegistry } from './patterns/registry.ts';
import { parseJavaInt, RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';

export class WhitespaceCheckFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const wsChar = this.getRequired('whitespaceChar', args);
    const pos = parseJavaInt(this.getRequired('position', args));
    if (pos < 1 || pos > patternTokens.length) {
      throw new Error('IllegalArgumentException: Wrong position in WhitespaceCheckFilter: ' + pos + ', must be 1 to ' + patternTokens.length);
    }
    if (patternTokens[pos - 1]!.getWhitespaceBefore() !== wsChar) {
      return match;
    } else {
      return null;
    }
  }

}

FilterRegistry.register('org.languagetool.rules.WhitespaceCheckFilter', () => new WhitespaceCheckFilter());
