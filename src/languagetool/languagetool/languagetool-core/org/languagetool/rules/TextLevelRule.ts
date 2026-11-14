// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/TextLevelRule.java faithful
// The three match overloads are one method: match(sentences, annotatedText?) is what subclasses
// implement (either upstream form: match(List) or match(List, AnnotatedText)); called with a
// single sentence, it throws as Java's final match(AnalyzedSentence) does. The constructors are one.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnnotatedText } from '../markup/AnnotatedText.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Rule } from './Rule.ts';
import type { RuleMatch } from './RuleMatch.ts';

/**
 * A rule that considers the complete text, not just one sentence after
 * the other. Useful for rules that check coherency over sentence boundaries etc.
 * @since 2.7
 */
export abstract class TextLevelRule extends Rule {

  /**
   * @since 3.9 (with annotatedText)
   * Called with one AnalyzedSentence, Java throws "Not implemented for a text-level rule".
   */
  abstract override match(sentences: AnalyzedSentence[] | AnalyzedSentence, annotatedText?: AnnotatedText | null): RuleMatch[];

  /**
   * Called by rules that require a translation of their messages.
   * @since 3.7 (without messages)
   */
  constructor(messages: ResourceBundle | null = null) {
    super(messages);
  }

  override estimateContextForSureMatch(): number {
    return -1;
  }

  /**
   * Gives back the minimum number of paragraphs to check to give back a correct result.
   * Only used by LO office extension.
   * <ul>
   * <li>n == -1  --&gt; need to check full text (use only if really needed / bad performance)
   *              examples: AbstractWordCoherencyRule, GenericUnpairedBracketsRule, ...
   * <li>n == 0   --&gt; need only to check the current paragraph
   *              examples: MultipleWhitespaceRule, LongParagraphRule, ...
   * <li>n &gt;= 1   --&gt; need only to check n paragraphs around the current paragraph
   *              examples: ParagraphRepeatBeginningRule (n == 1), WordRepeatBeginningRule (n == 2), ...
   * </ul>
   */
  abstract minToCheckParagraph(): number;

}
