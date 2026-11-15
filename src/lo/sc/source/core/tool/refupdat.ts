// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/refupdat.hxx partial
// @upstream sc/source/core/tool/refupdat.cxx partial
// ScRefUpdate::Update for a range given as coordinates (the database ranges' update on inserted,
// deleted and moved cells). Left out: the copy and reorder modes, the token reference updates (done by
// ScTokenArray here), DoTranspose and the reorder helpers.
import type { SCCOL, SCROW, SCTAB } from '../../../inc/address.ts';
import { UpdateRefMode } from '../../../inc/refupdatecontext.ts';
import type { ScDocument } from '../data/document.ts';

export const ScRefUpdateRes = { UR_NOTHING: 0, UR_UPDATED: 1, UR_INVALID: 2, UR_STICKY: 3 } as const;
export type ScRefUpdateRes = (typeof ScRefUpdateRes)[keyof typeof ScRefUpdateRes];
const { UR_NOTHING, UR_UPDATED, UR_INVALID, UR_STICKY } = ScRefUpdateRes;

function lcl_MoveStart(rRef: number, nStart: number, nDelta: number, nMask: number, bShrink = true): { r: number; bCut: boolean } {
  let bCut = false;
  if (rRef >= nStart) rRef = rRef + nDelta;
  else if (nDelta < 0 && bShrink && rRef >= nStart + nDelta) rRef = nStart + nDelta; //TODO: limit ???
  if (rRef < 0) {
    rRef = 0;
    bCut = true;
  } else if (rRef > nMask) {
    rRef = nMask;
    bCut = true;
  }
  return { r: rRef, bCut };
}

function lcl_MoveEnd(rRef: number, nStart: number, nDelta: number, nMask: number, bShrink = true): { r: number; bCut: boolean } {
  let bCut = false;
  if (rRef >= nStart) rRef = rRef + nDelta;
  else if (nDelta < 0 && bShrink && rRef >= nStart + nDelta) rRef = nStart + nDelta - 1; //TODO: limit ???
  if (rRef < 0) {
    rRef = 0;
    bCut = true;
  } else if (rRef > nMask) {
    rRef = nMask;
    bCut = true;
  }
  return { r: rRef, bCut };
}

function lcl_MoveItCut(rRef: number, nDelta: number, nMask: number): { r: number; bCut: boolean } {
  let bCut = false;
  rRef = rRef + nDelta;
  if (rRef < 0) {
    rRef = 0;
    bCut = true;
  } else if (rRef > nMask) {
    rRef = nMask;
    bCut = true;
  }
  return { r: rRef, bCut };
}

function IsExpand(n1: number, n2: number, nStart: number, nD: number): boolean {
  // before normal Move...
  return nD > 0 // Insert
    && n1 < n2 // at least two Cols/Rows/Tabs in Ref
    && ((nStart <= n1 && n1 < nStart + nD) // n1 within the Insert
      || n2 + 1 === nStart); // n2 directly before Insert
  // n1 < nStart <= n2 is expanded anyway!
}

function Expand(n1: number, n2: number, nStart: number, nD: number): [number, number] {
  // after normal Move..., only if IsExpand was true before!
  // first the End
  if (n2 + 1 === nStart) {
    // at End
    return [n1, n2 + nD];
  }
  // at the beginning
  return [n1 - nD, n2];
}

export interface RefCoords { theCol1: SCCOL; theRow1: SCROW; theTab1: SCTAB; theCol2: SCCOL; theRow2: SCROW; theTab2: SCTAB }

export const ScRefUpdate = {
  /** Update the range r (changed in place) for cells inserted, deleted or moved. */
  Update(rDoc: ScDocument, eUpdateRefMode: UpdateRefMode, nCol1: SCCOL, nRow1: SCROW, nTab1: SCTAB, nCol2: SCCOL, nRow2: SCROW, nTab2: SCTAB, nDx: SCCOL, nDy: SCROW, nDz: SCTAB, r: RefCoords): ScRefUpdateRes {
    let eRet: ScRefUpdateRes = UR_NOTHING;

    const oldCol1 = r.theCol1;
    const oldRow1 = r.theRow1;
    const oldTab1 = r.theTab1;
    const oldCol2 = r.theCol2;
    const oldRow2 = r.theRow2;
    const oldTab2 = r.theTab2;

    let bCut1: boolean, bCut2: boolean;

    if (eUpdateRefMode === UpdateRefMode.URM_INSDEL) {
      const bExpand = rDoc.IsExpandRefs();
      if (nDx && r.theRow1 >= nRow1 && r.theRow2 <= nRow2 && r.theTab1 >= nTab1 && r.theTab2 <= nTab2) {
        const bExp = bExpand && IsExpand(r.theCol1, r.theCol2, nCol1, nDx);
        ({ r: r.theCol1, bCut: bCut1 } = lcl_MoveStart(r.theCol1, nCol1, nDx, rDoc.MaxCol()));
        ({ r: r.theCol2, bCut: bCut2 } = lcl_MoveEnd(r.theCol2, nCol1, nDx, rDoc.MaxCol()));
        if (r.theCol2 < r.theCol1) {
          eRet = UR_INVALID;
          r.theCol2 = r.theCol1;
        } else if (bCut2 && r.theCol2 === 0) eRet = UR_INVALID;
        else if (bCut1 || bCut2) eRet = UR_UPDATED;
        if (bExp) {
          [r.theCol1, r.theCol2] = Expand(r.theCol1, r.theCol2, nCol1, nDx);
          eRet = UR_UPDATED;
        }
        if (eRet !== UR_NOTHING && oldCol1 === 0 && oldCol2 === rDoc.MaxCol()) {
          eRet = UR_STICKY;
          r.theCol1 = oldCol1;
          r.theCol2 = oldCol2;
        } else if (oldCol2 === rDoc.MaxCol() && oldCol1 < rDoc.MaxCol()) {
          // End was sticky, but start may have been moved. Only on range.
          r.theCol2 = oldCol2;
          if (eRet === UR_NOTHING) eRet = UR_STICKY;
        }
      }
      if (nDy && r.theCol1 >= nCol1 && r.theCol2 <= nCol2 && r.theTab1 >= nTab1 && r.theTab2 <= nTab2) {
        const bExp = bExpand && IsExpand(r.theRow1, r.theRow2, nRow1, nDy);
        ({ r: r.theRow1, bCut: bCut1 } = lcl_MoveStart(r.theRow1, nRow1, nDy, rDoc.MaxRow()));
        ({ r: r.theRow2, bCut: bCut2 } = lcl_MoveEnd(r.theRow2, nRow1, nDy, rDoc.MaxRow()));
        if (r.theRow2 < r.theRow1) {
          eRet = UR_INVALID;
          r.theRow2 = r.theRow1;
        } else if (bCut2 && r.theRow2 === 0) eRet = UR_INVALID;
        else if (bCut1 || bCut2) eRet = UR_UPDATED;
        if (bExp) {
          [r.theRow1, r.theRow2] = Expand(r.theRow1, r.theRow2, nRow1, nDy);
          eRet = UR_UPDATED;
        }
        if (eRet !== UR_NOTHING && oldRow1 === 0 && oldRow2 === rDoc.MaxRow()) {
          eRet = UR_STICKY;
          r.theRow1 = oldRow1;
          r.theRow2 = oldRow2;
        } else if (oldRow2 === rDoc.MaxRow() && oldRow1 < rDoc.MaxRow()) {
          // End was sticky, but start may have been moved. Only on range.
          r.theRow2 = oldRow2;
          if (eRet === UR_NOTHING) eRet = UR_STICKY;
        }
      }
      if (nDz && r.theCol1 >= nCol1 && r.theCol2 <= nCol2 && r.theRow1 >= nRow1 && r.theRow2 <= nRow2) {
        let nMaxTab = rDoc.GetTableCount() - 1;
        nMaxTab = nMaxTab + nDz; // adjust to new count
        const bExp = bExpand && IsExpand(r.theTab1, r.theTab2, nTab1, nDz);
        ({ r: r.theTab1, bCut: bCut1 } = lcl_MoveStart(r.theTab1, nTab1, nDz, nMaxTab, false /*bShrink*/));
        ({ r: r.theTab2, bCut: bCut2 } = lcl_MoveEnd(r.theTab2, nTab1, nDz, nMaxTab, false /*bShrink*/));
        if (r.theTab2 < r.theTab1) {
          eRet = UR_INVALID;
          r.theTab2 = r.theTab1;
        } else if (bCut1 || bCut2) eRet = UR_UPDATED;
        if (bExp) {
          [r.theTab1, r.theTab2] = Expand(r.theTab1, r.theTab2, nTab1, nDz);
          eRet = UR_UPDATED;
        }
      }
    } else if (eUpdateRefMode === UpdateRefMode.URM_MOVE) {
      if (r.theCol1 >= nCol1 - nDx && r.theRow1 >= nRow1 - nDy && r.theTab1 >= nTab1 - nDz && r.theCol2 <= nCol2 - nDx && r.theRow2 <= nRow2 - nDy && r.theTab2 <= nTab2 - nDz) {
        if (nDx) {
          ({ r: r.theCol1, bCut: bCut1 } = lcl_MoveItCut(r.theCol1, nDx, rDoc.MaxCol()));
          ({ r: r.theCol2, bCut: bCut2 } = lcl_MoveItCut(r.theCol2, nDx, rDoc.MaxCol()));
          if (bCut1 || bCut2) eRet = UR_UPDATED;
          if (eRet !== UR_NOTHING && oldCol1 === 0 && oldCol2 === rDoc.MaxCol()) {
            eRet = UR_STICKY;
            r.theCol1 = oldCol1;
            r.theCol2 = oldCol2;
          }
        }
        if (nDy) {
          ({ r: r.theRow1, bCut: bCut1 } = lcl_MoveItCut(r.theRow1, nDy, rDoc.MaxRow()));
          ({ r: r.theRow2, bCut: bCut2 } = lcl_MoveItCut(r.theRow2, nDy, rDoc.MaxRow()));
          if (bCut1 || bCut2) eRet = UR_UPDATED;
          if (eRet !== UR_NOTHING && oldRow1 === 0 && oldRow2 === rDoc.MaxRow()) {
            eRet = UR_STICKY;
            r.theRow1 = oldRow1;
            r.theRow2 = oldRow2;
          }
        }
        if (nDz) {
          const nMaxTab = rDoc.GetTableCount() - 1;
          ({ r: r.theTab1, bCut: bCut1 } = lcl_MoveItCut(r.theTab1, nDz, nMaxTab));
          ({ r: r.theTab2, bCut: bCut2 } = lcl_MoveItCut(r.theTab2, nDz, nMaxTab));
          if (bCut1 || bCut2) eRet = UR_UPDATED;
        }
      }
    }

    if (eRet === UR_NOTHING) {
      if (oldCol1 !== r.theCol1 || oldRow1 !== r.theRow1 || oldTab1 !== r.theTab1 || oldCol2 !== r.theCol2 || oldRow2 !== r.theRow2 || oldTab2 !== r.theTab2) eRet = UR_UPDATED;
    }
    return eRet;
  },
};
