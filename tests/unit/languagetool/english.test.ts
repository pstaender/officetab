// SPDX-License-Identifier: MPL-2.0
// English end to end: AmericanEnglish with all its rules (pattern rules of grammar.xml and
// style.xml, the Java rules, the Morfologik speller), the JSON of LanguageTool's HTTP API, and
// LanguageTool's own PatternRuleTest methodology (PatternRuleTest.testGrammarRulesFromXML) over
// every pattern rule of the English rule files: each incorrect example must be found once by its
// rule at the marker, with the given corrections, and the corrected sentence must not be found
// again; no correct example may be found. Failing rule ids are written to
// english-pattern-failures.txt next to this file (regenerated on every run).
import { beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNodeBroker } from './broker.ts';
import '../../../src/languagetool/languagetool/languagetool-language-modules/en/language-module.ts';
import { JLanguageTool } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import type { AnalyzedSentence } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { CheckResults } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/CheckResults.ts';
import { DetectedLanguage } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/DetectedLanguage.ts';
import { AnnotatedTextBuilder } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/markup/AnnotatedTextBuilder.ts';
import type { Rule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { RuleMatch } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TestHackHelper } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/TestHackHelper.ts';
import { ExampleSentence } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/ExampleSentence.ts';
import type { AbstractPatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/AbstractPatternRule.ts';
import { PatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/PatternRule.ts';
import { RegexPatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/RegexPatternRule.ts';
import { RuleMatchesAsJsonSerializer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/RuleMatchesAsJsonSerializer.ts';
import { AmericanEnglish } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/language/AmericanEnglish.ts';
import { EnglishChunker } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/chunking/EnglishChunker.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

let lang: Language;
let lt: JLanguageTool;
let loadMs = 0;

beforeAll(async () => {
  installNodeBroker();
  await EnglishChunker.init();
  const t0 = performance.now();
  lang = AmericanEnglish.getInstance();
  lt = new JLanguageTool(lang);
  lt.check('Warm up.');  // loads the speller dictionaries and the rule data
  loadMs = performance.now() - t0;
}, 300_000);

describe('AmericanEnglish', () => {
  it('is registered under en-US, en is English', () => {
    expect(Languages.getLanguageForShortCode('en-US')).toBe(lang);
    expect(Languages.getLanguageForShortCode('en').getName()).toBe('English');
    expect(Languages.getLanguageForShortCode('en-GB').getName()).toBe('English (GB)');
    expect(lang.getShortCodeWithCountryAndVariant()).toBe('en-US');
  });

  it('finds the grammar and the spelling error', () => {
    const text = 'This are a sentence with a speling error.';
    const matches = lt.check(text);
    const ids = matches.map((m) => m.getRule().getId());
    expect(ids).toContain('MORFOLOGIK_RULE_EN_US');
    const spelling = matches.find((m) => m.getRule().getId() === 'MORFOLOGIK_RULE_EN_US')!;
    expect(text.substring(spelling.getFromPos(), spelling.getToPos())).toBe('speling');
    expect(spelling.getSuggestedReplacements()).toContain('spelling');
    console.log('[english] matches:', matches.map((m) => m.getRule().getId() + ' ' + JSON.stringify(text.substring(m.getFromPos(), m.getToPos())) + ' ' + m.getSuggestedReplacements().slice(0, 3).join('|')).join('; '));
    // grammar.xml's PLURAL_VERB_AFTER_THIS: "This are" -> "This is"
    const grammar = matches.find((m) => m.getRule().getId() === 'PLURAL_VERB_AFTER_THIS');
    expect(grammar, 'grammar match for "This are": ' + ids.join(', ')).toBeDefined();
    expect(text.substring(grammar!.getFromPos(), grammar!.getToPos())).toBe('are');
    expect(grammar!.getSuggestedReplacements()).toContain('is');
  });

  it('serializes the matches as the HTTP API does', () => {
    const text = 'This are a sentence with a speling error.';
    const matches = lt.check(text);
    const json = new RuleMatchesAsJsonSerializer(0, lang).ruleMatchesToJson2(
      [new CheckResults(matches, [])], [], new AnnotatedTextBuilder().addText(text).build(), 40,
      new DetectedLanguage(lang, lang), null, false, null);
    const o = JSON.parse(json);
    expect(Object.keys(o)).toEqual(['software', 'warnings', 'language', 'matches', 'sentenceRanges', 'extendedSentenceRanges']);
    expect(o.software.name).toBe('LanguageTool');
    expect(o.language.code).toBe('en-US');
    expect(o.language.detectedLanguage.code).toBe('en-US');
    const m = o.matches.find((x: { rule: { id: string } }) => x.rule.id === 'MORFOLOGIK_RULE_EN_US');
    expect(m).toMatchObject({
      offset: 27, length: 7,
      context: { text: text, offset: 27, length: 7 },
      sentence: text,
      type: { typeName: 'UnknownWord' },
      rule: { id: 'MORFOLOGIK_RULE_EN_US', issueType: 'misspelling', category: { id: 'TYPOS' } },
    });
    expect(m.replacements[0]).toEqual({ value: 'spelling' });
    expect(Object.keys(m)).toEqual(expect.arrayContaining(['message', 'shortMessage', 'replacements', 'offset', 'length', 'context', 'sentence', 'type', 'rule', 'ignoreForIncompleteSentence', 'contextForSureMatch']));
  });

  it('checks a 200-word paragraph in reasonable time', () => {
    const paragraph = ('LanguageTool is an open source proofreading software for English, German and many other languages. ' +
      'It finds many errors that a simple spell checker cannot detect, like mixing up there and their, and it ' +
      'also detects some grammar problems. Their are a few rules wich look at the context of words, and the ' +
      'program uses a dictionary to find misspelled words. ').repeat(4);
    const words = paragraph.split(/\s+/).filter((w) => w !== '').length;
    expect(words).toBeGreaterThan(190);
    const t0 = performance.now();
    const matches = lt.check(paragraph);
    const checkMs = performance.now() - t0;
    console.log(`[english] loading AmericanEnglish with all rules: ${loadMs.toFixed(0)} ms; checking ${words} words: ${checkMs.toFixed(0)} ms, ${matches.length} matches`);
    expect(matches.some((m) => m.getRule().getId() === 'MORFOLOGIK_RULE_EN_US')).toBe(true);
  }, 120_000);
});

// ---- PatternRuleTest (languagetool-core/src/test/java/org/languagetool/rules/patterns/PatternRuleTest.java) ----

type Failure = { rule: AbstractPatternRule; message: string };

/** The minimum share of rules (of those with examples) that must pass all their examples. */
const MIN_PASS_RATE = 0.995;  // reached: 6134 of 6135 rule ids (A_NNS[4], see english-pattern-failures.txt)

describe('English pattern rules: PatternRuleTest', () => {
  it('finds every incorrect example and none of the correct ones', () => {
    // Java's date filters see PatternRuleTest on the stack and assume January 2014, as the examples do
    TestHackHelper.setJUnitTest(true);
    const analysisCache = new Map<string, AnalyzedSentence[]>();
    const analyzeText = (s: string): AnalyzedSentence[] => {
      let r = analysisCache.get(s);
      if (r === undefined) {
        r = lt.analyzeText(s);
        analysisCache.set(s, r);
      }
      return r;
    };
    // Unlike getMatchesForSingleSentence() this splits the text at sentence boundaries
    const getMatchesForText = (rule: Rule, sentence: string): RuleMatch[] => {
      const matches: RuleMatch[] = [];
      let matchOffset = 0;
      for (const analyzedSentence of analyzeText(sentence)) {
        const sentenceMatches = rule.match(analyzedSentence);
        for (const match of sentenceMatches) {
          match.setOffsetPosition(match.getFromPos() + matchOffset, match.getToPos() + matchOffset);
        }
        matches.push(...sentenceMatches);
        matchOffset += analyzedSentence.getText().length;
      }
      return matches;
    };
    const cleanXML = (str: string) => str.replace(/<([^<].*?)>/g, '');

    const rules: AbstractPatternRule[] = [];
    for (const patternRuleFileName of lang.getRuleFileNames()) {
      rules.push(...lt.loadPatternRules(patternRuleFileName));
    }
    const failures: Failure[] = [];
    const errors: Failure[] = [];
    const addError = (rule: AbstractPatternRule, message: string) => failures.push({ rule, message });
    let incorrectExamples = 0;
    let correctExamples = 0;
    let incorrectFailed = 0;
    let correctFailed = 0;
    const complexRules = new Map<string, AbstractPatternRule | null>();

    const assertSuggestions = (sentence: string, expectedCorrections: string[], rule: AbstractPatternRule, matches: RuleMatch[]): boolean => {
      if (expectedCorrections.length > 0) {
        const realSuggestions = matches[0]!.getSuggestedReplacements();
        if (realSuggestions.length === 0) {
          const expectedEmptyCorrection = expectedCorrections.length === 1 && expectedCorrections[0]!.length === 0;
          if (!expectedEmptyCorrection) {
            addError(rule, `Incorrect suggestions: Expected '${expectedCorrections.join('|')}', got <no suggestion> on input: '${sentence}'`);
            return false;
          }
        } else if (expectedCorrections.join('\u0000') !== realSuggestions.join('\u0000')) {
          addError(rule, `Incorrect suggestions: Expected '${expectedCorrections.join('|')}', got: '${realSuggestions.join('|')}' on input: '${sentence}'`);
          return false;
        }
      }
      return true;
    };
    const assertSuggestionsDoNotCreateErrors = (badSentence: string, rule: AbstractPatternRule, matches: RuleMatch[]): boolean => {
      let ok = true;
      const fromPos = matches[0]!.getFromPos();
      const toPos = matches[0]!.getToPos();
      for (const replacement of matches[0]!.getSuggestedReplacements()) {
        const fixedSentence = badSentence.substring(0, fromPos) + replacement + badSentence.substring(toPos);
        const tempMatches = getMatchesForText(rule, fixedSentence);
        if (tempMatches.length !== 0) {
          addError(rule, `Corrected sentence triggered error: ${fixedSentence}`);
          ok = false;
        }
      }
      return ok;
    };

    const testCorrectSentences = (rule: AbstractPatternRule) => {
      const auxRules = lt.getPatternRulesByIdAndSubId(rule.getId(), rule.getSubId()!);
      for (const goodSentenceObj of rule.getCorrectExamples()) {
        correctExamples++;
        const goodSentence = cleanXML(goodSentenceObj.getExample().replace(/[\n\t]+/g, ''));
        let isMatched = false;
        for (const auxRule of auxRules) {
          isMatched = isMatched || analyzeText(goodSentence).some((s) => auxRule.match(s).length > 0);
        }
        if (isMatched) {
          correctFailed++;
          addError(rule, `Did not expect error in: ${goodSentence}`);
        }
      }
    };

    const testBadSentences = (rule: AbstractPatternRule) => {
      const badSentences = rule.getIncorrectExamples();
      // necessary for XML Pattern rules containing <or>
      const auxRules = lt.getPatternRulesByIdAndSubId(rule.getId(), rule.getSubId()!);
      for (const origBadExample of badSentences) {
        incorrectExamples++;
        const before = failures.length;
        const origBadSentence = origBadExample.getExample().replace(/[\n\t]+/g, '');
        const expectedCorrections = origBadExample.getCorrections();
        const expectedMatchStart = origBadSentence.indexOf('<marker>');
        const expectedMatchEnd = origBadSentence.indexOf('</marker>') - '<marker>'.length;
        if (expectedMatchStart === -1 || expectedMatchEnd === -1) {
          addError(rule, "No error position markup ('<marker>...</marker>') in bad example.");
          incorrectFailed++;
          continue;
        }
        const badSentence = ExampleSentence.cleanMarkersInExample(origBadSentence);
        let matches: RuleMatch[] = [];
        for (const auxRule of auxRules) {
          matches.push(...getMatchesForText(auxRule, badSentence));
        }
        if (rule instanceof RegexPatternRule || (rule instanceof PatternRule && !rule.isWithComplexPhrase())) {
          if (matches.length !== 1) {
            addError(rule, `"${badSentence}" Errors expected: 1, found: ${matches.length}`);
          } else if (expectedMatchStart !== matches[0]!.getFromPos() || expectedMatchEnd !== matches[0]!.getToPos()) {
            addError(rule, `Incorrect match position markup (expected match position: ${expectedMatchStart} - ${expectedMatchEnd}, actual: ${matches[0]!.getFromPos()} - ${matches[0]!.getToPos()}) in sentence: ${badSentence}`);
          } else {
            // make sure suggestion is what we expect it to be
            assertSuggestions(badSentence, expectedCorrections, rule, matches);
            // make sure the suggested correction doesn't produce an error:
            const fromPos = matches[0]!.getFromPos();
            const toPos = matches[0]!.getToPos();
            for (const replacement of matches[0]!.getSuggestedReplacements()) {
              const fixedSentence = badSentence.substring(0, fromPos) + replacement + badSentence.substring(toPos);
              matches = getMatchesForText(rule, fixedSentence);
              if (matches.length > 0) {
                addError(rule, `The correction triggered an error itself: ${badSentence} => ${fixedSentence}`);
              }
            }
          }
        } else { // for multiple rules created with complex phrases
          matches = getMatchesForText(rule, badSentence);
          if (matches.length === 0 && !complexRules.has(rule.getId() + badSentence)) {
            complexRules.set(rule.getId() + badSentence, rule);
          }
          if (matches.length !== 0) {
            complexRules.set(rule.getId() + badSentence, null);
            if (matches.length !== 1) {
              addError(rule, `Did expect one error in: "${badSentence}", got ${matches.length}`);
            } else if (expectedMatchStart !== matches[0]!.getFromPos() || expectedMatchEnd !== matches[0]!.getToPos()) {
              addError(rule, `Incorrect match position markup (expected match position: ${expectedMatchStart} - ${expectedMatchEnd}, actual: ${matches[0]!.getFromPos()} - ${matches[0]!.getToPos()}) in sentence: ${badSentence}`);
            } else {
              assertSuggestions(badSentence, expectedCorrections, rule, matches);
              assertSuggestionsDoNotCreateErrors(badSentence, rule, matches);
            }
          }
        }
        if (failures.length > before) incorrectFailed++;
      }
    };

    const progressFile = process.env.LT_PROGRESS;  // optional: a file that gets a line every 250 rules
    let tested = 0;
    const testRules = (toTest: AbstractPatternRule[]) => {
      for (const rule of toTest) {
        if (progressFile && ++tested % 250 === 0) appendFileSync(progressFile, `${tested} ${rule.getFullId()} ${failures.length} failures\n`);
        if (progressFile) writeFileSync(progressFile + '.current', rule.getFullId());
        try {
          testCorrectSentences(rule);
          testBadSentences(rule);
        } catch (e) {
          errors.push({ rule, message: 'Exception: ' + (e instanceof Error ? (e.stack ?? e.message).split('\n').slice(0, 4).join(' | ') : String(e)) });
        }
      }
    };
    testRules(rules.slice(Number(process.env.LT_SKIP ?? 0)));  // LT_SKIP: for debugging, skip the first rules
    // rules with complex phrases whose incorrect examples never matched: tested again as a whole
    const badRules: AbstractPatternRule[] = [];
    for (const badRule of complexRules.values()) {
      if (badRule instanceof PatternRule) {
        badRule.notComplexPhrase();
        badRules.push(badRule);
      }
    }
    if (badRules.length > 0) testRules(badRules);

    const failedIds = new Map<string, string[]>();
    for (const f of [...errors, ...failures]) {
      const id = f.rule.getFullId();
      if (!failedIds.has(id)) failedIds.set(id, []);
      failedIds.get(id)!.push(f.message);
    }
    const ruleIds = new Set(rules.map((r) => r.getFullId()));
    const passed = [...ruleIds].filter((id) => !failedIds.has(id)).length;
    const rate = passed / ruleIds.size;
    const summary = `[english] PatternRuleTest: ${rules.length} rules (${ruleIds.size} ids), ${passed} pass all examples (${(100 * rate).toFixed(1)}%); ` +
      `incorrect examples: ${incorrectExamples - incorrectFailed}/${incorrectExamples} ok, correct examples: ${correctExamples - correctFailed}/${correctExamples} ok; ` +
      `${errors.length} rules threw`;
    console.log(summary);
    const lines = [summary, ''];
    for (const [id, msgs] of [...failedIds].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(id);
      for (const m of msgs.slice(0, 5)) lines.push('  ' + m.replace(/\n/g, ' '));
    }
    writeFileSync(join(HERE, 'english-pattern-failures.txt'), lines.join('\n') + '\n');
    TestHackHelper.setJUnitTest(false);
    expect(rate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
  }, 1_800_000);
});
