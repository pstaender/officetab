// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/rules/DisambiguationRuleLoader.java reduced
// getRules takes the file's text (or its UTF-8 bytes) instead of a stream; the parser settings
// are SAXParse's. Added: getMissingFilterWarnings() (see PatternRuleLoader).
import type { Language } from '../../../Language.ts';
import { DefaultHandler, SAXParse } from '../../../../../../../jdk/org/xml/sax/DefaultHandler.ts';
import type { DisambiguationPatternRule } from './DisambiguationPatternRule.ts';
import { DisambiguationRuleHandler } from './DisambiguationRuleHandler.ts';

/**
 * Loads {@link DisambiguationPatternRule}s from a disambiguation rules XML
 * file.
 *
 * @author Marcin Miłkowski
 */
export class DisambiguationRuleLoader extends DefaultHandler {

  private missingFilterWarnings: string[] = [];

  getRules(stream: string | Uint8Array, language: Language, xmlPath: string): DisambiguationPatternRule[] {
    const handler = new DisambiguationRuleHandler(language, xmlPath);
    SAXParse(typeof stream === 'string' ? stream : new TextDecoder('utf-8').decode(stream), handler, xmlPath);
    this.missingFilterWarnings = handler.getMissingFilterWarnings();
    return handler.getDisambRules();
  }

  /** The rules of the last getRules() skipped because their filter class is not ported: "id: class". */
  getMissingFilterWarnings(): string[] {
    return this.missingFilterWarnings;
  }

}
