// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.java faithful
import type { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import type { AnalyzedToken } from '../../../AnalyzedToken.ts';
import type { Language } from '../../../Language.ts';
import { AbstractTokenBasedRule } from '../../../rules/patterns/AbstractTokenBasedRule.ts';
import type { Match } from '../../../rules/patterns/Match.ts';
import type { PatternToken } from '../../../rules/patterns/PatternToken.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { DisambiguatedExample } from './DisambiguatedExample.ts';
import { DisambiguationPatternRuleReplacer } from './DisambiguationPatternRuleReplacer.ts';

/** Possible disambiguator actions. **/
export const DisambiguatorAction = {
  ADD: 'ADD', FILTER: 'FILTER', REMOVE: 'REMOVE', REPLACE: 'REPLACE', UNIFY: 'UNIFY', IMMUNIZE: 'IMMUNIZE',
  IGNORE_SPELLING: 'IGNORE_SPELLING', FILTERALL: 'FILTERALL', ADDCHUNK: 'ADDCHUNK',
} as const;
export type DisambiguatorAction = typeof DisambiguatorAction[keyof typeof DisambiguatorAction];

/**
 * A Rule that describes a pattern of words or part-of-speech tags used for
 * disambiguation.
 *
 * @author Marcin Miłkowski
 */
export class DisambiguationPatternRule extends AbstractTokenBasedRule {

  private readonly disambiguatedPOS: string | null;
  private readonly matchElement: Match | null;
  private readonly disAction: DisambiguatorAction;

  private newTokenReadings: AnalyzedToken[] | null = null;
  private examples: DisambiguatedExample[] = [];
  private untouchedExamples: string[] = [];

  /**
   * @param id Id of the Rule
   * @param language Language of the Rule
   * @param description Description to be shown (name)
   * @param disambAction the action to be executed on found token(s)
   * @since public since 2.5
   */
  constructor(id: string, description: string,
              language: Language, patternTokens: PatternToken[],
              disambiguatedPOS: string | null, posSelect: Match | null,
              disambAction: DisambiguatorAction) {
    super(id, description, language, patternTokens, true);
    if (disambiguatedPOS == null && posSelect == null
        && disambAction !== DisambiguatorAction.UNIFY
        && disambAction !== DisambiguatorAction.ADD
        && disambAction !== DisambiguatorAction.REMOVE
        && disambAction !== DisambiguatorAction.IMMUNIZE
        && disambAction !== DisambiguatorAction.REPLACE
        && disambAction !== DisambiguatorAction.FILTERALL
        && disambAction !== DisambiguatorAction.IGNORE_SPELLING
        && disambAction !== DisambiguatorAction.ADDCHUNK) {
      throw new Error('NullPointerException: disambiguated POS cannot be null with posSelect == null and ' + disambAction);
    }
    this.disambiguatedPOS = disambiguatedPOS;
    this.matchElement = posSelect;
    this.disAction = Objects_requireNonNull(disambAction);
    this.setMessage('');
    this.suggestionsOutMsg = '';
  }

  /**
   * Used to add new interpretations.
   * @param newReadings
   *          An array of AnalyzedTokens. The length of the array should be the
   *          same as the number of the tokens matched and selected by
   *          {@code <marker>...</marker>} elements.
   */
  setNewInterpretations(newReadings: AnalyzedToken[]): void {
    this.newTokenReadings = [...newReadings];
  }

  /**
   * Performs disambiguation on the source sentence.
   * @param sentence {@link AnalyzedSentence} Sentence to be disambiguated.
   * @return {@link AnalyzedSentence} Disambiguated sentence (might be unchanged).
   */
  replace(sentence: AnalyzedSentence): AnalyzedSentence {
    return this.canBeIgnoredFor(sentence) ? sentence : new DisambiguationPatternRuleReplacer(this).replace(sentence);
  }

  setExamples(examples: DisambiguatedExample[]): void {
    this.examples = Objects_requireNonNull(examples);
  }

  getExamples(): readonly DisambiguatedExample[] {
    return this.examples;
  }

  setUntouchedExamples(untouchedExamples: string[]): void {
    this.untouchedExamples = Objects_requireNonNull(untouchedExamples);
  }

  getUntouchedExamples(): readonly string[] {
    return this.untouchedExamples;
  }

  /**
   * @since 2.3
   */
  getAction(): DisambiguatorAction {
    return this.disAction;
  }

  /**
   * @since 2.3
   */
  getNewTokenReadings(): AnalyzedToken[] | null {
    return this.newTokenReadings;
  }

  /**
   * @since 2.3
   */
  getMatchElement(): Match | null {
    return this.matchElement;
  }

  /**
   * @since 2.3
   */
  getDisambiguatedPOS(): string | null {
    return this.disambiguatedPOS;
  }

}
