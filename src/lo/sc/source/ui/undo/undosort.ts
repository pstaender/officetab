// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undosort.hxx faithful
// @upstream sc/source/ui/undo/undosort.cxx reduced
// sc::UndoSort: undo and redo of a sort by replaying the reordering (reversed for undo). The
// selection of the sorted block in the view is left out.
import type { ReorderParam } from '../../../inc/sortparam.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import { ScSimpleUndo } from './undobase.ts';

const STR_UNDO_SORT = 'Sort';

export class UndoSort extends ScSimpleUndo {
  private maParam: ReorderParam;

  constructor(rDocSh: ScDocShell, aParam: ReorderParam) {
    super(rDocSh);
    this.maParam = aParam.clone();
  }

  override GetComment(): string { return STR_UNDO_SORT; }

  override Undo(): void {
    this.BeginUndo();
    this.Execute(true);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    this.Execute(false);
    this.EndRedo();
  }

  private Execute(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();
    const aParam = this.maParam.clone();
    if (bUndo) aParam.reverse();
    rDoc.Reorder(aParam);

    const aOverallRange = this.maParam.maSortRange.clone();
    if (this.maParam.maDataAreaExtras.anyExtrasWanted() && this.maParam.maDataAreaExtras.mnEndCol >= 0) {
      aOverallRange.aStart.SetCol(this.maParam.maDataAreaExtras.mnStartCol);
      aOverallRange.aStart.SetRow(this.maParam.maDataAreaExtras.mnStartRow);
      aOverallRange.aEnd.SetCol(this.maParam.maDataAreaExtras.mnEndCol);
      aOverallRange.aEnd.SetRow(this.maParam.maDataAreaExtras.mnEndRow);
    }

    // (ScUndoUtil::MarkSimpleBlock: the view would select the sorted block.)

    rDoc.SetDirty(this.maParam.maSortRange, true);
    if (!aParam.mbUpdateRefs) this.BroadcastChanges(aParam.maSortRange);

    this.rDocShell.PostPaint(aOverallRange, PaintPartFlags.Grid);
    this.rDocShell.PostDataChanged();
  }
}

