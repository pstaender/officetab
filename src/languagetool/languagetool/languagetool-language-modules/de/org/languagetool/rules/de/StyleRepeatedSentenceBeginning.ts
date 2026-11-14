// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/StyleRepeatedSentenceBeginning.java faithful
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { Category, Location } from '../../../../../../languagetool-core/org/languagetool/rules/Category.ts';
import { CategoryId } from '../../../../../../languagetool-core/org/languagetool/rules/CategoryId.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const MIN_REPEATED = 3;

/**
 * A rule checks sentences beginning repeatedly with a subject.
 * This rule detects no grammar error but a stylistic problem (default off)
 * @author Fred Kruse
 * @since 5.2
 */
export class StyleRepeatedSentenceBeginning extends TextLevelRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    super.setCategory(new Category(new CategoryId('CREATIVE_WRITING'),
        messages.getString('category_creative_writing'), Location.INTERNAL, false));
    this.setDefaultOff();
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.addExamplePair(Example.wrong('<marker>Das Auto</marker> kam näher. <marker>Der Hund</marker> lief langsam über die Straße. <marker>Die Reifen</marker> quietschten.'),
                   Example.fixed('Das Auto kam näher. Langsam lief der Hund über die Straße. Die Reifen quietschten.'));
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    if (sentences.length < MIN_REPEATED) {
      return this.toRuleMatchArray(ruleMatches);
    }
    const startPos: number[] = [];
    const endPos: number[] = [];
    const repeatedSentences: AnalyzedSentence[] = [];
    let pos = 0;
    let nRepeated = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      if (tokens[1]!.hasPosTagStartingWith('ART:DEF:NOM') || tokens[1]!.hasPosTagStartingWith('ART:IND:NOM')) {
        let noSub = true;
        for (let i = 2; i < tokens.length && !tokens[i]!.hasPosTagStartingWith('VER'); i++) {
          if (tokens[i]!.hasPosTagStartingWith('SUB')) {
            noSub = false;
            endPos.push(tokens[i]!.getEndPos() + pos);
            break;
          }
        }
        if (noSub) {
          endPos.push(tokens[1]!.getEndPos() + pos);
        }
        repeatedSentences.push(sentence);
        startPos.push(tokens[1]!.getStartPos() + pos);
        nRepeated++;
      } else if (tokens[1]!.hasPosTagStartingWith('PRO:PER:NOM')) {
        repeatedSentences.push(sentence);
        startPos.push(tokens[1]!.getStartPos() + pos);
        endPos.push(tokens[1]!.getEndPos() + pos);
        nRepeated++;
      } else {
        if (nRepeated >= MIN_REPEATED) {
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
    }
    if (nRepeated >= MIN_REPEATED) {
      for (let i = 0; i < repeatedSentences.length; i++) {
        const ruleMatch = new RuleMatch(this, repeatedSentences[i]!, startPos[i]!, endPos[i]!, this.getDescription());
        ruleMatches.push(ruleMatch);
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return MIN_REPEATED;
  }

  override getId(): string {
    return 'STYLE_REPEATED_SENTENCE_BEGINNING';
  }

  override getDescription(): string {
    return 'Subjekt als wiederholter Satzanfang';
  }

}
