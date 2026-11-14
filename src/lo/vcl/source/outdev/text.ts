// SPDX-License-Identifier: MPL-2.0
// @upstream include/vcl/outdev.hxx reduced
// @upstream vcl/source/outdev/text.cxx reduced
// Layout measures with the font sized numerically in twips ("240px" for 12pt). The result is
// independent of zoom and device pixel ratio, playing the role of Writer's reference device.

export interface FontDesc { family: string; size: number; bold: boolean; italic: boolean }
export interface FontMetric { ascent: number; descent: number }

export interface TextMeasurer {
  GetTextWidth(font: FontDesc, text: string): number;
  GetFontMetric(font: FontDesc): FontMetric;
  /**
   * GetTextBoundRect: the ink of the glyphs relative to the text origin on the baseline (top and
   * bottom negative above it). Measurers without it make formulas use the text cell.
   */
  GetTextBoundRect?(font: FontDesc, text: string): { left: number; top: number; right: number; bottom: number } | null;
}

// The Liberation families are metric-compatible with these, so layout survives their absence.
const FALLBACKS: Record<string, string> = {
  'Liberation Serif': '"Times New Roman", Times, serif',
  'Liberation Sans': 'Arial, Helvetica, sans-serif',
  'Liberation Mono': '"Courier New", Courier, monospace',
};
const defaultStack = (family: string): string => `"${family.replace(/"/g, '')}", ${FALLBACKS[family] ?? 'serif'}`;

/**
 * The font substitution (OutputDevice's font mapping with PhysicalFontCollection::FindFontFamily):
 * the CSS font-family list a document font is drawn with. The application sets it, for its font
 * profiles and web fonts; `noLigatures` names families drawn without optional ligatures.
 */
export interface FontResolver { stack(family: string): string; noLigatures?(family: string): boolean }
let resolver: FontResolver = { stack: defaultStack };
/**
 * The font-family list of each family, as the resolver gave it (ImplFontCache): layout measures
 * thousands of times per page, the mapping is the same each time.
 */
const stacks = new Map<string, string>();
let stacksGeneration = 0;
export function SetFontResolver(r: FontResolver | null): void { resolver = r ?? { stack: defaultStack }; InvalidateFontStacks(); }
/** The resolver's answers changed (another font profile, other settings): they are asked again. */
export function InvalidateFontStacks(): void { stacks.clear(); stacksGeneration++; }
/** Counts the changes of the font mapping, for a layout to know whether it is out of date. */
export const GetFontStacksGeneration = (): number => stacksGeneration;
const fontStack = (family: string): string => {
  let s = stacks.get(family);
  if (s === undefined) { s = resolver.stack(family); stacks.set(family, s); }
  return s;
};
/** Whether a family's optional ligatures are off (canvas: a tiny letter spacing turns them off). */
/** The families of the open document's fonts (SvxFontItem's FontFamily), for the resolver's fallback. */
let fontFamilies: ReadonlyMap<string, string> = new Map();
export function SetFontFamilies(m: ReadonlyMap<string, string>): void { if (m !== fontFamilies) { fontFamilies = m; InvalidateFontStacks(); } }
export const GetFontFamily = (name: string): string | undefined => fontFamilies.get(name);
export const NoLigatures = (family: string): boolean => !!resolver.noLigatures?.(family);
export const NO_LIGATURE_SPACING = '0.001px';

export const cssFont = (f: FontDesc): string =>
  `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${f.size}px ${fontStack(f.family)}`;

const MAX_WIDTH_CACHE = 200_000;

/** Canvas-backed measurer with caches: layout measures the same prefixes repeatedly. */
export class CanvasTextMeasurer implements TextMeasurer {
  private ctx: OffscreenCanvasRenderingContext2D;
  private widths = new Map<string, number>();
  private metrics = new Map<string, FontMetric>();
  private bounds = new Map<string, { left: number; top: number; right: number; bottom: number }>();
  private current = '';

  constructor() {
    this.ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    this.ctx.textRendering = 'geometricPrecision';
    this.ctx.fontKerning = 'normal';
  }

  private use(css: string, family = ''): void {
    if (css !== this.current) {
      this.ctx.font = css;
      this.current = css;
      // CSS turns optional ligatures off when letters are spaced; the canvas does the same.
      this.ctx.letterSpacing = NoLigatures(family) ? NO_LIGATURE_SPACING : '0px';
    }
  }

  GetTextWidth(font: FontDesc, text: string): number {
    if (!text) return 0;
    const css = cssFont(font);
    const key = `${css}\u0000${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.use(css, font.family);
      w = this.ctx.measureText(text).width;
      if (this.widths.size >= MAX_WIDTH_CACHE) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  GetFontMetric(font: FontDesc): FontMetric {
    const css = cssFont(font);
    let m = this.metrics.get(css);
    if (!m) {
      this.use(css, font.family);
      const t = this.ctx.measureText('Hg');
      m = { ascent: Math.ceil(t.fontBoundingBoxAscent), descent: Math.ceil(t.fontBoundingBoxDescent) };
      this.metrics.set(css, m);
    }
    return m;
  }

  GetTextBoundRect(font: FontDesc, text: string): { left: number; top: number; right: number; bottom: number } | null {
    if (!text) return null;
    const css = cssFont(font);
    const key = `${css}\u0001${text}`;
    let b = this.bounds.get(key);
    if (!b) {
      this.use(css, font.family);
      const t = this.ctx.measureText(text);
      b = { left: -t.actualBoundingBoxLeft, top: -t.actualBoundingBoxAscent, right: t.actualBoundingBoxRight, bottom: t.actualBoundingBoxDescent };
      if (this.bounds.size >= MAX_WIDTH_CACHE) this.bounds.clear();
      this.bounds.set(key, b);
    }
    return b;
  }

  /** Web fonts change metrics when they finish loading. */
  Invalidate(): void { this.widths.clear(); this.metrics.clear(); this.bounds.clear(); this.current = ''; }
}
