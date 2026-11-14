// The upstream unit tests of the repetition, bracket and quote rules (imported by
// javarules.test.ts): GenericUnpairedBracketsRuleTest, GenericUnpairedQuotesRuleTest,
// WordRepeatRuleTest (core and en), EnglishUnpairedBracketsRuleTest, EnglishUnpairedQuotesRuleTest,
// EnglishWordRepeatRuleTest, EnglishWordRepeatBeginningRuleTest, EnglishRepeatedWordsRuleTest,
// ConsistentApostrophesRuleTest. Differences: the core tests use FakeLanguage / Demo, here the
// English test language; tests that call lt.check() with all of English's rules check with only
// the rule under test (the other rules are ported and tested elsewhere).
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { english } from './testEnglish.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { AnnotatedTextBuilder } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/markup/AnnotatedTextBuilder.ts';
import type { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import type { TextLevelRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import { GenericUnpairedBracketsRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/GenericUnpairedBracketsRule.ts';
import { GenericUnpairedQuotesRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/GenericUnpairedQuotesRule.ts';
import { WordRepeatRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/WordRepeatRule.ts';
import { UnsyncStack } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/UnsyncStack.ts';
import { EnglishUnpairedBracketsRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishUnpairedBracketsRule.ts';
import { EnglishUnpairedQuotesRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishUnpairedQuotesRule.ts';
import { EnglishWordRepeatRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishWordRepeatRule.ts';
import { EnglishWordRepeatBeginningRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishWordRepeatBeginningRule.ts';
import { ConsistentApostrophesRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/ConsistentApostrophesRule.ts';
import { StyleTooOftenUsedVerbRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/StyleTooOftenUsedVerbRule.ts';
import { StyleTooOftenUsedNounRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/StyleTooOftenUsedNounRule.ts';
import { StyleTooOftenUsedAdjectiveRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/StyleTooOftenUsedAdjectiveRule.ts';

/** A JLanguageTool for English with all rules disabled and only the given rule added. */
function ltWithOnly(rule: Rule): JLanguageTool {
  const lt = new JLanguageTool(english().english);
  // the other rules are disabled; the language's own rule of the same id is replaced by this one
  lt.setRules(lt.getAllRules().filter((r) => r.getId() !== rule.getId()));
  for (const r of lt.getAllRules()) {
    lt.disableRule(r.getId());
  }
  lt.addRule(rule);
  return lt;
}

const messages = () => english().messages;
const lt = () => english().lt;

describe('UnsyncStackTest', () => {
  it('push, peek, pop, search', () => {
    const stack = new UnsyncStack<string>();
    expect(stack.empty()).toBe(true);
    stack.push('a');
    stack.push('b');
    expect(stack.peek()).toBe('b');
    expect(stack.search('a')).toBe(2);
    expect(stack.search('c')).toBe(-1);
    expect(stack.pop()).toBe('b');
    expect(stack.size()).toBe(1);
    expect(() => { stack.pop(); stack.pop(); }).toThrow('EmptyStackException');
  });
});

describe('GenericUnpairedBracketsRuleTest', () => {
  let check: JLanguageTool;
  const setUpRule = () => {
    check = ltWithOnly(new GenericUnpairedBracketsRule(messages(), ['»'], ['«']));
  };
  const assertMatches = (expectedMatches: number, input: string) => {
    expect(check.check(input).length, input).toBe(expectedMatches);
  };

  it('testRule', () => {
    setUpRule();
    assertMatches(0, 'This is »correct«.');
    assertMatches(0, '»Correct«\n»And »here« it ends.«');
    assertMatches(0, '»Correct. This is more than one sentence.«');
    assertMatches(0, '»Correct. This is more than one sentence.«\n»And »here« it ends.«');
    assertMatches(0, '»Correct«\n\n»And here it ends.«\n\nMore text.');
    assertMatches(0, "»Correct, he said. This is the next sentence.« Here's another sentence.");
    assertMatches(0, "»Correct, he said.\n\nThis is the next sentence.« Here's another sentence.");
    assertMatches(0, "»Correct, he said.\n\n\n\nThis is the next sentence.« Here's another sentence.");
    assertMatches(0, 'This »is also »correct««.');
    assertMatches(0, 'Good.\n\nThis »is also »correct««.');
    assertMatches(0, 'Good.\n\n\nThis »is also »correct««.');
    assertMatches(0, 'Good.\n\n\n\nThis »is also »correct««.');
    assertMatches(0, 'This is funny :-)');
    assertMatches(0, "This is sad :-( isn't it");
    assertMatches(0, 'This is funny :)');
    assertMatches(0, "This is sad :( isn't it");
    assertMatches(0, 'a) item one\nb) item two');
    assertMatches(0, 'a) item one\nb) item two\nc) item three');
    assertMatches(0, '\na) item one\nb) item two\nc) item three');
    assertMatches(0, '\n\na) item one\nb) item two\nc) item three');
    assertMatches(0, 'This is a), not b)');
    assertMatches(0, 'This is it (a, not b) some more test');
    assertMatches(0, 'This is »not an error yet');
    assertMatches(0, 'See https://de.wikipedia.org/wiki/Schlammersdorf_(Adelsgeschlecht)');

    assertMatches(1, 'This is not correct«');
    assertMatches(1, 'This is »not correct.');
    assertMatches(1, 'This is »not an error yet\n\nBut now it has become one');
    assertMatches(1, 'This is correct.\n\n»But this is not.');
    assertMatches(1, 'This is correct.\n\nBut this is not«');
    assertMatches(1, '»This is correct«\n\nBut this is not«');
    assertMatches(1, '»This is correct«\n\nBut this »is« not«');
    assertMatches(1, "This is not correct. No matter if it's more than one sentence«");
    assertMatches(1, "»This is not correct. No matter if it's more than one sentence");
    assertMatches(1, "Correct, he said. This is the next sentence.« Here's another sentence.");
    assertMatches(1, "»Correct, he said. This is the next sentence. Here's another sentence.");
    assertMatches(1, "»Correct, he said. This is the next sentence.\n\nHere's another sentence.");
    assertMatches(1, "»Correct, he said. This is the next sentence.\n\n\n\nHere's another sentence.");
  });

  it('testRuleMatchPositions', () => {
    setUpRule();
    const match1 = check.check('This »is a test.')[0]!;
    expect(match1.getFromPos()).toBe(5);
    expect(match1.getToPos()).toBe(6);
    expect(match1.getLine()).toBe(0);
    expect(match1.getEndLine()).toBe(0);
    expect(match1.getColumn()).toBe(5);
    expect(match1.getEndColumn()).toBe(6);

    const match2 = check.check('This.\nSome stuff.\nIt »is a test.')[0]!;
    expect(match2.getFromPos()).toBe(21);
    expect(match2.getToPos()).toBe(22);
    expect(match2.getLine()).toBe(2);  // first line is 0
    expect(match2.getEndLine()).toBe(2);
    expect(match2.getColumn()).toBe(4);
    expect(match2.getEndColumn()).toBe(5);

    const match3 = check.check('Th­is »is a test.')[0]!;
    expect(match3.getFromPos()).toBe(6);
    expect(match3.getToPos()).toBe(7);
  });
});

describe('GenericUnpairedQuotesRuleTest', () => {
  let check: JLanguageTool;
  const setUpRule = () => {
    check = ltWithOnly(new GenericUnpairedQuotesRule(messages(),
        ['»', '«', '"', "'", '›', '‹'], ['«', '»', '"', "'", '‹', '›']));
  };
  const assertMatches = (expectedMatches: number, input: string) => {
    expect(check.check(input).length, input).toBe(expectedMatches);
  };

  it('testRule', () => {
    setUpRule();
    assertMatches(0, 'This is »correct«.');
    assertMatches(0, 'This is «correct».');
    assertMatches(0, '»Correct«\n»And ›here‹ it ends.«');
    assertMatches(0, '«Correct»\n«And ‹here› it ends.»');
    assertMatches(0, '»Correct. This is more than one sentence.«');
    assertMatches(0, '»Correct. This is more than one sentence.«\n»And ›here‹ it ends.«');
    assertMatches(0, '»Correct«\n\n»And here it ends.«\n\nMore text.');
    assertMatches(0, "»Correct, he said. This is the next sentence.« Here's another sentence.");
    assertMatches(0, "»Correct«, he said.\n\n»This is the next sentence.« »Here's another sentence.«");
    assertMatches(0, "»Correct«, he said. »This is the next sentence.«\n»Here's another sentence.«");
    assertMatches(0, 'This »is also ›correct‹«.');
    assertMatches(0, 'Good.\n\nThis »is also ›correct‹«.');
    assertMatches(0, 'Good.\n\n\nThis »is also ›correct‹«.');
    assertMatches(0, 'Good.\n\n\n\nThis »is also ›correct‹«.');

    assertMatches(0, 'This is "correct".');
    assertMatches(0, "This is 'correct'.");
    assertMatches(0, '"Correct"\n"And \'here\' it ends."');
    assertMatches(0, '\'Correct\'\n\'And "here" it ends.\'');
    assertMatches(0, 'This "is also \'correct\'".');
    assertMatches(0, 'This isn\'t "incorrect".');
    assertMatches(0, '"This isn\'t incorrect."');
    assertMatches(0, 'The screen is 20" wide.');
    assertMatches(0, '"The screen is 20" wide."');

    assertMatches(1, 'This is not correct«');
    assertMatches(1, 'This is »not correct.');
    assertMatches(1, 'This is »not correct');
    assertMatches(1, 'This is »not an error yet\n\nBut now it has become one');
    assertMatches(1, 'This is correct.\n\n»But this is not.');
    assertMatches(1, 'This is correct.\n\nBut this is not«');
    assertMatches(1, '»This is correct«\n\nBut this is not«');
    assertMatches(1, '»This is correct«\n\nBut this »is« not«');
    assertMatches(1, "This is not correct. No matter if it's more than one sentence«");
    assertMatches(1, "»This is not correct. No matter if it's more than one sentence");
    assertMatches(1, "Correct, he said. This is the next sentence.« Here's another sentence.");
    assertMatches(1, "»Correct, he said. This is the next sentence. Here's another sentence.");
    assertMatches(1, "»Correct, he said. This is the next sentence.\n\nHere's another sentence.");
    assertMatches(1, "»Correct, he said. This is the next sentence.\n\n\n\nHere's another sentence.");

    assertMatches(2, '»Correct«\n»And »here« it ends with two matches.«');
    assertMatches(2, '»Correct. This is more than one sentence.«\n»And »here« it ends.«');
    assertMatches(2, 'Good.\n\nThis »is also »correct««.');
    assertMatches(2, 'Good.\n\n\nThis »is also »correct««.');
    assertMatches(2, 'Good.\n\n\n\nThis »is also »correct««.');
  });

  it('testRuleMatchPositions', () => {
    setUpRule();
    const match1 = check.check('This »is a test.')[0]!;
    expect(match1.getFromPos()).toBe(5);
    expect(match1.getToPos()).toBe(6);
    expect(match1.getLine()).toBe(0);
    expect(match1.getEndLine()).toBe(0);
    expect(match1.getColumn()).toBe(5);
    expect(match1.getEndColumn()).toBe(6);

    const match2 = check.check('This.\nSome stuff.\nIt »is a test.')[0]!;
    expect(match2.getFromPos()).toBe(21);
    expect(match2.getToPos()).toBe(22);
    expect(match2.getLine()).toBe(2);  // first line is 0
    expect(match2.getEndLine()).toBe(2);
    expect(match2.getColumn()).toBe(4);
    expect(match2.getEndColumn()).toBe(5);

    const match3 = check.check('Th­is »is a test.')[0]!;
    expect(match3.getFromPos()).toBe(6);
    expect(match3.getToPos()).toBe(7);
  });
});

describe('WordRepeatRuleTest (core)', () => {
  it('test', () => {
    const rule = new WordRepeatRule(messages(), english().english);
    const assertGood = (s: string) => expect(rule.match(lt().getAnalyzedSentence(s)).length, s).toBe(0);
    const assertBad = (s: string) => expect(rule.match(lt().getAnalyzedSentence(s)).length, s).toBe(1);
    assertGood('A test');
    assertGood('A test.');
    assertGood('A test...');
    assertGood('1 000 000 years');
    assertGood('010 020 030');
    //👍💚🌲🌲
    assertGood('👍💚🌲🌲');

    assertBad('A A test');
    assertBad('A a test');
    assertBad('This is is a test');
  });
});

describe('WordRepeatRuleTest (en)', () => {
  it('testRule', () => {
    const rule = new WordRepeatRule(messages(), english().english);
    const assertMatches = (input: string, expectedMatches: number) =>
      expect(rule.match(lt().getAnalyzedSentence(input)).length, input).toBe(expectedMatches);
    assertMatches('This is a test sentence.', 0);
    assertMatches('This is a test sentence...', 0);

    // make sure we ignore immunized tokens
    assertMatches('And side to side and top to bottom...', 0);

    assertMatches('This this is a test sentence.', 1);
    assertMatches('This is a test sentence sentence.', 1);
    assertMatches('This is is a a test sentence sentence.', 3);
  });
});

describe('EnglishUnpairedBracketsRuleTest', () => {
  const rule = (): TextLevelRule => new EnglishUnpairedBracketsRule(messages(), english().english);
  const count = (sentence: string) => rule().match([lt().getAnalyzedSentence(sentence)]).length;
  const assertCorrect = (sentence: string) => expect(count(sentence), sentence).toBe(0);
  const assertIncorrect = (sentence: string) => expect(count(sentence), sentence).toBe(1);
  const assertCorrectText = (sentences: string) => {
    const aText = new AnnotatedTextBuilder().addText(sentences).build();
    expect(rule().match(lt().analyzeText(sentences), aText).length, sentences).toBe(0);
  };

  it('testRule', () => {
    // correct sentences:
    assertCorrect('(This is a test sentence).');
    assertCorrect("This is a word 'test'.");
    assertCorrect('This is no smiley: (some more text)');
    assertCorrect('This is a sentence with a smiley :)');
    assertCorrect('This is a sentence with a smiley :(');
    assertCorrect('This is a sentence with a smiley :-)');
    assertCorrect('This is a sentence with a smiley ;-) and so on...');
    assertCorrect('This is a [test] sentence...');
    assertCorrect('The plight of Tamil refugees caused a surge of support from most of the Tamil political parties.[90]');
    assertCorrect('(([20] [20] [20]))');

    // test for a case that created a false alarm after disambiguation
    assertCorrect('This is a "special test", right?');
    // numerical bullets
    assertCorrect('We discussed this in Chapter 1).');
    assertCorrect('The jury recommended that: (1) Four additional deputies be employed.');
    assertCorrect('We discussed this in section 1a).');
    assertCorrect('We discussed this in section iv).');
    //some more cases
    assertCorrect("(Ketab fi Isti'mal al-'Adad al-Hindi)");
    assertCorrect("(al-'Adad al-Hindi)");
    assertCorrect("will-o'-the-wisp");
    assertCorrect('cat-o’-nine-tails');
    //TODO: ambiguous
    assertCorrect('a) item one\nb) item two\nc) item three');
    assertCorrectText('\n\n' +
                      'a) New York\n' +
                      'b) Boston\n');
    assertCorrectText('\n\n' +
        '1.) New York\n' +
        '2.) Boston\n');
    assertCorrectText('\n\n' +
        'XII.) New York\n' +
        'XIII.) Boston\n');
    assertCorrectText('\n\n' +
                      'A) New York\n' +
                      'B) Boston\n' +
                      'C) Foo\n');

    // incorrect sentences:
    assertIncorrect('(This is a test sentence.');
    assertCorrect('This is not so (neither a nor b');
    assertIncorrect('This is not so (neither a nor b.');
    assertIncorrect('This is not so neither a nor b)');
    assertIncorrect('This is not so neither foo nor bar)');

    // this is currently considered incorrect... although people often use smileys this way:
    assertCorrect('Some text (and some funny remark :-) with more text to follow');  //TODO: Why is this correct and the next one incorrect?
    assertIncorrect('Some text (and some funny remark :-) with more text to follow!');

    expect(count('(This is a test] sentence.')).toBe(2);
    expect(count('This [is (a test} sentence.')).toBe(3);
  });

  it('testMultipleSentences', () => {
    const check = ltWithOnly(rule());
    expect(check.check('This is multiple sentence text that contains a bracket: '
                     + '[This is a bracket. With some text.] and this continues.\n').length).toBe(0);
    expect(check.check('This is multiple sentence text that contains a bracket. '
                     + '(This is a bracket. \n\n With some text.) and this continues.').length).toBe(0);
    expect(check.check('This is multiple sentence text that contains a bracket: '
                     + '[This is a bracket. With some text. And this continues.\n\n').length).toBe(1);
  });
});

describe('EnglishUnpairedQuotesRuleTest', () => {
  const rule = (): TextLevelRule => new EnglishUnpairedQuotesRule(messages(), english().english);
  const count = (sentence: string) => rule().match([lt().getAnalyzedSentence(sentence)]).length;
  const assertCorrect = (sentence: string) => expect(count(sentence), sentence).toBe(0);
  const assertIncorrect = (sentence: string) => expect(count(sentence), sentence).toBe(1);

  it('testRule', () => {
    // correct sentences:
    assertCorrect("This is a word 'test'.");
    assertCorrect("I don't know.");
    assertCorrect("This is the joint presidents' declaration.");
    assertCorrect('The screen is 20"');
    assertCorrect('The screen is 20" wide.');
    assertIncorrect('The screen is very" wide.');
    assertCorrect('This is what he said: "We believe in freedom. This is what we do."');

    assertCorrect("He was an ol' man.");
    assertCorrect("'till the end.");
    assertCorrect("jack-o'-lantern");
    assertCorrect("jack o'lantern");
    assertCorrect("sittin' there");
    assertCorrect("Nothin'");
    assertCorrect("ya'");
    assertCorrect("I'm not goin'");
    assertCorrect("y'know");
    assertCorrect("Please find attached Fritz' revisions");
    assertCorrect("You're only foolin' round.");
    assertCorrect("I stayed awake 'till the morning.");
    assertCorrect("under the 'Global Markets' heading");
    assertCorrect("He's an 'admin'.");
    assertCorrect("However, he's still expected to start in the 49ers' next game on Oct.");
    assertCorrect("all of his great-grandfathers' names");
    assertCorrect("Though EES' past profits now are in question");
    assertCorrect("Networks' Communicator and FocusFocus' Conference.");
    assertCorrect("Additional funding came from MegaMags' founders and existing individual investors.");
    assertCorrect('al-Jazā’er');
    assertCorrect('second Mu’taq and third');
    assertCorrect("second Mu'taq and third");
    assertCorrect('The phrase ‘\\1 \\2’ is British English.');
    assertCorrect('The phrase ‘1 2’ is British English.');

    assertCorrect("22' N., long. ");
    assertCorrect("11º 22'");
    assertCorrect("11° 22'");
    assertCorrect("11° 22.5'");
    assertCorrect("In case I garbled mine, here 'tis.");
    assertCorrect("It's about three o’clock.");
    assertCorrect("It's about three o'clock.");
    assertCorrect('Rory O’More');
    assertCorrect("Rory O'More");
    assertCorrect('Côte d’Ivoire');
    assertCorrect("Côte d'Ivoire");
    assertCorrect('Colonel d’Aubigni');
    assertCorrect("They are members of the Bahá'í Faith.");


    // test for a case that created a false alarm after disambiguation
    assertCorrect('This is a "special test", right?');
    //inches exception shouldn't match " here:
    assertCorrect('In addition, the government would pay a $1,000 "cost of education" grant to the schools.');
    assertCorrect("Paradise lost to the alleged water needs of Texas' big cities Thursday.");
    assertCorrect("Kill 'em all!");
    assertCorrect("Puttin' on the Ritz");
    assertCorrect("Dunkin' Donuts");
    assertCorrect("Hold 'em!");
    //some more cases
    assertCorrect("(Ketab fi Isti'mal al-'Adad al-Hindi)");
    assertCorrect("(al-'Adad al-Hindi)");
    assertCorrect("On their 'host' societies.");
    assertCorrect("On their 'host society'.");
    assertCorrect("Burke-rostagno the Richard S. Burkes' home in Wayne may be the setting for the wedding reception for their daughter.");
    assertCorrect("The '49 team was off to a so-so 5-5 beginning");
    assertCorrect("The best reason that can be advanced for the state adopting the practice was the advent of expanded highway construction during the 1920s and '30s.");
    assertCorrect("A Republican survey says Kennedy won the '60 election on the religious issue.");
    assertCorrect('Economy class seats have a seat pitch of 31-33", with newer aircraft having thinner seats that have a 31" pitch.');
    assertCorrect('"02" will sort before "10" as expected so it will have size of 10".');
    assertCorrect('"02" will sort before "10" as expected so it will have size of 10"'); // inch symbol is at the sentence end
    assertCorrect('"02" will sort before "10"'); // quotation mark is at the sentence end
    assertCorrect("On their 'host societies'.");
    assertCorrect("On their host 'societies'.");
    assertIncorrect("On their 'host societies.");
    //TODO: ambiguous
    assertCorrect("On their host societies'.");
    assertCorrect('I think that Liszt\'s "Forgotten Waltz No.3" is a hidden masterpiece.');
    assertCorrect('I think that Liszt\'s "Forgotten Waltz No. 3" is a hidden masterpiece.');
    assertCorrect('Turkish distinguishes between dotted and dotless "I"s.');
    assertCorrect('It has recognized no "bora"-like pattern in his behaviour.'); //It's fixed with the new tokenizer

    // incorrect sentences:
    assertIncorrect("This is a test with an apostrophe &'.");
    //FIXME? assertIncorrect("&'");
    //FIXME? assertIncorrect("!'");
    //FIXME: assertIncorrect("What?'");
    assertIncorrect('He is making them feel comfortable all along."');
    assertIncorrect('"He is making them feel comfortable all along.');

    // this is currently considered incorrect... although people often use smileys this way:
    assertCorrect('Some text. This is "12345", a number.');
    assertCorrect('Some text.\n\nThis is "12345", a number.');
    assertCorrect('Some text. This is 12345", a number.');  // could be "inch", so no error
    assertCorrect('Some text. This is 12345", a number.');  // could be "inch", so no error
    assertCorrect('"When you bring someone," he said.\n' +
      'Gibson introduced the short-scale (30.5") bass in 1961.');  // could be "inch", so no error

    expect(count('"This is a test” sentence.')).toBe(2);
    expect(count('This "is \'a test” sentence.')).toBe(3);
  });

  it('testMultipleSentences', () => {
    const check = ltWithOnly(rule());
    expect(check.check('This is multiple sentence text that contains Quotes: '
                     + '"This is a bracket. With some text." and this continues.\n').length).toBe(0);
    expect(check.check('This is multiple sentence text that contains Quotes. '
                     + '“This is a bracket. \n\n With some text.” and this continues.').length).toBe(0);
    expect(check.check('This is multiple sentence text that contains a Quote: '
                     + '“This is a bracket. With some text. And this continues.\n\n').length).toBe(1);
  });
});

describe('EnglishWordRepeatRuleTest', () => {
  it('testRepeatRule', () => {
    const rule = new EnglishWordRepeatRule(messages(), english().english);
    const assertMatches = (sentence: string, expectedMatches: number) =>
      expect(rule.match(lt().getAnalyzedSentence(sentence)).length, sentence).toBe(expectedMatches);
    const assertGood = (sentence: string) => assertMatches(sentence, 0);
    const assertBad = (sentence: string) => assertMatches(sentence, 1);
    assertGood('This is a test.');
    assertGood('If I had had time, I would have gone to see him.');
    assertGood("I don't think that that is a problem.");
    assertGood('He also said that Azerbaijan had fulfilled a task he set, which was that that their defense budget should exceed the entire state budget of Armenia.');
    assertGood('Just as if that was proof that that English was correct.');
    assertGood('It was noticed after more than a month that that promise had not been carried out.');
    assertGood('It was said that that lady was an actress.');
    assertGood("Kurosawa's three consecutive movies after Seven Samurai had not managed to capture Japanese audiences in the way that that film had.");
    assertGood('The can can hold the water.');
    assertGood('May May awake up?');
    assertGood('May may awake up.');
    assertGood('The cat does meow meow');
    assertGood('Hah Hah');
    assertGood('Hip Hip Hooray');
    assertBad('Hip Hip');
    assertGood("It's S.T.E.A.M.");
    assertGood('Ok ok ok!');
    assertGood('O O O');
    assertGood('Alice and Bob had had a long-standing relationship.');
    assertBad('I may may awake up.');
    assertBad('That is May May.');
    assertGood('Will Will awake up?');
    assertGood('Will will awake up.');
    assertBad('I will will awake up.');
    assertBad('Please wait wait for me.');
    assertGood('Wait wait!');
    assertBad('That is Will Will.');
    assertBad('I will will hold the ladder.');
    assertBad('You can feel confident that that this administration will continue to support a free and open Internet.');
    assertBad('This is is a test.');
    assertGood('b a s i c a l l y');
    assertGood('You can contact E.ON on Instagram.');
    assertBad('But I i was not sure.');
    assertBad('I I am the best.');
    assertGood('In a land far far away.');
    assertGood('I love you so so much.');
    assertGood('Aye aye, sir!');
    assertGood("What Tom did didn't seem to bother Mary at all.");
    assertGood("Whatever you do don't leave the lid up on the toilet!");
    assertGood("Keep your chin up and whatever you do don't doubt yourself or your actions.");
    assertGood("I know that that can't really happen.");
    assertGood('Please pass her her phone.');
    assertGood('I have visited Bora Bora.');
  });
});

describe('EnglishWordRepeatBeginningRuleTest', () => {
  it('testRule', () => {
    const check = ltWithOnly(new EnglishWordRepeatBeginningRule(messages(), english().english));

    // ================== correct sentences ===================
    // two successive sentences that start with the same non-adverb word.
    expect(check.check('This is good. This is good, too.').length).toBe(0);
    // three successive sentences that start with the same exception word ("the").
    expect(check.check("The car. The bicycle. The third sentence with 'the'.").length).toBe(0);

    // =================== errors =============================
    // three successive sentences that start with the same non-exception word (personal pronoun "I")
    const matches1 = check.check("I think so. I have seen that before. I don't like it.");
    expect(matches1.length).toBe(1);
    // check suggestions
    expect(matches1[0]!.getSuggestedReplacements()[0]).toBe('Furthermore, I');
    expect(matches1[0]!.getSuggestedReplacements()[1]).toBe('Likewise, I');
    expect(matches1[0]!.getSuggestedReplacements()[2]).toBe('Not only that, but I');
    // three successive sentences that start with the same non-exception word (personal pronoun "He")
    const matches2 = check.check("He thinks so. He has seen that before. He doesn't like it.");
    expect(matches2.length).toBe(1);
    // check suggestions
    expect(matches2[0]!.getSuggestedReplacements()[0]).toBe('Furthermore, he');
    expect(matches2[0]!.getSuggestedReplacements()[1]).toBe('Likewise, he');
    expect(matches2[0]!.getSuggestedReplacements()[2]).toBe('Not only that, but he');
    // two successive sentences that start with one of the saved adverbs ("Also")
    const matches3 = check.check('Also, I play football. Also, I play basketball.');
    expect(matches3.length).toBe(1);
    // check suggestions (because the adverbs are contained in a Set it is safer to check if the correct suggestions
    // are contained in the real suggestions)
    for (const s of ['Additionally', 'Besides', 'Furthermore', 'Moreover', 'In addition', 'As well as']) {
      expect(matches3[0]!.getSuggestedReplacements()).toContain(s);
    }
  });
});

describe('ConsistentApostrophesRuleTest', () => {
  it('testRule', () => {
    const rule = new ConsistentApostrophesRule(messages());
    const matches = rule.match(lt().analyzeText('It\'s a nice idea. But it doesn’t work.'));
    expect(matches.length).toBe(2);
    expect(matches[0]!.getFromPos()).toBe(2);
    expect(matches[0]!.getToPos()).toBe(4);
    expect(matches[0]!.getSuggestedReplacements()).toEqual(['’s']);
    expect(matches[1]!.getFromPos()).toBe(29);
    expect(matches[1]!.getToPos()).toBe(32);
    expect(matches[1]!.getSuggestedReplacements()).toEqual(["n't"]);

    expect(rule.match(lt().analyzeText("It’s a nice idea. But it doesn't work.")).length).toBe(2);
    expect(rule.match(lt().analyzeText("It's a nice idea. But it doesn't work.")).length).toBe(0);
    expect(rule.match(lt().analyzeText('It’s a nice idea. But it doesn’t work.')).length).toBe(0);
  });
});

describe('StyleTooOftenUsed*Rule (no upstream test)', () => {
  it('finds a verb, noun and adjective used too often in a text of more than 100 such words', () => {
    const verb = new StyleTooOftenUsedVerbRule(messages(), english().english, null);
    const noun = new StyleTooOftenUsedNounRule(messages(), english().english, null);
    const adj = new StyleTooOftenUsedAdjectiveRule(messages(), english().english, null);
    expect(verb.isDefaultOff()).toBe(true);
    expect(verb.getRuleOptions()[0]!.getDefaultValue()).toBe(5);
    const fillers = ['house', 'tree', 'river', 'dog', 'table', 'garden', 'window', 'street', 'bird', 'car',
      'chair', 'cloud', 'field', 'flower', 'lamp', 'road', 'stone', 'wall', 'door', 'hill'];
    const adjectives = ['big', 'red', 'old', 'small', 'green', 'tall', 'warm', 'cold', 'dark', 'quiet',
      'bright', 'soft', 'loud', 'heavy', 'light', 'wide', 'deep', 'sharp', 'thin', 'clean'];
    const verbs = ['saw', 'found', 'took', 'knew', 'built', 'bought', 'sold', 'gave', 'brought', 'kept',
      'caught', 'chose', 'drew', 'forgot', 'held', 'left', 'lost', 'met', 'stole', 'threw'];
    const sentences: string[] = [];
    let k = 0;
    for (let i = 0; i < 120; i++) {
      if (i % 4 !== 0) k++;
      // "ate" every 4th sentence: 30 of 120 verbs (25%), the other verbs 4 or 5 times (< 5%); "wonderful" and "dragon" likewise
      const v = i % 4 === 0 ? 'ate' : verbs[k % 20]!;
      const a = i % 4 === 0 ? 'wonderful' : adjectives[(k * 3) % 20]!;
      const n = i % 4 === 0 ? 'dragon' : fillers[(k * 7) % 20]!;
      sentences.push(`He ${v} the ${a} ${n}.`);
    }
    const text = sentences.join(' ');
    const analyzedText = lt().analyzeText(text);
    const verbMatches = verb.match(analyzedText);
    expect(verbMatches.length).toBe(30);
    expect(text.substring(verbMatches[0]!.getFromPos(), verbMatches[0]!.getToPos())).toBe('ate');
    expect(adj.match(analyzedText).every((m) => text.substring(m.getFromPos(), m.getToPos()) === 'wonderful')).toBe(true);
    expect(adj.match(analyzedText).length).toBe(30);
    expect(noun.match(analyzedText).length).toBe(30);
    expect(verb.match(lt().analyzeText('He ate the dragon. He ate the dragon.')).length).toBe(0);  // fewer than 100 verbs
  });
});

const americanEnglishPort = new URL('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/language/AmericanEnglish.ts', import.meta.url);

describe.skipIf(!existsSync(americanEnglishPort))('EnglishRepeatedWordsRuleTest', () => {
  it('testRule', async () => {
    const { EnglishRepeatedWordsRule } = await import('../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/EnglishRepeatedWordsRule.ts');
    const rule: TextLevelRule = new EnglishRepeatedWordsRule(messages());
    const getRuleMatches = (sentences: string) => {
      const aText = new AnnotatedTextBuilder().addText(sentences).build();
      return rule.match(lt().analyzeText(sentences), aText);
    };
    const assertCorrectText = (sentences: string) => expect(getRuleMatches(sentences).length, sentences).toBe(0);

    // form
    assertCorrectText('They went on to form a new group. The bacteria causes a blood clot to form in the jugular vein.');

    // global
    assertCorrectText('Asia Global Crossing Ltd. Global Crossing and Asia Global Crossing.');
    assertCorrectText('It was a global effort. Announcing the participation of Enron Global Markets.');

    // great
    assertCorrectText('Matthew S. Anderson, Peter the Great. The Tomahawks were shipped from Great Britain.');
    assertCorrectText('It was great. The Tomahawks were shipped from Great Britain.');

    // interesting
    assertCorrectText('I found it very interesting. An interesting fact about me is that I have a twin.');

    // maybe
    assertCorrectText("Maybe it's because I used to be a FLAMING LIBERAL? Or maybe it's because with age, I developed EYES THAT SEE!");

    // need
    assertCorrectText('It needs to be done. That needs to be done.');
    assertCorrectText('This was needed. There is a need to do it.');
    assertCorrectText('It needs to be done. That also needed to be done.');
    assertCorrectText('I still need to sign in somewhere. You need to sign in too.');

    // new
    assertCorrectText('This is a new experience. Happy New Year!');

    // often
    assertCorrectText("It's often gloomy outside. More often than not, it's raining.");
    assertCorrectText("We have bad weather here often. Often times, it's raining.");

    // problem
    assertCorrectText('The students were given some problems. They needed help to solve the problems.');
    assertCorrectText("Then, there were numerous problems after that. His initial interest lay in an attempt to solve Hilbert's fifth problem.");
    assertCorrectText("There were some problems with the tests. No problem, I'm not in a rush.");
    assertCorrectText('The students were given some problems. They were math problems.');

    // several
    assertCorrectText('We noticed them several times. Several thousand people stormed the gate.');

    // suggest
    assertCorrectText('I suggested that, but he also suggests that.');
    assertCorrectText('He suggested that we review them again. What do these suggest about the transaction history?');
    assertCorrectText('I suggested he look it over again. This strongly suggests that Mr. Batt is guilty.');

    // whole
    assertCorrectText('In this example, persons is used instead of people because the law applies to the individuals and never to the group as a whole.');

    // ignore sentences without period at the end
    assertCorrectText('I suggested this. She suggests that');

    let matches = getRuleMatches('I suggested this. She suggests that.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(22);
    expect(matches[0]!.getToPos()).toBe(30);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe('proposes');
    expect(matches[0]!.getSuggestedReplacements()[1]).toBe('recommends');
    expect(matches[0]!.getSuggestedReplacements()[2]).toBe('submits');

    matches = getRuleMatches('I suggested this. She suggests that. And they suggested that.');
    expect(matches.length).toBe(2);
    expect(matches[0]!.getFromPos()).toBe(22);
    expect(matches[1]!.getFromPos()).toBe(46);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe('proposes');
    expect(matches[1]!.getSuggestedReplacements()[0]).toBe('proposed');

    matches = getRuleMatches('The problem was weird. And the solutions needed to be weird.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe('odd');
  });
});
