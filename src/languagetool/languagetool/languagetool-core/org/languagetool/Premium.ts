// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/Premium.java reduced
// There is no premium version here: get() returns a PremiumOff and isPremiumVersion() is false,
// without looking up org.languagetool.PremiumOn through the class broker. The deprecated build
// information getters (LtBuildInfo) are left out.
import type { Rule } from './rules/Rule.ts';
import type { AnnotatedText } from './markup/AnnotatedText.ts';
import { PremiumOff } from './PremiumOff.ts';

/**
 * Information about premium-only rules.
 */
export abstract class Premium {

  private static readonly tempNotPremiumRules: string[] = [];

  static isTempNotPremium(rule: Rule): boolean {
    return Premium.tempNotPremiumRules.includes(rule.getId());
  }

  static isPremiumStatusCheck(text: AnnotatedText): boolean {
    const testRuleText = 'languagetool testrule 8634756';
    const testRuleText2 = 'The languagetool testrule 8634756.';
    return testRuleText2 === text.getOriginalText() || testRuleText === text.getOriginalText();
  }

  static get(): Premium {
    // 'PremiumOn' doesn't exist, thus this is the non-premium version
    return new PremiumOff();
  }

  static isPremiumVersion(): boolean {
    // doesn't exist, thus this is the non-premium version
    return false;
  }

  abstract isPremiumRule(rule: Rule): boolean;
}
