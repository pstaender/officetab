// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/ShortDescriptionProvider.java faithful
// The descriptions are cached by the language's getShortCodeWithCountryAndVariant (Language.equals).
import type { Language } from './Language.ts';
import { JLanguageTool } from './JLanguageTool.ts';
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';

/**
 * Provide short (up to ~ 40 characters) descriptions for words.
 * Used to display as an additional hint when there are several suggestions.
 * @since 4.5
 */
export class ShortDescriptionProvider {
  private static readonly descriptions = new Map<string, Map<string, string>>();

  getShortDescription(word: string, lang: Language): string | null {
    return ShortDescriptionProvider.getAllDescriptions(lang).get(word) ?? null;
  }

  static getAllDescriptions(lang: Language): Map<string, string> {
    const key = lang.getShortCodeWithCountryAndVariant();
    let result = ShortDescriptionProvider.descriptions.get(key);
    if (result === undefined) {
      result = ShortDescriptionProvider.init(lang);
      ShortDescriptionProvider.descriptions.set(key, result);
    }
    return result;
  }

  private static init(lang: Language): Map<string, string> {
    const dataBroker = JLanguageTool.getDataBroker();
    const path = '/' + lang.getShortCode() + '/word_definitions.txt';
    if (!dataBroker.resourceExists(path)) {
      return new Map();
    }
    const wordToDef = new Map<string, string>();
    const lines = dataBroker.getFromResourceDirAsLines(path);
    for (const line of lines) {
      if (line.startsWith('#') || StringTrim(line).length === 0) {
        continue;
      }
      const parts = line.split('\t');
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();  // String.split drops trailing empty strings
      if (parts.length !== 2) {
        throw new Error("RuntimeException: Format in " + path + " not expected, expected 2 tab-separated columns: '" + line + "'");
      }
      wordToDef.set(parts[0]!, parts[1]!);
    }
    return wordToDef;
  }

}
