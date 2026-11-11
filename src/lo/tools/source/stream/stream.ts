// SPDX-License-Identifier: MPL-2.0
// @upstream tools/source/stream/stream.cxx reduced
// @upstream tools/source/stream/GenericTypeSerializer.cxx partial
// SvStream for reading a little-endian byte buffer: the integer reads, ReadUniOrByteString and
// GenericTypeSerializer::readColor. Errors are thrown instead of set as the stream's state.

export class SvStream {
  private m_nPos = 0;
  private readonly m_aData: Uint8Array;
  private readonly m_aView: DataView;
  /** The stream's character set for byte strings (RTL_TEXTENCODING_*); only UTF-8 and Latin-1 are decoded. */
  m_eStreamCharSet = 'latin1';

  constructor(aData: Uint8Array) {
    this.m_aData = aData;
    this.m_aView = new DataView(aData.buffer, aData.byteOffset, aData.byteLength);
  }

  Tell(): number { return this.m_nPos; }
  Seek(n: number): void { this.m_nPos = n; }
  remainingSize(): number { return this.m_aData.length - this.m_nPos; }
  good(): boolean { return this.m_nPos < this.m_aData.length; }

  private need(n: number): number {
    if (this.m_nPos + n > this.m_aData.length) throw new RangeError('SvStream: read past the end');
    const p = this.m_nPos;
    this.m_nPos += n;
    return p;
  }

  ReadUChar(): number { return this.m_aView.getUint8(this.need(1)); }
  ReadSChar(): number { return this.m_aView.getInt8(this.need(1)); }
  ReadCharAsBool(): boolean { return this.ReadUChar() !== 0; }
  ReadUInt16(): number { return this.m_aView.getUint16(this.need(2), true); }
  ReadInt16(): number { return this.m_aView.getInt16(this.need(2), true); }
  ReadUInt32(): number { return this.m_aView.getUint32(this.need(4), true); }
  ReadInt32(): number { return this.m_aView.getInt32(this.need(4), true); }
  ReadUInt64(): number { return Number(this.m_aView.getBigUint64(this.need(8), true)); }
  ReadInt64(): number { return Number(this.m_aView.getBigInt64(this.need(8), true)); }
  ReadFloat(): number { return this.m_aView.getFloat32(this.need(4), true); }
  SeekRel(n: number): void { this.m_nPos += n; }
  TellEnd(): number { return this.m_aData.length; }
  /** ReadBytes: up to n bytes from the position (fewer at the end of the data). */
  ReadBytes(n: number): Uint8Array {
    const p = Math.min(this.m_nPos, this.m_aData.length), e = Math.min(p + Math.max(0, n), this.m_aData.length);
    this.m_nPos = e;
    return this.m_aData.subarray(p, e);
  }

  /** ReadUniOrByteString: 'unicode' reads a uint32-prefixed UTF-16 string, else a uint16-prefixed byte string. */
  ReadUniOrByteString(eSrcCharSet: string = this.m_eStreamCharSet): string {
    if (eSrcCharSet === 'unicode') {
      const n = this.ReadUInt32();
      const p = this.need(n * 2);
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(this.m_aView.getUint16(p + i * 2, true));
      return s;
    }
    const n = this.ReadUInt16();
    const bytes = this.m_aData.subarray(this.need(n), this.m_nPos);
    return new TextDecoder(eSrcCharSet === 'utf-8' ? 'utf-8' : 'latin1').decode(bytes);
  }

  /** GenericTypeSerializer::readColor: a user colour (COL_NAME_USER) or one of the named colours. */
  readColor(): string {
    const COL_NAME_USER = 0x8000;
    const nColorNameID = this.ReadUInt16();
    const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (nColorNameID & COL_NAME_USER) {
      const r = this.ReadUInt16(), g = this.ReadUInt16(), b = this.ReadUInt16();
      return hex(r >> 8, g >> 8, b >> 8);
    }
    const staticColorArray = [
      '#000000', '#000080', '#008000', '#008080', '#800000', '#800080', '#808000', '#808080', '#c0c0c0', '#0000ff', '#00ff00', '#00ffff',
      '#ff0000', '#ff00ff', '#ffff00', '#ffffff', '#ffffff', '#000000', '#ffffff', '#000000', '#000000', '#ffffff', '#000000', '#ffffff',
      '#000000', '#c0c0c0', '#ffffff', '#808080', '#c0c0c0', '#ffffff', '#000000',
    ];
    return staticColorArray[nColorNameID] ?? '#000000';
  }
}
