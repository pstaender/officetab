import { useSyncExternalStore } from 'react';
import type { Controller } from '../controller.ts';
import { FormulaBar, MenuBar, StatusBar, ToolBar } from './Bars.tsx';
import { GridWin } from './GridWin.tsx';
import { SheetTabs } from './SheetTabs.tsx';
import { Ribbon } from './Ribbon.tsx';
import { Dialogs, FindBar } from './Dialogs.tsx';
import { A11yMirror } from './A11yMirror.tsx';
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
      <FindBar c={c} />
      <GridWin c={c} version={version} />
      <SheetTabs c={c} />
      <StatusBar c={c} />
      <OpeningIndicator c={c} />
      <Dialogs c={c} />
      <A11yMirror c={c} version={version} />
    </div>
  );
}
