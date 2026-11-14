// SPDX-License-Identifier: MPL-2.0
// Shared test setup for German's hand-written Java rules (rules/de/*.ts): German (Germany) with a
// JLanguageTool for it. German.ts imports every German rule class; those not ported yet are
// replaced by a stub rule that never matches (vi.doMock, as in german.test.ts), so that the
// language loads. Must be imported before any German module (germanrules.test.ts imports it first).
import { vi } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNodeBroker } from '../broker.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { Language } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import type { AnalyzedSentence } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { ResourceBundle } from '../../../../src/languagetool/jdk/java/util/ResourceBundle.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const RULES_DE = join(ROOT, 'src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de');

const RULE_CLASSES = [
  'AgreementRule', 'AgreementRule2', 'AustrianGermanSpellerRule', 'CaseRule', 'CompoundCoherencyRule', 'CompoundInfinitivRule',
  'ConjunctionAtBeginOfSentenceRule', 'DashRule', 'DuUpperLowerCaseRule', 'GermanCommaWhitespaceRule', 'GermanCompoundRule',
  'GermanDoublePunctuationRule', 'GermanFillerWordsRule', 'GermanMultitokenSpeller', 'GermanParagraphRepeatBeginningRule',
  'GermanReadabilityRule', 'GermanRepeatedWordsRule', 'GermanSpellerRule', 'GermanStyleRepeatedWordRule',
  'GermanUnpairedBracketsRule', 'GermanUnpairedQuotesRule', 'GermanWordRepeatBeginningRule', 'GermanWordRepeatRule',
  'GermanWrongWordInContextRule', 'LongSentenceRule', 'MissingCommaRelativeClauseRule', 'MissingVerbRule',
  'NonSignificantVerbsRule', 'OldSpellingRule', 'PassiveSentenceRule', 'RedundantModalOrAuxiliaryVerb', 'SentenceWhitespaceRule',
  'SentenceWithManRule', 'SentenceWithModalVerbRule', 'SimilarNameRule', 'SimpleReplaceRule', 'StyleRepeatedSentenceBeginning',
  'StyleRepeatedVeryShortSentences', 'StyleTooOftenUsedAdjectiveRule', 'StyleTooOftenUsedNounRule', 'StyleTooOftenUsedVerbRule',
  'SubjectVerbAgreementRule', 'SwissCompoundRule', 'SwissGermanSpellerRule', 'UnitConversionRule', 'UnnecessaryPhraseRule',
  'VerbAgreementRule', 'WiederVsWiderRule', 'WordCoherencyRule', 'MorfologikGermanyGermanSpellerRule',
];
export const stubbed: string[] = [];
for (const name of RULE_CLASSES) {
  if (existsSync(join(RULES_DE, name + '.ts'))) continue;
  stubbed.push(name);
  const Stub = class extends Rule {
    override getId(): string { return 'STUB_' + name; }
    override getDescription(): string { return 'not yet ported: ' + name; }
    override match(): RuleMatch[] { return []; }
    static INSTANCE = null;
  };
  Object.defineProperty(Stub, 'name', { value: name });
  // Vitest matches a module it cannot resolve by its specifier as written
  vi.doMock('../rules/de/' + name + '.ts', () => ({ [name]: Stub }));
  vi.doMock('./' + name + '.ts', () => ({ [name]: Stub }));
}
/** Whether a German rule class is ported (its file exists), for skipping tests that need it. */
export const isPorted = (name: string): boolean => existsSync(join(RULES_DE, name + '.ts'));

// creating German's JLanguageTool (first use) and loading rule data take longer than Vitest's default
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

installNodeBroker([join(ROOT, 'public/languagetool')]);
await import('../../../../src/languagetool/languagetool/languagetool-language-modules/de/language-module.ts');

let state: { german: Language; lt: JLanguageTool } | null = null;

/** German (Germany) with a JLanguageTool (created on first use) and the message bundle. */
export function german(): { german: Language; lt: JLanguageTool; messages: ResourceBundle } {
  if (state == null) {
    const lang = Languages.getLanguageForShortCode('de-DE');
    state = { german: lang, lt: new JLanguageTool(lang) };
  }
  return { ...state, messages: JLanguageTool.getMessageBundle(state.german) };
}

/** A language by its code (de-DE, de-CH, de-AT, de). */
export const lang = (code: string): Language => Languages.getLanguageForShortCode(code);

/** rule.match(lt.getAnalyzedSentence(text)) */
export function matchSentence(rule: Rule, text: string): RuleMatch[] {
  return rule.match(german().lt.getAnalyzedSentence(text));
}

/** A text-level rule's matches for lt.analyzeText(text). */
export function matchText(rule: Rule, text: string): RuleMatch[] {
  return rule.match(german().lt.analyzeText(text));
}

export function analyzed(text: string): AnalyzedSentence {
  return german().lt.getAnalyzedSentence(text);
}
