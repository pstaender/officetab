// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/de/SwissGermanTagger.java faithful
// GermanTagger's tag overloads are one method (see there): tag(word) is passed on unchanged.
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { TaggedWord } from '../../../../../../languagetool-core/org/languagetool/tagging/TaggedWord.ts';
import { GermanTagger } from './GermanTagger.ts';

/**
 * @since 4.4
 */
export class SwissGermanTagger extends GermanTagger {

  // Pattern.compile("ss", Pattern.LITERAL): a literal replacement of every "ss"

  /* (non-Javadoc)
   * @see org.languagetool.tagging.de.GermanTagger#tag(java.util.List, boolean)
   */
  override tag(word: string): TaggedWord[];
  override tag(sentenceTokens: string[], ignoreCase?: boolean): AnalyzedTokenReadings[];
  override tag(wordOrSentenceTokens: string | string[], ignoreCase = true): TaggedWord[] | AnalyzedTokenReadings[] {
    if (typeof wordOrSentenceTokens === 'string') {
      return super.tag(wordOrSentenceTokens);
    }
    const tokens = super.tag(wordOrSentenceTokens, ignoreCase);
    for (const reading of tokens) {
      if (reading != null &&
        reading.getToken() != null &&
        reading.getToken().includes('ss') &&
        !reading.isTagged()) {
        const replacementReading = this.lookup(reading.getToken().replaceAll('ss', 'ß'));
        if (replacementReading != null) {
          for (const at of replacementReading.getReadings()) {
            reading.addReading(new AnalyzedToken(reading.getToken(), at.getPOSTag(), at.getLemma()), 'SwissGermanTagger');
          }
        }
      }
    }
    return tokens;
  }
}
