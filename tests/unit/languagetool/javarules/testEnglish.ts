// SPDX-License-Identifier: MPL-2.0
// Shared test setup for the Java rules: an English language with the ported analysis
// (SRX sentence tokenizer, EnglishWordTokenizer, EnglishTagger, XmlRuleDisambiguator with
// disambiguation.xml, EnglishSynthesizer) until org.languagetool.language.AmericanEnglish is
// ported. Rules are created directly by the tests; getRelevantRules returns none.
import { installNodeBroker } from '../broker.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Language } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import type { AnalyzedSentence } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { ResourceBundle } from '../../../../src/languagetool/jdk/java/util/ResourceBundle.ts';
import { SRXSentenceTokenizer } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/SRXSentenceTokenizer.ts';
import type { SentenceTokenizer } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/SentenceTokenizer.ts';
import type { Tokenizer } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/Tokenizer.ts';
import type { Tagger } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/Tagger.ts';
import type { Disambiguator } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/Disambiguator.ts';
import type { Synthesizer } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import { XmlRuleDisambiguator } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/rules/XmlRuleDisambiguator.ts';
import { EnglishTagger } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/tagging/en/EnglishTagger.ts';
import { EnglishWordTokenizer } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/tokenizers/en/EnglishWordTokenizer.ts';
import { EnglishSynthesizer } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/synthesis/en/EnglishSynthesizer.ts';

/** A stand-in for org.languagetool.language.AmericanEnglish. */
export class TestEnglish extends Language {
  constructor() { super(); }
  override getShortCode(): string { return 'en'; }
  override getName(): string { return 'English (US)'; }
  override getCountries(): string[] { return ['US']; }
  override getMaintainers() { return []; }
  override getRelevantRules(_messages: ResourceBundle): Rule[] { return []; }
  override createDefaultSentenceTokenizer(): SentenceTokenizer { return new SRXSentenceTokenizer(this); }
  override createDefaultWordTokenizer(): Tokenizer { return new EnglishWordTokenizer(); }
  override createDefaultTagger(): Tagger { return EnglishTagger.INSTANCE; }
  override createDefaultDisambiguator(): Disambiguator { return new XmlRuleDisambiguator(this, true); }
  override createDefaultSynthesizer(): Synthesizer | null { return EnglishSynthesizer.INSTANCE; }
}

let state: { english: Language; lt: JLanguageTool } | null = null;

/** Installs the node data broker and returns the English test language with a JLanguageTool. */
export function english(): { english: Language; lt: JLanguageTool; messages: ResourceBundle } {
  if (state == null) {
    installNodeBroker();
    if (!Languages.isLanguageSupported('en')) {
      Languages.register('org.languagetool.language.AmericanEnglish', TestEnglish);
    }
    const lang = new TestEnglish();
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
