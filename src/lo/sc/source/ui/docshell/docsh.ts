// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/docsh.hxx reduced
// @upstream sc/source/ui/docshell/docsh3.cxx reduced
// @upstream sc/source/ui/docshell/docsh4.cxx partial
// @upstream sc/source/ui/docshell/docsh5.cxx partial
// @upstream sfx2/source/doc/objxtor.cxx partial
// ScDocShell, reduced to its model side: it owns the document (m_pDocument) and the undo manager
// (m_pUndoManager) and hands out the ScDocFunc that changes the document with undo. The UI
// (views, dialogs, the SfxObjectShell machinery, loading and saving, OLE, printing) is not
// here: PostPaint and the other paint and change notifications go to the listeners registered
// with AddPaintListener / AddChangeListener (the web shell repaints from them), and
// ErrorMessage stores the message id instead of showing a dialog. From docsh5.cxx
// AdjustRowHeight, MoveTable and the database range functions (GetDBData, DBAreaDeleted, …)
// are ported; from docsh4.cxx PageStyleModified and the end of ExecutePageStyle's Format > Page
// Style (ModifyPageStyle: the dialog's items applied with undo). PaintPartFlags is from
// sc/inc/global.hxx.
import type { ScRange, SCCOL, SCROW, SCTAB } from '../../../inc/address.ts';
import { ScAddress, ScRange as ScRangeClass } from '../../../inc/address.ts';
import { ScDocument } from '../../core/data/document.ts';
import { SfxUndoManager } from '../../../../svl/source/undo/undo.ts';
import { ScDocFunc } from './docfunc.ts';
import { ScUndoCopyTab, ScUndoMoveTab } from '../undo/undotab.ts';
import { ScStyleSaveData, ScUndoModifyStyle } from '../undo/undostyl.ts';
import { ScPrintFunc } from '../view/printfun.ts';
import { SfxStyleFamily } from '../../../inc/stlsheet.ts';
import type { ScItemSet } from '../../../inc/scitems.ts';
import { SfxDocumentMetaData } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';
import { ScDBData, STR_DB_LOCAL_NONAME } from '../../core/tool/dbdata.ts';
import { ScGetDBMode, ScGetDBSelection } from '../../../inc/global.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScSortParam } from '../../../inc/sortparam.ts';
import { ScSubTotalParam } from '../../../inc/subtotalparam.ts';

/** PaintPartFlags (global.hxx) */
export const PaintPartFlags = {
  NONE: 0x00,
  Grid: 0x01,
  Top: 0x02,
  Left: 0x04,
  Extras: 0x08,
  Marks: 0x10,
  Objects: 0x20,
  Size: 0x40,
  All: 0x01 | 0x02 | 0x04 | 0x08 | 0x20 | 0x40,
} as const;
export type PaintPartFlags = number;

/** The extra flags of PostPaint (docsh.hxx). */
export const SC_PF_LINES = 1;
export const SC_PF_TESTMERGE = 2;
export const SC_PF_WHOLEROWS = 4;

/** One paint request: the range to repaint and the parts of the view. */
export interface ScPaintHint {
  aRange: ScRange;
  nParts: PaintPartFlags;
}

/** The default number of undo steps (Tools - Options - LibreOffice - Advanced - Undo). */
const DEFAULT_UNDO_COUNT = 100;

export class ScDocShell {
  private m_pDocument: ScDocument;
  private m_pUndoManager: SfxUndoManager;
  private m_pDocFunc: ScDocFunc | null = null;
  private m_bIsInUndo = false;
  private m_nPaintLocks = 0;
  private maPaintListeners: ((rHint: ScPaintHint) => void)[] = [];
  private maChangeListeners: (() => void)[] = [];
  /** The id of the last error message (ErrorMessage); the UI may show it. */
  private maLastError: string | null = null;

  // SfxObjectShell (the base class upstream): the document properties, user data, editing time,
  // versions on closing and the modified flag (SfxObjectShell_Impl::m_bIsModified).
  m_xDocProps = new SfxDocumentMetaData();
  m_bUseUserData = true;
  m_nTime = new Date();
  m_bSaveVersionOnClose = false;
  private m_bIsModified = false;
  /** SfxObjectShell::GetTitle: the document's file name (the medium's), for the file name fields of printing. */
  private m_aTitle = '';

  /** Over an existing document (a new one with one sheet if none is given). */
  constructor(pDocument?: ScDocument, pUndoManager?: SfxUndoManager) {
    if (!pDocument) {
      pDocument = new ScDocument();
      pDocument.MakeTable(0);
      pDocument.RenameTab(0, 'Sheet1');
    }
    this.m_pDocument = pDocument;
    this.m_pUndoManager = pUndoManager ?? new SfxUndoManager(DEFAULT_UNDO_COUNT);
  }

  GetDocument(): ScDocument { return this.m_pDocument; }
  GetTitle(): string { return this.m_aTitle; }
  SetTitle(rTitle: string): void { this.m_aTitle = rTitle; }

  /** SfxObjectShell::IsModified */
  IsModified(): boolean { return this.m_bIsModified; }
  /** SfxObjectShell::SetModified: with bModified, the change is broadcast (SfxHintId::DocChanged). */
  SetModified(bModified = true): void {
    if (this.m_bIsModified === bModified && !bModified) return;
    this.m_bIsModified = bModified;
    if (bModified) for (const f of [...this.maChangeListeners]) f();
  }
  /** SetModified(false): the document as saved. */
  SetUnmodified(): void { this.SetModified(false); }
  GetUndoManager(): SfxUndoManager { return this.m_pUndoManager; }

  GetDocFunc(): ScDocFunc {
    if (!this.m_pDocFunc) this.m_pDocFunc = new ScDocFunc(this);
    return this.m_pDocFunc;
  }

  IsInUndo(): boolean { return this.m_bIsInUndo; }
  SetInUndo(bSet: boolean): void { this.m_bIsInUndo = bSet; }
  /** The document is editable (no read-only mode in the model). */
  IsEditable(): boolean { return true; }

  LockPaint(): void { this.m_nPaintLocks++; }
  UnlockPaint(): void { if (this.m_nPaintLocks) this.m_nPaintLocks--; }
  IsPaintLocked(): boolean { return this.m_nPaintLocks > 0; }

  /** Register a listener for paint requests; returns the function that removes it. */
  AddPaintListener(f: (rHint: ScPaintHint) => void): () => void {
    this.maPaintListeners.push(f);
    return () => { this.maPaintListeners = this.maPaintListeners.filter((g) => g !== f); };
  }

  /** Register a listener for document modifications; returns the function that removes it. */
  AddChangeListener(f: () => void): () => void {
    this.maChangeListeners.push(f);
    return () => { this.maChangeListeners = this.maChangeListeners.filter((g) => g !== f); };
  }

  /** PostPaint(nStartCol, nStartRow, nStartTab, nEndCol, nEndRow, nEndTab, nPart, nExtFlags)
      or PostPaint(rRange, nPart, nExtFlags). */
  PostPaint(nStartCol: SCCOL | ScRange, nStartRow?: SCROW | PaintPartFlags, nStartTab?: SCTAB | number, nEndCol?: SCCOL, nEndRow?: SCROW, nEndTab?: SCTAB, nPart?: PaintPartFlags, nExtFlags = 0): void {
    let aRange: ScRange;
    let nParts: PaintPartFlags;
    if (typeof nStartCol !== 'number') {
      aRange = nStartCol.clone();
      nParts = nStartRow as PaintPartFlags;
      nExtFlags = (nStartTab as number | undefined) ?? 0;
    } else {
      aRange = new ScRangeClass(nStartCol, nStartRow as SCROW, nStartTab as SCTAB, nEndCol!, nEndRow!, nEndTab!);
      nParts = nPart!;
    }
    const rDoc = this.m_pDocument;
    aRange.PutInOrder();
    if (aRange.aEnd.Col() > rDoc.MaxCol()) aRange.aEnd.SetCol(rDoc.MaxCol());
    if (aRange.aEnd.Row() > rDoc.MaxRow()) aRange.aEnd.SetRow(rDoc.MaxRow());
    if (aRange.aEnd.Tab() >= rDoc.GetTableCount()) aRange.aEnd.SetTab(Math.max(0, rDoc.GetTableCount() - 1));
    if (nExtFlags & SC_PF_LINES) {
      // extend by one cell for the lines around the range
      if (aRange.aStart.Col() > 0) aRange.aStart.IncCol(-1);
      if (aRange.aStart.Row() > 0) aRange.aStart.IncRow(-1);
      if (aRange.aEnd.Col() < rDoc.MaxCol()) aRange.aEnd.IncCol(1);
      if (aRange.aEnd.Row() < rDoc.MaxRow()) aRange.aEnd.IncRow(1);
    }
    if (nExtFlags & SC_PF_WHOLEROWS) {
      aRange.aStart.SetCol(0);
      aRange.aEnd.SetCol(rDoc.MaxCol());
    }
    if (this.IsPaintLocked()) return;
    for (const f of [...this.maPaintListeners]) f({ aRange, nParts });
  }

  PostPaintCell(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): void {
    if (nCol instanceof ScAddress) this.PostPaintCell(nCol.Col(), nCol.Row(), nCol.Tab());
    else this.PostPaint(nCol, nRow!, nTab!, nCol, nRow!, nTab!, PaintPartFlags.Grid, SC_PF_TESTMERGE);
  }

  PostPaintGridAll(): void {
    const rDoc = this.m_pDocument;
    this.PostPaint(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), Math.max(0, rDoc.GetTableCount() - 1), PaintPartFlags.Grid);
  }

  PostPaintExtras(): void {
    const rDoc = this.m_pDocument;
    this.PostPaint(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), Math.max(0, rDoc.GetTableCount() - 1), PaintPartFlags.Extras);
  }

  /** The cells changed (PostDataChanged): views update their input line. */
  PostDataChanged(): void {
    for (const f of [...this.maChangeListeners]) f();
  }

  /** SetDocumentModified: recalculate (with AutoCalc) and notify. */
  SetDocumentModified(): void {
    const rDoc = this.m_pDocument;
    rDoc.SetModified();
    if (rDoc.GetAutoCalc()) {
      rDoc.TrackFormulas();
      rDoc.CalcVolatile();
    }
    // SfxObjectShell::SetModified, which broadcasts the change.
    this.m_bIsModified = false;
    this.SetModified();
  }

  /** ErrorMessage: remembered for the UI instead of a message box. */
  ErrorMessage(pGlobStrId: string): void { this.maLastError = pGlobStrId; }
  GetLastError(): string | null { return this.maLastError; }
  ClearLastError(): void { this.maLastError = null; }

  AdjustRowHeight(nStartRow: SCROW, nEndRow: SCROW, nTab: SCTAB): boolean {
    const bChange = this.m_pDocument.SetOptimalHeight(nStartRow, nEndRow, nTab, true);

    if (bChange) this.PostPaint(0, nStartRow, nTab, this.m_pDocument.MaxCol(), this.m_pDocument.MaxRow(), nTab, PaintPartFlags.Grid | PaintPartFlags.Left);

    return bChange;
  }

  /** PageStyleModified: the page breaks of the sheets with the page style follow its new settings. */
  PageStyleModified(rStyleName: string, bApi: boolean): void {
    const aModificator = new ScDocShellModificator(this);

    const nTabCount = this.m_pDocument.GetTableCount();
    let nUseTab = -1;
    for (let nTab = 0; nTab < nTabCount && nUseTab < 0; nTab++) {
      if (this.m_pDocument.GetPageStyle(nTab) === rStyleName && (!bApi || this.m_pDocument.GetPageSize(nTab).Width)) nUseTab = nTab;
    }
    // at bApi only if breaks already shown

    if (nUseTab >= 0) { // not used -> nothing to do
      const aPrintFunc = new ScPrintFunc(null, this, nUseTab); //! cope without CountPages
      aPrintFunc.UpdatePages(); //  sets breaks on all tabs
      // (STR_PRINT_INVALID_AREA, shown when UpdatePages fails, is not shown)
    }

    aModificator.SetDocumentModified();
  }

  /**
   * ExecutePageStyle's SID_FORMATPAGE after the dialog's OK: the page style of the sheet nCurTab
   * gets the items rOutSet (with undo), and the sheets with that style their new page breaks.
   */
  ModifyPageStyle(nCurTab: SCTAB, rOutSet: ScItemSet): void {
    const aOldName = this.m_pDocument.GetPageStyle(nCurTab);
    const pStyleSheet = this.m_pDocument.GetStyleSheetPool().Find(aOldName, SfxStyleFamily.Page);
    if (!pStyleSheet) return;
    const bUndo = this.m_pDocument.IsUndoEnabled();
    const xOldData = new ScStyleSaveData();
    if (bUndo) xOldData.InitFromStyle(pStyleSheet);

    const aNewName = pStyleSheet.GetName();
    pStyleSheet.SetItemSet({ ...pStyleSheet.GetItemSet(), ...rOutSet });

    const aNewData = new ScStyleSaveData();
    aNewData.InitFromStyle(pStyleSheet);
    if (bUndo) this.GetUndoManager().AddUndoAction(new ScUndoModifyStyle(this, SfxStyleFamily.Page, xOldData, aNewData));

    this.PageStyleModified(aNewName, false);
    this.PostPaintGridAll();
  }

  // --- database ranges (docsh5.cxx: DBAreaDeleted, GetDBData, GetAnonymousDBData,
  // GetOldAutoDBRange, CancelAutoDBRange) ---

  /** The sheet-local anonymous range as it was before the first change, for undo. */
  private m_pOldAutoDBRange: ScDBData | null = null;

  DBAreaDeleted(nTab: SCTAB, nX1: SCCOL, nY1: SCROW, nX2: SCCOL): void {
    // the auto-filter is in the first row of the area
    this.m_pDocument.RemoveFlagsTab(nX1, nY1, nX2, nY1, nTab, ScMF.Auto);
    this.PostPaint(nX1, nY1, nTab, nX2, nY1, nTab, PaintPartFlags.Grid);
    // No SetDocumentModified, as the unnamed database range might have to be restored later.
  }

  /** The database range for the marked range: the named or anonymous range there, or a new
      sheet-local anonymous range on the contiguous data area (GetDBData). */
  GetDBData(rMarked: ScRange, eMode: ScGetDBMode, eSel: ScGetDBSelection): ScDBData | null {
    const m_pDocument = this.m_pDocument;
    const nCol = rMarked.aStart.Col();
    const nRow = rMarked.aStart.Row();
    const nTab = rMarked.aStart.Tab();

    let nStartCol = nCol;
    let nStartRow = nRow;
    let nStartTab = nTab;
    let nEndCol = rMarked.aEnd.Col();
    let nEndRow = rMarked.aEnd.Row();
    //  Not simply GetDBAtCursor: The continuous data range for "unnamed" (GetDataArea) may be
    //  located next to the cursor; so a named DB range needs to be searched for there as well.
    const pColl = m_pDocument.GetDBCollection();
    let pData = m_pDocument.GetDBAtArea(nTab, nStartCol, nStartRow, nEndCol, nEndRow);
    if (!pData) pData = pColl.GetDBNearCursor(nCol, nRow, nTab);

    const bSelected = eSel === ScGetDBSelection.ForceMark || (!rMarked.aStart.equals(rMarked.aEnd) && eSel !== ScGetDBSelection.RowDown);
    const bOnlyDown = !bSelected && eSel === ScGetDBSelection.RowDown && rMarked.aStart.Row() === rMarked.aEnd.Row();

    let bUseThis = false;
    if (pData) {
      //      take range, if nothing else is marked

      const { nCol1: nOldCol1, nRow1: nOldRow1, nCol2: nOldCol2, nRow2: nOldRow2 } = pData.GetAreaVars();
      const bIsNoName = pData.GetName() === STR_DB_LOCAL_NONAME;

      if (!bSelected) {
        bUseThis = true;
        if (bIsNoName && (eMode === ScGetDBMode.SC_DB_MAKE || eMode === ScGetDBMode.SC_DB_AUTOFILTER)) {
          // If nothing marked or only one row marked, adapt
          // "unnamed" to contiguous area.
          nStartCol = nCol;
          nStartRow = nRow;
          if (bOnlyDown) {
            nEndCol = rMarked.aEnd.Col();
            nEndRow = rMarked.aEnd.Row();
          } else {
            nEndCol = nStartCol;
            nEndRow = nStartRow;
          }
          ({ nStartCol, nStartRow, nEndCol, nEndRow } = m_pDocument.GetDataArea(nTab, nStartCol, nStartRow, nEndCol, nEndRow, false, bOnlyDown));
          if (nOldCol1 !== nStartCol || nOldCol2 !== nEndCol || nOldRow1 !== nStartRow) bUseThis = false; // doesn't fit at all
          else if (nOldRow2 !== nEndRow) {
            //  extend range to new end row
            pData.SetArea(nTab, nOldCol1, nOldRow1, nOldCol2, nEndRow);
          }
        }
      } else {
        if (nOldCol1 === nStartCol && nOldRow1 === nStartRow && nOldCol2 === nEndCol && nOldRow2 === nEndRow) {
          // marked precisely?
          bUseThis = true;
        } else bUseThis = false; // always take marking (Bug 11964)
      }

      //      never take "unnamed" for import

      if (bUseThis && eMode === ScGetDBMode.SC_DB_IMPORT && bIsNoName) bUseThis = false;
    }

    if (bUseThis) {
      ({ nTab: nStartTab, nCol1: nStartCol, nRow1: nStartRow, nCol2: nEndCol, nRow2: nEndRow } = pData!.GetAreaVars());
    } else if (eMode !== ScGetDBMode.SC_DB_OLD) {
      // tdf#168478 - use the previously found range rather than returning an empty one
      if (!bSelected) {
        // continuous range
        nStartCol = nCol;
        nStartRow = nRow;
        if (bOnlyDown) {
          nEndCol = rMarked.aEnd.Col();
          nEndRow = rMarked.aEnd.Row();
        } else {
          nEndCol = nStartCol;
          nEndRow = nStartRow;
        }
        ({ nStartCol, nStartRow, nEndCol, nEndRow } = m_pDocument.GetDataArea(nTab, nStartCol, nStartRow, nEndCol, nEndRow, false, bOnlyDown));
      }

      let bHasHeader = m_pDocument.HasColHeader(nStartCol, nStartRow, nEndCol, nEndRow, nTab);

      let pNoNameData = m_pDocument.GetAnonymousDBData(nTab);
      if (eMode !== ScGetDBMode.SC_DB_IMPORT && pNoNameData) {
        // Do not reset AutoFilter range during temporary operations on
        // other ranges, use the document global temporary anonymous range
        // instead. But, if AutoFilter is to be toggled then do use the
        // sheet-local DB range.
        let bSheetLocal = true;
        if (eMode !== ScGetDBMode.SC_DB_AUTOFILTER && pNoNameData.HasAutoFilter()) {
          bSheetLocal = false;
          pNoNameData = m_pDocument.GetAnonymousDBData();
          if (!pNoNameData) {
            m_pDocument.SetAnonymousDBData(new ScDBData(STR_DB_LOCAL_NONAME, nTab, nStartCol, nStartRow, nEndCol, nEndRow, true, bHasHeader));
            pNoNameData = m_pDocument.GetAnonymousDBData()!;
          }
          // ScDocShell::CancelAutoDBRange() would restore the
          // sheet-local anonymous DBData from pOldAutoDBRange, unset so
          // that won't happen with data of a previous sheet-local
          // DBData.
          this.m_pOldAutoDBRange = null;
        } else if (!this.m_pOldAutoDBRange) {
          // store the old unnamed database range with its settings for undo
          // (store at the first change, get the state before all changes)
          this.m_pOldAutoDBRange = pNoNameData.clone();
        } else if (this.m_pOldAutoDBRange.GetTab() !== pNoNameData.GetTab()) {
          // Different sheet-local unnamed DB range than the previous one.
          this.m_pOldAutoDBRange.assign(pNoNameData);
        }

        // take old range away cleanly
        const { nTab: nOldTab, nCol1: nOldX1, nRow1: nOldY1, nCol2: nOldX2, nRow2: nOldY2 } = pNoNameData.GetAreaVars();

        // If previously bHasHeader was set and the new range starts on the
        // same row and intersects the old column range, then don't reset
        // bHasHeader but assume that the new range still has headers, just
        // some are empty or numeric.
        if (!bHasHeader && pNoNameData.HasHeader() && nTab === nOldTab && nStartRow === nOldY1 && nStartCol <= nOldY2 && nOldY1 <= nEndCol) bHasHeader = true;

        // Remove AutoFilter button flags only for sheet-local DB range,
        // not if a temporary is used.
        if (bSheetLocal) this.DBAreaDeleted(nOldTab, nOldX1, nOldY1, nOldX2);

        pNoNameData.SetSortParam(new ScSortParam()); // reset parameter
        pNoNameData.SetQueryParam(new ScQueryParam());
        pNoNameData.SetSubTotalParam(new ScSubTotalParam());

        pNoNameData.SetArea(nTab, nStartCol, nStartRow, nEndCol, nEndRow); // set anew
        pNoNameData.SetByRow(true);
        pNoNameData.SetHeader(bHasHeader);
        pNoNameData.SetAutoFilter(false);
      } else {
        // (SC_DB_IMPORT, database import, is not ported)
        pNoNameData = new ScDBData(STR_DB_LOCAL_NONAME, nTab, nStartCol, nStartRow, nEndCol, nEndRow, true, bHasHeader);
        m_pDocument.SetAnonymousDBData(nTab, pNoNameData);
      }
      pData = pNoNameData;
    }
    void nStartTab;

    return pData;
  }

  GetAnonymousDBData(rRange: ScRange): ScDBData | null {
    const pColl = this.m_pDocument.GetDBCollection();
    const pData = pColl.getAnonDBs().getByRange(rRange);
    if (!pData) return null;

    if (!pData.HasHeader()) {
      const bHasHeader = this.m_pDocument.HasColHeader(rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row(), rRange.aStart.Tab());
      pData.SetHeader(bHasHeader);
    }

    return pData;
  }

  GetOldAutoDBRange(): ScDBData | null {
    const p = this.m_pOldAutoDBRange;
    this.m_pOldAutoDBRange = null;
    return p;
  }

  /** Called when a dialog is cancelled: restore the anonymous range of the sheet (CancelAutoDBRange). */
  CancelAutoDBRange(nTab: SCTAB): void {
    if (!this.m_pOldAutoDBRange) return;

    const pDBData = this.m_pDocument.GetAnonymousDBData(nTab);
    if (pDBData) {
      const r = pDBData.GetAreaVars();
      this.DBAreaDeleted(r.nTab, r.nCol1, r.nRow1, r.nCol2);

      pDBData.assign(this.m_pOldAutoDBRange); // restore old settings

      if (this.m_pOldAutoDBRange.HasAutoFilter()) {
        // restore AutoFilter buttons
        const o = this.m_pOldAutoDBRange.GetAreaVars();
        this.m_pDocument.ApplyFlagsTab(o.nCol1, o.nRow1, o.nCol2, o.nRow1, o.nTab, ScMF.Auto);
        this.PostPaint(o.nCol1, o.nRow1, o.nTab, o.nCol2, o.nRow1, o.nTab, PaintPartFlags.Grid);
      }
    }

    this.m_pOldAutoDBRange = null;
  }

  /** Move or copy a sheet (MoveTable). */
  MoveTable(nSrcTab: SCTAB, nDestTab: SCTAB, bCopy: boolean, bRecord: boolean): boolean {
    const aModificator = new ScDocShellModificator(this);
    const m_pDocument = this.m_pDocument;
    if (bRecord && !m_pDocument.IsUndoEnabled()) bRecord = false;

    // #i92477# be consistent with ScDocFunc::InsertTable: any index past the last sheet means "append"
    // #i101139# nDestTab must be the target position, not APPEND (for CopyTabProtection etc.)
    if (nDestTab >= m_pDocument.GetTableCount()) nDestTab = m_pDocument.GetTableCount();

    if (bCopy) {
      if (!m_pDocument.CopyTab(nSrcTab, nDestTab)) {
        return false;
      } else {
        let nAdjSource = nSrcTab;
        if (nDestTab <= nSrcTab) ++nAdjSource; // new position of source table after CopyTab

        if (m_pDocument.IsTabProtected(nAdjSource)) m_pDocument.SetTabProtection(nDestTab, true);

        if (bRecord) this.GetUndoManager().AddUndoAction(new ScUndoCopyTab(this, [nSrcTab], [nDestTab]));
      }
    } else {
      if (nSrcTab === nDestTab) {
        //! allow only for api calls?
        return true; // nothing to do, but valid
      }

      const bDone = m_pDocument.MoveTab(nSrcTab, nDestTab);
      if (!bDone) {
        return false;
      } else if (bRecord) {
        this.GetUndoManager().AddUndoAction(new ScUndoMoveTab(this, [nSrcTab], [nDestTab]));
      }
    }

    this.PostPaintGridAll();
    this.PostPaintExtras();
    aModificator.SetDocumentModified();

    return true;
  }
}

/** ScDocShellModificator: sets the document modified at the end of an operation. */
export class ScDocShellModificator {
  private rDocShell: ScDocShell;
  constructor(rDS: ScDocShell) { this.rDocShell = rDS; }
  SetDocumentModified(): void { this.rDocShell.SetDocumentModified(); }
}
