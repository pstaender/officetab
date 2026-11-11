// The document surface: a viewport-sized canvas under a native scroller, plus the hidden textarea
// that receives keyboard, IME and clipboard input. Mirrors the role of upstream's SwEditWin.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { SwTextNode } from '@lo/sw/inc/ndtxt.ts';
import type { SwWrongArea } from '@lo/sw/source/core/txtnode/txtedt.ts';
import { Point } from '@lo/tools/source/generic/gen.ts';
import { DOCUMENTBORDER } from '@lo/sw/source/core/layout/pagechg.ts';
import { FlyHandles, HANDLE_PX, PaintView, TWIPS_PER_CSS_PX, type PaintColors, type PaintView as View } from '@lo/sw/source/core/view/paint.ts';
import { SwRect } from '@lo/sw/inc/swrect.ts';
import { RndStdIds, SwChainRet } from '@lo/sw/inc/frmfmt.ts';
import type { Controller } from '../controller.ts';
import { dispatch } from '../commands.ts';
import { t } from '../i18n.ts';
import { PSCSDFPropsQuickHelp } from '../../lo/sw/source/uibase/docvw/edtwin2.ts';
import { Comments } from './Comments.tsx';
import { ContextMenu } from './Bars.tsx';
import { commandForKey, eventKeyName, isMac } from './labels.ts';

const BLINK_MS = 530;
const MULTI_CLICK_MS = 400;

const palette = (dark: boolean, controlCodes: boolean, comments: boolean): PaintColors => ({
  controlCodes: controlCodes ? '#268bd2' : null,
  // COL_AUTHOR1_LIGHT and COL_AUTHOR1_DARK: the first author colour.
  comment: comments ? '#fff3b4' : null,
  commentLine: '#c69200',
  desk: dark ? '#202226' : '#e9ecef',
  page: '#ffffff',
  pageEdge: dark ? '#0f1012' : '#ced4da',
  text: '#000000',
  selection: 'rgba(31, 111, 235, 0.32)',
  caret: '#000000',
  margin: '#e3e6ea',
  field: '#c0c0c0',
  handle: '#1f6feb',
  wrong: '#e60000',
});

/** Mouse cursors over the eight handles, clockwise from the top left. */
const HANDLE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

/** A fly being moved or resized with the mouse (SwEditWin's drag of a selected object). */
/** Dragging a fly's handle or the fly itself, or (with `create`) drawing a new shape of that type. */
interface FlyDrag { handle: number; start: Point; rect: SwRect; cur: SwRect; moved: boolean; keepRatio: boolean; create?: string; rotate?: number }
/** The size of a shape created by a click instead of a drag: 2.5 cm. */
const DEFAULT_SHAPE_SIZE = 1417;

export function EditWin({ c, version }: { c: Controller; version: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const caretOn = useRef(true);
  const focused = useRef(false);
  const composing = useRef(false);
  const dragging = useRef(false);
  const revealCaret = useRef(false);
  const frame = useRef(0);
  const clicks = useRef({ at: 0, n: 0, x: 0, y: 0 });
  const flyDrag = useRef<FlyDrag | null>(null);
  /** The AutoSpell context menu (SwSpellPopup): a misspelled word and where the menu is. */
  const [spellMenu, setSpellMenu] = useState<{ x: number; y: number; node: SwTextNode; w: SwWrongArea; sugg: string[] } | null>(null);
  /** The open context menu: the shell's popup menu name and where it opened. */
  const [ctxMenu, setCtxMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  /** Document point that must stay under the pointer while zooming, applied on the next paint. */
  const zoomAnchor = useRef<{ doc: Point; x: number; y: number } | null>(null);

  const view = (): View => {
    const s = scrollerRef.current!;
    const size = c.sh.m_pRoot.GetDocSize();
    const width = s.clientWidth, height = s.clientHeight;
    const scaledW = (size.width * c.zoom) / TWIPS_PER_CSS_PX;
    // Center the page when the document is narrower than the window.
    const scrollX = scaledW < width ? -((width - scaledW) / 2) * (TWIPS_PER_CSS_PX / c.zoom) : (s.scrollLeft * TWIPS_PER_CSS_PX) / c.zoom;
    return { scrollX, scrollY: (s.scrollTop * TWIPS_PER_CSS_PX) / c.zoom, zoom: c.zoom, dpr: window.devicePixelRatio || 1, width, height };
  };

  const toDoc = (e: { clientX: number; clientY: number }): Point => {
    const r = scrollerRef.current!.getBoundingClientRect();
    const v = view();
    const f = TWIPS_PER_CSS_PX / c.zoom;
    return new Point((e.clientX - r.left) * f + v.scrollX, (e.clientY - r.top) * f + v.scrollY);
  };

  /** Tolerance for hitting a handle or a frame's border, in twips. */
  const tolerance = () => (HANDLE_PX * TWIPS_PER_CSS_PX) / c.zoom;
  /** The handle of the selected fly under a point, or -1. */
  const handleAt = (p: Point): number => {
    if (!c.sh.IsFrameSelected()) return -1;
    const r = c.sh.GetFlyRect();
    if (!r) return -1;
    const t = tolerance();
    return FlyHandles(r).findIndex(([x, y]) => Math.abs(p.X() - x) <= t && Math.abs(p.Y() - y) <= t);
  };
  /** The fly a click selects: a graphic anywhere on it, a text frame only on its border. */
  const flyAt = (p: Point) => {
    const fly = c.sh.m_pRoot.GetFlyAt(p);
    if (!fly) return null;
    // A shape is an object to select, unless its text is being edited (SwDrawTextShell).
    if (fly.fmt.m_pShape && c.sh.GetCurrFlyName() !== fly.fmt.m_aName) return fly;
    if (fly.frames.length) {
      const r = fly.aFrame, t = tolerance();
      const inner = p.X() > r.Left() + t && p.X() < r.Left() + r.Width() - t && p.Y() > r.Top() + t && p.Y() < r.Top() + r.Height() - t;
      if (inner) return null;
    }
    return fly;
  };

  const paint = () => {
    frame.current = 0;
    const canvas = canvasRef.current, scroller = scrollerRef.current, spacer = spacerRef.current;
    if (!canvas || !scroller || !spacer) return;
    const size = c.sh.m_pRoot.GetDocSize();
    spacer.style.width = `${(size.width * c.zoom) / TWIPS_PER_CSS_PX}px`;
    // The canvas centres a document narrower than the window; DOM overlays must follow.
    spacer.style.marginLeft = `${Math.max(0, (scroller.clientWidth - (size.width * c.zoom) / TWIPS_PER_CSS_PX) / 2)}px`;
    spacer.style.height = `${(size.height * c.zoom) / TWIPS_PER_CSS_PX}px`;
    const anchor = zoomAnchor.current;
    if (anchor) {
      zoomAnchor.current = null;
      const f = c.zoom / TWIPS_PER_CSS_PX;
      scroller.scrollLeft = anchor.doc.X() * f - anchor.x;
      scroller.scrollTop = anchor.doc.Y() * f - anchor.y;
    } else if (revealCaret.current) {
      revealCaret.current = false;
      // SwFEShell::MakeSelVisible: a selected object is shown, not the cursor at its anchor.
      const fly = c.sh.IsFrameSelected() ? c.sh.GetFlyRect() : null;
      const f0 = c.zoom / TWIPS_PER_CSS_PX;
      // An object already partly in view (as when it was just clicked) needs no scrolling.
      const flyInView = !!fly && fly.Bottom() * f0 > scroller.scrollTop && fly.Top() * f0 < scroller.scrollTop + scroller.clientHeight;
      const r = fly ?? c.sh.GetCharRect();
      if (r && !flyInView) {
        const f = c.zoom / TWIPS_PER_CSS_PX;
        const top = r.Top() * f, bottom = (r.Top() + r.Height()) * f, pad = 32;
        if (top - pad < scroller.scrollTop) scroller.scrollTop = Math.max(0, top - pad);
        else if (bottom + pad > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom + pad - scroller.clientHeight;
        const left = r.Left() * f;
        if (left - pad < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left - pad);
        else if (left + pad > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left + pad - scroller.clientWidth;
      }
    }
    const v = view();
    const w = Math.round(v.width * v.dpr), h = Math.round(v.height * v.dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const doc = c.sh.m_pDoc;
    PaintView(canvas.getContext('2d', { alpha: false })!, c.sh, v, palette(matchMedia('(prefers-color-scheme: dark)').matches, c.showControlCodes, c.sh.m_pRoot.m_bShowComments), caretOn.current && focused.current, (k, a) => c.graphics.Get(doc, k, a), flyDrag.current?.moved ? flyDrag.current.cur : null);
    placeInput(v);
  };

  /** Keeps the textarea at the caret so IME candidate windows open in the right place. */
  const placeInput = (v: View) => {
    const r = c.sh.GetCharRect(), el = inputRef.current;
    if (!r || !el) return;
    const f = c.zoom / TWIPS_PER_CSS_PX;
    el.style.left = `${(r.Left() - v.scrollX) * f}px`;
    el.style.top = `${(r.Top() - v.scrollY) * f}px`;
    el.style.height = `${r.Height() * f}px`;
    el.style.fontSize = `${(c.sh.GetAttr('RES_CHRATR_FONTSIZE') * f)}px`;
  };

  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(paint); };
  const restartBlink = () => { caretOn.current = true; schedule(); };
  /** Call after a cursor or content change: resets blink, scrolls to the caret, refreshes the UI. */
  const moved = () => { revealCaret.current = true; restartBlink(); c.notify(); };

  useLayoutEffect(paint);

  useEffect(() => {
    c.onEdit = () => { revealCaret.current = true; caretOn.current = true; schedule(); };
    c.graphics.onLoaded = schedule;
    c.focusEditor = () => inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.focus({ preventScroll: true });
    const blink = setInterval(() => {
      if (!focused.current) return;
      caretOn.current = !caretOn.current;
      schedule();
    }, BLINK_MS);
    const ro = new ResizeObserver(schedule);
    ro.observe(scrollerRef.current!);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', schedule);
    return () => { clearInterval(blink); ro.disconnect(); mq.removeEventListener('change', schedule); };
    // The controller instance is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { schedule(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The popup menu of the topmost shell (RegisterPopupMenu): the selected object's (draw, OLE
   * object, graphic, frame), a shape's text being edited (drawtext), a table's, else the text's.
   */
  const popupName = (): string => {
    const sh = c.sh;
    if (sh.IsFrameSelected()) {
      const fmt = sh.GetFlyFrameFormat();
      return fmt?.m_pShape ? 'draw' : fmt?.m_pMath ? 'oleobject' : fmt?.graphic !== undefined ? 'graphic' : 'frame';
    }
    const cur = sh.GetCurrFlyName();
    if (cur && sh.GetFlyFrameFormat(cur)?.m_pShape) return 'drawtext';
    return sh.IsCursorInTable() ? 'table' : 'text';
  };
  /** SwEditWin's CommandEventId::ContextMenu from the keyboard: the menu at the caret. */
  const contextMenuAtCaret = () => {
    const r = c.sh.IsFrameSelected() ? c.sh.GetFlyRect() : c.sh.GetCharRect();
    const s = scrollerRef.current;
    if (!r || !s) return;
    const v = view(), f = c.zoom / TWIPS_PER_CSS_PX, b = s.getBoundingClientRect();
    setSpellMenu(null);
    setCtxMenu({ name: popupName(), x: b.left + (r.Left() - v.scrollX) * f, y: b.top + (r.Bottom() - v.scrollY) * f });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return;
    const sh = c.sh;
    // The context menu key and Shift+F10 open the context menu at the caret.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)) { e.preventDefault(); contextMenuAtCaret(); return; }
    const ext = e.shiftKey;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const wordMod = isMac ? e.altKey : e.ctrlKey;
    const pageHeight = (scrollerRef.current!.clientHeight * TWIPS_PER_CSS_PX) / c.zoom;
    // Escape leaves the draw function without drawing.
    if (e.key === 'Escape' && c.drawShape) { e.preventDefault(); flyDrag.current = null; c.setDrawShape(null); return; }
    // Escape ends cropping, keeping the image selected.
    if (e.key === 'Escape' && c.chainMode) { e.preventDefault(); c.setChainMode(false); return; }
    if (e.key === 'Escape' && c.cropMode) { e.preventDefault(); flyDrag.current = null; c.setCropMode(false); return; }
    if (e.key === 'Escape' && c.rotateMode) { e.preventDefault(); flyDrag.current = null; c.setRotateMode(false); return; }
    if (sh.IsFrameSelected()) {
      // SwEditWin::KeyInput with a selected object: delete it, leave it, or nudge it by 1 mm.
      const r = sh.GetFlyRect();
      const nudge = e.altKey ? 15 : 57;
      let done = true;
      switch (e.key) {
        case 'Delete': case 'Backspace': sh.DelSelectedFly(); break;
        case 'Escape': sh.SelectFly(null); break;
        case 'ArrowLeft': if (r) sh.MoveFly(r.Left() - nudge, r.Top()); break;
        case 'ArrowRight': if (r) sh.MoveFly(r.Left() + nudge, r.Top()); break;
        case 'ArrowUp': if (r) sh.MoveFly(r.Left(), r.Top() - nudge); break;
        case 'ArrowDown': if (r) sh.MoveFly(r.Left(), r.Top() + nudge); break;
        case 'Enter': {
          // A selected text frame is entered for editing.
          const fmt = sh.GetFlyFrameFormat();
          const sec = fmt?.m_sContentId ? sh.m_pDoc.GetNodes().FindFlySection(fmt.m_sContentId) : null;
          const first = sec && sh.m_pDoc.GetNodes().GoNext(sec.GetIndex());
          sh.SelectFly(null);
          if (first) sh.SelectRange(first, 0, 0);
          break;
        }
        case 'Tab': done = false; break;
        default: done = false;
      }
      if (done) { e.preventDefault(); moved(); return; }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) sh.SelectFly(null);
    }
    // Escape in a text frame's text selects the frame (SwEditWin, KEY_ESCAPE in a fly).
    if (e.key === 'Escape' && !sh.HasSelection() && sh.GetCurrFlyName()) { sh.SelectFly(sh.GetCurrFlyName()); e.preventDefault(); moved(); return; }
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': if (isMac && mod) sh.LeftMargin(ext); else if (wordMod) sh.PrevWord(ext); else sh.VisualLeft(ext); break;
      case 'ArrowRight': if (isMac && mod) sh.RightMargin(ext); else if (wordMod) sh.NextWord(ext); else sh.VisualRight(ext); break;
      case 'ArrowUp': if (isMac && mod) sh.SttDoc(ext); else sh.Up(ext); break;
      case 'ArrowDown': if (isMac && mod) sh.EndDoc(ext); else sh.Down(ext); break;
      case 'Home': if (mod) sh.SttDoc(ext); else sh.LeftMargin(ext); break;
      case 'End': if (mod) sh.EndDoc(ext); else sh.RightMargin(ext); break;
      case 'PageUp': sh.PageUp(ext, pageHeight); break;
      case 'PageDown': sh.PageDown(ext, pageHeight); break;
      case 'Backspace':
        // SwEditWin: at the start of a counted list entry, Backspace first removes its number.
        if (!wordMod && !sh.HasSelection() && sh.IsSttPara() && sh.GetNumRuleAtCurrCursorPos() && sh.NumOrNoNum(false)) break;
        if (wordMod) sh.DelPrevWord(); else sh.DelLeft();
        break;
      case 'Delete': if (wordMod) sh.DelNextWord(); else sh.DelRight(); break;
      case 'Enter':
        if (mod) { handled = dispatch(c, '.uno:InsertPagebreak'); break; }
        // RETURN and empty paragraph in numbering -> end numbering
        if (!ext && !sh.HasSelection() && sh.GetNumRuleAtCurrCursorPos() && sh.IsSttPara() && sh.IsEndPara()) { sh.DelNumRules(); break; }
        if (ext) sh.InsertLineBreak(); else sh.SplitNode();
        break;
      case 'Tab':
        if (mod || e.altKey) { handled = false; break; }
        // At the start of a list entry, Tab demotes and Shift+Tab promotes it.
        if (sh.GetNumRuleAtCurrCursorPos() && sh.IsSttPara() && !sh.HasSelection()) { sh.NumUpDown(!ext); break; }
        // In a table, Tab moves to the next cell (adding a row after the last) and Shift+Tab back.
        if (sh.IsCursorInTable()) { if (ext) sh.GoPrevCell(); else sh.GoNextCell(); break; }
        sh.Insert('\t');
        break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); moved(); return; }
    // Clipboard shortcuts must stay native: only they carry the permission to touch the clipboard.
    if (mod && !e.altKey && ['KeyC', 'KeyX', 'KeyV'].includes(e.code)) return;
    const cmd = commandForKey(eventKeyName(e.nativeEvent));
    if (cmd && dispatch(c, cmd)) { e.preventDefault(); moved(); }
  };

  const commitInput = () => {
    const el = inputRef.current!;
    if (composing.current || !el.value) return;
    c.sh.Insert(el.value);
    el.value = '';
    moved();
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (spellMenu) setSpellMenu(null);
    if (e.button !== 0) return;
    // Scrollbars live inside the scroller's box but outside its client area.
    const s = scrollerRef.current!, r = s.getBoundingClientRect();
    if (e.clientX - r.left >= s.clientWidth || e.clientY - r.top >= s.clientHeight) return;
    e.preventDefault();
    inputRef.current!.focus({ preventScroll: true });
    const now = performance.now(), k = clicks.current;
    k.n = now - k.at < MULTI_CLICK_MS && Math.abs(e.clientX - k.x) < 4 && Math.abs(e.clientY - k.y) < 4 ? k.n + 1 : 1;
    k.at = now; k.x = e.clientX; k.y = e.clientY;
    // SwEditWin::MouseButtonDown with a draw function: the drag draws the new shape.
    const p = toDoc(e);
    // SwEditWin chain mode: a click on a frame links the selected one to it (FN_FRAME_CHAIN).
    if (c.chainMode) {
      const target = c.sh.m_pRoot.GetFlyAt(p);
      c.setChainMode(false);
      if (target && c.sh.Chainable(target.fmt.m_aName) === SwChainRet.OK) c.sh.Chain(target.fmt.m_aName);
      moved();
      return;
    }
    if (c.drawShape) {
      const r0 = new SwRect(p.X(), p.Y(), 0, 0);
      flyDrag.current = { handle: -1, start: p, rect: r0, cur: r0, moved: false, keepRatio: false, create: c.drawShape };
      return;
    }
    // A selected object's handle resizes it; a click on an object selects it and may start a move.
    const h = handleAt(p);
    const fly = h < 0 ? flyAt(p) : null;
    if (h >= 0 || fly) {
      const prevSel = c.sh.GetFlyFrameFormat()?.m_aName;
      if (fly) c.sh.SelectFly(fly.fmt.m_aName);
      const rect = c.sh.GetFlyRect()!;
      const fmt = c.sh.GetFlyFrameFormat()!;
      if (k.n === 2 && fly) {
        // A double click edits a shape's text (SdrBeginTextEdit), and opens other objects' dialog.
        if (fly.fmt.m_pShape && c.sh.EditShapeText(fly.fmt.m_aName)) { moved(); return; }
        // A formula opens its editor (the Math object's in-place activation).
        if (fly.fmt.m_pMath) { c.setDialog('formula'); return; }
        c.setDialog('fly');
        return;
      }
      // Graphics keep their proportions when resized by a corner (SdrDragResize with KeepRatio).
      const canMove = h >= 0 || fmt.m_aAnchor.m_eAnchorId !== RndStdIds.FLY_AS_CHAR;
      // Cropping (SdrDragCrop) moves the edges freely and never moves the image.
      if (c.cropMode && fly && fly.fmt.m_aName !== prevSel) c.setCropMode(false);
      if (c.rotateMode && fly && fly.fmt.m_aName !== prevSel) c.setRotateMode(false);
      // SdrDragRotate: a handle turns the object about its centre.
      if (c.rotateMode && h >= 0) { flyDrag.current = { handle: h, start: p, rect, cur: rect, moved: false, keepRatio: false, rotate: 0 }; moved(); return; }
      if (c.cropMode && h < 0) { moved(); return; }
      if (canMove) flyDrag.current = { handle: h, start: p, rect, cur: rect, moved: false, keepRatio: !c.cropMode && fmt.graphic !== undefined && h % 2 === 0 };
      moved();
      return;
    }
    if (c.sh.IsFrameSelected()) c.sh.SelectFly(null);
    if (c.cropMode) c.setCropMode(false);
    if (c.rotateMode) c.setRotateMode(false);
    // Ctrl+click (Cmd+click on macOS) follows a hyperlink, as with Writer's default security option;
    // without that option a plain click does (SwEditWin::MouseButtonUp, IsCtrlClickHyperlink).
    if ((c.ctrlClickHyperlink ? (isMac ? e.metaKey : e.ctrlKey) : !(isMac ? e.metaKey : e.ctrlKey)) && !e.shiftKey && k.n === 1) {
      const hit = c.sh.m_pRoot.GetModelPositionForViewPoint(toDoc(e));
      const link = c.sh.GetINetAttr(hit.node, hit.content);
      if (link && hit.content >= link.start && hit.content < link.end) { c.openURL(link.url); return; }
    }
    c.sh.SetCursor(toDoc(e), e.shiftKey);
    if (k.n === 2) c.sh.SelWrd();
    else if (k.n >= 3) c.sh.SelPara();
    else dragging.current = true;
    moved();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = flyDrag.current;
      if (d) {
        const p = toDoc(e);
        const dx = p.X() - d.start.X(), dy = p.Y() - d.start.Y();
        if (!d.moved && Math.hypot(dx, dy) < tolerance() / 2) return;
        d.moved = true;
        const r = d.rect;
        if (d.rotate !== undefined) {
          const cx = r.Left() + r.Width() / 2, cy = r.Top() + r.Height() / 2;
          const deg = ((Math.atan2(p.Y() - cy, p.X() - cx) - Math.atan2(d.start.Y() - cy, d.start.X() - cx)) * 180) / Math.PI;
          let a = ((Math.round(deg) % 360) + 360) % 360;
          if (e.shiftKey) a = (Math.round(a / 15) * 15) % 360;
          d.rotate = a;
          c.setMessage(t('object.angle', { angle: a }));
          return;
        }
        if (d.create) {
          // Shift keeps the shape square (SdrCreateView with the ortho modifier).
          let w = dx, hh = dy;
          if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
          d.cur = new SwRect(Math.min(d.start.X(), d.start.X() + w), Math.min(d.start.Y(), d.start.Y() + hh), Math.abs(w), Math.abs(hh));
        } else if (d.handle < 0) d.cur = new SwRect(r.Left() + dx, r.Top() + dy, r.Width(), r.Height());
        else {
          // Each handle moves its edges: left (0, 6, 7), right (2, 3, 4), top (0, 1, 2), bottom (4, 5, 6).
          let l = r.Left(), t = r.Top(), rr = r.Left() + r.Width(), b = r.Top() + r.Height();
          if ([0, 6, 7].includes(d.handle)) l = Math.min(rr - 56, l + dx);
          if ([2, 3, 4].includes(d.handle)) rr = Math.max(l + 56, rr + dx);
          if ([0, 1, 2].includes(d.handle)) t = Math.min(b - 56, t + dy);
          if ([4, 5, 6].includes(d.handle)) b = Math.max(t + 56, b + dy);
          if (d.keepRatio || e.shiftKey) {
            const ratio = r.Height() / r.Width();
            const w = rr - l, hh = Math.round(w * ratio);
            if ([0, 1, 2].includes(d.handle)) t = b - hh; else b = t + hh;
          }
          d.cur = new SwRect(l, t, rr - l, b - t);
        }
        schedule();
        return;
      }
      if (!dragging.current) {
        // Hover feedback: resize cursors on handles, a move cursor on objects.
        const s = scrollerRef.current;
        if (s && e.target instanceof Node && s.contains(e.target)) {
          const p = toDoc(e);
          const h = handleAt(p);
          // In chain mode: whether the frame under the pointer can be linked (PointerStyle::Chain or ChainNotAllowed).
          const under = c.chainMode ? c.sh.m_pRoot.GetFlyAt(p) : null;
          s.style.cursor = c.chainMode ? (under && c.sh.Chainable(under.fmt.m_aName) === SwChainRet.OK ? 'copy' : 'not-allowed')
            : c.drawShape ? 'crosshair' : h >= 0 ? HANDLE_CURSORS[h]! : flyAt(p) ? 'move' : '';
          // The styles spotlight's quick help (SwEditWin::RequestHelp, PSCSDFPropsQuickHelp).
          const help = PSCSDFPropsQuickHelp(c.sh, p);
          const tip = !help ? '' : help.kind === 'charStyle' ? help.name : help.kind === 'charDF' ? t('spotlight.chardf')
            : help.df ? `${help.name} + ${t('spotlight.paradf')}` : help.name;
          // SwEditWin::RequestHelp for a hyperlink: STR_CTRLCLICKHYPERLINK or STR_CLICKHYPERLINK.
          let linkTip = '';
          if (!help && !h && !c.chainMode) {
            const hit = c.sh.m_pRoot.GetModelPositionForViewPoint(p);
            const link = hit.node ? c.sh.GetINetAttr(hit.node, hit.content) : null;
            if (link && hit.content >= link.start && hit.content < link.end) {
              linkTip = c.ctrlClickHyperlink ? t('link.ctrlClick', { key: isMac ? '⌘' : 'Ctrl', link: link.url }) : t('link.click', { link: link.url });
              if (!c.ctrlClickHyperlink || (isMac ? e.metaKey : e.ctrlKey)) s.style.cursor = 'pointer';
            }
          }
          if (s.title !== (tip || linkTip)) s.title = tip || linkTip;
        }
        return;
      }
      c.sh.SetCursor(toDoc(e), true);
      moved();
    };
    const up = (e: MouseEvent) => {
      const d = flyDrag.current;
      if (d?.create) {
        flyDrag.current = null;
        const r = d.moved && d.cur.Width() > 56 && d.cur.Height() > 56 ? d.cur : new SwRect(d.start.X(), d.start.Y(), DEFAULT_SHAPE_SIZE, DEFAULT_SHAPE_SIZE);
        c.setDrawShape(null);
        c.sh.InsertShape(d.create, r);
        moved();
        return;
      }
      if (d) {
        flyDrag.current = null;
        if (d.rotate !== undefined) {
          if (d.moved && d.rotate) c.sh.RotateSelection(d.rotate);
          c.setMessage(t('object.rotate'));
          moved();
          return;
        }
        if (d.moved) {
          if (d.handle < 0) c.sh.MoveFly(d.cur.Left(), d.cur.Top());
          else if (c.cropMode) c.sh.CropFly(d.cur);
          else c.sh.SetFlyRect(d.cur);
        }
        moved();
        return;
      }
      if (!dragging.current) return;
      dragging.current = false;
      // Clone Formatting applies to the selection made (or the word clicked) once.
      if (c.formatClipboard) {
        c.sh.PasteFormat(c.formatClipboard, isMac ? e.metaKey : e.ctrlKey);
        c.formatClipboard = null;
        moved();
      }
    };

    // Pinch zoom scales the document view, never the page: trackpad pinches arrive as ctrl+wheel
    // (Chromium, Firefox) or as gesture events (Safari). Both need non-passive listeners.
    const s = scrollerRef.current!;
    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      const r = s.getBoundingClientRect();
      const x = clientX - r.left, y = clientY - r.top;
      // Several events can arrive before a paint: keep the first anchor's document point.
      const doc = zoomAnchor.current?.doc ?? toDoc({ clientX, clientY });
      zoomAnchor.current = { doc, x, y };
      c.setZoom(c.zoom * factor);
      schedule();
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !(isMac && e.metaKey)) return;
      e.preventDefault();
      const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 33 : e.deltaY;
      zoomAt(Math.exp(-Math.max(-30, Math.min(30, dy)) * 0.01), e.clientX, e.clientY);
    };
    let gestureScale = 1;
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    const gestureStart = (e: Event) => { e.preventDefault(); gestureScale = 1; };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      zoomAt(g.scale / gestureScale, g.clientX, g.clientY);
      gestureScale = g.scale;
    };
    s.addEventListener('wheel', wheel, { passive: false });
    s.addEventListener('gesturestart', gestureStart);
    s.addEventListener('gesturechange', gestureChange);
    s.addEventListener('gestureend', gestureStart);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      s.removeEventListener('wheel', wheel);
      s.removeEventListener('gesturestart', gestureStart);
      s.removeEventListener('gesturechange', gestureChange);
      s.removeEventListener('gestureend', gestureStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="editwin" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      // Dropped images are inserted where they are dropped; documents are opened.
      if (f?.type.startsWith('image/')) { c.sh.SetCursor(toDoc(e)); void c.insertImageFile(f); }
      else if (f) void c.openFile(f, null);
    }}>
      <canvas ref={canvasRef} className="editwin-canvas" data-testid="document-canvas" />
      <div ref={scrollerRef} className={`editwin-scroller${c.formatClipboard ? ' paintbrush' : ''}`} onScroll={schedule} onMouseDown={onMouseDown} onContextMenu={(e) => {
        // Comments in the margin keep their own handling.
        if ((e.target as HTMLElement).closest('.comments, .comment')) return;
        e.preventDefault();
        const p = toDoc(e);
        const sh = c.sh;
        // SwEditWin::SelectMenuPosition: an object under the pointer is selected; otherwise the
        // cursor moves there unless the pointer is over the selection (TestCurrPam).
        const fly = flyAt(p);
        if (fly) { if (sh.GetCurrFlyName() !== fly.fmt.m_aName || !sh.IsFrameSelected()) sh.SelectFly(fly.fmt.m_aName); }
        else {
          if (sh.IsFrameSelected()) sh.SelectFly(null);
          const hit = sh.m_pRoot.GetModelPositionForViewPoint(p);
          const pam = sh.m_pCursor;
          const at = (n: SwTextNode, k: number) => n.GetIndex() * 1e6 + k;
          const inSel = sh.HasSelection() && at(hit.node, hit.content) >= at(pam.Start().GetNode(), pam.Start().GetContentIndex()) && at(hit.node, hit.content) <= at(pam.End().GetNode(), pam.End().GetContentIndex());
          if (!inSel) sh.SetCursor(p);
          // SwView::ExecSpellPopup: on a misspelled word, its suggestions instead.
          const w = sh.m_bOnlineSpell ? sh.GetWrongAt(hit.node, hit.content) : null;
          if (w) {
            moved();
            setCtxMenu(null);
            setSpellMenu({ x: e.clientX, y: e.clientY, node: hit.node, w, sugg: c.spell.getSuggestions(w.word, w.lang).slice(0, 8) });
            return;
          }
        }
        moved();
        setSpellMenu(null);
        setCtxMenu({ name: popupName(), x: e.clientX, y: e.clientY });
      }}>
        <div ref={spacerRef} className="editwin-spacer"><Comments c={c} /></div>
      </div>
      {ctxMenu && <ContextMenu key={`${ctxMenu.x},${ctxMenu.y},${ctxMenu.name}`} c={c} name={ctxMenu.name} x={ctxMenu.x} y={ctxMenu.y} close={() => setCtxMenu(null)} />}
      {spellMenu && (
        <div className="spell-menu" role="menu" aria-label="Spelling" style={{ left: Math.min(spellMenu.x, window.innerWidth - 220), top: Math.min(spellMenu.y, window.innerHeight - 300) }}
          onMouseDown={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === 'Escape') setSpellMenu(null); }}>
          {spellMenu.sugg.length ? spellMenu.sugg.map((s) => (
            <button key={s} role="menuitem" className="suggestion" onClick={() => { c.sh.ReplaceWord(spellMenu.node, spellMenu.w.nStart, spellMenu.w.nEnd, s); setSpellMenu(null); moved(); }}>{s}</button>
          )) : <div className="muted">(No suggestions)</div>}
          <hr />
          <button role="menuitem" onClick={() => { c.spell.IgnoreAll(spellMenu.w.word); setSpellMenu(null); schedule(); c.notify(); }}>Ignore All</button>
          <button role="menuitem" onClick={() => { c.addToDictionary(spellMenu.w.word); setSpellMenu(null); }}>Add to Dictionary</button>
          <button role="menuitem" onClick={() => { c.sh.SelectRange(spellMenu.node, spellMenu.w.nStart, spellMenu.w.nEnd); setSpellMenu(null); c.setDialog('spelling'); }}>Spelling…</button>
        </div>
      )}
      <textarea
        ref={inputRef}
        className="editwin-input"
        aria-label="Document text input"
        data-testid="document-input"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={commitInput}
        onFocus={() => { focused.current = true; restartBlink(); }}
        onBlur={() => { focused.current = false; schedule(); }}
        onCompositionStart={() => { composing.current = true; inputRef.current!.classList.add('composing'); }}
        onCompositionEnd={() => {
          composing.current = false;
          inputRef.current!.classList.remove('composing');
          commitInput();
        }}
        onCopy={(e) => { e.preventDefault(); e.clipboardData.setData('text/plain', c.sh.GetSelText()); }}
        onCut={(e) => {
          e.preventDefault();
          e.clipboardData.setData('text/plain', c.sh.GetSelText());
          c.sh.DelSelection();
          moved();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const image = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
          if (image) { void c.insertImageFile(image); return; }
          c.sh.Paste(e.clipboardData.getData('text/plain'));
          moved();
        }}
      />
    </div>
  );
}

export { DOCUMENTBORDER };
