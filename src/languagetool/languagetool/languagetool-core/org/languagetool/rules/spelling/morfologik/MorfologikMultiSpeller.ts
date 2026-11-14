// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/morfologik/MorfologikMultiSpeller.java reduced
// Differences from Java:
// - The FSA built from the plain text lines (FSABuilder) is used directly as the Dictionary's FSA;
//   Java serializes it with CFSA2Serializer and reads it back, which gives the same automaton
//   (CFSA2Serializer is not ported).
// - BufferedReaders are LineReaders over the lines of the (preloaded) resources; like Java's
//   SequenceInputStream reader, the reader over all plain text files is consumed by the first
//   read, so the lines of all files end up in the cache entry of the first path, as in Java.
// - The Guava caches are Maps (no expiry); the user dictionary cache is not size-bounded (no
//   weigher): the user dictionary of a premium user is cached by its name.
// - The constructors are one: the String / BufferedReader overloads are told apart by the type of
//   the second argument; the 4-argument overload is the 6-argument one with null user config and language.
import { JLanguageTool } from '../../../JLanguageTool.ts';
import type { Language } from '../../../Language.ts';
import type { UserConfig } from '../../../UserConfig.ts';
import { MorfologikSpeller } from './MorfologikSpeller.ts';
import type { WeightedSuggestion } from './WeightedSuggestion.ts';
import { Dictionary } from '../../../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryMetadata } from '../../../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryMetadata.ts';
import { FSABuilder } from '../../../../../../../morfologik-stemming/morfologik-fsa-builders/morfologik/fsa/builders/FSABuilder.ts';
import { StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';

/** SpellingCheckRule.LANGUAGETOOL (inlined, see MorfologikSpeller.ts) */
const LANGUAGETOOL = 'LanguageTool';

const encoder = new TextEncoder();
/** String.getBytes(UTF_8) */
function getBytes(s: string): Int8Array {
  const b = encoder.encode(s);
  return new Int8Array(b.buffer, b.byteOffset, b.length);
}

/** A BufferedReader over lines (readLine returns null at the end). */
export class LineReader {
  private readonly lines: readonly string[];
  private pos = 0;

  constructor(lines: readonly string[]) {
    this.lines = lines;
  }

  readLine(): string | null {
    return this.pos < this.lines.length ? this.lines[this.pos++]! : null;
  }
}

function getLines(br: LineReader, _path: string, lang: Language | null): Int8Array[] {
  const lines: Int8Array[] = [];
  let originalLine: string | null;
  while ((originalLine = br.readLine()) != null) {
    let lineList: string[];
    if (lang != null) {
      lineList = lang.prepareLineForSpeller(originalLine);
    } else {
      lineList = [originalLine];
    }
    for (let line of lineList) {
      if (line.startsWith('#') || line.length === 0) {
        continue;
      }
      line = StringTrim(line.split('#')[0]!);
      if (line.length !== 0) {
        lines.push(getBytes(line));
      }
    }
  }
  return lines;
}

// BufferedReaderWithSource equals readerPath and languageVariantPath:
const dictCache = new Map<string, Int8Array[]>();

function dictCacheGet(reader: BufferedReaderWithSource): Int8Array[] {
  const key = reader.readerPath + '\u0000' + reader.languageVariantPath;
  let lines = dictCache.get(key);
  if (lines === undefined) {
    lines = getLines(reader.reader, reader.readerPath, reader.language);
    if (reader.languageVariantReader != null) {
      lines.push(...getLines(reader.languageVariantReader, reader.readerPath, reader.language));
      lines.push(getBytes(LANGUAGETOOL)); // adding here so it's also used for suggestions
    }
    dictCache.set(key, lines);
  }
  return lines;
}

const dicPathToDict = new Map<string, Dictionary>();
const userDictCaches = new Map<string, Map<string, Dictionary>>();

/**
 * Morfologik speller that merges results from binary (.dict) and plain text
 * (.txt) dictionaries.
 *
 * @since 2.9
 */
export class MorfologikMultiSpeller {

  private readonly spellers: readonly MorfologikSpeller[];
  private readonly defaultDictSpellers: readonly MorfologikSpeller[];
  private readonly userDictSpellers: readonly MorfologikSpeller[];
  private readonly _convertsCase: boolean;
  private readonly premiumUid: number | null;
  private readonly userDictCacheSize: number | null;
  private readonly userDictName: string | null;
  private readonly userDictCacheKey: string | null;
  private readonly language: Language | null;

  /**
   * @param binaryDictPath  path in classpath to a {@code .dict} binary Morfologik
   *                        file
   * @param plainTextPaths  paths in classpath to plain text {@code .txt} files
   *                        (like spelling.txt), or (since 3.0) a reader with them
   * @param maxEditDistance maximum edit distance for accepting suggestions
   * @since 4.2
   */
  constructor(binaryDictPath: string, plainTextPaths: string[], languageVariantPlainTextPath: string | null,
              userConfig: UserConfig | null, maxEditDistance: number, lang: Language | null);
  constructor(binaryDictPath: string, plainTextPaths: string[], languageVariantPlainTextPath: string | null, maxEditDistance: number);
  constructor(binaryDictPath: string, plainTextReader: LineReader | null, plainTextReaderPath: string[],
              languageVariantPlainTextReader: LineReader | null, languageVariantPlainTextPath: string | null, userConfig: UserConfig | null,
              maxEditDistance: number, lang: Language | null);
  constructor(binaryDictPath: string, a: string[] | LineReader | null, b: string | null | string[], c?: UserConfig | null | number | LineReader,
              d?: number | string | null, e?: Language | null | UserConfig, f?: number, g?: Language | null) {
    if (Array.isArray(a)) {
      const plainTextPaths = a;
      const languageVariantPlainTextPath = b as string | null;
      let userConfig: UserConfig | null;
      let maxEditDistance: number;
      let lang: Language | null;
      if (typeof c === 'number') {
        userConfig = null; maxEditDistance = c; lang = null;
      } else {
        userConfig = (c as UserConfig | null | undefined) ?? null; maxEditDistance = d as number; lang = (e as Language | null | undefined) ?? null;
      }
      const r = MorfologikMultiSpeller.init(binaryDictPath,
        MorfologikMultiSpeller.getBufferedReader(plainTextPaths),
        plainTextPaths,
        languageVariantPlainTextPath == null ? null
          : new LineReader(JLanguageTool.getDataBroker().getFromResourceDirAsLines(languageVariantPlainTextPath)),
        languageVariantPlainTextPath,
        userConfig, maxEditDistance, lang);
      this.language = r.language; this.premiumUid = r.premiumUid; this.userDictName = r.userDictName;
      this.userDictCacheSize = r.userDictCacheSize; this.userDictCacheKey = r.userDictCacheKey;
      this.spellers = r.spellers; this.userDictSpellers = r.userDictSpellers; this.defaultDictSpellers = r.defaultDictSpellers;
      this._convertsCase = r.convertsCase;
      for (const plainTextPath of plainTextPaths) {
        if (plainTextPath != null &&
          (!plainTextPath.endsWith('.txt') ||
            (languageVariantPlainTextPath != null && !languageVariantPlainTextPath.endsWith('.txt')))) {
          throw new Error(
            'IllegalArgumentException: Unsupported dictionary, plain text file needs to have suffix .txt: ' + plainTextPath);
        }
      }
    } else {
      const r = MorfologikMultiSpeller.init(binaryDictPath, a, b as string[], c as LineReader | null, d as string | null,
        e as UserConfig | null, f!, g ?? null);
      this.language = r.language; this.premiumUid = r.premiumUid; this.userDictName = r.userDictName;
      this.userDictCacheSize = r.userDictCacheSize; this.userDictCacheKey = r.userDictCacheKey;
      this.spellers = r.spellers; this.userDictSpellers = r.userDictSpellers; this.defaultDictSpellers = r.defaultDictSpellers;
      this._convertsCase = r.convertsCase;
    }
  }

  /** The body of the BufferedReader constructor (Java assigns the final fields there). */
  private static init(binaryDictPath: string, plainTextReader: LineReader | null, plainTextReaderPath: string[],
                      languageVariantPlainTextReader: LineReader | null, languageVariantPlainTextPath: string | null, userConfig: UserConfig | null,
                      maxEditDistance: number, lang: Language | null) {
    const self = {
      language: lang,
      premiumUid: null as number | null,
      userDictName: null as string | null,
      userDictCacheSize: null as number | null,
      userDictCacheKey: null as string | null,
      spellers: [] as MorfologikSpeller[],
      userDictSpellers: [] as MorfologikSpeller[],
      defaultDictSpellers: [] as MorfologikSpeller[],
      convertsCase: false,
    };
    if (userConfig == null || userConfig.getAcceptedWords() == null || userConfig.getAcceptedWords().length === 0) {
      self.premiumUid = null;
      self.userDictName = null;
      self.userDictCacheSize = null;
    } else {
      self.premiumUid = userConfig.getPremiumUid();
      self.userDictName = userConfig.getUserDictName();
      self.userDictCacheSize = userConfig.getUserDictCacheSize();
    }
    if (self.premiumUid != null && self.userDictCacheSize != null) {
      self.userDictCacheKey = self.premiumUid + '|' + binaryDictPath;
    } else {
      self.userDictCacheKey = null;
    }
    const speller = MorfologikMultiSpeller.getBinaryDict(binaryDictPath, maxEditDistance);
    const spellers: MorfologikSpeller[] = [];
    const userDictSpeller = MorfologikMultiSpeller.getUserDictSpellerOrNull(self, userConfig, binaryDictPath, maxEditDistance);
    if (userDictSpeller != null) {
      // add this first, as otherwise suggestions from user's own dictionary might
      // drown in the mass of other suggestions
      spellers.push(userDictSpeller);
      self.userDictSpellers = [userDictSpeller];
    } else {
      self.userDictSpellers = [];
    }
    spellers.push(speller);
    self.convertsCase = speller.convertsCase();
    if (plainTextReader != null) {
      const plainTextSpeller = MorfologikMultiSpeller.getPlainTextDictSpellerOrNull(self, plainTextReader, plainTextReaderPath,
        languageVariantPlainTextReader, languageVariantPlainTextPath, binaryDictPath, maxEditDistance);
      if (plainTextSpeller != null) {
        spellers.push(plainTextSpeller);
        self.defaultDictSpellers = [speller, plainTextSpeller];
      } else {
        self.defaultDictSpellers = [speller];
      }
    } else {
      self.defaultDictSpellers = [speller];
    }
    self.spellers = Object.freeze(spellers) as MorfologikSpeller[];
    return self;
  }

  private static getBufferedReader(plainTextPaths: string[]): LineReader {
    const lines: string[] = [];
    for (const plainTextPath of plainTextPaths) {
      lines.push(...JLanguageTool.getDataBroker().getFromResourceDirAsLines(plainTextPath));
    }
    return new LineReader(lines);
  }

  /**
   * for tests only
   */
  static clearUserDictCache(): void {
    userDictCaches.clear();
  }

  private static getUserDictSpellerOrNull(self: { premiumUid: number | null }, userConfig: UserConfig | null, dictPath: string,
                                          maxEditDistance: number): MorfologikSpeller | null {
    if (self.premiumUid == null) {
      return null;
    }
    if (userConfig!.getAcceptedWords().length === 0) {
      return null;
    }
    const byteLinesSupplier = (): Int8Array[] => {
      const byteLines: Int8Array[] = [];
      for (const line of userConfig!.getAcceptedWords()) {
        byteLines.push(getBytes(line));
      }
      return byteLines;
    };
    const dictionary = MorfologikMultiSpeller.getDictionary(self as never, byteLinesSupplier, dictPath,
      dictPath.replace(JLanguageTool.DICTIONARY_FILENAME_EXTENSION, '.info'),
      true, userConfig!.getAcceptedWords().length);
    return new MorfologikSpeller(dictionary!, maxEditDistance);
  }

  private static getBinaryDict(binaryDictPath: string, maxEditDistance: number): MorfologikSpeller {
    if (binaryDictPath.endsWith(JLanguageTool.DICTIONARY_FILENAME_EXTENSION)) {
      return new MorfologikSpeller(binaryDictPath, maxEditDistance);
    } else {
      throw new Error(
        'IllegalArgumentException: Unsupported dictionary, binary Morfologik file needs to have suffix .dict: ' + binaryDictPath);
    }
  }

  private static getPlainTextDictSpellerOrNull(self: { language: Language | null; userDictCacheSize: number | null; userDictCacheKey: string | null; userDictName: string | null },
                                               plainTextReader: LineReader,
                                               plainTextReaderPaths: string[],
                                               languageVariantPlainTextReader: LineReader | null, languageVariantPlainTextPath: string | null, dictPath: string,
                                               maxEditDistance: number): MorfologikSpeller | null {
    const lineSupplier = (): Int8Array[] | null => {
      const lines: Int8Array[] = [];
      for (const plainTextReaderPath of plainTextReaderPaths) {
        const l = dictCacheGet(new BufferedReaderWithSource(plainTextReader, plainTextReaderPath,
          languageVariantPlainTextReader, languageVariantPlainTextPath, self.language));
        lines.push(...l);
      }
      if (lines.length === 0) {
        return null;
      }
      return lines;
    };
    const dictionary = MorfologikMultiSpeller.getDictionary(self, lineSupplier, '[' + plainTextReaderPaths.join(', ') + ']',
      dictPath.replace(JLanguageTool.DICTIONARY_FILENAME_EXTENSION, '.info'), false, 0);
    if (dictionary == null) {
      return null;
    }
    return new MorfologikSpeller(dictionary, maxEditDistance);
  }

  private static getDictionary(self: { userDictCacheSize: number | null; userDictCacheKey: string | null; userDictName: string | null },
                               lines: () => Int8Array[] | null, dictPath: string, infoPath: string, isUserDict: boolean,
                               _userDictSize: number): Dictionary | null {
    // avoid reading data for dictionaries when we can just use the cached one
    // by passing in lines lazily
    const cacheKey = dictPath + '|' + infoPath;
    const dictFromCache = dicPathToDict.get(cacheKey);
    if (!isUserDict && dictFromCache != null) {
      return dictFromCache;
    } else {
      if (isUserDict && self.userDictCacheSize != null) {
        const userDict = MorfologikMultiSpeller.getUserDictCache(self).get(self.userDictName!);
        if (userDict != null) {
          return userDict;
        }
      }
      // Creating the dictionary at runtime can easily take 50ms for spelling.txt
      // files
      // that are ~50KB. We don't want that overhead for every check of a short
      // sentence,
      // so we cache the result
      // Two caches exist: One for the standard dictionaries, which are static and in
      // dicPathToDict
      // Another one for user dictionaries, this is only enabled for selected users
      // with huge and relatively static dictionaries
      //
      const linesCopy = lines();
      // (Java: lines.get() returns null for an empty plain text dictionary, and isEmpty() then throws)
      if (linesCopy == null || linesCopy.length === 0) {
        return null;
      }
      linesCopy.sort(FSABuilder.LEXICAL_ORDERING);
      const fsa = FSABuilder.build(linesCopy);
      const metadata = JLanguageTool.getDataBroker().getFromResourceDirAsStream(infoPath);
      const dict = new Dictionary(fsa, DictionaryMetadata.read(metadata));
      if (!isUserDict) {
        dicPathToDict.set(cacheKey, dict);
      } else if (self.userDictCacheSize != null) {
        MorfologikMultiSpeller.getUserDictCache(self).set(self.userDictName!, dict);
      }
      return dict;
    }
  }

  private static getUserDictCache(self: { userDictCacheKey: string | null }): Map<string, Dictionary> {
    let cache = userDictCaches.get(self.userDictCacheKey!);
    if (cache === undefined) {
      cache = new Map();
      userDictCaches.set(self.userDictCacheKey!, cache);
    }
    return cache;
  }

  /**
   * Accept the word if at least one of the dictionaries accepts it as not
   * misspelled.
   */
  isMisspelled(word: string): boolean {
    for (const speller of this.spellers) {
      if (!speller.isMisspelled(word)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the frequency of use of a word (0-27) from the dictionary
   */
  getFrequency(word: string): number {
    for (const speller of this.spellers) {
      const freq = speller.getFrequency(word);
      if (freq > 0) {
        return freq;
      }
    }
    return 0;
  }

  private getSuggestionsFromSpellers(word: string, spellerList: readonly MorfologikSpeller[]): string[] {
    const result: WeightedSuggestion[] = [];
    const seenWords = new Set<string>();
    for (const speller of spellerList) {
      const suggestions = speller.getSuggestions(word);
      for (const suggestion of suggestions) {
        if (!seenWords.has(suggestion.getWord()) && suggestion.getWord() !== word) {
          result.push(suggestion);
        }
        seenWords.add(suggestion.getWord());
      }
    }
    result.sort((x, y) => x.compareTo(y));  // stable, as Collections.sort
    const wordResults: string[] = [];
    const maxWeightDiff = (this.language != null ? this.language.getSpellerMaxWeightDiff() : -1);
    let prevWeight = -1;
    for (const weightedSuggestion of result) {
      if (maxWeightDiff > 0 && prevWeight > 0 && (weightedSuggestion.getWeight() - prevWeight > maxWeightDiff)) {
        break;
      }
      wordResults.push(weightedSuggestion.getWord());
      prevWeight = weightedSuggestion.getWeight();
    }
    return wordResults;
  }

  /**
   * The suggestions from all dictionaries (without duplicates).
   */
  getSuggestions(word: string): string[] {
    return this.getSuggestionsFromSpellers(word, this.spellers);
  }

  /**
   * @param word misspelled word
   * @return suggestions from users personal dictionary
   * @since 4.5
   */
  getSuggestionsFromUserDicts(word: string): string[] {
    return this.getSuggestionsFromSpellers(word, this.userDictSpellers);
  }

  private readonly defaultDictSuggestionsCache = new Map<string, string[]>();

  /**
   * @param word misspelled word
   * @return suggestions from built-in dictionaries
   * @since 4.5
   */
  getSuggestionsFromDefaultDicts(word: string): string[] {
    let result = this.defaultDictSuggestionsCache.get(word);
    if (result === undefined) {
      result = this.getSuggestionsFromSpellers(word, this.defaultDictSpellers);
      if (this.defaultDictSuggestionsCache.size >= 2000) {  // maximumSize(2000)
        this.defaultDictSuggestionsCache.delete(this.defaultDictSuggestionsCache.keys().next().value!);
      }
      this.defaultDictSuggestionsCache.set(word, result);
    }
    return [...result];
  }

  /**
   * Determines whether the dictionary uses case conversions.
   *
   * @return True when the speller uses spell conversions.
   * @since 2.5
   */
  convertsCase(): boolean {
    return this._convertsCase;
  }
}

export class BufferedReaderWithSource {
  readonly reader: LineReader;
  readonly readerPath: string;
  readonly languageVariantReader: LineReader | null;
  readonly languageVariantPath: string | null;
  readonly language: Language | null;

  constructor(reader: LineReader, readerPath: string, languageVariantReader: LineReader | null,
              languageVariantPath: string | null, language: Language | null) {
    this.reader = reader;
    this.readerPath = readerPath;
    this.languageVariantReader = languageVariantReader;
    this.languageVariantPath = languageVariantPath;
    this.language = language;
  }
}
