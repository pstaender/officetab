// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/refupdatecontext.hxx reduced
// @upstream sc/source/core/data/refupdatecontext.cxx reduced
// The contexts of a reference update (insert/delete cells, move, sheets) and its result. The
// updated range names and the column/row reorder maps are left out.
import { ScRange, type SCCOL, type SCROW, type SCTAB } from './address.ts';
import type { ScDocument } from '../source/core/data/document.ts';

/** UpdateRefMode (global.hxx) */
export const UpdateRefMode = { URM_INSDEL: 0, URM_COPY: 1, URM_MOVE: 2, URM_REORDER: 3 } as const;
export type UpdateRefMode = (typeof UpdateRefMode)[keyof typeof UpdateRefMode];

/** Context for reference update during shifting, moving or copying of cell ranges. */
export class RefUpdateContext {
  mrDoc: ScDocument;
  /** update mode - insert/delete, copy, or move. The reorder mode (which corresponds with the
      reordering of sort results) is not used with this context. */
  meMode: UpdateRefMode = UpdateRefMode.URM_INSDEL;
  /** Whether this context is used in transposed cut-paste. */
  mbTransposed = false;
  /** Range of cells that are about to be moved for insert/delete/move modes. For copy mode, it's
      the destination range of cells that are about to be pasted. When moving a range of cells,
      it's the destination range, not the source range. */
  maRange = new ScRange();
  /** Amount and direction of movement in the column direction. */
  mnColDelta: SCCOL = 0;
  /** Amount and direction of movement in the row direction. */
  mnRowDelta: SCROW = 0;
  /** Amount and direction of movement in the sheet direction. */
  mnTabDelta: SCTAB = 0;

  constructor(rDoc: ScDocument) { this.mrDoc = rDoc; }

  isInserted(): boolean { return this.meMode === UpdateRefMode.URM_INSDEL && (this.mnColDelta > 0 || this.mnRowDelta > 0 || this.mnTabDelta > 0); }
  isDeleted(): boolean { return this.meMode === UpdateRefMode.URM_INSDEL && (this.mnColDelta < 0 || this.mnRowDelta < 0 || this.mnTabDelta < 0); }
}

export class RefUpdateResult {
  /** When this flag is true, the result of the formula needs to be re-calculated either because
      it contains a reference that's been deleted, or the size of a range reference has changed. */
  mbValueChanged = false;
  /** This flag indicates whether any reference in the token array has been modified. */
  mbReferenceModified = false;
  /** When this flag is true, it indicates that the token array contains a range name that's been
      updated. */
  mbNameModified = false;
  mnTab: SCTAB = -1;
}

export class RefUpdateInsertTabContext {
  mrDoc: ScDocument;
  mnInsertPos: SCTAB;
  mnSheets: SCTAB;
  constructor(rDoc: ScDocument, nInsertPos: SCTAB, nSheets: SCTAB) {
    this.mrDoc = rDoc;
    this.mnInsertPos = nInsertPos;
    this.mnSheets = nSheets;
  }
}

export class RefUpdateDeleteTabContext {
  mrDoc: ScDocument;
  mnDeletePos: SCTAB;
  mnSheets: SCTAB;
  constructor(rDoc: ScDocument, nDeletePos: SCTAB, nSheets: SCTAB) {
    this.mrDoc = rDoc;
    this.mnDeletePos = nDeletePos;
    this.mnSheets = nSheets;
  }
}

export class RefUpdateMoveTabContext {
  mrDoc: ScDocument;
  mnOldPos: SCTAB;
  mnNewPos: SCTAB;
  constructor(rDoc: ScDocument, nOldPos: SCTAB, nNewPos: SCTAB) {
    this.mrDoc = rDoc;
    this.mnOldPos = nOldPos;
    this.mnNewPos = nNewPos;
  }

  getNewTab(nOldTab: SCTAB): SCTAB {
    // Sheets below the lower bound or above the upper bound will not change.
    const nLowerBound = Math.min(this.mnOldPos, this.mnNewPos);
    const nUpperBound = Math.max(this.mnOldPos, this.mnNewPos);
    if (nOldTab < nLowerBound || nUpperBound < nOldTab) return nOldTab; // Outside the boundary. Nothing to adjust.
    if (nOldTab === this.mnOldPos) return this.mnNewPos;
    // It's somewhere in between.
    if (this.mnOldPos < this.mnNewPos) {
      // Moving a sheet to the right. The rest of the sheets shifts to the left.
      return nOldTab - 1;
    }
    // Moving a sheet to the left. The rest of the sheets shifts to the right.
    return nOldTab + 1;
  }
}
