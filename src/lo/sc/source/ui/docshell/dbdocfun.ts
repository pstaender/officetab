// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/dbdocfun.hxx partial
// @upstream sc/source/ui/docshell/dbdocfun.cxx partial
// ScDBDocFunc: Sort (Data - Sort), Query (the AutoFilter and the standard filter) and the
// database range functions (AddDBRange, DeleteDBRange, RenameDBRange, ModifyDBData), with undo.
// Query to another position (bInplace false) copies the matching rows there; the destination
// range's "keep formatting" and "insert or delete cells" options (bKeepFmt, bDoSize) are left
// out. DoSubTotals is without outlines. RepeatDB and the pivot table functions are not here. Sorting to another position (bInplace false) moves the block first as
// upstream does, with ScDocument::MoveBlock instead of ScDocFunc::MoveBlock (whose undo is not
// ported, so that move has no undo). The "update references when sorting" option is false
// (the default), cell formats move with their cells.
import { HasAttrFlags } from '../../../inc/global.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { ScRange, type SCTAB } from '../../../inc/address.ts';
import { ReorderParam, ScColorSortMode, ScSortParam } from '../../../inc/sortparam.ts';
import { UndoSort } from '../undo/undosort.ts';
import { ScUndoDBData, ScUndoQuery, ScUndoSubTotals } from '../undo/undodat.ts';
import { ScSubTotalParam } from '../../../inc/subtotalparam.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScDBData, ScDBDataPortion, STR_DB_LOCAL_NONAME } from '../../core/tool/dbdata.ts';
import { InsertDeleteFlags, ScGetDBMode, ScGetDBSelection } from '../../../inc/global.ts';
import { ScDocument, ScDocumentMode } from '../../core/data/document.ts';
import { PaintPartFlags, ScDocShellModificator, type ScDocShell } from './docsh.ts';

const STR_PROTECTIONERR = 'Protected cells can not be modified.';
const STR_SORT_ERR_MERGED = 'The range contains merged cells and cannot be sorted.';
const STR_PASTE_FULL = 'Contents cannot be inserted here.';
const STR_MSSG_INSERTCELLS_0 = 'Cannot insert into merged ranges.';
const STR_MSSG_DOSUBTOTALS_2 = 'Unable to insert rows';

export class ScDBDocFunc {
  private rDocShell: ScDocShell;

  constructor(rDocSh: ScDocShell) {
    this.rDocShell = rDocSh;
  }

  Sort(nTab: SCTAB, rSortParam: ScSortParam, bRecord = true, bPaint = true, bApi = false): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();
    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;

    let bCopy = !rSortParam.bInplace;
    if (bCopy && rSortParam.nDestCol === rSortParam.nCol1 && rSortParam.nDestRow === rSortParam.nRow1 && rSortParam.nDestTab === nTab) bCopy = false;

    const aLocalParam = new ScSortParam(rSortParam);
    if (bCopy) {
      // Copy the data range to the destination then move the sort range to it.
      const aSrcRange = new ScRange(rSortParam.nCol1, rSortParam.nRow1, nTab, rSortParam.nCol2, rSortParam.nRow2, nTab);
      rDoc.MoveBlock(aSrcRange, rSortParam.nDestCol - rSortParam.nCol1, rSortParam.nDestRow - rSortParam.nRow1, rSortParam.nDestTab - nTab);

      aLocalParam.MoveToDest();
      nTab = aLocalParam.nDestTab;
    }

    // tdf#119804: If there is a header row/column, it won't be affected by
    // sorting; so we can exclude it from the test.
    if (rDoc.IsTabProtected(nTab)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_PROTECTIONERR);
      return false;
    }

    const bUpdateRefs = false; // ScInputOptions::GetSortRefUpdate, default off

    // Adjust aLocalParam cols/rows to used data area. Keep sticky top row or
    // column (depending on direction) in any case, not just if it has headers,
    // so empty leading cells will be sorted to the end.
    // aLocalParam.nCol/Row will encompass data content only, extras in
    // aLocalParam.aDataAreaExtras.
    aLocalParam.aDataAreaExtras.resetArea();
    const aShrunk = rDoc.ShrinkToUsedDataArea(nTab, aLocalParam.nCol1, aLocalParam.nRow1, aLocalParam.nCol2, aLocalParam.nRow2, false, aLocalParam.bByRow, !aLocalParam.bByRow);
    aLocalParam.nCol1 = aShrunk.nStartCol;
    aLocalParam.nRow1 = aShrunk.nStartRow;
    aLocalParam.nCol2 = aShrunk.nEndCol;
    aLocalParam.nRow2 = aShrunk.nEndRow;

    let nStartRow = aLocalParam.nRow1;
    if (aLocalParam.bByRow && aLocalParam.bHasHeader && nStartRow < aLocalParam.nRow2) ++nStartRow;

    const nOverallCol1 = aLocalParam.nCol1;
    const nOverallRow1 = aLocalParam.nRow1;
    const nOverallCol2 = aLocalParam.nCol2;
    const nOverallRow2 = aLocalParam.nRow2;

    if (aLocalParam.aDataAreaExtras.mbCellFormats && rDoc.HasAttrib(nOverallCol1, nStartRow, nTab, nOverallCol2, nOverallRow2, nTab, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
      // Merge attributes would be mixed up during sorting.
      if (!bApi) this.rDocShell.ErrorMessage(STR_SORT_ERR_MERGED);
      return false;
    }

    //      execute

    let bRepeatQuery = false; // repeat existing filter?

    const aUndoParam = new ReorderParam();

    // don't call ScDocument::Sort with an empty SortParam (may be empty here if bCopy is set)
    if (aLocalParam.GetSortKeyCount() && aLocalParam.maKeyState[0]!.bDoSort) {
      for (let nRow = aLocalParam.nRow1; nRow <= aLocalParam.nRow2 && !bRepeatQuery; nRow++) if (rDoc.RowHidden(nRow, nTab)) bRepeatQuery = true;
      rDoc.Sort(nTab, aLocalParam, bRepeatQuery, bUpdateRefs, aUndoParam);
    }

    if (bRecord) {
      // Set up an undo object.
      this.rDocShell.GetUndoManager().AddUndoAction(new UndoSort(this.rDocShell, aUndoParam));
    }

    if (nStartRow <= aLocalParam.nRow2) {
      const aDirtyRange = new ScRange(aLocalParam.nCol1, nStartRow, nTab, aLocalParam.nCol2, aLocalParam.nRow2, nTab);
      rDoc.SetDirty(aDirtyRange, true);
    }

    if (bPaint) {
      let nPaint: number = PaintPartFlags.Grid;
      let nStartX = nOverallCol1;
      const nStartY = nOverallRow1;
      let nEndX = nOverallCol2;
      const nEndY = nOverallRow2;
      if (bRepeatQuery) {
        nPaint |= PaintPartFlags.Left;
        nStartX = 0;
        nEndX = rDoc.MaxCol();
      }
      this.rDocShell.PostPaint(new ScRange(nStartX, nStartY, nTab, nEndX, nEndY, nTab), nPaint);
    }

    if (nStartRow <= nOverallRow2) this.rDocShell.AdjustRowHeight(nStartRow, nOverallRow2, nTab);

    aModificator.SetDocumentModified();

    return true;
  }

  /** Filter a database range (Query): in place, hiding the rows that do not match, or by copying
      the matching rows to the destination. The filter is remembered at the database range. */
  Query(nTab: SCTAB, rQueryParam: ScQueryParam, pAdvSource: ScRange | null, bRecord: boolean, bApi: boolean): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();

    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;
    const pDBData = rDoc.GetDBAtArea(nTab, rQueryParam.nCol1, rQueryParam.nRow1, rQueryParam.nCol2, rQueryParam.nRow2);
    if (!pDBData) {
      // Query: no DBData
      return false;
    }

    //  Change from Inplace to non-Inplace, only then cancel Inplace:
    //  (only if "Persistent"  is selected in the dialog)

    if (!rQueryParam.bInplace && pDBData.HasQueryParam() && rQueryParam.bDestPers) {
      const aOldQuery = pDBData.GetQueryParam();
      if (aOldQuery.bInplace) {
        //  cancel old filtering

        const nEC = aOldQuery.GetEntryCount();
        for (let i = 0; i < nEC; i++) aOldQuery.GetEntry(i).bDoQuery = false;
        aOldQuery.bDuplicate = true;
        this.Query(nTab, aOldQuery, null, bRecord, bApi);
      }
    }

    const aLocalParam = new ScQueryParam(rQueryParam); // for Paint / destination range
    let bCopy = !rQueryParam.bInplace; // copied in Table::Query
    let pDestData: ScDBData | null = null; // range to be copied to
    let aOldDest = new ScRange();
    if (bCopy && rQueryParam.nDestCol === rQueryParam.nCol1 && rQueryParam.nDestRow === rQueryParam.nRow1 && rQueryParam.nDestTab === nTab) bCopy = false;
    let nDestTab = nTab;
    if (bCopy) {
      aLocalParam.MoveToDest();
      nDestTab = rQueryParam.nDestTab;
      if (!rDoc.ValidColRow(aLocalParam.nCol2, aLocalParam.nRow2)) {
        if (!bApi) this.rDocShell.ErrorMessage(STR_PASTE_FULL);
        return false;
      }

      pDestData = rDoc.GetDBAtCursor(rQueryParam.nDestCol, rQueryParam.nDestRow, rQueryParam.nDestTab, ScDBDataPortion.TOP_LEFT);
      if (pDestData) aOldDest = pDestData.GetArea();
    }

    //      execute

    let bKeepSub = false; // repeat existing partial results?
    if (rQueryParam.GetEntry(0).bDoQuery) {
      // not at cancellation
      const aSubTotalParam = pDBData.GetSubTotalParam(); // partial results exist?

      if (aSubTotalParam.aGroups[0]!.bActive && !aSubTotalParam.bRemoveOnly) bKeepSub = true;
    }

    let pUndoDoc: ScDocument | null = null;
    let aRowState: ReturnType<ScDocument['GetRowFilterState']> = null;
    let pUndoDB = null;
    let pOld: ScRange | null = null;

    if (bRecord) {
      if (bCopy) {
        pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
        pUndoDoc.InitUndo(rDoc, nDestTab, nDestTab, false, true);
        rDoc.CopyToDocument(new ScRange(aLocalParam.nCol1, aLocalParam.nRow1, nDestTab, aLocalParam.nCol2, aLocalParam.nRow2, nDestTab), InsertDeleteFlags.ALL, false, pUndoDoc);
        //  secure attributes in case they were copied along

        if (pDestData) {
          rDoc.CopyToDocument(aOldDest, InsertDeleteFlags.ALL, false, pUndoDoc);
          pOld = aOldDest;
        }
      } else aRowState = rDoc.GetRowFilterState(nTab);

      const pDocDB = rDoc.GetDBCollection();
      if (!pDocDB.empty()) pUndoDB = pDocDB.clone();
    }

    if (pDestData) {
      // delete destination range
      rDoc.DeleteAreaTab(aOldDest.aStart.Col(), aOldDest.aStart.Row(), aOldDest.aEnd.Col(), aOldDest.aEnd.Row(), aOldDest.aStart.Tab(), InsertDeleteFlags.ALL); // simply delete
    }

    //  execute filtering on the document
    const nCount = rDoc.Query(nTab, rQueryParam, bKeepSub);
    pDBData.CalcSaveFilteredCount(nCount);
    if (bCopy) {
      aLocalParam.nRow2 = aLocalParam.nRow1 + nCount;
      if (!aLocalParam.bHasHeader && nCount > 0) --aLocalParam.nRow2;
    }

    //  saving: Inplace always, otherwise depending on setting
    //          old Inplace-Filter may have already been removed

    const bSave = rQueryParam.bInplace || rQueryParam.bDestPers;
    if (bSave) {
      // memorize
      pDBData.SetQueryParam(rQueryParam);
      pDBData.SetHeader(rQueryParam.bHasHeader); //! ???
      pDBData.SetAdvancedQuerySource(pAdvSource); // after SetQueryParam
    }

    if (bCopy) {
      // memorize new DB range
      //  Selection is done afterwards from outside (dbfunc).
      //  Currently through the DB area at the destination position,
      //  so a range must be created there in any case.

      let pNewData: ScDBData | null;
      if (pDestData) pNewData = pDestData; // range exists -> adjust (always!)
      else {
        // create range
        pNewData = this.rDocShell.GetDBData(new ScRange(aLocalParam.nCol1, aLocalParam.nRow1, nDestTab, aLocalParam.nCol2, aLocalParam.nRow2, nDestTab), ScGetDBMode.SC_DB_MAKE, ScGetDBSelection.ForceMark);
      }

      if (pNewData) {
        pNewData.SetArea(nDestTab, aLocalParam.nCol1, aLocalParam.nRow1, aLocalParam.nCol2, aLocalParam.nRow2);

        //  query parameter is no longer set at the destination, only leads to confusion
        //  and mistakes with the query parameter at the source range (#37187#)
      }
    }

    // #i23299# Subtotal functions depend on cell's filtered states.
    const aDirtyRange = new ScRange(0, aLocalParam.nRow1, nDestTab, rDoc.MaxCol(), aLocalParam.nRow2, nDestTab);
    rDoc.SetSubTotalCellsDirty(aDirtyRange);

    if (bRecord) {
      // create undo action after executing, because of drawing layer undo
      this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoQuery(this.rDocShell, nTab, rQueryParam, pUndoDoc, aRowState, pUndoDB, pOld, pAdvSource));
    }

    if (bCopy) {
      // memorize new DB range
      let nEndX = aLocalParam.nCol2;
      let nEndY = aLocalParam.nRow2;
      if (pDestData) {
        if (aOldDest.aEnd.Col() > nEndX) nEndX = aOldDest.aEnd.Col();
        if (aOldDest.aEnd.Row() > nEndY) nEndY = aOldDest.aEnd.Row();
      }
      this.rDocShell.PostPaint(new ScRange(aLocalParam.nCol1, aLocalParam.nRow1, nDestTab, nEndX, nEndY, nDestTab), PaintPartFlags.Grid);
    } else this.rDocShell.PostPaint(new ScRange(0, rQueryParam.nRow1, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab), PaintPartFlags.Grid | PaintPartFlags.Left);
    aModificator.SetDocumentModified();

    return true;
  }

  /** Define a database range (Data - Define Range's Add). */
  AddDBRange(rName: string, rRange: ScRange): boolean {
    const aModificator = new ScDocShellModificator(this.rDocShell);

    const rDoc = this.rDocShell.GetDocument();
    const pDocColl = rDoc.GetDBCollection();
    const bUndo = rDoc.IsUndoEnabled();

    const pUndoColl = bUndo ? pDocColl.clone() : null;

    const pNew = new ScDBData(rName, rRange.aStart.Tab(), rRange.aStart.Col(), rRange.aStart.Row(), rRange.aEnd.Col(), rRange.aEnd.Row());

    let bOk: boolean;
    if (rName === STR_DB_LOCAL_NONAME) {
      rDoc.SetAnonymousDBData(rRange.aStart.Tab(), pNew);
      bOk = true;
    } else bOk = pDocColl.getNamedDBs().insert(pNew);

    if (!bOk) return false;

    if (pUndoColl) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDBData(this.rDocShell, pUndoColl, pDocColl.clone()));

    aModificator.SetDocumentModified();
    return true;
  }

  DeleteDBRange(rName: string): boolean {
    let bDone = false;
    const rDoc = this.rDocShell.GetDocument();
    const pDocColl = rDoc.GetDBCollection();
    const bUndo = rDoc.IsUndoEnabled();

    const rDBs = pDocColl.getNamedDBs();
    const iter = rDBs.findByUpperName(rName.toUpperCase());
    if (iter) {
      const aModificator = new ScDocShellModificator(this.rDocShell);

      const pUndoColl = bUndo ? pDocColl.clone() : null;

      if (iter.HasAutoFilter()) {
        // (the AutoFilter buttons go with the range, as SetDBCollection's bRemoveAutoFilter does)
        const r = iter.GetAreaVars();
        rDoc.RemoveFlagsTab(r.nCol1, r.nRow1, r.nCol2, r.nRow1, r.nTab, ScMF.Auto);
      }
      rDBs.erase(iter);

      if (pUndoColl) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDBData(this.rDocShell, pUndoColl, pDocColl.clone()));

      aModificator.SetDocumentModified();
      bDone = true;
    }

    return bDone;
  }

  RenameDBRange(rOld: string, rNew: string): boolean {
    let bDone = false;
    const rDoc = this.rDocShell.GetDocument();
    const pDocColl = rDoc.GetDBCollection();
    const bUndo = rDoc.IsUndoEnabled();
    const rDBs = pDocColl.getNamedDBs();
    const iterOld = rDBs.findByUpperName(rOld.toUpperCase());
    const pNew = rDBs.findByUpperName(rNew.toUpperCase());
    if (iterOld && !pNew) {
      const aModificator = new ScDocShellModificator(this.rDocShell);

      const pNewData = new ScDBData(rNew, iterOld);

      const pUndoColl = pDocColl.clone();

      rDBs.erase(iterOld);
      const bInserted = rDBs.insert(pNewData);
      if (!bInserted) {
        // error -> restore old state
        rDoc.SetDBCollection(pUndoColl); // belongs to the document then
      }

      if (bInserted) {
        // insertion worked
        if (bUndo) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDBData(this.rDocShell, pUndoColl, pDocColl.clone()));

        aModificator.SetDocumentModified();
        bDone = true;
      }
    }

    return bDone;
  }

  ModifyDBData(rNewData: ScDBData): void {
    const rDoc = this.rDocShell.GetDocument();
    const pDocColl = rDoc.GetDBCollection();
    const bUndo = rDoc.IsUndoEnabled();

    let pData: ScDBData | null = null;
    if (rNewData.GetName() === STR_DB_LOCAL_NONAME) {
      const aRange = rNewData.GetArea();
      const nTab = aRange.aStart.Tab();
      pData = rDoc.GetAnonymousDBData(nTab);
    } else pData = pDocColl.getNamedDBs().findByUpperName(rNewData.GetUpperName());

    if (!pData) return;

    const aModificator = new ScDocShellModificator(this.rDocShell);

    const pUndoColl = bUndo ? pDocColl.clone() : null;

    pData.assign(rNewData);

    if (pUndoColl) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoDBData(this.rDocShell, pUndoColl, pDocColl.clone()));

    aModificator.SetDocumentModified();
  }

  /** Data - Subtotals (DoSubTotals): the old subtotal rows removed (bReplace), the range sorted by
      the groups (bDoSort), the subtotal rows inserted. Reduced: the outline groups are not made
      (outlines are not ported); the "delete data?" question for subtotals with data beside them
      is answered yes. */
  DoSubTotals(nTab: SCTAB, rParam: ScSubTotalParam, bRecord: boolean, bApi: boolean): void {
    const bDo = !rParam.bRemoveOnly; // sal_False = only delete

    const rDoc = this.rDocShell.GetDocument();
    if (bRecord && !rDoc.IsUndoEnabled()) bRecord = false;
    const pDBData = rDoc.GetDBAtArea(nTab, rParam.nCol1, rParam.nRow1, rParam.nCol2, rParam.nRow2);
    if (!pDBData) {
      // SubTotals: no DBData
      return;
    }

    if (rDoc.HasAttrib(rParam.nCol1, rParam.nRow1 + 1, nTab, rParam.nCol2, rParam.nRow2, nTab, HasAttrFlags.Merged | HasAttrFlags.Overlapped)) {
      if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_INSERTCELLS_0); // don't insert into merged
      return;
    }

    const aModificator = new ScDocShellModificator(this.rDocShell);

    const aNewParam = new ScSubTotalParam(rParam); // end of range is being changed
    let pUndoDoc: ScDocument | null = null;
    let aRowState: ReturnType<ScDocument['GetRowFilterState']> = null;
    let pUndoDB = null;

    if (bRecord) {
      // secure old data
      pUndoDoc = new ScDocument(ScDocumentMode.SCDOCMODE_UNDO);
      pUndoDoc.InitUndo(rDoc, nTab, nTab, false, true);
      rDoc.CopyToDocument(new ScRange(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab), InsertDeleteFlags.ALL, false, pUndoDoc);
      aRowState = rDoc.GetRowFilterState(nTab);
      const pDocDB = rDoc.GetDBCollection();
      if (!pDocDB.empty()) pUndoDB = pDocDB.clone();
    }

    if (rParam.bReplace) rDoc.RemoveSubTotals(nTab, aNewParam);
    let bSuccess = true;
    if (bDo) {
      // sort
      if (rParam.bDoSort) {
        pDBData.SetArea(nTab, aNewParam.nCol1, aNewParam.nRow1, aNewParam.nCol2, aNewParam.nRow2);

        //  set partial result field to before the sorting
        //  (Duplicates are omitted, so can be called again)
        const aOldSort = pDBData.GetSortParam();
        const aSortParam = SortParamOfSubTotal(aNewParam, aOldSort);
        this.Sort(nTab, aSortParam, false, false, bApi);
      }

      bSuccess = rDoc.DoSubTotals(nTab, aNewParam);
    }
    const aDirtyRange = new ScRange(aNewParam.nCol1, aNewParam.nRow1, nTab, aNewParam.nCol2, aNewParam.nRow2, nTab);
    rDoc.SetDirty(aDirtyRange, true);

    if (bRecord && pUndoDoc) this.rDocShell.GetUndoManager().AddUndoAction(new ScUndoSubTotals(this.rDocShell, nTab, rParam, pUndoDoc, aRowState, pUndoDB));

    if (!bSuccess) {
      // "Cannot insert rows"
      if (!bApi) this.rDocShell.ErrorMessage(STR_MSSG_DOSUBTOTALS_2);
    }

    // memorize
    pDBData.SetSubTotalParam(aNewParam);
    pDBData.SetArea(nTab, aNewParam.nCol1, aNewParam.nRow1, aNewParam.nCol2, aNewParam.nRow2);

    this.rDocShell.PostPaint(new ScRange(0, 0, nTab, rDoc.MaxCol(), rDoc.MaxRow(), nTab), PaintPartFlags.Grid | PaintPartFlags.Left | PaintPartFlags.Top | PaintPartFlags.Size);
    aModificator.SetDocumentModified();
  }
}

/** The sort of the subtotals' groups, then the old sort keys (ScSortParam( const ScSubTotalParam&,
    const ScSortParam& )). */
function SortParamOfSubTotal(rSub: ScSubTotalParam, rOld: ScSortParam): ScSortParam {
  const p = new ScSortParam(rOld);
  p.nCol1 = rSub.nCol1; p.nRow1 = rSub.nRow1; p.nCol2 = rSub.nCol2; p.nRow2 = rSub.nRow2;
  p.nSourceTab = 0;
  p.nUserIndex = rSub.nUserIndex;
  p.bHasHeader = true; p.bByRow = true; p.bCaseSens = rSub.bCaseSens;
  p.bUserDef = rSub.bUserDef;
  p.bInplace = true;
  p.nDestTab = 0; p.nDestCol = 0; p.nDestRow = 0;
  p.aDataAreaExtras.mbCellFormats = rSub.bIncludePattern;
  p.aDataAreaExtras.resetArea();
  p.maKeyState = [];
  //  first the groups from the partial results
  if (rSub.bDoSort)
    for (const g of rSub.aGroups)
      if (g.bActive) p.maKeyState.push({ nField: g.nField, bAscending: rSub.bAscending, bDoSort: true, aColorSortMode: ScColorSortMode.None, aColorSortColor: null });
  //  then the old settings behind them
  for (const k of rOld.maKeyState) {
    if (!k.bDoSort) continue;
    // do not enter a field twice
    if (p.maKeyState.some((x) => x.nField === k.nField)) continue;
    p.maKeyState.push({ nField: k.nField, bAscending: k.bAscending, bDoSort: true, aColorSortMode: ScColorSortMode.None, aColorSortColor: null });
  }
  while (p.maKeyState.length < 3) p.maKeyState.push({ nField: 0, bAscending: true, bDoSort: false, aColorSortMode: ScColorSortMode.None, aColorSortColor: null });
  return p;
}
