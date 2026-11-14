// SPDX-License-Identifier: MPL-2.0
// German style and generic rules (rules/de/*.ts on the core bases) and German rule filters, checked
// with ports of LanguageTool's own unit tests: GermanCommaWhitespaceRuleTest, GermanWordRepeatRuleTest,
// WordRepeatRuleTest (de), GermanWordRepeatBeginningRuleTest, GenericUnpairedBracketsRuleTest (de),
// GermanUnpairedQuotesRuleTest, LongSentenceRuleTest (de), SentenceWhitespaceRuleTest (de),
// GermanParagraphRepeatBeginningRuleTest, GermanFillerWordsRuleTest, NonSignificantVerbsRuleTest,
// UnnecessaryPhraseRuleTest, RedundantModalOrAuxiliaryVerbTest, GermanStyleRepeatedWordRuleTest,
// GermanRepeatedWordsRuleTest, DateCheckFilterTest (de), InsertCommaFilterTest,
// GermanNumberInWordFilterTest; plus a check that every filter class the German rule files name
// is registered. Shares germanrules/testGerman.ts (German with stubs for the rule classes not
// ported yet). TestTools.getEnglishMessages() is German's bundle here (only category names
// differ). Tests that need GermanSpellerRule are todos while it is not ported.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { german, isPorted } from './germanrules/testGerman.ts';
import { fileForResource } from './broker.ts';
import { JLanguageTool } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { UserConfig } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/UserConfig.ts';
import type { AnalyzedSentence } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { Language } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import { Rule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { Example } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/Example.ts';
import { GenericUnpairedBracketsRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/GenericUnpairedBracketsRule.ts';
import { GenericUnpairedQuotesRule } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/GenericUnpairedQuotesRule.ts';
import { FilterRegistry } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { Tools } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/tools/Tools.ts';
import { Calendar } from '../../../src/languagetool/jdk/java/util/Calendar.ts';
import type { ResourceBundle } from '../../../src/languagetool/jdk/java/util/ResourceBundle.ts';
import { GermanCommaWhitespaceRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanCommaWhitespaceRule.ts';
import { GermanWordRepeatRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanWordRepeatRule.ts';
import { LongSentenceRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/LongSentenceRule.ts';
import { GermanParagraphRepeatBeginningRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanParagraphRepeatBeginningRule.ts';
import { GermanFillerWordsRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanFillerWordsRule.ts';
import { NonSignificantVerbsRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/NonSignificantVerbsRule.ts';
import { UnnecessaryPhraseRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/UnnecessaryPhraseRule.ts';
import { RedundantModalOrAuxiliaryVerb } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/RedundantModalOrAuxiliaryVerb.ts';
import { GermanStyleRepeatedWordRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanStyleRepeatedWordRule.ts';
import { GermanRepeatedWordsRule } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanRepeatedWordsRule.ts';
import { DateCheckFilter } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/DateCheckFilter.ts';
import { InsertCommaFilter } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/InsertCommaFilter.ts';
import { GermanNumberInWordFilter } from '../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanNumberInWordFilter.ts';

const str = (o: unknown): string => Array.isArray(o) ? '[' + o.map((x) => String(x)).join(', ') + ']' : String(o);

class FakeRule extends Rule {
  override getId(): string { return 'FAKE-RULE'; }
  override getDescription(): string { return 'fake'; }
  override match(_s: AnalyzedSentence): RuleMatch[] { return []; }
}

let lt: JLanguageTool;
let messages: ResourceBundle;
let de: Language;
/** A second JLanguageTool for the tests that disable all rules and add their own (setUpRule). */
let ltOwn: JLanguageTool;
beforeAll(() => {
  ({ lt, messages, german: de } = german());
  ltOwn = new JLanguageTool(de);
}, 300_000);

/** The tests' setUpRule: disables every rule, then adds and enables the rule. */
function setUpRule(tool: JLanguageTool, rule: Rule): void {
  for (const r of tool.getAllRules()) {
    tool.disableRule(r.getId());
  }
  tool.addRule(rule);
  tool.enableRule(rule.getId());
}

/** TestTools.disableAllRulesExcept */
function disableAllRulesExcept(tool: JLanguageTool, ruleId: string): void {
  for (const rule of tool.getAllRules()) {
    if (rule.getId() !== ruleId) tool.disableRule(rule.getId());
  }
}

/** A test that needs GermanSpellerRule: a todo while it is not ported. */
const withSpeller = (name: string, fn: () => void, timeout?: number): void => {
  if (isPorted('GermanSpellerRule')) it(name, fn, timeout);
  else it.todo(name + ' (needs GermanSpellerRule, not ported yet)');
};

describe('GermanCommaWhitespaceRuleTest', () => {
  it('testRule', () => {
    const rule = new GermanCommaWhitespaceRule(messages,
      Example.wrong('Die Partei<marker> ,</marker> die die letzte Wahl gewann.'),
      Example.fixed('Die Partei<marker>,</marker> die die letzte Wahl gewann.'),
      Tools.getUrl('http://fake'));
    expect(rule.match(lt.getAnalyzedSentence('Es gibt 5 Millionen .de-Domains.')).length).toBe(0);
  }, 120_000);
});

describe('GermanWordRepeatRuleTest', () => {
  it('testRule', () => {
    const rule = new GermanWordRepeatRule(messages, de);
    const n = (text: string): number => rule.match(lt.getAnalyzedSentence(text)).length;
    expect(n('Das ist gut so.')).toBe(0);
    expect(n('Das ist ist gut so.')).toBe(1);
    expect(n('Der der Mann')).toBe(1);
    expect(n('Warum fragen Sie sie nicht selbst?')).toBe(0);
    expect(n('Er will nur sein Leben leben.')).toBe(0);
    expect(n('Wie bei Honda, die die Bezahlung erhöht haben.')).toBe(0);
    expect(n('Dann warfen sie sie weg.')).toBe(0);
    expect(n('Dann konnte sie sie sehen.')).toBe(0);
    expect(n('Er muss sein Essen essen.')).toBe(0);
    expect(n('Wahrscheinlich ist das das Problem.')).toBe(0);
    expect(n('Dann wäre das das erste Wirtschaftsmagazin mit mehr als 10.000 Lesern.')).toBe(0);
    expect(n('Für mich war das das Härteste.')).toBe(0);
    expect(n('Ich weiß, wer wer ist!')).toBe(0);
    expect(n('Ich kann das machen, falls das das Problem ist.')).toBe(0);
    expect(n('Als ich das das erste Mal gehört habe …')).toBe(0);
    expect(n('Hat sie sie')).toBe(1);  // used to crash, issue #1010
    expect(n('Hat hat')).toBe(1);
    expect(n('hat hat')).toBe(1);
  }, 120_000);
});

describe('WordRepeatRuleTest (de)', () => {
  it('testRuleGerman', () => {
    const rule = new GermanWordRepeatRule(messages, de);
    const assertGood = (text: string) => expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(0);
    const assertBad = (text: string) => expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(1);
    assertGood('Das sind die Sätze, die die testen sollen.');
    assertGood('Sätze, die die testen.');
    assertGood('Das Haus, auf das das Mädchen zeigt.');
    assertGood('Warum fragen Sie sie nicht selbst?');
    assertGood('Er tut das, damit sie sie nicht sieht.');

    assertBad('Die die Sätze zum testen.');
    assertBad('Und die die Sätze zum testen.');
    assertBad('Auf der der Fensterbank steht eine Blume.');
    assertBad('Das Buch, in in dem es steht.');
    assertBad('Das Haus, auf auf das Mädchen zurennen.');
    assertBad('Sie sie gehen nach Hause.');
  }, 120_000);
});

describe('GermanWordRepeatBeginningRuleTest', () => {
  it('testRule', () => {
    const tool = new JLanguageTool(de);
    tool.disableRule('DE_REPEATEDWORDS');
    const n = (text: string): number => tool.check(text).length;
    // correct sentences:
    expect(n('Er ist nett. Er heißt Max.')).toBe(0);
    expect(n('Außerdem kommt er. Ferner kommt sie. Außerdem kommt es.')).toBe(0);
    expect(n('2011: Dieses passiert. 2011: Jenes passiert. 2011: Nicht passiert')).toBe(0);
    // errors:
    expect(n('Er ist nett. Er heißt Max. Er ist 11.')).toBe(1);
    expect(n('Außerdem kommt er. Außerdem kommt sie.')).toBe(1);
    // this used to cause false alarms because reset() was not implemented
    expect(n('Außerdem ist das ein neuer Text.')).toBe(0);
    // only consider 'real' sentences that end in [.!?]:
    expect(n('Außerdem ist das ein neuer Text\n\nAußerdem noch mehr ohne Punkt\n\nAußerdem schon wieder')).toBe(0);
  }, 120_000);
});

describe('GenericUnpairedBracketsRuleTest (de)', () => {
  it('testGermanRule', () => {
    const rule = lt.getAllActiveRules().find((r) => r instanceof GenericUnpairedBracketsRule) as GenericUnpairedBracketsRule;
    expect(rule.getId()).toBe('UNPAIRED_BRACKETS');
    const assertMatches = (input: string, expected: number) =>
      expect(rule.match([lt.getAnalyzedSentence(input)]).length, input).toBe(expected);
    // correct sentences:
    assertMatches('(Das sind die Sätze, die sie testen sollen).', 0);
    assertMatches('(Das sind die {Sätze}, die sie testen sollen).', 0);
    assertMatches('(Das sind die [Sätze], die sie testen sollen).', 0);
    assertMatches('(Das sind die Sätze (noch mehr Klammern [schon wieder!]), die sie testen sollen).', 0);
    assertMatches('Das ist ein Satz mit Smiley :-)', 0);
    assertMatches('Das ist auch ein Satz mit Smiley ;-)', 0);
    assertMatches('Das ist ein Satz mit Smiley :)', 0);
    assertMatches('Das ist ein Satz mit Smiley :(', 0);
    assertMatches('Die URL lautet https://de.wikipedia.org/wiki/Schlammersdorf_(Adelsgeschlecht)', 0);
    assertMatches('Die URL lautet https://de.wikipedia.org/wiki/Schlammersdorf_(Adelsgeschlecht).', 0);
    assertMatches('(Die URL lautet https://de.wikipedia.org/wiki/Schlammersdorf_(Adelsgeschlecht))', 0);
    assertMatches('(Die URL lautet https://de.wikipedia.org/wiki/Schlammersdorf)', 0);
    assertMatches('(Die URL lautet https://de.wikipedia.org/wiki/Schlammersdorf oder so)', 0);
    assertMatches('(Die URL lautet: http://www.pariscinema.org/).', 0);
    // these used to have wrong positions, causing "Could not map ... to original position":
    lt.check('Im Kran­ken­haus. Auch)');
    lt.check('Ein Kran­ken­haus. Auch)');
    lt.check('Das Kran­ken­haus. Auch)');
    lt.check('Kran­ken­haus. Auch)');
    lt.check('Kran­ken­haus. (Auch');
  }, 120_000);
});

describe('GermanUnpairedQuotesRuleTest', () => {
  it('testGermanRule', () => {
    const rule = lt.getAllActiveRules().find((r) => r instanceof GenericUnpairedQuotesRule) as GenericUnpairedQuotesRule;
    expect(rule.getId()).toBe('DE_UNPAIRED_QUOTES');
    const assertMatches = (input: string, expected: number) =>
      expect(rule.match([lt.getAnalyzedSentence(input)]).length, input).toBe(expected);
    // correct sentences:
    assertMatches('»Das sind die Sätze, die sie testen sollen«.', 0);
    assertMatches('«Das sind die ‹Sätze›, die sie testen sollen».', 0);
    assertMatches('»Das sind die ›Sätze‹, die sie testen sollen«.', 0);
    assertMatches('»Das sind die Sätze ›noch mehr Anführungszeichen‹ ›schon wieder!‹, die sie testen sollen«.', 0);
    assertMatches('»Das sind die Sätze ›noch mehr Anführungszeichen ›hier ein Fehler!‹‹, die sie testen sollen«.', 2);
    assertMatches('„Das sind die Sätze ‚noch mehr Anführungszeichen‘ ‚schon wieder!‘, die sie testen sollen“.', 0);
    assertMatches('„Das sind die Sätze ‚noch mehr Anführungszeichen ‚hier ein Fehler!‘‘, die sie testen sollen“.', 2);
    assertMatches('„Das sind die Sätze, die sie testen sollen.“ „Hier steht ein zweiter Satz.“', 0);
    assertMatches('Drücken Sie auf den "Jetzt Starten"-Knopf.', 0);
    assertMatches('Welches ist dein Lieblings-"Star Wars"-Charakter?', 0);
    assertMatches("‚So 'n Blödsinn!‘", 0);
    assertMatches('‚’n Blödsinn!‘', 0);
    assertMatches("'So 'n Blödsinn!'", 0);
    assertMatches("''n Blödsinn!'", 0);
    assertMatches('‚Das ist Hans’.‘', 0);
    assertMatches("'Das ist Hans'.'", 0);
    assertMatches('Das Fahrrad hat 26" Räder.', 0);
    assertMatches('"Das Fahrrad hat 26" Räder."', 0);
    assertMatches('und steigern » Datenbankperformance steigern » Tipps zur Performance-Verbesserung', 0);
    // incorrect sentences:
    assertMatches('"Das Fahrrad hat 26" Räder." "Und hier fehlt das abschließende doppelte Anführungszeichen.', 1);
    assertMatches('Die „Sätze zum Testen.', 1);
    assertMatches('Die «Sätze zum Testen.', 1);
    assertMatches('Die »Sätze zum Testen.', 1);
    // these used to have wrong positions, causing "Could not map ... to original position":
    lt.check('Im Kran­ken­haus. Auch)');
    lt.check('Ein Kran­ken­haus. Auch)');
    lt.check('Das Kran­ken­haus. Auch)');
    lt.check('Kran­ken­haus. Auch)');
    lt.check('Kran­ken­haus. (Auch');
  }, 120_000);
});

describe('LongSentenceRuleTest (de)', () => {
  it('testMatch', () => {
    const rule = new LongSentenceRule(messages, new UserConfig(), 6);
    const assertNoMatch = (input: string) => expect(rule.match(lt.analyzeText(input)).length, input).toBe(0);
    const assertMatch = (input: string, from: number, to: number) => {
      const matches = rule.match(lt.analyzeText(input));
      expect(matches.length, input).toBe(1);
      expect(matches[0]!.getFromPos()).toBe(from);
      expect(matches[0]!.getToPos()).toBe(to);
    };
    assertNoMatch('Eins zwei drei vier fünf sechs.');
    //  Words after colon are treated like a separate sentence
    assertNoMatch('Ich zähle jetzt: "Eins zwei drei vier fünf sechs."');
    assertNoMatch('Peter, bist du bereit?” Er nickte nur.\n');
    assertNoMatch('Peter, du bist bereit.” Er nickte nur.\n');
    assertNoMatch('Eins zwei drei vier fünf (sechs sieben) acht.');

    assertMatch('Eins zwei drei vier fünf sechs sieben.', 0, 38);
    assertMatch('Eins zwei drei vier fünf (sechs sieben) acht neun.', 0, 50);
    assertMatch('Ich zähle jetzt: Eins zwei drei vier fünf sechs sieben.', 0, 55);
    assertMatch('Ein Satz. Eins zwei drei vier fünf sechs sieben.', 10, 48);
  }, 120_000);
});

describe('SentenceWhitespaceRuleTest (de)', () => {
  it('testMatch', () => {
    const tool = new JLanguageTool(de);
    disableAllRulesExcept(tool, 'DE_SENTENCE_WHITESPACE');
    const assertGood = (text: string) => expect(tool.check(text).length, text).toBe(0);
    const assertBad = (text: string) => expect(tool.check(text).length, text).toBe(1);

    assertGood('Das ist ein Satz. Und hier der nächste.');
    assertGood('Das ist ein Satz! Und hier der nächste.');
    assertGood('Ist das ein Satz? Hier der nächste.');

    assertBad('Das ist ein Satz.Und hier der nächste.');
    assertBad('Das ist ein Satz!Und hier der nächste.');
    assertBad('Ist das ein Satz?Hier der nächste.');

    assertGood('Am 28. September.');
    assertBad('Am 28.September.');

    assertGood('Das 1. Internationale Filmfestival findet nächste Woche statt.');
    assertBad('Das 1.Internationale Filmfestival findet nächste Woche statt.');

    expect(tool.check('Am 7.September 2014.')[0]!.getMessage()).toContain('nach Ordnungszahlen');
    expect(tool.check('Im September.Dann der nächste Satz.')[0]!.getMessage()).toContain('zwischen Sätzen');
  }, 120_000);
});

describe('GermanParagraphRepeatBeginningRuleTest', () => {
  it('testRule', () => {
    setUpRule(ltOwn, new GermanParagraphRepeatBeginningRule(messages, de));
    const n = (text: string): number => ltOwn.check(text).length;
    expect(n('Der Hund spazierte über die Straße.\n\nDer Hund ignorierte den Verkehr.')).toBe(2);
    expect(n('Der Hund spazierte über die Straße.\n\nDas Tier ignorierte den Verkehr.')).toBe(0);
    expect(n('Peter spazierte über die Straße.\n\nPeter ignorierte den Verkehr.')).toBe(2);
    expect(n('Peter spazierte über die Straße.\n\nDer Junge ignorierte den Verkehr.')).toBe(0);
    expect(n('»Peter spazierte über die Straße.«\n\n»Peter ignorierte den Verkehr.«')).toBe(2);
  }, 120_000);
});

describe('GermanFillerWordsRuleTest', () => {
  it('testRule', () => {
    const n = (text: string): number => ltOwn.check(text).length;
    setUpRule(ltOwn, new GermanFillerWordsRule(messages, de, null));

    //  more than 8% filler words (default)
    expect(n('Der Satz enthält augenscheinlich ein Füllwort.')).toBe(1);
    expect(n('Der Satz enthält augenscheinlich relativ viele Füllwörter.')).toBe(2);
    //  less than 8% filler words - don't show them
    expect(n('Der Satz enthält augenscheinlich ein Füllwort, aber es sind nicht genug um angezeigt zu werden.')).toBe(0);
    //  direct speech or citation - don't show filler words
    expect(n('»Der Satz enthält augenscheinlich ein Füllwort«')).toBe(0);
    //  less than 8% filler words - but three in one sentence (show 3 instead of 4) <- don't show them per default
    expect(n('Der Text enthält zu wenige Füllwörter, daher werden sie nicht angezeigt. Was sich an diesem Satz mit diesem relativ einfachen Füllwort zeigt. Dazu müssen noch eine Reihe von Sätzen geschrieben werden, um die Anzahl der Wörter zu erhöhen. Langsam sollten die Anzahl der Worte für das Drücken unter die kritische Grenze reichen. Jetzt schreibe ich allerdings einen Satz, der drei Füllwörter enthält, was allemal ziemlich ausreichend ist.')).toBe(0);
    //  less than 8% filler words - but two consecutively (show 2 instead of 3) <- don't show them per default
    expect(n('Der Text enthält zu wenige Füllwörter, daher werden sie nicht angezeigt. Was sich an diesem Satz mit diesem relativ einfachen Füllwort zeigt. Dazu müssen noch eine Reihe von Sätzen geschrieben werden, um die Anzahl der Wörter zu erhöhen. Langsam sollten die Anzahl der Worte für das Drücken unter die kritische Grenze reichen. Jetzt schreibe ich einen Satz, der zwei Füllwörter hintereinander enthält, was allemal ziemlich ausreichend ist.')).toBe(0);

    //  percentage set to zero - show all filler words
    const ruleValues = new Map<string, unknown[]>();
    ruleValues.set('FILLER_WORDS_DE', [0]);
    let userConfig = new UserConfig(ruleValues);
    setUpRule(ltOwn, new GermanFillerWordsRule(messages, de, userConfig));
    expect(n('»Der Satz enthält augenscheinlich ein Füllwort«')).toBe(1);
    expect(n('Der Satz enthält augenscheinlich ein Füllwort, aber es sind nicht genug um angezeigt zu werden.')).toBe(1);

    ruleValues.set('FILLER_WORDS_DE', [8, true, true, true]);
    userConfig = new UserConfig(ruleValues);
    setUpRule(ltOwn, new GermanFillerWordsRule(messages, de, userConfig));
    //  direct speech or citation - show filler words because of option set
    expect(n('»Der Satz enthält augenscheinlich ein Füllwort«')).toBe(1);
    //  less than 8% filler words - but three in one sentence (show 3 instead of 4)
    expect(n('Der Text enthält zu wenige Füllwörter, daher werden sie nicht angezeigt. Was sich an diesem Satz mit diesem relativ einfachen Füllwort zeigt. Dazu müssen noch eine Reihe von Sätzen geschrieben werden, um die Anzahl der Wörter zu erhöhen. Langsam sollten die Anzahl der Worte für das Drücken unter die kritische Grenze reichen. Jetzt schreibe ich allerdings einen Satz, der vier Füllwörter enthält, was allemal ziemlich ausreichend ist.')).toBe(4);
    //  less than 8% filler words - but two consecutively (show 2 instead of 3)
    expect(n('Der Text enthält zu wenige Füllwörter, daher werden sie nicht angezeigt. Was sich an diesem Satz mit diesem relativ einfachen Füllwort zeigt. Dazu müssen noch eine Reihe von Sätzen geschrieben werden, um die Anzahl der Wörter zu erhöhen. Langsam sollten die Anzahl der Worte für das Drücken unter die kritische Grenze reichen. Jetzt schreibe ich einen Satz, der zwei Füllwörter hintereinander enthält, was allemal ziemlich ausreichend ist.')).toBe(3);
  }, 120_000);
});

describe('NonSignificantVerbsRuleTest', () => {
  it('testRule', () => {
    setUpRule(ltOwn, new NonSignificantVerbsRule(messages, de, new UserConfig()));
    expect(ltOwn.check('Wenn man das machen kann, sollte man das tun. Das ist so.').length).toBe(3);
    expect(ltOwn.check('Der Vorgang war abgeschlossen. Das hatte er nicht bedacht.').length).toBe(0);
  }, 120_000);
});

describe('UnnecessaryPhraseRuleTest', () => {
  it('testRule', () => {
    setUpRule(ltOwn, new UnnecessaryPhraseRule(messages, de, new UserConfig()));
    expect(ltOwn.check('In diesem Zusammenhang ist es im Allgemeinen voll und ganz zumindest mehr oder weniger sinnvoll.').length).toBe(4);
    //  exclude direct speach:
    expect(ltOwn.check('„In diesem Zusammenhang ist es im Allgemeinen voll und ganz zumindest mehr oder weniger sinnvoll.“').length).toBe(0);
    expect(ltOwn.check('Es ist weniger sinnvoll.').length).toBe(0);
  }, 120_000);
});

describe('RedundantModalOrAuxiliaryVerbTest', () => {
  it('testRule', () => {
    setUpRule(ltOwn, new RedundantModalOrAuxiliaryVerb(messages));
    const n = (text: string): number => ltOwn.check(text).length;
    //  matches
    expect(n('Erst werde ich die Preise vergleichen und erst dann werde ich entscheiden, ob ich die Kamera kaufe.')).toBe(1);
    expect(n('Sie hat das Foto von mir als kleinem Jungen angeschaut und hat gelacht.')).toBe(1);
    expect(n('Ich bin gern in eurer Mitte und ich bin gern zu Gast bei euch.')).toBe(1);
    expect(n('Da ich nun einmal bin, wer ich bin und was ich bin, kann ich es nicht übers Herz bringen.')).toBe(1);
    expect(n('Wann ist jemand kühn und wann ist jemand tollkühn?')).toBe(1);
    expect(n('Tom ist um halb drei angekommen und Mary ist kurze Zeit später angekommen.')).toBe(1);
    expect(n('Das Essen ist gut und der Service hier ist gut.')).toBe(1);
    expect(n('Wir müssen wissen, was wir tun sollen und wie wir es tun sollen.')).toBe(1);
    expect(n('Ich muss unbedingt wissen, was zu tun ist, wie es zu tun ist und wann es zu tun ist.')).toBe(1);
    expect(n('Er erzählte ihr, eine böse Hexe habe ihn in einen Frosch verwandelt und nur sie allein habe ihn retten können und morgen würden sie gemeinsam in sein Reich fahren.')).toBe(1);
    //  no match
    expect(n('„nicht dürfen“ und „nicht müssen“ dürfen nicht miteinander verwechselt werden.')).toBe(0);
    expect(n('Ich mag Physik und Mathematik mag ich noch mehr.')).toBe(0);
    expect(n('Aus Angst vor den Zeitungen sind Politiker langweilig und am Ende sind sie selbst für die Zeitungen zu langweilig.')).toBe(0);
    expect(n('Ändert der Akkusativ wirklich die Bedeutung eines Satzes: Sie hat Aids oder Aids hat sie?')).toBe(0);
    expect(n('Tom hat eine Tüte Äpfel gekauft und er hat an einem Tag ein Drittel davon gegessen.')).toBe(0);
    expect(n('Mein Vaterland ist mein Stadtviertel und nun ist es beinahe nicht wiedererkennbar.')).toBe(0);
    expect(n('Johnny hat Alice vorgeschlagen und sie hat akzeptiert.')).toBe(0);
    expect(n('Unsere Zeit hier ist begrenzt und sie ist wertvoll.')).toBe(0);
    expect(n('Manchmal ist die Wahrheit nützlich und manchmal ist sie unnütz.')).toBe(0);
    expect(n('Treue ist irgendwo absolut oder sie ist gar nichts.')).toBe(0);
    expect(n('Sie mag niemanden und niemand mag sie.')).toBe(0);
    expect(n('Eines Tages wird die USA eine Frau als Präsidenten wählen und das wird kein schönes Schauspiel sein.')).toBe(0);
    expect(n('Mein Name ist Mary und das ist Tom.')).toBe(0);
    expect(n('Er hat seine Augen langsam geöffnet und dann hat sie ihn geküsst.')).toBe(0);
    expect(n('Die Flaneure haben es prinzipiell nicht eilig und sind immer für ein Schwätzchen zu haben.')).toBe(0);
    expect(n('Es sind Tendenzen erkennbar und diese Tendenzen sind leider nicht ermutigend.')).toBe(0);
    expect(n('Ja ist ja und nein ist nein, das nennt man Offenheit.')).toBe(0);
    expect(n('Wie werden einmal unsere Namen hinter den Erfindern des Fliegens und dergleichen vergessen werden?')).toBe(0);
    expect(n('In den Chroniken ist über die Flut von 1342 zu lesen, dass im Mainzer Dom einem Mann das Wasser bis zur Brust gestanden habe und dass man in Köln mit Booten über die Stadtmauern habe fahren können.')).toBe(0);
    expect(n('Sie stellt sicher, dass die gerissenen Bänder nicht belastet werden können und dass das Gelenk dennoch bewegt werden kann.')).toBe(0);
  }, 120_000);
});

describe('GermanStyleRepeatedWordRuleTest', () => {
  it('testRule', () => {
    const n = (text: string): number => ltOwn.check(text).length;
    let rule = new GermanStyleRepeatedWordRule(messages, de, new UserConfig());
    setUpRule(ltOwn, rule);

    expect(n('Der alte Mann wohnte in einem großen Haus. Es stand in einem großen Garten.')).toBe(2);
    expect(n('Der alte Mann wohnte in einem großen Haus. Es stand in einem weitläufigen Garten.')).toBe(0);
    expect(n('Endlos lang zog sich der Ton dahin, aber schließlich verklang er doch.')).toBe(0);
    expect(n('Die Au leuchtete im Blitz, die Glühwürmchen flimmerten vor Aufregung.')).toBe(0);
    expect(n('Sie sind alle in der gleichen Art hergestellt. Nur bei einem Artefakt wurde eine andere Vorgehensweise angewandt.')).toBe(0);
    expect(n('Ich erkannte keinen Lidschlag zu spät, dass es nicht in ihrer Absicht lag.')).toBe(0);
    expect(n('Dieser Schritt brachte uns näher an die Lösung. Der nächste würde das Problem für immer aus der Welt schaffen.')).toBe(0);
    expect(n('Er lehnte seinen Wanderstab gegen die Wand.')).toBe(0);
    expect(n('Zweifel lagen in der Luft, ob es richtig war, diesen Weg einzuschlagen.')).toBe(0);
    expect(n('Der Donnerhall verklang nur langsam in meinen Ohren. Das war mir in all den Jahren meines Lebens noch nicht passiert.')).toBe(0);
    expect(n('Der Schiffsmotor, der im Heck des Schiffs eingebaut war, röhrte. Auf Hochtouren lief der Motor.')).toBe(0);
    expect(n('Der Buntspecht stolzierte den Baum hoch. Schon klopfte der Specht.')).toBe(0);
    expect(n('Rotbraun war die Farbe der Haselnuss. Der Horizont schimmerte rot.')).toBe(0);
    expect(n("Rotbraun war die Farbe der Haselnuss. Was für eine 'Farbe'?")).toBe(0);
    expect(n('Der Ausblick war überwätigend. "Was für ein Ausblick!", sagte sie auch prompt.')).toBe(0);
    expect(n('Frau Heinrich stand unschlüssig in in ihrem Garten. Frau Müller schaute zu ihr herüber.')).toBe(0);

    const ruleValues = new Map<string, unknown[]>();
    ruleValues.set(rule.getId(), [1, false, true]);
    rule = new GermanStyleRepeatedWordRule(messages, de, new UserConfig(ruleValues));
    setUpRule(ltOwn, rule);
    expect(n('Der Schiffsmotor, der im Heck des Schiffs eingebaut war, röhrte. Auf Hochtouren lief der Motor.')).toBe(3);
    expect(n('Der Buntspecht stolzierte den Baum hoch. Schon klopfte der Specht.')).toBe(2);
    expect(n('Rotbraun war die Farbe der Haselnuss. Der Horizont schimmerte rot.')).toBe(2);
    expect(n('Der Ausblick war überwätigend. "Was für ein Ausblick!", sagte sie auch prompt.')).toBe(2);
  }, 120_000);
});

describe('GermanRepeatedWordsRuleTest', () => {
  it('testRule', () => {
    const rule = new GermanRepeatedWordsRule(messages);
    expect(rule.match(lt.analyzeText('Lauf so schnell wie möglich. Das ist MÖGLICH!')).length).toBe(0);
    const matches = rule.match(lt.analyzeText('Das ist hervorragende Arbeit. Die Ergebnisse sind hervorragend.'));
    expect(matches.length).toBe(1);
    expect(str(matches[0]!.getSuggestedReplacements())).toBe('[brillant, exzellent, perfekt, fantastisch, traumhaft]');
  }, 120_000);
});

describe('DateCheckFilterTest (de)', () => {
  const match = (): RuleMatch => new RuleMatch(new FakeRule(), null, 0, 10, 'message');
  const makeMap = (year: string, month: string, dayOfMonth: string, weekDay: string): Map<string, string> =>
    new Map([['year', year], ['month', month], ['day', dayOfMonth], ['weekDay', weekDay]]);

  it('testAcceptIncompleteArgs', () => {
    const filter = new DateCheckFilter();
    const map = makeMap('2014', '8', '23', 'Samstag');
    map.delete('weekDay');
    expect(() => filter.acceptRuleMatch(match(), map, -1, null as never, null as never)).toThrow(/IllegalArgumentException/);
  });

  it('testGetDayOfWeek1', () => {
    const filter = new DateCheckFilter();
    expect(filter.getDayOfWeek('So')).toBe(1);
    expect(filter.getDayOfWeek('Mo')).toBe(2);
    expect(filter.getDayOfWeek('mo')).toBe(2);
    expect(filter.getDayOfWeek('Mon.')).toBe(2);
    expect(filter.getDayOfWeek('Montag')).toBe(2);
    expect(filter.getDayOfWeek('montag')).toBe(2);
    expect(filter.getDayOfWeek('Di')).toBe(3);
    expect(filter.getDayOfWeek('Fr')).toBe(6);
    expect(filter.getDayOfWeek('Samstag')).toBe(7);
    expect(filter.getDayOfWeek('Sonnabend')).toBe(7);
  });

  it('testGetDayOfWeek2', () => {
    const filter = new DateCheckFilter();
    const calendar = Calendar.getInstance();
    calendar.set(2014, 8 - 1, 29);
    expect(filter.getDayOfWeek(calendar)).toBe('Freitag');
    calendar.set(2014, 8 - 1, 30);
    expect(filter.getDayOfWeek(calendar)).toBe('Samstag');
  });

  it('testGetMonth', () => {
    const filter = new DateCheckFilter();
    expect(filter.getMonth('Januar')).toBe(1);
    expect(filter.getMonth('Jan')).toBe(1);
    expect(filter.getMonth('Jan.')).toBe(1);
    expect(filter.getMonth('Dezember')).toBe(12);
    expect(filter.getMonth('Dez')).toBe(12);
    expect(filter.getMonth('dez')).toBe(12);
    expect(filter.getMonth('DEZEMBER')).toBe(12);
    expect(filter.getMonth('dezember')).toBe(12);
  });
});

describe('InsertCommaFilterTest', () => {
  it('testFilter', () => {
    const runFilter = (input: string, patternTokenPos: number, atrFromPos: number, atrToPos: number, fromPos: number, toPos: number,
                       origRepl: string, newRepl: string) => {
      const args = new Map<string, string>();
      const filter = new InsertCommaFilter();
      const sentence = lt.getAnalyzedSentence(input);
      const match = new RuleMatch(new FakeRule(), sentence, fromPos, toPos, 'fake msg');
      match.setSuggestedReplacement(origRepl);
      const atr = [
        sentence.getTokensWithoutWhitespace()[atrFromPos]!,
        sentence.getTokensWithoutWhitespace()[atrToPos]!,
      ];
      const matchTmp = filter.acceptRuleMatch(match, args, patternTokenPos, atr, null);
      expect(str(matchTmp!.getSuggestedReplacements())).toBe(newRepl);
    };
    runFilter('Das Auto, das am Straßenrand steht parkt im Halteverbot.', 7,
      7, 8, 29, 40, 'steht parkt', '[steht, parkt]');
    runFilter('Hoffe bei euch ist alles gut.', 1,
      1, 4, 0, 7, 'Hoffe bei euch ist', '[Hoffe, bei euch ist]');
  }, 120_000);
});

describe('GermanNumberInWordFilterTest', () => {
  withSpeller('testFilter', () => {
    const runFilter = (input: string, arg: string, newRepl: string, patternTokenPos: number, fromPos: number, toPos: number) => {
      const filter = new GermanNumberInWordFilter();
      const sentence = lt.getAnalyzedSentence(input);
      const match = new RuleMatch(new FakeRule(), sentence, fromPos, toPos, 'fake msg');
      const args = new Map<string, string>([['word', arg]]);
      const matchTmp = filter.acceptRuleMatch(match, args, patternTokenPos, sentence.getTokensWithoutWhitespace(), null);
      expect(matchTmp).not.toBeNull();
      expect(matchTmp!.getSuggestedReplacements()).toContain(newRepl);
    };
    runFilter('Schöne Grüß0e aus Potsdam.', 'Grüß0e', 'Grüße', 2, 0, 5);
    runFilter('Schöne Grü0e aus Potsdam.', 'Grü0e', 'Grüße', 2, 0, 5);
    runFilter('Der Aut0r schreibt ein Buch.', 'Aut0r', 'Autor', 2, 0, 5);
  }, 120_000);
});

describe('German rule filters', () => {
  it('registers every filter class named in the German rule files', () => {
    const files = ['/org/languagetool/rules/de/grammar.xml', '/org/languagetool/rules/de/style.xml',
      '/org/languagetool/rules/de/de-DE-AT/grammar.xml', '/org/languagetool/resource/de/disambiguation.xml'];
    const named = new Set<string>();
    for (const path of files) {
      const file = fileForResource(path);
      if (file == null) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(/<filter\s[^>]*class="([^"]+)"/g)) named.add(m[1]!);
    }
    expect(named.size).toBeGreaterThan(10);
    const missing = [...named].filter((c) => FilterRegistry.forName(c) == null);
    expect(missing).toEqual([]);
  });
});
