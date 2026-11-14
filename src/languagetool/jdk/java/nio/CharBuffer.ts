// SPDX-License-Identifier: MPL-2.0
// java.nio.CharBuffer (heap buffers only) for the LanguageTool ports: not a port, the part of the
// JDK's API the ports use. A Java char is a UTF-16 code unit: chars are put and got as
// one-unit strings, the backing char[] is a Uint16Array. toString() gives the chars from
// position to limit, as in Java (a CharBuffer is a CharSequence).
import { BufferOverflowException, BufferUnderflowException, InvalidMarkException } from './ByteBuffer.ts';

export class CharBuffer {
  private hb: Uint16Array;
  private pos = 0;
  private lim: number;
  private mrk = -1;
  private readonly cap: number;

  private constructor(hb: Uint16Array) {
    this.hb = hb;
    this.cap = hb.length;
    this.lim = hb.length;
  }

  static allocate(capacity: number): CharBuffer {
    if (capacity < 0) throw new RangeError('capacity < 0: ' + capacity);
    return new CharBuffer(new Uint16Array(capacity));
  }

  /** wrap(char[]) shares the array; wrap(String) copies its chars (Java's is read-only). */
  static wrap(chars: Uint16Array | string): CharBuffer {
    if (typeof chars === 'string') {
      const a = new Uint16Array(chars.length);
      for (let i = 0; i < chars.length; i++) a[i] = chars.charCodeAt(i);
      return new CharBuffer(a);
    }
    return new CharBuffer(chars);
  }

  array(): Uint16Array { return this.hb; }
  hasArray(): boolean { return true; }
  capacity(): number { return this.cap; }
  length(): number { return this.remaining(); }

  position(): number;
  position(newPosition: number): CharBuffer;
  position(newPosition?: number): number | CharBuffer {
    if (newPosition === undefined) return this.pos;
    if (newPosition > this.lim || newPosition < 0) throw new RangeError('newPosition > limit: (' + newPosition + ' > ' + this.lim + ')');
    if (this.mrk > newPosition) this.mrk = -1;
    this.pos = newPosition;
    return this;
  }

  limit(): number;
  limit(newLimit: number): CharBuffer;
  limit(newLimit?: number): number | CharBuffer {
    if (newLimit === undefined) return this.lim;
    if (newLimit > this.cap || newLimit < 0) throw new RangeError('newLimit > capacity: (' + newLimit + ' > ' + this.cap + ')');
    this.lim = newLimit;
    if (this.pos > newLimit) this.pos = newLimit;
    if (this.mrk > newLimit) this.mrk = -1;
    return this;
  }

  remaining(): number { const rem = this.lim - this.pos; return rem > 0 ? rem : 0; }
  hasRemaining(): boolean { return this.pos < this.lim; }
  mark(): CharBuffer { this.mrk = this.pos; return this; }
  reset(): CharBuffer {
    if (this.mrk < 0) throw new InvalidMarkException();
    this.pos = this.mrk;
    return this;
  }
  clear(): CharBuffer { this.pos = 0; this.lim = this.cap; this.mrk = -1; return this; }
  flip(): CharBuffer { this.lim = this.pos; this.pos = 0; this.mrk = -1; return this; }
  rewind(): CharBuffer { this.pos = 0; this.mrk = -1; return this; }

  /** get(): the char at the position, which is incremented; get(index): the char at the absolute index. */
  get(index?: number): string {
    if (index === undefined) {
      if (this.pos >= this.lim) throw new BufferUnderflowException();
      return String.fromCharCode(this.hb[this.pos++]!);
    }
    if (index < 0 || index >= this.lim) throw new RangeError('Index ' + index + ' out of bounds for length ' + this.lim);
    return String.fromCharCode(this.hb[index]!);
  }

  /** CharSequence.charAt: relative to the position. */
  charAt(index: number): string {
    if (index < 0 || index >= this.remaining()) throw new RangeError('Index ' + index + ' out of bounds for length ' + this.remaining());
    return String.fromCharCode(this.hb[this.pos + index]!);
  }

  /** put(char) or put(String): relative put of each char; returns this. */
  put(s: string): CharBuffer {
    if (s.length > this.remaining()) throw new BufferOverflowException();
    for (let i = 0; i < s.length; i++) this.hb[this.pos++] = s.charCodeAt(i);
    return this;
  }

  /** Puts one char given as its UTF-16 code unit (used by the charset decoders). */
  putCode(code: number): CharBuffer {
    if (this.pos >= this.lim) throw new BufferOverflowException();
    this.hb[this.pos++] = code;
    return this;
  }

  /** The UTF-16 code unit at the position, which is incremented (used by the charset encoders). */
  getCode(): number {
    if (this.pos >= this.lim) throw new BufferUnderflowException();
    return this.hb[this.pos++]!;
  }

  toString(): string {
    let s = '';
    for (let i = this.pos; i < this.lim; i += 8192) {
      s += String.fromCharCode(...this.hb.subarray(i, Math.min(this.lim, i + 8192)));
    }
    return s;
  }
}
