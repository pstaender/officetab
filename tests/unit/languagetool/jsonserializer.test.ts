// Ports of RuleMatchesAsJsonSerializerTest.java and ContextToolsTest.java.
import { beforeAll, describe, expect, it } from 'vitest';
import { installNodeBroker } from './broker.ts';
import { JLanguageTool } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Language } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import { DetectedLanguage } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/DetectedLanguage.ts';
import { Tag } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Tag.ts';
import { ITSIssueType } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Rule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { AbstractPatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/AbstractPatternRule.ts';
import { Tools } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/Tools.ts';
import { ContextTools } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/ContextTools.ts';
import { RuleMatchesAsJsonSerializer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/RuleMatchesAsJsonSerializer.ts';

/** Stands in for LanguageTool's Demo language ("xx", "Testlanguage"). */
class Demo extends Language {
  getShortCode(): string { return 'xx'; }
  getName(): string { return 'Testlanguage'; }
  getCountries(): string[] { return ['XX']; }
  getMaintainers(): null { return null; }
  getRelevantRules(): Rule[] { return []; }
  protected override getPatternRules(): AbstractPatternRule[] { return []; }
}

class FakeRule extends Rule {
  constructor() {
    super();
    this.setLocQualityIssueType(ITSIssueType.Addition);
    this.setUrl(Tools.getUrl('http://foobar.org/blah'));
  }
  getId(): string { return 'FAKE_ID'; }
  getDescription(): string { return 'My rule description'; }
  match(): RuleMatch[] { throw new Error('not implemented'); }
}

let matches: RuleMatch[];
let matches2: RuleMatch[];
const serializer = new RuleMatchesAsJsonSerializer();

beforeAll(() => {
  installNodeBroker();
  Languages.register('org.languagetool.language.Demo', Demo);
  const sentence = () => new JLanguageTool(Languages.getLanguageForShortCode('xx')).getAnalyzedSentence('This is an test sentence.');
  matches = [new RuleMatch(new FakeRule(), sentence(), 1, 3, 'My Message, use <suggestion>foo</suggestion> instead', 'short message')];
  const rule = new FakeRule();
  rule.setTags([Tag.picky]);
  matches2 = [new RuleMatch(rule, sentence(), 1, 3, 'My Message, use <suggestion>foo</suggestion> instead', 'short message')];
});

const xx = () => new DetectedLanguage(Languages.getLanguageForShortCode('xx-XX'), Languages.getLanguageForShortCode('xx-XX'));

describe('RuleMatchesAsJsonSerializer', () => {
  it('testJson', () => {
    const json = serializer.ruleMatchesToJson(matches, 'This is an text.', 5, xx());
    for (const s of ['"LanguageTool"', JLanguageTool.VERSION!, '"Testlanguage"', '"xx-XX"',
      '"My Message, use \\"foo\\" instead"', '"My rule description"', '"FAKE_ID"', '"This is ..."',
      '"http://foobar.org/blah"', '"addition"', '"short message"', '"sentence":"This is an test sentence."']) {
      expect(json).toContain(s);
    }
    expect(json).not.toContain('tags');
    expect(json).not.toContain('picky');
  });

  it('testJsonWithTags', () => {
    expect(serializer.ruleMatchesToJson(matches2, 'This is an text.', 5, xx())).toContain('"tags":["picky"]');
  });

  it('testJsonWithUnixLinebreak', () => {
    expect(serializer.ruleMatchesToJson(matches, 'This\nis an text.', 5, xx())).toContain('This is ...');
  });

  it('testJsonWithWindowsLinebreak', () => {
    expect(serializer.ruleMatchesToJson(matches, 'This\ris an text.', 5, xx())).toContain('This\\ris ...');
  });

  it('writes the sections in Java order', () => {
    const o = JSON.parse(serializer.ruleMatchesToJson(matches, 'This is an text.', 5, xx()));
    expect(Object.keys(o)).toEqual(['software', 'warnings', 'language', 'matches', 'sentenceRanges', 'extendedSentenceRanges']);
    expect(Object.keys(o.matches[0])).toEqual(['message', 'shortMessage', 'replacements', 'offset', 'length', 'context',
      'sentence', 'type', 'rule', 'ignoreForIncompleteSentence', 'contextForSureMatch']);
    expect(o.matches[0].context).toEqual({ text: 'This is ...', offset: 1, length: 2 });
    expect(o.language.detectedLanguage).toEqual({ name: 'Testlanguage', code: 'xx-XX', confidence: 1, source: null });
  });
});

describe('ContextTools', () => {
  it('testGetContext', () => {
    const contextTools = new ContextTools();
    expect(contextTools.getContext(4, 8, 'Hi, this is some nice text waiting for its error markers.'))
      .toBe('Hi, <b><font bgcolor="#ff8b8b">this</font></b> is some nice text waiting for its error...');
    expect(contextTools.getContext(3, 5, 'xxx\n \nyyy')).toBe('xxx<b><font bgcolor="#ff8b8b">&nbsp;&nbsp;</font></b> yyy');
  });

  it('testPlainTextContext', () => {
    const contextTools = new ContextTools();
    contextTools.setContextSize(5);
    expect(contextTools.getPlainTextContext(8, 14, "This is a test sentence. Here's another sentence with more text."))
      .toBe('...s is a test sent...\n        ^^^^^^     ');
    expect(contextTools.getPlainTextContext(15, 19, "One.\nThis is a test sentence.\nHere's another sentence."))
      .toBe('...is a test sent...\n        ^^^^     ');
    expect(contextTools.getPlainTextContext(16, 20, "One.\r\nThis is a test sentence.\r\nHere's another sentence."))
      .toBe('...is a test sent...\n        ^^^^     ');
  });

  it('testLargerContext', () => {
    const contextTools = new ContextTools();
    contextTools.setContextSize(100);
    expect(contextTools.getContext(4, 8, 'Hi, this is some nice text waiting for its error markers.'))
      .toBe('Hi, <b><font bgcolor="#ff8b8b">this</font></b> is some nice text waiting for its error markers.');
  });

  it('testHtmlEscape', () => {
    const contextTools = new ContextTools();
    expect(contextTools.getContext(0, 2, 'Hi, this is <html>.')).toBe('<b><font bgcolor="#ff8b8b">Hi</font></b>, this is &lt;html&gt;.');
    contextTools.setEscapeHtml(false);
    expect(contextTools.getContext(0, 2, 'Hi, this is <html>.')).toBe('<b><font bgcolor="#ff8b8b">Hi</font></b>, this is <html>.');
  });

  it('testMarkers', () => {
    const contextTools = new ContextTools();
    contextTools.setErrorMarker('<X>', '</X>');
    expect(contextTools.getContext(0, 2, 'Hi, this is it.')).toBe('<X>Hi</X>, this is it.');
  });
});
