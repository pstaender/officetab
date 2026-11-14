// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/ManualTagger.java faithful
// The constructors are one; the input stream is the file's bytes or text. fastutil's
// Object2IntMap is a Map; StringInterner.intern and String.intern are left out (JavaScript
// strings are not duplicated by reading them). The separator regex is compiled once per change of
// separator rather than by String.split for every line.
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { StringTools } from '../tools/StringTools.ts';
import { TaggedWord } from './TaggedWord.ts';
import type { WordTagger } from './WordTagger.ts';

const DEFAULT_SEPARATOR = '\t';

const OFFSET_SHIFT = 8;
const MAX_LENGTH = (1 << OFFSET_SHIFT) - 1;
const MAX_OFFSET = (1 << 32 - OFFSET_SHIFT) - 1;
const ENTRY_SIZE = 2;

/** StringUtils.substringBefore */
function substringBefore(str: string, separator: string): string {
  const pos = str.indexOf(separator);
  return pos === -1 ? str : str.substring(0, pos);
}

/** BufferedReader.readLine over the whole text (also Scanner.nextLine). */
function readLines(input: Uint8Array | string): string[] {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * A tagger that reads the POS information from a plain (UTF-8) text file. This
 * makes it possible for the user to edit the text file to let the system know
 * about new words or missing readings in the *.dict file.
 *
 * <p>File Format: <tt>fullform baseform postags</tt> (tab separated)
 *
 * @author Marcin Miłkowski
 * @see ManualSynthesizer
 */
export class ManualTagger implements WordTagger {
  private readonly data: (string | null)[];

  /** A map from inflected forms to encoded lemma+POS pair offsets in {@link #data} */
  private readonly map: Map<string, number>;

  constructor(inputStream: Uint8Array | string, internTags = false) {
    const mapping = ManualTagger.loadMapping(inputStream, internTags);
    this.map = new Map();
    let valueCount = 0;
    for (const v of mapping.values()) valueCount += v.length;
    const firstIndex = ENTRY_SIZE; // skip an entry, as 0 means an absent value in TObjectIntHashMap
    this.data = new Array<string | null>(valueCount * ENTRY_SIZE + firstIndex).fill(null);
    if (valueCount > MAX_OFFSET) {
      throw new Error('UnsupportedOperationException: Too many values (' + valueCount + '), the storage needs adjusting');
    }
    let index = firstIndex;
    for (const [key, value] of mapping) {
      if (value.length > MAX_LENGTH) {
        throw new Error('UnsupportedOperationException: ' +
          'Too many lemmas (' + value.length + ' > ' + MAX_LENGTH + ' for ' + key + '), the storage needs adjusting');
      }
      this.map.set(key, ((index / ENTRY_SIZE) << OFFSET_SHIFT) | value.length);
      for (const tw of value) {
        this.data[index++] = tw.getLemma();
        this.data[index++] = tw.getPosTag();
      }
    }
  }

  private static loadMapping(inputStream: Uint8Array | string, _internTags: boolean): Map<string, TaggedWord[]> {
    const map = new Map<string, TaggedWord[]>();
    let lineCount = 0;
    let separator = DEFAULT_SEPARATOR;
    let separatorPattern = Pattern.compile(separator);
    for (let line of readLines(inputStream)) {
      line = StringTrim(line);
      lineCount++;
      if (line.startsWith('#separatorRegExp=')) {
        separator = line.replaceAll('#separatorRegExp=', '');
        separatorPattern = Pattern.compile(separator);
      }
      if (StringTools.isEmpty(line) || line.charAt(0) == '#') {
        continue;
      }
      if (line.includes(' ')) {
        throw new Error('RuntimeException: Non-breaking space found in line #' + lineCount + ": '" + line + "', please remove it");
      }
      line = StringTrim(substringBefore(line, '#'));
      const parts = separatorPattern.split(line);
      if (parts.length != 3) {
        throw new Error('IOException: Unknown line format in line ' + lineCount + ' when loading manual tagger dictionary, ' +
          "expected three tab-separated fields: '" + line + "'");
      }
      const form = parts[0]!;

      let lemma = parts[1]!;
      if (lemma === form) lemma = form;

      const tag = StringTrim(parts[2]!);
      let list = map.get(form);
      if (list === undefined) {
        map.set(form, list = []);
      }
      list.push(new TaggedWord(lemma, tag));
    }
    return map;
  }

  /**
   * Look up a word's baseform (lemma) and POS information.
   */
  tag(word: string): TaggedWord[] {
    const value = this.map.get(word) ?? 0;
    if (value == 0) {
      return [];
    }

    const offset = (value >>> OFFSET_SHIFT) * ENTRY_SIZE;
    const length = value & MAX_LENGTH;
    const result: TaggedWord[] = [];
    for (let i = 0; i < length; i++) {
      result.push(new TaggedWord(this.data[offset + i * ENTRY_SIZE]!, this.data[offset + i * ENTRY_SIZE + 1]!));
    }
    return result;
  }

}
