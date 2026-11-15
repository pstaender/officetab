// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/subtotalparam.hxx faithful
// @upstream sc/source/core/data/subtotalparam.cxx partial
// ScSubTotalParam: the settings of Data - Subtotals (the groups, their columns and functions, and
// the options). Left out: SetSubtotals from the UNO SubTotalColumn sequence.
import type { SCCOL, SCROW } from './address.ts';
import type { ScSubTotalFunc } from './global.ts';

export const MAXSUBTOTAL = 3;

export class SubtotalGroup {
  bActive = false; ///< active groups
  nField: SCCOL = 0; ///< associated field
  nSubTotals: SCCOL = 0; ///< number of SubTotals
  /** array of columns to be calculated, and associated functions */
  pSubTotals: [SCCOL, ScSubTotalFunc][] = [];

  clone(): SubtotalGroup {
    const r = new SubtotalGroup();
    r.bActive = this.bActive;
    r.nField = this.nField;
    r.AllocSubTotals(this.nSubTotals);
    for (let i = 0; i < this.nSubTotals; i++) r.pSubTotals[i] = [this.pSubTotals[i]![0], this.pSubTotals[i]![1]];
    return r;
  }

  equals(r: SubtotalGroup): boolean {
    return this.bActive === r.bActive && this.nField === r.nField && this.nSubTotals === r.nSubTotals
      && (!this.nSubTotals || this.pSubTotals.every((p, i) => p[0] === r.pSubTotals[i]![0] && p[1] === r.pSubTotals[i]![1]));
  }

  AllocSubTotals(n: SCCOL): void {
    if (this.nSubTotals !== n) {
      this.nSubTotals = Math.max(n, 0);
      this.pSubTotals = Array.from({ length: this.nSubTotals }, () => [0, 0 as ScSubTotalFunc] as [SCCOL, ScSubTotalFunc]);
    }
  }

  subtotals(): [SCCOL, ScSubTotalFunc][] { return this.pSubTotals; }
  col(n: SCCOL): SCCOL { return this.pSubTotals[n]![0]; }
  func(n: SCCOL): ScSubTotalFunc { return this.pSubTotals[n]![1]; }
}

export class ScSubTotalParam {
  nCol1: SCCOL = 0; ///< selected area
  nRow1: SCROW = 0;
  nCol2: SCCOL = 0;
  nRow2: SCROW = 0;
  nUserIndex = 0; ///< index into list
  bRemoveOnly = false;
  bReplace = true; ///< replace existing results
  bPagebreak = false; ///< page break at change of group
  bCaseSens = false;
  bDoSort = true; ///< presort
  bSummaryBelow = true; ///< Summary below or above (default: below)
  bAscending = true; ///< sort ascending
  bUserDef = false; ///< sort user defined
  bIncludePattern = false; ///< sort formats

  aGroups: SubtotalGroup[] = Array.from({ length: MAXSUBTOTAL }, () => new SubtotalGroup());

  constructor(r?: ScSubTotalParam) {
    if (r) {
      this.nCol1 = r.nCol1; this.nRow1 = r.nRow1; this.nCol2 = r.nCol2; this.nRow2 = r.nRow2;
      this.nUserIndex = r.nUserIndex; this.bRemoveOnly = r.bRemoveOnly; this.bReplace = r.bReplace; this.bPagebreak = r.bPagebreak;
      this.bCaseSens = r.bCaseSens; this.bDoSort = r.bDoSort; this.bSummaryBelow = r.bSummaryBelow; this.bAscending = r.bAscending;
      this.bUserDef = r.bUserDef; this.bIncludePattern = r.bIncludePattern;
      this.aGroups = r.aGroups.map((g) => g.clone());
    }
  }

  clone(): ScSubTotalParam { return new ScSubTotalParam(this); }

  equals(r: ScSubTotalParam): boolean {
    return this.nCol1 === r.nCol1 && this.nRow1 === r.nRow1 && this.nCol2 === r.nCol2 && this.nRow2 === r.nRow2 && this.nUserIndex === r.nUserIndex
      && this.bRemoveOnly === r.bRemoveOnly && this.bReplace === r.bReplace && this.bPagebreak === r.bPagebreak && this.bCaseSens === r.bCaseSens
      && this.bDoSort === r.bDoSort && this.bSummaryBelow === r.bSummaryBelow && this.bAscending === r.bAscending && this.bUserDef === r.bUserDef
      && this.bIncludePattern === r.bIncludePattern && this.aGroups.every((g, i) => g.equals(r.aGroups[i]!));
  }

  SetSubTotals(nGroup: number, ptrSubTotals: SCCOL[], ptrFunctions: ScSubTotalFunc[], nCount: number): void {
    if (!(ptrSubTotals && ptrFunctions && nCount > 0 && nGroup <= MAXSUBTOTAL)) return;

    // 0 is interpreted as 1, otherwise decrementing the array index
    if (nGroup !== 0) nGroup--;

    this.aGroups[nGroup]!.AllocSubTotals(nCount);
    for (let i = 0; i < nCount; i++) this.aGroups[nGroup]!.pSubTotals[i] = [ptrSubTotals[i]!, ptrFunctions[i]!];
  }
}
