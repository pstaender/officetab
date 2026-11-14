// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishPartialPosTagFilter.java faithful
import { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { PartialPosTagFilter } from '../../../../../../languagetool-core/org/languagetool/rules/PartialPosTagFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';

/**
 * A {@link PartialPosTagFilter} for English that also runs the disambiguator. Note
 * that the disambiguator is called with a single token, so only rules
 * will apply that have a single {@code <match>} element.
 * <b>Warning: Do not use this in disambiguation.xml, it would cause an endless loop,
 * use {@link NoDisambiguationEnglishPartialPosTagFilter} instead.</b>
 *
 * @since 2.8
 * @see NoDisambiguationEnglishPartialPosTagFilter
 */
export class EnglishPartialPosTagFilter extends PartialPosTagFilter {

  protected override tag(token: string): AnalyzedTokenReadings[] | null {
    try {
      const englishLanguage = Languages.getLanguageForShortCode('en');
      const tags = englishLanguage.getTagger().tag([token]);
      const atr = [...tags];
      const disambiguated = englishLanguage.getDisambiguator().disambiguate(new AnalyzedSentence(atr));
      return [...disambiguated.getTokens()];
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IOException')) {
        throw new Error("RuntimeException: Could not tag and disambiguate '" + token + "'", { cause: e });
      }
      throw e;
    }
  }
}

FilterRegistry.register('org.languagetool.rules.en.EnglishPartialPosTagFilter', () => new EnglishPartialPosTagFilter());
