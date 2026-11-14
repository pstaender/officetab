// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/YMDDateHelper.java faithful
import { RuleMatch } from './RuleMatch.ts';
import { Integer_parseInt } from '../../../../../jdk/java/lang/Exceptions.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * @since 4.3
 */
export class YMDDateHelper {

  constructor() {
  }

  parseDate(args: Map<string, string>): Map<string, string> {
    const dateString = args.get('date');
    if (dateString == null) {
      throw new Error("IllegalArgumentException: Missing key 'date'");
    }
    const parts = StringSplit(dateString, '-');
    if (parts.length !== 3) {
      throw new Error("RuntimeException: Expected date in format 'yyyy-mm-dd': '" + dateString + "'");
    }
    args.set('year', parts[0]!);
    args.set('month', parts[1]!);
    args.set('day', parts[2]!);
    return args;
  }

  correctDate(match: RuleMatch, args: Map<string, string>): RuleMatch {
    const year = args.get('year');
    const month = args.get('month');
    const day = args.get('day');
    const correctYear = Integer_parseInt(year) + 1;
    const correctDate = correctYear + '-' + month + '-' + day;  // String.format("%d-%s-%s", ...)
    const message = match.getMessage()
            .replaceAll('{realDate}', correctDate);
    const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(), match.getFromPos(),
            match.getToPos(), message, match.getShortMessage());
    ruleMatch.setType(match.getType());
    return ruleMatch;
  }
}
