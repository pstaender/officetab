import { A11yMirror, CaretAnnouncer } from './A11yMirror.tsx';
import { useEffect, useSyncExternalStore } from 'react';
import type { Controller } from '../controller.ts';
import { FormulaBar, MenuBar, StatusBar, ToolBar } from './Bars.tsx';
import { EditWin } from './EditWin.tsx';
import { Ribbon } from './Ribbon.tsx';
import { Dialogs, FindPanel } from './Dialogs.tsx';

export function App({ c }: { c: Controller }) {
  const version = useSyncExternalStore(c.subscribe, c.getVersion);

  useEffect(() => { document.title = `${c.title} – Writer`; });

  useEffect(() => {
    // Changes not yet in the file on disk, or (without autosave) not yet in the browser either.
    const warn = (e: BeforeUnloadEvent) => { if ((c.handle && c.sh.m_pDoc.IsModified()) || (!c.autoSave && c.unsaved)) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [c]);

  return (
    <div className={c.uiMode === 'ribbon' ? 'app ribbon-mode' : 'app'}>
      {c.uiMode === 'ribbon' ? <Ribbon c={c} /> : <>
        <MenuBar c={c} />
        <ToolBar c={c} />
      </>}
      <FormulaBar c={c} />
      {c.message && (
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
      )}
      <FindPanel c={c} />
      <EditWin c={c} version={version} />
      <StatusBar c={c} />
      <Dialogs c={c} />
      <A11yMirror c={c} version={version} />
      <CaretAnnouncer c={c} version={version} />
    </div>
  );
}
