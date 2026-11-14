// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/LongSentenceRule.java faithful
// Java calls Rule's constructor without messages and keeps its own messages field; here the
// bundle is passed to Rule's constructor (Rule.messages), which only changes the default
// category that the constructor then overwrites.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { Tag } from '../Tag.ts';
import type { UserConfig } from '../UserConfig.ts';
import { StringTools } from '../tools/StringTools.ts';
import { MessageFormat } from '../../../../../jdk/java/text/MessageFormat.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { RuleOption } from './RuleOption.ts';
import { TextLevelRule } from './TextLevelRule.ts';

let patterns: { QUOTED_SENT_END: Pattern; SENT_END: Pattern } | null = null;
const P = () => (patterns ??= {
  QUOTED_SENT_END: Pattern.compile('[?!.]["“”„»«]', Pattern.DOTALL),
  SENT_END: Pattern.compile('[?!.]'),
});

const OPENING_QUOTES = ['"', '“', '„', '«', '(', '[', '{', '—'];
const CLOSING_QUOTES = ['"', '”', '“', '»', ')', ']', '}', '—'];

/**
 * A rule that warns on long sentences.
 * @since 3.9
 */
export class LongSentenceRule extends TextLevelRule {

  static readonly RULE_ID = 'TOO_LONG_SENTENCE';

  private readonly maxWords: number;

  constructor(messages: ResourceBundle, userConfig: UserConfig | null, maxWords: number) {
    super(messages);
    this.setCategory(Categories.STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.setTags([Tag.picky]);
    let tmpMaxWords = maxWords;
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        tmpMaxWords = cf[0] as number;
      }
    }
    this.maxWords = tmpMaxWords;
  }

  override getDescription(): string {
    return MessageFormat.format(this.messages!.getString('long_sentence_rule_desc'), this.maxWords);
  }

  override getId(): string {
    return LongSentenceRule.RULE_ID;
  }

  private isWordCount(tokenText: string): boolean {
    if (tokenText.length > 0) {
      return !StringTools.isNotWordCharacter(tokenText.substring(0, 1));
    }
    return false;
  }

  getMessage(): string {
    return MessageFormat.format(this.messages!.getString('long_sentence_rule_msg2'), this.maxWords);
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const { QUOTED_SENT_END, SENT_END } = P();
    const maxWords = this.maxWords;
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokens();
      if (tokens.length < maxWords) {   // just a short-circuit
        pos += sentence.getCorrectedTextLength();
        continue;
      }
      if (QUOTED_SENT_END.matcher(sentence.getText()).find()) {
        pos += sentence.getCorrectedTextLength();
        continue;
      }
      const msg = this.getMessage();
      let i = 0;
      const fromPos: number[] = [];
      const toPos: number[] = [];

      let fromPosToken: AnalyzedTokenReadings | null = null;
      let toPosToken: AnalyzedTokenReadings | null = null;
      let indexOfQuote = -1;
      while (i < tokens.length) {
        let numWords = 0;
        while (i < tokens.length && tokens[i]!.getToken() !== ':' && tokens[i]!.getToken() !== ';'
          && tokens[i]!.getToken() !== '\n' && tokens[i]!.getToken() !== '\r\n'
          && tokens[i]!.getToken() !== '\n\r'
        ) {
          const token = tokens[i]!.getToken();
          if (indexOfQuote === -1 && OPENING_QUOTES.includes(token)) {
            indexOfQuote = OPENING_QUOTES.indexOf(token);
          } else if (indexOfQuote > -1 && CLOSING_QUOTES.indexOf(token) === indexOfQuote) {
            indexOfQuote = -1;
          }
          if (this.isWordCount(token) && indexOfQuote === -1) {
            //Get first word token
            if (fromPosToken == null) {
              fromPosToken = tokens[i]!;
            }
            if (numWords === maxWords) {
              //Get last word token
              if (toPosToken == null) {
                for (let j = tokens.length - 1; j >= 0; j--) {
                  if (this.isWordCount(tokens[j]!.getToken())) {
                    if (tokens.length > j + 1 && SENT_END.matcher(tokens[j + 1]!.getToken()).matches()) {
                      toPosToken = tokens[j + 1]!;
                    } else {
                      toPosToken = tokens[j]!;
                    }
                    break;
                  }
                }
              }
              if (fromPosToken != null && toPosToken != null) {
                fromPos.push(fromPosToken.getStartPos());
                toPos.push(toPosToken.getEndPos());
              } else {
                //keep old logic if we could not find word tokens
                fromPos.push(tokens[0]!.getStartPos());
                toPos.push(tokens[tokens.length - 1]!.getEndPos());
              }
              break;
            }
            numWords++;
          }
          i++;
        }
        i++;
      }
      for (let j = 0; j < fromPos.length; j++) {
        const ruleMatch = new RuleMatch(this, sentence, pos + fromPos[j]!, pos + toPos[j]!, msg);
        ruleMatches.push(ruleMatch);
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return 0;
  }

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [new RuleOption(this.maxWords, this.messages!.getString('guiLongSentencesText'), 5, 100)];
    return ruleOptions;
  }

}
