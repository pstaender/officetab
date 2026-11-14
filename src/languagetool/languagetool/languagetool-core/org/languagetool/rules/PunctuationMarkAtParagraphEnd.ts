// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/PunctuationMarkAtParagraphEnd.java faithful
// The two constructors are one (defaultActive defaults to true).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { Tag } from '../Tag.ts';
import { WordTokenizer } from '../tokenizers/WordTokenizer.ts';
import { Tools } from '../tools/Tools.ts';
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase } from '../../../../../jdk/java/lang/String.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

const PUNCTUATION_MARKS = ['.', '!', '?', ':', ',', ';'];
const QUOTATION_MARKS = ['„', '»', '«', '"', '”', '″', '’', '‚', '‘', '›', '‹', '′', "'"];
let P_NUMERIC: Pattern | null = null;
const MAX_URL_LENGTH = 30; // Do not add punctuation after long URLs

/**
 * A rule that checks for a punctuation mark at the end of a paragraph.
 * @author Fred Kruse
 * @since 4.1
 */
export class PunctuationMarkAtParagraphEnd extends TextLevelRule {

  private readonly lang: Language;

  /**
   * @since 4.5 (with defaultActive)
   */
  constructor(messages: ResourceBundle, lang: Language, defaultActive = true) {
    super(messages);
    this.lang = Objects_requireNonNull(lang);
    super.setCategory(Categories.PUNCTUATION.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Grammar);
    this.setTags([Tag.picky]);
    if (!defaultActive) {
      this.setDefaultOff();
    }
  }

  override getId(): string {
    return 'PUNCTUATION_PARAGRAPH_END';
  }

  override getDescription(): string {
    return this.messages!.getString('punctuation_mark_paragraph_end_desc');
  }

  private static stringEqualsAny(token: string, any: string[]): boolean {
    for (const s of any) {
      if (token === s) {
        return true;
      }
    }
    return false;
  }

  private static isQuotationMark(tk: AnalyzedTokenReadings): boolean {
    return PunctuationMarkAtParagraphEnd.stringEqualsAny(tk.getToken(), QUOTATION_MARKS);
  }

  private static isPunctuationMark(tk: AnalyzedTokenReadings): boolean {
    return PunctuationMarkAtParagraphEnd.stringEqualsAny(tk.getToken(), PUNCTUATION_MARKS);
  }

  private static isWord(tk: AnalyzedTokenReadings): boolean {
    return Character.isLetter(tk.getToken().charAt(0));
  }

  private static isNumeric(s: string): boolean {
    P_NUMERIC ??= Pattern.compile('[0-9.]+');
    return P_NUMERIC.matcher(StringTrim(s)).matches();
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const { isWord, isPunctuationMark, isQuotationMark, isNumeric } = PunctuationMarkAtParagraphEnd;
    const ruleMatches: RuleMatch[] = [];
    let lastPara = -1;
    let pos = 0;
    let isFirstWord: boolean;
    for (let n = 0; n < sentences.length; n++) {
      const sentence = sentences[n]!;
      if (Tools.isParagraphEnd(sentences, n, this.lang)) {
        const tokens = sentence.getTokensWithoutWhitespace();
        if (tokens.length > 2) {
          isFirstWord = (isWord(tokens[1]!) && !isPunctuationMark(tokens[2]!))
                || (tokens.length > 3 && isQuotationMark(tokens[1]!) && isWord(tokens[2]!) && !isPunctuationMark(tokens[3]!));
          // ignore sentences like "2.2.2. This is an item" (two sentences, first sentence only numbers)
          let ignoreSentence = false;
          if (n === 1 && isNumeric(sentences[0]!.getText())) {
            ignoreSentence = true;
          }
          if (n > 0 && isNumeric(sentences[n - 1]!.getText())) {
            ignoreSentence = true;
          }
          // paragraphs containing less than two sentences (e.g. headlines, listings) are excluded from rule
          if (n - lastPara > 1 && isFirstWord && !ignoreSentence) {
            let lastNWToken = tokens.length - 1;
            while (tokens[lastNWToken]!.isLinebreak()) {
              lastNWToken--;
            }
            if (StringEqualsIgnoreCase(tokens[tokens.length - 2]!.getToken(), ':') &&
                WordTokenizer.isUrl(tokens[tokens.length - 1]!.getToken())) {
              // e.g. "find it at: http://example.com" should not be an error
              lastPara = n;
              pos += sentence.getText().length;
              continue;
            }
            const lastToken = tokens[lastNWToken]!.getToken();
            if (lastToken.length > MAX_URL_LENGTH && lastToken.toLowerCase().startsWith('http') || lastToken.toLowerCase().startsWith('ftp')) {
              continue;
            }
            if (isWord(tokens[lastNWToken]!)
                || (isQuotationMark(tokens[lastNWToken]!) && isWord(tokens[lastNWToken - 1]!))) {
              const fromPos = pos + tokens[lastNWToken]!.getStartPos();
              const toPos = pos + tokens[lastNWToken]!.getEndPos();
              const ruleMatch = new RuleMatch(this, sentence, fromPos, toPos,
                  this.messages!.getString('punctuation_mark_paragraph_end_msg'));
              const replacements: string[] = [];
              for (const mark of PUNCTUATION_MARKS) {
                replacements.push(tokens[lastNWToken]!.getToken() + mark);
              }
              ruleMatch.setSuggestedReplacements(replacements);
              ruleMatches.push(ruleMatch);
            }
          }
        }
        lastPara = n;
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return 0;
  }

}
