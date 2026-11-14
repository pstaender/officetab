// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/CachingWordListLoader.java faithful
// The Guava cache (expiring after 10 minutes) is a Map.
import { JLanguageTool } from '../../JLanguageTool.ts';
import { StringTrim } from '../../../../../../jdk/java/lang/Character.ts';

/** StringUtils.substringBefore */
function substringBefore(str: string, separator: string): string {
  const pos = str.indexOf(separator);
  return pos < 0 ? str : str.substring(0, pos);
}

// Speed up the server use case, where rules get initialized for every call.
const cache = new Map<string, readonly string[]>();

function load(fileInClassPath: string): readonly string[] {
  const result: string[] = [];
  if (!JLanguageTool.getDataBroker().resourceExists(fileInClassPath)) {
    return result;
  }
  const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(fileInClassPath);
  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    result.push(StringTrim(substringBefore(StringTrim(line), '#')));
  }
  return Object.freeze(result);
}

/**
 * Helper to load text files from classpath.
 * @since 3.3, public since 3.5
 */
export class CachingWordListLoader {

  loadWords(filePath: string): readonly string[] {
    let words = cache.get(filePath);
    if (words === undefined) {
      words = load(filePath);
      cache.set(filePath, words);
    }
    return words;
  }
}
