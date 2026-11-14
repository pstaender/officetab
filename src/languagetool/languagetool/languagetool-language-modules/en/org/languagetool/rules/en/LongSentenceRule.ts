// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/LongSentenceRule.java faithful
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { LongSentenceRule as org_languagetool_rules_LongSentenceRule } from '../../../../../../languagetool-core/org/languagetool/rules/LongSentenceRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

export class LongSentenceRule extends org_languagetool_rules_LongSentenceRule {

  constructor(messages: ResourceBundle, userConfig: UserConfig | null, defaultWords: number) {
    super(messages, userConfig, defaultWords);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/splitting-long-sentences/'));
  }

  getShortMessage(): string {
    return 'Long sentence';
  }

}
