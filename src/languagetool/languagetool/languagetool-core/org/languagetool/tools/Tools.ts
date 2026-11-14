// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tools/Tools.java partial
// Ported: i18n, correctText, correctTextFromMatches, getFullStackTrace, getStream, selectRules
// (both overloads in one method), getUrl (a URL is a validated string) and isParagraphEnd. Left out:
// the bitext methods, profileRulesOnLine, setPasswordAuthenticator (no network rules here) and
// the LibreOffice extension's LinguServices hooks (setLinguisticServices, isExternSpeller,
// getLinguisticServices).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { JLanguageTool } from '../JLanguageTool.ts';
import type { Language } from '../Language.ts';
import type { CategoryId } from '../rules/CategoryId.ts';
import type { RuleMatch } from '../rules/RuleMatch.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { MessageFormat } from '../../../../../jdk/java/text/MessageFormat.ts';
import { List_contains } from '../../../../../jdk/java/util/Objects.ts';

export class Tools {

  private constructor() {
    // cannot construct, static methods only
  }

  /**
   * Translate a text string based on our i18n files.
   * @since 3.1
   */
  static i18n(messages: ResourceBundle, key: string, ...messageArguments: unknown[]): string {
    const formatter = new MessageFormat('');
    formatter.applyPattern(messages.getString(key));
    return formatter.format(messageArguments);
  }

  /**
   * Automatically applies suggestions to the text, as suggested
   * by the rules that match.
   * Note: if there is more than one suggestion, always the first
   * one is applied, and others are ignored silently.
   *
   * @param contents String to be corrected
   * @param lt Initialized LanguageTool object
   * @return Corrected text as String.
   */
  static correctText(contents: string, lt: JLanguageTool): string {
    const ruleMatches = lt.check(contents);
    if (ruleMatches.length === 0) {
      return contents;
    }
    return Tools.correctTextFromMatches(contents, ruleMatches);
  }

  /**
   * @since 2.3
   */
  static correctTextFromMatches(
      contents: string, matches: readonly RuleMatch[]): string {
    let sb = contents;
    const errors: string[] = [];
    for (const rm of matches) {
      const replacements = rm.getSuggestedReplacements();
      if (replacements.length > 0) {
        errors.push(sb.substring(rm.getFromPos(), rm.getToPos()));
      }
    }
    let offset = 0;
    let counter = 0;
    for (const rm of matches) {
      const replacements = rm.getSuggestedReplacements();
      if (replacements.length > 0) {
        //make sure the error hasn't been already corrected:
        if (rm.getFromPos() - offset >= 0 &&
            rm.getToPos() - offset >= rm.getFromPos() - offset &&
            errors[counter] === sb.substring(rm.getFromPos() - offset, rm.getToPos() - offset)) {
          sb = sb.substring(0, rm.getFromPos() - offset) + replacements[0] + sb.substring(rm.getToPos() - offset);
          offset += rm.getToPos() - rm.getFromPos() - replacements[0]!.length;
        }
        counter++;
      }
    }
    return sb;
  }

  /**
   * Get a stacktrace as a string.
   */
  static getFullStackTrace(e: unknown): string {
    return e instanceof Error ? (e.stack ?? String(e)) : String(e);
  }

  /**
   * Load a file from the classpath using {@link Class#getResourceAsStream(String)}.
   * Please load files in the {@code rules} and {@code resource} directories with
   * {@link org.languagetool.broker.ResourceDataBroker} instead.
   */
  static getStream(path: string): Uint8Array {
    // the other ways to load the stream like
    // "Tools.class.getClass().getResourceAsStream(filename)"
    // don't work in a web context (using Grails):
    const is = JLanguageTool.getDataBroker().getAsStream(path);
    if (is == null) {
      throw new Error("IOException: Could not load file from classpath: '" + path + "'");
    }
    return is;
  }

  /**
   * Enable and disable rules of the given LanguageTool instance.
   * Either (lt, disabledRuleIds, enabledRuleIds, useEnabledOnly), or (since 3.3)
   * (lt, disabledCategories, enabledCategories, disabledRules, enabledRules, useEnabledOnly, enableTempOff).
   * @param lt LanguageTool object
   * @param useEnabledOnly if set to {@code true}, disable all rules except those enabled explicitly
   */
  static selectRules(lt: JLanguageTool, disabledRuleIds: readonly string[], enabledRuleIds: readonly string[], useEnabledOnly: boolean): void;
  static selectRules(lt: JLanguageTool, disabledCategories: Iterable<CategoryId>, enabledCategories: Iterable<CategoryId>,
                     disabledRules: Iterable<string>, enabledRules: Iterable<string>, useEnabledOnly: boolean, enableTempOff: boolean): void;
  static selectRules(lt: JLanguageTool, a: Iterable<string> | Iterable<CategoryId>, b: Iterable<string> | Iterable<CategoryId>,
                     c: boolean | Iterable<string>, d?: Iterable<string>, useEnabledOnlyArg?: boolean, enableTempOffArg?: boolean): void {
    if (typeof c === 'boolean') {
      const disabledRuleIdsSet = new Set<string>(a as Iterable<string>);
      const enabledRuleIdsSet = new Set<string>(b as Iterable<string>);
      Tools.selectRules(lt, [], [], disabledRuleIdsSet, enabledRuleIdsSet, c, false);
      return;
    }
    const disabledCategories = [...(a as Iterable<CategoryId>)];
    const enabledCategories = [...(b as Iterable<CategoryId>)];
    const disabledRules = new Set(c);
    const enabledRules = new Set(d!);
    const useEnabledOnly = useEnabledOnlyArg!;
    if (enableTempOffArg) {
      for (const rule of lt.getAllRules()) {
        if (rule.isDefaultTempOff()) {
          console.log('Activating ' + rule.getFullId() + ", which is default='temp_off'");
          lt.enableRule(rule.getFullId());
        }
      }
    }
    for (const id of disabledCategories) {
      lt.disableCategory(id);
    }
    if (enabledCategories.length > 0) {
      for (const id of enabledCategories) {
        lt.enableRuleCategory(id);
      }
      if (useEnabledOnly) {
        // disable all rules except those in explicitly enabled categories, if any:
        for (const rule of lt.getAllRules()) {
          const category = rule.getCategory();
          if (!List_contains(enabledCategories, category.getId())) {
            lt.disableRule(rule.getFullId());
          }
        }
      }
    }
    // disable rules that are disabled explicitly:
    for (const disabledRule of disabledRules) {
      lt.disableRule(disabledRule);
    }
    // enable rules
    if (enabledRules.size > 0) {
      for (const ruleName of enabledRules) {
        lt.enableRule(ruleName);
      }
      if (useEnabledOnly) {
        // disable all rules except those enabled explicitly, if any:
        for (const rule of lt.getAllRules()) {
          if (!(enabledRules.has(rule.getFullId()) || enabledRules.has(rule.getId()))) {
            lt.disableRule(rule.getFullId());
          }
        }
      }
    }
  }

  /**
   * Create a URL object from a string. Helper method that turns
   * the {@code MalformedURLException} into a {@code RuntimeException}.
   * @since 4.0
   */
  static getUrl(url: string): string {
    try {
      new URL(url);  // MalformedURLException
      return url;
    } catch (e) {
      throw new Error('RuntimeException: ' + e);
    }
  }

  /**
   * @since 4.9
   */
  static isParagraphEnd(sentences: readonly AnalyzedSentence[], nTest: number, lang: Language): boolean {
    if (nTest >= sentences.length - 1) {
      return true;
    }
    if (lang.getSentenceTokenizer().singleLineBreaksMarksPara()) {
      if (sentences[nTest]!.getText().endsWith('\n') || sentences[nTest]!.getText().endsWith('\n\r')) {
        return true;
      }
    } else {
      if (sentences[nTest]!.getText().endsWith('\n\n') || sentences[nTest]!.getText().endsWith('\n\r\n\r') || sentences[nTest]!.getText().endsWith('\r\n\r\n')) {
        return true;
      }
    }
    if (sentences[nTest + 1]!.getText().startsWith('\n') || sentences[nTest + 1]!.getText().startsWith('\r\n')) {
      return true;
    }
    return false;
  }

}
