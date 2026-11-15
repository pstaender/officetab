// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/fillinfo.hxx reduced
// The per-cell information ScDocument::FillInfo collects for the output (ScOutputData): for each
// visible row (RowInfo) and column the cell, its pattern, background, borders and merge flags,
// and the column widths and row heights in output units (pixels on screen). Kept apart from
// upstream: the conditional formatting results (condition sets, colour scales, data bars, icon
// sets), shadows, rotation and the pivot table buttons are left out. ScBasicCellInfo is kept only
// for the columns FillInfo was asked for and one column on each side (upstream keeps it from
// column 0); the output asks the document for columns further left.
import type { SCCOL, SCROW, SCSIZE } from './address.ts';
import { ScRefCellValue } from './cellvalue.ts';
import type { ScPatternAttr } from './patattr.ts';
import type { SvxBorderLine, SvxBoxItem } from './scitems.ts';

/** ScClipMark: the cell's text is clipped at its left or right (the red clip mark triangles). */
export const ScClipMark = { NONE: 0x00, Left: 0x01, Right: 0x02, Bottom: 0x03, Top: 0x04 } as const;
export type ScClipMark = number;

// Keeping all the info in ScCellInfo could lead to allocation and initialization
// of MiB's of memory, so split the info needed for all cells to a smaller structure.
export class ScBasicCellInfo {
  nWidth = 0;
  bEmptyCellText = true;
  /** view-internal */
  bEditEngine = false;
}

export class ScCellInfo {
  maCell = new ScRefCellValue();

  pPatternAttr: ScPatternAttr | null = null;

  /** The background colour (SvxBrushItem), null for transparent. */
  maBackground: string | null = null;

  /** original item from document. */
  pLinesAttr: SvxBoxItem | null = null;
  mpTLBRLine: SvxBorderLine | null = null;
  mpBLTRLine: SvxBorderLine | null = null;

  nClipMark: ScClipMark = ScClipMark.NONE;

  bMerged = false;
  bHOverlapped = false;
  bVOverlapped = false;
  bAutoFilter = false;
  bFilterActive = false;
  /** when required (pagebreak mode) */
  bPrinted = false;
  /** output-internal */
  bHideGrid = false;

  getPatternAttr(): ScPatternAttr | null { return this.pPatternAttr; }
}

export const SC_ROTMAX_NONE = 0x7fff;

export class RowInfo {
  nHeight = 0;
  nRowNo: SCROW = 0;
  nRotMaxCol: SCCOL = SC_ROTMAX_NONE;

  bEmptyBack = true;
  bAutoFilter = false;
  bPivotButton = false;
  /** TRUE, if not tested */
  bChanged = true;
  bPivotToggle = false;

  // This class allocates ScCellInfo with also one item extra before and after.
  private pCellInfo: ScCellInfo[] = [];
  private pBasicCellInfo: ScBasicCellInfo[] = [];
  private nStartCol: SCCOL = 0;

  cellInfo(nCol: SCCOL): ScCellInfo {
    return this.pCellInfo[nCol - this.nStartCol + 1]!;
  }

  basicCellInfo(nCol: SCCOL): ScBasicCellInfo {
    return this.pBasicCellInfo[nCol - this.nStartCol + 1]!;
  }

  /** Whether basicCellInfo has the column (it has nStartCol-1 … endCol+1). */
  hasBasicCellInfo(nCol: SCCOL): boolean {
    const i = nCol - this.nStartCol + 1;
    return i >= 0 && i < this.pBasicCellInfo.length;
  }

  allocCellInfo(startCol: SCCOL, endCol: SCCOL): void {
    this.nStartCol = startCol;
    const n = endCol - this.nStartCol + 1 + 2;
    this.pCellInfo = Array.from({ length: n }, () => new ScCellInfo());
    this.pBasicCellInfo = Array.from({ length: n }, () => new ScBasicCellInfo());
  }
}

export class ScTableInfo {
  mpRowInfo: RowInfo[];
  mnArrCount: SCSIZE = 0;
  mnArrCapacity: SCSIZE;
  mbPageMode = false;

  constructor(nStartRow: SCROW, nEndRow: SCROW, _bHintOnly = false) {
    // capacity: the rows plus one before and two after
    this.mnArrCapacity = nEndRow - nStartRow + 4;
    this.mpRowInfo = Array.from({ length: this.mnArrCapacity }, () => new RowInfo());
  }
}
