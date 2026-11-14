// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/morfologik/MorfologikSpeller.java partial
// Only the dictionary cache (getDictionaryWithCaching), which the taggers and synthesizers use; the
// speller itself is left out for now. The Guava cache (expiring after 10 minutes) is a Map. Java's
// Dictionary.read(URL) reads the metadata (.info) next to the .dict; here both come from the data
// broker. Dictionaries outside the class path (Paths.get) are not supported.
import { JLanguageTool } from '../../../JLanguageTool.ts';
import { Dictionary } from '../../../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryMetadata } from '../../../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryMetadata.ts';

// Speed up the server use case, where rules get initialized for every call.
// See https://github.com/morfologik/morfologik-stemming/issues/69 for confirmation that
// Dictionary is thread-safe:
const dictCache = new Map<string, Dictionary>();

function load(fileInClassPath: string): Dictionary {
  const dataBroker = JLanguageTool.getDataBroker();
  if (dataBroker.resourceExists(fileInClassPath)) {
    return Dictionary.read(dataBroker.getFromResourceDirAsStream(fileInClassPath),
      dataBroker.getFromResourceDirAsStream(DictionaryMetadata.getExpectedMetadataFileName(fileInClassPath)));
  } else {
    throw new Error('IOException: dictionary not in the class path: ' + fileInClassPath);
  }
}

/**
 * Morfologik-based spell checker.
 */
export class MorfologikSpeller {

  /**
   * Load a dictionary from the given path or reuse a cached instance, if present.
   * @param fileInClassPath path in classpath to morfologik dictionary
   */
  static getDictionaryWithCaching(fileInClassPath: string): Dictionary {
    let dictionary = dictCache.get(fileInClassPath);
    if (dictionary === undefined) {
      dictionary = load(fileInClassPath);
      dictCache.set(fileInClassPath, dictionary);
    }
    return dictionary;
  }

}
