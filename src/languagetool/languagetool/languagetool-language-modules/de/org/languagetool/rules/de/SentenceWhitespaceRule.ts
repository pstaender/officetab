// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SentenceWhitespaceRule.java faithful
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { SentenceWhitespaceRule as org_languagetool_rules_SentenceWhitespaceRule } from '../../../../../../languagetool-core/org/languagetool/rules/SentenceWhitespaceRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Checks that there's whitespace between sentences etc.
 *
 * @author Daniel Naber
 * @since 2.8
 */
export class SentenceWhitespaceRule extends org_languagetool_rules_SentenceWhitespaceRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    super.setCategory(Categories.MISC.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Whitespace);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/de/beitrag/grammatik-leerzeichen/#fehler-1-leerzeichen-vor-und-nach-satzzeichen'));
    this.addExamplePair(Example.wrong('Hier steht ein Satz.<marker>Das</marker> ist ein weiterer Satz.'),
                   Example.fixed('Hier steht ein Satz.<marker> Das</marker> ist ein weiterer Satz.'));
  }

  override getId(): string {
    return 'DE_SENTENCE_WHITESPACE';
  }

  override getDescription(): string {
    return 'Fehlendes Leerzeichen zwischen Sätzen oder nach Ordnungszahlen';
  }

  override getMessage(prevSentenceEndsWithNumber: boolean): string {
    if (prevSentenceEndsWithNumber) {
      return 'Fügen Sie nach Ordnungszahlen (1., 2. usw.) ein Leerzeichen ein.';
    } else {
      return 'Fügen Sie zwischen Sätzen ein Leerzeichen ein.';
    }
  }
}
