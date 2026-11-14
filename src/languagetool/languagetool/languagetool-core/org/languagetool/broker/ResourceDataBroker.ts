// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/broker/ResourceDataBroker.java reduced
// Resources are in memory (see DefaultResourceDataBroker): the stream methods return a Uint8Array,
// the URL methods are left out (getFromResourceDirAsUrl(s), getAsURL(s), getFromRulesDirAsUrl:
// nothing has a URL before it is loaded), and getResourceBundle takes this broker as its loader.
// The RESOURCE_DIR and RULES_DIR constants are exported next to the interface.
import type { Locale } from '../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * The directory name of the {@code /resource} directory.
 */
export const RESOURCE_DIR = '/org/languagetool/resource';

/**
 * The directory name of the {@code /rules} directory.
 */
export const RULES_DIR = '/org/languagetool/rules';

/**
 * Is responsible for getting the necessary resources for the LanguageTool
 * library. Following directories are currently needed by a couple of classes:
 *
 * <ul style="list-type: circle">
 * <li>{@code /resource}</li>
 * <li>{@code /rules}</li>
 * </ul>
 *
 * This interface determines methods to obtain any contents from these
 * directories.
 */
export interface ResourceDataBroker {

  /**
   * Checks if a resource in LanguageTool's {@code /resource} exists.
   * @param path Path to an item from the {@code /resource} directory.
   * @return {@code true} if the resource file exists.
   */
  resourceExists(path: string): boolean;

  /**
   * Checks if a resource in LanguageTool's {@code /rules} exists.
   * @param path Path to an item from the {@code /rules} directory.
   * @return {@code true} if the resource file exists.
   */
  ruleFileExists(path: string): boolean;

  /**
   * Gets any resource from LanguageTool's {@code /resource} directory.
   * @param path Path to an item from the {@code /resource} directory.
   * @return the content of the requested item
   * @throws RuntimeException if path cannot be found
   */
  getFromResourceDirAsStream(path: string): Uint8Array;

  /**
   * Gets any resource from the {@code /resource} directory.
   * @param path The relative path to the item inside of the {@code /resource}, e.g. {@code /xx/filename}
   * @return An list of strings, one per line
   * @throws RuntimeException if path cannot be found
   * @since 4.9
   */
  getFromResourceDirAsLines(path: string): string[];

  /**
   * Get from resource broker by a path file
   * @param path Path to an item
   * @return the content of the requested item, or null if it does not exist
   * @since 4.9
   */
  getAsStream(path: string): Uint8Array | null;

  /**
   * Gets any resource from LanguageTool's {@code /rules} directory.
   * @param path Path to an item from the {@code /rules} directory.
   * @return the content of the requested item
   * @throws RuntimeException if path cannot be found
   */
  getFromRulesDirAsStream(path: string): Uint8Array;

  /**
   * @return The currently set resource directory path as a string. Make sure
   *         that you comply with the following format when setting this value:<br>
   *         {@code /subdir/furtherdir/resourcedir}
   */
  getResourceDir(): string;

  /**
   * @return The currently set rules directory path as a string. Make sure
   *         that you comply with the following format when setting this value:<br>
   *         {@code /subdir/furtherdir/rulesdir}
   */
  getRulesDir(): string;

  /**
   * Gets a resource bundle using the specified base name and locale, and the caller module.
   *
   * @param baseName the base name of the resource bundle, a fully qualified class name
   * @param locale the locale for which a resource bundle is desired
   * @return a resource bundle for the given base name and locale
   * @since 5.0
   */
  getResourceBundle(baseName: string, locale: Locale): ResourceBundle;
}
