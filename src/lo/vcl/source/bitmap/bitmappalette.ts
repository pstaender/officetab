// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/bitmap/bitmappalette.cxx partial
// @upstream include/vcl/BitmapColor.hxx reduced
// @upstream include/tools/color.hxx partial
// BitmapColor and the palette of an 8 bit bitmap: entry access, GetBestIndex, IsGreyPalette8Bit
// and GetGreyPalette. BitmapColor is reduced to the channels and the colour helpers the bitmap
// filters use (GetLuminance, GetColorError, Invert, the index stored in blue).

export class BitmapColor {
  mnRed: number;
  mnGreen: number;
  mnBlue: number;
  mnAlpha: number;

  constructor(nRed = 0, nGreen = 0, nBlue = 0, nAlpha = 255) {
    this.mnRed = nRed & 0xff;
    this.mnGreen = nGreen & 0xff;
    this.mnBlue = nBlue & 0xff;
    this.mnAlpha = nAlpha & 0xff;
  }

  /** BitmapColor(sal_uInt8 cIndex): a palette index, stored in blue. */
  static FromIndex(cIndex: number): BitmapColor {
    const aCol = new BitmapColor(0, 0, 0);
    aCol.SetIndex(cIndex);
    return aCol;
  }

  GetRed(): number { return this.mnRed; }
  GetGreen(): number { return this.mnGreen; }
  GetBlue(): number { return this.mnBlue; }
  GetAlpha(): number { return this.mnAlpha; }
  SetRed(n: number): void { this.mnRed = n & 0xff; }
  SetGreen(n: number): void { this.mnGreen = n & 0xff; }
  SetBlue(n: number): void { this.mnBlue = n & 0xff; }
  SetAlpha(n: number): void { this.mnAlpha = n & 0xff; }

  GetIndex(): number { return this.GetBlue(); }
  SetIndex(cIndex: number): void { this.SetBlue(cIndex); }

  GetLuminance(): number {
    return ((this.GetBlue() * 29 + this.GetGreen() * 151 + this.GetRed() * 76) >>> 8) & 0xff;
  }

  GetColorError(rCompareColor: BitmapColor): number {
    return (
      Math.abs(this.GetBlue() - rCompareColor.GetBlue()) +
      Math.abs(this.GetGreen() - rCompareColor.GetGreen()) +
      Math.abs(this.GetRed() - rCompareColor.GetRed())
    ) & 0xffff;
  }

  /** Inverts color. 1 and 0 are switched.
      Note that the result will be the complementary color.
      For example, if you have red, you will get cyan: FF0000 -> 00FFFF. */
  Invert(): void {
    this.SetRed(~this.GetRed());
    this.SetGreen(~this.GetGreen());
    this.SetBlue(~this.GetBlue());
  }

  equals(rColor: BitmapColor): boolean {
    return this.mnRed === rColor.mnRed && this.mnGreen === rColor.mnGreen && this.mnBlue === rColor.mnBlue
      && this.mnAlpha === rColor.mnAlpha;
  }

  clone(): BitmapColor {
    return new BitmapColor(this.mnRed, this.mnGreen, this.mnBlue, this.mnAlpha);
  }
}

export class BitmapPalette {
  maBitmapColor: BitmapColor[];

  constructor(nCount = 0) {
    this.maBitmapColor = Array.from({ length: nCount }, () => new BitmapColor());
  }

  GetEntryCount(): number { return this.maBitmapColor.length; }

  SetEntryCount(nCount: number): void {
    const nOld = this.maBitmapColor.length;
    this.maBitmapColor.length = nCount;
    for (let i = nOld; i < nCount; i++) this.maBitmapColor[i] = new BitmapColor();
  }

  /** operator[] for reading. */
  get(nIndex: number): BitmapColor { return this.maBitmapColor[nIndex]; }

  /** operator[] for writing. */
  set(nIndex: number, rCol: BitmapColor): void { this.maBitmapColor[nIndex] = rCol.clone(); }

  clone(): BitmapPalette {
    const aPal = new BitmapPalette();
    aPal.maBitmapColor = this.maBitmapColor.map((c) => c.clone());
    return aPal;
  }

  GetBestIndex(rCol: BitmapColor): number {
    const rBitmapColor = this.maBitmapColor;
    let nRetIndex = 0;

    if (rBitmapColor.length) {
      for (let j = 0; j < rBitmapColor.length; ++j) {
        if (rCol.equals(rBitmapColor[j])) {
          return j;
        }
      }

      let nLastErr = 0xffff;
      for (let i = 0; i < rBitmapColor.length; ++i) {
        const nActErr = rCol.GetColorError(rBitmapColor[i]);
        if (nActErr < nLastErr) {
          nLastErr = nActErr;
          nRetIndex = i;
        }
      }
    }

    return nRetIndex;
  }

  IsGreyPalette8Bit(): boolean {
    const rBitmapColor = this.maBitmapColor;
    if (!rBitmapColor.length) return true;
    if (rBitmapColor.length !== 256) return false;
    for (let i = 0; i < 256; ++i) {
      if (rBitmapColor[i].GetRed() !== i || rBitmapColor[i].GetGreen() !== i || rBitmapColor[i].GetBlue() !== i)
        return false;
    }
    return true;
  }
}

/** Bitmap::GetGreyPalette (bitmap.cxx), only for the 256 entries the filters use. */
export function GetGreyPalette256(): BitmapPalette {
  const aGreyPalette = new BitmapPalette(256);
  for (let i = 0; i < 256; i++) aGreyPalette.set(i, new BitmapColor(i, i, i));
  return aGreyPalette;
}
