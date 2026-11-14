// Writer's menus, toolbars, notebookbar and labels (the shell's createAppUi over Writer's
// upstream-ui.json) and its keymap.
import ui from '../generated/upstream-ui.json';
import { createAppUi, isMac, type UpstreamUi } from '@shell/ui/labels.ts';
import { KeymapStore } from '../keymaps.ts';

export type { MenuEntry, RibbonTab, ToolEntry } from '@shell/ui/labels.ts';

/**
 * Writer's UI: the shell's menu edits, and View > Normal and Web named Paper View and Screen View
 * (through t()).
 */
export const writerUi = createAppUi(ui as UpstreamUi, new KeymapStore((() => { try { return localStorage; } catch { return null; } })()), {
  labels: ['.uno:PrintLayout', '.uno:BrowseView'],
});

export const { menubar, popupmenus, toolbars, notebookbar, menuLabel, buttonLabel, tooltip, keymap, commandForKeyEvent, shortcutText } = writerUi;

export { isMac };
