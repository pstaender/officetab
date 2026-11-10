import { A11yMirror, CaretAnnouncer } from './A11yMirror.tsx';
import { useEffect, useSyncExternalStore } from 'react';
import type { Controller } from '../controller.ts';
import { MenuBar, StatusBar, ToolBar } from './Bars.tsx';
import { EditWin } from './EditWin.tsx';
import { Dialogs, FindPanel } from './Dialogs.tsx';

export function App({ c }: { c: Controller }) {
  const version = useSyncExternalStore(c.subscribe, c.getVersion);

  useEffect(() => { document.title = `${c.title} – Writer`; });

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (c.handle && c.sh.m_pDoc.IsModified()) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [c]);

  return (
    <div className="app">
      <MenuBar c={c} />
      <ToolBar c={c} />
      {c.message && (
        <div className="message" role="alert">
          <span>{c.message}</span>
          {c.messageActions.map((a) => <button key={a.label} className="action" onClick={a.run}>{a.label}</button>)}
          <button aria-label="Dismiss" onClick={() => { c.setMessage(null); c.focusEditor(); }}>×</button>
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
