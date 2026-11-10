// SPDX-License-Identifier: MPL-2.0
// @upstream basegfx/source/color/bcolortools.cxx partial
// basegfx::utils' HSL conversions. A BColor is three doubles in [0, 1] (for HSL: hue in degrees,
// saturation and luminance).

export type BColor = [number, number, number];

const equalZero = (v: number): boolean => Math.abs(v) <= 2 ** -47;
const approxEqual = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= Math.abs(a) * 2 ** -48;

export function rgb2hsl(rRGBColor: BColor): BColor {
  const [r, g, b] = rRGBColor;
  const minVal = Math.min(Math.min(r, g), b);
  const maxVal = Math.max(Math.max(r, g), b);
  const d = maxVal - minVal;

  let h = 0, s = 0;

  const l = (maxVal + minVal) / 2.0;

  if (equalZero(d)) {
    s = h = 0; // hue undefined (achromatic case)
  } else {
    s = l > 0.5 ? d / (2.0 - maxVal - minVal) : d / (maxVal + minVal);

    if (approxEqual(r, maxVal)) h = (g - b) / d;
    else if (approxEqual(g, maxVal)) h = 2.0 + (b - r) / d;
    else h = 4.0 + (r - g) / d;

    h *= 60.0;

    if (h < 0.0) h += 360.0;
  }

  return [h, s, l];
}

function hsl2rgbHelper(nValue1: number, nValue2: number, nHue: number): number {
  // clamp hue to [0,360]
  nHue = nHue % 360.0;

  // cope with wrap-arounds
  if (nHue < 0.0) nHue += 360.0;

  if (nHue < 60.0) return nValue1 + (nValue2 - nValue1) * nHue / 60.0;
  else if (nHue < 180.0) return nValue2;
  else if (nHue < 240.0) return nValue1 + (nValue2 - nValue1) * (240.0 - nHue) / 60.0;
  else return nValue1;
}

export function hsl2rgb(rHSLColor: BColor): BColor {
  const [h, s, l] = rHSLColor;

  if (equalZero(s)) return [l, l, l]; // achromatic case

  const nVal1 = l <= 0.5 ? l * (1.0 + s) : l + s - l * s;
  const nVal2 = 2.0 * l - nVal1;

  return [hsl2rgbHelper(nVal2, nVal1, h + 120.0), hsl2rgbHelper(nVal2, nVal1, h), hsl2rgbHelper(nVal2, nVal1, h - 120.0)];
}
