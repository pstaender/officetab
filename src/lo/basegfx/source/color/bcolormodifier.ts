// SPDX-License-Identifier: MPL-2.0
// @upstream basegfx/source/color/bcolormodifier.cxx partial
// The colour modifiers a graphic's colour attributes become (gray, black_and_white, invert,
// gamma, RGBLuminanceContrast) and BColorModifierStack. A BColor is three doubles in [0, 1].
import type { BColor } from './bcolortools.ts';

export interface BColorModifier { getModifiedColor(aSourceColor: BColor): BColor }

const fTools_equalZero = (v: number) => Math.abs(v) <= 1e-9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** BColor::luminance */
export const luminance = (c: BColor): number => c[0] * (77.0 / 256.0) + c[1] * (151.0 / 256.0) + c[2] * (28.0 / 256.0);

export class BColorModifier_gray implements BColorModifier {
  getModifiedColor(aSourceColor: BColor): BColor {
    const fLuminance = luminance(aSourceColor);
    return [fLuminance, fLuminance, fLuminance];
  }
}

export class BColorModifier_invert implements BColorModifier {
  getModifiedColor(aSourceColor: BColor): BColor { return [1.0 - aSourceColor[0], 1.0 - aSourceColor[1], 1.0 - aSourceColor[2]]; }
}

export class BColorModifier_black_and_white implements BColorModifier {
  private readonly mfValue: number;
  constructor(fValue: number) { this.mfValue = fValue; }
  getModifiedColor(aSourceColor: BColor): BColor {
    const fLuminance = luminance(aSourceColor);
    return fLuminance < this.mfValue ? [0, 0, 0] : [1.0, 1.0, 1.0];
  }
}

const f64 = new Float64Array(1), i32 = new Int32Array(f64.buffer);
const MSW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
/**
 * A fast and approximate std::pow(), good enough for gamma calculations, given that the parameter
 * a is in the range [0,1), and b is in the range (0, 0.1]
 */
function fast_pow(a: number, b: number): number {
  f64[0] = a;
  i32[MSW] = Math.trunc(b * (i32[MSW]! - 1072632447) + 1072632447);
  i32[1 - MSW] = 0;
  return f64[0];
}

export class BColorModifier_gamma implements BColorModifier {
  private readonly mfValue: number;
  private mfInvValue: number;
  private readonly mbUseIt: boolean;
  constructor(fValue: number) {
    this.mfValue = fValue;
    this.mfInvValue = fValue;
    this.mbUseIt = Math.abs(fValue - 1.0) > 1e-9 && fValue > 0.0 && fValue <= 10.0 + 1e-9;
    if (this.mbUseIt) this.mfInvValue = 1.0 / this.mfValue;
  }
  getModifiedColor(aSourceColor: BColor): BColor {
    if (!this.mbUseIt) return aSourceColor;
    const r: BColor = [fast_pow(aSourceColor[0], this.mfInvValue), fast_pow(aSourceColor[1], this.mfInvValue), fast_pow(aSourceColor[2], this.mfInvValue)];
    return [clamp(r[0], 0, 1), clamp(r[1], 0, 1), clamp(r[2], 0, 1)];
  }
}

export class BColorModifier_RGBLuminanceContrast implements BColorModifier {
  private readonly mfRed: number;
  private readonly mfGreen: number;
  private readonly mfBlue: number;
  private readonly mfLuminance: number;
  private readonly mfContrast: number;
  private mfContrastOff = 1.0;
  private mfRedOff = 0.0;
  private mfGreenOff = 0.0;
  private mfBlueOff = 0.0;
  private mbUseIt = false;
  constructor(fRed: number, fGreen: number, fBlue: number, fLuminance: number, fContrast: number) {
    this.mfRed = clamp(fRed, -1.0, 1.0);
    this.mfGreen = clamp(fGreen, -1.0, 1.0);
    this.mfBlue = clamp(fBlue, -1.0, 1.0);
    this.mfLuminance = clamp(fLuminance, -1.0, 1.0);
    this.mfContrast = clamp(fContrast, -1.0, 1.0);
    if (fTools_equalZero(this.mfRed) && fTools_equalZero(this.mfGreen) && fTools_equalZero(this.mfBlue) && fTools_equalZero(this.mfLuminance) && fTools_equalZero(this.mfContrast)) return;
    // calculate slope
    if (this.mfContrast >= 0.0) this.mfContrastOff = 128.0 / (128.0 - this.mfContrast * 127.0);
    else this.mfContrastOff = (128.0 + this.mfContrast * 127.0) / 128.0;
    // calculate unified contrast offset
    const fPreparedContrastOff = (128.0 - this.mfContrastOff * 128.0) / 255.0;
    const fCombinedOffset = this.mfLuminance + fPreparedContrastOff;
    // set full offsets
    this.mfRedOff = this.mfRed + fCombinedOffset;
    this.mfGreenOff = this.mfGreen + fCombinedOffset;
    this.mfBlueOff = this.mfBlue + fCombinedOffset;
    this.mbUseIt = true;
  }
  getModifiedColor(aSourceColor: BColor): BColor {
    if (!this.mbUseIt) return aSourceColor;
    return [
      clamp(aSourceColor[0] * this.mfContrastOff + this.mfRedOff, 0.0, 1.0),
      clamp(aSourceColor[1] * this.mfContrastOff + this.mfGreenOff, 0.0, 1.0),
      clamp(aSourceColor[2] * this.mfContrastOff + this.mfBlueOff, 0.0, 1.0),
    ];
  }
}

/** BColorModifierStack: the last pushed modifier (the innermost) applies first. */
export class BColorModifierStack {
  maBColorModifiers: BColorModifier[] = [];
  push(m: BColorModifier): void { this.maBColorModifiers.push(m); }
  count(): number { return this.maBColorModifiers.length; }
  getModifiedColor(rSource: BColor): BColor {
    let aRetval = rSource;
    for (let a = this.maBColorModifiers.length; a;) { a--; aRetval = this.maBColorModifiers[a]!.getModifiedColor(aRetval); }
    return aRetval;
  }
}
