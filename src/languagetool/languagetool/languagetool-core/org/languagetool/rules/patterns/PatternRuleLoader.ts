// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/PatternRuleLoader.java reduced
// getRules(InputStream is, String filename, Language lang) takes the file's text (or its bytes,
// decoded as UTF-8) instead of a stream; getRules(File, Language) is left out (no files here).
// The parser settings (external DTDs off, no entity limits) are those of SAXParse. Added:
// getMissingFilterWarnings(), the rules of the last file skipped because their filter class has
// not been ported (see RuleFilterCreator).
import type { Language } from '../../Language.ts';
import { DefaultHandler, SAXParse } from '../../../../../../jdk/org/xml/sax/DefaultHandler.ts';
import type { AbstractPatternRule } from './AbstractPatternRule.ts';
import { PatternRuleHandler } from './PatternRuleHandler.ts';

/**
 * Loads {@link PatternRule}s from an XML file.
 *
 * @author Daniel Naber
 */
export class PatternRuleLoader extends DefaultHandler {

  private relaxedMode = false;
  private missingFilterWarnings: string[] = [];

  /**
   * If set to true, don't throw an exception if id or name is not set.
   * Used for online rule editor.
   * @since 2.1
   */
  setRelaxedMode(relaxedMode: boolean): void {
    this.relaxedMode = relaxedMode;
  }

  /**
   * @param is the XML rules (text, or UTF-8 bytes)
   * @param filename used only for verbose exception message - should refer to where the stream comes from
   */
  getRules(is: string | Uint8Array, filename: string, lang: Language | null): AbstractPatternRule[] {
    try {
      const handler = new PatternRuleHandler(filename, lang);
      handler.setRelaxedMode(this.relaxedMode);
      SAXParse(typeof is === 'string' ? is : new TextDecoder('utf-8').decode(is), handler, filename);
      this.missingFilterWarnings = handler.getMissingFilterWarnings();
      return handler.getRules();
    } catch (e) {
      throw new Error("IOException: Cannot load or parse input stream of '" + filename + "'", { cause: e });
    }
  }

  /** The rules of the last getRules() skipped because their filter class is not ported: "id: class". */
  getMissingFilterWarnings(): string[] {
    return this.missingFilterWarnings;
  }

}
