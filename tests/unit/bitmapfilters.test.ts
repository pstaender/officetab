import { describe, expect, it } from 'vitest';
import type { BitmapBuffer } from '../../src/lo/vcl/source/bitmap/bitmapfilter.ts';
import { BitmapMosaicFilter } from '../../src/lo/vcl/source/bitmap/BitmapMosaicFilter.ts';
import { BitmapMedianFilter } from '../../src/lo/vcl/source/bitmap/BitmapMedianFilter.ts';
import { BitmapGaussianSeparableBlurFilter } from '../../src/lo/vcl/source/bitmap/BitmapGaussianSeparableBlurFilter.ts';
import { ImplConvertDown8BPP, ImplMakeGreyscales } from '../../src/lo/vcl/source/bitmap/bitmap.ts';
import { ExecuteGrfFilter, GetGrfFilterParams, GrfFilterTable } from '../../src/lo/svx/source/dialog/grfflt.ts';

type RGBA = [number, number, number, number];

function make(width: number, height: number, f: (x: number, y: number) => RGBA): BitmapBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(f(x, y), (y * width + x) * 4);
  return { width, height, data };
}

function px(b: BitmapBuffer, x: number, y: number): RGBA {
  const p = (y * b.width + x) * 4;
  return [b.data[p], b.data[p + 1], b.data[p + 2], b.data[p + 3]];
}

function colours(b: BitmapBuffer): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < b.data.length; i += 4) s.add(`${b.data[i]},${b.data[i + 1]},${b.data[i + 2]}`);
  return s;
}

const grey = (v: number, a = 255): RGBA => [v, v, v, a];
const gradient = make(16, 12, (x, y) => [x * 16, y * 20, (x * y * 7) & 255, 255]);

describe('graphic filters', () => {
  it('has a table entry for every Format > Image > Filter command', () => {
    expect(Object.keys(GrfFilterTable)).toHaveLength(11);
    expect(GrfFilterTable['.uno:GraphicFilterInvert'].params).toEqual([]);
    expect(GrfFilterTable['.uno:GraphicFilterSmooth'].params[0]).toMatchObject({ name: 'radius', default: 0.7, min: 0.1, max: 100 });
    // dlgfact.cxx: mosaic 4 x 4 without edges, posterize 16, aging 10, solarize 128 (50 %), emboss MM
    expect(GrfFilterTable['.uno:GraphicFilterMosaic'].params.map((p) => p.default)).toEqual([4, 4, false]);
    expect(GrfFilterTable['.uno:GraphicFilterPoster'].params[0].default).toBe(16);
    expect(GrfFilterTable['.uno:GraphicFilterSepia'].params[0]).toMatchObject({ label: 'Aging degree:', default: 10, min: 1, max: 100 });
    expect(GrfFilterTable['.uno:GraphicFilterSolarize'].params.map((p) => p.default)).toEqual([50, false]);
    expect(GrfFilterTable['.uno:GraphicFilterRelief'].params[0]).toMatchObject({ type: 'choice', default: 'MM' });
    expect(GrfFilterTable['.uno:GraphicFilterRelief'].params[0].choices).toHaveLength(9);
    // the dialog constructors limit the ranges by the graphic
    const ps = GetGrfFilterParams('.uno:GraphicFilterMosaic', gradient);
    expect([ps[0].max, ps[1].max]).toEqual([16, 12]);
    expect(GetGrfFilterParams('.uno:GraphicFilterPoster', gradient)[0].max).toBe(24);
    expect(GetGrfFilterParams('.uno:GraphicFilterPoster', make(2, 2, () => grey(9, 100)))[0].max).toBe(32);
  });

  it('keeps the size and does not modify the input', () => {
    const copy = new Uint8ClampedArray(gradient.data);
    for (const command of Object.keys(GrfFilterTable)) {
      const out = ExecuteGrfFilter(command, gradient, {})!;
      expect(out, command).not.toBeNull();
      expect([out.width, out.height, out.data.length], command).toEqual([16, 12, 16 * 12 * 4]);
    }
    expect(gradient.data).toEqual(copy);
    expect(ExecuteGrfFilter('.uno:Bold', gradient, {})).toBeNull();
    expect(ExecuteGrfFilter('.uno:GraphicFilterInvert', { width: 0, height: 0, data: new Uint8ClampedArray() }, {})).toBeNull();
  });

  it('inverts the colour and keeps the alpha', () => {
    const out = ExecuteGrfFilter('.uno:GraphicFilterInvert', make(1, 1, () => [10, 20, 30, 128]), {})!;
    expect(px(out, 0, 0)).toEqual([245, 235, 225, 128]);
  });

  it('ages through the sepia palette of the luminance', () => {
    // luminance (B*29 + G*151 + R*76) >> 8 of grey 100 is 100; 10 %: G = B = 9000 * 100 / 10000
    const out = ExecuteGrfFilter('.uno:GraphicFilterSepia', make(2, 1, (x) => (x ? [255, 0, 0, 255] : grey(100))), {})!;
    expect(px(out, 0, 0)).toEqual([100, 90, 90, 255]);
    // red: luminance 255 * 76 >> 8 = 75; 9000 * 75 / 10000 = 67.5
    expect(px(out, 1, 0)).toEqual([75, 67, 67, 255]);
    const full = ExecuteGrfFilter('.uno:GraphicFilterSepia', make(1, 1, () => grey(200)), { value: 100 })!;
    expect(px(full, 0, 0)).toEqual([200, 0, 0, 255]);
    // the result is an 8 bit palette bitmap upstream: it has no alpha
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterSepia', make(1, 1, () => grey(100, 50)), {})!, 0, 0)[3]).toBe(255);
  });

  it('solarizes from the threshold on', () => {
    // 50 % is fround(50 * 2.55) = fround(127.49999999999999) = 127
    const img = make(3, 1, (x) => grey([126, 127, 200][x], 90));
    const out = ExecuteGrfFilter('.uno:GraphicFilterSolarize', img, { value: 50, invert: false })!;
    expect([px(out, 0, 0), px(out, 1, 0), px(out, 2, 0)]).toEqual([grey(126, 90), grey(128, 90), grey(55, 90)]);
    const inverted = ExecuteGrfFilter('.uno:GraphicFilterSolarize', img, { value: 50, invert: true })!;
    expect([px(inverted, 0, 0), px(inverted, 1, 0)]).toEqual([grey(129, 90), grey(127, 90)]);
    const all = ExecuteGrfFilter('.uno:GraphicFilterSolarize', img, { value: 0 })!;
    expect(px(all, 0, 0)).toEqual(grey(129, 90));
  });

  it('averages mosaic tiles, truncating', () => {
    const img = make(3, 2, (x, y) => [[0, 10, 100][x] + y * 21, 0, 255, 255]);
    const out = new BitmapMosaicFilter(2, 2).execute(img)!;
    // left tile: (0 + 10 + 21 + 31) / 4 = 15.5; the right tile is 1 pixel wide: (100 + 121) / 2
    expect(px(out, 0, 0)).toEqual([15, 0, 255, 255]);
    expect(px(out, 1, 1)).toEqual([15, 0, 255, 255]);
    expect(px(out, 2, 0)).toEqual([110, 0, 255, 255]);
    expect(px(out, 2, 1)).toEqual([110, 0, 255, 255]);
    // no filter for 1 x 1 tiles
    expect(new BitmapMosaicFilter(1, 1).execute(img)).toBeNull();
    expect(ExecuteGrfFilter('.uno:GraphicFilterMosaic', img, { width: 1, height: 1 })).toBeNull();
    // in place on a 32 bit bitmap the tile keeps the alpha of the last pixel read
    const alpha = make(2, 2, (x, y) => [0, 0, 0, 10 + x + 2 * y]);
    expect(new BitmapMosaicFilter(2, 2).execute(alpha)!.data[3]).toBe(13);
  });

  it('posterizes to the most popular colours', () => {
    for (const n of [2, 4, 16]) {
      const out = ExecuteGrfFilter('.uno:GraphicFilterPoster', gradient, { value: n })!;
      const cs = colours(out);
      expect(cs.size).toBeLessThanOrEqual(n);
      for (const c of cs) for (const v of c.split(',')) expect(Number(v) % 16).toBe(0);
    }
    // the dialog's maximum for a 24 bit graphic is 24
    expect(colours(ExecuteGrfFilter('.uno:GraphicFilterPoster', gradient, { value: 200 })!).size).toBeLessThanOrEqual(24);
  });

  it('sharpens with the 3 x 3 matrix and a divisor of 8', () => {
    const uniform = ExecuteGrfFilter('.uno:GraphicFilterSharpen', make(3, 3, () => grey(77, 40)), {})!;
    expect(px(uniform, 1, 1)).toEqual(grey(77));
    const dot = ExecuteGrfFilter('.uno:GraphicFilterSharpen', make(3, 3, (x, y) => grey(x === 1 && y === 1 ? 80 : 0)), {})!;
    // centre 16 * 80 / 8 = 160; neighbours -80 / 8 clamped to 0
    expect(px(dot, 1, 1)).toEqual(grey(160));
    expect(px(dot, 0, 0)).toEqual(grey(0));
  });

  it('removes noise with the 3 x 3 median', () => {
    const img = make(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 0, 255, 255] : [50, 60, 70, 255]));
    const out = ExecuteGrfFilter('.uno:GraphicFilterRemoveNoise', img, {})!;
    expect(colours(out)).toEqual(new Set(['50,60,70']));
    // the sorting network gives the median of nine values
    const values = [9, 3, 7, 1, 8, 2, 6, 4, 5];
    const nine = make(3, 3, (x, y) => grey(values[y * 3 + x] * 10));
    expect(px(new BitmapMedianFilter().execute(nine)!, 1, 1)).toEqual(grey(50));
  });

  it('draws a charcoal sketch from the Sobel gradient', () => {
    const flat = ExecuteGrfFilter('.uno:GraphicFilterSobel', make(4, 4, () => [10, 200, 30, 255]), {})!;
    expect(colours(flat)).toEqual(new Set(['255,255,255']));
    // a vertical edge from 0 to 100 grey: |sum1| = 100 + 200 + 100 = 400, clamped to 255, inverted
    const edge = ExecuteGrfFilter('.uno:GraphicFilterSobel', make(4, 3, (x) => grey(x < 2 ? 0 : 100)), {})!;
    expect(px(edge, 1, 1)).toEqual(grey(0));
    expect(px(edge, 0, 1)).toEqual(grey(255));
  });

  it('converts to greyscale as ImplMakeGreyscales does', () => {
    // 24 bit: (B*28 + G*151 + R*77) >> 8; 32 bit: GetLuminance, (B*29 + G*151 + R*76) >> 8
    expect(ImplMakeGreyscales(make(1, 1, () => [255, 0, 0, 255]))!.indices[0]).toBe(76);
    expect(ImplMakeGreyscales(make(1, 1, () => [255, 0, 0, 254]))!.indices[0]).toBe(75);
  });

  it('embosses with the light source of the dialog', () => {
    // a flat image has no normal: the grey is the light's z, fround(sin(elevation) * 255)
    const flat = make(3, 3, () => grey(120));
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterRelief', flat, { lightsource: 'MM' })!, 1, 1)).toEqual(grey(255));
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterRelief', flat, { lightsource: 'LT' })!, 1, 1)).toEqual(grey(180));
    // a slope falling to the right is brighter in light from the left than from the right
    const slope = make(3, 3, (x) => grey(200 - x * 50));
    const fromLeft = ExecuteGrfFilter('.uno:GraphicFilterRelief', slope, { lightsource: 'LM' })!;
    const fromRight = ExecuteGrfFilter('.uno:GraphicFilterRelief', slope, { lightsource: 'RM' })!;
    expect(px(fromLeft, 1, 1)[0]).toBeGreaterThan(px(fromRight, 1, 1)[0]);
  });

  it('smooths with the separable Gaussian blur', () => {
    const kernel = { value: 0 };
    const k = BitmapGaussianSeparableBlurFilter.makeBlurKernel(0.7, kernel);
    expect(kernel.value).toBe(3);
    // the neighbours at distance 1 are beyond the radius 0.7
    expect(k[0]).toBe(0);
    expect(k[2]).toBe(0);
    const spike = make(5, 5, (x, y) => grey(x === 2 && y === 2 ? 255 : 0));
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterSmooth', spike, {})!, 2, 2)).toEqual(grey(255));
    const wide = ExecuteGrfFilter('.uno:GraphicFilterSmooth', spike, { radius: 2 })!;
    expect(px(wide, 2, 2)[0]).toBeLessThan(255);
    expect(px(wide, 1, 2)[0]).toBeGreaterThan(0);
    expect(px(wide, 1, 2)).toEqual(px(wide, 3, 2));
    expect(px(wide, 2, 1)).toEqual(px(wide, 2, 3));
  });

  it('rotates the palette for pop art', () => {
    // red is used most, so its palette entry takes blue's colour and blue's takes red's
    const img = make(4, 4, (x, y) => (x === 0 && y < 2 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
    const conv = ImplConvertDown8BPP(img)!;
    expect(conv.palette.GetEntryCount()).toBe(4); // two leaves plus black and white
    const out = ExecuteGrfFilter('.uno:GraphicFilterPopart', img, {})!;
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  it('keeps alpha only where upstream filters in place', () => {
    const img = make(4, 4, (x) => [x * 60, 100, 50, 77]);
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterInvert', img, {})!, 1, 1)[3]).toBe(77);
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterSolarize', img, {})!, 1, 1)[3]).toBe(77);
    expect(px(ExecuteGrfFilter('.uno:GraphicFilterMosaic', img, { width: 2, height: 2 })!, 1, 1)[3]).toBe(77);
    // these write new 8 or 24 bit bitmaps
    for (const command of ['.uno:GraphicFilterSharpen', '.uno:GraphicFilterSmooth', '.uno:GraphicFilterRemoveNoise',
      '.uno:GraphicFilterSobel', '.uno:GraphicFilterRelief', '.uno:GraphicFilterPoster', '.uno:GraphicFilterPopart',
      '.uno:GraphicFilterSepia'])
      expect(px(ExecuteGrfFilter(command, img, {})!, 1, 1)[3], command).toBe(255);
  });
});
