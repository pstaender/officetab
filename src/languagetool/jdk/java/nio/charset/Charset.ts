// SPDX-License-Identifier: MPL-2.0
// java.nio.charset (Charset, CharsetDecoder, CharsetEncoder, CoderResult, CodingErrorAction and
// the coding exceptions) for the LanguageTool ports: not a port, the part of the JDK's API the
// ports use. Supported charsets: UTF-8, ISO-8859-1, US-ASCII and the single-byte charsets that
// TextDecoder knows (ISO-8859-2, windows-1250, KOI8-R, ...; their tables are read from
// TextDecoder, the encoders invert them). Decoders and encoders are stateless; as in Java,
// decode/encode with endOfInput report an incomplete sequence at the end as malformed.
import { ByteBuffer } from '../ByteBuffer.ts';
import { CharBuffer } from '../CharBuffer.ts';

export class CharacterCodingException extends Error {}
export class MalformedInputException extends CharacterCodingException {
  readonly inputLength: number;
  constructor(inputLength: number) { super('Input length = ' + inputLength); this.inputLength = inputLength; }
}
export class UnmappableCharacterException extends CharacterCodingException {
  readonly inputLength: number;
  constructor(inputLength: number) { super('Input length = ' + inputLength); this.inputLength = inputLength; }
}
export class UnsupportedCharsetException extends Error {}
export class IllegalCharsetNameException extends Error {}

export const CodingErrorAction = { IGNORE: 'IGNORE', REPLACE: 'REPLACE', REPORT: 'REPORT' } as const;
export type CodingErrorAction = (typeof CodingErrorAction)[keyof typeof CodingErrorAction];

export class CoderResult {
  static readonly UNDERFLOW = new CoderResult(0, 0);
  static readonly OVERFLOW = new CoderResult(1, 0);
  private readonly type: number;
  private readonly len: number;
  private constructor(type: number, len: number) { this.type = type; this.len = len; }
  static malformedForLength(length: number): CoderResult { return new CoderResult(2, length); }
  static unmappableForLength(length: number): CoderResult { return new CoderResult(3, length); }
  isUnderflow(): boolean { return this.type === 0; }
  isOverflow(): boolean { return this.type === 1; }
  isError(): boolean { return this.type >= 2; }
  isMalformed(): boolean { return this.type === 2; }
  isUnmappable(): boolean { return this.type === 3; }
  length(): number {
    if (!this.isError()) throw new Error('UnsupportedOperationException');
    return this.len;
  }
  throwException(): never {
    switch (this.type) {
      case 0: throw new Error('BufferUnderflowException');
      case 1: throw new Error('BufferOverflowException');
      case 2: throw new MalformedInputException(this.len);
      default: throw new UnmappableCharacterException(this.len);
    }
  }
  toString(): string { return ['UNDERFLOW', 'OVERFLOW', 'MALFORMED[' + this.len + ']', 'UNMAPPABLE[' + this.len + ']'][this.type]!; }
}

/** The outcome of decoding or encoding one character at a position. */
type Step = { n: number; out: number[] } | { error: CoderResult } | null; // null: incomplete input

interface Codec {
  /** Decodes the sequence starting at a[i] (a[i..lim)), giving the UTF-16 units. */
  decodeOne(a: Int8Array, i: number, lim: number): Step;
  /** Encodes the char starting at c[i] (c[i..lim)), giving the bytes. */
  encodeOne(c: Uint16Array, i: number, lim: number): Step;
  maxCharsPerByte: number;
  maxBytesPerChar: number;
  /** Bytes and chars 0..127 map to each other one to one (a fast path for ASCII). */
  asciiCompatible: boolean;
}

const UTF_8: Codec = {
  asciiCompatible: true,
  maxCharsPerByte: 1.0,
  maxBytesPerChar: 3.0,
  decodeOne(a, i, lim) {
    const b0 = a[i]! & 0xff;
    if (b0 < 0x80) return { n: 1, out: [b0] };
    let need: number, min: number, cp: number;
    if (b0 >= 0xc2 && b0 <= 0xdf) { need = 1; min = 0x80; cp = b0 & 0x1f; }
    else if (b0 >= 0xe0 && b0 <= 0xef) { need = 2; min = 0x800; cp = b0 & 0x0f; }
    else if (b0 >= 0xf0 && b0 <= 0xf4) { need = 3; min = 0x10000; cp = b0 & 0x07; }
    else return { error: CoderResult.malformedForLength(1) };
    for (let k = 1; k <= need; k++) {
      if (i + k >= lim) {
        // Incomplete: underflow unless what is there is already malformed.
        return null;
      }
      const b = a[i + k]! & 0xff;
      if ((b & 0xc0) !== 0x80) return { error: CoderResult.malformedForLength(k) };
      cp = (cp << 6) | (b & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return { error: CoderResult.malformedForLength(need + 1) };
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      return { n: need + 1, out: [0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff)] };
    }
    return { n: need + 1, out: [cp] };
  },
  encodeOne(c, i, lim) {
    const u = c[i]!;
    if (u < 0x80) return { n: 1, out: [u] };
    if (u < 0x800) return { n: 1, out: [0xc0 | (u >> 6), 0x80 | (u & 0x3f)] };
    if (u >= 0xd800 && u <= 0xdbff) {
      if (i + 1 >= lim) return null;
      const lo = c[i + 1]!;
      if (lo < 0xdc00 || lo > 0xdfff) return { error: CoderResult.malformedForLength(1) };
      const cp = 0x10000 + ((u - 0xd800) << 10) + (lo - 0xdc00);
      return { n: 2, out: [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)] };
    }
    if (u >= 0xdc00 && u <= 0xdfff) return { error: CoderResult.malformedForLength(1) };
    return { n: 1, out: [0xe0 | (u >> 12), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f)] };
  },
};

/** A single-byte charset from its 256 chars (-1: unmappable byte). */
function singleByte(table: Int32Array): Codec {
  const reverse = new Map<number, number>();
  for (let b = 0; b < 256; b++) if (table[b]! >= 0 && !reverse.has(table[b]!)) reverse.set(table[b]!, b);
  let ascii = true;
  for (let b = 0; b < 128; b++) if (table[b] !== b) ascii = false;
  return {
    asciiCompatible: ascii,
    maxCharsPerByte: 1.0,
    maxBytesPerChar: 1.0,
    decodeOne(a, i) {
      const ch = table[a[i]! & 0xff]!;
      return ch < 0 ? { error: CoderResult.unmappableForLength(1) } : { n: 1, out: [ch] };
    },
    encodeOne(c, i, lim) {
      const u = c[i]!;
      const b = reverse.get(u);
      if (b !== undefined) return { n: 1, out: [b] };
      if (u >= 0xd800 && u <= 0xdbff) {
        if (i + 1 >= lim) return null;
        const lo = c[i + 1]!;
        return lo >= 0xdc00 && lo <= 0xdfff ? { error: CoderResult.unmappableForLength(2) } : { error: CoderResult.malformedForLength(1) };
      }
      if (u >= 0xdc00 && u <= 0xdfff) return { error: CoderResult.malformedForLength(1) };
      return { error: CoderResult.unmappableForLength(1) };
    },
  };
}

function identityTable(n: number): Int32Array {
  const t = new Int32Array(256).fill(-1);
  for (let b = 0; b < n; b++) t[b] = b;
  return t;
}

/** The table of a TextDecoder single-byte encoding, or null if TextDecoder does not know it. */
function textDecoderTable(label: string): Int32Array | null {
  let dec: TextDecoder;
  try {
    dec = new TextDecoder(label);
  } catch {
    return null;
  }
  const enc = dec.encoding;
  if (enc === 'utf-8' || enc.startsWith('utf-16') || enc === 'replacement' || /^(gb|big5|euc|iso-2022|shift_jis)/.test(enc)) return null;
  const t = new Int32Array(256);
  for (let b = 0; b < 256; b++) {
    const s = dec.decode(new Uint8Array([b]));
    t[b] = s.length === 1 && s !== '�' ? s.charCodeAt(0) : -1;
  }
  return t;
}

const CANONICAL: Record<string, string> = {
  'utf-8': 'UTF-8', utf8: 'UTF-8',
  'iso-8859-1': 'ISO-8859-1', 'iso8859-1': 'ISO-8859-1', cp819: 'ISO-8859-1', iso8859_1: 'ISO-8859-1', 'iso_8859-1': 'ISO-8859-1', 'iso_8859_1': 'ISO-8859-1', latin1: 'ISO-8859-1', l1: 'ISO-8859-1',
  'us-ascii': 'US-ASCII', ascii: 'US-ASCII',
};

export class Charset {
  private static readonly cache = new Map<string, Charset>();
  private readonly canonicalName: string;
  /** @internal */
  readonly codec: Codec;

  private constructor(canonicalName: string, codec: Codec) {
    this.canonicalName = canonicalName;
    this.codec = codec;
  }

  static forName(charsetName: string): Charset {
    const key = charsetName.trim().toLowerCase();
    const cached = Charset.cache.get(key);
    if (cached) return cached;
    let cs: Charset | null = null;
    const canonical = CANONICAL[key];
    if (canonical === 'UTF-8') cs = new Charset('UTF-8', UTF_8);
    else if (canonical === 'ISO-8859-1') cs = new Charset('ISO-8859-1', singleByte(identityTable(256)));
    else if (canonical === 'US-ASCII') cs = new Charset('US-ASCII', singleByte(identityTable(128)));
    else {
      // Java's aliases: Cp1250 is windows-1250, ISO8859_2 / iso8859-2 is ISO-8859-2.
      let m: RegExpExecArray | null;
      let name = key.replace(/_/g, '-');
      if ((m = /^(?:cp|windows-?)(\d{3,4})$/.exec(key))) name = 'windows-' + m[1];
      else if ((m = /^iso-?8859-?(\d+)$/.exec(name))) name = 'ISO-8859-' + m[1];
      else if (/^koi8/.test(name)) name = name.toUpperCase();
      const table = textDecoderTable(name);
      if (table) cs = new Charset(name, singleByte(table));
    }
    if (!cs) throw new UnsupportedCharsetException(charsetName);
    Charset.cache.set(key, cs);
    return cs;
  }

  static isSupported(charsetName: string): boolean {
    try {
      Charset.forName(charsetName);
      return true;
    } catch {
      return false;
    }
  }

  name(): string { return this.canonicalName; }
  newDecoder(): CharsetDecoder { return new CharsetDecoder(this); }
  newEncoder(): CharsetEncoder { return new CharsetEncoder(this); }
  toString(): string { return this.canonicalName; }

  /** String.getBytes(charset): unmappable chars become '?', as in Java. */
  encodeString(s: string): Int8Array {
    const enc = this.newEncoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE);
    const bb = enc.encode(CharBuffer.wrap(s));
    return bb.array().slice(0, bb.limit());
  }

  /** new String(bytes, charset): malformed input becomes U+FFFD, as in Java. */
  decodeBytes(bytes: Int8Array | Uint8Array): string {
    const dec = this.newDecoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE);
    return dec.decode(ByteBuffer.wrap(bytes)).toString();
  }
}

export class CharsetDecoder {
  private readonly cs: Charset;
  private malformed: CodingErrorAction = CodingErrorAction.REPORT;
  private unmappable: CodingErrorAction = CodingErrorAction.REPORT;

  constructor(cs: Charset) { this.cs = cs; }

  charset(): Charset { return this.cs; }
  maxCharsPerByte(): number { return this.cs.codec.maxCharsPerByte; }
  averageCharsPerByte(): number { return this.cs.codec.maxCharsPerByte; }
  malformedInputAction(): CodingErrorAction { return this.malformed; }
  unmappableCharacterAction(): CodingErrorAction { return this.unmappable; }
  onMalformedInput(action: CodingErrorAction): CharsetDecoder { this.malformed = action; return this; }
  onUnmappableCharacter(action: CodingErrorAction): CharsetDecoder { this.unmappable = action; return this; }
  reset(): CharsetDecoder { return this; }
  flush(_out: CharBuffer): CoderResult { return CoderResult.UNDERFLOW; }

  /**
   * decode(in, out, endOfInput): decodes as many bytes as possible, as Java's does;
   * decode(in): decodes the remaining bytes into a new buffer, throwing on errors (REPORT).
   */
  decode(input: ByteBuffer): CharBuffer;
  decode(input: ByteBuffer, out: CharBuffer, endOfInput: boolean): CoderResult;
  decode(input: ByteBuffer, out?: CharBuffer, endOfInput?: boolean): CoderResult | CharBuffer {
    if (out === undefined) {
      const chars = CharBuffer.allocate(Math.ceil(input.remaining() * this.maxCharsPerByte()) + 1);
      const cr = this.decode(input, chars, true);
      if (cr.isError()) cr.throwException();
      chars.flip();
      return chars;
    }
    const codec = this.cs.codec;
    const a = input.array();
    const base = input.arrayOffset();
    let i = input.position();
    const lim = input.limit();
    let result = CoderResult.UNDERFLOW;
    while (i < lim) {
      // ASCII needs no codec step (most of a dictionary's bytes).
      if (codec.asciiCompatible && a[base + i]! >= 0) {
        if (out.remaining() < 1) { result = CoderResult.OVERFLOW; break; }
        out.putCode(a[base + i]!);
        i++;
        continue;
      }
      const step = codec.decodeOne(a, base + i, base + lim);
      let cr: CoderResult;
      if (step === null) {
        if (!endOfInput) break;
        cr = CoderResult.malformedForLength(lim - i);
      } else if ('error' in step) {
        cr = step.error;
      } else {
        if (out.remaining() < step.out.length) { result = CoderResult.OVERFLOW; break; }
        for (const u of step.out) out.putCode(u);
        i += step.n;
        continue;
      }
      const action = cr.isMalformed() ? this.malformed : this.unmappable;
      if (action === CodingErrorAction.REPORT) { result = cr; break; }
      if (action === CodingErrorAction.REPLACE) {
        if (out.remaining() < 1) { result = CoderResult.OVERFLOW; break; }
        out.putCode(0xfffd);
      }
      i += cr.length();
    }
    input.position(i);
    return result;
  }
}

export class CharsetEncoder {
  private readonly cs: Charset;
  private malformed: CodingErrorAction = CodingErrorAction.REPORT;
  private unmappable: CodingErrorAction = CodingErrorAction.REPORT;

  constructor(cs: Charset) { this.cs = cs; }

  charset(): Charset { return this.cs; }
  maxBytesPerChar(): number { return this.cs.codec.maxBytesPerChar; }
  averageBytesPerChar(): number { return this.cs.codec.maxBytesPerChar; }
  malformedInputAction(): CodingErrorAction { return this.malformed; }
  unmappableCharacterAction(): CodingErrorAction { return this.unmappable; }
  onMalformedInput(action: CodingErrorAction): CharsetEncoder { this.malformed = action; return this; }
  onUnmappableCharacter(action: CodingErrorAction): CharsetEncoder { this.unmappable = action; return this; }
  reset(): CharsetEncoder { return this; }
  flush(_out: ByteBuffer): CoderResult { return CoderResult.UNDERFLOW; }

  /** True if the char (or string) can be encoded. */
  canEncode(s: string): boolean {
    try {
      this.encode(CharBuffer.wrap(s));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * encode(in, out, endOfInput): encodes as many chars as possible, as Java's does;
   * encode(in): encodes the remaining chars into a new buffer, throwing on errors (REPORT).
   */
  encode(input: CharBuffer): ByteBuffer;
  encode(input: CharBuffer, out: ByteBuffer, endOfInput: boolean): CoderResult;
  encode(input: CharBuffer, out?: ByteBuffer, endOfInput?: boolean): CoderResult | ByteBuffer {
    if (out === undefined) {
      const bytes = ByteBuffer.allocate(Math.ceil(input.remaining() * this.maxBytesPerChar()) + 4);
      const cr = this.encode(input, bytes, true);
      if (cr.isError()) cr.throwException();
      bytes.flip();
      return bytes;
    }
    const codec = this.cs.codec;
    const c = input.array();
    let i = input.position();
    const lim = input.limit();
    let result = CoderResult.UNDERFLOW;
    while (i < lim) {
      // ASCII needs no codec step.
      if (codec.asciiCompatible && c[i]! < 0x80) {
        if (out.remaining() < 1) { result = CoderResult.OVERFLOW; break; }
        out.put(c[i]!);
        i++;
        continue;
      }
      const step = codec.encodeOne(c, i, lim);
      let cr: CoderResult;
      if (step === null) {
        if (!endOfInput) break;
        cr = CoderResult.malformedForLength(lim - i);
      } else if ('error' in step) {
        cr = step.error;
      } else {
        if (out.remaining() < step.out.length) { result = CoderResult.OVERFLOW; break; }
        for (const b of step.out) out.put((b << 24) >> 24);
        i += step.n;
        continue;
      }
      const action = cr.isMalformed() ? this.malformed : this.unmappable;
      if (action === CodingErrorAction.REPORT) { result = cr; break; }
      if (action === CodingErrorAction.REPLACE) {
        if (out.remaining() < 1) { result = CoderResult.OVERFLOW; break; }
        out.put(0x3f); // '?'
      }
      i += cr.length();
    }
    input.position(i);
    return result;
  }
}
