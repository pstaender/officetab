// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/NoDisambiguationEnglishPartialPosTagFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { PartialPosTagFilter } from '../../../../../../languagetool-core/org/languagetool/rules/PartialPosTagFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import type { Tagger } from '../../../../../../languagetool-core/org/languagetool/tagging/Tagger.ts';

/**
 * A {@link PartialPosTagFilter} for English that does not run the disambiguator.
 * @since 3.2
 * @see EnglishPartialPosTagFilter
 */
export class NoDisambiguationEnglishPartialPosTagFilter extends PartialPosTagFilter {

  private readonly tagger: Tagger = Languages.getLanguageForShortCode('en').getTagger();

  protected override tag(token: string): AnalyzedTokenReadings[] | null {
    try {
      const tags = this.tagger.tag([token]);
      const atr = [...tags];
      return atr;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IOException')) {
        throw new Error("RuntimeException: Could not tag and disambiguate '" + token + "'", { cause: e });
      }
      throw e;
    }
  }
}

FilterRegistry.register('org.languagetool.rules.en.NoDisambiguationEnglishPartialPosTagFilter', () => new NoDisambiguationEnglishPartialPosTagFilter());
