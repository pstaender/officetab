// Writer's keyboard shortcut templates (Tools > Options > Keyboard Shortcuts): the application's
// keys, LibreOffice Writer's, and Word's for Windows and for Mac; and the store of the user's map,
// kept under Writer's own key. The machinery (key names, browser keys, files, the store) is the
// suite's, in src/shell/keymaps.ts.
import ui from './generated/upstream-ui.json';
import {
  KeymapStore as ShellKeymapStore, SHELL_KEYMAP_EDITS, keymapChoiceOf, overlayKeymap,
  type KeyValueStorage, type Keymap, type KeymapChoice, type KeymapTemplates,
} from '@shell/keymaps.ts';

export * from '@shell/keymaps.ts';

export const KEYMAP_TEMPLATES = ['default', 'libreoffice', 'msWindows', 'msMac'] as const;
export type KeymapTemplate = (typeof KEYMAP_TEMPLATES)[number];

export const LIBREOFFICE_KEYMAP: Keymap = { ...(ui.shortcuts as Keymap) };

/**
 * The application's keys: LibreOffice's, with the shell's changes (SHELL_KEYMAP_EDITS). In Writer,
 * Ctrl+/ (Cmd+/) opens Search Commands instead of inserting a zero-width space, Ctrl+F (Cmd+F)
 * opens Find & Replace, and Shift+Ctrl+R (View > Rulers) is left to the browser.
 */
export const DEFAULT_KEYMAP: Keymap = overlayKeymap(LIBREOFFICE_KEYMAP, SHELL_KEYMAP_EDITS);

/** Applies Word's keys over the application's: a command binds the key, null unbinds it. */
const overlay = (o: Record<string, string | null>): Keymap => overlayKeymap(DEFAULT_KEYMAP, o);

/**
 * Microsoft Word for Windows ("Keyboard shortcuts in Word", support.microsoft.com, Windows tab),
 * for the commands Writer has, over the application's keys. Word's Ctrl+Plus (zoom in) is the
 * Ctrl+= key here, as in browsers, since Ctrl+Shift+Plus is superscript. Ctrl+Alt+C copies the
 * formatting with the Clone Formatting brush.
 */
export const MS_WINDOWS_KEYMAP: Keymap = overlay({
  // Frequently used, zoom
  V_SHIFT_MOD1: '.uno:PasteUnformatted', EQUAL_MOD1: '.uno:ZoomPlus', SUBTRACT_MOD1: '.uno:ZoomMinus', '0_MOD1': '.uno:Zoom100Percent',
  // Navigate, find
  F_MOD1: '.uno:SearchDialog', F5: '.uno:GotoPage', F4_SHIFT: '.uno:RepeatSearch',
  // Edit
  C_MOD1_MOD2: '.uno:FormatPaintbrush',
  // Paragraphs
  M_MOD1: '.uno:IncrementIndent', M_SHIFT_MOD1: '.uno:DecrementIndent',
  '1_MOD1': '.uno:SpacePara1', '2_MOD1': '.uno:SpacePara2', '5_MOD1': '.uno:SpacePara15',
  K_MOD1_MOD2: '.uno:OnlineAutoFormat',
  '1_MOD1_MOD2': '.uno:Heading1ParaStyle', '2_MOD1_MOD2': '.uno:Heading2ParaStyle', '3_MOD1_MOD2': '.uno:Heading3ParaStyle',
  // Characters
  D_MOD1: '.uno:FontDialog', F_SHIFT_MOD1: '.uno:FontDialog', GREATER_MOD1: '.uno:Grow', LESS_MOD1: '.uno:Shrink',
  A_SHIFT_MOD1: '.uno:ChangeCaseToUpper', L_SHIFT_MOD1: '.uno:DefaultBullet', D_SHIFT_MOD1: '.uno:UnderlineDouble',
  SUBTRACT_SHIFT_MOD1: '.uno:SubScript', ADD_MOD1: '.uno:SuperScript', SPACE_MOD1: '.uno:ResetAttributes',
  '8_SHIFT_MOD1': '.uno:ControlCodes',
  // Special characters
  SUBTRACT_MOD1_MOD2: '.uno:InsertSoftHyphen', SUBTRACT_SHIFT_MOD2: '.uno:InsertHardHyphen',
  // Review, references
  M_MOD1_MOD2: '.uno:InsertAnnotation', E_SHIFT_MOD1: '.uno:TrackChanges',
  F_MOD1_MOD2: '.uno:InsertFootnote', D_MOD1_MOD2: '.uno:InsertEndnote', X_SHIFT_MOD2: '.uno:InsertIndexesEntry',
  // Fields
  D_SHIFT_MOD2: '.uno:InsertDateField', P_SHIFT_MOD2: '.uno:InsertPageNumberField', T_SHIFT_MOD2: '.uno:InsertTimeField',
  F9_MOD2: '.uno:Fieldnames', F9_MOD1: null,
  // Views
  P_MOD1_MOD2: '.uno:PrintLayout',
  // Function keys
  F4: '.uno:Repeat', F5_SHIFT_MOD1: '.uno:InsertBookmark', F7_SHIFT: '.uno:ThesaurusDialog', F8_MOD2: '.uno:MacroDialog',
  F12: '.uno:ExportTo', F12_SHIFT: '.uno:Save', F12_MOD1: '.uno:OpenFromWriter', F12_SHIFT_MOD1: '.uno:Print',
});

/**
 * Microsoft Word for Mac ("Keyboard shortcuts in Word", support.microsoft.com, macOS tab), for
 * the commands Writer has, over the application's keys. Cmd+Shift+= (superscript) and Cmd+K are
 * Word for Mac's menu keys, which the page does not list.
 */
export const MS_MAC_KEYMAP: Keymap = overlay({
  // Frequently used
  F1: '.uno:Undo', F2: '.uno:Cut', F3: '.uno:Copy', F4: '.uno:Paste', V_SHIFT_MOD1: '.uno:PasteUnformatted',
  EQUAL_MOD1: '.uno:ZoomPlus', SUBTRACT_MOD1: '.uno:ZoomMinus', '0_MOD1': '.uno:Zoom100Percent',
  G_MOD1_MOD2: '.uno:GotoPage', F5: '.uno:GotoPage', L_MOD1_MOD2: '.uno:SpellingAndGrammarDialog',
  F_MOD1: '.uno:SearchDialog', H_MOD3: '.uno:SearchDialog', F4_SHIFT: '.uno:RepeatSearch',
  // Editing
  V_MOD1_MOD3: '.uno:PasteSpecial', C_MOD1_MOD2: '.uno:FormatPaintbrush',
  // Paragraphs
  M_SHIFT_MOD3: '.uno:IncrementIndent', M_SHIFT_MOD1: '.uno:DecrementIndent',
  '1_MOD1': '.uno:SpacePara1', '2_MOD1': '.uno:SpacePara2', '5_MOD1': '.uno:SpacePara15',
  K_MOD1_MOD2: '.uno:OnlineAutoFormat',
  '1_MOD1_MOD2': '.uno:Heading1ParaStyle', '2_MOD1_MOD2': '.uno:Heading2ParaStyle', '3_MOD1_MOD2': '.uno:Heading3ParaStyle',
  SPACE_MOD2: '.uno:InsertNonBreakingSpace',
  // Characters
  GREATER_MOD1: '.uno:Grow', LESS_MOD1: '.uno:Shrink', D_MOD1: '.uno:FontDialog',
  A_SHIFT_MOD1: '.uno:ChangeCaseToUpper', L_SHIFT_MOD1: '.uno:DefaultBullet', D_SHIFT_MOD1: '.uno:UnderlineDouble',
  X_SHIFT_MOD1: '.uno:Strikeout', SUBTRACT_SHIFT_MOD1: '.uno:SubScript', ADD_MOD1: '.uno:SuperScript',
  // Special characters
  SUBTRACT_MOD1_MOD2: '.uno:InsertSoftHyphen', SUBTRACT_SHIFT_MOD2: '.uno:InsertHardHyphen',
  // Review, footnotes
  A_MOD1_MOD2: '.uno:InsertAnnotation', E_SHIFT_MOD1: '.uno:TrackChanges',
  F_MOD1_MOD2: '.uno:InsertFootnote', E_MOD1_MOD2: '.uno:InsertEndnote',
  // Fields
  D_SHIFT_MOD3: '.uno:InsertDateField', P_SHIFT_MOD3: '.uno:InsertPageNumberField', T_SHIFT_MOD3: '.uno:InsertTimeField',
  F9_MOD2: '.uno:Fieldnames', F9_MOD1: null,
  // Right-to-left text
  LEFT_MOD1_MOD3: '.uno:ParaRightToLeft', RIGHT_MOD1_MOD3: '.uno:ParaLeftToRight',
  // Function keys
  F5_SHIFT_MOD1: '.uno:InsertBookmark', F7_SHIFT: '.uno:ThesaurusDialog', F8_MOD2: '.uno:MacroDialog',
});

export const KEYMAPS: Record<KeymapTemplate, Keymap> = { default: DEFAULT_KEYMAP, libreoffice: LIBREOFFICE_KEYMAP, msWindows: MS_WINDOWS_KEYMAP, msMac: MS_MAC_KEYMAP };

/** Writer's templates, for the store and the options page. */
export const WRITER_KEYMAP_TEMPLATES: KeymapTemplates = { ids: KEYMAP_TEMPLATES, maps: KEYMAPS };

/** The template a map is, or custom when it is none of them. */
export const keymapChoice = (m: Keymap): KeymapChoice => keymapChoiceOf(WRITER_KEYMAP_TEMPLATES, m);

/** Writer's map in use, kept under `writer:keymap` (LibreOffice keeps shortcuts per module). */
export class KeymapStore extends ShellKeymapStore {
  constructor(storage: KeyValueStorage | null) { super(storage, WRITER_KEYMAP_TEMPLATES, 'writer:keymap'); }
}
