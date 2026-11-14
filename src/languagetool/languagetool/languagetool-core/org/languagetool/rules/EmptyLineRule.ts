// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/EmptyLineRule.java faithful
// The two constructors are one (defaultActive defaults to false).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { Language } from '../Language.ts';
import { Tools } from '../tools/Tools.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

/**
 * A rule that checks for empty lines. Useful especially for office extension
 * It checks only linebreaks because empty paragraphs can't be handled in LO/OO
 *
 * @author Fred Kruse
 */

export class EmptyLineRule extends TextLevelRule {

  private readonly lang: Language;

  constructor(messages: ResourceBundle, lang: Language, defaultActive = false) {
    super(messages);
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.lang = lang;
    if (!defaultActive) {
      this.setDefaultOff();
    }
    this.setOfficeDefaultOn();  // Default for LO/OO is always On
    this.setLocQualityIssueType(ITSIssueType.Style);
  }

  override getId(): string {
    return 'EMPTY_LINE';
  }

  override getDescription(): string {
    return this.messages!.getString('empty_line_rule_desc');
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (let n = 0; n < sentences.length - 1; n++) {
      const sentence = sentences[n]!;
      if (Tools.isParagraphEnd(sentences, n, this.lang)) {
        if (this.isSecondParagraphEndMark(sentence.getText())) {
          const tokens = sentence.getTokensWithoutWhitespace();
          if (tokens.length > 1) {
            const fromPos = pos + tokens[tokens.length - 1]!.getStartPos();
            const toPos = pos + tokens[tokens.length - 1]!.getEndPos();
            const ruleMatch = new RuleMatch(this, sentence, fromPos, toPos, this.messages!.getString('empty_line_rule_msg'));
            // Can't use SuggestedReplacement because of problems in LO/OO dialog with linebreaks
            ruleMatches.push(ruleMatch);
          }
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private isSecondParagraphEndMark(sentence: string): boolean {
    if (this.lang.getSentenceTokenizer().singleLineBreaksMarksPara()) {
      if (sentence.endsWith('\n\n') || sentence.endsWith('\n\r\n\r')) {
        return true;
      }
    } else {
      if (sentence.endsWith('\n\n\n\n') || sentence.endsWith('\n\r\n\r\n\r\n\r') || sentence.endsWith('\r\n\r\n\r\n\r\n')) {
        return true;
      }
    }
    return false;
  }

  override minToCheckParagraph(): number {
    return 1;
  }

}
