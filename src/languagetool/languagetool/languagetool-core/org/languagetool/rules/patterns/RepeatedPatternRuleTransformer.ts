// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/RepeatedPatternRuleTransformer.java faithful
// The inner class RepeatedPatternRule gets its outer instance as the first constructor parameter.
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { Language } from '../../Language.ts';
import type { Rule } from '../Rule.ts';
import { RuleMatch } from '../RuleMatch.ts';
import { SameRuleGroupFilter } from '../SameRuleGroupFilter.ts';
import { TextLevelRule } from '../TextLevelRule.ts';
import type { AbstractPatternRule } from './AbstractPatternRule.ts';
import { type PatternRuleTransformer, TransformedRules } from './PatternRuleTransformer.ts';

export class RepeatedPatternRuleTransformer implements PatternRuleTransformer {

  defaultMaxDistanceTokens = 60; // number of tokens
  protected readonly transformerLanguage: Language;

  constructor(lang: Language) {
    this.transformerLanguage = lang;
  }

  apply(patternRules: AbstractPatternRule[]): TransformedRules {
    const remaining: AbstractPatternRule[] = [];
    const toTransform = new Map<string, AbstractPatternRule[]>();
    // rules in a rule group / with the same ID should be combined so repetitions of similar patterns are matched
    for (const abstractPatternRule of patternRules) {
      if (abstractPatternRule.getMinPrevMatches() > 0) {
        const rules = toTransform.get(abstractPatternRule.getId());
        if (rules == null) {
          toTransform.set(abstractPatternRule.getId(), [abstractPatternRule]);
        } else {
          rules.push(abstractPatternRule);
        }
      } else {
        remaining.push(abstractPatternRule);
      }
    }
    const transformed: Rule[] = [...toTransform.values()]
      .map((group) => new RepeatedPatternRule(this, group, this.transformerLanguage));
    return new TransformedRules(remaining, transformed);
  }
}

/**
 * Wrapper for loaded {@link AbstractPatternRule} instances to act as text-level rules
 */
export class RepeatedPatternRule extends TextLevelRule {

  private readonly outer: RepeatedPatternRuleTransformer;
  protected readonly ruleLanguage: Language;
  private readonly rules: readonly AbstractPatternRule[];

  constructor(outer: RepeatedPatternRuleTransformer, rules: AbstractPatternRule[], lang: Language) {
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
    return this.rules[0]!.getId();
  }

  override getDescription(): string {
    return this.rules[0]!.getDescription();
  }

  override match(sentencesOrSentence: AnalyzedSentence[] | AnalyzedSentence): RuleMatch[] {
    if (!Array.isArray(sentencesOrSentence)) throw new Error('RuntimeException: Not implemented for a text-level rule');
    const sentences = sentencesOrSentence;
    const matches: RuleMatch[] = [];
    let offsetChars = 0;
    let offsetTokens = 0;
    let prevFromToken = 0;
    let prevMatches = 0;
    const distancesBetweenMatches: number[] = [];
    // we need to adjust offsets since each pattern rule returns offsets relative to the sentence, not text
    for (const s of sentences) {
      let sentenceMatches: RuleMatch[] = [];
      for (const rule of this.rules) {
        const ruleMatches = rule.match(s);
        sentenceMatches.push(...ruleMatches);
      }
      sentenceMatches = new SameRuleGroupFilter().filter(sentenceMatches);
      // no sorting: SameRuleGroupFilter sorts rule matches already
      const sentenceLenghtTokens = s.getTokensWithoutWhitespace().length;
      for (const m of sentenceMatches) {
        let fromToken = 0;
        while (fromToken < sentenceLenghtTokens
            && s.getTokensWithoutWhitespace()[fromToken]!.getStartPos() < m.getFromPos()) {
          fromToken++;
        }
        fromToken += offsetTokens;
        const fromPos = m.getFromPos() + offsetChars;
        const toPos = m.getToPos() + offsetChars;
        m.setOffsetPosition(fromPos, toPos);
        let maxDistanceTokens = m.getRule().getDistanceTokens();
        if (maxDistanceTokens < 1) {
          maxDistanceTokens = this.outer.defaultMaxDistanceTokens * m.getRule().getMinPrevMatches();
        }
        distancesBetweenMatches.push(fromToken - prevFromToken);
        if (prevMatches >= m.getRule().getMinPrevMatches()
            && this.isDistanceValid(distancesBetweenMatches, maxDistanceTokens, m.getRule().getMinPrevMatches())) {
          matches.push(m);
        }
        prevFromToken = fromToken;
        prevMatches++;
      }
      offsetChars += s.getText().length;
      offsetTokens += sentenceLenghtTokens - 1; // -1 -> not counting SENT_START
    }
    return matches;
  }

  override minToCheckParagraph(): number {
    // TODO: what should we use here? calculate based on min_prev_matches?
    return 0;
  }

  override supportsLanguage(language: Language): boolean {
    return language.equalsConsiderVariantsIfSpecified(this.ruleLanguage);
  }

  private isDistanceValid(distancesBetweenMatches: number[], maxDistanceTokens: number, minPrevMatches: number): boolean {
    let i = 0;
    const size = distancesBetweenMatches.length;
    let distance = 0;
    while (i < minPrevMatches && i < size) {
      distance += distancesBetweenMatches[size - 1 - i]!;
      i++;
    }
    return distance < maxDistanceTokens;
  }
}
