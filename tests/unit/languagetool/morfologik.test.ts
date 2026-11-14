import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ByteBuffer } from '../../../src/languagetool/jdk/java/nio/ByteBuffer.ts';
import { Charset } from '../../../src/languagetool/jdk/java/nio/charset/Charset.ts';
import { FSA } from '../../../src/languagetool/morfologik-stemming/morfologik-fsa/morfologik/fsa/FSA.ts';
import { CFSA2 } from '../../../src/languagetool/morfologik-stemming/morfologik-fsa/morfologik/fsa/CFSA2.ts';
import { FSA5 } from '../../../src/languagetool/morfologik-stemming/morfologik-fsa/morfologik/fsa/FSA5.ts';
import { BufferUtils } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/BufferUtils.ts';
import { Dictionary } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryAttribute } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryAttribute.ts';
import { DictionaryLookup } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryLookup.ts';
import { DictionaryMetadata } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryMetadata.ts';
import { DictionaryMetadataBuilder } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryMetadataBuilder.ts';
import { EncoderType } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/EncoderType.ts';
import type { IStemmer } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/IStemmer.ts';
import type { WordData } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/WordData.ts';
import { HMatrix } from '../../../src/languagetool/morfologik-stemming/morfologik-speller/morfologik/speller/HMatrix.ts';
import { Speller } from '../../../src/languagetool/morfologik-stemming/morfologik-speller/morfologik/speller/Speller.ts';

// Upstream's own test data (morfologik-stemming/src/test, a sparse-checkout addition to the
// git-ignored upstream checkout) and LanguageTool's English dictionaries (tools/languagetool/data.ts).
const UP = 'upstream/languagetool/morfologik-stemming/';
const STEMMING = UP + 'morfologik-stemming/src/test/resources/morfologik/stemming/';
const SPELLER = UP + 'morfologik-speller/src/test/resources/morfologik/speller/';
const EN = 'public/languagetool/org/languagetool/resource/en/';

/** Dictionary.read(URL): the .dict and the .info next to it. */
const read = (dict: string): Dictionary => Dictionary.read(readFileSync(dict), readFileSync(DictionaryMetadata.getExpectedMetadataFileName(dict)));

/** DictionaryLookupTest.stem */
function stem(s: IStemmer, word: string): (string | null)[] {
  const result: (string | null)[] = [];
  for (const wd of s.lookup(word)) {
    result.push(wd.getStem());
    result.push(wd.getTag());
  }
  return result;
}

describe('morfologik-stemming: SequenceEncodersTest', () => {
  const utf8 = Charset.forName('UTF-8');
  const samples: [string, string][] = [
    ['', ''], ['abc', 'ab'], ['abc', 'abx'], ['ab', 'abc'], ['xabc', 'abc'], ['axbc', 'abc'], ['axybc', 'abc'],
    ['azbc', 'abcxy'], ['Niemcami', 'Niemiec'], ['Niemiec', 'Niemcami'],
  ];
  // and some random ones (testEncodeSuffixOnRandomSequences), from a fixed seed
  let seed = 42;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const word = () => Array.from({ length: rnd(40) }, () => 'abcxyzABC'[rnd(9)]).join('');
  for (let i = 0; i < 300; i++) samples.push([word(), word()]);
  for (const t of EncoderType.values()) {
    it(`round-trips with ${t.name()}`, () => {
      const coder = t.get();
      for (const [src, dst] of samples) {
        const source = ByteBuffer.wrap(utf8.encodeString(src));
        const target = ByteBuffer.wrap(utf8.encodeString(dst));
        const encoded = coder.encode(ByteBuffer.allocate(rnd(30)), source, target);
        const decoded = coder.decode(ByteBuffer.allocate(rnd(30)), source, encoded);
        expect(BufferUtils.toString(decoded, utf8)).toBe(dst);
      }
    });
  }
});

describe.skipIf(!existsSync(STEMMING))('morfologik-stemming: upstream DictionaryLookupTest, DictionaryMetadataTest', () => {
  it('testApplyReplacements', () => {
    const conversion = new Map([["'", '`'], ['fi', 'ﬁ'], ['\\a', 'ą'], ['Barack', 'George'], ['_', 'xx']]);
    expect(DictionaryLookup.applyReplacements('filut', conversion)).toBe('ﬁlut');
    expect(DictionaryLookup.applyReplacements('fizdrygałk\\a', conversion)).toBe('ﬁzdrygałką');
    expect(DictionaryLookup.applyReplacements('Barack Bush', conversion)).toBe('George Bush');
    expect(DictionaryLookup.applyReplacements('____', conversion)).toBe('xxxxxxxx');
  });
  it('testRemovedEncoderProperties', () => {
    expect(() => new DictionaryLookup(read(STEMMING + 'test-removed-props.dict'))).toThrow(DictionaryAttribute.ENCODER.propertyName);
  });
  it('testPrefixDictionaries', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-prefix.dict'));
    expect(stem(s, 'Rzeczypospolitej')).toEqual(['Rzeczpospolita', 'subst:irreg']);
    expect(stem(s, 'Rzecząpospolitą')).toEqual(['Rzeczpospolita', 'subst:irreg']);
    // This word is not in the dictionary.
    expect(stem(s, 'martygalski')).toEqual([]);
  });
  it('testInputConversion', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-prefix.dict'));
    expect(stem(s, 'Rzecz\\apospolit\\a')).toEqual(['Rzeczpospolita', 'subst:irreg']);
    expect(stem(s, 'krowa\\apospolit\\a')).toEqual(['Rzeczpospolita', 'subst:irreg']);
  });
  it('testInfixDictionaries', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-infix.dict'));
    expect(stem(s, 'Rzeczypospolitej')).toEqual(['Rzeczpospolita', 'subst:irreg']);
    expect(stem(s, 'Rzeczyccy')).toEqual(['Rzeczycki', 'adj:pl:nom:m']);
    expect(stem(s, 'Rzecząpospolitą')).toEqual(['Rzeczpospolita', 'subst:irreg']);
    expect(stem(s, 'martygalski')).toEqual([]);
    // This word uses characters that are outside of the encoding range of the dictionary.
    expect(stem(s, 'Rzeczyckiõh')).toEqual([]);
  });
  it('testWordDataIterator and testWordDataCloning', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-infix.dict'));
    const entries = new Set<string>();
    const clones: WordData[] = [];
    for (const wd of s) {
      entries.add(wd.getWord() + ' ' + wd.getStem() + ' ' + wd.getTag());
      clones.push(wd.clone());
    }
    for (const e of ['Rzekunia Rzekuń subst:sg:gen:m', 'Rzeczkowskie Rzeczkowski adj:sg:nom.acc.voc:n+adj:pl:acc.nom.voc:f.n',
      'Rzecząpospolitą Rzeczpospolita subst:irreg', 'Rzeczypospolita Rzeczpospolita subst:irreg',
      'Rzeczypospolitych Rzeczpospolita subst:irreg', 'Rzeczyckiej Rzeczycki adj:sg:gen.dat.loc:f']) {
      expect(entries).toContain(e);
    }
    let i = 0;
    for (const wd of new DictionaryLookup(read(STEMMING + 'test-infix.dict'))) {
      const clone = clones[i++]!;
      expect([clone.getStem(), clone.getTag(), clone.getWord()]).toEqual([wd.getStem(), wd.getTag(), wd.getWord()]);
    }
    expect(i).toBe(clones.length);
    expect(() => clones[0]!.hashCode()).toThrow();
  });
  it('testMultibyteEncodingUTF8', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-diacritics-utf8.dict'));
    expect(stem(s, 'mergeam')).toEqual(['merge', '001']);
    expect(stem(s, 'merseserăm')).toEqual(['merge', '002']);
  });
  it('testSynthesis', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-synth.dict'));
    expect(stem(s, 'mieć|verb:praet:sg:ter:f:?perf')).toEqual(['miała', null]);
    expect(stem(s, 'a|conj')).toEqual(['a', null]);
    expect(stem(s, 'dziecko|subst:sg:dat:n')).toEqual([]);
    expect(stem(s, 'martygalski')).toEqual([]);
  });
  it('testInputWithSeparators', () => {
    const s = new DictionaryLookup(read(STEMMING + 'test-separators.dict'));
    const sequences: string[] = [];
    for (const wd of s) sequences.push('' + wd.getWord() + ' ' + wd.getStem() + ' ' + wd.getTag());
    sequences.sort();
    expect(sequences.slice(0, 8)).toEqual(['token1 null null', 'token2 null null', 'token3 null +', 'token4 token2 null',
      'token5 token2 null', 'token6 token2 +', 'token7 token2 token3+', 'token8 token2 token3++']);
  });
  it('testSeparatorInLookupTerm', () => {
    const fsa = FSA.read(readFileSync(STEMMING + 'test-separator-in-lookup.fsa'));
    const metadata = new DictionaryMetadataBuilder().separator('+').encoding('iso8859-1').encoder(EncoderType.INFIX).build();
    const s = new DictionaryLookup(new Dictionary(fsa, metadata));
    expect(s.lookup('l+A').length).toBe(0);
  });
  it('testGetSeparator', () => {
    expect(new DictionaryLookup(read(STEMMING + 'test-separators.dict')).getSeparatorChar()).toBe('+');
  });
  it('testEscapeSeparator, testUnicodeSeparator', () => {
    expect(DictionaryMetadata.read(readFileSync(STEMMING + 'escape-separator.info')).getSeparator()).toBe(9);
    expect(DictionaryMetadata.read(readFileSync(STEMMING + 'unicode-separator.info')).getSeparator()).toBe(9);
  });
  it('reads FSA5 and CFSA2 automata', () => {
    expect(FSA.read(readFileSync(STEMMING + 'test-infix.dict'))).toBeInstanceOf(FSA5);
    expect(FSA.read(readFileSync(SPELLER + 'dict-with-freq.dict'), CFSA2)).toBeInstanceOf(CFSA2);
    expect(() => FSA.read(readFileSync(STEMMING + 'test-infix.dict'), CFSA2)).toThrow('Expected FSA type CFSA2');
  });
});

describe.skipIf(!existsSync(SPELLER))('morfologik-speller: upstream SpellerTest, HMatrixTest', () => {
  const dictionary = existsSync(SPELLER) ? read(SPELLER + 'slownik.dict') : (null as unknown as Dictionary);

  it('stressTestInit', () => {
    for (let i = 0; i < 10; i++) expect(new HMatrix(i, 120).get(1, 1)).toBe(0);
  });
  it('testRunonWords', () => {
    const spell = new Speller(dictionary);
    expect(spell.replaceRunOnWords('abaka')).toEqual([]);
    expect(spell.replaceRunOnWords('abakaabace')).toContain('abaka abace');
    expect(spell.replaceRunOnWords('Abakaabace')).toContain('Abaka abace');
    expect(spell.replaceRunOnWords('AbakaAbace')).toContain('Abaka Abace');
    expect(spell.replaceRunOnWords('abakaAbace')).toContain('abaka Abace');

    // Test on an morphological dictionary - should work as well
    const spell1 = new Speller(read(SPELLER + 'test-infix.dict'));
    expect(spell1.replaceRunOnWords('Rzekunia')).toEqual([]);
    expect(spell1.replaceRunOnWords('RzekuniaRzeczypospolitej')).toContain('Rzekunia Rzeczypospolitej');
    expect(spell1.replaceRunOnWords('RzekuniaRze')).toEqual([]); //Rze is not found but is a prefix

    const spell2 = new Speller(read(SPELLER + 'single-char-word.dict'));
    expect(spell2.replaceRunOnWords('alot')).toContain('a lot');
    expect(spell2.replaceRunOnWords('Alot')).toContain('A lot');
    expect(spell2.replaceRunOnWords('ALot')).toContain('A Lot');
    expect(spell2.replaceRunOnWords('LotAmusement')).toContain('Lot Amusement');
    expect(spell2.replaceRunOnWords('aalot')).toContain('aa lot');
    expect(spell2.replaceRunOnWords('aamusement')).toContain('a amusement');
    expect(spell2.replaceRunOnWords('clot')).toEqual([]);
    expect(spell2.replaceRunOnWords('foobar')).toEqual([]);
  });
  it('testIsInDictionary', () => {
    const spell1 = new Speller(read(SPELLER + 'test-infix.dict'));
    expect(spell1.isInDictionary('Rzekunia')).toBe(true);
    expect(spell1.isInDictionary('Rzekunia+')).toBe(false);
    expect(spell1.isInDictionary('Rzekunia+aaa')).toBe(false);
    const spell = new Speller(read(SPELLER + 'test-utf-spell.dict'));
    for (const w of ['jaźń', 'zażółć', 'żółwiową', 'ćwikła', 'Żebrowski', 'Święto', 'Świerczewski', 'abc']) {
      expect(spell.isInDictionary(w)).toBe(true);
    }
  });
  it('testFindReplacements', () => {
    const spell = new Speller(dictionary, 1);
    expect(spell.findReplacements('abka')).toContain('abak');
    for (const word of spell.findReplacements('bak')) expect(spell.isInDictionary(word)).toBe(true);
    expect(spell.findReplacements('abka~~')).toEqual([]); // 2 characters more -> edit distance too large
    expect(spell.findReplacements('Rezkunia')).not.toContain('Rzekunia');

    const spell1 = new Speller(read(SPELLER + 'test-infix.dict'));
    expect(spell1.findReplacements('Rezkunia')).toContain('Rzekunia');
    //diacritics
    expect(spell1.findReplacements('Rzękunia')).toContain('Rzekunia');
    //we should get no candidates for correct words
    expect(spell1.isInDictionary('Rzekunia')).toBe(true);
    expect(spell1.findReplacements('Rzekunia')).toEqual([]);
    //and no for things that are too different from the dictionary
    expect(spell1.findReplacements('Strefakibica')).toEqual([]);
    //nothing for nothing
    expect(spell1.findReplacements('')).toEqual([]);
    //nothing for weird characters
    expect(spell1.findReplacements('\u0000')).toEqual([]);
    //nothing for other characters
    expect(spell1.findReplacements('«…»')).toEqual([]);
    //nothing for separator
    expect(spell1.findReplacements('+')).toEqual([]);
  });
  it('testFrequencyNonUTFDictionary', () => {
    const spell = new Speller(read(SPELLER + 'test_freq_iso.dict'));
    expect(spell.isInDictionary('a')).toBe(true);
    expect(spell.isInDictionary('aõh')).toBe(false); //non-encodable in UTF-8
  });
  it('testFindReplacementsInUTF', () => {
    const spell = new Speller(read(SPELLER + 'test-utf-spell.dict'));
    const cases: [string, string][] = [
      ['gęslą', 'gęślą'], ['ćwikla', 'ćwikła'], ['Swierczewski', 'Świerczewski'], ['zółwiową', 'żółwiową'],
      ['Żebrowsk', 'Żebrowski'], ['święto', 'Święto'], ['gesla', 'gęślą'], ['swieto', 'Święto'], ['zolwiowa', 'żółwiową'],
      ['jexn', 'jaźń'], ['zażulv', 'zażółć'], ['zarzulv', 'zażółć'], ['Rzebrowski', 'Żebrowski'], ['rzółw', 'żółw'],
      ['Świento', 'Święto'],
    ];
    for (const [word, expected] of cases) expect(spell.findReplacements(word)).toContain(expected);
    // avoid mixed-case words as suggestions when using replacements ('rz' = 'ż')
    expect(spell.findReplacements('zArzółć')[0]).toBe('zażółć');
  });
  it('testFindReplacementsUsingFrequency', () => {
    const spell = new Speller(read(SPELLER + 'dict-with-freq.dict'));
    const reps = spell.findReplacements('jist');
    for (const word of reps) expect(spell.isInDictionary(word)).toBe(true);
    // get replacements ordered by frequency
    expect(reps.slice(0, 7)).toEqual(['just', 'list', 'fist', 'mist', 'jest', 'dist', 'gist']);
  });
  it('testFindSimilarWords', () => {
    const spell = new Speller(read(SPELLER + 'dict-with-freq.dict'));
    expect(spell.findSimilarWords('fist')).toEqual(['list', 'mist', 'dist', 'gist', 'wist', 'hist']);
    expect(spell.findSimilarWords('mist')).toEqual(['list', 'fist', 'dist', 'gist', 'wist', 'hist']);
    expect(spell.findSimilarWords('Fist')).toEqual(['fist', 'list', 'mist', 'dist', 'gist', 'wist', 'hist']);
    expect(spell.findSimilarWords('licit')).toEqual(['list', 'fist', 'mist', 'dist', 'gist', 'wist', 'hist']);
  });
  it('testConcurrentReplacements', () => {
    const spell = new Speller(read(SPELLER + 'dict-with-freq.dict'));
    //only the longest key is selected in replacement pairs
    const reps = spell.getAllReplacements('teached', 0, 0);
    expect(reps).toContain('teached');
    expect(reps).toContain('taught');
    expect(reps).not.toContain('tgheached');
  });
  it('testIsMisspelled', () => {
    const spell = new Speller(read(SPELLER + 'test-utf-spell.dict'));
    expect(spell.isMisspelled('Paragraf22')).toBe(false); //ignorujemy liczby
    expect(spell.isMisspelled('!')).toBe(false); //ignorujemy znaki przestankowe
    expect(spell.isMisspelled('dziekie')).toBe(true); //test, czy znajdujemy błąd
    expect(spell.isMisspelled('SłowozGarbem')).toBe(false); //ignorujemy słowa w stylu wielbłąda
    expect(spell.isMisspelled('Ćwikła')).toBe(false); //i małe litery
    expect(spell.isMisspelled('TOJESTTEST')).toBe(false); //i wielkie litery
    const oldStyleSpell = new Speller(dictionary, 1);
    expect(oldStyleSpell.isMisspelled('Paragraf22')).toBe(true); // nie ignorujemy liczby
    expect(oldStyleSpell.isMisspelled('!')).toBe(true); //nie ignorujemy znaków przestankowych
    expect(oldStyleSpell.isMisspelled('Abaka')).toBe(true); //i małe litery
    const spell1 = new Speller(read(SPELLER + 'test-infix.dict'));
    expect(spell1.isMisspelled('Rzekunia')).toBe(false);
    expect(spell1.isAllUppercase('RZEKUNIA')).toBe(true);
    expect(spell1.isMisspelled('RZEKUNIAA')).toBe(true); // finds a typo here
    expect(spell1.isMisspelled('RZEKUNIA')).toBe(false); // but not here
  });
  it('testCamelCase, testCapitalizedWord', () => {
    const spell = new Speller(dictionary, 1);
    expect(['CamelCase', 'Camel', 'CAMEL', 'camel', 'cAmel', 'CAmel', ''].map((w) => spell.isCamelCase(w)))
      .toEqual([true, false, false, false, false, false, false]);
    expect(['CamelCase', 'Camel', 'CAMEL', 'camel', 'cAmel', 'CAmel', ''].map((w) => spell.isNotCapitalizedWord(w)))
      .toEqual([true, false, true, true, true, true, true]);
  });
  it('testGetAllReplacements', () => {
    const spell = new Speller(read(SPELLER + 'test-utf-spell.dict'));
    expect(spell.isMisspelled('rzarzerzarzu')).toBe(true);
    expect(spell.getAllReplacements('rzarzerzarzu', 0, 0)).toEqual(['rzarzerzarzu']);
  });
  it('testEditDistanceCalculation, testCutOffEditDistance', () => {
    const getEditDistance = (spell: Speller, word: string, candidate: string): number => {
      spell.setWordAndCandidate(word, candidate);
      const maxDistance = spell.getEffectiveED();
      const candidateLen = spell.getCandLen();
      const wordLen = spell.getWordLen();
      let ed = 0;
      for (let i = 0; i < candidateLen; i++) {
        if (spell.cuted(i, i, i) <= maxDistance) {
          if (Math.abs(wordLen - 1 - i) <= maxDistance) ed = spell.ed(wordLen - 1, i, wordLen - 1, i);
        }
      }
      return ed;
    };
    const getCutOffDistance = (spell: Speller, word: string, candidate: string): number => {
      spell.setWordAndCandidate(word, candidate);
      const ced: number[] = [];
      for (let i = 0; i < spell.getCandLen() - spell.getWordLen(); i++) {
        ced.push(spell.cuted(spell.getWordLen() + i, spell.getWordLen() + i, spell.getWordLen() + i));
      }
      ced.sort((a, b) => a - b);
      return ced.length > 0 ? ced[0]! : 0;
    };
    const spell = new Speller(dictionary, 5);
    //test examples from Oflazer's paper
    expect(getEditDistance(spell, 'recoginze', 'recognize')).toBe(1);
    expect(getEditDistance(spell, 'sailn', 'failing')).toBe(3);
    expect(getEditDistance(spell, 'abc', 'abcd')).toBe(1);
    expect(getEditDistance(spell, 'abc', 'abcde')).toBe(2);
    //test words from fsa_spell output
    expect(getEditDistance(spell, 'abka', 'abaka')).toBe(1);
    expect(getEditDistance(spell, 'abka', 'abakan')).toBe(2);
    expect(getEditDistance(spell, 'abka', 'abaką')).toBe(2);
    expect(getEditDistance(spell, 'abka', 'abaki')).toBe(2);
    const spell2 = new Speller(dictionary, 2); //note: threshold = 2
    expect(getCutOffDistance(spell2, 'repo', 'reprter')).toBe(1);
    expect(getCutOffDistance(spell2, 'reporter', 'reporter')).toBe(0);
  });
  it('testReplacementsAndDistance2', () => {
    const speller = new Speller(read(SPELLER + 'reps_dist2.dict'), 3);
    expect(speller.findReplacements('Rytmus').slice(0, 2)).toEqual(['Rhythmus', 'Mitmuss']);
    expect(speller.findReplacements('Walt').slice(0, 2)).toEqual(['Wald', 'Band']);
    expect(speller.findReplacements('yout').slice(0, 3)).toEqual(['youd', 'ijond', 'ijo']);
    expect(speller.findReplacements('yousut').slice(0, 4)).toEqual(['ijoussud', 'ijousod', 'ijoussuud', 'youd']);
    expect(speller.findReplacements('yo').slice(0, 2)).toEqual(['ijo', 'ij']);
    expect(speller.findReplacements('Clarkem').slice(0, 5)).toEqual(['Ciarkę', 'Clarke', 'Clarkiem', 'Clarkom', 'Czarkę']);
  });
  it('testIssue94', () => {
    const speller = new Speller(read(SPELLER + 'issue94.dict'));
    expect(speller.findReplacements('schänken').slice(0, 2)).toEqual(['Schänken', 'schenken']);
  });
});

describe.skipIf(!existsSync(EN + 'english.dict'))("LanguageTool's English dictionaries", () => {
  it('tags words as EnglishTaggerTest expects (english.dict)', () => {
    const tagger = new DictionaryLookup(read(EN + 'english.dict'));
    const readings = (w: string) => tagger.lookup(w).map((wd) => wd.getStem() + '/' + wd.getTag());
    expect(readings('houses')).toEqual(['house/NNS', 'house/VBZ']);
    // EnglishTaggerTest: does/[do]VBZ|does/[doe]NNS, his/[he]PRP$_A3SM|his/[he]PRP$_P3SM|his/[hi]NNS|his/[his]PRP$
    expect(readings('does').sort()).toEqual(['do/VBZ', 'doe/NNS']);
    expect(readings('his').sort()).toEqual(['he/PRP$_A3SM', 'he/PRP$_P3SM', 'hi/NNS', 'his/PRP$']);
    expect(readings('laptop')).toEqual(['laptop/NN']);
    expect(readings('Manager')).toEqual([]); // case is the tagger's business
    expect(readings('xyzzy')).toEqual([]);
  });
  it('synthesizes forms from lemma|tag (english_synth.dict)', () => {
    const synth = new DictionaryLookup(read(EN + 'english_synth.dict'));
    const forms = (w: string) => synth.lookup(w).map((wd) => wd.getStem());
    expect(forms('house|NNS')).toEqual(['houses']);
    expect(forms('go|VBD')).toEqual(['went']);
    expect(forms('good|JJR')).toEqual(['better']);
    expect(forms('be|VBZ').sort()).toEqual(["'s", 'is']);
  });
  it('spells with hunspell/en_US.dict', () => {
    const speller = new Speller(read(EN + 'hunspell/en_US.dict'), 1);
    expect(speller.isMisspelled('houses')).toBe(false);
    expect(speller.isMisspelled('Houses')).toBe(false); // convert-case
    expect(speller.isMisspelled('hosue')).toBe(true);
    expect(speller.findReplacements('hosue')[0]).toBe('house');
    expect(speller.findReplacements('recieve')).toContain('receive');
    expect(speller.getFrequency('houses')).toBeGreaterThan(0); // fsa.dict.frequency-included
  });
});

describe('java.nio charsets for the dictionaries', () => {
  it('decodes and encodes UTF-8 and single-byte charsets, with Java names', () => {
    expect(Charset.forName('Cp1250').name()).toBe('windows-1250');
    expect(Charset.forName('iso8859-1').name()).toBe('ISO-8859-1');
    expect(Charset.forName('iso-8859-2').decodeBytes(new Uint8Array([0xb1]))).toBe('ą');
    expect(Array.from(Charset.forName('utf-8').encodeString('ż😀'))).toEqual([-59, -68, -16, -97, -104, -128]);
    expect(Charset.isSupported('x-unknown')).toBe(false);
  });
});
