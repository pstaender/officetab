// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/hunspell/Hunspell.java reduced
// There is no file system: dictionaries come from the data broker as bytes (the Factory takes the
// contents instead of InputStreams), so the file:// branch of forDictionaryInResources, the
// temporary files (createTempFilesFromStreams) and getDictionary(Path, Path) / createFromLocalFiles
// (dictionaries outside the class path) are left out. As in Java, dictionaries from resources are
// created directly, so the factory (used by getDictionary only) is kept but unused. The cache is
// keyed by the resource paths. Await DumontsHunspellDictionary.init() before the first dictionary
// is created. Loggers dropped.
import { JLanguageTool } from '../../../JLanguageTool.ts';
import { DumontsHunspellDictionary } from './DumontsHunspellDictionary.ts';
import type { HunspellDictionary } from './HunspellDictionary.ts';

/**
 * Cache for {@link HunspellDictionary Hunspell dictionaries} loaded from resources
 */
const resourceCache = new Map<string, HunspellDictionary>();

export interface Factory {
  /**
   * Create a {@link HunspellDictionary} from the contents of the dictionary (.dic) and affix (.aff) files.
   */
  createFromStreams(languageCode: string, dictionary: Uint8Array, affix: Uint8Array): HunspellDictionary;
}

function viaTempFiles(): Factory {
  return {
    createFromStreams(_language: string, dictionaryStream: Uint8Array, affixStream: Uint8Array): HunspellDictionary {
      return new DumontsHunspellDictionary(dictionaryStream, affixStream, true);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let hunspellDictionaryStreamFactory: Factory = viaTempFiles();

export class Hunspell {

  private constructor() {}

  /**
   * Set a custom way to create {@link HunspellDictionary Hunspell dictionaries},
   * e.g., more efficient or portable than the default, possibly via Apache Lucene.
   * The default one is to use a native wrapper over the real Hunspell binary.
   */
  static setHunspellStreamFactory(factory: Factory): void {
    hunspellDictionaryStreamFactory = factory;
  }

  /**
   * Get a {@link HunspellDictionary} from classpath resources.
   * The dictionary is cached by resource path and reused for subsequent requests.
   * Overloads: (language), (language, resourcePath), (language, dicPath, affPath).
   *
   * @param language Language code (for error messages)
   * @param dicPath Classpath resource path to dictionary file (.dic)
   * @param affPath Classpath resource path to affix file (.aff)
   * @return {@link HunspellDictionary} that is either cached or newly created
   */
  static forDictionaryInResources(language: string, resourcePath = '', affPath?: string): HunspellDictionary {
    if (affPath === undefined) {
      return Hunspell.forDictionaryInResources(language, resourcePath + language + '.dic', resourcePath + language + '.aff');
    }
    const dicPath = resourcePath;
    // Check cache first using resource paths as key
    const key = dicPath + '\u0000' + affPath;
    const cached = resourceCache.get(key);
    if (cached != null && !cached.isClosed()) {
      return cached;
    }

    const broker = JLanguageTool.getDataBroker();

    const dictionaryStream = broker.resourceExists(dicPath) ? broker.getFromResourceDirAsStream(dicPath) : null;
    const affixStream = broker.resourceExists(affPath) ? broker.getFromResourceDirAsStream(affPath) : null;
    if (dictionaryStream == null || affixStream == null) {
      throw new Error('RuntimeException: Could not find the dictionary for language "' + language + '" in the classpath');
    }

    const dict = new DumontsHunspellDictionary(dictionaryStream, affixStream, false);

    // Cache by resource path for future lookups (fixes #11380)
    resourceCache.set(key, dict);

    return dict;
  }
}
