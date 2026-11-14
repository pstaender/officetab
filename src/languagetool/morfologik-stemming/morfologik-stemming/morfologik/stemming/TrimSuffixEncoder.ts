// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/TrimSuffixEncoder.java faithful
import type { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { BufferUtils } from './BufferUtils.ts';
import type { ISequenceEncoder } from './ISequenceEncoder.ts';

const A = 0x41; // 'A'

/**
 * Encodes <code>dst</code> relative to <code>src</code> by trimming whatever
 * non-equal suffix <code>src</code> has. The output code is (bytes):
 *
 * <pre>
 * {K}{suffix}
 * </pre>
 *
 * where (<code>K</code> - 'A') bytes should be trimmed from the end of
 * <code>src</code> and then the <code>suffix</code> should be appended to the
 * resulting byte sequence.
 *
 * <p>
 * Examples:
 * </p>
 *
 * <pre>
 * src: foo
 * dst: foobar
 * encoded: Abar
 *
 * src: foo
 * dst: bar
 * encoded: Dbar
 * </pre>
 */
export class TrimSuffixEncoder implements ISequenceEncoder {
  /**
   * Maximum encodable single-byte code.
   */
  private static readonly REMOVE_EVERYTHING = 255;

  encode(reuse: ByteBuffer | null, source: ByteBuffer, target: ByteBuffer): ByteBuffer {
    let sharedPrefix = BufferUtils.sharedPrefixLength(source, target);
    let truncateBytes = source.remaining() - sharedPrefix;
    if (truncateBytes >= TrimSuffixEncoder.REMOVE_EVERYTHING) {
      truncateBytes = TrimSuffixEncoder.REMOVE_EVERYTHING;
      sharedPrefix = 0;
    }

    reuse = BufferUtils.clearAndEnsureCapacity(reuse, 1 + target.remaining() - sharedPrefix);

    // assert target.hasArray() &&
    //        target.position() == 0 &&
    //        target.arrayOffset() == 0;

    const suffixTrimCode = ((truncateBytes + A) << 24) >> 24;
    reuse.put(suffixTrimCode)
         .put(target.array(), sharedPrefix, target.remaining() - sharedPrefix)
         .flip();

    return reuse;
  }

  prefixBytes(): number {
    return 1;
  }

  decode(reuse: ByteBuffer | null, source: ByteBuffer, encoded: ByteBuffer): ByteBuffer {
    // assert encoded.remaining() >= 1;

    const suffixTrimCode = encoded.get(encoded.position());
    let truncateBytes = (suffixTrimCode - A) & 0xFF;
    if (truncateBytes == TrimSuffixEncoder.REMOVE_EVERYTHING) {
      truncateBytes = source.remaining();
    }

    const len1 = source.remaining() - truncateBytes;
    const len2 = encoded.remaining() - 1;

    reuse = BufferUtils.clearAndEnsureCapacity(reuse, len1 + len2);

    // assert source.hasArray() &&
    //        source.position() == 0 &&
    //        source.arrayOffset() == 0;

    // assert encoded.hasArray() &&
    //        encoded.position() == 0 &&
    //        encoded.arrayOffset() == 0;

    reuse.put(source.array(), 0, len1)
         .put(encoded.array(), 1, len2)
         .flip();

    return reuse;
  }

  toString(): string {
    return 'TrimSuffixEncoder';
  }
}
