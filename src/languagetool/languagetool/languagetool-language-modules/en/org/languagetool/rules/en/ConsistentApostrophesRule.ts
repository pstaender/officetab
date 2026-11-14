// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/ConsistentApostrophesRule.java faithful
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Check for consistent use of apostrophes (typographic (’) vs. typewriter (')).
 * @since 5.3
 */
export class ConsistentApostrophesRule extends TextLevelRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    this.setDefaultTempOff(); // TODO
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/punctuation-guide/#what-is-an-apostrophe'));
    this.addExamplePair(Example.wrong("It's nice, but it <marker>doesn’t</marker> work."),
                   Example.fixed("It's nice, but it <marker>doesn't</marker> work."));
  }

  override getId(): string {
    return 'EN_CONSISTENT_APOS';
  }

  override getDescription(): string {
    return "Checks if the two types of apostrophes (' and ’) are used consistently in a text.";
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const matches: RuleMatch[] = [];
    let pos = 0;
    const hasTwoTypes = this.hasTwoApostropheTypes(sentences);
    if (!hasTwoTypes) {
      return this.toRuleMatchArray(matches);
    }
    for (const sentence of sentences) {
      const tokens = sentence.getTokens();
      for (const token of tokens) {
        let message: string | null = null;
        let repl: string | null = null;
        if (token != null && token.getToken().includes("'") && !token.hasTypographicApostrophe()) {
          message = 'You used a typewriter-style apostrophe here, but a typographic apostrophe elsewhere in this text.';
          repl = token.getToken().replaceAll("'", '’');
        } else if (token != null && token.getToken().includes("'") && token.hasTypographicApostrophe()) {
          message = 'You used a typographic apostrophe here, but a typewriter-style apostrophe elsewhere in this text.';
          repl = token.getToken();
        }
        if (message != null) {
          const match = new RuleMatch(this, sentence, pos + token.getStartPos(), pos + token.getEndPos(),
                              message + ' Both are correct, but consider using the same type everywhere in your text.');
          match.setSuggestedReplacement(repl!);
          matches.push(match);
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(matches);
  }

  private hasTwoApostropheTypes(sentences: AnalyzedSentence[]): boolean {
    let hasTypewriterStyle = false;
    let hasTypographicStyle = false;
    for (const sentence of sentences) {
      const tokens = sentence.getTokens();
      for (const token of tokens) {
        if (token != null && token.getToken().includes("'") && !token.hasTypographicApostrophe()) {
          hasTypewriterStyle = true;
        } else if (token != null && token.getToken().includes("'") && token.hasTypographicApostrophe()) {
          hasTypographicStyle = true;
        }
        if (hasTypewriterStyle && hasTypographicStyle) {
          return true;
        }
      }
    }
    return false;
  }

  override minToCheckParagraph(): number {
    return -1;
  }

}
