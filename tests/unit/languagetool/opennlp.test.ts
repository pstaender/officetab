// Apache OpenNLP's tokenizer, POS tagger and chunker with the English models LanguageTool uses.
// Expectations from OpenNLP's documentation and LanguageTool's EnglishChunkerTest.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readZip } from '../../../src/lo/package/source/zipapi/zip.ts';
import { TokenizerModel } from '../../../src/languagetool/opennlp/opennlp-tools/opennlp/tools/tokenize/TokenizerModel.ts';
import { TokenizerME } from '../../../src/languagetool/opennlp/opennlp-tools/opennlp/tools/tokenize/TokenizerME.ts';
import { POSModel } from '../../../src/languagetool/opennlp/opennlp-tools/opennlp/tools/postag/POSModel.ts';
import { POSTaggerME } from '../../../src/languagetool/opennlp/opennlp-tools/opennlp/tools/postag/POSTaggerME.ts';
import { ChunkerModel } from '../../../src/languagetool/opennlp/opennlp-tools/opennlp/tools/chunker/ChunkerModel.ts';
import { ChunkerME } from '../../../src/languagetool/opennlp/opennlp-tools/opennlp/tools/chunker/ChunkerME.ts';
import { DataInputStream } from '../../../src/languagetool/jdk/java/io/DataInputStream.ts';
import { PriorityQueue } from '../../../src/languagetool/jdk/java/util/PriorityQueue.ts';

const dir = 'public/languagetool';
const have = existsSync(`${dir}/en-token.bin`) && existsSync(`${dir}/en-pos-maxent.bin`) && existsSync(`${dir}/en-chunker.bin`);

describe('JDK stand-ins', () => {
  it('reads modified UTF-8', () => {
    // "a", NUL (C0 80), "é" (C3 A9), "€" (E2 82 AC), U+1F600 as two surrogates (ED A0 BD, ED B8 80)
    const bytes = new Uint8Array([0, 14, 0x61, 0xC0, 0x80, 0xC3, 0xA9, 0xE2, 0x82, 0xAC, 0xED, 0xA0, 0xBD, 0xED, 0xB8, 0x80]);
    expect(new DataInputStream(bytes).readUTF()).toBe('a\u0000é€\u{1F600}');
  });

  it('polls equal elements in Java PriorityQueue order', () => {
    const q = new PriorityQueue<[number, string]>((a, b) => a[0] - b[0]);
    for (const e of [[1, 'a'], [0, 'b'], [1, 'c'], [0, 'd'], [1, 'e']] as [number, string][]) q.add(e);
    const out: string[] = [];
    while (q.size()) out.push(q.remove()[1]);
    // java.util.PriorityQueue's siftUp/siftDown give b d a c e for these offers
    expect(out).toEqual(['b', 'd', 'a', 'c', 'e']);
  });
});

describe.skipIf(!have)('OpenNLP English models', () => {
  let tokenModel: TokenizerModel, posModel: POSModel, chunkerModel: ChunkerModel;
  const times: Record<string, number> = {};

  beforeAll(async () => {
    const load = async <T>(name: string, make: (m: Map<string, Uint8Array>) => T): Promise<T> => {
      const t0 = performance.now();
      const m = make(await readZip(new Uint8Array(readFileSync(`${dir}/${name}`))));
      times[name] = performance.now() - t0;
      return m;
    };
    tokenModel = await load('en-token.bin', (m) => new TokenizerModel(m));
    posModel = await load('en-pos-maxent.bin', (m) => new POSModel(m));
    chunkerModel = await load('en-chunker.bin', (m) => new ChunkerModel(m));
    console.log('model load times (ms):', Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v)])));
  }, 60000);

  const tokenize = (s: string) => new TokenizerME(tokenModel).tokenize(s.replace(/’/g, "'"));
  const tag = (toks: string[]) => new POSTaggerME(posModel).tag(toks);
  const chunk = (toks: string[], tags: string[]) => new ChunkerME(chunkerModel).chunk(toks, tags);

  it('reads the 1.5 manifests', () => {
    expect(tokenModel.getLanguage()).toBe('en');
    expect(tokenModel.useAlphaNumericOptimization()).toBe(true);
    expect(posModel.getVersion().toString()).toBe('1.5.0');
    expect(posModel.getFactory().getTagDictionary()?.getTags('brave')).toEqual(['JJ', 'VB']);
  });

  it('tokenizes (OpenNLP manual, EnglishChunkerTest.testTokenize)', () => {
    expect(tokenize('Pierre Vinken, 61 years old, will join the board as a nonexecutive director Nov. 29.').join(' '))
      .toBe('Pierre Vinken , 61 years old , will join the board as a nonexecutive director Nov. 29 .');
    expect(tokenize("I'm going to London")).toEqual(['I', "'m", 'going', 'to', 'London']);
    expect(tokenize('I’m going to London')).toEqual(['I', "'m", 'going', 'to', 'London']);
  });

  it('POS-tags and chunks the OpenNLP manual sentence', () => {
    const toks = 'Pierre Vinken , 61 years old , will join the board as a nonexecutive director Nov. 29 .'.split(' ');
    const tags = tag(toks);
    expect(tags.join(' ')).toBe('NNP NNP , CD NNS JJ , MD VB DT NN IN DT JJ NN NNP CD .');
    expect(chunk(toks, tags).join(' ')).toBe('B-NP I-NP O B-NP I-NP B-ADJP O B-VP I-VP B-NP I-NP B-PP B-NP I-NP I-NP B-NP I-NP O');
  });

  it('chunks as EnglishChunkerTest expects', () => {
    const run = (s: string) => { const t = tokenize(s); const p = tag(t); return { t, p, c: chunk(t, p) }; };
    // testAddChunkTags: "A short test" NP, "of" PP, "the bicycle" NP, "is needed" VP
    expect(run('A short test of the bicycle is needed').c).toEqual(['B-NP', 'I-NP', 'I-NP', 'B-PP', 'B-NP', 'I-NP', 'B-VP', 'I-VP']);
    // testNonBreakingSpace: Away/B-ADVP from/B-PP home/B-NP often/B-ADVP ?/O
    expect(run('Away from home often?').c).toEqual(['B-ADVP', 'B-PP', 'B-NP', 'B-ADVP', 'O']);
    expect(run('Away from home often?').c).toEqual(['B-ADVP', 'B-PP', 'B-NP', 'B-ADVP', 'O']);
    // testContractions: I'll be there -> I/B-NP 'll be (VP)
    expect(run("I'll be there").c.slice(0, 3)).toEqual(['B-NP', 'B-VP', 'I-VP']);
    // testSingularNounAtEndOfNounPhrase / testAddChunkTagsSingular (before LanguageTool's filter)
    expect(run('The aircraft manager is here.').c.slice(0, 3)).toEqual(['B-NP', 'I-NP', 'I-NP']);
    expect(run('The aircraft maintenance manager is here.').c.slice(0, 4)).toEqual(['B-NP', 'I-NP', 'I-NP', 'I-NP']);
    expect(run('Does your box converter operate correctly?').c.slice(1, 4)).toEqual(['B-NP', 'I-NP', 'I-NP']);
    expect(run('I\'d like a fish pie.').c.slice(3, 6)).toEqual(['B-NP', 'I-NP', 'I-NP']);
    const abacus = run('The abacus shows how numbers can be stored');
    expect(abacus.c.slice(0, 2)).toEqual(['B-NP', 'I-NP']);
    expect(abacus.c[abacus.t.indexOf('numbers')]).toBe('B-NP');
  });

  it('tags and chunks a 20-word sentence quickly', () => {
    const toks = tokenize('The quick brown fox jumps over the lazy dog while the farmer, who was tired, watched from the old barn.');
    expect(toks.length).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < 5; i++) chunk(toks, tag(toks)); // warm up
    const n = 50;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) chunk(toks, tag(toks));
    const ms = (performance.now() - t0) / n;
    console.log(`tag+chunk of ${toks.length} tokens: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
