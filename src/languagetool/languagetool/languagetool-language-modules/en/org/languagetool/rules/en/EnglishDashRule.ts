// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishDashRule.java faithful
import { AbstractDashRule, type AhoCorasickDoubleArrayTrie } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractDashRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let trie: AhoCorasickDoubleArrayTrie<string> | null = null;

/**
 * Check for compounds written with dashes instead of hyphens.
 * @since 3.8
 */
export class EnglishDashRule extends AbstractDashRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    this.addExamplePair(Example.wrong("I'll buy a new <marker>T—shirt</marker>."),
                   Example.fixed("I'll buy a new <marker>T-shirt</marker>."));
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/hyphen/'));
  }

  override getId(): string {
    return 'EN_DASH_RULE';
  }

  override getDescription(): string {
    return "Checks if hyphenated words were spelled with dashes (e.g., 'T — shirt' instead 'T-shirt').";
  }

  override getMessage(): string {
    return 'A dash was used instead of a hyphen.';
  }

  protected override getCompoundsData(): AhoCorasickDoubleArrayTrie<string> {
    let data = trie;
    if (data == null) {
      trie = data = AbstractDashRule.loadCompoundFile('/en/compounds.txt');
    }
    return data;
  }

}
