// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SentenceWhitespaceRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

/** StringUtils.isNumeric: not empty, and only Unicode digits. */
function isNumeric(cs: string): boolean {
  return cs.length > 0 && [...cs].every((c) => Character.isDigit(c));
}

/**
 * Checks that there's whitespace between sentences.
 *
 * @author Daniel Naber
 * @since 2.5
 */
export class SentenceWhitespaceRule extends TextLevelRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    super.setCategory(Categories.TYPOGRAPHY.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Whitespace);
  }

  override getId(): string {
    return 'SENTENCE_WHITESPACE';
  }

  override getDescription(): string {
    return this.messages!.getString('missing_space_between_sentences');
  }

  getMessage(_prevSentenceEndsWithNumber: boolean): string {
    return this.messages!.getString('addSpaceBetweenSentences');
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    let isFirstSentence = true;
    let prevSentenceEndsWithWhitespace = false;
    let prevSentenceEndsWithNumber = false;
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokens();
      if (isFirstSentence) {
        isFirstSentence = false;
      } else {
        if (!prevSentenceEndsWithWhitespace && tokens.length > 1) {
          const firstToken = tokens[1]!.getToken();
          const ruleMatch = new RuleMatch(this, sentence, pos, pos + firstToken.length, this.getMessage(prevSentenceEndsWithNumber));
          ruleMatch.setSuggestedReplacement(' ' + firstToken);
          ruleMatches.push(ruleMatch);
        }
      }
      if (tokens.length > 0) {
        const lastToken = tokens[tokens.length - 1]!.getToken();
        prevSentenceEndsWithWhitespace = StringTrim(lastToken.replaceAll(' ', ' ')).length === 0 && lastToken.length === 1;
      }
      if (tokens.length > 1) {
        const prevLastToken = tokens[tokens.length - 2]!.getToken();
        prevSentenceEndsWithNumber = isNumeric(prevLastToken);
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return 0;
  }

}
