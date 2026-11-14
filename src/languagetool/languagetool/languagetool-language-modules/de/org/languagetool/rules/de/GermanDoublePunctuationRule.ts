// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanDoublePunctuationRule.java faithful
import { DoublePunctuationRule } from '../../../../../../languagetool-core/org/languagetool/rules/DoublePunctuationRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Double punctuation rule with German-specific error message.
 */
export class GermanDoublePunctuationRule extends DoublePunctuationRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    this.setUrl(Tools.getUrl('https://dict.leo.org/grammatik/deutsch/Rechtschreibung/Amtlich/Interpunktion/pgf101-105.html#grammarpgf103'));
    this.addExamplePair(Example.wrong('Sein Vater ist Regierungsrat <marker>a. D..</marker>'),
                   Example.fixed('Sein Vater ist Regierungsrat <marker>a. D.</marker>'));
  }

  override getId(): string {
    return 'DE_DOUBLE_PUNCTUATION';
  }

  protected override getDotMessage(): string {
    return 'Zwei aufeinander folgende Punkte. Auch wenn ein Satz mit einer Abkürzung endet, ' +
            'endet er nur mit einem Punkt (§103 Regelwerk).';
  }

}
