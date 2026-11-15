// Calc's keyboard shortcut templates (Tools > Options > Keyboard Shortcuts): the application's
// keys, LibreOffice Calc's, and Excel's for Windows and for Mac; and the store of the user's map,
// kept under Calc's own key. The machinery is the suite's, in src/shell/keymaps.ts.
import ui from './generated/upstream-ui.json';
import {
  KeymapStore as ShellKeymapStore, SHELL_KEYMAP_EDITS, keymapChoiceOf, overlayKeymap,
  type KeyValueStorage, type Keymap, type KeymapChoice, type KeymapTemplates,
} from '@shell/keymaps.ts';

export * from '@shell/keymaps.ts';

export const KEYMAP_TEMPLATES = ['default', 'libreoffice', 'excelWindows', 'excelMac'] as const;
export type KeymapTemplate = (typeof KEYMAP_TEMPLATES)[number];

export const LIBREOFFICE_KEYMAP: Keymap = { ...(ui.shortcuts as Keymap) };

/**
 * The application's keys: LibreOffice Calc's, with the shell's changes (SHELL_KEYMAP_EDITS):
 * Ctrl+/ (Cmd+/) opens Search Commands instead of selecting the array formula, Shift+Ctrl+R
 * (Repaint) is left to the browser.
 */
export const DEFAULT_KEYMAP: Keymap = overlayKeymap(LIBREOFFICE_KEYMAP, SHELL_KEYMAP_EDITS);

const overlay = (o: Record<string, string | null>): Keymap => overlayKeymap(DEFAULT_KEYMAP, o);

/**
 * Microsoft Excel for Windows ("Keyboard shortcuts in Excel", support.microsoft.com, Windows tab),
 * for the commands Calc has, over the application's keys. Excel's Ctrl+Plus and Ctrl+Minus insert
 * and delete cells; its number format keys are Calc's already (Shift+Ctrl+1 … 6 differ: Excel's
 * Shift+Ctrl+~ is General, Shift+Ctrl+$ Currency and so on, which are the same keys on a US
 * keyboard as Calc's Shift+Ctrl+digit, apart from General).
 */
export const EXCEL_WINDOWS_KEYMAP: Keymap = overlay({
  // Frequently used
  F2: '.uno:SetInputMode', F4: '.uno:ToggleRelative', F_MOD1: '.uno:SearchDialog', H_MOD1: '.uno:SearchDialog',
  D_MOD1: '.uno:FillDown', R_MOD1: '.uno:FillRight', '9_MOD1': '.uno:HideRow', '0_MOD1': '.uno:HideColumn',
  '5_MOD1': '.uno:Strikeout', '1_MOD1': '.uno:FormatCellDialog', '2_MOD1': '.uno:Bold', '3_MOD1': '.uno:Italic', '4_MOD1': '.uno:Underline',
  EQUAL_MOD2: '.uno:AutoSum', K_MOD1: '.uno:HyperlinkDialog',
  // Cells, rows and columns
  ADD_MOD1: '.uno:InsertCell', ADD_SHIFT_MOD1: '.uno:InsertCell', SUBTRACT_MOD1: '.uno:DeleteCell',
  SPACE_MOD1: '.uno:SelectColumn', SPACE_SHIFT: '.uno:SelectRow', SPACE_SHIFT_MOD1: '.uno:SelectAll',
  // Number formats: Shift+Ctrl+~ General
  QUOTELEFT_SHIFT_MOD1: '.uno:NumberFormatStandard', TILDE_MOD1: '.uno:NumberFormatStandard',
  // Formulas
  QUOTELEFT_MOD1: '.uno:ToggleFormula', SEMICOLON_MOD1: '.uno:InsertCurrentDate', SEMICOLON_SHIFT_MOD1: '.uno:InsertCurrentTime',
  // Sheets
  F11_SHIFT: '.uno:Insert', PAGEDOWN_MOD1: '.uno:JumpToNextTable', PAGEUP_MOD1: '.uno:JumpToPrevTable',
  // Edit
  V_MOD1_MOD2: '.uno:PasteSpecial', Y_MOD1: '.uno:Redo', F9: '.uno:Calculate',
  // Function keys
  F12: '.uno:ExportTo', F12_SHIFT: '.uno:Save', F12_MOD1: '.uno:OpenFromCalc', F12_SHIFT_MOD1: '.uno:Print',
  F3_SHIFT: '.uno:FunctionDialog', F3_MOD1: '.uno:DefineName',
});

/**
 * Microsoft Excel for Mac ("Keyboard shortcuts in Excel", support.microsoft.com, macOS tab), for
 * the commands Calc has, over the application's keys (Cmd is MOD1, Ctrl MOD3).
 */
export const EXCEL_MAC_KEYMAP: Keymap = overlay({
  F2: '.uno:SetInputMode', U_MOD3: '.uno:SetInputMode', T_MOD1: '.uno:ToggleRelative', F4: '.uno:ToggleRelative',
  F_MOD1: '.uno:SearchDialog', H_MOD3: '.uno:SearchDialog',
  D_MOD1: '.uno:FillDown', R_MOD1: '.uno:FillRight', '9_MOD3': '.uno:HideRow', '0_MOD3': '.uno:HideColumn',
  X_SHIFT_MOD1: '.uno:Strikeout', '1_MOD1': '.uno:FormatCellDialog',
  T_SHIFT_MOD1: '.uno:AutoSum', EQUAL_MOD1_MOD2: '.uno:AutoSum', K_MOD1: '.uno:HyperlinkDialog',
  ADD_MOD3: '.uno:InsertCell', SUBTRACT_MOD3: '.uno:DeleteCell', SUBTRACT_MOD1: '.uno:DeleteCell',
  SPACE_MOD3: '.uno:SelectColumn', SPACE_SHIFT: '.uno:SelectRow', SPACE_SHIFT_MOD1: '.uno:SelectAll',
  QUOTELEFT_MOD3: '.uno:ToggleFormula', SEMICOLON_MOD3: '.uno:InsertCurrentDate', SEMICOLON_MOD1: '.uno:InsertCurrentTime',
  F11_SHIFT: '.uno:Insert', PAGEDOWN_MOD2: '.uno:JumpToNextTable', PAGEUP_MOD2: '.uno:JumpToPrevTable',
  V_MOD1_MOD3: '.uno:PasteSpecial', Y_MOD1: '.uno:Redo',
});

export const KEYMAPS: Record<KeymapTemplate, Keymap> = { default: DEFAULT_KEYMAP, libreoffice: LIBREOFFICE_KEYMAP, excelWindows: EXCEL_WINDOWS_KEYMAP, excelMac: EXCEL_MAC_KEYMAP };

export const CALC_KEYMAP_TEMPLATES: KeymapTemplates = { ids: KEYMAP_TEMPLATES, maps: KEYMAPS };

export const keymapChoice = (m: Keymap): KeymapChoice => keymapChoiceOf(CALC_KEYMAP_TEMPLATES, m);

/** Calc's map in use, kept under `calc:keymap` (LibreOffice keeps shortcuts per module). */
export class KeymapStore extends ShellKeymapStore {
  constructor(storage: KeyValueStorage | null) { super(storage, CALC_KEYMAP_TEMPLATES, 'calc:keymap'); }
}
