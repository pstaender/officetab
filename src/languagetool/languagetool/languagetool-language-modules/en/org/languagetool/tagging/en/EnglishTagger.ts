// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/tagging/en/EnglishTagger.java faithful
// INSTANCE is created on first use (Java creates it when the class is loaded), as the dictionary
// must have been preloaded into the data broker first.
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { BaseTagger, toLowerCase } from '../../../../../../languagetool-core/org/languagetool/tagging/BaseTagger.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';

let instance: EnglishTagger | null = null;

/**
 * English Part-of-speech tagger.
 * Based on part-of-speech lists in Public Domain. See readme.txt for details,
 * the POS tagset is described in tagset.txt.
 *
 * @author Marcin Milkowski
 */
export class EnglishTagger extends BaseTagger {
  static get INSTANCE(): EnglishTagger {
    return (instance ??= new EnglishTagger());
  }

  constructor() {
    // intern tags because we only have 47 types and get megabytes of duplicated strings
    super('/en/english.dict', Locale.ENGLISH, false, true);
  }

  override tag(sentenceTokens: string[]): AnalyzedTokenReadings[] {

    const tokenReadings: AnalyzedTokenReadings[] = [];
    let pos = 0;
    for (let word of sentenceTokens) {
      // This hack allows all rules and dictionary entries to work with typewriter apostrophe
      let containsTypographicApostrophe = false;
      if (word.length > 1) {
        if (word.includes('’')) {
          containsTypographicApostrophe = true;
          word = word.replaceAll('’', '\'');
        }
      }
      const l: AnalyzedToken[] = [];
      const lowerWord = toLowerCase(word, this.locale);
      const isLowercase = word === lowerWord;
      const isMixedCase = StringTools.isMixedCase(word);
      const isAllUpper = StringTools.isAllUppercase(word);
      const taggerTokens = this.asAnalyzedTokenListForTaggedWords(word, this.getWordTagger().tag(word));

      // normal case:
      this.addTokens(taggerTokens, l);
      // tag non-lowercase (alluppercase or startuppercase), but not mixed-case words with lowercase word tags:
      if (!isLowercase && !isMixedCase) {
        const lowerTaggerTokens = this.asAnalyzedTokenListForTaggedWords(word, this.getWordTagger().tag(lowerWord));
        this.addTokens(lowerTaggerTokens, l);
      }

      //tag all-uppercase proper nouns (ex. FRANCE)
      if (l.length === 0 && isAllUpper) {
        const firstUpper = StringTools.uppercaseFirstChar(lowerWord)!;
        const firstupperTaggerTokens = this.asAnalyzedTokenListForTaggedWords(word, this.getWordTagger().tag(firstUpper));
        this.addTokens(firstupperTaggerTokens, l);
      }

      if (l.length === 0 && lowerWord.endsWith("in'")) {
        let correctedWord = word;
        if (isAllUpper) {
          correctedWord = correctedWord.substring(0, correctedWord.length - 1) + 'G';
        } else {
          correctedWord = correctedWord.substring(0, correctedWord.length - 1) + 'g';
        }
        const taggerTokens2 = this.asAnalyzedTokenListForTaggedWords(word, this.getWordTagger().tag(correctedWord));
        // normal case:
        this.addTokens(taggerTokens2, l);
        // tag non-lowercase (alluppercase or startuppercase), but not mixed-case words with lowercase word tags:
        if (!isLowercase && !isMixedCase) {
          const lowerTaggerTokens = this.asAnalyzedTokenListForTaggedWords(word,
              this.getWordTagger().tag(correctedWord.toLowerCase()));
          this.addTokens(lowerTaggerTokens, l);
        }
      }

      // additional tagging with prefixes   removed: && !isMixedCase
      /*if (l.isEmpty()) {
        addTokens(additionalTags(word), l);
      }*/

      if (l.length === 0) {
        l.push(new AnalyzedToken(word, null, null));
      }

      const atr = new AnalyzedTokenReadings(l, pos);
      if (containsTypographicApostrophe) {
        atr.setTypographicApostrophe();
      }

      tokenReadings.push(atr);
      pos += word.length;
    }

    return tokenReadings;
  }

  private addTokens(taggedTokens: AnalyzedToken[] | null, l: AnalyzedToken[]): void {
    if (taggedTokens != null) {
      l.push(...taggedTokens);
    }
  }
}
