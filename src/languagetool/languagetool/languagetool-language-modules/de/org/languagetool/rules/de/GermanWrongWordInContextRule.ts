// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanWrongWordInContextRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WrongWordInContextRule } from '../../../../../../languagetool-core/org/languagetool/rules/WrongWordInContextRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

export class GermanWrongWordInContextRule extends WrongWordInContextRule {

  constructor(messages: ResourceBundle, lang: Language) {
    super(messages, lang);
    this.addExamplePair(Example.wrong('Die <marker>Miene</marker> vom Kugelschreiber ist leer.'),
                   Example.fixed('Die <marker>Mine</marker> vom Kugelschreiber ist leer.'));
  }

  protected override getCategoryString(): string {
    return 'Leicht zu verwechselnde Wörter';
  }

  override getId(): string {
    return 'GERMAN_WRONG_WORD_IN_CONTEXT';
  }

  override getDescription(): string {
    return 'Mögliche Wortverwechslungen: $match';
  }

  protected override getFilename(): string {
    return '/de/wrongWordInContext.txt';
  }

  protected override getMessageString(): string {
    return "Mögliche Wortverwechslung: Meinten Sie <suggestion>$SUGGESTION</suggestion> anstatt '$WRONGWORD'?";
  }

  protected override getShortMessageString(): string {
    return 'Mögliche Wortverwechslung';
  }

  protected override getLongMessageString(): string {
    return "Mögliche Wortverwechslung: Meinten Sie <suggestion>$SUGGESTION</suggestion> (= $EXPLANATION_SUGGESTION) anstatt '$WRONGWORD' (= $EXPLANATION_WRONGWORD)?";
  }
}
