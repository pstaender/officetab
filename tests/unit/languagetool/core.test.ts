// LanguageTool core: the data broker, message bundles, AnnotatedText and the JLanguageTool check
// pipeline with a small test language (the English module comes separately).
import { beforeAll, describe, expect, it } from 'vitest';
import { installNodeBroker, type NodeResourceDataBroker } from './broker.ts';
import { JLanguageTool, Level, ParagraphHandling } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Language } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import type { AnalyzedSentence } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { UserConfig } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/UserConfig.ts';
import { DefaultResourceDataBroker } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/broker/DefaultResourceDataBroker.ts';
import { AnnotatedText } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/markup/AnnotatedText.ts';
import { AnnotatedTextBuilder } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/markup/AnnotatedTextBuilder.ts';
import { Categories } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Categories.ts';
import { Rule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import type { AbstractPatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/AbstractPatternRule.ts';
import type { SentenceTokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/SentenceTokenizer.ts';
import type { Tokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/Tokenizer.ts';
import { Tools } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/Tools.ts';
import { MessageFormat } from '../../../src/languagetool/jdk/java/text/MessageFormat.ts';
import { PropertyResourceBundle, type ResourceBundle } from '../../../src/languagetool/jdk/java/util/ResourceBundle.ts';

let broker: NodeResourceDataBroker;

beforeAll(() => {
  broker = installNodeBroker();
});

// ------------------------------------------------------------------ a test language

/** Splits after ". ", keeping the space with the sentence (as LanguageTool's SRX rules do). */
class TestSentenceTokenizer implements SentenceTokenizer {
  private singleLineBreaks = false;
  tokenize(text: string): string[] {
    return text.split(/(?<=\. )/).filter((s) => s.length > 0);
  }
  setSingleLineBreaksMarksParagraph(b: boolean): void { this.singleLineBreaks = b; }
  singleLineBreaksMarksPara(): boolean { return this.singleLineBreaks; }
}

/** Whitespace and full stops are tokens of their own. */
class TestWordTokenizer implements Tokenizer {
  tokenize(text: string): string[] {
    return text.split(/([ .\n])/).filter((s) => s.length > 0);
  }
}

/** Finds "foo", suggests "bar". */
class FooRule extends Rule {
  constructor(messages: ResourceBundle) {
    super(messages);
    this.setCategory(Categories.TYPOS.getCategory(messages));
  }
  getId(): string { return 'FOO_RULE'; }
  getDescription(): string { return 'Finds foo'; }
  match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches: RuleMatch[] = [];
    for (const token of sentence.getTokensWithoutWhitespace()) {
      if (token.getToken() === 'foo') {
        matches.push(new RuleMatch(this, sentence, token.getStartPos(), token.getEndPos(), 'Did you mean <suggestion>bar</suggestion>?', 'foo'));
      }
    }
    return matches;
  }
}

/** Matches the first word of a text that has more than one sentence. */
class FirstWordTextRule extends TextLevelRule {
  getId(): string { return 'FIRST_WORD_TEXT_RULE'; }
  getDescription(): string { return 'Text-level demo'; }
  minToCheckParagraph(): number { return -1; }
  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    if (sentences.length < 2) return [];
    const first = sentences[0]!.getTokensWithoutWhitespace()[1]!;
    return [new RuleMatch(this, sentences[0]!, first.getStartPos(), first.getEndPos(), 'First word')];
  }
}

class TestLanguage extends Language {
  getShortCode(): string { return 'yy'; }
  getName(): string { return 'Test language'; }
  getCountries(): string[] { return ['YY']; }
  getMaintainers(): null { return null; }
  getRelevantRules(messages: ResourceBundle, _userConfig: UserConfig | null): Rule[] {
    const textRule = new FirstWordTextRule(messages);
    textRule.setDefaultOff();
    return [new FooRule(messages), textRule];
  }
  override createDefaultSentenceTokenizer(): SentenceTokenizer { return new TestSentenceTokenizer(); }
  override createDefaultWordTokenizer(): Tokenizer { return new TestWordTokenizer(); }
  protected override getPatternRules(): AbstractPatternRule[] { return []; }
}

/** The core's default tokenizers and tagger, and pattern rules from a rule file in the broker. */
class DefaultsLanguage extends Language {
  getShortCode(): string { return 'zy'; }
  getName(): string { return 'Defaults language'; }
  getCountries(): string[] { return []; }
  getMaintainers(): null { return null; }
  getRelevantRules(): Rule[] { return []; }
}

// ------------------------------------------------------------------ tests

describe('ResourceDataBroker', () => {
  it('reads resources of the manifest from disk in Node', () => {
    const lines = broker.getFromResourceDirAsLines('/en/added.txt');
    expect(lines.length).toBeGreaterThan(10);
    expect(broker.resourceExists('/en/added.txt')).toBe(true);
    expect(broker.resourceExists('/en/no-such-file.txt')).toBe(false);
    expect(broker.ruleFileExists('en/grammar.xml')).toBe(true);
    expect(broker.ruleFileExists('en/en-US/grammar.xml')).toBe(true);
    expect(broker.getFromRulesDirAsStream('/en/grammar.xml').length).toBeGreaterThan(1000);
    expect(broker.getAsStream('/org/languagetool/nothing-here.txt')).toBeNull();
    expect(() => broker.getFromResourceDirAsStream('/xx/missing.txt')).toThrow(/not found in class path/);
    expect(broker.getResourceDir()).toBe('/org/languagetool/resource');
    expect(broker.getRulesDir()).toBe('/org/languagetool/rules');
  });

  it('throws a clear error for a resource that was not preloaded', () => {
    const b = new DefaultResourceDataBroker();
    expect(b.resourceExists('/en/added.txt')).toBe(true);
    expect(() => b.getFromResourceDirAsStream('/en/added.txt')).toThrow(/\/org\/languagetool\/resource\/en\/added\.txt not preloaded/);
  });

  it('knows where resources are fetched from and preloads them', async () => {
    const b = new DefaultResourceDataBroker();
    b.setLocalBaseUrl('/app/');
    expect(b.getUrlFor('/org/languagetool/rules/en/grammar.xml'))
      .toBe('https://cdn.jsdelivr.net/gh/languagetool-org/languagetool@v6.8/languagetool-language-modules/en/src/main/resources/org/languagetool/rules/en/grammar.xml');
    expect(b.getUrlFor('/org/languagetool/resource/en/english.dict')).toBe('/app/languagetool/org/languagetool/resource/en/english.dict');
    const paths = b.getLanguagePaths('en');
    expect(paths).toContain('/org/languagetool/rules/en/grammar.xml');
    expect(paths).toContain('/org/languagetool/resource/en/english.dict');
    expect(paths).toContain('/en-pos-maxent.bin');
    expect(paths).toContain('/org/languagetool/MessagesBundle.properties');
    expect(paths).toContain('/org/languagetool/resource/segment.srx');
    expect(paths.some((p) => p.endsWith('.awk') || p.endsWith('.xsd'))).toBe(false);
    const fetched: string[] = [];
    b.setFetch(async (url) => { fetched.push(url); return new Response('a\nb\n'); });
    await b.preload(['/org/languagetool/resource/en/added.txt']);
    expect(fetched).toHaveLength(1);
    expect(b.getFromResourceDirAsLines('/en/added.txt')).toEqual(['a', 'b']);
    await expect(b.preload(['/not/in/manifest.txt'])).rejects.toThrow(/not in generated\/resources.json/);
  });
});

describe('ResourceBundle and MessageFormat', () => {
  it('reads MessagesBundle.properties through the broker', () => {
    const messages = JLanguageTool.getMessageBundle(new TestLanguage());
    expect(messages.getString('category_misc')).toBe('Miscellaneous');
    expect(messages.getString('category_typo')).toBe('Possible Typo');
    expect(messages.containsKey('category_grammar')).toBe(true);
    expect(messages.containsKey('no_such_key')).toBe(false);
    expect(() => messages.getString('no_such_key')).toThrow(/key no_such_key/);
    expect(Tools.i18n(messages, 'checkDone', 3, 1234)).toBe('Potential problems found: 3 (time: 1,234ms)');
    expect(new TestLanguage().getTranslatedName(messages)).toBe('Test language');
  });

  it('parses .properties syntax', () => {
    const b = new PropertyResourceBundle('# comment\n! another\na = 1\nb:2\nc  3\nlong = one \\\n    two\nu = \\u00e4\\u00df\n');
    expect(b.getString('a')).toBe('1');
    expect(b.getString('b')).toBe('2');
    expect(b.getString('c')).toBe('3');
    expect(b.getString('long')).toBe('one two');
    expect(b.getString('u')).toBe('äß');
  });

  it('formats like java.text.MessageFormat', () => {
    expect(MessageFormat.format('{0} and {1}', 'a', 'b')).toBe('a and b');
    expect(MessageFormat.format("It''s {0}", 'x')).toBe("It's x");
    expect(MessageFormat.format("'{0}' is {0}", 'x')).toBe('{0} is x');
    expect(MessageFormat.format('{2}', 'a')).toBe('{2}');
  });
});

describe('AnnotatedText (AnnotatedTextTest.java)', () => {
  it('test', () => {
    const text = new AnnotatedTextBuilder()
      .addGlobalMetaData('foo', 'val')
      .addGlobalMetaData(AnnotatedText.MetaDataKey.EmailToAddress, 'Foo Bar <foo@foobar.org>')
      // text:
      // hello <b>user!</b>
      .addText('hello ')
      .addMarkup('<b>')
      .addText('user!')
      .addMarkup('</b>')
      .build();
    expect(text.getGlobalMetaData('foo', '')).toBe('val');
    expect(text.getGlobalMetaData('non-existing-key', 'xxx')).toBe('xxx');
    expect(text.getGlobalMetaData(AnnotatedText.MetaDataKey.EmailToAddress, 'xxx')).toBe('Foo Bar <foo@foobar.org>');
    expect(text.getGlobalMetaData(AnnotatedText.MetaDataKey.DocumentTitle, 'default-title')).toBe('default-title');
    expect(text.getPlainText()).toBe('hello user!');
    expect(text.getOriginalTextPositionFor(0, false)).toBe(0);
    expect(text.getOriginalTextPositionFor(5, false)).toBe(5);
    expect(text.getOriginalTextPositionFor(6, false)).toBe(9);
    expect(text.getOriginalTextPositionFor(7, false)).toBe(10);
    expect(text.getOriginalTextPositionFor(8, false)).toBe(11);
  });

  it('testIgnoreInterpretAs', () => {
    const text = new AnnotatedTextBuilder()
      .addText('hello ')
      .addMarkup('<p>', '\n\n')
      .addText('more xxxx text!')
      .build();
    expect(text.getPlainText()).toBe('hello \n\nmore xxxx text!');
    expect(text.getTextWithMarkup()).toBe('hello <p>more xxxx text!');
    // "xxxx" is 13-17 in the plain text, 14-18 with markup (ContextTools in the Java test)
    expect(text.getOriginalTextPositionFor(13, false)).toBe(14);
    expect(text.getOriginalTextPositionFor(16, true) + 1).toBe(18);
  });

  it('turns soft hyphens into markup', () => {
    const text = new AnnotatedTextBuilder().addText('hy­phen').build();
    expect(text.getPlainText()).toBe('hyphen');
    expect(text.getParts().map((p) => p.getType())).toEqual(['TEXT', 'MARKUP', 'TEXT']);
    expect(text.getOriginalTextPositionFor(2, false)).toBe(3);
  });
});

describe('JLanguageTool', () => {
  it('checks a text with sentence and text-level rules', () => {
    const lt = new JLanguageTool(new TestLanguage());
    expect(lt.getAllRules().map((r) => r.getId())).toEqual(['FOO_RULE', 'FIRST_WORD_TEXT_RULE']);
    const text = 'Hello foo. This foo is ok. ';
    let matches = lt.check(text);
    expect(matches.map((m) => [m.getRule().getId(), m.getFromPos(), m.getToPos()])).toEqual([
      ['FOO_RULE', 6, 9], ['FOO_RULE', 16, 19],
    ]);
    const m = matches[1]!;
    expect(text.substring(m.getFromPos(), m.getToPos())).toBe('foo');
    expect(m.getFromPosSentence()).toBe(5);
    expect(m.getToPosSentence()).toBe(8);
    expect(m.getSuggestedReplacements()).toEqual(['bar']);
    expect(m.getMessage()).toBe('Did you mean <suggestion>bar</suggestion>?');
    expect(m.getShortMessage()).toBe('foo');
    expect(m.getLine()).toBe(0);
    expect(m.getColumn()).toBe(17);
    expect(m.getSentence()!.getText()).toBe('This foo is ok. ');
    expect(m.getRule().getCategory().getName()).toBe('Possible Typo');

    lt.enableRule('FIRST_WORD_TEXT_RULE');
    matches = lt.check(text);
    expect(matches.map((x) => [x.getRule().getId(), x.getFromPos(), x.getToPos()])).toEqual([
      ['FIRST_WORD_TEXT_RULE', 0, 5], ['FOO_RULE', 6, 9], ['FOO_RULE', 16, 19],
    ]);
    expect(lt.check(text, true, ParagraphHandling.ONLYPARA).map((x) => x.getRule().getId())).toEqual(['FIRST_WORD_TEXT_RULE']);
    expect(lt.check(text, true, ParagraphHandling.ONLYNONPARA).map((x) => x.getRule().getId())).toEqual(['FOO_RULE', 'FOO_RULE']);

    lt.disableRule('FOO_RULE');
    expect(lt.check(text).map((x) => x.getRule().getId())).toEqual(['FIRST_WORD_TEXT_RULE']);
    lt.enableRule('FOO_RULE');
    lt.disableCategory(Categories.TYPOS.getId());
    expect(lt.isCategoryDisabled(Categories.TYPOS.getId())).toBe(true);
    // an explicitly enabled rule stays on in a disabled category
    expect(lt.check(text).map((x) => x.getRule().getId())).toContain('FOO_RULE');
    lt.disableRule('FOO_RULE');
    expect(lt.check(text).map((x) => x.getRule().getId())).toEqual(['FIRST_WORD_TEXT_RULE']);
  });

  it('maps positions back to the text with markup', () => {
    const lt = new JLanguageTool(new TestLanguage());
    const text = new AnnotatedTextBuilder()
      .addText('Hello ').addMarkup('<b>').addText('foo').addMarkup('</b>').addText('. A ')
      .addMarkup('<p/>', '\n\n').addText('foo.')
      .build();
    expect(text.getPlainText()).toBe('Hello foo. A \n\nfoo.');
    const matches = lt.check(text);
    const original = text.getTextWithMarkup();
    expect(matches.map((m) => original.substring(m.getFromPos(), m.getToPos()))).toEqual(['foo', 'foo']);
    expect(matches.map((m) => m.getFromPos())).toEqual([9, 24]);
  });

  it('keeps a single sentence when not tokenizing, and analyzes text', () => {
    const lt = new JLanguageTool(new TestLanguage());
    expect(lt.check('foo. foo.', false, ParagraphHandling.NORMAL).map((m) => m.getFromPos())).toEqual([0, 5]);
    const sentences = lt.analyzeText('Hello foo. Bye.');
    expect(sentences.map((s) => s.getText())).toEqual(['Hello foo. ', 'Bye.']);
    const tokens = sentences[0]!.getTokens();
    expect(tokens[0]!.isSentenceStart()).toBe(true);
    expect(sentences[0]!.getTokensWithoutWhitespace().map((t) => t.getToken())).toEqual(['', 'Hello', 'foo', '.']);
    expect(sentences[1]!.getTokens().at(-1)!.isParagraphEnd()).toBe(true);
    expect(sentences[0]!.getTokens().find((t) => t.getToken() === '.')!.isSentenceEnd()).toBe(true);
  });

  it('removes soft hyphens from tokens but keeps positions', () => {
    const lt = new JLanguageTool(new TestLanguage());
    const raw = lt.getRawAnalyzedSentence('a fo­o b');
    const t = raw.getTokens().find((x) => x.getCleanToken() === 'foo')!;
    expect(t.getToken()).toBe('fo­o');
    expect(raw.getTokens().at(-1)!.getStartPos()).toBe(7);
  });

  it('honours the cancel callback, match filters, levels and correctText', () => {
    const lt = new JLanguageTool(new TestLanguage());
    lt.setCheckCancelledCallback({ checkCancelled: () => true });
    expect(lt.check('foo.')).toEqual([]);
    lt.setCheckCancelledCallback(null);
    lt.addMatchFilter({ filter: (matches) => matches.filter((m) => m.getFromPos() > 0) });
    expect(lt.check('foo foo.').map((m) => m.getFromPos())).toEqual([4]);
    expect(lt.check('foo foo.', Level.PICKY).map((m) => m.getFromPos())).toEqual([4]);
    expect(Tools.correctText('a foo and foo.', new JLanguageTool(new TestLanguage()))).toBe('a bar and bar.');
    const listened: number[] = [];
    new JLanguageTool(new TestLanguage()).check('foo.', { matchFound: (m) => listened.push(m.getFromPos()) });
    expect(listened).toEqual([0]);
  });

  it('cleans overlapping matches by priority and length', () => {
    class LongRule extends FooRule {
      override getId(): string { return 'LONG_RULE'; }
      override match(sentence: AnalyzedSentence): RuleMatch[] {
        const text = sentence.getText();
        const i = text.indexOf('foo is');
        return i < 0 ? [] : [new RuleMatch(this, sentence, i, i + 6, 'long')];
      }
    }
    const lang = new TestLanguage();
    const lt = new JLanguageTool(lang);
    lt.addRule(new LongRule(JLanguageTool.getMessageBundle(lang)));
    expect(lt.check('This foo is ok.').map((m) => m.getRule().getId())).toEqual(['LONG_RULE']);
    lt.setCleanOverlappingMatches(false);
    expect(lt.check('This foo is ok.').map((m) => m.getRule().getId()).sort()).toEqual(['FOO_RULE', 'LONG_RULE']);
  });

  it('uses the default tokenizers, tagger and disambiguator of the core', () => {
    const lang = new DefaultsLanguage();
    expect(lang.getRuleFileNames()).toEqual(['/org/languagetool/rules/zy/grammar.xml']);
    broker.put('/org/languagetool/rules/zy/grammar.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rules lang="zy">
  <category id="MISC" name="Misc">
    <rule id="DOUBLE_THE" name="Double the">
      <pattern><token>the</token><token>the</token></pattern>
      <message>Remove one <suggestion>the</suggestion>.</message>
      <example correction="the">This is <marker>the the</marker> test.</example>
      <example>This is the test.</example>
    </rule>
  </category>
</rules>`);
    const lt = new JLanguageTool(lang);
    expect(lt.sentenceTokenize('One sentence. Another one! A third?')).toEqual(['One sentence. ', 'Another one! ', 'A third?']);
    expect(lt.getRawAnalyzedSentence('A user@example.com and http://example.org/x.').getTokensWithoutWhitespace().map((t) => t.getToken()))
      .toEqual(['', 'A', 'user@example.com', 'and', 'http://example.org/x', '.']);
    const matches = lt.check('Hello world. This is the the test.');
    expect(matches.map((m) => [m.getRule().getId(), m.getFromPos(), m.getToPos(), m.getSuggestedReplacements()])).toEqual([
      ['DOUBLE_THE', 21, 28, ['the']],
    ]);
  });
});
