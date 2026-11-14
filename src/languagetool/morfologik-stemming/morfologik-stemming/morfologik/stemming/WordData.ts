// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/WordData.java faithful
// CharSequence results are strings: getStem() and getTag() decode into the reused CharBuffers
// as upstream does and return their content as a string (or null). The two constructors are
// one: (decoder) or, for tests, (stem, tag, encoding).
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { CharBuffer } from '../../../../jdk/java/nio/CharBuffer.ts';
import { Charset, type CharsetDecoder } from '../../../../jdk/java/nio/charset/Charset.ts';
import { BufferUtils } from './BufferUtils.ts';

/**
 * Stem and tag data associated with a given word.
 *
 * Instances of this class are reused and mutable (values
 * returned from {@link #getStem()}, {@link #getWord()}
 * and other related methods change on subsequent calls to
 * {@link DictionaryLookup} class that returned a given
 * instance of {@link WordData}.
 *
 * If you need a copy of the
 * stem or tag data for a given word, you have to create a custom buffer
 * yourself and copy the associated data, perform {@link #clone()} or create
 * strings (they are immutable) using {@link #getStem()} and then
 * {@link CharSequence#toString()}.
 *
 * For reasons above it makes no sense to use instances
 * of this class in associative containers or lists. In fact,
 * both {@link #equals(Object)} and {@link #hashCode()} are overridden and throw
 * exceptions to prevent accidental damage.
 */
export class WordData {
  /**
   * Error information if somebody puts us in a Java collection.
   */
  private static readonly COLLECTIONS_ERROR_MESSAGE = "Not suitable for use"
          + " in Java collections framework (volatile content). Refer to documentation.";

  /** Character encoding in internal buffers. */
  private readonly decoder: CharsetDecoder;

  /**
   * Inflected word form data.
   */
  private wordCharSequence: string | null = null;

  /**
   * Character sequence after converting {@link #stemBuffer} using
   * {@link #decoder}.
   */
  private stemCharSequence: CharBuffer;

  /**
   * Character sequence after converting {@link #tagBuffer} using
   * {@link #decoder}.
   */
  private tagCharSequence: CharBuffer;

  /** Byte buffer holding the inflected word form data. */
  wordBuffer: ByteBuffer | null = null;

  /** Byte buffer holding stem data. */
  stemBuffer: ByteBuffer;

  /** Byte buffer holding tag data. */
  tagBuffer: ByteBuffer;

  /**
   * Package scope constructor; with (stem, tag, encoding): a constructor for tests only.
   */
  constructor(decoder: CharsetDecoder);
  constructor(stem: string | null, tag: string | null, encoding: string);
  constructor(decoderOrStem: CharsetDecoder | string | null, tag?: string | null, encoding?: string) {
    if (encoding !== undefined) {
      const charset = Charset.forName(encoding);
      this.decoder = charset.newDecoder();
    } else {
      this.decoder = decoderOrStem as CharsetDecoder;
    }

    this.stemBuffer = ByteBuffer.allocate(0);
    this.tagBuffer = ByteBuffer.allocate(0);
    this.stemCharSequence = CharBuffer.allocate(0);
    this.tagCharSequence = CharBuffer.allocate(0);

    if (encoding !== undefined) {
      const charset = Charset.forName(encoding);
      const stem = decoderOrStem as string | null;
      // ByteBuffer.allocate(0).put(...) would overflow in Java too, unless the strings are empty.
      if (stem != null)
        this.stemBuffer.put(charset.encodeString(stem));
      if (tag != null)
        this.tagBuffer.put(charset.encodeString(tag));
    }
  }

  /**
   * Copy the stem's binary data (no charset decoding) to a custom byte
   * buffer.
   *
   * The buffer is cleared prior to copying and flipped for reading
   * upon returning from this method. If the buffer is null or not large
   * enough to hold the result, a new buffer is allocated.
   *
   * @param target
   *            Target byte buffer to copy the stem buffer to or
   *            <code>null</code> if a new buffer should be allocated.
   *
   * @return Returns <code>target</code> or the new reallocated buffer.
   */
  getStemBytes(target: ByteBuffer | null): ByteBuffer {
    target = BufferUtils.clearAndEnsureCapacity(target, this.stemBuffer.remaining());
    this.stemBuffer.mark();
    target.put(this.stemBuffer);
    this.stemBuffer.reset();
    target.flip();
    return target;
  }

  /**
   * Copy the tag's binary data (no charset decoding) to a custom byte buffer.
   *
   * The buffer is cleared prior to copying and flipped for reading
   * upon returning from this method. If the buffer is null or not large
   * enough to hold the result, a new buffer is allocated.
   *
   * @param target
   *            Target byte buffer to copy the tag buffer to or
   *            <code>null</code> if a new buffer should be allocated.
   *
   * @return Returns <code>target</code> or the new reallocated buffer.
   */
  getTagBytes(target: ByteBuffer | null): ByteBuffer {
    target = BufferUtils.clearAndEnsureCapacity(target, this.tagBuffer.remaining());
    this.tagBuffer.mark();
    target.put(this.tagBuffer);
    this.tagBuffer.reset();
    target.flip();
    return target;
  }

  /**
   * Copy the inflected word's binary data (no charset decoding) to a custom
   * byte buffer.
   *
   * The buffer is cleared prior to copying and flipped for reading
   * upon returning from this method. If the buffer is null or not large
   * enough to hold the result, a new buffer is allocated.
   *
   * @param target
   *            Target byte buffer to copy the word buffer to or
   *            <code>null</code> if a new buffer should be allocated.
   *
   * @return Returns <code>target</code> or the new reallocated buffer.
   */
  getWordBytes(target: ByteBuffer | null): ByteBuffer {
    target = BufferUtils.clearAndEnsureCapacity(target, this.wordBuffer!.remaining());
    this.wordBuffer!.mark();
    target.put(this.wordBuffer!);
    this.wordBuffer!.reset();
    target.flip();
    return target;
  }

  /**
   * @return Return tag data decoded to a character sequence or
   *         <code>null</code> if no associated tag data exists.
   */
  getTag(): string | null {
    this.tagCharSequence = BufferUtils.bytesToChars(this.decoder, this.tagBuffer, this.tagCharSequence);
    return this.tagCharSequence.remaining() == 0 ? null : this.tagCharSequence.toString();
  }

  /**
   * @return Return stem data decoded to a character sequence or
   *         <code>null</code> if no associated stem data exists.
   */
  getStem(): string | null {
    this.stemCharSequence = BufferUtils.bytesToChars(this.decoder, this.stemBuffer, this.stemCharSequence);
    return this.stemCharSequence.remaining() == 0 ? null : this.stemCharSequence.toString();
  }

  /**
   * @return Return inflected word form data. Usually the parameter passed to
   *         {@link DictionaryLookup#lookup(CharSequence)}.
   */
  getWord(): string | null {
    return this.wordCharSequence;
  }

  /*
   *
   */
  equals(_obj: unknown): boolean {
    throw new Error("UnsupportedOperationException: " + WordData.COLLECTIONS_ERROR_MESSAGE);
  }

  /*
   *
   */
  hashCode(): number {
    throw new Error("UnsupportedOperationException: " + WordData.COLLECTIONS_ERROR_MESSAGE);
  }

  toString(): string {
      return "WordData["
          + this.getWord() + ","
          + this.getStem() + ","
          + this.getTag() + "]";
  }

  /**
   * Declare a covariant of {@link Object#clone()} that returns a deep copy of
   * this object. The content of all internal buffers is copied.
   */
  clone(): WordData {
    const clone = new WordData(this.decoder);
    clone.wordCharSequence = this.cloneCharSequence(this.wordCharSequence);
    clone.wordBuffer = this.getWordBytes(null);
    clone.stemBuffer = this.getStemBytes(null);
    clone.tagBuffer = this.getTagBytes(null);
    return clone;
  }

  /**
   * Clone char sequences only if not immutable.
   */
  private cloneCharSequence(chs: string | null): string | null {
    return chs;
  }

  update(wordBuffer: ByteBuffer, word: string): void {
    this.stemCharSequence.clear();
    this.tagCharSequence.clear();
    this.stemBuffer.clear();
    this.tagBuffer.clear();

    this.wordBuffer = wordBuffer;
    this.wordCharSequence = word;
  }
}
