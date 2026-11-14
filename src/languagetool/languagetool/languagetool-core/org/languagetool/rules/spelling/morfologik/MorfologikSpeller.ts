// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/morfologik/MorfologikSpeller.java faithful
// The Guava dictionary cache (expiring after 10 minutes) is a Map. Java's Dictionary.read(URL)
// reads the metadata (.info) next to the .dict; here both come from the data broker. Dictionaries
// outside the class path (Paths.get) are not supported. The constructors are one: the first
// argument is a class path or a Dictionary (the package-private constructor). `synchronized` is
// dropped (one thread).
// SpellingCheckRule.LANGUAGETOOL(ER) are inlined as strings: importing SpellingCheckRule (a Rule)
// here would make the taggers, which use getDictionaryWithCaching, load the rule classes.
import { JLanguageTool } from '../../../JLanguageTool.ts';
import { StringMatcher } from '../../patterns/StringMatcher.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import { WeightedSuggestion } from './WeightedSuggestion.ts';
import { Dictionary } from '../../../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryMetadata } from '../../../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryMetadata.ts';
import { Speller, type CandidateData } from '../../../../../../../morfologik-stemming/morfologik-speller/morfologik/speller/Speller.ts';

/** SpellingCheckRule.LANGUAGETOOL, SpellingCheckRule.LANGUAGETOOLER (see the header) */
const LANGUAGETOOL = 'LanguageTool';
const LANGUAGETOOLER = 'LanguageTooler';

// Speed up the server use case, where rules get initialized for every call.
// See https://github.com/morfologik/morfologik-stemming/issues/69 for confirmation that
// Dictionary is thread-safe:
const dictCache = new Map<string, Dictionary>();

function load(fileInClassPath: string): Dictionary {
  const dataBroker = JLanguageTool.getDataBroker();
  if (dataBroker.resourceExists(fileInClassPath)) {
    return Dictionary.read(dataBroker.getFromResourceDirAsStream(fileInClassPath),
      dataBroker.getFromResourceDirAsStream(DictionaryMetadata.getExpectedMetadataFileName(fileInClassPath)));
  } else {
    throw new Error('IOException: dictionary not in the class path: ' + fileInClassPath);
  }
}

/**
 * Morfologik-based spell checker.
 */
export class MorfologikSpeller {

  private readonly dictionary: Dictionary;
  private readonly speller: Speller;
  private readonly maxEditDistance: number;

  /**
   * Creates a speller with the given maximum edit distance (default: one).
   * @param fileInClassPath path in classpath to morfologik dictionary (or, since 2.9, the dictionary)
   */
  constructor(fileInClassPath: string | Dictionary, maxEditDistance = 1) {
    const dictionary = typeof fileInClassPath === 'string' ? MorfologikSpeller.getDictionaryWithCaching(fileInClassPath) : fileInClassPath;
    if (maxEditDistance <= 0) {
      throw new Error('RuntimeException: maxEditDistance must be > 0: ' + maxEditDistance);
    }
    this.dictionary = dictionary;
    this.maxEditDistance = maxEditDistance;
    this.speller = new Speller(dictionary, maxEditDistance);
  }

  /**
   * Load a dictionary from the given path or reuse a cached instance, if present.
   * @param fileInClassPath path in classpath to morfologik dictionary
   */
  static getDictionaryWithCaching(fileInClassPath: string): Dictionary {
    let dictionary = dictCache.get(fileInClassPath);
    if (dictionary === undefined) {
      dictionary = load(fileInClassPath);
      dictCache.set(fileInClassPath, dictionary);
    }
    return dictionary;
  }

  isMisspelled(word: string): boolean {
    if (word.length === 0 || LANGUAGETOOL === word || LANGUAGETOOLER === word) {
      return false;
    }
    return this.speller.isMisspelled(word);
  }

  findReplacements(word: string): string[] {
    return this.speller.findReplacements(word);
  }

  findSimilarWords(word: string): string[] {
    return this.speller.findSimilarWords(word);
  }

  /**
   * @deprecated use (or introduce) other methods to this class which would take care of the necessary synchronization
   */
  getSpeller(): Speller {
    return this.speller;
  }

  getSuggestions(word: string): WeightedSuggestion[] {
    const suggestions: WeightedSuggestion[] = [];
    if (word.length > StringMatcher.MAX_MATCH_LENGTH) {
      return suggestions;
    }
    // needs to be reset every time, possible bug: HMatrix for distance computation is not reset;
    // output changes when reused
    const speller = new Speller(this.dictionary, this.maxEditDistance);
    let replacementCandidates: CandidateData[];
    if (word.length < 50) {   // slow for long words (the limit is arbitrary)
      replacementCandidates = speller.findReplacementCandidates(word);
      for (const candidate of replacementCandidates) {
        suggestions.push(new WeightedSuggestion(candidate.getWord(), candidate.getDistance()));
      }
    }
    const runOnCandidates = speller.replaceRunOnWordCandidates(word);
    for (const runOnCandidate of runOnCandidates) {
      suggestions.push(new WeightedSuggestion(runOnCandidate.getWord(), runOnCandidate.getDistance()));
    }

    // all upper-case suggestions if necessary
    if (this.dictionary.metadata.isConvertingCase() && StringTools.isAllUppercase(word)) {
      for (let i = 0; i < suggestions.length; i++) {
        const sugg = suggestions[i]!;
        let allUppercase = sugg.getWord().toUpperCase();
        // do not use capitalized word if it matches the original word or it's mixed case
        if (allUppercase === word || StringTools.isMixedCase(suggestions[i]!.getWord())) {
          allUppercase = sugg.getWord();
        }
        // remove duplicates
        const auxIndex = this.getSuggestionIndex(suggestions, allUppercase);
        if (auxIndex > i) {
          suggestions.splice(auxIndex, 1);
        }
        if (auxIndex > -1 && auxIndex < i) {
          suggestions.splice(i, 1);
          i--;
        } else {
          suggestions[i] = new WeightedSuggestion(allUppercase, sugg.getWeight());
        }
      }
    }
    // capitalize suggestions if necessary
    else if (this.dictionary.metadata.isConvertingCase() && StringTools.startsWithUppercase(word)) {
      for (let i = 0; i < suggestions.length; i++) {
        const sugg = suggestions[i]!;
        let uppercaseFirst = StringTools.uppercaseFirstChar(sugg.getWord())!;
        // do not use capitalized word if it matches the original word or it's mixed case
        if (uppercaseFirst === word || StringTools.isMixedCase(suggestions[i]!.getWord())) {
          uppercaseFirst = sugg.getWord();
        }
        // remove capitalized duplicates
        const auxIndex = this.getSuggestionIndex(suggestions, uppercaseFirst);
        if (auxIndex > i) {
          suggestions.splice(auxIndex, 1);
        }
        if (auxIndex > -1 && auxIndex < i) {
          suggestions.splice(i, 1);
          i--;
        } else {
          suggestions[i] = new WeightedSuggestion(uppercaseFirst, sugg.getWeight());
        }
      }
    }
    return suggestions;
  }

  private getSuggestionIndex(suggestions: readonly WeightedSuggestion[], uppercaseFirst: string): number {
    let i = 0;
    for (const suggestion of suggestions) {
      if (suggestion.getWord() === uppercaseFirst) {
        return i;
      }
      i++;
    }
    return -1;
  }

  /**
   * Determines whether the dictionary uses case conversions.
   * @return True when the speller uses spell conversions.
   * @since 2.5
   */
  convertsCase(): boolean {
    return this.speller.convertsCase();
  }

  toString(): string {
    return 'dist=' + this.maxEditDistance;
  }

  getFrequency(word: string): number {
    let freq = this.speller.getFrequency(word);
    if (freq === 0 && word !== word.toLowerCase()) {
      freq = this.speller.getFrequency(word.toLowerCase());
    }
    return freq;
  }
}
