// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/NoEncoder.java faithful
import type { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { BufferUtils } from './BufferUtils.ts';
import type { ISequenceEncoder } from './ISequenceEncoder.ts';

/**
 * No relative encoding at all (full target form is returned).
 */
export class NoEncoder implements ISequenceEncoder {
  encode(reuse: ByteBuffer | null, _source: ByteBuffer, target: ByteBuffer): ByteBuffer {
    reuse = BufferUtils.clearAndEnsureCapacity(reuse, target.remaining());

    target.mark();
    reuse.put(target)
         .flip();
    target.reset();

    return reuse;
  }

  decode(reuse: ByteBuffer | null, _source: ByteBuffer, encoded: ByteBuffer): ByteBuffer {
    reuse = BufferUtils.clearAndEnsureCapacity(reuse, encoded.remaining());

    encoded.mark();
    reuse.put(encoded)
         .flip();
    encoded.reset();

    return reuse;
  }

  prefixBytes(): number {
    return 0;
  }

  toString(): string {
    return 'NoEncoder';
  }
}
