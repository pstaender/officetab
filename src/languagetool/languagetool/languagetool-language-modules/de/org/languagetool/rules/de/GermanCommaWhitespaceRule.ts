// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanCommaWhitespaceRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { CommaWhitespaceRule } from '../../../../../../languagetool-core/org/languagetool/rules/CommaWhitespaceRule.ts';
import type { CorrectExample } from '../../../../../../languagetool-core/org/languagetool/rules/CorrectExample.ts';
import type { IncorrectExample } from '../../../../../../languagetool-core/org/languagetool/rules/IncorrectExample.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const DOMAINS = Pattern.compile('[a-z]{2,10}-Domains?');

export class GermanCommaWhitespaceRule extends CommaWhitespaceRule {

  constructor(messages: ResourceBundle, incorrectExample: IncorrectExample, correctExample: CorrectExample, url: string | null) {
    super(messages, incorrectExample, correctExample, url);
  }

  protected override isException(tokens: AnalyzedTokenReadings[], tokenIdx: number): boolean {
    if (tokenIdx + 2 < tokens.length &&
        tokens[tokenIdx]!.getToken() === '.' &&
        DOMAINS.matcher(tokens[tokenIdx + 1]!.getToken()).matches()) {
      return true;
    }
    return false;
  }
}
