// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/xx/DemoTagger.java faithful
import { AnalyzedToken } from '../../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import type { Tagger } from '../Tagger.ts';

/**
 * A trivial tagger that does nothing than assign null
 * tags to words.
 *
 * @author Daniel Naber
 */
export class DemoTagger implements Tagger {

  tag(sentenceTokens: string[]): AnalyzedTokenReadings[] {
    const tokenReadings: AnalyzedTokenReadings[] = [];
    for (const word of sentenceTokens) {
      const l: AnalyzedToken[] = [];
      // a real tagger would need to assign a POS tag
      // in the next line instead of null:
      l.push(new AnalyzedToken(word, null, null));
      tokenReadings.push(new AnalyzedTokenReadings(l, 0));
    }
    return tokenReadings;
  }

  createNullToken(token: string, startPos: number): AnalyzedTokenReadings {
    return new AnalyzedTokenReadings(new AnalyzedToken(token, null, null), startPos);
  }

  createToken(token: string, posTag: string | null): AnalyzedToken {
    return new AnalyzedToken(token, posTag, null);
  }

}
