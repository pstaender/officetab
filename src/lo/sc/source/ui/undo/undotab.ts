// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undotab.hxx partial
// @upstream sc/source/ui/undo/undotab.cxx partial
// The undo actions of sheets: insert (ScUndoInsertTab), delete (ScUndoDeleteTab), rename
// (ScUndoRenameTab), move (ScUndoMoveTab) and copy (ScUndoCopyTab). Upstream several of them go
// through the view shell (DeleteTable, InsertTable, AppendTable); here they call the document
// or ScDocFunc without recording. ScUndoPrintRange restores the print ranges of all sheets.
// Change tracking, the drawing layer, links, scenarios, sheet events, VBA modules and the LOK
// notifications are left out, as are the other actions of undotab.cxx (tab colour, protection,
// show/hide, layout direction, ...).
import { ScRange, type SCTAB } from '../../../inc/address.ts';
import { InsertDeleteFlags } from '../../../inc/global.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import type { ScRefUndoData } from './refundo.ts';
import { ScMoveUndo, ScSimpleUndo } from './undobase.ts';
import type { ScPrintRangeSaver } from '../../../inc/prnsave.ts';
import { ScPrintFunc } from '../view/printfun.ts';

const STR_UNDO_APPEND_TAB = 'Append sheet';
const STR_UNDO_INSERT_TAB = 'Insert Sheet';
const STR_UNDO_DELETE_TAB = 'Delete Sheets';
const STR_UNDO_RENAME_TAB = 'Rename Sheet';
const STR_UNDO_MOVE_TAB = 'Move Sheets';
const STR_UNDO_COPY_TAB = 'Copy Sheets';

const MAXTAB = 9999;

export class ScUndoInsertTab extends ScSimpleUndo {
  private sNewName: string;
  private nTab: SCTAB;
  private bAppend: boolean;

  constructor(rNewDocShell: ScDocShell, nTabNum: SCTAB, bApp: boolean, aNewName: string) {
    super(rNewDocShell);
    this.sNewName = aNewName;
    this.nTab = nTabNum;
    this.bAppend = bApp;
  }

  override GetComment(): string { return this.bAppend ? STR_UNDO_APPEND_TAB : STR_UNDO_INSERT_TAB; }

  override Undo(): void {
    this.rDocShell.SetInUndo(true); //! BeginUndo
    this.rDocShell.GetDocFunc().DeleteTable(this.nTab, false);
    this.rDocShell.SetInUndo(false); //! EndUndo
  }

  override Redo(): void {
    this.rDocShell.SetInUndo(true); //! BeginRedo
    this.rDocShell.GetDocFunc().InsertTable(this.bAppend ? this.rDocShell.GetDocument().GetTableCount() : this.nTab, this.sNewName, false, true);
    this.rDocShell.SetInUndo(false); //! EndRedo
  }
}

export class ScUndoDeleteTab extends ScMoveUndo {
  private theTabs: SCTAB[];

  constructor(rNewDocShell: ScDocShell, aTab: SCTAB[], pUndoDocument: ScDocument, pRefData: ScRefUndoData | null) {
    super(rNewDocShell, pUndoDocument, pRefData);
    this.theTabs = [...aTab];
  }

  override GetComment(): string { return STR_UNDO_DELETE_TAB; }

  override Undo(): void {
    this.BeginUndo();
    const rDoc = this.rDocShell.GetDocument();
    const pRefUndoDoc = this.pRefUndoDoc!;

    for (const nTab of this.theTabs) {
      const aName = pRefUndoDoc.GetName(nTab) ?? '';
      const bOk = rDoc.InsertTab(nTab, aName, false, true);
      if (bOk) {
        pRefUndoDoc.CopyToDocument(new ScRange(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab), InsertDeleteFlags.ALL, false, rDoc);

        const aOldName = pRefUndoDoc.GetName(nTab) ?? '';
        rDoc.RenameTab(nTab, aOldName);

        rDoc.SetVisible(nTab, pRefUndoDoc.IsVisible(nTab));
        rDoc.SetTabBgColor(nTab, pRefUndoDoc.GetTabBgColor(nTab));
        rDoc.SetLayoutRTL(nTab, pRefUndoDoc.IsLayoutRTL(nTab));

        if (pRefUndoDoc.IsTabProtected(nTab)) rDoc.SetTabProtection(nTab, true);
      }
    }

    this.EndUndo(); // Draw-Undo has to be called before Broadcast!

    this.rDocShell.PostPaint(0, 0, 0, rDoc.MaxCol(), rDoc.MaxRow(), MAXTAB, PaintPartFlags.All); // incl. extras
  }

  override Redo(): void {
    this.rDocShell.SetInUndo(true); //! BeginRedo
    // DeleteTables (descending, so the indices stay valid)
    for (const nTab of [...this.theTabs].sort((a, b) => b - a)) this.rDocShell.GetDocFunc().DeleteTable(nTab, false);
    this.rDocShell.SetInUndo(false); //! EndRedo
  }
}

export class ScUndoRenameTab extends ScSimpleUndo {
  private nTab: SCTAB;
  private sOldName: string;
  private sNewName: string;

  constructor(rNewDocShell: ScDocShell, nT: SCTAB, rOldName: string, rNewName: string) {
    super(rNewDocShell);
    this.nTab = nT;
    this.sOldName = rOldName;
    this.sNewName = rNewName;
  }

  override GetComment(): string { return STR_UNDO_RENAME_TAB; }

  private DoChange(nTabP: SCTAB, rName: string): void {
    const rDoc = this.rDocShell.GetDocument();
    rDoc.RenameTab(nTabP, rName);

    this.rDocShell.PostPaintGridAll();
    this.rDocShell.PostPaintExtras();
    this.rDocShell.PostDataChanged();
  }

  override Undo(): void { this.DoChange(this.nTab, this.sOldName); }
  override Redo(): void { this.DoChange(this.nTab, this.sNewName); }
}

export class ScUndoMoveTab extends ScSimpleUndo {
  private mpOldTabs: SCTAB[];
  private mpNewTabs: SCTAB[];
  private mpOldNames: string[] | null;
  private mpNewNames: string[] | null;

  constructor(rNewDocShell: ScDocShell, pOldTabs: SCTAB[], pNewTabs: SCTAB[], pOldNames: string[] | null = null, pNewNames: string[] | null = null) {
    super(rNewDocShell);
    this.mpOldTabs = [...pOldTabs];
    this.mpNewTabs = [...pNewTabs];
    this.mpOldNames = pOldNames;
    this.mpNewNames = pNewNames;
  }

  override GetComment(): string { return STR_UNDO_MOVE_TAB; }

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();
    if (bUndo) {
      // UnDo
      for (let i = this.mpNewTabs.length; i > 0; --i) {
        let nDestTab = this.mpNewTabs[i - 1]!;
        const nOldTab = this.mpOldTabs[i - 1]!;
        if (nDestTab > MAXTAB || nDestTab >= rDoc.GetTableCount()) nDestTab = rDoc.GetTableCount() - 1; // appended ?

        rDoc.MoveTab(nDestTab, nOldTab);
        if (this.mpOldNames) rDoc.RenameTab(nOldTab, this.mpOldNames[i - 1]!);
      }
    } else {
      for (let i = 0; i < this.mpNewTabs.length; ++i) {
        const nDestTab = this.mpNewTabs[i]!;
        const nNewTab = nDestTab;
        const nOldTab = this.mpOldTabs[i]!;

        rDoc.MoveTab(nOldTab, nNewTab);
        if (this.mpNewNames) rDoc.RenameTab(nNewTab, this.mpNewNames[i]!);
      }
    }

    this.rDocShell.PostPaintGridAll();
    this.rDocShell.PostPaintExtras();
    this.rDocShell.PostDataChanged();
  }

  override Undo(): void { this.DoChange(true); }
  override Redo(): void { this.DoChange(false); }
}

export class ScUndoCopyTab extends ScSimpleUndo {
  private mpOldTabs: SCTAB[];
  private mpNewTabs: SCTAB[];
  private mpNewNames: string[] | null;
  /** The names the copies got, so redo creates them with the same names. */
  private maCopyNames: string[] = [];

  constructor(rNewDocShell: ScDocShell, pOldTabs: SCTAB[], pNewTabs: SCTAB[], pNewNames: string[] | null = null) {
    super(rNewDocShell);
    this.mpOldTabs = [...pOldTabs];
    this.mpNewTabs = [...pNewTabs];
    this.mpNewNames = pNewNames;
  }

  override GetComment(): string { return STR_UNDO_COPY_TAB; }

  private DoChange(): void {
    this.rDocShell.PostPaintGridAll();
    this.rDocShell.PostPaintExtras();
    this.rDocShell.PostDataChanged();
  }

  override Undo(): void {
    const rDoc = this.rDocShell.GetDocument();
    this.maCopyNames = [];
    for (let i = this.mpNewTabs.length - 1; i >= 0; i--) {
      let nDestTab = this.mpNewTabs[i]!;
      if (nDestTab > MAXTAB || nDestTab >= rDoc.GetTableCount()) nDestTab = rDoc.GetTableCount() - 1; // append?
      this.maCopyNames[i] = rDoc.GetName(nDestTab) ?? '';
      rDoc.DeleteTab(nDestTab);
    }
    this.DoChange();
  }

  override Redo(): void {
    const rDoc = this.rDocShell.GetDocument();

    for (let i = 0; i < this.mpNewTabs.length; ++i) {
      const nDestTab = this.mpNewTabs[i]!;
      const nNewTab = nDestTab;
      const nOldTab = this.mpOldTabs[i]!;

      rDoc.CopyTab(nOldTab, nNewTab, this.maCopyNames[i]);

      let nAdjSource = nOldTab;
      if (nNewTab <= nOldTab) ++nAdjSource; // new position of source table after CopyTab

      if (rDoc.IsTabProtected(nAdjSource)) rDoc.SetTabProtection(nNewTab, true);

      if (this.mpNewNames) rDoc.RenameTab(nNewTab, this.mpNewNames[i]!);
    }

    this.DoChange();
  }
}

const STR_UNDO_PRINTRANGES = 'Change print range';

export class ScUndoPrintRange extends ScSimpleUndo {
  private readonly nTab: SCTAB;
  private readonly pOldRanges: ScPrintRangeSaver;
  private readonly pNewRanges: ScPrintRangeSaver;

  constructor(rShell: ScDocShell, nNewTab: SCTAB, pOld: ScPrintRangeSaver, pNew: ScPrintRangeSaver) {
    super(rShell);
    this.nTab = nNewTab;
    this.pOldRanges = pOld;
    this.pNewRanges = pNew;
  }

  override GetComment(): string { return STR_UNDO_PRINTRANGES; }

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();
    if (bUndo) rDoc.RestorePrintRanges(this.pOldRanges);
    else rDoc.RestorePrintRanges(this.pNewRanges);

    new ScPrintFunc(null, this.rDocShell, this.nTab).UpdatePages();

    this.rDocShell.PostPaint(new ScRange(0, 0, this.nTab, rDoc.MaxCol(), rDoc.MaxRow(), this.nTab), PaintPartFlags.Grid);
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
