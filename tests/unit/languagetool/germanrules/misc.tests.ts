// SPDX-License-Identifier: MPL-2.0
// German rules checked with LanguageTool's own unit tests: DashRuleTest, WiederVsWiderRuleTest,
// DuUpperLowerCaseRuleTest, CompoundCoherencyRuleTest, SimilarNameRuleTest, WordCoherencyRuleTest,
// OldSpellingRuleTest, GermanWrongWordInContextRuleTest, UnitConversionRuleTest,
// GermanCompoundRuleTest, SwissCompoundRuleTest (AbstractCompoundRuleTest). Imported by
// germanrules.test.ts. TestTools.getEnglishMessages() is German's bundle here (only category
// names differ); the GermanCompoundRule tests need the German speller (isMisspelled) for the
// suggestions and accept every suggestion while GermanSpellerRule is not ported.
import { beforeAll, describe, expect, it } from 'vitest';
import { german, isPorted, lang } from './testGerman.ts';
import { JLanguageTool } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import type { RuleMatch } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { AbstractCompoundRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/AbstractCompoundRule.ts';
import type { AbstractUnitConversionRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/AbstractUnitConversionRule.ts';
import type { ResourceBundle } from '../../../../src/languagetool/jdk/java/util/ResourceBundle.ts';
import { DashRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/DashRule.ts';
import { WiederVsWiderRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/WiederVsWiderRule.ts';
import { DuUpperLowerCaseRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/DuUpperLowerCaseRule.ts';
import { CompoundCoherencyRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/CompoundCoherencyRule.ts';
import { SimilarNameRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/SimilarNameRule.ts';
import { WordCoherencyRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/WordCoherencyRule.ts';
import { OldSpellingRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/OldSpellingRule.ts';
import { GermanWrongWordInContextRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanWrongWordInContextRule.ts';
import { UnitConversionRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/UnitConversionRule.ts';
import { GermanCompoundRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/GermanCompoundRule.ts';
import { SwissCompoundRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/de/org/languagetool/rules/de/SwissCompoundRule.ts';

const str = (o: unknown): string => Array.isArray(o) ? '[' + o.map((x) => String(x)).join(', ') + ']' : String(o);

let lt: JLanguageTool;
let messages: ResourceBundle;
beforeAll(() => {
  ({ lt, messages } = german());
}, 300_000);

/** TestTools.disableAllRulesExcept */
function disableAllRulesExcept(tool: JLanguageTool, ruleId: string): void {
  for (const rule of tool.getAllRules()) {
    if (rule.getId() !== ruleId) tool.disableRule(rule.getId());
  }
}

describe('DashRuleTest', () => {
  it('testRule', () => {
    const rule = new DashRule(messages);
    const assertGood = (text: string) => expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(0);
    const assertBad = (text: string) => expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(1);
    // correct sentences:
    assertGood('Die große Diäten-Erhöhung kam dann doch.');
    assertGood('Die große Diätenerhöhung kam dann doch.');
    assertGood('Die große Diäten-Erhöhungs-Manie kam dann doch.');
    assertGood('Die große Diäten- und Gehaltserhöhung kam dann doch.');
    assertGood('Die große Diäten- sowie Gehaltserhöhung kam dann doch.');
    assertGood('Die große Diäten- oder Gehaltserhöhung kam dann doch.');
    assertGood('Erst so - Karl-Heinz dann blah.');
    assertGood('Erst so -- Karl-Heinz aber...');
    assertGood('Nord- und Südkorea');
    assertGood('NORD- UND SÜDKOREA');
    assertGood('NORD- BZW. SÜDKOREA');
    
    // incorrect sentences:
    assertBad('Die große Diäten- Erhöhung kam dann doch.');
    assertBad('Die große Diäten-  Erhöhung kam dann doch.');
    assertBad('Die große Diäten-Erhöhungs- Manie kam dann doch.');
    assertBad('Die große Diäten- Erhöhungs-Manie kam dann doch.');
    assertBad('MAZEDONIEN- SKOPJE Str.');
  });
});

describe('WiederVsWiderRuleTest', () => {
  it('testRule', () => {
    const rule = new WiederVsWiderRule(messages);
    const assertGood = (text: string) => expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(0);
    const assertBad = (text: string) => expect(rule.match(lt.getAnalyzedSentence(text)).length, text).toBe(1);
    assertGood('Das spiegelt wider, wie es wieder läuft.');
    assertGood('Das spiegelt die Situation gut wider.');
    assertGood('Das spiegelt die Situation.');
    assertGood('Immer wieder spiegelt das die Situation.');
    assertGood('Immer wieder spiegelt das die Situation wider.');
    assertGood('Das spiegelt wieder wider, wie es läuft.');
    assertBad('Das spiegelt wieder, wie es wieder läuft.');
    assertBad('Sie spiegeln das Wachstum der Stadt wieder.');
    assertBad('Das spiegelt die Situation gut wieder.');
    assertBad('Immer wieder spiegelt das die Situation wieder.');
    assertBad('Immer wieder spiegelte das die Situation wieder.');
  });
});

describe('DuUpperLowerCaseRuleTest', () => {
  it('testRule', () => {
    const rule = new DuUpperLowerCaseRule(messages);
    const assertErrors = (input: string, expectedMatches: number) => {
      const sentence = lt.getAnalyzedSentence(input);
      const matches = rule.match([sentence]);
      expect(matches.length, 'Expected ' + expectedMatches + ', got ' + matches.length + ': ' + sentence.getText() + ' -> ' + str(matches)).toBe(expectedMatches);
    };
    assertErrors('Du bist noch jung.', 0);
    assertErrors('Du bist noch jung, du bist noch fit.', 0);
    assertErrors('Aber du bist noch jung, du bist noch fit.', 0);
    assertErrors('Aber du bist noch jung, dir ist das egal.', 0);
    assertErrors('Hast Du ihre Brieftasche gesehen?', 0);
    assertErrors('Aber Du bist noch jung, du bist noch fit.', 1);
    assertErrors('Aber Du bist noch jung, dir ist das egal.', 1);
    assertErrors('Aber Du bist noch jung. Und dir ist das egal.', 1);
    
    assertErrors('Aber du bist noch jung. Und Du bist noch fit.', 1);
    assertErrors('Aber du bist noch jung, Dir ist das egal.', 1);
    assertErrors('Aber du bist noch jung. Und Dir ist das egal.', 1);
    assertErrors('Aber du bist noch jung, sagt euer Vater oft.', 0);
    assertErrors('Aber Du bist noch jung, sagt Euer Vater oft.', 0);
    assertErrors('Aber Du bist noch jung, sagt euer Vater oft.', 1);
    assertErrors('Aber du bist noch jung, sagt Euer Vater oft.', 1);
    assertErrors('Könnt Ihr Euch das vorstellen???', 0);
    assertErrors('Könnt ihr euch das vorstellen???', 0);
    assertErrors('Aber Samstags geht ihr Sohn zum Sport. Stellt Euch das mal vor!', 0);
    //assertErrors("Könnt Ihr euch das vorstellen???", 1);
    assertErrors('Wie geht es euch? Herr Meier, wie war ihr Urlaub?', 0);
    assertErrors('Wie geht es Euch? Herr Meier, wie war Ihr Urlaub?', 0);
    
    assertErrors('"Du sagtest, du würdest es schaffen!"', 0);
    assertErrors('Egal, was du tust: Du musst dein Bestes geben.', 0);
    assertErrors('Was auch immer du tust: ICH UND DU KÖNNEN ES SCHAFFEN.', 0);
    assertErrors('Hast Du die Adresse von ihr?', 0);
  });
});

describe('CompoundCoherencyRuleTest', () => {
  let rule: CompoundCoherencyRule;
  let ltDe: JLanguageTool;
  beforeAll(() => {
    rule = new CompoundCoherencyRule(messages);
    ltDe = new JLanguageTool(lang('de'));
  }, 300_000);
  const getMatches = (s1: string, s2: string): RuleMatch[] => rule.match([ltDe.getAnalyzedSentence(s1), ltDe.getAnalyzedSentence(s2)]);
  const assertOkay = (s1: string, s2: string) => {
    const matches = getMatches(s1, s2);
    expect(matches.length, 'Got ' + str(matches)).toBe(0);
  };
  const assertError = (s1: string, s2: string, fromPos: number, toPos: number, suggestion: string | null) => {
    const matches = getMatches(s1, s2);
    expect(matches.length, 'Got ' + str(matches)).toBe(1);
    expect(matches[0]!.getFromPos()).toBe(fromPos);
    expect(matches[0]!.getToPos()).toBe(toPos);
    if (suggestion == null) {
      expect(matches[0]!.getSuggestedReplacements().length, 'Did not expect suggestion, but got: ' + str(matches[0]!.getSuggestedReplacements())).toBe(0);
    } else {
      expect(matches[0]!.getSuggestedReplacements()).toEqual([suggestion]);
    }
  };
  it('testRule', () => {
    assertOkay('Ein Jugendfoto.', 'Und ein Jugendfoto.');
    assertOkay('Ein Jugendfoto.', 'Der Rahmen eines Jugendfotos.');
    assertOkay('Der Rahmen eines Jugendfotos.', 'Ein Jugendfoto.');
    assertOkay('Der Zahn-Ärzte-Verband.', 'Der Zahn-Ärzte-Verband.');
    assertOkay('Der Zahn-Ärzte-Verband.', 'Des Zahn-Ärzte-Verbands.');
    assertOkay('Der Zahn-Ärzte-Verband.', 'Des Zahn-Ärzte-Verbandes.');
    assertOkay('Es gibt E-Mail.', 'Und es gibt E-Mails.');
    assertOkay('Es gibt E-Mails.', 'Und es gibt E-Mail.');
    assertOkay('Ein Jugend-Foto.', 'Der Rahmen eines Jugend-Fotos.');
    
    assertError('Ein Jugendfoto.', 'Und ein Jugend-Foto.', 23, 34, 'Jugendfoto');
    assertError('Ein Jugend-Foto.', 'Und ein Jugendfoto.', 24, 34, 'Jugend-Foto');
    
    assertError('Viele Zahn-Ärzte.', 'Oder Zahnärzte.', 22, 31, null);
    assertError('Viele Zahn-Ärzte.', 'Oder Zahnärzte.', 22, 31, null);
    assertError('Viele Zahn-Ärzte.', 'Oder Zahnärzten.', 22, 32, null);
    
    assertError('Der Zahn-Ärzte-Verband.', 'Der Zahn-Ärzteverband.', 27, 44, 'Zahn-Ärzte-Verband');
    assertError('Der Zahn-Ärzte-Verband.', 'Der Zahnärzte-Verband.', 27, 44, 'Zahn-Ärzte-Verband');
    assertError('Der Zahn-Ärzte-Verband.', 'Der Zahnärzteverband.', 27, 43, 'Zahn-Ärzte-Verband');
    assertError('Der Zahn-Ärzteverband.', 'Der Zahn-Ärzte-Verband.', 26, 44, 'Zahn-Ärzteverband');
    assertError('Der Zahnärzte-Verband.', 'Der Zahn-Ärzte-Verband.', 26, 44, 'Zahnärzte-Verband');
    assertError('Der Zahnärzteverband.', 'Der Zahn-Ärzte-Verband.', 25, 43, 'Zahnärzteverband');
    assertError('Der Zahn-Ärzte-Verband.', 'Des Zahn-Ärzteverbandes.', 27, 46, null);
    assertError('Der Zahn-Ärzte-Verband.', 'Des Zahnärzte-Verbandes.', 27, 46, null);
    assertError('Der Zahn-Ärzte-Verband.', 'Des Zahnärzteverbandes.', 27, 45, null);
  });
});

describe('SimilarNameRuleTest', () => {
  it('testRule', () => {
    const rule = new SimilarNameRule(messages);
    const assertErrors = (input: string, expectedMatches: number) => {
      const sentence = lt.getAnalyzedSentence(input);
      const matches = rule.match([sentence]);
      expect(matches.length, input).toBe(expectedMatches);
      if (expectedMatches === 1) {
        expect(matches[0]!.getRule().getId()).toBe('DE_SIMILAR_NAMES');
      }
    };
    assertErrors('Hier steht Angela Müller. Im nächsten Satz dann Miller.', 1);
    assertErrors('Hier steht Angela Müller. Im nächsten Satz dann Müllers Ehemann.', 0);
    assertErrors('Hier steht Angela Müller. Dann Mulla, nicht ähnlich genug.', 0);
    assertErrors('Ein Mikrocontroller, bei Mikrocontrollern', 0);
    assertErrors('Hier steht das Rad Deiner Freundin. Und Deinem Hund geht es gut?', 0);
  });
});

describe('WordCoherencyRuleTest', () => {
  let ltWc: JLanguageTool;
  beforeAll(() => {
    ltWc = new JLanguageTool(lang('de-DE'));
    disableAllRulesExcept(ltWc, 'DE_WORD_COHERENCY');
  }, 300_000);
  const assertError = (s: string, expectedSuggestion?: string) => {
    const rule = new WordCoherencyRule(messages);
    const matches = rule.match(ltWc.analyzeText(s));
    expect(matches.length, s).toBe(1);
    if (expectedSuggestion !== undefined) {
      expect(str(matches[0]!.getSuggestedReplacements())).toBe('[' + expectedSuggestion + ']');
    }
  };
  const assertGood = (s: string) => {
    const rule = new WordCoherencyRule(messages);
    expect(rule.match(ltWc.analyzeText(s)).length, s).toBe(0);
  };

  it('testRule', () => {
    // correct sentences:
    assertGood('Das ist aufwendig, aber nicht zu aufwendig.');
    assertGood('Das ist aufwendig. Aber nicht zu aufwendig.');
    assertGood('Das ist aufwändig, aber nicht zu aufwändig.');
    assertGood('Das ist aufwändig. Aber nicht zu aufwändig.');
    // errors:
    assertError('Das ist aufwendig. Aufwändig ist das.', 'Aufwendig');
    assertError('Das ist aufwendig, aber nicht zu aufwändig.');
    assertError('Das ist aufwendig. Aber nicht zu aufwändig.');
    assertError('Das ist aufwendiger, aber nicht zu aufwändig.');
    assertError('Das ist aufwendiger. Aber nicht zu aufwändig.');
    assertError('Das ist aufwändig, aber nicht zu aufwendig.');
    assertError('Das ist aufwändig. Aber nicht zu aufwendig.');
    assertError('Das ist aufwändiger, aber nicht zu aufwendig.');
    assertError('Das ist aufwändiger. Aber nicht zu aufwendig.');
    assertError('Delfin und Delphin');
    assertError('Delfins und Delphine');
    assertError('essentiell und essenziell');
    assertError('essentieller und essenzielles');
    assertError('Differential und Differenzial');
    assertError('Differentials und Differenzials');
    assertError('Facette und Fassette');
    assertError('Facetten und Fassetten');
    assertError('Joghurt und Jogurt');
    assertError('Joghurts und Jogurt');
    assertError('Joghurt und Jogurts');
    assertError('Joghurts und Jogurts');
    assertError('Ketchup und Ketschup');
    assertError('Ketchups und Ketschups');
    assertError('Kommuniqué und Kommunikee');
    assertError('Kommuniqués und Kommunikees');
    assertError('Necessaire und Nessessär');
    assertError('Necessaires und Nessessärs');
    assertError('Orthographie und Orthografie');
    assertError('Orthographien und Orthografien');
    assertError('Potential und Potenzial');
    assertError('Potentials und Potenziale');
    assertError('Portemonnaie und Portmonee');
    assertError('Portemonnaies und Portmonees');
    assertError('potentiell und potenziell');
    assertError('potentielles und potenzieller');
    assertError('Schenke und Schänke');
    // see TODO comment in WordCoherencyRule:
    //assertError("Schenken und Schänken");
    assertError('substantiell und substanziell');
    assertError('substantieller und substanzielles');
    assertError('Thunfisch und Tunfisch');
    assertError('Thunfische und Tunfische');
    assertError('Xylophon und Xylofon');
    assertError('Xylophone und Xylofone');
    assertError('selbständig und selbstständig');
    assertError('selbständiges und selbstständiger');
    assertError('Bahnhofsplatz und Bahnhofplatz');
    // TODO: known to fail because jWordSplitters list is not complete:
    //assertError("Testketchup und Testketschup");
    const matches1 = ltWc.check('Eine aufwendige Untersuchung. Oder ist sie aufwändig?');
    expect(matches1.length).toBe(1);
    expect(matches1[0]!.getFromPos()).toBe(43);
    expect(matches1[0]!.getToPos()).toBe(52);
    expect(str(matches1[0]!.getSuggestedReplacements())).toBe('[aufwendig]');
    const matches2 = ltWc.check('Eine aufwendige Untersuchung. Oder ist sie noch aufwändiger?');
    expect(matches2.length).toBe(1);
    expect(matches2[0]!.getFromPos()).toBe(48);
    expect(matches2[0]!.getToPos()).toBe(59);
    expect(str(matches2[0]!.getSuggestedReplacements())).toBe('[aufwendiger]');
  });

  it('testCallIndependence', () => {
    assertGood('Das ist aufwendig.');
    assertGood('Aber nicht zu aufwändig.');  // this won't be noticed, the calls are independent of each other
  });

  it('testMatchPosition', () => {
    const ruleMatches = ltWc.check('Das ist aufwendig. Aber nicht zu aufwändig');
    expect(ruleMatches.length).toBe(1);
    expect(ruleMatches[0]!.getFromPos()).toBe(33);
    expect(ruleMatches[0]!.getToPos()).toBe(42);
  });

  it('testRuleCompleteTexts', () => {
    expect(ltWc.check('Das ist aufwändig. Aber hallo. Es ist wirklich aufwändig.').length).toBe(0);
    expect(ltWc.check('Das ist aufwendig. Aber hallo. Es ist wirklich aufwändig.').length).toBe(1);
    expect(ltWc.check('Das ist aufwändig. Aber hallo. Es ist wirklich aufwendig.').length).toBe(1);
    
    // also find full forms:
    expect(ltWc.check('Das ist aufwendig. Aber hallo. Es ist wirklich aufwendiger als so.').length).toBe(0);
    expect(ltWc.check('Das ist aufwendig. Aber hallo. Es ist wirklich aufwändiger als so.').length).toBe(1);
    
    expect(ltWc.check('Das ist aufwändig. Aber hallo. Es ist wirklich aufwendiger als so.').length).toBe(1);
    expect(ltWc.check('Das ist das aufwändigste. Aber hallo. Es ist wirklich aufwendiger als so.').length).toBe(1);
    expect(ltWc.check('Das ist das aufwändigste. Aber hallo. Es ist wirklich aufwendig.').length).toBe(1);
    // cross-paragraph checks
    expect(ltWc.check('Das ist das aufwändigste.\n\nAber hallo. Es ist wirklich aufwendig.').length).toBe(1);
  });
});

describe('OldSpellingRuleTest', () => {
  let rule: OldSpellingRule;
  beforeAll(() => {
    rule = new OldSpellingRule(JLanguageTool.getMessageBundle(), lang('de-DE'));
  });
  const assertMatch = (input: string) => expect(rule.match(lt.getAnalyzedSentence(input)).length, input).toBe(1);
  const assertNoMatch = (input: string) => {
    const match = rule.match(lt.getAnalyzedSentence(input));
    if (match.length > 0) {
      expect.fail("Unexpected match for '" + input + "': " + match[0]);
    }
  };
  const sugg = (input: string) => str(rule.match(lt.getAnalyzedSentence(input))[0]!.getSuggestedReplacements());

  it('test', () => {
    const sentence1 = lt.getAnalyzedSentence('Ein Kuß');
    expect(rule.match(sentence1).length).toBe(1);
    expect(str(rule.match(sentence1)[0]!.getSuggestedReplacements())).toBe('[Kuss]');
    const sentence2 = lt.getAnalyzedSentence('Das Corpus delicti');
    expect(rule.match(sentence2).length).toBe(1);
    expect(str(rule.match(sentence2)[0]!.getSuggestedReplacements())).toBe('[Corpus Delicti]');
    // inflected forms should work, too (as long as the inflection database still contains the old variants):
    const sentence3 = lt.getAnalyzedSentence('In Rußlands Weiten');
    expect(rule.match(sentence3).length).toBe(1);
    expect(str(rule.match(sentence3)[0]!.getSuggestedReplacements())).toBe('[Russlands]');
    const sentence4 = lt.getAnalyzedSentence('Hot pants');
    expect(rule.match(sentence4).length).toBe(1);
    expect(str(rule.match(sentence4)[0]!.getSuggestedReplacements())).toBe('[Hotpants]');
    const sentence5 = lt.getAnalyzedSentence('Ich muß los');
    expect(rule.match(sentence5).length).toBe(1);
    expect(str(rule.match(sentence5)[0]!.getSuggestedReplacements())).toBe('[muss]');
    const sentence6 = lt.getAnalyzedSentence('schwarzweißmalen');
    expect(rule.match(sentence6).length).toBe(1);
    expect(str(rule.match(sentence6)[0]!.getSuggestedReplacements())).toBe('[schwarzweiß malen, schwarz-weiß malen]');
    expect(sugg('geschneuzt')).toBe('[geschnäuzt]');
    expect(sugg('naß machen')).toBe('[nassmachen]');
    expect(sugg('Midlife-crisis')).toBe('[Midlife-Crisis, Midlifecrisis]');
    expect(sugg('Schluß')).toBe('[Schluss]');
    expect(rule.match(lt.getAnalyzedSentence('schluß')).length).toBe(0);
    expect(sugg('Schloß')).toBe('[Schloss]');
    expect(sugg('radfahren')).toBe('[Rad fahren]');
    expect(sugg('Photo')).toBe('[Foto]');
    expect(sugg('Geschoß')).toBe('[Geschoss]');
    expect(sugg('Erdgeschoß')).toBe('[Erdgeschoss]');
    expect(sugg('Erdgeschoßes')).toBe('[Erdgeschosses]');
    assertNoMatch('In Russland');
    assertNoMatch('In Russlands Weiten');
    assertNoMatch('Schlüsse');
    assertNoMatch('Schloß Holte');
    assertNoMatch('in Schloß Holte');
    assertNoMatch('Schloß Holte ist');
    assertNoMatch('Asse');
    assertNoMatch('Photons');  // not "Photo" substring match
    assertNoMatch('Photon');
    assertNoMatch('Des Photons');
    assertNoMatch('Photons ');
    assertNoMatch('Hallo Herr Naß');
    assertNoMatch('Hallo Hr. Naß');
    assertNoMatch('Hallo Frau Naß');
    assertNoMatch('Hallo Fr. Naß');
    assertNoMatch('Fr. Naß');
    assertNoMatch('Dr. Naß');
    assertNoMatch('Prof. Naß');
    assertNoMatch('Bell Telephone');
    assertNoMatch('Telephone Company');
    assertMatch('Naß ist das Wasser');
    assertMatch('Läßt du das bitte');
    assertNoMatch('Das mögliche Bestehenbleiben');
    assertNoMatch('Das mögliche Bloßstrampeln verhindern.');
    assertMatch('Bloßstrampeln konnte er sich nicht.');
  });

  it('testGermanAT', () => {
    const germanAT = lang('de-AT');
    const rule = new OldSpellingRule(JLanguageTool.getMessageBundle(), germanAT);
    const lt = new JLanguageTool(germanAT);
    // this is a special case for Austria because of the pronunciation:
    expect(rule.match(lt.getAnalyzedSentence('Geschoß')).length).toBe(0);
    expect(rule.match(lt.getAnalyzedSentence('Erdgeschoß')).length).toBe(0);
    expect(rule.match(lt.getAnalyzedSentence('Erdgeschoßes')).length).toBe(0);
  }, 300_000);
});

describe('GermanWrongWordInContextRuleTest', () => {
  it('testRule', () => {
    const rule = new GermanWrongWordInContextRule(null!, lang('de-DE'));
    const assertGood = (s: string) => expect(rule.match(lt.getAnalyzedSentence(s)).length, s).toBe(0);
    const assertBad = (s: string) => expect(rule.match(lt.getAnalyzedSentence(s)).length, s).toBe(1);
    const first = (s: string) => rule.match(lt.getAnalyzedSentence(s))[0]!.getSuggestedReplacements()[0];
    // Laiche/Leiche
    assertBad('Eine Laiche ist ein toter Körper.');
    assertGood('Eine Leiche ist ein toter Körper.');
    assertGood('Die Leichen der Verstorbenen wurden ins Wasser geworfen.');
    // Mine/Miene
    assertGood('Er verzieht keine Miene.');
    assertGood('Er verzieht keine Miene.');
    assertGood('Die Explosion der Mine.');
    assertGood('Die Mine ist explodiert.');
    assertGood('Er versucht, keine Miene zu verziehen.');
    assertGood('Sie sollen weiter Minen eingesetzt haben.');
    assertGood('Er verzieht sich nach Bekanntgabe der Mineralölsteuerverordnung.');
    assertBad('Er verzieht keine Mine.');
    assertBad('Mit unbewegter Mine.');
    assertBad('Er setzt eine kalte Mine auf.');
    assertBad('Er sagt, die unterirdische Miene sei zusammengestürzt.');
    assertBad('Die Miene ist eingestürzt.');
    assertBad('Die Sprengung mit Mienen ist toll.');
    assertBad('Der Bleistift hat eine Miene.');
    assertBad('Die Mienen sind gestern Abend explodiert.');
    assertBad('Die Miene des Kugelschreibers ist leer.');
    expect(first('Er hat das mit den Mienen weggesprengt.')).toBe('Minen');
    expect(first('Er versucht, keine Mine zu verziehen.')).toBe('Miene');
    // Neutron/Neuron
    assertGood('Nervenzellen nennt man Neuronen');
    assertGood('Das Neutron ist elektisch neutral');
    assertBad('Atomkerne bestehen aus Protonen und Neuronen');
    assertBad('Über eine Synapse wird das Neutron mit einer bestimmten Zelle verknüpft und nimmt mit der lokal zugeordneten postsynaptischen Membranregion eines Dendriten Signale auf.');
    expect(first('Protonen und Neuronen sind Bausteine des Atomkerns')).toBe('Neutronen');
    expect(first('Das Axon des Neutrons ...')).toBe('Neurons');
    
    // Wunde/Winde
    assertGood('Das Seil läuft durch eine Winde.');
    assertGood('Eine blutende Wunde');
    assertBad('Es kamen Keime in die Winde.');
    assertBad('Möglicherweise wehen die Wunde gerade nicht günstig.');
    // betäuben/bestäuben
    assertGood('Er war durch die Narkose betäubt.');
    assertGood('Die Biene bestäubt die Blume.');
    assertBad('Den Kuchen mit Puderzucker betäuben.');
    assertBad('Von Drogen bestäubt spürte er keine Schmerzen.');
    // ver(r)eisen
    assertGood('Er verreist stets mit leichtem Gepäck.');
    assertGood('Die Warze wurde vereist.');
    assertBad('Nach Diktat vereist.');
    assertBad('Die Tragfläche war verreist.');
  });
});

describe('UnitConversionRuleTest', () => {
  /** UnitConversionRuleTestHelper.assertMatches */
  function assertMatches(input: string, expectedMatches: number, converted: string | null, rule: AbstractUnitConversionRule, lt: JLanguageTool): void {
    const matches = rule.match(lt.getAnalyzedSentence(input));
    expect(matches.length, 'Got matches: ' + matches.map(String).join(', ')).toBe(expectedMatches);
    if (expectedMatches > 0 && converted != null) {
      const match = matches[0]!;
      const suggestion = match.getSuggestedReplacements().find((s) => s.includes(converted)) ?? null;
      expect(suggestion != null, 'Suggestion is correct: ' + match.getSuggestedReplacements().join(' | ') + ' / expected: ' + converted).toBe(true);
    }
  }
  it('match', () => {
    const l = lang('de');
    const lt = new JLanguageTool(l);
    const rule = new UnitConversionRule(JLanguageTool.getMessageBundle(l));
    assertMatches('Ich bin 6 Fuß groß.', 1, '1,83 Meter', rule, lt);
    assertMatches('Ich bin 6 Fuß (2,02 m) groß.', 1, '1,83 Meter', rule, lt);
    assertMatches('Ich bin 6 Fuß (1,82 m) groß.', 0, null, rule, lt);
    assertMatches('Der Kostenvoranschlag hatte eine Höhe von 1.800 Pfund Sterling.', 0, null, rule, lt);
    assertMatches('Der Weg ist 100 Meilen lang.', 1, '160,93 Kilometer', rule, lt);
    assertMatches('Der Weg ist 10 km (20 Meilen) lang.', 1, '6,21', rule, lt);
    assertMatches('Der Weg ist 10 km (6,21 Meilen) lang.', 0, null, rule, lt);
    assertMatches('Der Weg ist 100 Meilen (160,93 Kilometer) lang.', 0, null, rule, lt);
    assertMatches('Die Ladung ist 10.000,75 Pfund schwer.', 1, '4,54 Tonnen', rule, lt);
    assertMatches('Sie ist 5\'6" groß.', 1, '1,68 m', rule, lt);
    assertMatches('Meine neue Wohnung ist 500 sq ft groß.', 1, '46,45 Quadratmeter', rule, lt);
    assertMatches("Zwischen 330'000 und 500'000/600", 0, null, rule, lt);
  }, 300_000);
});

describe('GermanCompoundRuleTest', () => {
  let rule: AbstractCompoundRule;
  /** AbstractCompoundRuleTest.check */
  function check(expectedErrors: number, text: string, ...expSuggestions: string[]): void {
    const ruleMatches = rule.match(lt.getAnalyzedSentence(text));
    expect(ruleMatches.length, 'Expected ' + expectedErrors + ' error(s), but got: ' + ruleMatches.join(', ') + ' for ' + text).toBe(expectedErrors);
    if (expSuggestions.length > 0) {
      expect(ruleMatches[0]!.getSuggestedReplacements(), text).toEqual(expSuggestions);
    }
  }
  /** Without the German speller, every suggestion counts as correctly spelled. */
  function withoutSpeller(r: AbstractCompoundRule): AbstractCompoundRule {
    if (!isPorted('GermanSpellerRule')) r.isMisspelled = () => false;
    return r;
  }

  function runTests(): void {
    // correct sentences:
    check(0, 'Eine tolle CD-ROM');
    check(0, 'Eine tolle CD-ROM.');
    check(0, 'Ein toller CD-ROM-Test.');
    check(0, 'Systemadministrator');
    check(0, 'Eine Million Dollar');
    check(0, 'Das System des Administrators');
    check(0, 'Nur im Stand-by-Betrieb');
    check(0, 'Start, Ziel, Sieg');
    check(0, 'Roll-on-roll-off-Schiff');
    check(0, 'Halswirbelsäule');
    check(0, 'Castrop-Rauxel');
    check(0, '2-Zimmer-Wohnung');
    check(0, '3-Zimmer-Wohnung');
    check(0, 'Hals-Wirbel-Säule');   // doubtful whether this is correct...
    check(0, 'Die Bürger konnten an die 900 Meter Kabel in Eigenregie verlegen.');
    check(0, 'Die Bürger konnten ca. 900 Meter Kabel in Eigenregie verlegen.');
    check(0, 'Aus dem Tank zapften die Diebe rund 250 Liter Diesel ab.');
    check(0, 'Aus dem Tank zapften die Diebe 250 Liter Diesel ab.');
    check(0, 'Lohnt sich die Werbung vom ausgegebenen Euro aus gedacht?');
    // incorrect sentences:
    check(1, 'System Administrator', 'Systemadministrator');
    check(1, 'System-Administrator');
    check(1, 'bla bla bla bla bla System Administrator bla bla bla bla bla');
    check(1, 'System Administrator blubb');
    check(1, 'Der System Administrator');
    check(1, 'Der dumme System Administrator');
    check(1, 'CD ROM', 'CD-ROM');
    check(1, 'Nur im Stand by Betrieb', 'Stand-by-Betrieb');
    check(1, 'Ein echter Start Ziel Sieg', 'Start-Ziel-Sieg');
    check(1, 'Ein echter Start Ziel Sieg.');
    check(1, 'Ein Start Ziel Sieg');
    check(1, 'Start Ziel Sieg');
    check(1, 'Start Ziel Sieg!');
    check(1, 'Doppler Effekt');
    check(1, '3 Tage Woche');
    check(1, '4 Tage Woche');
    check(1, '5 Tage Woche');
    check(1, '100 m Lauf');
    check(1, '200 m Lauf');
    check(1, '800 m Lauf');
    check(1, '1000 m Lauf');
    check(1, '2 Zimmer Wohnung');
    check(1, '3 Zimmer-Wohnung');
    check(1, '4-Zimmer Wohnung');
    check(1, '5 Zimmer Wohnung');
    check(1, '6 Zimmer Wohnung');
    check(1, '1000 Jahr Feier');
    check(1, '1000-Jahr Feier');
    check(1, '1000 Jahr-Feier');
    check(2, 'Der dumme System Administrator legt die CD ROM');
    check(2, 'Der dumme System Administrator legt die CD ROM.');
    check(2, 'Der dumme System Administrator legt die CD ROM ein blah');
    check(2, 'System Administrator CD ROM');
    check(1, 'Und herum zu knobeln können.', 'herumzuknobeln');
    check(1, 'Castrop Rauxel', 'Castrop-Rauxel');
    check(1, 'Spin off');
    // no hyphen suggestion for some words:
    check(1, 'Das ist Haar sträubend', 'Haarsträubend');
    // Only hyphen suggestion for some words:
    check(1, 'Spin off', 'Spin-off');
    // also detect an error if only some of the hyphens are missing:
    check(1, 'Geräte Wahl', 'Geräte-Wahl', 'Gerätewahl');
    // first part is a single character:
    check(0, 'x-mal');
    check(1, 'x mal', 'x-mal');
    check(0, 'y-Achse');
    check(1, 'y Achse', 'y-Achse');
    
    // "Blu-ray-Brenner*"
    check(0, 'Blu-ray-Brenner');
    check(1, 'Blu ray Brenner', 'Blu-ray-Brenner');
    // "nach-denken+"
    check(0, 'Ich muss nachdenken');
    check(1, 'Ich muss  nach denken', 'nachdenken');
    // "Back-up$"
    check(0, 'Backup');
    check(0, 'Back-up');
    check(1, 'Back up', 'Back-up', 'Backup');
    // "Aggregat-Zustand?"
    check(0, 'Aggregatzustand');
    check(1, 'Aggregat-Zustand', 'Aggregatzustand');
    check(1, 'Aggregat Zustand', 'Aggregatzustand');
    check(1, 'Billard Kugel', 'Billardkugel');
  }

  it('testRule', () => {
    rule = withoutSpeller(new GermanCompoundRule(messages, lang('de-DE'), null));
    runTests();
    rule = withoutSpeller(new SwissCompoundRule(messages, lang('de-DE'), null));
    runTests();
  });

  it('SwissCompoundRuleTest.testRule', () => {
    rule = withoutSpeller(new SwissCompoundRule(messages, lang('de-DE'), null));
    check(1, 'Ente süß-sauer');
    check(1, 'Ente süß sauer');
  });
});
