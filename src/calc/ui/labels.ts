// Calc's menus, toolbars, notebookbar and labels (the shell's createAppUi over Calc's
// upstream-ui.json) and its keymap.
import ui from '../generated/upstream-ui.json';
import { createAppUi, isMac, type UpstreamUi } from '@shell/ui/labels.ts';
import { KeymapStore } from '../keymaps.ts';

export type { MenuEntry, RibbonTab, ToolEntry } from '@shell/ui/labels.ts';

export const calcUi = createAppUi(ui as UpstreamUi, new KeymapStore((() => { try { return localStorage; } catch { return null; } })()));

export const { menubar, popupmenus, toolbars, notebookbar, menuLabel, buttonLabel, tooltip, keymap, commandForKeyEvent, shortcutText } = calcUi;

export { isMac };
