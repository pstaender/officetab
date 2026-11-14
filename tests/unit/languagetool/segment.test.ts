import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Srx2SaxParser } from '../../../src/languagetool/segment/segment/net/loomchild/segment/srx/io/Srx2SaxParser.ts';
import { SrxTextIterator } from '../../../src/languagetool/segment/segment/net/loomchild/segment/srx/SrxTextIterator.ts';
import type { SrxDocument } from '../../../src/languagetool/segment/segment/net/loomchild/segment/srx/SrxDocument.ts';
import { SrxDocument as Doc } from '../../../src/languagetool/segment/segment/net/loomchild/segment/srx/SrxDocument.ts';
import { LanguageRule } from '../../../src/languagetool/segment/segment/net/loomchild/segment/srx/LanguageRule.ts';
import { Rule } from '../../../src/languagetool/segment/segment/net/loomchild/segment/srx/Rule.ts';
import { JavaToJavaScript, Pattern } from '../../../src/languagetool/jdk/java/util/regex/Pattern.ts';
import { Util } from '../../../src/languagetool/segment/segment/net/loomchild/segment/util/Util.ts';

const SRX = 'upstream/languagetool/languagetool/languagetool-core/src/main/resources/org/languagetool/resource/segment.srx';

/** SrxTools.tokenize */
function tokenize(text: string, srxDocument: SrxDocument, code: string): string[] {
  const segments: string[] = [];
  const textIterator = new SrxTextIterator(srxDocument, code, text);
  while (textIterator.hasNext()) segments.push(textIterator.next()!);
  return segments;
}

describe('segment (SRX)', () => {
  it('finitizes patterns for lookbehind', () => {
    expect(Util.finitize('a*b+c{2,}\\*', 10)).toBe('a{0,10}b{1,10}c{2,10}\\*');
    expect(Util.finitize('a++', 5)).toBe('a{1,5}+');
    expect(Util.removeBlockQuotes('\\Qa.b\\E')).toBe('\\a\\.\\b');
    expect(Util.removeCapturingGroups('(a)(?:b)\\(c')).toBe('(?:a)(?:b)\\(c');
  });

  it('uses Matcher regions with opaque and transparent bounds', () => {
    const m = Pattern.compile('(?<=a)b').matcher('abab');
    m.region(1, 4);
    expect(m.lookingAt()).toBe(false); // opaque: the lookbehind cannot see 'a' at 0
    m.useTransparentBounds(true);
    m.region(1, 4);
    expect(m.lookingAt()).toBe(true);
    expect([m.start(), m.end()]).toEqual([1, 2]);
    const f = Pattern.compile('b').matcher('abab');
    f.region(2, 4);
    expect(f.find()).toBe(true);
    expect(f.start()).toBe(3);
    expect(f.find()).toBe(false);
  });

  it('rewrites patterns Oniguruma refuses for JavaScript', () => {
    // a lookahead inside a lookbehind, inline flags, \s as ASCII, a class with a set and '-'
    const p = Pattern.compile('(?<=[.\\s](?!(on|it))\\p{L}{1,2}\\.\\s)(?=(?iu)x)');
    expect(p.matcher('a ab. X').find()).toBe(true);
    expect(p.matcher('a on. X').find()).toBe(false);
    expect(p.matcher('a ab. X').find()).toBe(false);
    expect(Pattern.compile('(?<=(?!a)b)[\\p{Lu}-–]').matcher('b-').find()).toBe(true);
    expect(Pattern.compile('(?<=(?!a)b)[\\p{Lu}-–]').matcher('bx').find()).toBe(false);
    expect(JavaToJavaScript('[a-z&&[^aeiou]]')).toBe('(?:(?=[a-z])[^aeiou])');
    expect(new RegExp(JavaToJavaScript('[a-z&&[^aeiou]]+'), 'u').exec('aeixyz')![0]).toBe('xyz');
  });

  it('splits with break and exception rules', () => {
    const doc = new Doc();
    const lr = new LanguageRule('Test');
    lr.addRule(new Rule(false, '\\bMr\\.', '\\s'));
    lr.addRule(new Rule(true, '[.!?]', '\\s'));
    doc.addLanguageMap('.*', lr);
    expect(tokenize('Hi Mr. Smith. Bye!', doc, 'en')).toEqual(['Hi Mr. Smith.', ' Bye!']);
  });

  describe("LanguageTool's segment.srx, English", () => {
    const doc = new Srx2SaxParser({ [Srx2SaxParser.VALIDATE_PARAMETER]: true }).parse(readFileSync(SRX, 'utf8'));
    const split = (code: string, ...sentences: string[]) =>
      expect(tokenize(sentences.join(''), doc, code)).toEqual(sentences);
    const testSplit = (...sentences: string[]) => split('en_one', ...sentences);

    it('parses the document', () => {
      expect(doc.getCascade()).toBe(true);
      expect(doc.getLanguageRuleList('en_two').map((r) => r.getName())).toEqual(['GeneralImportant', 'ByTwoLineBreaks', 'English', 'Default']);
    });

    it('splits sentences', () => {
      split('en_two', 'This is a test. ', 'Mr. Smith went to Washington. ', 'It was great!');
    });

    // EnglishSRXSentenceTokenizerTest
    it('passes EnglishSRXSentenceTokenizerTest', () => {
      testSplit('What is the I.S?');
      testSplit('Where are the I.S and the M.Z notes? ');
      testSplit("Here's a");
      testSplit("Here's a sentence. ", "And here's one that's not comp");
      testSplit('Or did you install it (i.e. MS Word) yourself?');
      testSplit('This is a sentence. ');
      testSplit('This is a sentence. ', 'And this is another one.');
      testSplit('This is it. ', 'and this is another sentence.');
      testSplit('This is a sentence.', "Isn't it?", 'Yes, it is.');
      testSplit('This is e.g. Mr. Smith, who talks slowly...', 'But this is another sentence.');
      testSplit('Chanel no. 5 is blah.');
      testSplit('Mrs. Jones gave Peter $4.5, to buy Chanel No 5.', 'He never came back.');
      testSplit("On p. 6 there's nothing. ", 'Another sentence.');
      testSplit('Leave me alone!, he yelled. ', 'Another sentence.');
      testSplit('"Leave me alone!", he yelled.');
      testSplit("'Leave me alone!', he yelled. ", 'Another sentence.');
      testSplit("Don't split strings like U.S.A either.");
      testSplit('"Here he comes!", she said.');
      testSplit('The sentence [...] ends here.');
      testSplit('He will not. ', 'Really.');
      testSplit("He won't go. ", 'Really.');
      testSplit("He won't say No.", 'Not really.');
      testSplit("He won't say no. 5 is better. ", 'Not really.');
      testSplit('It [really!] works.');
      testSplit('It works [really!]. ', 'No doubt.');
      testSplit('It really[!] works well.');
      testSplit('A test.\n', 'Another test.');
      testSplit('A test. \n', 'Another test.');
      split('en_two', "He won't\n\n", 'Really.');
      testSplit("'Leave me alone!,' he yelled. ", 'Another sentence.');
      testSplit('This works on the phrase level, i.e. not on the word level.');
      testSplit("Let's meet at 5 p.m. in the main street.");
      testSplit('James comes from the U.K. where he worked as a programmer.');
      testSplit("Don't split strings like U.S.A. please.");
      testSplit('Hello ( Hi! ) my name is Chris.');
      testSplit("Don't split strings like U. S. A. either.");
      testSplit("Don't split... ", 'Well you know. ', 'Here comes more text.');
      testSplit("Don't split... well you know. ", 'Here comes more text.');
      testSplit('The "." should not be a delimiter in quotes.');
      testSplit('"Here he comes!" she said.');
      testSplit('"Here he comes." ', 'But this is another sentence.');
      testSplit('"Here he comes!". ', "That's what he said.");
      testSplit('The sentence ends here. ', '(Another sentence.)');
      testSplit('The sentence (...) ends here.');
      testSplit('The sentence ends here (...). ', 'Another sentence.');
      testSplit("He won't. ", 'Really.');
      testSplit("He won't say no.", 'Not really.');
      testSplit("He won't say No. 5 is better. ", 'Not really.');
      testSplit('They met at 5 p.m. on Thursday.');
      testSplit('They met at 5 p.m. ', 'It was Thursday.');
      testSplit('This is it: a test.');
      testSplit('12) Make sure that the lamp is on. ', '12) Make sure that the lamp is on. ');
      testSplit('He also offers a conversion table (see Cohen, 1988, p. 123). ');
      split('en_two', "He won't\n\n", 'Really.');
      split('en_one', "He won't\n", 'Really.');
      split('en_two', "He won't\nReally.");
      testSplit('James is from the Ireland!', 'He lives in Spain now.');
      testSplit('Jones Bros. have built a successful company.');
      testSplit('It (really!) works.');
      testSplit('It works (really!). ', 'No doubt.');
      testSplit('It really(!) works well.');
      testSplit('A test. \n', 'Another test.');
      testSplit('A test. ', 'Another test.');
      testSplit('A test. \n', '\n', 'Another test.');
      testSplit('"Here he comes." ', 'But this is another sentence.');
      testSplit('The new Yahoo! product is nice.');
      testSplit('Yahoo!, what is it?');
      testSplit('Yahoo!', 'What is it?');
      testSplit('This is a sentence.\u0002 ', 'And this is another one.');
      testSplit('Other good editions are in vol. 4.');
      testSplit('Other good editions are in vol. IX.');
      testSplit('Other good editions are in vol. I think.');
      testSplit('Who Shall I Say is Calling & Other Stories S. Deziemianowicz, ed. (2009)');
      testSplit('Who Shall I Say is Calling & Other Stories S. Deziemianowicz, ed. ', 'And this is another one.');
      testSplit('This is a sentence written by Ed. ', 'And this is another one.');
    });
  });
});
