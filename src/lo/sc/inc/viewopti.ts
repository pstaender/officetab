// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/viewopti.hxx reduced
// @upstream sc/source/core/tool/viewopti.cxx reduced
// ScViewOptions: Tools - Options - LibreOffice Calc - View (formulas, zero values, headers, grid
// lines, scroll bars, sheet tabs, …) and the grid colour. The object display modes (OLE, charts,
// drawings), the drawing grid options (ScGridOptions) and the configuration item (ScViewCfg) are
// left out; the web shell keeps the options in the browser instead.

/** sc::ViewOption */
export const ViewOption = {
  FORMULAS: 0,
  NULLVALS: 1,
  SYNTAX: 2,
  NOTES: 3,
  NOTEAUTHOR: 4,
  FORMULAS_MARKS: 5,
  VSCROLL: 6,
  HSCROLL: 7,
  TABCONTROLS: 8,
  OUTLINER: 9,
  HEADER: 10,
  GRID: 11,
  GRID_ONTOP: 12,
  HELPLINES: 13,
  ANCHOR: 14,
  PAGEBREAKS: 15,
  SUMMARY: 16,
  // tdf#96854 - move/copy sheet dialog: last used option for action (true: copy, false: move)
  COPY_SHEET: 17,
  THEMEDCURSOR: 18,
} as const;
export type ViewOption = (typeof ViewOption)[keyof typeof ViewOption];

export const MAX_OPT = ViewOption.THEMEDCURSOR + 1;

/** svtools::ColorConfig's CALCGRID default. */
export const SC_STD_GRIDCOLOR = '#c0c0c0';

export class ScViewOptions {
  private aOptArr: boolean[] = new Array<boolean>(MAX_OPT).fill(false);
  private aGridCol = SC_STD_GRIDCOLOR;
  private aGridColName = '';

  constructor(rCpy?: ScViewOptions) {
    if (rCpy) this.assign(rCpy);
    else this.SetDefaults();
  }

  SetDefaults(): void {
    this.aOptArr[ViewOption.FORMULAS] = false;
    this.aOptArr[ViewOption.SYNTAX] = false;
    this.aOptArr[ViewOption.HELPLINES] = false;
    this.aOptArr[ViewOption.GRID_ONTOP] = false;
    this.aOptArr[ViewOption.NOTES] = true;
    this.aOptArr[ViewOption.NOTEAUTHOR] = true;
    this.aOptArr[ViewOption.FORMULAS_MARKS] = false;
    this.aOptArr[ViewOption.NULLVALS] = true;
    this.aOptArr[ViewOption.VSCROLL] = true;
    this.aOptArr[ViewOption.HSCROLL] = true;
    this.aOptArr[ViewOption.TABCONTROLS] = true;
    this.aOptArr[ViewOption.OUTLINER] = true;
    this.aOptArr[ViewOption.HEADER] = true;
    this.aOptArr[ViewOption.GRID] = true;
    this.aOptArr[ViewOption.ANCHOR] = true;
    this.aOptArr[ViewOption.PAGEBREAKS] = true;
    this.aOptArr[ViewOption.SUMMARY] = true;
    this.aOptArr[ViewOption.COPY_SHEET] = false;
    this.aOptArr[ViewOption.THEMEDCURSOR] = false;

    this.aGridCol = SC_STD_GRIDCOLOR;
  }

  SetOption(eOption: ViewOption, bNew: boolean): void { this.aOptArr[eOption] = bNew; }
  GetOption(eOption: ViewOption): boolean { return this.aOptArr[eOption]!; }

  SetGridColor(rCol: string, rName: string): void { this.aGridCol = rCol; this.aGridColName = rName; }
  GetGridColor(): string { return this.aGridCol; }
  GetGridColorName(): string { return this.aGridColName; }

  assign(rCpy: ScViewOptions): this {
    this.aOptArr = [...rCpy.aOptArr];
    this.aGridCol = rCpy.aGridCol;
    this.aGridColName = rCpy.aGridColName;
    return this;
  }

  equals(rOpt: ScViewOptions): boolean {
    return this.aOptArr.every((b, i) => b === rOpt.aOptArr[i]) && this.aGridCol === rOpt.aGridCol && this.aGridColName === rOpt.aGridColName;
  }

  /** The options as plain data (the web shell's storage instead of ScViewCfg). */
  toJSON(): { opts: boolean[]; grid: string } { return { opts: [...this.aOptArr], grid: this.aGridCol }; }
  static fromJSON(o: { opts?: boolean[]; grid?: string } | null | undefined): ScViewOptions {
    const r = new ScViewOptions();
    if (o?.opts) for (let i = 0; i < MAX_OPT && i < o.opts.length; i++) r.aOptArr[i] = !!o.opts[i];
    if (o?.grid) r.aGridCol = o.grid;
    return r;
  }
}
