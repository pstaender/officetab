// The document surface: a viewport-sized canvas under a native scroller, plus the hidden textarea
// that receives keyboard, IME and clipboard input. Mirrors the role of upstream's SwEditWin.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { SwTextNode } from '@lo/sw/inc/ndtxt.ts';
import { IsGrammarArea, ProofreadingText, type SwWrongArea } from '@lo/sw/source/core/txtnode/txtedt.ts';
import { Point } from '@lo/tools/source/generic/gen.ts';
import { DEFAULT_MARGIN_HEIGHT, DEFAULT_MARGIN_WIDTH, DOCUMENTBORDER, IsOverHeaderFooterArea } from '@lo/sw/source/core/layout/pagechg.ts';
import { Size } from '@lo/tools/source/generic/gen.ts';
import { FlyHandles, HANDLE_PX, PaintView, TWIPS_PER_CSS_PX, type PaintColors, type PaintView as View } from '@lo/sw/source/core/view/paint.ts';
import { SwRect } from '@lo/sw/inc/swrect.ts';
import { RndStdIds, SwChainRet } from '@lo/sw/inc/frmfmt.ts';
import { MINLAY, type SwTabCols } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { DRAW_TEXT, DRAW_TEXT_VERTICAL, type Controller } from '../controller.ts';
import { dispatch } from '../commands.ts';
import { t } from '../i18n.ts';
import { PSCSDFPropsQuickHelp } from '../../lo/sw/source/uibase/docvw/edtwin2.ts';
import { Comments } from './Comments.tsx';
import { HeaderFooterControls } from './HeaderFooterControls.tsx';
import { useRulers } from './Rulers.tsx';
import { SvxAutoCorrCfg } from '@lo/editeng/source/misc/acorrcfg.ts';
import { ACFlags, SvxAutoCorrect } from '@lo/editeng/source/misc/svxacorr.ts';
import { KEY_END, KEY_RETURN, KEY_RIGHT, KEY_SPACE, KEY_TAB } from '@lo/editeng/source/misc/swafopt.ts';
import { QuickHelpData, ShowAutoCorrectQuickHelp } from '@lo/sw/source/uibase/docvw/edtwin.ts';
import { autoCompleteWords } from '../autocorrect.ts';
import { ContextMenu } from './Bars.tsx';
import { commandForKeyEvent, isMac } from './labels.ts';

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
/**
 * A table column or row border dragged in the document (SwEditWin::MouseButtonDown with
 * WhichMouseTabCol, then the ruler's drag of that border, SvxRuler::DragBorders): `pt` finds the
 * table again, `origin` is the table's left edge (columns) or the row's top (rows), `borders` the
 * column borders from the table's left edge while dragging, and `line` the guide line painted.
 */
interface TabDrag { row: boolean; pt: Point; old: SwTabCols | null; index: number; origin: number; start: number; borders: number[]; line: SwRect; moved: boolean }
/** How near a table border the pointer must be, in CSS pixels (upstream: COLFUZZY / 4, a little more here). */
const TABCOL_FUZZY_PX = 8;
/** The size of a shape created by a click instead of a drag: 2.5 cm. */
const DEFAULT_SHAPE_SIZE = 1417;

export function EditWin({ c, version }: { c: Controller; version: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  /** The frame shown around the object under the pointer, and that object's rectangle. */
  const hoverRef = useRef<HTMLDivElement>(null);
  const hoverRect = useRef<SwRect | null>(null);
  const caretOn = useRef(true);
  const focused = useRef(false);
  const composing = useRef(false);
  const dragging = useRef(false);
  const revealCaret = useRef(false);
  const frame = useRef(0);
  const clicks = useRef({ at: 0, n: 0, x: 0, y: 0 });
  const flyDrag = useRef<FlyDrag | null>(null);
  const tabDrag = useRef<TabDrag | null>(null);
  /** The Caps Lock state and key repetition of the last key (KeyEvent::GetRepeat, the window's indicator state). */
  const capsLock = useRef(false);
  const keyRepeat = useRef(false);
  /** SwEditWin::s_pQuickHlpData: the word completion at the cursor, and where it is shown. */
  const quickHlp = useRef(new QuickHelpData());
  const [quickTip, setQuickTip] = useState<{ text: string; rest: string; tip: boolean; x: number; y: number; h: number; font: string } | null>(null);
  /** The AutoSpell context menu (SwSpellPopup): a misspelled word and where the menu is. */
  const [spellMenu, setSpellMenu] = useState<{ x: number; y: number; node: SwTextNode; w: SwWrongArea; sugg: string[] } | null>(null);
  /** The open context menu: the shell's popup menu name and where it opened. */
  const [ctxMenu, setCtxMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  /** Document point that must stay under the pointer while zooming, applied on the next paint. */
  const zoomAnchor = useRef<{ doc: Point; x: number; y: number } | null>(null);

  /**
   * SwView::IsDocumentBorder: in browse mode the document border is not shown, so the view
   * starts at the page's top left corner.
   */
  const docBorder = () => (c.sh.m_pRoot.m_pViewOpt.getBrowseMode() ? DOCUMENTBORDER : 0);

  const view = (): View => {
    const s = scrollerRef.current!;
    const size = c.sh.m_pRoot.GetDocSize();
    const org = docBorder();
    const width = s.clientWidth, height = s.clientHeight;
    const scaledW = ((size.width - 2 * org) * c.zoom) / TWIPS_PER_CSS_PX;
    // Center the page when the document is narrower than the window.
    const scrollX = scaledW < width ? -((width - scaledW) / 2) * (TWIPS_PER_CSS_PX / c.zoom) + org : (s.scrollLeft * TWIPS_PER_CSS_PX) / c.zoom + org;
    return { scrollX, scrollY: (s.scrollTop * TWIPS_PER_CSS_PX) / c.zoom + org, zoom: c.zoom, dpr: window.devicePixelRatio || 1, width, height };
  };

  const toDoc = (e: { clientX: number; clientY: number }): Point => {
    const r = scrollerRef.current!.getBoundingClientRect();
    const v = view();
    const f = TWIPS_PER_CSS_PX / c.zoom;
    return new Point((e.clientX - r.left) * f + v.scrollX, (e.clientY - r.top) * f + v.scrollY);
  };

  /**
   * SdrSnapView::SnapPos with grid snap (View > Grid and Helplines > Snap to Grid): a point to the
   * nearest point of the fine grid, from the print area of the page it is on (SwDPage's grid frames).
   */
  const snapPos = (x: number, y: number): [number, number] => {
    const o = c.viewOpt;
    if (!o.IsSnap()) return [x, y];
    const root = c.sh.m_pRoot;
    const page = root.pages.find((pg) => pg.aFrame.Contains(new Point(x, y)));
    const org = page ? page.aPrt.Pos() : new Point(0, 0);
    const sz = o.GetSnapSize();
    const fx = sz.Width() / (o.GetDivisionX() + 1), fy = sz.Height() / (o.GetDivisionY() + 1);
    // round instead of trunc
    const snap = (v: number, o0: number, w: number) => (w ? o0 + Math.round((v - o0) / w) * w : v);
    return [Math.round(snap(x, org.X(), fx)), Math.round(snap(y, org.Y(), fy))];
  };

  /** Tolerance for hitting a handle or a frame's border, in twips. */
  const tolerance = () => (HANDLE_PX * TWIPS_PER_CSS_PX) / c.zoom;
  const tabFuzzy = () => (TABCOL_FUZZY_PX * TWIPS_PER_CSS_PX) / c.zoom;
  /**
   * The table border under a point that the mouse can drag (SwFEShell::WhichMouseTabCol): a column
   * border, the table's left or right edge, or a row's bottom.
   */
  const tabBorderAt = (p: Point): TabDrag | null => {
    const fz = tabFuzzy();
    const f = c.sh.GetBox(p, fz);
    if (!f) return null;
    const tab = f.tab.aFrame;
    if (f.bRow) {
      // The border is the bottom of the cell above the point, or of the cell itself.
      const cell = Math.abs(f.cell.aFrame.Top() - p.Y()) <= fz
        ? f.tab.rows.flatMap((r) => r.cells).find((x) => Math.abs(x.aFrame.Bottom() - f.cell.aFrame.Top()) <= fz && x.aFrame.Left() <= p.X() && x.aFrame.Right() >= p.X())
        : f.cell;
      if (!cell) return null;
      const y = cell.aFrame.Bottom();
      return { row: true, pt: p, old: null, index: 0, origin: cell.aFrame.Top(), start: y, borders: [], line: new SwRect(tab.Left(), y, tab.Width(), 0), moved: false };
    }
    const old = c.sh.GetTabCols(f.tab.node);
    if (!old) return null;
    const borders = [old.left, ...old.cols, old.right], x = p.X() - tab.Left();
    let index = 0;
    for (let i = 1; i < borders.length; i++) if (Math.abs(borders[i]! - x) < Math.abs(borders[index]! - x)) index = i;
    if (Math.abs(borders[index]! - x) > fz) return null;
    return { row: false, pt: p, old, index, origin: tab.Left(), start: borders[index]!, borders, line: new SwRect(tab.Left() + borders[index]!, tab.Top(), 0, tab.Height()), moved: false };
  };
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
    const root = c.sh.m_pRoot;
    // SwView::SetBrowseBorder and SwViewShell::VisPortChgd: browse mode pages follow the window.
    const lf = TWIPS_PER_CSS_PX / c.zoom;
    const borderChanged = root.SetBrowseBorder(new Size(Math.round(DEFAULT_MARGIN_WIDTH * lf), Math.round(DEFAULT_MARGIN_HEIGHT * lf)));
    const visChanged = root.VisPortChgd(new Size(Math.round(scroller.clientWidth * lf), Math.round(scroller.clientHeight * lf)));
    if (borderChanged || visChanged) root.Layout();
    const size = root.GetDocSize();
    // The DOM overlays are placed in document coordinates; without the document border (browse
    // mode) the spacer starts that far above and left of the scroller.
    const org = docBorder(), fs = c.zoom / TWIPS_PER_CSS_PX;
    spacer.style.width = `${(size.width - org) * fs}px`;
    // The canvas centres a document narrower than the window; DOM overlays must follow.
    spacer.style.marginLeft = `${Math.max(0, (scroller.clientWidth - (size.width - 2 * org) * fs) / 2) - org * fs}px`;
    spacer.style.marginTop = `${-org * fs}px`;
    spacer.style.height = `${(size.height - org) * fs}px`;
    const anchor = zoomAnchor.current;
    const restore = c.restoreView;
    c.restoreView = null;
    // SwView::ReadUserDataSequence, the document laid out: the cursor and the visible area where it was left.
    let vis = restore ? c.sh.ReadViewData(restore.view) : null;
    if (restore?.node !== undefined) {
      // The browser kept the cursor's place in the text itself.
      const n = c.sh.m_pDoc.GetNodes().node(restore.node);
      if (n?.IsTextNode() && (restore.content ?? 0) <= n.Len()) c.sh.SelectRange(n, restore.content ?? 0, restore.content ?? 0);
      else vis = null;
    }
    if (restore && !vis) revealCaret.current = true;
    if (vis) {
      const f = c.zoom / TWIPS_PER_CSS_PX;
      scroller.scrollTop = Math.max(0, (vis.Y() - org) * f);
      scroller.scrollLeft = Math.max(0, (vis.X() - org) * f);
    } else if (anchor) {
      zoomAnchor.current = null;
      const f = c.zoom / TWIPS_PER_CSS_PX;
      scroller.scrollLeft = (anchor.doc.X() - org) * f - anchor.x;
      scroller.scrollTop = (anchor.doc.Y() - org) * f - anchor.y;
    } else if (revealCaret.current) {
      revealCaret.current = false;
      // SwFEShell::MakeSelVisible: a selected object is shown, not the cursor at its anchor.
      const fly = c.sh.IsFrameSelected() ? c.sh.GetFlyRect() : null;
      const f0 = c.zoom / TWIPS_PER_CSS_PX;
      // An object already partly in view (as when it was just clicked) needs no scrolling.
      const flyInView = !!fly && (fly.Bottom() - org) * f0 > scroller.scrollTop && (fly.Top() - org) * f0 < scroller.scrollTop + scroller.clientHeight;
      const r = fly ?? c.sh.GetCharRect();
      if (r && !flyInView) {
        const f = c.zoom / TWIPS_PER_CSS_PX;
        const top = (r.Top() - org) * f, bottom = (r.Top() + r.Height() - org) * f, pad = 32;
        if (top - pad < scroller.scrollTop) scroller.scrollTop = Math.max(0, top - pad);
        else if (bottom + pad > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom + pad - scroller.clientHeight;
        const left = (r.Left() - org) * f;
        if (left - pad < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left - pad);
        else if (left + pad > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left + pad - scroller.clientWidth;
      }
    }
    const v = view();
    // SwView's visible area, written to the document's view settings.
    c.sh.m_aVisArea = new Point(Math.round(v.scrollX), Math.round(v.scrollY));
    const w = Math.round(v.width * v.dpr), h = Math.round(v.height * v.dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const doc = c.sh.m_pDoc;
    PaintView(canvas.getContext('2d', { alpha: false })!, c.sh, v, palette(matchMedia('(prefers-color-scheme: dark)').matches, c.showControlCodes, c.sh.m_pRoot.m_bShowComments), caretOn.current && focused.current, (k, a) => c.graphics.Get(doc, k, a), flyDrag.current?.moved ? flyDrag.current.cur : tabDrag.current?.moved ? tabDrag.current.line : rulers.handle.trackLine(v));
    rulers.handle.paint(v);
    placeInput(v);
    placeHover();
  };

  /** Shows the hover frame around `r` (in document coordinates), or hides it. */
  const placeHover = (r: SwRect | null = hoverRect.current) => {
    hoverRect.current = r;
    const el = hoverRef.current;
    if (!el) return;
    el.hidden = !r;
    if (!r) return;
    const f = c.zoom / TWIPS_PER_CSS_PX;
    el.style.left = `${r.Left() * f}px`;
    el.style.top = `${r.Top() * f}px`;
    el.style.width = `${r.Width() * f}px`;
    el.style.height = `${r.Height() * f}px`;
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
  // View > Rulers: SwView's horizontal and vertical ruler.
  const rulers = useRulers(c, () => schedule(), () => moved());
  const restartBlink = () => { caretOn.current = true; schedule(); };
  /** Call after a cursor or content change: resets blink, scrolls to the caret, refreshes the UI. */
  const moved = () => { revealCaret.current = true; restartBlink(); c.notify(); };

  useLayoutEffect(paint);

  useEffect(() => {
    c.onEdit = () => { revealCaret.current = true; caretOn.current = true; schedule(); };
    c.graphics.onLoaded = schedule;
    c.onRepaint = schedule;
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
    if (hoverRect.current) placeHover(null);
    const sh = c.sh;
    capsLock.current = e.getModifierState?.('CapsLock') ?? false;
    keyRepeat.current = e.repeat;
    if (quickHelpKey(e)) return;
    // The context menu key and Shift+F10 open the context menu at the caret.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)) { e.preventDefault(); contextMenuAtCaret(); return; }
    const ext = e.shiftKey;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const wordMod = isMac ? e.altKey : e.ctrlKey;
    const pageHeight = (scrollerRef.current!.clientHeight * TWIPS_PER_CSS_PX) / c.zoom;
    // Escape cancels dragging a table border (Ruler::CancelDrag).
    if (e.key === 'Escape' && tabDrag.current) { e.preventDefault(); tabDrag.current = null; schedule(); return; }
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
        if (ext) { checkAutoCorrect(); sh.InsertLineBreak(); }
        //RETURN for new paragraph with AutoFormatting
        else if (SvxAutoCorrCfg.Get().IsAutoFormatByInput() && !sh.IsTableMode()) sh.SplitNode(true);
        else { checkAutoCorrect(); sh.SplitNode(); }
        break;
      case 'Tab':
        if (mod || e.altKey) { handled = false; break; }
        // At the start of a list entry, Tab demotes and Shift+Tab promotes it.
        if (sh.GetNumRuleAtCurrCursorPos() && sh.IsSttPara() && !sh.HasSelection()) { sh.NumUpDown(!ext); break; }
        // In a table, Tab moves to the next cell (adding a row after the last) and Shift+Tab back.
        if (sh.IsCursorInTable()) { if (ext) sh.GoPrevCell(); else sh.GoNextCell(); break; }
        typeText('\t');
        break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); moved(); return; }
    // Clipboard shortcuts must stay native: only they carry the permission to touch the clipboard.
    if (mod && !e.altKey && ['KeyC', 'KeyX', 'KeyV'].includes(e.code)) return;
    const cmd = commandForKeyEvent(e.nativeEvent)?.cmd;
    if (cmd && dispatch(c, cmd)) { e.preventDefault(); moved(); }
    // Save, disabled with autosave on, must not fall through to the browser's Save Page.
    else if (cmd === '.uno:Save') e.preventDefault();
  };

  /** QuickHelpData::Stop: the word completion goes. */
  const stopQuickHelp = () => {
    if (quickHlp.current.m_bIsDisplayed) quickHlp.current.Stop();
    setQuickTip(null);
  };
  /** QuickHelpData::Start: the current candidate as a tip above the cursor, or as inline text after it. */
  const showQuickHelp = () => {
    const q = quickHlp.current, s = scrollerRef.current, r = c.sh.GetCharRect();
    if (!q.m_bIsDisplayed || !q.HasContent() || !s || !r) { setQuickTip(null); return; }
    const v = view(), f = c.zoom / TWIPS_PER_CSS_PX, b = s.getBoundingClientRect();
    setQuickTip({ text: q.CurStr(), rest: q.CurStr().slice(q.CurLen()), tip: q.m_bIsTip, x: b.left + (r.Left() - v.scrollX) * f, y: b.top + (r.Top() - v.scrollY) * f, h: r.Height() * f, font: c.sh.GetAttr('RES_CHRATR_FONT') });
  };
  /** SwEditWin::ShowAutoCorrectQuickHelp after a word character: the completions of the word before the cursor. */
  const autoCompleteAfterTyping = () => {
    const a = c.acorr, flags = a.GetSwFlags();
    const q = quickHlp.current;
    q.ClearContent();
    if (flags.bAutoCompleteWords && !c.sh.HasSelection())
      ShowAutoCorrectQuickHelp(q, c.sh.GetPrevAutoCorrWord(a), true, flags.bAutoCmpltShowAsTip, c.sh.GetAttr('RES_CHRATR_LANGUAGE'), autoCompleteWords);
    showQuickHelp();
  };
  /** The VCL key code (with modifiers) of the keys that may accept a completion. */
  const expandKeyOf = (e: React.KeyboardEvent): number => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return -1;
    return ({ Enter: KEY_RETURN, ' ': KEY_SPACE, Tab: KEY_TAB, ArrowRight: KEY_RIGHT, End: KEY_END } as Record<string, number>)[e.key] ?? -1;
  };
  /** SwEditWin::KeyInput with word completion shown: accept, cycle or dismiss it. */
  const quickHelpKey = (e: React.KeyboardEvent): boolean => {
    const q = quickHlp.current, a = c.acorr;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return false;
    const bNormalKey = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
    // Only a following word character takes the space a completion asked for (m_bAppendSpace).
    if (!bNormalKey) q.m_bAppendSpace = false;
    if (!q.m_bIsDisplayed || !q.HasContent()) return false;
    if (!c.sh.HasSelection() && !c.sh.HasReadonlySel() && !q.m_bIsAutoText && a.GetSwFlags().nAutoCmpltExpandKey === expandKeyOf(e)) {
      // SwKeyState::GlossaryExpand: the rest of the word is inserted
      e.preventDefault();
      const sFnd = q.CurStr().slice(q.CurLen());
      const nUndo = c.sh.StartUndo();
      c.sh.Insert(sFnd);
      c.sh.EndUndo(nUndo);
      stopQuickHelp();
      q.m_bAppendSpace = a.GetSwFlags().bAutoCmpltAppendBlank;
      moved();
      return true;
    }
    if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
      // SwKeyState::NextPrevGlossary
      e.preventDefault();
      if (e.shiftKey) q.Previous(a.GetSwFlags().bAutoCmpltEndless); else q.Next(a.GetSwFlags().bAutoCmpltEndless);
      showQuickHelp();
      return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); stopQuickHelp(); return true; }
    if (!bNormalKey) stopQuickHelp();
    return false;
  };
  /** SwKeyState::CheckAutoCorrect: the word before the cursor is finished without a character. */
  const checkAutoCorrect = () => {
    const a = c.acorr;
    if (SvxAutoCorrCfg.Get().IsAutoFormatByInput() &&
      a.IsAutoCorrFlag(ACFlags.CapitalStartSentence | ACFlags.CapitalStartWord |
        ACFlags.ChgOrdinalNumber | ACFlags.TransliterateRTL |
        ACFlags.ChgToEnEmDash | ACFlags.SetINetAttr |
        ACFlags.Autocorrect | ACFlags.SetDOIAttr) &&
      !c.sh.HasReadonlySel())
      c.sh.AutoCorrect(a, '');
  };
  /**
   * SwEditWin::KeyInput for typed characters (SwKeyState::InsChar): characters that end a word go
   * through AutoCorrect, the others are inserted together (m_aInBuffer and FlushInBuffer).
   */
  const typeText = (text: string) => {
    const sh = c.sh, cfg = SvxAutoCorrCfg.Get(), pACorr = cfg.GetAutoCorrect();
    const q = quickHlp.current;
    let buf = '';
    const FlushInBuffer = () => { if (buf) { sh.Insert(buf); buf = ''; } };
    let bLastNormal = false;
    for (const aCh of text) {
      const bIsNormalChar = /^[\p{L}\p{N}]$/u.test(aCh);
      if (q.m_bAppendSpace && bIsNormalChar && (buf || !sh.IsSttPara() || !sh.IsEndPara())) {
        // insert a blank ahead of the character. this ends up
        // between the expanded text and the new "non-word-separator".
        buf += ' ';
      }
      q.m_bAppendSpace = false;
      const bIsAutoCorrectChar = SvxAutoCorrect.IsAutoCorrectChar(aCh);
      const bRepeat = keyRepeat.current;
      if (!bRepeat && (bIsAutoCorrectChar || sh.m_bNbspRunNext.value) &&
        cfg.IsAutoFormatByInput() &&
        ((pACorr.IsAutoCorrFlag(ACFlags.ChgWeightUnderl) &&
          ('*' === aCh || '_' === aCh)) ||
          (pACorr.IsAutoCorrFlag(ACFlags.ChgQuotes) && ('"' === aCh)) ||
          (pACorr.IsAutoCorrFlag(ACFlags.ChgSglQuotes) && ('\'' === aCh)))) {
        FlushInBuffer();
        sh.AutoCorrect(pACorr, aCh, capsLock.current);
      } else if (!bRepeat && (bIsAutoCorrectChar || sh.m_bNbspRunNext.value) &&
        cfg.IsAutoFormatByInput() &&
        pACorr.IsAutoCorrFlag(ACFlags.CapitalStartSentence | ACFlags.CapitalStartWord |
          ACFlags.ChgOrdinalNumber | ACFlags.AddNonBrkSpace |
          ACFlags.ChgToEnEmDash | ACFlags.SetINetAttr |
          ACFlags.Autocorrect | ACFlags.TransliterateRTL |
          ACFlags.SetDOIAttr) &&
        '"' !== aCh && '\'' !== aCh && '*' !== aCh && '_' !== aCh) {
        FlushInBuffer();
        sh.AutoCorrect(pACorr, aCh, capsLock.current);
      } else {
        buf += aCh;
      }

      const bIsSpace = (aCh === ' ');
      if (bIsSpace) {
        FlushInBuffer();
        // do the formatting only for few starting characters (for "* " or "- " conversion)
        if (sh.m_pCursor.GetPoint().GetContentIndex() < 3) {
          const rFlags = pACorr.GetSwFlags();
          if (cfg.IsAutoFormatByInput() && rFlags.bSetNumRule && rFlags.bSetNumRuleAfterSpace) {
            // Make a copy of the flags but disable all the ones that aren't relevant to
            // the bullet formatting so that we don't apply any other formatting such as
            // deleting the trailing space. See tdf#171135.
            const aFlags = rFlags.Clone();
            aFlags.resetAllFlags();
            aFlags.bSetNumRule = true;
            aFlags.bSetNumRuleAfterSpace = true;
            aFlags.bAFormatByInput = rFlags.bAFormatByInput;
            aFlags.bWithRedlining = rFlags.bWithRedlining;
            aFlags.bChgEnumNum = rFlags.bChgEnumNum;
            sh.AutoFormat(aFlags, true);
          }
        }
      }
      bLastNormal = bIsNormalChar;
    }
    FlushInBuffer();
    if (bLastNormal && !keyRepeat.current) autoCompleteAfterTyping();
    else stopQuickHelp();
  };

  /** The composition box (dead keys, IMEs) as wide as the text being composed, not a fixed width. */
  const measureCtx = useRef<CanvasRenderingContext2D | null>(null);
  const sizeComposition = () => {
    const el = inputRef.current;
    if (!el) return;
    if (!composing.current) { el.style.width = ''; return; }
    const ctx = measureCtx.current ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.font = getComputedStyle(el).font;
    el.style.width = `${Math.max(2, Math.ceil(ctx.measureText(el.value).width) + 2)}px`;
  };

  const commitInput = () => {
    const el = inputRef.current!;
    if (composing.current || !el.value) return;
    const text = el.value;
    el.value = '';
    typeText(text);
    moved();
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (spellMenu) setSpellMenu(null);
    if (quickTip) stopQuickHelp();
    if (e.button !== 0) return;
    // Scrollbars live inside the scroller's box but outside its client area.
    const s = scrollerRef.current!, r = s.getBoundingClientRect();
    if (e.clientX - r.left >= s.clientWidth || e.clientY - r.top >= s.clientHeight) return;
    e.preventDefault();
    inputRef.current!.focus({ preventScroll: true });
    placeHover(null);
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
    // A single click on a table's column or row border drags it (SwEditWin::MouseButtonDown,
    // WhichMouseTabCol and RulerColumnDrag); the cursor stays where it is.
    const border = h < 0 && !fly && k.n === 1 ? tabBorderAt(p) : null;
    if (border) {
      if (c.sh.IsFrameSelected()) c.sh.SelectFly(null);
      tabDrag.current = border;
      return;
    }
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
      // SwWrtShell::ClickToField: a reference field, clicked as a hyperlink is, goes to what it refers to.
      const ref = hit.node ? c.sh.GetRefFieldAt(hit.node, hit.content) : null;
      if (ref && c.sh.GotoRefMark(ref.name ?? '', ref.subType ?? 0, ref.seqNo ?? 0)) { moved(); return; }
    }
    // A plain click on a check box form field toggles it (SwEditWin::MouseButtonUp, IsAttrAtPos::FormControl).
    if (!e.shiftKey && k.n === 1 && !(isMac ? e.metaKey : e.ctrlKey)) {
      const hit = c.sh.m_pRoot.GetModelPositionForViewPoint(toDoc(e));
      const at = hit.node ? c.sh.GetFormCheckboxAt(hit.node, hit.content) : null;
      if (hit.node && at !== null) { c.sh.ToggleFormCheckbox(hit.node, at); moved(); return; }
      // SwWrtShell::ClickToField: a click on an input field opens its Input Field dialog.
      const inp = hit.node ? c.sh.GetInputFieldAt(hit.node, hit.content) : null;
      if (hit.node && inp !== null) { c.StartInputFieldDlg(hit.node.GetIndex(), inp); return; }
    }
    // SwEditWin::MouseButtonDown: a click in a page's header (footer) area shows the header (footer)
    // controls; in an area without one it toggles them, unless the cursor is in a header (footer)
    // already; a click elsewhere hides them. Showing the footer's keeps the cursor where it is (tdf#84929).
    if (k.n === 1 && !e.shiftKey && !c.sh.m_pRoot.m_pViewOpt.getBrowseMode()) {
      const page = c.sh.m_pRoot.GetPageAt(p);
      const eControl = page ? IsOverHeaderFooterArea(page, p) : null;
      if (eControl) {
        const bActive = eControl === 'header' ? !!page.aHeader : !!page.aFooter;
        if (!bActive) {
          const n = c.sh.m_pCursor.GetPoint().GetNode();
          if (!(eControl === 'header' ? n.FindHeaderStartNode() : n.FindFooterStartNode())) {
            const bSeparatorWasVisible = eControl === 'header' ? c.sh.m_bShowHeaderSeparator : c.sh.m_bShowFooterSeparator;
            c.sh.SetShowHeaderFooterSeparator(eControl, !bSeparatorWasVisible);
            c.notify();
            if (eControl === 'footer' && !bSeparatorWasVisible) return;
          }
        } else {
          c.sh.SetShowHeaderFooterSeparator('header', eControl === 'header');
          c.sh.SetShowHeaderFooterSeparator('footer', eControl === 'footer');
        }
      } else {
        c.sh.SetShowHeaderFooterSeparator('header', false);
        c.sh.SetShowHeaderFooterSeparator('footer', false);
      }
    }
    c.sh.SetCursor(toDoc(e), e.shiftKey);
    if (k.n === 2) c.sh.SelWrd();
    else if (k.n >= 3) c.sh.SelPara();
    else dragging.current = true;
    moved();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const td = tabDrag.current;
      if (td) {
        const p = toDoc(e);
        const pos = td.row ? p.Y() : p.X() - td.origin;
        if (!td.moved && Math.abs(pos - td.start) < tabFuzzy() / 2) return;
        td.moved = true;
        if (td.row) {
          // A row is at least as high as a cell's smallest content (SwDoc::SetTabRows has no lower limit here).
          const y = Math.max(td.origin + MINLAY, p.Y());
          td.line = new SwRect(td.line.Left(), y, td.line.Width(), 0);
        } else {
          // SvxRuler::EvalModifier: Shift moves the borders to the right with it (OBJECT_SIZE_LINEAR),
          // Ctrl (Cmd on macOS) resizes the columns to the right proportionally (OBJECT_SIZE_PROPORTIONAL),
          // otherwise only this border moves, and never past its neighbours (RulerDragSize::Move).
          const old = td.old!, b = [old.left, ...old.cols, old.right], i = td.index, last = b.length - 1;
          const rightMax = Math.max(old.right, old.rightMax);
          const prev = b[i - 1]! + MINLAY;
          let nb: number[];
          if (i === 0) {
            // The left edge moves the table's left side, not past its area's left edge (or, for a
            // table already further left, its own) nor its first column's right border.
            const at = Math.min(Math.max(pos, Math.min(0, old.leftMin ?? 0)), b[1]! - MINLAY);
            nb = b.map((x, j) => (j === 0 ? at : x));
          } else if (e.shiftKey) {
            const diff = Math.min(Math.max(pos, prev) - b[i]!, rightMax - old.right);
            nb = b.map((x, j) => (j >= i ? x + diff : x));
          } else if (isMac ? e.metaKey : e.ctrlKey) {
            if (i === last) {
              const r = Math.min(Math.max(pos, b.length * MINLAY), rightMax);
              nb = b.map((x) => (x * r) / old.right);
            } else {
              const at = Math.min(Math.max(pos, prev), old.right - (last - i) * MINLAY);
              nb = b.map((x, j) => (j < i ? x : j === last ? x : at + ((x - b[i]!) * (old.right - at)) / (old.right - b[i]!)));
            }
          } else {
            const at = Math.min(Math.max(pos, prev), i === last ? rightMax : b[i + 1]! - MINLAY);
            nb = b.map((x, j) => (j === i ? at : x));
          }
          td.borders = nb.map((x) => Math.round(x));
          td.line = new SwRect(td.origin + td.borders[i]!, td.line.Top(), 0, td.line.Height());
        }
        schedule();
        return;
      }
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
          const [sx, sy] = snapPos(d.start.X(), d.start.Y());
          let [ex, ey] = snapPos(d.start.X() + w, d.start.Y() + hh);
          if (e.shiftKey) { const m = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)); ex = sx + Math.sign(w || 1) * m; ey = sy + Math.sign(hh || 1) * m; }
          d.cur = new SwRect(Math.min(sx, ex), Math.min(sy, ey), Math.abs(ex - sx), Math.abs(ey - sy));
        } else if (d.handle < 0) {
          // SdrDragMove snaps the object's top left corner.
          const [sx, sy] = snapPos(r.Left() + dx, r.Top() + dy);
          d.cur = new SwRect(sx, sy, r.Width(), r.Height());
        } else {
          // Each handle moves its edges: left (0, 6, 7), right (2, 3, 4), top (0, 1, 2), bottom (4, 5, 6).
          let l = r.Left(), t = r.Top(), rr = r.Left() + r.Width(), b = r.Top() + r.Height();
          if ([0, 6, 7].includes(d.handle)) l = Math.min(rr - 56, l + dx);
          if ([2, 3, 4].includes(d.handle)) rr = Math.max(l + 56, rr + dx);
          if ([0, 1, 2].includes(d.handle)) t = Math.min(b - 56, t + dy);
          if ([4, 5, 6].includes(d.handle)) b = Math.max(t + 56, b + dy);
          // SdrDragResize snaps the dragged corner or edge.
          [l, t] = [[0, 6, 7].includes(d.handle) ? snapPos(l, t)[0] : l, [0, 1, 2].includes(d.handle) ? snapPos(l, t)[1] : t];
          [rr, b] = [[2, 3, 4].includes(d.handle) ? snapPos(rr, b)[0] : rr, [4, 5, 6].includes(d.handle) ? snapPos(rr, b)[1] : b];
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
          // The object a click would select gets a subtle frame, unless it is selected already.
          const hovered = flyAt(p);
          const outline = hovered && h < 0 && !c.chainMode && !c.drawShape && !(c.sh.IsFrameSelected() && c.sh.GetFlyFrameFormat()?.m_aName === hovered.fmt.m_aName) ? hovered.aFrame : null;
          const was = hoverRect.current;
          if (!outline !== !was || (outline && was && (outline.Left() !== was.Left() || outline.Top() !== was.Top() || outline.Width() !== was.Width() || outline.Height() !== was.Height()))) placeHover(outline);
          // In chain mode: whether the frame under the pointer can be linked (PointerStyle::Chain or ChainNotAllowed).
          const under = c.chainMode ? c.sh.m_pRoot.GetFlyAt(p) : null;
          s.style.cursor = c.chainMode ? (under && c.sh.Chainable(under.fmt.m_aName) === SwChainRet.OK ? 'copy' : 'not-allowed')
            : c.drawShape ? 'crosshair' : h >= 0 ? HANDLE_CURSORS[h]! : hovered ? 'move'
            // SwEditWin::changeMousePointer: HSizeBar over a column border, VSizeBar over a row's.
            : (() => { const b = tabBorderAt(p); return !b ? '' : b.row ? 'row-resize' : 'col-resize'; })();
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
        } else if (hoverRect.current) placeHover(null);
        return;
      }
      c.sh.SetCursor(toDoc(e), true);
      moved();
    };
    const up = (e: MouseEvent) => {
      const td = tabDrag.current;
      if (td) {
        tabDrag.current = null;
        if (td.moved) {
          const fz = tabFuzzy();
          if (td.row) c.sh.SetMouseTabRows(td.line.Top() - td.start, td.pt, fz);
          else {
            const b = td.borders;
            c.sh.SetMouseTabCols(td.old!, { ...td.old!, left: b[0]!, cols: b.slice(1, -1), right: b[b.length - 1]! }, td.pt, fz);
          }
        }
        moved();
        return;
      }
      const d = flyDrag.current;
      if (d?.create) {
        flyDrag.current = null;
        const dragged = d.moved && d.cur.Width() > 56 && d.cur.Height() > 56;
        c.setDrawShape(null);
        // SID_DRAW_TEXT and SID_DRAW_TEXT_VERTICAL: a text object, its text edited at once. A click
        // makes one a line long that grows with its text.
        if (d.create === DRAW_TEXT || d.create === DRAW_TEXT_VERTICAL) {
          const bVert = d.create === DRAW_TEXT_VERTICAL;
          c.sh.InsertDrawText(dragged ? d.cur : new SwRect(d.start.X(), d.start.Y(), bVert ? 56 : 2 * DEFAULT_SHAPE_SIZE, bVert ? 2 * DEFAULT_SHAPE_SIZE : 56), bVert);
        } else c.sh.InsertShape(d.create, dragged ? d.cur : new SwRect(d.start.X(), d.start.Y(), DEFAULT_SHAPE_SIZE, DEFAULT_SHAPE_SIZE));
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
    <div className="editwin" style={{ '--ruler-h': `${rulers.top}px`, '--ruler-v': `${rulers.left}px` } as React.CSSProperties} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      // Dropped images are inserted where they are dropped; documents are opened.
      if (f?.type.startsWith('image/')) { c.sh.SetCursor(toDoc(e)); void c.insertImageFile(f); }
      else if (f) void c.openFile(f, null);
    }}>
      {rulers.elements}
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
            setSpellMenu({ x: e.clientX, y: e.clientY, node: hit.node, w, sugg: (w.pError ? w.pError.aSuggestions : c.spell.getSuggestions(w.word, w.lang)).slice(0, 8) });
            return;
          }
        }
        moved();
        setSpellMenu(null);
        setCtxMenu({ name: popupName(), x: e.clientX, y: e.clientY });
      }}>
        <div ref={spacerRef} className="editwin-spacer"><div ref={hoverRef} className="editwin-hover" hidden /><Comments c={c} /><HeaderFooterControls c={c} /></div>
      </div>
      {ctxMenu && <ContextMenu key={`${ctxMenu.x},${ctxMenu.y},${ctxMenu.name}`} c={c} name={ctxMenu.name} x={ctxMenu.x} y={ctxMenu.y} close={() => setCtxMenu(null)} />}
      {quickTip && (quickTip.tip
        ? <div className="quickhelp-tip" role="tooltip" style={{ left: quickTip.x, top: quickTip.y }}>{quickTip.text}</div>
        : <div className="quickhelp-inline" aria-hidden="true" style={{ left: quickTip.x, top: quickTip.y, height: quickTip.h, lineHeight: `${quickTip.h}px`, fontSize: quickTip.h * 0.8, fontFamily: quickTip.font }}>{quickTip.rest}</div>)}
      {spellMenu && (
        <div className="spell-menu" role="menu" aria-label={IsGrammarArea(spellMenu.w) ? t('spell.grammar') : t('spell.spelling')} style={{ left: Math.min(spellMenu.x, window.innerWidth - 260), top: Math.min(spellMenu.y, window.innerHeight - 300) }}
          onMouseDown={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === 'Escape') setSpellMenu(null); }}>
          {/* SwSpellPopup for a grammar result: the error's short comment first. */}
          {spellMenu.w.pError && IsGrammarArea(spellMenu.w) && <div className="spell-comment">{spellMenu.w.pError.aShortComment}</div>}
          {spellMenu.sugg.length ? spellMenu.sugg.map((s) => (
            <button key={s} role="menuitem" className="suggestion" onClick={() => { c.sh.ReplaceWord(spellMenu.node, spellMenu.w.nStart, spellMenu.w.nEnd, s); setSpellMenu(null); moved(); }}>{s}</button>
          )) : <div className="muted">{t('spell.noSuggestions')}</div>}
          <hr />
          {IsGrammarArea(spellMenu.w) ? <>
            {/* .uno:SpellCheckIgnore and .uno:SpellCheckIgnoreAll with Type=Grammar. */}
            <button role="menuitem" onClick={() => { c.grammar?.IgnoreGrammarErrorAt(ProofreadingText(spellMenu.node), spellMenu.w.pError!); setSpellMenu(null); schedule(); }}>{t('spell.ignore')}</button>
            <button role="menuitem" onClick={() => { c.grammar?.ignoreRule(spellMenu.w.pError!.aRuleIdentifier); setSpellMenu(null); schedule(); }}>{t('spell.ignoreAll')}</button>
          </> : <>
            <button role="menuitem" onClick={() => { c.spell.IgnoreAll(spellMenu.w.word); setSpellMenu(null); schedule(); c.notify(); }}>{t('spell.ignoreAll')}</button>
            <button role="menuitem" onClick={() => { c.addToDictionary(spellMenu.w.word); setSpellMenu(null); }}>{t('spell.addToDictionary')}</button>
          </>}
          <button role="menuitem" onClick={() => { c.sh.SelectRange(spellMenu.node, spellMenu.w.nStart, spellMenu.w.nEnd); setSpellMenu(null); c.setDialog('spelling'); }}>{t('spell.dialog')}</button>
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
        onInput={() => { sizeComposition(); commitInput(); }}
        onFocus={() => { focused.current = true; restartBlink(); }}
        onBlur={() => { focused.current = false; schedule(); }}
        onCompositionStart={() => { composing.current = true; inputRef.current!.classList.add('composing'); sizeComposition(); }}
        onCompositionUpdate={sizeComposition}
        onCompositionEnd={() => {
          composing.current = false;
          inputRef.current!.classList.remove('composing');
          sizeComposition();
          commitInput();
        }}
        onCopy={(e) => {
          e.preventDefault();
          // A selected object is copied as itself (SwFEShell::Copy), with HTML and text for other applications.
          const fly = c.sh.IsFrameSelected() ? c.copyFly(false) : null;
          if (fly) { e.clipboardData.setData('text/html', fly.html); e.clipboardData.setData('text/plain', fly.text); return; }
          e.clipboardData.setData('text/plain', c.sh.GetSelText());
        }}
        onCut={(e) => {
          e.preventDefault();
          const fly = c.sh.IsFrameSelected() ? c.copyFly(true) : null;
          if (fly) { e.clipboardData.setData('text/html', fly.html); e.clipboardData.setData('text/plain', fly.text); }
          else {
            e.clipboardData.setData('text/plain', c.sh.GetSelText());
            c.sh.DelSelection();
          }
          moved();
        }}
        onPaste={(e) => {
          e.preventDefault();
          if (c.pasteFly(e.clipboardData.getData('text/html'))) { moved(); return; }
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
