// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/RemoveUnknownCompoundsFilter.java faithful
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

export class RemoveUnknownCompoundsFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, arguments_: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {
    const compound = arguments_.get('part1')! + arguments_.get('part2')!.toLowerCase();
    if (GermanyGerman_getInstance().getDefaultSpellingRule().isMisspelled(compound)) {
      //System.err.println("Ignoring match for " + compound + ": " + match.getRule().getFullId());
      return null;
    }
    // TODO: use ngrams. no occurrences for compound = don't show error
    return match;
  }
}

FilterRegistry.register('org.languagetool.rules.de.RemoveUnknownCompoundsFilter', () => new RemoveUnknownCompoundsFilter());
