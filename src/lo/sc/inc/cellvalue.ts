// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/cellvalue.hxx reduced
// @upstream sc/source/core/data/cellvalue.cxx reduced
// ScCellValue (an owned copy of a cell) and ScRefCellValue (a view of a cell in the document):
// the cell type and its value, string, edit text or formula cell. A column stores its cells as
// the raw value (number, string, EditTextObject or ScFormulaCell); these classes interpret it.
import { EditTextObject } from '../../editeng/source/editeng/editobj.ts';
import type { ScFormulaCell } from '../source/core/data/formulacell.ts';

export const CellType = { CELLTYPE_NONE: 0, CELLTYPE_VALUE: 1, CELLTYPE_STRING: 2, CELLTYPE_FORMULA: 3, CELLTYPE_EDIT: 4 } as const;
export type CellType = (typeof CellType)[keyof typeof CellType];
export const { CELLTYPE_NONE, CELLTYPE_VALUE, CELLTYPE_STRING, CELLTYPE_FORMULA, CELLTYPE_EDIT } = CellType;

/** The raw cell as a column stores it. */
export type ScCellData = number | string | EditTextObject | ScFormulaCell;

/** The type of a stored cell. */
export function GetCellType(p: ScCellData | undefined): CellType {
  if (p === undefined) return CELLTYPE_NONE;
  if (typeof p === 'number') return CELLTYPE_VALUE;
  if (typeof p === 'string') return CELLTYPE_STRING;
  if (p instanceof EditTextObject) return CELLTYPE_EDIT;
  return CELLTYPE_FORMULA;
}

/**
 * This is a very lightweight version of a cell value: the type and a reference to the cell's
 * content in the document.
 */
export class ScRefCellValue {
  meType: CellType = CELLTYPE_NONE;
  mfValue = 0;
  mpString: string | null = null;
  mpEditText: EditTextObject | null = null;
  mpFormula: ScFormulaCell | null = null;

  constructor(p?: ScCellData) {
    if (p !== undefined) this.assign(p);
  }

  assign(p: ScCellData | undefined): this {
    this.meType = GetCellType(p);
    this.mfValue = 0; this.mpString = null; this.mpEditText = null; this.mpFormula = null;
    switch (this.meType) {
      case CELLTYPE_VALUE: this.mfValue = p as number; break;
      case CELLTYPE_STRING: this.mpString = p as string; break;
      case CELLTYPE_EDIT: this.mpEditText = p as EditTextObject; break;
      case CELLTYPE_FORMULA: this.mpFormula = p as ScFormulaCell; break;
      default:
    }
    return this;
  }

  getType(): CellType { return this.meType; }
  getDouble(): number { return this.mfValue; }
  getSharedString(): string | null { return this.mpString; }
  getEditText(): EditTextObject | null { return this.mpEditText; }
  getFormula(): ScFormulaCell | null { return this.mpFormula; }
  isEmpty(): boolean { return this.meType === CELLTYPE_NONE; }

  /** True if this cell has a value or a numeric formula result (hasNumeric). */
  hasNumeric(): boolean {
    switch (this.meType) {
      case CELLTYPE_VALUE: return true;
      case CELLTYPE_FORMULA: return !this.mpFormula!.IsValue() ? false : true;
      default: return false;
    }
  }

  /** True if this cell has a string or a string formula result (hasString). */
  hasString(): boolean {
    switch (this.meType) {
      case CELLTYPE_STRING:
      case CELLTYPE_EDIT: return true;
      case CELLTYPE_FORMULA: return !this.mpFormula!.IsValue();
      default: return false;
    }
  }

  /** True if this cell has an error result. */
  hasError(): boolean { return this.meType === CELLTYPE_FORMULA && this.mpFormula!.GetErrCode() !== 0; }

  hasEmptyValue(): boolean {
    if (this.isEmpty()) return true;
    if (this.meType === CELLTYPE_FORMULA) return this.mpFormula!.IsEmpty();
    return false;
  }

  /** The numeric value: the value, the formula result, 0 for strings. */
  getValue(): number {
    switch (this.meType) {
      case CELLTYPE_VALUE: return this.mfValue;
      case CELLTYPE_FORMULA: return this.mpFormula!.GetValue();
      default: return 0.0;
    }
  }

  /** The raw value (formula result without interpreting). */
  getRawValue(): number {
    switch (this.meType) {
      case CELLTYPE_VALUE: return this.mfValue;
      case CELLTYPE_FORMULA: return this.mpFormula!.GetRawValue();
      default: return 0.0;
    }
  }

  /** The string of the cell: text, edit text, or formula string result (getString). */
  getString(): string {
    switch (this.meType) {
      case CELLTYPE_STRING: return this.mpString!;
      case CELLTYPE_EDIT: return this.mpEditText!.GetString();
      case CELLTYPE_FORMULA: return this.mpFormula!.GetString();
      default: return '';
    }
  }

  /** The cell data as a column stores it. */
  getData(): ScCellData | undefined {
    switch (this.meType) {
      case CELLTYPE_VALUE: return this.mfValue;
      case CELLTYPE_STRING: return this.mpString!;
      case CELLTYPE_EDIT: return this.mpEditText!;
      case CELLTYPE_FORMULA: return this.mpFormula!;
      default: return undefined;
    }
  }

  equalsWithoutFormat(r: ScRefCellValue): boolean {
    if (this.meType !== r.meType) return false;
    switch (this.meType) {
      case CELLTYPE_NONE: return true;
      case CELLTYPE_VALUE: return this.mfValue === r.mfValue;
      case CELLTYPE_STRING: return this.mpString === r.mpString;
      case CELLTYPE_EDIT: return this.mpEditText!.GetString() === r.mpEditText!.GetString();
      case CELLTYPE_FORMULA: return this.mpFormula!.GetFormula() === r.mpFormula!.GetFormula();
      default: return false;
    }
  }
}

/** Store arbitrary cell value of any kind; it only stores cell value and nothing else. It creates
    a copy of the original cell value, and manages the life cycle of the copied value. */
export class ScCellValue {
  meType: CellType = CELLTYPE_NONE;
  private mData: ScCellData | undefined;

  constructor(p?: ScCellData | ScRefCellValue) {
    if (p instanceof ScRefCellValue) this.set(p.getData());
    else if (p !== undefined) this.set(p);
  }

  set(p: ScCellData | undefined): void {
    this.meType = GetCellType(p);
    if (p instanceof EditTextObject) this.mData = p.Clone();
    else if (this.meType === CELLTYPE_FORMULA) this.mData = (p as ScFormulaCell).Clone();
    else this.mData = p;
  }

  clear(): void { this.meType = CELLTYPE_NONE; this.mData = undefined; }
  getType(): CellType { return this.meType; }
  getData(): ScCellData | undefined { return this.mData; }
  getDouble(): number { return this.meType === CELLTYPE_VALUE ? (this.mData as number) : 0; }
  getString(): string { return this.meType === CELLTYPE_STRING ? (this.mData as string) : ''; }
  getEditText(): EditTextObject | null { return this.meType === CELLTYPE_EDIT ? (this.mData as EditTextObject) : null; }
  getFormula(): ScFormulaCell | null { return this.meType === CELLTYPE_FORMULA ? (this.mData as ScFormulaCell) : null; }
  isEmpty(): boolean { return this.meType === CELLTYPE_NONE; }
}
