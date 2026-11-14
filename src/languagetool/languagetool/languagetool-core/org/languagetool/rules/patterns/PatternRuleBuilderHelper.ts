// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRuleBuilderHelper.java faithful
// The static methods are exported functions too, for Java's "import static ...PatternRuleBuilderHelper.*".
import type { PatternToken } from './PatternToken.ts';
import { PatternTokenBuilder } from './PatternTokenBuilder.ts';

/**
 * @since 4.8
 */
export class PatternRuleBuilderHelper {

  static tokenRegex(s: string): PatternToken {
    return new PatternTokenBuilder().tokenRegex(s).build();
  }

  static posRegex(s: string): PatternToken {
    return new PatternTokenBuilder().posRegex(s).build();
  }

  static csToken(s: string): PatternToken {
    return new PatternTokenBuilder().csToken(s).build();
  }

  static pos(s: string): PatternToken {
    return new PatternTokenBuilder().pos(s).build();
  }

  static token(s: string): PatternToken {
    return new PatternTokenBuilder().token(s).build();
  }

  static regex(regex: string): PatternToken {
    return new PatternTokenBuilder().tokenRegex(regex).build();
  }

  static csRegex(regex: string): PatternToken {
    return new PatternTokenBuilder().csTokenRegex(regex).build();
  }
}

export const { tokenRegex, posRegex, csToken, pos, token, regex, csRegex } = PatternRuleBuilderHelper;
