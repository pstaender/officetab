// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WordRepeatRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { Character } from '../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase } from '../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';

/** StringUtils.isNumericSpace: only Unicode digits and spaces (U+0020). */
function StringUtils_isNumericSpace(cs: string): boolean {
  for (const c of cs) {
    if (c !== ' ' && !Character.isDigit(c)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a word is repeated, e.g. "the the".
 *
 * @author Daniel Naber
 */
export class WordRepeatRule extends Rule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages);
    super.setCategory(Categories.MISC.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Duplication);
  }

  /**
   * Implement this method to return <code>true</code> if there's
   * a potential word repetition at the current position that should be ignored,
   * i.e. if no error should be created.
   * @param tokens the tokens of the sentence currently being checked
   * @param position the current position in the tokens
   * @return this implementation always returns false
   */
  ignore(tokens: AnalyzedTokenReadings[], position: number): boolean {
    if (this.wordRepetitionOf('Phi', tokens, position)) {
      return true;   // "Phi Phi Islands"
    } else if (this.wordRepetitionOf('Li', tokens, position)) {
      return true;   // "Li Li", Chinese name
    } else if (this.wordRepetitionOf('Xiao', tokens, position)) {
      return true;   // "Xiao Xiao", name
    } else if (this.wordRepetitionOf('Duran', tokens, position)) {
      return true;   // "Duran Duran"
    } else if (this.wordRepetitionOf('Wagga', tokens, position)) {
      return true;   // "Wagga Wagga"
    } else if (this.wordRepetitionOf('Abdullah', tokens, position)) {
      return true;   // https://en.wikipedia.org/wiki/Abdullah_Abdullah
    } else if (this.wordRepetitionOf('Nwe', tokens, position)) {
      return true;   // e.g. https://en.wikipedia.org/wiki/Nwe_Nwe_Aung
    } else if (this.wordRepetitionOf('Pago', tokens, position)) {
      return true;   // "Pago Pago"
    } else if (this.wordRepetitionOf('Cao', tokens, position)) {
      return true;   // https://en.wikipedia.org/wiki/Cao_Cao
    }
    return false;
  }

  override getId(): string {
    return 'WORD_REPEAT_RULE';
  }

  override getDescription(): string {
    return this.messages!.getString('desc_repetition');
  }

  override estimateContextForSureMatch(): number {
    return 1;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    let prevToken = '';
    // we start from token 1, token no. 0 is guaranteed to be SENT_START
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!.getToken();
      if (tokens[i]!.isImmunized()) {
        prevToken = '';
        continue;
      }
      if (this.isWord(token) && StringEqualsIgnoreCase(prevToken, token) && !this.ignore(tokens, i)) {
        const msg = this.messages!.getString('repetition');
        const prevPos = tokens[i - 1]!.getStartPos();
        const pos = tokens[i]!.getStartPos();
        const ruleMatch = this.createRuleMatch(prevToken, token, prevPos, pos, msg, sentence);
        ruleMatches.push(ruleMatch);
      }
      prevToken = token;
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  protected createRuleMatch(prevToken: string, _token: string, prevPos: number, pos: number, msg: string, sentence: AnalyzedSentence): RuleMatch {
    const ruleMatch = new RuleMatch(this, sentence, prevPos, pos + prevToken.length, msg, this.messages!.getString('desc_repetition_short'));
    ruleMatch.setSuggestedReplacement(prevToken);
    return ruleMatch;
  }

  protected wordRepetitionOf(word: string, tokens: AnalyzedTokenReadings[], position: number): boolean {
    return position > 0 && tokens[position - 1]!.getToken() === word && tokens[position]!.getToken() === word;
  }

  // avoid "..." etc. to be matched:
  private isWord(token: string): boolean {
    if (StringTools.isEmoji(token)) {
      return false;
    }
    if (StringUtils_isNumericSpace(token)) {
      return false;
    } else if (token.length === 1) {
      const c = token.charAt(0);
      if (!Character.isLetter(c)) {
        return false;
      }
    }
    return true;
  }

}
