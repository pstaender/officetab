// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/CaseRuleExceptions.java faithful
// The static exceptions are loaded on first use (Java loads them when the class is initialised,
// i.e. on its first use as well). StringUtils.split(phrase, ' ') is a local function.
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { StringMatcher } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/StringMatcher.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';

/** StringUtils.split(str, separatorChar): the parts between the separators, without empty ones. */
function StringUtils_split(str: string, separatorChar: string): string[] {
  return str.split(separatorChar).filter((s) => s.length > 0);
}

/**
 * @since 3.0
 */
export class CaseRuleExceptions {

  private static _exceptions: Set<string> | null = null;
  private static get exceptions(): Set<string> {
    return (CaseRuleExceptions._exceptions ??= CaseRuleExceptions.loadExceptions(
      "/de/eigennamen_gross.txt",  // Premium
      "/de/case_rule_exceptions.txt"
    ));
  }

  private constructor() {
  }

  static getExceptions(): Set<string> {
    return CaseRuleExceptions.exceptions;
  }

  static getExceptionPatterns(): Set<StringMatcher[]> {
    const exceptionPatterns = new Set<StringMatcher[]>();
    for (const phrase of CaseRuleExceptions.exceptions) {
      const parts = StringUtils_split(phrase, ' ');
      const patterns: StringMatcher[] = new Array(parts.length);
      for (let j = 0; j < parts.length; j++) {
        patterns[j] = StringMatcher.regexp(parts[j]!);
      }
      exceptionPatterns.add(patterns);
    }
    return exceptionPatterns;
  }

  private static loadExceptions(...paths: string[]): Set<string> {
    const result = new Set<string>();
    for (const path of paths) {
      const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(path);
      for (const line of lines) {
        if (line.length === 0 || line.startsWith("#")) {
          continue;
        }
        if (Character.isWhitespace(line.charAt(0)) || Character.isWhitespace(line.charAt(line.length-1))) {
          throw new Error("IllegalArgumentException: Invalid line in " + path + ", starts or ends with whitespace: '" + line + "'");
        }
        result.add(line);
      }
    }
    return result;
  }

}
