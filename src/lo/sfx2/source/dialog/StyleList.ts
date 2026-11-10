// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/dialog/StyleList.cxx partial
// @upstream sal/rtl/strtmpl.hxx partial
// ColorHash: the colour the style list and the styles spotlight give a style name.
import { ApplyTintOrShade, HSBtoRGB } from '../../../tools/source/generic/color.ts';

/** rtl::str::hashCode_WithLength over the UTF-16 code units. */
export function hashCode_WithLength(pStr: string): number {
  let h = pStr.length >>> 0;
  for (let i = 0; i < pStr.length; i++) h = (Math.imul(h, 37) + pStr.charCodeAt(i)) >>> 0;
  return h | 0;
}

/** The first number of std::mt19937 seeded with `seed`. */
function mt19937First(seed: number): number {
  const mt = new Uint32Array(624);
  mt[0] = seed >>> 0;
  for (let i = 1; i < 624; i++) {
    const p = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
    mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
  }
  // The first twist only needs element 0: it mixes mt[0], mt[1] and mt[397].
  const y = (mt[0]! & 0x80000000) | (mt[1]! & 0x7fffffff);
  let x = (mt[397]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
  x ^= x >>> 11;
  x ^= (x << 7) & 0x9d2c5680;
  x ^= (x << 15) & 0xefc60000;
  x ^= x >>> 18;
  return x >>> 0;
}

const aSaturationArray = [90, 75, 60];
const aBrightnessArray = [100, 80, 60];
const aTintOrShadeArray = [1_500, 3_000, 4_500, 6_500, 7_500];

export function ColorHash(rString: string): string {
  let nStringHash = hashCode_WithLength(rString) >>> 0;

  // Twist the hash number with a RNG twister so we can get very different number even when the string hash
  // differs only slightly. For example "Heading 1" and "Heading 2" are very close, so we would get a color
  // that is very similar and with number quantization could result in the same color.
  nStringHash = mt19937First(nStringHash);

  const fHue = (nStringHash % 60) * 6;
  nStringHash = Math.floor(nStringHash / 60);

  const fSaturation = aSaturationArray[nStringHash % aSaturationArray.length]!;
  nStringHash = Math.floor(nStringHash / aSaturationArray.length);

  const fBrightness = aBrightnessArray[nStringHash % aBrightnessArray.length]!;
  nStringHash = Math.floor(nStringHash / aBrightnessArray.length);

  const aColor = HSBtoRGB(fHue, fSaturation, fBrightness);
  const fTintOrShade = aTintOrShadeArray[nStringHash % aTintOrShadeArray.length]!;
  return ApplyTintOrShade(aColor, fTintOrShade);
}
