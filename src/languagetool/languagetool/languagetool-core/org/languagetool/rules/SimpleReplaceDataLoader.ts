// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SimpleReplaceDataLoader.java faithful
// The Scanner reading the stream line by line is a split of the decoded text.
import { JLanguageTool } from '../JLanguageTool.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Load replacement data from a UTF-8 file. One replacement per line,
 * word and its replacement(s) separated by an equals sign. Both the
 * word and the replacements can have more than one form if separated
 * by pipe symbols.
 * @since 3.0
 */
export class SimpleReplaceDataLoader {

  /**
   * Load replacement rules from a utf-8 file in the classpath.
   */
  loadWords(path: string): ReadonlyMap<string, string[]> {
    const stream = JLanguageTool.getDataBroker().getFromRulesDirAsStream(path);
    const map = new Map<string, string[]>();
    const lines = new TextDecoder('utf-8').decode(stream).split(/\r\n|[\n\r\u2028\u2029\u0085]/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      if (line.length === 0 || line.charAt(0) === '#') { // # = comment
        continue;
      }
      const parts = StringSplit(line, '=');
      if (parts.length !== 2) {
        throw new Error('RuntimeException: Could not load simple replacement data from: ' + path + '. ' +
                'Error in line \'' + line + '\', expected format \'word=replacement\'');
      }
      if (StringTrim(parts[1]!).length === 0) {
        throw new Error('RuntimeException: Could not load simple replacement data from: ' + path + '. ' +
          'Error in line \'' + line + '\', replacement cannot be empty');
      }
      const wrongForms = StringSplit(parts[0]!, '\\|');
      const replacements = StringSplit(parts[1]!, '\\|');
      for (const wrongForm of wrongForms) {
        map.set(wrongForm, replacements);
      }
    }
    return map;
  }

}
