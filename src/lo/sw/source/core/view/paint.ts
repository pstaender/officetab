// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/layout/paintfrm.cxx reduced
// @upstream sw/source/core/text/itrpaint.cxx reduced
// @upstream sw/source/core/crsr/viscrs.cxx reduced
import { cssFont } from '../../../../vcl/source/outdev/text.ts';
import { displayText, type SwLineLayout, type SwLinePortion } from '../text/itrform2.ts';
import type { SwCellFrame, SwFlyFrame, SwPageFrame, SwTabFrame, SwTextFrame } from '../layout/pagechg.ts';
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

export interface PaintColors {
  desk: string; page: string; pageEdge: string; text: string; selection: string; caret: string; margin: string; field: string;
  controlCodes: string | null;
  /** Comment highlight and anchor line colour, or null when comments are hidden. */
  comment: string | null;
  commentLine: string;
  /** Selection handles of objects. */
  handle: string;
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
    ctx.font = cssFont(f);
    ctx.wordSpacing = '0px';
    const w = ctx.measureText(p.aFill).width;
    if (w > 0) {
      const n = Math.floor(p.nWidth / w);
      ctx.fillText(p.aFill.repeat(Math.max(0, n)), x + p.nWidth - n * w, baseline);
    }
    return;
  }
  if (p.kind === 'fly' && p.pFly) {
    const img = o.graphic?.(p.pFly.graphic);
    const top = baseline - p.pFly.height;
    if (img) ctx.drawImage(img, x, top, p.pFly.width, p.pFly.height);
    else { ctx.fillStyle = '#e9ecef'; ctx.fillRect(x, top, p.pFly.width, p.pFly.height); }
    return;
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
    ctx.font = cssFont({ ...p.font, bold: false, italic: false });
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
        const w = ctx.measureText(displayText(ch, f)).width + (ch === ' ' ? line.nSpaceAdd : 0);
        if (ch === ' ' || ch === '\u00a0') {
          const dw = ctx.measureText(CH_BULLET).width;
          ctx.fillText(CH_BULLET, cx + (w - dw) / 2, baseline);
        }
        cx += w;
      }
    }
  }
  if (isLast && lastFont) {
    ctx.font = cssFont({ ...lastFont, bold: false, italic: false });
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

/** SwFlyFrame::PaintSwFrame: background, border, then the graphic or the frame's text. */
export function PaintFly(ctx: CanvasRenderingContext2D, fly: SwFlyFrame, o: PaintOptions): void {
  const r = fly.aFrame, fmt = fly.fmt;
  if (fmt.m_aBackground) { ctx.fillStyle = fmt.m_aBackground; ctx.fillRect(r.Left(), r.Top(), r.Width(), r.Height()); }
  if (fmt.graphic !== undefined) {
    const img = o.graphic?.(fmt.graphic);
    if (img) ctx.drawImage(img, r.Left(), r.Top(), r.Width(), r.Height());
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
