// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undoblk.hxx partial
// @upstream sc/source/ui/undo/undoblk.cxx partial
// The undo actions of inserting and deleting cells, rows and columns (ScUndoInsertCells,
// ScUndoDeleteCells), pasting (ScUndoPaste), applying a cell style (ScUndoSelectionStyle),
// entering an array formula (ScUndoEnterMatrix) and removing merges (ScUndoRemoveMerge). Change
// tracking, the drawing layer, AutoFilter buttons, the LOK notifications, the paste-with-insert
// combination and Repeat are left out; ScUndoPaste keeps the destination before and after the
// paste (its undo and redo documents) instead of the reference undo data. The other actions of
// undoblk.cxx (cut, drag and drop, borders, indents, transliteration, conditional formats,
// sparklines, ...) are not ported.
import { ScRange, type SCTAB } from '../../../inc/address.ts';
import { DelCellCmd, HasAttrFlags, InsCellCmd, InsertDeleteFlags } from '../../../inc/global.ts';
import { ScMarkData } from '../../../inc/markdata.ts';
import { SfxStyleFamily } from '../../../inc/stlsheet.ts';
import { ScMF } from '../../../inc/scitems.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { PaintPartFlags, SC_PF_LINES, type ScDocShell } from '../docshell/docsh.ts';
import type { ScCellMergeOption } from '../view/cellmergeoption.ts';
import type { ScRefUndoData } from './refundo.ts';
import { ScBlockUndo, ScBlockUndoMode, ScMoveUndo, ScSimpleUndo } from './undobase.ts';

const STR_UNDO_INSERTCELLS = 'Insert';
const STR_UNDO_DELETECELLS = 'Delete';
const STR_UNDO_APPLYCELLSTYLE = 'Apply Cell Style';
const STR_UNDO_ENTERMATRIX = 'Insert Array Formula';
const STR_UNDO_REMERGE = 'Split Cells';
const STR_UNDO_PASTE = 'Paste';

const { INS_CELLSDOWN, INS_CELLSRIGHT, INS_INSROWS_BEFORE, INS_INSCOLS_BEFORE, INS_INSROWS_AFTER, INS_INSCOLS_AFTER } = InsCellCmd;

export class ScUndoInsertCells extends ScMoveUndo {
  private aEffRange: ScRange;
  private nCount: SCTAB;
  private pTabs: SCTAB[];
  private pScenarios: SCTAB[];
  private eCmd: InsCellCmd;
  private bPartOfPaste: boolean;

  constructor(rNewDocShell: ScDocShell, rRange: ScRange, nNewCount: SCTAB, pNewTabs: SCTAB[], pNewScenarios: SCTAB[], eNewCmd: InsCellCmd, pUndoDocument: ScDocument | null, pRefData: ScRefUndoData | null, bNewPartOfPaste: boolean) {
    super(rNewDocShell, pUndoDocument, pRefData);
    this.aEffRange = rRange.clone();
    this.nCount = nNewCount;
    this.pTabs = pNewTabs;
    this.pScenarios = pNewScenarios;
    this.eCmd = eNewCmd;
    this.bPartOfPaste = bNewPartOfPaste;
    const rDoc = this.rDocShell.GetDocument();
    if (this.eCmd === INS_INSROWS_BEFORE || this.eCmd === INS_INSROWS_AFTER) {
      // whole row?
      this.aEffRange.aStart.SetCol(0);
      this.aEffRange.aEnd.SetCol(rDoc.MaxCol());
    }

    if (this.eCmd === INS_INSCOLS_BEFORE || this.eCmd === INS_INSCOLS_AFTER) {
      // whole column?
      this.aEffRange.aStart.SetRow(0);
      this.aEffRange.aEnd.SetRow(rDoc.MaxRow());
    }
  }

  override GetComment(): string { return STR_UNDO_INSERTCELLS; }

  IsPartOfPaste(): boolean { return this.bPartOfPaste; }

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();
    let i: SCTAB;
    const r = this.aEffRange;

    // refresh of merged cells has to be after inserting/deleting

    switch (this.eCmd) {
      case INS_INSROWS_BEFORE:
      case INS_INSROWS_AFTER:
      case INS_CELLSDOWN:
        for (i = 0; i < this.nCount; i++) {
          if (bUndo) rDoc.DeleteRow(r.aStart.Col(), this.pTabs[i]!, r.aEnd.Col(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Row(), r.aEnd.Row() - r.aStart.Row() + 1);
          else rDoc.InsertRow(r.aStart.Col(), this.pTabs[i]!, r.aEnd.Col(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Row(), r.aEnd.Row() - r.aStart.Row() + 1);
        }
        break;
      case INS_INSCOLS_BEFORE:
      case INS_INSCOLS_AFTER:
      case INS_CELLSRIGHT:
        for (i = 0; i < this.nCount; i++) {
          if (bUndo) rDoc.DeleteCol(r.aStart.Row(), this.pTabs[i]!, r.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Col(), r.aEnd.Col() - r.aStart.Col() + 1);
          else rDoc.InsertCol(r.aStart.Row(), this.pTabs[i]!, r.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Col(), r.aEnd.Col() - r.aStart.Col() + 1);
        }
        break;
      default:
      // added to avoid warnings
    }

    const aWorkRange = this.aEffRange.clone();
    if (this.eCmd === INS_CELLSRIGHT) aWorkRange.aEnd.SetCol(rDoc.MaxCol()); // only "shift right" requires refresh of the moved area

    // Undo for displaced attributes?

    let nPaint: number = PaintPartFlags.Grid;

    switch (this.eCmd) {
      case INS_INSROWS_BEFORE:
      case INS_INSROWS_AFTER:
        nPaint |= PaintPartFlags.Left;
        aWorkRange.aEnd.SetRow(rDoc.MaxRow());
        break;
      case INS_CELLSDOWN:
        for (i = 0; i < this.nCount; i++) {
          aWorkRange.aEnd.SetRow(rDoc.MaxRow());
          if (this.rDocShell.AdjustRowHeight(aWorkRange.aStart.Row(), aWorkRange.aEnd.Row(), this.pTabs[i]!)) {
            aWorkRange.aStart.SetCol(0);
            aWorkRange.aEnd.SetCol(rDoc.MaxCol());
            nPaint |= PaintPartFlags.Left;
          }
        }
        break;
      case INS_INSCOLS_BEFORE:
      case INS_INSCOLS_AFTER:
      case INS_CELLSRIGHT:
        if (this.eCmd !== INS_CELLSRIGHT) nPaint |= PaintPartFlags.Top; // top bar
        for (i = 0; i < this.nCount; i++) {
          aWorkRange.aEnd.SetCol(rDoc.MaxCol()); // to the far right
          if (this.rDocShell.AdjustRowHeight(aWorkRange.aStart.Row(), aWorkRange.aEnd.Row(), this.pTabs[i]!)) {
            // AdjustDraw does not paint PaintPartFlags::Top,
            aWorkRange.aStart.SetCol(0); // thus solved like this
            aWorkRange.aEnd.SetRow(rDoc.MaxRow());
            nPaint |= PaintPartFlags.Left;
          }
        }
        break;
      default:
      // added to avoid warnings
    }

    for (i = 0; i < this.nCount; i++) this.rDocShell.PostPaint(aWorkRange.aStart.Col(), aWorkRange.aStart.Row(), this.pTabs[i]!, aWorkRange.aEnd.Col(), aWorkRange.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!, nPaint);
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

export class ScUndoDeleteCells extends ScMoveUndo {
  private aEffRange: ScRange;
  private nCount: SCTAB;
  private pTabs: SCTAB[];
  private pScenarios: SCTAB[];
  private eCmd: DelCellCmd;

  constructor(rNewDocShell: ScDocShell, rRange: ScRange, nNewCount: SCTAB, pNewTabs: SCTAB[], pNewScenarios: SCTAB[], eNewCmd: DelCellCmd, pUndoDocument: ScDocument | null, pRefData: ScRefUndoData | null) {
    super(rNewDocShell, pUndoDocument, pRefData);
    this.aEffRange = rRange.clone();
    this.nCount = nNewCount;
    this.pTabs = pNewTabs;
    this.pScenarios = pNewScenarios;
    this.eCmd = eNewCmd;
    const rDoc = this.rDocShell.GetDocument();
    if (this.eCmd === DelCellCmd.Rows) {
      // whole row?
      this.aEffRange.aStart.SetCol(0);
      this.aEffRange.aEnd.SetCol(rDoc.MaxCol());
    }

    if (this.eCmd === DelCellCmd.Cols) {
      // whole column?
      this.aEffRange.aStart.SetRow(0);
      this.aEffRange.aEnd.SetRow(rDoc.MaxRow());
    }
  }

  override GetComment(): string { return STR_UNDO_DELETECELLS; } // "Delete"

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();
    let i: SCTAB;
    const r = this.aEffRange;

    switch (this.eCmd) {
      case DelCellCmd.Rows:
      case DelCellCmd.CellsUp:
        for (i = 0; i < this.nCount; i++) {
          if (bUndo) rDoc.InsertRow(r.aStart.Col(), this.pTabs[i]!, r.aEnd.Col(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Row(), r.aEnd.Row() - r.aStart.Row() + 1);
          else rDoc.DeleteRow(r.aStart.Col(), this.pTabs[i]!, r.aEnd.Col(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Row(), r.aEnd.Row() - r.aStart.Row() + 1);
        }
        break;
      case DelCellCmd.Cols:
      case DelCellCmd.CellsLeft:
        for (i = 0; i < this.nCount; i++) {
          if (bUndo) rDoc.InsertCol(r.aStart.Row(), this.pTabs[i]!, r.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Col(), r.aEnd.Col() - r.aStart.Col() + 1);
          else rDoc.DeleteCol(r.aStart.Row(), this.pTabs[i]!, r.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!, r.aStart.Col(), r.aEnd.Col() - r.aStart.Col() + 1);
        }
        break;
      default:
      // added to avoid warnings
    }

    // if Undo, restore references
    for (i = 0; i < this.nCount && bUndo; i++) {
      this.pRefUndoDoc!.CopyToDocument(new ScRange(r.aStart.Col(), r.aStart.Row(), this.pTabs[i]!, r.aEnd.Col(), r.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!), InsertDeleteFlags.ALL | InsertDeleteFlags.NOCAPTIONS, false, rDoc);
    }

    const aWorkRange = this.aEffRange.clone();
    if (this.eCmd === DelCellCmd.CellsLeft) aWorkRange.aEnd.SetCol(rDoc.MaxCol()); // only "shift left" requires refresh of the moved area

    for (i = 0; i < this.nCount; i++) {
      if (rDoc.HasAttrib(aWorkRange.aStart.Col(), aWorkRange.aStart.Row(), this.pTabs[i]!, aWorkRange.aEnd.Col(), aWorkRange.aEnd.Row(), this.pTabs[i]!, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
        // #i51445# old merge flag attributes must be deleted also for single cells,
        // not only for whole columns/rows

        if (!bUndo) {
          if (this.eCmd === DelCellCmd.Cols || this.eCmd === DelCellCmd.CellsLeft) aWorkRange.aEnd.SetCol(rDoc.MaxCol());
          if (this.eCmd === DelCellCmd.Rows || this.eCmd === DelCellCmd.CellsUp) aWorkRange.aEnd.SetRow(rDoc.MaxRow());
          rDoc.RemoveFlagsTab(aWorkRange.aStart.Col(), aWorkRange.aStart.Row(), aWorkRange.aEnd.Col(), aWorkRange.aEnd.Row(), aWorkRange.aStart.Tab(), ScMF.Hor | ScMF.Ver);
        }

        rDoc.ExtendMerge(aWorkRange.aStart.Col(), aWorkRange.aStart.Row(), aWorkRange.aEnd.Col(), aWorkRange.aEnd.Row(), this.pTabs[i]!);
      }
    }

    // paint
    let nPaint: number = PaintPartFlags.Grid;
    switch (this.eCmd) {
      case DelCellCmd.Rows:
        nPaint |= PaintPartFlags.Left;
        aWorkRange.aEnd.SetRow(rDoc.MaxRow());
        break;
      case DelCellCmd.CellsUp:
        for (i = 0; i < this.nCount; i++) {
          aWorkRange.aEnd.SetRow(rDoc.MaxRow());
          if (this.rDocShell.AdjustRowHeight(aWorkRange.aStart.Row(), aWorkRange.aEnd.Row(), this.pTabs[i]!)) {
            aWorkRange.aStart.SetCol(0);
            aWorkRange.aEnd.SetCol(rDoc.MaxCol());
            nPaint |= PaintPartFlags.Left;
          }
        }
        break;
      case DelCellCmd.Cols:
      case DelCellCmd.CellsLeft:
        if (this.eCmd === DelCellCmd.Cols) nPaint |= PaintPartFlags.Top; // top bar
        for (i = 0; i < this.nCount; i++) {
          aWorkRange.aEnd.SetCol(rDoc.MaxCol()); // to the far right
          if (this.rDocShell.AdjustRowHeight(aWorkRange.aStart.Row(), aWorkRange.aEnd.Row(), this.pTabs[i]!)) {
            aWorkRange.aStart.SetCol(0);
            aWorkRange.aEnd.SetRow(rDoc.MaxRow());
            nPaint |= PaintPartFlags.Left;
          }
        }
        break;
      default:
      // added to avoid warnings
    }

    for (i = 0; i < this.nCount; i++) this.rDocShell.PostPaint(aWorkRange.aStart.Col(), aWorkRange.aStart.Row(), this.pTabs[i]!, aWorkRange.aEnd.Col(), aWorkRange.aEnd.Row(), this.pTabs[i]! + this.pScenarios[i]!, nPaint, SC_PF_LINES);
    // Selection not until EndUndo

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

export class ScUndoSelectionStyle extends ScSimpleUndo {
  private aMarkData: ScMarkData;
  private pUndoDoc: ScDocument;
  private aStyleName: string;
  private aRange: ScRange;

  constructor(rNewDocShell: ScDocShell, rMark: ScMarkData, rRange: ScRange, aName: string, pNewUndoDoc: ScDocument) {
    super(rNewDocShell);
    this.aMarkData = rMark.clone();
    this.pUndoDoc = pNewUndoDoc;
    this.aStyleName = aName;
    this.aRange = rRange.clone();
    this.aMarkData.MarkToMulti();
  }

  override GetComment(): string { return STR_UNDO_APPLYCELLSTYLE; }

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();

    this.SetViewMarkData(this.aMarkData);

    const aWorkRange = this.aRange.clone();
    if (rDoc.HasAttrib(aWorkRange, HasAttrFlags.Merged)) rDoc.ExtendMerge(aWorkRange); // Merged cells?

    if (bUndo) {
      // if Undo then push back all old data again
      const nTabCount = rDoc.GetTableCount();
      const aCopyRange = aWorkRange.clone();
      aCopyRange.aStart.SetTab(0);
      aCopyRange.aEnd.SetTab(nTabCount - 1);
      this.pUndoDoc.CopyToDocument(aCopyRange, InsertDeleteFlags.ATTRIB, true, rDoc, this.aMarkData);
    } else {
      // if Redo, then reapply style
      const pStlPool = rDoc.GetStyleSheetPool();
      const pStyleSheet = pStlPool.Find(this.aStyleName, SfxStyleFamily.Para);
      if (!pStyleSheet) return; // StyleSheet not found
      rDoc.ApplySelectionStyle(pStyleSheet, this.aMarkData);
    }

    if (!this.rDocShell.AdjustRowHeight(aWorkRange.aStart.Row(), aWorkRange.aEnd.Row(), aWorkRange.aStart.Tab()))
      this.rDocShell.PostPaint(aWorkRange, PaintPartFlags.Grid | PaintPartFlags.Extras);
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

export class ScUndoEnterMatrix extends ScBlockUndo {
  private pUndoDoc: ScDocument;
  private aFormula: string;

  constructor(rNewDocShell: ScDocShell, rArea: ScRange, pNewUndoDoc: ScDocument, aForm: string) {
    super(rNewDocShell, rArea, ScBlockUndoMode.SC_UNDO_SIMPLE);
    this.pUndoDoc = pNewUndoDoc;
    this.aFormula = aForm;
  }

  override GetComment(): string { return STR_UNDO_ENTERMATRIX; }

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();

    rDoc.DeleteAreaTab(this.aBlockRange, InsertDeleteFlags.ALL & ~InsertDeleteFlags.NOTE);
    this.pUndoDoc.CopyToDocument(this.aBlockRange, InsertDeleteFlags.ALL & ~InsertDeleteFlags.NOTE, false, rDoc);
    this.BroadcastChanges(this.aBlockRange);
    this.rDocShell.PostPaint(this.aBlockRange, PaintPartFlags.Grid);
    this.rDocShell.PostDataChanged();

    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    const rDoc = this.rDocShell.GetDocument();

    const aDestMark = new ScMarkData(rDoc.GetSheetLimits());
    aDestMark.SelectOneTable(this.aBlockRange.aStart.Tab());
    aDestMark.SetMarkArea(this.aBlockRange);

    rDoc.InsertMatrixFormula(this.aBlockRange.aStart.Col(), this.aBlockRange.aStart.Row(), this.aBlockRange.aEnd.Col(), this.aBlockRange.aEnd.Row(), aDestMark, this.aFormula);

    this.EndRedo();
  }
}

export class ScUndoRemoveMerge extends ScBlockUndo {
  private maOptions: ScCellMergeOption[] = [];
  private pUndoDoc: ScDocument;

  /** ScUndoRemoveMerge(rDocSh, rOption, pUndoDoc) or ScUndoRemoveMerge(rDocSh, rRange, pUndoDoc). */
  constructor(rNewDocShell: ScDocShell, rOption: ScCellMergeOption | ScRange, pNewUndoDoc: ScDocument) {
    super(rNewDocShell, rOption instanceof ScRange ? rOption : rOption.getFirstSingleRange(), ScBlockUndoMode.SC_UNDO_SIMPLE);
    this.pUndoDoc = pNewUndoDoc;
    if (!(rOption instanceof ScRange)) this.maOptions.push(rOption.clone());
  }

  override GetComment(): string { return STR_UNDO_REMERGE; } // "remove merge"

  GetUndoDoc(): ScDocument { return this.pUndoDoc; }

  AddCellMergeOption(rOption: ScCellMergeOption): void { this.maOptions.push(rOption.clone()); }

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();
    for (const rOption of this.maOptions) {
      for (const rTab of rOption.tabs()) {
        // There is no need to extend merge area because it's already been extended.
        const aRange = rOption.getSingleRange(rTab);
        rDoc.DeleteAreaTab(aRange, InsertDeleteFlags.ATTRIB);
        this.pUndoDoc.CopyToDocument(aRange, InsertDeleteFlags.ATTRIB, false, rDoc);

        if (!this.rDocShell.AdjustRowHeight(rOption.mnStartRow, rOption.mnEndRow, rTab)) this.rDocShell.PostPaint(aRange, PaintPartFlags.Grid); // ScUndoUtil::PaintMore
      }
    }
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    const rDoc = this.rDocShell.GetDocument();

    for (const rOption of this.maOptions) {
      for (const nTab of rOption.tabs()) {
        // There is no need to extend merge area because it's already been extended.
        const aRange = rOption.getSingleRange(nTab);

        rDoc.ApplyPatternAreaTab(rOption.mnStartCol, rOption.mnStartRow, rOption.mnEndCol, rOption.mnEndRow, nTab, { ATTR_MERGE: { nColMerge: 0, nRowMerge: 0 } });

        rDoc.RemoveFlagsTab(rOption.mnStartCol, rOption.mnStartRow, rOption.mnEndCol, rOption.mnEndRow, nTab, ScMF.Hor | ScMF.Ver);

        //  Paint
        if (!this.rDocShell.AdjustRowHeight(rOption.mnStartRow, rOption.mnEndRow, nTab)) this.rDocShell.PostPaint(aRange, PaintPartFlags.Grid); // ScUndoUtil::PaintMore
      }
    }

    this.EndRedo();
  }
}

/** ScUndoPaste: the destination ranges as they were before and after a paste. */
export class ScUndoPaste extends ScSimpleUndo {
  private aMarkData: ScMarkData;
  private maBlockRanges: ScRange[];
  private pUndoDoc: ScDocument;
  private pRedoDoc: ScDocument;
  private nFlags: InsertDeleteFlags;

  constructor(rNewDocShell: ScDocShell, rRanges: readonly ScRange[], rMark: ScMarkData, pNewUndoDoc: ScDocument, pNewRedoDoc: ScDocument, nNewFlags: InsertDeleteFlags) {
    super(rNewDocShell);
    this.aMarkData = rMark.clone();
    this.maBlockRanges = rRanges.map((r) => r.clone());
    this.pUndoDoc = pNewUndoDoc;
    this.pRedoDoc = pNewRedoDoc;
    this.nFlags = nNewFlags;
  }

  override GetComment(): string { return STR_UNDO_PASTE; }
  override getAffectedRange(): ScRange | null { return this.maBlockRanges[0] ?? null; }

  private DoChange(bUndo: boolean): void {
    const rDoc = this.rDocShell.GetDocument();
    const pSrc = bUndo ? this.pUndoDoc : this.pRedoDoc;
    for (const r of this.maBlockRanges) {
      for (const nTab of this.aMarkData) {
        const aRange = new ScRange(r.aStart.Col(), r.aStart.Row(), nTab, r.aEnd.Col(), r.aEnd.Row(), nTab);
        pSrc.UndoToDocument(aRange, this.nFlags | InsertDeleteFlags.ATTRIB, false, rDoc);
        this.BroadcastChanges(aRange);
        if (!this.rDocShell.AdjustRowHeight(aRange.aStart.Row(), aRange.aEnd.Row(), nTab)) this.rDocShell.PostPaint(aRange, PaintPartFlags.Grid, SC_PF_LINES);
      }
    }
    this.SetViewMarkData(this.aMarkData);
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
