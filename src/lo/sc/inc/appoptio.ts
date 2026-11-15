// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/appoptio.hxx reduced
// @upstream sc/source/core/tool/appoptio.cxx reduced
// ScAppOptions: the application options Calc's views use, reduced to the status bar functions
// and AutoInput. The metric, zoom defaults, LRU function list, change tracking colours, link
// mode and the configuration items are left out; the web shell keeps the options in the browser.

export class ScAppOptions {
  /** A bit set of ScSubTotalFunc: SCLAYOUTOPT_STATUSBARMULTI_DEFAULTVAL, Sum and Average. */
  private nStatusFunc = 514;
  private bAutoComplete = true;

  clone(): ScAppOptions { return Object.assign(new ScAppOptions(), this); }
  SetStatusFunc(nNew: number): void { this.nStatusFunc = nNew; }
  GetStatusFunc(): number { return this.nStatusFunc; }
  SetAutoComplete(bNew: boolean): void { this.bAutoComplete = bNew; }
  GetAutoComplete(): boolean { return this.bAutoComplete; }
}
