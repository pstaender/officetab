// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/layout/paintfrm.cxx reduced
// @upstream sw/source/core/text/itrpaint.cxx reduced
// @upstream sw/source/core/crsr/viscrs.cxx reduced
import { cssFont } from '../../../../vcl/source/outdev/text.ts';
import { displayText, type SwLinePortion } from '../text/itrform2.ts';
import type { SwCellFrame, SwPageFrame, SwTabFrame, SwTextFrame } from '../layout/pagechg.ts';
import type { SwWrtShell } from '../../uibase/wrtsh/wrtsh.ts';

export const TWIPS_PER_CSS_PX = 15;

export interface PaintView {
  scrollX: number; // twips
  scrollY: number; // twips
  zoom: number; // 1 = 100%
  dpr: number;
  width: number; // CSS px
  height: number; // CSS px
}

export interface PaintColors { desk: string; page: string; pageEdge: string; text: string; selection: string; caret: string; margin: string; field: string }

/** What content painting needs: automatic text colour and the screen-only decorations, or null when printing. */
export interface PaintOptions { autoColor: string; fieldShading: string | null; bounds: string | null }

export const pxScale = (v: PaintView): number => (v.zoom * v.dpr) / TWIPS_PER_CSS_PX;

function paintPortion(ctx: CanvasRenderingContext2D, text: string, p: SwLinePortion, x: number, baseline: number, spaceAdd: number, lineTop: number, lineHeight: number, o: PaintOptions): void {
  const autoColor = o.autoColor;
  const f = p.font;
  const slice = text.slice(p.nStart, p.nStart + p.nLen);
  let extra = 0;
  if (spaceAdd) for (const c of slice) if (c === ' ') extra += spaceAdd;
  if (f.background && p.kind === 'text') {
    ctx.fillStyle = f.background;
    ctx.fillRect(x, lineTop, p.nWidth + extra, lineHeight);
  }
  if (p.kind === 'field') {
    // Field shadings (View > Field Shadings) are a screen aid only.
    if (o.fieldShading && !f.background) { ctx.fillStyle = o.fieldShading; ctx.fillRect(x, lineTop, p.nWidth, lineHeight); }
    ctx.fillStyle = f.color ?? autoColor;
    ctx.font = cssFont(f);
    ctx.wordSpacing = '0px';
    ctx.fillText(displayText(p.aExpand ?? '', f), x, baseline - f.rise);
    return;
  }
  if (p.kind === 'number' && p.aExpand) {
    ctx.fillStyle = f.color ?? autoColor;
    ctx.font = cssFont(f);
    ctx.wordSpacing = '0px';
    ctx.fillText(p.aExpand, x + (p.nLabelX ?? 0), baseline);
    return;
  }
  if (p.kind !== 'text') return;
  const color = f.color ?? autoColor;
  const y = baseline - f.rise;
  ctx.fillStyle = color;
  ctx.font = cssFont(f);
  ctx.wordSpacing = spaceAdd ? `${spaceAdd}px` : '0px';
  ctx.fillText(displayText(slice, f), x, y);
  if (f.underline !== 'none' || f.strike) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(8, f.size / 16);
    const w = p.nWidth + extra;
    const line = (yy: number) => { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); };
    if (f.underline !== 'none') {
      const uy = y + f.size * 0.12;
      ctx.setLineDash(f.underline === 'dotted' ? [ctx.lineWidth, ctx.lineWidth * 2] : f.underline === 'dash' ? [ctx.lineWidth * 4, ctx.lineWidth * 3] : []);
      line(uy);
      if (f.underline === 'double') line(uy + ctx.lineWidth * 2);
      ctx.setLineDash([]);
    }
    if (f.strike) line(y - f.size * 0.28);
  }
}

export function PaintFrame(ctx: CanvasRenderingContext2D, frame: SwTextFrame, o: PaintOptions): void {
  const text = frame.node.GetText();
  const bg = frame.node.GetAttr('RES_BACKGROUND');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(frame.nLeft, frame.nTop, frame.nWidth, frame.nHeight); }
  let top = frame.nTop;
  for (const line of frame.lines) {
    const baseline = top + (line.nRealHeight - line.nHeight) + line.nAscent;
    for (const p of line.portions) {
      let spaces = 0;
      if (line.nSpaceAdd) for (let i = line.nStart; i < p.nStart; i++) if (text[i] === ' ') spaces++;
      paintPortion(ctx, text, p, frame.nLeft + line.nX + p.nX + spaces * line.nSpaceAdd, baseline, line.nSpaceAdd, top, line.nRealHeight, o);
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
    for (const f of c.frames) if (f.pCell === c) PaintFrame(ctx, f, o);
    for (const t of c.tabs) PaintTab(ctx, t, o);
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

export function PaintPage(ctx: CanvasRenderingContext2D, page: SwPageFrame, c: PaintColors, showMargins: boolean): void {
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
  PaintPageContent(ctx, page, { autoColor: c.text, fieldShading: c.field, bounds: showMargins ? c.margin : null });
}

/** The page's text and tables, without page background and decorations (also used for printing). */
export function PaintPageContent(ctx: CanvasRenderingContext2D, page: SwPageFrame, o: PaintOptions): void {
  for (const f of page.frames) if (!f.pCell) PaintFrame(ctx, f, o);
  for (const t of page.tabs) PaintTab(ctx, t, o);
}

/** Paints the visible part of the document. The canvas only ever covers the viewport. */
export function PaintView(ctx: CanvasRenderingContext2D, sh: SwWrtShell, v: PaintView, c: PaintColors, caretOn: boolean): void {
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
    PaintPage(ctx, page, c, true);
  }

  ctx.fillStyle = c.selection;
  for (const r of sh.GetSelectionRects()) {
    if (r.y + r.h < top || r.y > bottom) continue;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  if (caretOn && !sh.HasSelection()) {
    const r = sh.GetCharRect();
    if (r) {
      ctx.fillStyle = c.caret;
      // Keep the caret visually about one CSS pixel wide at every zoom level.
      ctx.fillRect(r.Left(), r.Top(), v.dpr / s, r.Height());
    }
  }
}
