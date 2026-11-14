// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishWrongWordInContextRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WrongWordInContextRule } from '../../../../../../languagetool-core/org/languagetool/rules/WrongWordInContextRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

export class EnglishWrongWordInContextRule extends WrongWordInContextRule {

  constructor(messages: ResourceBundle | null, lang: Language) {
    super(messages, lang);
    this.addExamplePair(Example.wrong('I have <marker>proscribed</marker> you a course of antibiotics.'),
                   Example.fixed('I have <marker>prescribed</marker> you a course of antibiotics.'));
  }

  protected override getCategoryString(): string {
    return 'Commonly Confused Words';
  }

  override getId(): string {
    return 'ENGLISH_WRONG_WORD_IN_CONTEXT';
  }

  override getDescription(): string {
    return 'commonly confused words: $match';
  }

  protected override getFilename(): string {
    return '/en/wrongWordInContext.txt';
  }

  protected override getMessageString(): string {
    return "Possibly confused word: Did you mean <suggestion>$SUGGESTION</suggestion> instead of '$WRONGWORD'?";
  }

  protected override getShortMessageString(): string {
    return 'Possibly confused word';
  }

  protected override getLongMessageString(): string {
    return "Possibly confused word: Did you mean <suggestion>$SUGGESTION</suggestion> (= $EXPLANATION_SUGGESTION) instead of '$WRONGWORD' (= $EXPLANATION_WRONGWORD)?";
  }
}
