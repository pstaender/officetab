// SPDX-License-Identifier: MPL-2.0
// @upstream filter/source/svg/svgwriter.cxx reduced
// Upstream's SVGActionWriter turns a metafile's actions into SVG elements. Here SVGContext offers
// the subset of CanvasRenderingContext2D that Writer's painting uses (as the PDF writer's context
// does), so the same paint code produces SVG: paths, rectangles, text, images, clipping and
// transforms. Text stays text in the fonts the layout used; each run is given the width the layout
// measured (textLength), so lines break and align as on screen. Gradients, patterns and embedded
// fonts are not ported (the page's own web fonts render the text).

/** Platform services: measuring text in a CSS font (and letter spacing) the way the layout did. */
export interface SVGEnvironment {
  measure(cssFont: string, text: string, letterSpacing: string): number;
  /** The text's glyph bounds above and below the baseline (TextMetrics' actualBoundingBox), if known. */
  bounds?(cssFont: string, text: string): { ascent: number; descent: number };
}

/** Marks an image handed to drawImage: its URL (a blob: or data: URL). */
export interface SVGImageRef { svgHref: string }

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const num = (n: number): string => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Characters XML does not allow (control codes other than tab, newline and return). */
const xmlText = (s: string) => esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));

interface State { globalAlpha: number; m: Mat; clip: string | null; fillStyle: string; strokeStyle: string; lineWidth: number; font: string; wordSpacing: string; letterSpacing: string; textAlign: CanvasTextAlign; direction: CanvasDirection; dash: number[] }

/** The canvas subset Writer's painting uses, recording SVG elements. */
export class SVGContext {
  fillStyle = '#000000';
  globalAlpha = 1;
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '10px serif';
  wordSpacing = '0px';
  letterSpacing = '0px';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  textRendering = 'auto';
  fontKerning = 'normal';
  direction: CanvasDirection = 'ltr';
  textAlign: CanvasTextAlign = 'start';
  private readonly out: string[] = [];
  private readonly defs: string[] = [];
  private path: string[] = [];
  private dash: number[] = [];
  private m: Mat = IDENTITY;
  private clipId: string | null = null;
  private stack: State[] = [];
  private nIds = 0;
  private readonly env: SVGEnvironment;
  private readonly idPrefix: string;

  constructor(env: SVGEnvironment, idPrefix = 'p') { this.env = env; this.idPrefix = idPrefix; }

  /** The page transform is fixed, as in the PDF writer. */
  setTransform(): void { /* nothing */ }
  getTransform(): { a: number; b: number } { return { a: this.m[0], b: this.m[1] }; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.m = mul(this.m, [a, b, c, d, e, f]); }
  setLineDash(d: number[]): void { this.dash = d; }

  save(): void {
    this.stack.push({ globalAlpha: this.globalAlpha, m: this.m, clip: this.clipId, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, wordSpacing: this.wordSpacing, letterSpacing: this.letterSpacing, textAlign: this.textAlign, direction: this.direction, dash: this.dash });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    ({ globalAlpha: this.globalAlpha, m: this.m, clip: this.clipId, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, wordSpacing: this.wordSpacing, letterSpacing: this.letterSpacing, textAlign: this.textAlign, direction: this.direction, dash: this.dash } = s);
  }

  /** The transform and opacity attributes every element carries (the clip goes on in emit()). */
  private attrs(): string {
    const m = this.m;
    const t = this.transformed() ? ` transform="matrix(${m.map(num).join(' ')})"` : '';
    const o = this.globalAlpha < 1 ? ` opacity="${num(this.globalAlpha)}"` : '';
    return `${t}${o}`;
  }
  private transformed(): boolean { return !(this.m === IDENTITY || this.m.every((v, k) => v === IDENTITY[k])); }

  /**
   * Writes an element under the current clip. An element's clip-path is read in its own user
   * space, which its transform attribute changes, but the clip was set in page space: a
   * transformed element goes into a group that carries the clip.
   */
  private emit(el: string): void {
    if (!this.clipId) { this.out.push(el); return; }
    const clip = ` clip-path="url(#${this.clipId})"`;
    if (this.transformed()) this.out.push(`<g${clip}>${el}</g>`);
    else this.out.push(el.replace(/(\/?>)/, `${clip}$1`));
  }

  beginPath(): void { this.path = []; }
  moveTo(x: number, y: number): void { this.path.push(`M${num(x)} ${num(y)}`); }
  lineTo(x: number, y: number): void { this.path.push(`L${num(x)} ${num(y)}`); }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void { this.path.push(`C${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)}`); }
  closePath(): void { this.path.push('Z'); }
  rect(x: number, y: number, w: number, h: number): void { this.path.push(`M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`); }

  /** As on a canvas, the path stays the current path after clipping; clips intersect. */
  clip(rule: CanvasFillRule = 'nonzero'): void {
    if (!this.path.length) return;
    const id = `${this.idPrefix}c${++this.nIds}`;
    const m = this.m;
    const t = m.every((v, k) => v === IDENTITY[k]) ? '' : ` transform="matrix(${m.map(num).join(' ')})"`;
    // A clip path's own clip-path makes it the intersection with the clip before.
    this.defs.push(`<clipPath id="${id}"${this.clipId ? ` clip-path="url(#${this.clipId})"` : ''}><path d="${this.path.join('')}"${t} clip-rule="${rule}"/></clipPath>`);
    this.clipId = id;
  }

  fill(rule: CanvasFillRule = 'nonzero'): void {
    if (!this.path.length || /^(transparent|none)$/i.test(this.fillStyle)) return;
    this.emit(`<path d="${this.path.join('')}" fill="${esc(this.fillStyle)}"${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this.attrs()}/>`);
  }
  stroke(): void {
    if (!this.path.length || /^(transparent|none)$/i.test(this.strokeStyle)) return;
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.map(num).join(' ')}"` : '';
    this.emit(`<path d="${this.path.join('')}" fill="none" stroke="${esc(this.strokeStyle)}" stroke-width="${num(this.lineWidth)}"${dash}${this.attrs()}/>`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    if (/^(transparent|none)$/i.test(this.fillStyle)) return;
    this.emit(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${esc(this.fillStyle)}"${this.attrs()}/>`);
  }
  strokeRect(x: number, y: number, w: number, h: number): void { this.beginPath(); this.rect(x, y, w, h); this.stroke(); }

  measureText(text: string): { width: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number } {
    const b = this.env.bounds?.(this.font, text);
    return { width: this.env.measure(this.font, text, this.letterSpacing), actualBoundingBoxAscent: b?.ascent, actualBoundingBoxDescent: b?.descent };
  }

  fillText(text: string, x: number, y: number): void {
    if (!text || /^(transparent|none)$/i.test(this.fillStyle)) return;
    const ws = parseFloat(this.wordSpacing) || 0;
    // The width the layout measured, with justification's extra space between words.
    const width = this.env.measure(this.font, text, this.letterSpacing) + ws * (text.match(/ /g)?.length ?? 0);
    const rtl = this.direction === 'rtl';
    // Placed by its left edge: text aligned at its end (right-to-left runs) moves left by its width.
    if (this.textAlign === 'right' || (this.textAlign === 'start' && rtl) || (this.textAlign === 'end' && !rtl)) x -= width;
    else if (this.textAlign === 'center') x -= width / 2;
    const style = [`font:${this.font}`, 'white-space:pre', 'font-kerning:normal'];
    if (ws) style.push(`word-spacing:${num(ws)}px`);
    if (parseFloat(this.letterSpacing)) style.push(`letter-spacing:${this.letterSpacing}`, 'font-variant-ligatures:none');
    // A right-to-left run is drawn from its right edge, as the canvas does with direction rtl.
    const anchor = rtl ? ` direction="rtl" text-anchor="end" x="${num(x + width)}"` : ` x="${num(x)}"`;
    const len = width > 0 ? ` textLength="${num(width)}" lengthAdjust="spacing"` : '';
    this.emit(`<text${anchor} y="${num(y)}" fill="${esc(this.fillStyle)}" style="${esc(style.join(';'))}"${len}${this.attrs()}>${xmlText(text)}</text>`);
  }

  drawImage(img: unknown, x: number, y: number, w: number, h: number): void {
    const ref = img as Partial<SVGImageRef>;
    if (!ref.svgHref) return;
    this.emit(`<image href="${esc(ref.svgHref)}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"${this.attrs()}/>`);
  }

  /** The page as an SVG element of `w` × `h` CSS units showing the area (x, y, w', h') of the paint coordinates. */
  Emit(viewBox: [number, number, number, number], cssWidth: string, cssHeight: string): string {
    const [x, y, w, h] = viewBox;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" width="${cssWidth}" height="${cssHeight}"><defs>${this.defs.join('')}</defs><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="#ffffff"/>${this.out.join('')}</svg>`;
  }
}
