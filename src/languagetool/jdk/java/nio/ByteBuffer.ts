// SPDX-License-Identifier: MPL-2.0
// java.nio.ByteBuffer (heap buffers only) for the LanguageTool ports: not a port, the part of the
// JDK's API the ports use, so that they read like the Java. A Java byte[] is an Int8Array (signed,
// as Java's bytes are); position, limit, capacity and mark behave as in Java.

export class BufferOverflowException extends Error {}
export class BufferUnderflowException extends Error {}
export class InvalidMarkException extends Error {}

export class ByteBuffer {
  private hb: Int8Array;
  private pos = 0;
  private lim: number;
  private mrk = -1;
  private readonly cap: number;
  /** Start of this buffer in hb (non-zero for slices). */
  private readonly off: number;

  private constructor(hb: Int8Array, off: number, cap: number) {
    this.hb = hb;
    this.off = off;
    this.cap = cap;
    this.lim = cap;
  }

  static allocate(capacity: number): ByteBuffer {
    if (capacity < 0) throw new RangeError('capacity < 0: ' + capacity);
    return new ByteBuffer(new Int8Array(capacity), 0, capacity);
  }

  /** wrap(array) or wrap(array, offset, length): position = offset, limit = offset + length. */
  static wrap(array: Int8Array | Uint8Array, offset = 0, length = array.length - offset): ByteBuffer {
    const hb = array instanceof Int8Array ? array : new Int8Array(array.buffer, array.byteOffset, array.length);
    const b = new ByteBuffer(hb, 0, hb.length);
    if (offset < 0 || length < 0 || offset + length > hb.length) throw new RangeError('Index out of bounds');
    b.pos = offset;
    b.lim = offset + length;
    return b;
  }

  array(): Int8Array { return this.hb; }
  arrayOffset(): number { return this.off; }
  hasArray(): boolean { return true; }
  capacity(): number { return this.cap; }

  /** position() returns the position; position(n) sets it and returns this. */
  position(): number;
  position(newPosition: number): ByteBuffer;
  position(newPosition?: number): number | ByteBuffer {
    if (newPosition === undefined) return this.pos;
    if (newPosition > this.lim || newPosition < 0) throw new RangeError('newPosition > limit: (' + newPosition + ' > ' + this.lim + ')');
    if (this.mrk > newPosition) this.mrk = -1;
    this.pos = newPosition;
    return this;
  }

  /** limit() returns the limit; limit(n) sets it and returns this. */
  limit(): number;
  limit(newLimit: number): ByteBuffer;
  limit(newLimit?: number): number | ByteBuffer {
    if (newLimit === undefined) return this.lim;
    if (newLimit > this.cap || newLimit < 0) throw new RangeError('newLimit > capacity: (' + newLimit + ' > ' + this.cap + ')');
    this.lim = newLimit;
    if (this.pos > newLimit) this.pos = newLimit;
    if (this.mrk > newLimit) this.mrk = -1;
    return this;
  }

  remaining(): number { const rem = this.lim - this.pos; return rem > 0 ? rem : 0; }
  hasRemaining(): boolean { return this.pos < this.lim; }
  mark(): ByteBuffer { this.mrk = this.pos; return this; }
  reset(): ByteBuffer {
    if (this.mrk < 0) throw new InvalidMarkException();
    this.pos = this.mrk;
    return this;
  }
  clear(): ByteBuffer { this.pos = 0; this.lim = this.cap; this.mrk = -1; return this; }
  flip(): ByteBuffer { this.lim = this.pos; this.pos = 0; this.mrk = -1; return this; }
  rewind(): ByteBuffer { this.pos = 0; this.mrk = -1; return this; }

  /** A buffer sharing the content from position to limit. */
  slice(): ByteBuffer {
    const b = new ByteBuffer(this.hb, this.off + this.pos, this.remaining());
    return b;
  }

  /**
   * get(): the byte at the position, which is incremented; get(index): the byte at index;
   * get(dst, offset?, length?): bulk relative get, returns this.
   */
  get(): number;
  get(index: number): number;
  get(dst: Int8Array, offset?: number, length?: number): ByteBuffer;
  get(arg?: number | Int8Array, offset = 0, length?: number): number | ByteBuffer {
    if (arg === undefined) {
      if (this.pos >= this.lim) throw new BufferUnderflowException();
      return this.hb[this.off + this.pos++]!;
    }
    if (typeof arg === 'number') {
      if (arg < 0 || arg >= this.lim) throw new RangeError('Index ' + arg + ' out of bounds for length ' + this.lim);
      return this.hb[this.off + arg]!;
    }
    const len = length ?? arg.length - offset;
    if (len > this.remaining()) throw new BufferUnderflowException();
    arg.set(this.hb.subarray(this.off + this.pos, this.off + this.pos + len), offset);
    this.pos += len;
    return this;
  }

  /**
   * put(byte): relative put of one byte; put(src: ByteBuffer): the remaining bytes of src;
   * put(src: byte[], offset?, length?): bulk relative put. All return this.
   */
  put(b: number): ByteBuffer;
  put(src: ByteBuffer): ByteBuffer;
  put(src: Int8Array | Uint8Array, offset?: number, length?: number): ByteBuffer;
  put(arg: number | ByteBuffer | Int8Array | Uint8Array, offset = 0, length?: number): ByteBuffer {
    if (typeof arg === 'number') {
      if (this.pos >= this.lim) throw new BufferOverflowException();
      this.hb[this.off + this.pos++] = arg;
      return this;
    }
    if (arg instanceof ByteBuffer) {
      const n = arg.remaining();
      if (n > this.remaining()) throw new BufferOverflowException();
      this.hb.set(arg.hb.subarray(arg.off + arg.pos, arg.off + arg.pos + n), this.off + this.pos);
      arg.pos += n;
      this.pos += n;
      return this;
    }
    const len = length ?? arg.length - offset;
    if (offset < 0 || len < 0 || offset + len > arg.length) throw new RangeError('Index out of bounds');
    if (len > this.remaining()) throw new BufferOverflowException();
    const src = arg instanceof Int8Array ? arg : new Int8Array(arg.buffer, arg.byteOffset, arg.length);
    this.hb.set(src.subarray(offset, offset + len), this.off + this.pos);
    this.pos += len;
    return this;
  }

  toString(): string {
    return 'java.nio.HeapByteBuffer[pos=' + this.pos + ' lim=' + this.lim + ' cap=' + this.cap + ']';
  }
}
