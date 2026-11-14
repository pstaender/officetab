// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WhiteSpaceBeforeParagraphEnd.java faithful
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
 * A rule that checks for a whitespace at the end of a paragraph
 * @author Fred Kruse
 */
export class WhiteSpaceBeforeParagraphEnd extends TextLevelRule {

  private readonly lang: Language;

  constructor(messages: ResourceBundle, lang: Language, defaultActive = false) {
    super(messages);
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.lang = lang;
    if (!defaultActive) {
      this.setDefaultOff();
    }
    this.setOfficeDefaultOn();
    this.setLocQualityIssueType(ITSIssueType.Style);
  }

  override getId(): string {
    return 'WHITESPACE_PARAGRAPH';
  }

  override getDescription(): string {
    return this.messages!.getString('whitespace_before_parapgraph_end_desc');
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (let n = 0; n < sentences.length; n++) {
      const sentence = sentences[n]!;
      if (Tools.isParagraphEnd(sentences, n, this.lang)) {
        const tokens = sentence.getTokens();
        let lb: number;
        let lw: number;
        for (lb = tokens.length - 1; lb > 0 && tokens[lb]!.isLinebreak(); lb--);
        for (lw = lb; lw > 0 && tokens[lw]!.isWhitespace() && tokens[lw]!.getToken() !== '​'; lw--);
        if (lw < lb) {
          const fromPos = tokens[lw]!.isWhitespace() ? pos + tokens[lw + 1]!.getStartPos() : pos + tokens[lw]!.getStartPos();
          const toPos = pos + tokens[lb]!.getEndPos();
          const ruleMatch = new RuleMatch(this, sentence, fromPos, toPos, this.messages!.getString('whitespace_before_parapgraph_end_msg'));
          if (lw > 0 && !tokens[lw]!.isWhitespace()) {
            ruleMatch.setSuggestedReplacement(tokens[lw]!.getToken());
          } else {
            ruleMatch.setSuggestedReplacement('');
          }
          ruleMatches.push(ruleMatch);
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
