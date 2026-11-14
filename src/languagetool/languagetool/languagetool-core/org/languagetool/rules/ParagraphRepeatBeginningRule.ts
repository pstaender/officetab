// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/ParagraphRepeatBeginningRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { Tools } from '../tools/Tools.ts';
import { Character } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

let QUOTES_REGEX: Pattern | null = null;

/**
 * Check if to paragraphs begin with the same word.
 * If the first word is an article it checks if the first two words are identical
 *
 * @author Fred Kruse
 * @since 4.1
 */
export class ParagraphRepeatBeginningRule extends TextLevelRule {

  private readonly lang: Language;

  constructor(messages: ResourceBundle, lang: Language) {
    super(messages);
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.lang = lang;
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.setDefaultOff();
  }

  override getId(): string {
    return 'PARAGRAPH_REPEAT_BEGINNING_RULE';
  }

  override getDescription(): string {
    return this.messages!.getString('repetition_paragraph_beginning_desc');
  }

  isArticle(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith('DT');
  }

  private numCharEqualBeginning(lastTokens: AnalyzedTokenReadings[], nextTokens: AnalyzedTokenReadings[]): number {
    QUOTES_REGEX ??= Pattern.compile('[’\'"„“”»«‚‘›‹()\\[\\]]');
    if (lastTokens.length < 2 || nextTokens.length < 2
        || lastTokens[1]!.isWhitespace() || nextTokens[1]!.isWhitespace()) {
      return 0;
    }
    let nToken = 1;
    let lastToken = lastTokens[nToken]!.getToken();
    let nextToken = nextTokens[nToken]!.getToken();
    if (QUOTES_REGEX.matcher(lastToken).matches() && lastToken === nextToken) {
      if (lastTokens.length <= nToken + 1 || nextTokens.length <= nToken + 1) {
        return 0;
      }
      nToken++;
      lastToken = lastTokens[nToken]!.getToken();
      nextToken = nextTokens[nToken]!.getToken();
    }
    if (!Character.isLetter(lastToken.charAt(0))) {
      return 0;
    }
    if (lastTokens.length > nToken + 1 && this.isArticle(lastTokens[nToken]!) && lastToken === nextToken) {
      if (nextTokens.length <= nToken + 1) {
        return 0;
      }
      nToken++;
      lastToken = lastTokens[nToken]!.getToken();
      nextToken = nextTokens[nToken]!.getToken();
    }
    if (!Character.isLetter(lastToken.charAt(0))) {
      return 0;
    }
    if (lastToken === nextToken) {
      return lastTokens[nToken]!.getEndPos();
    }
    return 0;
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {

    const ruleMatches: RuleMatch[] = [];

    if (sentences.length < 1) {
      return this.toRuleMatchArray(ruleMatches);
    }

    let nextPos = 0;
    let lastPos = 0;
    let endPos: number;
    let lastSentence = sentences[0]!;
    let lastTokens = lastSentence.getTokensWithoutWhitespace();
    let nextSentence: AnalyzedSentence;
    let nextTokens: AnalyzedTokenReadings[];

    for (let n = 0; n < sentences.length - 1; n++) {
      nextPos += sentences[n]!.getText().length;
      if (Tools.isParagraphEnd(sentences, n, this.lang)) {
        nextSentence = sentences[n + 1]!;
        nextTokens = nextSentence.getTokensWithoutWhitespace();
        endPos = this.numCharEqualBeginning(lastTokens, nextTokens);
        if (endPos > 0) {
          let startPos = lastPos + lastTokens[1]!.getStartPos();
          if (startPos < lastPos + endPos) {
            let msg = this.messages!.getString('repetition_paragraph_beginning_last_msg');
            let ruleMatch = new RuleMatch(this, lastSentence, startPos, lastPos + endPos, msg);
            ruleMatches.push(ruleMatch);

            startPos = nextPos + nextTokens[1]!.getStartPos();
            msg = this.messages!.getString('repetition_paragraph_beginning_last_msg');
            ruleMatch = new RuleMatch(this, nextSentence, startPos, nextPos + endPos, msg);
            ruleMatches.push(ruleMatch);
          }
        }
        lastSentence = nextSentence;
        lastTokens = nextTokens;
        lastPos = nextPos;
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return 1;
  }

}
