// The core rules of English.getRelevantRules (whitespace, punctuation, casing, paragraph and
// readability rules), checked with their upstream unit tests: CommaWhitespaceRuleTest,
// DoublePunctuationRuleTest, UppercaseSentenceStartRuleTest (core and en), MultipleWhitespaceRuleTest,
// SentenceWhitespaceRuleTest, LongSentenceRuleTest, LongParagraphRuleTest,
// PunctuationMarkAtParagraphEndTest, PunctuationMarkAtParagraphEnd2Test.
// The core tests use TestTools.getDemoLanguage() (Demo, "xx": the Language defaults, i.e.
// SimpleSentenceTokenizer, WordTokenizer, DemoTagger) or FakeLanguage; both are a Language with
// the defaults here. The en UppercaseSentenceStartRuleTest checks with the full English
// language; here with the English test language and only that rule enabled.
// This file is imported by tests/unit/languagetool/javarules.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { english } from './testEnglish.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Language } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { UserConfig } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/UserConfig.ts';
import type { AbstractPatternRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/AbstractPatternRule.ts';
import type { Rule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import { Example } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Example.ts';
import type { ResourceBundle } from '../../../../src/languagetool/jdk/java/util/ResourceBundle.ts';
import { CommaWhitespaceRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/CommaWhitespaceRule.ts';
import { DoublePunctuationRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/DoublePunctuationRule.ts';
import { UppercaseSentenceStartRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/UppercaseSentenceStartRule.ts';
import { MultipleWhitespaceRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/MultipleWhitespaceRule.ts';
import { SentenceWhitespaceRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/SentenceWhitespaceRule.ts';
import { WhiteSpaceBeforeParagraphEnd } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/WhiteSpaceBeforeParagraphEnd.ts';
import { WhiteSpaceAtBeginOfParagraph } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/WhiteSpaceAtBeginOfParagraph.ts';
import { EmptyLineRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/EmptyLineRule.ts';
import { LongSentenceRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/LongSentenceRule.ts';
import { LongParagraphRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/LongParagraphRule.ts';
import { ParagraphRepeatBeginningRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/ParagraphRepeatBeginningRule.ts';
import { PunctuationMarkAtParagraphEnd } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/PunctuationMarkAtParagraphEnd.ts';
import { PunctuationMarkAtParagraphEnd2 } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/PunctuationMarkAtParagraphEnd2.ts';
import { ReadabilityRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/ReadabilityRule.ts';

/** org.languagetool.language.Demo ("xx") with the Language defaults (and FakeLanguage, "yy"). */
class Demo extends Language {
  private readonly code: string;
  constructor(code = 'xx') { super(); this.code = code; }
  override getShortCode(): string { return this.code; }
  override getName(): string { return 'Testlanguage'; }
  override getCountries(): string[] { return ['XX']; }
  override getMaintainers() { return null; }
  override getRelevantRules(): Rule[] { return []; }
  // Demo's xx/grammar.xml is a test resource of upstream's, not used here (FakeLanguage has none either)
  protected override getPatternRules(): AbstractPatternRule[] { return []; }
}

let messages: ResourceBundle;
let demo: Demo;

beforeAll(() => {
  messages = english().messages;  // TestTools.getEnglishMessages()
  demo = new Demo();
});

/** A JLanguageTool with all rules disabled and the given rule added (setUpRule in the tests). */
function ltWithOnly(lang: Language, rule: Rule): JLanguageTool {
  const lt = new JLanguageTool(lang);
  // the other rules are disabled; the language's own rule of the same id is replaced by this one
  lt.setRules(lt.getAllRules().filter((r) => r.getId() !== rule.getId()));
  for (const r of lt.getAllRules()) {
    lt.disableRule(r.getId());
  }
  lt.addRule(rule);
  return lt;
}

describe('CommaWhitespaceRuleTest', () => {
  it('testRule', () => {
    const rule = new CommaWhitespaceRule(messages);
    const lt = new JLanguageTool(demo);
    const assertMatches = (text: string, expected: number) =>
      expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(expected);
    const assertMatchesForText = (text: string, expected: number) => {
      let matchCount = 0;
      for (const analyzedSentence of lt.analyzeText(text)) {
        matchCount += rule.match(analyzedSentence).length;
      }
      expect(matchCount, text).toBe(expected);
    };
    assertMatches('This is a test sentence.', 0);
    assertMatches('I work with the technology .Net and Azure.', 0);
    assertMatches('I work with the technology .NET and Azure.', 0);
    assertMatches('I use .MP3 or .WAV file suffix', 0);
    assertMatches('This, is, a test sentence.', 0);
    assertMatches('This (foo bar) is a test!.', 0);
    assertMatches('Das kostet €2,45.', 0);
    assertMatches('Das kostet 50,- Euro', 0);
    assertMatches('This is a sentence with ellipsis ...', 0);
    assertMatches("This is a figure: .5 and it's correct.", 0);
    assertMatches('This is $1,000,000.', 0);
    assertMatches('This is 1,5.', 0);
    assertMatches("This is a ,,test''.", 0);
    assertMatches('Run ./validate.sh to check the file.', 0);
    assertMatches('This is, really, non-breaking whitespace.', 0);
    //test OpenOffice field codes:
    assertMatches('In his book,\u0002 Einstein proved this to be true.', 0);
    assertMatches('- [ ] A checkbox at GitHub', 0);
    assertMatches('- [x] A checked checkbox at GitHub', 0);
    assertMatches("A sentence 'with' ten \"correct\" examples of ’using’ quotation “marks” at «once» in it.", 0);
    assertMatches("I'd recommend resaving the .DOC as a PDF file.", 0);
    assertMatches("I'd recommend resaving the .mp3 as a WAV file.", 0);
    assertMatches("I'd suggest buying the .org domain.", 0);
    assertMatches(". This isn't good.", 0);  // strange, but complaining without having a suggestions also doesn't help much...
    assertMatches("), this isn't good.", 0);  // strange, but complaining without having a suggestions also doesn't help much...
    assertMatches('Das sind .exe-Dateien', 0);  // German, but the exception might be useful for other languages
    assertMatches('I live in .Los Angeles', 1);
    assertMatchesForText('Die Vertriebsniederlassu­ng der Versorgungstechnik..­.', 1);
    assertMatchesForText('Die Vertriebsniederlassu­ng der Versorgungstechnik..­.\n', 1);

    // errors:
    assertMatches('This,is a test sentence.', 1);
    assertMatches('This , is a test sentence.', 1);
    assertMatches('This ,is a test sentence.', 2);
    assertMatches(',is a test sentence.', 2);
    assertMatches('This ( foo bar) is a test!.', 1);
    assertMatches('This (foo bar ) is a test!.', 1);
    assertMatches('This is a sentence with an orphaned full stop .', 1);
    assertMatches('This is a test with a OOo footnote\u0002, which is denoted by 0x2 in the text.', 0);
    assertMatches("A sentence ' with ' ten \" incorrect \" examples of ’ using ’ quotation “ marks ” at « once » in it.", 10);
    assertMatches("A sentence ' with' one examples of wrong quotations marks in it.", 1);
    assertMatches("A sentence 'with ' one examples of wrong quotations marks in it.", 1);

    let matches = rule.match(lt.getAnalyzedSentence('ABB (  z.B. )'));
    expect(matches.length).toBe(2);
    expect(matches[0]!.getFromPos()).toBe(4);
    expect(matches[0]!.getToPos()).toBe(6);
    expect(matches[1]!.getFromPos()).toBe(11);
    expect(matches[1]!.getToPos()).toBe(13);

    matches = rule.match(lt.getAnalyzedSentence('This ,'));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe(',');
    matches = rule.match(lt.getAnalyzedSentence('This ,is a test sentence.'));
    expect(matches.length).toBe(2);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe(', ');
    matches = rule.match(lt.getAnalyzedSentence('This , is a test sentence.'));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe(',');

    matches = rule.match(lt.getAnalyzedSentence('You " fixed" it.'));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe('" ');
    expect(matches[0]!.getSuggestedReplacements()[1]).toBe(' "');
    expect(matches[0]!.getFromPos()).toBe(3);
    expect(matches[0]!.getToPos()).toBe(6);
    matches = rule.match(lt.getAnalyzedSentence('You "fixed " it.'));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()[0]).toBe('" ');
    expect(matches[0]!.getSuggestedReplacements()[1]).toBe(' "');
    expect(matches[0]!.getFromPos()).toBe(10);
    expect(matches[0]!.getToPos()).toBe(13);

    assertMatches('Ellipsis . . . as suggested by The Chicago Manual of Style', 3);
    assertMatches('Ellipsis . . . . as suggested by The Chicago Manual of Style', 4);
  });
});

describe('DoublePunctuationRuleTest', () => {
  it('testRule', () => {
    const rule = new DoublePunctuationRule(messages);
    const lt = new JLanguageTool(demo);
    const count = (s: string) => rule.match(lt.getAnalyzedSentence(s)).length;

    // correct sentences:
    expect(count('This is a test sentence...')).toBe(0);
    expect(count('Это тестовое предложение?..')).toBe(0);
    expect(count('Это тестовое предложение!.. ')).toBe(0);
    expect(count('This is a test sentence... More stuff....')).toBe(0);
    expect(count('This is a test sentence..... More stuff....')).toBe(0);
    expect(count('This, is, a test sentence.')).toBe(0);
    expect(count('The path is ../data/vtest.avi')).toBe(0);
    expect(count('The path is ..\\data\\vtest.avi')).toBe(0);
    expect(count('Something … … ..')).toBe(0);
    expect(count('Something … … ... …')).toBe(0);
    expect(count('Something … … .... …')).toBe(0);
    expect(count('Something … … .. …')).toBe(0);
    expect(count('Something ……..')).toBe(0);

    // errors:
    const matches1 = rule.match(lt.getAnalyzedSentence('This,, is a test sentence.'));
    expect(matches1.length).toBe(1);
    expect(matches1[0]!.getFromPos()).toBe(4);
    expect(matches1[0]!.getToPos()).toBe(6);
    const matches2 = rule.match(lt.getAnalyzedSentence('This is a test sentence.. Another sentence'));
    expect(matches2.length).toBe(1);
    expect(matches2[0]!.getFromPos()).toBe(23);
    expect(matches2[0]!.getToPos()).toBe(25);
  });
});

describe('UppercaseSentenceStartRuleTest', () => {
  it('testRule (core)', () => {
    const rule = new UppercaseSentenceStartRule(messages, demo,
      Example.wrong('<marker>a</marker> sentence.'), Example.fixed('<marker>A</marker> sentence.'));
    const lt = new JLanguageTool(demo);
    const assertGood = (s: string) => expect(rule.match(lt.analyzeText(s)).length, s).toBe(0);
    // correct sentences:
    assertGood('this');
    assertGood('a) This is a test sentence.');
    assertGood('iv. This is a test sentence...');
    assertGood('"iv. This is a test sentence..."');
    assertGood('»iv. This is a test sentence...');
    assertGood('This');
    assertGood('This is');
    assertGood('This is a test sentence');
    assertGood('');
    assertGood('http://www.languagetool.org');
    assertGood('eBay can be at sentence start in lowercase.');
    assertGood('¿Esto es una pregunta?');
    assertGood('¿Esto es una pregunta?, ¿y esto?');
    assertGood('ø This is a test sentence with a wrong bullet character.');

    // incorrect sentences:
    const matches = rule.match(lt.analyzeText('this is a test sentence.'));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(0);
    expect(matches[0]!.getToPos()).toBe(4);
    const matches2 = rule.match(lt.analyzeText('this!'));
    expect(matches2.length).toBe(1);
    expect(matches2[0]!.getFromPos()).toBe(0);
    expect(matches2[0]!.getToPos()).toBe(4);
    for (const s of ["'this is a sentence'.", '"this is a sentence."', '„this is a sentence.', '«this is a sentence.',
      '‘this is a sentence.', '¿esto es una pregunta?', '¿Esto es una pregunta? ¿y esto?']) {
      expect(rule.match(lt.analyzeText(s)).length, s).toBe(1);
    }
  });

  it('testRule (en, only this rule enabled)', () => {
    const { english: en } = english();
    const lt = ltWithOnly(en, new UppercaseSentenceStartRule(messages, en));
    const count = (s: string) => lt.check(s).length;
    expect(count('v8.2.0 has been released')).toBe(0);
    expect(count('In Nov. next year.')).toBe(0);
    expect(count('www.languagetool.org is a website.')).toBe(0);
    expect(count('Languagetool.org is a website.')).toBe(0);
    expect(count('1. an item in a list\n2. another item.')).toBe(0);
    expect(count('This is a sentence. microRNA is the start of another sentence.')).toBe(0);
    expect(count('This is a sentence. mRNA is the start of another sentence.')).toBe(0);
    expect(count('This is a sentence. iDeal is the start of another sentence.')).toBe(0);
    expect(count('languagetool.org is a website.')).toBe(0); // questionable
    expect(count('a sentence.')).toBe(1);
    expect(count('a sentence!')).toBe(1);
    expect(count('— Dash introducing enumeration item!')).toBe(0);
    expect(count('— dash introducing enumeration item!')).toBe(0);
    expect(count('Hi Mr. Miller,\n\n \n\nhow are you?')).toBe(0);  // special case for paste from e.g. Outlook
    expect(count('ℹ️ Tree Structure.')).toBe(0);
    expect(count('ℹ Tree Structure.')).toBe(0);
  });
});

describe('MultipleWhitespaceRuleTest', () => {
  it('testRule', () => {
    const lt = ltWithOnly(demo, new MultipleWhitespaceRule(messages, demo));
    const assertGood = (input: string) => expect(lt.check(input).length, JSON.stringify(input)).toBe(0);

    // correct sentences:
    assertGood('This is a test sentence.');
    assertGood('This﻿ is a test sentence.');
    assertGood('This﻿﻿ is a test sentence.');
    assertGood('This ﻿is a test sentence.');
    assertGood('This﻿⁠ is a test sentence.');
    assertGood('This﻿⁠ is a test sentence.');
    assertGood('﻿﻿This is a\n⁠\ntest sentence...');
    assertGood('This is a test sentence...');
    assertGood('\n\tThis is a test sentence...');
    assertGood('Multiple tabs\t\tare okay');
    assertGood('\n This is a test sentence...');
    assertGood('\n    This is a test sentence...');

    // incorrect sentences:
    let matches = lt.check('This  is a test sentence.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(4);
    expect(matches[0]!.getToPos()).toBe(6);
    matches = lt.check('\n   This  is a test sentence.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(8);
    expect(matches[0]!.getToPos()).toBe(10);
    matches = lt.check('This is a test   sentence.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(14);
    expect(matches[0]!.getToPos()).toBe(17);
    matches = lt.check('This is   a  test   sentence.');
    expect(matches.length).toBe(3);
    expect(matches[0]!.getFromPos()).toBe(7);
    expect(matches[0]!.getToPos()).toBe(10);
    expect(matches[1]!.getFromPos()).toBe(11);
    expect(matches[1]!.getToPos()).toBe(13);
    expect(matches[2]!.getFromPos()).toBe(17);
    expect(matches[2]!.getToPos()).toBe(20);
    matches = lt.check('\t\t\t    \t\t\t\t  ');
    expect(matches.length).toBe(2);
    //with non-breakable spaces
    matches = lt.check('This  is a test sentence.');
    expect(matches.length).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(4);
    expect(matches[0]!.getToPos()).toBe(6);
  });
});

describe('SentenceWhitespaceRuleTest', () => {
  it('testMatch', () => {
    const rule = new SentenceWhitespaceRule(messages);
    const lt = new JLanguageTool(new Demo('yy'));  // FakeLanguage
    lt.addRule(rule);
    const assertGood = (text: string) => expect(lt.check(text).length, text).toBe(0);
    const assertBad = (text: string) => expect(lt.check(text).length, text).toBe(1);

    assertGood("This is a text. And there's the next sentence.");
    assertGood("This is a text! And there's the next sentence.");
    assertGood("This is a text\nAnd there's the next sentence.");
    assertGood("This is a text\n\nAnd there's the next sentence.");

    assertBad("This is a text.And there's the next sentence.");
    assertBad("This is a text!And there's the next sentence.");
    assertBad("This is a text?And there's the next sentence.");
  });
});

describe('LongSentenceRuleTest', () => {
  it('testMatch', () => {
    const lt = new JLanguageTool(demo);
    const assertNoMatch = (input: string, rule: LongSentenceRule) =>
      expect(rule.match(lt.analyzeText(input)).length, input).toBe(0);
    const assertMatch = (input: string, from: number, to: number, rule: LongSentenceRule) => {
      const matches = rule.match(lt.analyzeText(input));
      expect(matches.length, input).toBe(1);
      expect(matches[0]!.getFromPos(), input).toBe(from);
      expect(matches[0]!.getToPos(), input).toBe(to);
    };

    const rule = new LongSentenceRule(messages, new UserConfig(), 40);
    assertNoMatch(' is a rather short text.', rule);
    assertMatch('Now this is not ' +
            'a a a a a a a a a a a ' +
            'a a a a a a a a a a a ' +
            'a a a a a a a a a a a ' +
            'a a a a a a a a a a a ' +
            'rather that short text.', 0, 127, rule);

    assertMatch('Now this is not ' +
            'a a a a a a a a a a a ' +
            'a a a a a a a a a a a ' +
            'a a a a a a a a a a a ' +
            'a a a a a a a a a a a ' +
            'rather that short text', 0, 126, rule);

    assertMatch('The sun slowly set behind the majestic mountains, ' +
      'casting a warm golden glow over the tranquil valley below, where a ' +
      'gentle breeze rustled the leaves of the trees, and the sound of a ' +
      'distant stream provided a soothing backdrop to the peaceful scene.', 0, 249, rule);

    // test quotes
    const quote = (open: string, close: string) => 'The quote ' + open + 'When days grow dark and nights grow dreary, we can be thankful that our God combines in ' +
      'his nature a creative synthesis of love and justice which will lead us through life’s dark valleys and into ' +
      'sunlit pathways of hope and fulfillment' + close + ' (p. 9) refers to God’s nature as a combination of love and justice.';
    assertNoMatch(quote('“', '”'), rule);
    assertNoMatch(quote('"', '"'), rule);
    assertNoMatch(quote('«', '»'), rule);
    assertNoMatch(quote('„', '“'), rule);

    assertMatch('The quote "When days" grow dark and nights grow dreary, we can be thankful that our God combines in ' +
        'his nature a creative synthesis of love and justice which will lead us through life’s dark valleys and into ' +
        'sunlit pathways of hope "and fulfillment" (p. 9) refers to God’s nature as a combination of love and justice.',
      0, 253, rule);

    // no quotes
    assertMatch(quote('', ''), 0, 249, rule);

    // wrong or mismatched quotes: opening quote, with no closing quote
    assertNoMatch(quote('“', '»'), rule);

    const shortRule = new LongSentenceRule(messages, new UserConfig(), 6);
    assertNoMatch('This is a rather short text.', shortRule);
    assertMatch('This is also a rather short text.', 0, 33, shortRule);
    assertNoMatch("These ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ don't count.", shortRule);
    assertNoMatch('one two three four five six.', shortRule);
    assertNoMatch('one two three (four) five six.', shortRule);
    assertMatch('one two three four five six seven.', 0, 34, shortRule);
    assertNoMatch('Eins zwei drei vier fünf sechs.', shortRule);
    assertMatch('\n\n\nEins zwei drei vier fünf sechs seven', 3, 39, shortRule);
    assertMatch('Eins zwei drei vier fünf sechs seven\n\n\n', 0, 36, shortRule);
    assertMatch('\n\n\nEins zwei drei vier fünf sechs seven\n\n\n', 3, 39, shortRule);
    assertMatch('\n\n\nEins zwei drei vier fünf sechs seven.', 3, 40, shortRule);
    assertMatch('Eins zwei drei vier fünf sechs seven.\n\n\n', 0, 37, shortRule);
    assertMatch('\n\n\nEins zwei drei vier fünf sechs seven.\n\n\n', 3, 40, shortRule);
  });
});

describe('LongParagraphRuleTest', () => {
  it('testRule', () => {
    const lang = new Demo();
    const rule = new LongParagraphRule(messages, lang, null, 6);
    const lt = new JLanguageTool(lang);
    const count = (s: string) => rule.match(lt.analyzeText(s)).length;
    expect(count('This is a short paragraph.')).toBe(0);
    expect(count('This is only almost long paragraph by unit test standards.')).toBe(0);
    expect(count("Here's some text as a filler. This is a long paragraph by unit test standards.")).toBe(1);
    expect(count("Here's some text as a filler.  A test. A long paragraph by unit test standards.")).toBe(1);
    expect(count("Here's some text as a filler.  A test.\nNot a long paragraph.\nBecause of the line breaks.\n")).toBe(0);
    expect(count('- [ ] A test.\n- [ ] Not a long paragraph.\n- [ ] Because of the line breaks.\n- [ ] More text even.\n')).toBe(0);

    const text1 = "This is a short paragraph.\n\nHere's some text as filler. This is a long paragraph by unit test standards.";
    const matches1 = rule.match(lt.analyzeText(text1));
    expect(matches1.length).toBe(1);
    expect(matches1[0]!.getFromPos()).toBe(45);  // "filler"
    expect(matches1[0]!.getToPos()).toBe(54);

    const text2 = "Here's some text as filler. This is a long paragraph by unit test standards.\n\nAnother paragraph.\n\nHere's some text as morefiller - this is a long paragraph by unit test standards.";
    const matches2 = rule.match(lt.analyzeText(text2));
    expect(matches2.length).toBe(2);
    expect(matches2[0]!.getFromPos()).toBe(17);  // "filler"
    expect(matches2[0]!.getToPos()).toBe(26);
    expect(matches2[1]!.getFromPos()).toBe(115);  // "morefiller"
    expect(matches2[1]!.getToPos()).toBe(128);
  });
});

describe('PunctuationMarkAtParagraphEndTest', () => {
  it('testRule', () => {
    const rule = new PunctuationMarkAtParagraphEnd(messages, demo);
    rule.setTags([]);
    const lt = ltWithOnly(demo, rule);
    const count = (s: string) => lt.check(s).length;

    expect(count('A paragraph.\n2. Some headline\n\n(a) A new sentence.')).toBe(0);
    expect(count('A paragraph.\n\n2. Some headline\n\n(a) A new sentence.')).toBe(0);
    expect(count('A paragraph.\n2.2.1 Some headline\n\n(a) A new sentence.')).toBe(0);
    expect(count('A paragraph.\n\n2.2.1 Some headline\n\n(a) A new sentence.')).toBe(0);
    expect(count('2. This is an item in a list')).toBe(0);
    expect(count('2.2.2. This is an item in a list')).toBe(0);
    expect(count('a) This is an item in a list')).toBe(0);
    expect(count('a.) This is an item in a list')).toBe(0);
    expect(count('✓ This is an item in a list')).toBe(0);
    expect(count('* This is an item in a list')).toBe(0);
    expect(count('This is a test sentence.')).toBe(0);
    expect(count('This is a test headline')).toBe(0);
    expect(count('This is a test sentence. This is a link: http://example.com')).toBe(0);  // no error because of colon
    expect(count('This is a test sentence. It can be found at http://example.com/foobar')).toBe(1);
    expect(count('This is a test sentence. And this is a second test sentence')).toBe(1);
    expect(count('"This is a test sentence. And this is a second test sentence')).toBe(1);
    expect(count('This is a test sentence. And this is a second test sentence.')).toBe(0);
    expect(count('B. v. – Beschluss vom')).toBe(0);
    expect(count('This is a test sentence.\nAnd this is a second test sentence. Here is a dot missing')).toBe(1);
    expect(count('This is a test sentence.\nAnd this is a second test sentence. Here is a dot missing.')).toBe(0);
    expect(count('This is a sentence. Another one: https://languagetool.org/foo\n\nAnother sentence\n')).toBe(0);
  });
});

describe('PunctuationMarkAtParagraphEnd2Test', () => {
  it('test', () => {
    const rule = new PunctuationMarkAtParagraphEnd2(messages, demo);
    rule.setDefaultOn();
    const lt = ltWithOnly(demo, rule);
    const count = (s: string) => lt.check(s).length;
    expect(count('2. This is an item in a list')).toBe(0);
    expect(count('2.2.2. This is an item in a list')).toBe(0);
    expect(count('This is a test.')).toBe(0);
    expect(count('This is a test')).toBe(0);  // too short
    expect(count('This is a really nice test')).toBe(0);  // no error, might not be finished
    expect(count('This is a really nice test, and it has enough tokens\n')).toBe(1);
    expect(count('This is a really nice test, and it has enough tokens\n\n')).toBe(1);
    expect(count('"This is a really nice test, and it has enough tokens."\n\n')).toBe(0);
    expect(count('"This is a really nice test, and it has enough tokens"\n')).toBe(0);  // not really clear whether the rule should match here...
    expect(count('"This is a really nice test, and it has enough tokens"\n\n')).toBe(0);  // not really clear whether the rule should match here...
    expect(count('This is a test.\n\nRegards,\nJim')).toBe(0);
    expect(count('This is a test.\n\nRegards,\n\nJim')).toBe(0);
    expect(count('This is a test.\n\nKind Regards,\nJim')).toBe(0);
    expect(count('This is a test.\n\nKind Regards,\n\nJim')).toBe(0);
    expect(count('This is a test.\n\nKind Regards,\n\nJim Tester')).toBe(0);
    expect(count('This is a test.\n\nKind Regards,\n\nJim van Tester')).toBe(0);
    expect(count('This is headline-style text')).toBe(0);
    expect(count('This is headline-style text.')).toBe(0);
    expect(count('This is headline-style text. If it gets longer, a dot is needed.')).toBe(0);
    expect(count('This is headline-style text. If it gets longer, a dot is needed')).toBe(1);
    expect(count('This is a test\n\nKind Regards,\n\nJim van Tester')).toBe(0);  // too short to find missing dot
    expect(count('This is a really nice test, and it has enough tokens\n\nKind Regards,\n\nJim van Tester')).toBe(1);
  });
});

// Not upstream tests: the rules without a unit test upstream, checked on small texts.
describe('paragraph rules without upstream tests', () => {
  it('WhiteSpaceBeforeParagraphEnd', () => {
    const rule = new WhiteSpaceBeforeParagraphEnd(messages, demo);
    expect(rule.isDefaultOff()).toBe(true);
    const lt = new JLanguageTool(demo);
    const matches = rule.match(lt.analyzeText('This is a test.  \n\nAnother one.'));
    expect(matches.length).toBe(1);
    // the sentence tokenizer keeps the first space with "This is a test. ": the second one is marked
    expect([matches[0]!.getFromPos(), matches[0]!.getToPos()]).toEqual([16, 17]);
    expect(rule.match(lt.analyzeText('This is a test.\n\nAnother one.')).length).toBe(0);
  });

  it('WhiteSpaceAtBeginOfParagraph', () => {
    const rule = new WhiteSpaceAtBeginOfParagraph(messages);
    const lt = new JLanguageTool(demo);
    const matches = rule.match(lt.getAnalyzedSentence('   This is a test.'));
    expect(matches.length).toBe(1);
    expect(matches[0]!.getSuggestedReplacements()).toEqual(['This']);
    expect(rule.match(lt.getAnalyzedSentence('This is a test.')).length).toBe(0);
  });

  it('EmptyLineRule', () => {
    const { english: en, lt } = english();
    const rule = new EmptyLineRule(messages, en);
    const matches = rule.match(lt.analyzeText('This is a test.\n\n\n\nAnother one.'));
    expect(matches.length).toBe(1);
    expect([matches[0]!.getFromPos(), matches[0]!.getToPos()]).toEqual([14, 15]);  // the last non-whitespace token
    expect(rule.match(lt.analyzeText('This is a test.\n\nAnother one.')).length).toBe(0);
  });

  it('ParagraphRepeatBeginningRule', () => {
    const { english: en, lt } = english();
    const rule = new ParagraphRepeatBeginningRule(messages, en);
    expect(rule.match(lt.analyzeText('The house is old.\n\nThe house is new.')).length).toBe(2);
    expect(rule.match(lt.analyzeText('The house is old.\n\nThe garden is new.')).length).toBe(0);
    expect(rule.match(lt.analyzeText('Houses are old.\n\nHouses are new.')).length).toBe(2);
  });

  it('ReadabilityRule', () => {
    const { english: en, lt } = english();
    const difficult = new ReadabilityRule(messages, en, null, false);
    const simple = new ReadabilityRule(messages, en, null, true);
    expect(difficult.getId()).toBe('READABILITY_RULE_DIFFICULT');
    expect(simple.getId()).toBe('READABILITY_RULE_SIMPLE');
    const hard = 'Notwithstanding considerable organizational difficulties, international cooperation regarding environmental sustainability necessitates unprecedented institutional commitment.';
    expect(difficult.match(lt.analyzeText(hard)).length).toBe(1);
    expect(simple.match(lt.analyzeText(hard)).length).toBe(0);
    // the simple test also needs the whole text (more than one paragraph) to be too simple
    const easy = 'The cat sat on the mat. The dog ran to the cat. It was fun.\n\nThe sun is hot. We go to the sea. We swim a lot.';
    expect(simple.match(lt.analyzeText(easy)).length).toBe(2);
    expect(difficult.match(lt.analyzeText(easy)).length).toBe(0);
  });
});

