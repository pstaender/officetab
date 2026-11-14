// SPDX-License-Identifier: MPL-2.0
// The replace, coherency, specific-case, dash, compound and wrong-word-in-context rules, checked
// with LanguageTool's own unit tests: AbstractSimpleReplaceRule2Test, CompoundRuleTest
// (AbstractCompoundRuleTest), ContractionSpellingRuleTest, EnglishWrongWordInContextRuleTest,
// EnglishDashRuleTest, WordCoherencyRuleTest, EnglishSpecificCaseRuleTest, AmericanReplaceRuleTest,
// BritishReplaceRuleTest, NewZealandReplaceRuleTest. Imported by javarules.test.ts.
// The variant replace rules need org.languagetool.language.{American,British,NewZealand}English
// (ported separately); their tests are skipped until those modules exist.
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { english } from './testEnglish.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import { DefaultResourceDataBroker } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/broker/DefaultResourceDataBroker.ts';
import type { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { AbstractSimpleReplaceRule2, CaseSensitivy } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import type { AbstractCompoundRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/AbstractCompoundRule.ts';
import { Locale } from '../../../../src/languagetool/jdk/java/util/Locale.ts';
import { CompoundRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/CompoundRule.ts';
import { ContractionSpellingRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/ContractionSpellingRule.ts';
import { EnglishWrongWordInContextRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishWrongWordInContextRule.ts';
import { EnglishDashRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishDashRule.ts';
import { WordCoherencyRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/WordCoherencyRule.ts';
import { EnglishSpecificCaseRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishSpecificCaseRule.ts';
import { SimpleReplaceRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/SimpleReplaceRule.ts';
import { SimpleReplaceProfanityRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/SimpleReplaceProfanityRule.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const EN_RULES = resolve(ROOT, 'src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool');
const hasLanguage = (name: string) => existsSync(resolve(EN_RULES, 'language', name + '.ts'));

/** Whether the English language modules load (they are ported separately and import all English rules). */
async function languagesLoad(): Promise<boolean> {
  try {
    await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/language/AmericanEnglish.ts');
    return true;
  } catch (e) {
    console.warn('English language modules do not load yet, skipping: ' + String(e));
    return false;
  }
}

let lt: JLanguageTool;
let lang: Language;

beforeAll(() => {
  ({ lt, english: lang } = english());
});

const match = (rule: Rule, text: string): RuleMatch[] => rule.match(lt.getAnalyzedSentence(text));

/** TestTools.disableAllRulesExcept */
function disableAllRulesExcept(tool: JLanguageTool, ruleId: string): void {
  for (const rule of tool.getAllRules()) {
    if (rule.getId() !== ruleId) tool.disableRule(rule.getId());
  }
}

// ------------------------------------------------------------------ AbstractSimpleReplaceRule2Test

class MyCaseSensitiveRule extends AbstractSimpleReplaceRule2 {
  override getFileNames(): string[] { return ['/xx/abstract_simple_replace2.txt']; }
  override getId(): string { return 'ABSTRACT_TEST_RULE'; }
  override getDescription(): string { return 'internal test rule'; }
  override getShort(): string { return 'internal test rule'; }
  override getMessage(): string { return 'fake suggestion'; }
  override getSuggestionsSeparator(): string { return ','; }
  override getLocale(): Locale { return Locale.ENGLISH; }
  override getCaseSensitivy(): CaseSensitivy { return CaseSensitivy.CS; }
}

class MyCaseInsensitiveRule extends MyCaseSensitiveRule {
  override getCaseSensitivy(): CaseSensitivy { return CaseSensitivy.CI; }
}

describe('AbstractSimpleReplaceRule2Test', () => {
  it('testRule', () => {
    // the test resource of languagetool-core (the Demo language is English here)
    const broker = JLanguageTool.getDataBroker() as DefaultResourceDataBroker;
    broker.put('/org/languagetool/rules/xx/abstract_simple_replace2.txt', new Uint8Array(readFileSync(resolve(ROOT,
      'upstream/languagetool/languagetool/languagetool-core/src/test/resources/org/languagetool/rules/xx/abstract_simple_replace2.txt'))));
    const csRule = new MyCaseSensitiveRule(JLanguageTool.getMessageBundle(), lang);
    expect(match(csRule, 'But a propos').length).toBe(1);
    expect(match(csRule, 'But A propos').length).toBe(0);
    expect(match(csRule, 'A propos').length).toBe(0);
    expect(match(csRule, 'a propos').length).toBe(1);
    expect(match(csRule, 'A Pokemon').length).toBe(1);
    expect(match(csRule, 'A pokemon').length).toBe(0);
    const ciRule = new MyCaseInsensitiveRule(JLanguageTool.getMessageBundle(), lang);
    expect(match(ciRule, 'But a propos').length).toBe(1);
    expect(match(ciRule, 'But A propos').length).toBe(1);
    expect(match(ciRule, 'A propos').length).toBe(1);
    expect(match(ciRule, 'a propos').length).toBe(1);
    expect(match(ciRule, 'A Pokemon').length).toBe(1);
    expect(match(ciRule, 'A pokemon').length).toBe(1);
  });
});

// ------------------------------------------------------------------ CompoundRuleTest

describe('CompoundRuleTest', () => {
  let rule: AbstractCompoundRule;

  /** AbstractCompoundRuleTest.check */
  function check(expectedErrors: number, text: string, ...expSuggestions: string[]): void {
    const ruleMatches = rule.match(lt.getAnalyzedSentence(text));
    expect(ruleMatches.length, 'Expected ' + expectedErrors + ' error(s), but got: ' + ruleMatches.join(', ') + ' for ' + text).toBe(expectedErrors);
    if (expSuggestions.length > 0) {
      expect(ruleMatches[0]!.getSuggestedReplacements(), text).toEqual(expSuggestions);
    }
  }

  beforeAll(() => {
    const en = Languages.getLanguageForShortCode('en-US');
    rule = new CompoundRule(english().messages, en, null);
    if (en.getDefaultSpellingRule() == null) {
      // no speller yet (the English speller is ported separately): accept every suggestion
      rule.isMisspelled = () => false;
    }
  });

  it('testRule', () => {
    // correct sentences:
    check(0, 'The software supports case-sensitive search.');
    check(0, 'He is one-year-old.');
    check(0, "If they're educated people, they will know.");
    check(0, 'Tiffany & Co chairman has to say something important');
    check(0, 'Another one bites the dust');
    check(0, 'We well received your email');
    check(0, 'air-to-air');
    check(0, 'non-party');
    check(0, 'age-old');
    check(0, 'able-bodied');
    check(0, 'non-scientific');
    check(0, 'This is the first ever green bond by a municipality.');
    check(0, 'Semi Automatic'); // desired?
    check(0, 'Night Mare'); // desired?
    check(0, 'This is a multi-module project.'); // #9502

    // incorrect sentences:
    check(1, 'case sensitive', 'case-sensitive');
    check(1, 'Young criminals must be re educated.');
    check(1, 'And an other one bites the dust');
    check(1, 'An other one bites the dust');

    check(1, 'good-bye', 'goodbye'); //?
    check(1, 'back-fire', 'backfire'); //+
    check(1, 'back fire', 'backfire');
    check(1, 'air-to air', 'air-to-air');
    check(1, 'air to air', 'air-to-air');
    check(1, 'air to-air', 'air-to-air');
    check(1, 'air to -air', 'air-to-air');
    check(1, 'age old', 'age-old');
    check(1, 'able bodied', 'able-bodied');
    check(1, 'non scientific', 'non-scientific', 'nonscientific');
    check(1, 'night-mare', 'nightmare');
    check(1, 'Night-mare', 'Nightmare');
    check(1, 'Night mare', 'Nightmare');
    check(1, 'semi automatic', 'semi-automatic', 'semiautomatic');
    check(1, 'Semi automatic', 'Semi-automatic', 'Semiautomatic');
    check(1, 'Dev-Ops', 'DevOps');
    check(1, 'Dev Ops', 'DevOps');
    check(1, 'Night-mare', 'Nightmare');
    check(1, 'Play Station', 'PlayStation');
    check(1, 'Play-Station', 'PlayStation');
  });

  it('testAllCompounds (loads compounds.txt, merges every compound)', () => {
    const data = rule.getCompoundRuleData();
    expect(data.getIncorrectCompounds().size).toBeGreaterThan(1000);
    for (const compound of data.getIncorrectCompounds()) {
      if (data.getJoinedSuggestion().has(compound)) {
        rule.mergeCompound(compound, data.getJoinedLowerCaseSuggestion().has(compound));
      }
    }
  });
});

// ------------------------------------------------------------------ ContractionSpellingRuleTest

describe('ContractionSpellingRuleTest', () => {
  let rule: ContractionSpellingRule;
  beforeAll(() => {
    rule = new ContractionSpellingRule(english().messages, lt.getLanguage());
  });

  function checkSimpleReplaceRule(sentence: string, word: string): void {
    const matches = match(rule, sentence);
    expect(matches.length, 'Invalid matches.length while checking sentence: ' + sentence).toBe(1);
    expect(matches[0]!.getSuggestedReplacements().length, 'Invalid replacement count wile checking sentence: ' + sentence).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()[0], 'Invalid suggested replacement while checking sentence: ' + sentence).toBe(word);
  }

  it('testRule', () => {
    // correct sentences:
    expect(match(rule, "It wasn't me.").length).toBe(0);
    expect(match(rule, "I'm ill.").length).toBe(0);
    expect(match(rule, 'Staatszerfall im südlichen Afrika.').length).toBe(0);
    expect(match(rule, 'by IVE').length).toBe(0);
    expect(match(rule, 'Never mind the whys and wherefores.').length).toBe(0);

    // incorrect sentences:
    // at the beginning of a sentence
    checkSimpleReplaceRule('Wasnt this great', "Wasn't");
    checkSimpleReplaceRule('YOURE WRONG', "YOU'RE");
    checkSimpleReplaceRule('Dont do this', "Don't");
    //checkSimpleReplaceRule("Ive been doing", "I've");
    // inside sentence
    checkSimpleReplaceRule('It wasnt me', "wasn't");
    checkSimpleReplaceRule('You neednt do this', "needn't");
    checkSimpleReplaceRule('I know Im wrong', "I'm");
    //two suggestions
    const matches = match(rule, 'Whereve you are');
    expect(matches[0]!.getSuggestedReplacements().length).toBe(2);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe("Where've");
    expect(matches[0]!.getSuggestedReplacements()[1]).toBe('Wherever');
  });
});

// ------------------------------------------------------------------ EnglishWrongWordInContextRuleTest

describe('EnglishWrongWordInContextRuleTest', () => {
  let rule: EnglishWrongWordInContextRule;
  beforeAll(() => {
    rule = new EnglishWrongWordInContextRule(null, lang);
  });
  const assertGood = (s: string) => expect(match(rule, s).length, s).toBe(0);
  const assertBad = (s: string) => expect(match(rule, s).length, s).toBe(1);

  it('testRule', () => {
    // prescribe/proscribe
    assertBad('I have proscribed you a course of antibiotics.');
    assertGood('I have prescribed you a course of antibiotics.');
    assertGood('Name one country that does not proscribe theft.');
    assertBad('Name one country that does not prescribe theft.');
    expect(match(rule, 'I have proscribed you a course of antibiotics.')[0]!.getSuggestedReplacements()[0]).toBe('prescribed');
    // herion/heroine
    assertBad('We know that heroine is highly addictive.');
    assertGood('He wrote about his addiction to heroin.');
    assertGood('A heroine is the principal female character in a novel.');
    assertBad('A heroin is the principal female character in a novel.');
    // bizarre/bazaar
    assertBad('What a bazaar behavior!');
    assertGood('I bought these books at the church bazaar.');
    assertGood('She has a bizarre haircut.');
    assertBad('The Saturday morning bizarre is worth seeing even if you buy nothing.');
    // bridal/bridle
    assertBad('The bridle party waited on the lawn.');
    assertGood('Forgo the champagne treatment a bridal boutique often provides.');
    assertGood('He sat there holding his horse by the bridle.');
    assertBad('Each rider used his own bridal.');
    // desert/dessert
    assertBad('They have some great deserts on this menu.');
    assertGood('They have some great desserts on this menu.');
    // statute/statue
    assertBad('They have some great marble statutes.');
    assertGood('They have a great marble statue.');
    // neutron/neuron
    assertGood('Protons and neutrons');
    assertBad('Protons and neurons');
    // hangar / hanger
    // neutron/neuron
    assertBad('The plane taxied to the hanger.');
    assertGood('The plane taxied to the hangar.');
  });
});

// ------------------------------------------------------------------ EnglishDashRuleTest

describe('EnglishDashRuleTest', () => {
  let rule: EnglishDashRule;
  beforeAll(() => {
    rule = new EnglishDashRule(JLanguageTool.getMessageBundle(lang));
  });

  function check(expectedErrors: number, text: string, expectedSuggestion: string | null = null): void {
    const ruleMatches = match(rule, text);
    expect(ruleMatches.length, 'Expected ' + expectedErrors + ' errors, but got: ' + ruleMatches.join(', ')).toBe(expectedErrors);
    if (expectedSuggestion != null) {
      expect(ruleMatches[0]!.getSuggestedReplacements()).toEqual([expectedSuggestion]);
    }
  }

  it('testRule', () => {
    // correct sentences:
    check(0, 'This is my T-shirt.');
    check(0, 'This is water-proof.');
    check(0, 'This works semi-automatically.');
    check(0, "She's a newcomer.");   // compounds.txt: "new-comer+"
    check(0, 'I sent you and e-mail.');   // compounds.txt: "e-mail"
    // incorrect sentences:
    check(1, 'T – shirt', 'T-shirt');
    check(1, 'three–way street', 'three-way');
    check(1, 'surface — to — surface', 'surface-to-surface');
    check(1, 'This works semi–automatically.', 'semi-automatically');  // compounds.txt: "semi-automatic$" and "semi-automatically$"
    check(1, 'This works semi – automatically.', 'semi-automatically');
    check(1, 'I sent you and e–mail.', 'e-mail');   // compounds.txt: "e-mail"
  });
});

// ------------------------------------------------------------------ WordCoherencyRuleTest

describe('WordCoherencyRuleTest', () => {
  let tool: JLanguageTool;
  beforeAll(() => {
    tool = new JLanguageTool(lang);
    tool.addRule(new WordCoherencyRule(english().messages));
    disableAllRulesExcept(tool, 'EN_WORD_COHERENCY');
  });
  const assertGood = (s: string) => expect(new WordCoherencyRule(english().messages).match(tool.analyzeText(s)).length, s).toBe(0);
  const assertError = (s: string) => expect(new WordCoherencyRule(english().messages).match(tool.analyzeText(s)).length, s).toBe(1);

  it('testRule', () => {
    // correct sentences:
    assertGood('He likes archeology. She likes archeology, too.');
    assertGood('He likes archaeology. She likes archaeology, too.');
    // errors:
    assertError('He likes archaeology. She likes archeology, too.');

    const matches1 = tool.check('He is reelected, or he will be re-elected.');
    expect(matches1.length).toBe(1);
    expect(matches1[0]!.getFromPos()).toBe(31);
    expect(matches1[0]!.getToPos()).toBe(41);
    expect(matches1[0]!.getSuggestedReplacements()).toEqual(['reelected']);

    const matches2 = tool.check('He was reelected, and I will re-elect him again in 2002.');
    expect(matches2.length).toBe(1);
    expect(matches2[0]!.getFromPos()).toBe(29);
    expect(matches2[0]!.getToPos()).toBe(37);
    expect(matches2[0]!.getSuggestedReplacements()).toEqual(['reelect']);

    const matches3 = tool.check('He oxidises o, or he oxidizes');
    expect(matches3.length).toBe(1);
    expect(matches3[0]!.getFromPos()).toBe(21);
    expect(matches3[0]!.getToPos()).toBe(29);
    expect(matches3[0]!.getSuggestedReplacements()).toEqual(['oxidises']);
  });

  it('testCallIndependence', () => {
    assertGood('He likes archaeology.');
    assertGood('She likes archeology, too.');  // this won't be noticed, the calls are independent of each other
  });

  it('testMatchPosition', () => {
    const ruleMatches = tool.check('He likes archaeology. She likes archeology, too.');
    expect(ruleMatches.length).toBe(1);
    expect(ruleMatches[0]!.getFromPos()).toBe(32);
    expect(ruleMatches[0]!.getToPos()).toBe(42);
  });

  it('testRuleCompleteTexts', () => {
    expect(tool.check('He likes archaeology. Really? She likes archaeology, too.').length).toBe(0);
    expect(tool.check('He likes archaeology. Really? She likes archeology, too.').length).toBe(1);
    expect(tool.check('He likes archeology. Really? She likes archaeology, too.').length).toBe(1);
    expect(tool.check('Mix of upper case and lower case: Westernize and westernise.').length).toBe(1);
  });
});

// ------------------------------------------------------------------ EnglishSpecificCaseRuleTest

describe('EnglishSpecificCaseRuleTest', () => {
  let rule: EnglishSpecificCaseRule;
  beforeAll(() => {
    rule = new EnglishSpecificCaseRule(english().messages);
  });
  const assertGood = (s: string) => expect(match(rule, s).length, s).toBe(0);
  const assertBad = (s: string): RuleMatch[] => {
    const matches = match(rule, s);
    expect(matches.length, s).toBe(1);
    return matches;
  };

  it('testRule', () => {
    assertGood('Harry Potter');
    assertGood('I like Harry Potter.');
    assertGood('I like HARRY POTTER.');
    assertBad('harry potter');
    assertBad('harry Potter');
    assertBad('Harry potter');
    const matches1 = assertBad('I like Harry potter.');
    expect(matches1[0]!.getFromPos()).toBe(7);
    expect(matches1[0]!.getToPos()).toBe(19);
    expect(matches1[0]!.getSuggestedReplacements()).toEqual(['Harry Potter']);
    expect(matches1[0]!.getMessage()).toBe('If the term is a proper noun, use initial capitals.');

    const matches2 = assertBad('Alexander The Great');
    expect(matches2[0]!.getMessage()).toBe('If the term is a proper noun, use the suggested capitalization.');

    const matches3 = assertBad('I like Harry  potter.');  // note the two spaces
    expect(matches3[0]!.getFromPos()).toBe(7);
    expect(matches3[0]!.getToPos()).toBe(20);
  });
});

// ------------------------------------------------------------------ SimpleReplaceRule, SimpleReplaceProfanityRule (no upstream tests: the rules' examples)

describe('SimpleReplaceRule and SimpleReplaceProfanityRule', () => {
  it('load their files and find a replacement', () => {
    const rule = new SimpleReplaceRule(english().messages, lang);
    expect(rule.getWrongWords()[0]!.size + rule.getWrongWords()[1]!.size).toBeGreaterThan(100);
    expect(match(rule, 'This is a perfectly fine sentence.').length).toBe(0);
    // replace.txt: "disencourage=discourage", "crohns disease|...=Crohn's disease"
    let matches = match(rule, 'Do not disencourage them.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()).toEqual(['discourage']);
    expect(matches[0]!.getRule().getId()).toBe('EN_SIMPLE_REPLACE_DISENCOURAGE');
    matches = match(rule, 'She has chrons disease.');
    expect(matches.map((m) => [m.getFromPos(), m.getToPos()])).toEqual([[8, 22]]);
    expect(matches[0]!.getSuggestedReplacements()).toEqual(["Crohn's disease"]);
    const profanity = new SimpleReplaceProfanityRule(english().messages, lang);
    expect(profanity.getWrongWords()[0]!.size + profanity.getWrongWords()[1]!.size).toBeGreaterThan(10);
    expect(match(profanity, 'This is a perfectly fine sentence.').length).toBe(0);
    expect(match(profanity, 'A pox on you.').length).toBe(1);
  });
});

// ------------------------------------------------------------------ American/British/NewZealandReplaceRuleTest

/** checkSimpleReplaceRule of the three tests */
function checkSimpleReplaceRule(rule: Rule, tool: JLanguageTool, sentence: string, word: string): void {
  const matches = rule.match(tool.getAnalyzedSentence(sentence));
  expect(matches.length, 'Invalid matches.length while checking sentence: ' + sentence).toBe(1);
  expect(matches[0]!.getSuggestedReplacements().length, 'Invalid replacement count wile checking sentence: ' + sentence).toBe(1);
  expect(matches[0]!.getSuggestedReplacements()[0], 'Invalid suggested replacement while checking sentence: ' + sentence).toBe(word);
}

describe.skipIf(!hasLanguage('AmericanEnglish'))('AmericanReplaceRuleTest', () => {
  it('testRule', async (ctx) => {
    if (!await languagesLoad()) return ctx.skip();
    const { AmericanReplaceRule } = await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/AmericanReplaceRule.ts');
    const rule = new AmericanReplaceRule(english().messages, '/en/en-US/replace.txt');
    // correct sentences:
    expect(match(rule, 'Buy some gasoline.').length).toBe(0);
    // incorrect sentences:
    // expression
    checkSimpleReplaceRule(rule, lt, 'I love fish fingers.', 'fish sticks');
  });
});

describe.skipIf(!hasLanguage('BritishEnglish'))('BritishReplaceRuleTest', () => {
  it('testRule', async (ctx) => {
    if (!await languagesLoad()) return ctx.skip();
    const { BritishReplaceRule } = await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/BritishReplaceRule.ts');
    const rule = new BritishReplaceRule(english().messages, '/en/en-GB/replace.txt');
    // correct sentences:
    expect(match(rule, 'Buy some petrol.').length).toBe(0);
    // incorrect sentences:
    // at the beginning of a sentence (Romanian replace rule is case-sensitive)
    checkSimpleReplaceRule(rule, lt, 'Diapers for sale!', 'Nappies');
    // inside sentence
    checkSimpleReplaceRule(rule, lt, 'We have some diapers for sale.', 'nappies');
    // expression
    checkSimpleReplaceRule(rule, lt, 'Everyone loves cotton candy.', 'candy floss');
  });
});

describe.skipIf(!hasLanguage('NewZealandEnglish'))('NewZealandReplaceRuleTest', () => {
  it('testRule', async (ctx) => {
    if (!await languagesLoad()) return ctx.skip();
    const { NewZealandReplaceRule } = await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/NewZealandReplaceRule.ts');
    const rule = new NewZealandReplaceRule(english().messages, '/en/en-NZ/replace.txt');
    // correct sentences:
    expect(match(rule, 'Walk on the footpath.').length).toBe(0);
    // incorrect sentences:

    // at the beginning of a sentence (Romanian replace rule is case-sensitive)
    checkSimpleReplaceRule(rule, lt, 'Sidewalk is not a place to park your car!', 'Footpath');
    // inside sentence
    checkSimpleReplaceRule(rule, lt, 'I walked on the sidewalk', 'footpath');
  });
});

describe.skipIf(!hasLanguage('English'))('EnglishDiacriticsRule, EnglishPlainEnglishRule, EnglishRedundancyRule (their examples)', () => {
  it('find their incorrect examples', async (ctx) => {
    if (!await languagesLoad()) return ctx.skip();
    const base = '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/';
    const { EnglishDiacriticsRule } = await import(base + 'EnglishDiacriticsRule.ts');
    const { EnglishPlainEnglishRule } = await import(base + 'EnglishPlainEnglishRule.ts');
    const { EnglishRedundancyRule } = await import(base + 'EnglishRedundancyRule.ts');
    for (const rule of [new EnglishDiacriticsRule(english().messages), new EnglishPlainEnglishRule(english().messages),
      new EnglishRedundancyRule(english().messages)] as Rule[]) {
      for (const example of rule.getIncorrectExamples()) {
        const text = example.getExample().replace(/<\/?marker>/g, '');
        expect(match(rule, text).length, rule.getId() + ': ' + text).toBe(1);
        // an example that is a whole sentence ("blase") gets its suggestion capitalized at the
        // sentence start, as in Java (AbstractSimpleReplaceRule2.addRuleMatch)
        const lc = (l: readonly string[]) => l.map((x) => x.charAt(0).toLowerCase() + x.substring(1));
        expect(lc(match(rule, text)[0]!.getSuggestedReplacements()), rule.getId()).toEqual(lc(example.getCorrections()));
      }
    }
  });
});
