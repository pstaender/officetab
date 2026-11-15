// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/tool/addincol.cxx reduced
// The UNO add-in collection: the functions of the installed add-in components (the Analysis
// and DateFunctions add-ins of scaddins), found by their programmatic, English or local name, and
// ScUnoAddInCall, which calls one with the interpreter's arguments and converts its result.
// Reduced: no UNO and no configuration. The installed components are the list below instead of
// the registry's AddInInfo, so ReadConfiguration and LoadComponent/UpdateFromAddIn (late loading)
// are left out and ReadFromAddIn reads every component when the collection is first used.
// Volatile results (XVolatileResult, ScAddInListener) and the XCellRange argument are not
// supported (a cell range argument is an error). The local names are the English ones (the UI
// language of the port's function names).
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import {
  IllegalArgumentException, NoConvergenceException, ScAddInArgumentType, type LocalizedName, type ScAddInArgDesc, type ScAddInComponent, type ScAddInMethod,
  type UnoAny, type XPropertySet,
} from '../../../inc/addincol.ts';
import { ScMatrix } from './scmatrix.ts';

const { SC_ADDINARG_NONE, SC_ADDINARG_CALLER, SC_ADDINARG_VARARGS, SC_ADDINARG_VALUE_OR_ARRAY } = ScAddInArgumentType;

const SC_CALLERPOS_NONE = -1;

/** The add-in components installed (the configuration's AddInInfo node upstream). */
const aInstalledComponents: (() => ScAddInComponent)[] = [
  /* scaddins: add the components here */
];

/** Register a further add-in component (an extension's add-in), before the collection is used. */
export function RegisterAddInComponent(f: () => ScAddInComponent): void {
  aInstalledComponents.push(f);
  ScGlobalAddIns.pAddInCollection?.Clear();
}

/** The function categories of an add-in (lcl_GetCategory): the programmatic category name to
    the function group id of scfuncs (ID_FUNCTION_GRP_*). */
function lcl_GetCategory(rName: string): number {
  const aFuncNames = [
    //  array index = ID_FUNCTION_GRP_*
    'Database', // 1
    'Date&Time', // 2
    'Financial', // 3
    'Information', // 4
    'Logical', // 5
    'Mathematical', // 6
    'Matrix', // 7
    'Statistical', // 8
    'Spreadsheet', // 9
    'Text', // 10
    'Add-In', // 11
  ];
  for (let i = 0; i < aFuncNames.length; i++) if (rName.toLowerCase() === aFuncNames[i]!.toLowerCase()) return i + 1;
  return 11; // ID_FUNCTION_GRP_ADDINS
}

/** One add-in function (ScUnoAddInFuncData). */
export class ScUnoAddInFuncData {
  private aOriginalName: string; ///< kept in formula
  private aLocalName: string; ///< for display
  private aUpperName: string; ///< for entering formulas
  private aUpperLocal: string; ///< for entering formulas
  private aUpperEnglish = ''; ///< for Function Wizard and tooltips
  private aDescription: string;
  private xFunction: ScAddInMethod | null;
  private aObject: ScAddInComponent | null;
  private nArgCount: number;
  private pArgDescs: ScAddInArgDesc[];
  private nCallerPos: number;
  private nCategory: number;
  private sHelpId: string;
  private maCompNames: { maLocale: string; maName: string }[] = [];
  private bCompInitialized = false;

  constructor(rNam: string, rLoc: string, aDesc: string, nCat: number, sHelp: string, xFunc: ScAddInMethod | null, aO: ScAddInComponent | null, nAC: number, pAD: ScAddInArgDesc[], nCP: number) {
    this.aOriginalName = rNam;
    this.aLocalName = rLoc;
    this.aUpperName = rNam;
    this.aUpperLocal = rLoc;
    this.aDescription = aDesc;
    this.xFunction = xFunc;
    this.aObject = aO;
    this.nArgCount = nAC;
    this.nCallerPos = nCP;
    this.nCategory = nCat;
    this.sHelpId = sHelp;
    this.pArgDescs = pAD.slice(0, nAC);
    this.aUpperName = this.aUpperName.toUpperCase(); // programmatic name
    this.aUpperLocal = this.aUpperLocal.toUpperCase();
  }

  GetOriginalName(): string { return this.aOriginalName; }
  GetLocalName(): string { return this.aLocalName; }
  GetUpperName(): string { return this.aUpperName; }
  GetUpperLocal(): string { return this.aUpperLocal; }
  GetUpperEnglish(): string { return this.aUpperEnglish; }
  GetFunction(): ScAddInMethod | null { return this.xFunction; }
  GetObject(): ScAddInComponent | null { return this.aObject; }
  GetArgumentCount(): number { return this.nArgCount; }
  GetArguments(): ScAddInArgDesc[] { return this.pArgDescs; }
  GetCallerPos(): number { return this.nCallerPos; }
  GetDescription(): string { return this.aDescription; }
  GetCategory(): number { return this.nCategory; }
  GetHelpId(): string { return this.sHelpId; }

  GetCompNames(): { maLocale: string; maName: string }[] {
    if (!this.bCompInitialized) {
      //  read sequence of compatibility names on demand
      const xAddIn = this.aObject;
      if (xAddIn && this.xFunction) {
        const aMethodName = this.xFunction.getName();
        const aCompNames: LocalizedName[] = xAddIn.getCompatibilityNames(aMethodName);
        this.maCompNames = [];
        for (const rCompName of aCompNames) {
          const { Language, Country } = rCompName.Locale;
          this.maCompNames.push({ maLocale: Country ? `${Language}-${Country}` : Language, maName: rCompName.Name });
        }
      }
      this.bCompInitialized = true; // also if not successful
    }
    return this.maCompNames;
  }

  SetCompNames(rNew: { maLocale: string; maName: string }[]): void {
    this.maCompNames = rNew;
    this.bCompInitialized = true;
  }

  /** Takes care of handling an empty name *after* upper local name was set. */
  SetEnglishName(rEnglishName: string): void {
    if (rEnglishName) this.aUpperEnglish = rEnglishName.toUpperCase();
    else {
      // A dumb fallback to not have an empty name, mainly just for the
      // assignment to ScFuncDesc::mxFuncName for the Function Wizard and
      // formula input tooltips.
      this.aUpperEnglish = this.aUpperLocal;
    }
  }

  /** The name in another application for a BCP 47 language tag ("en-US"), or null. */
  GetExcelName(rDestLang: string, bFallbackToAny = true): string | null {
    const rCompNames = this.GetCompNames();
    if (rCompNames.length) {
      const aSearch = rDestLang;
      // First, check exact match without fallback overhead.
      let it = rCompNames.find((rName) => rName.maLocale === aSearch);
      if (it) return it.maName;
      // For "en-US" try the most likely fallback of "en".
      if (aSearch === 'en-US') {
        it = rCompNames.find((rName) => rName.maLocale === 'en');
        if (it) return it.maName;
      }
      // Try match of fallback search with fallback locales,
      // appending also 'en-US' and 'en' to search if not queried.
      const aFallbackSearch = getFallbackStrings(aSearch);
      if (aSearch !== 'en-US') {
        aFallbackSearch.push('en-US');
        if (aSearch !== 'en') aFallbackSearch.push('en');
      }
      for (const rSearch of aFallbackSearch) {
        for (const rCompName of rCompNames) {
          if (getFallbackStrings(rCompName.maLocale).includes(rSearch)) return rCompName.maName;
        }
      }
      if (bFallbackToAny) {
        // Last resort, use first (default) entry.
        return rCompNames[0]!.maName;
      }
    }
    return null;
  }
}

/** LanguageTag::getFallbackStrings(true), reduced: the tag itself and its language. */
function getFallbackStrings(rTag: string): string[] {
  const a = [rTag];
  const nDash = rTag.indexOf('-');
  if (nDash > 0) a.push(rTag.slice(0, nDash));
  return a;
}

export class ScUnoAddInCollection {
  private ppFuncData: (ScUnoAddInFuncData | null)[] = [];
  private pExactHashMap = new Map<string, ScUnoAddInFuncData>(); ///< exact internal name
  private pNameHashMap = new Map<string, ScUnoAddInFuncData>(); ///< internal name upper
  private pLocalHashMap = new Map<string, ScUnoAddInFuncData>(); ///< localized name upper
  private pEnglishHashMap = new Map<string, ScUnoAddInFuncData>(); ///< English name upper
  private bInitialized = false;

  Clear(): void {
    this.ppFuncData = [];
    this.pExactHashMap.clear();
    this.pNameHashMap.clear();
    this.pLocalHashMap.clear();
    this.pEnglishHashMap.clear();
    this.bInitialized = false;
  }

  private Initialize(): void {
    for (const f of aInstalledComponents) {
      try {
        this.ReadFromAddIn(f());
      } catch {
        // an add-in that fails to load is left out
      }
    }
    this.bInitialized = true; // with or without functions
  }

  private ReadFromAddIn(xAddIn: ScAddInComponent): void {
    // The UI language of the port is English.
    xAddIn.setLocale({ Language: 'en', Country: 'US' });

    // Instead, in a second run with 'en-US' obtain English names.
    const aFuncNameData: { aFuncU: string; pData: ScUnoAddInFuncData }[] = [];

    const aServiceName = xAddIn.getServiceName();
    const aMethods = xAddIn.getMethods();
    for (const xFunc of aMethods) {
      const aFuncU = xFunc.getName();
      // stored function name: (service name).(function)
      const aFuncName = aServiceName + '.' + aFuncU;

      let bValid = true;
      let nVisibleCount = 0;
      let nCallerPos = SC_CALLERPOS_NONE;

      const aParams = xFunc.getParameterInfos();
      const nParamCount = aParams.length;
      for (let nParamPos = 0; nParamPos < nParamCount; nParamPos++) {
        const eArgType = aParams[nParamPos]!.eType;
        if (eArgType === SC_ADDINARG_NONE) bValid = false;
        else if (eArgType === SC_ADDINARG_CALLER) nCallerPos = nParamPos;
        else ++nVisibleCount;
      }

      if (bValid) {
        const nCategory = lcl_GetCategory(xAddIn.getProgrammaticCategoryName(aFuncU));
        const sHelpId = aFuncName;
        let aLocalName: string;
        try {
          aLocalName = xAddIn.getDisplayFunctionName(aFuncU);
        } catch {
          aLocalName = '###';
        }
        let aDescription: string;
        try {
          aDescription = xAddIn.getFunctionDescription(aFuncU);
        } catch {
          aDescription = '###';
        }

        const pVisibleArgs: ScAddInArgDesc[] = [];
        for (let nParamPos = 0; nParamPos < nParamCount; nParamPos++) {
          const eArgType = aParams[nParamPos]!.eType;
          if (eArgType !== SC_ADDINARG_CALLER) {
            let aArgName: string;
            try {
              aArgName = xAddIn.getDisplayArgumentName(aFuncU, nParamPos);
            } catch {
              aArgName = '###';
            }
            let aArgDesc: string;
            try {
              aArgDesc = xAddIn.getArgumentDescription(aFuncU, nParamPos);
            } catch {
              aArgDesc = '###';
            }
            const bOptional = eArgType === SC_ADDINARG_VALUE_OR_ARRAY || eArgType === SC_ADDINARG_VARARGS;
            pVisibleArgs.push({ eType: eArgType, aName: aArgName, aDescription: aArgDesc, bOptional, aInternalName: aParams[nParamPos]!.aName });
          }
        }

        const pData = new ScUnoAddInFuncData(aFuncName, aLocalName, aDescription, nCategory, sHelpId, xFunc, xAddIn, nVisibleCount, pVisibleArgs, nCallerPos);
        this.ppFuncData.push(pData);
        if (!this.pExactHashMap.has(pData.GetOriginalName())) this.pExactHashMap.set(pData.GetOriginalName(), pData);
        if (!this.pNameHashMap.has(pData.GetUpperName())) this.pNameHashMap.set(pData.GetUpperName(), pData);
        if (!this.pLocalHashMap.has(pData.GetUpperLocal())) this.pLocalHashMap.set(pData.GetUpperLocal(), pData);
        aFuncNameData.push({ aFuncU, pData });
      }
    }

    for (const rFunc of aFuncNameData) {
      let aEnglishName = '';
      try {
        aEnglishName = xAddIn.getDisplayFunctionName(rFunc.aFuncU);
      } catch {
        // none
      }
      if (!aEnglishName) {
        const aExcel = rFunc.pData.GetExcelName('en-US', false /*bFallbackToAny*/);
        if (aExcel !== null) {
          aEnglishName = aExcel;
          // Check our known suffixes and append if not present. Note this
          // depends on localization (that should not add such suffix, but..)
          // and is really only a last resort.
          if (rFunc.pData.GetLocalName().endsWith('_ADD') && !aEnglishName.endsWith('_ADD')) aEnglishName += '_ADD';
          else if (rFunc.pData.GetLocalName().endsWith('_EXCEL2003') && !aEnglishName.endsWith('_EXCEL2003')) aEnglishName += '_EXCEL2003';
        }
      }
      rFunc.pData.SetEnglishName(aEnglishName); // takes care of handling empty
      if (!this.pEnglishHashMap.has(rFunc.pData.GetUpperEnglish())) this.pEnglishHashMap.set(rFunc.pData.GetUpperEnglish(), rFunc.pData);
    }
  }

  /** The Excel name of a function by its exact name, or null. */
  GetExcelName(rCalcName: string, eDestLang = 'en-US'): string | null {
    const pFuncData = this.GetFuncData(rCalcName);
    if (pFuncData) return pFuncData.GetExcelName(eDestLang);
    return null;
  }

  /** The exact name of the function with an Excel name, or null. */
  GetCalcName(rExcelName: string): string | null {
    if (!this.bInitialized) this.Initialize();
    const aUpperCmp = rExcelName.toUpperCase();
    for (const pFuncData of this.ppFuncData) {
      if (pFuncData) {
        const rNames = pFuncData.GetCompNames();
        //  use the first function that has this name for any language
        if (rNames.some((rName) => rName.maName.toUpperCase() === aUpperCmp)) return pFuncData.GetOriginalName();
      }
    }
    return null;
  }

  /** User entered name. rUpperName MUST already be upper case! */
  FindFunction(rUpperName: string, bLocalFirst: boolean): string {
    if (!this.bInitialized) this.Initialize();
    if (this.ppFuncData.length === 0) return '';

    if (bLocalFirst) {
      // Only scan local names (used for entering formulas).
      const iLook = this.pLocalHashMap.get(rUpperName);
      if (iLook) return iLook.GetOriginalName();
    } else {
      // First scan international programmatic names (used when calling a
      // function).
      let iLook = this.pNameHashMap.get(rUpperName);
      if (iLook) return iLook.GetOriginalName();

      // Then scan English names (as FunctionAccess API could expect).
      iLook = this.pEnglishHashMap.get(rUpperName);
      if (iLook) return iLook.GetOriginalName();

      // After that, scan all local names; either to allow replacing old
      // AddIns with Uno, or for functions where the AddIn did not provide an
      // English name.
      iLook = this.pLocalHashMap.get(rUpperName);
      if (iLook) return iLook.GetOriginalName();
    }
    return '';
  }

  /** The function by its exact name (GetFuncData(rName, bComplete)), or by index for
      enumeration (0 <= nIndex < GetFuncCount()). */
  GetFuncData(rName: string | number): ScUnoAddInFuncData | null {
    if (!this.bInitialized) this.Initialize();
    if (typeof rName === 'number') return rName < this.ppFuncData.length ? this.ppFuncData[rName]! : null;
    //  rName must be the exact internal name
    return this.pExactHashMap.get(rName) ?? null;
  }

  /** The local name of a function by its exact name (unchanged if unknown). */
  LocalizeString(rName: string): string {
    if (!this.bInitialized) this.Initialize();
    //  modify rName - input: exact name
    const iLook = this.pExactHashMap.get(rName);
    return iLook ? iLook.GetUpperLocal() : rName; //TODO: upper?
  }

  GetFuncCount(): number {
    if (!this.bInitialized) this.Initialize();
    return this.ppFuncData.length;
  }
}

/** ScGlobal::GetAddInCollection. */
const ScGlobalAddIns: { pAddInCollection: ScUnoAddInCollection | null } = { pAddInCollection: null };
export function GetAddInCollection(): ScUnoAddInCollection {
  return (ScGlobalAddIns.pAddInCollection ??= new ScUnoAddInCollection());
}

/** A call of an add-in function (ScUnoAddInCall). */
export class ScUnoAddInCall {
  private pFuncData: ScUnoAddInFuncData | null;
  private aArgs: UnoAny[] = [];
  private aVarArg: UnoAny[] = [];
  private xCaller: XPropertySet | null = null;
  private bValidCount = false;
  // result:
  private nErrCode: FormulaError = FormulaError.NoCode; // before function was called
  private bHasString = true;
  private fValue = 0.0;
  private aString = '';
  private xMatrix: ScMatrix | null = null;

  constructor(rColl: ScUnoAddInCollection, rName: string, nParamCount: number) {
    this.pFuncData = rColl.GetFuncData(rName); // need fully initialized data
    if (!this.pFuncData) return;

    const nDescCount = this.pFuncData.GetArgumentCount();
    const pArgs = this.pFuncData.GetArguments();

    //  is aVarArg sequence needed?
    if (nParamCount >= nDescCount && nDescCount > 0 && pArgs[nDescCount - 1]!.eType === SC_ADDINARG_VARARGS) {
      const nVarCount = nParamCount - (nDescCount - 1); // size of last argument
      this.aVarArg = new Array<UnoAny>(nVarCount).fill(undefined);
      this.bValidCount = true;
    } else if (nParamCount <= nDescCount) {
      //  all args behind nParamCount must be optional
      this.bValidCount = true;
      for (let i = nParamCount; i < nDescCount; i++) if (!pArgs[i]!.bOptional) this.bValidCount = false;
    }
    // else invalid (too many arguments)

    if (this.bValidCount) this.aArgs = new Array<UnoAny>(nDescCount).fill(undefined); // sequence must always match function signature
  }

  ValidParamCount(): boolean { return this.bValidCount; }

  GetArgType(nPos: number): ScAddInArgumentType {
    if (this.pFuncData) {
      const nCount = this.pFuncData.GetArgumentCount();
      const pArgs = this.pFuncData.GetArguments();
      // if last arg is sequence, use "any" type
      if (nCount > 0 && nPos >= nCount - 1 && pArgs[nCount - 1]!.eType === SC_ADDINARG_VARARGS) return SC_ADDINARG_VALUE_OR_ARRAY;
      if (nPos < nCount) return pArgs[nPos]!.eType;
    }
    return SC_ADDINARG_VALUE_OR_ARRAY; //TODO: error code !!!!
  }

  NeedsCaller(): boolean { return !!this.pFuncData && this.pFuncData.GetCallerPos() !== SC_CALLERPOS_NONE; }

  SetCaller(rInterface: XPropertySet): void { this.xCaller = rInterface; }

  SetParam(nPos: number, rValue: UnoAny): void {
    if (!this.pFuncData) return;
    const nCount = this.pFuncData.GetArgumentCount();
    const pArgs = this.pFuncData.GetArguments();
    if (nCount > 0 && nPos >= nCount - 1 && pArgs[nCount - 1]!.eType === SC_ADDINARG_VARARGS) {
      const nVarPos = nPos - (nCount - 1);
      if (nVarPos < this.aVarArg.length) this.aVarArg[nVarPos] = rValue;
      // else: wrong argument number
    } else if (nPos < this.aArgs.length) this.aArgs[nPos] = rValue;
    // else: wrong argument number
  }

  ExecuteCall(): void {
    if (!this.pFuncData) return;
    const nCount = this.pFuncData.GetArgumentCount();
    const pArgs = this.pFuncData.GetArguments();
    if (nCount > 0 && pArgs[nCount - 1]!.eType === SC_ADDINARG_VARARGS) {
      //  insert aVarArg as last argument
      this.aArgs[nCount - 1] = this.aVarArg;
    }

    if (this.pFuncData.GetCallerPos() !== SC_CALLERPOS_NONE) {
      const nUserLen = this.aArgs.length;
      let nCallPos = this.pFuncData.GetCallerPos();
      if (nCallPos > nUserLen) {
        // should not happen
        nCallPos = nUserLen;
      }
      const aRealArgs: unknown[] = [...this.aArgs.slice(0, nCallPos), this.xCaller, ...this.aArgs.slice(nCallPos)];
      this.ExecuteCallWithArgs(aRealArgs);
    } else this.ExecuteCallWithArgs(this.aArgs);
  }

  private ExecuteCallWithArgs(rCallArgs: unknown[]): void {
    //  rCallArgs may not match argument descriptions (because of caller)
    const xFunction = this.pFuncData ? this.pFuncData.GetFunction() : null;
    if (!xFunction) return;

    let aAny: UnoAny;
    this.nErrCode = FormulaError.NONE;
    try {
      aAny = xFunction.invoke(rCallArgs);
    } catch (e) {
      if (e instanceof IllegalArgumentException) this.nErrCode = FormulaError.IllegalArgument;
      else if (e instanceof NoConvergenceException) this.nErrCode = FormulaError.NoConvergence;
      else this.nErrCode = FormulaError.NoValue;
    }

    if (this.nErrCode === FormulaError.NONE) this.SetResult(aAny); // convert result to Calc types
  }

  /** Convert the add-in's result to Calc types (SetResult). */
  SetResult(rNewRes: UnoAny): void {
    this.nErrCode = FormulaError.NONE;
    if (rNewRes === undefined || rNewRes === null) {
      this.nErrCode = FormulaError.NotAvailable; // #NA
    } else if (typeof rNewRes === 'number' || typeof rNewRes === 'boolean') {
      this.fValue = Number(rNewRes);
      this.bHasString = false;
    } else if (typeof rNewRes === 'string') {
      this.aString = rNewRes;
      this.bHasString = true;
    } else if (Array.isArray(rNewRes)) {
      // sequence<sequence<…>>: rows of elements, numbers, strings or any
      const pRowSeq = rNewRes as UnoAny[][];
      const nRowCount = pRowSeq.length;
      const nMaxColCount = pRowSeq.reduce((n, r) => Math.max(n, Array.isArray(r) ? r.length : 0), 0);
      if (nMaxColCount && nRowCount) {
        this.xMatrix = new ScMatrix(nMaxColCount, nRowCount, 0.0);
        for (let nRow = 0; nRow < nRowCount; nRow++) {
          const pColArr = Array.isArray(pRowSeq[nRow]) ? pRowSeq[nRow]! : [];
          for (let nCol = 0; nCol < nMaxColCount; nCol++) {
            const v = pColArr[nCol];
            if (typeof v === 'number' || typeof v === 'boolean') this.xMatrix.PutDouble(Number(v), nCol, nRow);
            else if (typeof v === 'string') this.xMatrix.PutString(v, nCol, nRow);
            else if (nCol < pColArr.length) this.xMatrix.PutEmpty(nCol, nRow); // void element of a mixed array
            else this.xMatrix.PutDouble(0.0, nCol, nRow);
          }
        }
      }
      if (!this.xMatrix) this.nErrCode = FormulaError.NoValue; //TODO: code for error in return type???
    } else this.nErrCode = FormulaError.NoValue; // unknown interface
  }

  GetErrCode(): FormulaError { return this.nErrCode; }
  HasString(): boolean { return this.bHasString; }
  HasMatrix(): boolean { return !!this.xMatrix; }
  HasVarRes(): boolean { return false; }
  GetValue(): number { return this.fValue; }
  GetString(): string { return this.aString; }
  GetMatrix(): ScMatrix | null { return this.xMatrix; }
}
