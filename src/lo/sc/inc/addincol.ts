// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/addincol.hxx reduced
// The types of the UNO add-in collection: the argument types an add-in function may declare, the
// argument descriptions, and, in place of UNO, the surface of an add-in component the collection
// reads (what ScUnoAddInCollection::ReadFromAddIn learns through css::sheet::XAddIn,
// css::sheet::XCompatibilityNames, css::lang::XServiceName and introspection of the methods).
// Reduced: no UNO. An add-in is a TypeScript object implementing ScAddInComponent; a UNO Any is a
// JavaScript value (undefined for void, number, string, boolean, arrays of rows for
// sequence<sequence<…>>, an array for sequence<any>), and the exceptions an add-in throws are the
// classes below.

/** The UNO type of an add-in argument, as lcl_GetArgType derives it. */
export const ScAddInArgumentType = {
  SC_ADDINARG_NONE: 0, ///< -
  SC_ADDINARG_INTEGER: 1, ///< long
  SC_ADDINARG_DOUBLE: 2, ///< double
  SC_ADDINARG_STRING: 3, ///< string
  SC_ADDINARG_INTEGER_ARRAY: 4, ///< sequence<sequence<long>>
  SC_ADDINARG_DOUBLE_ARRAY: 5, ///< sequence<sequence<double>>
  SC_ADDINARG_STRING_ARRAY: 6, ///< sequence<sequence<string>>
  SC_ADDINARG_MIXED_ARRAY: 7, ///< sequence<sequence<any>>
  SC_ADDINARG_VALUE_OR_ARRAY: 8, ///< any
  SC_ADDINARG_CELLRANGE: 9, ///< XCellRange
  SC_ADDINARG_CALLER: 10, ///< XPropertySet
  SC_ADDINARG_VARARGS: 11, ///< sequence<any>
} as const;
export type ScAddInArgumentType = (typeof ScAddInArgumentType)[keyof typeof ScAddInArgumentType];

export interface ScAddInArgDesc {
  aInternalName: string; ///< used to match configuration and reflection information
  aName: string;
  aDescription: string;
  eType: ScAddInArgumentType;
  bOptional: boolean;
}

/** A UNO Any as an add-in receives or returns it. */
export type UnoAny = undefined | null | number | string | boolean | UnoAny[] | UnoAny[][];

/** css::util::Date, as the caller's "NullDate" property gives it. */
export interface UnoDate { Day: number; Month: number; Year: number }

/** The caller argument of an add-in function (css::beans::XPropertySet of the document
    model): the document options the add-in may read, NullDate in particular. */
export interface XPropertySet {
  getPropertyValue(aPropertyName: string): unknown;
}

/** css::lang::Locale. */
export interface UnoLocale { Language: string; Country: string; Variant?: string }

/** css::sheet::LocalizedName: a function's name in another application (Excel). */
export interface LocalizedName { Locale: UnoLocale; Name: string }

/** reflection::ParamInfo of a method parameter (its name and type). */
export interface ScAddInParamInfo { aName: string; eType: ScAddInArgumentType }

/** One function of an add-in (reflection::XIdlMethod): its name, parameters (the caller
    included) and the call. */
export interface ScAddInMethod {
  getName(): string;
  getParameterInfos(): ScAddInParamInfo[];
  /** XIdlMethod::invoke: the arguments in parameter order (the caller at its position). */
  invoke(aArgs: UnoAny[] | unknown[]): UnoAny;
}

/** An add-in component (css::sheet::XAddIn, XCompatibilityNames, XServiceName and its
    introspected methods). */
export interface ScAddInComponent {
  getServiceName(): string;
  getMethods(): ScAddInMethod[];
  setLocale(eLocale: UnoLocale): void;
  getProgrammaticCategoryName(aProgrammaticName: string): string;
  getDisplayFunctionName(aProgrammaticName: string): string;
  getFunctionDescription(aProgrammaticName: string): string;
  getDisplayArgumentName(aProgrammaticName: string, nArgument: number): string;
  getArgumentDescription(aProgrammaticName: string, nArgument: number): string;
  getCompatibilityNames(aProgrammaticName: string): LocalizedName[];
}

/** css::lang::IllegalArgumentException: the call results in Err:502. */
export class IllegalArgumentException extends Error {
  constructor(sMessage = 'IllegalArgumentException') { super(sMessage); }
}

/** css::sheet::NoConvergenceException: the call results in Err:523. */
export class NoConvergenceException extends Error {
  constructor(sMessage = 'NoConvergenceException') { super(sMessage); }
}

/** css::uno::RuntimeException and others: the call results in #VALUE!. */
export class RuntimeException extends Error {
  constructor(sMessage = 'RuntimeException') { super(sMessage); }
}
