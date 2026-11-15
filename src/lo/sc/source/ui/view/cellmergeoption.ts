// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/cellmergeoption.hxx faithful
// @upstream sc/source/ui/view/cellmergeoption.cxx faithful
// ScCellMergeOption: the block to merge or unmerge and the sheets it applies to. maTabs is a
// std::set upstream: iterate it with tabs() for the sorted order.
import { ScRange, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';

export class ScCellMergeOption {
  maTabs = new Set<SCTAB>();
  mnStartCol: SCCOL;
  mnStartRow: SCROW;
  mnEndCol: SCCOL;
  mnEndRow: SCROW;
  mbCenter: boolean;

  /** ScCellMergeOption(rRange) or ScCellMergeOption(nStartCol, nStartRow, nEndCol, nEndRow, bCenter). */
  constructor(nStartCol: SCCOL | ScRange, nStartRow?: SCROW, nEndCol?: SCCOL, nEndRow?: SCROW, bCenter = false) {
    if (nStartCol instanceof ScRange) {
      const rRange = nStartCol;
      this.mnStartCol = rRange.aStart.Col();
      this.mnStartRow = rRange.aStart.Row();
      this.mnEndCol = rRange.aEnd.Col();
      this.mnEndRow = rRange.aEnd.Row();
      this.mbCenter = false;
      const nTab1 = rRange.aStart.Tab();
      const nTab2 = rRange.aEnd.Tab();
      for (let i = nTab1; i <= nTab2; ++i) this.maTabs.add(i);
      return;
    }
    this.mnStartCol = nStartCol;
    this.mnStartRow = nStartRow!;
    this.mnEndCol = nEndCol!;
    this.mnEndRow = nEndRow!;
    this.mbCenter = bCenter;
  }

  clone(): ScCellMergeOption {
    const r = new ScCellMergeOption(this.mnStartCol, this.mnStartRow, this.mnEndCol, this.mnEndRow, this.mbCenter);
    r.maTabs = new Set(this.maTabs);
    return r;
  }

  /** The sheets in ascending order (iterating the std::set). */
  tabs(): SCTAB[] { return [...this.maTabs].sort((a, b) => a - b); }

  getSingleRange(nTab: SCTAB): ScRange {
    return new ScRange(this.mnStartCol, this.mnStartRow, nTab, this.mnEndCol, this.mnEndRow, nTab);
  }

  getFirstSingleRange(): ScRange {
    let nTab = 0;
    if (this.maTabs.size) nTab = this.tabs()[0]!;
    return this.getSingleRange(nTab);
  }
}
