import { A11yMirror, CaretAnnouncer } from './A11yMirror.tsx';
import { useSyncExternalStore } from 'react';
import type { Controller } from '../controller.ts';
import { FormulaBar, MenuBar, StatusBar, ToolBar } from './Bars.tsx';
import { EditWin } from './EditWin.tsx';
import { Navigator } from './Navigator.tsx';
import { Ribbon } from './Ribbon.tsx';
import { Dialogs, FindPanel } from './Dialogs.tsx';
import { MessageBar, OpeningIndicator, useAppWindow } from '@shell/ui/AppFrame.tsx';

export function App({ c }: { c: Controller }) {
  const version = useSyncExternalStore(c.subscribe, c.getVersion);

  useAppWindow(c);

  return (
    <div className={c.uiMode === 'ribbon' ? 'app ribbon-mode' : 'app'}>
      {c.uiMode === 'ribbon' ? <Ribbon c={c} /> : <>
        <MenuBar c={c} />
        <ToolBar c={c} />
      </>}
      <FormulaBar c={c} />
      <MessageBar c={c} />
      <FindPanel c={c} />
      <EditWin c={c} version={version} />
      {c.navigator && <Navigator c={c} />}
      <StatusBar c={c} />
      <OpeningIndicator c={c} />
      <Dialogs c={c} />
      <A11yMirror c={c} version={version} />
      <CaretAnnouncer c={c} version={version} />
    </div>
  );
}
