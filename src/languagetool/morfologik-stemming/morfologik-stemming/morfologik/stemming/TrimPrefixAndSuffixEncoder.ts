// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/TrimPrefixAndSuffixEncoder.java faithful
import type { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { BufferUtils } from './BufferUtils.ts';
import type { ISequenceEncoder } from './ISequenceEncoder.ts';

const A = 0x41; // 'A'

/**
 * Encodes <code>dst</code> relative to <code>src</code> by trimming whatever
 * non-equal suffix and prefix <code>src</code> and <code>dst</code> have. The
 * output code is (bytes):
 *
 * <pre>
 * {P}{K}{suffix}
 * </pre>
 *
 * where (<code>P</code> - 'A') bytes should be trimmed from the start of
 * <code>src</code>, (<code>K</code> - 'A') bytes should be trimmed from the
 * end of <code>src</code> and then the <code>suffix</code> should be appended
 * to the resulting byte sequence.
 *
 * <p>
 * Examples:
 * </p>
 *
 * <pre>
 * src: abc
 * dst: abcd
 * encoded: AAd
 *
 * src: abc
 * dst: xyz
 * encoded: ADxyz
 * </pre>
 */
export class TrimPrefixAndSuffixEncoder implements ISequenceEncoder {
  /**
   * Maximum encodable single-byte code.
   */
  private static readonly REMOVE_EVERYTHING = 255;

  encode(reuse: ByteBuffer | null, source: ByteBuffer, target: ByteBuffer): ByteBuffer {
    const REMOVE_EVERYTHING = TrimPrefixAndSuffixEncoder.REMOVE_EVERYTHING;
    // Search for the maximum matching subsequence that can be encoded.
    let maxSubsequenceLength = 0;
    let maxSubsequenceIndex = 0;
    for (let i = 0; i < source.remaining(); i++) {
      // prefix at i => shared subsequence (infix)
      const sharedPrefix = BufferUtils.sharedPrefixLength(source, i, target, 0);
      // Only update maxSubsequenceLength if we will be able to encode it.
      if (sharedPrefix > maxSubsequenceLength && i < REMOVE_EVERYTHING
          && (source.remaining() - (i + sharedPrefix)) < REMOVE_EVERYTHING) {
        maxSubsequenceLength = sharedPrefix;
        maxSubsequenceIndex = i;
      }
    }

    // Determine how much to remove (and where) from src to get a prefix of dst.
    let truncatePrefixBytes = maxSubsequenceIndex;
    let truncateSuffixBytes = (source.remaining() - (maxSubsequenceIndex + maxSubsequenceLength));
    if (truncatePrefixBytes >= REMOVE_EVERYTHING || truncateSuffixBytes >= REMOVE_EVERYTHING) {
      maxSubsequenceIndex = maxSubsequenceLength = 0;
      truncatePrefixBytes = truncateSuffixBytes = REMOVE_EVERYTHING;
    }

    const len1 = target.remaining() - maxSubsequenceLength;
    reuse = BufferUtils.clearAndEnsureCapacity(reuse, 2 + len1);

    // assert target.hasArray() &&
    //        target.position() == 0 &&
    //        target.arrayOffset() == 0;

    reuse.put((((truncatePrefixBytes + A) & 0xFF) << 24) >> 24);
    reuse.put((((truncateSuffixBytes + A) & 0xFF) << 24) >> 24);
    reuse.put(target.array(), maxSubsequenceLength, len1);
    reuse.flip();

    return reuse;
  }

  prefixBytes(): number {
    return 2;
  }

  decode(reuse: ByteBuffer | null, source: ByteBuffer, encoded: ByteBuffer): ByteBuffer {
    // assert encoded.remaining() >= 2;

    const p = encoded.position();
    let truncatePrefixBytes = (encoded.get(p)     - A) & 0xFF;
    let truncateSuffixBytes = (encoded.get(p + 1) - A) & 0xFF;

    if (truncatePrefixBytes == TrimPrefixAndSuffixEncoder.REMOVE_EVERYTHING ||
        truncateSuffixBytes == TrimPrefixAndSuffixEncoder.REMOVE_EVERYTHING) {
      truncatePrefixBytes = source.remaining();
      truncateSuffixBytes = 0;
    }

    // assert source.hasArray() &&
    //        source.position() == 0 &&
    //        source.arrayOffset() == 0;

    // assert encoded.hasArray() &&
    //        encoded.position() == 0 &&
    //        encoded.arrayOffset() == 0;

    const len1 = source.remaining() - (truncateSuffixBytes + truncatePrefixBytes);
    const len2 = encoded.remaining() - 2;
    reuse = BufferUtils.clearAndEnsureCapacity(reuse, len1 + len2);

    reuse.put(source.array(), truncatePrefixBytes, len1);
    reuse.put(encoded.array(), 2, len2);
    reuse.flip();

    return reuse;
  }

  toString(): string {
    return 'TrimPrefixAndSuffixEncoder';
  }
}
