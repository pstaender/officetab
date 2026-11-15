// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undostyl.hxx partial
// @upstream sc/source/ui/undo/undostyl.cxx partial
// ScUndoModifyStyle for page styles: a page style's items before and after the Page Style dialog
// (ScStyleSaveData). Creating, deleting and renaming styles, cell and graphic styles
// (lcl_DocStyleChanged) and ScUndoApplyPageStyle are not ported.
import type { ScItemSet } from '../../../inc/scitems.ts';
import { SfxStyleFamily, type ScStyleSheet } from '../../../inc/stlsheet.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import { ScSimpleUndo } from './undobase.ts';

const STR_UNDO_EDITPAGESTYLE = 'Edit Page Style';
const STR_UNDO_EDITCELLSTYLE = 'Edit Cell Style';

export class ScStyleSaveData {
  private aName = '';
  private aParent = '';
  private moItems: ScItemSet | null = null;

  GetName(): string { return this.aName; }
  GetParent(): string { return this.aParent; }
  GetItems(): ScItemSet | null { return this.moItems; }

  InitFromStyle(pSource: ScStyleSheet | null): void {
    if (pSource) {
      this.aName = pSource.GetName();
      this.aParent = pSource.GetParent();
      this.moItems = { ...pSource.GetItemSet() };
    } else {
      this.aName = '';
      this.aParent = '';
      this.moItems = null;
    }
  }
}

export class ScUndoModifyStyle extends ScSimpleUndo {
  private readonly eFamily: SfxStyleFamily;
  private readonly aOldData: ScStyleSaveData;
  private readonly aNewData: ScStyleSaveData;

  constructor(rShell: ScDocShell, eFam: SfxStyleFamily, rOld: ScStyleSaveData, rNew: ScStyleSaveData) {
    super(rShell);
    this.eFamily = eFam;
    this.aOldData = rOld;
    this.aNewData = rNew;
  }

  override GetComment(): string { return this.eFamily === SfxStyleFamily.Page ? STR_UNDO_EDITPAGESTYLE : STR_UNDO_EDITCELLSTYLE; }

  static DoChange(rDocSh: ScDocShell, rName: string, eStyleFamily: SfxStyleFamily, rData: ScStyleSaveData): void {
    const rDoc = rDocSh.GetDocument();
    const pStlPool = rDoc.GetStyleSheetPool();
    const aNewName = rData.GetName();

    // find old style to modify
    const pStyle = rName ? pStlPool.Find(rName, eStyleFamily) : null;
    if (pStyle) {
      // set new name
      pStyle.SetName(aNewName);

      // modify style

      const aNewParent = rData.GetParent();
      if (aNewParent !== pStyle.GetParent()) pStyle.SetParent(aNewParent);

      const pNewSet = rData.GetItems();
      if (pNewSet) pStyle.SetItemSet(pNewSet);

      if (eStyleFamily === SfxStyleFamily.Page) {
        // page styles

        if (aNewName !== rName) rDoc.RenamePageStyleInUse(rName, aNewName);

        rDocSh.PageStyleModified(aNewName, true);
      }
    }

    rDocSh.PostPaint(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), Math.max(0, rDoc.GetTableCount() - 1), PaintPartFlags.Grid | PaintPartFlags.Left);
  }

  override Undo(): void {
    this.BeginUndo();
    ScUndoModifyStyle.DoChange(this.rDocShell, this.aNewData.GetName(), this.eFamily, this.aOldData);
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    ScUndoModifyStyle.DoChange(this.rDocShell, this.aOldData.GetName(), this.eFamily, this.aNewData);
    this.EndRedo();
  }
}
