// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRuleTransformer.java faithful
// Function<List<AbstractPatternRule>, TransformedRules> is an interface with apply().
import type { Rule } from '../Rule.ts';
import type { AbstractPatternRule } from './AbstractPatternRule.ts';

/**
 * Allows transformation of pattern rules to add additional matching/filtering logic
 * Used in {@link org.languagetool.JLanguageTool#transformPatternRules}
 * Return a value if a transform is applied, none otherwise
 * @since 5.6
 */
export interface PatternRuleTransformer {
  apply(patternRules: AbstractPatternRule[]): TransformedRules;
}

export class TransformedRules {
  private readonly remainingRules: readonly AbstractPatternRule[];
  private readonly transformedRules: readonly Rule[];

  constructor(remainingRules: AbstractPatternRule[], transformedRules: Rule[]) {
    this.remainingRules = remainingRules;
    this.transformedRules = transformedRules;
  }

  getRemainingRules(): readonly AbstractPatternRule[] {
    return this.remainingRules;
  }

  getTransformedRules(): readonly Rule[] {
    return this.transformedRules;
  }
}
