// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/data/fillinfo.cxx reduced
// ScDocument::FillInfo: collects what the output paints of a block of cells (ScTableInfo):
// the visible rows with their heights, the column widths, and per cell its content, pattern,
// background, borders and merge flags, with merged cells' backgrounds taken from their origin.
// Reduced: conditional formats, cell style previews, shadows, rotated text (FindMaxRotCol) and
// the frame border array (svx::frame::Array, which the reduced DrawFrame does not use) are left
// out; ScBasicCellInfo is filled for the requested columns and one on each side only.
import type { SCCOL, SCROW, SCTAB } from '../../../inc/address.ts';
import { ScRefCellValue, CELLTYPE_FORMULA } from '../../../inc/cellvalue.ts';
import { STD_COL_WIDTH } from '../../../inc/global.ts';
import type { ScMarkData } from '../../../inc/markdata.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { type RowInfo, type ScTableInfo } from '../../../inc/fillinfo.ts';
import type { ScDocument } from './document.ts';

// Similar as in output.cxx

function lcl_GetMergeRange(nX: SCCOL, nY: SCROW, nArrY: number, pDoc: ScDocument, pRowInfo: RowInfo[], nX1: SCCOL, nY1: SCROW, nTab: SCTAB): { rStartX: SCCOL; rStartY: SCROW; rEndX: SCCOL; rEndY: SCROW } {
  const pInfo = pRowInfo[nArrY]!.cellInfo(nX);

  let rStartX = nX;
  let rStartY = nY;
  let bHOver = pInfo.bHOverlapped;
  let bVOver = pInfo.bVOverlapped;

  while (bHOver) {
    // nY constant
    --rStartX;
    if (rStartX >= nX1 && !pDoc.ColHidden(rStartX, nTab)) {
      bHOver = pRowInfo[nArrY]!.cellInfo(rStartX).bHOverlapped;
      bVOver = pRowInfo[nArrY]!.cellInfo(rStartX).bVOverlapped;
    } else {
      const nOverlap = pDoc.GetPattern(rStartX, rStartY, nTab).GetItem('ATTR_MERGE_FLAG');
      bHOver = (nOverlap & ScMF.Hor) !== 0;
      bVOver = (nOverlap & ScMF.Ver) !== 0;
    }
  }

  while (bVOver) {
    --rStartY;

    if (nArrY > 0) --nArrY; // local copy !

    if (rStartX >= nX1 && rStartY >= nY1 && !pDoc.ColHidden(rStartX, nTab) && !pDoc.RowHidden(rStartY, nTab) && pRowInfo[nArrY]!.nRowNo === rStartY) {
      bVOver = pRowInfo[nArrY]!.cellInfo(rStartX).bVOverlapped;
    } else {
      const nOverlap = pDoc.GetPattern(rStartX, rStartY, nTab).GetItem('ATTR_MERGE_FLAG');
      bVOver = (nOverlap & ScMF.Ver) !== 0;
    }
  }

  let pMerge;
  if (rStartX >= nX1 && rStartY >= nY1 && !pDoc.ColHidden(rStartX, nTab) && !pDoc.RowHidden(rStartY, nTab) && pRowInfo[nArrY]!.nRowNo === rStartY && pRowInfo[nArrY]!.cellInfo(rStartX).getPatternAttr()) {
    pMerge = pRowInfo[nArrY]!.cellInfo(rStartX).getPatternAttr()!.GetItem('ATTR_MERGE');
  } else pMerge = pDoc.GetPattern(rStartX, rStartY, nTab).GetItem('ATTR_MERGE');

  return { rStartX, rStartY, rEndX: rStartX + Math.max(pMerge.nColMerge, 1) - 1, rEndY: rStartY + Math.max(pMerge.nRowMerge, 1) - 1 };
}

/** initRowInfo: the visible rows (and one before and after) with their heights in output units. */
function initRowInfo(pDoc: ScDocument, pRowInfo: RowInfo[], nMaxRow: number, fRowScale: number, nRow1: SCROW, nTab: SCTAB, rYExtra: { v: SCROW }, rRow2: { v: SCROW }): number {
  let rArrRow = 0;
  let nDocHeight = 255;
  let nDocHeightEndRow = -1;
  for (let nSignedY = nRow1 - 1; nSignedY <= rYExtra.v; nSignedY++) {
    let nY: SCROW;
    if (nSignedY >= 0) nY = nSignedY;
    else nY = pDoc.MaxRow() + 1; // invalid

    if (nY > nDocHeightEndRow) {
      if (pDoc.ValidRow(nY)) {
        const r = pDoc.GetRowHeightRun(nY, nTab);
        nDocHeight = r.nHeight;
        nDocHeightEndRow = r.nEndRow;
      } else nDocHeight = 255;
    }

    if (rArrRow === 0 || nDocHeight || nY > pDoc.MaxRow()) {
      const pThisRowInfo = pRowInfo[rArrRow]!;

      const nHeight = Math.trunc(Math.min(Math.max(nDocHeight * fRowScale, 1.0), 65535));

      pThisRowInfo.nRowNo = nY; //TODO: case < 0 ?
      pThisRowInfo.nHeight = nHeight;
      pThisRowInfo.bEmptyBack = true;
      pThisRowInfo.bChanged = true;
      pThisRowInfo.bAutoFilter = false;
      pThisRowInfo.bPivotButton = false;
      pThisRowInfo.bPivotToggle = false;

      ++rArrRow;
      if (rArrRow >= nMaxRow) {
        // FillInfo: Range too big
        rYExtra.v = nSignedY; // End
        rRow2.v = rYExtra.v - 1; // Adjust range
      }
    } else if (nSignedY === rYExtra.v) {
      // hidden additional line?
      ++rYExtra.v;
    }
  }
  return rArrRow;
}

export function FillInfo(
  rDoc: ScDocument, rTabInfo: ScTableInfo, nCol1: SCCOL, nRow1: SCROW, nCol2: SCCOL, nRow2: SCROW,
  nTab: SCTAB, fColScale: number, fRowScale: number, bPageMode: boolean, bFormulaMode: boolean,
  pMarkData: ScMarkData | null = null,
): void {
  void pMarkData;
  const pRowInfo = rTabInfo.mpRowInfo;
  const pTable = rDoc.FetchTable(nTab);
  if (!pTable) return;

  let bAnyMerged = false;

  const bTabProtect = rDoc.IsTabProtected(nTab);

  // first only the entries for the entire column

  const nYExtra = { v: nRow2 + 1 };
  const rRow2 = { v: nRow2 };
  let nArrCount = initRowInfo(rDoc, pRowInfo, rTabInfo.mnArrCapacity, fRowScale, nRow1, nTab, nYExtra, rRow2); // incl. Dummys
  nRow2 = rRow2.v;

  //  Allocate cell information
  for (let nArrRow = 0; nArrRow < nArrCount; ++nArrRow) pRowInfo[nArrRow]!.allocCellInfo(nCol1, nCol2 + 1);

  for (let nCol = nCol1 - 1; nCol <= nCol2 + 1; nCol++) {
    // collect info for the columns and left & right + 1
    if (rDoc.ValidCol(nCol)) {
      // #i58049#, #i57939# Hidden columns must be skipped here, or their attributes
      // will disturb the output
      const bColHidden = rDoc.ColHidden(nCol, nTab);
      if (!bColHidden) {
        const nColWidth = rDoc.GetColWidth(nCol, nTab, false);
        const nThisWidth = Math.trunc(Math.min(Math.max(nColWidth * fColScale, 1.0), 65535));

        pRowInfo[0]!.basicCellInfo(nCol).nWidth = nThisWidth; //TODO: this should be enough

        const pThisCol = pTable.FetchColumn(nCol);
        if (pThisCol) {
          // Iterate between rows nY1 and nY2 and pick up non-empty
          // cells that are not hidden.
          let nArrRow = 1;
          pThisCol.ForEachCell(nRow1, nRow2, (nRow, p) => {
            if (rDoc.RowHidden(nRow, nTab)) return;
            while (pRowInfo[nArrRow]!.nRowNo < nRow) ++nArrRow;
            const rThisRowInfo = pRowInfo[nArrRow]!;
            rThisRowInfo.cellInfo(nCol).maCell = new ScRefCellValue(p);
            rThisRowInfo.basicCellInfo(nCol).bEmptyCellText = false;
            ++nArrRow;
          });
        }

        // Attribute/Blockmark from nX1-1
        let nArrRow = 0;

        let nCurRow = nRow1; // single rows
        if (nCurRow > 0) --nCurRow; // 1 more on top
        else nArrRow = 1;

        while (nArrRow < nArrCount && nCurRow <= nYExtra.v) {
          const pPattern: ScPatternAttr = rDoc.GetPattern(nCol, nCurRow, nTab);
          const bRowHidden = rDoc.RowHidden(nCurRow, nTab);
          if (nArrRow === 0 || !bRowHidden) {
            const pBackground = pPattern.GetItem('ATTR_BACKGROUND');
            const pLinesAttr = pPattern.GetItem('ATTR_BORDER');
            const pTLBRLine = pPattern.GetItem('ATTR_BORDER_TLBR');
            const pBLTRLine = pPattern.GetItem('ATTR_BORDER_BLTR');
            const pMergeAttr = pPattern.GetItem('ATTR_MERGE');
            const bMerged = pMergeAttr.nColMerge > 1 || pMergeAttr.nRowMerge > 1;
            const nOverlap = pPattern.GetItem('ATTR_MERGE_FLAG');
            const bHOverlapped = (nOverlap & ScMF.Hor) !== 0;
            const bVOverlapped = (nOverlap & ScMF.Ver) !== 0;
            const bAutoFilter = (nOverlap & ScMF.Auto) !== 0;
            const bFilterActive = (nOverlap & ScMF.HiddenMember) !== 0;
            if (bMerged || bHOverlapped || bVOverlapped) bAnyMerged = true; // internal

            let bHidden: boolean, bHideFormula: boolean;
            if (bTabProtect) {
              const rProtAttr = pPattern.GetItem('ATTR_PROTECTION');
              bHidden = rProtAttr.bHideCell;
              bHideFormula = rProtAttr.bHideFormula;
            } else bHidden = bHideFormula = false;

            const pThisRowInfo = pRowInfo[nArrRow]!;
            if (pBackground) pThisRowInfo.bEmptyBack = false; // Column background == Default ?
            if (bAutoFilter) pThisRowInfo.bAutoFilter = true;

            const pInfo = pThisRowInfo.cellInfo(nCol);
            const pBasicInfo = pThisRowInfo.basicCellInfo(nCol);
            pInfo.maBackground = pBackground;
            pInfo.pPatternAttr = pPattern;
            pInfo.bMerged = bMerged;
            pInfo.bHOverlapped = bHOverlapped;
            pInfo.bVOverlapped = bVOverlapped;
            pInfo.bAutoFilter = bAutoFilter;
            pInfo.bFilterActive = bFilterActive;
            pInfo.pLinesAttr = pLinesAttr;
            pInfo.mpTLBRLine = pTLBRLine;
            pInfo.mpBLTRLine = pBLTRLine;
            // nWidth is no longer set individually

            if (bHidden || (bFormulaMode && bHideFormula && pInfo.maCell.getType() === CELLTYPE_FORMULA)) pBasicInfo.bEmptyCellText = true;

            ++nArrRow;
          }
          ++nCurRow;
        }
      } else {
        // a hidden column: width 0, no content
        for (let nArrRow = 0; nArrRow < nArrCount; nArrRow++) pRowInfo[nArrRow]!.basicCellInfo(nCol).nWidth = 0;
      }
    } else pRowInfo[0]!.basicCellInfo(nCol).nWidth = STD_COL_WIDTH;
    // STD_COL_WIDTH farthest to the left and right is needed for DrawExtraShadow
  }

  //      Adjust data from merged cells

  if (bAnyMerged) {
    for (let nArrRow = 0; nArrRow < nArrCount; nArrRow++) {
      const pThisRowInfo = pRowInfo[nArrRow]!;
      const nSignedY = nArrRow ? pThisRowInfo.nRowNo : nRow1 - 1;

      for (let nCol = nCol1 - 1; nCol <= nCol2 + 1; nCol++) {
        // 1 more left and right
        const pInfo = pThisRowInfo.cellInfo(nCol);

        if (pInfo.bMerged || pInfo.bHOverlapped || pInfo.bVOverlapped) {
          const { rStartX: nStartX, rStartY: nStartY } = lcl_GetMergeRange(nCol, nSignedY, nArrRow, rDoc, pRowInfo, nCol1, nRow1, nTab);
          const pStartPattern = rDoc.GetPattern(nStartX, nStartY, nTab);

          // Copy Background (or in output.cxx)
          pInfo.maBackground = pStartPattern.GetItem('ATTR_BACKGROUND');
          pRowInfo[nArrRow]!.bEmptyBack = false;
        }
      }
    }
  }

  rTabInfo.mnArrCount = nArrCount;
  rTabInfo.mbPageMode = bPageMode;
  nArrCount = 0;
}
