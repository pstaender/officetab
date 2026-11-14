// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractWordCoherencyRule.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { StringTools } from '../tools/StringTools.ts';
import { StringEqualsIgnoreCase } from '../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { StringReplaceFirst } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

/**
 * A rule that matches words for which two different spellings are used
 * throughout the document.
 * 
 * <p>Note that this should not be used for language variations like
 * American English vs. British English or German "alte Rechtschreibung"
 * vs. "neue Rechtschreibung" -- that's the task of a spell checker.
 * 
 * @author Daniel Naber
 * @since 2.7
 */
export abstract class AbstractWordCoherencyRule extends TextLevelRule {

  /**
   * Maps words in both directions, e.g. "aufwendig -&gt; aufwändig" and "aufwändig -&gt; aufwendig".
   * @since 3.0
   */
  protected abstract getWordMap(): ReadonlyMap<string, ReadonlySet<string>>;

  /**
   * Get the message shown to the user if the rule matches.
   */
  protected abstract getMessage(word1: string, word2: string): string;

  protected getShortMessage(): string | null {
    return null;
  }

  constructor(messages: ResourceBundle) {
    super();
    super.setCategory(Categories.MISC.getCategory(messages));
  }

  override match(sentences: AnalyzedSentence[] | AnalyzedSentence): RuleMatch[] {
    if (!Array.isArray(sentences)) {
      throw new Error('UnsupportedOperationException: Not implemented for a text-level rule');
    }
    const ruleMatches: RuleMatch[] = [];
    const shouldNotAppearWord = new Map<string, string>();  // e.g. aufwändig -> aufwendig
    let pos = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (const tmpToken of tokens) {
        let token = tmpToken.getToken();
        const readings = tmpToken.getReadings();
        if (readings.length > 0) {
          const baseforms = new Set(readings.map((r) => r.getLemma()));
          for (const baseform of baseforms) {
            if (baseform != null) {
              token = baseform;
            }
            const fromPos = pos + tmpToken.getStartPos();
            const toPos = pos + tmpToken.getEndPos();
            if (shouldNotAppearWord.has(token)) {
              const otherSpelling = shouldNotAppearWord.get(token)!;
              const msg = this.getMessage(token, otherSpelling);
              const ruleMatch = new RuleMatch(this, sentence, fromPos, toPos, msg);
              const marked = sentence.getText().substring(tmpToken.getStartPos(), tmpToken.getEndPos());
              let replacement = this.createReplacement(marked, token, otherSpelling, tmpToken);
              if (StringTools.startsWithUppercase(tmpToken.getToken())) {
                replacement = StringTools.uppercaseFirstChar(replacement)!;
              }
              if (!StringEqualsIgnoreCase(marked, replacement)) {   // see https://github.com/languagetool-org/languagetool/issues/3493
                ruleMatch.setSuggestedReplacement(replacement);
                ruleMatches.push(ruleMatch);
              }
              ruleMatch.setShortMessage(this.getShortMessage());
              break;
            } else if (this.getWordMap().has(token)) {
              const shouldNotAppearSet = this.getWordMap().get(token)!;
              for (const shouldNotAppear of shouldNotAppearSet) {
                shouldNotAppearWord.set(shouldNotAppear, token);
              }
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

  protected createReplacement(marked: string, token: string, otherSpelling: string, _tmpToken: AnalyzedTokenReadings): string {
    return StringReplaceFirst(marked, '(?i)' + token, otherSpelling);
  }

}
