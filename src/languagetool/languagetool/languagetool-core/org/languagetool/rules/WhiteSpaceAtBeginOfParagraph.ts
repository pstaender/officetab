// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WhiteSpaceAtBeginOfParagraph.java faithful
// The two constructors are one (defaultActive defaults to false).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';

/**
 * A rule that checks for WhiteSpaces at the begin of a paragraph
 * @since 4.0
 * @author Fred Kruse
 */
export class WhiteSpaceAtBeginOfParagraph extends Rule {

  constructor(messages: ResourceBundle, defaultActive = false) {
    super(messages);
    super.setCategory(Categories.STYLE.getCategory(messages));
    if (!defaultActive) {
      this.setDefaultOff();
    }
    this.setOfficeDefaultOn();
    this.setLocQualityIssueType(ITSIssueType.Style);
  }

  override getId(): string {
    return 'WHITESPACE_PARAGRAPH_BEGIN';
  }

  override getDescription(): string {
    return this.messages!.getString('whitespace_at_begin_parapgraph_desc');
  }

  private isWhitespaceDel(token: AnalyzedTokenReadings): boolean {
    // returns only whitespaces that may be deleted
    // "​" is excluded to prevent function (e.g. page number, page count) in LO/OO
    return token.isWhitespace() && token.getToken() !== '​' && !token.isLinebreak();
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokens();
    let i: number;
    for (i = 1; i < tokens.length && this.isWhitespaceDel(tokens[i]!); i++);
    if (i > 1 && i < tokens.length && !tokens[i]!.isLinebreak()) {
      const ruleMatch = new RuleMatch(this, sentence, tokens[1]!.getStartPos(),
              tokens[i]!.getEndPos(), this.messages!.getString('whitespace_at_begin_parapgraph_msg'));
      ruleMatch.setSuggestedReplacement(tokens[i]!.getToken());
      ruleMatches.push(ruleMatch);
    }
    return this.toRuleMatchArray(ruleMatches);
  }

}
