// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/EmbeddedGermanDictionary.java faithful
// The class path is LanguageTool's data broker (as Tools.getStream reads it): DICT must be loaded
// into JLanguageTool.getDataBroker() first. wordsGerman.txt is not in jwordsplitter's repository
// (build.sh generates it); it comes from the jwordsplitter 4.7 JAR on Maven Central.
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';
import { BufferedReader_readLines } from '../../../../jdk/java/io/BufferedReader.ts';
import { JLanguageTool } from '../../../../languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';

/**
 * A singleton that returns always the same words of the embedded dictionary.
 * @since 4.1
 */
export class EmbeddedGermanDictionary {

  static readonly DICT = "/de/danielnaber/jwordsplitter/wordsGerman.txt";   // dict inside the JAR

  private static words: Set<string> | null = null;

  private constructor() {
  }

  static getWords(): Set<string> {
    if (EmbeddedGermanDictionary.words == null) {
      const words = new Set<string>();
      //long t = System.currentTimeMillis();
      const is = JLanguageTool.getDataBroker().getAsStream(EmbeddedGermanDictionary.DICT);
      if (is == null) {
        throw new Error("RuntimeException: Could not load " + EmbeddedGermanDictionary.DICT);
      }
      for (const line of BufferedReader_readLines(is)) {
        if (!line.startsWith("#")) {
          words.add(StringTrim(line).toLowerCase());
        }
      }
      //long t2 = System.currentTimeMillis();
      //System.out.println("Loading time: " + (t2-t) + "ms");
      EmbeddedGermanDictionary.words = words;
    }
    return EmbeddedGermanDictionary.words;
  }

}
