// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/idl/com/sun/star/sheet/addin/XMiscFunctions.idl reduced
// The methods of css::sheet::addin::XMiscFunctions as ScUnoAddInCollection learns them by introspection:
// name, return type and the parameters (name and argument type, lcl_GetArgType's mapping of the
// UNO type). Reduced: the documentation comments and the raised exceptions are left out.

import { ScAddInArgumentType, type ScAddInParamInfo } from '../../../../../../../sc/inc/addincol.ts';

const { SC_ADDINARG_STRING } = ScAddInArgumentType;

export interface XMiscFunctionsMethod { readonly aName: string; readonly aReturnType: string; readonly aParams: readonly ScAddInParamInfo[] }

export const XMiscFunctions: readonly XMiscFunctionsMethod[] = [
  { aName: 'getRot13', aReturnType: 'string', aParams: [{ aName: 'aSrcString', eType: SC_ADDINARG_STRING }] },
];
