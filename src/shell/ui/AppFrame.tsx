// The parts of an app's window every app has: the window's title, the warning before leaving with
// unsaved changes, Search Commands' shortcut wherever the focus is, the message bar (info bars and
// passing toasts) and the indicator of a large file being opened.
import { useEffect } from 'react';
import type { AnyController as Controller } from '../appcontroller.ts';
import { t } from '../i18n.ts';
import { commandForKeyEvent, dispatch } from './registry.ts';

/** The window's title, the warning before unloading, and Search Commands' shortcut. */
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
    // Search Commands' shortcuts work wherever the focus is (the ribbon, a toolbar), not only in
    // the document, but not over a dialog.
    const key = (e: KeyboardEvent) => {
      if (c.dialog || commandForKeyEvent(e)?.cmd !== '.uno:CommandPopup') return;
      e.preventDefault();
      e.stopPropagation();
      dispatch(c, '.uno:CommandPopup');
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
