// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/DoublePunctuationRule.java faithful
// The two constructors are one; the URL is a string.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';

/**
 * A rule that matches ".." (but not "..." etc) and ",,".
 *
 * @author Daniel Naber
 */
export class DoublePunctuationRule extends Rule {

  /** @since 5.9 (with url) */
  constructor(messages: ResourceBundle, url: string | null = null) {
    super(messages);
    super.setCategory(Categories.PUNCTUATION.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Typographical);
    if (url != null) {
      this.setUrl(url);
    }
  }

  override getId(): string {
    return 'DOUBLE_PUNCTUATION';
  }

  override getDescription(): string {
    return this.messages!.getString('desc_double_punct');
  }

  getCommaCharacter(): string {
    return ',';
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokensWithoutWhitespace();
    let startPos = 0;
    let dotCount = 0;
    let commaCount = 0;
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!.getToken();
      let nextToken: string | null = null;
      let prevPrevToken: string | null = null;
      if (i < tokens.length - 1) {
        nextToken = tokens[i + 1]!.getToken();
      }
      if (i > 1) {
        prevPrevToken = tokens[i - 2]!.getToken();
      }
      if ('.' === token) {
        dotCount++;
        commaCount = 0;
        startPos = tokens[i]!.getStartPos();
      } else if (this.getCommaCharacter() === token) {
        commaCount++;
        dotCount = 0;
        startPos = tokens[i]!.getStartPos();
      }


      if (dotCount === 2 && '.' !== nextToken && '…' !== nextToken &&
          '/' !== token && '/' !== nextToken &&  /* Unix path */
          '\\' !== token && '\\' !== nextToken &&  /* Windows path */
          '?' !== prevPrevToken && '!' !== prevPrevToken &&
          '…' !== prevPrevToken && '.' !== prevPrevToken) {
        const fromPos = Math.max(0, startPos - 1);
        const ruleMatch = new RuleMatch(this, sentence, fromPos, startPos + 1,
            this.getDotMessage(), this.messages!.getString('double_dots_short'));
        ruleMatch.addSuggestedReplacement('.');
        ruleMatch.addSuggestedReplacement('…');
        ruleMatches.push(ruleMatch);
        dotCount = 0;
      } else if (commaCount === 2 && this.getCommaCharacter() !== nextToken) {
        const fromPos = Math.max(0, startPos - 1);
        const ruleMatch = new RuleMatch(this, sentence, fromPos, startPos + 1,
            this.getCommaMessage(), this.messages!.getString('double_commas_short'));
        ruleMatch.setSuggestedReplacement(this.getCommaCharacter());
        ruleMatches.push(ruleMatch);
        commaCount = 0;
      }
      if ('.' !== token && this.getCommaCharacter() !== token) {
        dotCount = 0;
        commaCount = 0;
      }
    }

    return this.toRuleMatchArray(ruleMatches);
  }

  protected getDotMessage(): string {
    return this.messages!.getString('two_dots');
  }

  protected getCommaMessage(): string {
    return this.messages!.getString('two_commas');
  }

}
