// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/AvsAnData.java faithful
// The word sets are loaded on first use (Java loads them when the class is loaded).
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';

let requiresA: ReadonlySet<string> | null = null;
let requiresAn: ReadonlySet<string> | null = null;

/**
 * Load words, normalized to lowercase unless starting with '*'.
 */
function loadWords(path: string): ReadonlySet<string> {
  const set = new Set<string>();
  const stream = JLanguageTool.getDataBroker().getFromRulesDirAsStream(path);
  const lines = new TextDecoder('utf-8').decode(stream).split(/\r\n|\r|\n/);
  for (const nextLine of lines) {
    const line = StringTrim(nextLine);
    if (line.length === 0 || line.charAt(0) == '#') {
      continue;
    }
    if (line.charAt(0) == '*') {
      set.add(line.substring(1));
    } else {
      set.add(line.toLowerCase());
    }
  }
  return set;
}

/**
 * Data for {@link AvsAnRule}.
 * Loads exceptions (e.g. "hour" as in "an hour") from external files.
 *
 * @author Daniel Naber
 * @since 3.0
 */
export const AvsAnData = {

  getWordsRequiringA(): ReadonlySet<string> {
    return (requiresA ??= loadWords('/en/det_a.txt'));
  },

  getWordsRequiringAn(): ReadonlySet<string> {
    return (requiresAn ??= loadWords('/en/det_an.txt'));
  },

};
