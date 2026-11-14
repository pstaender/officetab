// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractCompoundRule.java faithful
// The two constructors are one with an optional short message. LinguServices (the office
// extension's speller) is not ported: UserConfig has no getLinguServices(), so linguServices is
// always null and isCorrectSpell asks isMisspelled. The ArrayDeque is an array.
import { AnalyzedToken } from '../AnalyzedToken.ts';
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import type { UserConfig } from '../UserConfig.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import type { CompoundRuleData } from './CompoundRuleData.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { SpecificIdRule } from './SpecificIdRule.ts';

/** The office extension's linguistic services (not ported). */
interface LinguServices {
  isCorrectSpell(word: string, lang: Language): boolean;
}

let patterns: { DIGIT: Pattern; WHITESPACE: Pattern; DASHES: Pattern } | null = null;
const P = () => (patterns ??= {
  DIGIT: Pattern.compile('\\d+'),
  WHITESPACE: Pattern.compile('\\s+'),
  DASHES: Pattern.compile('--+'),
});

/** StringUtils.isNumeric */
function isNumeric(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    if (!Character.isDigit(s.charAt(i))) return false;
  }
  return true;
}

/** StringUtils.uncapitalize */
function uncapitalize(s: string): string {
  if (s.length === 0) return s;
  return Character.toLowerCase(s.charAt(0)) + s.substring(1);
}

/**
 * Checks that compounds (if in the list) are not written as separate words.
 * 
 * @author Daniel Naber, Marcin Miłkowski (refactoring)
 */
export abstract class AbstractCompoundRule extends Rule {

  static readonly MAX_TERMS = 5;

  private readonly withHyphenMessage: string;
  private readonly withoutHyphenMessage: string;
  private readonly withOrWithoutHyphenMessage: string;
  private readonly shortDesc: string | null;
  protected readonly linguServices: LinguServices | null;   // Linguistic Service of LO/OO used for LO/OO extension is null in other cases
  protected readonly lang: Language;                 // used by LO/OO Linguistic Service 
  // if true, the first word will be uncapitalized before compared to the entries in CompoundRuleData
  protected sentenceStartsWithUpperCase = true;
  protected subRuleSpecificIds = false;

  abstract override getId(): string;

  abstract override getDescription(): string;

  override estimateContextForSureMatch(): number {
    return 1;
  }

  useSubRuleSpecificIds(): void {
    this.subRuleSpecificIds = true;
  }

  /** @since 3.0 */
  abstract getCompoundRuleData(): CompoundRuleData;

  /**
   * @since 3.0
   */
  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null,
              withHyphenMessage: string, withoutHyphenMessage: string, withOrWithoutHyphenMessage: string,
              shortMessage: string | null = null) {
    super();
    super.setCategory(Categories.MISC.getCategory(messages));
    this.withHyphenMessage = withHyphenMessage;
    this.withoutHyphenMessage = withoutHyphenMessage;
    this.withOrWithoutHyphenMessage = withOrWithoutHyphenMessage;
    this.shortDesc = shortMessage;
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.lang = lang;
    if (userConfig != null) {
      this.linguServices = null;  // userConfig.getLinguServices(): not ported (see the header)
    } else {
      this.linguServices = null;
    }
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();

    let prevRuleMatch: RuleMatch | null = null;
    const prevTokens: AnalyzedTokenReadings[] = [];
    const hasDigitPatterns = this.getCompoundRuleData().hasDigitPatterns();
    const stringsToCheck: string[] = [];
    const origStringsToCheck: string[] = [];
    const stringToToken = new Map<string, AnalyzedTokenReadings>();
    for (let i = 0; i < tokens.length + AbstractCompoundRule.MAX_TERMS; i++) {
      let token: AnalyzedTokenReadings;
      // we need to extend the token list so we find matches at the end of the original list:
      if (i >= tokens.length) {
        token = new AnalyzedTokenReadings(new AnalyzedToken('', '', null), prevTokens[0]!.getStartPos());
      } else {
        token = tokens[i]!;
      }
      if (i === 0) {
        AbstractCompoundRule.addToQueue(token, prevTokens);
        continue;
      } else if (token.isImmunized()) {
        continue;
      }

      const firstMatchToken = prevTokens[0]!;
      stringsToCheck.length = 0;      // no hyphens spelling
      origStringsToCheck.length = 0;  // original upper/lowercase and hyphens spelling
      stringToToken.clear();
      this.getStringToTokenMap(prevTokens, stringsToCheck, origStringsToCheck, stringToToken);
      // iterate backwards over all potentially incorrect strings to make
      // sure we match longer strings first:
      for (let k = stringsToCheck.length - 1; k >= 0; k--) {
        const stringToCheck = stringsToCheck[k]!;
        const origStringToCheck = origStringsToCheck[k]!;
        let digitsRegexp: string | null = null;
        const containsDigits = hasDigitPatterns && StringSplit(stringToCheck, ' ').some((s) => isNumeric(s));
        if (this.getCompoundRuleData().getIncorrectCompounds().has(stringToCheck) ||
            (containsDigits && this.getCompoundRuleData().getIncorrectCompounds().has(digitsRegexp = P().DIGIT.matcher(stringToCheck).replaceAll('\\\\d+')))) {
          const atr = stringToToken.get(stringToCheck)!;
          let msg: string | null = null;
          let replacement: string[] = [];
          if (this.getCompoundRuleData().getDashSuggestion().has(stringToCheck) && !origStringToCheck.includes(' ')) {
            // It is already joined
            break;
          }
          if (this.getCompoundRuleData().getDashSuggestion().has(stringToCheck) ||
              (containsDigits && this.getCompoundRuleData().getIncorrectCompounds().has(digitsRegexp!))) {
            replacement.push(origStringToCheck.replaceAll(' ', '-'));
            msg = this.withHyphenMessage;
          }
          if (this.isNotAllUppercase(origStringToCheck) && this.getCompoundRuleData().getJoinedSuggestion().has(stringToCheck)) {
            replacement.push(this.mergeCompound(origStringToCheck, [...this.getCompoundRuleData().getJoinedLowerCaseSuggestion()].some((s) => stringToCheck.includes(s))));
            msg = this.withoutHyphenMessage;
          }
          const parts = StringSplit(stringToCheck, ' ');
          if (parts.length > 0 && parts[0]!.length === 1) {
            replacement.length = 0;
            replacement.push(origStringToCheck.replaceAll(' ', '-'));
            msg = this.withHyphenMessage;
          } else if (replacement.length === 0 || replacement.length === 2) {     // isEmpty shouldn't happen
            msg = this.withOrWithoutHyphenMessage;
          }
          replacement = this.filterReplacements(replacement,
            sentence.getText().substring(firstMatchToken.getStartPos(), atr.getEndPos()));
          if (replacement.length === 0) {
            break;
          }
          const startPos = firstMatchToken.getStartPos();
          const endPos = atr.getEndPos();
          let ruleMatch = new RuleMatch(this, sentence, startPos, endPos, msg!, this.shortDesc);
          if (this.subRuleSpecificIds) {
            const id = StringTools.toId(this.getId() + '_' + stringToCheck, this.lang);
            const description = this.getDescription().replaceAll('$match', origStringToCheck);
            const subRuleId = new SpecificIdRule(id, description, this.isPremium(), this.getCategory(),
              this.getLocQualityIssueType(), this.getTags());
            ruleMatch = new RuleMatch(subRuleId, sentence, startPos, endPos, msg!, this.shortDesc);
          }
          ruleMatch.setSuggestedReplacements(replacement);
          // avoid duplicate matches:
          if (prevRuleMatch != null && prevRuleMatch.getFromPos() === ruleMatch.getFromPos()) {
            prevRuleMatch = ruleMatch;
            break;
          }
          prevRuleMatch = ruleMatch;
          ruleMatches.push(ruleMatch);
          break;
        }
      }
      AbstractCompoundRule.addToQueue(token, prevTokens);
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  protected filterReplacements(replacements: readonly string[], original: string): string[] {
    const newReplacements: string[] = [];
    for (const replacement of replacements) {
      const newReplacement = P().DASHES.matcher(replacement).replaceAll('-');
      if (newReplacement !== original && this.isCorrectSpell(newReplacement)) {
        newReplacements.push(newReplacement);
      }
    }
    return newReplacements;
  }

  private getStringToTokenMap(prevTokens: readonly AnalyzedTokenReadings[],
                              stringsToCheck: string[], origStringsToCheck: string[],
                              stringToToken: Map<string, AnalyzedTokenReadings>): void {
    let sb = '';
    let j = 0;
    let isFirstSentStart = false;
    for (const atr of prevTokens) {
      if (atr.isWhitespaceBefore()) {
        sb += ' ';
      }
      sb += atr.getToken();
      if (j === 0) {
        isFirstSentStart = atr.hasPosTag(JLanguageTool.SENTENCE_START_TAGNAME);
      }
      if (j >= 1 || (j === 0 && !isFirstSentStart)) {
        let stringToCheck = this.normalize(sb);
        if (this.sentenceStartsWithUpperCase && isFirstSentStart) {
          stringToCheck = uncapitalize(stringToCheck);
        }
        stringsToCheck.push(stringToCheck);
        origStringsToCheck.push(StringTrim(sb));
        if (!stringToToken.has(stringToCheck)) {
          stringToToken.set(stringToCheck, atr);
        }
      }
      j++;
    }
  }

  private normalize(inStr: string): string {
    let str = StringTrim(inStr);
    str = str.replaceAll(' - ', ' ');
    str = str.replaceAll('-', ' ');
    str = P().WHITESPACE.matcher(str).replaceAll(' ');
    return str;
  }

  private isNotAllUppercase(str: string): boolean {
    const parts = StringSplit(str, ' ');
    for (const part of parts) {
      if ('-' !== part) { // do not treat '-' as an upper-case word
        if (StringTools.isAllUppercase(part)) {
          return false;
        }
      }
    }
    return true;
  }

  mergeCompound(str: string, uncapitalizeMidWords: boolean): string {
    const stringParts = StringSplit(str.replaceAll('-', ' '), ' ');
    let sb = '';
    for (let k = 0; k < stringParts.length; k++) {
      if (k === 0) {
        sb += stringParts[0];
      } else {
        sb += uncapitalizeMidWords ? uncapitalize(stringParts[k]!) : stringParts[k];
      }
    }
    return sb;
  }

  private static addToQueue(token: AnalyzedTokenReadings, prevTokens: AnalyzedTokenReadings[]): void {
    if (prevTokens.length === AbstractCompoundRule.MAX_TERMS) {
      prevTokens.shift();
    }
    prevTokens.push(token);
  }

  private isCorrectSpell(word: string): boolean {
    if (this.linguServices == null) {
      return !this.isMisspelled(word);
    }
    return this.linguServices.isCorrectSpell(word, this.lang);
  }

  isMisspelled(_word: string): boolean {
    return false;
  }

}
