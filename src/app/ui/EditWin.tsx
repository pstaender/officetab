// The document surface: a viewport-sized canvas under a native scroller, plus the hidden textarea
// that receives keyboard, IME and clipboard input. Mirrors the role of upstream's SwEditWin.
import { useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { Point } from '@lo/tools/source/generic/gen.ts';
import { DOCUMENTBORDER } from '@lo/sw/source/core/layout/pagechg.ts';
import { PaintView, TWIPS_PER_CSS_PX, type PaintColors, type PaintView as View } from '@lo/sw/source/core/view/paint.ts';
import type { Controller } from '../controller.ts';
import { dispatch } from '../commands.ts';
import { commandForKey, eventKeyName, isMac } from './labels.ts';

const BLINK_MS = 530;
const MULTI_CLICK_MS = 400;

const palette = (dark: boolean, controlCodes: boolean): PaintColors => ({
  controlCodes: controlCodes ? '#268bd2' : null,
  desk: dark ? '#202226' : '#e9ecef',
  page: '#ffffff',
  pageEdge: dark ? '#0f1012' : '#ced4da',
  text: '#000000',
  selection: 'rgba(31, 111, 235, 0.32)',
  caret: '#000000',
  margin: '#e3e6ea',
  field: '#c0c0c0',
});

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

  const paint = () => {
    frame.current = 0;
    const canvas = canvasRef.current, scroller = scrollerRef.current, spacer = spacerRef.current;
    if (!canvas || !scroller || !spacer) return;
    const size = c.sh.m_pRoot.GetDocSize();
    spacer.style.width = `${(size.width * c.zoom) / TWIPS_PER_CSS_PX}px`;
    spacer.style.height = `${(size.height * c.zoom) / TWIPS_PER_CSS_PX}px`;
    const anchor = zoomAnchor.current;
    if (anchor) {
      zoomAnchor.current = null;
      const f = c.zoom / TWIPS_PER_CSS_PX;
      scroller.scrollLeft = anchor.doc.X() * f - anchor.x;
      scroller.scrollTop = anchor.doc.Y() * f - anchor.y;
    } else if (revealCaret.current) {
      revealCaret.current = false;
      const r = c.sh.GetCharRect();
      if (r) {
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
    PaintView(canvas.getContext('2d', { alpha: false })!, c.sh, v, palette(matchMedia('(prefers-color-scheme: dark)').matches, c.showControlCodes), caretOn.current && focused.current, (k) => c.graphics.Get(doc, k));
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return;
    const sh = c.sh;
    const ext = e.shiftKey;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const wordMod = isMac ? e.altKey : e.ctrlKey;
    const pageHeight = (scrollerRef.current!.clientHeight * TWIPS_PER_CSS_PX) / c.zoom;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': if (isMac && mod) sh.LeftMargin(ext); else if (wordMod) sh.PrevWord(ext); else sh.Left(ext); break;
      case 'ArrowRight': if (isMac && mod) sh.RightMargin(ext); else if (wordMod) sh.NextWord(ext); else sh.Right(ext); break;
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
    if (e.button !== 0) return;
    // Scrollbars live inside the scroller's box but outside its client area.
    const s = scrollerRef.current!, r = s.getBoundingClientRect();
    if (e.clientX - r.left >= s.clientWidth || e.clientY - r.top >= s.clientHeight) return;
    e.preventDefault();
    inputRef.current!.focus({ preventScroll: true });
    const now = performance.now(), k = clicks.current;
    k.n = now - k.at < MULTI_CLICK_MS && Math.abs(e.clientX - k.x) < 4 && Math.abs(e.clientY - k.y) < 4 ? k.n + 1 : 1;
    k.at = now; k.x = e.clientX; k.y = e.clientY;
    // Ctrl+click (Cmd+click on macOS) follows a hyperlink, as with Writer's default security option.
    if ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey) {
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
      if (!dragging.current) return;
      c.sh.SetCursor(toDoc(e), true);
      moved();
    };
    const up = (e: MouseEvent) => {
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
      <div ref={scrollerRef} className={`editwin-scroller${c.formatClipboard ? ' paintbrush' : ''}`} onScroll={schedule} onMouseDown={onMouseDown}>
        <div ref={spacerRef} />
      </div>
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
