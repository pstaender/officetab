// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/WordCoherencyDataLoader.java faithful
// The fastutil map and sets are a Map and Sets.
import { JLanguageTool } from '../JLanguageTool.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Loads word variations words from a UTF-8 file. One entry per line,
 * word variations separated by a semicolon.
 * @since 3.0
 */
export class WordCoherencyDataLoader {

  loadWords(path: string): ReadonlyMap<string, Set<string>> {
    const stream = JLanguageTool.getDataBroker().getFromRulesDirAsStream(path);
    const map = new Map<string, Set<string>>();
    try {
      const lines = new TextDecoder('utf-8').decode(stream).split(/\r\n|\r|\n/);
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      for (const line of lines) {
        if (line.length === 0 || line.charAt(0) === '#') {   // ignore comments
          continue;
        }
        const parts = StringSplit(line, ';');
        if (parts.length !== 2) {
          throw new Error('IOException: Format error in file ' + path + ', line: ' + line);
        }
        if (map.has(parts[0]!)) {
          map.get(parts[0]!)!.add(parts[1]!);
        } else {
          map.set(parts[0]!, new Set([parts[1]!]));
        }
        if (map.has(parts[1]!)) {
          map.get(parts[1]!)!.add(parts[0]!);
        } else {
          map.set(parts[1]!, new Set([parts[0]!]));
        }
      }
    } catch (e) {
      throw new Error('RuntimeException: Could not load coherency data from ' + path, { cause: e });
    }
    return map;
  }

}
