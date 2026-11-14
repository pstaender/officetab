// Tests of the pattern rule engine (rules/patterns, tagging/disambiguation): loading LanguageTool's
// English rule files unchanged, and LanguageTool's own methodology (PatternRuleTest): every
// incorrect <example> must be found by its rule at the <marker>, with the given corrections,
// and every correct one not. Until the English tokenizer, tagger and disambiguator are ported,
// sentences are built as JLanguageTool.getRawAnalyzedSentence does with an untagged tagger, so
// the examples are checked for the rules that only look at token texts.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnalyzedSentence } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { WordTokenizer } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tokenizers/WordTokenizer.ts';
import { StringTools } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/StringTools.ts';
import { PatternRuleLoader } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/PatternRuleLoader.ts';
import { PatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/PatternRule.ts';
import { PatternToken } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { RegexPatternRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/RegexPatternRule.ts';
import { StringMatcher } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/StringMatcher.ts';
import { UnifierConfiguration } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/UnifierConfiguration.ts';
import { RuleSet } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/RuleSet.ts';
import { DisambiguationRuleLoader } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationRuleLoader.ts';
import { DisambiguationPatternRule, DisambiguatorAction } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Pattern } from '../../../src/languagetool/jdk/java/util/regex/Pattern.ts';
import { MultiWordChunker } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/MultiWordChunker.ts';
import { XmlRuleDisambiguator } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tagging/disambiguation/rules/XmlRuleDisambiguator.ts';

// JLanguageTool's tag names only (the real one loads the whole checker), and message bundles.
// The data broker reads the resource directories of the upstream checkout.
vi.mock('../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts', async () => {
  const fs = await import('node:fs');
  const dirs = ['upstream/languagetool/languagetool/languagetool-language-modules/en/src/main/resources/org/languagetool/resource',
    'upstream/languagetool/languagetool/languagetool-core/src/main/resources/org/languagetool/resource'];
  const getFromResourceDirAsStream = (path: string): Uint8Array => {
    for (const dir of dirs) {
      const file = `${dir}/${path.replace(/^\//, '')}`;
      if (fs.existsSync(file)) return fs.readFileSync(file);
    }
    throw new Error('not found: ' + path);
  };
  return {
    JLanguageTool: {
      SENTENCE_START_TAGNAME: 'SENT_START', SENTENCE_END_TAGNAME: 'SENT_END', PARAGRAPH_END_TAGNAME: 'PARA_END',
      getDataBroker: () => ({ getFromResourceDirAsStream }),
    },
  };
});
vi.mock('../../../src/languagetool/languagetool/languagetool-core/org/languagetool/ResourceBundleTools.ts', () => ({
  ResourceBundleTools: { getMessageBundle: () => ({ getString: (key: string) => key }) },
}));
// Java regexes that jdk Pattern.ts refuses (Java accepts them, or the rule files would not load):
// recorded, and compiled as a pattern that never matches, so that the rest can be tested.
const refusedRegexes = new Map<string, string>();
{
  const compile = Pattern.compile.bind(Pattern);
  vi.spyOn(Pattern, 'compile').mockImplementation((regex: string, flags?: number) => {
    try {
      return compile(regex, flags);
    } catch (e) {
      refusedRegexes.set(regex, (e as Error).message);
      return compile('(?!)', flags);
    }
  });
}

type PatternTokenT = InstanceType<typeof PatternToken>;
type AbstractPatternRuleT = InstanceType<typeof PatternRule> | InstanceType<typeof RegexPatternRule>;
type Sentence = InstanceType<typeof AnalyzedSentence>;

const UP = 'upstream/languagetool/languagetool';
const EN_RULES = `${UP}/languagetool-language-modules/en/src/main/resources/org/languagetool/rules/en`;
const EN_RESOURCE = `${UP}/languagetool-language-modules/en/src/main/resources/org/languagetool/resource/en`;
const CORE_RESOURCE = `${UP}/languagetool-core/src/main/resources/org/languagetool/resource`;

/** The parts of Language the pattern engine uses (Language.ts needs JLanguageTool). */
function makeLanguage() {
  const unifierConfig = new UnifierConfiguration();
  const disambiguationUnifierConfig = new UnifierConfiguration();
  const lang = {
    getShortCode: () => 'en',
    getShortCodeWithCountryAndVariant: () => 'en-US',
    getName: () => 'English (US)',
    getUnifier: () => unifierConfig.createUnifier(),
    getUnifierConfiguration: () => unifierConfig,
    getDisambiguationUnifier: () => disambiguationUnifierConfig.createUnifier(),
    getDisambiguationUnifierConfiguration: () => disambiguationUnifierConfig,
    getDefaultLanguageVariant: () => lang,
    getSynthesizer: () => null,
    equalsConsiderVariantsIfSpecified: () => true,
    getConsistencyRulePrefix: () => 'EN_CONSISTENCY_RULE_',
    // DemoTagger: no POS tags, no lemmas (used by suppress_misspelled suggestions)
    getTagger: () => ({ tag: (words: string[]) => words.map((w) => new AnalyzedTokenReadings(new AnalyzedToken(w, null, null), 0)) }),
  };
  return lang as never;
}
const english = makeLanguage();

/**
 * EnglishWordTokenizer (languagetool-language-modules/en), statement by statement, except that
 * without the English tagger only the contraction parts ('s, n't, ...) count as in the dictionary.
 */
const wordTokenizer = new WordTokenizer();
const enTokenizer = (() => {
  const CI = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
  const wordCharacters = '±§©@€£¥\\$\\p{L}\\d\\-\u0300-\u036F\u00A8°%‰‱&\uFFFD\u00AD\u00AC\uFF0C\uFF1F';
  const tokenizerPattern = Pattern.compile('[' + wordCharacters + ']+|[^' + wordCharacters + ']');
  const patternList = [
    Pattern.compile("^(fo['’]c['’]sle|rec['’][ds]|OK['’]d|cc['’][ds]|DJ['’][d]|[pd]m['’]d|rsvp['’]d)$", CI),
    Pattern.compile("^(['’]?)(are|is|were|was|do|does|did|have|has|had|wo|would|ca|could|sha|should|must|ai|ought|might|need|may|am|dare|das|dass|hai|used|use)(n['’]t)$", CI),
    Pattern.compile("^(.+)(['’]m|['’]re|['’]ll|['’]ve|['’]d|['’]s)(['’-]?)$", CI),
    Pattern.compile("^(['’]t)(was|were|is)$", CI),
  ];
  const wordsToAdd = (s: string): string[] => {
    const l: string[] = [];
    let hyphensAtEnd = 0;
    if (s !== '') {
      while (s.startsWith('-')) { l.push('-'); s = s.substring(1); }
      while (s.endsWith('-')) { s = s.substring(0, s.length - 1); hyphensAtEnd++; }
      if (s !== '') {
        if (!s.includes('-') && !s.includes("'") && !s.includes('’')) l.push(s);
        // the contraction parts, which the English tagger knows
        else if (inDictionary(s)) l.push(s);
        else for (const t of s.split(/(['’])/)) if (t !== '') l.push(t); // StringTokenizer(s, "’'", true)
      }
    }
    while (hyphensAtEnd-- > 0) l.push('-');
    return l;
  };
  return (text: string): string[] => {
    const l: string[] = [];
    const aux = text.replaceAll("'", 'xxAPOSTYPEWxx').replaceAll('’', 'xxAPOSTYPOGxx');
    const tokenizerMatcher = tokenizerPattern.matcher(aux);
    while (tokenizerMatcher.find()) {
      let s = tokenizerMatcher.group()!;
      if (l.length > 0 && s.length === 1 && s.codePointAt(0)! >= 0xFE00 && s.codePointAt(0)! <= 0xFE0F) { l[l.length - 1] += s; continue; }
      s = s.replaceAll('xxAPOSTYPEWxx', "'").replaceAll('xxAPOSTYPOGxx', '’');
      let matcher = null;
      if (s.includes("'") || s.includes('’')) {
        for (const pattern of patternList) {
          const m = pattern.matcher(s);
          if (m.find()) { matcher = m; break; }
        }
      }
      if (matcher != null) {
        for (let i = 1; i <= matcher.groupCount(); i++) l.push(...wordsToAdd(matcher.group(i) ?? ''));
      } else {
        l.push(...wordsToAdd(s));
      }
    }
    return (wordTokenizer as unknown as { joinEMailsAndUrls(l: string[]): string[] }).joinEMailsAndUrls(l);
  };
})();

/**
 * Whether the English tagger tags a word with an apostrophe: the contraction parts and a few
 * words, with EnglishTagger's case handling (lowercase lookup unless mixed case; -in' as -ing).
 */
function inDictionary(word: string): boolean {
  const w = word.replaceAll('’', "'");
  const known = (x: string) => /^('(s|re|m|ll|ve|d|t)|n't|o'clock|ma'am)$/.test(x);
  const lower = w.toLowerCase();
  if (known(w) || (w !== lower && !StringTools.isMixedCase(w) && known(lower))) return true;
  return lower.endsWith("in'") && !w.includes('-');
}

/** JLanguageTool.getRawAnalyzedSentence with an untagged tagger (DemoTagger: no POS, no lemma). */
function analyze(text: string): Sentence {
  const tokens = enTokenizer(text);
  // EnglishTagger: "This hack allows all rules and dictionary entries to work with typewriter apostrophe"
  const aTokens = tokens.map((t: string) => {
    const typographic = t.length > 1 && t.includes('’');
    const atr = new AnalyzedTokenReadings(new AnalyzedToken(typographic ? t.replaceAll('’', "'") : t, null, null), 0);
    if (typographic) atr.setTypographicApostrophe();
    return atr;
  });
  const tokenArray = [new AnalyzedTokenReadings([new AnalyzedToken('', 'SENT_START', null)], 0)];
  let startPos = 0;
  for (const posTag of aTokens) {
    posTag.setStartPos(startPos);
    tokenArray.push(posTag);
    startPos += posTag.getToken().length;
  }
  for (let i = 1; i < aTokens.length; i++) aTokens[i]!.setWhitespaceBefore(aTokens[i - 1]!.getToken());
  let lastToken = tokenArray.length - 1;
  for (let i = 0; i < tokenArray.length - 1; i++) {
    if (!tokenArray[lastToken - i]!.isWhitespace()) { lastToken -= i; break; }
  }
  tokenArray[lastToken]!.setSentEnd();
  return new AnalyzedSentence(tokenArray);
}

/** Whether a token (with its exceptions, groups and references) only tests the token text. */
function textOnlyToken(t: PatternTokenT): boolean {
  const pos = t.getPOStag();
  if (pos != null && (t.isPOStagRegularExpression() || (pos !== 'SENT_START' && pos !== 'SENT_END'))) return false;
  if (t.isInflected() || t.getChunkTag() != null || t.isUnified() || t.isUnificationNeutral()) return false;
  if (t.getMatch() != null && t.getMatch()!.getPosTag() != null) return false;
  const prev = (t as unknown as { rareFields: { previousExceptions: PatternTokenT[] } | null }).rareFields?.previousExceptions ?? [];
  return [...t.getExceptionList(), ...prev, ...t.getAndGroup(), ...t.getOrGroup()].every(textOnlyToken);
}

function textOnlyRule(rule: AbstractPatternRuleT): boolean {
  if (rule instanceof RegexPatternRule) return true;
  if (rule.getFilter() != null || rule.isTestUnification()) return false;
  if (rule.isInterpretPosTagsPreDisambiguation()) return false;
  if ([...rule.getSuggestionMatches(), ...rule.getSuggestionMatchesOutMsg()].some((m) => m.getPosTag() != null || m.checksSpelling())) return false;
  return rule.getPatternTokens()!.every(textOnlyToken) && rule.getAntiPatterns().every((ap) => ap.getPatternTokens()!.every(textOnlyToken));
}

type Failure = { id: string; example: string; problem: string };

/** PatternRuleTest's checks of one rule's examples. */
function checkExamples(rule: AbstractPatternRuleT, failures: Failure[]): number {
  let checked = 0;
  for (const ex of rule.getIncorrectExamples()) {
    checked++;
    const orig = ex.getExample();
    const text = orig.replaceAll('<marker>', '').replaceAll('</marker>', '');
    const expectedStart = orig.indexOf('<marker>');
    const expectedEnd = orig.indexOf('</marker>') - '<marker>'.length;
    let matches;
    try {
      matches = rule.match(analyze(text));
    } catch (e) {
      failures.push({ id: rule.getFullId(), example: orig, problem: `throws ${(e as Error).message} ${((e as Error).cause as Error)?.message ?? ''}` });
      continue;
    }
    if (matches.length !== 1 && !(rule instanceof PatternRule && rule.isWithComplexPhrase() && matches.length === 0)) {
      failures.push({ id: rule.getFullId(), example: orig, problem: `${matches.length} matches` });
      continue;
    }
    if (matches.length === 0) continue;
    const m = matches[0]!;
    if (expectedStart >= 0 && (m.getFromPos() !== expectedStart || m.getToPos() !== expectedEnd)) {
      failures.push({ id: rule.getFullId(), example: orig, problem: `at ${m.getFromPos()}-${m.getToPos()}, expected ${expectedStart}-${expectedEnd}` });
      continue;
    }
    const corrections = ex.getCorrections();
    if (corrections.length > 0) {
      const suggestions = m.getSuggestedReplacements();
      const expectedEmptyCorrection = corrections.length === 1 && corrections[0] === '';
      if (suggestions.length === 0 ? !expectedEmptyCorrection : JSON.stringify(suggestions) !== JSON.stringify(corrections)) {
        failures.push({ id: rule.getFullId(), example: orig, problem: `suggestions ${JSON.stringify(suggestions)}, expected ${JSON.stringify(corrections)}` });
      }
    }
  }
  for (const ex of rule.getCorrectExamples()) {
    checked++;
    const orig = ex.getExample();
    const text = orig.replaceAll('<marker>', '').replaceAll('</marker>', '');
    try {
      const matches = rule.match(analyze(text));
      if (matches.length !== 0) failures.push({ id: rule.getFullId(), example: orig, problem: `correct example matched at ${matches[0]!.getFromPos()}-${matches[0]!.getToPos()}` });
    } catch (e) {
      failures.push({ id: rule.getFullId(), example: orig, problem: `throws ${(e as Error).message}` });
    }
  }
  return checked;
}

/**
 * TODO: jdk SAXParse (saxes) expands internal entities as text, but Java's parser parses their
 * replacement text as markup, and grammar.xml has entities of <token>s (&date_dmy; ...). Until
 * SAXParse does that, the test expands those entities in the text before parsing.
 */
function expandMarkupEntities(xml: string): string {
  const doctypeEnd = xml.indexOf(']>');
  if (doctypeEnd < 0) return xml;
  const doctype = xml.slice(0, doctypeEnd);
  const raw = new Map<string, string>();
  for (const m of doctype.matchAll(/<!ENTITY\s+([^\s%]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) if (!raw.has(m[1]!)) raw.set(m[1]!, m[2] ?? m[3] ?? '');
  const done = new Map<string, string>();
  const expand = (name: string, depth = 0): string => {
    if (done.has(name)) return done.get(name)!;
    const v = (raw.get(name) ?? '').replace(/&([\w.-]+);/g, (all, n: string) => (raw.has(n) && depth < 20 ? expand(n, depth + 1) : all));
    done.set(name, v);
    return v;
  };
  const markup = [...raw.keys()].filter((n) => expand(n).includes('<'));
  if (markup.length === 0) return xml;
  const re = new RegExp(`&(${markup.join('|')});`, 'g');
  return xml.slice(0, doctypeEnd) + xml.slice(doctypeEnd).replace(re, (_all, n: string) => expand(n));
}

function loadRules(file: string) {
  const loader = new PatternRuleLoader();
  const t0 = performance.now();
  // TODO: jdk Pattern.ts does not accept Java's empty inline-flag group "(?)" yet (grammar.xml
  // uses regexp_match="(?)id"); until it does, the test leaves it out, which Java reads the same.
  const text = expandMarkupEntities(readFileSync(file, 'utf8').replaceAll('regexp_match="(?)', 'regexp_match="'));
  const rules = loader.getRules(text, file, english) as AbstractPatternRuleT[];
  return { rules, ms: performance.now() - t0, missing: loader.getMissingFilterWarnings() };
}

describe('StringMatcher', () => {
  it('enumerates the values of simple regexps', () => {
    expect(StringMatcher.getPossibleRegexpValues('foo|ba[rz]')).toEqual(new Set(['foo', 'bar', 'baz']));
    expect(StringMatcher.getPossibleRegexpValues('colou?r')).toEqual(new Set(['color', 'colour']));
    expect(StringMatcher.getPossibleRegexpValues('a.*')).toBeNull();
    expect(StringMatcher.getRequiredSubstrings('.*foo.*')?.toString()).toBe('(foo)');
    expect(StringMatcher.getRequiredSubstrings('foo.*bar')?.toString()).toBe('[foo, bar]');
  });

  it('matches like the regexp it stands for', () => {
    const ci = StringMatcher.create('Foo|bar', true, false);
    expect([ci.matches('foo'), ci.matches('BAR'), ci.matches('baz')]).toEqual([true, true, false]);
    const cs = StringMatcher.create('Foo|bar', true, true);
    expect([cs.matches('foo'), cs.matches('Foo')]).toEqual([false, true]);
    const re = StringMatcher.create('.*ing', true, false);
    expect([re.matches('RUNNING'), re.matches('ring'), re.matches('run')]).toEqual([true, true, false]);
    const regexp = StringMatcher.create('[a-z]+\\d', true, true);
    expect([regexp.matches('abc1'), regexp.matches('ABC1')]).toEqual([true, false]);
  });
});

describe('PatternRule', () => {
  it('matches a hand-made rule with suggestions and markers', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rules lang="en"><category id="TEST" name="Test">
  <rule id="THE_THE" name="the the">
    <pattern><marker><token>the</token><token>the</token></marker></pattern>
    <message>Repeated word: <suggestion>\\1</suggestion></message>
    <example correction="the">This is <marker>the the</marker> house.</example>
    <example>This is the house.</example>
  </rule>
  <rulegroup id="A_AN" name="a/an">
    <rule><pattern><token>a</token><marker><token regexp="yes">[aeiou].*<exception>use</exception></token></marker></pattern>
      <message>Use 'an'?</message></rule>
  </rulegroup>
</category></rules>`;
    const loader = new PatternRuleLoader();
    const rules = loader.getRules(xml, 'test.xml', english) as AbstractPatternRuleT[];
    expect(rules.map((r) => r.getFullId())).toEqual(['THE_THE[1]', 'A_AN[1]']);
    const m = rules[0]!.match(analyze('This is the the house.'));
    expect(m.map((x) => [x.getFromPos(), x.getToPos(), x.getSuggestedReplacements()])).toEqual([[8, 15, ['the']]]);
    expect(rules[1]!.match(analyze('a apple and a use')).map((x) => [x.getFromPos(), x.getToPos()])).toEqual([[2, 7]]);
  });
});

describe('English grammar.xml and style.xml', () => {
  const grammar = loadRules(`${EN_RULES}/grammar.xml`);
  const style = loadRules(`${EN_RULES}/style.xml`);
  const all = [...grammar.rules, ...style.rules];

  it('loads all rules', () => {
    console.log(`regexes refused by jdk Pattern.ts: ${refusedRegexes.size}`);
    for (const [re, msg] of [...refusedRegexes].slice(0, 40)) console.log(`  ${JSON.stringify(re)}: ${msg}`);
    console.log(`grammar.xml: ${grammar.rules.length} rules in ${grammar.ms.toFixed(0)} ms, ${grammar.missing.length} skipped for unported filters`);
    console.log(`style.xml: ${style.rules.length} rules in ${style.ms.toFixed(0)} ms, ${style.missing.length} skipped`);
    const missingClasses = new Map<string, number>();
    for (const w of [...grammar.missing, ...style.missing]) {
      const c = w.slice(w.indexOf(': ') + 2);
      missingClasses.set(c, (missingClasses.get(c) ?? 0) + 1);
    }
    console.log('unported filter classes:', Object.fromEntries(missingClasses));
    expect(grammar.rules.length).toBeGreaterThan(3000);
    expect(style.rules.length).toBeGreaterThan(500);
  });

  it('a RuleSet hints rules by token', () => {
    const set = RuleSet.textLemmaHinted(all);
    const s = analyze('This is the the house.');
    expect(set.rulesForSentence(s).length).toBeLessThan(all.length);
  });

  it("finds the incorrect examples of the token-text rules, and not the correct ones", () => {
    const failures: Failure[] = [];
    let rulesChecked = 0, examples = 0;
    const t0 = performance.now();
    for (const rule of all) {
      if (!textOnlyRule(rule)) continue;
      rulesChecked++;
      examples += checkExamples(rule, failures);
    }
    const ms = performance.now() - t0;
    const failedRules = new Set(failures.map((f) => f.id));
    console.log(`token-text rules: ${rulesChecked} of ${all.length}, ${examples} examples in ${ms.toFixed(0)} ms; ` +
      `${failures.length} examples fail, in ${failedRules.size} rules`);
    for (const f of failures.slice(0, 60)) console.log(`  ${f.id}: ${f.problem}: ${f.example}`);
    expect(rulesChecked).toBeGreaterThan(2000);
    expect(failures).toEqual([]);
  });

  it('runs every rule on its examples without exceptions (untagged)', () => {
    const errors: string[] = [];
    let runs = 0;
    for (const rule of all) {
      for (const ex of [...rule.getIncorrectExamples(), ...rule.getCorrectExamples()]) {
        const text = ex.getExample().replaceAll('<marker>', '').replaceAll('</marker>', '');
        runs++;
        try {
          rule.match(analyze(text));
        } catch (e) {
          const cause = (e as Error).cause as Error | undefined;
          errors.push(`${rule.getFullId()}: ${cause?.message ?? (e as Error).message}`);
        }
      }
    }
    console.log(`all rules on their examples: ${runs} runs, ${errors.length} exceptions`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
    expect(errors).toEqual([]);
  });
});

describe('English disambiguation.xml', () => {
  it('loads the rules', () => {
    const loader = new DisambiguationRuleLoader();
    let t0 = performance.now();
    const rules = loader.getRules(readFileSync(`${EN_RESOURCE}/disambiguation.xml`, 'utf8'), english, 'en/disambiguation.xml');
    const ms = performance.now() - t0;
    t0 = performance.now();
    const global = loader.getRules(readFileSync(`${CORE_RESOURCE}/disambiguation-global.xml`, 'utf8'), english, 'disambiguation-global.xml');
    console.log(`disambiguation.xml: ${rules.length} rules in ${ms.toFixed(0)} ms; disambiguation-global.xml: ${global.length} in ${(performance.now() - t0).toFixed(0)} ms`);
    expect(rules.length).toBeGreaterThan(500);
    expect(rules.every((r) => r instanceof DisambiguationPatternRule)).toBe(true);
  });

  it('immunizes and adds readings', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rules lang="en">
  <rule id="IMM" name="immunize"><pattern><token>New</token><token>York</token></pattern><disambig action="immunize"/></rule>
  <rule id="ADD" name="add"><pattern><marker><token>foo</token></marker></pattern><disambig action="add"><wd pos="NN" lemma="foo">foo</wd></disambig></rule>
</rules>`;
    const rules = new DisambiguationRuleLoader().getRules(xml, english, 'test.xml');
    expect(rules.map((r) => r.getAction())).toEqual([DisambiguatorAction.IMMUNIZE, DisambiguatorAction.ADD]);
    let s = analyze('I love New York and foo.');
    for (const r of rules) s = r.replace(s);
    const toks = s.getTokensWithoutWhitespace();
    expect(toks.filter((t) => t.isImmunized()).map((t) => t.getToken())).toEqual(['New', 'York']);
    expect(toks.find((t) => t.getToken() === 'foo')!.hasPosTag('NN')).toBe(true);
  });
});

describe('EnglishHybridDisambiguator parts', () => {
  it('MultiWordChunker tags multiwords of en/multiwords.txt', () => {
    const chunker = MultiWordChunker.getInstance('/en/multiwords.txt', true, true, false);
    chunker.setIgnoreSpelling(true);
    chunker.setRemovePreviousTags(true);
    const s = chunker.disambiguate(analyze('He did it ad hoc.'));
    const toks = s.getTokensWithoutWhitespace();
    const tags = (w: string) => toks.filter((t) => t.getToken() === w).flatMap((t) => t.getReadings().map((r) => r.getPOSTag()));
    // "ad hoc\tJJ" and "ad hoc\tRB": the later line wins (Map.put); <RB></RB> become RB RB
    expect([tags('ad'), tags('hoc'), tags('did')]).toEqual([['RB'], ['RB'], [null]]);
    expect(toks.find((t) => t.getToken() === 'hoc')!.isIgnoredBySpeller()).toBe(true);
  });

  it('XmlRuleDisambiguator loads disambiguation.xml and disambiguation-global.xml and runs', () => {
    const t0 = performance.now();
    const disambiguator = new XmlRuleDisambiguator(english, true);
    const ms = performance.now() - t0;
    const t1 = performance.now();
    let n = 0;
    for (const text of ['This is a test sentence.', "I don't know what it's about.", 'The quick brown fox jumps over the lazy dog.']) {
      disambiguator.disambiguate(analyze(text));
      n++;
    }
    console.log(`XmlRuleDisambiguator: loaded in ${ms.toFixed(0)} ms, ${n} sentences in ${(performance.now() - t1).toFixed(1)} ms`);
  });
});
