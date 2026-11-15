// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/undodat.hxx partial
// @upstream sc/source/ui/undo/undodat.cxx partial
// Undo of the database functions: a filter (ScUndoQuery), showing or hiding the AutoFilter
// buttons (ScUndoAutoFilter) and changes of the database ranges (ScUndoDBData). Reduced: an
// in-place filter keeps the sheet's hidden and filtered row states instead of an undo document
// with the row flags; a filter's redo runs ScDBDocFunc::Query (upstream runs the view's Query,
// which does the same and updates the view); the drawing layer undo is left out.
import { ScRange, type SCTAB } from '../../../inc/address.ts';
import { InsertDeleteFlags } from '../../../inc/global.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScMF } from '../../../inc/scitems.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { ScDBDataPortion, STR_DB_LOCAL_NONAME, type ScDBCollection, type ScDBData } from '../../core/tool/dbdata.ts';
import { ScDBDocFunc } from '../docshell/dbdocfun.ts';
import { PaintPartFlags, type ScDocShell } from '../docshell/docsh.ts';
import { ScDBFuncUndo, ScSimpleUndo } from './undobase.ts';

const STR_UNDO_QUERY = 'Filter';
const STR_UNDO_DBDATA = 'Change Database Range';

/** The hidden and filtered rows of a sheet. */
export interface ScRowFilterState { hidden: unknown; filtered: unknown }

export class ScUndoQuery extends ScDBFuncUndo {
  private nTab: SCTAB;
  private aQueryParam: ScQueryParam;
  private xUndoDoc: ScDocument | null;
  private aRowState: ScRowFilterState | null;
  private xUndoDB: ScDBCollection | null;
  private aOldDest = new ScRange();
  private aAdvSource = new ScRange();
  private bIsAdvanced = false;
  private bDestArea = false;

  constructor(rNewDocShell: ScDocShell, nNewTab: SCTAB, rParam: ScQueryParam, pNewUndoDoc: ScDocument | null, aRowState: ScRowFilterState | null, pNewUndoDB: ScDBCollection | null, pOld: ScRange | null, pAdvSrc: ScRange | null) {
    super(rNewDocShell, new ScRange(rParam.nCol1, rParam.nRow1, nNewTab, rParam.nCol2, rParam.nRow2, nNewTab));
    this.nTab = nNewTab;
    this.aQueryParam = new ScQueryParam(rParam);
    this.xUndoDoc = pNewUndoDoc;
    this.aRowState = aRowState;
    this.xUndoDB = pNewUndoDB;
    if (pOld) {
      this.bDestArea = true;
      this.aOldDest = pOld.clone();
    }
    if (pAdvSrc) {
      this.bIsAdvanced = true;
      this.aAdvSource = pAdvSrc.clone();
    }
  }

  // "Filter";
  override GetComment(): string { return STR_UNDO_QUERY; }

  override Undo(): void {
    this.BeginUndo();

    const rDoc = this.rDocShell.GetDocument();
    const aQueryParam = this.aQueryParam;
    const nTab = this.nTab;

    const bCopy = !aQueryParam.bInplace;
    let nDestEndCol = 0;
    let nDestEndRow = 0;
    if (bCopy) {
      nDestEndCol = aQueryParam.nDestCol + (aQueryParam.nCol2 - aQueryParam.nCol1);
      nDestEndRow = aQueryParam.nDestRow + (aQueryParam.nRow2 - aQueryParam.nRow1);

      const pData = rDoc.GetDBAtCursor(aQueryParam.nDestCol, aQueryParam.nDestRow, aQueryParam.nDestTab, ScDBDataPortion.TOP_LEFT);
      if (pData) {
        const aNewDest = pData.GetArea();
        nDestEndCol = aNewDest.aEnd.Col();
        nDestEndRow = aNewDest.aEnd.Row();
      }

      rDoc.DeleteAreaTab(aQueryParam.nDestCol, aQueryParam.nDestRow, nDestEndCol, nDestEndRow, aQueryParam.nDestTab, InsertDeleteFlags.ALL);

      this.xUndoDoc?.CopyToDocument(new ScRange(aQueryParam.nDestCol, aQueryParam.nDestRow, aQueryParam.nDestTab, nDestEndCol, nDestEndRow, aQueryParam.nDestTab), InsertDeleteFlags.ALL, false, rDoc);
      //  Attributes are always copied (#49287#)

      // rest of the old range
      if (this.bDestArea) {
        rDoc.DeleteAreaTab(this.aOldDest.aStart.Col(), this.aOldDest.aStart.Row(), this.aOldDest.aEnd.Col(), this.aOldDest.aEnd.Row(), this.aOldDest.aStart.Tab(), InsertDeleteFlags.ALL);
        this.xUndoDoc?.CopyToDocument(this.aOldDest, InsertDeleteFlags.ALL, false, rDoc);
      }
    } else if (this.aRowState) rDoc.SetRowFilterState(nTab, this.aRowState);

    if (this.xUndoDB) rDoc.SetDBCollection(this.xUndoDB.clone(), true);

    const aDirtyRange = new ScRange(0, aQueryParam.nRow1, nTab, rDoc.MaxCol(), aQueryParam.nRow2, nTab);
    rDoc.SetDirty(aDirtyRange, true);
    rDoc.SetSubTotalCellsDirty(aDirtyRange);

    //  Paint

    if (bCopy) {
      let nEndX = nDestEndCol;
      let nEndY = nDestEndRow;
      if (this.bDestArea) {
        if (this.aOldDest.aEnd.Col() > nEndX) nEndX = this.aOldDest.aEnd.Col();
        if (this.aOldDest.aEnd.Row() > nEndY) nEndY = this.aOldDest.aEnd.Row();
      }
      this.rDocShell.PostPaint(aQueryParam.nDestCol, aQueryParam.nDestRow, aQueryParam.nDestTab, nEndX, nEndY, aQueryParam.nDestTab, PaintPartFlags.Grid);
    } else this.rDocShell.PostPaint(0, aQueryParam.nRow1, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab, PaintPartFlags.Grid | PaintPartFlags.Left);
    this.rDocShell.PostDataChanged();

    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();

    new ScDBDocFunc(this.rDocShell).Query(this.nTab, this.aQueryParam, this.bIsAdvanced ? this.aAdvSource : null, false, true);

    this.EndRedo();
  }
}

export class ScUndoAutoFilter extends ScDBFuncUndo {
  private aDBName: string;
  private bFilterSet: boolean;

  constructor(rNewDocShell: ScDocShell, rRange: ScRange, aName: string, bSet: boolean) {
    super(rNewDocShell, rRange);
    this.aDBName = aName;
    this.bFilterSet = bSet;
  }

  override GetComment(): string { return STR_UNDO_QUERY; } // same as ScUndoQuery

  private DoChange(bUndo: boolean): void {
    const bNewFilter = bUndo ? !this.bFilterSet : this.bFilterSet;

    const rDoc = this.rDocShell.GetDocument();
    let pDBData: ScDBData | null = null;
    if (this.aDBName === STR_DB_LOCAL_NONAME) {
      const nTab = this.aOriginalRange.aStart.Tab();
      pDBData = rDoc.GetAnonymousDBData(nTab);
    } else {
      const pColl = rDoc.GetDBCollection();
      pDBData = pColl.getNamedDBs().findByUpperName(this.aDBName.toUpperCase());
    }

    if (!pDBData) return;

    pDBData.SetAutoFilter(bNewFilter);

    const r = pDBData.GetAreaVars();

    if (bNewFilter) rDoc.ApplyFlagsTab(r.nCol1, r.nRow1, r.nCol2, r.nRow1, r.nTab, ScMF.Auto);
    else rDoc.RemoveFlagsTab(r.nCol1, r.nRow1, r.nCol2, r.nRow1, r.nTab, ScMF.Auto);

    this.rDocShell.PostPaint(r.nCol1, r.nRow1, r.nTab, r.nCol2, r.nRow1, r.nTab, PaintPartFlags.Grid);
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

export class ScUndoDBData extends ScSimpleUndo {
  private pUndoColl: ScDBCollection;
  private pRedoColl: ScDBCollection;

  constructor(rNewDocShell: ScDocShell, pNewUndoColl: ScDBCollection, pNewRedoColl: ScDBCollection) {
    super(rNewDocShell);
    this.pUndoColl = pNewUndoColl;
    this.pRedoColl = pNewRedoColl;
  }

  // "Change database range";
  override GetComment(): string { return STR_UNDO_DBDATA; }

  override Undo(): void {
    this.BeginUndo();
    const rDoc = this.rDocShell.GetDocument();
    rDoc.SetDBCollection(this.pUndoColl.clone(), true);
    this.rDocShell.PostPaintGridAll();
    this.EndUndo();
  }

  override Redo(): void {
    this.BeginRedo();
    const rDoc = this.rDocShell.GetDocument();
    rDoc.SetDBCollection(this.pRedoColl.clone(), true);
    this.rDocShell.PostPaintGridAll();
    this.EndRedo();
  }
}
