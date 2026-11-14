// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/RuleMatchListener.java faithful
import type { RuleMatch } from './rules/RuleMatch.ts';

/**
 * @since 3.7
 */
export interface RuleMatchListener {

  /**
   * Called for every {@link RuleMatch} found. Useful to show (some) results
   * even when checking stops with a timeout.
   */
  matchFound(ruleMatch: RuleMatch): void;

}
