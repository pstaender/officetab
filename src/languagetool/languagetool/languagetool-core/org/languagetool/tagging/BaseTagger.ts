// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/BaseTagger.java faithful
// The constructors are one, with optional parameters. getFromResourceDirAsUrls (all class path
// entries of a name) becomes the one resource of that name, if it exists; SequenceInputStream
// becomes the concatenated bytes. String.toLowerCase(locale) is toLocaleLowerCase only for the
// locales where Java's differs (tr, az, lt). The private addTokens is #addTokens, so that
// EnglishTagger's own private addTokens does not clash with it.
import { AnalyzedToken } from '../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Dictionary } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import type { WordData } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/WordData.ts';
import type { Locale } from '../../../../../jdk/java/util/Locale.ts';
import { MorfologikSpeller } from '../rules/spelling/morfologik/MorfologikSpeller.ts';
import { StringTools } from '../tools/StringTools.ts';
import { CombiningTagger } from './CombiningTagger.ts';
import { ManualTagger } from './ManualTagger.ts';
import { MorfologikTagger } from './MorfologikTagger.ts';
import type { TaggedWord } from './TaggedWord.ts';
import type { Tagger } from './Tagger.ts';
import type { WordTagger } from './WordTagger.ts';

const MANUAL_ADDITIONS_FILE = '/added.txt';
const CUSTOM_MANUAL_ADDITIONS_FILE = '/added_custom.txt';
const MANUAL_REMOVALS_FILE = '/removed.txt';
const CUSTOM_MANUAL_REMOVALS_FILE = '/removed_custom.txt';

/** String.toLowerCase(Locale) */
export function toLowerCase(s: string, locale: Locale): string {
  const language = locale.getLanguage();
  return language === 'tr' || language === 'az' || language === 'lt' ? s.toLocaleLowerCase(language) : s.toLowerCase();
}

/** SequenceInputStream over the streams (null if there are none). */
function concat(streams: Uint8Array[]): Uint8Array | null {
  if (streams.length === 0) return null;
  if (streams.length === 1) return streams[0]!;
  const result = new Uint8Array(streams.reduce((n, s) => n + s.length, 0));
  let offset = 0;
  for (const s of streams) {
    result.set(s, offset);
    offset += s.length;
  }
  return result;
}

/**
 * Base tagger using Morfologik binary dictionaries.
 *
 * @author Marcin Milkowski
 */
export abstract class BaseTagger implements Tagger {

  protected readonly wordTagger: WordTagger;
  protected readonly locale: Locale;

  private readonly tagLowercaseWithUppercase: boolean;
  private readonly dictionaryPath: string;
  private readonly dictionary: Dictionary;

  /**
   * Get the filenames for manual additions, e.g., {@code /en/added.txt}.
   * @since 5.0
   */
  getManualAdditionsFileNames(): string[] {
    return [this.locale.getLanguage() + MANUAL_ADDITIONS_FILE, this.locale.getLanguage() + CUSTOM_MANUAL_ADDITIONS_FILE];
  }

  /**
   * Get the filenames for manual removals, e.g., {@code /en/removed.txt}.
   * @since 5.0
   */
  getManualRemovalsFileNames(): string[] {
    return [this.locale.getLanguage() + MANUAL_REMOVALS_FILE, this.locale.getLanguage() + CUSTOM_MANUAL_REMOVALS_FILE];
  }

  /**
   * @param internTags true if string tags should be interned
   * @since 4.9
   */
  constructor(filename: string, locale: Locale, tagLowercaseWithUppercase = true, internTags = false) {
    this.dictionaryPath = filename;
    this.locale = locale;
    this.tagLowercaseWithUppercase = tagLowercaseWithUppercase;
    this.dictionary = MorfologikSpeller.getDictionaryWithCaching(filename);
    this.wordTagger = this.initWordTagger(internTags);
  }

  /**
   * @since 2.9
   */
  getDictionaryPath(): string {
    return this.dictionaryPath;
  }

  /**
   * If true, tags from the binary dictionary (*.dict) will be overwritten by manual tags
   * from the plain text dictionary.
   * @since 2.9
   */
  overwriteWithManualTagger(): boolean {
    return false;
  }

  protected getWordTagger(): WordTagger {
    return this.wordTagger;
  }

  /** getFromResourceDirAsUrls(file), opened: the resource of that name, if it exists. */
  private static getStreams(file: string): Uint8Array[] {
    const dataBroker = JLanguageTool.getDataBroker();
    return dataBroker.resourceExists(file) ? [dataBroker.getFromResourceDirAsStream(file)] : [];
  }

  private initWordTagger(internTags: boolean): WordTagger {
    const morfologikTagger = new MorfologikTagger(this.dictionary, internTags);
    try {
      let removalTagger: ManualTagger | null = null;
      const removals: Uint8Array[] = [];
      for (const file of this.getManualRemovalsFileNames()) {
        removals.push(...BaseTagger.getStreams(file));
      }
      let stream = concat(removals);
      if (stream != null) {
        removalTagger = new ManualTagger(stream, internTags);
      }

      //long startTime = System.currentTimeMillis();
      const additions: Uint8Array[] = [];
      for (const file of this.getManualAdditionsFileNames()) {
        additions.push(...BaseTagger.getStreams(file));
      }
      stream = concat(additions);
      if (stream != null) {
        const manualTagger = new ManualTagger(stream, internTags);
        //long loadTime = System.currentTimeMillis() - startTime;
        //System.out.println("Loading " + getManualAdditionsFileNames() + " took " + loadTime + "ms");
        return new CombiningTagger(morfologikTagger, manualTagger, removalTagger, this.overwriteWithManualTagger());
      } else {
        return morfologikTagger;
      }
    } catch (e) {
      throw new Error('RuntimeException: Could not load manual tagger data from ' + this.getManualAdditionsFileNames(), { cause: e });
    }
  }

  protected getDictionary(): Dictionary {
    return this.dictionary;
  }

  tag(sentenceTokens: string[]): AnalyzedTokenReadings[] {
    const tokenReadings: AnalyzedTokenReadings[] = [];
    let pos = 0;
    for (const word of sentenceTokens) {
      const l = this.getAnalyzedTokens(word);
      tokenReadings.push(new AnalyzedTokenReadings(l, pos));
      pos += word.length;
    }
    return tokenReadings;
  }

  protected getAnalyzedTokens(word: string): AnalyzedToken[] {
    const result: AnalyzedToken[] = [];
    const lowerWord = toLowerCase(word, this.locale);
    const isLowercase = word === lowerWord;
    const isMixedCase = StringTools.isMixedCase(word);
    const taggerTokens = this.asAnalyzedTokenListForTaggedWords(word, this.getWordTagger().tag(word));
    const lowerTaggerTokens =
        ! isLowercase
            ? this.asAnalyzedTokenListForTaggedWords(word, this.getWordTagger().tag(lowerWord))
            : taggerTokens;

    //normal case:
    this.#addTokens(taggerTokens, result);
    //tag non-lowercase (alluppercase or startuppercase), but not mixedcase word with lowercase word tags:
    if (!isLowercase && !isMixedCase) {
      this.#addTokens(lowerTaggerTokens, result);
    }
    //tag lowercase word with startuppercase word tags:
    if (this.tagLowercaseWithUppercase
        && lowerTaggerTokens.length === 0
        && taggerTokens.length === 0
        && isLowercase) {
      const upperTaggerTokens = this.asAnalyzedTokenListForTaggedWords(word,
            this.getWordTagger().tag(StringTools.uppercaseFirstChar(word)!));
      if (upperTaggerTokens.length !== 0) {
        this.#addTokens(upperTaggerTokens, result);
      }
    }
    // Additional language-dependent-tagging:
    if (result.length === 0) {
      const additionalTaggedTokens = this.additionalTags(word, this.getWordTagger());
      this.#addTokens(additionalTaggedTokens, result);
    }
    if (result.length === 0) {
      result.push(new AnalyzedToken(word, null, null));
    }
    return result;
  }

  protected asAnalyzedTokenList(word: string, wdList: WordData[]): AnalyzedToken[] {
    const aTokenList: AnalyzedToken[] = [];
    for (const wd of wdList) {
      aTokenList.push(this.asAnalyzedToken(word, wd));
    }
    return aTokenList;
  }

  protected asAnalyzedTokenListForTaggedWords(word: string, taggedWords: TaggedWord[]): AnalyzedToken[] {
    const aTokenList: AnalyzedToken[] = [];
    for (const taggedWord of taggedWords) {
      aTokenList.push(this.asAnalyzedToken(word, taggedWord));
    }
    return aTokenList;
  }

  /** asAnalyzedToken(String, WordData) and the private asAnalyzedToken(String, TaggedWord). */
  protected asAnalyzedToken(word: string, wd: WordData | TaggedWord): AnalyzedToken {
    if ('getPosTag' in wd) {
      return new AnalyzedToken(word, wd.getPosTag(), wd.getLemma());
    }
    let tag = wd.getTag();
    // Remove frequency data from tags (if exists)
    // The frequency data is in the last byte (without a separator)
    if (this.dictionary.metadata.isFrequencyIncluded() && tag != null && tag.length > 1) {
      tag = tag.substring(0, tag.length - 1);
    }
    return new AnalyzedToken( word, tag, wd.getStem());
  }

  //please do not make protected, this breaks other languages
  #addTokens(taggedTokens: AnalyzedToken[] | null, l: AnalyzedToken[]): void {
    if (taggedTokens != null) {
      for (const at of taggedTokens) {
        l.push(at);
      }
    }
  }

  createNullToken(token: string, startPos: number): AnalyzedTokenReadings {
    return new AnalyzedTokenReadings(new AnalyzedToken(token, null, null), startPos);
  }

  createToken(token: string, posTag: string | null): AnalyzedToken {
    return new AnalyzedToken(token, posTag, null);
  }

  /**
   * Allows additional tagging in some language-dependent circumstances
   * @param word The word to tag
   * @return Returns list of analyzed tokens with additional tags, or {@code null}
   */
  protected additionalTags(_word: string, _wordTagger: WordTagger): AnalyzedToken[] | null {
    return null;
  }

}
