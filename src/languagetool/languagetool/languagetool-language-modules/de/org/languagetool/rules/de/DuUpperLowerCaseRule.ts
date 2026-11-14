// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/DuUpperLowerCaseRule.java faithful
// StringUtils.equalsAny and isAllUpperCase are local.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/** StringUtils.isAllUpperCase */
function isAllUpperCase(cs: string): boolean {
  if (cs.length === 0) return false;
  for (let i = 0; i < cs.length; i++) {
    if (!Character.isUpperCase(cs.charAt(i))) return false;
  }
  return true;
}

const lowerWords = new Set<string>(
          ['du', 'dir', 'dich', 'dein', 'deine', 'deines', 'deins', 'deiner', 'deinen', 'deinem',
                        'euch', 'euer', 'eure', 'euere', 'euren', 'eueren', 'euern', 'eurer', 'euerer',
                        'eurem', 'euerem', 'eures', 'eueres']
  );

/**
 * Coherent use of Du/du, Dich/dich etc. Assume that the first use has 'correct'
 * capitalization and suggest the same capitalization for subsequent uses. 
 * 
 * @author Daniel Naber
 * @since 4.1
 */
export class DuUpperLowerCaseRule extends TextLevelRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    super.setCategory(Categories.CASING.getCategory(messages));
    this.addExamplePair(Example.wrong('Wie geht es Dir? Bist <marker>du</marker> wieder gesund?'),
                   Example.fixed('Wie geht es Dir? Bist <marker>Du</marker> wieder gesund?'));
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/de/beitrag/duzen-grossgeschrieben/'));
  }

  override getId(): string {
    return 'DE_DU_UPPER_LOWER';
  }

  override getDescription(): string {
    return 'Einheitliche Verwendung von Du/du, Dir/dir etc.';
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    let firstUse: string | null = null;
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (let i = 0; i < tokens.length; i++) {
        // (Java's "\\u2063" etc. are six-char strings with a backslash, kept as they are)
        if (i > 0 && (tokens[i-1]!.isSentenceStart() || ['"','„', '‚', ':', '»', '«', '“', '-', '–', '*', '•', '\\u2063', '\\u25E6', '\\u00B7'].includes(tokens[i-1]!.getToken()))) {
          continue;
        }
        const token = tokens[i]!;
        const word = token.getToken();
        const lcWord = word.toLowerCase();
        if (lowerWords.has(lcWord)) {
          if (firstUse == null) {
            firstUse = word;
          } else {
            const firstUseIsUpper = StringTools.startsWithUppercase(firstUse);
            let msg: string | null = null;
            let replacement: string | null = null;
            if (firstUseIsUpper && !StringTools.startsWithUppercase(word)) {
              replacement =  StringTools.uppercaseFirstChar(word);
              msg = "Vorher wurde bereits '" + firstUse + "' großgeschrieben. " +
                      "Aus Gründen der Einheitlichkeit '" + replacement + "' hier auch großschreiben?";
            } else if (!firstUseIsUpper && StringTools.startsWithUppercase(word) && !isAllUpperCase(word)) {
              replacement = StringTools.lowercaseFirstChar(word);
              msg = "Vorher wurde bereits '" + firstUse + "' kleingeschrieben. " +
                      "Aus Gründen der Einheitlichkeit '" + replacement + "' hier auch kleinschreiben?";
            }
            if (msg != null) {
              const ruleMatch = new RuleMatch(this, sentence, pos + token.getStartPos(), pos + token.getEndPos(), msg);
              ruleMatch.setSuggestedReplacement(replacement!);
              ruleMatches.push(ruleMatch);
            }
          }
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return -1;
  }
}
