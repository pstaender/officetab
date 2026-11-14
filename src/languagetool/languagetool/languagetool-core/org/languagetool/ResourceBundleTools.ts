// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/ResourceBundleTools.java faithful
// The two getMessageBundle overloads are one method with an optional language.
import type { Language } from './Language.ts';
import { JLanguageTool } from './JLanguageTool.ts';
import { ResourceBundleWithFallback } from './ResourceBundleWithFallback.ts';
import { Locale } from '../../../../jdk/java/util/Locale.ts';
import { MissingResourceException, type ResourceBundle } from '../../../../jdk/java/util/ResourceBundle.ts';

/**
 * Message bundle helper class used for translation of the user interface.
 * @since 2.3
 */
export class ResourceBundleTools {

  private constructor() {
  }

  /**
   * Gets the ResourceBundle (i18n strings) for the given user interface language,
   * or (without a language) for the default language of the user's system.
   */
  static getMessageBundle(lang?: Language | null): ResourceBundle {
    const MESSAGE_BUNDLE = JLanguageTool.MESSAGE_BUNDLE;
    if (lang == null) {
      try {
        const bundle = JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, Locale.getDefault());
        const fallbackBundle = JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, Locale.ENGLISH);
        return new ResourceBundleWithFallback(bundle, fallbackBundle);
      } catch (e) {
        if (!(e instanceof MissingResourceException)) throw e;
        return JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, Locale.ENGLISH);
      }
    }
    try {
      let bundle = JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, lang.getLocaleWithCountryAndVariant());
      if (!ResourceBundleTools.isValidBundleFor(lang, bundle)) {
        bundle = JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, lang.getLocale());
        if (!ResourceBundleTools.isValidBundleFor(lang, bundle)) {
          // happens if 'xx' is requested but only a MessagesBundle_xx_YY.properties exists:
          const defaultVariant = lang.getDefaultLanguageVariant();
          if (defaultVariant != null && defaultVariant.getCountries().length > 0) {
            const locale = new Locale(defaultVariant.getShortCode(), defaultVariant.getCountries()[0]);
            bundle = JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, locale);
          }
        }
      }
      const fallbackBundle = JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, Locale.ENGLISH);
      return new ResourceBundleWithFallback(bundle, fallbackBundle);
    } catch (e) {
      if (!(e instanceof MissingResourceException)) throw e;
      return JLanguageTool.getDataBroker().getResourceBundle(MESSAGE_BUNDLE, Locale.ENGLISH);
    }
  }

  private static isValidBundleFor(lang: Language, bundle: ResourceBundle): boolean {
    return lang.getLocale().getLanguage() === bundle.getLocale().getLanguage();
  }
}
