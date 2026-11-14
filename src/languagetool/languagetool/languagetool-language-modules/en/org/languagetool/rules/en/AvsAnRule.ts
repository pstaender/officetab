// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/AvsAnRule.java faithful
// The static patterns are compiled on first use.
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import { AvsAnData } from './AvsAnData.ts';

const { getWordsRequiringA, getWordsRequiringAn } = AvsAnData;
const compile = Pattern.compile;

export const Determiner = {
  A: 'A', AN: 'AN', A_OR_AN: 'A_OR_AN', UNKNOWN: 'UNKNOWN',
} as const;
export type Determiner = typeof Determiner[keyof typeof Determiner];

let patterns: {
  cleanupPattern: Pattern; delimPattern: Pattern; dashQuotePattern: Pattern; anPrefixes: Pattern; anExceptionPrefixes: Pattern;
} | null = null;
const P = () => (patterns ??= {
  cleanupPattern: compile("[^αa-zA-Z0-9.;,:']"),
  delimPattern: compile('[-"“\'‘()\\[\\]]+'),
  dashQuotePattern: compile("[-']"),
  anPrefixes: compile('^(unidentif|uni[mn])[a-z]+$', Pattern.CASE_INSENSITIVE),
  anExceptionPrefixes: compile('^(eu|one|uni|u[rst][aeiou])[a-z]*$', Pattern.CASE_INSENSITIVE),
});

/**
 * Check if the determiner (if any) preceding a word is:
 * <ul>
 *   <li><i>an</i> if the next word starts with a vowel
 *   <li><i>a</i> if the next word does not start with a vowel
 * </ul>
 *  This rule loads some exceptions from external files {@code det_a.txt} and
 *  {@code det_an.txt} (e.g. for <i>an hour</i>).
 *
 * @author Daniel Naber
 */
export class AvsAnRule extends Rule {

  constructor(messages: ResourceBundle) {
    super();
    super.setCategory(Categories.MISC.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/indefinite-articles/'));
    this.addExamplePair(Example.wrong('The train arrived <marker>a hour</marker> ago.'),
                   Example.fixed('The train arrived <marker>an hour</marker> ago.'));
  }

  override getId(): string {
    return 'EN_A_VS_AN';
  }

  override getDescription(): string {
    return "Use of 'a' vs. 'an'";
  }

  override estimateContextForSureMatch(): number {
    return 1;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    let prevTokenIndex = 0;
    let isSentenceStart: boolean;
    let equalsA: boolean;
    let equalsAn: boolean;
    for (let i = 1; i < tokens.length; i++) {  // ignoring token 0, i.e., SENT_START
      const token = tokens[i]!;
      const prevTokenStr = prevTokenIndex > 0 ? tokens[prevTokenIndex]!.getToken() : null;
      isSentenceStart = prevTokenIndex == 1;
      if (!isSentenceStart) {
        equalsA = 'a' === prevTokenStr;
        equalsAn = 'an' === prevTokenStr;
      } else {
        equalsA = StringEqualsIgnoreCase('a', prevTokenStr);
        equalsAn = StringEqualsIgnoreCase('an', prevTokenStr);
      }
      if (equalsA || equalsAn) {
        const determiner = AvsAnRule.getCorrectDeterminerFor(token);
        let msg: string | null = null;
        if (equalsA && determiner == Determiner.AN) {
          const replacement = StringTools.startsWithUppercase(prevTokenStr!) ? 'An' : 'an';
          msg = 'Use <suggestion>' + replacement + "</suggestion> instead of '" + prevTokenStr + "' if the following " +
                  "word starts with a vowel sound, e.g. 'an article', 'an hour'.";
        } else if (equalsAn && determiner == Determiner.A) {
          const replacement = StringTools.startsWithUppercase(prevTokenStr!) ? 'A' : 'a';
          msg = 'Use <suggestion>' + replacement + "</suggestion> instead of '" + prevTokenStr + "' if the following " +
                  "word doesn't start with a vowel sound, e.g. 'a sentence', 'a university'.";
        }
        if (msg != null) {
          const match = new RuleMatch(
              this, sentence, tokens[prevTokenIndex]!.getStartPos(), tokens[prevTokenIndex]!.getEndPos(),
                  tokens[prevTokenIndex]!.getStartPos(), token.getEndPos(), msg, 'Wrong article');
          ruleMatches.push(match);
        }
      }
      let nextToken = '';
      if (i + 1 < tokens.length) {
        nextToken = tokens[i + 1]!.getToken();
      }
      if (token.hasPosTag('DT')) {
        prevTokenIndex = i;
      } else if (nextToken.length > 1 && P().delimPattern.matcher(token.getToken()).matches()) {
        // skip e.g. the quote in >>an "industry party"<<
      } else {
        prevTokenIndex = 0;
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  /**
   * Adds "a" or "an" to the English noun. Used for suggesting the proper form of the indefinite article.
   * For the rare cases where both "a" and "an" are considered okay (e.g. for "historical"), "a" is returned.
   * @param origWord Word that needs an article.
   * @return String containing the word with a determiner, or just the word if the word is an abbreviation.
   */
  suggestAorAn(origWord: string): string {
    const token = new AnalyzedTokenReadings(new AnalyzedToken(origWord, null, null), 0);
    const determiner = AvsAnRule.getCorrectDeterminerFor(token);
    if (determiner == Determiner.A || determiner == Determiner.A_OR_AN) {
      return 'a ' + StringTools.lowercaseFirstCharIfCapitalized(origWord);
    } else if (determiner == Determiner.AN) {
      return 'an ' + StringTools.lowercaseFirstCharIfCapitalized(origWord);
    } else {
      return origWord;
    }
  }

  static getCorrectDeterminerFor(token: AnalyzedTokenReadings): Determiner {
    let word = token.getToken();
    let determiner: Determiner = Determiner.UNKNOWN;
    const parts = P().dashQuotePattern.split(word);  // for example, in "one-way" only "one" is relevant
    const anPrefix = P().anPrefixes.matcher(token.getToken());
    const anExceptionPrefix = P().anExceptionPrefixes.matcher(token.getToken());
    if (parts.length >= 1 && !StringEqualsIgnoreCase(parts[0]!, 'a')) {  // avoid false alarm on "A-levels are..."
      word = parts[0]!;
    }
    if (token.isWhitespaceBefore() || !('-' === word)) { // e.g., 'a- or anti- are prefixes'
      word = P().cleanupPattern.matcher(word).replaceAll('');         // e.g. >>an "industry party"<<
      if (StringTools.isEmpty(word)) {
        return Determiner.UNKNOWN;
      }
    }
    if (getWordsRequiringA().has(word.toLowerCase()) || getWordsRequiringA().has(word)) {
      determiner = Determiner.A;
    }
    if (getWordsRequiringAn().has(word.toLowerCase()) || getWordsRequiringAn().has(word)) {
      if (determiner == Determiner.A) {
        determiner = Determiner.A_OR_AN;   // e.g. for 'historical'
      } else {
        determiner = Determiner.AN;
      }
    }
    if (determiner == Determiner.UNKNOWN) {
      const tokenFirstChar = word.charAt(0);
      if (StringTools.isAllUppercase(word) || StringTools.isMixedCase(word)) {
        // we don't know how all-uppercase words (often abbreviations) are pronounced,
        // so never complain about these
        determiner = Determiner.UNKNOWN;
      } else if (anPrefix.find()) {
        determiner = Determiner.AN;
      } else if (AvsAnRule.isVowel(tokenFirstChar) && !anExceptionPrefix.find()) {
        determiner = Determiner.AN;
      } else {
        determiner = Determiner.A;
      }
    }
    return determiner;
  }

  private static isVowel(c: string): boolean {
    const lc = c.toLowerCase();
    return lc == 'a' || lc == 'e' || lc == 'i' || lc == 'o' || lc == 'u';
  }

}
