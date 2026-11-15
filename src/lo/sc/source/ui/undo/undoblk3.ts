// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undoblk.hxx partial
// @upstream sc/source/ui/undo/undoblk3.cxx partial
// The undo actions of deleting contents (ScUndoDeleteContents), applying attributes
// (ScUndoSelectionAttr), filling (ScUndoAutoFill, also for Fill Down/Right and Fill Series) and
// merging cells (ScUndoMerge). Change tracking, the drawing layer, the edit data array of
// ScUndoSelectionAttr (rich text attributes in edit cells), borders and Repeat are left out; the
// other actions of undoblk3.cxx (fill sheets, AutoFormat, replace, table of operations,
// conversions, area links) are not ported.
import { ScRange } from '../../../inc/address.ts';
import { FillCmd, FillDateCmd, FillDir, HasAttrFlags, InsertDeleteFlags } from '../../../inc/global.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { MAXDOUBLE } from '../../core/data/table4.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import type { ScCellMergeOption } from '../view/cellmergeoption.ts';
import { ScBlockUndo, ScBlockUndoMode, ScSimpleUndo } from './undobase.ts';

const STR_UNDO_DELETECONTENTS = 'Delete';
const STR_UNDO_SELATTR = 'Attributes';
const STR_UNDO_AUTOFILL = 'Fill';
const STR_UNDO_MERGE = 'Merge';

export class ScUndoDeleteContents extends ScSimpleUndo {
  private aRange: ScRange;
  private aMarkData: ScMarkData;
  private pUndoDoc: ScDocument;
  private nFlags: InsertDeleteFlags;
  private bMulti: boolean; // unnecessary

  constructor(rNewDocShell: ScDocShell, rMark: ScMarkData, rRange: ScRange, pNewUndoDoc: ScDocument, bNewMulti: boolean, nNewFlags: InsertDeleteFlags, bObjects: boolean) {
    super(rNewDocShell);
    void bObjects;
    this.aRange = rRange.clone();
    this.aMarkData = rMark.clone();
    this.pUndoDoc = pNewUndoDoc;
    this.nFlags = nNewFlags;
    this.bMulti = bNewMulti;

    if (!(this.aMarkData.IsMarked() || this.aMarkData.IsMultiMarked())) this.aMarkData.SetMarkArea(this.aRange); // if no cell is selected: select cell under cursor
  }

  override GetComment(): string { return STR_UNDO_DELETECONTENTS; } // "Delete"

  override getAffectedRange(): ScRange | null { return this.aRange; }

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();

    this.SetViewMarkData(this.aMarkData);

    if (bUndo) {
      // only Undo
      let nUndoFlags: number = InsertDeleteFlags.NONE; // copy either all or none of the content
      if (this.nFlags & InsertDeleteFlags.CONTENTS) nUndoFlags |= InsertDeleteFlags.CONTENTS; // (Only the correct ones have been copied into UndoDoc)
      if (this.nFlags & InsertDeleteFlags.ATTRIB) nUndoFlags |= InsertDeleteFlags.ATTRIB;
      if (this.nFlags & InsertDeleteFlags.EDITATTR) nUndoFlags |= InsertDeleteFlags.STRING; // Edit-Engine attribute -> Cells will be changed
      if (this.nFlags & InsertDeleteFlags.SPARKLINES) nUndoFlags |= InsertDeleteFlags.SPARKLINES;
      // do not create clones of note captions, they will be restored via drawing undo
      nUndoFlags |= InsertDeleteFlags.NOCAPTIONS;

      const aCopyRange = this.aRange.clone();
      const nTabCount = rDoc.GetTableCount();
      aCopyRange.aStart.SetTab(0);
      aCopyRange.aEnd.SetTab(nTabCount - 1);

      this.pUndoDoc.CopyToDocument(aCopyRange, nUndoFlags, this.bMulti, rDoc, this.aMarkData);
    } else {
      // only Redo
      this.aMarkData.MarkToMulti();
      // do not delete objects and note captions, they have been removed via drawing undo
      const nRedoFlags = (this.nFlags & ~InsertDeleteFlags.OBJECTS) | InsertDeleteFlags.NOCAPTIONS;
      rDoc.DeleteSelection(nRedoFlags, this.aMarkData);
      this.aMarkData.MarkToSimple();
    }

    if (this.nFlags & InsertDeleteFlags.CONTENTS) {
      // Broadcast only when the content changes. fdo#74687
      const aBroadcast = this.aRange.clone();
      for (const nTab of this.aMarkData) {
        aBroadcast.aStart.SetTab(nTab);
        aBroadcast.aEnd.SetTab(nTab);
        this.BroadcastChanges(aBroadcast);
      }
    }

    if (!this.rDocShell.AdjustRowHeight(this.aRange.aStart.Row(), this.aRange.aEnd.Row(), this.aRange.aStart.Tab()))
      /*A*/ this.rDocShell.PostPaint(this.aRange, PaintPartFlags.Grid | PaintPartFlags.Extras);

    this.rDocShell.PostDataChanged();
  }

  override Undo(): void {
    this.BeginUndo();
    this.DoChange(true);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    this.DoChange(false);
    this.EndRedo();
  }
}

export class ScUndoSelectionAttr extends ScSimpleUndo {
  private aMarkData: ScMarkData;
  private aRange: ScRange;
  private aRangeCover: ScRange;
  private pUndoDoc: ScDocument;
  private bMulti: boolean;
  private aApplyPattern: ScPatternAttr;

  constructor(rNewDocShell: ScDocShell, rMark: ScMarkData, nStartX: number, nStartY: number, nStartZ: number, nEndX: number, nEndY: number, nEndZ: number, pNewUndoDoc: ScDocument, bNewMulti: boolean, pNewApply: ScPatternAttr, pRangeCover?: ScRange | null) {
    super(rNewDocShell);
    this.aMarkData = rMark.clone();
    this.aRange = new ScRange(nStartX, nStartY, nStartZ, nEndX, nEndY, nEndZ);
    this.pUndoDoc = pNewUndoDoc;
    this.bMulti = bNewMulti;
    this.aApplyPattern = pNewApply;
    this.aRangeCover = pRangeCover ? pRangeCover.clone() : this.aRange.clone();
  }

  override GetComment(): string { return STR_UNDO_SELATTR; } // "Attribute"

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();

    this.SetViewMarkData(this.aMarkData);

    const aEffRange = this.aRangeCover.clone();
    if (rDoc.HasAttrib(aEffRange, HasAttrFlags.Merged)) rDoc.ExtendMerge(aEffRange); // merged cells?

    if (bUndo) {
      // only for Undo
      const aCopyRange = this.aRangeCover.clone();
      const nTabCount = rDoc.GetTableCount();
      aCopyRange.aStart.SetTab(0);
      aCopyRange.aEnd.SetTab(nTabCount - 1);
      this.pUndoDoc.CopyToDocument(aCopyRange, InsertDeleteFlags.ATTRIB, this.bMulti, rDoc, this.aMarkData);
    } else {
      // only for Redo
      this.aMarkData.MarkToMulti();
      rDoc.ApplySelectionPattern(this.aApplyPattern.GetItemSet(), this.aMarkData);
      this.aMarkData.MarkToSimple();
    }

    if (!this.rDocShell.AdjustRowHeight(aEffRange.aStart.Row(), aEffRange.aEnd.Row(), aEffRange.aStart.Tab()))
      /*A*/ this.rDocShell.PostPaint(aEffRange, PaintPartFlags.Grid | PaintPartFlags.Extras);
  }

  override Undo(): void {
    this.BeginUndo();
    this.DoChange(true);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    this.DoChange(false);
    this.EndRedo();
  }
}

export class ScUndoAutoFill extends ScBlockUndo {
  private aSource: ScRange;
  private aMarkData: ScMarkData;
  private pUndoDoc: ScDocument;
  private eFillDir: FillDir;
  private eFillCmd: FillCmd;
  private eFillDateCmd: FillDateCmd;
  private fStartValue: number;
  private fStepValue: number;
  private fMaxValue: number;

  constructor(rNewDocShell: ScDocShell, rRange: ScRange, rSourceArea: ScRange, pNewUndoDoc: ScDocument, rMark: ScMarkData, eNewFillDir: FillDir, eNewFillCmd: FillCmd, eNewFillDateCmd: FillDateCmd, fNewStartValue: number, fNewStepValue: number, fNewMaxValue: number) {
    super(rNewDocShell, rRange, ScBlockUndoMode.SC_UNDO_AUTOHEIGHT);
    this.aSource = rSourceArea.clone();
    this.aMarkData = rMark.clone();
    this.pUndoDoc = pNewUndoDoc;
    this.eFillDir = eNewFillDir;
    this.eFillCmd = eNewFillCmd;
    this.eFillDateCmd = eNewFillDateCmd;
    this.fStartValue = fNewStartValue;
    this.fStepValue = fNewStepValue;
    this.fMaxValue = fNewMaxValue;
  }

  override GetComment(): string { return STR_UNDO_AUTOFILL; } //"Fill"

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();

    const nTabCount = rDoc.GetTableCount();
    for (const rTab of this.aMarkData) {
      if (rTab >= nTabCount) break;
      const aWorkRange = this.aBlockRange.clone();
      aWorkRange.aStart.SetTab(rTab);
      aWorkRange.aEnd.SetTab(rTab);

      rDoc.DeleteAreaTab(aWorkRange, InsertDeleteFlags.AUTOFILL);
      this.pUndoDoc.CopyToDocument(aWorkRange, InsertDeleteFlags.AUTOFILL, false, rDoc);

      // Actually we'd only need to broadcast the cells inserted during
      // CopyToDocument(), as DeleteAreaTab() broadcasts deleted cells. For
      // this we'd need to either record the span sets or let
      // CopyToDocument() broadcast.
      this.BroadcastChanges(aWorkRange);

      this.rDocShell.PostPaint(aWorkRange, PaintPartFlags.Grid);
    }
    this.rDocShell.PostDataChanged();

    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    //! Select sheet

    let nCount = 0;
    switch (this.eFillDir) {
      case FillDir.FILL_TO_BOTTOM:
        nCount = this.aBlockRange.aEnd.Row() - this.aSource.aEnd.Row();
        break;
      case FillDir.FILL_TO_RIGHT:
        nCount = this.aBlockRange.aEnd.Col() - this.aSource.aEnd.Col();
        break;
      case FillDir.FILL_TO_TOP:
        nCount = this.aSource.aStart.Row() - this.aBlockRange.aStart.Row();
        break;
      case FillDir.FILL_TO_LEFT:
        nCount = this.aSource.aStart.Col() - this.aBlockRange.aStart.Col();
        break;
    }

    const rDoc = this.rDocShell.GetDocument();
    if (this.fStartValue !== MAXDOUBLE) {
      const nValX = this.eFillDir === FillDir.FILL_TO_LEFT ? this.aSource.aEnd.Col() : this.aSource.aStart.Col();
      const nValY = this.eFillDir === FillDir.FILL_TO_TOP ? this.aSource.aEnd.Row() : this.aSource.aStart.Row();
      const nTab = this.aSource.aStart.Tab();
      rDoc.SetValue(nValX, nValY, nTab, this.fStartValue);
    }
    rDoc.Fill(this.aSource.aStart.Col(), this.aSource.aStart.Row(), this.aSource.aEnd.Col(), this.aSource.aEnd.Row(), this.aMarkData, nCount, this.eFillDir, this.eFillCmd, this.eFillDateCmd, this.fStepValue, this.fMaxValue);

    this.rDocShell.PostPaint(this.aBlockRange, PaintPartFlags.Grid);
    this.rDocShell.PostDataChanged();

    this.EndRedo();
  }
}

export class ScUndoMerge extends ScSimpleUndo {
  private maOption: ScCellMergeOption;
  private mbMergeContents: boolean;
  private mxUndoDoc: ScDocument | null;

  constructor(rNewDocShell: ScDocShell, aOption: ScCellMergeOption, bMergeContents: boolean, pUndoDoc: ScDocument | null) {
    super(rNewDocShell);
    this.maOption = aOption.clone();
    this.mbMergeContents = bMergeContents;
    this.mxUndoDoc = pUndoDoc;
  }

  override GetComment(): string { return STR_UNDO_MERGE; }

  private DoChange(bUndo: boolean): void {
    if (!this.maOption.maTabs.size)
      // Nothing to do.
      return;

    const rDoc = this.rDocShell.GetDocument();

    for (const nTab of this.maOption.tabs()) {
      const aRange = this.maOption.getSingleRange(nTab);

      if (bUndo)
        // remove merge (contents are copied back below from undo document)
        rDoc.RemoveMerge(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aStart.Tab());
      else {
        // repeat merge, but do not remove note captions (will be done by drawing redo below)
        rDoc.DoMerge(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row(), aRange.aStart.Tab());

        if (this.maOption.mbCenter) rDoc.ApplyAttr(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aStart.Tab(), { ATTR_HOR_JUSTIFY: 'Center', ATTR_VER_JUSTIFY: 'Center' });
      }

      // undo -> copy back deleted contents
      if (bUndo && this.mxUndoDoc) {
        rDoc.DeleteAreaTab(aRange, InsertDeleteFlags.CONTENTS | InsertDeleteFlags.NOCAPTIONS | InsertDeleteFlags.FORGETCAPTIONS);
        this.mxUndoDoc.CopyToDocument(aRange, InsertDeleteFlags.ALL | InsertDeleteFlags.NOCAPTIONS, false, rDoc);
      }
      // redo -> merge contents again
      else if (!bUndo && this.mbMergeContents) {
        rDoc.DoMergeContents(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row(), aRange.aStart.Tab());
      }

      if (!this.rDocShell.AdjustRowHeight(this.maOption.mnStartRow, this.maOption.mnEndRow, nTab)) this.rDocShell.PostPaint(aRange, PaintPartFlags.Grid); // ScUndoUtil::PaintMore

      this.BroadcastChanges(aRange);
    }
  }

  override Undo(): void {
    this.BeginUndo();
    this.DoChange(true);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    this.DoChange(false);
    this.EndRedo();
  }
}
