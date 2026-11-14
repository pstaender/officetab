// The horizontal and vertical rulers above and beside the document (SwView's m_pHRuler and
// m_pVRuler): canvases painted by the SvxRuler port, fed with SwView::StateTabWin's items on every
// paint of the document, whose drags go to SwView::ExecTabWin.
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Ruler, RULER_UNIT_CM, RULER_UNIT_INCH, WB_HORZ, type RenderContext, type RulerColors } from '@lo/svtools/source/control/ruler.ts';
import { KEY_MOD1, KEY_MOD2, KEY_SHIFT, SvxRuler, type SvxRulerRequest } from '@lo/svx/source/dialog/svxruler.ts';
import { ExecTabWin, StateTabWin } from '@lo/sw/source/uibase/uiview/viewtab.ts';
import { TWIPS_PER_CSS_PX, type PaintView } from '@lo/sw/source/core/view/paint.ts';
import { SwRect } from '@lo/sw/inc/swrect.ts';
import type { Controller } from '../controller.ts';

const RULER_FONT = '9px system-ui, sans-serif';

/** StyleSettings and ColorConfig colours of the light and the dark scheme. */
const rulerColors = (dark: boolean): RulerColors => dark
  ? { shadow: '#8a8f98', darkShadow: '#e6e6e6', light: '#3a3d42', face: '#3a3d42', window: '#1b1c1f', dialog: '#2b2d31', workspace: '#2b2d31', appBackground: '#202226', checked: '#3d5a80' }
  : { shadow: '#8c8c8c', darkShadow: '#1f1f1f', light: '#ffffff', face: '#dcdcdc', window: '#ffffff', dialog: '#e8eaed', workspace: '#ffffff', appBackground: '#e9ecef', checked: '#c7d7f0' };

/** vcl's RenderContext on a canvas, in CSS pixels; rectangles and lines include their end points. */
function CanvasRenderContext(ctx: CanvasRenderingContext2D): RenderContext {
  let line: string | null = null, fill: string | null = null;
  ctx.font = RULER_FONT;
  const height = (() => { const m = ctx.measureText('0123456789'); return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; })();
  return {
    SetLineColor: (c) => { line = c; },
    SetFillColor: (c) => { fill = c; },
    DrawLine: (x1, y1, x2, y2) => {
      if (!line) return;
      ctx.fillStyle = line;
      if (x1 === x2 || y1 === y2) ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1);
      else { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1 + 0.5, y1 + 0.5); ctx.lineTo(x2 + 0.5, y2 + 0.5); ctx.stroke(); }
    },
    DrawRect: (x1, y1, x2, y2) => {
      const l = Math.min(x1, x2), t = Math.min(y1, y2), w = Math.abs(x2 - x1) + 1, h = Math.abs(y2 - y1) + 1;
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(l, t, w, h); }
      if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.strokeRect(l + 0.5, t + 0.5, w - 1, h - 1); }
    },
    DrawPolygon: (pts) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 0.5, y + 0.5) : ctx.moveTo(x + 0.5, y + 0.5)));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke(); }
    },
    DrawTextCentered: (x, y, s, vertical) => {
      ctx.save();
      ctx.fillStyle = rulerTextColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(x + 0.5, y + 0.5);
      if (vertical) ctx.rotate(-Math.PI / 2);
      ctx.fillText(s, 0, 0);
      ctx.restore();
    },
    GetTextWidth: (s) => ctx.measureText(s).width,
    GetTextHeight: () => height,
  };
}
/** The ruler's text colour (ApplyControlForeground: the dark shadow colour), set per paint. */
let rulerTextColor = '#1f1f1f';

/** The modifier keys as vcl's (KEY_MOD1 is Cmd on macOS, Ctrl elsewhere; KEY_MOD2 is Alt). */
const modifier = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) =>
  (e.shiftKey ? KEY_SHIFT : 0) | (e.ctrlKey || e.metaKey ? KEY_MOD1 : 0) | (e.altKey ? KEY_MOD2 : 0);

export interface RulersHandle {
  /** Updates the rulers from the view and paints them. */
  paint(v: PaintView): void;
  /** The ruler's drag line (SvxRuler::DrawLine_Impl) in document coordinates, or null. */
  trackLine(v: PaintView): SwRect | null;
}

/**
 * The rulers of the edit window. `repaint` paints the document again (for the drag line),
 * `edited` follows a change the rulers made.
 */
export function useRulers(c: Controller, repaint: () => void, edited: () => void): { handle: RulersHandle; elements: React.ReactNode; top: number; left: number } {
  const hRef = useRef<HTMLCanvasElement>(null);
  const vRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<PaintView | null>(null);
  const line = useRef<{ pos: number; horz: boolean } | null>(null);
  const rulers = useRef<{ h: SvxRuler; v: SvxRuler } | null>(null);
  const size = useRef(0);

  const opt = c.viewOpt;
  const bH = opt.IsViewHRuler(), bV = opt.IsViewVRuler();
  if (!size.current) {
    const ctx = document.createElement('canvas').getContext('2d');
    size.current = ctx ? Ruler.GetDefaultSize(CanvasRenderContext(ctx), WB_HORZ) : 23;
  }

  const dispatch = (r: SvxRulerRequest) => { ExecTabWin(c.sh, r); edited(); };
  if (!rulers.current) {
    const editWin = (horz: boolean) => ({
      LogicToPixelX: (n: number) => (view.current ? Math.round(((n - view.current.scrollX) * view.current.zoom) / TWIPS_PER_CSS_PX) : 0),
      LogicToPixelY: (n: number) => (view.current ? Math.round(((n - view.current.scrollY) * view.current.zoom) / TWIPS_PER_CSS_PX) : 0),
      GetZoom: () => c.zoom,
      ShowTrackLine: (pos: number | null) => { line.current = pos === null ? null : { pos, horz }; repaint(); },
    });
    rulers.current = { h: new SvxRuler(true, editWin(true), dispatch), v: new SvxRuler(false, editWin(false), dispatch) };
    // The measurement system of the locale (as SwModule's default metric).
    const unit = /^en-(US|LR|MM)$/.test(navigator.language) ? RULER_UNIT_INCH : RULER_UNIT_CM;
    rulers.current.h.SetUnit(unit);
    rulers.current.v.SetUnit(unit);
  }

  const paintOne = (canvas: HTMLCanvasElement | null, r: SvxRuler) => {
    if (!canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    r.SetOutputSizePixel(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = rulerColors(matchMedia('(prefers-color-scheme: dark)').matches);
    rulerTextColor = colors.darkShadow;
    r.Paint(CanvasRenderContext(ctx), colors);
  };

  const handle: RulersHandle = {
    paint(v) {
      view.current = v;
      const { h, v: vr } = rulers.current!;
      const state = StateTabWin(c.sh);
      const left = vRef.current ? size.current : 0;
      if (state) {
        // SwView::StateTabWin's items, and the edit window's offset in each ruler (SvxRuler::UpdatePage).
        h.SetWinPos(left);
        h.SetZoom(v.zoom);
        h.Update({ aPagePos: state.aPagePosSize, aLRSpace: state.aLongLR, bMarginsSizeable: state.bPageMargins, aParaItem: state.aParaLR, aTabStopItem: state.aTabStops, nDefTabDist: state.nDefTabDist, bTextRTL: state.bTextRTL });
        vr.SetWinPos(0);
        vr.SetZoom(v.zoom);
        vr.Update({ aPagePos: state.aPagePosSize, aLRSpace: state.aLongUL, bMarginsSizeable: state.bPageMargins, aParaItem: null, aTabStopItem: null, nDefTabDist: state.nDefTabDist, bTextRTL: false });
      }
      paintOne(hRef.current, h);
      paintOne(vRef.current, vr);
    },
    trackLine(v) {
      const l = line.current;
      if (!l) return null;
      const f = TWIPS_PER_CSS_PX / v.zoom;
      return l.horz ? new SwRect(l.pos, v.scrollY, 0, v.height * f) : new SwRect(v.scrollX, l.pos, v.width * f, 0);
    },
  };

  const events = (which: 'h' | 'v') => {
    const r = () => rulers.current![which];
    const pos = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
      const b = e.currentTarget.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    const redraw = () => { if (view.current) handle.paint(view.current); };
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const [x, y] = pos(e);
        if (r().MouseButtonDown(x, y, e.detail || 1, modifier(e))) e.currentTarget.setPointerCapture(e.pointerId);
        redraw();
      },
      onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const [x, y] = pos(e);
        if (r().IsDrag()) r().Tracking(x, y, false);
        else e.currentTarget.style.cursor = r().MouseMove(x, y);
        redraw();
      },
      onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!r().IsDrag()) return;
        const [x, y] = pos(e);
        r().Tracking(x, y, false);
        r().Tracking(x, y, true);
        redraw();
        c.focusEditor();
      },
      onPointerCancel: () => { if (r().IsDrag()) { r().Tracking(0, 0, true, true); redraw(); } },
      onPointerLeave: () => { if (!r().IsDrag()) { r().MouseLeave(); redraw(); } },
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape' && r().IsDrag()) { r().Tracking(0, 0, true, true); redraw(); } },
    };
  };

  const top = bH ? size.current : 0, left = bV ? size.current : 0;
  const elements = <>
    {bH && <canvas ref={hRef} className="ruler ruler-h" tabIndex={-1} aria-hidden="true" data-testid="hruler" style={{ height: size.current }} {...events('h')} />}
    {bV && <canvas ref={vRef} className="ruler ruler-v" tabIndex={-1} aria-hidden="true" data-testid="vruler" style={{ width: size.current, top, height: `calc(100% - ${top}px)` }} {...events('v')} />}
  </>;
  return { handle, elements, top, left };
}
