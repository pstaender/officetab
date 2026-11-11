// SPDX-License-Identifier: MPL-2.0
// @upstream filter/source/svg/svgwriter.cxx reduced
// Upstream's SVGActionWriter turns a metafile's actions into SVG elements. Here SVGContext offers
// the subset of CanvasRenderingContext2D that Writer's painting uses (as the PDF writer's context
// does), so the same paint code produces SVG: paths, rectangles, text, images, clipping and
// transforms. Text stays text in the fonts the layout used; each run is given the width the layout
// measured (textLength), so lines break and align as on screen. Gradients, patterns and embedded
// fonts are not ported (the page's own web fonts render the text). WriteMetaFileSVG writes the
// actions of a GDIMetaFile (a WMF or EMF graphic) as an SVG document.

import { PolyFlags, type Polygon, type PolyPolygon } from '../../../tools/source/generic/poly.ts';
import { RasterOp, type ClipPart, type GDIMetaFile, type LineInfo, type MetaAction, type VclFont } from '../../../vcl/source/gdi/gdimtf.ts';

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
  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y); }
  scale(sx: number, sy: number): void { this.transform(sx, 0, 0, sy, 0, 0); }
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

/**
 * SVGActionWriter::ImplWriteActions for a metafile of the WMF and EMF readers: every action as an
 * SVG element in the metafile's 1/100 mm, with its clip region as nested clip paths. The
 * document scales to `nWidth` × `nHeight` CSS pixels (preserveAspectRatio none), as a graphic is
 * stretched to its frame.
 *
 * Reduced: raster operations other than overpaint are not combined with what is below; the XOR
 * paint trick of old metafiles (a bitmap drawn with XOR, black shapes, the same bitmap with XOR
 * again, which leaves the bitmap inside the shapes) is recognised and written as the bitmap
 * clipped to the shapes, other XOR painting overpaints and inverting painting is left out.
 * Text uses the metafile's font by name with a generic fallback; the text background, font
 * widths (condensed fonts) and kerning are not written.
 */
export function WriteMetaFileSVG(rMtf: GDIMetaFile, nWidth?: number, nHeight?: number): string {
  const aPref = rMtf.GetPrefSize();
  const W = Math.max(1, aPref.width), H = Math.max(1, aPref.height);
  const cssW = nWidth ?? Math.max(1, Math.round((W / 2540) * 96)), cssH = nHeight ?? Math.max(1, Math.round((H / 2540) * 96));
  const defs: string[] = [];
  const out: string[] = [];
  let nIds = 0;
  let maLineColor: string | null = '#000000', maFillColor: string | null = '#ffffff';
  let maFont: VclFont | null = null;
  let meRasterOp: number = RasterOp.OverPaint;
  let nClipDepth = 0;
  const clipIds = new Map<ClipPart, string>();
  type BmpAction = Extract<MetaAction, { mnType: 'BMPSCALE' }>;
  // The XOR paint trick: the first XOR bitmap, where its output starts, and the black shapes since.
  let pXor: { pA: BmpAction; nOut: number; aShapes: string[] } | null = null;

  const n = (v: number) => num(v);
  const PolyPath = (p: Polygon, bClose: boolean): string => {
    const pts = p.mxPointAry;
    if (!pts.length) return '';
    let d = `M${n(pts[0]!.X())} ${n(pts[0]!.Y())}`;
    for (let i = 1; i < pts.length; i++) {
      if (p.GetFlags(i) === PolyFlags.Control && i + 2 < pts.length) {
        d += `C${n(pts[i]!.X())} ${n(pts[i]!.Y())} ${n(pts[i + 1]!.X())} ${n(pts[i + 1]!.Y())} ${n(pts[i + 2]!.X())} ${n(pts[i + 2]!.Y())}`;
        i += 2;
      } else d += `L${n(pts[i]!.X())} ${n(pts[i]!.Y())}`;
    }
    return bClose ? `${d}Z` : d;
  };
  const PolyPolyPath = (pp: PolyPolygon): string => pp.mpPolyAry.map((p) => PolyPath(p, true)).join('');
  // A hairline is one pixel wide at any scale.
  const Hairline = ' stroke-width="1" vector-effect="non-scaling-stroke"';
  const FillStroke = (): string => `fill="${maFillColor ?? 'none'}"${maLineColor ? ` stroke="${maLineColor}"${Hairline}` : ''}`;
  const LineAttrs = (li: LineInfo): string => {
    const w = Math.abs(li.mnWidth);
    let a = w ? ` stroke-width="${n(w)}"` : Hairline;
    if (li.meStyle === 'DASH') {
      // LineInfo's dashes and dots (a hairline's of about a pixel)
      const unit = w || W / cssW;
      const dash = li.mnDashLen || unit * 3, dot = li.mnDotLen || unit, dist = li.mnDistance || unit;
      const arr: number[] = [];
      for (let i = 0; i < li.mnDashCount; i++) arr.push(dash, dist);
      for (let i = 0; i < li.mnDotCount; i++) arr.push(dot, dist);
      if (arr.length) a += ` stroke-dasharray="${arr.map(n).join(' ')}"`;
    }
    if (w) a += ` stroke-linejoin="${li.meLineJoin}" stroke-linecap="${li.meLineCap}"`;
    return a;
  };
  const Emit = (el: string, bBlackShape = false): void => {
    if (meRasterOp === RasterOp.Invert) return;
    if (pXor) {
      const m = bBlackShape ? /\bd="([^"]*)"/.exec(el) : null;
      if (m) pXor.aShapes.push(m[1]!);
      else pXor = null;
    }
    out.push(el);
  };
  const IsBlackShape = () => maFillColor === '#000000' && !maLineColor;
  const SetClip = (maRegion: ClipPart[] | null): void => {
    pXor = null;
    for (; nClipDepth > 0; nClipDepth--) out.push('</g>');
    for (const part of maRegion ?? []) {
      let id = clipIds.get(part);
      if (!id) {
        id = `c${++nIds}`;
        clipIds.set(part, id);
        defs.push(`<clipPath id="${id}"><path d="${PolyPolyPath(part.aPolyPoly)}" clip-rule="${part.bEvenOdd ? 'evenodd' : 'nonzero'}"/></clipPath>`);
      }
      out.push(`<g clip-path="url(#${id})">`);
      nClipDepth++;
    }
  };
  const Image = (pA: BmpAction): string => {
    const b = pA.maBmp;
    let x = pA.maPt.X(), y = pA.maPt.Y(), w = pA.maSz.Width(), h = pA.maSz.Height();
    // A negative size mirrors the bitmap.
    const flip: string[] = [];
    if (w < 0) { flip.push(`translate(${n(2 * x + w)} 0) scale(-1 1)`); x += w; w = -w; }
    if (h < 0) { flip.push(`translate(0 ${n(2 * y + h)}) scale(1 -1)`); y += h; h = -h; }
    const t = flip.length ? ` transform="${flip.join(' ')}"` : '';
    // A crop of the whole bitmap is none.
    if (!b.crop || (b.crop.x === 0 && b.crop.y === 0 && b.crop.width === b.width && b.crop.height === b.height)) return `<image href="${esc(b.href)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"${t}/>`;
    const c = b.crop;
    return `<svg x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="${c.x} ${c.y} ${c.width} ${c.height}" preserveAspectRatio="none"${t}><image href="${esc(b.href)}" width="${b.width}" height="${b.height}"/></svg>`;
  };
  const GENERIC: Record<string, string> = { roman: 'serif', swiss: 'sans-serif', modern: 'monospace', script: 'cursive', decorative: 'fantasy' };

  for (const pA of rMtf.m_aList) {
    switch (pA.mnType) {
      case 'LINECOLOR': maLineColor = pA.mbSet ? pA.maColor : null; break;
      case 'FILLCOLOR': maFillColor = pA.mbSet ? pA.maColor : null; break;
      case 'RASTEROP': meRasterOp = pA.meRasterOp; break;
      case 'CLIPREGION': SetClip(pA.maRegion); break;
      case 'FONT': maFont = pA.maFont; break;
      case 'PIXEL': Emit(`<rect x="${n(pA.maPt.X())}" y="${n(pA.maPt.Y())}" width="1" height="1" fill="${pA.maColor}"/>`); break;
      case 'RECT': {
        if (!maFillColor && !maLineColor) break;
        const r = pA.maRect;
        Emit(`<path d="M${n(r.Left())} ${n(r.Top())}H${n(r.Right())}V${n(r.Bottom())}H${n(r.Left())}Z" ${FillStroke()}/>`, IsBlackShape());
        break;
      }
      case 'ROUNDRECT': {
        const r = pA.maRect;
        Emit(`<rect x="${n(Math.min(r.Left(), r.Right()))}" y="${n(Math.min(r.Top(), r.Bottom()))}" width="${n(Math.abs(r.GetWidth()))}" height="${n(Math.abs(r.GetHeight()))}" rx="${n(pA.mnHorzRound)}" ry="${n(pA.mnVertRound)}" ${FillStroke()}/>`);
        break;
      }
      case 'ELLIPSE': {
        const r = pA.maRect, c = r.Center();
        Emit(`<ellipse cx="${n(c.X())}" cy="${n(c.Y())}" rx="${n(Math.abs(r.GetWidth()) / 2)}" ry="${n(Math.abs(r.GetHeight()) / 2)}" ${FillStroke()}/>`);
        break;
      }
      case 'ARC':
        if (maLineColor) Emit(`<path d="${PolyPath(pA.maPoly, false)}" fill="none" stroke="${maLineColor}"${Hairline}/>`);
        break;
      case 'PIE':
      case 'CHORD':
      case 'POLYGON':
        if (!maFillColor && !maLineColor) break;
        Emit(`<path d="${PolyPath(pA.maPoly, true)}" fill-rule="evenodd" ${FillStroke()}/>`, IsBlackShape());
        break;
      case 'POLYPOLYGON':
        if (!maFillColor && !maLineColor) break;
        Emit(`<path d="${PolyPolyPath(pA.maPolyPoly)}" fill-rule="evenodd" ${FillStroke()}/>`, IsBlackShape());
        break;
      case 'LINE':
      case 'POLYLINE': {
        if (!maLineColor || pA.maLineInfo.meStyle === 'NONE') break;
        const d = pA.mnType === 'LINE' ? `M${n(pA.maStartPt.X())} ${n(pA.maStartPt.Y())}L${n(pA.maEndPt.X())} ${n(pA.maEndPt.Y())}` : PolyPath(pA.maPoly, false);
        Emit(`<path d="${d}" fill="none" stroke="${maLineColor}"${LineAttrs(pA.maLineInfo)}/>`);
        break;
      }
      case 'TEXTARRAY': {
        if (!maFont || !pA.maStr) break;
        const f = maFont, h = f.maFontSize.Height() || 423;
        const x0 = pA.maStartPt.X(), y0 = pA.maStartPt.Y();
        // VCL aligns the text's top, baseline or bottom at the position (Arial's ascent and descent).
        const yb = y0 + (f.meAlign === 'TOP' ? h * 0.905 : f.meAlign === 'BOTTOM' ? -h * 0.212 : 0);
        const xs = pA.maDXAry ? [x0, ...pA.maDXAry.slice(0, pA.maStr.length - 1).map((dx) => x0 + dx)].map(n).join(' ') : n(x0);
        const family = `'${f.maFamilyName.replace(/'/g, '')}', ${GENERIC[f.meFamily] ?? 'sans-serif'}`;
        const deco = [f.mbUnderline ? 'underline' : '', f.mbStrikeout ? 'line-through' : ''].filter(Boolean).join(' ');
        const rot = f.mnOrientation % 3600 ? ` transform="rotate(${n(-f.mnOrientation / 10)} ${n(x0)} ${n(y0)})"` : '';
        const anchor = pA.meAnchor && pA.meAnchor !== 'start' ? ` text-anchor="${pA.meAnchor}"` : '';
        Emit(`<text x="${xs}" y="${n(yb)}" font-family="${esc(family)}" font-size="${n(h)}"${f.meWeight ? ` font-weight="${f.meWeight}"` : ''}${f.mbItalic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''} fill="${f.maColor}"${anchor}${rot} xml:space="preserve">${xmlText(pA.maStr)}</text>`);
        break;
      }
      case 'BMPSCALE': {
        if (!pA.maBmp.href || meRasterOp === RasterOp.Invert) break;
        if (meRasterOp !== RasterOp.Xor) { Emit(Image(pA)); break; }
        const p = pXor;
        if (p && p.aShapes.length && p.pA.maBmp.href === pA.maBmp.href && p.pA.maPt.equals(pA.maPt) && p.pA.maSz.equals(pA.maSz)) {
          // The XOR paint trick: the bitmap inside the black shapes, the rest left as it was.
          out.length = p.nOut;
          const id = `c${++nIds}`;
          defs.push(`<clipPath id="${id}"><path d="${p.aShapes.join('')}"/></clipPath>`);
          out.push(`<g clip-path="url(#${id})">${Image(pA)}</g>`);
          pXor = null;
          break;
        }
        pXor = null;
        const nOut = out.length;
        Emit(Image(pA));
        pXor = { pA, nOut, aShapes: [] };
        break;
      }
    }
  }
  for (; nClipDepth > 0; nClipDepth--) out.push('</g>');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cssW}" height="${cssH}" viewBox="0 0 ${n(W)} ${n(H)}" preserveAspectRatio="none" overflow="hidden"><defs>${defs.join('')}</defs>${out.join('')}</svg>`;
}
