// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/ValidWordFilter.java faithful
// GermanyGerman.getInstance() is Languages.getLanguageForShortCode('de-DE') (what it does): a value
// import of GermanyGerman would make the import cycle language module → registerFilters →
// GermanyGerman → German → rules.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { RuleFilter } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/RuleFilter.ts';
import type { German } from '../../language/German.ts';

const GermanyGerman_getInstance = (): German => Languages.getLanguageForShortCode('de-DE') as German;

/**
 * To be used in LEERZEICHEN_NACH_KLAMMER.
 * @since 6.1
 */
export class ValidWordFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, arguments_: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const word1 = arguments_.get('word1')! + arguments_.get('word2')!;
    const word2 = arguments_.get('word1')! + arguments_.get('word2')!.toLowerCase();
    const speller = GermanyGerman_getInstance().getDefaultSpellingRule();
    if (!speller.isMisspelled(word1) || !speller.isMisspelled(word2)) {
      // e.g. "(Promotions)Studierende" -> "Promotionsstudierende" is ok, so no match
      return null;
    }
    // all other cases, e.g.: "Das ist (vielleicht)der bessere Ansatz".
    return match;
  }
}

FilterRegistry.register('org.languagetool.rules.de.ValidWordFilter', () => new ValidWordFilter());
