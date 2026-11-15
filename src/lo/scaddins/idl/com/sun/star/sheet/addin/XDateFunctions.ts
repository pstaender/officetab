// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/idl/com/sun/star/sheet/addin/XDateFunctions.idl reduced
// The methods of css::sheet::addin::XDateFunctions as ScUnoAddInCollection learns them by introspection:
// name, return type and the parameters (name and argument type, lcl_GetArgType's mapping of the
// UNO type). Reduced: the documentation comments and the raised exceptions are left out.

import { ScAddInArgumentType, type ScAddInParamInfo } from '../../../../../../../sc/inc/addincol.ts';

const { SC_ADDINARG_CALLER, SC_ADDINARG_INTEGER } = ScAddInArgumentType;

export interface XDateFunctionsMethod { readonly aName: string; readonly aReturnType: string; readonly aParams: readonly ScAddInParamInfo[] }

export const XDateFunctions: readonly XDateFunctionsMethod[] = [
  { aName: 'getDiffWeeks', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nStartDate', eType: SC_ADDINARG_INTEGER }, { aName: 'nEndDate', eType: SC_ADDINARG_INTEGER }, { aName: 'nMode', eType: SC_ADDINARG_INTEGER }] },
  { aName: 'getDiffMonths', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nStartDate', eType: SC_ADDINARG_INTEGER }, { aName: 'nEndDate', eType: SC_ADDINARG_INTEGER }, { aName: 'nMode', eType: SC_ADDINARG_INTEGER }] },
  { aName: 'getDiffYears', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nStartDate', eType: SC_ADDINARG_INTEGER }, { aName: 'nEndDate', eType: SC_ADDINARG_INTEGER }, { aName: 'nMode', eType: SC_ADDINARG_INTEGER }] },
  { aName: 'getIsLeapYear', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nDate', eType: SC_ADDINARG_INTEGER }] },
  { aName: 'getDaysInMonth', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nDate', eType: SC_ADDINARG_INTEGER }] },
  { aName: 'getDaysInYear', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nDate', eType: SC_ADDINARG_INTEGER }] },
  { aName: 'getWeeksInYear', aReturnType: 'long', aParams: [{ aName: 'xOptions', eType: SC_ADDINARG_CALLER }, { aName: 'nDate', eType: SC_ADDINARG_INTEGER }] },
];
