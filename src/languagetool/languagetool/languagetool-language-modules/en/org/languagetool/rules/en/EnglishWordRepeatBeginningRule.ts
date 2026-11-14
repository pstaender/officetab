// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishWordRepeatBeginningRule.java faithful
// The HashSets iterate in insertion order here (Java's order is the hash order; upstream's test
// does not depend on it).
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WordRepeatBeginningRule } from '../../../../../../languagetool-core/org/languagetool/rules/WordRepeatBeginningRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

//==================== ADVERBS ======================

// adverbs used to add to what the previous sentence mentioned
const ADD_ADVERBS = new Set<string>();

// adverbs used to express contrast to what the previous sentence mentioned
const CONTRAST_ADVERBS = new Set<string>();

// adverbs used to express emphasis to what the previous sentence mentioned
const EMPHASIS_ADVERBS = new Set<string>();

// adverbs used to explain what the previous sentence mentioned
const EXPLAIN_ADVERBS = new Set<string>();

//==================== EXPRESSIONS ======================
// the expressions will be used only as additional suggestions

// linking expressions that can be used instead of the ADD_ADVERBS
const ADD_EXPRESSIONS = ['In addition', 'As well as'];

// linking expressions that can be used instead of the CONTRAST_ADVERBS
const CONTRAST_EXPRESSIONS = ['Even so', 'On the other hand'];

{
  // based on https://www.pinterest.com/pin/229542912245527548/
  ADD_ADVERBS.add('Additionally');
  ADD_ADVERBS.add('Besides');
  ADD_ADVERBS.add('Furthermore');
  ADD_ADVERBS.add('Moreover');
  ADD_ADVERBS.add('Also');
  CONTRAST_ADVERBS.add('Nevertheless');
  CONTRAST_ADVERBS.add('Nonetheless');
  CONTRAST_ADVERBS.add('Alternatively');
  EMPHASIS_ADVERBS.add('Undoubtedly');
  EMPHASIS_ADVERBS.add('Indeed');
  EMPHASIS_ADVERBS.add('Obviously');
  EMPHASIS_ADVERBS.add('Clearly');
  EMPHASIS_ADVERBS.add('Importantly');
  EMPHASIS_ADVERBS.add('Absolutely');
  EMPHASIS_ADVERBS.add('Definitely');
  EXPLAIN_ADVERBS.add('Particularly');
  EXPLAIN_ADVERBS.add('Especially');
  EXPLAIN_ADVERBS.add('Specifically');
}

/**
 * Adds a list English adverbs to {@link WordRepeatBeginningRule}.
 *
 * @author Markus Brenneis
 */
export class EnglishWordRepeatBeginningRule extends WordRepeatBeginningRule {

  constructor(messages: ResourceBundle, language: Language | null) {
    super(messages, language);
    this.addExamplePair(Example.wrong('Moreover, the street is almost entirely residential. <marker>Moreover</marker>, it was named after a poet.'),
                   Example.fixed('Moreover, the street is almost entirely residential. <marker>It</marker> was named after a poet.'));
  }

  override getId(): string {
    return 'ENGLISH_WORD_REPEAT_BEGINNING_RULE';
  }

  override isException(token: string): boolean {
    return super.isException(token) || token === 'The' || token === 'A' || token === 'An';
  }

  protected override isAdverb(token: AnalyzedTokenReadings): boolean {
    const tok = token.getToken();
    return ADD_ADVERBS.has(tok) || CONTRAST_ADVERBS.has(tok) || EMPHASIS_ADVERBS.has(tok)
        || EXPLAIN_ADVERBS.has(tok);
  }

  protected override getSuggestions(token: AnalyzedTokenReadings): string[] {
    const tok = token.getToken();
    // the repeated word is a personal pronoun
    if (token.hasPosTag('PRP')) {
      const adaptedToken = tok === 'I' ? tok : tok.toLowerCase();
      return ['Furthermore, ' + adaptedToken, 'Likewise, ' + adaptedToken,
          'Not only that, but ' + adaptedToken];
    } else if (ADD_ADVERBS.has(tok)) {
      const addSuggestions = this.getDifferentAdverbsOfSameCategory(tok, ADD_ADVERBS);
      addSuggestions.push(...ADD_EXPRESSIONS);
      return addSuggestions;
    } else if (CONTRAST_ADVERBS.has(tok)) {
      const contrastSuggestions = this.getDifferentAdverbsOfSameCategory(tok, CONTRAST_ADVERBS);
      contrastSuggestions.push(...CONTRAST_EXPRESSIONS);
      return contrastSuggestions;
    } else if (EMPHASIS_ADVERBS.has(tok)) {
      return this.getDifferentAdverbsOfSameCategory(tok, EMPHASIS_ADVERBS);
    } else if (EXPLAIN_ADVERBS.has(tok)) {
      return this.getDifferentAdverbsOfSameCategory(tok, EXPLAIN_ADVERBS);
    }
    return [];
  }

  /**
   * Gives suggestions to replace the given adverb.
   *
   * @param adverb            to get suggestions for
   * @param adverbsOfCategory the adverbs of the same category as adverb (adverb
   *                          is <b>required</b> to be contained in the Set)
   * @return a List of suggested adverbs to replace the given adverb
   */
  private getDifferentAdverbsOfSameCategory(adverb: string, adverbsOfCategory: Set<string>): string[] {
    return [...adverbsOfCategory].filter((adv) => adv !== adverb);
  }
}
