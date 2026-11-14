// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractSpecificCaseRule.java faithful
// The map per class is keyed by the constructor.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { StringTools } from '../tools/StringTools.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { CachingWordListLoader } from './spelling/CachingWordListLoader.ts';

// a map that has as keys the special case phrases into lowercase
// and as values the special case phrases properly spelled:
// one for each subclass
const lcToProperSpelling = new Map<Function, Map<string, string>>();
let maxLen = 0;

/**
 * A rule that matches words which need a specific upper/lowercase spelling.
 * @since 4.8
 */
export abstract class AbstractSpecificCaseRule extends Rule {

  // used to speed up the server as the phrases are loaded in every initialization:
  protected readonly phrasesListLoader = new CachingWordListLoader();

  /**
   * The constructor of the abstract class AbstractSpecificCaseRule
   * @param messages     the messages to apply the rule
   */
  constructor(messages: ResourceBundle) {
    super(messages);
    super.setCategory(Categories.CASING.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.loadPhrases();
  }

  /**
   * @return the path to the txt file that contains the phrases for the rule
   */
  abstract getPhrasesPath(): string;

  /**
   * @return the message that will be shown if the words of the
   *         wrongly capitalized phrase must begin with capital
   */
  getInitialCapitalMessage(): string {
    return 'The initials of the particular phrase must be capitals.';
  }

  /**
   * @return the message that will be shown if the wrongly capitalized phrase
   *         must not be written with capital initials
   *         (another special kind of capitalization)
   */
  getOtherCapitalizationMessage(): string {
    return 'The particular expression should follow the suggested capitalization.';
  }

  getShortMessage(): string {
    return 'Special capitalization';
  }

  /**
   * Initializes the phrases that will be detected from the rule by the given path
   */
  private loadPhrases(): void {
    if (!lcToProperSpelling.has(this.constructor)) {
      const properSpelling = new Map<string, string>();
      const lines = this.phrasesListLoader.loadWords(this.getPhrasesPath());
      for (const line of lines) {
        const parts = StringSplit(line, ' ').length;
        maxLen = Math.max(parts, maxLen);
        const phrase = StringTrim(line);
        properSpelling.set(phrase.toLowerCase(), phrase);
      }
      lcToProperSpelling.set(this.constructor, properSpelling);
    }
  }

  override getId(): string {
    return 'SPECIFIC_CASE';
  }

  override getDescription(): string {
    return 'Checks upper/lower case expressions.';
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    const properSpellingMap = lcToProperSpelling.get(this.constructor)!;
    for (let i = 0; i < tokens.length; i++) {
      const l: string[] = [];
      let j = 0;
      while (l.length < maxLen && i + j < tokens.length) {
        l.push(tokens[i + j]!.getToken());
        j++;
        const phrase = l.join(' ');
        const lcPhrase = phrase.toLowerCase();
        const properSpelling = properSpellingMap.get(lcPhrase);
        if (properSpelling != null && !StringTools.isAllUppercase(phrase) && phrase !== properSpelling) {
          if (i > 0 && tokens[i - 1]!.isSentenceStart() && !StringTools.startsWithUppercase(properSpelling)) {
            // avoid suggesting e.g. "vitamin C" at sentence start:
            continue;
          }
          let msg: string;
          if (this.allWordsUppercase(properSpelling)) {
            msg = this.getInitialCapitalMessage();
          } else {
            msg = this.getOtherCapitalizationMessage();
          }
          const match = new RuleMatch(this, sentence, tokens[i]!.getStartPos(),
                                  tokens[i + j - 1]!.getEndPos(), msg, this.getShortMessage());
          match.setSuggestedReplacement(properSpelling);
          matches.push(match);
        }
      }
    }
    return this.toRuleMatchArray(matches);
  }

  /**
   * Checks if all the words in the given string begin with a capital letter
   * @param s    the string to check
   * @return     <code>true</code> if all the words within the given string
   *             begin with capital letter, else <code>false</code>
   */
  private allWordsUppercase(s: string): boolean {
    return StringSplit(s, ' ').every((w) => StringTools.startsWithUppercase(w));
  }
}
