// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/ConsistencyPatternRuleTransformer.java faithful
// The inner class ConsistencyPatternRule gets its outer instance as the first constructor parameter.
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { Language } from '../../Language.ts';
import type { Rule } from '../Rule.ts';
import type { RuleMatch } from '../RuleMatch.ts';
import { SameRuleGroupFilter } from '../SameRuleGroupFilter.ts';
import { TextLevelRule } from '../TextLevelRule.ts';
import { StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import type { AbstractPatternRule } from './AbstractPatternRule.ts';
import { type PatternRuleTransformer, TransformedRules } from './PatternRuleTransformer.ts';

export class ConsistencyPatternRuleTransformer implements PatternRuleTransformer {

  protected readonly transformerLanguage: Language;

  constructor(lang: Language) {
    this.transformerLanguage = lang;
  }

  apply(patternRules: AbstractPatternRule[]): TransformedRules {
    const remaining: AbstractPatternRule[] = [];
    const toTransform = new Map<string, AbstractPatternRule[]>();
    // rule id conventions:
    // PREFIX_GROUPOFRULES_FEATURE
    for (const abstractPatternRule of patternRules) {
      const ruleId = abstractPatternRule.getId();
      if (ruleId.startsWith(abstractPatternRule.getLanguage().getConsistencyRulePrefix())) {
        const id = this.getMainRuleId(ruleId);
        const rules = toTransform.get(id);
        if (rules == null) {
          toTransform.set(id, [abstractPatternRule]);
        } else {
          rules.push(abstractPatternRule);
        }
      } else {
        remaining.push(abstractPatternRule);
      }
    }
    const transformed: Rule[] = [...toTransform.values()]
      .map((group) => new ConsistencyPatternRule(this, group, this.transformerLanguage));
    return new TransformedRules(remaining, transformed);
  }

  getMainRuleId(originalId: string): string {
    const parts = StringSplit(originalId, '_');
    return parts[0] + '_' + parts[1];
  }

  getFeature(originalId: string): string {
    const parts = StringSplit(originalId, '_');
    return parts[2]!;
  }
}

/**
 * Wrapper for loaded {@link AbstractPatternRule} instances to act as text-level rules
 */
export class ConsistencyPatternRule extends TextLevelRule {

  private readonly outer: ConsistencyPatternRuleTransformer;
  protected readonly ruleLanguage: Language;
  private readonly rules: readonly AbstractPatternRule[];

  constructor(outer: ConsistencyPatternRuleTransformer, rules: AbstractPatternRule[], lang: Language) {
    super();
    this.outer = outer;
    this.rules = rules;
    this.ruleLanguage = lang;
    this.setPremium(rules.some((r) => r.isPremium()));
  }

  getWrappedRules(): readonly AbstractPatternRule[] {
    return this.rules;
  }

  override getId(): string {
    return this.outer.getMainRuleId(this.rules[0]!.getId());
  }

  override getDescription(): string {
    return this.rules[0]!.getDescription();
  }

  override match(sentencesOrSentence: AnalyzedSentence[] | AnalyzedSentence): RuleMatch[] {
    if (!Array.isArray(sentencesOrSentence)) throw new Error('RuntimeException: Not implemented for a text-level rule');
    const sentences = sentencesOrSentence;
    const countFeatures = new Map<string, number>();
    let offsetChars = 0;
    const matches: RuleMatch[] = [];
    for (const s of sentences) {
      let sentenceMatches: RuleMatch[] = [];
      for (const rule of this.rules) {
        const ruleMatches = rule.match(s);
        sentenceMatches.push(...ruleMatches);
      }
      sentenceMatches = new SameRuleGroupFilter().filter(sentenceMatches);
      // we need to adjust offsets since each pattern rule returns offsets relative to the sentence, not text
      const adjustedSentenceMatches: RuleMatch[] = [];
      for (const rm of sentenceMatches) {
        rm.setSentencePosition(rm.getFromPos(), rm.getToPos());
        const fromPos = rm.getFromPos() + offsetChars;
        const toPos = rm.getToPos() + offsetChars;
        rm.setOffsetPosition(fromPos, toPos);
        adjustedSentenceMatches.push(rm);
      }
      matches.push(...adjustedSentenceMatches);
      offsetChars += s.getText().length;
    }
    const resultMatches: RuleMatch[] = [];
    // count occurrences of features
    for (const rm of matches) {
      const feature = this.outer.getFeature(rm.getRule().getId());
      countFeatures.set(feature, (countFeatures.get(feature) ?? 0) + 1);
    }
    if (countFeatures.size < 2) {
      // there is no inconsistency
      return resultMatches;
    }
    const max = Math.max(...countFeatures.values());
    const featuresWithMax: string[] = [];
    const featuresToKeep: string[] = [];
    const featuresToSuggest: string[] = [];
    for (const [key, value] of countFeatures) {
      if (value === max) {
        featuresWithMax.push(key);
      } else {
        featuresToKeep.push(key);
      }
    }
    featuresToSuggest.push(...featuresWithMax);
    if (featuresWithMax.length > 1) {
      featuresToKeep.push(...featuresWithMax);
    }
    for (const rm of matches) {
      if (featuresToKeep.includes(this.outer.getFeature(rm.getRule().getId()))) {
        resultMatches.push(this.ruleLanguage.adjustMatch(rm, featuresToSuggest));
      }
    }
    return resultMatches;
  }

  override minToCheckParagraph(): number {
    // TODO: what should we use here? calculate based on min_prev_matches?
    return 0;
  }

  override supportsLanguage(language: Language): boolean {
    return language.equalsConsiderVariantsIfSpecified(this.ruleLanguage);
  }
}
