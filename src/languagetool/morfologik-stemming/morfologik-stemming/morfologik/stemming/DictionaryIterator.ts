// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/DictionaryIterator.java faithful
// A Java-style iterator (hasNext/next); DictionaryLookup is also JavaScript-iterable over it.
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { CharBuffer } from '../../../../jdk/java/nio/CharBuffer.ts';
import type { CharsetDecoder } from '../../../../jdk/java/nio/charset/Charset.ts';
import { BufferUtils } from './BufferUtils.ts';
import type { Dictionary } from './Dictionary.ts';
import type { ISequenceEncoder } from './ISequenceEncoder.ts';
import { WordData } from './WordData.ts';

/**
 * An iterator over {@link WordData} entries of a {@link Dictionary}. The stems can be decoded from compressed format or
 * the compressed form can be preserved.
 */
export class DictionaryIterator {
  private readonly decoder: CharsetDecoder;
  private readonly entriesIter: { hasNext(): boolean; next(): ByteBuffer };
  private readonly entry: WordData;
  private readonly separator: number;
  private readonly decodeStems: boolean;

  private inflectedBuffer = ByteBuffer.allocate(0);
  private inflectedCharBuffer = CharBuffer.allocate(0);
  private temp = ByteBuffer.allocate(0);
  private readonly sequenceEncoder: ISequenceEncoder;

  constructor(dictionary: Dictionary, decoder: CharsetDecoder, decodeStems: boolean) {
    this.entriesIter = dictionary.fsa.iterator();
    this.separator = dictionary.metadata.getSeparator();
    this.sequenceEncoder = dictionary.metadata.getSequenceEncoderType().get();
    this.decoder = decoder;
    this.entry = new WordData(decoder);
    this.decodeStems = decodeStems;
  }

  hasNext(): boolean {
    return this.entriesIter.hasNext();
  }

  next(): WordData {
    const entryBuffer = this.entriesIter.next();

    /*
     * Entries are typically: inflected<SEP>codedBase<SEP>tag so try to find this split.
     */
    let ba = entryBuffer.array();
    let bbSize = entryBuffer.remaining();

    let sepPos: number;
    for (sepPos = 0; sepPos < bbSize; sepPos++) {
      if (ba[sepPos] == this.separator) {
        break;
      }
    }

    if (sepPos == bbSize) {
      throw new Error("Invalid dictionary " + "entry format (missing separator).");
    }

    this.inflectedBuffer = BufferUtils.clearAndEnsureCapacity(this.inflectedBuffer, sepPos);
    this.inflectedBuffer.put(ba, 0, sepPos);
    this.inflectedBuffer.flip();

    this.inflectedCharBuffer = BufferUtils.bytesToChars(this.decoder, this.inflectedBuffer, this.inflectedCharBuffer);
    this.entry.update(this.inflectedBuffer, this.inflectedCharBuffer.toString());

    this.temp = BufferUtils.clearAndEnsureCapacity(this.temp, bbSize - sepPos);
    sepPos++;
    this.temp.put(ba, sepPos, bbSize - sepPos);
    this.temp.flip();

    ba = this.temp.array();
    bbSize = this.temp.remaining();

    /*
     * Find the next separator byte's position splitting word form and tag.
     */
    // assert sequenceEncoder.prefixBytes() <= bbSize : sequenceEncoder.getClass() + " >? " + bbSize;
    sepPos = this.sequenceEncoder.prefixBytes();
    for (; sepPos < bbSize; sepPos++) {
      if (ba[sepPos] == this.separator)
        break;
    }

    /*
     * Decode the stem into stem buffer.
     */
    if (this.decodeStems) {
      this.entry.stemBuffer = this.sequenceEncoder.decode(this.entry.stemBuffer,
                                            this.inflectedBuffer,
                                            ByteBuffer.wrap(ba, 0, sepPos));
    } else {
      this.entry.stemBuffer = BufferUtils.clearAndEnsureCapacity(this.entry.stemBuffer, sepPos);
      this.entry.stemBuffer.put(ba, 0, sepPos);
      this.entry.stemBuffer.flip();
    }

    // Skip separator character, if present.
    if (sepPos + 1 <= bbSize) {
      sepPos++;
    }

    /*
     * Decode the tag data.
     */
    this.entry.tagBuffer = BufferUtils.clearAndEnsureCapacity(this.entry.tagBuffer, bbSize - sepPos);
    this.entry.tagBuffer.put(ba, sepPos, bbSize - sepPos);
    this.entry.tagBuffer.flip();

    return this.entry;
  }

  remove(): void {
    throw new Error("UnsupportedOperationException");
  }
}
