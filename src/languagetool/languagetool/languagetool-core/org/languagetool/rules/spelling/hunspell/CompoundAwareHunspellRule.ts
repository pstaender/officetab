// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/hunspell/CompoundAwareHunspellRule.java faithful
// The constructors are one: morfoSpeller is a MorfologikMultiSpeller or a Supplier of one (a
// function), memoized as Guava's Suppliers.memoize does; altLanguages and languageModel are
// optional. getStreams returns the lines of the files (with the separating "# Start of file"
// lines) instead of a list of InputStreams. The getCandidates overloads are one method
// (a word or a list of parts). CompoundWordTokenizer (a Tokenizer: one method) may be a function.
import { JLanguageTool } from '../../../JLanguageTool.ts';
import type { Language } from '../../../Language.ts';
import type { UserConfig } from '../../../UserConfig.ts';
import type { LanguageModel } from '../../../languagemodel/LanguageModel.ts';
import type { MorfologikMultiSpeller } from '../morfologik/MorfologikMultiSpeller.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import { HunspellRule } from './HunspellRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/** org.languagetool.tokenizers.CompoundWordTokenizer, or the lambda implementing it. */
export type CompoundWordTokenizer = ((text: string) => string[]) | { tokenize(text: string): readonly string[] };

const MAX_SUGGESTIONS = 20;

/** StringUtils.removeEnd */
function removeEnd(str: string, remove: string): string {
  return remove.length > 0 && str.endsWith(remove) ? str.substring(0, str.length - remove.length) : str;
}

/**
 * A spell checker that combines Hunspell and Morfologik spell checking
 * to support compound words and offer fast suggestions for some misspelled
 * compound words.
 */
export abstract class CompoundAwareHunspellRule extends HunspellRule {

  private readonly compoundSplitter: CompoundWordTokenizer;
  private readonly morfoSpeller: () => MorfologikMultiSpeller;

  protected abstract filterForLanguage(suggestions: string[]): void;

  protected static getSpellingFilePaths(langCode: string): string[] {
    return [
      '/' + langCode + '/hunspell/spelling.txt',
      '/' + langCode + '/hunspell/spelling_custom.txt',
      '/' + langCode + '/multitoken-suggest.txt',
      'spelling_global.txt',
    ];
  }

  /** The lines of the files, each file preceded by a "# Start of file" line (Java: a list of streams read in sequence). */
  protected static getStreams(paths: readonly string[]): string[] {
    const streams: string[] = [];
    for (const path of paths) {
      // add separation between streams so that missing newlines at the end don't join the last & first line from two files
      const separation = '# Start of file ' + path.replaceAll('\n', '');
      streams.push(separation);
      for (const line of JLanguageTool.getDataBroker().getFromResourceDirAsLines(path)) streams.push(line);
      // (Java adds a line separator after each file: don't crash if input doesn't end with newline)
    }
    return streams;
  }

  /**
   * @since 4.3 (altLanguages), 6.4 (Supplier)
   */
  constructor(messages: ResourceBundle, language: Language, compoundSplitter: CompoundWordTokenizer,
              morfoSpeller: MorfologikMultiSpeller | null | (() => MorfologikMultiSpeller | null), userConfig: UserConfig | null,
              altLanguages: Language[] = [], languageModel: LanguageModel | null = null) {
    super(messages, language, userConfig, altLanguages, languageModel);
    this.compoundSplitter = compoundSplitter;
    const supplier = typeof morfoSpeller === 'function' ? morfoSpeller : () => morfoSpeller;
    let memo: { value: MorfologikMultiSpeller } | null = null;
    this.morfoSpeller = () => (memo ??= { value: supplier()! }).value;
  }

  /**
   * As a hunspell-based approach is too slow, we use Morfologik to create suggestions. As this
   * won't work for compounds not in the dictionary, we split the word and also get suggestions
   * on the compound parts. In the end, all candidates are filtered against Hunspell again (which
   * supports compounds).
   */
  override getSuggestions(word: string): string[] {
    this.ensureInitialized();
    //System.out.println("Computing suggestions for " + word);
    const candidates = this.getCandidates(word);
    let simpleSuggestions = this.getCorrectWords(candidates);
    simpleSuggestions = this.getFilteredSuggestions(simpleSuggestions);
    //System.out.println("simpleSuggestions: " + simpleSuggestions);

    const morfoSpeller = this.morfoSpeller();
    const noSplitSuggestions = [...morfoSpeller.getSuggestions(word)];  // after getCorrectWords() so spelling.txt is considered
    CompoundAwareHunspellRule.handleWordEndPunctuation('.', word, noSplitSuggestions, morfoSpeller);
    CompoundAwareHunspellRule.handleWordEndPunctuation('...', word, noSplitSuggestions, morfoSpeller);
    let noSplitLowercaseSuggestions: string[] = [];
    if (StringTools.startsWithUppercase(word) && !StringTools.isAllUppercase(word)) {
      // almost all words can be uppercase because they can appear at the start of a sentence:
      noSplitLowercaseSuggestions = morfoSpeller.getSuggestions(word.toLowerCase());
    }
    //System.out.println("noSplitSuggestions: " + noSplitSuggestions);
    //System.out.println("noSplitLcSuggestions: " + noSplitLowercaseSuggestions);
    // We don't know about the quality of the results here, so mix both lists together,
    // taking elements from both lists on a rotating basis:
    let suggestions: string[] = [];
    const max = Math.max(simpleSuggestions.length, noSplitSuggestions.length, noSplitLowercaseSuggestions.length);
    for (let i = 0; i < max; i++) {
      if (i < noSplitSuggestions.length) {
        suggestions.push(noSplitSuggestions[i]!);
      }
      if (i < noSplitLowercaseSuggestions.length) {
        suggestions.push(StringTools.uppercaseFirstChar(noSplitLowercaseSuggestions[i]!)!);
      }
      // put these behind suggestions by Morfologik, often low-quality / made-up words
      if (i < simpleSuggestions.length) {
        suggestions.push(simpleSuggestions[i]!);
      }
    }
    //System.out.println("suggestions (mixed from simpleSuggestions, noSplitSuggestions, noSplitLowerCaseSuggestions): " + suggestions);

    suggestions = HunspellRule.filterDupes(suggestions);
    this.filterForLanguage(suggestions);

    const sortedSuggestions = this.sortSuggestionByQuality(word, suggestions);
    //System.out.println("sortSuggestionByQuality(): " + sortedSuggestions);
    // This is probably be the right place to sort suggestions by probability:
    //SuggestionSorter sorter = new SuggestionSorter(new LuceneLanguageModel(new File("/home/dnaber/data/google-ngram-index/de")));
    //sortedSuggestions = sorter.sortSuggestions(sortedSuggestions);
    //System.out.println();
    return sortedSuggestions.slice(0, Math.min(MAX_SUGGESTIONS, sortedSuggestions.length));
  }

  private static handleWordEndPunctuation(punct: string, word: string, noSplitSuggestions: string[], morfoSpeller: MorfologikMultiSpeller): void {
    if (word.endsWith(punct)) {
      // e.g. "informationnen." - the dot is a word char in hunspell, so it needs special treatment here
      const tmp = morfoSpeller.getSuggestions(word.substring(0, word.length - punct.length));
      for (const s of tmp) {
        noSplitSuggestions.push(s + punct);
      }
    }
  }

  /**
   * Find potential corrections - it's okay if some of these are not valid words,
   * this list will be filtered against the spellchecker before being returned to the user.
   * Overloads: (word) splits the word with the compound splitter; (parts) ...
   */
  getCandidates(word: string | readonly string[]): string[] {
    if (typeof word === 'string') {
      const s = this.compoundSplitter;
      return typeof s === 'function' ? s(word) : [...s.tokenize(word)];
    }
    const parts = word;
    let partCount = 0;
    const candidates: string[] = [];
    for (const part of parts) {
      if (!this.hunspell!.spell(part)) {
        // assume noun, so use uppercase:
        const morfoSpeller = this.morfoSpeller();
        const doUpperCase = partCount > 0 && !StringTools.startsWithUppercase(part);
        let suggestions = [...morfoSpeller.getSuggestions(doUpperCase ? StringTools.uppercaseFirstChar(part)! : part)];
        if (suggestions.length === 0) {
          suggestions = [...morfoSpeller.getSuggestions(doUpperCase ? StringTools.lowercaseFirstChar(part) : part)];
        }
        let appendS = false;
        if (doUpperCase && part.endsWith('s')) {  // maybe infix-s as in "Dampfschiffahrtskapitän" -> "Dampfschifffahrtskapitän"
          suggestions.push(...morfoSpeller.getSuggestions(removeEnd(part, 's')));
          appendS = true;
        }
        for (let suggestion of suggestions) {
          const partsCopy = [...parts];
          if (appendS) {
            suggestion += 's';
          }
          if (partCount > 0 && parts[partCount]!.startsWith('-') && parts[partCount]!.length > 1) {
            partsCopy[partCount] = '-' + StringTools.uppercaseFirstChar(suggestion.substring(1));
          } else if (partCount > 0 && !parts[partCount - 1]!.endsWith('-')) {
            partsCopy[partCount] = suggestion.toLowerCase();
          } else {
            partsCopy[partCount] = suggestion;
          }
          const candidate = partsCopy.join('');
          if (!this.isMisspelled(candidate)) {
            candidates.push(candidate);
          }
          // Arbeidszimmer -> Arbeitszimmer:
          if (partCount < parts.length - 1 && part.endsWith('s') && suggestion.endsWith('-')) {
            partsCopy[partCount] = suggestion.substring(0, suggestion.length - 1);
            const infixCandidate = partsCopy.join('');
            if (!this.isMisspelled(infixCandidate)) {
              candidates.push(infixCandidate);
            }
          }
        }
      }
      // What if there's no misspelled parts like for Arbeitamt = Arbeit+Amt ??
      // -> morfologik must be extended to return similar words even for known words
      // But GermanSpellerRule.getCandidates() has a solution for the cases with infix "s".
      partCount++;
    }
    return candidates;
  }

  protected override sortSuggestionByQuality(misspelling: string, suggestions: string[]): string[] {
    const result: string[] = [];
    for (const suggestion of suggestions) {
      if (suggestion.replaceAll(' ', '') === misspelling
          && suggestion.split(' ').filter((k) => k.length > 0).every((k) => k.length !== 1)) {
        // prefer run-on words unless a single letter is split off:
        result.unshift(suggestion);
      } else {
        result.push(suggestion);
      }
    }
    return result;
  }

  // avoid over-accepting words, as the Morfologik approach above might construct
  // compound words with parts that are correct but the compound is not correct (e.g. "Arbeit + Amt = Arbeitamt"):
  private getCorrectWords(wordsOrPhrases: readonly string[]): string[] {
    const result: string[] = [];
    for (const wordOrPhrase of wordsOrPhrases) {
      // this might be a phrase like "aufgrund dessen", so it needs to be split:
      const words = this.tokenizeText(wordOrPhrase);
      let wordIsOkay = true;
      for (const word of words) {
        if (!this.hunspell!.spell(word)) {
          wordIsOkay = false;
          break;
        }
      }
      if (wordIsOkay) {
        result.push(wordOrPhrase);
      }
    }
    return result;
  }

  /**
   * @since 4.7
   */
  protected getFilteredSuggestions(wordsOrPhrases: string[]): string[] {
    return wordsOrPhrases;
  }

}
