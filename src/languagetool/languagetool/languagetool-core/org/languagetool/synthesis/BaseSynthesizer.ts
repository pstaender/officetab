// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/synthesis/BaseSynthesizer.java faithful
// The constructors are one: (sorosFileName, resourceFileName, tagFileName, lang) or
// (resourceFileName, tagFileName, lang), lang being a Language or its short code. The two
// synthesize overloads are one method with an optional posTagRegExp (undefined: the two-argument
// one). synchronized and StringInterner.intern are left out.
import type { AnalyzedToken } from '../AnalyzedToken.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import type { Dictionary } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryLookup } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryLookup.ts';
import type { IStemmer } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/IStemmer.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { MorfologikSpeller } from '../rules/spelling/morfologik/MorfologikSpeller.ts';
import { ManualSynthesizer } from './ManualSynthesizer.ts';
import { Soros } from './Soros.ts';
import type { Synthesizer } from './Synthesizer.ts';
import { SynthesizerTools } from './SynthesizerTools.ts';

/** BufferedReader.readLine() of the whole text, each line followed by '\n'. */
function readText(stream: Uint8Array): string {
  const lines = new TextDecoder('utf-8').decode(stream).split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  let sb = '';
  for (const line of lines) {
    sb += line;
    sb += '\n';
  }
  return sb;
}

/**
 * Synthesizer for Morfologik dictionaries.
 */
export class BaseSynthesizer implements Synthesizer {

  readonly SPELLNUMBER_TAG = '_spell_number_';
  readonly SPELLNUMBER_FEMININE_TAG = '_spell_number_:feminine';
  readonly SPELLNUMBER_ROMAN_TAG = '_spell_number_:Roman';

  protected possibleTags: string[] | null = null;

  private readonly tagFileName: string;
  private readonly resourceFileName: string;
  private readonly stemmer: IStemmer;
  private readonly manualSynthesizer: ManualSynthesizer | null;
  private readonly removalSynthesizer: ManualSynthesizer | null;
  private readonly removalSynthesizer2: ManualSynthesizer | null;
  private readonly sorosFileName: string | null;
  private readonly numberSpeller: Soros | null;
  private readonly romanNumberer: Soros | null;

  private dictionary: Dictionary | null = null;

  protected language: Language | null = null;

  /**
   * @param sorosFileName the Soros file for spelling numbers (or null)
   * @param resourceFileName The dictionary file name.
   * @param tagFileName The name of a file containing all possible tags.
   * @param lang the language, or its short code used to find the data files
   */
  constructor(sorosFileName: string | null, resourceFileName: string, tagFileName: string, lang: Language | string);
  constructor(resourceFileName: string, tagFileName: string, lang: Language | string);
  constructor(a: string | null, b: string, c: string | Language, d?: Language | string) {
    let sorosFileName: string | null, resourceFileName: string, tagFileName: string, lang: Language | string;
    if (d === undefined) {
      // BaseSynthesizer(String resourceFileName, String tagFileName, Language|String lang)
      sorosFileName = null; resourceFileName = a!; tagFileName = b; lang = c;
    } else {
      sorosFileName = a; resourceFileName = b; tagFileName = c as string; lang = d;
    }
    const langShortCode = typeof lang === 'string' ? lang : lang.getShortCode();
    this.resourceFileName = resourceFileName;
    this.tagFileName = tagFileName;
    this.stemmer = this.createStemmer();
    this.sorosFileName = sorosFileName;
    this.numberSpeller = this.createNumberSpeller(langShortCode);
    this.romanNumberer = this.createRomanNumberer();
    try {
      const path = '/' + langShortCode + '/added.txt';
      if (JLanguageTool.getDataBroker().resourceExists(path)) {
        const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(path);
        this.manualSynthesizer = new ManualSynthesizer(stream);
      } else {
        this.manualSynthesizer = null;
      }
      const removalPath = '/' + langShortCode + '/removed.txt';
      if (JLanguageTool.getDataBroker().resourceExists(removalPath)) {
        const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(removalPath);
        this.removalSynthesizer = new ManualSynthesizer(stream);
      } else {
        this.removalSynthesizer = null;
      }
      const removalPath2 = '/' + langShortCode + '/do-not-synthesize.txt';
      if (JLanguageTool.getDataBroker().resourceExists(removalPath2)) {
        const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(removalPath2);
        this.removalSynthesizer2 = new ManualSynthesizer(stream);
      } else {
        this.removalSynthesizer2 = null;
      }

    } catch (e) {
      throw new Error('RuntimeException: ' + e, { cause: e });
    }
    if (typeof lang !== 'string') {
      this.language = lang;
    }
  }

  /**
   * Returns the {@link Dictionary} used for this synthesizer.
   * The dictionary file can be defined in the {@link #BaseSynthesizer(String, String, Language) constructor}.
   * @throws IOException In case the dictionary cannot be loaded.
   */
  protected getDictionary(): Dictionary {
    let dict = this.dictionary;
    if (dict == null) {
      dict = MorfologikSpeller.getDictionaryWithCaching(this.resourceFileName);
      this.dictionary = dict;
    }
    return dict;
  }

  /**
   * Creates a new {@link IStemmer} based on the configured {@link #getDictionary() dictionary}.
   * The result must not be shared among threads.
   * @since 2.3
   */
  protected createStemmer(): IStemmer {
    try {
      return new DictionaryLookup(this.getDictionary());
    } catch (e) {
      throw new Error('RuntimeException: Could not load dictionary', { cause: e });
    }
  }

  private createNumberSpeller(langcode: string): Soros | null {
    let s: Soros;
    try {
      const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(this.sorosFileName!);
      s = new Soros(readText(stream), langcode);
    } catch {
      return null;
    }
    return s;
  }

  private createRomanNumberer(): Soros | null {
    let s: Soros;
    try {
      const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream('Roman.sor');
      s = new Soros(readText(stream), 'Roman');
    } catch {
      return null;
    }
    return s;
  }

  /**
   * Lookup the inflected forms of a lemma defined by a part-of-speech tag.
   * @param lemma the lemma to be inflected.
   * @param posTag the desired part-of-speech tag.
   */
  protected lookup(lemma: string, posTag: string): string[] {
    let results: string[] = [];
    // the stemmer is not thread-safe
    const wordForms = this.stemmer.lookup(lemma + '|' + posTag);
    for (const wd of wordForms) {
      results.push(wd.getStem()!.toString());
    }
    if (this.manualSynthesizer != null) {
      const manualForms = this.manualSynthesizer.lookup(lemma, posTag);
      if (manualForms != null) {
        results.push(...manualForms);
      }
    }
    if (this.removalSynthesizer != null) {
      const removeForms = this.removalSynthesizer.lookup(lemma, posTag);
      if (removeForms != null) {
        results = results.filter((r) => !removeForms.includes(r));
      }
    }
    if (this.removalSynthesizer2 != null) {
      const removeForms = this.removalSynthesizer2.lookup(lemma, posTag);
      if (removeForms != null) {
        results = results.filter((r) => !removeForms.includes(r));
      }
    }
    return results;
  }

  /**
   * Get a form of a given AnalyzedToken, where the form is defined by a
   * part-of-speech tag.
   * @param token AnalyzedToken to be inflected.
   * @param posTag The desired part-of-speech tag.
   * @param posTagRegExp Specifies whether the posTag string is a regular expression
   *   (undefined: the two-argument overload).
   * @return inflected words, or an empty array if no forms were found
   */
  synthesize(token: AnalyzedToken, posTag: string, posTagRegExp?: boolean): string[] {
    if (posTagRegExp === undefined) {
      if (posTag === this.SPELLNUMBER_TAG) {
        return [this.getSpelledNumber(token.getToken())];
      }
      if (posTag === this.SPELLNUMBER_FEMININE_TAG) {
        return [this.getSpelledNumber('feminine ' + token.getToken())];
      }
      if (posTag === this.SPELLNUMBER_ROMAN_TAG) {
        return [this.getRomanNumber(token.getToken())];
      }
      const wordForms = this.lookup(token.getLemma()!, posTag);
      return this.removeExceptions(wordForms);
    }
    if (posTagRegExp) {
      let p: Pattern;
      try {
        p = Pattern.compile(posTag);
      } catch (e) {
        throw new Error('RuntimeException: Error trying to synthesize POS tag ' + posTag +
                ' (posTagRegExp: true) from token ' + token.getToken(), { cause: e });
      }
      return this.synthesizeForPosTags(token.getLemma()!, (tag) => p.matcher(tag).matches());
    }
    return this.removeExceptions(this.synthesize(token, posTag));
  }

  /**
   * Synthesize forms for the given lemma and for all POS tags satisfying the given predicate.
   * @since 5.3
   */
  synthesizeForPosTags(lemma: string, acceptTag: (tag: string) => boolean): string[] {
    this.initPossibleTags();
    const results: string[] = [];
    for (const tag of this.possibleTags!) {
      if (acceptTag(tag)) {
        results.push(...this.lookup(lemma, tag));
      }
    }
    return this.removeExceptions(results);
  }

  getPosTagCorrection(posTag: string): string {
    return posTag;
  }

  /**
   * @since 2.5
   * @return the stemmer interface to be used.
   */
  getStemmer(): IStemmer {
    return this.stemmer;
  }

  protected initPossibleTags(): void {
    if (this.possibleTags == null) {
      this.possibleTags = this.loadTags();
    }
  }

  private loadTags(): string[] {
    const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(this.tagFileName);
    const tags = SynthesizerTools.loadWords(stream);
    if (this.manualSynthesizer != null) {
      for (const tag of this.manualSynthesizer.getPossibleTags()) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
    return tags;
  }

  getSpelledNumber(arabicNumeral: string): string {
    if (this.numberSpeller != null) {
      return this.numberSpeller.run(arabicNumeral);
    }
    return arabicNumeral;
  }

  getRomanNumber(arabicNumeral: string): string {
    if (this.romanNumberer != null) {
      return this.romanNumberer.run(arabicNumeral);
    }
    return arabicNumeral;
  }

  protected isException(_w: string): boolean {
    return false;
  }

  protected removeExceptions(words: string[]): string[] {
    const results: string[] = [];
    for (const word of words) {
      if (!this.isException(word)) {
        results.push(word);
      }
    }
    return results;
  }

  getTargetPosTag(posTags: string[], targetPosTag: string): string {
    if (posTags.length === 0) {
      return targetPosTag;
    }
    // return the last one to keep the previous results
    return posTags[posTags.length - 1]!;
  }

}
