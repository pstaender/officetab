// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/morfologik/MorfologikSpellerRule.java reduced
// Left out:
// - the ForeignLanguageChecker (only used with two or more preferred languages in the user config,
//   which a server sets; it reports other languages detected in a sentence);
// - the translator branch of getRuleMatches (in Java `translator` is always null there: the
//   getTranslator call is commented out) and getTranslator, mergeSuggestionsWithSameTranslation,
//   PhraseToTranslate;
// - Tools.isExternSpeller() (the 32-bit OpenOffice extension's external speller; always false);
// - SuggestionsChanges experiments (fullSuggestionCandidates is false: no experiment runs);
// - Paths.get(getFileName()) for dictionaries outside the class path.
// The constructors are one (the trailing parameters optional); isMisspelled(speller, word) and
// isMisspelled(word) are one method. `synchronized`/`volatile` are dropped (one thread).
import { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../AnalyzedTokenReadings.ts';
import type { GlobalConfig } from '../../../GlobalConfig.ts';
import { JLanguageTool } from '../../../JLanguageTool.ts';
import type { Language } from '../../../Language.ts';
import type { UserConfig } from '../../../UserConfig.ts';
import type { LanguageModel } from '../../../languagemodel/LanguageModel.ts';
import { Categories } from '../../Categories.ts';
import { ITSIssueType } from '../../ITSIssueType.ts';
import { RuleMatch, Type as RuleMatch_Type } from '../../RuleMatch.ts';
import { SuggestedReplacement, SuggestionType } from '../../SuggestedReplacement.ts';
import { SpellingCheckRule } from '../SpellingCheckRule.ts';
import { StringTools } from '../../../tools/StringTools.ts';
import { MorfologikMultiSpeller } from './MorfologikMultiSpeller.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import { StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';

let patterns: { pStartsWithNumbersBullets: Pattern; pStartsWithNumbersBulletsExceptions: Pattern } | null = null;
const P = () => (patterns ??= {
  pStartsWithNumbersBullets: Pattern.compile('^(\\d[\\.,\\d]*|\\P{L}+)(.*)$'),
  pStartsWithNumbersBulletsExceptions: Pattern.compile('^([\\p{C}\\-\\$%&]+)(.*)$'),
});

/** StringUtils.containsAny(cs, chars...) for the digits */
function containsAnyDigit(s: string): boolean {
  return /[0-9]/.test(s);
}

export abstract class MorfologikSpellerRule extends SpellingCheckRule {

  protected speller1!: MorfologikMultiSpeller;
  protected speller2!: MorfologikMultiSpeller;
  protected speller3!: MorfologikMultiSpeller;
  protected conversionLocale!: Locale;
  protected readonly motherTongue: Language | null;
  protected readonly globalConfig: GlobalConfig | null;

  private ignoreTaggedWords = false;
  private checkCompound = false;
  private compoundRegex = Pattern.compile('-');
  private readonly userConfig: UserConfig | null;
  private spellersInitialized = false;

  //do not use very frequent words in split word suggestions ex. to *thow ≠ tot how
  static readonly MAX_FREQUENCY_FOR_SPLITTING = 21; //0..21

  /**
   * Get the filename, e.g., <code>/resource/pl/spelling.dict</code>.
   */
  abstract getFileName(): string;

  abstract override getId(): string;

  /**
   * Java's overloads: (messages, language), (messages, language, userConfig),
   * (messages, language, userConfig, altLanguages) and
   * (messages, language, globalConfig, userConfig, altLanguages, languageModel, motherTongue).
   * Here: (messages, language, globalConfig?, userConfig?, altLanguages?, languageModel?, motherTongue?);
   * the shorter Java overloads pass null for globalConfig.
   */
  constructor(messages: ResourceBundle, language: Language, globalConfig: GlobalConfig | null = null, userConfig: UserConfig | null = null,
              altLanguages: Language[] = [], languageModel: LanguageModel | null = null, motherTongue: Language | null = null) {
    super(messages, language, userConfig, altLanguages, languageModel);
    this.globalConfig = globalConfig;
    this.userConfig = userConfig;
    this.motherTongue = motherTongue;
    super.setCategory(Categories.TYPOS.getCategory(messages));
    this.conversionLocale = this.conversionLocale != null ? this.conversionLocale : Locale.getDefault();
    this.init();
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
  }

  override getDescription(): string {
    return this.messages!.getString('desc_spelling');
  }

  setLocale(locale: Locale): void {
    this.conversionLocale = locale;
  }

  /**
   * Skip words that are known in the POS tagging dictionary, assuming they
   * cannot be incorrect.
   */
  setIgnoreTaggedWords(): void {
    this.ignoreTaggedWords = true;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    this.initSpellers();

    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    let idx = -1;
    let isFirstWord = true;
    for (const token of tokens) {
      idx++;
      if (this.canBeIgnored(tokens, idx, token)) {
        if (idx > 0 && isFirstWord && !StringTools.isPunctuationMark(token.getToken())) {
          isFirstWord = false;
        }
        continue;
      }
      const startPos = token.getStartPos();
      // if we use token.getToken() we'll get ignored characters inside and speller will choke
      const word = token.getAnalyzedToken(0).getToken();

      const newRuleIdx = ruleMatches.length;
      const pattern = this.tokenizingPattern();
      if (pattern == null) {
        ruleMatches.push(...this.getRuleMatches(word, startPos, sentence, ruleMatches, idx, tokens));
      } else {
        let index = 0;
        const m = pattern.matcher(word);
        while (m.find()) {
          const match = word.substring(index, m.start());
          ruleMatches.push(...this.getRuleMatches(match, startPos + index, sentence, ruleMatches, idx, tokens));
          index = m.end();
        }
        if (index === 0) { // tokenizing char not found
          ruleMatches.push(...this.getRuleMatches(word, startPos, sentence, ruleMatches, idx, tokens));
        } else {
          ruleMatches.push(...this.getRuleMatches(word.substring(index, word.length), startPos + index, sentence, ruleMatches, idx, tokens));
        }
      }

      if (ruleMatches.length > newRuleIdx) {
        // matches added for current token - need to adjust for hidden characters
        const hiddenCharOffset = token.getToken().length - word.length;
        if (hiddenCharOffset > 0) {
          for (let i = newRuleIdx; i < ruleMatches.length; i++) {
            const ruleMatch = ruleMatches[i]!;
            if (token.getEndPos() < ruleMatch.getToPos()) { // done by multi-token speller, no need to adjust
              continue;
            }
            ruleMatch.setOffsetPosition(ruleMatch.getFromPos(), ruleMatch.getToPos() + hiddenCharOffset);
          }
        }
      }

      // Capitalize word at the sentence start
      // if it is not the last token in the sentence, similarly to UPPERCASE_SENTENCE_START
      if (isFirstWord && ruleMatches.length > 0 && idx < tokens.length - 1) {
        const ruleMatch = ruleMatches[0]!;
        const replacements = ruleMatch.getSuggestedReplacements();
        const newReplacements: string[] = [];
        for (const replacement of replacements) {
          // only if the replacement is all lower case
          if (replacement === replacement.toLowerCase()) {
            const capitalizedReplacement = StringTools.uppercaseFirstChar(replacement)!;
            if (!newReplacements.includes(capitalizedReplacement)) {
              newReplacements.push(capitalizedReplacement);
            }
          } else {
            if (!newReplacements.includes(replacement)) {
              newReplacements.push(replacement);
            }
          }
        }
        ruleMatch.setSuggestedReplacements(newReplacements);
      }
      if (idx > 0 && isFirstWord && !StringTools.isPunctuationMark(token.getToken())) {
        isFirstWord = false;
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private initSpellers(): void {
    if (this.spellersInitialized) {
      return;
    }
    let binaryDict: string | null = null;
    if (JLanguageTool.getDataBroker().resourceExists(this.getFileName())) {
      binaryDict = this.getFileName();
    }
    if (binaryDict == null) {
      // should not happen, as we only configure this rule (or rather its subclasses)
      // when we have the resources:
      throw new Error('RuntimeException: Cannot find dictionary file ' + this.getFileName());
    }
    this.initSpeller(binaryDict);
    this.spellersInitialized = true;
  }

  private initSpeller(binaryDict: string): void {
    const plainTextDicts: string[] = [];
    let languageVariantPlainTextDict: string | null = null;
    const dataBroker = JLanguageTool.getDataBroker();
    if (this.getSpellingFileName() != null && dataBroker.resourceExists(this.getSpellingFileName()!)) {
      plainTextDicts.push(this.getSpellingFileName()!);
    }
    for (const fileName of this.getAdditionalSpellingFileNames()) {
      if (dataBroker.resourceExists(fileName)) {
        plainTextDicts.push(fileName);
      }
    }
    if (this.getLanguageVariantSpellingFileName() != null && dataBroker.resourceExists(this.getLanguageVariantSpellingFileName()!)) {
      languageVariantPlainTextDict = this.getLanguageVariantSpellingFileName();
    }
    this.speller1 = new MorfologikMultiSpeller(binaryDict, plainTextDicts, languageVariantPlainTextDict, this.userConfig, 1, this.language);
    this.speller2 = new MorfologikMultiSpeller(binaryDict, plainTextDicts, languageVariantPlainTextDict, this.userConfig, 2, this.language);
    this.speller3 = new MorfologikMultiSpeller(binaryDict, plainTextDicts, languageVariantPlainTextDict, this.userConfig, 3, this.language);
    this.setConvertsCase(this.speller1.convertsCase());
  }

  private canBeIgnored(tokens: readonly AnalyzedTokenReadings[], idx: number, token: AnalyzedTokenReadings): boolean {
    return token.isSentenceStart() ||
           token.isImmunized() ||
           token.isIgnoredBySpeller() ||
           SpellingCheckRule.isUrl(token.getToken()) ||
           SpellingCheckRule.isEMail(token.getToken()) ||
           (this.ignoreTaggedWords && token.isTagged() && !this.isProhibited(token.getToken())) ||
           this.ignoreToken(tokens, idx);
  }


  /**
   * isMisspelled(word) (@since 4.8): with the first speller.
   * isMisspelled(speller, word) (@since 2.4): true if the word is misspelled.
   */
  override isMisspelled(word: string): boolean;
  isMisspelled(speller: MorfologikMultiSpeller, word: string): boolean;
  isMisspelled(a: string | MorfologikMultiSpeller, b?: string): boolean {
    if (typeof a === 'string') {
      this.initSpellers();
      return this.isMisspelled(this.speller1, a);
    }
    const speller = a;
    const word = b!;
    if (!speller.isMisspelled(word)) {
      return false;
    }
    if (this.checkCompound && this.compoundRegex.matcher(word).find()) {
      const words = this.compoundRegex.split(word);
      for (const singleWord of words) {
        if (speller.isMisspelled(singleWord)) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  private static getFrequency(speller: MorfologikMultiSpeller, word: string): number {
    return speller.getFrequency(word);
  }

  protected getRuleMatches(word: string, startPos: number, sentence: AnalyzedSentence, ruleMatchesSoFar: RuleMatch[], idx: number,
                           tokens: readonly AnalyzedTokenReadings[]): RuleMatch[] {
    // We create only one rule match.
    // Several rule matches on the same word or words can not be shown to the user.
    const ruleMatches: RuleMatch[] = [];
    let ruleMatch: RuleMatch | null = null;
    const speller1 = this.speller1;
    const getFrequency = MorfologikSpellerRule.getFrequency;

    if (!this.isMisspelled(speller1, word) && !this.isProhibited(word)) {
      return ruleMatches;
    }

    if (this.ignorePotentiallyMisspelledWord(word)) {
      return ruleMatches;
    }

    //the current word is already dealt with in the previous match, so do nothing
    if (ruleMatchesSoFar.length > 0 && ruleMatchesSoFar[ruleMatchesSoFar.length - 1]!.getToPos() > startPos) {
      return ruleMatches;
    }

    let beforeSuggestionStr = ''; //to be added before the suggestion if there is a suggestion for a split word
    let afterSuggestionStr = '';  //to be added after

    // Check for split word with previous word
    if (idx > 0 && tokens[idx]!.isWhitespaceBefore()) {
      const prevWord = tokens[idx - 1]!.getToken();
      if (prevWord.length > 0 && !containsAnyDigit(prevWord)
          && getFrequency(speller1, prevWord) < MorfologikSpellerRule.MAX_FREQUENCY_FOR_SPLITTING) {
        const prevStartPos = tokens[idx - 1]!.getStartPos();
        // "thanky ou" -> "thank you"
        const sugg1a = prevWord.substring(0, prevWord.length - 1);
        const sugg1b = prevWord.substring(prevWord.length - 1) + word;
        if (sugg1a.length > 1 && sugg1b.length > 2 && !this.isMisspelled(speller1, sugg1a)
            && !this.isMisspelled(speller1, sugg1b)
            && getFrequency(speller1, sugg1a) + getFrequency(speller1, sugg1b) > getFrequency(speller1, prevWord)) {
          ruleMatch = this.createWrongSplitMatch(sentence, ruleMatchesSoFar, startPos, word, sugg1a, sugg1b, prevStartPos);
          beforeSuggestionStr = prevWord + ' ';
        }
        // "than kyou" -> "thank you" ; but not "She awaked" -> "Shea waked"
        const sugg2a = prevWord + word.charAt(0);
        const sugg2b = word.substring(1);
        if (sugg2b.length > 2 && !this.isMisspelled(speller1, sugg2a) && !this.isMisspelled(speller1, sugg2b)) {
          if (ruleMatch == null) {
            if (getFrequency(speller1, sugg2a) + getFrequency(speller1, sugg2b) > getFrequency(speller1, prevWord)) {
              ruleMatch = this.createWrongSplitMatch(sentence, ruleMatchesSoFar, startPos, word, sugg2a, sugg2b,
                  prevStartPos);
              beforeSuggestionStr = prevWord + ' ';
            }
          } else {
            ruleMatch.addSuggestedReplacement(StringTrim(sugg2a + ' ' + sugg2b));
          }
        }
        // "g oing-> "going"
        const sugg = prevWord + word;
        if (word === word.toLowerCase() && !this.isMisspelled(speller1, sugg)) {
          if (ruleMatch == null) {
            if (getFrequency(speller1, sugg) >= getFrequency(speller1, prevWord)) {
              ruleMatch = new RuleMatch(this, sentence, prevStartPos, startPos + word.length,
                  this.messages!.getString('spelling'), this.messages!.getString('desc_spelling_short'));
              ruleMatch.setType(RuleMatch_Type.UnknownWord);
              beforeSuggestionStr = prevWord + ' ';
              ruleMatch.setSuggestedReplacement(sugg);
            }
          } else {
            ruleMatch.addSuggestedReplacement(sugg);
          }
        }
        if (ruleMatch != null && this.isMisspelled(speller1, prevWord)) {
          ruleMatches.push(ruleMatch);
          return ruleMatches;
        }
      }
    }

    // Check for split word with next word
    if (ruleMatch == null && idx < tokens.length - 1 && tokens[idx + 1]!.isWhitespaceBefore()) {
      const nextWord = tokens[idx + 1]!.getToken();
      if (nextWord.length > 0 && !containsAnyDigit(nextWord)
          && getFrequency(speller1, nextWord) < MorfologikSpellerRule.MAX_FREQUENCY_FOR_SPLITTING) {
        const nextStartPos = tokens[idx + 1]!.getStartPos();
        const sugg1a = word.substring(0, word.length - 1);
        const sugg1b = word.substring(word.length - 1) + nextWord;
        if (sugg1a.length > 1 && sugg1b.length > 2 && !this.isMisspelled(speller1, sugg1a) && !this.isMisspelled(speller1, sugg1b) &&
            getFrequency(speller1, sugg1a) + getFrequency(speller1, sugg1b) > getFrequency(speller1, nextWord)) {
          ruleMatch = this.createWrongSplitMatch(sentence, ruleMatchesSoFar, nextStartPos, nextWord, sugg1a, sugg1b, startPos);
          afterSuggestionStr = ' ' + nextWord;
        }
        const sugg2a = word + nextWord.charAt(0);
        const sugg2b = nextWord.substring(1);
        if (sugg2b.length > 2 && !this.isMisspelled(speller1, sugg2a) && !this.isMisspelled(speller1, sugg2b)) {
          if (ruleMatch == null) {
            if (getFrequency(speller1, sugg2a) + getFrequency(speller1, sugg2b) > getFrequency(speller1, nextWord)) {
              ruleMatch = this.createWrongSplitMatch(sentence, ruleMatchesSoFar, nextStartPos, nextWord, sugg2a, sugg2b, startPos);
              afterSuggestionStr = ' ' + nextWord;
            }
          } else {
            ruleMatch.addSuggestedReplacement(StringTrim(sugg2a + ' ' + sugg2b));
          }
        }
        const sugg = word + nextWord;
        if (nextWord === nextWord.toLowerCase() && !this.isMisspelled(speller1, sugg)) {
          if (ruleMatch == null) {
            if (getFrequency(speller1, sugg) >= getFrequency(speller1, nextWord)) {
              ruleMatch = new RuleMatch(this, sentence, startPos, nextStartPos + nextWord.length,
                  this.messages!.getString('spelling'), this.messages!.getString('desc_spelling_short'));
              ruleMatch.setType(RuleMatch_Type.UnknownWord);
              afterSuggestionStr = ' ' + nextWord;
              ruleMatch.setSuggestedReplacement(sugg);
            }
          } else {
            ruleMatch.addSuggestedReplacement(sugg);
          }
        }
        if (ruleMatch != null && this.isMisspelled(speller1, nextWord)) {
          ruleMatches.push(ruleMatch);
          return ruleMatches;
        }
      }
    }

    const translationSuggestionCount = 0;
    let preventFurtherSuggestions = false;

    // (the translator branch is left out, see the header)

    if (ruleMatch == null) {
      ruleMatch = new RuleMatch(this, sentence, startPos, startPos + word.length, this.messages!.getString('spelling'),
              this.messages!.getString('desc_spelling_short'));
      ruleMatch.setType(RuleMatch_Type.UnknownWord);
    }

    if (this.userConfig != null && !this.userConfig.isSuggestionsEnabled()) {
      ruleMatches.push(ruleMatch);
      return ruleMatches;
    }

    //word starting with numbers or bullets
    let cleanWord = word;
    let firstPart = '';
    let secondPart = '';
    const mStartsWithNumbersBullets = P().pStartsWithNumbersBullets.matcher(word);
    if (mStartsWithNumbersBullets.matches()) {
      const mStartsWithNumbersBulletsExceptions = P().pStartsWithNumbersBulletsExceptions.matcher(word);
      if (!mStartsWithNumbersBulletsExceptions.matches()) {
        firstPart = mStartsWithNumbersBullets.group(1)!;
        secondPart = mStartsWithNumbersBullets.group(2)!;
        const secondPartTokens = this.language.getWordTokenizer().tokenize(secondPart);
        const multitokenIsMisspeled = secondPartTokens.some((str) => this.isMisspelled(speller1, str));
        if ((!multitokenIsMisspeled || this.isIgnoredNoCase(secondPart)) && !this.isProhibited(secondPart)) {
          ruleMatch.addSuggestedReplacement(firstPart + ' ' + secondPart);
          preventFurtherSuggestions = true;
        } else {
          beforeSuggestionStr = firstPart + ' ';
          cleanWord = secondPart;
        }
      }
    }

    const fullResults = false;  // SuggestionsChanges experiments are not ported

    if (this.userConfig == null || this.userConfig.getMaxSpellingSuggestions() === 0
        || ruleMatchesSoFar.length <= this.userConfig.getMaxSpellingSuggestions()) {
      if (translationSuggestionCount > 0) {
        const prev = ruleMatch.getSuggestedReplacementObjects();
        ruleMatch = new RuleMatch(ruleMatch.getRule(), ruleMatch.getSentence(), ruleMatch.getFromPos(), ruleMatch.getToPos(),
          this.messages!.getString('spelling') + ' Translations to English are also offered.');
        ruleMatch.setSuggestedReplacementObjects(prev);
      }

      if (!preventFurtherSuggestions) {
        ruleMatch.setLazySuggestedReplacements(this.appendLazySuggestions(cleanWord, beforeSuggestionStr, afterSuggestionStr,
          fullResults, ruleMatch.getSuggestedReplacementObjects()));
      }
    } else {
      // limited to save CPU
      ruleMatch.setSuggestedReplacement(this.messages!.getString('too_many_errors'));
    }

    ruleMatches.push(ruleMatch);
    return ruleMatches;
  }

  private appendLazySuggestions(word: string, beforeSuggestionStr: string, afterSuggestionStr: string, fullResults: boolean,
                                prev: readonly SuggestedReplacement[]): () => SuggestedReplacement[] {
    const prevCopy = [...prev];
    return () => {
      const fromSpeller = this.calcSpellerSuggestions(word, fullResults);
      const joined = MorfologikSpellerRule.joinBeforeAfterSuggestions(fromSpeller, beforeSuggestionStr, afterSuggestionStr);
      return [...prevCopy, ...joined];
    };
  }

  private calcSpellerSuggestions(word: string, fullResults: boolean): SuggestedReplacement[] {
    const onlySuggestions = this.getOnlySuggestions(word);
    if (onlySuggestions.length !== 0) {
      return onlySuggestions;
    }
    let defaultSuggestions = SuggestedReplacement.convert(this.speller1.getSuggestionsFromDefaultDicts(word));
    let userSuggestions = SuggestedReplacement.convert(this.speller1.getSuggestionsFromUserDicts(word));
    //System.out.println("speller1: " + suggestions);
    let onlyCaseDiffers = false;
    if (defaultSuggestions.length > 0 && word.toLowerCase() === defaultSuggestions[0]!.getReplacement().toLowerCase()) {
      // We have no good concept yet for showing both translations and standard suggestions, so
      // use a hack to fix e.g. "muslims" not suggesting "Muslims" (https://github.com/languagetool-org/languagetool/issues/3333)
      onlyCaseDiffers = true;
    }
    if (word.length >= 3 && (onlyCaseDiffers || fullResults || defaultSuggestions.length === 0)) {
      // speller1 uses a maximum edit distance of 1, it won't find suggestion for "garentee", "greatful" etc.
      //System.out.println("speller2: " + speller2.getSuggestions(word));
      defaultSuggestions.push(...SuggestedReplacement.convert(this.speller2.getSuggestionsFromDefaultDicts(word)));
      userSuggestions.push(...SuggestedReplacement.convert(this.speller2.getSuggestionsFromUserDicts(word)));
      if (word.length >= 5 && (fullResults || defaultSuggestions.length === 0)) {
        //System.out.println("speller3: " + speller3.getSuggestions(word));
        defaultSuggestions.push(...SuggestedReplacement.convert(this.speller3.getSuggestionsFromDefaultDicts(word)));
        userSuggestions.push(...SuggestedReplacement.convert(this.speller3.getSuggestionsFromUserDicts(word)));
      }
    }
    //System.out.println("getAdditionalTopSuggestions(suggestions, word): " + getAdditionalTopSuggestions(suggestions, word));
    const topSuggestions: SuggestedReplacement[] = [];
    if (defaultSuggestions.length === 0 && userSuggestions.length === 0 && word.includes('-')) {
      this.addHyphenSuggestions(StringSplit(word, '-'), topSuggestions);
    }
    topSuggestions.push(...this.getAdditionalTopSuggestions(defaultSuggestions, word));
    topSuggestions.forEach((s) => s.setType(SuggestionType.Curated));
    defaultSuggestions.unshift(...topSuggestions);
    //System.out.println("getAdditionalSuggestions(suggestions, word): " + getAdditionalSuggestions(suggestions, word));
    defaultSuggestions.push(...this.getAdditionalSuggestions(defaultSuggestions, word));

    if (defaultSuggestions.length === 0 && userSuggestions.length === 0) {
      return [];
    }

    defaultSuggestions = this.filterSuggestions(defaultSuggestions);
    userSuggestions = SpellingCheckRule.filterDupes(userSuggestions);
    defaultSuggestions = this.orderSuggestions(defaultSuggestions, word);

    if (word.length > 4) {
      return [...userSuggestions, ...defaultSuggestions];
    } else {
      // Don't use short words from user dictionaries because they usually hide the best suggestions
      return [...defaultSuggestions, ...userSuggestions];
    }

  }

  protected addHyphenSuggestions(_split: string[], _topSuggestions: SuggestedReplacement[]): void {
  }

  /**
   * Get the regular expression pattern used to tokenize
   * the words as in the source dictionary. For example,
   * it may contain a hyphen, if the words with hyphens are
   * not included in the dictionary
   * @return A compiled {@link Pattern} that is used to tokenize words or {@code null}.
   */
  tokenizingPattern(): Pattern | null {
    return null;
  }

  protected orderSuggestions(suggestions: SuggestedReplacement[], _word: string): SuggestedReplacement[] {
    return suggestions;
  }

  /**
   * @param checkCompound If true and the word is not in the dictionary
   * it will be split (see {@link #setCompoundRegex(String)})
   * and each component will be checked separately
   * @since 2.4
   */
  protected setCheckCompound(checkCompound: boolean): void {
    this.checkCompound = checkCompound;
  }

  /**
   * @param compoundRegex see {@link #setCheckCompound(boolean)}
   * @since 2.4
   */
  protected setCompoundRegex(compoundRegex: string): void {
    this.compoundRegex = Pattern.compile(compoundRegex);
  }

  /**
   * Ignore surrogate pairs (emojis)
   * @since 4.3
   * @see org.languagetool.rules.spelling.SpellingCheckRule#ignoreWord(java.lang.String)
   */
  protected override ignoreWord(word: string | readonly string[], idx?: number): boolean {
    if (typeof word !== 'string') {
      return super.ignoreWord(word, idx);
    }
    return super.ignoreWord(word) || StringTools.isEmoji(word);
  }

  /**
   *
   * Join strings before and after a suggestion.
   * Used when there is also suggestion for split words
   * Ex. to thow > tot how | to throw
   *
   */
  private static joinBeforeAfterSuggestions(suggestionsList: readonly SuggestedReplacement[], beforeSuggestionStr: string,
                                            afterSuggestionStr: string): SuggestedReplacement[] {
    const newSuggestionsList: SuggestedReplacement[] = [];
    for (const suggestion of suggestionsList) {
      const str = suggestion.getReplacement();
      const newSuggestion = new SuggestedReplacement(suggestion);
      newSuggestion.setReplacement(beforeSuggestionStr + str + afterSuggestionStr);
      newSuggestionsList.push(newSuggestion);
    }
    return newSuggestionsList;
  }

  /*
   * Get suggestions for a single word, using all the features of the Morfologik
   * spelling rule
   *
   * @since 5.6
   */
  getSpellingSuggestions(w: string): string[] {
    const suggestions: string[] = [];
    const atk: AnalyzedTokenReadings[] = [];
    const token = new AnalyzedToken(w, null, null);
    atk[0] = new AnalyzedTokenReadings(token);
    const sentence = new AnalyzedSentence(atk);
    const matches = this.match(sentence);
    if (matches.length > 0) {
      suggestions.push(...matches[0]!.getSuggestedReplacements());
    }
    return suggestions;
  }

}
