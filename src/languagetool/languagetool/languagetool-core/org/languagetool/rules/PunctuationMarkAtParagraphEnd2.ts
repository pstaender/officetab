// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/PunctuationMarkAtParagraphEnd2.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { Tools } from '../tools/Tools.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringMatches } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

// more than this many word tokens needed for a "real" paragraph that requires a period (etc) at the end:
const TOKEN_THRESHOLD = 10;

/**
 * A rule that checks for a punctuation mark at the end of a paragraph.
 * Simplified implementation of PunctuationMarkAtParagraphEnd.
 */
export class PunctuationMarkAtParagraphEnd2 extends TextLevelRule {

  private readonly lang: Language;

  constructor(messages: ResourceBundle, lang: Language) {
    super(messages);
    this.lang = Objects_requireNonNull(lang);
    super.setCategory(Categories.PUNCTUATION.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Grammar);
//  setDefaultTempOff();  // TODO
    this.setDefaultOff();

  }

  override getId(): string {
    return 'PUNCTUATION_PARAGRAPH_END2';
  }

  override getDescription(): string {
    return this.messages!.getString('punctuation_mark_paragraph_end_desc');
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    let sentPos = 0;
    let tokenCount = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokens();
      for (const token of tokens) {
        if (!token.isNonWord() && !token.isWhitespace()) {
          tokenCount++;
        }
      }
      const lastNonSpaceToken = this.getLastNonSpaceToken(tokens);
      const isParaEnd = Tools.isParagraphEnd(sentences, sentPos, this.lang);
      if (isParaEnd && tokenCount > TOKEN_THRESHOLD &&
          lastNonSpaceToken != null && !StringMatches(lastNonSpaceToken.getToken(), '[:.?!…]') && !lastNonSpaceToken.isNonWord()) {
        const ruleMatch = new RuleMatch(this, sentence, pos + lastNonSpaceToken.getStartPos(), pos + lastNonSpaceToken.getEndPos(),
          this.messages!.getString('punctuation_mark_paragraph_end_msg'));
        ruleMatch.setSuggestedReplacement(lastNonSpaceToken.getToken() + '.');
        ruleMatches.push(ruleMatch);
      }
      if (isParaEnd) {
        tokenCount = 0;
      }
      sentPos++;
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private getLastNonSpaceToken(tokens: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null {
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!tokens[i]!.isWhitespace()) {
        return tokens[i]!;
      }
    }
    return null;
  }

  override minToCheckParagraph(): number {
    return 0;
  }

}
