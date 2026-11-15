// The app a page runs (one per page: src/<app>/index.html), as the shared UI sees it: its command
// table, its menus, toolbars, labels and keys (createAppUi), and its additions to the shared
// components (popup menu controllers, Tools > Options pages, the ribbon's own controls). The app's
// main module registers it (setAppRegistry) before it renders; the shared components read it.
import type { ReactNode } from 'react';
import type { AnyController } from '../appcontroller.ts';
import { dispatchCommand, type Command, type CommandTable } from '../commands.ts';
import type { AppUi, MenuEntry, RibbonTab, ToolEntry } from './labels.ts';

/** One entry of a filled popup menu: a checkable item running its command, or a separator. */
export interface PopupEntry { label?: string; checked?: boolean; run?: () => void; sep?: boolean }

/**
 * A page of Tools > Options that an app adds to the shared ones (user, view, fonts, languagetool,
 * keyboard). Its fields are part of the dialog's form: `apply` reads them when OK is pressed, after
 * the user's name and before LanguageTool's and the icon theme's settings.
 */
export interface OptionsPage<C extends AnyController = AnyController> {
  id: string;
  /** The shared page it follows in the list (`fonts`); at the end without one. */
  after?: string;
  label(): string;
  render(c: C): ReactNode;
  apply?(c: C, f: FormData): void;
}

/**
 * The ribbon (Menu > Ribbon, the app's tabbed notebookbar) as the app draws it: the context of its
 * topmost shell (vcl::EnumContext's name: Text, Table, Cell …), the commands it draws as controls of
 * its own (shown even when no command of that name is registered), and the New button's entries.
 */
export interface RibbonConfig<C extends AnyController = AnyController> {
  context(c: C): string;
  special: ReadonlySet<string>;
  /** The control of a command: one of `special`'s, or another drawn differently; undefined for a ToolButton. */
  control(c: C, cmd: string, labeled: boolean): ReactNode | undefined;
  /** The quick access toolbox's command the New button goes before (the app's Open). */
  newBefore: string;
  /** The New button's entries: commands and their labels. */
  newEntries(): { cmd: string; label: string }[];
}

export interface AppRegistry<C extends AnyController = AnyController> {
  commands: CommandTable<C>;
  ui: AppUi;
  /** framework's popup menu controllers: commands whose menu entry is a submenu filled when it opens. */
  popupControllers?: Record<string, (c: C) => PopupEntry[]>;
  optionsPages?: OptionsPage<C>[];
  ribbon?: RibbonConfig<C>;
}

let current: AppRegistry | null = null;

/** Registers the page's app, before the first render. */
export function setAppRegistry<C extends AnyController>(r: AppRegistry<C>): void { current = r as unknown as AppRegistry; }

/** The page's app. */
export function appRegistry(): AppRegistry {
  if (!current) throw new Error('No app registered (setAppRegistry)');
  return current;
}

/** The page's app's command of a name (without arguments), if registered. */
export const commandOf = (cmd: string): Command | undefined => appRegistry().commands[cmd.split('?')[0]!];
/** Runs a command of the page's app (dispatchCommand). */
export const dispatch = (c: AnyController, name: string, args?: Record<string, number>): boolean => dispatchCommand(appRegistry().commands, c, name, args);

export const menuLabel = (cmd: string): string => appRegistry().ui.menuLabel(cmd);
export const buttonLabel = (cmd: string): string => appRegistry().ui.buttonLabel(cmd);
export const tooltip = (cmd: string): string => appRegistry().ui.tooltip(cmd);
export const shortcutText = (cmd: string): string => appRegistry().ui.shortcutText(cmd);
export const commandForKeyEvent = (e: KeyboardEvent) => appRegistry().ui.commandForKeyEvent(e);
export const menubar = (): MenuEntry[] => appRegistry().ui.menubar;
export const popupmenus = (): Record<string, MenuEntry[]> => appRegistry().ui.popupmenus;
export const toolbars = (): Record<string, ToolEntry[]> => appRegistry().ui.toolbars;
export const notebookbar = (): RibbonTab[] => appRegistry().ui.notebookbar;
