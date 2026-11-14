// LanguageTool's text analysis (tokenizers, tagger, synthesizer, chunker) for English, checked with
// upstream's own unit tests (languagetool-core/src/test and languagetool-language-modules/en/src/test,
// sparse-checkout additions to the git-ignored upstream checkout): WordTokenizerTest,
// EnglishWordTokenizerTest, EnglishSRXSentenceTokenizerTest, EnglishTaggerTest,
// EnglishSynthesizerTest, EnglishChunkerTest (the tests that do not need JLanguageTool) and
// EnglishChunkFilterTest.
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import manifest from '../../../src/languagetool/generated/resources.json';
import { AnalyzedToken } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Language } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import { DefaultResourceDataBroker } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/broker/DefaultResourceDataBroker.ts';
import { ChunkTag } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/chunking/ChunkTag.ts';
import { ChunkTaggedToken } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/chunking/ChunkTaggedToken.ts';
import { ManualSynthesizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/synthesis/ManualSynthesizer.ts';
import { CombiningTagger } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/CombiningTagger.ts';
import { ManualTagger } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/ManualTagger.ts';
import type { Tagger } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/Tagger.ts';
import { SRXSentenceTokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/SRXSentenceTokenizer.ts';
import type { SentenceTokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/SentenceTokenizer.ts';
import type { Tokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/Tokenizer.ts';
import { WordTokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/WordTokenizer.ts';
import { EnglishChunkFilter } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/chunking/EnglishChunkFilter.ts';
import { EnglishChunker } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/chunking/EnglishChunker.ts';
import { EnglishSynthesizer } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/synthesis/en/EnglishSynthesizer.ts';
import { EnglishTagger } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/tagging/en/EnglishTagger.ts';
import { EnglishWordTokenizer } from '../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/tokenizers/en/EnglishWordTokenizer.ts';

const UP = 'upstream/languagetool/languagetool/';
const timings: string[] = [];

/** Where a class path resource is in the checkout (or in public/languagetool for the Maven data). */
function fileFor(path: string): string {
  const module = (manifest.resources as Record<string, string>)[path];
  if (module !== undefined) {
    return UP + (manifest.modules as Record<string, string>)[module] + path;
  }
  return 'public/languagetool' + path;
}

/** A data broker with the resources of the analysis classes (the worker preloads them by fetch). */
function makeBroker(): DefaultResourceDataBroker {
  const broker = new DefaultResourceDataBroker();
  const R = '/org/languagetool/resource';
  const paths = [
    '/org/languagetool/MessagesBundle.properties', '/org/languagetool/MessagesBundle_en.properties',
    R + '/segment.srx', R + '/Roman.sor',
    R + '/en/english.dict', R + '/en/english.info', R + '/en/english_synth.dict', R + '/en/english_synth.info',
    R + '/en/english_tags.txt', R + '/en/added.txt', R + '/en/added_custom.txt', R + '/en/removed.txt',
    R + '/en/removed_custom.txt', R + '/en/do-not-synthesize.txt', R + '/en/en.sor',
    '/org/languagetool/rules/en/det_a.txt', '/org/languagetool/rules/en/det_an.txt',
    '/en-token.bin', '/en-pos-maxent.bin', '/en-chunker.bin',
  ];
  for (const path of paths) {
    if (existsSync(fileFor(path))) broker.put(path, new Uint8Array(readFileSync(fileFor(path))));
  }
  return broker;
}

/** A stand-in for org.languagetool.language.English (ported elsewhere): the short code is enough here. */
class TestEnglish extends Language {
  constructor() { super(); }
  override getShortCode(): string { return 'en'; }
  override getName(): string { return 'English'; }
  override getCountries(): string[] { return ['US', 'GB']; }
  override getMaintainers() { return []; }
  override getRelevantRules() { return []; }
}

function time<T>(label: string, f: () => T): T {
  const start = performance.now();
  const result = f();
  timings.push(`${label}: ${(performance.now() - start).toFixed(1)} ms`);
  return result;
}

beforeAll(async () => {
  JLanguageTool.setDataBroker(makeBroker());
  if (!Languages.isLanguageSupported('en')) {
    Languages.register('org.languagetool.language.English', TestEnglish);
  }
  const start = performance.now();
  await EnglishChunker.init();
  timings.push(`EnglishChunker.init (3 OpenNLP models): ${(performance.now() - start).toFixed(1)} ms`);
});

// ---------------------------------------------------------------- tokenizers

describe('WordTokenizerTest', () => {
  const wordTokenizer = new WordTokenizer();
  const tokenize = (text: string) => wordTokenizer.tokenize(text).join('|');
  const str = (l: string[]) => '[' + l.join(', ') + ']';

  it('testTokenize', () => {
    let tokens = wordTokenizer.tokenize('This is\u00A0a test');
    expect(tokens.length).toBe(7);
    expect(str(tokens)).toBe('[This,  , is, \u00A0, a,  , test]');
    tokens = wordTokenizer.tokenize('This\rbreaks');
    expect(tokens.length).toBe(3);
    expect(str(tokens)).toBe('[This, \r, breaks]');
    expect(wordTokenizer.tokenize('dev.all@languagetool.org').length).toBe(1);
    expect(wordTokenizer.tokenize('dev.all@languagetool.org.').length).toBe(2);
    expect(wordTokenizer.tokenize('dev.all@languagetool.org:').length).toBe(2);
    expect(wordTokenizer.tokenize('Schreiben Sie Hr. Meier (meier@mail.com).').length).toBe(13);
    tokens = wordTokenizer.tokenize('Get more at languagetool.org/foo, and via twitter');
    expect(tokens.length).toBe(14);
    expect(tokens).toContain('languagetool.org/foo');
    tokens = wordTokenizer.tokenize('Get more at sub.languagetool.org/foo, and via twitter');
    expect(tokens.length).toBe(14);
    expect(tokens).toContain('sub.languagetool.org/foo');
  });

  it('testIsUrl', () => {
    expect(WordTokenizer.isUrl('www.languagetool.org')).toBe(true);
    expect(WordTokenizer.isUrl('languagetool.org/')).toBe(true);
    expect(WordTokenizer.isUrl('languagetool.org/foo')).toBe(true);
    expect(WordTokenizer.isUrl('subdomain.languagetool.org/')).toBe(true);
    expect(WordTokenizer.isUrl('http://www.languagetool.org')).toBe(true);
    expect(WordTokenizer.isUrl('https://www.languagetool.org')).toBe(true);
    expect(WordTokenizer.isUrl('languagetool.org')).toBe(false);  // not detected yet
    expect(WordTokenizer.isUrl('sub.languagetool.org')).toBe(false);  // not detected yet
    expect(WordTokenizer.isUrl('something-else')).toBe(false);
  });

  it('testIsEMail', () => {
    expect(WordTokenizer.isEMail('martin.mustermann@test.de')).toBe(true);
    expect(WordTokenizer.isEMail('martin.mustermann@test.languagetool.de')).toBe(true);
    expect(WordTokenizer.isEMail('martin-mustermann@test.com')).toBe(true);
    expect(WordTokenizer.isEMail('@test.de')).toBe(false);
    expect(WordTokenizer.isEMail('f.test@test')).toBe(false);
    expect(WordTokenizer.isEMail('f@t.t')).toBe(false);
  });

  it('testUrlTokenize', () => {
    expect(tokenize('"This http://foo.org."')).toBe('"|This| |http://foo.org|.|"');
    expect(tokenize('«This http://foo.org.»')).toBe('«|This| |http://foo.org|.|»');
    expect(tokenize('This http://foo.org...')).toBe('This| |http://foo.org|.|.|.');
    expect(tokenize('This http://foo.org.')).toBe('This| |http://foo.org|.');
    expect(tokenize('This http://foo.org blah')).toBe('This| |http://foo.org| |blah');
    expect(tokenize('This http://foo.org and ftp://bla.com blah')).toBe('This| |http://foo.org| |and| |ftp://bla.com| |blah');
    expect(tokenize('foo http://localhost:32000/?ch=1 bar')).toBe('foo| |http://localhost:32000/?ch=1| |bar');
    expect(tokenize('foo ftp://localhost:32000/ bar')).toBe('foo| |ftp://localhost:32000/| |bar');
    expect(tokenize('foo http://google.de/?aaa bar')).toBe('foo| |http://google.de/?aaa| |bar');
    expect(tokenize('foo http://www.flickr.com/123@N04/hallo#test bar')).toBe('foo| |http://www.flickr.com/123@N04/hallo#test| |bar');
    expect(tokenize('foo http://www.youtube.com/watch?v=wDN_EYUvUq0 bar')).toBe('foo| |http://www.youtube.com/watch?v=wDN_EYUvUq0| |bar');
    expect(tokenize('foo http://example.net/index.html?s=A54C6FE2%23info bar')).toBe('foo| |http://example.net/index.html?s=A54C6FE2%23info| |bar');
    expect(tokenize('foo https://writerduet.com/script/#V6922~***~branch=-MClu-LnPrTNz8oz_rJb bar')).toBe('foo| |https://writerduet.com/script/#V6922~***~branch=-MClu-LnPrTNz8oz_rJb| |bar');
    expect(tokenize('foo https://joe:passwd@example.net:8080/index.html?action=x&session=A54C6FE2#info bar'))
      .toBe('foo| |https://joe:passwd@example.net:8080/index.html?action=x&session=A54C6FE2#info| |bar');
  });

  it('testUrlTokenizeWithQuote', () => {
    expect(tokenize("This 'http://foo.org' blah")).toBe("This| |'|http://foo.org|'| |blah");
    expect(tokenize('This "http://foo.org" blah')).toBe('This| |"|http://foo.org|"| |blah');
    expect(tokenize('This ("http://foo.org") blah')).toBe('This| |(|"|http://foo.org|"|)| |blah');   // issue #1226
  });

  it('testUrlTokenizeWithAppendedCharacter', () => {
    expect(tokenize('foo (http://ex.net/p?a=x#i) bar')).toBe('foo| |(|http://ex.net/p?a=x#i|)| |bar');
    expect(tokenize('foo http://ex.net/p?a=x#i, bar')).toBe('foo| |http://ex.net/p?a=x#i|,| |bar');
    expect(tokenize('foo http://ex.net/p?a=x#i. bar')).toBe('foo| |http://ex.net/p?a=x#i|.| |bar');
    expect(tokenize('foo http://ex.net/p?a=x#i: bar')).toBe('foo| |http://ex.net/p?a=x#i|:| |bar');
    expect(tokenize('foo http://ex.net/p?a=x#i? bar')).toBe('foo| |http://ex.net/p?a=x#i|?| |bar');
    expect(tokenize('foo http://ex.net/p?a=x#i! bar')).toBe('foo| |http://ex.net/p?a=x#i|!| |bar');
  });

  it('testIncompleteUrlTokenize', () => {
    expect(tokenize('http:/')).toBe('http|:|/');
    expect(tokenize('http://')).toBe('http://');
    expect(tokenize('http://a')).toBe('http://a');
    expect(tokenize('foo http bar')).toBe('foo| |http| |bar');
    expect(tokenize('foo http: bar')).toBe('foo| |http|:| |bar');
    expect(tokenize('foo http:/ bar')).toBe('foo| |http|:|/| |bar');
    expect(tokenize('foo http:// bar')).toBe('foo| |http://| |bar');
    expect(tokenize('foo http://a bar')).toBe('foo| |http://a| |bar');
    expect(tokenize('foo http://? bar')).toBe('foo| |http://|?| |bar');
  });

  it('testCheckCurrencyExpression', () => {
    expect(wordTokenizer.isCurrencyExpression('US$45')).toBe(true);
    expect(wordTokenizer.isCurrencyExpression('5,000€')).toBe(true);
    expect(wordTokenizer.isCurrencyExpression('£1.50')).toBe(true);
    expect(wordTokenizer.isCurrencyExpression('R$1.999.99')).toBe(true);
    expect(wordTokenizer.isCurrencyExpression('US$')).toBe(false);
    expect(wordTokenizer.isCurrencyExpression('X€')).toBe(false);
    expect(wordTokenizer.isCurrencyExpression('.50£')).toBe(false);
    expect(wordTokenizer.isCurrencyExpression('5R$5')).toBe(false);
  });

  it('testSplitCurrencyExpression', () => {
    expect(wordTokenizer.splitCurrencyExpression('US$45')).toEqual(['US$', '45']);
    expect(wordTokenizer.splitCurrencyExpression('5,000€')).toEqual(['5,000', '€']);
    expect(wordTokenizer.splitCurrencyExpression('£1.50')).toEqual(['£', '1.50']);
    expect(wordTokenizer.splitCurrencyExpression('R$1.999.99')).toEqual(['R$', '1.999.99']);
    // not currency expr
    expect(wordTokenizer.splitCurrencyExpression('US$X')).toEqual(['US$X']);
    expect(wordTokenizer.splitCurrencyExpression('foobar')).toEqual(['foobar']);
  });
});

describe('EnglishWordTokenizerTest', () => {
  it('testTokenize', () => {
    const wordTokenizer = new EnglishWordTokenizer();
    const t = (s: string) => '[' + wordTokenizer.tokenize(s).join(', ') + ']';
    const tokens = wordTokenizer.tokenize('This is\u00A0a test');
    expect(tokens.length).toBe(7);
    expect(t('This is\u00A0a test')).toBe('[This,  , is, \u00A0, a,  , test]');
    expect(t('This\rbreaks')).toBe('[This, \r, breaks]');
    //hyphen with no whitespace
    expect(t('Now this is-really!-a test.')).toBe('[Now,  , this,  , is-really, !, -, a,  , test, .]');
    //hyphen at the end of the word
    expect(t('Now this is- really!- a test.')).toBe('[Now,  , this,  , is, -,  , really, !, -,  , a,  , test, .]');
    //mdash
    expect(t('Now this is—really!—a test.')).toBe('[Now,  , this,  , is, —, really, !, —, a,  , test, .]');
    //exception
    expect(wordTokenizer.tokenize("fo'c'sle").length).toBe(1);
    //contractions
    expect(t("I'm John.")).toBe("[I, 'm,  , John, .]");
    expect(t('You hadn’t.')).toBe('[You,  , had, n’t, .]');
    expect(t("We'are")).toBe("[We, ', are]");
    expect(t("'We're'")).toBe("[', We, 're, ']");
    expect(t("'We’re the best.'")).toBe("[', We, ’re,  , the,  , best, ., ']");
    expect(t("'Don't do it'")).toBe("[', Do, n't,  , do,  , it, ']");
    expect(t('‘Don’t do it’')).toBe('[‘, Do, n’t,  , do,  , it, ’]');
    expect(t("Don't do it")).toBe("[Do, n't,  , do,  , it]");
    expect(t('My address is address@email.com')).toBe('[My,  , address,  , is,  , address@email.com]');
    expect(t('@test@test.social you are aweesome!')).toBe('[@test@test.social,  , you,  , are,  , aweesome, !]');
    expect(t('My address is address@email.com or other@email.com.')).toBe('[My,  , address,  , is,  , address@email.com,  , or,  , other@email.com, .]');
    expect(t("doin' that")).toBe("[doin',  , that]");
    expect(t("ne’er e'er o’er jack-o'-lantern")).toBe("[ne’er,  , e'er,  , o’er,  , jack-o'-lantern]");
    //vertical tab
    expect(t("I'm a cool test\u000Bwith a line")).toBe("[I, 'm,  , a,  , cool,  , test, \u000B, with,  , a,  , line]");
    expect(t('fast⇿superfast')).toBe('[fast, ⇿, superfast]');
  });
});

describe('EnglishSRXSentenceTokenizerTest', () => {
  // accept \n as paragraph:
  let stokenizer: SentenceTokenizer;
  // accept only \n\n as paragraph:
  let stokenizer2: SentenceTokenizer;
  beforeAll(() => {
    stokenizer = time('SRXSentenceTokenizer (segment.srx)', () => new SRXSentenceTokenizer(new TestEnglish()));
    stokenizer2 = new SRXSentenceTokenizer(new TestEnglish());
    stokenizer.setSingleLineBreaksMarksParagraph(true);
    stokenizer2.setSingleLineBreaksMarksParagraph(false);
  });
  /** TestTools.testSplit */
  const testSplitWith = (sentences: string[], sTokenizer: SentenceTokenizer) => expect(sTokenizer.tokenize(sentences.join(''))).toEqual(sentences);
  const testSplit = (...sentences: string[]) => testSplitWith(sentences, stokenizer);

  it('testTokenize', () => {
    // incomplete sentences, need to work for on-thy-fly checking of texts:
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
    testSplit('This works on the phrase level, i.e. not on the word level.');
    testSplit("Let's meet at 5 p.m. in the main street.");
    testSplit('James comes from the U.K. where he worked as a programmer.');
    testSplit("Don't split strings like U.S.A. please.");
    testSplit('Hello ( Hi! ) my name is Chris.');
    testSplit("Don't split... ", 'Well you know. ', 'Here comes more text.');
    testSplit('"Here he comes!" she said.');
    testSplit('"Here he comes." ', 'But this is another sentence.');
    testSplit('The sentence ends here. ', '(Another sentence.)');
    testSplit('The sentence (...) ends here.');
    testSplit("He won't say No. 5 is better. ", 'Not really.');
    testSplit('They met at 5 p.m. ', 'It was Thursday.');
    testSplit('12) Make sure that the lamp is on. ', '12) Make sure that the lamp is on. ');
    testSplit('He also offers a conversion table (see Cohen, 1988, p. 123). ');
    // one/two returns = paragraph = new sentence:
    testSplitWith(["He won't\n\n", 'Really.'], stokenizer2);
    testSplitWith(["He won't\n", 'Really.'], stokenizer);
    testSplitWith(["He won't\nReally."], stokenizer2);
    // Missing space after sentence end:
    testSplit('James is from the Ireland!', 'He lives in Spain now.');
    testSplit('It works (really!). ', 'No doubt.');
    testSplit('A test.\u00A0\n', 'Another test.');
    testSplit('A test. \n', '\n', 'Another test.');
    testSplit('"Here he comes."\u00a0', 'But this is another sentence.');
    testSplit('The new Yahoo! product is nice.');
    testSplit('Yahoo!', 'What is it?');
    testSplit('This is a sentence.\u0002 ', 'And this is another one.');  // footnotes in LibOO/OOo look like this
    testSplit('Other good editions are in vol. IX.');
    testSplit('This is a sentence written by Ed. ', 'And this is another one.');
  });
});

// ---------------------------------------------------------------- tagging

describe('ManualTagger, CombiningTagger', () => {
  const manual = (text: string) => new ManualTagger(text);
  it('tags from a text file (ManualTaggerTest)', () => {
    const tagger = manual('# comment\nfoo\tbar\tNN\nfoo\tfoo\tVB\n#separatorRegExp=\\s+\nhouses house  NNS # trailing comment\n');
    expect(tagger.tag('foo').map(String)).toEqual(['bar/NN', 'foo/VB']);
    expect(tagger.tag('houses').map(String)).toEqual(['house/NNS']);
    expect(tagger.tag('nothing')).toEqual([]);
  });
  it('combines and removes (CombiningTaggerTest)', () => {
    const t1 = manual('a\tA\tX\nb\tB\tY\n');
    const t2 = manual('a\tA2\tX2\n');
    const removal = manual('a\tA\tX\n');
    expect(new CombiningTagger(t1, t2, false).tag('a').map(String)).toEqual(['A2/X2', 'A/X']);
    expect(new CombiningTagger(t1, t2, true).tag('a').map(String)).toEqual(['A2/X2']);
    expect(new CombiningTagger(t1, t2, removal, false).tag('a').map(String)).toEqual(['A2/X2']);
    expect(new CombiningTagger(t1, t2, false).tag('b').map(String)).toEqual(['B/Y']);
  });
});

/** TestTools.isWord */
function isWord(token: string): boolean {
  return /[\p{L}\p{Nd}]/u.test(token);
}

/** TestTools.myAssert(input, expected, tokenizer, tagger) */
function myAssert(input: string, expected: string, tokenizer: Tokenizer, tagger: Tagger): void {
  const tokens = tokenizer.tokenize(input).filter(isWord);
  const output = tagger.tag(tokens);
  const outputStr = output.map((tokenReadings) => {
    const readings = [...tokenReadings].map((t) => t.getToken() + '/[' + t.getLemma() + ']' + t.getPOSTag());
    // force some order on the result just for the test case - order may vary
    // from one version of the lexicon to the next:
    readings.sort();
    return readings.join('|');
  }).join(' -- ');
  expect(outputStr).toBe(expected);
}

describe('EnglishTaggerTest', () => {
  let tagger: EnglishTagger;
  let tokenizer: EnglishWordTokenizer;
  beforeAll(() => {
    tagger = time('EnglishTagger (english.dict, added.txt, removed.txt)', () => new EnglishTagger());
    tokenizer = new EnglishWordTokenizer();
  });

  it('testTagger', () => {
    myAssert('This is a big house.',
        'This/[this]DT|This/[this]PDT -- is/[be]VBZ -- a/[a]DT -- big/[big]JJ|big/[big]RB -- house/[house]NN|house/[house]VB|house/[house]VBP', tokenizer, tagger);
    myAssert('Marketing do a lot of trouble.',
        'Marketing/[market]VBG|Marketing/[marketing]NN:U -- do/[do]VB|do/[do]VBP -- a/[a]DT -- lot/[lot]NN -- of/[of]IN -- trouble/[trouble]NN:UN|trouble/[trouble]VB|trouble/[trouble]VBP', tokenizer, tagger);
    myAssert('Manager use his laptop every day.',
      'Manager/[manager]NN -- use/[use]NN:UN|use/[use]VB|use/[use]VBP -- his/[he]PRP$_A3SM|his/[he]PRP$_P3SM|his/[hi]NNS|his/[his]PRP$ -- laptop/[laptop]NN -- every/[every]DT -- day/[day]NN:UN', tokenizer, tagger);
    myAssert('This is a bigger house.',
        'This/[this]DT|This/[this]PDT -- is/[be]VBZ -- a/[a]DT -- bigger/[big]JJR -- house/[house]NN|house/[house]VB|house/[house]VBP', tokenizer, tagger);
    myAssert("He doesn't believe me.",
      'He/[he]PRP|He/[he]PRP_S3SM -- does/[do]VBZ|does/[doe]NNS -- n\'t/[not]RB -- believe/[believe]VB|believe/[believe]VBP -- me/[I]PRP|me/[I]PRP_O1S', tokenizer, tagger);
    myAssert('It has become difficult.',
      'It/[it]PRP|It/[it]PRP_O3SN|It/[it]PRP_S3SN -- has/[have]VBZ -- become/[become]VB|become/[become]VBN|become/[become]VBP -- difficult/[difficult]JJ', tokenizer, tagger);
    myAssert("You haven't.",
      "You/[you]PRP|You/[you]PRP_O2P|You/[you]PRP_O2S|You/[you]PRP_S2P|You/[you]PRP_S2S -- have/[have]NN|have/[have]VB|have/[have]VBP -- n't/[not]RB", tokenizer, tagger);
    myAssert('You haven’t.',
      "You/[you]PRP|You/[you]PRP_O2P|You/[you]PRP_O2S|You/[you]PRP_S2P|You/[you]PRP_S2S -- have/[have]NN|have/[have]VB|have/[have]VBP -- n't/[not]RB", tokenizer, tagger);
  });

  it('testLemma', () => {
    const aToken = EnglishTagger.INSTANCE.tag(['Trump', 'works']);
    expect(aToken.length).toBe(2);
    expect(aToken[0]!.getReadings().length).toBe(4);
    expect(aToken[1]!.getReadings().length).toBe(2);
    expect(aToken[0]!.getReadings()[0]!.getLemma()).toBe('Trump');
    expect(aToken[0]!.getReadings()[1]!.getLemma()).toBe('trump');
    expect(aToken[0]!.getReadings()[2]!.getLemma()).toBe('trump');
    expect(aToken[0]!.getReadings()[3]!.getLemma()).toBe('trump');
    expect(aToken[1]!.getReadings()[0]!.getLemma()).toBe('work');
    expect(aToken[1]!.getReadings()[1]!.getLemma()).toBe('work');
  });

  it('tags a paragraph (timing)', () => {
    const text = 'The quick brown fox jumps over the lazy dog. It wasn’t the first time that the fox had done this; '
      + 'in fact, the dog had seen it happen dozens of times before, and he didn\'t care anymore. Meanwhile, '
      + 'researchers at the university published 12 papers about canine indifference in 2023, each of them '
      + 'longer than the last, and none of them particularly convincing to anyone outside the field.';
    const tokens = time('tokenizing a paragraph (EnglishWordTokenizer)', () => tokenizer.tokenize(text));
    const words = tokens.filter(isWord);
    const tagged = time(`tagging a paragraph (${words.length} words)`, () => tagger.tag(words));
    expect(tagged.length).toBe(words.length);
    expect(tagged.every((t) => t.isTagged() || /^\d+$/.test(t.getToken()))).toBe(true);
  });
});

// ---------------------------------------------------------------- synthesis

describe('ManualSynthesizerTest', () => {
  it('looks up forms', () => {
    const synth = new ManualSynthesizer('# comment\nfoo\tfoo\tVB\nfooed\tfoo\tVBD\nwent\tgo\tVBD\nfoes\tfoe\tNNS\n');
    expect(synth.lookup('foo', 'VBD')).toEqual(['fooed']);
    expect(synth.lookup('go', 'VBD')).toEqual(['went']);
    expect(synth.lookup('foe', 'NNS')).toEqual(['foes']);
    expect(synth.lookup('foo', 'NNS')).toBe(null);
    expect([...synth.getPossibleTags()].sort()).toEqual(['NNS', 'VB', 'VBD']);
  });
});

describe('EnglishSynthesizerTest', () => {
  const dummyToken = (tokenStr: string, tokenLemma = tokenStr) => new AnalyzedToken(tokenStr, tokenStr, tokenLemma);
  const s = (a: string[]) => '[' + a.join(', ') + ']';

  it('testSynthesizeStringString', () => {
    const synth = time('EnglishSynthesizer (english_synth.dict, added.txt, removed.txt, en.sor)', () => EnglishSynthesizer.INSTANCE);
    expect(synth.synthesize(dummyToken('blablabla'), 'blablabla').length).toBe(0);

    expect(s(synth.synthesize(dummyToken('be'), 'VBD'))).toBe('[was, were]');
    expect(s(synth.synthesize(dummyToken('president'), 'NNS'))).toBe('[presidents]');
    expect(s(synth.synthesize(dummyToken('test'), 'VBD'))).toBe('[tested]');
    expect(s(synth.synthesize(dummyToken('test'), 'VBD', false))).toBe('[tested]');
    // with regular expressions
    expect(s(synth.synthesize(dummyToken('test'), 'VBD', true))).toBe('[tested]');
    expect(s(synth.synthesize(dummyToken('test'), 'VBD|VBG', true))).toBe('[tested, testing]');
    // with special indefinite article
    expect(s(synth.synthesize(dummyToken('university'), '+DT', false))).toBe('[a university, the university]');
    expect(s(synth.synthesize(dummyToken('hour'), '+DT', false))).toBe('[an hour, the hour]');
    expect(s(synth.synthesize(dummyToken('hour'), '+INDT', false))).toBe('[an hour]');
    // indefinite article and other changes...
    expect(s(synth.synthesize(dummyToken('hours', 'hour'), 'NN\\+INDT', true))).toBe('[an hour]');
    expect(s(synth.synthesize(dummyToken('hexagon'), 'NN|NN:.*\\+INDT', true))).toBe('[a hexagon]');
    // indefinite article and other changes...
    expect(s(synth.synthesize(dummyToken('hours', 'hour'), 'NN\\+DT', true))).toBe('[the hour]');
    // from added.txt:
    expect(s(synth.synthesize(dummyToken('absolutize'), 'VBD', false))).toBe('[absolutized]');
    expect(s(synth.synthesize(dummyToken('absolutize'), 'VB[XD]', true))).toBe('[absolutized]');
    // from removed.txt:
    expect(s(synth.synthesize(dummyToken('Christmas'), 'VBZ', false))).toBe('[]');

    expect(s(synth.synthesize(dummyToken('12'), '_spell_number_', false))).toBe('[twelve]');
    expect(s(synth.synthesize(dummyToken('1243'), '_spell_number_', false))).toBe('[one thousand two hundred forty-three]');
    expect(s(synth.synthesize(dummyToken('12'), '_spell_number_', true))).toBe('[twelve]');

    expect(s(synth.synthesize(dummyToken('myself', 'I'), 'PRP_S1S', true))).toBe('[I]');

    expect(s(synth.synthesize(dummyToken('myself', 'I'), 'PRP\\$_A1S', true))).toBe('[my]');

    expect(s(synth.synthesize(dummyToken('mix'), 'VBD'))).toBe('[mixed]');
    expect(s(synth.synthesize(dummyToken('mix'), 'VBN'))).toBe('[mixed]');
  });

  it('spells Roman numbers', () => {
    expect(EnglishSynthesizer.INSTANCE.synthesize(dummyToken('1984'), '_spell_number_:Roman')).toEqual(['MCMLXXXIV']);
  });
});

// ---------------------------------------------------------------- chunking

describe('EnglishChunkFilterTest', () => {
  const makeTokens = (tokensAsString: string): ChunkTaggedToken[] => tokensAsString.split(' ').map((token) => {
    const parts = token.split('/');
    if (parts.length !== 2) throw new Error("Invalid token, form 'x/y' required: " + token);
    return new ChunkTaggedToken(parts[0]!, [new ChunkTag(parts[1]!)], null);
  });
  const assertChunks = (tokens: ChunkTaggedToken[], expected: string) =>
    expect(new EnglishChunkFilter().filter(tokens).map(String).join(' ')).toBe(expected);

  it('testSingular', () => {
    assertChunks(makeTokens('He/B-NP owns/B-VP a/B-NP nice/I-NP house/I-NP in/X Berlin/B-NP ./.'),
                 'He/B-NP-singular,E-NP-singular owns/B-VP a/B-NP-singular nice/I-NP-singular house/E-NP-singular in/X Berlin/B-NP-singular,E-NP-singular ./.');
  });

  it('testPluralByPluralNoun', () => {
    const tokens = makeTokens('I/X have/N-VP ten/B-NP books/I-NP ./.');
    tokens.splice(3, 1);  // 'books'
    const readings = new AnalyzedTokenReadings([
      new AnalyzedToken('books', 'NNS', 'book'),
      new AnalyzedToken('books', 'VBZ', 'book')], 0);
    tokens.splice(3, 0, new ChunkTaggedToken('books', [new ChunkTag('I-NP')], readings));
    assertChunks(tokens, 'I/X have/N-VP ten/B-NP-plural books/E-NP-plural ./.');
  });
});

describe('EnglishChunkerTest', () => {
  const createReadingsList = (sentence: string): AnalyzedTokenReadings[] => {
    const result: AnalyzedTokenReadings[] = [];
    let pos = 0;
    for (const token of sentence.split(/( )/).filter((t) => t !== '')) {
      if (token.trim() === '') {
        result.push(new AnalyzedTokenReadings(new AnalyzedToken(token, null, null), pos));
      } else {
        result.push(new AnalyzedTokenReadings(new AnalyzedToken(token, 'fake', 'fake'), pos));
      }
      pos += token.length;
    }
    return result;
  };
  const tags = (r: AnalyzedTokenReadings) => '[' + r.getChunkTags().join(', ') + ']';

  it('testAddChunkTags', () => {
    const chunker = new EnglishChunker();
    const readingsList = createReadingsList('A short test of the bicycle is needed');
    time('chunking a sentence (EnglishChunker)', () => chunker.addChunkTags(readingsList));
    expect(readingsList.length).toBe(15);
    // "A short test":
    expect(tags(readingsList[0]!)).toBe('[B-NP-singular]');
    expect(tags(readingsList[2]!)).toBe('[I-NP-singular]');
    expect(tags(readingsList[4]!)).toBe('[E-NP-singular]');
    // "the bicycle":
    expect(tags(readingsList[8]!)).toBe('[B-NP-singular]');
    expect(tags(readingsList[10]!)).toBe('[E-NP-singular]');
    // "is needed"
    expect(tags(readingsList[12]!)).toBe('[B-VP]');
    expect(tags(readingsList[14]!)).toBe('[I-VP]');
  });

  it('testAddChunkTagsSingular (tagged by EnglishTagger, without disambiguation)', () => {
    const chunker = new EnglishChunker();
    const tokens = new EnglishWordTokenizer().tokenize('The abacus shows how numbers can be stored');
    const tagged = EnglishTagger.INSTANCE.tag(tokens);
    // with the SENT_START token in front, as AnalyzedSentence.getTokens() has it
    const readingsList = [new AnalyzedTokenReadings(new AnalyzedToken('', 'SENT_START', null), 0), ...tagged];
    chunker.addChunkTags(readingsList);
    // "The abacus":
    expect(tags(readingsList[1]!)).toBe('[B-NP-singular]');
    expect(tags(readingsList[3]!)).toBe('[E-NP-singular]');
    // "numbers":
    expect(tags(readingsList[9]!)).toBe('[B-NP-plural, E-NP-plural]');
  });

  it('testTokenize', () => {
    const chunker = new EnglishChunker();
    const expected = "[I, 'm, going, to, London]";
    expect('[' + chunker.tokenize("I'm going to London").join(', ') + ']').toBe(expected);
    expect('[' + chunker.tokenize('I’m going to London').join(', ') + ']').toBe(expected);  // different apostrophe char
  });

  it('reports timings', () => {
    console.log('LanguageTool analysis timings:\n  ' + timings.join('\n  '));
  });
});
