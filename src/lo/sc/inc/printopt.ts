// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/printopt.hxx reduced
// @upstream sc/source/core/tool/printopt.cxx reduced
// ScPrintOptions: Tools > Options > LibreOffice Calc > Print: suppress output of empty pages,
// print all sheets, always apply manual breaks. The configuration item (ScPrintCfg) and the pool
// item (ScTpPrintItem) are left out; the module's options are one shared object
// (GetPrintOptions stands for ScModule::GetPrintOptions).

export class ScPrintOptions {
  private bSkipEmpty = true;
  private bAllSheets = false;
  private bForceBreaks = false;

  constructor() { this.SetDefaults(); }

  GetSkipEmpty(): boolean { return this.bSkipEmpty; }
  SetSkipEmpty(bVal: boolean): void { this.bSkipEmpty = bVal; }
  GetAllSheets(): boolean { return this.bAllSheets; }
  SetAllSheets(bVal: boolean): void { this.bAllSheets = bVal; }
  GetForceBreaks(): boolean { return this.bForceBreaks; }
  SetForceBreaks(bVal: boolean): void { this.bForceBreaks = bVal; }

  SetDefaults(): void {
    this.bSkipEmpty = true;
    this.bAllSheets = false;
    this.bForceBreaks = false;
  }

  equals(rOpt: ScPrintOptions): boolean {
    return this.bSkipEmpty === rOpt.bSkipEmpty && this.bAllSheets === rOpt.bAllSheets && this.bForceBreaks === rOpt.bForceBreaks;
  }

  clone(): ScPrintOptions {
    const r = new ScPrintOptions();
    r.bSkipEmpty = this.bSkipEmpty; r.bAllSheets = this.bAllSheets; r.bForceBreaks = this.bForceBreaks;
    return r;
  }
}

const aModulePrintOptions = new ScPrintOptions();

/** ScModule::GetPrintOptions: the module's print options. */
export function GetPrintOptions(): ScPrintOptions { return aModulePrintOptions; }
