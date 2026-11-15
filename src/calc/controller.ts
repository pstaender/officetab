// Owns the open spreadsheet (ScDocShell) and its view (ScTabViewShell), and everything the React
// tree renders from them: the cell being edited, the view options, the dialogs.
import {
  AppController, newId, type AppDescription, type AppFileType, type FileHandle, type PackageImport, type ShellDialogId,
} from '@shell/appcontroller.ts';
import { appKey } from '@shell/settings.ts';
import { t } from '@shell/i18n.ts';
import type { ZipEntry } from '@lo/package/source/zipapi/zip.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { CanvasTextMeasurer, GetFontStacksGeneration, cssFont } from '@lo/vcl/source/outdev/text.ts';
import { ScDocShell } from '@lo/sc/source/ui/docshell/docsh.ts';
import { ScAddress, ScRange, type SCCOL, type SCROW, type SCTAB } from '@lo/sc/inc/address.ts';
import { ScInputOptions } from '@lo/sc/inc/inputopt.ts';
import { ScAppOptions } from '@lo/sc/inc/appoptio.ts';
import { ScViewOptions, ViewOption } from '@lo/sc/inc/viewopti.ts';
import { ScDirection } from '@lo/sc/inc/global.ts';
import { ScTabViewShell } from '@lo/sc/source/ui/view/tabvwsh.ts';
import { ScFollowMode, ScRefType, SC_SPLIT_BOTTOM, SC_SPLIT_LEFT, SC_SPLIT_RIGHT, SC_SPLIT_TOP, ScSplitMode } from '@lo/sc/source/ui/view/viewdata.ts';
import { GetAutoInputCompletion, GetRefString, GetReferenceAt, InitRangeFinder, IsFormulaText, IsRefInputPosition, type ScRangeFindList } from '@lo/sc/source/ui/app/inputhdl.ts';
import { CELLTYPE_FORMULA } from '@lo/sc/inc/cellvalue.ts';
import { DefaultViewSettings, DefaultViewSettingsTable, ExportFODS, ExportODS, ImportFODS, ImportODS, type ScViewSettings } from '@lo/sc/source/filter/xml/ods.ts';
import { ExportCSV, ImportCSV } from '@lo/sc/source/ui/docshell/impex.ts';
import { ResetFromTemplate } from '@lo/sfx2/source/doc/objcont.ts';
import type { AutoFilterData } from '@lo/sc/source/ui/view/gridwin.ts';
import type { ScValidationError } from '@lo/sc/source/core/data/validat.ts';
import { CheckValidity } from './datacommands.ts';

export type DialogId = ShellDialogId | 'formatcells' | 'insertcells' | 'deletecells' | 'deletecontents' | 'rowheight' | 'colwidth'
  | 'optimalrowheight' | 'optimalcolwidth' | 'insertsheet' | 'renamesheet' | 'movesheet' | 'tabcolor' | 'sort' | 'find' | 'pastespecial'
  | 'fillseries' | 'definename' | 'gotocell'
  | 'standardfilter' | 'definedb' | 'selectdb' | 'subtotals' | 'validation' | 'condformat' | 'condformatmanager' | 'validityerror';

/** Where a spreadsheet was left: the shown sheet, and per sheet the cursor, scroll position, zoom and frozen panes. */
export interface ViewPosition {
  tab: SCTAB;
  sheets: { curX: SCCOL; curY: SCROW; posX: SCCOL; posY: SCROW; zoom: number; fixX?: SCCOL; fixY?: SCROW; posX0?: SCCOL; posY0?: SCROW; grid?: boolean }[];
}

const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const OTS_MIME = 'application/vnd.oasis.opendocument.spreadsheet-template';
const FODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet-flat-xml';
const saveTypes: AppFileType[] = [
  { id: 'ods', label: 'ODF Spreadsheet (.ods)', description: 'OpenDocument Spreadsheet', mime: ODS_MIME, exts: ['ods'] },
  { id: 'ots', label: 'ODF Spreadsheet Template (.ots)', description: 'OpenDocument Spreadsheet Template', mime: OTS_MIME, exts: ['ots'] },
  { id: 'fods', label: 'Flat XML ODF Spreadsheet (.fods)', description: 'Flat XML ODF Spreadsheet', mime: FODS_MIME, exts: ['fods'] },
  { id: 'csv', label: 'Text CSV (.csv)', description: 'Text CSV', mime: 'text/csv', exts: ['csv'] },
];
/** Calc for the shell: its storage and settings, and the file types it reads and writes. */
export const CALC: AppDescription = {
  id: 'calc',
  name: 'Calc',
  docType: saveTypes[0]!,
  templateType: saveTypes[1]!,
  saveTypes,
  openTypes: [{ description: 'Spreadsheets', accept: { [ODS_MIME]: ['.ods'], [OTS_MIME]: ['.ots'], [FODS_MIME]: ['.fods'], 'text/csv': ['.csv'], 'text/plain': ['.txt', '.tsv'] } }],
  openAccept: '.ods,.ots,.fods,.csv,.tsv,.txt',
};

/** The cell input being edited (ScInputHandler's state): where, its text and caret, and how it started. */
export interface EditState {
  nCol: SCCOL;
  nRow: SCROW;
  nTab: SCTAB;
  text: string;
  /** The caret (selection start and end) in the text. */
  selStart: number;
  selEnd: number;
  /** Started by typing (arrow keys end the input) rather than F2 or a click (they move in the text). */
  bByTyping: boolean;
  /** Where the input is: the cell's editor or the formula bar. */
  where: 'cell' | 'bar';
  /** The reference being inserted by pointing (its text's start and end), while a reference is picked. */
  refSel: { nStart: number; nEnd: number } | null;
  /** AutoInput's completion shown after the caret (selected in the editor). */
  completion: string | null;
}

/** Options kept in this browser: view options (ScViewCfg), input options (ScInputCfg), app options. */
const LS_VIEW = 'viewoptions', LS_INPUT = 'inputoptions', LS_APP = 'appoptions';

export class Controller extends AppController<ScDocShell, Exclude<DialogId, ShellDialogId>, ViewPosition> {
  readonly measurer = new CanvasTextMeasurer();
  sh: ScDocShell;
  view: ScTabViewShell;
  inputOptions: ScInputOptions;
  appOptions: ScAppOptions;
  viewOptions: ScViewOptions;
  /** The cell input, while a cell is edited. */
  edit: EditState | null = null;
  /** The formula's references in their colours while a formula is edited. */
  rangeFinder: ScRangeFindList | null = null;
  /** The cells copied or cut (the marching ants), until the next change. */
  copySource: ScRange | null = null;
  /** The error alert of an invalid input while it is shown, and what to do with the answer. */
  /** The conditional format the Condition dialog edits (0 for a new one). */
  condFormatKey = 0;
  validityError: { err: ScValidationError; resolve: (bOk: boolean) => void } | null = null;
  /** The AutoFilter popup: its data and where it opens (the button's cell, in the grid's pixels). */
  autoFilter: { data: AutoFilterData; x: number; y: number; w: number } | null = null;
  /** Set by the grid window: opens the AutoFilter popup of a cell (Alt+Down on a button cell). */
  openAutoFilterAt: (nCol: SCCOL, nRow: SCROW) => void = () => {};
  /** Set by the grid window: paints again. */
  onRepaint: () => void = () => {};
  /** Set by the grid window: places the cell editor and focuses it. */
  focusCellEditor: () => void = () => {};
  /** Set by the formula bar: focuses its input. */
  focusInputLine: () => void = () => {};
  /** Set by the Name Box: focuses it (Shift+Ctrl+F5, .uno:FocusCellAddress). */
  focusNameBox: () => void = () => {};
  private unsubscribeDoc: () => void = () => {};
  private unsubscribeView: () => void = () => {};

  constructor() {
    super(CALC);
    this.viewOptions = ScViewOptions.fromJSON(this.readSetting(LS_VIEW));
    this.inputOptions = Object.assign(new ScInputOptions(), this.readSetting(LS_INPUT) ?? {});
    this.appOptions = Object.assign(new ScAppOptions(), this.readSetting(LS_APP) ?? {});
    this.sh = this.newDoc();
    this.view = this.createView(this.sh);
    this.attach();
  }

  private readSetting<T>(name: string): T | null {
    try { return JSON.parse(localStorage.getItem(appKey('calc', name)) ?? 'null') as T | null; } catch { return null; }
  }
  private writeSetting(name: string, v: unknown): void {
    try { localStorage.setItem(appKey('calc', name), JSON.stringify(v)); } catch { /* storage may be unavailable */ }
  }
  /** Tools > Options and View's toggles changed the options: they are kept and the view repaints. */
  saveOptions(): void {
    this.writeSetting(LS_VIEW, this.viewOptions.toJSON());
    this.writeSetting(LS_INPUT, this.inputOptions);
    this.writeSetting(LS_APP, this.appOptions);
    this.view.GetViewData().SetOptions(this.viewOptions);
    this.notify();
  }

  private createView(sh: ScDocShell): ScTabViewShell {
    const v = new ScTabViewShell(sh, () => this.inputOptions);
    v.GetViewData().SetOptions(this.viewOptions);
    v.fnIsFormulaMode = () => this.isRefInput();
    return v;
  }

  /** A new spreadsheet with one sheet, by the user. */
  protected newDoc(): ScDocShell {
    const sh = new ScDocShell();
    sh.m_xDocProps.setAuthor(this.userFullName);
    sh.m_xDocProps.setCreationDate(DateTimeNow());
    return sh;
  }

  get document(): ScDocShell { return this.sh; }

  protected installDocument(doc: ScDocShell): void {
    this.edit = null;
    this.rangeFinder = null;
    this.copySource = null;
    this.sh = doc;
    this.view = this.createView(doc);
  }

  protected attach(): void {
    this.unsubscribeDoc();
    this.unsubscribeView();
    const offChange = this.sh.AddChangeListener(() => {
      this.edits++;
      if (this.sessionBase) { this.pendingAutoVersion = this.sessionBase; this.sessionBase = null; }
      this.copySource = null;
      this.scheduleSave();
      this.notify();
    });
    const offPaint = this.sh.AddPaintListener(() => this.onRepaint());
    this.unsubscribeDoc = () => { offChange(); offPaint(); };
    this.unsubscribeView = this.view.AddListener({
      CursorPosChanged: () => this.notify(),
      SelectionChanged: () => this.notify(),
      VisAreaChanged: () => this.notify(),
      RefChanged: () => this.refChanged(),
      TabChanged: () => this.notify(),
    });
    this.restoreViewPosition(this.docId);
    this.applyViewPosition();
  }

  // --- files: ODS (the own format), its template OTS, flat FODS and CSV ---

  /** The view settings each document's file came with (settings.xml), until its view takes them. */
  private readonly fileViewSettings = new WeakMap<ScDocShell, ScViewSettings>();

  protected async readPackage(bytes: Uint8Array, bRepairPackage?: boolean): Promise<PackageImport<ScDocShell>> {
    const r = await ImportODS(bytes, bRepairPackage);
    if (r.viewSettings) this.fileViewSettings.set(r.doc, r.viewSettings);
    return r;
  }
  protected exportPackage(doc: ScDocShell, extra: readonly ZipEntry[], template: boolean): Promise<Uint8Array> {
    return ExportODS(doc, extra, template, doc === this.sh ? this.viewSettings() : this.fileViewSettings.get(doc));
  }

  /** Opens a file of any type Calc reads (the shell's openFile); false when it is not opened. */
  protected async importFile(file: File, handle: FileHandle | null): Promise<boolean> {
    const base = file.name.replace(/\.[^.]+$/, '');
    if (/\.ods$/i.test(file.name)) {
      const data = new Uint8Array(await file.arrayBuffer());
      const r = await this.importPackage(file.name, (repair) => this.readPackage(data, repair));
      if (!r) return false;
      const { doc, lost, storage, template } = r.result;
      // A repaired document is a new one: saving must not overwrite the broken file.
      const keep = !r.repaired && !lost.length;
      this.install(doc, base, newId(), keep ? handle : null, storage ?? null, file.lastModified, template);
      if (lost.length) this.openedAsCopy(lost);
    } else if (/\.ots$/i.test(file.name)) {
      // A template opens as a new, untitled document made from it (SfxObjectShell's AsTemplate).
      const data = new Uint8Array(await file.arrayBuffer());
      const r = await this.importPackage(file.name, (repair) => this.readPackage(data, repair));
      if (!r) return false;
      const { doc, lost } = r.result;
      ResetFromTemplate(doc, doc.m_xDocProps.getTitle() || base, file.name);
      this.install(doc, base, newId(), null);
      if (lost.length) this.openedAsCopy(lost);
    } else if (/\.fods$/i.test(file.name)) {
      const r = ImportFODS(await file.text());
      if (r.viewSettings) this.fileViewSettings.set(r.doc, r.viewSettings);
      this.install(r.doc, base, newId(), r.lost.length ? null : handle);
      if (r.lost.length) this.openedAsCopy(r.lost);
    } else if (/\.(csv|tsv|txt)$/i.test(file.name) || file.type === 'text/csv') {
      // Text CSV with the separators detected (SfxObjectShell::DetectCsvSeparators); kept in the
      // browser as ODS, with the file attached so Save writes the CSV back.
      const doc = ImportCSV(await file.text());
      this.install(doc, base, newId(), handle);
    } else {
      this.setMessage(t('calc.cantOpen', { name: file.name }));
      return false;
    }
    return true;
  }

  /** The spreadsheet in Calc's other formats (FODS, CSV of the shown sheet); null for ODS and OTS. */
  protected async exportFile(filename: string): Promise<Blob | null> {
    if (/\.fods$/i.test(filename)) return new Blob([ExportFODS(this.sh, this.viewSettings())], { type: FODS_MIME });
    if (/\.(csv|tsv|txt)$/i.test(filename)) return new Blob([ExportCSV(this.sh, this.view.GetViewData().GetTabNo())], { type: 'text/csv' });
    return null;
  }

  /** ScViewData::WriteUserDataSequence: the view's settings for settings.xml. */
  viewSettings(): ScViewSettings {
    const v = this.view.GetViewData();
    const rDoc = this.sh.GetDocument();
    const out = DefaultViewSettings();
    out.ActiveTable = rDoc.GetName(v.GetTabNo()) ?? '';
    out.ZoomValue = Math.round(v.GetZoomX() * 100);
    const o = this.viewOptions;
    out.ShowZeroValues = o.GetOption(ViewOption.NULLVALS);
    out.ShowGrid = o.GetOption(ViewOption.GRID);
    out.HasColumnRowHeaders = o.GetOption(ViewOption.HEADER);
    out.GridColor = o.GetGridColor();
    for (let i = 0; i < rDoc.GetTableCount(); i++) {
      const d = v.GetTabData(i);
      const ts = DefaultViewSettingsTable();
      ts.CursorPositionX = d.nCurX;
      ts.CursorPositionY = d.nCurY;
      ts.HorizontalSplitMode = d.eHSplitMode;
      ts.VerticalSplitMode = d.eVSplitMode;
      // freeze panes are written as the column and row of the split
      ts.HorizontalSplitPosition = d.eHSplitMode === ScSplitMode.SC_SPLIT_FIX ? d.nFixPosX : 0;
      ts.VerticalSplitPosition = d.eVSplitMode === ScSplitMode.SC_SPLIT_FIX ? d.nFixPosY : 0;
      ts.ActiveSplitRange = d.eWhichActive;
      ts.PositionLeft = d.nPosX[0];
      ts.PositionRight = d.nPosX[1];
      ts.PositionTop = d.nPosY[0];
      ts.PositionBottom = d.nPosY[1];
      ts.ZoomValue = Math.round(d.aZoomX * 100);
      ts.ShowGrid = d.bShowGrid;
      out.Tables[rDoc.GetName(i) ?? ''] = ts;
    }
    return out;
  }

  // --- view position ---

  protected currentViewPosition(): ViewPosition | null {
    const v = this.view.GetViewData();
    const rDoc = this.sh.GetDocument();
    const sheets: ViewPosition['sheets'] = [];
    for (let i = 0; i < rDoc.GetTableCount(); i++) {
      const d = v.GetTabData(i);
      sheets.push({
        curX: d.nCurX, curY: d.nCurY, posX: d.nPosX[1], posY: d.nPosY[1], zoom: d.aZoomX,
        ...(d.eHSplitMode === ScSplitMode.SC_SPLIT_FIX ? { fixX: d.nFixPosX, posX0: d.nPosX[0] } : {}),
        ...(d.eVSplitMode === ScSplitMode.SC_SPLIT_FIX ? { fixY: d.nFixPosY, posY0: d.nPosY[0] } : {}),
      });
    }
    return { tab: v.GetTabNo(), sheets };
  }
  /** ScViewData::ReadUserDataSequence: where the file says the spreadsheet was left (settings.xml). */
  protected documentViewPosition(): ViewPosition | null {
    const vs = this.fileViewSettings.get(this.sh);
    if (!vs) return null;
    const rDoc = this.sh.GetDocument();
    const names = rDoc.GetAllTableNames();
    const sheets = names.map((n) => {
      const ts = vs.Tables[n];
      if (!ts) return { curX: 0, curY: 0, posX: 0, posY: 0, zoom: vs.ZoomValue / 100 };
      const bH = ts.HorizontalSplitMode === ScSplitMode.SC_SPLIT_FIX && ts.HorizontalSplitPosition > 0;
      const bV = ts.VerticalSplitMode === ScSplitMode.SC_SPLIT_FIX && ts.VerticalSplitPosition > 0;
      return {
        curX: ts.CursorPositionX, curY: ts.CursorPositionY, posX: bH ? ts.PositionRight : ts.PositionLeft, posY: ts.PositionBottom, zoom: (ts.ZoomValue || vs.ZoomValue || 100) / 100,
        ...(bH ? { fixX: ts.HorizontalSplitPosition, posX0: ts.PositionLeft } : {}),
        ...(bV ? { fixY: ts.VerticalSplitPosition, posY0: ts.PositionTop } : {}),
        grid: ts.ShowGrid,
      };
    });
    const tab = Math.max(0, names.indexOf(vs.ActiveTable));
    return { tab, sheets };
  }

  /** The kept view position applied to the new view (ScViewData::ReadUserDataSequence). */
  private applyViewPosition(): void {
    const p = this.restoreView;
    this.restoreView = null;
    if (!p) return;
    const v = this.view.GetViewData();
    const rDoc = this.sh.GetDocument();
    p.sheets.forEach((s, i) => {
      if (i >= rDoc.GetTableCount()) return;
      v.SetTabNo(i);
      v.SetCurX(Math.min(s.curX, rDoc.MaxCol()));
      v.SetCurY(Math.min(s.curY, rDoc.MaxRow()));
      v.SetZoom(s.zoom || 1, s.zoom || 1);
      if (s.grid !== undefined) v.SetShowGrid(s.grid);
      if (s.fixX !== undefined) { v.SetHSplitMode(ScSplitMode.SC_SPLIT_FIX); v.SetFixPosX(s.fixX); v.SetPosX(SC_SPLIT_LEFT, s.posX0 ?? 0); }
      if (s.fixY !== undefined) { v.SetVSplitMode(ScSplitMode.SC_SPLIT_FIX); v.SetFixPosY(s.fixY); v.SetPosY(SC_SPLIT_TOP, s.posY0 ?? 0); }
      v.SetPosX(s.fixX !== undefined ? SC_SPLIT_RIGHT : SC_SPLIT_LEFT, s.posX);
      v.SetPosY(SC_SPLIT_BOTTOM, s.posY);
      if (s.fixX !== undefined) v.SetHSplitPos(v.GetScrPos(s.fixX, 0, 0, true).X);
      if (s.fixY !== undefined) v.SetVSplitPos(v.GetScrPos(0, s.fixY, 0, true).Y);
    });
    this.view.SetTabNo(Math.min(p.tab, rDoc.GetTableCount() - 1), true);
  }

  // --- fonts ---

  private laidOutWith = '';
  override fontsChanged(): void {
    let loaded = 0;
    if (typeof document !== 'undefined') document.fonts.forEach((f) => { if (f.status === 'loaded') loaded++; });
    const state = `${loaded}/${GetFontStacksGeneration()}`;
    if (state === this.laidOutWith) return;
    this.laidOutWith = state;
    this.measurer.Invalidate();
    this.notify();
  }
  /** The font names the document uses (its cell styles and patterns). */
  override documentFonts(): Set<string> {
    const out = new Set<string>();
    const rDoc = this.sh.GetDocument();
    for (const s of rDoc.GetStyleSheetPool().GetStyles()) out.add(s.GetItem('ATTR_FONT'));
    const v = this.view.GetViewData();
    out.add(rDoc.GetPattern(v.GetCurX(), v.GetCurY(), v.GetTabNo()).GetItem('ATTR_FONT'));
    return out;
  }
  /** The CSS font of a cell's pattern at the zoom, for the cell editor. */
  cellFont(nCol: SCCOL, nRow: SCROW, nTab: SCTAB): string {
    const p = this.sh.GetDocument().GetPattern(nCol, nRow, nTab);
    const pptY = this.view.GetViewData().GetPPTY();
    return cssFont({ family: p.GetItem('ATTR_FONT'), size: p.GetItem('ATTR_FONT_HEIGHT') * pptY, bold: p.GetItem('ATTR_FONT_WEIGHT'), italic: p.GetItem('ATTR_FONT_POSTURE') });
  }

  override setZoom(z: number): void {
    const v = this.view.GetViewData();
    v.SetZoom(z, z);
    this.zoom = v.GetZoomX();
    this.view.ZoomChanged();
    this.notify();
  }

  override notify(): void {
    this.zoom = this.view?.GetViewData().GetZoomX() ?? this.zoom;
    super.notify();
  }

  // --- cell input (ScInputHandler) ---

  /** The input line's text of the cursor's cell (ScTabViewShell::UpdateInputHandler). */
  inputLineText(nCol = this.view.GetViewData().GetCurX(), nRow = this.view.GetViewData().GetCurY(), nTab = this.view.GetViewData().GetTabNo()): string {
    const rDoc = this.sh.GetDocument();
    const aPos = new ScAddress(nCol, nRow, nTab);
    if (rDoc.GetCellType(aPos) === CELLTYPE_FORMULA) return rDoc.GetFormula(aPos);
    return rDoc.GetInputString(aPos);
  }

  /**
   * Starts editing the cursor's cell (ScInputHandler::ActivateInputWindow / SetMode(SC_INPUT_TABLE)):
   * with the cell's text (F2, a double-click) or a typed text replacing it.
   */
  startEdit(text?: string, where: 'cell' | 'bar' = 'cell', caret?: number): void {
    const v = this.view.GetViewData();
    const nCol = v.GetCurX(), nRow = v.GetCurY(), nTab = v.GetTabNo();
    const bByTyping = text !== undefined;
    const s = text ?? this.inputLineText(nCol, nRow, nTab);
    const c = caret ?? s.length;
    this.edit = { nCol, nRow, nTab, text: s, selStart: c, selEnd: c, bByTyping, where, refSel: null, completion: null };
    v.SetEditEngine(nCol, nRow);
    this.updateRangeFinder();
    this.notify();
  }

  /** The editor's text or caret changed (ScInputHandler::DataChanged). */
  setEditText(text: string, selStart: number, selEnd = selStart, bTyped = false): void {
    const e = this.edit;
    if (!e) return;
    const changed = e.text !== text;
    e.text = text;
    e.selStart = selStart;
    e.selEnd = selEnd;
    if (changed) {
      e.refSel = null;
      // a reference typed by hand ends picking with the mouse
      if (this.view.GetViewData().IsRefMode()) this.view.DoneRefMode();
    }
    e.completion = null;
    if (bTyped) this.updateAutoInput();
    if (changed) this.updateRangeFinder();
    this.notify();
  }

  /** UseColData: AutoInput's completion after the caret, from the column's texts. */
  private updateAutoInput(): void {
    const e = this.edit;
    if (!e || !this.appOptions.GetAutoComplete() || e.selStart !== e.text.length) return;
    const full = GetAutoInputCompletion(this.sh.GetDocument(), e.nCol, e.nRow, e.nTab, e.text);
    e.completion = full ? full.slice(e.text.length) : null;
  }

  private updateRangeFinder(): void {
    const e = this.edit;
    this.rangeFinder = e && this.inputOptions.GetRangeFinder() ? InitRangeFinder(e.text, this.sh.GetDocument(), new ScAddress(e.nCol, e.nRow, e.nTab)) : null;
    this.onRepaint();
  }

  /** Whether a formula is edited with the caret where a reference may be pointed at (IsFormulaMode). */
  isRefInput(): boolean {
    const e = this.edit;
    if (!e || !IsFormulaText(e.text)) return false;
    if (e.refSel) return true;
    return IsRefInputPosition(e.text, e.selStart);
  }

  /** Whether a formula is being edited. */
  isFormulaEdit(): boolean { return !!this.edit && IsFormulaText(this.edit.text); }

  /**
   * SetReference: the range picked with the mouse or keyboard replaces the reference being picked
   * (or the one at the caret) in the formula.
   */
  private refChanged(): void {
    const e = this.edit;
    const v = this.view.GetViewData();
    if (!e || !v.IsRefMode() || v.GetRefType() !== ScRefType.SC_REFTYPE_REF) { this.onRepaint(); return; }
    const r = new ScRange(v.GetRefStartX(), v.GetRefStartY(), v.GetRefStartZ(), v.GetRefEndX(), v.GetRefEndY(), v.GetRefEndZ());
    r.PutInOrder();
    const ref = GetRefString(this.sh.GetDocument(), r, e.nTab);
    let { nStart, nEnd } = e.refSel ?? (() => { const at = GetReferenceAt(e.text, e.selStart); return at ?? { nStart: e.selStart, nEnd: e.selEnd }; })();
    if (!e.refSel && e.selEnd > e.selStart) { nStart = e.selStart; nEnd = e.selEnd; }
    e.text = e.text.slice(0, nStart) + ref + e.text.slice(nEnd);
    e.refSel = { nStart, nEnd: nStart + ref.length };
    e.selStart = e.selEnd = nStart + ref.length;
    e.completion = null;
    this.updateRangeFinder();
    this.notify();
  }

  /**
   * Ends the input (ScInputHandler::EnterHandler): the text goes into the cell (or the selection,
   * with Alt+Enter) through ScDocFunc, and the cursor moves as Enter's options say.
   */
  commitEdit(move: 'enter' | 'shift-enter' | 'tab' | 'shift-tab' | 'none' | 'left' | 'right' | 'up' | 'down' = 'enter', bBlock = false, bValidated = false): void {
    const e = this.edit;
    if (!e) return;
    // Validity (ScInputHandler::EnterHandler): invalid input shows the error alert and is
    // dropped, or kept when a warning or information alert is confirmed.
    if (!bValidated && !bBlock) {
      const aPos = new ScAddress(e.nCol, e.nRow, e.nTab);
      const aErr = CheckValidity(this.sh.GetDocument(), aPos, e.text + (e.completion ?? ''));
      if (aErr !== true) {
        if (aErr === null) { this.cancelEdit(); return; }
        this.validityError = { err: aErr, resolve: (bOk) => { this.validityError = null; this.setDialog(null); if (bOk) this.commitEdit(move, bBlock, true); else this.cancelEdit(); } };
        this.setDialog('validityerror');
        return;
      }
    }
    let text = e.text + (e.completion ?? '');
    this.edit = null;
    this.rangeFinder = null;
    const v = this.view.GetViewData();
    v.ResetEditView();
    this.view.DoneRefMode();
    // A formula is completed: missing closing parentheses are added (as ScInputHandler does).
    if (IsFormulaText(text)) {
      const open = (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0);
      if (open > 0 && !/"[^"]*$/.test(text)) text += ')'.repeat(open);
    }
    // back to the edited cell's sheet
    if (v.GetTabNo() !== e.nTab) this.view.SetTabNo(e.nTab);
    if (bBlock) this.view.EnterBlock(text);
    else if (text !== this.inputLineText(e.nCol, e.nRow, e.nTab) || !e.bByTyping) this.view.EnterData(e.nCol, e.nRow, e.nTab, text);
    switch (move) {
      case 'enter': case 'shift-enter':
        if (!this.view.MoveCursorEnter(move === 'shift-enter')) this.notify();
        break;
      case 'tab': case 'shift-tab': this.view.MoveCursorTab(move === 'shift-tab'); break;
      case 'left': this.view.MoveCursorRel(-1, 0, ScFollowMode.SC_FOLLOW_LINE, false); break;
      case 'right': this.view.MoveCursorRel(1, 0, ScFollowMode.SC_FOLLOW_LINE, false); break;
      case 'up': this.view.MoveCursorRel(0, -1, ScFollowMode.SC_FOLLOW_LINE, false); break;
      case 'down': this.view.MoveCursorRel(0, 1, ScFollowMode.SC_FOLLOW_LINE, false); break;
      default: break;
    }
    if (move === 'enter' || move === 'shift-enter') { /* the Tab start column stays for Enter */ } else if (move !== 'tab' && move !== 'shift-tab') v.SetTabStartCol(-1);
    if (move === 'enter' || move === 'shift-enter') v.SetTabStartCol(-1);
    this.notify();
    this.focusEditor();
  }

  /** Escape: the input is dropped (ScInputHandler::CancelHandler). */
  cancelEdit(): void {
    if (!this.edit) return;
    const nTab = this.edit.nTab;
    this.edit = null;
    this.rangeFinder = null;
    this.view.GetViewData().ResetEditView();
    this.view.DoneRefMode();
    if (this.view.GetViewData().GetTabNo() !== nTab) this.view.SetTabNo(nTab);
    this.notify();
    this.focusEditor();
  }

  /** Inserts text at the caret of the input (a function name, a reference), starting the input if needed. */
  insertInInput(text: string, caretOffset = text.length): void {
    if (!this.edit) this.startEdit('', 'bar');
    const e = this.edit!;
    const s = e.text.slice(0, e.selStart) + text + e.text.slice(e.selEnd);
    this.setEditText(s, e.selStart + caretOffset);
  }

  /** Enter's direction (Tools > Options > LibreOffice Calc > General), for the editor's keys. */
  get enterDirection(): number { return this.inputOptions.GetMoveDir() as number; }
  /** Whether Enter moves the selection. */
  get enterMoves(): boolean { return this.inputOptions.GetMoveSelection(); }
  /** ScDirection for the options page. */
  static readonly ScDirection = ScDirection;
  static readonly ViewOption = ViewOption;

  /** Undo or Redo, ending an input first, with the view following the document. */
  undo(): void { this.undoRedo(() => this.sh.GetUndoManager().Undo()); }
  redo(): void { this.undoRedo(() => this.sh.GetUndoManager().Redo()); }

  /**
   * Undo or Redo: the view's sheet data follow sheets the action inserted or removed (the undo
   * actions of upstream tell the views through ScTabViewShell; here the sheet names are compared).
   */
  private undoRedo(f: () => boolean): void {
    this.cancelEdit();
    const rDoc = this.sh.GetDocument();
    const before = rDoc.GetAllTableNames();
    if (!f()) { this.notify(); return; }
    const after = rDoc.GetAllTableNames();
    const v = this.view.GetViewData();
    if (after.length < before.length) {
      for (let k = before.length - after.length; k > 0; k--) {
        const cur = rDoc.GetAllTableNames();
        let i = 0;
        while (i < cur.length && before[i] === cur[i]) i++;
        v.DeleteTab(i);
        before.splice(i, 1);
      }
    } else if (after.length > before.length) {
      for (let k = after.length - before.length; k > 0; k--) {
        let i = 0;
        while (i < before.length && before[i] === after[i]) i++;
        v.InsertTab(i);
        before.splice(i, 0, after[i]!);
      }
    }
    this.view.UpdateAfterUndo();
    this.notify();
  }

  override setDialog(d: DialogId | null): void {
    super.setDialog(d as Exclude<DialogId, ShellDialogId> | ShellDialogId | null);
  }

  /** A new spreadsheet replaces the open one (File > New > Spreadsheet). */
  override async newDocument(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    this.install(this.newDoc(), 'Untitled', newId(), null);
  }
}
