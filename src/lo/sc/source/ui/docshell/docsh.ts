// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/docsh.hxx reduced
// @upstream sc/source/ui/docshell/docsh3.cxx reduced
// @upstream sc/source/ui/docshell/docsh5.cxx partial
// @upstream sfx2/source/doc/objxtor.cxx partial
// ScDocShell, reduced to its model side: it owns the document (m_pDocument) and the undo manager
// (m_pUndoManager) and hands out the ScDocFunc that changes the document with undo. The UI
// (views, dialogs, the SfxObjectShell machinery, loading and saving, OLE, printing) is not
// here: PostPaint and the other paint and change notifications go to the listeners registered
// with AddPaintListener / AddChangeListener (the web shell repaints from them), and
// ErrorMessage stores the message id instead of showing a dialog. From docsh5.cxx only
// AdjustRowHeight and MoveTable are ported. PaintPartFlags is from sc/inc/global.hxx.
import type { ScRange, SCCOL, SCROW, SCTAB } from '../../../inc/address.ts';
import { ScAddress, ScRange as ScRangeClass } from '../../../inc/address.ts';
import { ScDocument } from '../../core/data/document.ts';
import { SfxUndoManager } from '../../../../svl/source/undo/undo.ts';
import { ScDocFunc } from './docfunc.ts';
import { ScUndoCopyTab, ScUndoMoveTab } from '../undo/undotab.ts';
import { SfxDocumentMetaData } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';

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
