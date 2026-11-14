// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SwissCompoundRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { CompoundRuleData } from '../../../../../../languagetool-core/org/languagetool/rules/CompoundRuleData.ts';
import type { LineExpander } from '../../../../../../languagetool-core/org/languagetool/rules/LineExpander.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { GermanCompoundRule } from './GermanCompoundRule.ts';

let compoundData: CompoundRuleData | null = null;

/**
 * @since 4.9
 */
export class SwissCompoundRule extends GermanCompoundRule {
 
  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null) {
    super(messages, lang, userConfig);
  }

  override getId(): string {
    return 'DE_CH_COMPOUNDS';
  }

  override getCompoundRuleData(): CompoundRuleData {
    let data = compoundData;
    if (data == null) {
      compoundData = data = new CompoundRuleData(new SwissExpander(), '/de/compounds.txt', '/de/compound-cities.txt');
    }
    return data;
  }
}

export class SwissExpander implements LineExpander {
  expandLine(line: string): string[] {
    if (line.includes('ß')) {
      return [line, line.replaceAll('ß', 'ss')];  // accept both, assuming Swiss users sometimes deal with GermanyGerman text
    } else {
      return [line];
    }
  }
}
