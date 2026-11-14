// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WordRepeatBeginningRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringMatches } from '../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Check if three successive sentences begin with the same word, e.g. "I am Max. I am living in Germany. I like ice cream.",
 * and if two successive sentences begin with the same adverb, e.g. "Furthermore, he is ill. Furthermore, he likes her."
 *
 * @author Markus Brenneis
 */
export class WordRepeatBeginningRule extends TextLevelRule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages);
    super.setCategory(Categories.REPETITIONS_STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Style);
  }

  override getId(): string {
    return 'WORD_REPEAT_BEGINNING_RULE';
  }

  override getDescription(): string {
    return this.messages!.getString('desc_repetition_beginning');
  }

  protected isAdverb(_token: AnalyzedTokenReadings): boolean {
    return false;
  }

  isException(token: string): boolean {
    // avoid warning when having lists like "2007: ..." or the like
    return token === ':' || token === '–' || token === '-' || token === '✔️' || token === '➡️'
        || token === '—' || token === '⭐️' || token === '⚠️';
  }

  isSentenceException(_sentence: AnalyzedSentence): boolean {
    return false;
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    let lastToken = '';
    let beforeLastToken = '';
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    let prevSentence: AnalyzedSentence | null = null;
    for (const sentence of sentences) {
      if (this.isSentenceException(sentence)) {
        prevSentence = null;
        continue;
      }
      const tokens = sentence.getTokensWithoutWhitespace();
      let token = '';
      if (tokens.length > 1) {
        const analyzedToken = tokens[1]!;
        token = analyzedToken.getToken();
        if (tokens.length > 3) {
          // avoid "..." etc. to be matched:
          let isWord = true;
          if (token.length === 1) {
            if (!Character.isLetter(token.charAt(0))) {
              isWord = false;
            }
          }
          if (isWord && lastToken === token && !this.isException(token) && !this.isException(tokens[2]!.getToken())
              && !this.isException(tokens[3]!.getToken()) && prevSentence != null
              && StringMatches(StringTrim(prevSentence.getText()), '.+[.?!]$')) { // no matches for e.g. table cells
            let shortMsg: string;
            if (this.isAdverb(analyzedToken)) {
              shortMsg = this.messages!.getString('desc_repetition_beginning_adv');
            } else if (beforeLastToken === token) {
              shortMsg = this.messages!.getString('desc_repetition_beginning_word');
            } else {
              shortMsg = '';
            }
            if (shortMsg.length !== 0) {
              const msg = shortMsg + ' ' + this.messages!.getString('desc_repetition_beginning_thesaurus');
              const startPos = analyzedToken.getStartPos();
              const endPos = startPos + token.length;
              const ruleMatch = new RuleMatch(this, sentence, pos + startPos, pos + endPos, msg, shortMsg);
              const suggestions = this.getSuggestions(analyzedToken);
              if (suggestions.length > 0) {
                ruleMatch.setSuggestedReplacements(suggestions);
              }
              ruleMatches.push(ruleMatch);
            }
          }
        }
      }
      beforeLastToken = lastToken;
      lastToken = token;
      pos += sentence.getCorrectedTextLength();
      prevSentence = sentence;
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  protected getSuggestions(_analyzedToken: AnalyzedTokenReadings): string[] {
    return [];
  }

  override minToCheckParagraph(): number {
    return 2;
  }

}
