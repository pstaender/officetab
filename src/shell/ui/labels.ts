// An app's menus, toolbars, notebookbar and command labels, from its generated upstream-ui.json
// (tools/upstream/gen-ui.ts), with the web shell's own edits; and the keys menus show for them.
import { t } from '../i18n.ts';
import { KeymapStore, commandForEvent, keyText, menuKeys } from '../keymaps.ts';

export interface MenuEntry { sep?: boolean; cmd?: string; items?: MenuEntry[] }
export interface ToolEntry { sep?: boolean; cmd?: string; visible?: boolean }
/** An app's tabbed notebookbar (notebookbar.ui): tabs, the contexts they show for, command groups. */
export interface RibbonTab { id: string; label: string; contexts: string[]; groups: string[][] }
export interface CommandLabel { label?: string; context?: string; popup?: string; tooltip?: string }

/** The shape of src/<app>/generated/upstream-ui.json. */
export interface UpstreamUi {
  menubar: unknown[];
  popupmenus: Record<string, unknown[]>;
  toolbars: Record<string, unknown[]>;
  notebookbar: unknown[];
  labels: Record<string, CommandLabel>;
  shortcuts: Record<string, string>;
}

/** An entry the web shell adds to an upstream menu, after `after`; with `items`, a submenu. */
export interface AppEntry { after: string; cmd: string; sep?: boolean; items?: MenuEntry[] }

/**
 * The web shell's Workspace menu, between Menu and Help: the suite's documents and settings in this
 * browser as a whole (src/shell/workspace.ts), and Clear Data.
 */
export const WORKSPACE_MENU: MenuEntry = {
  cmd: 'app:Workspace',
  items: [
    { cmd: 'app:WorkspaceImport' }, { cmd: 'app:WorkspaceExport' }, { cmd: 'app:WorkspaceExportSettings' },
    { sep: true }, { cmd: 'app:ClearData' },
  ],
};

/** File > Save to Computer needs a save dialog that gives a file to write back to (Chromium's). */
const canSaveToComputer = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
/**
 * The web shell's own menu entries (`app:` commands, labelled through t()), added to upstream's
 * menus, and upstream entries it moves: File > Autosave after Save All, and after Save, Save New
 * Version, Save a Copy (Download), Export (Download As, with Save As's shortcut), Create Copy and,
 * where the browser has a save dialog, Save As (Save to Computer).
 */
export const APP_ENTRIES: Record<string, AppEntry[]> = {
  '.uno:PickList': [
    { after: '.uno:Save', cmd: 'app:SaveVersion' }, { after: 'app:SaveVersion', cmd: '.uno:SaveACopy' },
    { after: '.uno:SaveACopy', cmd: '.uno:ExportTo' }, { after: '.uno:ExportTo', cmd: 'app:CreateCopy' },
    ...(canSaveToComputer ? [{ after: 'app:CreateCopy', cmd: '.uno:SaveAs' }] : []),
    { after: '.uno:SaveAll', cmd: 'app:AutoSave' },
  ],
};
/**
 * Upstream entries a browser has no use for: the browser's print dialog has its own preview and
 * printer settings, and the tab is closed instead of quitting (and the entries moved above).
 */
export const APP_REMOVED: Record<string, string[]> = { '.uno:PickList': ['.uno:PrintPreview', '.uno:PrinterSetup', '.uno:Quit', '.uno:SaveAs', '.uno:SaveACopy', '.uno:ExportTo'] };
/**
 * Upstream menus the shell replaces: Window (a browser tab has one window) by Menu, which
 * switches between the classic menus and toolbars and the ribbon (the tabbed notebookbar).
 */
export const APP_MENUS: Record<string, MenuEntry> = { '.uno:WindowList': { cmd: 'app:MenuMode', items: [{ cmd: 'app:MenuClassic' }, { cmd: 'app:MenuRibbon' }] } };
/** Menus the web shell adds to the menu bar, after an upstream one: Workspace after Menu (Window). */
export const APP_MENUS_AFTER: Record<string, MenuEntry[]> = { '.uno:WindowList': [WORKSPACE_MENU] };
/**
 * Upstream commands the web shell names differently, through t() (`menu.<name>`, `button.<name>`):
 * Save a Copy and Export are downloads, Save As saves to the computer.
 */
export const APP_LABELS: readonly string[] = ['.uno:SaveACopy', '.uno:ExportTo', '.uno:SaveAs'];

/** How an app changes its upstream UI: the shell's edits above by default, and labels of its own. */
export interface UiEdits {
  entries?: Record<string, AppEntry[]>;
  removed?: Record<string, string[]>;
  menus?: Record<string, MenuEntry>;
  menusAfter?: Record<string, MenuEntry[]>;
  /** Further upstream commands the app names through t(), besides APP_LABELS. */
  labels?: readonly string[];
}

const clean = (s: string) => s.replace(/~/g, '');
const base = (cmd: string) => cmd.split('?')[0]!;

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** An app's UI as the shell shows it: its menus, toolbars and ribbon, labels and keys. */
export interface AppUi {
  readonly menubar: MenuEntry[];
  /** The context menus of the app's shells (<module>/uiconfig/<app>/popupmenu), by name. */
  readonly popupmenus: Record<string, MenuEntry[]>;
  readonly toolbars: Record<string, ToolEntry[]>;
  readonly notebookbar: RibbonTab[];
  menuLabel(cmd: string): string;
  buttonLabel(cmd: string): string;
  tooltip(cmd: string): string;
  /** The user's keyboard shortcuts (Tools > Options > Keyboard Shortcuts). */
  readonly keymap: KeymapStore;
  /** The command a key runs, and the key name it matched. */
  commandForKeyEvent(e: KeyboardEvent): { key: string; cmd: string } | undefined;
  /** The key a command's menu entry shows. */
  shortcutText(cmd: string): string;
}

/** An app's UI from its upstream-ui.json, the shell's edits (and the app's), and its keymap store. */
export function createAppUi(ui: UpstreamUi, keymap: KeymapStore, edits: UiEdits = {}): AppUi {
  const APP_ENTRIES_ = edits.entries ?? APP_ENTRIES, APP_REMOVED_ = edits.removed ?? APP_REMOVED, APP_MENUS_ = edits.menus ?? APP_MENUS;
  const APP_LABELS_ = new Set([...APP_LABELS, ...(edits.labels ?? [])]);
  const APP_MENUS_AFTER_ = edits.menusAfter ?? APP_MENUS_AFTER;
  const menubar = (ui.menubar as MenuEntry[]).flatMap((m) => [edit(m), ...(m.cmd ? APP_MENUS_AFTER_[m.cmd] ?? [] : [])]);
  function edit(m: MenuEntry): MenuEntry {
    if (m.cmd && APP_MENUS_[m.cmd]) return APP_MENUS_[m.cmd]!;
    const extra = m.cmd ? APP_ENTRIES_[m.cmd] : undefined;
    const removed = m.cmd ? APP_REMOVED_[m.cmd] : undefined;
    if ((!extra && !removed) || !m.items) return m;
    let items = m.items.filter((i) => !i.cmd || !removed?.includes(i.cmd));
    for (const e of extra ?? []) items.splice(items.findIndex((i) => i.cmd === e.after) + 1, 0, ...(e.sep ? [{ sep: true }] : []), e.items ? { cmd: e.cmd, items: e.items } : { cmd: e.cmd });
    // No separators at either end or next to each other.
    items = items.filter((i, k) => !i.sep || (k > 0 && k < items.length - 1 && !items[k - 1]!.sep));
    return { ...m, items };
  }
  const labels = ui.labels;

  /** Mirrors vcl's choice: a popup label wins in menus, then the module's context label. */
  function menuLabel(cmd: string): string {
    if (cmd.startsWith('app:')) return t(`menu.${cmd.slice(4)}`);
    if (APP_LABELS_.has(base(cmd))) return t(`menu.${base(cmd).slice(5)}`);
    const l = labels[base(cmd)];
    return clean(l?.popup ?? l?.context ?? l?.label ?? cmd.replace('.uno:', ''));
  }

  /** A toolbar button's text beside its icon: the command's label, without the dialog ellipsis. */
  function buttonLabel(cmd: string): string {
    if (APP_LABELS_.has(base(cmd))) return t(`button.${base(cmd).slice(5)}`);
    const l = labels[base(cmd)];
    return clean(l?.label ?? l?.context ?? cmd.replace('.uno:', '')).replace(/\.\.\.$|…$/, '');
  }

  function tooltip(cmd: string): string {
    if (APP_LABELS_.has(base(cmd))) return t(`button.${base(cmd).slice(5)}`);
    const l = labels[base(cmd)];
    return clean(l?.tooltip ?? l?.label ?? cmd.replace('.uno:', ''));
  }

  let reverse = menuKeys(keymap.map, isMac);
  keymap.subscribe(() => { reverse = menuKeys(keymap.map, isMac); });

  /** The key a command's menu entry shows. */
  function shortcutText(cmd: string): string {
    const k = reverse.get(base(cmd));
    return k ? keyText(k, isMac) : '';
  }

  return {
    menubar,
    popupmenus: ui.popupmenus as Record<string, MenuEntry[]>,
    toolbars: ui.toolbars as Record<string, ToolEntry[]>,
    notebookbar: ui.notebookbar as RibbonTab[],
    menuLabel, buttonLabel, tooltip, keymap,
    commandForKeyEvent: (e: KeyboardEvent) => commandForEvent(keymap.map, e, isMac),
    shortcutText,
  };
}
