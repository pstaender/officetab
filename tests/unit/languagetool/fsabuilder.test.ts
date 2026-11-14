import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FSABuilder } from '../../../src/languagetool/morfologik-stemming/morfologik-fsa-builders/morfologik/fsa/builders/FSABuilder.ts';
import { Dictionary } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryMetadata } from '../../../src/languagetool/morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryMetadata.ts';
import { Speller } from '../../../src/languagetool/morfologik-stemming/morfologik-speller/morfologik/speller/Speller.ts';

const enc = (s: string) => new Int8Array(new TextEncoder().encode(s).buffer);

describe('morfologik-fsa-builders: FSABuilder', () => {
  const words = ['zebra', 'abd', 'b', 'abc', 'bcd'];
  const input = words.map(enc).sort(FSABuilder.LEXICAL_ORDERING);
  const fsa = FSABuilder.build(input);

  it('encodes exactly the input', () => {
    const out: string[] = [];
    for (const bb of fsa) {
      out.push(new TextDecoder().decode(bb.array().subarray(bb.arrayOffset() + bb.position(), bb.arrayOffset() + bb.position() + bb.remaining())));
    }
    expect(out).toEqual([...words].sort());
  });

  it('works as a speller dictionary', () => {
    const md = DictionaryMetadata.read(readFileSync('public/languagetool/org/languagetool/resource/en/hunspell/en_US.info'));
    const speller = new Speller(new Dictionary(fsa, md));
    expect(speller.isMisspelled('zebra')).toBe(false);
    expect(speller.isMisspelled('zebru')).toBe(true);
    expect(speller.findReplacements('zebru')).toContain('zebra');
  });
});
