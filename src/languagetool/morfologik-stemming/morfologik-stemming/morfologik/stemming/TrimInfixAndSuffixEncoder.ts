// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/TrimInfixAndSuffixEncoder.java faithful
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { BufferUtils } from './BufferUtils.ts';
import type { ISequenceEncoder } from './ISequenceEncoder.ts';

const A = 0x41; // 'A'

/**
 * Encodes <code>dst</code> relative to <code>src</code> by trimming whatever
 * non-equal suffix and infix <code>src</code> and <code>dst</code> have. The
 * output code is (bytes):
 *
 * <pre>
 * {X}{L}{K}{suffix}
 * </pre>
 *
 * where <code>src's</code> infix at position (<code>X</code> - 'A') and of
 * length (<code>L</code> - 'A') should be removed, then (<code>K</code> -
 * 'A') bytes should be trimmed from the end and then the <code>suffix</code>
 * should be appended to the resulting byte sequence.
 *
 * <p>
 * Examples:
 * </p>
 *
 * <pre>
 * src: ayz
 * dst: abc
 * encoded: AACbc
 *
 * src: aillent
 * dst: aller
 * encoded: BBCr
 * </pre>
 */
export class TrimInfixAndSuffixEncoder implements ISequenceEncoder {
  /**
   * Maximum encodable single-byte code.
   */
  private static readonly REMOVE_EVERYTHING = 255;
  private scratch = ByteBuffer.allocate(0);

  encode(reuse: ByteBuffer | null, source: ByteBuffer, target: ByteBuffer): ByteBuffer {
    const REMOVE_EVERYTHING = TrimInfixAndSuffixEncoder.REMOVE_EVERYTHING;
    // assert source.hasArray() &&
    //        source.position() == 0 &&
    //        source.arrayOffset() == 0;

    // assert target.hasArray() &&
    //        target.position() == 0 &&
    //        target.arrayOffset() == 0;

    // Search for the infix that can we can encode and remove from src
    // to get a maximum-length prefix of dst. This could be done more efficiently
    // by running a smarter longest-common-subsequence algorithm and some pruning (?).
    //
    // For now, naive loop should do.

    // There can be only two positions for the infix to delete:
    // 1) we remove leading bytes, even if they are partially matching (but a longer match
    //    exists somewhere later on).
    // 2) we leave max. matching prefix and remove non-matching bytes that follow.
    let maxInfixIndex = 0;
    let maxSubsequenceLength = BufferUtils.sharedPrefixLength(source, target);
    let maxInfixLength = 0;
    for (const i of [0, maxSubsequenceLength]) {
      for (let j = 1; j <= source.remaining() - i; j++) {
        // Compute temporary src with the infix removed.
        // Concatenate in scratch space for simplicity.
        const len2 = source.remaining() - (i + j);
        this.scratch = BufferUtils.clearAndEnsureCapacity(this.scratch, i + len2);
        this.scratch.put(source.array(), 0, i);
        this.scratch.put(source.array(), i + j, len2);
        this.scratch.flip();

        const sharedPrefix = BufferUtils.sharedPrefixLength(this.scratch, target);

        // Only update maxSubsequenceLength if we will be able to encode it.
        if (sharedPrefix > 0 && sharedPrefix > maxSubsequenceLength && i < REMOVE_EVERYTHING && j < REMOVE_EVERYTHING) {
          maxSubsequenceLength = sharedPrefix;
          maxInfixIndex = i;
          maxInfixLength = j;
        }
      }
    }

    let truncateSuffixBytes = source.remaining() - (maxInfixLength + maxSubsequenceLength);

    // Special case: if we're removing the suffix in the infix code, move it
    // to the suffix code instead.
    if (truncateSuffixBytes == 0 &&
        maxInfixIndex + maxInfixLength == source.remaining()) {
      truncateSuffixBytes = maxInfixLength;
      maxInfixIndex = maxInfixLength = 0;
    }

    if (maxInfixIndex >= REMOVE_EVERYTHING ||
        maxInfixLength >= REMOVE_EVERYTHING ||
        truncateSuffixBytes >= REMOVE_EVERYTHING) {
      maxInfixIndex = maxSubsequenceLength = 0;
      maxInfixLength = truncateSuffixBytes = REMOVE_EVERYTHING;
    }

    const len1 = target.remaining() - maxSubsequenceLength;
    reuse = BufferUtils.clearAndEnsureCapacity(reuse, 3 + len1);

    reuse.put((((maxInfixIndex + A) & 0xFF) << 24) >> 24);
    reuse.put((((maxInfixLength + A) & 0xFF) << 24) >> 24);
    reuse.put((((truncateSuffixBytes + A) & 0xFF) << 24) >> 24);
    reuse.put(target.array(), maxSubsequenceLength, len1);
    reuse.flip();

    return reuse;
  }

  prefixBytes(): number {
    return 3;
  }

  decode(reuse: ByteBuffer | null, source: ByteBuffer, encoded: ByteBuffer): ByteBuffer {
    // assert encoded.remaining() >= 3;

    const p = encoded.position();
    let infixIndex = (encoded.get(p) - A) & 0xFF;
    let infixLength = (encoded.get(p + 1) - A) & 0xFF;
    let truncateSuffixBytes = (encoded.get(p + 2) - A) & 0xFF;

    if (infixLength == TrimInfixAndSuffixEncoder.REMOVE_EVERYTHING ||
        truncateSuffixBytes == TrimInfixAndSuffixEncoder.REMOVE_EVERYTHING) {
      infixIndex = 0;
      infixLength = source.remaining();
      truncateSuffixBytes = 0;
    }

    const len1 = source.remaining() - (infixIndex + infixLength + truncateSuffixBytes);
    const len2 = encoded.remaining() - 3;
    reuse = BufferUtils.clearAndEnsureCapacity(reuse, infixIndex + len1 + len2);

    // assert encoded.hasArray() &&
    //        encoded.position() == 0 &&
    //        encoded.arrayOffset() == 0;

    // assert source.hasArray() &&
    //        source.position() == 0 &&
    //        source.arrayOffset() == 0;

    reuse.put(source.array(), 0, infixIndex);
    reuse.put(source.array(), infixIndex + infixLength, len1);
    reuse.put(encoded.array(), 3, len2);
    reuse.flip();

    return reuse;
  }

  toString(): string {
    return 'TrimInfixAndSuffixEncoder';
  }
}
