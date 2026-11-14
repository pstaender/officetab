import ui from '../generated/upstream-ui.json';
import { t } from '../i18n.ts';
import { KeymapStore, commandForEvent, keyText, menuKeys } from '../keymaps.ts';

export interface MenuEntry { sep?: boolean; cmd?: string; items?: MenuEntry[] }
export interface ToolEntry { sep?: boolean; cmd?: string; visible?: boolean }

/** File > Save to Computer needs a save dialog that gives a file to write back to (Chromium's). */
const canSaveToComputer = 'showSaveFilePicker' in window;
/**
 * The web shell's own menu entries (`app:` commands, labelled through t()), added to upstream's
 * menus, and upstream entries it moves: File > Autosave after Save All, and after Save, Save New
 * Version, Save a Copy (Download), Export (Download As, with Save As's shortcut), Create Copy and,
 * where the browser has a save dialog, Save As (Save to Computer); Clear Data last, on its own
 * (`sep`: after a separator).
 */
const APP_ENTRIES: Record<string, { after: string; cmd: string; sep?: boolean }[]> = {
  '.uno:PickList': [
    { after: '.uno:Save', cmd: 'app:SaveVersion' }, { after: 'app:SaveVersion', cmd: '.uno:SaveACopy' },
    { after: '.uno:SaveACopy', cmd: '.uno:ExportTo' }, { after: '.uno:ExportTo', cmd: 'app:CreateCopy' },
    ...(canSaveToComputer ? [{ after: 'app:CreateCopy', cmd: '.uno:SaveAs' }] : []),
    { after: '.uno:SaveAll', cmd: 'app:AutoSave' },
    { after: '.uno:SignaturesMenu', cmd: 'app:ClearData', sep: true },
  ],
};
/**
 * Upstream entries a browser has no use for: the browser's print dialog has its own preview and
 * printer settings, and the tab is closed instead of quitting (and the entries moved above).
 */
const APP_REMOVED: Record<string, string[]> = { '.uno:PickList': ['.uno:PrintPreview', '.uno:PrinterSetup', '.uno:Quit', '.uno:SaveAs', '.uno:SaveACopy', '.uno:ExportTo'] };
/**
 * Upstream menus the shell replaces: Window (a browser tab has one window) by Menu, which
 * switches between the classic menus and toolbars and the ribbon (Writer's tabbed notebookbar).
 */
const APP_MENUS: Record<string, MenuEntry> = { '.uno:WindowList': { cmd: 'app:MenuMode', items: [{ cmd: 'app:MenuClassic' }, { cmd: 'app:MenuRibbon' }] } };
export const menubar = (ui.menubar as MenuEntry[]).map((m) => {
  if (m.cmd && APP_MENUS[m.cmd]) return APP_MENUS[m.cmd]!;
  const extra = m.cmd ? APP_ENTRIES[m.cmd] : undefined;
  const removed = m.cmd ? APP_REMOVED[m.cmd] : undefined;
  if ((!extra && !removed) || !m.items) return m;
  let items = m.items.filter((i) => !i.cmd || !removed?.includes(i.cmd));
  for (const e of extra ?? []) items.splice(items.findIndex((i) => i.cmd === e.after) + 1, 0, ...(e.sep ? [{ sep: true }] : []), { cmd: e.cmd });
  // No separators at either end or next to each other.
  items = items.filter((i, k) => !i.sep || (k > 0 && k < items.length - 1 && !items[k - 1]!.sep));
  return { ...m, items };
});
/** The context menus of Writer's shells (sw/uiconfig/swriter/popupmenu), by name. */
export const popupmenus = ui.popupmenus as Record<string, MenuEntry[]>;
export const toolbars = ui.toolbars as Record<string, ToolEntry[]>;
/** Writer's tabbed notebookbar (notebookbar.ui): tabs, the contexts they show for, command groups. */
export interface RibbonTab { id: string; label: string; contexts: string[]; groups: string[][] }
export const notebookbar = ui.notebookbar as RibbonTab[];
const labels = ui.labels as Record<string, { label?: string; context?: string; popup?: string; tooltip?: string }>;

const clean = (s: string) => s.replace(/~/g, '');
const base = (cmd: string) => cmd.split('?')[0]!;

/**
 * Upstream commands the web shell names differently, through t(): Save a Copy and Export are
 * downloads, Save As saves to the computer, and View > Normal and Web are Paper View and Screen View.
 */
const APP_LABELS = new Set(['.uno:SaveACopy', '.uno:ExportTo', '.uno:SaveAs', '.uno:PrintLayout', '.uno:BrowseView']);

/** Mirrors vcl's choice: a popup label wins in menus, then the module's context label. */
export function menuLabel(cmd: string): string {
  if (cmd.startsWith('app:')) return t(`menu.${cmd.slice(4)}`);
  if (APP_LABELS.has(base(cmd))) return t(`menu.${base(cmd).slice(5)}`);
  const l = labels[base(cmd)];
  return clean(l?.popup ?? l?.context ?? l?.label ?? cmd.replace('.uno:', ''));
}

/** A toolbar button's text beside its icon: the command's label, without the dialog ellipsis. */
export function buttonLabel(cmd: string): string {
  if (APP_LABELS.has(base(cmd))) return t(`button.${base(cmd).slice(5)}`);
  const l = labels[base(cmd)];
  return clean(l?.label ?? l?.context ?? cmd.replace('.uno:', '')).replace(/\.\.\.$|…$/, '');
}

export function tooltip(cmd: string): string {
  if (APP_LABELS.has(base(cmd))) return t(`button.${base(cmd).slice(5)}`);
  const l = labels[base(cmd)];
  return clean(l?.tooltip ?? l?.label ?? cmd.replace('.uno:', ''));
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The user's keyboard shortcuts (Tools > Options > Keyboard Shortcuts). */
export const keymap = new KeymapStore((() => { try { return localStorage; } catch { return null; } })());
let reverse = menuKeys(keymap.map, isMac);
keymap.subscribe(() => { reverse = menuKeys(keymap.map, isMac); });

/** The command a key runs, and the key name it matched. */
export const commandForKeyEvent = (e: KeyboardEvent) => commandForEvent(keymap.map, e, isMac);

/** The key a command's menu entry shows. */
export function shortcutText(cmd: string): string {
  const k = reverse.get(base(cmd));
  return k ? keyText(k, isMac) : '';
}

export { isMac };
