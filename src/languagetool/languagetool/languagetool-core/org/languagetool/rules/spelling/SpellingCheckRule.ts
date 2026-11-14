// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/SpellingCheckRule.java reduced
// Left out: in addSuggestionsToRuleMatch, the SuggestionsOrdererFeatureExtractor branch (machine
// learned suggestion ordering is not ported; an orderer of that kind cannot exist here). The
// constructors are one (altLanguages and languageModel optional). DisambiguationPatternRule is
// created through Rule.DisambiguationPatternRule (see Rule.ts for the import cycle). `volatile`
// and `synchronized` are dropped (one thread). Arrays.binarySearch and Guava's
// Strings.commonPrefix are local functions.
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../JLanguageTool.ts';
import type { Language } from '../../Language.ts';
import type { UserConfig } from '../../UserConfig.ts';
import type { LanguageModel } from '../../languagemodel/LanguageModel.ts';
import { ITSIssueType } from '../ITSIssueType.ts';
import { Rule } from '../Rule.ts';
import { RuleMatch, Type as RuleMatch_Type } from '../RuleMatch.ts';
import { SuggestedReplacement, SuggestionType } from '../SuggestedReplacement.ts';
import { PatternToken } from '../patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../patterns/PatternTokenBuilder.ts';
import type { DisambiguationPatternRule } from '../../tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { WordTokenizer } from '../../tokenizers/WordTokenizer.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { CachingWordListLoader } from './CachingWordListLoader.ts';
import type { SuggestionsOrderer } from './suggestions/SuggestionsOrderer.ts';
import { isSuggestionsRanker } from './suggestions/SuggestionsRanker.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';
import { String_CASE_INSENSITIVE_ORDER } from '../../../../../../jdk/java/lang/String.ts';
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { List_contains } from '../../../../../../jdk/java/util/Objects.ts';
import { StringTrim } from '../../../../../../jdk/java/lang/Character.ts';

const SPELLING_IGNORE_FILE = '/hunspell/ignore.txt';
const SPELLING_FILE = '/hunspell/spelling.txt';
const SPELLING_PROHIBIT_FILE = '/hunspell/prohibit.txt';
const CUSTOM_SPELLING_PROHIBIT_FILE = '/hunspell/prohibit_custom.txt';
const SPELLING_FILE_VARIANT: string | null = null;

let patterns: { pHasNoLetterLatin: Pattern; pHasNoLetter: Pattern } | null = null;
const P = () => (patterns ??= {
  pHasNoLetterLatin: Pattern.compile('^[^\\p{script=latin}]+$'),
  pHasNoLetter: Pattern.compile('^[^\\p{L}]+$'),
});

/** DisambiguationPatternRule.DisambiguatorAction.IGNORE_SPELLING */
const IGNORE_SPELLING = 'IGNORE_SPELLING' as const;

/** Arrays.binarySearch(array, key, comparator) */
function binarySearch(a: readonly string[], key: string, c: (x: string, y: string) => number): number {
  let low = 0;
  let high = a.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const cmp = c(a[mid]!, key);
    if (cmp < 0) {
      low = mid + 1;
    } else if (cmp > 0) {
      high = mid - 1;
    } else {
      return mid; // key found
    }
  }
  return -(low + 1);  // key not found.
}

/** Guava's Strings.commonPrefix (without the surrogate pair check's subtleties: it backs off a split pair) */
function commonPrefix(a: string, b: string): string {
  const maxPrefixLength = Math.min(a.length, b.length);
  let p = 0;
  while (p < maxPrefixLength && a.charAt(p) === b.charAt(p)) {
    p++;
  }
  if (p > 0 && p - 1 < a.length && isHighSurrogate(a.charCodeAt(p - 1))) {
    if ((p < a.length && isLowSurrogate(a.charCodeAt(p))) || (p < b.length && isLowSurrogate(b.charCodeAt(p)))) {
      p--;
    }
  }
  return a.substring(0, p);
}
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * An abstract rule for spellchecking rules.
 *
 * @author Marcin Miłkowski
 */
export abstract class SpellingCheckRule extends Rule {

  /**
   * The confidence value for a suggestion with high confidence. Not 1.0, as even with a high confidence,
   * we might still be wrong.
   */
  static readonly HIGH_CONFIDENCE = 0.99;

  /**
   * The string {@code LanguageTool}.
   * @since 2.3
   */
  static readonly LANGUAGETOOL = 'LanguageTool';
  /**
   * The string {@code LanguageTooler}.
   * @since 4.4
   */
  static readonly LANGUAGETOOLER = 'LanguageTooler';
  static readonly MAX_TOKEN_LENGTH = 200;

  protected readonly language: Language;

  /**
   * @since 4.5
   * For rules from @see Language.getRelevantLanguageModelCapableRules
   * Optional, allows e.g. better suggestions when set
   */
  protected languageModel: LanguageModel | null;
  protected readonly wordListLoader = new CachingWordListLoader();

  protected static readonly CUSTOM_SPELLING_FILE = '/hunspell/spelling_custom.txt';
  static readonly GLOBAL_SPELLING_FILE = 'spelling_global.txt';

  private readonly wordsToBeProhibited = new Set<string>();

  private wordsToBeIgnoredDictionary: string[] | null = null;
  private wordsToBeIgnoredDictionaryIgnoreCase: string[] | null = null;

  private antiPatterns: DisambiguationPatternRule[] = [];
  private considerIgnoreWords = true;
  private convertsCase = false;
  protected readonly wordsToBeIgnored = new Set<string>();
  protected ignoreWordsWithLength = 0;

  /**
   * @since 4.4 (altLanguages), 4.5 (languageModel)
   */
  constructor(messages: ResourceBundle, language: Language, userConfig: UserConfig | null, _altLanguages: Language[] = [],
              languageModel: LanguageModel | null = null) {
    super(messages);
    this.language = language;
    this.languageModel = languageModel;
    if (userConfig != null) {
      for (const w of userConfig.getAcceptedWords()) this.wordsToBeIgnored.add(w);
    }
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
  }

  /**
   * @param word misspelled word that suggestions should be generated for
   * @param userCandidatesList candidates from personal dictionary
   * @param candidatesList candidates from default dictionary
   * @param orderer model to rank suggestions / extract features, or null
   * @param match rule match to add suggestions to
   */
  protected static addSuggestionsToRuleMatch(word: string, userCandidatesList: SuggestedReplacement[], candidatesList: SuggestedReplacement[],
                                             orderer: SuggestionsOrderer | null, match: RuleMatch): void {
    const sentence = match.getSentence();
    const userCandidates = userCandidatesList.map((s) => s.getReplacement());
    const candidates = candidatesList.map((s) => s.getReplacement());
    const startPos = match.getFromPos();
    //long startTime = System.currentTimeMillis();
    if (orderer != null && orderer.isMlAvailable()) {
      if (isSuggestionsRanker(orderer)) {
        // don't rank words form user dictionary, assign confidence 0.0, but add at start
        // hard to ensure performance on unknown words
        const ranker = orderer;
        const defaultSuggestions = ranker.orderSuggestions(
          candidates, word, sentence, startPos);
        if (defaultSuggestions.length === 0) {
          // could not rank for some reason
        } else {
          if (userCandidates.length === 0) {
            match.setAutoCorrect(ranker.shouldAutoCorrect(defaultSuggestions));
            match.setSuggestedReplacementObjects(defaultSuggestions);
          } else {
            const combinedSuggestions: SuggestedReplacement[] = [];
            for (const wordFromUserDict of userCandidates) {
              const s = new SuggestedReplacement(wordFromUserDict);
              // confidence is null
              combinedSuggestions.push(s);
            }
            combinedSuggestions.push(...defaultSuggestions);
            match.setSuggestedReplacementObjects(combinedSuggestions);
            // no auto correct when words from personal dictionaries are included
            match.setAutoCorrect(false);
          }
        }
      } else {
        const combinedSuggestions: SuggestedReplacement[] = [];
        combinedSuggestions.push(...orderer.orderSuggestions(userCandidates, word, sentence, startPos));
        combinedSuggestions.push(...orderer.orderSuggestions(candidates, word, sentence, startPos));
        match.setSuggestedReplacementObjects(combinedSuggestions);
      }
    } else { // no reranking
      const combinedSuggestions: SuggestedReplacement[] = [...match.getSuggestedReplacementObjects()];
      combinedSuggestions.push(...userCandidatesList);
      combinedSuggestions.push(...candidatesList);
      match.setSuggestedReplacementObjects(combinedSuggestions);
    }
    /*long timeDelta = System.currentTimeMillis() - startTime;
    System.out.printf("Reordering %d suggestions took %d ms.%n", result.getSuggestedReplacements().size(), timeDelta);*/
  }

  protected createWrongSplitMatch(sentence: AnalyzedSentence, ruleMatchesSoFar: RuleMatch[], pos: number, coveredWord: string,
                                  suggestion1: string, suggestion2: string, prevPos: number): RuleMatch {
    if (ruleMatchesSoFar.length > 0) {
      const prevMatch = ruleMatchesSoFar[ruleMatchesSoFar.length - 1]!;
      if (prevMatch.getFromPos() === prevPos) {
        // we'll later create a new match that covers the previous misspelled word and the current one:
        ruleMatchesSoFar.splice(ruleMatchesSoFar.length - 1, 1);
      }
    }
    const ruleMatch = new RuleMatch(this, sentence, prevPos, pos + coveredWord.length,
            this.messages!.getString('spelling'), this.messages!.getString('desc_spelling_short'));
    ruleMatch.setType(RuleMatch_Type.UnknownWord);
    ruleMatch.setSuggestedReplacement(StringTrim(suggestion1 + ' ' + suggestion2));
    return ruleMatch;
  }

  abstract override getId(): string;

  abstract override getDescription(): string;

  abstract override match(sentence: AnalyzedSentence): RuleMatch[];

  /**
   * @since 4.8
   */
  abstract isMisspelled(word: string): boolean;

  override isDictionaryBasedSpellingRule(): boolean {
    return true;
  }

  /**
   * Add the given words to the list of words to be ignored during spell check.
   * You might want to use {@link #acceptPhrases(List)} instead, as only that
   * can also deal with phrases.
   */
  addIgnoreTokens(tokens: readonly string[]): void {
    for (const t of tokens) this.wordsToBeIgnored.add(t);
  }

  private updateIgnoredWordDictionary(): void {
    this.wordsToBeIgnoredDictionaryIgnoreCase = null;
    this.wordsToBeIgnoredDictionary = null;
  }

  /**
   * Set whether the list of words to be explicitly ignored (set with {@link #addIgnoreTokens(List)}) is considered at all.
   */
  setConsiderIgnoreWords(considerIgnoreWords: boolean): void {
    this.considerIgnoreWords = considerIgnoreWords;
  }

  /**
   * Get additional suggestions added before other suggestions (note the rule may choose to
   * re-order the suggestions anyway). Only add suggestions here that you know are spelled correctly,
   * they will not be checked again before being shown to the user.
   */
  protected getAdditionalTopSuggestions(suggestions: readonly SuggestedReplacement[], word: string): SuggestedReplacement[] {
    const moreSuggestions: string[] = [];
    if (('Languagetool' === word || 'languagetool' === word) && !suggestions.some((k) => k.getReplacement() === SpellingCheckRule.LANGUAGETOOL)) {
      moreSuggestions.push(SpellingCheckRule.LANGUAGETOOL);
    }
    if (('Languagetooler' === word || 'languagetooler' === word) && !suggestions.some((k) => k.getReplacement() === SpellingCheckRule.LANGUAGETOOLER)) {
      moreSuggestions.push(SpellingCheckRule.LANGUAGETOOLER);
    }
    return SuggestedReplacement.convert(moreSuggestions);
  }

  /**
   * Get suggestions that will replace all other suggestions.
   * Only add suggestions here that you know are spelled correctly,
   * they will not be checked again before being shown to the user.
   */
  protected getOnlySuggestions(_word: string): SuggestedReplacement[] {
    return [];
  }

  /**
   * Get additional suggestions added after other suggestions (note the rule may choose to
   * re-order the suggestions anyway).
   */
  protected getAdditionalSuggestions(_suggestions: readonly SuggestedReplacement[], _word: string): SuggestedReplacement[] {
    return [];
  }

  /**
   * Returns true iff the token at the given position should be ignored by the spell checker.
   * Use {@link #ignorePotentiallyMisspelledWord(String)} if the check you want to implement is slightly
   * computationally expensive.
   */
  protected ignoreToken(tokens: readonly AnalyzedTokenReadings[], idx: number): boolean {
    const words: string[] = [];
    for (const token of tokens) {
      words.push(token.getToken());
    }
    return this.ignoreWord(words, idx);
  }

  /**
   * Returns true iff the word should be ignored by the spell checker.
   * If possible, use {@link #ignoreToken(AnalyzedTokenReadings[], int)} instead.
   * Overloaded (since 2.6): (words, idx) returns true iff the word at the given position should be ignored.
   */
  protected ignoreWord(word: string | readonly string[], idx?: number): boolean {
    if (typeof word !== 'string') {
      return this.ignoreWord(word[idx!]!);
    }
    if (word.length > SpellingCheckRule.MAX_TOKEN_LENGTH) {
      return true;
    }
    if (!this.considerIgnoreWords) {
      return false;
    }
    // Tokens with no letters cannot have spelling errors. So ignore them.
    let mHasNoLetter;
    if (this.isLatinScript()) {
      mHasNoLetter = P().pHasNoLetterLatin.matcher(word);
    } else {
      mHasNoLetter = P().pHasNoLetter.matcher(word);
    }
    if (mHasNoLetter.matches()) {
      return true;
    }
    if (word.endsWith('.') && !this.isInIgnoredSet(word)) {
      return this.isIgnoredNoCase(word.substring(0, word.length - 1));  // e.g. word at end of sentence
    }
    return this.isIgnoredNoCase(word);
  }

  protected isInIgnoredSet(word: string): boolean {
    return this.wordsToBeIgnored.has(word);
  }

  protected isIgnoredNoCase(word: string): boolean {
    return this.isInIgnoredSet(word) ||
           (!StringTools.isMixedCase(word) && this.convertsCase && this.isInIgnoredSet(word.toLowerCase())) ||
           (this.ignoreWordsWithLength > 0 && word.length <= this.ignoreWordsWithLength);
  }

  /**
   * Like {@link #ignoreWord(String)}, but will only be called after the standard spell
   * check has run and considered this word to be incorrect. This way, tests run here
   * can be a bit more computationally expensive.
   */
  protected ignorePotentiallyMisspelledWord(_words: string): boolean {
    return false;
  }

  /**
   * Used to determine whether the dictionary will use case conversions for
   * spell checking.
   * @param convertsCase if true, then conversions are used.
   * @since 2.5
   */
  setConvertsCase(convertsCase: boolean): void {
    this.convertsCase = convertsCase;
  }


  protected static isUrl(token: string): boolean {
    return WordTokenizer.isUrl(token);
  }

  protected static isEMail(token: string): boolean {
    return WordTokenizer.isEMail(token);
  }

  protected static filterDupes<T>(words: readonly T[]): T[] {
    // Stream.distinct() uses equals
    const result: T[] = [];
    for (const w of words) {
      if (!List_contains(result, w)) result.push(w);
    }
    return result;
  }

  protected init(): void {
    for (const ignoreWord of this.wordListLoader.loadWords(this.getIgnoreFileName())) {
      this.addIgnoreWords(ignoreWord);
    }
    if (this.getSpellingFileName() != null) {
      for (const ignoreWord of this.wordListLoader.loadWords(this.getSpellingFileName()!)) {
        this.addIgnoreWords(ignoreWord);
      }
    }
    for (const fileName of this.getAdditionalSpellingFileNames()) {
      if (JLanguageTool.getDataBroker().resourceExists(fileName)) {
        for (const ignoreWord of this.wordListLoader.loadWords(fileName)) {
          this.addIgnoreWords(ignoreWord);
        }
      }
    }
    this.updateIgnoredWordDictionary();
    for (const prohibitedWord of this.wordListLoader.loadWords(this.getProhibitFileName())) {
      this.addProhibitedWords(this.expandLine(prohibitedWord));
    }
    for (const fileName of this.getAdditionalProhibitFileNames()) {
      for (const prohibitedWord of this.wordListLoader.loadWords(fileName)) {
        this.addProhibitedWords(this.expandLine(prohibitedWord));
      }
    }
  }

  /**
   * Get the name of the ignore file, which lists words to be accepted, even
   * when the spell checker would not accept them. Unlike with {@link #getSpellingFileName()}
   * the words in this file will not be used for creating suggestions for misspelled words.
   * @since 2.7
   */
  protected getIgnoreFileName(): string {
    return this.language.getShortCode() + SPELLING_IGNORE_FILE;
  }

  /**
   * Get the name of the spelling file, which lists words to be accepted
   * and used for suggestions, even when the spell checker would not accept them.
   * @since 2.9, public since 3.5
   */
  getSpellingFileName(): string | null {
    return this.language.getShortCode() + SPELLING_FILE;
  }

  /**
   * Get the name of additional spelling file, which lists words to be accepted
   * and used for suggestions, even when the spell checker would not accept them.
   * @since 4.8
   */
  getAdditionalSpellingFileNames(): string[] {
    // NOTE: also add to GermanSpellerRule.getSpeller() when adding items here:
    return [this.language.getShortCode() + SpellingCheckRule.CUSTOM_SPELLING_FILE, SpellingCheckRule.GLOBAL_SPELLING_FILE];
  }

  /**
   *
   * Get the name of the spelling file for a language variant (e.g., en-US or de-AT),
   * which lists words to be accepted and used for suggestions, even when the spell
   * checker would not accept them.
   * @since 4.3
   */
  getLanguageVariantSpellingFileName(): string | null {
    return SPELLING_FILE_VARIANT;
  }

  /**
   * Get the name of the prohibit file, which lists words not to be accepted, even
   * when the spell checker would accept them.
   * @since 2.8
   */
  protected getProhibitFileName(): string {
    return this.language.getShortCode() + SPELLING_PROHIBIT_FILE;
  }

  /**
   * Get the name of the prohibit file, which lists words not to be accepted, even
   * when the spell checker would accept them.
   * @since 2.8
   */
  protected getAdditionalProhibitFileNames(): string[] {
    return [this.language.getShortCode() + CUSTOM_SPELLING_PROHIBIT_FILE];
  }

  /**
   * Whether the word is prohibited, i.e. whether it should be marked as a spelling
   * error even if the spell checker would accept it. (This is useful to improve our spell
   * checker without waiting for the upstream checker to be updated.)
   * @since 2.8
   */
  protected isProhibited(word: string): boolean {
    return this.wordsToBeProhibited.has(word);
  }

  /**
   * Remove prohibited words from suggestions.
   * @since 2.8
   */
  protected filterSuggestions(suggestions: SuggestedReplacement[]): SuggestedReplacement[] {
    for (let i = suggestions.length - 1; i >= 0; i--) {
      if (this.isProhibited(suggestions[i]!.getReplacement())) suggestions.splice(i, 1);
    }
    let newSuggestions: SuggestedReplacement[] = [];
    for (const suggestion of suggestions) {
      const replacement = suggestion.getReplacement();
      const suggestionWithoutS = replacement.length > 3 ? replacement.substring(0, replacement.length - 2) : '';
      if (replacement.endsWith(' s') && this.isProperNoun(suggestionWithoutS)) {
        // "Michael s" -> "Michael's"
        //System.out.println("### " + suggestion + " => " + sentence.getText().replaceAll(suggestionWithoutS + "s", "**" + suggestionWithoutS + "s**"));
        const sugg1 = new SuggestedReplacement(suggestionWithoutS);
        sugg1.setType(SuggestionType.Curated);
        newSuggestions.unshift(sugg1);
        const sugg2 = new SuggestedReplacement(suggestionWithoutS + "'s");
        sugg2.setType(SuggestionType.Curated);
        newSuggestions.unshift(sugg2);
      } else {
        newSuggestions.push(suggestion);
      }
    }
    newSuggestions = SpellingCheckRule.filterDupes(newSuggestions);
    newSuggestions = this.filterNoSuggestWords(newSuggestions);
    return newSuggestions;
  }

  protected filterNoSuggestWords(l: SuggestedReplacement[]): SuggestedReplacement[] {
    return l;
  }

  private isProperNoun(wordWithoutS: string): boolean {
    const tags = this.language.getTagger().tag([wordWithoutS]);
    return tags.some((k) => k.hasPosTag('NNP'));
  }

  /**
   * @param line the line as read from {@code spelling.txt}.
   * @since 2.9, signature modified in 3.9
   */
  protected addIgnoreWords(line: string): void {
    if (!this.tokenizeNewWords()) {
      this.wordsToBeIgnored.add(line);
    } else {
      // if line consists of several words (separated by " "), a DisambiguationPatternRule
      // will be created where each words serves as a case-sensitive and non-inflected PatternToken
      // so that the entire multi-word entry is ignored by the spell checker
      const tokens = this.language.getWordTokenizer().tokenize(line);
      if (tokens.length > 1) {
        //System.out.println("Tokenized multi-token: " + line);
        const patternTokens: PatternToken[] = [];
        for (const token of tokens) {
          if (StringTrim(token).length === 0) {
            continue;
          }
          patternTokens.push(new PatternToken(token, true, false, false));
        }
        this.antiPatterns.push(new Rule.DisambiguationPatternRule!('INTERNAL_ANTIPATTERN', '(no description)', this.language,
          patternTokens, null, null, IGNORE_SPELLING));
      } else {
        this.wordsToBeIgnored.add(line);
      }
    }
  }

  /**
   * @param words list of words to be prohibited.
   * @since 4.2
   */
  protected addProhibitedWords(words: readonly string[]): void {
    for (const w of words) this.wordsToBeProhibited.add(w);
  }

  /**
   * Expand suffixes in a line. By default, the line is not expanded.
   * Implementations might e.g. turn {@code bicycle/S} into {@code [bicycle, bicycles]}.
   * @since 3.0
   */
  protected expandLine(line: string): string[] {
    return [line];
  }

  /**
   * Accept (case-sensitively, unless at the start of a sentence) the given phrases even though they
   * are not in the built-in dictionary.
   * Use this to avoid false alarms on e.g. names and technical terms. Unlike {@link #addIgnoreTokens(List)}
   * this can deal with phrases. A way to call this is like this:
   * <code>rule.acceptPhrases(Arrays.asList("duodenal atresia"))</code>
   * This way, checking would not create an error for "duodenal atresia", but it would still
   * create and error for "duodenal" or "atresia" if they appear on their own.
   * @since 3.3
   */
  acceptPhrases(phrases: readonly string[]): void {
    const antiPatterns: PatternToken[][] = [];
    for (const phrase of phrases) {
      const parts = phrase.split(' ');
      const patternTokens: PatternToken[] = [];
      let i = 0;
      let startsLowercase = false;
      for (const part of parts) {
        if (i === 0 && part !== StringTools.uppercaseFirstChar(part)) {
          startsLowercase = true;
        }
        patternTokens.push(new PatternTokenBuilder().csToken(part).build());
        i++;
      }
      antiPatterns.push(patternTokens);
      if (startsLowercase) {
        antiPatterns.push(SpellingCheckRule.getTokensForSentenceStart(parts));
      }
    }
    this.antiPatterns = Rule.makeAntiPatterns(antiPatterns, this.language);
  }

  private static getTokensForSentenceStart(parts: readonly string[]): PatternToken[] {
    const ucPatternTokens: PatternToken[] = [];
    let j = 0;
    for (const part of parts) {
      if (j === 0) {
        // at sentence start, we also need to accept a phrase that starts with an uppercase char:
        const uppercased = StringTools.uppercaseFirstChar(part)!;
        ucPatternTokens.push(new PatternTokenBuilder().posRegex(JLanguageTool.SENTENCE_START_TAGNAME).build());
        ucPatternTokens.push(new PatternTokenBuilder().csToken(uppercased).build());
      } else {
        ucPatternTokens.push(new PatternTokenBuilder().csToken(part).build());
      }
      j++;
    }
    return ucPatternTokens;
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns;
  }

  /**
   * Checks whether a <code>word</code> starts with an ignored word.
   * Note that a minimum <code>word</code>-length of 4 characters is expected.
   * (This is for better performance. Moreover, such short words are most likely contained in the dictionary.)
   * @param word - entire word
   * @param caseSensitive - determines whether the check is case-sensitive
   * @return length of the ignored word (i.e., return value is 0, if the word does not start with an ignored word).
   * If there are several matches from the set of ignored words, the length of the longest matching word is returned.
   * @since 3.5
   */
  protected startsWithIgnoredWord(word: string, caseSensitive: boolean): number {
    if (word.length < 4) {
      return 0;
    }
    const comparator = caseSensitive ? (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0) : String_CASE_INSENSITIVE_ORDER;
    let array = caseSensitive ? this.wordsToBeIgnoredDictionary : this.wordsToBeIgnoredDictionaryIgnoreCase;
    if (array == null) {
      array = [...this.wordsToBeIgnored].sort(comparator);
      if (caseSensitive) {
        this.wordsToBeIgnoredDictionary = array;
      } else {
        this.wordsToBeIgnoredDictionaryIgnoreCase = array;
      }
    }

    while (word.length !== 0) {
      const result = binarySearch(array, word, comparator);
      if (result >= 0) break;

      const prev = -result - 2;
      if (prev < 0) return 0;

      const prefix = caseSensitive
                     ? commonPrefix(word, array[prev]!)
                     : commonPrefix(word.toLowerCase(), array[prev]!.toLowerCase());
      word = caseSensitive ? prefix : word.substring(0, prefix.length);
    }
    return word.length;
  }

  // tokenize words from files spelling.txt, prohibit.txt...
  protected tokenizeNewWords(): boolean {
    return true;
  }

  protected isLatinScript(): boolean {
    return true;
  }

}
