// The English spelling rules (AbstractEnglishSpellerRule and its variants), checked with a subset of
// upstream's MorfologikAmericanSpellerRuleTest, MorfologikBritishSpellerRuleTest and
// AbstractEnglishSpellerRuleTest (languagetool-language-modules/en/src/test), with
// org.languagetool.language.AmericanEnglish and BritishEnglish.
import { beforeAll, describe, expect, it } from 'vitest';
import { english } from './javarules/testEnglish.ts';
import '../../../src/languagetool/languagetool/languagetool-language-modules/en/language-module.ts';
import { JLanguageTool } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Languages } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import { UserConfig } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/UserConfig.ts';
import type { Rule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { SuggestedReplacement } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/SuggestedReplacement.ts';
import type { ResourceBundle } from '../../../src/languagetool/jdk/java/util/ResourceBundle.ts';
import { MorfologikAmericanSpellerRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/MorfologikAmericanSpellerRule.ts';
import { MorfologikBritishSpellerRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/MorfologikBritishSpellerRule.ts';

let messages: ResourceBundle;
let lt: JLanguageTool;
let rule: MorfologikAmericanSpellerRule;
let gbLt: JLanguageTool;
let gbRule: MorfologikBritishSpellerRule;

beforeAll(() => {
  const e = english();
  messages = e.messages;
  const us = Languages.getLanguageForShortCode('en-US');
  lt = new JLanguageTool(us);
  rule = new MorfologikAmericanSpellerRule(messages, us);
  const gb = Languages.getLanguageForShortCode('en-GB');
  gbLt = new JLanguageTool(gb);
  gbRule = new MorfologikBritishSpellerRule(messages, gb);
}, 60000);

function matches(text: string, r: Rule = rule, l: JLanguageTool = lt) {
  return r.match(l.getAnalyzedSentence(text));
}

/** AbstractEnglishSpellerRuleTest.assertFirstMatch */
function assertFirstMatch(r: Rule, l: JLanguageTool, text: string, ...expected: string[]) {
  const m = matches(text, r, l);
  expect(m.length, text).toBe(1);
  const suggestions = m[0]!.getSuggestedReplacements();
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions.slice(0, expected.length), text).toEqual(expected);
}

/** assertAllMatches */
function assertAllMatches(r: Rule, l: JLanguageTool, text: string, ...expected: string[]) {
  const m = matches(text, r, l);
  expect(m.length, text).toBe(1);
  expect(m[0]!.getSuggestedReplacements(), text).toEqual(expected);
}

/** MorfologikAmericanSpellerRuleTest.assertSuggestion: one match containing all expected suggestions */
function assertSuggestion(input: string, ...expected: string[]) {
  const m = matches(input);
  expect(m.length, input).toBe(1);
  const s = m[0]!.getSuggestedReplacements();
  for (const e of expected) expect(s, input).toContain(e);
}

describe('AbstractEnglishSpellerRuleTest.testNonVariantSpecificSuggestions', () => {
  const cases: [string, ...string[]][] = [
    ['teh', 'the'], ['seperate', 'separate'], ['definately', 'definitely'], ['recieve', 'receive'],
    ['offical', 'official'], ['managment', 'management'], ['goverment ', 'government'], ['Febuary', 'February'],
    ['enviroment', 'environment'], ['occurence', 'occurrence'], ['commision', 'commission'],
    ['assocation', 'association'], ['Cincinatti', 'Cincinnati'], ['milennium', 'millennium'],
    ['accomodation', 'accommodation'], ['foriegn', 'foreign'], ['chemcial', 'chemical'],
    ['developement', 'development'], ['maintainance', 'maintenance'], ['restaraunt', 'restaurant'],
    ['garentee', 'guarantee'], ['greatful', 'grateful'], ['hipocrit', 'hypocrite'], ['mischevious', 'mischievous'],
    ['hygeine', 'hygiene'], ['ur', 'your'], ['doublecheck', 'double-check'], ['alot', 'a lot'],
    ['speach', 'speech'], ['qualifys', 'qualifies'], ['nicefys', 'nicely'],
    ['vacume', 'value', 'volume', 'acute', 'vacuum'],
  ];
  for (const [variant, getRule, getLt] of [
    ['en-US', () => rule, () => lt], ['en-GB', () => gbRule, () => gbLt],
  ] as const) {
    it(`first suggestions (${variant})`, () => {
      for (const [text, ...expected] of cases) assertFirstMatch(getRule(), getLt(), text, ...expected);
    });
    it(`all suggestions (${variant})`, () => {
      assertAllMatches(getRule(), getLt(), 'campaignt', 'campaign', 'campaigns');
      assertAllMatches(getRule(), getLt(), 'campaignd', 'campaign', 'campaigns', 'campaigned');
      assertAllMatches(getRule(), getLt(), 'campaignll', 'campaign', 'campaigns', 'campaigned', 'campaigner');
      assertAllMatches(getRule(), getLt(), 'spreaded', 'spread', 'spreader');
      assertAllMatches(getRule(), getLt(), 'slimiar', 'similar', 'slimier');
      expect(matches("You couldn't; he didn't; it doesn't; they aren't; I hadn't; etc.", getRule(), getLt()).length).toBe(0);
    });
  }
});

describe('MorfologikAmericanSpellerRuleTest', () => {
  it('speling', () => {
    const m = matches('This is a speling mistake.');
    expect(m.length).toBe(1);
    expect(m[0]!.getFromPos()).toBe(10);
    expect(m[0]!.getToPos()).toBe(17);
    expect(m[0]!.getSuggestedReplacements()).toContain('spelling');
    expect(m[0]!.getSuggestedReplacements()).toContain('spieling');
  });

  it('testSuggestionForMisspelledHyphenatedWords', () => {
    assertSuggestion('one-diminensional', 'one-dimensional');
    assertSuggestion('parple-people-eater', 'purple-people-eater');
  });

  it('testVariantMessages', () => {
    const m = matches('This is a nice colour.');
    expect(m.length).toBe(1);
    expect(m[0]!.getMessage()).toContain('is British English');
    expect(m[0]!.getSuggestedReplacements()).toEqual(['color']);
    const m2 = matches('Colour is the British words.');
    expect(m2.length).toBe(1);
    expect(m2[0]!.getMessage()).toContain('is British English');
  });

  it('testUserDict', () => {
    const userConfig = new UserConfig(['mytestword', 'mytesttwo']);
    const r = new MorfologikAmericanSpellerRule(messages, lt.getLanguage(), null, userConfig, []);
    expect(matches('mytestword', r).length).toBe(0);
    expect(matches('mytesttwo', r).length).toBe(0);
    expect(matches('mytestthree', r).length).toBe(1);
  });

  it('testMorfologikSpeller', () => {
    expect(matches('mansplaining').length).toBe(0); // test merge of spelling.txt
    expect(matches("Qur'an").length).toBe(0);
    // test suggesting words with diacritics
    expect(matches('fianc')[0]!.getSuggestedReplacements()).toContain('fiancé');
    // correct sentences:
    for (const s of [
      'This is an example: we get behavior as a dictionary word.', "Why don't we speak today.",
      'An URL like http://sdaasdwe.com is no error.', "He doesn't know what to do.", ',', '123454',
      'I like my emoji 😾', 'μ', "Yes ma'am.", 'Yes ma’am.', "'twas but a dream of thee",
      "O'Connell, O’Connell, O'Connor, O’Neill", 'viva voce, a fortiori, in vitro', 'компьютерная',
      "At 3 o'clock.", 'At 3 o’clock.',
      // multiwords.txt
      "C'est la vie.", 'c’est la guerre!', 'Andorra la Vella is the capital and largest city of Andorra.', 'bona fides.',
      'doctor honoris causa',
      // hyphens - accept words if all their parts are okay:
      'A web-based software.', 'A web-feature-driven-car software.',
      // contractions with apostrophe
      "You're only foolin' round.", 'You’re only foolin’ round.', "This is freakin' hilarious.",
      "It's the meal that keeps on givin'.", "Don't Stop Believin'.",
    ]) {
      expect(matches(s).length, s).toBe(0);
    }
    assertSuggestion('Abu-Bakr', 'Abu Bakr');
    assertSuggestion('Abudhabi', 'Abu Dhabi');
    assertSuggestion('Casagrande', 'Casa Grande');
    assertSuggestion('ELPASO', 'El Paso');
    assertSuggestion('Eldorado', 'El Dorado');
    assertSuggestion('nom-de-plume', 'nom de plume');
    assertSuggestion('sui-generis', 'sui generis');
    assertSuggestion('Wiener-Neustadt', 'Wiener Neustadt');
    assertSuggestion('Zyklon-B', 'Zyklon B');

    const matches1 = matches('behaviour');
    expect(matches1.length).toBe(1);
    expect(matches1[0]!.getFromPos()).toBe(0);
    expect(matches1[0]!.getToPos()).toBe(9);
    expect(matches1[0]!.getSuggestedReplacements()[0]).toBe('behavior');

    expect(matches('aõh').length).toBe(1);
    expect(matches('a').length).toBe(0);

    const matches2 = matches('He teached us.');
    expect(matches2.length).toBe(1);
    expect(matches2[0]!.getFromPos()).toBe(3);
    expect(matches2[0]!.getToPos()).toBe(10);
    expect(matches2[0]!.getSuggestedReplacements()[0]).toBe('taught');

    expect(matches('A wxeb-based software.').length).toBe(1);
    expect(matches('A web-baxsed software.').length).toBe(1);
    expect(matches('A web-feature-drivenx-car software.').length).toBe(1);

    assertAllMatches(rule, lt, 'robinson', 'Robinson', 'robin son', 'robins on', 'Robson', 'Robeson', 'robins', 'Roberson', 'Robins');

    expect(matches("wrongwordin'").length).toBe(1);
    expect(matches('wrongwordin’').length).toBe(1);
  });

  it('testRuleWithWrongSplit', () => {
    const check = (text: string, count: number, idx: number, first: string, from?: number, to?: number) => {
      const m = matches(text);
      expect(m.length, text).toBe(count);
      expect(m[idx]!.getSuggestedReplacements()[0], text).toBe(first);
      if (from !== undefined) {
        expect(m[idx]!.getFromPos(), text).toBe(from);
        expect(m[idx]!.getToPos(), text).toBe(to);
      }
      return m;
    };
    check('But than kyou for the feedback', 1, 0, 'thank you', 4, 13);
    check('But thanky ou for the feedback', 1, 0, 'thank you', 4, 13);
    check('But thank you for th efeedback', 1, 0, 'the feedback', 18, 30);
    check('But thank you for thef eedback', 1, 0, 'the feedback', 18, 30);
    const m5 = check('But thnk you fo rthe feedback', 2, 0, 'tank');
    expect(m5[1]!.getSuggestedReplacements()).toEqual(['for the']);
    expect(m5[1]!.getFromPos()).toBe(13);
    expect(m5[1]!.getToPos()).toBe(20);
    check('LanguageTol offer sspell checking', 2, 0, 'LanguageTool');
    check('LanguageTol offer sspell checking', 2, 1, 'offers spell', 12, 24);
    check("I'm g oing", 1, 0, 'going', 4, 10);
    check("I'm go ing", 1, 0, 'going', 4, 10);
    check('to thow', 1, 0, 'show', 3, 7);
    check('dditionally, this is it.', 1, 0, 'Additionally', 0, 11);
  });

  it('testSuggestionForIrregularWords', () => {
    assertSuggestion('He teached us.', 'taught');
    assertSuggestion('He buyed the wrong brand', 'bought');
    assertSuggestion('I thinked so.', 'thought');
    assertSuggestion('She becomed', 'became');
    assertSuggestion('It begined', 'began');
    assertSuggestion('It bited', 'bit');
    assertSuggestion('She dealed', 'dealt');
    assertSuggestion('She drived', 'drove');
    assertSuggestion('He drawed', 'drew');
    assertSuggestion('She finded', 'found');
    assertSuggestion('It hurted', 'hurt');
    assertSuggestion('It was keeped', 'kept');
    assertSuggestion('He maked', 'made');
    assertSuggestion('She runed', 'ran');
    assertSuggestion('She selled', 'sold');
    assertSuggestion('He speaked', 'spoke');
    assertSuggestion('auditory stimuluses', 'stimuli');
    assertSuggestion('analysises', 'analyses');
    assertSuggestion('parenthesises', 'parentheses');
    assertSuggestion('childs', 'children');
    assertSuggestion('womans', 'women');
    assertSuggestion('gooder', 'better');
    assertSuggestion('bader', 'worse');
    assertSuggestion('farer', 'further', 'farther');
    assertSuggestion('goodest', 'best');
    assertSuggestion('badest', 'worst');
    assertSuggestion('farest', 'furthest', 'farthest');
    expect(matches('He teached us.')[0]!.getMessage()).toBe(
      "Possible spelling mistake. Did you mean <suggestion>taught</suggestion>, the past tense form of the verb 'teach'?");
  });

  it('testIsMisspelled', () => {
    expect(rule.isMisspelled('sdadsadas')).toBe(true);
    expect(rule.isMisspelled('bicylce')).toBe(true);
    expect(rule.isMisspelled('tabble')).toBe(true);
    expect(rule.isMisspelled('tabbles')).toBe(true);
    expect(rule.isMisspelled('bicycle')).toBe(false);
    expect(rule.isMisspelled('table')).toBe(false);
    expect(rule.isMisspelled('tables')).toBe(false);
  });

  it('testGetOnlySuggestions', () => {
    // protected in TypeScript; the Java test is in the same package
    const only = (w: string) => (rule as unknown as { getOnlySuggestions(w: string): SuggestedReplacement[] }).getOnlySuggestions(w);
    expect(only('cemetary').length).toBe(1);
    expect(only('cemetary')[0]!.getReplacement()).toBe('cemetery');
    expect(only('Cemetary').length).toBe(1);
    expect(only('Cemetary')[0]!.getReplacement()).toBe('Cemetery');
    const m = matches('cemetary');
    expect(m.length).toBe(1);
    expect(m[0]!.getSuggestedReplacements()).toEqual(['cemetery']);
  });
});

describe('MorfologikBritishSpellerRuleTest', () => {
  const gbMatches = (text: string) => matches(text, gbRule, gbLt);

  it('testVariantMessages', () => {
    const m = gbMatches('This is a nice color.');
    expect(m.length).toBe(1);
    expect(m[0]!.getMessage()).toContain('is American English');
    const m2 = gbMatches('Color is the American English word.');
    expect(m2.length).toBe(1);
    expect(m2[0]!.getMessage()).toContain('is American English');
  });

  it('testMorfologikSpeller', () => {
    for (const s of [
      'This is an example: we get behaviour as a dictionary word.', "Why don't we speak today.",
      "He doesn't know what to do.", 'The entrée at the café.', 'This is my Ph.D. thesis.', ',', '123454', 'μ',
      'Ménage à trois', 'ménage à trois', 'The quid pro quo', "Ma'am, O'Connell, O’Connell, O'Connor, O’Neill",
    ]) {
      expect(gbMatches(s).length, s).toBe(0);
    }
    const matches1 = gbMatches('Behavior');
    expect(matches1.length).toBe(1);
    expect(matches1[0]!.getFromPos()).toBe(0);
    expect(matches1[0]!.getToPos()).toBe(8);
    expect(matches1[0]!.getSuggestedReplacements()[0]).toBe('Behaviour');

    expect(gbMatches('aõh').length).toBe(1);
    expect(gbMatches('a').length).toBe(0);

    const matches2 = gbMatches('He teached us.');
    expect(matches2.length).toBe(1);
    expect(matches2[0]!.getFromPos()).toBe(3);
    expect(matches2[0]!.getToPos()).toBe(10);
    expect(matches2[0]!.getSuggestedReplacements()[0]).toBe('taught');

    const matches3 = gbMatches("I'm g oing");
    expect(matches3.length).toBe(1);
    expect(matches3[0]!.getSuggestedReplacements()[0]).toBe('going');
    expect(matches3[0]!.getSuggestedReplacements()[1]).toBe('g going');
    expect(matches3[0]!.getFromPos()).toBe(4);
    expect(matches3[0]!.getToPos()).toBe(10);

    // custom URLs
    const matches4 = gbMatches('archeological');
    expect(matches4[0]!.getUrl()).toBe(
      'https://languagetool.org/insights/post/our-or/#likeable-vs-likable-judgement-vs-judgment-oestrogen-vs-estrogen');
  });
});
