// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/OrdinalSuffixFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { RuleFilter } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/RuleFilter.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const PATTERN = Pattern.compile('.*(11|12|13)');
const NON_DIGITS = Pattern.compile('[^0-9]');

/**
 * Fixes the suggestion for ordinal suffixes, like "1nd" -&gt; "1st".
 * @since 5.3
 */
export class OrdinalSuffixFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, _arguments: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const ordinal = NON_DIGITS.matcher(match.getSuggestedReplacements()[0]!).replaceAll('');
    if (PATTERN.matcher(ordinal).matches()) {
      match.setSuggestedReplacement(ordinal + 'th');
    } else if (ordinal.endsWith('1')) {
      match.setSuggestedReplacement(ordinal + 'st');
    } else if (ordinal.endsWith('2')) {
      match.setSuggestedReplacement(ordinal + 'nd');
    } else if (ordinal.endsWith('3')) {
      match.setSuggestedReplacement(ordinal + 'rd');
    } else {
      match.setSuggestedReplacement(ordinal + 'th');
    }
    return match;
  }
}

FilterRegistry.register('org.languagetool.rules.en.OrdinalSuffixFilter', () => new OrdinalSuffixFilter());
