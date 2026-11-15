// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undobase.hxx reduced
// @upstream sc/source/ui/undo/undobase.cxx reduced
// The base classes of Calc's undo actions: ScSimpleUndo (Begin/EndUndo around an action),
// ScBlockUndo and ScMultiBlockUndo (an action on one or several blocks, optionally adjusting
// the row heights afterwards), ScMoveUndo (an action that moved cells: restores the formulas
// whose references changed, from its reference undo document) and ScUndoWrapper. Left out: the
// view (cursor, selection and sheet switching after undo, ShowTable, ShowBlock and
// SetViewMarkData only check the paint lock), the drawing layer undo, the detective undo, the
// view shell ids.
import type { ScRange, SCTAB } from '../../../inc/address.ts';
import { InsertDeleteFlags } from '../../../inc/global.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import type { ScRangeList } from '../../../inc/rangelst.ts';
import { ScRange as ScRangeClass } from '../../../inc/address.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { SfxUndoAction, type SfxRepeatTarget } from '../../../../svl/source/undo/undo.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import type { ScRefUndoData } from './refundo.ts';
import type { ScDBData } from '../../core/tool/dbdata.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScSortParam } from '../../../inc/sortparam.ts';
import { ScSubTotalParam } from '../../../inc/subtotalparam.ts';

export class ScSimpleUndo extends SfxUndoAction {
  protected rDocShell: ScDocShell;

  constructor(rDocSh: ScDocShell) {
    super();
    this.rDocShell = rDocSh;
  }

  /** The range the action changed, for checking independent undo actions. */
  getAffectedRange(): ScRange | null { return null; }

  protected IsPaintLocked(): boolean { return this.rDocShell.IsPaintLocked(); }

  /** The view's selection would become rMarkData; there is no view in the model. */
  protected SetViewMarkData(_rMarkData: ScMarkData): boolean {
    if (this.IsPaintLocked()) return false;
    return false;
  }

  protected BeginUndo(): void {
    this.rDocShell.SetInUndo(true);
  }

  protected EndUndo(): void {
    {
      // rhbz#1352881 Temporarily turn off undo generation during
      // SetDocumentModified
      const rDoc = this.rDocShell.GetDocument();
      const bUndoEnabled = rDoc.IsUndoEnabled();
      rDoc.EnableUndo(false);
      this.rDocShell.SetDocumentModified();
      rDoc.EnableUndo(bUndoEnabled);
    }
    this.rDocShell.SetInUndo(false);
  }

  protected BeginRedo(): void {
    this.rDocShell.SetInUndo(true); //! own Flag for Redo?
  }

  protected EndRedo(): void {
    {
      // rhbz#1352881 Temporarily turn off undo generation during
      // SetDocumentModified
      const rDoc = this.rDocShell.GetDocument();
      const bUndoEnabled = rDoc.IsUndoEnabled();
      rDoc.EnableUndo(false);
      this.rDocShell.SetDocumentModified();
      rDoc.EnableUndo(bUndoEnabled);
    }
    this.rDocShell.SetInUndo(false);
  }

  /** Broadcast the changed cells of a range (BroadcastChanges). */
  protected BroadcastChanges(rRange: ScRange): void {
    const rDoc = this.rDocShell.GetDocument();
    for (let nTab = rRange.aStart.Tab(); nTab <= rRange.aEnd.Tab(); nTab++) rDoc.BroadcastRange(nTab, rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row());
  }

  /** ShowTable: the view would switch to the sheet. */
  protected static ShowTable(_nTab: SCTAB | ScRange): void {}

  override Repeat(_rTarget: SfxRepeatTarget): void {}
  override CanRepeat(_rTarget: SfxRepeatTarget): boolean { return false; }
}

export const ScBlockUndoMode = { SC_UNDO_SIMPLE: 0, SC_UNDO_MANUALHEIGHT: 1, SC_UNDO_AUTOHEIGHT: 2 } as const;
export type ScBlockUndoMode = (typeof ScBlockUndoMode)[keyof typeof ScBlockUndoMode];

export class ScBlockUndo extends ScSimpleUndo {
  protected aBlockRange: ScRange;
  protected eMode: ScBlockUndoMode;

  constructor(rDocSh: ScDocShell, rRange: ScRange, eBlockMode: ScBlockUndoMode) {
    super(rDocSh);
    this.aBlockRange = rRange.clone();
    this.eMode = eBlockMode;
  }

  override getAffectedRange(): ScRange | null { return this.aBlockRange; }

  protected override BeginUndo(): void {
    super.BeginUndo();
  }

  protected override EndUndo(): void {
    if (this.eMode === ScBlockUndoMode.SC_UNDO_AUTOHEIGHT) this.AdjustHeight();
    // tdf#161712 invoke ScSimpleUndo::EndUndo() before ShowBlock()
    super.EndUndo();
    this.ShowBlock();
  }

  protected override EndRedo(): void {
    if (this.eMode === ScBlockUndoMode.SC_UNDO_AUTOHEIGHT) this.AdjustHeight();
    this.ShowBlock();
    super.EndRedo();
  }

  protected AdjustHeight(): boolean {
    const rDoc = this.rDocShell.GetDocument();
    const bRet = rDoc.SetOptimalHeight(this.aBlockRange.aStart.Row(), this.aBlockRange.aEnd.Row(), this.aBlockRange.aStart.Tab(), true);
    if (bRet) {
      this.rDocShell.PostPaint(0, this.aBlockRange.aStart.Row(), this.aBlockRange.aStart.Tab(), rDoc.MaxCol(), rDoc.MaxRow(), this.aBlockRange.aEnd.Tab(), PaintPartFlags.Grid | PaintPartFlags.Left);
    }
    return bRet;
  }

  /** ShowBlock: the view would select the block. */
  protected ShowBlock(): void {
    if (this.IsPaintLocked()) return;
  }
}

export class ScMultiBlockUndo extends ScSimpleUndo {
  protected maBlockRanges: ScRangeList;

  constructor(rDocSh: ScDocShell, aRanges: ScRangeList) {
    super(rDocSh);
    this.maBlockRanges = aRanges;
  }

  protected override EndUndo(): void {
    this.ShowBlock();
    super.EndUndo();
  }

  protected override EndRedo(): void {
    this.ShowBlock();
    super.EndRedo();
  }

  /** ShowBlock: the view would select the blocks. */
  protected ShowBlock(): void {
    if (this.IsPaintLocked()) return;
  }
}

/** With references: restores the formulas whose references a move changed. */
export class ScMoveUndo extends ScSimpleUndo {
  protected pRefUndoDoc: ScDocument | null;
  protected pRefUndoData: ScRefUndoData | null;

  constructor(rDocSh: ScDocShell, pRefDoc: ScDocument | null, pRefData: ScRefUndoData | null) {
    super(rDocSh);
    this.pRefUndoDoc = pRefDoc;
    this.pRefUndoData = pRefData;
    const rDoc = this.rDocShell.GetDocument();
    if (this.pRefUndoData) this.pRefUndoData.DeleteUnchanged(rDoc);
  }

  private UndoRef(): void {
    const rDoc = this.rDocShell.GetDocument();
    const aRange = new ScRangeClass(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), this.pRefUndoDoc!.GetTableCount() - 1);
    this.pRefUndoDoc!.CopyToDocument(aRange, InsertDeleteFlags.FORMULA, false, rDoc, null, false);
    if (this.pRefUndoData) this.pRefUndoData.DoUndo(rDoc, false);
    // The restored formulas listen and recalculate.
    rDoc.ClearListeners();
    rDoc.StartAllListeners();
    rDoc.SetAllFormulasDirty();
  }

  protected override BeginUndo(): void {
    super.BeginUndo();
  }

  protected override EndUndo(): void {
    if (this.pRefUndoDoc) this.UndoRef();
    super.EndUndo();
  }
}

/** for manual merging of actions */
export class ScUndoWrapper extends SfxUndoAction {
  private pWrappedUndo: SfxUndoAction | null;

  constructor(pUndo: SfxUndoAction | null) {
    super();
    this.pWrappedUndo = pUndo;
  }

  GetWrappedUndo(): SfxUndoAction | null { return this.pWrappedUndo; }
  ReleaseWrappedUndo(): SfxUndoAction | null {
    const p = this.pWrappedUndo;
    this.pWrappedUndo = null;
    return p;
  }

  override GetComment(): string { return this.pWrappedUndo ? this.pWrappedUndo.GetComment() : ''; }
  override GetRepeatComment(rTarget: SfxRepeatTarget): string { return this.pWrappedUndo ? this.pWrappedUndo.GetRepeatComment(rTarget) : ''; }
  override Merge(pNextAction: SfxUndoAction): boolean { return this.pWrappedUndo ? this.pWrappedUndo.Merge(pNextAction) : false; }
  override Undo(): void { this.pWrappedUndo?.Undo(); }
  override Redo(): void { this.pWrappedUndo?.Redo(); }
  override Repeat(rTarget: SfxRepeatTarget): void { this.pWrappedUndo?.Repeat(rTarget); }
  override CanRepeat(rTarget: SfxRepeatTarget): boolean { return this.pWrappedUndo ? this.pWrappedUndo.CanRepeat(rTarget) : false; }
}

/** An undo action of a database function: restores the sheet's anonymous database range as it
    was before the function moved it (ScDBFuncUndo). */
export class ScDBFuncUndo extends ScSimpleUndo {
  protected pAutoDBRange: ScDBData | null;
  protected aOriginalRange: ScRange;

  constructor(rDocSh: ScDocShell, rOriginal: ScRange) {
    super(rDocSh);
    this.aOriginalRange = rOriginal.clone();
    this.pAutoDBRange = rDocSh.GetOldAutoDBRange();
  }

  protected override BeginUndo(): void {
    super.BeginUndo();
  }

  protected override EndUndo(): void {
    super.EndUndo();

    if (!this.pAutoDBRange) return;

    const rDoc = this.rDocShell.GetDocument();
    // (GetVisibleTab: the sheet of the action)
    const nTab = this.aOriginalRange.aStart.Tab();
    const pNoNameData = rDoc.GetAnonymousDBData(nTab);
    if (!pNoNameData) return;

    const r = pNoNameData.GetAreaVars();
    this.rDocShell.DBAreaDeleted(r.nTab, r.nCol1, r.nRow1, r.nCol2);

    pNoNameData.assign(this.pAutoDBRange);

    if (this.pAutoDBRange.HasAutoFilter()) {
      // restore AutoFilter buttons
      const o = this.pAutoDBRange.GetAreaVars();
      rDoc.ApplyFlagsTab(o.nCol1, o.nRow1, o.nCol2, o.nRow1, o.nTab, ScMF.Auto);
      this.rDocShell.PostPaint(o.nCol1, o.nRow1, o.nTab, o.nCol2, o.nRow1, o.nTab, PaintPartFlags.Grid);
    }
  }

  protected override BeginRedo(): void {
    if (this.pAutoDBRange) {
      // move the database range to this function's position again (see ScDocShell::GetDBData)

      const rDoc = this.rDocShell.GetDocument();
      const pNoNameData = rDoc.GetAnonymousDBData(this.aOriginalRange.aStart.Tab());
      if (pNoNameData) {
        const r = pNoNameData.GetAreaVars();
        this.rDocShell.DBAreaDeleted(r.nTab, r.nCol1, r.nRow1, r.nCol2);

        pNoNameData.SetSortParam(new ScSortParam());
        pNoNameData.SetQueryParam(new ScQueryParam());
        pNoNameData.SetSubTotalParam(new ScSubTotalParam());

        pNoNameData.SetArea(this.aOriginalRange.aStart.Tab(), this.aOriginalRange.aStart.Col(), this.aOriginalRange.aStart.Row(), this.aOriginalRange.aEnd.Col(), this.aOriginalRange.aEnd.Row());

        pNoNameData.SetByRow(true);
        pNoNameData.SetAutoFilter(false);
        // header is always set with the operation in redo
      }
    }

    super.BeginRedo();
  }

  protected override EndRedo(): void {
    super.EndRedo();
  }
}
