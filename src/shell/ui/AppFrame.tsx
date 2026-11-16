// The parts of an app's window every app has: the window's title, the warning before leaving with
// unsaved changes, the shortcuts of Search Commands and Find & Replace wherever the focus is, the
// message bar (info bars and passing toasts) and the indicator of a large file being opened.
import { useEffect } from 'react';
import type { AnyController as Controller } from '../appcontroller.ts';
import { t } from '../i18n.ts';
import { browserUses, detectBrowser, eventKeyNames } from '../keymaps.ts';
import { isMac } from './labels.ts';
import { commandForKeyEvent, dispatch } from './registry.ts';

const browser = typeof navigator !== 'undefined' ? detectBrowser(navigator.userAgent) : 'other';

const editable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

/**
 * Whether the browser would open its find bar for a key: Ctrl+F (Cmd+F), find next and previous
 * (Ctrl+G, F3), and Firefox's quick find ("/" and "'" outside text fields).
 */
function isBrowserFindKey(e: KeyboardEvent): boolean {
  if (browser === 'firefox' && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '/' || e.key === "'") && !editable(e.target)) return true;
  return eventKeyNames(e, isMac).some((k) => browserUses(k, browser, isMac).some((u) => u.action === 'find' || u.action === 'findNext'));
}

/** Focuses the open Find & Replace bar's search text, selected, to type another one. */
function focusFindBar(): void {
  document.querySelector<HTMLInputElement>('.findbar input')?.select();
}

/** The window's title, the warning before unloading, and the shortcuts of Search Commands and Find & Replace. */
export function useAppWindow(c: Controller): void {
  useEffect(() => { document.title = `${c.title} – ${c.app.name}`; });

  useEffect(() => {
    // Changes not yet in the file on disk, or (without autosave) not yet in the browser either.
    // Not after File > Clear Data, which reloads on purpose.
    const warn = (e: BeforeUnloadEvent) => { if (!c.cleared && ((c.handle && c.isModified()) || (!c.autoSave && c.unsaved) || c.savePending)) { c.flushSave(); e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [c]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const cmd = commandForKeyEvent(e)?.cmd;
      // Search Commands' shortcuts work wherever the focus is (the ribbon, a toolbar), not only in
      // the document, but not over a dialog.
      if (cmd === '.uno:CommandPopup') {
        if (c.dialog) return;
        e.preventDefault();
        e.stopPropagation();
        dispatch(c, '.uno:CommandPopup');
        return;
      }
      // The browser's find bar cannot search a document drawn on a canvas: Find & Replace's keys,
      // and the browser's own find keys left unbound, open the app's Find & Replace wherever the
      // focus is. A find key bound to another command keeps it, without the browser's find bar.
      const browserFind = isBrowserFindKey(e);
      if (cmd !== '.uno:SearchDialog' && !(browserFind && !cmd)) {
        if (browserFind) e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (c.dialog === 'find') focusFindBar();
      else if (!c.dialog) dispatch(c, '.uno:SearchDialog');
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [c]);
}

/** The current message: an info bar with its actions, or a toast that goes by itself. */
export function MessageBar({ c }: { c: Controller }) {
  if (!c.message) return null;
  return (
    <div className="message-row" key={c.messageSeq}>
      <div className="message" role={c.messageTimeout ? 'status' : 'alert'}>
        <div className="message-body">
          <span>{c.message}</span>
          {c.messageActions.map((a) => <button key={a.label} className="action" onClick={a.run}>{a.label}</button>)}
        </div>
        <button className="dismiss" aria-label="Dismiss" onClick={() => { c.setMessage(null); c.focusEditor(); }}>
          {/* The cross drawn, centred exactly; for a passing notice, a ring around it runs out and the
              notice goes (paused while hovered). */}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path className="cross" d="M9 9 15 15M15 9 9 15" />
            {c.messageTimeout > 0 && <circle className="countdown" cx="12" cy="12" r="10" style={{ animationDuration: `${c.messageTimeout}ms` }} onAnimationEnd={() => c.setMessage(null)} />}
          </svg>
        </button>
      </div>
    </div>
  );
}

/** The loading indicator of a large file being opened. */
export function OpeningIndicator({ c }: { c: Controller }) {
  if (!c.opening) return null;
  return (
    // The page cannot repaint while a large document is read and laid out: the spinner turns
    // on the compositor all the same.
    <div className="opening" role="status" aria-live="polite">
      <div className="opening-card"><span className="spinner" aria-hidden="true" />{t('opening', { name: c.opening })}</div>
    </div>
  );
}
