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
}

// The Liberation families are metric-compatible with these, so layout survives their absence.
const FALLBACKS: Record<string, string> = {
  'Liberation Serif': '"Times New Roman", Times, serif',
  'Liberation Sans': 'Arial, Helvetica, sans-serif',
  'Liberation Mono': '"Courier New", Courier, monospace',
};
const fontStack = (family: string): string => `"${family.replace(/"/g, '')}", ${FALLBACKS[family] ?? 'serif'}`;

export const cssFont = (f: FontDesc): string =>
  `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${f.size}px ${fontStack(f.family)}`;

const MAX_WIDTH_CACHE = 200_000;

/** Canvas-backed measurer with caches: layout measures the same prefixes repeatedly. */
export class CanvasTextMeasurer implements TextMeasurer {
  private ctx: OffscreenCanvasRenderingContext2D;
  private widths = new Map<string, number>();
  private metrics = new Map<string, FontMetric>();
  private current = '';

  constructor() {
    this.ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    this.ctx.textRendering = 'geometricPrecision';
    this.ctx.fontKerning = 'normal';
  }

  private use(css: string): void {
    if (css !== this.current) { this.ctx.font = css; this.current = css; }
  }

  GetTextWidth(font: FontDesc, text: string): number {
    if (!text) return 0;
    const css = cssFont(font);
    const key = `${css}\u0000${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.use(css);
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
      this.use(css);
      const t = this.ctx.measureText('Hg');
      m = { ascent: Math.ceil(t.fontBoundingBoxAscent), descent: Math.ceil(t.fontBoundingBoxDescent) };
      this.metrics.set(css, m);
    }
    return m;
  }

  /** Web fonts change metrics when they finish loading. */
  Invalidate(): void { this.widths.clear(); this.metrics.clear(); this.current = ''; }
}
