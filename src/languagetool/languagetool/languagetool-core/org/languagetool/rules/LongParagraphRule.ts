// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/LongParagraphRule.java faithful
// The three constructors are one: (messages, lang, userConfig) is defaultWords -1 and
// defaultActive true, (messages, lang, userConfig, defaultWords) defaultActive false.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { Language } from '../Language.ts';
import { Tag } from '../Tag.ts';
import type { UserConfig } from '../UserConfig.ts';
import { Tools } from '../tools/Tools.ts';
import { MessageFormat } from '../../../../../jdk/java/text/MessageFormat.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringReplaceFirst } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { RuleOption } from './RuleOption.ts';
import { TextLevelRule } from './TextLevelRule.ts';

const DEFAULT_ACTIVATION = false;
const DEFAULT_MAX_WORDS = 220;
const LIMIT_MAX_WORDS = 300;

/**
 * A rule that warns on long paragraphs.
 * @since 4.2
 */
export class LongParagraphRule extends TextLevelRule {

  static readonly RULE_ID = 'TOO_LONG_PARAGRAPH';

  private readonly lang: Language;

  private maxWords = DEFAULT_MAX_WORDS;

  /** Note: with defaultWords but without defaultActive, will be off by default. */
  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null, defaultWords?: number, _defaultActive?: boolean) {
    super(messages);
    if (defaultWords === undefined) {
      defaultWords = -1;
      _defaultActive = true;
    } else if (_defaultActive === undefined) {
      _defaultActive = DEFAULT_ACTIVATION;
    }
    super.setCategory(Categories.STYLE.getCategory(messages));
    this.lang = lang;
    this.setDefaultOff();
    this.setOfficeDefaultOn();  // Default for LO/OO is always On
    if (defaultWords > 0) {
      this.maxWords = defaultWords;
    }
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        this.maxWords = cf[0] as number;
      }
    }
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.setTags([Tag.picky]);
  }

  override getDescription(): string {
    return MessageFormat.format(this.messages!.getString('long_paragraph_rule_desc'), this.maxWords);
  }

  override getId(): string {
    return LongParagraphRule.RULE_ID;
  }

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [new RuleOption(this.maxWords, MessageFormat.format(
        this.messages!.getString('guiLongParagraphsText'), LIMIT_MAX_WORDS), 5, LIMIT_MAX_WORDS)];
    return ruleOptions;
  }

  getMessage(): string {
    return MessageFormat.format(this.messages!.getString('long_paragraph_rule_msg'), this.maxWords);
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    let startPos = 0;
    let endPos = 0;
    let wordCount = 0;
    let paraHasLinebreaks = false;
    for (let n = 0; n < sentences.length; n++) {
      const sentence = sentences[n]!;
      const paragraphEnd = Tools.isParagraphEnd(sentences, n, this.lang);
      if (!paragraphEnd && StringReplaceFirst(sentence.getText(), '^\n+', '').includes('\n')) {
        // e.g. text with manually added line breaks (e.g. issues on github with "- [ ]" syntax)
        paraHasLinebreaks = true;
      }
      const tokens = sentence.getTokensWithoutWhitespace();
      for (const token of tokens) {
        if (!token.isWhitespace() && !token.isSentenceStart() && !token.isNonWord()) {
          wordCount++;
          if (wordCount === this.maxWords) {
            endPos = token.getEndPos() + pos;
          } else if (wordCount === this.maxWords - 1) {
            startPos = token.getStartPos() + pos;
          }
        }
      }
      if (paragraphEnd) {
        if (wordCount > this.maxWords + 5 && !paraHasLinebreaks) {  // + 5: don't show match almost at end of paragraph
          const ruleMatch = new RuleMatch(this, sentence, startPos, endPos, this.getMessage());
          ruleMatches.push(ruleMatch);
        }
        wordCount = 0;
        paraHasLinebreaks = false;
      }
      pos += sentence.getCorrectedTextLength();
    }
    if (wordCount > this.maxWords) {
      const ruleMatch = new RuleMatch(this, null, startPos, endPos, this.getMessage());
      ruleMatches.push(ruleMatch);
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return 0;
  }

}
