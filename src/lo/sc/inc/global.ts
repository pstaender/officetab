// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/global.hxx partial
// @upstream sc/source/core/data/global.cxx partial
// The flag sets and enums of global.hxx used by the document model, and ScGlobal's error
// strings. The ScGlobal statics with process-wide state (collators, char classes, the number
// formatter) are not ported; en-US is the UI language.
import { FormulaError } from '../../include/formula/errorcodes.ts';
import { ocErrDivZero, ocErrNA, ocErrName, ocErrNull, ocErrNum, ocErrValue } from '../../include/formula/opcode.ts';
import { FormulaCompiler } from '../../formula/source/core/api/FormulaCompiler.ts';
import { FindUnquoted } from './address.ts';

export const STD_COL_WIDTH = 1280; // 64 pt in twips
export const STD_EXTRA_WIDTH = 113; // 2 mm in twips
export const MAX_EXTRA_WIDTH = 23811; // 42 cm in twips
export const MAX_EXTRA_HEIGHT = 23811; // 42 cm in twips

export const InsertDeleteFlags = {
  NONE: 0x0000,
  VALUE: 0x0001, /// Numeric values (and numeric results if InsertDeleteFlags::FORMULA is not set).
  DATETIME: 0x0002, /// Dates, times, datetime values.
  STRING: 0x0004, /// Strings (and string results if InsertDeleteFlags::FORMULA is not set).
  NOTE: 0x0008, /// Cell notes.
  FORMULA: 0x0010, /// Formula cells.
  HARDATTR: 0x0020, /// Hard cell attributes.
  STYLES: 0x0040, /// Cell styles.
  OBJECTS: 0x0080, /// Drawing objects.
  EDITATTR: 0x0100, /// Rich-text attributes.
  OUTLINE: 0x0800, /// Sheet / outlining (grouping) information
  SPARKLINES: 0x4000, /// Sparklines in a cell.
  NOCAPTIONS: 0x8000, /// Internal use only (undo etc.): do not copy/delete caption objects of cell notes.
  ADDNOTES: 0x0400, /// Internal use only (copy from clip): do not delete existing cell contents when pasting notes.
  SPECIAL_BOOLEAN: 0x1000,
  FORGETCAPTIONS: 0x2000, /// Internal use only (d&d undo): do not delete caption objects of cell notes.
  ATTRIB: 0x0020 | 0x0040,
  CONTENTS: 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0800 | 0x4000,
  // tdf#116127 - add EDITATTR to ALL flags in order to check for valid function inputs
  ALL: 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0800 | 0x4000 | 0x0020 | 0x0040 | 0x0080 | 0x0100,
  /// Copy flags for auto/series fill functions: do not touch notes and drawing objects.
  AUTOFILL: (0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0800 | 0x4000 | 0x0020 | 0x0040 | 0x0080 | 0x0100) & ~(0x0008 | 0x0080),
} as const;
export type InsertDeleteFlags = number;

export const ScPasteFunc = { NONE: 0, ADD: 1, SUB: 2, MUL: 3, DIV: 4 } as const;
export type ScPasteFunc = (typeof ScPasteFunc)[keyof typeof ScPasteFunc];

// bits for HasAttr
export const HasAttrFlags = {
  NONE: 0x0000,
  Lines: 0x0001,
  Merged: 0x0002,
  Overlapped: 0x0004,
  Protected: 0x0008,
  Shadow: 0x0010,
  NeedHeight: 0x0020,
  ShadowRight: 0x0040,
  ShadowDown: 0x0080,
  AutoFilter: 0x0100,
  Conditional: 0x0200,
  Rotate: 0x0400,
  NotOverlapped: 0x0800,
  RightOrCenter: 0x1000, // right or centered logical alignment
} as const;
export type HasAttrFlags = number;

// flags for cells hidden by protection
export const ScProtectionCellHidden = 0;

/** Column/row flags (CRFlags). */
export const CRFlags = {
  NONE: 0x0000,
  // Filtered always together with Hidden
  // Filtered and ManualSize only valid for rows
  Hidden: 0x0001,
  ManualBreak: 0x0002,
  Filtered: 0x0004,
  ManualSize: 0x0008,
  All: 0x0001 | 0x0002 | 0x0004 | 0x0008,
} as const;
export type CRFlags = number;

/** ScBreakType: an automatic (Page) or manual page break. */
export const ScBreakType = { NONE: 0x00, Page: 0x01, Manual: 0x02 } as const;
export type ScBreakType = number;

export const InsCellCmd = { INS_CELLSDOWN: 0, INS_CELLSRIGHT: 1, INS_INSROWS_BEFORE: 2, INS_INSCOLS_BEFORE: 3, INS_NONE: 4, INS_INSROWS_AFTER: 5, INS_INSCOLS_AFTER: 6 } as const;
export type InsCellCmd = (typeof InsCellCmd)[keyof typeof InsCellCmd];

export const DelCellCmd = { CellsUp: 0, CellsLeft: 1, Rows: 2, Cols: 3, NONE: 4 } as const;
export type DelCellCmd = (typeof DelCellCmd)[keyof typeof DelCellCmd];

export const ScDirection = { DIR_BOTTOM: 0, DIR_RIGHT: 1, DIR_TOP: 2, DIR_LEFT: 3 } as const;
export type ScDirection = (typeof ScDirection)[keyof typeof ScDirection];

export const FillDir = { FILL_TO_BOTTOM: 0, FILL_TO_RIGHT: 1, FILL_TO_TOP: 2, FILL_TO_LEFT: 3 } as const;
export type FillDir = (typeof FillDir)[keyof typeof FillDir];

export const FillCmd = { FILL_SIMPLE: 0, FILL_LINEAR: 1, FILL_GROWTH: 2, FILL_DATE: 3, FILL_AUTO: 4 } as const;
export type FillCmd = (typeof FillCmd)[keyof typeof FillCmd];

export const FillDateCmd = { FILL_DAY: 0, FILL_WEEKDAY: 1, FILL_MONTH: 2, FILL_END_OF_MONTH: 3, FILL_YEAR: 4 } as const;
export type FillDateCmd = (typeof FillDateCmd)[keyof typeof FillDateCmd];

export const ScSizeMode = {
  SC_SIZE_DIRECT: 0, // set size or hide if value is 0
  SC_SIZE_OPTIMAL: 1, // set optimal size for everything
  SC_SIZE_SHOW: 2, // show with original size
  SC_SIZE_VISOPT: 3, // set optimal size only if visible
  SC_SIZE_ORIGINAL: 4, // only set size, don't change visible flag
} as const;
export type ScSizeMode = (typeof ScSizeMode)[keyof typeof ScSizeMode];

export const ScMoveDirection = { SC_MOVE_RIGHT: 0, SC_MOVE_LEFT: 1, SC_MOVE_UP: 2, SC_MOVE_DOWN: 3 } as const;

export const ScSubTotalFunc = {
  SUBTOTAL_FUNC_NONE: 0, SUBTOTAL_FUNC_AVE: 1, SUBTOTAL_FUNC_CNT: 2, SUBTOTAL_FUNC_CNT2: 3, SUBTOTAL_FUNC_MAX: 4, SUBTOTAL_FUNC_MIN: 5,
  SUBTOTAL_FUNC_PROD: 6, SUBTOTAL_FUNC_STD: 7, SUBTOTAL_FUNC_STDP: 8, SUBTOTAL_FUNC_SUM: 9, SUBTOTAL_FUNC_VAR: 10, SUBTOTAL_FUNC_VARP: 11,
  SUBTOTAL_FUNC_MED: 12, SUBTOTAL_FUNC_SELECTION_COUNT: 13,
} as const;
export type ScSubTotalFunc = (typeof ScSubTotalFunc)[keyof typeof ScSubTotalFunc];

/** The subtotal flags of the interpreter's iteration (SubtotalFlags). */
export const SubtotalFlags = {
  NONE: 0x00,
  IgnoreHidden: 0x01,
  IgnoreErrVal: 0x02,
  IgnoreNestedStAg: 0x04,
  IgnoreFiltered: 0x08,
} as const;
export type SubtotalFlags = number;

/** ScQueryOp (global.hxx) */
export const ScQueryOp = {
  SC_EQUAL: 0, SC_LESS: 1, SC_GREATER: 2, SC_LESS_EQUAL: 3, SC_GREATER_EQUAL: 4, SC_NOT_EQUAL: 5, SC_TOPVAL: 6, SC_BOTVAL: 7, SC_TOPPERC: 8,
  SC_BOTPERC: 9, SC_CONTAINS: 10, SC_DOES_NOT_CONTAIN: 11, SC_BEGINS_WITH: 12, SC_DOES_NOT_BEGIN_WITH: 13, SC_ENDS_WITH: 14,
  SC_DOES_NOT_END_WITH: 15,
} as const;
export type ScQueryOp = (typeof ScQueryOp)[keyof typeof ScQueryOp];

export const ScQueryConnect = { SC_AND: 0, SC_OR: 1 } as const;

/** utl::SearchParam search types relevant to criteria (wildcards, regular expressions). */
export const SearchType = { Normal: 0, Regexp: 1, Wildcard: 2 } as const;
export type SearchType = (typeof SearchType)[keyof typeof SearchType];

/** STR_ERROR_STR and friends: the error strings shown in cells. */
const STR_NO_REF_TABLE = '#REF!';
const STR_NO_ADDIN = '#ADDIN?';
const STR_NO_MACRO = '#MACRO?';
const STR_ERROR_STR = 'Err:';

const LONG_ERRORS: Partial<Record<number, string>> = {
  [FormulaError.IllegalArgument]: 'Error: Invalid argument',
  [FormulaError.IllegalFPOperation]: 'Error: Invalid numeric value',
  [FormulaError.IllegalChar]: 'Error: Invalid character',
  [FormulaError.IllegalParameter]: 'Error in parameter list',
  [FormulaError.Pair]: 'Error: in bracketing',
  [FormulaError.PairExpected]: 'Error: in bracketing',
  [FormulaError.OperatorExpected]: 'Error: Operator missing',
  [FormulaError.VariableExpected]: 'Error: Variable missing',
  [FormulaError.ParameterExpected]: 'Error: Variable missing',
  [FormulaError.CodeOverflow]: 'Error: Formula overflow',
  [FormulaError.StringOverflow]: 'Error: String overflow',
  [FormulaError.StackOverflow]: 'Error: Internal overflow',
  [FormulaError.MatrixSize]: 'Error: Array or matrix size',
  [FormulaError.UnknownState]: 'Internal syntactical error',
  [FormulaError.UnknownVariable]: 'Internal syntactical error',
  [FormulaError.UnknownOpCode]: 'Internal syntactical error',
  [FormulaError.UnknownStackVariable]: 'Internal syntactical error',
  [FormulaError.UnknownToken]: 'Internal syntactical error',
  [FormulaError.NoCode]: 'Error: No code or intersection',
  [FormulaError.CircularReference]: 'Error: Circular reference',
  [FormulaError.NoConvergence]: 'Error: Calculation does not converge',
  [FormulaError.NoRef]: 'Error: Not a valid reference',
  [FormulaError.NoName]: 'Error: Invalid name',
  [FormulaError.NoAddin]: 'Error: Add-in not found',
  [FormulaError.NoMacro]: 'Error: Macro not found',
  [FormulaError.DivisionByZero]: 'Error: Division by zero',
  [FormulaError.NestedArray]: 'Error: Nested arrays are not supported',
  [FormulaError.BadArrayContent]: 'Error: Inline array contents are not supported',
  [FormulaError.LinkFormulaNeedingCheck]: 'External content disabled.',
  [FormulaError.NoValue]: 'Error: Wrong data type',
  [FormulaError.NotAvailable]: 'Error: Value not available',
};

export const ScGlobal = {
  /** The error string a cell shows: #DIV/0!, #VALUE!, #REF!, #NAME?, #N/A, #NUM!, #NULL! or Err:5xx. */
  GetErrorString(nErr: FormulaError): string {
    switch (nErr) {
      case FormulaError.NoRef: return STR_NO_REF_TABLE;
      case FormulaError.NoAddin: return STR_NO_ADDIN;
      case FormulaError.NoMacro: return STR_NO_MACRO;
      case FormulaError.NotAvailable: return FormulaCompiler.GetNativeSymbol(ocErrNA);
      case FormulaError.NoName: return FormulaCompiler.GetNativeSymbol(ocErrName);
      case FormulaError.NoValue: return FormulaCompiler.GetNativeSymbol(ocErrValue);
      case FormulaError.NoCode: return FormulaCompiler.GetNativeSymbol(ocErrNull);
      case FormulaError.DivisionByZero: return FormulaCompiler.GetNativeSymbol(ocErrDivZero);
      case FormulaError.IllegalFPOperation: return FormulaCompiler.GetNativeSymbol(ocErrNum);
      default: return STR_ERROR_STR + String(nErr);
    }
  },

  /** The long error message of the status bar. */
  GetLongErrorString(nErr: FormulaError): string {
    if (nErr === FormulaError.NONE) return '';
    return LONG_ERRORS[nErr] ?? STR_ERROR_STR + String(nErr);
  },

  FindUnquoted,

  /** Whether a string is a valid sheet name (ScDocument::ValidTabName is stricter; see there). */
  ToUpperAlpha(c: string): string { return c.toUpperCase(); },

  /** The default sheet name prefix: "Sheet" (STR_TABLE_DEF). */
  GetStandardTabName(): string { return 'Sheet'; },
};

/** For ScDocShell::GetDBData (ScGetDBMode). */
export const ScGetDBMode = {
  SC_DB_MAKE: 0, ///< create "untitled" (if necessary)
  SC_DB_AUTOFILTER: 1, ///< force use of sheet-local instead of document global anonymous range
  SC_DB_IMPORT: 2, ///< create "Importx" (if necessary)
  SC_DB_OLD: 3, ///< don't create
} as const;
export type ScGetDBMode = (typeof ScGetDBMode)[keyof typeof ScGetDBMode];

/** For ScDBFunc::GetDBData() (ScGetDBSelection). */
export const ScGetDBSelection = {
  /** Keep selection as is, expand to used data area if no selection. */
  Keep: 0,
  /** Shrink selection to actually used data area within the selection. */
  ShrinkToUsedData: 1,
  /** If only one row or portion thereof is selected, shrink row to used data
      columns and select further rows down until end of data. If an area is
      selected, shrink rows to actually used columns. Else, no selection,
      expand to used data area. */
  RowDown: 2,
  /** Behave as if the range corresponding to a ScDBData area was selected,
      for API use. */
  ForceMark: 3,
} as const;
export type ScGetDBSelection = (typeof ScGetDBSelection)[keyof typeof ScGetDBSelection];
