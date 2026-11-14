// SPDX-License-Identifier: MPL-2.0
// Shared test setup for the Java rules: org.languagetool.language.AmericanEnglish (with its
// filters registered and the OpenNLP chunker models loaded) and a JLanguageTool for it. Rules are
// mostly created directly by the tests.
import { installNodeBroker } from '../broker.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import type { AnalyzedSentence } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { ResourceBundle } from '../../../../src/languagetool/jdk/java/util/ResourceBundle.ts';
import '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/registerFilters.ts';
import '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/language/AmericanEnglish.ts';
import { EnglishChunker } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/chunking/EnglishChunker.ts';

installNodeBroker();
await EnglishChunker.init();

let state: { english: Language; lt: JLanguageTool } | null = null;

/** Installs the node data broker and returns American English with a JLanguageTool. */
export function english(): { english: Language; lt: JLanguageTool; messages: ResourceBundle } {
  if (state == null) {
    installNodeBroker();
    const lang = Languages.getLanguageForShortCode('en-US');
    state = { english: lang, lt: new JLanguageTool(lang) };
  }
  return { ...state, messages: JLanguageTool.getMessageBundle(state.english) };
}

/** rule.match(lt.getAnalyzedSentence(text)) */
export function matchSentence(rule: Rule, text: string): RuleMatch[] {
  return rule.match(english().lt.getAnalyzedSentence(text));
}

/** A text-level rule's matches for lt.analyzeText(text). */
export function matchText(rule: Rule, text: string): RuleMatch[] {
  return rule.match(english().lt.analyzeText(text));
}

export function analyzed(text: string): AnalyzedSentence {
  return english().lt.getAnalyzedSentence(text);
}
