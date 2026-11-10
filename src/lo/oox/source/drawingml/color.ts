// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/drawingml/color.cxx reduced
// oox::drawingml::Color::getColor for the colour elements Word writes (a:srgbClr, a:schemeClr,
// a:sysClr, a:prstClr, a:scrgbClr) and the lumMod, lumOff, shade and tint transformations, with
// upstream's CRGB gamma (2.3) and HSL conversions. Other transformations and alpha are ignored.
import { child, childElements, type XmlElement } from '../../../xmloff/source/core/xmlparse.ts';

const MAX_PERCENT = 100000;
const DEC_GAMMA = 2.3;
const INC_GAMMA = 1 / DEC_GAMMA;

/** The theme's colour scheme (a:clrScheme), by scheme name (dk1, lt1, accent1, ...). */
export type ThemeColors = Record<string, string>;

const PRESET: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00',
  cyan: '00ffff', magenta: 'ff00ff', gray: '808080', grey: '808080', darkGray: 'a9a9a9', lightGray: 'd3d3d3',
  orange: 'ffa500', purple: '800080', navy: '000080', maroon: '800000', olive: '808000', teal: '008080', silver: 'c0c0c0',
};
/** ClrScheme: the names a:schemeClr may use for the four basic colours. */
const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

const gamma = (v: number, g: number) => Math.round(Math.pow(v / MAX_PERCENT, g) * MAX_PERCENT);
const rgbToCrgb = (c: number) => gamma(Math.round((c * MAX_PERCENT) / 255), DEC_GAMMA);
const crgbToRgb = (c: number) => Math.round((gamma(c, INC_GAMMA) * 255) / MAX_PERCENT);

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const fR = r / 255, fG = g / 255, fB = b / 255;
  const fMin = Math.min(fR, fG, fB), fMax = Math.max(fR, fG, fB), fD = fMax - fMin;
  let h = 0;
  if (fD !== 0) h = fMax === fR ? ((fG - fB) / fD * 60 + 360) % 360 : fMax === fG ? (fB - fR) / fD * 60 + 120 : (fR - fG) / fD * 60 + 240;
  const l = (fMin + fMax) / 2;
  const s = l === 0 || l === 1 ? 0 : l <= 0.5 ? fD / (fMin + fMax) : fD / (2 - fMax - fMin);
  return [h, s, l];
}
function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0 || l === 1) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hue = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [hue(h / 360 + 1 / 3), hue(h / 360), hue(h / 360 - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** The colour of a colour element (or of an element holding one, such as a:solidFill), as #rrggbb. */
export function GetColor(el: XmlElement | undefined, theme: ThemeColors): string | null {
  if (!el) return null;
  const c = ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr'].includes(el.name) ? el : childElements(el).find((e) => e.name.endsWith('Clr'));
  if (!c) return null;
  const val = c.attrs.get('val') ?? '';
  let hex: string | undefined;
  switch (c.name) {
    case 'a:srgbClr': hex = val; break;
    case 'a:sysClr': hex = c.attrs.get('lastClr') ?? (val === 'window' ? 'ffffff' : '000000'); break;
    case 'a:prstClr': hex = PRESET[val]; break;
    case 'a:schemeClr': hex = theme[SCHEME_ALIAS[val] ?? val]?.replace('#', ''); break;
    case 'a:scrgbClr': {
      const p = (k: string) => crgbToRgb(parseInt(c.attrs.get(k) ?? '0', 10));
      hex = [p('r'), p('g'), p('b')].map((v) => v.toString(16).padStart(2, '0')).join('');
      break;
    }
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  let rgb = [0, 2, 4].map((k) => parseInt(hex!.slice(k, k + 2), 16)) as [number, number, number];
  for (const t of childElements(c)) {
    const v = parseInt(t.attrs.get('val') ?? '0', 10);
    switch (t.name) {
      case 'a:lumMod': case 'a:lumOff': {
        const [h, s, l0] = toHsl(...rgb);
        let l = t.name === 'a:lumMod' ? (l0 * v) / MAX_PERCENT : l0 + v / MAX_PERCENT;
        l = Math.min(1, Math.max(0, l));
        rgb = fromHsl(h, l === 0 || l === 1 ? 0 : s, l);
        break;
      }
      case 'a:shade': case 'a:tint': {
        // In linear (CRGB) values: shade blends towards black, tint towards white.
        const f = Math.min(MAX_PERCENT, Math.max(0, v)) / MAX_PERCENT;
        rgb = rgb.map((ch) => {
          const lin = rgbToCrgb(ch);
          return crgbToRgb(t.name === 'a:shade' ? lin * f : MAX_PERCENT - (MAX_PERCENT - lin) * f);
        }) as [number, number, number];
        break;
      }
    }
  }
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** ThemeImport: the colour scheme of word/theme/theme1.xml (a:theme/a:themeElements/a:clrScheme). */
export function ReadThemeColors(theme: XmlElement | undefined): ThemeColors {
  const scheme = child(child(child(theme, 'a:theme'), 'a:themeElements'), 'a:clrScheme');
  const out: ThemeColors = {};
  for (const e of scheme ? childElements(scheme) : []) {
    const c = GetColor(e, {});
    if (c) out[e.name.replace(/^a:/, '')] = c;
  }
  return out;
}
