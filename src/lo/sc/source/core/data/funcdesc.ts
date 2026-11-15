// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/funcdesc.hxx reduced
// @upstream sc/source/core/data/funcdesc.cxx reduced
// ScFuncDesc, ScFunctionList, ScFunctionCategory and ScFunctionMgr: the descriptions the function
// wizard, autocomplete and tooltips show. Reduced: no add-ins (legacy or UNO), no last recently
// used or favourite lists, no formula::IFunction* interfaces, names always the en-US UI names
// (ScCompiler::GetNativeSymbol), First()/Next() iteration replaced by arrays.
// Addition: ScFuncDesc::IsImplemented() tells whether this port's interpreter has the opcode
// (ScInterpreter.maOpCodeFuncs), and ScFunctionList/ScFunctionMgr take bOnlyImplemented to offer
// only those; upstream lists every function it describes.
import { FormulaCompiler } from '../../../../formula/source/core/api/FormulaCompiler.ts';
import { ocClose, ocOpen, ocSep, SC_OPCODE_LAST_OPCODE_ID, type OpCode } from '../../../../include/formula/opcode.ts';
import { aDescs, ID_FUNCTION_GRP_ADDINS, RID_FUNCTION_CATEGORIES, type ScFuncDescCore } from '../../../inc/scfuncs.ts';
import { ScInterpreter } from '../tool/interpr4.ts';
import './formulacell.ts'; // registers the opcode implementations (interpr*.ts)

// include/formula/funcvarargs.h
export const VAR_ARGS = 255;
export const PAIRED_VAR_ARGS = VAR_ARGS + VAR_ARGS;

export const SC_FUNCGROUP_COUNT = ID_FUNCTION_GRP_ADDINS;
export const MAX_FUNCCAT = 12; /* maximum number of categories for functions */

export class ScFuncDesc {
  maDefArgNames: string[] = [];
  maDefArgDescs: string[] = [];
  pDefArgFlags: { bOptional: boolean }[] | null = null;
  mxFuncName: string | null = null;
  mxFuncDesc: string | null = null;
  nFIndex = 0;
  nCategory = 0;
  sHelpId = '';
  nArgCount = 0;
  nVarArgsStart = 0;
  nVarArgsLimit = 0;
  bIncomplete = false;
  mbHidden = false;

  GetParamList(): string {
    const sep = FormulaCompiler.GetNativeSymbol(ocSep);
    let aSig = '';
    const nArgCount = this.nArgCount;
    if (nArgCount > 0) {
      if (nArgCount < VAR_ARGS) {
        for (let i = 0; i < nArgCount; i++) {
          aSig += this.maDefArgNames[i];
          if (i !== nArgCount - 1) aSig += sep + ' ';
        }
      } else if (nArgCount < PAIRED_VAR_ARGS) {
        for (let nArg = 0; nArg < this.nVarArgsStart; nArg++) aSig += this.maDefArgNames[nArg] + sep + ' ';
        aSig += this.maDefArgNames[this.nVarArgsStart] + '1' + sep + ' '
          + this.maDefArgNames[this.nVarArgsStart] + '2' + sep + ' ... ';
      } else {
        for (let nArg = 0; nArg < this.nVarArgsStart; nArg++) aSig += this.maDefArgNames[nArg] + sep + ' ';
        const bLet = this.mxFuncName === 'LET';
        aSig += this.maDefArgNames[this.nVarArgsStart] + '1' + sep
          + this.maDefArgNames[this.nVarArgsStart + 1] + (!bLet ? '1' : '2') + sep + ' '
          + this.maDefArgNames[this.nVarArgsStart] + '2' + sep
          + this.maDefArgNames[this.nVarArgsStart + 1] + (!bLet ? '2' : '3') + sep + ' ... ';
      }
    }
    return aSig;
  }

  getSignature(): string {
    let aSig = '';
    if (this.mxFuncName !== null) {
      aSig += this.mxFuncName;
      const aParamList = this.GetParamList();
      if (aParamList.length > 0) {
        // U+00A0 (NBSP) prevents automatic line break
        aSig += '( ' + aParamList + ' ' + ')';
      } else aSig += '()';
    }
    return aSig;
  }

  getFormula(_aArguments: readonly string[]): string {
    const sep = FormulaCompiler.GetNativeSymbol(ocSep);
    let aFormula = '';
    if (this.mxFuncName !== null) {
      aFormula += this.mxFuncName + '(';
      if (this.nArgCount > 0 && _aArguments.length > 0 && _aArguments[0]) {
        aFormula += _aArguments[0];
        for (let i = 1; i < _aArguments.length && _aArguments[i]; i++) aFormula += sep + _aArguments[i];
      }
      aFormula += ')';
    }
    return aFormula;
  }

  GetSuppressedArgCount(): number { return this.nArgCount; }
  getFunctionName(): string { return this.mxFuncName ?? ''; }
  getCategory(): ScFunctionCategory | null { return ScFunctionMgr.Get().getCategory(this.nCategory - 1); }
  getDescription(): string { return this.mxFuncDesc ?? ''; }
  getSuppressedArgumentCount(): number { return this.GetSuppressedArgCount(); }
  getHelpId(): string { return this.sHelpId; }
  isHidden(): boolean { return this.mbHidden; }
  getParameterCount(): number { return this.nArgCount; }
  getVarArgsStart(): number { return this.nVarArgsStart; }
  getVarArgsLimit(): number { return this.nVarArgsLimit; }
  getParameterName(_nPos: number): string { return this.maDefArgNames[_nPos] ?? ''; }
  getParameterDescription(_nPos: number): string { return this.maDefArgDescs[_nPos] ?? ''; }
  isParameterOptional(_nPos: number): boolean { return this.pDefArgFlags?.[_nPos]?.bOptional ?? false; }

  /** Not upstream: whether this port's interpreter implements the function. */
  IsImplemented(): boolean { return ScInterpreter.maOpCodeFuncs.has(this.nFIndex as OpCode); }

  static compareByName(a: ScFuncDesc, b: ScFuncDesc): number {
    return (a.mxFuncName ?? '').localeCompare(b.mxFuncName ?? '', 'en');
  }
}

function ScFuncRes(rEntry: ScFuncDescCore, pDesc: ScFuncDesc): boolean {
  const nOpCode = rEntry.nOpCode;
  const nFunctionFlags = rEntry.nFunctionFlags;
  // Bit 1: entirely suppressed
  // Bit 2: hidden unless used
  const rbSuppressed = (nFunctionFlags & 1) !== 0;
  pDesc.mbHidden = (nFunctionFlags & 2) !== 0;
  pDesc.nCategory = rEntry.nCategory;
  pDesc.sHelpId = rEntry.pHelpId;
  pDesc.nArgCount = rEntry.nArgs;
  let nArgs = pDesc.nArgCount;
  let nVarArgsSet = 0;
  if (nArgs >= PAIRED_VAR_ARGS) {
    nVarArgsSet = 2;
    nArgs -= PAIRED_VAR_ARGS - nVarArgsSet;
  } else if (nArgs >= VAR_ARGS) {
    nVarArgsSet = 1;
    nArgs -= VAR_ARGS - nVarArgsSet;
  }
  if (nArgs) {
    pDesc.nVarArgsStart = nArgs - nVarArgsSet;
    pDesc.nVarArgsLimit = rEntry.nVarArgsLimit;
    pDesc.pDefArgFlags = [];
    for (let i = 0; i < nArgs; ++i) pDesc.pDefArgFlags[i] = { bOptional: Boolean(rEntry.aOptionalArgs[i]) };
  }

  pDesc.mxFuncName = FormulaCompiler.GetNativeSymbol(nOpCode as OpCode);
  pDesc.mxFuncDesc = rEntry.aResource[0] ?? '';

  if (!nArgs) return rbSuppressed;

  pDesc.maDefArgNames = new Array<string>(nArgs).fill('');
  pDesc.maDefArgDescs = new Array<string>(nArgs).fill('');
  for (let i = 0; i < nArgs; ++i) {
    const nIndex = i * 2 + 1;
    if (nIndex < rEntry.aResource.length) pDesc.maDefArgNames[i] = rEntry.aResource[nIndex]!;
    if (nIndex + 1 < rEntry.aResource.length) pDesc.maDefArgDescs[i] = rEntry.aResource[nIndex + 1]!;
    // If empty and variable number of arguments and last parameter and
    // parameter is optional and the previous is not optional, repeat
    // previous parameter name and description.
    if ((!pDesc.maDefArgNames[i] || !pDesc.maDefArgDescs[i])
      && nVarArgsSet > 0 && i > nVarArgsSet && (i === nArgs - 1 || i === nArgs - 2)
      && pDesc.pDefArgFlags![i]!.bOptional) {
      const nPrev = i - nVarArgsSet;
      if (!pDesc.pDefArgFlags![nPrev]!.bOptional) {
        if (!pDesc.maDefArgNames[i]) pDesc.maDefArgNames[i] = pDesc.maDefArgNames[nPrev]!;
        if (!pDesc.maDefArgDescs[i]) pDesc.maDefArgDescs[i] = pDesc.maDefArgDescs[nPrev]!;
        // This also means that variable arguments start one
        // parameter set earlier.
        pDesc.nVarArgsStart -= nVarArgsSet;
      }
    }
  }
  return rbSuppressed;
}

/** All described functions, in opcode order. */
export class ScFunctionList {
  readonly aFunctionList: readonly ScFuncDesc[];

  constructor(bOnlyImplemented = false) {
    const tmpFuncVector: ScFuncDesc[] = [];
    const byOp = new Map(aDescs.map((d) => [d.nOpCode, d]));
    for (let i = 0; i <= SC_OPCODE_LAST_OPCODE_ID; ++i) {
      const pEntry = byOp.get(i);
      if (!pEntry) continue;
      const pDesc = new ScFuncDesc();
      const bSuppressed = ScFuncRes(pEntry, pDesc);
      // Instead of dealing with this exceptional case at 1001 places
      // we simply don't add an entirely suppressed function to the list.
      if (bSuppressed) continue;
      pDesc.nFIndex = i;
      if (bOnlyImplemented && !pDesc.IsImplemented()) continue;
      tmpFuncVector.push(pDesc);
    }
    this.aFunctionList = tmpFuncVector;
  }

  GetCount(): number { return this.aFunctionList.length; }
  GetFunction(nIndex: number): ScFuncDesc | null { return this.aFunctionList[nIndex] ?? null; }
}

export class ScFunctionCategory {
  private m_sName = '';
  readonly m_rCategory: readonly ScFuncDesc[];
  readonly m_nCategory: number;
  constructor(rCategory: readonly ScFuncDesc[], nCategory: number) {
    this.m_rCategory = rCategory;
    this.m_nCategory = nCategory;
  }
  getCount(): number { return this.m_rCategory.length; }
  getName(): string {
    if (!this.m_sName) this.m_sName = ScFunctionMgr.GetCategoryName(this.m_nCategory);
    return this.m_sName;
  }
  getFunction(_nPos: number): ScFuncDesc | null { return this.m_rCategory[_nPos] ?? null; }
  getNumber(): number { return this.m_nCategory; }
}

/** The functions by category, each sorted by name; aCatLists[0] is "All". */
export class ScFunctionMgr {
  readonly aCatLists: ScFuncDesc[][] = [];
  private readonly m_aCategories = new Map<number, ScFunctionCategory>();
  private readonly maByName = new Map<string, ScFuncDesc>();

  constructor(pFuncList: ScFunctionList) {
    for (let i = 0; i < MAX_FUNCCAT; ++i) this.aCatLists.push([]);
    // Retrieve all functions, store in cumulative ("All") category
    for (const pDesc of pFuncList.aFunctionList) this.aCatLists[0]!.push(pDesc);
    // Sort functions in cumulative category by name
    this.aCatLists[0]!.sort(ScFuncDesc.compareByName);
    // Fill categories with the corresponding functions (still sorted by name)
    for (const elemList of this.aCatLists[0]!) {
      if (elemList.nCategory < MAX_FUNCCAT) this.aCatLists[elemList.nCategory]!.push(elemList);
      this.maByName.set(elemList.getFunctionName().toUpperCase(), elemList);
    }
  }

  private static s_pAll: ScFunctionMgr | null = null;
  private static s_pImplemented: ScFunctionMgr | null = null;
  /** ScGlobal::GetStarCalcFunctionMgr; with bOnlyImplemented only this port's implemented functions. */
  static Get(bOnlyImplemented = false): ScFunctionMgr {
    if (bOnlyImplemented) return (ScFunctionMgr.s_pImplemented ??= new ScFunctionMgr(new ScFunctionList(true)));
    return (ScFunctionMgr.s_pAll ??= new ScFunctionMgr(new ScFunctionList(false)));
  }

  /** Get(nFIndex): the description of an opcode, or by (case-insensitive) name. */
  GetByOpCode(nFIndex: number): ScFuncDesc | null { return this.aCatLists[0]!.find((p) => p.nFIndex === nFIndex) ?? null; }
  GetByName(rName: string): ScFuncDesc | null { return this.maByName.get(rName.toUpperCase()) ?? null; }

  /** The functions of a category (0 is all), sorted by name. */
  GetFunctions(nCategory = 0): readonly ScFuncDesc[] { return this.aCatLists[nCategory] ?? []; }

  getCount(): number { return MAX_FUNCCAT - 1; }

  getCategory(nCategory: number): ScFunctionCategory | null {
    if (nCategory < MAX_FUNCCAT - 1) {
      let p = this.m_aCategories.get(nCategory);
      if (!p) this.m_aCategories.set(nCategory, p = new ScFunctionCategory(this.aCatLists[nCategory + 1]!, nCategory)); // aCatLists[0] is "all"
      return p;
    }
    return null;
  }

  getFunctionIndex(_pDesc: ScFuncDesc | null): number { return _pDesc ? _pDesc.nFIndex : 0; }

  static GetCategoryName(_nCategoryNumber: number): string {
    if (_nCategoryNumber >= SC_FUNCGROUP_COUNT) return '';
    return RID_FUNCTION_CATEGORIES[_nCategoryNumber]!;
  }

  getSingleToken(eToken: 'eOk' | 'eClose' | 'eSep'): string {
    switch (eToken) {
      case 'eOk': return FormulaCompiler.GetNativeSymbolChar(ocOpen);
      case 'eClose': return FormulaCompiler.GetNativeSymbolChar(ocClose);
      case 'eSep': return FormulaCompiler.GetNativeSymbolChar(ocSep);
    }
  }
}
