// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/StyleRepeatedVeryShortSentences.java faithful
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { Category, Location } from '../../../../../../languagetool-core/org/languagetool/rules/Category.ts';
import { CategoryId } from '../../../../../../languagetool-core/org/languagetool/rules/CategoryId.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { RuleOption } from '../../../../../../languagetool-core/org/languagetool/rules/RuleOption.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const MIN_REPEATED = 3;
const MIN_WORDS = 4;
const EXCLUDE_DIRECT_SPEECH = true;

const OPENING_QUOTES = Pattern.compile('["“„»«]');
const ENDING_QUOTES = Pattern.compile('["“”»«]');

/**
 * A rule checks the use of very short sentences repeatedly.
 * This rule detects no grammar error but a stylistic problem (default off)
 * @author Fred Kruse
 * @since 5.2
 */
export class StyleRepeatedVeryShortSentences extends TextLevelRule {

  private readonly lang: Language;
  private minWords = MIN_WORDS;
  private minRepeated = MIN_REPEATED;
  private excludeDirectSpeech = EXCLUDE_DIRECT_SPEECH;

  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null) {
    super(messages);
    super.setCategory(new Category(new CategoryId('CREATIVE_WRITING'),
        messages.getString('category_creative_writing'), Location.INTERNAL, false));
    this.lang = lang;
    this.setDefaultOff();
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.addExamplePair(Example.wrong('Das Auto kam <marker>näher.</marker> Der Hund <marker>schlief.</marker> Die Reifen <marker>quietschten.</marker>'),
                   Example.fixed('Das Auto kam näher. Tief und fest schlief der Hund. Die Reifen quietschten.'));
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        if (cf.length > 0 && cf[0] != null && Number.isInteger(cf[0])) {
          this.minRepeated = cf[0] as number;
        }
        if (cf.length > 1 && cf[1] != null && Number.isInteger(cf[1])) {
          this.minWords = cf[1] as number;
        }
        if (cf.length > 2 && cf[2] != null && typeof cf[2] === 'boolean') {
          this.excludeDirectSpeech = cf[2];
        }
      }
    }

  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    if (sentences.length < this.minRepeated) {
      return this.toRuleMatchArray(ruleMatches);
    }
    let pos = 0;
    let nRepeated = 0;
    const startPos: number[] = [];
    const endPos: number[] = [];
    const repeatedSentences: AnalyzedSentence[] = [];
    let tokens: AnalyzedTokenReadings[] | null = null;
    let n = -1;
    let nPara  = -1;
    let beginnsWithDirectSpeech = false;
    let endsWithDirectSpeech = false;
    for (const sentence of sentences) {
      n++;
      nPara++;
      tokens = sentence.getTokensWithoutWhitespace();
      if (this.excludeDirectSpeech) {
        if (endsWithDirectSpeech) {
          beginnsWithDirectSpeech = true;
        } else {
          beginnsWithDirectSpeech = false;
        }
        for (let i = 0; i < tokens.length; i++) {
          if (!beginnsWithDirectSpeech && OPENING_QUOTES.matcher(tokens[i]!.getToken()).matches()
              && i < tokens.length - 1 && !tokens[i + 1]!.isWhitespaceBefore()) {
            beginnsWithDirectSpeech = true;
            endsWithDirectSpeech = true;
          } else if (beginnsWithDirectSpeech && ENDING_QUOTES.matcher(tokens[i]!.getToken()).matches()
              && i > 1 && !tokens[i]!.isWhitespaceBefore()) {
            endsWithDirectSpeech = false;
          }
        }
      }
      const paragraphEnd = Tools.isParagraphEnd(sentences, n, this.lang);
      if (!beginnsWithDirectSpeech && (!paragraphEnd || nPara > 0) && tokens.length > 3 && tokens.length <= this.minWords + 2) {
            // 3 -> skip one word sentences
            // max tokens: minWords + SENT_START + punctuation mark
        repeatedSentences.push(sentence);
        startPos.push(tokens[tokens.length - 2]!.getStartPos() + pos);
        endPos.push(tokens[tokens.length - 1]!.getEndPos() + pos);
        nRepeated++;
      } else {
        if (nRepeated >= this.minRepeated) {
          for (let i = 0; i < repeatedSentences.length; i++) {
            const ruleMatch = new RuleMatch(this, repeatedSentences[i]!, startPos[i]!, endPos[i]!, this.getDescription());
            ruleMatches.push(ruleMatch);
          }
        }
        repeatedSentences.length = 0;
        startPos.length = 0;
        endPos.length = 0;
        nRepeated = 0;
      }
      pos += sentence.getCorrectedTextLength();
      if (paragraphEnd) {
        nPara = -1;
      }
    }
    if (nRepeated >= this.minRepeated) {
      for (let i = 0; i < repeatedSentences.length; i++) {
        const ruleMatch = new RuleMatch(this, repeatedSentences[i]!, startPos[i]!, endPos[i]!, this.getDescription());
        ruleMatches.push(ruleMatch);
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return this.minRepeated;
  }

  override getId(): string {
    return 'STYLE_REPEATED_SHORT_SENTENCES';
  }

  override getDescription(): string {
    return 'Stakkato-Sätze';
  }

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [
        new RuleOption(MIN_REPEATED, 'Anzahl von kurzen Sätzen hintereinander', 0, 10),
        new RuleOption(MIN_WORDS, 'Maximale Länge eines kurzen Satzes', 0, 10),
        new RuleOption(EXCLUDE_DIRECT_SPEECH, 'Direkte Rede und Zitate ausschließen')
    ];
    return ruleOptions;
  }

}
