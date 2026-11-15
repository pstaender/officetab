// `.uno:` command dispatch, shared by the apps: a command table is keyed by upstream's command
// names, so menus, toolbars and shortcuts generated from upstream light up as soon as a command is
// registered. SHELL_COMMANDS are the commands every app has (File, Help, zoom, the UI mode); an app
// spreads them into its own table.
import type { AnyController } from './appcontroller.ts';

export interface Command<C = AnyController> {
  /** `args` are the dispatch's arguments (a toolbar control's value), as upstream's request items. */
  exec(c: C, args?: Record<string, number>): void | Promise<void>;
  /** Toggle state for toolbar buttons and menu checkmarks. */
  checked?(c: C): boolean;
  enabled?(c: C): boolean;
}

export type CommandTable<C = AnyController> = Record<string, Command<C>>;

/** Runs a command of a table when it is enabled; false when it is not (or not registered). */
export function dispatchCommand<C extends AnyController>(table: CommandTable<C>, c: C, name: string, args?: Record<string, number>): boolean {
  const cmd = table[name.split('?')[0]!];
  if (!cmd || (cmd.enabled && !cmd.enabled(c))) return false;
  void Promise.resolve(cmd.exec(c, args)).catch((e: Error) => c.setMessage(e.message));
  return true;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The commands of the shell's own part (AppController): File's storage, download and versions
 * commands, Tools > Options, Help, zoom and Menu's modes. `.uno:Open…FromWriter` and the like are
 * the app's, as are New, Print and the templates.
 */
export const SHELL_COMMANDS: CommandTable = {
  '.uno:AddDirect': { exec: (c) => c.newDocument() },
  // SID_COMMAND_POPUP: Help > Search Commands (Shift+Esc, and Ctrl+/ here), sfx2's CommandPopup.
  '.uno:CommandPopup': { exec: (c) => c.setDialog('commandpopup') },
  '.uno:Open': { exec: (c) => c.setDialog('documents') },
  // With autosave, every change is in the browser already: Save keeps the state as a version
  // (and writes the file on disk, if one is attached).
  '.uno:Save': { exec: (c) => c.saveCommand() },
  // Save a Copy and Export are, in a browser, downloads: the web shell names them File > Download
  // as File (the document's own format, at once) and Download As (another format, from a dialog).
  '.uno:SaveACopy': { exec: (c) => c.download(c.name, c.fileFormat()) },
  '.uno:ExportTo': { exec: (c) => c.setDialog('download') },
  // Save As, where the browser has a save dialog: File > Save to Computer, which links the file.
  '.uno:SaveAs': { exec: (c) => c.saveToComputer() },
  // SID_VERSION: File > Versions (SfxObjectShell::ExecFile_Impl, SfxVersionDialog).
  '.uno:VersionDialog': { exec: (c) => c.setDialog('versions') },
  // The web shell's File > Save New Version (Ctrl+Alt+V): Versions' Save New Version, with its comment dialog.
  'app:SaveVersion': { exec: (c) => c.setDialog('saveversion') },
  // The web shell's File > Create Copy: store a copy of the document in the browser under a new name.
  'app:CreateCopy': { exec: (c) => c.setDialog('createcopy') },
  // The web shell's Workspace menu (workspace.ts): the settings and stored documents of the suite's
  // apps as one .workspacez file (Export and Import, each with a dialog choosing what), the settings
  // as JSON, and Clear Data: delete everything stored in this browser, after a warning.
  'app:WorkspaceImport': { exec: (c) => c.importWorkspace() },
  'app:WorkspaceExport': { exec: (c) => c.setDialog('workspaceexport') },
  'app:WorkspaceExportSettings': { exec: (c) => c.exportSettingsJson() },
  'app:ClearData': { exec: (c) => c.setDialog('cleardata') },
  // The web shell's File > Autosave: store every change in the browser at once.
  'app:AutoSave': { exec: (c) => c.setAutoSave(!c.autoSave), checked: (c) => c.autoSave },
  'app:MenuClassic': { exec: (c) => c.setUiMode('classic'), checked: (c) => c.uiMode === 'classic' },
  'app:MenuRibbon': { exec: (c) => c.setUiMode('ribbon'), checked: (c) => c.uiMode === 'ribbon' },
  '.uno:About': { exec: (c) => c.setDialog('about') },
  '.uno:ZoomPlus': { exec: (c) => c.setZoom(clamp(c.zoom * 1.2, 0.2, 6)) },
  '.uno:ZoomMinus': { exec: (c) => c.setZoom(clamp(c.zoom / 1.2, 0.2, 6)) },
  '.uno:Zoom50Percent': { exec: (c) => c.setZoom(0.5) },
  '.uno:Zoom75Percent': { exec: (c) => c.setZoom(0.75) },
  '.uno:Zoom100Percent': { exec: (c) => c.setZoom(1) },
  '.uno:Zoom150Percent': { exec: (c) => c.setZoom(1.5) },
  '.uno:Zoom200Percent': { exec: (c) => c.setZoom(2) },
  '.uno:OptionsTreeDialog': { exec: (c) => c.setDialog('options') },
};
