// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/tabvwsh.hxx reduced
// ScTabViewShell: the spreadsheet view as the application drives it, the top of the view's class
// chain (ScTabView, ScViewFunc, ScDBFunc). The SfxViewShell machinery (slots, dispatcher, shells
// for drawing objects and the edit engine, the sidebar) is the web shell's command table; the
// state the cell and format shells read (GetState) is read by the commands directly.
import type { ScInputOptions } from '../../../inc/inputopt.ts';
import type { ScDocShell } from '../docshell/docsh.ts';
import { ScDBFunc } from './dbfunc.ts';

export class ScTabViewShell extends ScDBFunc {
  constructor(rDocSh: ScDocShell, fnInputOptions: () => ScInputOptions) {
    super(rDocSh, fnInputOptions);
  }

  GetViewShell(): ScTabViewShell { return this; }
}
