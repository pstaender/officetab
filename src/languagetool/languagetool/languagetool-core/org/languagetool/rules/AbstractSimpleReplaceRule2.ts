// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractSimpleReplaceRule2.java faithful
// URLs: getFilePaths() returns further files as their path and content (Java: URLs, read with
// openStream()); the files of getFileNames() are read from the rules directory through the data
// broker. getDescription(String details), which returns null and is not overridden by any rule,
// is left out: TypeScript cannot overload the abstract getDescription(). The fastutil maps are
// Maps; the lazy initialization needs no lock.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Tools } from '../tools/Tools.ts';
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { Locale } from '../../../../../jdk/java/util/Locale.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringReplaceFirst, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { SpecificIdRule } from './SpecificIdRule.ts';
import { SuggestionWithMessage } from './SuggestionWithMessage.ts';

export const CaseSensitivy = { CS: 'CS', CI: 'CI', CSExceptAtSentenceStart: 'CSExceptAtSentenceStart' } as const;
export type CaseSensitivy = typeof CaseSensitivy[keyof typeof CaseSensitivy];

/** A file given by URL in Java: its name (for messages) and its content. */
export interface ReplaceFile {
  path: string;
  content: Uint8Array;
}

/** StringUtils.substringBefore */
function substringBefore(str: string, separator: string): string {
  const pos = str.indexOf(separator);
  return pos < 0 ? str : str.substring(0, pos);
}

/** StringUtils.getDigits(s).length() > 0 */
function hasDigits(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (Character.isDigit(s.charAt(i))) return true;
  }
  return false;
}

/** BufferedReader.readLine over the whole content */
function readLines(content: Uint8Array): string[] {
  const lines = new TextDecoder('utf-8').decode(content).split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * A rule that matches words which should not be used and suggests correct ones instead.
 * <p>Unlike AbstractSimpleReplaceRule, it supports phrases (Ex: "aqua forte" -&gt; "acvaforte").
 * Note: Merge this into {@link AbstractSimpleReplaceRule}
 *
 * @author Ionuț Păduraru
 */
export abstract class AbstractSimpleReplaceRule2 extends Rule {

  static readonly CaseSensitivy = CaseSensitivy;

  private initialized = false;
  private mStartSpace!: Map<string, number>;
  private mStartNoSpace!: Map<string, number>;
  private mFullSpace!: Map<string, SuggestionWithMessage>;
  private mFullNoSpace!: Map<string, SuggestionWithMessage>;

  protected isCheckingCase(): boolean {
    return false;
  }

  private static readonly MAX_TOKENS_IN_MULTIWORD = 20;

  //only for CheckCaseRule
  private ignoreShortUppercaseWords = true;
  //only for CheckCaseRule
  private MAX_LENGTH_SHORT_WORDS = 4;

  private ruleHasSuggestions = true;

  protected readonly language: Language;

  protected subRuleSpecificIds = false;

  abstract getFileNames(): string[];

  getFilePaths(): ReplaceFile[] | null {
    return null;
  }

  abstract override getId(): string;

  /**
   * @return A string where {@code $match} will be replaced with the matching word.
   */
  abstract override getDescription(): string;

  abstract getShort(): string;

  /**
   * @return A string where {@code $match} will be replaced with the matching word
   * and {@code $suggestions} will be replaced with the alternatives. This is the string
   * shown to the user.
   */
  abstract getMessage(): string;

  /**
   * @return the word used to separate multiple suggestions; used only before last suggestion, the rest are
   * comma-separated.
   */
  getSuggestionsSeparator(): string {
    return ', ';
  }

  /**
   * locale used on case-conversion
   */
  abstract getLocale(): Locale;


  constructor(messages: ResourceBundle, language: Language) {
    super(messages);
    this.language = Objects_requireNonNull(language);
    super.setCategory(Categories.MISC.getCategory(messages));
  }

  /**
   * If this is set, each replacement pair will have its own rule ID, making rule deactivations more specific.
   *
   * @since 5.1
   */
  useSubRuleSpecificIds(): void {
    this.subRuleSpecificIds = true;
  }

  getCaseSensitivy(): CaseSensitivy {
    return CaseSensitivy.CI;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    this.lazyInit();
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    let sentStart = 1;
    while (sentStart < tokens.length && this.isPunctuationStart(tokens[sentStart]!.getToken())) {
      sentStart++;
    }
    const checkCaseCoveredUpto = [0];
    checkCaseCoveredUpto[0] = 0;
    for (let startIndex = sentStart; startIndex < tokens.length; startIndex++) {
      if (this.isTokenException(tokens[startIndex]!)) {
        continue;
      }
      let tok = tokens[startIndex]!.getToken();
      if (tok.length < 1) {
        continue;
      }
      // If there is no whitespace to the next token, concatenate the next token
      let k = startIndex + 1;
      while (k < tokens.length && !tokens[k]!.isWhitespaceBefore()) {
        tok = tok + tokens[k]!.getToken();
        k++;
      }
      if (this.getCaseSensitivy() === CaseSensitivy.CI) {
        tok = tok.toLowerCase();
      }
      if (this.mStartSpace.has(tok)) {
        let keyBuilder = '';
        const maxTokenLen = this.mStartSpace.get(tok)!;
        let endIndex = startIndex;
        while (endIndex < tokens.length && endIndex - startIndex < AbstractSimpleReplaceRule2.MAX_TOKENS_IN_MULTIWORD) {
          if (endIndex > startIndex && tokens[endIndex]!.isWhitespaceBefore()) {
            keyBuilder += ' ';
          }
          keyBuilder += tokens[endIndex]!.getToken();
          const originalStr = keyBuilder;
          const numberOfSpaces = StringTools.numberOf(originalStr, ' ');
          if (numberOfSpaces + 1 > maxTokenLen) {
            break;
          }
          if (numberOfSpaces > 0) {
            let keyStr = originalStr;
            if (this.getCaseSensitivy() === CaseSensitivy.CI) {
              keyStr = keyStr.toLowerCase();
            }
            let suggestionWithMessage = this.mFullSpace.get(keyStr) ?? null;
            this.createMatch(ruleMatches, suggestionWithMessage, startIndex, endIndex, originalStr, tokens, sentence,
              sentStart, checkCaseCoveredUpto);
            //No language uses this. It could be removed.
            if (suggestionWithMessage == null && sentStart === startIndex && this.getCaseSensitivy() === CaseSensitivy.CSExceptAtSentenceStart
              && keyStr !== StringTools.lowercaseFirstChar(keyStr)) {
              keyStr = StringTools.lowercaseFirstChar(keyStr);
              suggestionWithMessage = this.mFullSpace.get(keyStr) ?? null;
              this.createMatch(ruleMatches, suggestionWithMessage, startIndex, endIndex, originalStr, tokens, sentence,
                sentStart, checkCaseCoveredUpto);
            }
          }
          endIndex++;
        }
      }
      if (this.mStartNoSpace.has(tok.substring(0, 1))) {
        let endIndex = startIndex;
        let keyBuilder = '';
        while (endIndex < tokens.length && endIndex - startIndex < AbstractSimpleReplaceRule2.MAX_TOKENS_IN_MULTIWORD) {
          if (endIndex > startIndex && tokens[endIndex]!.isWhitespaceBefore()) {
            break;
          }
          keyBuilder += tokens[endIndex]!.getToken();
          const originalStr = keyBuilder;
          let keyStr = originalStr;
          if (this.getCaseSensitivy() === CaseSensitivy.CI) {
            keyStr = keyStr.toLowerCase();
          }
          let suggestionWithMessage = this.mFullNoSpace.get(keyStr) ?? null;
          this.createMatch(ruleMatches, suggestionWithMessage, startIndex, endIndex, originalStr, tokens, sentence,
            sentStart, checkCaseCoveredUpto);
          //No language uses this. It could be removed.
          if (suggestionWithMessage == null && sentStart === startIndex && this.getCaseSensitivy() === CaseSensitivy.CSExceptAtSentenceStart
            && keyStr !== StringTools.lowercaseFirstChar(keyStr)) {
            keyStr = StringTools.lowercaseFirstChar(keyStr);
            suggestionWithMessage = this.mFullNoSpace.get(keyStr) ?? null;
            this.createMatch(ruleMatches, suggestionWithMessage, startIndex, endIndex, originalStr, tokens, sentence,
              sentStart, checkCaseCoveredUpto);
          }
          endIndex++;
        }
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private createMatch(ruleMatches: RuleMatch[], suggestionWithMessage: SuggestionWithMessage | null, startIndex: number,
                      endIndex: number, originalStr: string, tokens: AnalyzedTokenReadings[], sentence: AnalyzedSentence,
                      sentStart: number, checkCaseCoveredUpto: number[]): void {
    if (suggestionWithMessage == null || this.isException(originalStr)) {
      return;
    }
    const replacements = StringSplit(suggestionWithMessage.getSuggestion(), '\\|');
    const fromPos = tokens[startIndex]!.getStartPos();
    const toPos = tokens[endIndex]!.getEndPos();
    //keep only the longest match
    if (ruleMatches.length > 0) {
      const lastRuleMatch = ruleMatches[ruleMatches.length - 1]!;
      if (lastRuleMatch.getFromPos() <= fromPos
        && lastRuleMatch.getToPos() >= toPos) {
        return;
      }
    }
    const firstWordInSuggIsCamelCase = replacements.some((k) => StringTools.isCamelCase(StringSplit(k, ' ')[0] ?? ''));
    const isAllUppercase = StringTools.isAllUppercase(originalStr);
    const isCapitalized = StringTools.isCapitalizedWord(StringSplit(originalStr, ' ')[0] ?? '');
    // exceptions for checking case
    if (this.isCheckingCase()) {
      if (endIndex <= checkCaseCoveredUpto[0]!) {
        return;
      }
      const replacementCheckCase = replacements[0]!;
      if ((sentStart === startIndex && originalStr === StringTools.uppercaseFirstChar(replacementCheckCase))
        || originalStr === replacementCheckCase) {
        if (ruleMatches.length > 0) {
          // remove last match if is contained in a correct phrase
          const lastRuleMatch = ruleMatches[ruleMatches.length - 1]!;
          if (lastRuleMatch.getToPos() > fromPos) {
            ruleMatches.pop();
          }
        }
        checkCaseCoveredUpto[0] = endIndex;
        return;
      }
      //Allow all-upper case, except for CamelCase and short words in Dutch (length<MAX_LENGTH_SHORT_WORDS)
      if (!firstWordInSuggIsCamelCase && originalStr === originalStr.toUpperCase()) {
        if (this.ignoreShortUppercaseWords || originalStr.length > this.MAX_LENGTH_SHORT_WORDS) {
          checkCaseCoveredUpto[0] = endIndex;
          return;
        }
      }
    }
    const finalReplacements: string[] = [];
    // adjust casing of suggestions
    for (const repl of replacements) {
      let finalRepl = repl;
      if (!firstWordInSuggIsCamelCase && (sentStart === startIndex || (isCapitalized && !this.isCheckingCase()))) {
        finalRepl = StringTools.uppercaseFirstChar(repl)!;
      }
      if (!this.isCheckingCase() && isAllUppercase) {
        finalRepl = repl.toUpperCase();
      }
      if (repl !== originalStr && finalRepl !== originalStr && !finalReplacements.includes(finalRepl)) {
        finalReplacements.push(finalRepl);
      }
      if (finalRepl === originalStr) {
        // the original is correct, so there is no need to fix anything
        finalReplacements.length = 0;
        break;
      }
    }
    if (this.ruleHasSuggestions && finalReplacements.length === 0) {
      return;
    }
    // Begin of match creation
    let msg = suggestionWithMessage.getMessage();
    let url: string | null = null;
    if (msg != null && (msg.startsWith('http://') || msg.startsWith('https://'))) {
      msg = null;
      url = msg;
    }
    if (msg == null) {
      let msgSuggestions = '';
      for (let k = 0; k < replacements.length; k++) {
        if (k > 0) {
          msgSuggestions += (k === replacements.length - 1 ? this.getSuggestionsSeparator() : ', ');
        }
        msgSuggestions += '<suggestion>' + replacements[k] + '</suggestion>';
      }
      msg = StringReplaceFirst(StringReplaceFirst(this.getMessage(), '\\$match', originalStr), '\\$suggestions', msgSuggestions);
    }
    let ruleMatch = new RuleMatch(this, sentence, fromPos, toPos, msg, this.getShort());
    if (this.subRuleSpecificIds) {
      const id = StringTools.toId(this.getId() + '_' + originalStr, this.language);
      const desc = this.getDescription().replaceAll('$match', originalStr);
      const specificIdRule = new SpecificIdRule(id, desc, this.isPremium(), this.getCategory(),
        this.getLocQualityIssueType(), this.getTags());
      ruleMatch = new RuleMatch(specificIdRule, sentence, fromPos, toPos, msg, this.getShort());
    }
    if (url != null) {
      ruleMatch.setUrl(Tools.getUrl(url));
    }
    if (this.ruleHasSuggestions) {
      ruleMatch.setSuggestedReplacements(finalReplacements);
    }
    // End of match creation
    if (this.isRuleMatchException(ruleMatch)) {
      return;
    }
    //keep only the longest match
    if (ruleMatches.length > 0) {
      const lastRuleMatch = ruleMatches[ruleMatches.length - 1]!;
      if (lastRuleMatch.getFromPos() >= fromPos
        && lastRuleMatch.getToPos() <= toPos) {
        ruleMatches.pop();
      }
    }
    ruleMatches.push(ruleMatch);
  }

  protected isRuleMatchException(_ruleMatch: RuleMatch): boolean {
    return false;
  }

  protected isException(_matchedText: string): boolean {
    return false;
  }

  protected isTokenException(_atr: AnalyzedTokenReadings): boolean {
    return false;
  }

  /**
   * Create a warning if a key word of the replacement rule is not allowed by the speller rule.
   */
  checkKeyWordsAreKnownToSpeller(): boolean {
    return false;
  }

  /**
   * Create a warning if a key word of the replacement rule is allowed by the speller rule.
   */
  checkKeyWordsAreUnknownToSpeller(): boolean {
    return false;
  }

  separateKeyWordsBySpeller(): boolean {
    return false;
  }


  protected isPunctuationStart(word: string): boolean {
    return hasDigits(word) // e.g. postal codes
      || StringTools.isPunctuationMark(word) || StringTools.isNotWordCharacter(word);
  }

  private lazyInit(): void {
    if (this.initialized) {
      return;
    }
    const mStartSpace = new Map<string, number>();
    const mStartNoSpace = new Map<string, number>();
    const mFullSpace = new Map<string, SuggestionWithMessage>();
    const mFullNoSpace = new Map<string, SuggestionWithMessage>();
    this.fillMaps(mStartSpace, mStartNoSpace, mFullSpace, mFullNoSpace);
    this.mStartSpace = mStartSpace;
    this.mStartNoSpace = mStartNoSpace;
    this.mFullSpace = mFullSpace;
    this.mFullNoSpace = mFullNoSpace;
    this.initialized = true;
  }

  private fillMaps(mStartSpace: Map<string, number>, mStartNoSpace: Map<string, number>,
                   mFullSpace: Map<string, SuggestionWithMessage>, mFullNoSpace: Map<string, SuggestionWithMessage>): void {
    try {
      for (const filePath of this.getAllFilePaths()) {
        for (let line of readLines(filePath.content)) {
          line = StringTrim(line);
          if (line.length === 0 || line.charAt(0) === '#') { // ignore comments
            continue;
          }
          if (line.includes('  ') && this.language.getShortCode() !== 'ar') {
            throw new Error('RuntimeException: More than one consecutive space in ' + filePath.path + ' - use a tab character as ' +
              'a delimiter for the message: ' + line);
          }
          line = StringTrim(substringBefore(line, '#'));
          if (this.isCheckingCase()) {
            // It is a rule for checking chase
            const parts = StringSplit(line, '=');
            line = StringTrim(parts[0]!.toLowerCase()) + '=' + StringTrim(parts[0]!);
            if (parts.length === 2) {
              line = line + '\t' + StringTrim(parts[1]!);
            }
          }
          const parts = StringSplit(line, '\t');
          const confPair = parts[0]!;
          let msg: string | null;
          if (parts.length === 1) {
            msg = null;
          } else if (parts.length === 2) {
            msg = parts[1]!;
          } else {
            throw new Error('IOException: Format error in file ' + filePath.path + ". Expected at most 1 '=' character and at " +
              'most 1 tab character. Line: ' + line);
          }
          const confPairParts = StringSplit(confPair, '=');
          let suggestion = '';
          if (this.ruleHasSuggestions) {
            if (confPairParts.length < 2) {
              throw new Error('IOException: Format error in file ' + filePath.path
                + ". Missing suggestion after character '='. Line: " + line);
            }
            suggestion = confPairParts[1]!;
          }
          const wrongForms = StringSplit(confPairParts[0]!, '\\|'); // multiple incorrect forms
          for (const wrongForm of wrongForms) {
            const searchKey = this.getCaseSensitivy() === CaseSensitivy.CI ? wrongForm.toLowerCase() : wrongForm;
            if (!this.isCheckingCase() && searchKey === suggestion) {
              throw new Error('IOException: Format error in file ' + filePath.path
                + ". Found same word on left and right side of '='. Line: " + line);
            }
            const suggestionWithMessage = new SuggestionWithMessage(suggestion, msg);
            const containsSpace = wrongForm.indexOf(' ') > 0;
            if (!containsSpace) {
              const firstChar = searchKey.substring(0, 1);
              if (mStartNoSpace.has(firstChar)) {
                if (mStartNoSpace.get(firstChar)! < searchKey.length) {
                  mStartNoSpace.set(firstChar, searchKey.length);
                }
              } else {
                mStartNoSpace.set(firstChar, searchKey.length);
              }
              mFullNoSpace.set(searchKey, suggestionWithMessage);
            } else {
              const tokens = StringSplit(searchKey, ' ');
              const firstToken = tokens[0]!;
              if (mStartSpace.has(firstToken)) {
                if (mStartSpace.get(firstToken)! < tokens.length) {
                  mStartSpace.set(firstToken, tokens.length);
                }
              } else {
                mStartSpace.set(firstToken, tokens.length);
              }
              mFullSpace.set(searchKey, suggestionWithMessage);
            }
          }
        }
      }
    } catch (e) {
      throw new Error('RuntimeException: ' + (e instanceof Error ? e.message : String(e)), { cause: e });
    }
  }

  private getAllFilePaths(): ReplaceFile[] {
    const filePaths: ReplaceFile[] = [];
    const extra = this.getFilePaths();
    if (extra != null) {
      filePaths.push(...extra);
    }
    for (const fileName of this.getFileNames()) {
      filePaths.push({ path: fileName, content: JLanguageTool.getDataBroker().getFromRulesDirAsStream(fileName) });
    }
    return filePaths;
  }

  // Only for checking the spelling of the suggestions
  getWrongWords(): Map<string, SuggestionWithMessage>[] {
    this.lazyInit();
    const wrongWords: Map<string, SuggestionWithMessage>[] = [];
    wrongWords.push(this.mFullSpace);
    wrongWords.push(this.mFullNoSpace);
    return wrongWords;
  }

  // only for check_case rule
  protected isIgnoreShortUppercaseWords(): boolean {
    return this.ignoreShortUppercaseWords;
  }

  // only for check_case rule
  protected setIgnoreShortUppercaseWords(value: boolean): void {
    this.ignoreShortUppercaseWords = value;
  }

  protected setRuleHasSuggestions(value: boolean): void {
    this.ruleHasSuggestions = value;
  }

}
