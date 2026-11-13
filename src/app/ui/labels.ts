import ui from '../generated/upstream-ui.json';
import { t } from '../i18n.ts';

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
/**
 * Save As's shortcut belongs to Download As, which replaces it. Save New Version gets Ctrl+Alt+V
 * (V for version), which upstream leaves free; Shift+Ctrl+V is Paste Special. Ctrl+/ (Cmd+/)
 * opens Search Commands besides upstream's Shift+Esc, instead of inserting a zero-width space.
 */
const shortcuts: Record<string, string> = { ...(ui.shortcuts as Record<string, string>), S_SHIFT_MOD1: '.uno:ExportTo', V_MOD1_MOD2: 'app:SaveVersion', DIVIDE_MOD1: '.uno:CommandPopup' };

const clean = (s: string) => s.replace(/~/g, '');
const base = (cmd: string) => cmd.split('?')[0]!;

/** Upstream commands the web shell names differently, through t(): Save a Copy and Export are downloads, Save As saves to the computer. */
const APP_LABELS = new Set(['.uno:SaveACopy', '.uno:ExportTo', '.uno:SaveAs']);

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

/** Upstream key names look like `B_MOD1` or `F8_SHIFT_MOD1`. */
export function eventKeyName(e: KeyboardEvent): string {
  const code = e.code;
  // vcl's KEY_DIVIDE: the "/" character, wherever the layout puts it (Shift+7 on German keyboards,
  // so Shift does not count), or the keypad's.
  if (e.key === '/' || code === 'NumpadDivide') {
    let k = 'DIVIDE';
    if (isMac ? e.metaKey : e.ctrlKey) k += '_MOD1';
    if (e.altKey) k += '_MOD2';
    return k;
  }
  let key = code.startsWith('Key') ? code.slice(3)
    : code.startsWith('Digit') ? code.slice(5)
    : /^F\d+$/.test(code) ? code
    : { Enter: 'RETURN', Tab: 'TAB', Space: 'SPACE', Backspace: 'BACKSPACE', Delete: 'DELETE', Insert: 'INSERT', Escape: 'ESCAPE', PageUp: 'PAGEUP', PageDown: 'PAGEDOWN', Home: 'HOME', End: 'END', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN' }[code] ?? '';
  if (!key) return '';
  if (e.shiftKey) key += '_SHIFT';
  if (isMac ? e.metaKey : e.ctrlKey) key += '_MOD1';
  if (e.altKey) key += '_MOD2';
  return key;
}

export const commandForKey = (name: string): string | undefined => shortcuts[name];

// The keys menus show: the shortest, but never a dedicated key (Sun keyboards' PASTE, COPY, UNDO …)
// that most keyboards lack.
const DEDICATED_KEYS = new Set(['PASTE', 'COPY', 'CUT', 'UNDO', 'REPEAT', 'FIND', 'OPEN', 'PROPERTIES', 'FRONT', 'HELP', 'CONTEXTMENU']);
const reverse = new Map<string, string>();
for (const [k, c] of Object.entries(shortcuts)) {
  if (DEDICATED_KEYS.has(k.split('_')[0]!)) continue;
  const cur = reverse.get(c);
  if (!cur || k.length < cur.length) reverse.set(c, k);
}

export function shortcutText(cmd: string): string {
  const k = reverse.get(base(cmd));
  if (!k) return '';
  const [key, ...mods] = k.split('_');
  const m = mods.map((x) => (x === 'MOD1' ? (isMac ? '⌘' : 'Ctrl') : x === 'MOD2' ? (isMac ? '⌥' : 'Alt') : isMac ? '⇧' : 'Shift'));
  return [...m, key].join(isMac ? '' : '+');
}

export { isMac };
