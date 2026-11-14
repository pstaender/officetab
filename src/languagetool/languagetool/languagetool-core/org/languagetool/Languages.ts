// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/Languages.java reduced
// Java instantiates the classes listed in META-INF/org/languagetool/language-module.properties by
// reflection. Here language modules register their classes: Languages.register(className, ctor)
// (e.g. 'org.languagetool.language.AmericanEnglish'), which creates the instance as Java does
// when it loads the list. Left out: dynamic Morfologik/Hunspell languages (addLanguage), the
// premium classes, and the NoopLanguage (getLanguageForShortCode's noopLanguageCodes).
import type { Language } from './Language.ts';
import type { Locale } from '../../../../jdk/java/util/Locale.ts';
import { StringTools } from './tools/StringTools.ts';

const languages: Language[] = [];
const classNames = new Map<Function, string>();
const constructors = new Map<string, new () => Language>();

/**
 * Helper methods to list all supported languages and to get language objects
 * by their name or language code etc.
 */
export class Languages {

  private constructor() {
  }

  /**
   * Not in Java (which reads language-module.properties): registers a language class under its
   * Java class name and adds an instance of it to the known languages.
   */
  static register(className: string, ctor: new () => Language): Language {
    for (const element of languages) {
      if (classNames.get(element.constructor) === className) {
        return element;
      }
    }
    constructors.set(className, ctor);
    classNames.set(ctor, className);
    const language = new ctor();
    languages.push(language);
    return language;
  }

  /** The Java class name a language was registered with (getClass().getName()). */
  static getClassName(language: Language): string | null {
    return classNames.get(language.constructor) ?? null;
  }

  /**
   * Language classes are detected at runtime by searching the classpath for files named
   * {@code META-INF/org/languagetool/language-module.properties}. Those file(s)
   * need to contain a key {@code languageClasses} which specifies the fully qualified
   * class name(s), e.g. {@code org.languagetool.language.English}. Use commas to specify
   * more than one class.
   * @return an unmodifiable list of all supported languages
   */
  static get(): readonly Language[] {
    const result: Language[] = [];
    for (const lang of Languages.getStaticAndDynamicLanguages()) {
      if ('xx' !== lang.getShortCode() && 'zz' !== lang.getShortCode()) {  // skip demo and noop language
        result.push(lang);
      }
    }
    return result;
  }

  /**
   * Like {@link #get()} but the list contains also LanguageTool's internal 'Demo'
   * language, if available. Only useful for tests.
   * @return an unmodifiable list
   */
  static getWithDemoLanguage(): readonly Language[] {
    return Languages.getStaticAndDynamicLanguages();
  }

  private static getStaticAndDynamicLanguages(): readonly Language[] {
    return languages;
  }

  /**
   * Get the Language object for the given language class name or try to create it and add it to the known languages.
   * @param className e.g. 'org.languagetool.language.English'
   * @return a language object
   * @throws RuntimeException if language not found in classpath
   */
  static getOrAddLanguageByClassName(className: string): Language {
    for (const element of Languages.getStaticAndDynamicLanguages()) {
      if (className === classNames.get(element.constructor)) {
        return element;
      }
    }
    const ctor = constructors.get(className);
    if (ctor === undefined) {
      throw new Error("RuntimeException: Class '" + className + ' could not be found in classpath');
    }
    const language = new ctor();
    languages.push(language);
    return language;
  }

  /**
   * Get the Language object for the given language name.
   *
   * @param languageName e.g. <code>English</code> or <code>German</code> (case is significant)
   * @return a Language object or {@code null} if there is no such language
   */
  static getLanguageForName(languageName: string): Language | null {
    for (const element of Languages.getStaticAndDynamicLanguages()) {
      if (languageName === element.getName()) {
        return element;
      }
    }
    return null;
  }

  /**
   * Get the Language object for the given language code.
   * @param langCode e.g. <code>en</code> or <code>en-US</code>
   * @throws IllegalArgumentException if the language is not supported or if the language code is invalid
   * @since 3.6
   */
  static getLanguageForShortCode(langCode: string): Language {
    let language = Languages.getLanguageForShortCodeOrNull(langCode);
    if (language == null) {
      // e.g. 'fr-FR' requested (happens with LibreOffice 7.4):
      language = Languages.getLongCodeToLangMapping().get(langCode) ?? null;
    }
    if (language == null) {
      throw new Error("IllegalArgumentException: '" + langCode + "' is not a language code known to LanguageTool." +
              ' Supported language codes are: ' + Languages.getLangCodes().join(', ') + '. Languages are registered with Languages.register.');
    }
    return language;
  }

  private static getLangCodes(): string[] {
    const codes: string[] = [];
    for (const realLanguage of Languages.getStaticAndDynamicLanguages()) {
      codes.push(realLanguage.getShortCodeWithCountryAndVariant());
    }
    const longCodeToLang = Languages.getLongCodeToLangMapping();
    for (const key of longCodeToLang.keys()) {
      if (!codes.includes(key)) {
        codes.push(key);
      }
    }
    codes.sort();
    return codes;
  }

  /**
   * Return whether a language with the given language code is supported. Which languages
   * are supported depends on the classpath when the {@code Language} object is initialized.
   * @param langCode e.g. {@code en} or {@code en-US}
   * @return true if the language is supported
   * @throws IllegalArgumentException in some cases of an invalid language code format
   */
  static isLanguageSupported(langCode: string): boolean {
    return Languages.getLanguageForShortCodeOrNull(langCode) != null;
  }

  /**
   * Get the best match for a locale, using American English as the final fallback if nothing
   * else fits. The returned language will be a country variant language (e.g. British English, not just English)
   * if available.
   * Note: this does not consider languages added dynamically
   * @throws RuntimeException if no language was found and American English as a fallback is not available
   */
  static getLanguageForLocale(locale: Locale): Language {
    const language = Languages.getLanguageForLanguageNameAndCountry(locale);
    if (language != null) {
      return language;
    } else {
      const firstFallbackLanguage = Languages.getLanguageForLanguageNameOnly(locale);
      if (firstFallbackLanguage != null) {
        return firstFallbackLanguage;
      }
    }
    for (const aLanguage of languages) {
      if (aLanguage.getShortCodeWithCountryAndVariant() === 'en-US') {
        return aLanguage;
      }
    }
    throw new Error('RuntimeException: No appropriate language found, not even en-US. Supported languages: ' + Languages.get());
  }

  /**
   * @since 5.6
   */
  static getLongCodeToLangMapping(): Map<string, Language> {
    const map = new Map<string, Language>();
    const languages = Languages.get();
    for (const language of languages) {
      if (language.getCountries().length > 0 && language.getCountries()[0]!.length !== 0) {
        map.set(language.getShortCode() + '-' + language.getCountries()[0], language);
      }
    }
    return map;
  }

  private static getLanguageForShortCodeOrNull(langCode: string): Language | null {
    StringTools.assureSet(langCode, 'langCode');
    let result: Language | null = null;
    if (langCode.includes('-x-')) {
      // e.g. "de-DE-x-simple-language"
      for (const element of Languages.getStaticAndDynamicLanguages()) {
        if (element.getShortCode().toLowerCase() === langCode.toLowerCase()) {
          return element;
        }
      }
    } else if (langCode.includes('-')) {
      const parts = langCode.split('-');
      if (parts.length === 2) { // e.g. en-US
        for (const element of Languages.getStaticAndDynamicLanguages()) {
          if (parts[0]!.toLowerCase() === element.getShortCode().toLowerCase()
                  && element.getCountries().length === 1
                  && parts[1]!.toLowerCase() === element.getCountries()[0]!.toLowerCase()) {
            result = element;
            break;
          }
        }
      } else if (parts.length === 3) { // e.g. ca-ES-valencia
        for (const element of Languages.getStaticAndDynamicLanguages()) {
          if (parts[0]!.toLowerCase() === element.getShortCode().toLowerCase()
                  && element.getCountries().length === 1
                  && parts[1]!.toLowerCase() === element.getCountries()[0]!.toLowerCase()
                  && parts[2]!.toLowerCase() === element.getVariant()?.toLowerCase()) {
            result = element;
            break;
          }
        }
      } else {
        throw new Error("IllegalArgumentException: '" + langCode + "' isn't a valid language code");
      }
    } else {
      for (const element of Languages.getStaticAndDynamicLanguages()) {
        if (langCode === 'global') {
          // for disambiguation-global.xml take any language
          result = element;
          break;
        }
        if (langCode.toLowerCase() === element.getShortCode().toLowerCase()) {
          result = element;
            /* TODO: It should return the DefaultLanguageVariant,
             * not the first language found */
          break;
        }
      }
    }
    return result;
  }

  private static getLanguageForLanguageNameAndCountry(locale: Locale): Language | null {
    for (const language of Languages.getStaticAndDynamicLanguages()) {
      if (language.getShortCode() === locale.getLanguage()) {
        const countryVariants = language.getCountries();
        if (countryVariants.includes(locale.getCountry())) {
          return language;
        }
      }
    }
    return null;
  }

  private static getLanguageForLanguageNameOnly(locale: Locale): Language | null {
    // use default variant if available:
    for (const language of Languages.getStaticAndDynamicLanguages()) {
      if (language.getShortCode() === locale.getLanguage() && language.hasVariant()) {
        const defaultVariant = language.getDefaultLanguageVariant();
        if (defaultVariant != null) {
          return defaultVariant;
        }
      }
    }
    // use the first match otherwise (which should be the only match):
    for (const language of Languages.getStaticAndDynamicLanguages()) {
      if (language.getShortCode() === locale.getLanguage() && !language.hasVariant()) {
        return language;
      }
    }
    return null;
  }

}
