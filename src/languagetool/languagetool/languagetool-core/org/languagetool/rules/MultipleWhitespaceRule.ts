// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/MultipleWhitespaceRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { StringTools } from '../tools/StringTools.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

/**
 * Check if there is duplicated whitespace in a sentence.
 * Considers two spaces as incorrect, and proposes a single space instead.
 *
 * @author Marcin Miłkowski
 */
export class MultipleWhitespaceRule extends TextLevelRule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages);
    super.setCategory(Categories.TYPOGRAPHY.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Whitespace);
  }

  override getId(): string {
    return 'WHITESPACE_RULE';
  }

  override getDescription(): string {
    return this.messages!.getString('desc_whitespacerepetition');
  }

  // First White space is not a linebreak, function or footnote
  private static isFirstWhite(token: AnalyzedTokenReadings): boolean {
    return (token.isWhitespace() || StringTools.isNonBreakingWhitespace(token.getToken()))
        && !token.isLinebreak()
        && !token.getToken().includes('​') && !token.getToken().includes('﻿') && !token.getToken().includes('⁠');
  }

  // Removable white space are not linebreaks, tabs, functions or footnotes
  private static isRemovableWhite(token: AnalyzedTokenReadings): boolean {
    return (token.isWhitespace() || StringTools.isNonBreakingWhitespace(token.getToken()))
        && !token.isLinebreak() && token.getToken() !== '\t'
        // exclude invisible spaces:
        && !token.getToken().includes('​') && !token.getToken().includes('﻿') && !token.getToken().includes('⁠');
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokens();
      //note: we start from token 1
      //token no. 0 is guaranteed to be SENT_START
      for (let i = 1; i < tokens.length; i++) {
        if (MultipleWhitespaceRule.isFirstWhite(tokens[i]!)) {
          const nFirst = i;
          for (i++; i < tokens.length && MultipleWhitespaceRule.isRemovableWhite(tokens[i]!); i++);
          i--;
          if (i > nFirst) {
            const message = this.messages!.getString('whitespace_repetition');
            const ruleMatch = new RuleMatch(this, sentence, pos + tokens[nFirst]!.getStartPos(),
                pos + tokens[i]!.getEndPos(), message);
            ruleMatch.setSuggestedReplacement(tokens[nFirst]!.getToken());
            ruleMatches.push(ruleMatch);
          }
        } else if (tokens[i]!.isLinebreak()) {
          for (i++; i < tokens.length && MultipleWhitespaceRule.isRemovableWhite(tokens[i]!); i++);
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return 0;
  }

}
