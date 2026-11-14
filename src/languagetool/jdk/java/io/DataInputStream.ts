// SPDX-License-Identifier: MPL-2.0
// java.io.DataInputStream over a byte array, for the LanguageTool ports: not a port, the part of
// the JDK's API they use. Big-endian, as DataOutputStream writes; readUTF decodes Java's modified
// UTF-8 (a two-byte length, NUL as C0 80, supplementary characters as two three-byte surrogates).

export class EOFException extends Error {}
export class UTFDataFormatException extends Error {}

export class DataInputStream {
  private readonly m_aBytes: Uint8Array;
  private readonly m_aView: DataView;
  private m_nPos = 0;

  constructor(bytes: Uint8Array) {
    this.m_aBytes = bytes;
    this.m_aView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.m_nPos + n > this.m_aBytes.length) throw new EOFException();
  }

  /** Bytes not read yet. */
  available(): number { return this.m_aBytes.length - this.m_nPos; }

  readByte(): number { this.need(1); return this.m_aView.getInt8(this.m_nPos++); }
  readUnsignedByte(): number { this.need(1); return this.m_aBytes[this.m_nPos++]; }
  readBoolean(): boolean { return this.readUnsignedByte() !== 0; }
  readShort(): number { this.need(2); const v = this.m_aView.getInt16(this.m_nPos); this.m_nPos += 2; return v; }
  readUnsignedShort(): number { this.need(2); const v = this.m_aView.getUint16(this.m_nPos); this.m_nPos += 2; return v; }
  readChar(): string { return String.fromCharCode(this.readUnsignedShort()); }
  readInt(): number { this.need(4); const v = this.m_aView.getInt32(this.m_nPos); this.m_nPos += 4; return v; }
  readLong(): bigint { this.need(8); const v = this.m_aView.getBigInt64(this.m_nPos); this.m_nPos += 8; return v; }
  readFloat(): number { this.need(4); const v = this.m_aView.getFloat32(this.m_nPos); this.m_nPos += 4; return v; }
  readDouble(): number { this.need(8); const v = this.m_aView.getFloat64(this.m_nPos); this.m_nPos += 8; return v; }

  readFully(b: Uint8Array, off = 0, len = b.length - off): void {
    this.need(len);
    b.set(this.m_aBytes.subarray(this.m_nPos, this.m_nPos + len), off);
    this.m_nPos += len;
  }

  skipBytes(n: number): number {
    const k = Math.max(0, Math.min(n, this.available()));
    this.m_nPos += k;
    return k;
  }

  readUTF(): string {
    const utflen = this.readUnsignedShort();
    this.need(utflen);
    const b = this.m_aBytes;
    const end = this.m_nPos + utflen;
    let p = this.m_nPos;
    // the common case: all ASCII
    let ascii = true;
    for (let i = p; i < end; i++) if (b[i] & 0x80) { ascii = false; break; }
    if (ascii) {
      this.m_nPos = end;
      return utflen === 0 ? '' : String.fromCharCode.apply(null, b.subarray(p, end) as unknown as number[]);
    }
    const chars: number[] = [];
    while (p < end) {
      const c = b[p];
      switch (c >> 4) {
        case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
          // 0xxxxxxx
          p++;
          chars.push(c);
          break;
        case 12: case 13: {
          // 110x xxxx   10xx xxxx
          p += 2;
          if (p > end) throw new UTFDataFormatException('malformed input: partial character at end');
          const c2 = b[p - 1];
          if ((c2 & 0xC0) !== 0x80) throw new UTFDataFormatException(`malformed input around byte ${p}`);
          chars.push(((c & 0x1F) << 6) | (c2 & 0x3F));
          break;
        }
        case 14: {
          // 1110 xxxx  10xx xxxx  10xx xxxx
          p += 3;
          if (p > end) throw new UTFDataFormatException('malformed input: partial character at end');
          const c2 = b[p - 2], c3 = b[p - 1];
          if ((c2 & 0xC0) !== 0x80 || (c3 & 0xC0) !== 0x80) throw new UTFDataFormatException(`malformed input around byte ${p - 1}`);
          chars.push(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
          break;
        }
        default:
          // 10xx xxxx,  1111 xxxx
          throw new UTFDataFormatException(`malformed input around byte ${p}`);
      }
    }
    this.m_nPos = end;
    let s = '';
    for (let i = 0; i < chars.length; i += 8192) s += String.fromCharCode.apply(null, chars.slice(i, i + 8192));
    return s;
  }
}
