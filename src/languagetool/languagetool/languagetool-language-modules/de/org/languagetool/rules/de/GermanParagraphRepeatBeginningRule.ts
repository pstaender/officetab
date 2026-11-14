// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanParagraphRepeatBeginningRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { ParagraphRepeatBeginningRule } from '../../../../../../languagetool-core/org/languagetool/rules/ParagraphRepeatBeginningRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Check if to paragraphs begin with the same word.
 * If the first word is an article it checks if the first two words are identical
 * 
 * @author Fred Kruse
 * @since 4.1
 */
export class GermanParagraphRepeatBeginningRule extends ParagraphRepeatBeginningRule {

  constructor(messages: ResourceBundle, lang: Language) {
    super(messages, lang);
  }

  override getId(): string {
    return 'GERMAN_PARAGRAPH_REPEAT_BEGINNING_RULE';
  }

  override isArticle(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith('ART');
  }
}
