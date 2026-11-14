// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/rules/XmlRuleDisambiguator.java faithful
// The two constructors are one with useGlobalDisambiguation defaulting to false; the two
// disambiguate methods are one with an optional checkCanceled. The rule files are read from
// JLanguageTool.getDataBroker(), which must have them loaded.
import type { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import { type CheckCancelledCallback, JLanguageTool } from '../../../JLanguageTool.ts';
import type { Language } from '../../../Language.ts';
import { RuleSet } from '../../../rules/patterns/RuleSet.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import { AbstractDisambiguator } from '../AbstractDisambiguator.ts';
import type { DisambiguationPatternRule } from './DisambiguationPatternRule.ts';
import { DisambiguationRuleLoader } from './DisambiguationRuleLoader.ts';

const DISAMBIGUATION_FILE = 'disambiguation.xml';
const GLOBAL_DISAMBIGUATION_FILE = 'disambiguation-global.xml';

/**
 * Rule-based disambiguator. Implements an idea by Agnes Souque.
 *
 * @author Marcin Miłkowski
 */
export class XmlRuleDisambiguator extends AbstractDisambiguator {

  private readonly disambiguationRules: RuleSet;

  constructor(language: Language, useGlobalDisambiguation = false) {
    super();
    Objects_requireNonNull(language);
    const disambiguationFile = language.getShortCode() + '/' + DISAMBIGUATION_FILE;
    let disambiguationRulesList: DisambiguationPatternRule[];
    try {
      disambiguationRulesList = this.loadPatternRules(disambiguationFile, language);
    } catch (e) {
      throw new Error('RuntimeException: Problems with loading disambiguation file: ' + disambiguationFile, { cause: e });
    }
    if (useGlobalDisambiguation) {
      // disambiguation-global.xml
      try {
        disambiguationRulesList.push(...this.loadPatternRules(GLOBAL_DISAMBIGUATION_FILE, language));
      } catch (e) {
        throw new Error('RuntimeException: Problems with loading global disambiguation file: ' + GLOBAL_DISAMBIGUATION_FILE, { cause: e });
      }
    }
    this.disambiguationRules = RuleSet.textHinted(disambiguationRulesList);
  }

  override disambiguate(sentence: AnalyzedSentence,
      checkCanceled: CheckCancelledCallback | null = null): AnalyzedSentence {
    for (const rule of this.disambiguationRules.rulesForSentence(sentence)) {
      if (checkCanceled != null && checkCanceled.checkCancelled()) {
        break;
      }
      sentence = (rule as DisambiguationPatternRule).replace(sentence);
    }
    return sentence;
  }

  /**
   * Load disambiguation rules from an XML file. Use {@link JLanguageTool#addRule}
   * to add these rules to the checking process.
   *
   * @return a List of {@link DisambiguationPatternRule} objects
   */
  protected loadPatternRules(filename: string, language: Language): DisambiguationPatternRule[] {
    const ruleLoader = new DisambiguationRuleLoader();
    return ruleLoader.getRules(JLanguageTool.getDataBroker().getFromResourceDirAsStream(filename), language, filename);
  }

}
