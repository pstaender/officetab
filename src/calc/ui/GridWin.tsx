// The spreadsheet's window: ScTabView's grid windows (the panes, frozen or not), the column and
// row headers, the corner, the scroll bars, and the cell editor over the cell being edited. The
// cells are painted on one canvas (src/lo's ScGridWindow DrawPane and ScHeaderControl); a
// transparent scroller over the cells gives the native scroll bars and takes the mouse; a
// textarea is the keyboard's target and becomes the cell editor when typing starts.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Controller } from '../controller.ts';
import { DrawPane, SC_AUTOFILL_HANDLE, GetRangePixelRect } from '@lo/sc/source/ui/view/gridwin4.ts';
import { ScHeaderControl, DEFAULT_HEADER_COLORS, type ScHeaderColors } from '@lo/sc/source/ui/view/hdrcont.ts';
import {
  SC_SPLIT_BOTTOM, SC_SPLIT_BOTTOMLEFT, SC_SPLIT_BOTTOMRIGHT, SC_SPLIT_LEFT, SC_SPLIT_RIGHT, SC_SPLIT_TOP, SC_SPLIT_TOPLEFT, SC_SPLIT_TOPRIGHT,
  ScFollowMode, ScRefType, ScSplitMode, WhichH, WhichV, type ScSplitPos,
} from '@lo/sc/source/ui/view/viewdata.ts';
import { KEY_MOD1, KEY_SHIFT } from '@lo/sc/source/ui/view/tabview.ts';
import { ScRange } from '@lo/sc/inc/address.ts';
import { ViewOption } from '@lo/sc/inc/viewopti.ts';
import { FillDir, ScSizeMode } from '@lo/sc/inc/global.ts';
import { GetArgumentsTip, GetFunctionAtCaret, IsFormulaText, UseFormulaData } from '@lo/sc/source/ui/app/inputhdl.ts';
import { commandForKeyEvent, isMac } from './labels.ts';
import { dispatch } from '../commands.ts';
import { ContextMenu } from '@shell/ui/Bars.tsx';
import { t } from '@shell/i18n.ts';
import { copySelection, pasteClipboard } from '../clipboard.ts';

/** The headers' size at 100%: the column header's height. */
const HEADER_HEIGHT = 20;
/** The largest the scroll bars' area may get before positions are scaled (browsers limit element sizes). */
const MAX_SCROLL_PX = 8_000_000;

interface Geometry {
  hdrW: number; hdrH: number;
  gx: number; gy: number; gw: number; gh: number;
  splitX: number; splitY: number;
  bH: boolean; bV: boolean;
}

/** The colours of the window, light or dark. */
function useDark(): boolean {
  const [dark, setDark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setDark(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return dark;
}

const DARK_HEADERS: ScHeaderColors = {
  face: '#2b2d31', text: '#d0d0d0', line: '#45474c', selFace: '#33475f', selText: '#ffffff', fullFace: '#3f6aa5', fullText: '#ffffff', selLine: '#7aa7e6',
};

export function GridWin({ c, version }: { c: Controller; version: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const frame = useRef(0);
  const geo = useRef<Geometry>({ hdrW: 40, hdrH: HEADER_HEIGHT, gx: 40, gy: HEADER_HEIGHT, gw: 0, gh: 0, splitX: 0, splitY: 0, bH: false, bV: false });
  const scrollScale = useRef({ x: 1, y: 1, baseX: 0, baseY: 0 });
  const ignoreScroll = useRef(false);
  const composing = useRef(false);
  const focused = useRef(false);
  const dark = useDark();
  const [ctxMenu, setCtxMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [cursorStyle, setCursorStyle] = useState('cell');
  const [funcList, setFuncList] = useState<{ names: string[]; sel: number; nStart: number; aStart: string } | null>(null);
  const drag = useRef<
    | { kind: 'select'; anchorX: number; anchorY: number; started: boolean }
    | { kind: 'ref' }
    | { kind: 'fill'; r: ScRange }
    | { kind: 'colsel' | 'rowsel' }
    | { kind: 'resize'; bCol: boolean; nEntry: number; start: number; size: number; cols: number[] }
    | null
  >(null);

  const v = () => c.view.GetViewData();

  /** The pixel rectangle of a pane in the canvas. */
  const paneRect = (ePos: ScSplitPos) => {
    const g = geo.current;
    const left = WhichH(ePos) === SC_SPLIT_LEFT;
    const top = WhichV(ePos) === SC_SPLIT_TOP;
    const x = g.gx + (left ? 0 : g.bH ? g.splitX : 0);
    const w = g.bH ? (left ? g.splitX : g.gw - g.splitX) : left ? g.gw : 0;
    const y = g.gy + (top ? 0 : g.bV ? g.splitY : 0);
    const h = g.bV ? (top ? g.splitY : g.gh - g.splitY) : top ? 0 : g.gh;
    return { x, y, w, h };
  };

  /** The pane at a point of the cell area (canvas coordinates), and the point in it. */
  const paneAt = (px: number, py: number): { ePos: ScSplitPos; x: number; y: number } => {
    const g = geo.current;
    const right = g.bH && px - g.gx >= g.splitX;
    const bottom = !g.bV || py - g.gy >= g.splitY;
    const ePos = bottom ? (right ? SC_SPLIT_BOTTOMRIGHT : SC_SPLIT_BOTTOMLEFT) : right ? SC_SPLIT_TOPRIGHT : SC_SPLIT_TOPLEFT;
    const r = paneRect(ePos);
    return { ePos, x: px - r.x, y: py - r.y };
  };

  /** The geometry from the window's size and the view's split. */
  const layout = () => {
    const root = rootRef.current;
    if (!root) return;
    const vd = v();
    const zoom = vd.GetZoomY();
    const hdrH = vd.GetOptions().GetOption(ViewOption.HEADER) ? Math.round(HEADER_HEIGHT * Math.min(1.6, Math.max(0.75, zoom))) : 0;
    // the row header fits the largest row number shown
    const lastRow = vd.GetPosY(SC_SPLIT_BOTTOM) + 200;
    const digits = String(lastRow + 1).length;
    const hdrW = hdrH ? Math.max(Math.round(36 * Math.min(1.6, Math.max(0.75, zoom))), digits * 8 + 12) : 0;
    const gw = Math.max(0, root.clientWidth - hdrW), gh = Math.max(0, root.clientHeight - hdrH);
    vd.SetScrSize(gw, gh);
    geo.current = {
      hdrW, hdrH, gx: hdrW, gy: hdrH, gw, gh,
      splitX: vd.GetHSplitPos(), splitY: vd.GetVSplitPos(),
      bH: vd.GetHSplitMode() !== ScSplitMode.SC_SPLIT_NONE, bV: vd.GetVSplitMode() !== ScSplitMode.SC_SPLIT_NONE,
    };
  };

  const paint = () => {
    frame.current = 0;
    const canvas = canvasRef.current, root = rootRef.current;
    if (!canvas || !root) return;
    layout();
    const g = geo.current;
    const dpr = window.devicePixelRatio || 1;
    const W = root.clientWidth, H = root.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';
    const vd = v();
    const colors = dark ? { doc: '#1e1f22', grid: '#3c3f44', cursor: '#e8e8e8', selection: 'rgba(122, 167, 230, 0.22)', selectionBorder: '#7aa7e6', handle: '#7aa7e6' } : {};
    const parts = c.view.GetVisibleParts();
    const editCell = c.edit && c.edit.nTab === vd.GetTabNo() ? { nCol: c.edit.nCol, nRow: c.edit.nRow } : null;
    for (const ePos of parts) {
      const r = paneRect(ePos);
      DrawPane(ctx, vd, ePos, r.x, r.y, r.w, r.h, c.measurer, { editCell, rangeFinder: c.rangeFinder?.maEntries, copySource: c.copySource, colors });
    }
    // the frozen panes' separating lines
    ctx.fillStyle = dark ? '#8a8d93' : '#6b6b6b';
    if (g.bH) ctx.fillRect(g.gx + g.splitX - 1, g.gy, 1, g.gh);
    if (g.bV) ctx.fillRect(g.gx, g.gy + g.splitY - 1, g.gw, 1);
    // headers
    if (g.hdrH) {
      const hc = dark ? DARK_HEADERS : DEFAULT_HEADER_COLORS;
      for (const eH of g.bH ? [SC_SPLIT_LEFT, SC_SPLIT_RIGHT] as const : [SC_SPLIT_LEFT] as const) {
        const r = paneRect(eH === SC_SPLIT_LEFT ? SC_SPLIT_BOTTOMLEFT : SC_SPLIT_BOTTOMRIGHT);
        new ScHeaderControl(vd, false, eH).Paint(ctx, r.x, 0, r.w, g.hdrH, hc, vd.GetZoomX(), c.inputOptions.GetMarkHeader());
      }
      for (const eV of g.bV ? [SC_SPLIT_TOP, SC_SPLIT_BOTTOM] as const : [SC_SPLIT_BOTTOM] as const) {
        const r = paneRect(eV === SC_SPLIT_TOP ? SC_SPLIT_TOPLEFT : SC_SPLIT_BOTTOMLEFT);
        new ScHeaderControl(vd, true, eV).Paint(ctx, 0, r.y, r.h, g.hdrW, hc, vd.GetZoomY(), c.inputOptions.GetMarkHeader());
      }
      ctx.fillStyle = hc.face;
      ctx.fillRect(0, 0, g.hdrW, g.hdrH);
      ctx.fillStyle = hc.line;
      ctx.fillRect(g.hdrW - 1, 0, 1, g.hdrH);
      ctx.fillRect(0, g.hdrH - 1, g.hdrW, 1);
      // the corner's triangle (select all)
      ctx.beginPath(); ctx.moveTo(g.hdrW - 4, g.hdrH - 12); ctx.lineTo(g.hdrW - 4, g.hdrH - 4); ctx.lineTo(g.hdrW - 12, g.hdrH - 4); ctx.closePath(); ctx.fillStyle = hc.line; ctx.fill();
    }
    updateScroller();
    placeEditor();
  };
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(paint); };

  /** The scroll bars: the spacer's size and the position follow the view (UpdateScrollBars). */
  const updateScroller = () => {
    const s = scrollerRef.current, sp = spacerRef.current;
    if (!s || !sp) return;
    const g = geo.current, vd = v(), rDoc = c.sh.GetDocument(), nTab = vd.GetTabNo();
    s.style.left = `${g.gx + (g.bH ? g.splitX : 0)}px`;
    s.style.top = `${g.gy + (g.bV ? g.splitY : 0)}px`;
    const eH = g.bH ? SC_SPLIT_RIGHT : SC_SPLIT_LEFT;
    const originX = g.bH ? vd.GetFixPosX() : 0, originY = g.bV ? vd.GetFixPosY() : 0;
    const area = rDoc.GetPrintArea(nTab);
    const posX = vd.GetPosX(eH), posY = vd.GetPosY(SC_SPLIT_BOTTOM);
    const visX = vd.VisibleCellsX(eH), visY = vd.VisibleCellsY(SC_SPLIT_BOTTOM);
    const maxX = Math.min(rDoc.MaxCol() + 1, Math.max(area.nEndCol, vd.GetCurX(), posX + visX) + visX + 1);
    const maxY = Math.min(rDoc.MaxRow() + 1, Math.max(area.nEndRow, vd.GetCurY(), posY + visY) + visY + 1);
    const baseX = vd.GetColPixelOffset(originX), baseY = vd.GetRowPixelOffset(originY);
    const extX = vd.GetColPixelOffset(maxX) - baseX, extY = vd.GetRowPixelOffset(maxY) - baseY;
    const sx = extX > MAX_SCROLL_PX ? MAX_SCROLL_PX / extX : 1, sy = extY > MAX_SCROLL_PX ? MAX_SCROLL_PX / extY : 1;
    scrollScale.current = { x: sx, y: sy, baseX, baseY };
    sp.style.width = `${Math.round(extX * sx) + s.clientWidth}px`;
    sp.style.height = `${Math.round(extY * sy) + s.clientHeight}px`;
    const wantLeft = Math.round((vd.GetColPixelOffset(posX) - baseX) * sx), wantTop = Math.round((vd.GetRowPixelOffset(posY) - baseY) * sy);
    if (Math.abs(s.scrollLeft - wantLeft) > 1 || Math.abs(s.scrollTop - wantTop) > 1) {
      ignoreScroll.current = true;
      s.scrollLeft = wantLeft;
      s.scrollTop = wantTop;
    }
  };

  /** The scroll bars moved: the view scrolls to the column and row there. */
  const onScroll = () => {
    if (ignoreScroll.current) { ignoreScroll.current = false; return; }
    const s = scrollerRef.current;
    if (!s) return;
    const g = geo.current, vd = v(), sc = scrollScale.current;
    const eH = g.bH ? SC_SPLIT_RIGHT : SC_SPLIT_LEFT;
    const col = vd.GetColAtPixelOffset(s.scrollLeft / sc.x + sc.baseX);
    const row = vd.GetRowAtPixelOffset(s.scrollTop / sc.y + sc.baseY);
    if (col !== vd.GetPosX(eH)) c.view.ScrollX(col - vd.GetPosX(eH), eH);
    if (row !== vd.GetPosY(SC_SPLIT_BOTTOM)) c.view.ScrollY(row - vd.GetPosY(SC_SPLIT_BOTTOM), SC_SPLIT_BOTTOM);
    schedule();
  };

  /** The editor over the cell being edited, or (not editing) a hidden one at the cursor for the keyboard. */
  const placeEditor = () => {
    const el = inputRef.current;
    if (!el) return;
    const vd = v();
    const e = c.edit;
    const nCol = e?.nCol ?? vd.GetCurX(), nRow = e?.nRow ?? vd.GetCurY();
    const ePos = vd.GetActivePart();
    const r = paneRect(ePos);
    const p = vd.GetScrPos(nCol, nRow, ePos, true);
    const sz = vd.GetMergeSizePixel(nCol, nRow);
    const x = r.x + p.X, y = r.y + p.Y;
    el.style.left = `${Math.max(r.x, x)}px`;
    el.style.top = `${Math.max(r.y, y)}px`;
    const bEditing = !!e && e.where === 'cell';
    el.style.minWidth = bEditing ? `${Math.max(0, sz.rSizeXPix - 1)}px` : '';
    el.style.minHeight = bEditing ? `${Math.max(0, sz.rSizeYPix - 1)}px` : '';
    el.style.maxWidth = `${Math.max(sz.rSizeXPix, geo.current.gx + geo.current.gw - Math.max(r.x, x))}px`;
    if (e && e.where === 'cell') {
      el.classList.add('editing');
      const pat = c.sh.GetDocument().GetPattern(nCol, nRow, vd.GetTabNo());
      el.style.font = c.cellFont(nCol, nRow, vd.GetTabNo());
      el.style.textAlign = pat.GetItem('ATTR_HOR_JUSTIFY') === 'Right' ? 'right' : pat.GetItem('ATTR_HOR_JUSTIFY') === 'Center' ? 'center' : 'left';
      el.style.background = pat.GetItem('ATTR_BACKGROUND') ?? '';
    } else el.classList.remove('editing');
  };

  // the editor's text follows the input (a change in the formula bar, a reference pointed at)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || composing.current) return;
    const e = c.edit;
    if (e && e.where === 'cell') {
      const full = e.text + (e.completion ?? '');
      if (el.value !== full) el.value = full;
      if (document.activeElement === el && (el.selectionStart !== e.selStart || el.selectionEnd !== (e.completion ? full.length : e.selEnd))) {
        el.setSelectionRange(e.selStart, e.completion ? full.length : e.selEnd);
      }
    } else if (!e && el.value) el.value = '';
  });

  useLayoutEffect(paint);
  useEffect(() => { schedule(); }, [version, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    c.onRepaint = schedule;
    c.focusEditor = () => inputRef.current?.focus({ preventScroll: true });
    c.focusCellEditor = () => { schedule(); inputRef.current?.focus({ preventScroll: true }); };
    inputRef.current?.focus({ preventScroll: true });
    const ro = new ResizeObserver(() => { schedule(); });
    ro.observe(rootRef.current!);
    // Ctrl+wheel zooms (the browser would zoom the page)
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      c.setZoom(c.view.GetViewData().GetZoomX() * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    const root = rootRef.current!;
    root.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); root.removeEventListener('wheel', wheel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- mouse ---

  /** The cell under a point of the canvas (client coordinates), and the pane. */
  const cellAt = (clientX: number, clientY: number) => {
    const b = rootRef.current!.getBoundingClientRect();
    const { ePos, x, y } = paneAt(clientX - b.left, clientY - b.top);
    const { rPosX, rPosY } = v().GetPosFromPixel(x, y, ePos);
    return { ePos, nCol: rPosX, nRow: rPosY, x, y };
  };

  /** Whether a point is on the AutoFill handle of the selection. */
  const onFillHandle = (clientX: number, clientY: number): ScRange | null => {
    if (c.edit) return null;
    const vd = v();
    if (vd.GetMarkData().IsMultiMarked()) return null;
    const { rRange } = vd.GetSimpleArea();
    const b = rootRef.current!.getBoundingClientRect();
    const { ePos, x, y } = paneAt(clientX - b.left, clientY - b.top);
    const p = GetRangePixelRect(vd, rRange, ePos);
    const hx = p.x + p.w - 1, hy = p.y + p.h - 1;
    return Math.abs(x - hx) <= SC_AUTOFILL_HANDLE && Math.abs(y - hy) <= SC_AUTOFILL_HANDLE ? rRange : null;
  };

  const onCellMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    e.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    setFuncList(null);
    const vd = v();
    const nTab = vd.GetTabNo();
    const { nCol, nRow } = cellAt(e.clientX, e.clientY);
    // a formula being edited: the click points at a reference
    if (c.edit && c.isRefInput()) {
      if (e.shiftKey && vd.IsRefMode()) c.view.UpdateRef(nCol, nRow, nTab);
      else {
        c.view.DoneRefMode();
        c.view.InitRefMode(nCol, nRow, nTab, ScRefType.SC_REFTYPE_REF);
      }
      drag.current = { kind: 'ref' };
      return;
    }
    if (c.edit) c.commitEdit('none');
    if (e.detail === 2) {
      // double-click: edit the cell (SID_SETINPUTMODE)
      c.view.ClickCursor(nCol, nRow);
      c.startEdit(undefined, 'cell');
      return;
    }
    const fill = onFillHandle(e.clientX, e.clientY);
    if (fill) {
      vd.SetFillMode(fill.aStart.Col(), fill.aStart.Row(), fill.aEnd.Col(), fill.aEnd.Row());
      c.view.InitRefMode(fill.aStart.Col(), fill.aStart.Row(), nTab, ScRefType.SC_REFTYPE_FILL);
      c.view.UpdateRef(fill.aEnd.Col(), fill.aEnd.Row(), nTab);
      drag.current = { kind: 'fill', r: fill };
      return;
    }
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.shiftKey) {
      // extend from the cursor (ScViewFunctionSet with Shift)
      if (!c.view.IsBlockMode()) c.view.InitBlockMode(vd.GetCurX(), vd.GetCurY(), nTab, true);
      c.view.MarkCursor(nCol, nRow, nTab, false, false, true);
      c.view.SelectionChanged();
      drag.current = { kind: 'select', anchorX: vd.GetCurX(), anchorY: vd.GetCurY(), started: true };
      return;
    }
    if (mod) {
      // add a range to the selection
      const rMark = vd.GetMarkData();
      if (!rMark.IsMarked() && !rMark.IsMultiMarked()) {
        c.view.InitBlockMode(vd.GetCurX(), vd.GetCurY(), nTab, true);
        c.view.MarkCursor(vd.GetCurX(), vd.GetCurY(), nTab);
      }
      c.view.DoneBlockMode(true);
      c.view.InitBlockMode(nCol, nRow, nTab, true);
      c.view.MarkCursor(nCol, nRow, nTab);
      c.view.SetCursor(nCol, nRow);
      c.view.SelectionChanged();
      drag.current = { kind: 'select', anchorX: nCol, anchorY: nRow, started: true };
      return;
    }
    c.view.DoneBlockMode();
    vd.GetMarkData().ResetMark();
    c.view.MoveCursorAbs(nCol, nRow, ScFollowMode.SC_FOLLOW_LINE, false, false);
    vd.SetTabStartCol(-1);
    drag.current = { kind: 'select', anchorX: nCol, anchorY: nRow, started: false };
  };

  const onHeaderMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const b = rootRef.current!.getBoundingClientRect();
    const px = e.clientX - b.left, py = e.clientY - b.top;
    const g = geo.current;
    if (px >= g.gx && py >= g.gy) return;
    if (e.button === 2) return;
    e.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    const vd = v();
    if (px < g.gx && py < g.gy) {
      // the corner: select all
      if (c.edit) c.commitEdit('none');
      c.view.SelectAll();
      return;
    }
    const bCol = py < g.gy;
    const hit = headerHit(px, py);
    if (!hit) return;
    const nModifier = (e.shiftKey ? KEY_SHIFT : 0) | ((isMac ? e.metaKey : e.ctrlKey) ? KEY_MOD1 : 0);
    if (hit.bBorder) {
      if (e.detail === 2) {
        // double-click on the edge: the optimal width or height (SetMarkedWidthOrHeight with SC_SIZE_OPTIMAL)
        const marked = bCol ? vd.SimpleColMarked() : vd.SimpleRowMarked();
        const spans = marked ? c.view.GetMarkedColRowSpans(bCol) : [{ mnStart: hit.nEntry, mnEnd: hit.nEntry }];
        c.view.SetWidthOrHeight(bCol, spans, bCol ? ScSizeMode.SC_SIZE_OPTIMAL : ScSizeMode.SC_SIZE_OPTIMAL, bCol ? 113 : 0);
        return;
      }
      const rDoc = c.sh.GetDocument();
      const size = bCol ? rDoc.GetColWidth(hit.nEntry, vd.GetTabNo()) : rDoc.GetRowHeight(hit.nEntry, vd.GetTabNo());
      const marked = bCol ? vd.SimpleColMarked() : vd.SimpleRowMarked();
      const spans = marked ? c.view.GetMarkedColRowSpans(bCol) : [];
      const inSel = spans.some((s) => s.mnStart <= hit.nEntry && hit.nEntry <= s.mnEnd);
      const cols: number[] = inSel ? spans.flatMap((s) => Array.from({ length: s.mnEnd - s.mnStart + 1 }, (_, i) => s.mnStart + i)) : [hit.nEntry];
      drag.current = { kind: 'resize', bCol, nEntry: hit.nEntry, start: bCol ? e.clientX : e.clientY, size, cols };
      return;
    }
    if (c.edit && !c.isRefInput()) c.commitEdit('none');
    if (bCol) c.view.MarkColumns(hit.nEntry, nModifier);
    else c.view.MarkRows(hit.nEntry, nModifier);
    drag.current = { kind: bCol ? 'colsel' : 'rowsel' };
  };

  /** The header entry at a point of the canvas. */
  const headerHit = (px: number, py: number) => {
    const g = geo.current;
    const vd = v();
    if (py < g.gy && px >= g.gx) {
      const right = g.bH && px - g.gx >= g.splitX;
      const r = paneRect(right ? SC_SPLIT_BOTTOMRIGHT : SC_SPLIT_BOTTOMLEFT);
      return new ScHeaderControl(vd, false, right ? SC_SPLIT_RIGHT : SC_SPLIT_LEFT).GetMousePos(px - r.x);
    }
    if (px < g.gx && py >= g.gy) {
      const top = g.bV && py - g.gy < g.splitY;
      const r = paneRect(top ? SC_SPLIT_TOPLEFT : SC_SPLIT_BOTTOMLEFT);
      return new ScHeaderControl(vd, true, top ? SC_SPLIT_TOP : SC_SPLIT_BOTTOM).GetMousePos(py - r.y);
    }
    return null;
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      const vd = v();
      const nTab = vd.GetTabNo();
      if (!d) {
        // the pointer's shape: resize over header edges, a cross over the fill handle
        const root = rootRef.current;
        if (!root) return;
        const b = root.getBoundingClientRect();
        const px = e.clientX - b.left, py = e.clientY - b.top;
        if (px < 0 || py < 0 || px > b.width || py > b.height) return;
        const g = geo.current;
        let cur = 'cell';
        if (px < g.gx || py < g.gy) {
          const h = headerHit(px, py);
          cur = h?.bBorder ? (py < g.gy ? 'col-resize' : 'row-resize') : 'default';
        } else if (onFillHandle(e.clientX, e.clientY)) cur = 'crosshair';
        if (cur !== cursorStyle) setCursorStyle(cur);
        return;
      }
      if (d.kind === 'resize') {
        const delta = (d.bCol ? e.clientX : e.clientY) - d.start;
        const ppt = d.bCol ? vd.GetPPTX() : vd.GetPPTY();
        const twips = Math.max(0, Math.round(d.size + delta / ppt));
        // a live preview: the size is set without undo, then once with undo on release
        const rDoc = c.sh.GetDocument();
        for (const n of d.cols) {
          if (d.bCol) rDoc.SetColWidth(n, nTab, twips);
          else { rDoc.SetRowHeight(n, nTab, twips); rDoc.SetManualHeight(n, n, nTab, true); }
        }
        vd.RecalcPixPos();
        schedule();
        return;
      }
      if (d.kind === 'colsel' || d.kind === 'rowsel') {
        const b = rootRef.current!.getBoundingClientRect();
        const h = headerHit(d.kind === 'colsel' ? Math.max(geo.current.gx, e.clientX - b.left) : 0, d.kind === 'colsel' ? 0 : Math.max(geo.current.gy, e.clientY - b.top));
        if (!h) return;
        const rDoc = c.sh.GetDocument();
        if (vd.IsRefMode()) c.view.UpdateRef(d.kind === 'colsel' ? h.nEntry : rDoc.MaxCol(), d.kind === 'colsel' ? rDoc.MaxRow() : h.nEntry, nTab);
        else if (d.kind === 'colsel') c.view.MarkCursor(h.nEntry, rDoc.MaxRow(), nTab, true, false);
        else c.view.MarkCursor(rDoc.MaxCol(), h.nEntry, nTab, false, true);
        c.view.SelectionChanged();
        return;
      }
      const { nCol, nRow } = cellAt(e.clientX, e.clientY);
      if (d.kind === 'ref') {
        c.view.UpdateRef(nCol, nRow, nTab);
        c.view.AlignToCursor(nCol, nRow, ScFollowMode.SC_FOLLOW_LINE);
        return;
      }
      if (d.kind === 'fill') {
        // fill only ever in one direction (ScViewFunctionSet::SetCursorAtCell's fill mode)
        const r = d.r;
        const rDoc = c.sh.GetDocument();
        let nPosX = nCol, nPosY = nRow;
        if (nPosX >= r.aStart.Col() && nPosX <= r.aEnd.Col() && nPosY >= r.aStart.Row() && nPosY <= r.aEnd.Row()) {
          nPosX = r.aEnd.Col(); nPosY = r.aEnd.Row();
        } else {
          const bNegX = nPosX < r.aStart.Col(), bNegY = nPosY < r.aStart.Row();
          const nSizeX = bNegX ? rDoc.GetColWidthRange(nPosX, r.aStart.Col() - 1, nTab) : nPosX > r.aEnd.Col() ? rDoc.GetColWidthRange(r.aEnd.Col() + 1, nPosX, nTab) : 0;
          const nSizeY = bNegY ? rDoc.GetRowHeightRange(nPosY, r.aStart.Row() - 1, nTab) : nPosY > r.aEnd.Row() ? rDoc.GetRowHeightRange(r.aEnd.Row() + 1, nPosY, nTab) : 0;
          let refStX = r.aStart.Col(), refStY = r.aStart.Row();
          if (nSizeX > nSizeY) { nPosY = bNegX ? r.aStart.Row() : r.aEnd.Row(); if (bNegX) { refStX = r.aEnd.Col(); refStY = r.aEnd.Row(); nPosY = r.aStart.Row(); } }
          else { nPosX = bNegY ? r.aStart.Col() : r.aEnd.Col(); if (bNegY) { refStX = r.aEnd.Col(); refStY = r.aEnd.Row(); nPosX = r.aStart.Col(); } }
          if (refStX !== vd.GetRefStartX() || refStY !== vd.GetRefStartY()) {
            c.view.DoneRefMode();
            c.view.InitRefMode(refStX, refStY, nTab, ScRefType.SC_REFTYPE_FILL);
          }
        }
        c.view.UpdateRef(nPosX, nPosY, nTab);
        c.view.AlignToCursor(nCol, nRow, ScFollowMode.SC_FOLLOW_LINE);
        schedule();
        return;
      }
      // selection
      if (d.kind !== 'select') return;
      if (!d.started) {
        if (nCol === d.anchorX && nRow === d.anchorY) return;
        c.view.InitBlockMode(d.anchorX, d.anchorY, nTab, true);
        d.started = true;
      }
      c.view.MarkCursor(nCol, nRow, nTab, false, false, true);
      c.view.AlignToCursor(nCol, nRow, ScFollowMode.SC_FOLLOW_LINE);
      c.view.SelectionChanged();
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const vd = v();
      const nTab = vd.GetTabNo();
      if (d.kind === 'resize') {
        const rDoc = c.sh.GetDocument();
        const size = d.bCol ? rDoc.GetColWidth(d.nEntry, nTab) : rDoc.GetRowHeight(d.nEntry, nTab);
        // back to the old size, and the new one with undo
        for (const n of d.cols) { if (d.bCol) rDoc.SetColWidth(n, nTab, d.size); else rDoc.SetRowHeight(n, nTab, d.size); }
        const spans = d.cols.map((n) => ({ mnStart: n, mnEnd: n }));
        c.view.SetWidthOrHeight(d.bCol, spans, ScSizeMode.SC_SIZE_DIRECT, size);
        return;
      }
      if (d.kind === 'fill') {
        // ScGridWindow::DropScroll/ButtonUp: FillAuto in the dragged direction
        const r = d.r;
        const s = new ScRange(vd.GetRefStartX(), vd.GetRefStartY(), nTab, vd.GetRefEndX(), vd.GetRefEndY(), nTab);
        s.PutInOrder();
        c.view.DoneRefMode();
        vd.ResetFillMode();
        if (s.aEnd.Row() > r.aEnd.Row()) c.view.FillAuto(FillDir.FILL_TO_BOTTOM, r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), s.aEnd.Row() - r.aEnd.Row());
        else if (s.aStart.Row() < r.aStart.Row()) c.view.FillAuto(FillDir.FILL_TO_TOP, r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), r.aStart.Row() - s.aStart.Row());
        else if (s.aEnd.Col() > r.aEnd.Col()) c.view.FillAuto(FillDir.FILL_TO_RIGHT, r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), s.aEnd.Col() - r.aEnd.Col());
        else if (s.aStart.Col() < r.aStart.Col()) c.view.FillAuto(FillDir.FILL_TO_LEFT, r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), r.aStart.Col() - s.aStart.Col());
        schedule();
        return;
      }
      if (d.kind === 'ref') {
        // the reference stays in the formula; pointing again starts a new one
        c.focusEditor();
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  });

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const b = rootRef.current!.getBoundingClientRect();
    const px = e.clientX - b.left, py = e.clientY - b.top;
    const g = geo.current;
    const vd = v();
    if (c.edit) c.commitEdit('none');
    if (px < g.gx && py < g.gy) return;
    if (py < g.gy || px < g.gx) {
      const h = headerHit(px, py);
      if (!h) return;
      const bCol = py < g.gy;
      // a header outside the selection selects its column or row first
      const spans = c.view.GetMarkedColRowSpans(bCol);
      const marked = bCol ? vd.SimpleColMarked() || vd.GetMarkData().IsMultiMarked() : vd.SimpleRowMarked() || vd.GetMarkData().IsMultiMarked();
      if (!marked || !spans.some((s) => s.mnStart <= h.nEntry && h.nEntry <= s.mnEnd)) {
        if (bCol) c.view.MarkColumns(h.nEntry); else c.view.MarkRows(h.nEntry);
      }
      setCtxMenu({ name: bCol ? 'colheader' : 'rowheader', x: e.clientX, y: e.clientY });
      return;
    }
    const { nCol, nRow } = cellAt(e.clientX, e.clientY);
    const rMark = vd.GetMarkData();
    if (!rMark.IsCellMarked(nCol, nRow)) {
      c.view.DoneBlockMode();
      rMark.ResetMark();
      c.view.MoveCursorAbs(nCol, nRow, ScFollowMode.SC_FOLLOW_NONE, false, false);
    }
    setCtxMenu({ name: 'cell', x: e.clientX, y: e.clientY });
  };

  // --- keyboard ---

  const updateFuncList = (text: string, caret: number) => {
    const f = UseFormulaData(text, caret);
    setFuncList(f ? { names: f.aNames.slice(0, 12), sel: 0, nStart: f.nStart, aStart: f.aStart } : null);
  };
  const acceptFunc = (name: string) => {
    const e = c.edit;
    const fl = funcList;
    if (!e || !fl) return;
    const s = e.text.slice(0, fl.nStart) + name + '(' + e.text.slice(e.selStart);
    setFuncList(null);
    c.setEditText(s, fl.nStart + name.length + 1);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const ed = c.edit;
    const vd = v();
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = paneRect(vd.GetActivePart());
      const p = vd.GetScrPos(vd.GetCurX(), vd.GetCurY(), vd.GetActivePart(), true);
      const b = rootRef.current!.getBoundingClientRect();
      setCtxMenu({ name: 'cell', x: b.left + r.x + p.X + 10, y: b.top + r.y + p.Y + 10 });
      return;
    }
    if (ed) {
      // function autocompletion
      if (funcList) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const n = funcList.names.length;
          setFuncList({ ...funcList, sel: (funcList.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptFunc(funcList.names[funcList.sel]!); return; }
        if (e.key === 'Escape') { e.preventDefault(); setFuncList(null); return; }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.altKey || (mod && !e.shiftKey)) {
          if (e.altKey && e.shiftKey) { c.commitEdit('none', true); return; }
          // a line break in the cell
          const el = e.currentTarget;
          const a = el.selectionStart, b = el.selectionEnd;
          const s = ed.text.slice(0, a) + '\n' + ed.text.slice(Math.min(b, ed.text.length));
          c.setEditText(s, a + 1);
          return;
        }
        setFuncList(null);
        c.commitEdit(e.shiftKey ? 'shift-enter' : 'enter');
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); setFuncList(null); c.commitEdit(e.shiftKey ? 'shift-tab' : 'tab'); return; }
      if (e.key === 'Escape') { e.preventDefault(); setFuncList(null); c.cancelEdit(); return; }
      if (e.key === 'F4' || (isMac && mod && e.key === 't')) {
        e.preventDefault();
        dispatch(c, '.uno:ToggleRelative');
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const arrow = arrows[e.key];
      if (arrow && !e.altKey) {
        if (c.isRefInput() && (ed.bByTyping || vd.IsRefMode()) && !mod) {
          // the reference moves with the arrow keys (ScTabView in reference input mode)
          e.preventDefault();
          if (e.shiftKey) c.view.ExpandBlock(arrow[0], arrow[1], ScFollowMode.SC_FOLLOW_LINE);
          else {
            const nX = vd.IsRefMode() ? vd.GetRefEndX() : vd.GetCurX(), nY = vd.IsRefMode() ? vd.GetRefEndY() : vd.GetCurY();
            const rDoc = c.sh.GetDocument();
            const nCol = Math.min(rDoc.MaxCol(), Math.max(0, nX + arrow[0])), nRow = Math.min(rDoc.MaxRow(), Math.max(0, nY + arrow[1]));
            c.view.DoneRefMode();
            c.view.InitRefMode(nCol, nRow, vd.GetTabNo(), ScRefType.SC_REFTYPE_REF);
            c.view.AlignToCursor(nCol, nRow, ScFollowMode.SC_FOLLOW_LINE);
          }
          return;
        }
        if (ed.bByTyping && !e.shiftKey && !mod) {
          e.preventDefault();
          setFuncList(null);
          c.commitEdit(({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[e.key as 'ArrowLeft']);
          return;
        }
      }
      if (ed.completion && (e.key === 'Backspace' || e.key === 'Delete')) {
        // the AutoInput completion goes first
        e.preventDefault();
        c.setEditText(ed.text, ed.selStart);
        return;
      }
      return; // the textarea edits the text
    }
    // Not editing: the commands of the keys (navigation, formatting …)
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault();
      if (mod) return;
      if (c.inputOptions.GetEnterEdit()) { c.startEdit(undefined, 'cell'); return; }
      c.view.MoveCursorEnter(e.shiftKey);
      return;
    }
    if (e.key === 'F2' && !e.shiftKey && !mod && !e.altKey) { e.preventDefault(); c.startEdit(undefined, 'cell'); return; }
    // Clipboard shortcuts must stay native: only they carry the permission to touch the clipboard.
    if (mod && !e.altKey && ['KeyC', 'KeyX', 'KeyV'].includes(e.code) && !(e.shiftKey && e.code === 'KeyV')) return;
    const cmd = commandForKeyEvent(e.nativeEvent)?.cmd;
    if (cmd && dispatch(c, cmd)) e.preventDefault();
    else if (cmd === '.uno:Save') e.preventDefault();
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (composing.current) return;
    if (!c.edit) {
      // typing starts the input with what was typed (ScGridWindow::KeyInput → the input handler)
      if (!el.value) return;
      c.startEdit(el.value, 'cell', el.selectionStart);
      if (IsFormulaText(el.value)) updateFuncList(el.value, el.selectionStart);
      return;
    }
    const native = e.nativeEvent as InputEvent;
    const typed = native.inputType === 'insertText' || native.inputType === 'insertCompositionText';
    // the AutoInput completion was in the editor as selected text: the edit replaced it
    c.setEditText(el.value, el.selectionStart, el.selectionEnd, typed);
    if (IsFormulaText(el.value)) updateFuncList(el.value, el.selectionStart);
    else setFuncList(null);
  };

  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ed = c.edit;
    const el = e.currentTarget;
    if (!ed || composing.current) return;
    const full = ed.text + (ed.completion ?? '');
    if (el.value !== full) return;
    if (ed.completion && el.selectionStart === ed.text.length && el.selectionEnd === full.length) return;
    if (el.selectionStart !== ed.selStart || el.selectionEnd !== ed.selEnd) {
      if (ed.completion) { ed.completion = null; el.value = ed.text; }
      ed.selStart = Math.min(el.selectionStart, ed.text.length);
      ed.selEnd = Math.min(el.selectionEnd, ed.text.length);
      ed.refSel = null;
      if (vd().IsRefMode()) c.view.DoneRefMode();
      c.notify();
    }
  };
  const vd = v;

  // the argument tip of the function the caret is in
  const tip = (() => {
    const ed = c.edit;
    if (!ed || ed.where !== 'cell' || funcList) return null;
    const f = GetFunctionAtCaret(ed.text, ed.selStart);
    if (!f) return null;
    return GetArgumentsTip(f.pDesc, f.nArg);
  })();
  const editorBox = inputRef.current?.getBoundingClientRect();
  const rootBox = rootRef.current?.getBoundingClientRect();

  return (
    <div className="calc-grid" ref={rootRef} style={{ cursor: cursorStyle }}>
      <canvas ref={canvasRef} className="calc-canvas" data-testid="grid-canvas" onMouseDown={onHeaderMouseDown} onContextMenu={onContextMenu} />
      <div ref={scrollerRef} className="calc-scroller" data-testid="grid-scroller" onScroll={onScroll} onMouseDown={onCellMouseDown} onContextMenu={onContextMenu}
        style={{ cursor: cursorStyle }}>
        <div ref={spacerRef} className="calc-spacer" />
      </div>
      <textarea
        ref={inputRef}
        className="cell-editor"
        data-testid="cell-input"
        aria-label={t('calc.cellInput')}
        autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onSelect={onSelect}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setFuncList(null); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(e) => { composing.current = false; onInput(e as unknown as React.FormEvent<HTMLTextAreaElement>); }}
        onCopy={(e) => { if (c.edit) return; e.preventDefault(); copySelection(c, e.clipboardData, false); }}
        onCut={(e) => { if (c.edit) return; e.preventDefault(); copySelection(c, e.clipboardData, true); }}
        onPaste={(e) => { if (c.edit) return; e.preventDefault(); pasteClipboard(c, e.clipboardData); }}
      />
      {funcList && editorBox && rootBox && (
        <ul className="func-list" role="listbox" aria-label={t('calc.functions')} style={{ left: editorBox.left - rootBox.left, top: editorBox.bottom - rootBox.top + 2 }}>
          {funcList.names.map((n, i) => (
            <li key={n} role="option" aria-selected={i === funcList.sel} className={i === funcList.sel ? 'on' : undefined}
              onMouseDown={(ev) => { ev.preventDefault(); acceptFunc(n); }}>{n}</li>
          ))}
        </ul>
      )}
      {tip && editorBox && rootBox && (
        <div className="func-tip" role="tooltip" style={{ left: editorBox.left - rootBox.left, top: editorBox.bottom - rootBox.top + 2 }}>
          {tip.aSig.split(tip.aParam).map((part, i, all) => <span key={i}>{part}{i < all.length - 1 && tip.aParam ? <strong>{tip.aParam}</strong> : null}</span>)}
        </div>
      )}
      {ctxMenu && <ContextMenu c={c} name={ctxMenu.name} x={ctxMenu.x} y={ctxMenu.y} close={() => { setCtxMenu(null); c.focusEditor(); }} />}
    </div>
  );
}
