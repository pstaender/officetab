// SPDX-License-Identifier: MPL-2.0
// @upstream tools/source/generic/color.cxx partial
// Colors are '#rrggbb' strings, as the rest of the port paints with.
import { hsl2rgb, rgb2hsl, type BColor } from '../../../basegfx/source/color/bcolortools.ts';

const u8 = (v: number): number => Math.trunc(v) & 0xff;
const hex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
const getBColor = (c: string): BColor => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as BColor;

/** Color::HSBtoRGB: hue in degrees, saturation and brightness in percent (sal_uInt16 each). */
export function HSBtoRGB(nHue: number, nSat: number, nBri: number): string {
  nHue = Math.trunc(nHue); nSat = Math.trunc(nSat); nBri = Math.trunc(nBri);
  let cR = 0, cG = 0, cB = 0;
  const nB = u8(nBri * 255 / 100);

  if (nSat === 0) {
    cR = nB;
    cG = nB;
    cB = nB;
  } else {
    let dH = nHue;
    if (dH === 360.0) dH = 0.0;

    dH /= 60.0;
    const n = Math.trunc(dH);
    const f = dH - n;

    const a = u8(Math.trunc(nB * (100 - nSat) / 100));
    const b = u8(nB * (100 - nSat * f) / 100);
    const c = u8(nB * (100 - nSat * (1.0 - f)) / 100);

    switch (n) {
      case 0: cR = nB; cG = c; cB = a; break;
      case 1: cR = b; cG = nB; cB = a; break;
      case 2: cR = a; cG = nB; cB = c; break;
      case 3: cR = a; cG = b; cB = nB; break;
      case 4: cR = c; cG = a; cB = nB; break;
      case 5: cR = nB; cG = a; cB = b; break;
    }
  }

  return hex(cR, cG, cB);
}

/** Color::ApplyTintOrShade: positive values tint towards white, negative shade towards black (1/100 %). */
export function ApplyTintOrShade(c: string, n100thPercent: number): string {
  if (n100thPercent === 0) return c;

  const aBColor = rgb2hsl(getBColor(c));
  const fFactor = 1.0 - (Math.abs(n100thPercent) / 10000.0);
  let fResult: number;

  if (n100thPercent > 0) { // tint
    fResult = aBColor[2] * fFactor + (1.0 - fFactor);
  } else { // shade
    fResult = aBColor[2] * fFactor;
  }

  aBColor[2] = fResult;
  const rgb = hsl2rgb(aBColor);

  return hex(...(rgb.map((v) => Math.round(v * 255) & 0xff) as [number, number, number]));
}
