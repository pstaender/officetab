// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/inputopt.hxx reduced
// @upstream sc/source/core/tool/inputopt.cxx partial
// ScInputOptions: Tools - Options - LibreOffice Calc - General's input settings (Enter moves the
// selection and in which direction, Enter switches to edit mode, expand references, highlight
// the selection in the headers, …). The configuration item (ScInputCfg) is left out; the web
// shell keeps the options in the browser.
import { ScDirection } from './global.ts';

export class ScInputOptions {
  private nMoveDir: number = ScDirection.DIR_BOTTOM; // enum ScDirection
  private bMoveSelection = true;
  private bMoveKeepEdit = false;
  private bEnterEdit = false;
  private bExtendFormat = false;
  private bRangeFinder = true;
  private bExpandRefs = false;
  private mbSortRefUpdate = true;
  private bMarkHeader = true;
  private bUseTabCol = false;
  private bTextWysiwyg = false;
  private bReplCellsWarn = true;
  private bLegacyCellSelection = false;
  private bEnterPasteMode = false;
  private bWarnActiveSheet = true;

  clone(): ScInputOptions { return Object.assign(new ScInputOptions(), this); }

  SetMoveDir(nNew: number): void { this.nMoveDir = nNew; }
  GetMoveDir(): number { return this.nMoveDir; }
  SetMoveSelection(bSet: boolean): void { this.bMoveSelection = bSet; }
  GetMoveSelection(): boolean { return this.bMoveSelection; }
  SetEnterEdit(bSet: boolean): void { this.bEnterEdit = bSet; }
  GetEnterEdit(): boolean { return this.bEnterEdit; }
  SetMoveKeepEdit(bSet: boolean): void { this.bMoveKeepEdit = bSet; }
  GetMoveKeepEdit(): boolean { return this.bMoveKeepEdit; }
  SetExtendFormat(bSet: boolean): void { this.bExtendFormat = bSet; }
  GetExtendFormat(): boolean { return this.bExtendFormat; }
  SetRangeFinder(bSet: boolean): void { this.bRangeFinder = bSet; }
  GetRangeFinder(): boolean { return this.bRangeFinder; }
  SetExpandRefs(bSet: boolean): void { this.bExpandRefs = bSet; }
  GetExpandRefs(): boolean { return this.bExpandRefs; }
  SetSortRefUpdate(bSet: boolean): void { this.mbSortRefUpdate = bSet; }
  GetSortRefUpdate(): boolean { return this.mbSortRefUpdate; }
  SetMarkHeader(bSet: boolean): void { this.bMarkHeader = bSet; }
  GetMarkHeader(): boolean { return this.bMarkHeader; }
  SetUseTabCol(bSet: boolean): void { this.bUseTabCol = bSet; }
  GetUseTabCol(): boolean { return this.bUseTabCol; }
  SetTextWysiwyg(bSet: boolean): void { this.bTextWysiwyg = bSet; }
  GetTextWysiwyg(): boolean { return this.bTextWysiwyg; }
  SetReplaceCellsWarn(bSet: boolean): void { this.bReplCellsWarn = bSet; }
  GetReplaceCellsWarn(): boolean { return this.bReplCellsWarn; }
  SetLegacyCellSelection(bSet: boolean): void { this.bLegacyCellSelection = bSet; }
  GetLegacyCellSelection(): boolean { return this.bLegacyCellSelection; }
  SetEnterPasteMode(bSet: boolean): void { this.bEnterPasteMode = bSet; }
  GetEnterPasteMode(): boolean { return this.bEnterPasteMode; }
  SetWarnActiveSheet(bSet: boolean): void { this.bWarnActiveSheet = bSet; }
  GetWarnActiveSheet(): boolean { return this.bWarnActiveSheet; }
}
