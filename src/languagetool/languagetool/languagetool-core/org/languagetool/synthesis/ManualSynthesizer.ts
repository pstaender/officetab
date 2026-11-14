// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/synthesis/ManualSynthesizer.java faithful
// The input stream is the file's bytes or text. fastutil's maps are Maps, keyed by Java's
// String.hashCode as in Java; StringInterner.intern is left out. The separator regex is compiled
// once per change of separator rather than by String.split for every line.
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { TaggedWord } from '../tagging/TaggedWord.ts';
import { StringTools } from '../tools/StringTools.ts';

const SUFFIX_MARKER = '+';

const OFFSET_SHIFT = 8;
const MAX_LENGTH = (1 << OFFSET_SHIFT) - 1;
const MAX_OFFSET = (1 << 32 - OFFSET_SHIFT) - 1;
const ENTRY_SIZE = 3;

const DEFAULT_SEPARATOR = '\t';

/** String.hashCode */
function stringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** Triple<String, String, String> */
type Triple = [left: string, middle: string, right: string];

/**
 * A synthesizer that reads the inflected form and POS information from a plain (UTF-8) text file.
 * This makes it possible for the user to edit the text file to let the system know
 * about new words or missing readings in the synthesizer *.dict file.
 * <p>
 * File Format: <tt>fullform baseform postags</tt> (tab separated)
 *
 * @author Ionuț Păduraru
 * @see org.languagetool.tagging.ManualTagger
 * @see BaseSynthesizer
 */
export class ManualSynthesizer {
  private readonly possibleTags: ReadonlySet<string>;

  private readonly data: (string | null)[];

  /** A map from lemma+POS hashes to encoded lemma+POS+word tuple offsets in {@link #data} */
  private readonly map: Map<number, number>;

  constructor(inputStream: Uint8Array | string) {
    const mapping = ManualSynthesizer.loadMapping(inputStream);
    const byHash = ManualSynthesizer.groupByHash(mapping);

    this.map = new Map();
    let valueCount = 0;
    for (const v of mapping.values()) valueCount += v.length;
    const firstIndex = ENTRY_SIZE; // skip an entry, as 0 means an absent value in TObjectIntHashMap
    this.data = new Array<string | null>(valueCount * ENTRY_SIZE + firstIndex).fill(null);
    if (valueCount > MAX_OFFSET) {
      throw new Error('UnsupportedOperationException: Too many values (' + valueCount + '), the storage needs adjusting');
    }
    let index = firstIndex;
    for (const [hash, value] of byHash) {
      if (value.length > MAX_LENGTH) {
        throw new Error('UnsupportedOperationException: ' +
          'Too many lemmas (' + value.length + ' for the same hash ' + value + ', the storage needs adjusting');
      }
      this.map.set(hash, ((index / ENTRY_SIZE) << OFFSET_SHIFT) | value.length);
      for (const triple of value) {
        this.data[index++] = triple[0];
        this.data[index++] = triple[1];
        this.data[index++] = triple[2];
      }
    }

    this.possibleTags = ManualSynthesizer.collectTags(mapping);
  }

  private static groupByHash(mapping: Map<string, [TaggedWord, string[]]>): Map<number, Triple[]> {
    const byHash = new Map<number, Triple[]>();
    for (const [tw, words] of mapping.values()) {
      const lemma = tw.getLemma()!;
      const hash = ManualSynthesizer.hashCode(lemma, tw.getPosTag()!);
      let list = byHash.get(hash);
      if (list === undefined) {
        byHash.set(hash, list = []);
      }
      for (const word of words) {
        if (word.startsWith(SUFFIX_MARKER)) {
          throw new Error("UnsupportedOperationException: Words can't start with " + SUFFIX_MARKER);
        }
        const value = ManualSynthesizer.encodeForm(lemma, word);
        list.push([lemma, tw.getPosTag()!, value]);
      }
    }
    return byHash;
  }

  private static encodeForm(lemma: string, word: string): string {
    if (word.length > lemma.length && word.startsWith(lemma)) {
      return SUFFIX_MARKER + word.substring(lemma.length);
    }
    if (word.length >= lemma.length && word.startsWith(lemma.substring(0, lemma.length - 1))) {
      return SUFFIX_MARKER + SUFFIX_MARKER + word.substring(lemma.length - 1);
    }
    return word;
  }

  private static decodeForm(lemma: string, word: string): string {
    if (word.startsWith(SUFFIX_MARKER)) {
      if (word.startsWith(SUFFIX_MARKER, SUFFIX_MARKER.length)) {
        return lemma.substring(0, lemma.length - 1) + word.substring(SUFFIX_MARKER.length * 2);
      }
      return lemma + word.substring(SUFFIX_MARKER.length);
    }
    return word;
  }

  private static collectTags(mapping: Map<string, [TaggedWord, string[]]>): Set<string> {
    const tags = new Set<string>();
    for (const [tw] of mapping.values()) {
      tags.add(tw.getPosTag()!);
    }
    return tags;
  }

  private static hashCode(lemma: string, posTag: string): number {
    return (Math.imul(stringHashCode(lemma), 31) + stringHashCode(posTag)) | 0;
  }

  /**
   * Retrieve all the possible POS values.
   */
  getPossibleTags(): ReadonlySet<string> {
    return this.possibleTags;
  }

  /**
   * Look up a word's inflected form as specified by the lemma and POS tag.
   *
   * @param lemma the lemma to inflect.
   * @param posTag the required POS tag.
   * @return a list with all the inflected forms of the specified lemma having the specified POS tag.
   * If no inflected form is found, the function returns <code>null</code>.
   */
  lookup(lemma: string | null, posTag: string | null): string[] | null {
    if (lemma == null || posTag == null) {
      return null;
    }

    const value = this.map.get(ManualSynthesizer.hashCode(lemma, posTag)) ?? 0;
    if (value == 0) return null;

    const offset = (value >>> OFFSET_SHIFT) * ENTRY_SIZE;
    const length = value & MAX_LENGTH;
    const result: string[] = [];
    for (let i = 0; i < length; i++) {
      if (lemma === this.data[offset + i * ENTRY_SIZE] && posTag === this.data[offset + i * ENTRY_SIZE + 1]) {
        const word = this.data[offset + i * ENTRY_SIZE + 2]!;
        result.push(ManualSynthesizer.decodeForm(lemma, word));
      }
    }
    return result;
  }

  /**
   * The mapping from TaggedWord (here keyed by lemma and POS tag, as Java's HashMap uses
   * TaggedWord.equals) to the inflected forms.
   */
  private static loadMapping(inputStream: Uint8Array | string): Map<string, [TaggedWord, string[]]> {
    const mapping = new Map<string, [TaggedWord, string[]]>();
    const text = typeof inputStream === 'string' ? inputStream : new TextDecoder('utf-8').decode(inputStream);
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    let separator = DEFAULT_SEPARATOR;
    let separatorPattern = Pattern.compile(separator);
    for (let line of lines) {
      line = StringTrim(line);
      if (line.startsWith('#separatorRegExp=')) {
        separator = line.replaceAll('#separatorRegExp=', '');
        separatorPattern = Pattern.compile(separator);
      }
      if (StringTools.isEmpty(line) || line.charAt(0) == '#') {
        continue;
      }
      const hashPos = line.indexOf('#');
      line = StringTrim(hashPos === -1 ? line : line.substring(0, hashPos));
      const parts = separatorPattern.split(line);
      if (parts.length != 3) {
        throw new Error('IOException: Unknown line format when loading manual synthesizer dictionary, ' +
          "expected 3 parts separated by '" + separator + "', found " + parts.length + ": '" + line + "'");
      }
      let form = parts[0]!;
      const lemma = parts[1]!;
      if (form === lemma) {
        form = lemma;
      }
      const posTag = parts[2]!;
      const key = lemma + '\u0000' + posTag;
      let entry = mapping.get(key);
      if (entry === undefined) {
        mapping.set(key, entry = [new TaggedWord(lemma, posTag), []]);
      }
      entry[1].push(form);
    }
    return mapping;
  }

}
