// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/docoptio.hxx reduced
// @upstream sc/source/core/tool/docoptio.cxx reduced
// ScDocOptions: the calculation options of a document (iteration, null date, precision as
// shown, case sensitivity, whole cell matching, wildcards or regular expressions in formulas).
import { SearchType } from './global.ts';

export class ScDocOptions {
  private fIterEps = 1.0e-3; // epsilon value dazu
  private nIterCount = 100; ///< number
  private nPrecStandardFormat = -1; ///< precision for standard format (UNLIMITED_PRECISION)
  private nDay = 30; ///< Null date:
  private nMonth = 12;
  private nYear = 1899;
  private nYear2000 = 1930; ///< earlier 19YY is assumed, 20YY otherwise (if < 100)
  private nTabDistance = 1250; ///< distance of standard tabs (1.25 cm in 1/100 mm)
  private bIsIgnoreCase = false; ///< ignore case for comparisons?
  private bIsIter = false; ///< iterations for circular refs
  private bCalcAsShown = false; ///< calculate as shown (wrt precision)
  private bMatchWholeCell = true; ///< search criteria must match the whole cell
  private bLookUpColRowNames = true; ///< determine column-/row titles automagically
  private bFormulaRegexEnabled = false; ///< regular expressions in formulas enabled, only when reading settings
  private bFormulaWildcardsEnabled = true; ///< wildcards in formulas enabled, only when reading settings
  private eFormulaSearchType: SearchType = SearchType.Wildcard; ///< wildcards or regular expressions or normal search
  private bWriteCalcConfig = true; ///< (subset of) Calc config will be written to user's profile

  clone(): ScDocOptions {
    const r = new ScDocOptions();
    Object.assign(r, this);
    return r;
  }

  equals(r: ScDocOptions): boolean { return JSON.stringify(this) === JSON.stringify(r); }

  ResetDocOptions(): void { Object.assign(this, new ScDocOptions()); }

  IsIgnoreCase(): boolean { return this.bIsIgnoreCase; }
  SetIgnoreCase(bVal: boolean): void { this.bIsIgnoreCase = bVal; }
  IsIter(): boolean { return this.bIsIter; }
  SetIter(bVal: boolean): void { this.bIsIter = bVal; }
  GetIterCount(): number { return this.nIterCount; }
  SetIterCount(nCount: number): void { this.nIterCount = nCount; }
  GetIterEps(): number { return this.fIterEps; }
  SetIterEps(fEps: number): void { this.fIterEps = fEps; }
  GetDate(): { nDay: number; nMonth: number; nYear: number } { return { nDay: this.nDay, nMonth: this.nMonth, nYear: this.nYear }; }
  SetDate(nD: number, nM: number, nY: number): void { this.nDay = nD; this.nMonth = nM; this.nYear = nY; }
  GetTabDistance(): number { return this.nTabDistance; }
  SetTabDistance(nTabDist: number): void { this.nTabDistance = nTabDist; }
  IsCalcAsShown(): boolean { return this.bCalcAsShown; }
  SetCalcAsShown(bVal: boolean): void { this.bCalcAsShown = bVal; }
  GetStdPrecision(): number { return this.nPrecStandardFormat; }
  SetStdPrecision(n: number): void { this.nPrecStandardFormat = n; }
  IsMatchWholeCell(): boolean { return this.bMatchWholeCell; }
  SetMatchWholeCell(bVal: boolean): void { this.bMatchWholeCell = bVal; }
  IsLookUpColRowNames(): boolean { return this.bLookUpColRowNames; }
  SetLookUpColRowNames(bVal: boolean): void { this.bLookUpColRowNames = bVal; }
  GetYear2000(): number { return this.nYear2000; }
  SetYear2000(nVal: number): void { this.nYear2000 = nVal; }

  SetFormulaRegexEnabled(bVal: boolean): void {
    if (bVal) {
      this.bFormulaRegexEnabled = true;
      this.bFormulaWildcardsEnabled = false;
      this.eFormulaSearchType = SearchType.Regexp;
    } else if (!this.bFormulaRegexEnabled) {
      // nothing changes for setting false to false
    } else {
      this.bFormulaRegexEnabled = false;
      this.eFormulaSearchType = SearchType.Normal;
    }
  }
  IsFormulaRegexEnabled(): boolean { return this.bFormulaRegexEnabled; }

  SetFormulaWildcardsEnabled(bVal: boolean): void {
    if (bVal) {
      this.bFormulaRegexEnabled = false;
      this.bFormulaWildcardsEnabled = true;
      this.eFormulaSearchType = SearchType.Wildcard;
    } else if (!this.bFormulaWildcardsEnabled) {
      // nothing changes for setting false to false
    } else {
      this.bFormulaWildcardsEnabled = false;
      this.eFormulaSearchType = SearchType.Normal;
    }
  }
  IsFormulaWildcardsEnabled(): boolean { return this.bFormulaWildcardsEnabled; }
  GetFormulaSearchType(): SearchType { return this.eFormulaSearchType; }

  SetWriteCalcConfig(bVal: boolean): void { this.bWriteCalcConfig = bVal; }
  IsWriteCalcConfig(): boolean { return this.bWriteCalcConfig; }
}
