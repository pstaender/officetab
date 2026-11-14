// jWordSplitter 4.7 (src/languagetool/jwordsplitter/): its own unit tests (GermanWordSplitterTest,
// GermanInterfixDisambiguatorTest, EmbeddedGermanDictionaryTest, GermanFullDictWordSplitterTest,
// GermanRegressionTest) with their expectations. The test dictionaries are read from the upstream
// checkout (or its git objects, when the working tree is not materialised); the embedded dictionary
// and the exception list are class path resources from the jwordsplitter JAR, unpacked into
// public/languagetool/ (see src/languagetool/upstream.json, $data).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import pins from '../../../src/languagetool/upstream.json';
import type { AbstractWordSplitter } from '../../../src/languagetool/jwordsplitter/de/danielnaber/jwordsplitter/AbstractWordSplitter.ts';
import { EmbeddedGermanDictionary } from '../../../src/languagetool/jwordsplitter/de/danielnaber/jwordsplitter/EmbeddedGermanDictionary.ts';
import { GermanInterfixDisambiguator } from '../../../src/languagetool/jwordsplitter/de/danielnaber/jwordsplitter/GermanInterfixDisambiguator.ts';
import { GermanWordSplitter } from '../../../src/languagetool/jwordsplitter/de/danielnaber/jwordsplitter/GermanWordSplitter.ts';
import { InputTooLongException } from '../../../src/languagetool/jwordsplitter/de/danielnaber/jwordsplitter/InputTooLongException.ts';
import { FileTools } from '../../../src/languagetool/jwordsplitter/de/danielnaber/jwordsplitter/tools/FileTools.ts';
import { installNodeBroker } from './broker.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = join(ROOT, 'upstream/languagetool/jwordsplitter');
const DATA = join(ROOT, 'public/languagetool');
const hasData = existsSync(join(DATA, EmbeddedGermanDictionary.DICT)) && existsSync(join(DATA, GermanWordSplitter.EXCEPTION_DICT));

/** A file of the pinned jwordsplitter checkout. */
function readUpstream(path: string): Uint8Array {
  const file = join(REPO, path);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  return new Uint8Array(execFileSync('git', ['-C', REPO, 'show', `${pins.jwordsplitter.commit}:${path}`], { maxBuffer: 1 << 26 }));
}

/** List.toString() */
const str = (l: readonly unknown[]): string => '[' + l.map((x) => (Array.isArray(x) ? str(x) : String(x))).join(', ') + ']';

const TEST_DE = 'src/test/resources/de/danielnaber/jwordsplitter/test-de.txt';
const TEST_DE_LARGE = 'src/test/resources/de/danielnaber/jwordsplitter/test-de-large.txt';

describe.skipIf(!hasData)('jwordsplitter', () => {
  let tmpLexiconFile: Uint8Array;
  let splitter: AbstractWordSplitter;

  beforeAll(() => {
    installNodeBroker([DATA]);
    tmpLexiconFile = readUpstream(TEST_DE);
  });

  const expectSplit = (expected: string, input: string | null) => expect(str(splitter.splitWord(input))).toBe(expected);
  const expectSubwords = (expected: string, input: string) => expect(str(splitter.getSubWords(input))).toBe(expected);
  const testAllSplits = (input: string, expected: string) => expect(str(splitter.getAllSplits(input))).toBe(expected);

  describe('GermanWordSplitterTest', () => {
    it('testGetAllSplits', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      splitter.setStrictMode(false);

      testAllSplits('Klumaflaschenstörung', '[[Klumaflaschen, störung], [Kluma, flaschen, störung]]');
      testAllSplits('Klimaflischenstörung', '[[Klima, flischenstörung], [Klima, flischen, störung], [Klimaflischen, störung]]');
      testAllSplits('Klimaflaschenstirung', '[[Klima, flaschenstirung], [Klima, flasche, nstirung], [Klima, flaschen, stirung]]');

      testAllSplits('Hxusverhaltenflügel', '[[Hxusverhalten, flügel], [Hxus, verhalten, flügel]]');
      testAllSplits('Hausvxrhaltenflügel', '[[Haus, vxrhaltenflügel], [Haus, vxrhalten, flügel], [Hausvxrhalten, flügel]]');
      testAllSplits('Hausverhaltenflüxel', '[[Haus, verhaltenflüxel], [Haus, verhalten, flüxel]]');

      testAllSplits('Hauxverhaltensflügel', '[[Hauxverhaltens, flügel], [Haux, verhaltens, flügel]]');
      testAllSplits('Hausverhalxensflügel', '[[Haus, verhalxensflügel], [Haus, verhalxens, flügel], [Hausverhalxens, flügel]]');
      testAllSplits('Hausverhaltensflügex', '[[Haus, verhaltensflügex], [Haus, verhalten, sflügex], [Haus, verhaltens, flügex]]');

      testAllSplits('Verhaltensflügex', '[[Verhalten, sflügex], [Verhaltens, flügex]]');
      testAllSplits('Verhaltensflügel', '[[Verhalten, sflügel], [Verhaltens, flügel]]');
      testAllSplits('Verhaltens-Flügex', '[[Verhalten, s-Flügex], [Verhaltens, -Flügex]]');
      testAllSplits('Hausverhaltens-Flügex', '[[Haus, verhaltens-Flügex], [Haus, verhalten, s-Flügex], [Haus, verhaltens, -Flügex]]');
    });

    it('testGetAllSplitsMinLength', () => {
      splitter = new GermanWordSplitter(true);
      splitter.setMinimumWordLength(3);
      testAllSplits('Augen', '[]');
      testAllSplits('Genau', '[]');
      splitter.setMinimumWordLength(2);
      testAllSplits('Augen', '[[Au, gen]]');
      testAllSplits('Genau', '[[Gen, au]]');
    });

    function baseChecks(): void {
      expectSplit('[xyz]', 'xyz');
      expectSplit('[Verhalten]', 'Verhalten');
      expectSplit('[Verhalten, störung]', 'Verhaltenstörung');
      expectSplit('[Verhaltens, störung]', 'Verhaltensstörung');
      expectSplit('[Verhaltenxstörung]', 'Verhaltenxstörung');
      expectSplit('[Verhaltens, haus]', 'Verhaltenshaus');
      expectSplit('[Verhaltens, haus, störung]', 'Verhaltenshausstörung');
      expectSplit('[Abend, haus]', 'Abendhaus');
      expectSplit('[Abend, haus, störung]', 'Abendhausstörung');
      // just from special test file:
      expectSplit('[Krawehl, pusselsumm]', 'Krawehlpusselsumm');
    }

    it('testStreamDictConstructor / testFileDictConstructor', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      baseChecks();
    });

    it('testFile', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      baseChecks();
    });

    it('testInterfix', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      // 'Störungs' doesn't exist, so the 's' is an interfix:
      expectSplit('[Störung, flügel]', 'Störungsflügel');
      expectSplit('[Störung, haus]', 'Störungshaus');
    });

    it('testStrictMode', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      expectSplit('[Wirtstierspezies]', 'Wirtstierspezies');
      splitter.setStrictMode(false);
      expectSplit('[Wirts, tiers, pezies]', 'Wirtstierspezies'); // Wirtstier is in exception file
    });

    it('testWithHyphen', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      expectSplit('[Verhalten, Störung]', 'Verhaltens-Störung');
      expectSplit('[Sauerstoff, Flasche]', 'Sauerstoff-Flasche');

      expectSplit('[Sauerstoff-Foobar]', 'Sauerstoff-Foobar');
      splitter.setStrictMode(false);
      expectSplit('[Sauerstoff, Foobar]', 'Sauerstoff-Foobar');
      expectSplit('[Foobar, Sauerstoff]', 'Foobar-Sauerstoff');
      // no term known -> not split at all despite hyphen:
      expectSplit('[Blahbar-Foobar]', 'Blahbar-Foobar');
    });

    it('testWithWhitespace', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      expectSplit('[Verhalten, Störung]', '  Verhaltens-Störung\t ');
    });

    it('testWrongCase', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      // words with wrong case are also split up:
      expectSplit('[VERHALTENS, STÖRUNG]', 'VERHALTENSSTÖRUNG');
      expectSplit('[verhaltens, störung]', 'verhaltensstörung');
    });

    it('testWithConnectionCharacter', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      expectSplit('[xyz]', 'xyz');
      expectSplit('[Verhalten]', 'Verhalten');
      expectSplit('[Verhalten, störung]', 'Verhaltenstörung');
      expectSplit('[Verhaltens, störung]', 'Verhaltensstörung'); // now with "s"
      expectSplit('[Verhaltenxstörung]', 'Verhaltenxstörung');
      expectSplit('[Verhaltenfoobar]', 'Verhaltenfoobar');
    });

    it('testTooShortWords', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      // too short to be split (default min word length: 3)
      expectSplit('[Verhaltenei]', 'Verhaltenei');
      expectSplit('[Eiverhalten]', 'Eiverhalten');
      splitter.setMinimumWordLength(3);
      expectSplit('[Eiverhalten]', 'Eiverhalten');
      splitter.setMinimumWordLength(2);
      expectSplit('[Ei, verhalten]', 'Eiverhalten');
    });

    it('testNonStrictMode', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      splitter.setStrictMode(false);
      expectSplit('[xyz]', 'xyz');
      expectSplit('[Verhalten]', 'Verhalten');
      expectSplit('[Verhalten, störung]', 'Verhaltenstörung');
      expectSplit('[Verhalten, sstörung]', 'Verhaltensstörung'); // not correct, but hey - it's non-strict mode
      // now split because of non-strict mode:
      expectSplit('[Verhalten, xstörung]', 'Verhaltenxstörung');
      expectSplit('[Verhalten, sxyz]', 'Verhaltensxyz');
      expectSplit('[Verhalten, sxyz]', 'Verhaltensxyz');
      expectSplit('[yzstörung]', 'yzstörung');
      splitter.setMinimumWordLength(3);
      expectSplit('[xyz, störung]', 'xyzstörung');
      expectSplit('[Verhalten, xyz]', 'Verhaltenxyz');
      splitter.setMinimumWordLength(3);
      expectSplit('[Eiverhalten]', 'Eiverhalten');
      splitter.setMinimumWordLength(2);
      expectSplit('[Ei, verhalten]', 'Eiverhalten');
    });

    it('testLongerWords', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      expectSplit('[Sauerstoff, flaschen, störungs, verhalten]', 'Sauerstoffflaschenstörungsverhalten');
      expectSplit('[Sauerstoff, sauerstoff]', 'Sauerstoffsauerstoff');
      expectSplit('[Sauerstoff, sauerstoff, sauerstoff]', 'Sauerstoffsauerstoffsauerstoff');
      expectSplit('[Störungs, störung]', 'Störungsstörung');
      expectSplit('[Störungs, störungs, störung]', 'Störungsstörungsstörung');
    });

    it('testLongerWordsHideInterfix', () => {
      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      expectSplit('[Sauerstoff, flaschen, störung, verhalten]', 'Sauerstoffflaschenstörungsverhalten');
      expectSplit('[Sauerstoff, sauerstoff]', 'Sauerstoffsauerstoff');
      expectSplit('[Sauerstoff, sauerstoff, sauerstoff]', 'Sauerstoffsauerstoffsauerstoff');
      expectSplit('[Störung, störung]', 'Störungsstörung');
      expectSplit('[Störung, störung, störung]', 'Störungsstörungsstörung');
    });

    it('testExceptionsWithEmbeddedDict', () => {
      splitter = new GermanWordSplitter(false);
      expectSplit('[Sünder, ecke]', 'Sünderecke');
      expectSplit('[Klima, sünde, recke]', 'Klimasünderecke');
      expectSplit('[Klima, sünder, recke]', 'Klimasünderrecke');
      splitter.setStrictMode(false);
      expectSplit('[Sünder, ecke]', 'Sünderecke');
      expectSplit('[Klima, sünder, ecke]', 'Klimasünderecke');
      expectSplit('[Klima, sünderrecke]', 'Klimasünderrecke');
      // test that some words to *not* get split:
      expectSplit('[Vereinsamen]', 'Vereinsamen');
    });

    it('testEmbeddedDict', () => {
      splitter = new GermanWordSplitter(false);
      expectSplit('[Sauerstoff, flasche]', 'Sauerstoffflasche');
      expectSplit('[Sauerstoff, lasche]', 'Sauerstofflasche'); // not correct (pre-reform spelling)
      expectSplit('[Noten, durchschnitt]', 'Notendurchschnitt');
      expectSplit('[Fahrzeug, staus]', 'Fahrzeugstaus');
      expectSplit('[Noten, bank, vorsitzenden]', 'Notenbankvorsitzenden');
    });

    it('testNoCompounds', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      // Kotflügel, Kot, and Flügel in the dictionary so don't split:
      expectSplit('[Kotflügel]', 'Kotflügel');
    });

    it('testSpecialCases', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      expectSplit('[]', null);
      expectSplit('[]', '');
      expectSplit('[]', '\t');
      expectSplit('[]', '   ');
    });

    it('testExceptionsAddedViaApi', () => {
      splitter = new GermanWordSplitter(false, tmpLexiconFile);
      expectSplit('[Verhaltens, störung]', 'Verhaltensstörung');
      splitter.addException('Verhaltensstörung', ['Verhaltensstörung']);
      expectSplit('[Verhaltensstörung]', 'Verhaltensstörung');
      splitter.addException('Verhaltensstörung', ['Ver', 'halten', 'Störung']); // will override the old mapping
      expectSplit('[Ver, halten, Störung]', 'Verhaltensstörung');

      splitter.addException('Verhaltensstörung', []);
      expectSplit('[]', 'Verhaltensstörung'); // not sure if this makes sense...
      splitter.addException('Verhaltensstörung', null); // resets to original behaviour
      expectSplit('[Verhaltens, störung]', 'Verhaltensstörung');
      // NullPointerException in Java
      expect(() => splitter.addException(null as unknown as string, ['Verhaltensstörung'])).toThrow(TypeError);
    });

    it('testGetSubWords', () => {
      splitter = new GermanWordSplitter(true);
      expectSubwords('[Hammer, schlag, bohrer, schlagbohrer]', 'Hammerschlagbohrer');
      expectSubwords('[Sauer, stoff, Sauerstoff, flasche]', 'Sauerstoffflasche');
      expectSubwords('[Fahrzeug, taus, Fahr, zeug, staus]', 'Fahrzeugstaus');
      splitter.addException('Hammerschlagbohrer', ['Hammer', 'schlag', 'bohrer']);
      expectSubwords('[Hammer, schlag, bohrer]', 'Hammerschlagbohrer');

      splitter = new GermanWordSplitter(true, tmpLexiconFile);
      expectSubwords('[Kot, flügel, Kotflügel]', 'Kotflügel');
      splitter.addException('Kotflügel', ['Kot', 'flügel']);
      expectSubwords('[Kot, flügel]', 'Kotflügel');
      expectSubwords('[Verhalten, störung]', 'Verhaltensstörung');
      expectSubwords('[Bohrkopf]', 'Bohrkopf');
      expectSubwords('[Hand, waschbecken]', 'Handwaschbecken');
      splitter.addException('Waschbecken', ['Wasch', 'becken']);
      expectSubwords('[Hand, waschbecken, wasch, becken]', 'Handwaschbecken');
    });

    it('testLongWords', () => {
      const splitter = new GermanWordSplitter(true);
      splitter.splitWord('Bahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhr'); // 67 chars
      const tooLongByDefault = 'Bahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhrbahnhofsuhr'; // 77 chars
      expect(() => splitter.splitWord(tooLongByDefault)).toThrow(InputTooLongException);
      expect(() => splitter.getSubWords(tooLongByDefault)).toThrow(InputTooLongException);
      expect(() => splitter.getAllSplits(tooLongByDefault)).toThrow(InputTooLongException);
      splitter.setMaximumWordLength(100);
      const result = splitter.splitWord(tooLongByDefault);
      expect(result.length).toBe(14);
    });
  });

  describe('GermanInterfixDisambiguatorTest', () => {
    const assertSplit = (input: string, output: string, disambiguator: GermanInterfixDisambiguator) =>
      expect(str(disambiguator.disambiguate(input.split(' ')))).toBe('[' + output + ']');

    it('testSmallDict', () => {
      const compoundParts = FileTools.loadFileToSet(tmpLexiconFile, 'utf-8');
      const disambiguator = new GermanInterfixDisambiguator(compoundParts);
      assertSplit('Verkehr samt', 'Verkehrs, amt', disambiguator);
      // input when hideInfix is false:
      assertSplit('Sauerstoff flaschen störung s verhalten', 'Sauerstoff, flaschen, störungs, verhalten', disambiguator);
    });

    it('testFullDict', () => {
      const compoundParts = EmbeddedGermanDictionary.getWords();
      const disambiguator = new GermanInterfixDisambiguator(compoundParts);
      assertSplit('Verkehr samt', 'Verkehrs, amt', disambiguator);
      assertSplit('Sauerstoff flaschen störung s verhalten', 'Sauerstoff, flaschen, störungs, verhalten', disambiguator);
    });
  });

  describe('EmbeddedGermanDictionaryTest', () => {
    it('testDict', () => {
      const words = EmbeddedGermanDictionary.getWords();
      expect(words.size, 'Got only ' + words.size + ' words').toBeGreaterThan(50_000);
    });
  });

  describe('GermanFullDictWordSplitterTest', () => {
    it('testSplitBug', () => { // there was a UnsupportedOperationException for this
      const splitter = new GermanWordSplitter(false);
      splitter.setStrictMode(false);
      expect(str(splitter.splitWord('TV-Serien-Seite'))).toBe('[TV, Serien, , Seite]'); // still not 100% clean...
    });

    it('testSplit', () => {
      const splitter = new GermanWordSplitter(true);
      const s = (w: string) => str(splitter.splitWord(w));
      expect(s('Hausrichten')).toBe('[Hausrichten]'); // 'richten' is in removals.txt
      expect(s('Krankenhaus')).toBe('[Kranken, haus]');
      expect(s('Krankenhauses')).toBe('[Kranken, hauses]');
      expect(s('Junggeselle')).toBe('[Junggeselle]');
      expect(s('Junggesellen')).toBe('[Junggesellen]');
      expect(s('Bahnhof')).toBe('[Bahnhof]');
      expect(s('Bahnhofs')).toBe('[Bahnhofs]');
      expect(s('Nicht-Angriffspakt')).toBe('[Nicht, Angriffs, pakt]');
      expect(s('Nicht-Mitgliedern')).toBe('[Nicht, Mitgliedern]');
      expect(s('Zwei-Jahres-Programm')).toBe('[Zwei, Jahre, Programm]');
      expect(s('Bildabtastgerät')).toBe('[Bild, abtast, gerät]');
      // some items from exceptionsGerman.txt:
      expect(s('Schwerpunktsachsen')).toBe('[Schwerpunkts, achsen]');
      expect(s('Bahnsteig')).toBe('[Bahnsteig]');
      expect(s('Gewebekulturzelle')).toBe('[Gewebe, kultur, zelle]');
      expect(s('Bruttorentenniveau')).toBe('[Brutto, renten, niveau]');
      expect(s('Bruttorentenniveaus')).toBe('[Brutto, renten, niveaus]');
    });
  });

  describe('GermanRegressionTest', () => {
    it('testLargeFile', () => {
      const splitter = new GermanWordSplitter(false);
      splitter.setStrictMode(true);
      const lines = new TextDecoder().decode(readUpstream(TEST_DE_LARGE)).split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      const diffs: string[] = [];
      for (const line of lines) {
        const input = line.replaceAll(', ', '');
        const result = splitter.splitWord(input).join(', ');
        if (line !== result) diffs.push(`-${line}\n+${result}`);
      }
      expect(lines.length).toBeGreaterThan(4000);
      expect(diffs.join('\n')).toBe('');
    });
  });
});
