// SPDX-License-Identifier: MPL-2.0
// @upstream include/formula/FormulaCompiler.hxx reduced
// @upstream formula/source/core/api/FormulaCompiler.cxx reduced
// FormulaCompiler: the opcode maps of the grammars (native en-US UI names, English, ODFF, PODF,
// OOXML, API), the recursive descent that turns the token code into RPN (CompileTokenArray) with
// jump commands, the ForceArray propagation, and the conversion of a token array back to a
// string (CreateStringFromTokenArray). Left out: the auto-correction of the entered formula
// (bAutoCorrect), implicit intersection computation (mbComputeII, HandleIIOpCode), add-in
// mappings, the UNO opcode map sequences, LibreOfficeKit per-language maps, and the
// PODF/OOXML missing-argument rewriting.
import { FormulaError, isPublishedFormulaError } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar, FormulaLanguage } from '../../../../include/formula/grammar.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import {
  ocAdd, ocAnd, ocArrayClose, ocArrayColSep, ocArrayOpen, ocArrayRowSep, ocBad, ocChoose, ocClose, ocColRowName, ocColRowNameAuto, ocDBArea,
  ocErrDivZero, ocErrNA, ocErrName, ocErrNull, ocErrNum, ocErrRef, ocErrValue, ocExternal, ocFalse, ocIf, ocIfError, ocIfNA, ocIntersect, ocLet,
  ocMacro, ocMatRef, ocMissing, ocMul, ocName, ocNone, ocOpen, ocOr, ocPercentSign, ocPow, ocPush, ocRange, ocSep, ocSpaces, ocStop,
  ocStringName, ocStringXML, ocSub, ocDiv, ocAmpersand, ocEqual, ocGreaterEqual, ocTableRef, ocTableRefOpen, ocTrue, ocUnion, ocWhitespace,
  ocSubTotal, ocAggregate, ocNot, ocNoName, ocTTT, ocDebugVar, ocEasterSunday, ocIsoWeeknum, ocWeeknumOOo,
  SC_OPCODE_LAST_OPCODE_ID, SC_OPCODE_START_1_PAR, SC_OPCODE_START_2_PAR, SC_OPCODE_START_BIN_OP, SC_OPCODE_START_NO_PAR,
  SC_OPCODE_START_UN_OP, SC_OPCODE_STOP_1_PAR, SC_OPCODE_STOP_2_PAR, SC_OPCODE_STOP_BIN_OP, SC_OPCODE_STOP_NO_PAR, SC_OPCODE_STOP_UN_OP,
  type OpCode,
} from '../../../../include/formula/opcode.ts';
import {
  RID_STRLIST_FUNCTION_NAMES, RID_STRLIST_FUNCTION_NAMES_ENGLISH, RID_STRLIST_FUNCTION_NAMES_ENGLISH_API, RID_STRLIST_FUNCTION_NAMES_ENGLISH_ODFF,
  RID_STRLIST_FUNCTION_NAMES_ENGLISH_OOXML, RID_STRLIST_FUNCTION_NAMES_ENGLISH_PODF, RID_STRLIST_FUNCTION_NAMES_SYMBOLS,
} from '../../../inc/core_resource.ts';
import { doubleToUString, rtl_math_DecimalPlaces_Max, rtl_math_StringFormat } from '../../../../sal/rtl/math.ts';
import {
  FORMULA_MAXJUMPCOUNT, FORMULA_MAXPARAMS, FORMULA_MAXTOKENS, FormulaByteToken, FormulaToken, FormulaTokenArray, FormulaTokenArrayPlainIterator,
  IsOpCodeJumpCommand, ParamClass, ScRecalcMode, svByte, svDouble, svDoubleRef, svError, svExternal, svFAP, svIndex, svJump, svMatrix,
  svMatrixCell, svMissing, svSep, svSingleRef, svString, svExternalName, svExternalSingleRef, svExternalDoubleRef,
} from './token.ts';

export { IsOpCodeJumpCommand };

/** SeparatorType */
const SeparatorType = { RESOURCE_BASE: 0, SEMICOLON_BASE: 1 } as const;
type SeparatorType = (typeof SeparatorType)[keyof typeof SeparatorType];

/** Mappings from strings to OpCodes and vice versa. */
export class OpCodeMap {
  /** Hash map of symbols, OUString -> OpCode */
  private maHashMap = new Map<string, OpCode>();
  /** Array of symbols, OpCode -> OUString, offset==OpCode */
  private mpTable: string[];
  private readonly mnSymbols: number;
  private readonly mbCore: boolean;
  private mbEnglish: boolean;
  private meGrammar: FormulaGrammar.Grammar;
  private mbEnglishLocale: boolean;

  constructor(nSymbols: number, bCore: boolean, eGrammar: FormulaGrammar.Grammar) {
    this.mpTable = new Array<string>(nSymbols).fill('');
    this.mnSymbols = nSymbols;
    this.mbCore = bCore;
    this.meGrammar = eGrammar;
    this.mbEnglish = FormulaGrammar.isEnglish(eGrammar);
    this.mbEnglishLocale = this.mbEnglish; // en-US UI: native is English locale too
  }

  /** Copy mappings from r into this map, effectively replacing this map. */
  copyFrom(r: OpCodeMap): void {
    this.maHashMap = new Map(r.maHashMap);
    this.mpTable = [...r.mpTable];
    this.mbEnglish = r.mbEnglish;
    this.mbEnglishLocale = r.mbEnglishLocale;
    this.meGrammar = r.meGrammar;
  }

  /// Get the symbol String -> OpCode hash map for finds.
  getHashMap(): Map<string, OpCode> { return this.maHashMap; }

  /// Get the symbol string matching an OpCode.
  getSymbol(eOp: OpCode): string {
    if (eOp < this.mnSymbols) return this.mpTable[eOp]!;
    return '';
  }

  /// Get the first character of the symbol string matching an OpCode.
  getSymbolChar(eOp: OpCode): string { return this.getSymbol(eOp)[0] ?? '\0'; }

  /// Get the grammar.
  getGrammar(): FormulaGrammar.Grammar { return this.meGrammar; }
  /// Get the symbol count.
  getSymbolCount(): number { return this.mnSymbols; }
  /** Are these English symbols, as opposed to native language (which may be English as well)? */
  isEnglish(): boolean { return this.mbEnglish; }
  /** Are these English symbols and is the locale English as well? */
  isEnglishLocale(): boolean { return this.mbEnglishLocale; }
  /// Is it an ODF 1.1 compatibility mapping?
  isPODF(): boolean { return FormulaGrammar.isPODF(this.meGrammar); }
  /// Is it an ODFF / ODF 1.2 mapping?
  isODFF(): boolean { return FormulaGrammar.isODFF(this.meGrammar); }
  /// Is it an OOXML mapping?
  isOOXML(): boolean { return FormulaGrammar.isOOXML(this.meGrammar); }
  /// Does it have external symbol/name mappings?
  hasExternals(): boolean { return false; }
  /// Is it the core map?
  isCore(): boolean { return this.mbCore; }

  /// Put entry of symbol String and OpCode pair.
  putOpCode(rStr: string, eOp: OpCode): void {
    if (0 < eOp && eOp < this.mnSymbols) {
      let bPutOp = this.mpTable[eOp] === '';
      let bRemoveFromMap = false;
      if (!bPutOp) {
        switch (eOp) {
          // These OpCodes are meant to overwrite and also remove an
          // existing mapping.
          case OC.ocCurrency:
            bPutOp = true;
            bRemoveFromMap = true;
            break;
          // These separator OpCodes are meant to overwrite and also
          // remove an existing mapping if it is not used for one of the
          // other separators.
          case ocArrayColSep:
            bPutOp = true;
            bRemoveFromMap = this.mpTable[ocArrayRowSep] !== this.mpTable[eOp] && this.mpTable[ocSep] !== this.mpTable[eOp];
            break;
          case ocArrayRowSep:
            bPutOp = true;
            bRemoveFromMap = this.mpTable[ocArrayColSep] !== this.mpTable[eOp] && this.mpTable[ocSep] !== this.mpTable[eOp];
            break;
          // For ocSep keep the ";" in map but remove any other if it is
          // not used for ocArrayColSep or ocArrayRowSep.
          case ocSep:
            bPutOp = true;
            bRemoveFromMap = this.mpTable[eOp] !== ';' && this.mpTable[ocArrayColSep] !== this.mpTable[eOp] && this.mpTable[ocArrayRowSep] !== this.mpTable[eOp];
            break;
          // These OpCodes are known to be duplicates in the Excel
          // external API mapping because of different parameter counts
          // in different BIFF versions. Names are identical and entries
          // are ignored.
          case OC.ocLinest:
          case OC.ocTrend:
          case OC.ocLogest:
          case OC.ocGrowth:
          case OC.ocTrunc:
          case OC.ocFixed:
          case OC.ocGetDayOfWeek:
          case OC.ocHLookup:
          case OC.ocVLookup:
          case OC.ocGetDiffDate360:
            if (rStr === this.mpTable[eOp]) return;
            break;
          default:
            break;
        }
      }

      // Case preserving opcode -> string, upper string -> opcode
      if (bRemoveFromMap) {
        const aUpper = this.mpTable[eOp]!.toUpperCase();
        // Ensure we remove a mapping only for the requested OpCode.
        if (this.maHashMap.get(aUpper) === eOp) this.maHashMap.delete(aUpper);
      }
      if (bPutOp) this.mpTable[eOp] = rStr;
      const aUpper = rStr.toUpperCase();
      if (!this.maHashMap.has(aUpper)) this.maHashMap.set(aUpper, eOp);
    }
  }
}

/** OpCodeList: fills a map from a resource table (formula/source/core/api/FormulaCompiler.cxx). */
function OpCodeList(pSymbols: readonly (readonly [string, number])[], xMap: OpCodeMap, eSepType: SeparatorType = SeparatorType.SEMICOLON_BASE): void {
  const getOpCodeString = (nOp: number): string | null => {
    switch (nOp) {
      case OC.ocSep:
        if (eSepType === SeparatorType.SEMICOLON_BASE) return ';';
        break;
      case ocArrayColSep:
        if (eSepType === SeparatorType.SEMICOLON_BASE) return ';';
        break;
      case ocArrayRowSep:
        if (eSepType === SeparatorType.SEMICOLON_BASE) return '|';
        break;
    }
    return null;
  };
  const putDefaultOpCode = (nOp: number) => {
    const p = pSymbols.find((s) => s[1] === nOp);
    if (!p) return;
    xMap.putOpCode(p[0], nOp);
  };
  for (let i = 0; i <= SC_OPCODE_LAST_OPCODE_ID; ++i) {
    if (eSepType === SeparatorType.RESOURCE_BASE) putDefaultOpCode(i);
    else {
      const aOpStr = getOpCodeString(i);
      if (aOpStr !== null) xMap.putOpCode(aOpStr, i);
      else putDefaultOpCode(i);
    }
  }
}

let aSymbolMapNative: OpCodeMap | null = null;
function lcl_fillNativeSymbols(bDestroy = false): OpCodeMap {
  if (bDestroy) aSymbolMapNative = null;
  if (!aSymbolMapNative) {
    // Core
    aSymbolMapNative = new OpCodeMap(SC_OPCODE_LAST_OPCODE_ID + 1, true, FormulaGrammar.GRAM_NATIVE_UI);
    OpCodeList(RID_STRLIST_FUNCTION_NAMES_SYMBOLS, aSymbolMapNative);
    OpCodeList(RID_STRLIST_FUNCTION_NAMES, aSymbolMapNative);
    // No AddInMap for native core mapping.
    // The en-US separators of ScFormulaOptions::GetDefaultFormulaSeparators (decimal separator '.').
    aSymbolMapNative.putOpCode(',', ocSep);
    aSymbolMapNative.putOpCode(',', ocArrayColSep);
    aSymbolMapNative.putOpCode(';', ocArrayRowSep);
  }
  return aSymbolMapNative;
}

const maps = new Map<number, OpCodeMap>();
function loadSymbols(pSymbols: readonly (readonly [string, number])[], eGrammar: FormulaGrammar.Grammar, eSepType: SeparatorType = SeparatorType.SEMICOLON_BASE): OpCodeMap {
  // not Core
  const rxMap = new OpCodeMap(SC_OPCODE_LAST_OPCODE_ID + 1, eGrammar !== FormulaGrammar.GRAM_ODFF, eGrammar);
  OpCodeList(pSymbols, rxMap, eSepType);
  return rxMap;
}

/** A stacked token array, for named expressions expanded during compilation (FormulaArrayStack). */
interface FormulaArrayStack { pNext: FormulaArrayStack | null; pArr: FormulaTokenArray; nIndex: number; mpLastToken: FormulaToken | null; bTemp: boolean }

export class FormulaCompiler {
  protected nCurrentFactorParam = 0;
  protected pArr: FormulaTokenArray | null;
  protected maArrIterator: FormulaTokenArrayPlainIterator;
  protected mpLastToken: FormulaToken | null = null;
  protected mpToken: FormulaToken = new FormulaByteToken(ocStop);
  protected pCurrentFactorToken: FormulaToken | null = null;
  /** The RPN being built; pCode[-1] of upstream is maRPN[pc - 1]. */
  protected maRPN: FormulaToken[] = [];
  protected pc = 0;
  protected pStack: FormulaArrayStack | null = null;
  protected eLastOp: OpCode = ocPush;
  protected nRecursion = 0;
  protected meGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_UNSPECIFIED;
  protected mxSymbols: OpCodeMap;
  protected bAutoCorrect = false;
  protected glSubTotal = false;
  protected needsRPNTokenCheck = false;
  protected mbJumpCommandReorder = true;
  protected mbStopOnError = true;
  protected mbMatrixFlag: boolean;

  constructor(rArr?: FormulaTokenArray | null, bMatrixFlag = false) {
    this.pArr = rArr ?? null;
    this.maArrIterator = new FormulaTokenArrayPlainIterator(rArr ?? new FormulaTokenArray());
    this.mbMatrixFlag = bMatrixFlag;
    this.mxSymbols = lcl_fillNativeSymbols();
  }

  /** Get OpCodeMap for formula language. */
  GetOpCodeMap(nLanguage: number): OpCodeMap {
    let m = maps.get(nLanguage);
    if (m) return m;
    switch (nLanguage) {
      case FormulaLanguage.ODFF:
        m = loadSymbols(RID_STRLIST_FUNCTION_NAMES_ENGLISH_ODFF, FormulaGrammar.GRAM_ODFF, SeparatorType.RESOURCE_BASE);
        break;
      case FormulaLanguage.ODF_11:
        m = loadSymbols(RID_STRLIST_FUNCTION_NAMES_ENGLISH_PODF, FormulaGrammar.GRAM_PODF, SeparatorType.RESOURCE_BASE);
        break;
      case FormulaLanguage.ENGLISH:
        m = loadSymbols(RID_STRLIST_FUNCTION_NAMES_ENGLISH, FormulaGrammar.GRAM_ENGLISH);
        break;
      case FormulaLanguage.NATIVE:
        return lcl_fillNativeSymbols();
      case FormulaLanguage.XL_ENGLISH:
        m = loadSymbols(RID_STRLIST_FUNCTION_NAMES_ENGLISH, FormulaGrammar.GRAM_ENGLISH);
        // TODO: For now, just replace the separators to the Excel English
        // variants. Later, if we want to properly map Excel functions with Calc
        // functions, we'll need to do a little more work here.
        m.putOpCode(',', ocSep);
        m.putOpCode(',', ocArrayColSep);
        m.putOpCode(';', ocArrayRowSep);
        break;
      case FormulaLanguage.OOXML:
        m = loadSymbols(RID_STRLIST_FUNCTION_NAMES_ENGLISH_OOXML, FormulaGrammar.GRAM_OOXML, SeparatorType.RESOURCE_BASE);
        break;
      case FormulaLanguage.API:
        m = loadSymbols(RID_STRLIST_FUNCTION_NAMES_ENGLISH_API, FormulaGrammar.GRAM_API, SeparatorType.RESOURCE_BASE);
        break;
      default:
        return lcl_fillNativeSymbols();
    }
    maps.set(nLanguage, m);
    return m;
  }

  /** Get current OpCodeMap in effect. */
  GetCurrentOpCodeMap(): OpCodeMap { return this.mxSymbols; }

  static GetNativeSymbol(eOp: OpCode): string { return lcl_fillNativeSymbols().getSymbol(eOp); }
  static GetNativeSymbolChar(eOp: OpCode): string { return FormulaCompiler.GetNativeSymbol(eOp)[0] ?? '\0'; }

  /** Set the separators of the native (UI) map: the parameter separator and the inline array
      column and row separators. */
  static UpdateSeparatorsNative(rSep: string, rArrayColSep: string, rArrayRowSep: string): void {
    const xSymbolsNative = lcl_fillNativeSymbols();
    xSymbolsNative.putOpCode(rSep, ocSep);
    xSymbolsNative.putOpCode(rArrayColSep, ocArrayColSep);
    xSymbolsNative.putOpCode(rArrayRowSep, ocArrayRowSep);
  }

  static ResetNativeSymbols(): void { lcl_fillNativeSymbols(true); }

  /** Get OpCode for English symbol. */
  GetEnglishOpCode(rName: string): OpCode {
    const xMap = this.GetOpCodeMap(FormulaLanguage.ENGLISH);
    return xMap.getHashMap().get(rName.toUpperCase()) ?? ocNone;
  }

  static IsOpCodeVolatile(eOp: OpCode): boolean {
    switch (eOp) {
      // no parameters:
      case OC.ocRandom:
      case OC.ocGetActDate:
      case OC.ocGetActTime:
      // one parameter:
      case OC.ocFormula:
      case OC.ocInfo:
      // more than one parameters:
      // ocIndirect otherwise would have to do
      // StopListening and StartListening on a reference for every
      // interpreted value.
      case OC.ocIndirect:
      // ocOffset results in indirect references.
      case OC.ocOffset:
      // ocDebugVar shows internal value that may change as the internal state changes.
      case ocDebugVar:
      // ocRandArray is a volatile function.
      case OC.ocRandArray:
        return true;
      default:
        return false;
    }
  }

  static IsOpCodeJumpCommand(eOp: OpCode): boolean { return IsOpCodeJumpCommand(eOp); }

  static IsMatrixFunction(eOpCode: OpCode): boolean {
    switch (eOpCode) {
      case OC.ocDde:
      case OC.ocGrowth:
      case OC.ocTrend:
      case OC.ocLogest:
      case OC.ocLinest:
      case OC.ocFrequency:
      case OC.ocMatSequence:
      case OC.ocMatTrans:
      case OC.ocMatMult:
      case OC.ocMatInv:
      case OC.ocMatrixUnit:
      case OC.ocModalValue_Multi:
      case OC.ocFourier:
      case OC.ocFilter:
      case OC.ocSort:
      case OC.ocSortBy:
      case OC.ocRandArray:
      case OC.ocChooseCols:
      case OC.ocChooseRows:
      case OC.ocDrop:
      case OC.ocExpand:
      case OC.ocHStack:
      case OC.ocVStack:
      case OC.ocTake:
      case OC.ocTextSplit:
      case OC.ocToCol:
      case OC.ocToRow:
      case OC.ocUnique:
      case ocLet:
      case OC.ocWrapCols:
      case OC.ocWrapRows:
        return true;
      default:
    }
    return false;
  }

  // Remove quotes, escaped quotes are unescaped.
  static DeQuote(rStr: string): string | null {
    const nLen = rStr.length;
    if (nLen > 1 && rStr[0] === '\'' && rStr[nLen - 1] === '\'') return rStr.slice(1, nLen - 1).replaceAll('\'\'', '\'');
    return null;
  }

  GetGrammar(): FormulaGrammar.Grammar { return this.meGrammar; }

  /** Sets the implementation's grammar and opcode map. */
  SetGrammar(eGrammar: FormulaGrammar.Grammar): void {
    const nLang = FormulaGrammar.extractFormulaLanguage(eGrammar);
    this.mxSymbols = nLang === FormulaLanguage.NATIVE ? lcl_fillNativeSymbols() : this.GetOpCodeMap(nLang);
    this.meGrammar = eGrammar;
  }

  EnableJumpCommandReorder(bEnable: boolean): void { this.mbJumpCommandReorder = bEnable; }
  EnableStopOnError(bEnable: boolean): void { this.mbStopOnError = bEnable; }

  /** Error constant from a name (#DIV/0! or a detailed #ERRxxx!). */
  GetErrorConstant(rName: string): FormulaError {
    let nError: FormulaError = FormulaError.NONE;
    const eOp = this.mxSymbols.getHashMap().get(rName);
    if (eOp !== undefined) {
      switch (eOp) {
        // Not all may make sense in a formula, but these we know as
        // opcodes.
        case ocErrNull: nError = FormulaError.NoCode; break;
        case ocErrDivZero: nError = FormulaError.DivisionByZero; break;
        case ocErrValue: nError = FormulaError.NoValue; break;
        case ocErrRef: nError = FormulaError.NoRef; break;
        case ocErrName: nError = FormulaError.NoName; break;
        case ocErrNum: nError = FormulaError.IllegalFPOperation; break;
        case ocErrNA: nError = FormulaError.NotAvailable; break;
        default:
      }
    } else {
      // Per convention recognize detailed "#ERRxxx!" constants, always
      // untranslated. Error numbers are sal_uInt16 so at most 5 decimal
      // digits.
      if (/^#ERR/i.test(rName) && rName.length <= 10 && rName[rName.length - 1] === '!') {
        const nErr = Number(rName.slice(4, rName.length - 1));
        if (Number.isInteger(nErr) && 0 < nErr && nErr <= 0xffff && isPublishedFormulaError(nErr as FormulaError)) nError = nErr as FormulaError;
      }
    }
    return nError;
  }

  AppendErrorConstant(nError: FormulaError): string {
    let eOp: OpCode;
    switch (nError) {
      case FormulaError.NoCode: eOp = ocErrNull; break;
      case FormulaError.DivisionByZero: eOp = ocErrDivZero; break;
      case FormulaError.NoValue: eOp = ocErrValue; break;
      case FormulaError.NoRef: eOp = ocErrRef; break;
      case FormulaError.NoName: eOp = ocErrName; break;
      case FormulaError.IllegalFPOperation: eOp = ocErrNum; break;
      case FormulaError.NotAvailable: eOp = ocErrNA; break;
      default:
        // Per convention create detailed "#ERRxxx!" constants, always
        // untranslated.
        return `#ERR${nError}!`;
    }
    return this.mxSymbols.getSymbol(eOp);
  }

  // --- RPN creation by recursion -----------------------------------------------------------------

  /** Overridden by ScCompiler. */
  SetError(nError: FormulaError): void { void nError; }
  ExtendRangeReference(rTok1: FormulaToken, rTok2: FormulaToken): FormulaToken | null { void rTok1; void rTok2; return null; }
  HandleExternalReference(_aToken: FormulaToken): boolean { return true; }
  HandleStringName(): boolean { return true; }
  HandleRange(): boolean { return true; }
  HandleColRowName(): boolean { return true; }
  HandleDbData(): boolean { return true; }
  HandleTableRef(): boolean { return true; }
  PostProcessCode(): void {}
  AnnotateOperands(): void {}
  GetForceArrayParameter(_pToken: FormulaToken, _nParam: number): ParamClass { return ParamClass.Unknown; }

  protected GetToken(): boolean {
    const nRecursionMax = 100;
    this.nRecursion++;
    try {
      if (this.nRecursion > nRecursionMax) {
        this.SetError(FormulaError.StackOverflow);
        this.mpLastToken = this.mpToken = new FormulaByteToken(ocStop);
        return false;
      }
      let bStop = false;
      const pArr = this.pArr!;
      if (pArr.GetCodeError() !== FormulaError.NONE && this.mbStopOnError) bStop = true;
      else {
        let pSpacesToken: FormulaToken | null = null;
        let nWasColRowName: number;
        if (pArr.OpCodeBefore(this.maArrIterator.GetIndex()) === ocColRowName) nWasColRowName = 1;
        else nWasColRowName = 0;
        let eTmpOp: OpCode;
        let t = this.maArrIterator.Next();
        while (t && ((eTmpOp = t.GetOpCode()) === ocSpaces || eTmpOp === ocWhitespace)) {
          if (eTmpOp === ocSpaces) {
            // For significant whitespace remember last ocSpaces token.
            // Usually there's only one even for multiple spaces.
            pSpacesToken = t;
            if (nWasColRowName) nWasColRowName++;
          }
          t = this.maArrIterator.Next();
        }
        if (!t) {
          if (this.pStack) {
            this.PopTokenArray();
            // mpLastToken was popped as well and corresponds to the
            // then current last token during PushTokenArray(), e.g. for
            // HandleRange().
            return this.GetToken();
          } else bStop = true;
        } else {
          this.mpToken = t;
          if (nWasColRowName >= 2 && this.mpToken.GetOpCode() === ocColRowName) {
            // convert an ocSpaces to ocIntersect in RPN
            this.mpLastToken = this.mpToken = new FormulaByteToken(ocIntersect);
            this.maArrIterator.StepBack(); // we advanced to the second ocColRowName, step back
          } else if (pSpacesToken && FormulaGrammar.isExcelSyntax(this.meGrammar) && this.mpLastToken
            && isPotentialRangeType(this.mpToken, false, true)
            && (this.mpLastToken.GetOpCode() === ocClose || isPotentialRangeType(this.mpLastToken, false, false))) {
            // Let IntersectionLine() <- Factor() decide how to treat this,
            // once the actual arguments are determined in RPN.
            this.mpLastToken = this.mpToken = pSpacesToken;
            this.maArrIterator.StepBack(); // step back from next non-spaces token
            return true;
          }
        }
      }
      if (bStop) {
        this.mpLastToken = this.mpToken = new FormulaByteToken(ocStop);
        return false;
      }

      // Remember token for next round and any PushTokenArray() calls that may
      // occur in handlers.
      this.mpLastToken = this.mpToken;

      if (this.mpToken.IsExternalRef()) return this.HandleExternalReference(this.mpToken);
      switch (this.mpToken.GetOpCode()) {
        case ocSubTotal:
        case ocAggregate:
          this.glSubTotal = true;
          break;
        case ocStringName:
          return this.HandleStringName();
        case ocName:
          if (this.HandleRange()) {
            this.needsRPNTokenCheck = true;
            return true;
          }
          return false;
        case ocColRowName:
          return this.HandleColRowName();
        case ocDBArea:
          return this.HandleDbData();
        case ocTableRef:
          return this.HandleTableRef();
        default:
      }
      return true;
    } finally {
      this.nRecursion--;
    }
  }

  protected NextToken(): OpCode {
    if (!this.GetToken()) return ocStop;
    let eOp = this.mpToken.GetOpCode();
    const eLastOp = this.eLastOp;
    // There must be an operator before a push
    if ((eOp === ocPush || eOp === ocColRowNameAuto) && !(eLastOp === ocOpen || eLastOp === ocSep || (SC_OPCODE_START_BIN_OP <= eLastOp && eLastOp < SC_OPCODE_STOP_UN_OP)))
      this.SetError(FormulaError.OperatorExpected);
    // Operator and Plus => operator
    if (eOp === ocAdd && (eLastOp === ocOpen || eLastOp === ocSep || (SC_OPCODE_START_BIN_OP <= eLastOp && eLastOp < SC_OPCODE_STOP_UN_OP))) {
      this.nRecursion++;
      try { eOp = this.NextToken(); } finally { this.nRecursion--; }
    } else {
      // Before an operator there must not be another operator, with the
      // exception of AND and OR.
      if (eOp !== ocAnd && eOp !== ocOr && SC_OPCODE_START_BIN_OP <= eOp && eOp < SC_OPCODE_STOP_BIN_OP
        && (eLastOp === ocOpen || eLastOp === ocSep || (SC_OPCODE_START_BIN_OP <= eLastOp && eLastOp < SC_OPCODE_STOP_UN_OP))) {
        this.SetError(FormulaError.VariableExpected);
      }
      // Nasty, ugly, horrific, terrifying... significant whitespace...
      if (eOp === ocSpaces && FormulaGrammar.isExcelSyntax(this.meGrammar)) {
        // Fake an intersection op as last op for the next round, but at
        // least roughly check if it could make sense at all.
        const pPrev = this.maArrIterator.PeekPrevNoSpaces();
        if (pPrev && isPotentialRangeType(pPrev, false, false)) {
          const pNext = this.maArrIterator.PeekNextNoSpaces();
          if (pNext && isPotentialRangeType(pNext, false, true)) this.eLastOp = ocIntersect;
          else this.eLastOp = eOp;
        } else this.eLastOp = eOp;
      } else this.eLastOp = eOp;
    }
    return eOp;
  }

  protected PutCode(p: FormulaToken): FormulaToken {
    if (this.pc >= FORMULA_MAXTOKENS - 1) {
      if (this.pc === FORMULA_MAXTOKENS - 1) {
        p = new FormulaByteToken(ocStop);
        this.maRPN[this.pc++] = p;
      }
      this.SetError(FormulaError.CodeOverflow);
      return p;
    }
    if (this.pArr!.GetCodeError() !== FormulaError.NONE && this.mbJumpCommandReorder) return p;
    this.ForceArrayOperator(p);
    this.maRPN[this.pc++] = p;
    return p;
  }

  /** pCode[n] with negative n relative to the end. */
  protected code(n: number): FormulaToken | null { return this.pc + n >= 0 ? (this.maRPN[this.pc + n] ?? null) : null; }

  /** CurrentFactor::operator=: sets the current factor token. */
  private setCurrentFactor(r: FormulaToken): void {
    this.ForceArrayOperator(r);
    this.pCurrentFactorToken = r;
    this.nCurrentFactorParam = 0;
  }

  protected Factor(): void {
    if (this.pArr!.GetCodeError() !== FormulaError.NONE && this.mbStopOnError) return;

    // CurrentFactor pFacToken( this );
    const pPrevFac = this.pCurrentFactorToken;
    const nPrevParam = this.nCurrentFactorParam;
    try {
      this.FactorImpl();
    } finally {
      this.pCurrentFactorToken = pPrevFac;
      this.nCurrentFactorParam = nPrevParam;
    }
  }

  private FactorImpl(): void {
    const pArr = this.pArr!;
    let eOp = this.mpToken.GetOpCode();
    if (eOp === ocPush || eOp === ocColRowNameAuto || eOp === ocMatRef || eOp === ocDBArea || eOp === ocTableRef
      || (!this.mbJumpCommandReorder && (eOp === ocName || eOp === ocColRowName || eOp === ocBad))) {
      this.PutCode(this.mpToken);
      eOp = this.NextToken();
      if (eOp === ocOpen) {
        // PUSH( is an error that may be caused by an unknown function.
        this.SetError(this.mpToken.GetType() === svString || this.mpToken.GetType() === svSingleRef ? FormulaError.NoName : FormulaError.OperatorExpected);
      }
    } else if (eOp === ocOpen) {
      this.NextToken();
      eOp = this.Expression();
      while (eOp === ocSep && (pArr.GetCodeError() === FormulaError.NONE || !this.mbStopOnError)) {
        // range list  (A1;A2)  converted to  (A1~A2)
        const pFacToken = this.mpToken;
        this.setCurrentFactor(pFacToken);
        this.NextToken();
        this.CheckSetForceArrayParameter(this.mpToken, 0);
        eOp = this.Expression();
        // Do not ignore error here, regardless of mbStopOnError, to not
        // change the formula expression in case of an unexpected state.
        if (pArr.GetCodeError() === FormulaError.NONE && this.pc >= 2) {
          // Left and right operands must be reference or function
          // returning reference to form a range list.
          let p = this.code(-2);
          if (p && isPotentialRangeType(p, true, false)) {
            p = this.code(-1);
            if (p && isPotentialRangeType(p, true, true)) {
              pFacToken.NewOpCode(ocUnion);
              // XXX NOTE: the token's eType is still svSep here!
              this.PutCode(pFacToken);
            }
          }
        }
      }
      if (eOp !== ocClose) this.SetError(FormulaError.PairExpected);
      else this.NextToken();
    } else {
      if (FormulaCompiler.IsOpCodeVolatile(eOp)) pArr.SetExclusiveRecalcModeAlways();
      else {
        switch (eOp) {
          // Functions recalculated on every document load.
          case OC.ocConvertOOo:
          case OC.ocDde:
          case ocMacro:
          case OC.ocWebservice:
            pArr.AddRecalcMode(ScRecalcMode.ONLOAD_LENIENT);
            break;
          case ocExternal:
            pArr.AddRecalcMode(ScRecalcMode.ONLOAD_LENIENT);
            break;
          // If the referred cell is moved the value changes.
          case OC.ocColumn:
          case OC.ocRow:
            pArr.SetRecalcModeOnRefMove();
            break;
          // ocCell needs recalc on move for some possible type values.
          // And recalc mode on load, tdf#60645
          case OC.ocCell:
            pArr.SetRecalcModeOnRefMove();
            pArr.AddRecalcMode(ScRecalcMode.ONLOAD_MUST);
            break;
          case OC.ocHyperLink:
            // Cell with hyperlink needs to be calculated on load to
            // get its matrix result generated.
            pArr.AddRecalcMode(ScRecalcMode.ONLOAD_MUST);
            pArr.SetHyperLink(true);
            break;
          default:
        }
      }
      if (SC_OPCODE_START_NO_PAR <= eOp && eOp < SC_OPCODE_STOP_NO_PAR) {
        const pFacToken = this.mpToken;
        this.setCurrentFactor(pFacToken);
        eOp = this.NextToken();
        if (eOp !== ocOpen) {
          this.SetError(FormulaError.PairExpected);
          this.PutCode(pFacToken);
        } else {
          eOp = this.NextToken();
          if (eOp !== ocClose) this.SetError(FormulaError.PairExpected);
          this.PutCode(pFacToken);
          this.NextToken();
        }
      } else if (SC_OPCODE_START_1_PAR <= eOp && eOp < SC_OPCODE_STOP_1_PAR) {
        if (eOp === ocIsoWeeknum && FormulaGrammar.isODFF(this.meGrammar)) {
          // tdf#50950 ocIsoWeeknum can have 2 arguments when saved by older versions of Calc;
          // the opcode then has to be changed to ocWeek for backward compatibility
          const pFacToken = this.mpToken;
          this.setCurrentFactor(pFacToken);
          eOp = this.NextToken();
          let bNoParam = false;
          if (eOp === ocOpen) {
            eOp = this.NextToken();
            if (eOp === ocClose) bNoParam = true;
            else {
              this.CheckSetForceArrayParameter(this.mpToken, 0);
              eOp = this.Expression();
            }
          } else this.SetError(FormulaError.PairExpected);
          let nSepCount = 0;
          if (!bNoParam) {
            nSepCount++;
            while (eOp === ocSep && (pArr.GetCodeError() === FormulaError.NONE || !this.mbStopOnError)) {
              this.NextToken();
              this.CheckSetForceArrayParameter(this.mpToken, nSepCount);
              nSepCount++;
              if (nSepCount > FORMULA_MAXPARAMS) this.SetError(FormulaError.CodeOverflow);
              eOp = this.Expression();
            }
          }
          if (eOp !== ocClose) this.SetError(FormulaError.PairExpected);
          else this.NextToken();
          pFacToken.SetByte(nSepCount);
          // For the remaining two arguments cases use the compatibility function.
          if (nSepCount === 2) pFacToken.NewOpCode(ocWeeknumOOo);
          this.PutCode(pFacToken);
        } else {
          // standard handling of 1-parameter opcodes
          const pFacToken = this.mpToken;
          this.setCurrentFactor(pFacToken);
          eOp = this.NextToken();
          if (eOp === ocOpen) {
            this.NextToken();
            this.CheckSetForceArrayParameter(this.mpToken, 0);
            eOp = this.Expression();
          } else this.SetError(FormulaError.PairExpected);
          if (eOp !== ocClose) this.SetError(FormulaError.PairExpected);
          else if (pArr.GetCodeError() === FormulaError.NONE) pFacToken.SetByte(1);
          this.PutCode(pFacToken);
          this.NextToken();
        }
      } else if ((SC_OPCODE_START_2_PAR <= eOp && eOp < SC_OPCODE_STOP_2_PAR) || eOp === ocExternal || eOp === ocMacro || eOp === ocAnd || eOp === ocOr
        || eOp === ocBad || (eOp >= OC.ocInternalBegin && eOp <= OC.ocInternalEnd) || (!this.mbJumpCommandReorder && IsOpCodeJumpCommand(eOp))) {
        const pFacToken = this.mpToken;
        this.setCurrentFactor(pFacToken);
        const eMyLastOp = eOp;
        eOp = this.NextToken();
        let bNoParam = false;
        let bBadName = false;
        if (eOp === ocOpen) {
          eOp = this.NextToken();
          if (eOp === ocClose) bNoParam = true;
          else {
            this.CheckSetForceArrayParameter(this.mpToken, 0);
            eOp = this.Expression();
          }
        } else if (eMyLastOp === ocBad) {
          // Just a bad name, not an unknown function, no parameters, no
          // closing expected.
          bBadName = true;
          bNoParam = true;
        } else this.SetError(FormulaError.PairExpected);
        let nSepCount = 0;
        if (!bNoParam) {
          nSepCount++;
          while (eOp === ocSep && (pArr.GetCodeError() === FormulaError.NONE || !this.mbStopOnError)) {
            this.NextToken();
            this.CheckSetForceArrayParameter(this.mpToken, nSepCount);
            nSepCount++;
            if (nSepCount > FORMULA_MAXPARAMS) this.SetError(FormulaError.CodeOverflow);
            eOp = this.Expression();
          }
        }
        let bDone = false;
        if (bBadName) {
          // nothing, keep current token for return
        } else if (eOp !== ocClose) this.SetError(FormulaError.PairExpected);
        else {
          this.NextToken();
          bDone = true;
        }
        pFacToken.SetByte(nSepCount);
        this.PutCode(pFacToken);
        if (bDone) this.AnnotateOperands();
      } else if (IsOpCodeJumpCommand(eOp)) {
        // the PC counters are -1
        const pFacToken = this.mpToken;
        this.setCurrentFactor(pFacToken);
        const pJump = pFacToken.GetJump();
        switch (eOp) {
          case ocIf:
            pJump[0] = 3; // if, else, behind
            break;
          case ocChoose:
            pJump[0] = FORMULA_MAXJUMPCOUNT + 1;
            break;
          case ocLet:
            pJump[0] = FORMULA_MAXPARAMS + 1;
            break;
          case ocIfError:
          case ocIfNA:
            pJump[0] = 2; // if, behind
            break;
          default:
        }
        eOp = this.NextToken();
        if (eOp === ocOpen) {
          this.NextToken();
          this.CheckSetForceArrayParameter(this.mpToken, 0);
          eOp = this.Expression();
        } else this.SetError(FormulaError.PairExpected);
        this.PutCode(pFacToken);
        let nJumpMax: number;
        let eFacOpCode = pFacToken.GetOpCode();
        switch (eFacOpCode) {
          case ocIf: nJumpMax = 3; break;
          case ocChoose: nJumpMax = FORMULA_MAXJUMPCOUNT; break;
          case ocLet: nJumpMax = FORMULA_MAXPARAMS; break;
          case ocIfError:
          case ocIfNA: nJumpMax = 2; break;
          default: nJumpMax = 0;
        }
        let nJumpCount = 0;
        while (nJumpCount < FORMULA_MAXPARAMS - 1 && eOp === ocSep && (pArr.GetCodeError() === FormulaError.NONE || !this.mbStopOnError)) {
          if (++nJumpCount <= nJumpMax) pJump[nJumpCount] = this.pc - 1;
          this.NextToken();
          this.CheckSetForceArrayParameter(this.mpToken, nJumpCount - 1);
          eOp = this.Expression();
          // ocSep or ocClose terminate the subexpression
          this.PutCode(this.mpToken);
        }
        if (eOp !== ocClose) this.SetError(FormulaError.PairExpected);
        else {
          this.NextToken();
          // always limit to nJumpMax, no arbitrary overwrites
          if (++nJumpCount <= nJumpMax) pJump[nJumpCount] = this.pc - 1;
          eFacOpCode = pFacToken.GetOpCode();
          let bLimitOk: boolean;
          switch (eFacOpCode) {
            case ocIf: bLimitOk = nJumpCount <= 3; break;
            case ocChoose: bLimitOk = nJumpCount < FORMULA_MAXJUMPCOUNT; break;
            case ocLet: bLimitOk = nJumpCount < FORMULA_MAXPARAMS; break;
            case ocIfError:
            case ocIfNA: bLimitOk = nJumpCount <= 2; break;
            default: bLimitOk = false;
          }
          if (bLimitOk) pJump[0] = nJumpCount;
          else this.SetError(FormulaError.IllegalParameter);
        }
      } else if (eOp === ocMissing) {
        this.PutCode(this.mpToken);
        this.NextToken();
      } else if (eOp === ocClose) {
        this.SetError(FormulaError.ParameterExpected);
      } else if (eOp === ocSep) {
        // Subsequent ocSep
        this.SetError(FormulaError.ParameterExpected);
      } else if (this.mpToken.IsExternalRef()) {
        this.PutCode(this.mpToken);
        this.NextToken();
      } else {
        this.SetError(FormulaError.UnknownToken);
      }
    }
  }

  protected RangeLine(): void {
    this.Factor();
    while (this.mpToken.GetOpCode() === ocRange) {
      const nCode1 = this.pc - 1;
      const p = this.mpToken;
      this.NextToken();
      this.Factor();
      const nCode2 = this.pc - 1;
      if (!this.MergeRangeReference(nCode1, nCode2)) this.PutCode(p);
    }
  }

  protected IntersectionLine(): void {
    this.RangeLine();
    while (this.mpToken.GetOpCode() === ocIntersect || this.mpToken.GetOpCode() === ocSpaces) {
      const nCodeIndex = this.maArrIterator.GetIndex() - 1;
      const nCode1 = this.pc - 1;
      const p = this.mpToken;
      this.NextToken();
      this.RangeLine();
      const nCode2 = this.pc - 1;
      if (p.GetOpCode() === ocSpaces) {
        // Convert to intersection if both left and right are references or
        // functions (potentially returning references, if not then a space
        // or no space would be a syntax error anyway), not other operators
        // or operands. Else discard.
        if (this.isAdjacentOrGapRpnEnd(nCode1, nCode2) && this.isIntersectable(nCode1, nCode2)) {
          const pIntersect = new FormulaByteToken(ocIntersect);
          // Replace ocSpaces with ocIntersect so that when switching
          // formula syntax the correct operator string is created.
          this.pArr!.ReplaceToken(nCodeIndex, pIntersect);
          this.PutCode(pIntersect);
        }
      } else this.PutCode(p);
    }
  }

  protected UnionLine(): void {
    this.IntersectionLine();
    while (this.mpToken.GetOpCode() === ocUnion) {
      const p = this.mpToken;
      this.NextToken();
      this.IntersectionLine();
      this.PutCode(p);
    }
  }

  protected UnaryLine(): void {
    if (this.mpToken.GetOpCode() === ocAdd) this.GetToken();
    else if (SC_OPCODE_START_UN_OP <= this.mpToken.GetOpCode() && this.mpToken.GetOpCode() < SC_OPCODE_STOP_UN_OP) {
      const p = this.mpToken;
      this.NextToken();
      this.UnaryLine();
      this.PutCode(p);
    } else this.UnionLine();
  }

  protected PostOpLine(): void {
    this.UnaryLine();
    while (this.mpToken.GetOpCode() === ocPercentSign) {
      // this operator _follows_ its operand
      this.PutCode(this.mpToken);
      this.NextToken();
    }
  }

  protected PowLine(): void {
    this.PostOpLine();
    while (this.mpToken.GetOpCode() === ocPow) {
      const p = this.mpToken;
      this.NextToken();
      this.PostOpLine();
      this.PutCode(p);
    }
  }

  protected MulDivLine(): void {
    this.PowLine();
    while (this.mpToken.GetOpCode() === ocMul || this.mpToken.GetOpCode() === ocDiv) {
      const p = this.mpToken;
      this.NextToken();
      this.PowLine();
      this.PutCode(p);
    }
  }

  protected AddSubLine(): void {
    this.MulDivLine();
    while (this.mpToken.GetOpCode() === ocAdd || this.mpToken.GetOpCode() === ocSub) {
      const p = this.mpToken;
      this.NextToken();
      this.MulDivLine();
      this.PutCode(p);
    }
  }

  protected ConcatLine(): void {
    this.AddSubLine();
    while (this.mpToken.GetOpCode() === ocAmpersand) {
      const p = this.mpToken;
      this.NextToken();
      this.AddSubLine();
      this.PutCode(p);
    }
  }

  protected CompareLine(): void {
    this.ConcatLine();
    while (this.mpToken.GetOpCode() >= ocEqual && this.mpToken.GetOpCode() <= ocGreaterEqual) {
      const p = this.mpToken;
      this.NextToken();
      this.ConcatLine();
      this.PutCode(p);
    }
  }

  protected Expression(): OpCode {
    const nRecursionMax = 100;
    this.nRecursion++;
    try {
      if (this.nRecursion > nRecursionMax) {
        this.SetError(FormulaError.StackOverflow);
        return ocStop; //! generate token instead?
      }
      this.CompareLine();
      while (this.mpToken.GetOpCode() === ocAnd || this.mpToken.GetOpCode() === ocOr) {
        const p = this.mpToken;
        this.mpToken.SetByte(2); // 2 parameters!
        this.NextToken();
        this.CompareLine();
        this.PutCode(p);
      }
      return this.mpToken.GetOpCode();
    } finally {
      this.nRecursion--;
    }
  }

  private isAdjacentRpnEnd(nCode1: number, nCode2: number): boolean {
    return this.pc >= 2 && nCode1 >= 0 && nCode2 >= 0 && nCode2 - nCode1 === 1 && this.pc - 1 === nCode2;
  }

  private isAdjacentOrGapRpnEnd(nCode1: number, nCode2: number): boolean {
    return this.pc >= 2 && nCode1 >= 0 && nCode2 >= 0 && nCode1 < nCode2 && this.pc - 1 === nCode2;
  }

  private isIntersectable(nCode1: number, nCode2: number): boolean {
    const pCode1 = this.maRPN[nCode1], pCode2 = this.maRPN[nCode2];
    return !!pCode1 && !!pCode2 && isPotentialRangeType(pCode1, true, false) && isPotentialRangeType(pCode2, true, true);
  }

  protected MergeRangeReference(nCode1: number, nCode2: number): boolean {
    if (!this.isAdjacentRpnEnd(nCode1, nCode2)) return false;
    const p1 = this.maRPN[nCode1]!, p2 = this.maRPN[nCode2]!;
    const p = this.ExtendRangeReference(p1, p2);
    if (!p) return false;
    this.maRPN[nCode1] = p;
    --this.pc;
    this.maRPN.length = this.pc;
    return true;
  }

  CompileTokenArray(): boolean {
    this.glSubTotal = false;
    this.needsRPNTokenCheck = false;
    const pArr = this.pArr!;
    if (pArr.GetCodeError() === FormulaError.NONE || !this.mbStopOnError) {
      pArr.DelRPN();
      this.maArrIterator.Reset();
      this.pStack = null;
      // Code in some places refers to the last token as 'pCode - 1', which may
      // point before the first element if the expression is bad.
      this.maRPN = [];
      const bWasForced = pArr.IsRecalcModeForced();
      pArr.ClearRecalcMode();
      this.maArrIterator.Reset();
      this.eLastOp = ocOpen;
      this.pc = 0;
      this.NextToken();
      const eOp = this.Expression();
      // Some trailing garbage that doesn't form an expression?
      if (eOp !== ocStop) this.SetError(FormulaError.OperatorExpected);
      this.PostProcessCode();

      const nErrorBeforePop = this.pArr!.GetCodeError();

      while (this.pStack) this.PopTokenArray();
      const pArrNow = this.pArr!;
      if (this.pc) pArrNow.CreateNewRPNArrayFromData(this.maRPN.slice(0, this.pc));

      // once an error, always an error
      if (pArrNow.GetCodeError() === FormulaError.NONE && nErrorBeforePop !== FormulaError.NONE) pArrNow.SetCodeError(nErrorBeforePop);

      if (pArrNow.GetCodeError() !== FormulaError.NONE && this.mbStopOnError) {
        pArrNow.DelRPN();
        this.maArrIterator.Reset();
        pArrNow.SetHyperLink(false);
      }

      if (bWasForced) pArrNow.SetRecalcModeForced();
    }
    return this.glSubTotal;
  }

  protected PushTokenArray(pa: FormulaTokenArray, bTemp: boolean): void {
    this.pStack = { pNext: this.pStack, pArr: this.pArr!, nIndex: this.maArrIterator.GetIndex(), mpLastToken: this.mpLastToken, bTemp };
    this.pArr = pa;
    this.maArrIterator = new FormulaTokenArrayPlainIterator(pa);
  }

  protected PopTokenArray(): void {
    if (!this.pStack) return;
    const p = this.pStack;
    this.pStack = p.pNext;
    // obtain special RecalcMode from SharedFormula
    const pArr = this.pArr!;
    if (pArr.IsRecalcModeAlways()) p.pArr.SetExclusiveRecalcModeAlways();
    else if (!pArr.IsRecalcModeNormal() && p.pArr.IsRecalcModeNormal()) p.pArr.SetMaskedRecalcMode(pArr.GetRecalcMode());
    p.pArr.SetCombinedBitsRecalcMode(pArr.GetRecalcMode());
    if (pArr.IsHyperLink()) p.pArr.SetHyperLink(true);
    this.pArr = p.pArr;
    this.maArrIterator = new FormulaTokenArrayPlainIterator(this.pArr);
    this.maArrIterator.Jump(p.nIndex);
    this.mpLastToken = p.mpLastToken;
  }

  protected ForceArrayOperator(rCurr: FormulaToken): void {
    if (this.pCurrentFactorToken === rCurr) return;
    const eOp = rCurr.GetOpCode();
    const eType = rCurr.GetType();
    const bInlineArray = eOp === ocPush && eType === svMatrix;
    if (!bInlineArray) {
      // Already set, unnecessary to evaluate again.
      if (rCurr.GetInForceArray() !== ParamClass.Unknown) return;
      if (!(eOp !== ocPush && (eType === svByte || eType === svJump))) return;
    }

    // Return class for inline arrays and functions returning array/matrix.
    const eArrayReturn = ParamClass.ForceArrayReturn;

    const pCur = this.pCurrentFactorToken;
    if (bInlineArray) {
      // rCurr->SetInForceArray() can not be used with ocPush, but ocPush
      // with svMatrix has an implicit ParamClass::ForceArrayReturn.
      if (this.nCurrentFactorParam > 0 && pCur && pCur.GetInForceArray() === ParamClass.Unknown
        && this.GetForceArrayParameter(pCur, this.nCurrentFactorParam - 1) === ParamClass.Value) {
        // Propagate to caller as if a function returning an array/matrix
        // was called (see also below).
        pCur.SetInForceArray(eArrayReturn);
      }
      return;
    }

    if (!pCur) {
      if (this.mbMatrixFlag) {
        // An array/matrix formula acts as ForceArray on all top level
        // operators and function calls, so that can be inherited properly
        // below.
        rCurr.SetInForceArray(ParamClass.ForceArray);
      } else if (this.pc >= 2 && SC_OPCODE_START_BIN_OP <= eOp && eOp < SC_OPCODE_STOP_BIN_OP) {
        // Binary operators are not functions followed by arguments
        // and need some peeking into RPN to inspect their operands.
        const c1 = this.code(-1)!, c2 = this.code(-2)!;
        const eOp1 = c1.GetOpCode();
        const eOp2 = c2.GetOpCode();
        const b1 = c1.GetInForceArray() !== ParamClass.Unknown || FormulaCompiler.IsMatrixFunction(eOp1);
        const b2 = c2.GetInForceArray() !== ParamClass.Unknown || FormulaCompiler.IsMatrixFunction(eOp2);
        if ((b1 && b2) || (b1 && eOp2 === ocPush && c2.GetType() !== svDoubleRef) || (b2 && eOp1 === ocPush && c1.GetType() !== svDoubleRef))
          rCurr.SetInForceArray(eArrayReturn);
      } else if (this.pc >= 1 && SC_OPCODE_START_UN_OP <= eOp && eOp < SC_OPCODE_STOP_UN_OP) {
        // Similar for unary operators.
        const c1 = this.code(-1)!;
        if (c1.GetInForceArray() !== ParamClass.Unknown || FormulaCompiler.IsMatrixFunction(c1.GetOpCode())) rCurr.SetInForceArray(eArrayReturn);
      }
      return;
    }

    // Inherited parameter class.
    const eForceType = pCur.GetInForceArray();
    if (eForceType === ParamClass.ForceArray || eForceType === ParamClass.ReferenceOrRefArray) {
      // ReferenceOrRefArray was set only if in ForceArray context already,
      // it is valid for the one function only to indicate the preferred
      // return type. Propagate as ForceArray if not another parameter
      // handling ReferenceOrRefArray.
      if (this.nCurrentFactorParam > 0 && this.GetForceArrayParameter(pCur, this.nCurrentFactorParam - 1) === ParamClass.ReferenceOrRefArray)
        rCurr.SetInForceArray(ParamClass.ReferenceOrRefArray);
      else rCurr.SetInForceArray(ParamClass.ForceArray);
      return;
    } else if (eForceType === ParamClass.ReferenceOrForceArray) {
      // Inherit further only if the return class of the nested function is
      // not Reference. Else flag as suppressed.
      if (this.GetForceArrayParameter(rCurr, 0xffff) !== ParamClass.Reference) rCurr.SetInForceArray(eForceType);
      else rCurr.SetInForceArray(ParamClass.SuppressedReferenceOrForceArray);
      return;
    }

    if (this.nCurrentFactorParam <= 0) return;

    // Actual current parameter's class.
    const eParamType = this.GetForceArrayParameter(pCur, this.nCurrentFactorParam - 1);
    if (eParamType === ParamClass.ForceArray) rCurr.SetInForceArray(eParamType);
    else if (eParamType === ParamClass.ReferenceOrForceArray) {
      if (this.GetForceArrayParameter(rCurr, 0xffff) !== ParamClass.Reference) rCurr.SetInForceArray(eParamType);
      else rCurr.SetInForceArray(ParamClass.SuppressedReferenceOrForceArray);
    }

    // Propagate a ForceArrayReturn to caller if the called function
    // returns one and the caller so far does not have a stronger array
    // mode set and expects a scalar value for this parameter.
    if (eParamType === ParamClass.Value && pCur.GetInForceArray() === ParamClass.Unknown) {
      if (FormulaCompiler.IsMatrixFunction(eOp)) pCur.SetInForceArray(eArrayReturn);
      else if (this.GetForceArrayParameter(rCurr, 0xffff) === ParamClass.ForceArrayReturn) pCur.SetInForceArray(ParamClass.ForceArrayReturn);
    }
  }

  protected CheckSetForceArrayParameter(rCurr: FormulaToken, nParam: number): void {
    if (!this.pCurrentFactorToken) return;
    this.nCurrentFactorParam = nParam + 1;
    this.ForceArrayOperator(rCurr);
  }

  // --- Creating a string from tokens -------------------------------------------------------------

  CreateStringFromTokenArray(): string {
    const pArr = this.pArr;
    if (!pArr || !pArr.GetLen()) return '';
    const nSaveIndex = this.maArrIterator.GetIndex();
    this.maArrIterator = new FormulaTokenArrayPlainIterator(pArr);
    let rBuffer = '';
    if (pArr.IsRecalcModeForced()) rBuffer += '=';
    let t = this.maArrIterator.First();
    while (t) {
      // Discard writing unknown functions without a name in OOXML ex: #NAME!()
      if (FormulaGrammar.isOOXML(this.meGrammar) && (t.GetOpCode() === ocNoName || t.GetOpCode() === ocExternal) && t.GetType() === svByte) {
        rBuffer = FormulaCompiler.GetNativeSymbol(ocErrRef);
        break;
      }
      const r = this.CreateStringFromToken(t, true);
      rBuffer += r.s;
      t = r.next;
    }
    this.maArrIterator.Jump(nSaveIndex);
    return rBuffer;
  }

  CreateStringFromToken(pTokenP: FormulaToken, bAllowArrAdvance = false): { s: string; next: FormulaToken | null } {
    let rBuffer = '';
    let bNext = true;
    let bSpaces = false;
    let t: FormulaToken | null = pTokenP;
    const eOp = t.GetOpCode();
    if (eOp >= ocAnd && eOp <= ocOr) {
      // AND, OR infix?
      if (bAllowArrAdvance) t = this.maArrIterator.Next();
      else t = this.maArrIterator.PeekNext();
      bNext = false;
      bSpaces = !t || t.GetOpCode() !== ocOpen;
    }
    if (bSpaces) rBuffer += ' ';

    if (eOp === ocSpaces || eOp === ocWhitespace) {
      let bWriteSpaces = true;
      if (eOp === ocSpaces && this.mxSymbols.isODFF()) {
        let p = this.maArrIterator.PeekPrevNoSpaces();
        let bIntersectionOp = !!p && p.GetOpCode() === ocColRowName;
        if (bIntersectionOp) {
          p = this.maArrIterator.PeekNextNoSpaces();
          bIntersectionOp = !!p && p.GetOpCode() === ocColRowName;
        }
        if (bIntersectionOp) {
          rBuffer += '!!';
          bWriteSpaces = false;
        }
      }
      if (bWriteSpaces) {
        // ODF v1.3 OpenFormula 5.14 Whitespace states "whitespace shall
        // not separate a function name from its initial opening
        // parenthesis". Suppress/remove it in any case also in UI, it
        // will not be preserved.
        let p = this.maArrIterator.PeekPrevNoSpaces();
        if (p && p.IsFunction()) {
          p = this.maArrIterator.PeekNextNoSpaces();
          if (p && p.GetOpCode() === ocOpen) bWriteSpaces = false;
        }
      }
      if (bWriteSpaces) {
        // most times it's just one blank
        const n = pTokenP.GetByte();
        for (let j = 0; j < n; ++j) rBuffer += eOp === ocWhitespace ? pTokenP.GetChar() : ' ';
      }
    } else if (eOp === ocTTT) rBuffer += 'TTT';
    else if (eOp === ocDebugVar) rBuffer += '__DEBUG_VAR';
    else if (eOp === ocIntersect) {
      // Nasty, ugly, horrific, terrifying...
      if (FormulaGrammar.isExcelSyntax(this.meGrammar)) rBuffer += ' ';
      else rBuffer += this.mxSymbols.getSymbol(eOp);
    } else if (eOp === ocEasterSunday) rBuffer += this.mxSymbols.getSymbol(eOp);
    else if (eOp < this.mxSymbols.getSymbolCount()) rBuffer += this.mxSymbols.getSymbol(eOp); // Keyword:
    else rBuffer += FormulaCompiler.GetNativeSymbol(ocErrName);

    if (bNext && t) {
      if (t.IsExternalRef()) rBuffer += this.CreateStringFromExternal(pTokenP);
      else {
        switch (t.GetType()) {
          case svDouble:
            rBuffer += this.AppendDouble(t.GetDouble());
            break;
          case svString:
            if (eOp === ocBad || eOp === ocStringXML || eOp === ocStringName) rBuffer += t.GetString();
            else rBuffer += FormulaCompiler.AppendString(t.GetString());
            break;
          case svSingleRef:
            rBuffer += this.CreateStringFromSingleRef(t);
            break;
          case svDoubleRef:
            rBuffer += this.CreateStringFromDoubleRef(t);
            break;
          case svMatrix:
          case svMatrixCell:
            rBuffer += this.CreateStringFromMatrix(t);
            break;
          case svIndex:
            rBuffer += this.CreateStringFromIndex(t);
            break;
          case svExternal:
            // mapped or translated name of AddIns
            rBuffer += t.GetExternal();
            break;
          case svError:
            rBuffer += this.AppendErrorConstant(t.GetError());
            break;
          case svByte:
          case svJump:
          case svFAP:
          case svMissing:
          case svSep:
            break; // Opcodes
          default:
        }
      }
    }
    if (bSpaces) rBuffer += ' ';
    if (bAllowArrAdvance) {
      if (bNext) t = this.maArrIterator.Next();
      return { s: rBuffer, next: t };
    }
    return { s: rBuffer, next: pTokenP };
  }

  AppendDouble(fVal: number): string {
    // en-US: the decimal separator is '.' for the native map as well.
    return doubleToUString(fVal, rtl_math_StringFormat.Automatic, rtl_math_DecimalPlaces_Max, '.', true);
  }

  AppendBoolean(bVal: boolean): string { return this.mxSymbols.getSymbol(bVal ? ocTrue : ocFalse); }

  static AppendString(rStr: string): string {
    return `"${rStr.replaceAll('"', '""')}"`;
  }

  CreateStringFromSingleRef(_pToken: FormulaToken): string { return ''; }
  CreateStringFromDoubleRef(_pToken: FormulaToken): string { return ''; }
  CreateStringFromIndex(_pToken: FormulaToken): string { return ''; }
  CreateStringFromMatrix(_pToken: FormulaToken): string { return ''; }
  CreateStringFromExternal(_pToken: FormulaToken): string { return ''; }

  /** The token array the compiler works on. */
  GetTokenArray(): FormulaTokenArray | null { return this.pArr; }
}

// --- helpers of the anonymous namespace ---------------------------------------------------------

function isPotentialRangeLeftOp(eOp: OpCode): boolean {
  switch (eOp) {
    case ocClose:
      return true;
    default:
      return false;
  }
}

function isRangeResultFunction(eOp: OpCode): boolean {
  switch (eOp) {
    case OC.ocIndirect:
    case OC.ocOffset:
      return true;
    default:
      return false;
  }
}

function isRangeResultOpCode(eOp: OpCode): boolean {
  switch (eOp) {
    case ocRange:
    case ocUnion:
    case ocIntersect:
    case OC.ocIndirect:
    case OC.ocOffset:
      return true;
    default:
      return false;
  }
}

/**
    @param  pToken
            MUST be a valid token.
    @param  bRPN
            If not in RPN the parameter count is not available.
    @param  bRight
            If bRPN==false, bRight==false means opcodes for left side are
            checked, bRight==true means opcodes for right side. If bRPN==true
            it doesn't matter except for the ocSep converted to ocUnion case.
 */
function isPotentialRangeType(pToken: FormulaToken, bRPN: boolean, bRight: boolean): boolean {
  switch (pToken.GetType()) {
    case svByte: // could be range result, but only a few
      if (bRPN) return isRangeResultOpCode(pToken.GetOpCode());
      else if (bRight) return isRangeResultFunction(pToken.GetOpCode());
      else return isPotentialRangeLeftOp(pToken.GetOpCode());
    case svSingleRef:
    case svDoubleRef:
    case svIndex: // could be range
    //case svRefList:     // um..what?
    case svExternalSingleRef:
    case svExternalDoubleRef:
    case svExternalName: // could be range
      return true;
    case svSep:
      // A special case if a previous ocSep was converted to ocUnion it
      // stays svSep instead of svByte.
      return bRPN && !bRight && pToken.GetOpCode() === ocUnion;
    default:
      // Separators are not part of RPN and right opcodes need to be
      // other StackVar types or functions and thus svByte.
      return !bRPN && !bRight && isPotentialRangeLeftOp(pToken.GetOpCode());
  }
}

export { ocArrayClose, ocArrayOpen, ocNot, ocPercentSign, ocMul, ocSub, ocDiv, ocAmpersand, ocPow, ocChoose };
