// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RuleMatcher.java faithful
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { RuleMatch } from '../RuleMatch.ts';

/**
 * @since 3.2
 */
export interface RuleMatcher {

  match(sentence: AnalyzedSentence): RuleMatch[];

}
