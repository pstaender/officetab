// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/BufferUtils.java faithful
// The ByteBuffer/CharBuffer overloads of clearAndEnsureCapacity and toString are one function
// each; asserts are kept as comments.
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { CharBuffer } from '../../../../jdk/java/nio/CharBuffer.ts';
import { CharacterCodingException, type Charset, type CharsetDecoder, type CharsetEncoder } from '../../../../jdk/java/nio/charset/Charset.ts';
import { UnmappableInputException } from './UnmappableInputException.ts';

/** Arrays.toString(byte[]). */
function arraysToString(a: Int8Array): string {
  return '[' + Array.from(a).join(', ') + ']';
}

export class BufferUtils {
  /**
   * No instances.
   */
  private constructor() {
    // empty
  }

  /**
   * Ensure the buffer's capacity is large enough to hold a given number
   * of elements. If the input buffer is not large enough, a new buffer is allocated
   * and returned.
   *
   * @param elements The required number of elements to be appended to the buffer.
   *
   * @param buffer
   *          The buffer to check or <code>null</code> if a new buffer should be
   *          allocated (a null buffer gives a ByteBuffer).
   *
   * @return Returns the same buffer or a new buffer with the given capacity.
   */
  static clearAndEnsureCapacity(buffer: ByteBuffer | null, elements: number): ByteBuffer;
  static clearAndEnsureCapacity(buffer: CharBuffer, elements: number): CharBuffer;
  static clearAndEnsureCapacity(buffer: ByteBuffer | CharBuffer | null, elements: number): ByteBuffer | CharBuffer {
    if (buffer instanceof CharBuffer) {
      if (buffer.capacity() < elements) {
        buffer = CharBuffer.allocate(elements);
      } else {
        buffer.clear();
      }
      return buffer;
    }
    if (buffer == null || buffer.capacity() < elements) {
      buffer = ByteBuffer.allocate(elements);
    } else {
      buffer.clear();
    }
    return buffer;
  }

  /**
   * @param buffer The buffer to convert to a string.
   * @param charset The charset to use when converting bytes to characters (ByteBuffer only).
   * @return A string representation of buffer's content.
   */
  static toString(buffer: ByteBuffer, charset: Charset): string;
  static toString(buffer: CharBuffer): string;
  static toString(buffer: ByteBuffer | CharBuffer, charset?: Charset): string {
    if (buffer instanceof CharBuffer) {
      return buffer.toString();
    }
    buffer = buffer.slice();
    const buf = new Int8Array(buffer.remaining());
    buffer.get(buf);
    return charset!.decodeBytes(buf);
  }

  /**
   * @param buffer The buffer to read from.
   * @return Returns the remaining bytes from the buffer copied to an array.
   */
  static toArray(buffer: ByteBuffer): Int8Array {
    const dst = new Int8Array(buffer.remaining());
    buffer.mark();
    buffer.get(dst);
    buffer.reset();
    return dst;
  }

  /**
   * Compute the length of the shared prefix between two byte sequences.
   */
  static sharedPrefixLength(a: ByteBuffer, aStart: number, b?: ByteBuffer, bStart?: number): number;
  static sharedPrefixLength(a: ByteBuffer, b: ByteBuffer): number;
  static sharedPrefixLength(a: ByteBuffer, aStartOrB: number | ByteBuffer, b?: ByteBuffer, bStart = 0): number {
    if (aStartOrB instanceof ByteBuffer) {
      return BufferUtils.sharedPrefixLength(a, 0, aStartOrB, 0);
    }
    let aStart = aStartOrB;
    let i = 0;
    const max = Math.min(a.remaining() - aStart, b!.remaining() - bStart);
    aStart += a.position();
    bStart += b!.position();
    while (i < max && a.get(aStart++) == b!.get(bStart++)) {
      i++;
    }
    return i;
  }

  /**
   * Convert byte buffer's content into characters. The input buffer's bytes are not
   * consumed (mark is set and reset).
   */
  static bytesToChars(decoder: CharsetDecoder, bytes: ByteBuffer, chars: CharBuffer): CharBuffer {
    // assert decoder.malformedInputAction() == CodingErrorAction.REPORT;

    chars = BufferUtils.clearAndEnsureCapacity(chars, Math.trunc(bytes.remaining() * decoder.maxCharsPerByte()));

    bytes.mark();
    decoder.reset();
    let cr = decoder.decode(bytes, chars, true);
    if (cr.isError()) {
      bytes.reset();
      try {
        cr.throwException();
      } catch (e) {
        if (!(e instanceof CharacterCodingException)) throw e;
        throw new Error("Input cannot be mapped to bytes using encoding "
            + decoder.charset().name() + ": " + arraysToString(BufferUtils.toArray(bytes)), { cause: e });
      }
    }

    // assert cr.isUnderflow();  // This should be guaranteed by ensuring max. capacity.
    cr = decoder.flush(chars);
    // assert cr.isUnderflow();

    chars.flip();
    bytes.reset();

    return chars;
  }

  /**
   * Convert chars into bytes.
   */
  static charsToBytes(encoder: CharsetEncoder, chars: CharBuffer, bytes: ByteBuffer | null): ByteBuffer {
    // assert encoder.malformedInputAction() == CodingErrorAction.REPORT;

    bytes = BufferUtils.clearAndEnsureCapacity(bytes, Math.trunc(chars.remaining() * encoder.maxBytesPerChar()));

    chars.mark();
    encoder.reset();

    let cr = encoder.encode(chars, bytes, true);
    if (cr.isError()) {
      chars.reset();
      try {
        cr.throwException();
      } catch (e) {
        if (!(e instanceof CharacterCodingException)) throw e;
        throw new UnmappableInputException("Input cannot be mapped to characters using encoding "
            + encoder.charset().name() + ": " + arraysToString(BufferUtils.toArray(bytes)), e);
      }
    }

    // assert cr.isUnderflow();  // This should be guaranteed by ensuring max. capacity.
    cr = encoder.flush(bytes);
    // assert cr.isUnderflow();

    bytes.flip();
    chars.reset();

    return bytes;
  }
}
