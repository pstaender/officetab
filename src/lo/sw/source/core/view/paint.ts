// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/layout/paintfrm.cxx reduced
// @upstream sw/source/core/text/itrpaint.cxx reduced
// @upstream sw/source/core/crsr/viscrs.cxx reduced
import { createGradientSteps } from '../../../../basegfx/source/tools/gradienttools.ts';
import { cssFont, NO_LIGATURE_SPACING, NoLigatures, type FontDesc } from '../../../../vcl/source/outdev/text.ts';

/** The canvas font of a portion, with the letter spacing that keeps its ligatures as measured. */
function setFont(ctx: CanvasRenderingContext2D, f: FontDesc): void {
  ctx.font = cssFont(f);
  ctx.letterSpacing = NoLigatures(f.family) ? NO_LIGATURE_SPACING : '0px';
}
import { CapitalBlocks, displayText, type SwFont, type SwLineLayout, type SwLinePortion } from '../text/itrform2.ts';
import type { FontLineStyle } from '../../../inc/hintids.ts';
import type { SwCellFrame, SwFlyFrame, SwPageFrame, SwTabFrame, SwTextFrame } from '../layout/pagechg.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';
import type { SwCropGrf } from '../../../inc/hintids.ts';
import type { SdrShape } from '../../../inc/frmfmt.ts';
import { EnhancedCustomShape2d, type SdrPathObj } from '../../../../svx/source/customshapes/EnhancedCustomShape2d.ts';
import { GetCustomShapeContent } from '../../../../svx/source/customshapes/EnhancedCustomShapeGeometry.ts';

export const TWIPS_PER_CSS_PX = 15;
/** SwModuleOptions' default mark for changed lines: a black bar in the left margin. */
const CHANGE_BAR = '#000000', CHANGE_BAR_WIDTH = 15, CHANGE_BAR_DIST = 227;

export interface PaintView {
  scrollX: number; // twips
  scrollY: number; // twips
  zoom: number; // 1 = 100%
  dpr: number;
  width: number; // CSS px
  height: number; // CSS px
}

export interface PaintColors {
  desk: string; page: string; pageEdge: string; text: string; selection: string; caret: string; margin: string; field: string;
  controlCodes: string | null;
  /** Comment highlight and anchor line colour, or null when comments are hidden. */
  comment: string | null;
  commentLine: string;
  /** Selection handles of objects. */
  handle: string;
  /** The wave under misspelled words (svtools::SPELL). */
  wrong: string;
}

/** What content painting needs: automatic text colour and the screen-only decorations, or null when printing. */
export interface PaintOptions {
  autoColor: string;
  fieldShading: string | null;
  bounds: string | null;
  /** Highlight of commented text and comment anchors, or null when comments are hidden or printing. */
  commentColor?: string | null;
  /** View > Formatting Marks: the colour to draw them in, or null. */
  controlCodes?: string | null;
  /** Decoded graphics by key; null while one is still loading. */
  graphic?: (key: string) => CanvasImageSource | null;
}

export const pxScale = (v: PaintView): number => (v.zoom * v.dpr) / TWIPS_PER_CSS_PX;

function paintPortion(ctx: CanvasRenderingContext2D, text: string, p: SwLinePortion, x: number, baseline: number, spaceAdd: number, lineTop: number, lineHeight: number, o: PaintOptions): void {
  const autoColor = o.autoColor;
  const f = p.font;
  if (f.hidden) return;
  const slice = text.slice(p.nStart, p.nStart + p.nLen);
  let extra = 0;
  if (spaceAdd) for (const c of slice) if (c === ' ') extra += spaceAdd;
  if (f.background && p.kind === 'text') {
    ctx.fillStyle = f.background;
    ctx.fillRect(x, lineTop, p.nWidth + extra, lineHeight);
  } else if (f.comment && o.commentColor && p.kind === 'text') {
    ctx.fillStyle = o.commentColor;
    ctx.fillRect(x, lineTop, p.nWidth + extra, lineHeight);
  }
  if (p.kind === 'tab' && p.aFill) {
    // SwTabPortion::Paint: the fill character repeated across the tab.
    ctx.fillStyle = f.color ?? autoColor;
    setFont(ctx, f);
    ctx.wordSpacing = '0px';
    const w = ctx.measureText(p.aFill).width;
    if (w > 0) {
      const n = Math.floor(p.nWidth / w);
      ctx.fillText(p.aFill.repeat(Math.max(0, n)), x + p.nWidth - n * w, baseline);
    }
    return;
  }
  if (p.kind === 'fly' && p.pFly) {
    const top = baseline - p.pFly.height;
    if (p.pFly.shape) { PaintShape(ctx, p.pFly.shape, x, top, p.pFly.width, p.pFly.height); return; }
    const img = o.graphic?.(p.pFly.graphic);
    if (img) DrawGraphic(ctx, img, x, top, p.pFly.width, p.pFly.height, p.pFly.crop);
    else { ctx.fillStyle = '#e9ecef'; ctx.fillRect(x, top, p.pFly.width, p.pFly.height); }
    return;
  }
  if (p.kind === 'field') {
    // Field shadings (View > Field Shadings) are a screen aid only.
    if (o.fieldShading && !f.background) { ctx.fillStyle = o.fieldShading; ctx.fillRect(x, lineTop, p.nWidth, lineHeight); }
    DrawText(ctx, f, p.aExpand ?? '', x, baseline - f.rise, p.nWidth, f.color ?? autoColor, 0, false);
    return;
  }
  if (p.kind === 'number' && p.aExpand) {
    ctx.fillStyle = f.color ?? autoColor;
    setFont(ctx, f);
    ctx.wordSpacing = '0px';
    ctx.fillText(p.aExpand, x + (p.nLabelX ?? 0), baseline - f.rise);
    return;
  }
  if (p.kind !== 'text') return;
  DrawText(ctx, f, slice, x, baseline - f.rise, p.nWidth + extra, f.color ?? autoColor, spaceAdd, (p.nLevel ?? 0) % 2 === 1);
}

/** One device pixel of upstream's offsets, at 100 %: a CSS pixel in twips. */
const PX = TWIPS_PER_CSS_PX;
const luminance = (c: string): number => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? (parseInt(m[1]!, 16) * 29 + parseInt(m[2]!, 16) * 151 + parseInt(m[3]!, 16) * 76) >> 8 : 0;
};

/**
 * SwSubFont::DrawText: the text with its case map (small capitals block by block, as
 * SwSubFont::DoOnCapitals), its text lines (underline, overline, strikeout) over the width `w`, and
 * OutputDevice::ImplDrawSpecialText's shadow (a copy offset down right, light grey under dark
 * text) and outline (the text in its colour around each pixel, white inside).
 */
function DrawText(ctx: CanvasRenderingContext2D, f: SwFont, s: string, x: number, y: number, w: number, color: string, spaceAdd: number, rtl: boolean): void {
  const blocks = rtl ? [{ text: displayText(s, f), font: f }] : CapitalBlocks(s, f);
  const once = (dx: number, dy: number, fill: string) => {
    ctx.fillStyle = fill;
    if (rtl) {
      // A right-to-left run is drawn from its right edge, shaped and ordered by the browser.
      setFont(ctx, f);
      ctx.wordSpacing = spaceAdd ? `${spaceAdd}px` : '0px';
      ctx.direction = 'rtl'; ctx.textAlign = 'right';
      ctx.fillText(blocks[0]!.text, x + w + dx, y + dy);
      ctx.direction = 'ltr'; ctx.textAlign = 'start';
    } else {
      let cx = x;
      for (const b of blocks) {
        setFont(ctx, b.font);
        ctx.wordSpacing = '0px';
        const bw = blocks.length > 1 ? ctx.measureText(b.text).width : 0;
        ctx.wordSpacing = spaceAdd ? `${spaceAdd}px` : '0px';
        ctx.fillText(b.text, cx + dx, y + dy);
        if (blocks.length > 1) for (const c of b.text) cx += c === ' ' ? spaceAdd : 0;
        cx += bw;
      }
    }
    TextLines(ctx, f, x + dx, y + dy, w, fill);
  };
  if (f.shadow) {
    // nOff = 1 + (line height - 24) / 24 pixels, one more with the outline.
    let nOff = 1 + Math.trunc(((f.size * 1.15) / PX - 24) / 24);
    if (f.outline) nOff++;
    const shadow = color === '#000000' || luminance(color) < 8 ? '#c0c0c0' : '#000000';
    once(nOff * PX, nOff * PX, shadow);
    if (!f.outline) once(0, 0, color);
  }
  if (f.outline) {
    for (const [dx, dy] of [[-1, -1], [1, 1], [-1, 0], [-1, 1], [0, 1], [0, -1], [1, -1], [1, 0]] as const) once(dx * PX, dy * PX, color);
    once(0, 0, '#ffffff');
  }
  if (!f.shadow && !f.outline) once(0, 0, color);
}

/** OutputDevice::ImplDrawTextLines: underline below, overline above the ascent, strikeout through. */
function TextLines(ctx: CanvasRenderingContext2D, f: SwFont, x: number, y: number, w: number, color: string): void {
  const over = f.overline ?? 'none';
  if (f.underline === 'none' && over === 'none' && !f.strike) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(8, f.size / 16);
  const line = (yy: number) => { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); };
  const styled = (style: FontLineStyle, yy: number, dir: number) => {
    if (style === 'none') return;
    ctx.setLineDash(style === 'dotted' ? [ctx.lineWidth, ctx.lineWidth * 2] : style === 'dash' ? [ctx.lineWidth * 4, ctx.lineWidth * 3] : []);
    line(yy);
    if (style === 'double') line(yy + dir * ctx.lineWidth * 2);
    ctx.setLineDash([]);
  };
  styled(f.underline, y + f.size * 0.12, 1);
  // mnAboveUnderlineOffset: the ascent less half the internal leading.
  styled(over, y - f.size * 0.83, -1);
  if (f.strike) line(y - f.size * 0.28);
}

// swfont.hxx and inftxt.cxx: the characters that show formatting marks.
const CH_PAR = '\u00B6', CH_BULLET = '\u00B7', CHAR_TAB = '\u2192', CHAR_LINEBREAK = '\u21B5';

/** SwTextPaintInfo::DrawSpecial and SwHolePortion: formatting marks of one line. */
function paintControlCodes(ctx: CanvasRenderingContext2D, text: string, frame: SwTextFrame, line: SwLineLayout, baseline: number, color: string, isLast: boolean): void {
  ctx.fillStyle = color;
  ctx.wordSpacing = '0px';
  let lastFont = line.portions[line.portions.length - 1]?.font;
  for (const p of line.portions) {
    lastFont = p.font;
    let spaces = 0;
    if (line.nSpaceAdd) for (let i = line.nStart; i < p.nStart; i++) if (text[i] === ' ') spaces++;
    const x = frame.nLeft + line.nX + p.nX + spaces * line.nSpaceAdd;
    setFont(ctx, { ...p.font, bold: false, italic: false });
    if (p.kind === 'tab') {
      // lcl_DrawSpecial: the arrow is centred and clipped to the tab's width.
      const w = ctx.measureText(CHAR_TAB).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, baseline - p.font.size * 2, p.nWidth, p.font.size * 3);
      ctx.clip();
      ctx.fillText(CHAR_TAB, x + (p.nWidth - w) / 2, baseline);
      ctx.restore();
    } else if (p.kind === 'break') ctx.fillText(CHAR_LINEBREAK, x, baseline);
    else if (p.kind === 'text') {
      // A centred dot in the middle of every space, including justification's extra width.
      const f = p.font;
      let cx = x;
      for (let i = p.nStart; i < p.nStart + p.nLen; i++) {
        const ch = text[i]!;
        // Small capitals: a lower case letter is measured in the smaller font.
        const b = CapitalBlocks(ch, f)[0];
        if (b && b.font !== f) setFont(ctx, { ...b.font, bold: false, italic: false });
        const w = ctx.measureText(b?.text ?? displayText(ch, f)).width + (ch === ' ' ? line.nSpaceAdd : 0);
        if (b && b.font !== f) setFont(ctx, { ...f, bold: false, italic: false });
        if (ch === ' ' || ch === '\u00a0') {
          const dw = ctx.measureText(CH_BULLET).width;
          ctx.fillText(CH_BULLET, cx + (w - dw) / 2, baseline);
        }
        cx += w;
      }
    }
  }
  if (isLast && lastFont) {
    setFont(ctx, { ...lastFont, bold: false, italic: false });
    const end = line.portions.length ? line.portions[line.portions.length - 1]! : null;
    let spaces = 0;
    if (line.nSpaceAdd) for (let i = line.nStart; i < line.nStart + line.nLen; i++) if (text[i] === ' ') spaces++;
    const x = frame.nLeft + line.nX + (end ? end.nX + end.nWidth : 0) + spaces * line.nSpaceAdd;
    ctx.fillText(CH_PAR, x, baseline);
  }
}

export function PaintFrame(ctx: CanvasRenderingContext2D, frame: SwTextFrame, o: PaintOptions): void {
  const text = frame.node.GetText();
  const b = frame.pBorder;
  if (b) {
    const r = b.rect;
    if (b.background) { ctx.fillStyle = b.background; ctx.fillRect(r.Left(), r.Top(), r.Width(), r.Height()); }
    // SwBorderAttrs / PaintBorder: lines inside the paragraph area.
    const box = b.box;
    const line = (l: { color: string; width: number } | null, x: number, y: number, w: number, h: number) => { if (l) { ctx.fillStyle = l.color; ctx.fillRect(x, y, w, h); } };
    if (box) {
      if (b.top) line(box.top, r.Left(), r.Top(), r.Width(), box.top?.width ?? 0);
      if (b.bottom) line(box.bottom, r.Left(), r.Top() + r.Height() - (box.bottom?.width ?? 0), r.Width(), box.bottom?.width ?? 0);
      line(box.left, r.Left(), r.Top(), box.left?.width ?? 0, r.Height());
      line(box.right, r.Left() + r.Width() - (box.right?.width ?? 0), r.Top(), box.right?.width ?? 0, r.Height());
    }
  }
  let top = frame.nTop;
  for (const line of frame.lines) {
    const baseline = top + (line.nRealHeight - line.nHeight) + line.nAscent;
    for (const p of line.portions) {
      let spaces = 0;
      if (line.nSpaceAdd) for (let i = line.nStart; i < p.nStart; i++) if (text[i] === ' ') spaces++;
      paintPortion(ctx, text, p, frame.nLeft + line.nX + p.nX + spaces * line.nSpaceAdd, baseline, line.nSpaceAdd, top, line.nRealHeight, o);
    }
    if (o.controlCodes) paintControlCodes(ctx, text, frame, line, baseline, o.controlCodes, line === frame.lines[frame.lines.length - 1] && !frame.bHasFollow);
    // SwTextPainter::PaintMultiPortion's change bar (SwRedlineItr, "mark changed lines" in the left margin).
    const isLast = line === frame.lines[frame.lines.length - 1] && !frame.bHasFollow;
    if (line.portions.some((p) => p.font.redline) || (isLast && frame.node.m_aSet.RES_PARATR_REDLINE)) {
      ctx.fillStyle = CHANGE_BAR;
      ctx.fillRect(frame.nLeft - CHANGE_BAR_DIST, top, CHANGE_BAR_WIDTH, line.nRealHeight);
    }
    top += line.nRealHeight;
  }
}

/**
 * SwTabFramePainter, reduced: each cell paints its background, then borders are drawn centred on
 * the cell edges, so that the borders of neighbouring cells coincide (collapsing border model).
 */
export function PaintTab(ctx: CanvasRenderingContext2D, tab: SwTabFrame, o: PaintOptions): void {
  const cells = tab.rows.flatMap((r) => r.cells);
  for (const c of cells) {
    const bg = c.box.m_aAttrs.background;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(c.aFrame.Left(), c.aFrame.Top(), c.aFrame.Width(), c.aFrame.Height()); }
  }
  for (const c of cells) {
    // Vertical text: the content painted through the cell's rotation.
    if (c.aVert) { ctx.save(); ctx.transform(...c.aVert); }
    for (const f of c.frames) if (f.pCell === c) PaintFrame(ctx, f, o);
    for (const t of c.tabs) PaintTab(ctx, t, o);
    if (c.aVert) ctx.restore();
  }
  for (const c of cells) paintCellBorders(ctx, c, o.bounds);
}

function paintCellBorders(ctx: CanvasRenderingContext2D, c: SwCellFrame, showBounds: string | null): void {
  const r = c.aFrame, b = c.box.m_aAttrs.box;
  const x0 = r.Left(), y0 = r.Top(), x1 = r.Left() + r.Width(), y1 = r.Top() + r.Height();
  const edge = (line: { color: string; width: number } | null, ax: number, ay: number, bx: number, by: number) => {
    if (line) { ctx.strokeStyle = line.color; ctx.lineWidth = Math.max(line.width, 1); }
    else if (showBounds) { ctx.strokeStyle = showBounds; ctx.lineWidth = 6; } // "Table Boundaries" for borderless cells
    else return;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  };
  edge(b.top, x0, y0, x1, y0);
  edge(b.bottom, x0, y1, x1, y1);
  edge(b.left, x0, y0, x0, y1);
  edge(b.right, x1, y0, x1, y1);
}

export function PaintPage(ctx: CanvasRenderingContext2D, page: SwPageFrame, c: PaintColors, showMargins: boolean, graphic?: PaintOptions['graphic']): void {
  const r = page.aFrame;
  ctx.fillStyle = c.pageEdge;
  ctx.fillRect(r.Left() - 8, r.Top() - 8, r.Width() + 16, r.Height() + 16);
  ctx.fillStyle = c.page;
  ctx.fillRect(r.Left(), r.Top(), r.Width(), r.Height());
  if (showMargins) {
    const p = page.aPrt;
    ctx.strokeStyle = c.margin;
    ctx.lineWidth = 6;
    ctx.strokeRect(p.Left(), p.Top(), p.Width(), p.Height());
  }
  PaintPageContent(ctx, page, { autoColor: c.text, fieldShading: c.field, bounds: showMargins ? c.margin : null, graphic, controlCodes: c.controlCodes, commentColor: c.comment });
}

/**
 * SwNoTextFrame::PaintPicture with SwCropGrf: the whole graphic is scaled so that its uncropped
 * part fills the frame, and clipped to the frame.
 */
function DrawGraphic(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, crop: SwCropGrf | undefined): void {
  if (!crop) { ctx.drawImage(img, x, y, w, h); return; }
  const fw = w / Math.max(1e-6, 1 - crop.left - crop.right), fh = h / Math.max(1e-6, 1 - crop.top - crop.bottom);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x - crop.left * fw, y - crop.top * fh, fw, fh);
  ctx.restore();
}

/** The sub-paths of a shape at a size, cached per shape (formats are replaced, never changed). */
const shapeCache = new WeakMap<SdrShape, { w: number; h: number; objs: SdrPathObj[] }>();
export function ShapePaths(shape: SdrShape, w: number, h: number): SdrPathObj[] {
  const hit = shapeCache.get(shape);
  if (hit && hit.w === w && hit.h === h) return hit.objs;
  const preset = GetCustomShapeContent(shape.m_sType);
  // The type decides the shading (EnhancedCustomShapeTypeNames::Get), also for a shape's own path.
  const geom = shape.m_aGeometry ? { ...shape.m_aGeometry, mso: preset?.mso } : preset ?? GetCustomShapeContent('rectangle')!;
  const objs = new EnhancedCustomShape2d(shape.m_sType, geom, w, h, !!shape.m_aFill, !!shape.m_aLine, shape.m_aAdjust).CreatePathObj();
  shapeCache.set(shape, { w, h, objs });
  return objs;
}

/** EnhancedCustomShape2d::GetColorData, LibreOffice's way: blend towards white or black. */
function ShadeColor(color: string, dBrightness: number): string {
  if (!dBrightness) return color;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  const ch = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16)).map((c) => Math.round(Math.min(255, Math.max(0, dBrightness >= 0 ? c * (1 - dBrightness) + dBrightness * 255 : c * (1 + dBrightness)))));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** EnhancedCustomShape2d::GetColorData, the OpenOffice way: a luminance change in HSV. */
function LuminanceColor(color: string, nLuminance: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  let s = max ? d / max : 0, v = max;
  const f = nLuminance / 100;
  if (f > 0) { s *= 1 - f; v = f + (1 - f) * v; } else v *= 1 + f;
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m0 = v - c;
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return `#${[r1, g1, b1].map((u) => Math.round(Math.min(1, Math.max(0, u + m0)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * SdrObjCustomShape painting: the sub-paths of the shape's geometry, mirrored and rotated around
 * its centre, filled (even-odd) and stroked. Points are transformed here, so that any canvas-like
 * context (the PDF writer too) only needs moveTo, lineTo, bezierCurveTo, closePath, fill and stroke.
 */
export function PaintShape(ctx: CanvasRenderingContext2D, shape: SdrShape, left: number, top: number, w: number, h: number): void {
  const objs = ShapePaths(shape, w, h);
  const rad = ((shape.m_nRotate ?? 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const tf = (x: number, y: number): [number, number] => {
    if (shape.m_bFlipH) x = w - x;
    if (shape.m_bFlipV) y = h - y;
    const dx = x - w / 2, dy = y - h / 2;
    return [left + w / 2 + dx * cos - dy * sin, top + h / 2 + dx * sin + dy * cos];
  };
  for (const o of objs) {
    ctx.beginPath();
    for (const poly of o.polys) {
      const pts = poly.pts;
      if (!pts.length) continue;
      ctx.moveTo(...tf(pts[0]!.x, pts[0]!.y));
      const seg = (a: (typeof pts)[number], b: (typeof pts)[number]) => {
        if (a.next || b.prev) ctx.bezierCurveTo(...tf(...(a.next ?? [a.x, a.y])), ...tf(...(b.prev ?? [b.x, b.y])), ...tf(b.x, b.y));
        else ctx.lineTo(...tf(b.x, b.y));
      };
      for (let k = 1; k < pts.length; k++) seg(pts[k - 1]!, pts[k]!);
      if (poly.closed) { seg(pts[pts.length - 1]!, pts[0]!); ctx.closePath(); }
    }
    if (o.fill && shape.m_aFill && shape.m_aGradient) {
      // FillGradientPrimitive2D: the solid steps, clipped to the part.
      ctx.save();
      ctx.clip('evenodd');
      for (const step of createGradientSteps(shape.m_aGradient, w, h)) {
        ctx.beginPath();
        const pts = step.poly.pts;
        ctx.moveTo(...tf(pts[0]!.x, pts[0]!.y));
        for (let k = 1; k <= pts.length; k++) {
          const a = pts[k - 1]!, b = pts[k % pts.length]!;
          if (a.next || b.prev) ctx.bezierCurveTo(...tf(...(a.next ?? [a.x, a.y])), ...tf(...(b.prev ?? [b.x, b.y])), ...tf(b.x, b.y));
          else ctx.lineTo(...tf(b.x, b.y));
        }
        ctx.closePath();
        ctx.fillStyle = ShadeColor(step.color, o.brightness);
        ctx.fill();
      }
      ctx.restore();
    } else if (o.fill && shape.m_aFill) { ctx.fillStyle = o.luminance ? LuminanceColor(shape.m_aFill, o.luminance) : ShadeColor(shape.m_aFill, o.brightness); ctx.fill('evenodd'); }
    if (o.stroke && shape.m_aLine) {
      ctx.strokeStyle = shape.m_aLine.color;
      // A hairline is one device pixel wide at any zoom.
      ctx.lineWidth = shape.m_aLine.width || 1 / Math.max(1e-6, Math.hypot(ctx.getTransform?.().a ?? 1, ctx.getTransform?.().b ?? 0));
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }
}

/** SwFlyFrame::PaintSwFrame: background, border, then the graphic or the frame's text. */
export function PaintFly(ctx: CanvasRenderingContext2D, fly: SwFlyFrame, o: PaintOptions): void {
  const r = fly.aFrame, fmt = fly.fmt;
  if (fmt.m_pShape) PaintShape(ctx, fmt.m_pShape, r.Left(), r.Top(), r.Width(), r.Height());
  if (fmt.m_aBackground) { ctx.fillStyle = fmt.m_aBackground; ctx.fillRect(r.Left(), r.Top(), r.Width(), r.Height()); }
  if (fmt.graphic !== undefined) {
    const img = o.graphic?.(fmt.graphic);
    if (img) DrawGraphic(ctx, img, r.Left(), r.Top(), r.Width(), r.Height(), fmt.crop);
    else { ctx.fillStyle = '#e9ecef'; ctx.fillRect(r.Left(), r.Top(), r.Width(), r.Height()); }
  }
  const box = fmt.m_aBox;
  if (box) {
    const line = (l: { color: string; width: number } | null, x: number, y: number, w: number, h: number) => { if (l) { ctx.fillStyle = l.color; ctx.fillRect(x, y, w, h); } };
    line(box.top, r.Left(), r.Top(), r.Width(), box.top?.width ?? 0);
    line(box.bottom, r.Left(), r.Top() + r.Height() - (box.bottom?.width ?? 0), r.Width(), box.bottom?.width ?? 0);
    line(box.left, r.Left(), r.Top(), box.left?.width ?? 0, r.Height());
    line(box.right, r.Left() + r.Width() - (box.right?.width ?? 0), r.Top(), box.right?.width ?? 0, r.Height());
  } else if (o.bounds && fmt.m_sContentId !== undefined) {
    // View > Text Boundaries for a frame without border.
    ctx.strokeStyle = o.bounds; ctx.lineWidth = 6; ctx.strokeRect(r.Left(), r.Top(), r.Width(), r.Height());
  }
  if (fly.frames.length || fly.tabs.length) {
    ctx.save();
    ctx.beginPath(); ctx.rect(r.Left(), r.Top(), r.Width(), r.Height()); ctx.clip();
    for (const f of fly.frames) if (!f.pCell) PaintFrame(ctx, f, o);
    for (const t of fly.tabs) PaintTab(ctx, t, o);
    ctx.restore();
  }
}

/** The page's text and tables, without page background and decorations (also used for printing). */
export function PaintPageContent(ctx: CanvasRenderingContext2D, page: SwPageFrame, o: PaintOptions): void {
  // Objects "in background" go below the text (SwViewShellImp::PaintLayer of the hell layer).
  for (const f of page.flys) if (!f.fmt.m_bOpaque) PaintFly(ctx, f, o);
  // SwLayoutFrame::PaintColLines: separator lines between columns.
  ctx.fillStyle = '#000000';
  for (const l of page.colLines) ctx.fillRect(l.Left(), l.Top(), l.Width(), l.Height());
  // SwFootnoteContFrame::PaintLine: the footnote separator.
  const sep = page.aFootnoteSep;
  if (sep) { ctx.fillStyle = '#000000'; ctx.fillRect(sep.Left(), sep.Top(), sep.Width(), sep.Height()); }
  for (const f of page.frames) if (!f.pCell && f.pArea !== 'fly') PaintFrame(ctx, f, o);
  for (const t of page.tabs) PaintTab(ctx, t, o);
  for (const f of page.flys) if (f.fmt.m_bOpaque) PaintFly(ctx, f, o);
}

/** Paints the visible part of the document. The canvas only ever covers the viewport. */
/** Size of an object's selection handles, in CSS pixels (SdrHdl). */
export const HANDLE_PX = 7;

/** The eight handles of a selected object: corners and edge centres, clockwise from the top left. */
export function FlyHandles(r: { Left(): number; Top(): number; Width(): number; Height(): number }): [number, number][] {
  const l = r.Left(), t = r.Top(), w = r.Width(), h = r.Height();
  return [[l, t], [l + w / 2, t], [l + w, t], [l + w, t + h / 2], [l + w, t + h], [l + w / 2, t + h], [l, t + h], [l, t + h / 2]];
}

export function PaintView(ctx: CanvasRenderingContext2D, sh: SwWrtShell, v: PaintView, c: PaintColors, caretOn: boolean, graphic?: PaintOptions['graphic'],
  flyDrag?: { Left(): number; Top(): number; Width(): number; Height(): number } | null): void {
  const s = pxScale(v);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = c.desk;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(s, 0, 0, s, -v.scrollX * s, -v.scrollY * s);
  ctx.textBaseline = 'alphabetic';
  ctx.textRendering = 'geometricPrecision';
  ctx.fontKerning = 'normal';

  const top = v.scrollY, bottom = v.scrollY + (v.height * v.dpr) / s;
  for (const page of sh.m_pRoot.pages) {
    if (page.aFrame.Top() + page.aFrame.Height() < top || page.aFrame.Top() > bottom) continue;
    PaintPage(ctx, page, c, true, graphic);
  }

  // SwPostItMgr: a dashed line from each comment anchor to the sidebar.
  if (c.comment) {
    ctx.strokeStyle = c.commentLine;
    ctx.lineWidth = v.dpr / s;
    ctx.setLineDash([4 * v.dpr / s, 3 * v.dpr / s]);
    for (const a of sh.m_pRoot.m_aAnnotationAnchors) {
      if (a.y < top || a.y > bottom) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + a.h); ctx.lineTo(a.page.aFrame.Right(), a.y + a.h); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // SwWrongList painting (SwTextPaintInfo::DrawWrongText): a red wave under misspelled words.
  if (sh.m_bOnlineSpell && sh.m_pSpell) {
    const px = v.dpr / s;
    ctx.strokeStyle = c.wrong;
    ctx.lineWidth = px;
    for (const page of sh.m_pRoot.pages) {
      if (page.aFrame.Top() + page.aFrame.Height() < top || page.aFrame.Top() > bottom) continue;
      const seen = new Set<SwTextFrame['node']>();
      for (const f of page.frames) {
        if (seen.has(f.node)) continue;
        seen.add(f.node);
        for (const w of sh.GetWrongList(f.node)) {
          for (const r of sh.m_pRoot.GetRangeRects(f.node, w.nStart, w.nEnd)) {
            if (r.page !== page || r.w <= 0) continue;
            const y = r.baseline + 2.5 * px, amp = 1.5 * px, step = 2 * px;
            ctx.beginPath();
            for (let x = r.x, i = 0; x <= r.x + r.w; x += step, i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, x, y + (i % 2 ? amp : -amp));
            ctx.stroke();
          }
        }
      }
    }
  }

  ctx.fillStyle = c.selection;
  for (const r of sh.GetSelectionRects()) {
    if (r.y + r.h < top || r.y > bottom) continue;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // SwFEShell's frame selection: an outline with eight handles; while dragging, the new outline.
  const sel = sh.IsFrameSelected() ? sh.GetFlyRect() : null;
  if (sel) {
    const px = v.dpr / s;
    ctx.strokeStyle = c.handle;
    ctx.lineWidth = px;
    ctx.strokeRect(sel.Left(), sel.Top(), sel.Width(), sel.Height());
    const hs = HANDLE_PX * px;
    for (const [hx, hy] of FlyHandles(sel)) {
      ctx.fillStyle = c.handle;
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.fillStyle = c.page;
      ctx.fillRect(hx - hs / 2 + px, hy - hs / 2 + px, hs - 2 * px, hs - 2 * px);
    }
    if (flyDrag) {
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(flyDrag.Left(), flyDrag.Top(), flyDrag.Width(), flyDrag.Height());
      ctx.setLineDash([]);
    }
  } else if (flyDrag) {
    // SdrCreateView: the outline of the shape being drawn.
    const px = v.dpr / s;
    ctx.strokeStyle = c.handle;
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.strokeRect(flyDrag.Left(), flyDrag.Top(), flyDrag.Width(), flyDrag.Height());
    ctx.setLineDash([]);
  }

  if (caretOn && !sh.HasSelection() && !sel) {
    const r = sh.GetCharRect();
    if (r) {
      ctx.fillStyle = c.caret;
      // Keep the caret visually about one CSS pixel wide at every zoom level.
      ctx.fillRect(r.Left(), r.Top(), v.dpr / s, r.Height());
    }
  }
}
