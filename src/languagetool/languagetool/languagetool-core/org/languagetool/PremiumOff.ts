// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/PremiumOff.java faithful
// Implements Premium's type instead of extending it: Premium.get() creates a PremiumOff, and a
// subclass cannot be evaluated while its base class module is still loading (import cycle).
import type { Premium } from './Premium.ts';
import type { Rule } from './rules/Rule.ts';

/**
 * Information about premium-only rules.
 */
export class PremiumOff implements Premium {

  isPremiumRule(_rule: Rule): boolean {
    return false;
  }

}
