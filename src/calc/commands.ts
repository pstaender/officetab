// `.uno:` command dispatch. Keys are upstream's command names, so menus, toolbars and shortcuts
// generated from upstream light up as soon as a command is registered here. The commands are
// ScCellShell's, ScFormatShell's and ScTabViewShell's slots (cellsh*.cxx, formatsh.cxx,
// tabvwsh*.cxx), calling the view (ScTabViewShell) the way those slots do.
import { SHELL_COMMANDS, dispatchCommand, type Command as ShellCommand, type CommandTable } from '@shell/commands.ts';
import { fromColorInt, lastColor, rememberColor } from '@shell/colors.ts';
import type { Controller } from './controller.ts';
import { ScFollowMode, ScSplitMode } from '@lo/sc/source/ui/view/viewdata.ts';
import { DelCellCmd, FillDir, InsCellCmd, InsertDeleteFlags, ScSizeMode } from '@lo/sc/inc/global.ts';
import { ViewOption } from '@lo/sc/inc/viewopti.ts';
import type { SvxBorderLine, SvxCellHorJustify, SvxCellVerJustify, ScItems } from '@lo/sc/inc/scitems.ts';
import { SvNumFormatType } from '@lo/svl/source/numbers/zforlist.ts';
import { ScSortParam, ScColorSortMode } from '@lo/sc/inc/sortparam.ts';
import { GetAutoSumArea, GetRefString, IsFormulaText } from '@lo/sc/source/ui/app/inputhdl.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { ToggleRelative } from './refs.ts';
import { copyCommand, getLastClip, pasteCommand, pasteOnly } from './clipboard.ts';
import { t } from '@shell/i18n.ts';

export type Command = ShellCommand<Controller>;

const { SC_FOLLOW_LINE, SC_FOLLOW_JUMP, SC_FOLLOW_FIX, SC_FOLLOW_JUMP_END } = ScFollowMode;

const pattern = (c: Controller) => c.view.GetSelectionPattern();
const attr = <K extends keyof ScItems>(c: Controller, k: K): ScItems[K] => pattern(c).GetItem(k);
const notEditing = (c: Controller) => !c.edit;

/** A toggle of a boolean font attribute (SID_ATTR_CHAR_WEIGHT …), for the selection. */
const toggle = (key: 'ATTR_FONT_WEIGHT' | 'ATTR_FONT_POSTURE' | 'ATTR_FONT_CROSSEDOUT' | 'ATTR_FONT_SHADOWED' | 'ATTR_FONT_CONTOUR' | 'ATTR_LINEBREAK'): Command => ({
  exec: (c) => c.view.ApplyAttributes({ [key]: !attr(c, key) }),
  checked: (c) => attr(c, key),
});
const line = (key: 'ATTR_FONT_UNDERLINE' | 'ATTR_FONT_OVERLINE', style: 'single' | 'double'): Command => ({
  exec: (c) => c.view.ApplyAttributes({ [key]: attr(c, key) === style ? 'none' : style }),
  checked: (c) => attr(c, key) === style,
});
/** ScFormatShell's horizontal alignment: a second click goes back to the standard alignment. */
const horJustify = (j: SvxCellHorJustify): Command => ({
  exec: (c) => c.view.ApplyAttributes({ ATTR_HOR_JUSTIFY: attr(c, 'ATTR_HOR_JUSTIFY') === j ? 'Standard' : j }),
  checked: (c) => attr(c, 'ATTR_HOR_JUSTIFY') === j,
});
const verJustify = (j: SvxCellVerJustify): Command => ({
  exec: (c) => c.view.ApplyAttributes({ ATTR_VER_JUSTIFY: attr(c, 'ATTR_VER_JUSTIFY') === j ? 'Standard' : j }),
  checked: (c) => attr(c, 'ATTR_VER_JUSTIFY') === j,
});
/** ScFormatShell::ExecuteNumFormat's types: a second click goes back to General. */
const numFormat = (eType: SvNumFormatType, code?: string): Command => ({
  exec: (c) => {
    const cur = c.view.GetCurNumFormat();
    if (cur.type === eType && (!code || cur.code === code)) c.view.SetNumberFormat(SvNumFormatType.NUMBER);
    else if (code) c.view.SetNumFmtByStr(code);
    else c.view.SetNumberFormat(eType);
  },
  checked: (c) => { const cur = c.view.GetCurNumFormat(); return cur.type === eType && (!code || cur.code === code); },
});

/** Cursor movement (ScCellShell::ExecuteCursor): plain, or extending the selection (…Sel). */
const move = (dx: number, dy: number, sel: boolean): Command => ({
  exec: (c) => {
    c.view.GetViewData().SetTabStartCol(-1);
    if (sel) c.view.ExpandBlock(dx, dy, SC_FOLLOW_LINE);
    else c.view.MoveCursorRel(dx, dy, SC_FOLLOW_LINE, false);
  },
  enabled: notEditing,
});
const moveArea = (dx: number, dy: number, sel: boolean): Command => ({
  exec: (c) => { if (sel) c.view.ExpandBlockArea(dx, dy); else c.view.MoveCursorArea(dx, dy, SC_FOLLOW_JUMP, false); },
  enabled: notEditing,
});
const movePage = (dx: number, dy: number, sel: boolean): Command => ({
  exec: (c) => { if (sel) c.view.ExpandBlockPage(dx, dy); else c.view.MoveCursorPage(dx, dy, SC_FOLLOW_FIX, false); },
  enabled: notEditing,
});
const moveEnd = (dx: number, dy: number, sel: boolean, mode: ScFollowMode = SC_FOLLOW_LINE): Command => ({
  exec: (c) => c.view.MoveCursorEnd(dx, dy, mode, sel),
  enabled: notEditing,
});

const hasUndo = (c: Controller) => c.sh.GetUndoManager().GetUndoActionCount() > 0;
const hasRedo = (c: Controller) => c.sh.GetUndoManager().GetRedoActionCount() > 0;
const notMulti = (c: Controller) => !c.view.GetViewData().GetMarkData().IsMultiMarked();

/** The font or background colour for the selection; the argument is 0xRRGGBB, -1 for automatic. */
function setColor(c: Controller, kind: 'font' | 'highlight', v: number | undefined): void {
  const color = v === undefined ? lastColor(kind) : v < 0 ? null : fromColorInt(v);
  if (color) rememberColor(kind, color);
  c.view.ApplyAttributes(kind === 'font' ? { ATTR_FONT_COLOR: color } : { ATTR_BACKGROUND: color });
}

/** The border line of the toolbar (SvxLineStyleToolBoxControl's width), and its colour. */
let borderWidth = 15;
let borderColor = '#000000';
const borderLine = (): SvxBorderLine => ({ color: borderColor, width: borderWidth, style: 'solid' });

/**
 * SvxFrameWindow_Impl's arrangements for Calc, 1 … 12: no borders, left, right, left and right,
 * top, bottom, top and bottom, outer, outer with horizontal inner lines, outer with all inner lines,
 * outer with vertical inner lines, all inner lines (as Calc's frame window lists them).
 */
export const BORDER_PRESETS: [number, string][] = [
  [1, 'No Borders'], [2, 'Left Border'], [3, 'Right Border'], [4, 'Left and Right Borders'], [5, 'Top Border'], [6, 'Bottom Border'],
  [7, 'Top and Bottom Borders'], [8, 'Outer Border'], [9, 'Outer Border and Horizontal Lines'], [10, 'Outer Border and All Inner Lines'],
  [11, 'Outer Border and Vertical Lines'], [12, 'All Borders, Thick Outer'],
];
export const LINE_WIDTHS: [number, string][] = [[1, 'Hairline (0.05 pt)'], [10, 'Very thin (0.5 pt)'], [15, 'Thin (0.75 pt)'], [30, 'Medium (1.5 pt)'], [45, 'Thick (2.25 pt)'], [90, 'Extra thick (4.5 pt)']];

function applyBorderPreset(c: Controller, n: number): void {
  const l = borderLine();
  const v = c.view;
  switch (n) {
    case 1: v.ApplyFrameLines(null, false, false, false, false, false, false, true); break;
    case 2: v.ApplyFrameLines(l, true, false, false, false, false, false); break;
    case 3: v.ApplyFrameLines(l, false, true, false, false, false, false); break;
    case 4: v.ApplyFrameLines(l, true, true, false, false, false, false); break;
    case 5: v.ApplyFrameLines(l, false, false, true, false, false, false); break;
    case 6: v.ApplyFrameLines(l, false, false, false, true, false, false); break;
    case 7: v.ApplyFrameLines(l, false, false, true, true, false, false); break;
    case 8: v.ApplyFrameLines(l, true, true, true, true, false, false); break;
    case 9: v.ApplyFrameLines(l, true, true, true, true, true, false); break;
    case 10: v.ApplyFrameLines(l, true, true, true, true, true, true); break;
    case 11: v.ApplyFrameLines(l, true, true, true, true, false, true); break;
    case 12:
      v.ApplyFrameLines(l, true, true, true, true, true, true);
      v.ApplyFrameLines({ ...l, width: Math.max(30, l.width * 2) }, true, true, true, true, false, false);
      break;
  }
}

/** A view option on or off (SID_TOGGLE_GRID, FID_TOGGLEHEADERS, FID_TOGGLESYNTAX …), kept. */
const viewOption = (o: number): Command => ({
  exec: (c) => { c.viewOptions.SetOption(o as never, !c.viewOptions.GetOption(o as never)); c.saveOptions(); },
  checked: (c) => c.viewOptions.GetOption(o as never),
});

/** AutoSum and the sum bar's functions: the function of the range above or left of the cursor. */
export function autoFunc(c: Controller, name: string): void {
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const nTab = v.GetTabNo();
  const { rRange } = v.GetSimpleArea();
  const sel = v.GetMarkData().IsMarked();
  if (sel && !rRange.aStart.equals(rRange.aEnd)) {
    // a selection: the function goes below it (ScViewFunc::EnterAutoSum with a selection)
    const nRow = Math.min(rDoc.MaxRow(), rRange.aEnd.Row() + 1);
    c.view.GetViewData().GetDocFunc().EnterListAction('AutoSum');
    for (let nCol = rRange.aStart.Col(); nCol <= rRange.aEnd.Col(); nCol++) {
      const r = rRange.clone();
      r.aStart.SetCol(nCol); r.aEnd.SetCol(nCol);
      c.view.EnterData(nCol, nRow, nTab, `=${name}(${GetRefString(rDoc, r, nTab)})`);
    }
    c.view.GetViewData().GetDocFunc().EndListAction();
    return;
  }
  const area = GetAutoSumArea(rDoc, v.GetCurX(), v.GetCurY(), nTab);
  const text = `=${name}(${area ? GetRefString(rDoc, area, nTab) : ''})`;
  c.startEdit(text, 'cell', text.length - 1);
  if (area) c.view.MarkRange(area, false);
  c.edit && (c.edit.selStart = c.edit.selEnd = text.length - 1);
  c.focusCellEditor();
}

/** Sort Ascending/Descending (SID_SORT_ASCENDING): the data area by the cursor's column, a header detected. */
function quickSort(c: Controller, bAscending: boolean): void {
  const view = c.view;
  const v = view.GetViewData();
  const r = view.GetSortArea();
  const rDoc = c.sh.GetDocument();
  const p = new ScSortParam();
  p.nCol1 = r.aStart.Col(); p.nRow1 = r.aStart.Row(); p.nCol2 = r.aEnd.Col(); p.nRow2 = r.aEnd.Row();
  p.nSourceTab = v.GetTabNo();
  p.bByRow = true;
  // ScDBFunc: a first row of texts over numbers is a header
  let bHeader = false;
  if (p.nRow2 > p.nRow1) {
    for (let nCol = p.nCol1; nCol <= p.nCol2; nCol++) {
      if (rDoc.HasStringData(nCol, p.nRow1, p.nSourceTab) && rDoc.HasValueData(nCol, p.nRow1 + 1, p.nSourceTab)) { bHeader = true; break; }
    }
  }
  p.bHasHeader = bHeader;
  p.maKeyState = [{ nField: Math.min(Math.max(v.GetCurX(), p.nCol1), p.nCol2), bDoSort: true, bAscending, aColorSortMode: ScColorSortMode.None, aColorSortColor: null }];
  view.Sort(p);
}

/** The cell style commands of the Styles menu (.uno:GoodCellStyles …, SID_CELL_FORMAT_RESET's neighbours). */
const cellStyle = (name: string): Command => ({
  exec: (c) => c.view.SetStyleSheetToMarked(name),
  checked: (c) => c.view.GetSelectionPattern().GetStyleName() === name,
});

export const COMMANDS: CommandTable<Controller> = {
  // File (storage, downloads, versions), Tools > Options, Help, zoom and Menu: the shell's.
  ...(SHELL_COMMANDS as CommandTable<Controller>),
  '.uno:OpenFromCalc': { exec: (c) => c.setDialog('documents') },
  '.uno:Undo': { exec: (c) => c.undo(), enabled: hasUndo },
  '.uno:Redo': { exec: (c) => c.redo(), enabled: hasRedo },
  '.uno:SelectAll': { exec: (c) => c.view.SelectAll() },
  '.uno:SelectColumn': { exec: (c) => c.view.MarkSelectionColumns(true), enabled: notEditing },
  '.uno:SelectRow': { exec: (c) => c.view.MarkSelectionColumns(false), enabled: notEditing },
  '.uno:SelectData': { exec: (c) => c.view.MarkDataArea(), enabled: notEditing },
  // Navigation (ScCellShell::ExecuteCursor, ExecuteCursorSel, ExecutePage)
  '.uno:GoDown': move(0, 1, false), '.uno:GoUp': move(0, -1, false), '.uno:GoLeft': move(-1, 0, false), '.uno:GoRight': move(1, 0, false),
  '.uno:GoDownSel': move(0, 1, true), '.uno:GoUpSel': move(0, -1, true), '.uno:GoLeftSel': move(-1, 0, true), '.uno:GoRightSel': move(1, 0, true),
  '.uno:GoDownToEndOfData': moveArea(0, 1, false), '.uno:GoUpToStartOfData': moveArea(0, -1, false),
  '.uno:GoLeftToStartOfData': moveArea(-1, 0, false), '.uno:GoRightToEndOfData': moveArea(1, 0, false),
  '.uno:GoDownToEndOfDataSel': moveArea(0, 1, true), '.uno:GoUpToStartOfDataSel': moveArea(0, -1, true),
  '.uno:GoLeftToStartOfDataSel': moveArea(-1, 0, true), '.uno:GoRightToEndOfDataSel': moveArea(1, 0, true),
  '.uno:GoDownBlock': movePage(0, 1, false), '.uno:GoUpBlock': movePage(0, -1, false),
  '.uno:GoDownBlockSel': movePage(0, 1, true), '.uno:GoUpBlockSel': movePage(0, -1, true),
  '.uno:GoToStartOfRow': moveEnd(-1, 0, false), '.uno:GoToEndOfRow': moveEnd(1, 0, false, SC_FOLLOW_JUMP),
  '.uno:GoToStartOfRowSel': moveEnd(-1, 0, true), '.uno:GoToEndOfRowSel': moveEnd(1, 0, true, SC_FOLLOW_JUMP),
  '.uno:GoToStart': moveEnd(-1, -1, false), '.uno:GoToEndOfData': moveEnd(1, 1, false, SC_FOLLOW_JUMP_END),
  '.uno:GoToStartSel': moveEnd(-1, -1, true), '.uno:GoToEndOfDataSel': moveEnd(1, 1, true, SC_FOLLOW_JUMP_END),
  '.uno:JumpToNextUnprotected': { exec: (c) => c.view.MoveCursorTab(false), enabled: notEditing },
  '.uno:JumpToPreviousUnprotected': { exec: (c) => c.view.MoveCursorTab(true), enabled: notEditing },
  '.uno:JumpToNextTable': { exec: (c) => { c.cancelEdit(); c.view.SelectNextTab(1); }, enabled: (c) => c.view.GetViewData().GetTabNo() < c.sh.GetDocument().GetTableCount() - 1 },
  '.uno:JumpToPrevTable': { exec: (c) => { c.cancelEdit(); c.view.SelectNextTab(-1); }, enabled: (c) => c.view.GetViewData().GetTabNo() > 0 },
  '.uno:GoToCurrentCell': { exec: (c) => { const v = c.view.GetViewData(); c.view.AlignToCursor(v.GetCurX(), v.GetCurY(), SC_FOLLOW_JUMP); } },
  // Escape without input: the copy marquee and the selection go (SID_CANCEL)
  '.uno:Cancel': { exec: (c) => { if (c.copySource) { c.copySource = null; c.notify(); } else c.view.Unmark(); }, enabled: notEditing },
  '.uno:Deselect': { exec: (c) => c.view.Unmark(), enabled: notEditing },
  '.uno:SetInputMode': { exec: (c) => { c.startEdit(undefined, 'cell'); c.focusCellEditor(); }, enabled: notEditing },
  '.uno:FocusInputLine': { exec: (c) => { if (!c.edit) c.startEdit(undefined, 'bar'); c.focusInputLine(); } },
  '.uno:FocusCellAddress': { exec: (c) => c.focusNameBox() },
  // F4 in a formula: the reference at the caret cycles through relative and absolute (SID_TOGGLE_REL)
  '.uno:ToggleRelative': {
    exec: (c) => {
      const e = c.edit;
      if (!e) return;
      const r = ToggleRelative(c, e.text, e.selStart);
      if (r) c.setEditText(r.text, r.caret);
    },
    enabled: (c) => !!c.edit && IsFormulaText(c.edit.text),
  },
  // Clipboard from the menus (the keys stay native)
  '.uno:Cut': { exec: (c) => copyCommand(c, true), enabled: notEditing },
  '.uno:Copy': { exec: (c) => copyCommand(c, false), enabled: notEditing },
  '.uno:Paste': { exec: (c) => pasteCommand(c), enabled: notEditing },
  '.uno:PasteUnformatted': { exec: (c) => pasteCommand(c, true), enabled: notEditing },
  '.uno:PasteSpecial': { exec: (c) => c.setDialog('pastespecial'), enabled: notEditing },
  '.uno:PasteOnlyText': { exec: (c) => pasteOnly(c, InsertDeleteFlags.STRING), enabled: (c) => notEditing(c) && !!getLastClip() },
  '.uno:PasteOnlyValue': { exec: (c) => pasteOnly(c, InsertDeleteFlags.VALUE | InsertDeleteFlags.DATETIME), enabled: (c) => notEditing(c) && !!getLastClip() },
  '.uno:PasteOnlyFormula': { exec: (c) => pasteOnly(c, InsertDeleteFlags.FORMULA), enabled: (c) => notEditing(c) && !!getLastClip() },
  // Dialogs
  '.uno:Delete': { exec: (c) => c.setDialog('deletecontents'), enabled: notEditing },
  '.uno:InsertCell': { exec: (c) => c.setDialog('insertcells'), enabled: (c) => notEditing(c) && notMulti(c) },
  '.uno:DeleteCell': { exec: (c) => c.setDialog('deletecells'), enabled: (c) => notEditing(c) && notMulti(c) },
  '.uno:RowHeight': { exec: (c) => c.setDialog('rowheight') },
  '.uno:ColumnWidth': { exec: (c) => c.setDialog('colwidth') },
  '.uno:SetOptimalRowHeight': { exec: (c) => c.setDialog('optimalrowheight') },
  '.uno:SetOptimalColumnWidth': { exec: (c) => c.setDialog('optimalcolwidth') },
  '.uno:FormatCellDialog': { exec: (c) => { if (c.edit) c.commitEdit('none'); c.setDialog('formatcells'); } },
  '.uno:DataSort': { exec: (c) => c.setDialog('sort'), enabled: notEditing },
  '.uno:SearchDialog': { exec: (c) => c.setDialog('find') },
  // Sheets (ScTabViewShell::ExecuteTable)
  '.uno:Insert': { exec: (c) => c.setDialog('insertsheet'), enabled: notEditing },
  '.uno:InsertSheetAtEnd': { exec: (c) => { const rDoc = c.sh.GetDocument(); c.view.InsertTable(rDoc.CreateValidTabName(`Sheet${rDoc.GetTableCount() + 1}`), rDoc.GetTableCount()); }, enabled: notEditing },
  '.uno:Remove': {
    exec: async (c) => {
      const tabs = c.view.GetViewData().GetMarkData().GetSelectedTabs();
      if (!(await c.queryYesNo(t('calc.deleteSheetTitle'), t('calc.deleteSheetQuery')))) return;
      const rDocFunc = c.view.GetViewData().GetDocFunc();
      rDocFunc.EnterListAction(t('calc.deleteSheetTitle'));
      for (const n of [...tabs].sort((a, b) => b - a)) c.view.DeleteTable(n);
      rDocFunc.EndListAction();
    },
    enabled: (c) => notEditing(c) && c.sh.GetDocument().GetTableCount() > c.view.GetViewData().GetMarkData().GetSelectCount(),
  },
  '.uno:RenameTable': { exec: (c) => c.setDialog('renamesheet'), enabled: notEditing },
  '.uno:Move': { exec: (c) => c.setDialog('movesheet'), enabled: notEditing },
  '.uno:DuplicateSheet': { exec: (c) => { const n = c.view.GetViewData().GetTabNo(); c.view.MoveTable(n + 1, true, n); }, enabled: notEditing },
  '.uno:SetTabBgColor': { exec: (c) => c.setDialog('tabcolor') },
  '.uno:TableSelectAll': { exec: (c) => { const m = c.view.GetViewData().GetMarkData(); for (let i = 0; i < c.sh.GetDocument().GetTableCount(); i++) m.SelectTable(i, true); c.notify(); } },
  '.uno:TableDeselectAll': { exec: (c) => { const v = c.view.GetViewData(); v.GetMarkData().SelectOneTable(v.GetTabNo()); c.notify(); } },
  '.uno:Hide': {
    exec: (c) => { const v = c.view.GetViewData(); const rDoc = c.sh.GetDocument(); const n = v.GetTabNo(); rDoc.SetVisible(n, false); c.sh.SetDocumentModified(); c.view.SelectNextTab(1); if (v.GetTabNo() === n) c.view.SelectNextTab(-1); c.notify(); },
    enabled: (c) => { const rDoc = c.sh.GetDocument(); let vis = 0; for (let i = 0; i < rDoc.GetTableCount(); i++) if (rDoc.IsVisible(i)) vis++; return vis > 1; },
  },
  '.uno:Show': {
    exec: (c) => { const rDoc = c.sh.GetDocument(); for (let i = 0; i < rDoc.GetTableCount(); i++) rDoc.SetVisible(i, true); c.sh.SetDocumentModified(); c.notify(); },
    enabled: (c) => { const rDoc = c.sh.GetDocument(); for (let i = 0; i < rDoc.GetTableCount(); i++) if (!rDoc.IsVisible(i)) return true; return false; },
  },
  // Edit
  '.uno:ClearContents': { exec: (c) => c.view.DeleteContents(InsertDeleteFlags.CONTENTS & ~InsertDeleteFlags.NOTE), enabled: notEditing },
  '.uno:FillDown': { exec: (c) => c.view.FillSimple(FillDir.FILL_TO_BOTTOM), enabled: notEditing },
  '.uno:FillRight': { exec: (c) => c.view.FillSimple(FillDir.FILL_TO_RIGHT), enabled: notEditing },
  '.uno:FillUp': { exec: (c) => c.view.FillSimple(FillDir.FILL_TO_TOP), enabled: notEditing },
  '.uno:FillLeft': { exec: (c) => c.view.FillSimple(FillDir.FILL_TO_LEFT), enabled: notEditing },
  '.uno:InsertCurrentDate': {
    exec: (c) => { const d = DateTimeNow(); const s = `${d.Year}-${String(d.Month).padStart(2, '0')}-${String(d.Day).padStart(2, '0')}`; if (c.edit) c.insertInInput(s); else { const v = c.view.GetViewData(); c.view.EnterData(v.GetCurX(), v.GetCurY(), v.GetTabNo(), s); } },
  },
  '.uno:InsertCurrentTime': {
    exec: (c) => { const d = DateTimeNow(); const s = `${String(d.Hours).padStart(2, '0')}:${String(d.Minutes).padStart(2, '0')}:${String(d.Seconds).padStart(2, '0')}`; if (c.edit) c.insertInInput(s); else { const v = c.view.GetViewData(); c.view.EnterData(v.GetCurX(), v.GetCurY(), v.GetTabNo(), s); } },
  },
  '.uno:Calculate': { exec: (c) => { c.sh.GetDocument().CalcAll(); c.sh.PostPaintGridAll(); c.notify(); } },
  '.uno:CalculateHard': { exec: (c) => { c.sh.GetDocument().CalcAll(); c.sh.PostPaintGridAll(); c.notify(); } },
  '.uno:AutoSum': { exec: (c) => autoFunc(c, 'SUM'), enabled: notEditing },
  '.uno:InsertRowsBefore': { exec: (c) => { c.view.InsertCells(InsCellCmd.INS_INSROWS_BEFORE); }, enabled: notMulti },
  '.uno:InsertRowsAfter': { exec: (c) => { c.view.InsertCells(InsCellCmd.INS_INSROWS_AFTER); }, enabled: notMulti },
  '.uno:InsertColumnsBefore': { exec: (c) => { c.view.InsertCells(InsCellCmd.INS_INSCOLS_BEFORE); }, enabled: notMulti },
  '.uno:InsertColumnsAfter': { exec: (c) => { c.view.InsertCells(InsCellCmd.INS_INSCOLS_AFTER); }, enabled: notMulti },
  '.uno:DeleteRows': { exec: (c) => { c.view.DeleteCells(DelCellCmd.Rows); }, enabled: notMulti },
  '.uno:DeleteColumns': { exec: (c) => { c.view.DeleteCells(DelCellCmd.Cols); }, enabled: notMulti },
  '.uno:HideRow': { exec: (c) => c.view.SetMarkedWidthOrHeight(false, ScSizeMode.SC_SIZE_DIRECT, 0) },
  '.uno:ShowRow': { exec: (c) => c.view.SetMarkedWidthOrHeight(false, ScSizeMode.SC_SIZE_SHOW, 0) },
  '.uno:HideColumn': { exec: (c) => c.view.SetMarkedWidthOrHeight(true, ScSizeMode.SC_SIZE_DIRECT, 0) },
  '.uno:ShowColumn': { exec: (c) => c.view.SetMarkedWidthOrHeight(true, ScSizeMode.SC_SIZE_SHOW, 0) },
  // Merge (FID_MERGE_ON, FID_MERGE_OFF, FID_MERGE_TOGGLE)
  '.uno:MergeCells': { exec: (c) => { c.view.MergeCells(false); }, enabled: (c) => c.view.TestMergeCells() },
  '.uno:MergeAndCenterCells': { exec: (c) => { c.view.MergeCells(false, true); }, enabled: (c) => c.view.TestMergeCells() },
  '.uno:SplitCell': { exec: (c) => { c.view.RemoveMerge(); }, enabled: (c) => c.view.IsMerged() },
  '.uno:ToggleMergeCells': {
    exec: (c) => { if (c.view.IsMerged()) c.view.RemoveMerge(); else c.view.MergeCells(false, true); },
    checked: (c) => c.view.IsMerged(),
    enabled: (c) => c.view.IsMerged() || c.view.TestMergeCells(),
  },
  // Format
  '.uno:Bold': toggle('ATTR_FONT_WEIGHT'),
  '.uno:Italic': toggle('ATTR_FONT_POSTURE'),
  '.uno:Strikeout': toggle('ATTR_FONT_CROSSEDOUT'),
  '.uno:Shadowed': toggle('ATTR_FONT_SHADOWED'),
  '.uno:OutlineFont': toggle('ATTR_FONT_CONTOUR'),
  '.uno:Underline': line('ATTR_FONT_UNDERLINE', 'single'),
  '.uno:UnderlineSingle': line('ATTR_FONT_UNDERLINE', 'single'),
  '.uno:UnderlineDouble': line('ATTR_FONT_UNDERLINE', 'double'),
  '.uno:Overline': line('ATTR_FONT_OVERLINE', 'single'),
  '.uno:WrapText': toggle('ATTR_LINEBREAK'),
  '.uno:Grow': { exec: (c) => c.view.ApplyAttributes({ ATTR_FONT_HEIGHT: attr(c, 'ATTR_FONT_HEIGHT') + 20 }) },
  '.uno:Shrink': { exec: (c) => c.view.ApplyAttributes({ ATTR_FONT_HEIGHT: Math.max(40, attr(c, 'ATTR_FONT_HEIGHT') - 20) }) },
  '.uno:Color': { exec: (c, a) => setColor(c, 'font', a?.Color) },
  '.uno:FontColor': { exec: (c, a) => setColor(c, 'font', a?.FontColor ?? a?.Color) },
  '.uno:BackgroundColor': { exec: (c, a) => setColor(c, 'highlight', a?.BackgroundColor) },
  // the font boxes dispatch their values themselves (CharFontName, FontHeight)
  '.uno:AlignLeft': horJustify('Left'),
  '.uno:AlignHorizontalCenter': horJustify('Center'),
  '.uno:AlignRight': horJustify('Right'),
  '.uno:AlignBlock': horJustify('Block'),
  '.uno:CommonAlignLeft': horJustify('Left'),
  '.uno:CommonAlignHorizontalCenter': horJustify('Center'),
  '.uno:CommonAlignRight': horJustify('Right'),
  '.uno:CommonAlignJustified': horJustify('Block'),
  '.uno:AlignTop': verJustify('Top'),
  '.uno:AlignVCenter': verJustify('Center'),
  '.uno:AlignBottom': verJustify('Bottom'),
  '.uno:CommonAlignTop': verJustify('Top'),
  '.uno:CommonAlignVerticalCenter': verJustify('Center'),
  '.uno:CommonAlignBottom': verJustify('Bottom'),
  '.uno:IncrementIndent': { exec: (c) => c.view.ApplyAttributes({ ATTR_INDENT: attr(c, 'ATTR_INDENT') + 200, ATTR_HOR_JUSTIFY: attr(c, 'ATTR_HOR_JUSTIFY') === 'Right' ? 'Right' : 'Left' }) },
  '.uno:DecrementIndent': { exec: (c) => c.view.ApplyAttributes({ ATTR_INDENT: Math.max(0, attr(c, 'ATTR_INDENT') - 200) }) },
  '.uno:ResetAttributes': { exec: (c) => { c.view.DeleteContents(InsertDeleteFlags.ATTRIB & ~InsertDeleteFlags.STYLES); } },
  '.uno:NumberFormatStandard': numFormat(SvNumFormatType.NUMBER, 'General'),
  '.uno:NumberFormatCurrency': numFormat(SvNumFormatType.CURRENCY),
  '.uno:NumberFormatPercent': numFormat(SvNumFormatType.PERCENT),
  '.uno:NumberFormatDate': numFormat(SvNumFormatType.DATE),
  '.uno:NumberFormatTime': numFormat(SvNumFormatType.TIME),
  '.uno:NumberFormatScientific': numFormat(SvNumFormatType.SCIENTIFIC),
  '.uno:NumberFormatDecimal': numFormat(SvNumFormatType.NUMBER, '#,##0.00'),
  '.uno:NumberFormatIncDecimals': { exec: (c) => c.view.ChangeNumFmtDecimals(true) },
  '.uno:NumberFormatDecDecimals': { exec: (c) => c.view.ChangeNumFmtDecimals(false) },
  '.uno:NumberFormatThousands': {
    exec: (c) => c.view.ToggleThousandsSeparator(),
    checked: (c) => /,/.test(c.view.GetCurNumFormat().code.split(';')[0]!.replace(/"[^"]*"|\[[^\]]*\]/g, '')),
  },
  '.uno:SetBorderStyle': { exec: (c, a) => applyBorderPreset(c, a?.SetBorderStyle ?? 8) },
  '.uno:LineStyle': { exec: (_c, a) => { if (a?.LineStyle) borderWidth = a.LineStyle; } },
  '.uno:FrameLineColor': { exec: (_c, a) => { if (a?.FrameLineColor !== undefined) borderColor = a.FrameLineColor < 0 ? '#000000' : fromColorInt(a.FrameLineColor); } },
  '.uno:DefaultCellStylesmenu': cellStyle('Default'),
  '.uno:Accent1CellStyles': cellStyle('Accent 1'),
  '.uno:Accent2CellStyles': cellStyle('Accent 2'),
  '.uno:Accent3CellStyles': cellStyle('Accent 3'),
  '.uno:BadCellStyles': cellStyle('Bad'),
  '.uno:ErrorCellStyles': cellStyle('Error'),
  '.uno:GoodCellStyles': cellStyle('Good'),
  '.uno:NeutralCellStyles': cellStyle('Neutral'),
  '.uno:WarningCellStyles': cellStyle('Warning'),
  '.uno:FootnoteCellStyles': cellStyle('Footnote'),
  '.uno:NoteCellStyles': cellStyle('Note'),
  // Sheet
  '.uno:FreezePanes': {
    exec: (c) => { if (c.view.HasFrozenPanes()) c.view.RemoveSplit(); else c.view.FreezeSplitters(true); },
    checked: (c) => c.view.HasFrozenPanes(),
  },
  '.uno:FreezePanesFirstRow': { exec: (c) => { c.view.RemoveSplit(); c.view.FreezeSplitters(true, 1, 1); } },
  '.uno:FreezePanesFirstColumn': { exec: (c) => { c.view.RemoveSplit(); c.view.FreezeSplitters(true, 0, 1); } },
  // Data
  '.uno:SortAscending': { exec: (c) => quickSort(c, true), enabled: notEditing },
  '.uno:SortDescending': { exec: (c) => quickSort(c, false), enabled: notEditing },
  // View
  '.uno:ToggleSheetGrid': {
    exec: (c) => { const v = c.view.GetViewData(); v.SetShowGrid(!v.IsGridMode()); c.notify(); },
    checked: (c) => c.view.GetViewData().IsGridMode(),
  },
  '.uno:ViewRowColumnHeaders': viewOption(ViewOption.HEADER),
  '.uno:ToggleFormula': viewOption(ViewOption.FORMULAS),
};

/** Whether the frozen panes are on (for the status of FreezePanes). */
export const isFrozen = (c: Controller) => c.view.GetViewData().GetHSplitMode() === ScSplitMode.SC_SPLIT_FIX || c.view.GetViewData().GetVSplitMode() === ScSplitMode.SC_SPLIT_FIX;


export function dispatch(c: Controller, name: string, args?: Record<string, number>): boolean {
  return dispatchCommand(COMMANDS, c, name, args);
}
