// The rule filters used by English (grammar.xml, style.xml, disambiguation.xml): DateCheckFilterTest,
// EnglishNumberInWordFilterTest (skipped while AmericanEnglish cannot be loaded), checks of the
// core filters, of MultitokenSpeller and of the jdk Calendar they use, that the English rule
// files load without unregistered filter classes, and the <example>s of the rules with date,
// ordinal, adverb, date range, whitespace and FindSuggestions filters (as PatternRuleTest runs
// them, with TestHackHelper's JUnit flag: dates without a year are in 2014, "now" is 1 January
// 2014). The rules with chunk conditions need the chunker, which the test language gets here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzed, english } from './testEnglish.ts';
import '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/registerFilters.ts';
import { FilterRegistry } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { PatternRuleLoader } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/PatternRuleLoader.ts';
import type { AbstractPatternRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/AbstractPatternRule.ts';
import { DisambiguationRuleLoader } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationRuleLoader.ts';
import { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { AnalyzedSentence } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { TestHackHelper } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/TestHackHelper.ts';
import { DateRangeChecker } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/DateRangeChecker.ts';
import { YMDDateHelper } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/YMDDateHelper.ts';
import { MultitokenSpeller } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/spelling/multitoken/MultitokenSpeller.ts';
import { EditDistance } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/spelling/symspell/implementation/EditDistance.ts';
import { DateCheckFilter } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/DateCheckFilter.ts';
import { OrdinalSuffixFilter } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/OrdinalSuffixFilter.ts';
import { AdverbFilter } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/AdverbFilter.ts';
import { NoDisambiguationEnglishPartialPosTagFilter } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/NoDisambiguationEnglishPartialPosTagFilter.ts';
import { Calendar } from '../../../../src/languagetool/jdk/java/util/Calendar.ts';
import { Locale } from '../../../../src/languagetool/jdk/java/util/Locale.ts';
import { fileForResource } from '../broker.ts';
import { EnglishChunker } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/chunking/EnglishChunker.ts';

class FakeRule extends Rule {
  override getId(): string { return 'FAKE-RULE'; }
  override getDescription(): string { return 'fake'; }
  override match(_s: AnalyzedSentence): RuleMatch[] { return []; }
}

const EN_FILTERS = [
  'org.languagetool.rules.DateRangeChecker',
  'org.languagetool.rules.UnderlineSpacesFilter',
  'org.languagetool.rules.spelling.multitoken.MultitokenSpellerFilter',
  'org.languagetool.rules.en.AdverbFilter',
  'org.languagetool.rules.en.DateCheckFilter',
  'org.languagetool.rules.en.EnglishNumberInWordFilter',
  'org.languagetool.rules.en.EnglishSuppressMisspelledSuggestionsFilter',
  'org.languagetool.rules.en.FindSuggestionsFilter',
  'org.languagetool.rules.en.FutureDateFilter',
  'org.languagetool.rules.en.NewYearDateFilter',
  'org.languagetool.rules.en.NoDisambiguationEnglishPartialPosTagFilter',
  'org.languagetool.rules.en.OrdinalSuffixFilter',
  'org.languagetool.rules.en.YMDNewYearDateFilter',
];

/** Filters whose <example>s are checked here (the others need the speller). */
const EXAMPLE_FILTERS = new Set([
  'org.languagetool.rules.DateRangeChecker',
  'org.languagetool.rules.UnderlineSpacesFilter',
  'org.languagetool.rules.en.AdverbFilter',
  'org.languagetool.rules.en.DateCheckFilter',
  'org.languagetool.rules.en.FindSuggestionsFilter',
  'org.languagetool.rules.en.FutureDateFilter',
  'org.languagetool.rules.en.NewYearDateFilter',
  'org.languagetool.rules.en.OrdinalSuffixFilter',
  'org.languagetool.rules.en.YMDNewYearDateFilter',
]);

function filterClassName(rule: AbstractPatternRule): string | null {
  const f = rule.getFilter();
  if (f == null) return null;
  return FilterRegistry.classNames().find((c) => FilterRegistry.forName(c)!().constructor === f.constructor) ?? null;
}

describe('DateCheckFilterTest', () => {
  it('testGetDayOfWeek', () => {
    const filter = new DateCheckFilter();
    expect(filter.getDayOfWeek('Sun')).toBe(1);
    expect(filter.getDayOfWeek('Mon')).toBe(2);
    expect(filter.getDayOfWeek('mon')).toBe(2);
    expect(filter.getDayOfWeek('Mon.')).toBe(2);
    expect(filter.getDayOfWeek('Monday')).toBe(2);
    expect(filter.getDayOfWeek('monday')).toBe(2);
    expect(filter.getDayOfWeek('Tue')).toBe(3);
    expect(filter.getDayOfWeek('Fri')).toBe(6);
    expect(filter.getDayOfWeek('Fr')).toBe(6);
    expect(filter.getDayOfWeek('Saturday')).toBe(7);
  });

  it('testMonth', () => {
    const filter = new DateCheckFilter();
    expect(filter.getMonth('jan')).toBe(1);
    expect(filter.getMonth('dec')).toBe(12);
    expect(filter.getMonth('december')).toBe(12);
    expect(filter.getMonth('December')).toBe(12);
    expect(filter.getMonth('DECEMBER')).toBe(12);
  });
});

describe('jdk Calendar (as the date filters use it)', () => {
  it('computes the day of the week and rejects invalid dates when not lenient', () => {
    const cal = Calendar.getInstance(Locale.UK);
    cal.setLenient(false);
    cal.set(2014, 0, 1, 0, 0, 0);
    expect(cal.get(Calendar.DAY_OF_WEEK)).toBe(Calendar.WEDNESDAY);
    expect(cal.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.LONG, Locale.UK)).toBe('Wednesday');
    cal.set(2014, 1, 29, 0, 0, 0);
    expect(() => cal.get(Calendar.DAY_OF_WEEK)).toThrow(/IllegalArgumentException/);
    cal.set(2016, 1, 29, 0, 0, 0);
    expect(cal.get(Calendar.DAY_OF_WEEK)).toBe(Calendar.MONDAY);
    const lenient = Calendar.getInstance();
    lenient.set(2014, 7, 32, 0, 0, 0);
    expect(lenient.get(Calendar.MONTH)).toBe(8);
    const day = Calendar.getInstance();
    day.set(Calendar.DAY_OF_WEEK, Calendar.FRIDAY);
    expect(day.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.LONG, Locale.UK)).toBe('Friday');
    expect(new Calendar.Builder().setDate(2014, 0, 2).build().after(new Calendar.Builder().setDate(2014, 0, 1).build())).toBe(true);
  });
});

describe('core filters', () => {
  beforeAll(() => { english(); });

  const fakeMatch = (text: string, from: number, to: number, suggestion?: string) => {
    const m = new RuleMatch(new FakeRule(), analyzed(text), from, to, 'fake msg');
    if (suggestion != null) m.setSuggestedReplacement(suggestion);
    return m;
  };

  it('DateRangeChecker accepts a range whose start is not before its end', () => {
    const f = new DateRangeChecker();
    const m = fakeMatch('from 2010 to 2005', 0, 4);
    expect(f.acceptRuleMatch(m, new Map([['x', '2010'], ['y', '2005']]), 0, [], [])).toBe(m);
    expect(f.acceptRuleMatch(m, new Map([['x', '2005'], ['y', '2010']]), 0, [], [])).toBeNull();
    expect(f.acceptRuleMatch(m, new Map([['x', 'foo'], ['y', '2010']]), 0, [], [])).toBeNull();
  });

  it('YMDDateHelper parses yyyy-mm-dd and corrects the year', () => {
    const helper = new YMDDateHelper();
    const args = helper.parseDate(new Map([['date', '2013-01-05']]));
    expect([...args]).toEqual([['date', '2013-01-05'], ['year', '2013'], ['month', '01'], ['day', '05']]);
    const m = new RuleMatch(new FakeRule(), null, 0, 1, 'Did you mean {realDate}?');
    expect(helper.correctDate(m, args).getMessage()).toBe('Did you mean 2014-01-05?');
    expect(() => helper.parseDate(new Map([['date', '2013-01']]))).toThrow(/RuntimeException/);
  });

  it('OrdinalSuffixFilter and AdverbFilter fix the suggestion', () => {
    for (const [wrong, right] of [['1nd', '1st'], ['11st', '11th'], ['22th', '22nd'], ['113rd', '113th'], ['3th', '3rd'], ['5st', '5th']]) {
      const m = fakeMatch('the ' + wrong + ' time', 4, 4 + wrong.length, wrong);
      expect(new OrdinalSuffixFilter().acceptRuleMatch(m, new Map(), 0, [], [])!.getSuggestedReplacements()).toEqual([right]);
    }
    const m = fakeMatch('a quickly car', 2, 13, 'x');
    expect(new AdverbFilter().acceptRuleMatch(m, new Map([['adverb', 'quickly'], ['noun', 'car']]), 0, [], [])!.getSuggestedReplacements()).toEqual(['quick car']);
  });

  it('NoDisambiguationEnglishPartialPosTagFilter tags a part of the token', () => {
    const f = new NoDisambiguationEnglishPartialPosTagFilter();
    const tokens = analyzed('This is unwalkable.').getTokensWithoutWhitespace();
    const m = fakeMatch('This is unwalkable.', 8, 18);
    const args = (postag: string) => new Map([['no', '4'], ['regexp', '(?:un)(.*)able'], ['postag_regexp', postag]]);
    expect(f.acceptRuleMatch(m, args('VB.*'), 0, tokens, [])).toBe(m);
    expect(f.acceptRuleMatch(m, args('JJ.*'), 0, tokens, [])).toBeNull();
  });

  it('EditDistance (Damerau) as AbstractFindSuggestionsFilter sorts with it', () => {
    const d = new EditDistance('house', EditDistance.DistanceAlgorithm.Damerau);
    expect(d.compare('house', 4)).toBe(0);
    expect(d.compare('hosue', 4)).toBe(1);
    expect(d.compare('mouse', 4)).toBe(1);
    expect(d.compare('horses', 4)).toBe(2);
    expect(d.compare('elephant', 2)).toBe(-1);
  });
});

describe('MultitokenSpeller', () => {
  it('suggests multi-word names of en/multiwords.txt and spelling_global.txt', async (ctx) => {
    const { english: lang, messages } = english();
    let rule: unknown;
    try {
      const { MorfologikAmericanSpellerRule } = await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/MorfologikAmericanSpellerRule.ts');
      rule = new MorfologikAmericanSpellerRule(messages, lang);
    } catch (e) {
      console.log('MultitokenSpeller test skipped: ' + (e as Error).message);
      ctx.skip();
      return;
    }
    // a language whose default spelling rule is the American speller (the test language has none)
    const withSpeller = Object.create(lang) as typeof lang;
    withSpeller.getDefaultSpellingRule = () => rule as ReturnType<typeof lang.getDefaultSpellingRule>;
    const speller = new MultitokenSpeller(withSpeller, ['/en/multiwords.txt', '/spelling_global.txt']);
    expect(speller.getSuggestions('Ludwig van Beethovenn')).toEqual(['Ludwig van Beethoven']);
    // English.prepareLineForSpeller keeps the NNP "Los Ángeles" of multiwords.txt (the order of equally
    // distant candidates follows Java's HashMap order there, file order here)
    expect(speller.getSuggestions('Los Angelos').sort()).toEqual(['Los Angeles', 'Los Ángeles']);
    expect(speller.getSuggestions('Gabriel Garcia Marquez')).toEqual(['Gabriel García Márquez']);
    expect(speller.getSuggestions('Los Angeles')).toEqual([]);
  });
});

describe('EnglishNumberInWordFilterTest', () => {
  it('testFilter', async (ctx) => {
    let modules;
    try {
      await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/language/AmericanEnglish.ts');
      modules = await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishNumberInWordFilter.ts');
    } catch (e) {
      console.log('EnglishNumberInWordFilterTest skipped: ' + (e as Error).message);
      ctx.skip();
      return;
    }
    const lt = english().lt;
    const runFilter = (input: string, arg: string, newRepl: string, patternTokenPos: number, fromPos: number, toPos: number) => {
      const filter = new modules.EnglishNumberInWordFilter();
      const sentence = lt.getAnalyzedSentence(input);
      const match = new RuleMatch(new FakeRule(), sentence, fromPos, toPos, 'fake msg');
      const args = new Map([['word', arg]]);
      const matchTmp = filter.acceptRuleMatch(match, args, patternTokenPos, sentence.getTokensWithoutWhitespace(), null);
      expect(matchTmp).not.toBeNull();
      expect(matchTmp!.getSuggestedReplacements()).toContain(newRepl);
    };
    runFilter('Go0d morning, Potsdam.', 'Go0d', 'Good', 2, 0, 4);
  });
});

describe('English rule files with the ported filters', () => {
  const loaded: { grammar: AbstractPatternRule[]; style: AbstractPatternRule[]; missing: string[]; disambMissing: string[] } = {
    grammar: [], style: [], missing: [], disambMissing: [],
  };

  beforeAll(async () => {
    const { english: lang } = english();
    // the rules with chunk conditions need the chunker (the test language has none by default)
    await EnglishChunker.init();
    lang.setChunker(new EnglishChunker());
    for (const name of ['grammar.xml', 'style.xml'] as const) {
      const file = fileForResource('/org/languagetool/rules/en/' + name)!;
      const loader = new PatternRuleLoader();
      const rules = loader.getRules(readFileSync(file), file, lang);
      if (name === 'grammar.xml') loaded.grammar = rules; else loaded.style = rules;
      loaded.missing.push(...loader.getMissingFilterWarnings());
    }
    const disambFile = fileForResource('/org/languagetool/resource/en/disambiguation.xml')!;
    const disambLoader = new DisambiguationRuleLoader();
    disambLoader.getRules(readFileSync(disambFile), lang, disambFile);
    loaded.disambMissing = disambLoader.getMissingFilterWarnings();
    TestHackHelper.setJUnitTest(true);
  });

  afterAll(() => {
    TestHackHelper.setJUnitTest(false);
    english().english.setChunker(null);
  });

  it('registers every filter class the English rule files name', () => {
    for (const c of EN_FILTERS) expect(FilterRegistry.forName(c), c).not.toBeNull();
    expect(loaded.missing).toEqual([]);
    expect(loaded.disambMissing).toEqual([]);
  });

  it('finds the incorrect examples of the rules with date, ordinal, adverb, range and whitespace filters, and not the correct ones', () => {
    const failures: string[] = [];
    let rules = 0, examples = 0;
    for (const rule of [...loaded.grammar, ...loaded.style]) {
      const className = filterClassName(rule);
      if (className == null || !EXAMPLE_FILTERS.has(className)) continue;
      rules++;
      for (const ex of rule.getIncorrectExamples()) {
        examples++;
        const text = ex.getExample().replaceAll('<marker>', '').replaceAll('</marker>', '');
        const markerStart = ex.getExample().indexOf('<marker>');
        let matches: RuleMatch[];
        try {
          matches = rule.match(analyzed(text));
        } catch (e) {
          failures.push(`${rule.getFullId()}: exception ${(e as Error).message}: ${text}`);
          continue;
        }
        if (matches.length === 0) {
          failures.push(`${rule.getFullId()}: not found: ${ex.getExample()}`);
          continue;
        }
        // as PatternRuleTest: correction="" expects no suggestion
        const corrections = ex.getCorrections().filter((c) => c.length > 0);
        if (ex.getCorrections().length > 0 && markerStart >= 0) {
          const suggestions = matches[0]!.getSuggestedReplacements();
          if (JSON.stringify(suggestions) !== JSON.stringify(corrections)) {
            failures.push(`${rule.getFullId()}: suggestions ${JSON.stringify(suggestions)}, expected ${JSON.stringify(corrections)}: ${ex.getExample()}`);
          }
        }
      }
      for (const ex of rule.getCorrectExamples()) {
        examples++;
        const text = ex.getExample().replaceAll('<marker>', '').replaceAll('</marker>', '');
        try {
          const matches = rule.match(analyzed(text));
          if (matches.length > 0) failures.push(`${rule.getFullId()}: false alarm: ${text}`);
        } catch (e) {
          failures.push(`${rule.getFullId()}: exception ${(e as Error).message}: ${text}`);
        }
      }
    }
    console.log(`filtered rules: ${rules}, ${examples} examples, ${failures.length} failures`);
    for (const f of failures.slice(0, 40)) console.log('  ' + f);
    expect(rules).toBeGreaterThan(30);
    expect(failures).toEqual([]);
  });
});
