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
