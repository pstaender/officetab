// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractStyleRepeatedWordRule.java faithful
// The two private isTokenInSentence overloads are one, with notCheck -1 for the shorter one.
// LinguServices (the office extension's services) is not ported: UserConfig.getLinguServices()
// gives it untyped. java.net.URL is a string.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import type { UserConfig } from '../UserConfig.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import type { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { RuleOption } from './RuleOption.ts';
import { TextLevelRule } from './TextLevelRule.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

/** The part of org.languagetool.LinguServices used here and by subclasses. */
export interface LinguServices {
  setThesaurusRelevantRule(rule: Rule): void;
  isCorrectSpell(word: string, lang: Language): boolean;
  getSynonyms(word: string, lang: Language): string[];
}

const OPENING_QUOTES = Pattern.compile('["“„»«]');
const ENDING_QUOTES = Pattern.compile('["“”»«]');
const SINGLE_QUOTES = Pattern.compile("['‚‘’'›‹]");
const MAX_TOKEN_TO_CHECK = 5;
const MAX_DISTANCE_OF_SENTENCES = 1;
const EXCLUDE_DIRECT_SPEECH = true;

/**
 * An abstract rule checks the appearance of same words in a sentence or in two consecutive sentences.
 * The isTokenToCheck method can be used to check only specific words (e.g. substantive, verbs and adjectives).
 * This rule detects no grammar error but a stylistic problem (default off)
 * @author Fred Kruse
 * @since 4.1
 */
export abstract class AbstractStyleRepeatedWordRule extends TextLevelRule {

  protected readonly linguServices: LinguServices | null;
  protected readonly lang: Language;

  protected maxDistanceOfSentences = MAX_DISTANCE_OF_SENTENCES;
  protected excludeDirectSpeech = EXCLUDE_DIRECT_SPEECH;

  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null) {
    super(messages);
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.setDefaultOff();
    this.setOfficeDefaultOn();  // Default for LO/OO is always On
    this.lang = lang;
    if (userConfig != null) {
      this.linguServices = userConfig.getLinguServices() as LinguServices | null;
      if (this.linguServices != null) {
        this.linguServices.setThesaurusRelevantRule(this);
      }
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        if (cf != null && cf.length > 0 && cf[0] != null && Number.isInteger(cf[0])) {
          this.maxDistanceOfSentences = cf[0] as number;
        }
        if (cf != null && cf.length > 1 && cf[1] != null && typeof cf[1] === 'boolean') {
          this.excludeDirectSpeech = cf[1];
        }
      }
    } else {
      this.linguServices = null;
    }
  }

  /**
   * Override this ID by adding a language acronym (e.g. STYLE_REPEATED_WORD_RULE_DE)
   * to use adjustment of maxWords by option panel
   * @since 4.1
   */
  override getId(): string {
    return 'STYLE_REPEATED_WORD_RULE';
  }

  override getDescription(): string {
    return 'Repeated words in consecutive sentences';
  }

  /*
   * Message for repeated word in same sentence
   */
  protected abstract messageSameSentence(): string;

  /*
   * Message for repeated word in sentence before
   */
  protected abstract messageSentenceBefore(): string;

  /*
   * Message for repeated word in sentence after
   */
  protected abstract messageSentenceAfter(): string;

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [new RuleOption(MAX_DISTANCE_OF_SENTENCES, this.messages!.getString('guiStyleRepeatedWordText'), 0, 5),
                         new RuleOption(EXCLUDE_DIRECT_SPEECH, this.messages!.getString('guiStyleExcludeDirectSpeechText'), 0, 5)
                        ];
    return ruleOptions;
  }

  /*
   * Check only special words (e.g substantive, verbs, adjectives)
   * (German example: return (token.matchesPosTagRegex("(SUB|EIG|VER|ADJ):.*") 
   *              && !token.matchesPosTagRegex("ART:.*|ADV:.*|VER:(AUX|MOD):.*"));
   */
  protected abstract isTokenToCheck(tokens: AnalyzedTokenReadings[], n: number): boolean;

  /*
   * Is checked word part of pairs like "arm in arm", "side by side", etc. (exclude such pairs)
   */
  protected abstract isTokenPair(tokens: AnalyzedTokenReadings[], n: number, before: boolean): boolean;

  /*
   * listings are excluded
   */
  private static hasBreakToken(tokens: AnalyzedTokenReadings[]): boolean {
    for (let i = 0; i < tokens.length && i < MAX_TOKEN_TO_CHECK; i++) {
      if (tokens[i]!.getToken() === '-' || tokens[i]!.getToken() === '—' || tokens[i]!.getToken() === '–') {
        return true;
      }
    }
    return false;
  }

  /*
   * question - response - pairs are excluded
   */
  private static isQuestionResponse(nAct: number, nTest: number, tokenList: AnalyzedTokenReadings[][]): boolean {
    const dist = nAct - nTest;
    if (dist !== 1 && dist !== -1) {
      return false;
    }
    const actTokens = tokenList[nAct]!;
    const testTokens = tokenList[nTest]!;
    if (actTokens.length < 2 || testTokens.length < 2) {
      return false;
    }
    let actToken: string;
    if (ENDING_QUOTES.matcher(actTokens[actTokens.length - 1]!.getToken()).matches()) {
      actToken = actTokens[actTokens.length - 2]!.getToken();
    } else {
      actToken = actTokens[actTokens.length - 1]!.getToken();
    }
    let testToken: string;
    if (ENDING_QUOTES.matcher(testTokens[testTokens.length - 1]!.getToken()).matches()) {
      testToken = testTokens[testTokens.length - 2]!.getToken();
    } else {
      testToken = testTokens[testTokens.length - 1]!.getToken();
    }
    return ((actToken === '?' && testToken !== '?') || (testToken === '?' && actToken !== '?'));
  }

  /* 
   *  true if token is part of composite word in sentence
   *  override for languages like German which contents composed words
   */
  protected isPartOfWord(_testTokenText: string, _tokenText: string): boolean {
    return false;
  }

  /* 
   *  true if is an exception of token pair
   *  note: method is called after two tokens are tested to share the same lemma
   */
  protected isExceptionPair(_token1: AnalyzedTokenReadings, _token2: AnalyzedTokenReadings): boolean {
    return false;
  }

  /* 
   * Set a URL to a synonym dictionary for a token
   */
  protected setURL(_token: AnalyzedTokenReadings): string | null {
    return null;
  }

  /* 
   *  true if token is found in sentence
   */
  private isTokenInSentence(testToken: AnalyzedTokenReadings | null, tokens: AnalyzedTokenReadings[] | null,
      notCheck: number, isDirectSpeech: boolean): boolean {
    if (testToken == null || tokens == null) {
      return false;
    }
    const readings = testToken.getReadings();
    const lemmas: string[] = [];
    for (const reading of readings) {
      if (reading.getLemma() != null) {
        lemmas.push(reading.getLemma()!);
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      if (this.excludeDirectSpeech && !isDirectSpeech && OPENING_QUOTES.matcher(tokens[i]!.getToken()).matches()
          && i < tokens.length - 1 && !tokens[i + 1]!.isWhitespaceBefore()) {
        isDirectSpeech = true;
      } else if (this.excludeDirectSpeech && isDirectSpeech && ENDING_QUOTES.matcher(tokens[i]!.getToken()).matches()
          && i > 1 && !tokens[i]!.isWhitespaceBefore()) {
        isDirectSpeech = false;
      } else if (i !== notCheck && !isDirectSpeech && !this.isInQuotes(tokens, i) && this.isTokenToCheck(tokens, i)) {
        if ((lemmas.length !== 0 && tokens[i]!.hasAnyLemma(...lemmas) && !this.isExceptionPair(testToken, tokens[i]!))
            || this.isPartOfWord(testToken.getToken(), tokens[i]!.getToken())) {
          if (notCheck >= 0) {
            if (notCheck === i - 2) {
              return !this.isTokenPair(tokens, i, true);
            } else if (notCheck === i + 2) {
              return !this.isTokenPair(tokens, i, false);
            } else if ((notCheck === i + 1 || notCheck === i - 1)
                && testToken.getToken() === tokens[i]!.getToken()) {
              return false;
            }
          }
          return true;
        }
      }
    }
    return false;
  }

  private isInQuotes(tokens: AnalyzedTokenReadings[], i: number): boolean {
    return (i > 0
            && (OPENING_QUOTES.matcher(tokens[i - 1]!.getToken()).matches()
                || SINGLE_QUOTES.matcher(tokens[i - 1]!.getToken()).matches())
            && i < tokens.length - 1
            && (ENDING_QUOTES.matcher(tokens[i + 1]!.getToken()).matches()
                || SINGLE_QUOTES.matcher(tokens[i + 1]!.getToken()).matches()));
  }

  private getStartsWithDirectSpeech(n: number, sentences: AnalyzedSentence[], isDirectSpeech: boolean): boolean {
    if (!this.excludeDirectSpeech || n <= 0) {
      return false;
    }
    const sentence = sentences[n - 1]!.getTokensWithoutWhitespace();
    for (let i = 0; i < sentence.length; i++) {
      const token = sentence[i]!;
      if (!isDirectSpeech && OPENING_QUOTES.matcher(token.getToken()).matches()
          && i < sentence.length - 1 && !sentence[i + 1]!.isWhitespaceBefore()) {
        isDirectSpeech = true;
      } else if (isDirectSpeech && ENDING_QUOTES.matcher(token.getToken()).matches()
          && i > 1 && !sentence[i]!.isWhitespaceBefore()) {
        isDirectSpeech = false;
      }
    }
    return isDirectSpeech;
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokenList: AnalyzedTokenReadings[][] = [];
    const isDSList: boolean[] = [];
    let pos = 0;
    let startsWithDirectSpeech = false;
    for (let n = 0; n < this.maxDistanceOfSentences && n < sentences.length; n++) {
      tokenList.push(sentences[n]!.getTokensWithoutWhitespace());
      startsWithDirectSpeech = this.getStartsWithDirectSpeech(n, sentences, startsWithDirectSpeech);
      isDSList.push(startsWithDirectSpeech);
    }
    let isDirectSpeech = false;
    for (let n = 0; n < sentences.length; n++) {
      if (n + this.maxDistanceOfSentences < sentences.length) {
        tokenList.push(sentences[n + this.maxDistanceOfSentences]!.getTokensWithoutWhitespace());
        startsWithDirectSpeech = this.getStartsWithDirectSpeech(n + this.maxDistanceOfSentences, sentences, startsWithDirectSpeech);
        isDSList.push(startsWithDirectSpeech);
      }
      if (tokenList.length > 2 * this.maxDistanceOfSentences + 1) {
        tokenList.splice(0, 1);
        isDSList.splice(0, 1);
      }
      let nTok = this.maxDistanceOfSentences;
      if (n < this.maxDistanceOfSentences) {
        nTok = n;
      } else if (n >= sentences.length - this.maxDistanceOfSentences) {
        nTok = tokenList.length - (sentences.length - n);
      }
      if (!AbstractStyleRepeatedWordRule.hasBreakToken(tokenList[nTok]!)) {
        for (let i = 0; i < tokenList[nTok]!.length; i++) {
          const token = tokenList[nTok]![i]!;
          if (this.excludeDirectSpeech && !isDirectSpeech && OPENING_QUOTES.matcher(token.getToken()).matches()
              && i < tokenList[nTok]!.length - 1 && !tokenList[nTok]![i + 1]!.isWhitespaceBefore()) {
            isDirectSpeech = true;
          } else if (this.excludeDirectSpeech && isDirectSpeech && ENDING_QUOTES.matcher(token.getToken()).matches()
              && i > 1 && !tokenList[nTok]![i]!.isWhitespaceBefore()) {
            isDirectSpeech = false;
          } else if (!isDirectSpeech && !this.isInQuotes(tokenList[nTok]!, i) && this.isTokenToCheck(tokenList[nTok]!, i)) {
            let isRepeated = 0;
            if (this.isTokenInSentence(token, tokenList[nTok]!, i, isDSList[nTok]!)) {
              isRepeated = 1;
            }
            for (let j = nTok - 1; isRepeated === 0 && j >= 0 && j >= nTok - this.maxDistanceOfSentences; j--) {
              if (!AbstractStyleRepeatedWordRule.isQuestionResponse(nTok, j, tokenList) && this.isTokenInSentence(token, tokenList[j]!, -1, isDSList[j]!)) {
                isRepeated = 2;
              }
            }
            for (let j = nTok + 1; isRepeated === 0 && j < tokenList.length && j <= nTok + this.maxDistanceOfSentences; j++) {
              if (!AbstractStyleRepeatedWordRule.isQuestionResponse(nTok, j, tokenList) && this.isTokenInSentence(token, tokenList[j]!, -1, isDSList[j]!)) {
                isRepeated = 3;
              }
            }
            if (isRepeated !== 0) {
              let msg: string;
              if (isRepeated === 1) {
                msg = this.messageSameSentence();
              } else if (isRepeated === 2) {
                msg = this.messageSentenceBefore();
              } else {
                msg = this.messageSentenceAfter();
              }
              const startPos = pos + token.getStartPos();
              const endPos = pos + token.getEndPos();
              const ruleMatch = new RuleMatch(this, null, startPos, endPos, msg);
              const url = this.setURL(token);
              if (url != null) {
                ruleMatch.setUrl(url);
              }
              ruleMatches.push(ruleMatch);
            }
          }
        }
      }
      pos += sentences[n]!.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return this.excludeDirectSpeech ? -1 : this.maxDistanceOfSentences;
  }

}
