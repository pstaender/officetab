// SPDX-License-Identifier: MPL-2.0
// @upstream include/formula/token.hxx reduced
// @upstream include/formula/tokenarray.hxx reduced
// @upstream include/formula/paramclass.hxx faithful
// @upstream formula/source/core/api/token.cxx reduced
// FormulaToken and its subclasses, FormulaTokenArray (the code as entered, pCode, and the RPN,
// pRPN) and the iterators. Reference counting is left to the garbage collector. The svl
// SharedString of string tokens is a plain string. Left out: the PODF/OOXML missing-parameter
// rewrite (RewriteMissing), FormulaFAPToken, external (add-in) name tokens beyond their name,
// and the vector (OpenCL) state.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import {
  ocAnd, ocArrayClose, ocArrayColSep, ocArrayOpen, ocArrayRowSep, ocBad, ocChoose, ocClose, ocColRowName, ocExternal, ocIf, ocIfError,
  ocIfNA, ocLet, ocMacro, ocMissing, ocName, ocOpen, ocOr, ocPercentSign, ocPush, ocSep, ocSpaces, ocStop, ocWhitespace,
  SC_OPCODE_START_1_PAR, SC_OPCODE_START_2_PAR, SC_OPCODE_START_BIN_OP, SC_OPCODE_START_NO_PAR, SC_OPCODE_START_UN_OP,
  SC_OPCODE_STOP_1_PAR, SC_OPCODE_STOP_2_PAR, SC_OPCODE_STOP_BIN_OP, SC_OPCODE_STOP_NO_PAR, SC_OPCODE_STOP_UN_OP, ocDBArea,
  ocTableRef, type OpCode,
} from '../../../../include/formula/opcode.ts';
import * as OC from '../../../../include/formula/opcode.ts';

export const StackVar = {
  svByte: 0,
  svDouble: 1,
  svString: 2,
  svStringName: 3,
  svSingleRef: 4,
  svDoubleRef: 5,
  svMatrix: 6,
  svIndex: 7,
  svJump: 8,
  svExternal: 9, // Byte + String
  svFAP: 10, // FormulaAutoPilot only, ever exported
  svJumpMatrix: 11,
  svRefList: 12, // ocUnion result
  svEmptyCell: 13, // Result is an empty cell, e.g. in LOOKUP()
  svMatrixCell: 14, // Result is a matrix with bells and whistles as needed for _the_ matrix formula result.
  svHybridCell: 15, // A temporary condition of a formula cell during import, having a double
  // and/or string result and a formula string to be compiled.
  svExternalSingleRef: 16,
  svExternalDoubleRef: 17,
  svExternalName: 18,
  svSingleVectorRef: 19,
  svDoubleVectorRef: 20,
  svError: 21, // error token
  svMissing: 22, // 0 or ""
  svSep: 23, // separator, ocSep, ocOpen, ocClose
  svUnknown: 24, // unknown StackType
} as const;
export type StackVar = (typeof StackVar)[keyof typeof StackVar];
export const { svByte, svDouble, svString, svStringName, svSingleRef, svDoubleRef, svMatrix, svIndex, svJump, svExternal, svFAP, svJumpMatrix,
  svRefList, svEmptyCell, svMatrixCell, svHybridCell, svExternalSingleRef, svExternalDoubleRef, svExternalName, svError, svMissing, svSep, svUnknown } = StackVar;

export const ParamClass = {
  Unknown: 0, // MUST be zero for initialization mechanism!
  /** Out of bounds, function doesn't expect that many parameters.
      However, not necessarily returned if a module specific definition
      for example returns type Value for an unlisted function. */
  Bounds: 1,
  /** In array formula: single value to be passed. Results in JumpMatrix
      being created and multiple calls to function. Functions handling a
      formula::svDoubleRef by means of DoubleRefToPosSingleRef() or
      PopDoubleRefOrSingleRef() or GetDouble() or GetString() should have
      this. */
  Value: 2,
  /** In array formula: area reference must stay reference. Otherwise
      don't care. Functions handling a formula::svDoubleRef by means of
      PopDoubleRefOrSingleRef() should not have this. */
  Reference: 3,
  /** Like Reference but the function accepts also a list of references
      (ocUnion svRefList) as one argument AND handles the special case of
      an array of references in array mode. */
  ReferenceOrRefArray: 4,
  /** In array formula: convert area reference to array. Function will be
      called only once if no Value type is involved. Functions able to
      handle a svMatrix parameter but not a formula::svDoubleRef parameter as area
      should have this. */
  Array: 5,
  /** Area reference must be converted to array in any case, and must
      also be propagated to subsequent operators and functions being part
      of a parameter of this function. */
  ForceArray: 6,
  /** Area reference is not converted to array, but ForceArray must be
      propagated to subsequent operators and functions being part of a
      parameter of this function. Used with functions that treat
      references separately from arrays, but need the forced array
      calculation of parameters that are not references. */
  ReferenceOrForceArray: 7,
  /** Same as ReferenceOrForceArray but suppressed / not inherited in the
      compiler's ForceArray context to indicate that a result of
      Reference in JumpMatrix context should use the result matrix
      instead of the array of references. */
  SuppressedReferenceOrForceArray: 8,
  /** A function return forces the caller into array mode for this one
      call, making it behave like it had ForceArray but not propagated to
      any further operators in the same parameter. */
  ForceArrayReturn: 9,
} as const;
export type ParamClass = (typeof ParamClass)[keyof typeof ParamClass];

/** ScRecalcMode */
export const ScRecalcMode = {
  ALWAYS: 0x01, // exclusive, always
  ONLOAD_MUST: 0x02, // exclusive, always after load
  ONLOAD_ONCE: 0x04, // exclusive, once after load, import filter
  ONLOAD_LENIENT: 0x08, // exclusive, lenient after load (eg. macros not always, aliens, ...)
  NORMAL: 0x10, // exclusive
  FORCED: 0x20, // combined, also if cell isn't visible, for macros with side effects
  ONREFMOVE: 0x40, // combined, if reference was moved
  EMask: 0x01 | 0x02 | 0x08 | 0x04 | 0x10, // mask of exclusive bits
} as const;
export type ScRecalcMode = number;

export const FORMULA_MAXJUMPCOUNT = 32; /* maximum number of jumps (ocChoose) */
export const FORMULA_MAXTOKENS = 8192; /* maximum number of tokens in formula */
export const FORMULA_MAXPARAMS = 255; /* maximum number of parameters per function (byte) */
export const FORMULA_MAXPARAMSII = 8; /* maximum number of parameters for functions that have implicit intersection ranges */

/** The reference data of the sc token types (ScSingleRefData, ScComplexRefData), typed loosely here. */
export interface FormulaRefData { clone(): FormulaRefData }

export class FormulaToken {
  protected eOp: OpCode;
  protected readonly eType: StackVar;

  constructor(eTypeP: StackVar, e: OpCode = ocPush) {
    this.eType = eTypeP;
    this.eOp = e;
  }

  GetType(): StackVar { return this.eType; }
  GetOpCode(): OpCode { return this.eOp; }

  // pure functions, no operators
  IsFunction(): boolean {
    const eOp = this.eOp;
    return eOp !== ocPush && eOp !== ocBad && eOp !== ocColRowName && eOp !== OC.ocColRowNameAuto && eOp !== ocName && eOp !== ocDBArea
      && eOp !== ocTableRef
      && (this.GetByte() !== 0 // x parameters
        || (SC_OPCODE_START_NO_PAR <= eOp && eOp < SC_OPCODE_STOP_NO_PAR) // no parameter
        || IsOpCodeJumpCommand(eOp) // @ jump commands
        || (SC_OPCODE_START_1_PAR <= eOp && eOp < SC_OPCODE_STOP_1_PAR) // one parameter
        || (SC_OPCODE_START_2_PAR <= eOp && eOp < SC_OPCODE_STOP_2_PAR) // x parameters (cByte==0 in
        // FuncAutoPilot)
        || eOp === ocMacro || eOp === ocExternal // macros, AddIns
        || eOp === ocAnd || eOp === ocOr // former binary, now x parameters
        || (eOp >= OC.ocInternalBegin && eOp <= OC.ocInternalEnd)); // internal
  }

  IsExternalRef(): boolean {
    switch (this.eType) {
      case svExternalSingleRef:
      case svExternalDoubleRef:
      case svExternalName:
        return true;
      default:
        return false;
    }
  }

  IsRef(): boolean {
    switch (this.eType) {
      case svSingleRef:
      case svDoubleRef:
      case svExternalSingleRef:
      case svExternalDoubleRef:
        return true;
      default:
        if (this.eOp === ocTableRef) return true;
    }
    return false;
  }

  GetParamCount(): number {
    if (this.eOp < OC.SC_OPCODE_STOP_DIV && this.eOp !== ocExternal && this.eOp !== ocMacro
      && !IsOpCodeJumpCommand(this.eOp) && this.eOp !== ocPercentSign) return 0; // parameters and specials
    // ocIf... jump commands not for FAP, have cByte then
    else if (this.GetByte()) return this.GetByte(); // all functions, also ocExternal and ocMacro
    else if (SC_OPCODE_START_BIN_OP <= this.eOp && this.eOp < SC_OPCODE_STOP_BIN_OP && this.eOp !== ocAnd && this.eOp !== ocOr) return 2; // binary operators, compiler checked; OR and AND legacy but are functions
    else if ((SC_OPCODE_START_UN_OP <= this.eOp && this.eOp < SC_OPCODE_STOP_UN_OP) || this.eOp === ocPercentSign) return 1; // unary operators, compiler checked
    else if (SC_OPCODE_START_NO_PAR <= this.eOp && this.eOp < SC_OPCODE_STOP_NO_PAR) return 0; // no parameter
    else if (IsOpCodeJumpCommand(this.eOp)) return 1; // only the condition counts as parameter
    else return 0; // all the rest, no Parameter, or
    // if so then it should be in cByte
  }

  IsInForceArray(): boolean {
    const eParam = this.GetInForceArray();
    return eParam === ParamClass.ForceArray || eParam === ParamClass.ReferenceOrForceArray
      || eParam === ParamClass.SuppressedReferenceOrForceArray || eParam === ParamClass.ForceArrayReturn;
  }

  /**
      Dummy methods to avoid switches and casts where possible,
      the real token classes have to override the appropriate method[s].
   */
  GetByte(): number { return 0; }
  SetByte(n: number): void { void n; }
  GetInForceArray(): ParamClass { return ParamClass.Unknown; }
  SetInForceArray(c: ParamClass): void { void c; }
  GetDouble(): number { return 0.0; }
  SetDouble(fValue: number): void { void fValue; }
  GetDoubleType(): number { return 0; }
  SetDoubleType(nType: number): void { void nType; }
  GetString(): string { return ''; }
  SetString(rStr: string): void { void rStr; }
  GetIndex(): number { return 0; }
  SetIndex(n: number): void { void n; }
  GetSheet(): number { return -1; }
  SetSheet(n: number): void { void n; }
  GetChar(): string { return '\0'; }
  GetJump(): number[] { return []; }
  GetExternal(): string { return ''; }
  GetError(): FormulaError { return FormulaError.NONE; }
  SetError(e: FormulaError): void { void e; }
  // The reference payloads of the Sc token classes.
  GetSingleRef(): any { return null; }
  GetDoubleRef(): any { return null; }
  GetSingleRef2(): any { return null; }
  GetMatrix(): any { return null; }
  GetJumpMatrix(): any { return null; }
  GetRefList(): any[] | null { return null; }

  Clone(): FormulaToken { return new FormulaToken(this.eType, this.eOp); }

  TextEqual(rToken: FormulaToken): boolean { return this.equals(rToken); }

  equals(rToken: FormulaToken): boolean {
    // don't compare reference count!
    return this.eType === rToken.eType && this.GetOpCode() === rToken.GetOpCode();
  }

  /** This is dirty and only the compiler should use it! */
  NewOpCode(e: OpCode): void { this.eOp = e; }
}


export function IsOpCodeJumpCommand(eOp: OpCode): boolean {
  switch (eOp) {
    case ocIf:
    case ocIfError:
    case ocIfNA:
    case ocChoose:
    case ocLet:
      return true;
    default:
  }
  return false;
}

export class FormulaSpaceToken extends FormulaToken {
  private nByte: number;
  private cChar: string;
  constructor(n: number, c: string) {
    super(svByte, ocWhitespace);
    this.nByte = n;
    this.cChar = c;
  }
  override Clone(): FormulaToken { return new FormulaSpaceToken(this.nByte, this.cChar); }
  override GetByte(): number { return this.nByte; }
  override GetChar(): string { return this.cChar; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.nByte === r.GetByte() && this.cChar === r.GetChar(); }
}

export class FormulaByteToken extends FormulaToken {
  private nByte: number;
  private eInForceArray: ParamClass;
  constructor(e: OpCode, n = 0, c: ParamClass = ParamClass.Unknown, v: StackVar = svByte) {
    super(v, e);
    this.nByte = n;
    this.eInForceArray = c;
  }
  override Clone(): FormulaToken { return new FormulaByteToken(this.eOp, this.nByte, this.eInForceArray, this.eType); }
  override GetByte(): number { return this.nByte; }
  override SetByte(n: number): void { this.nByte = n; }
  override GetInForceArray(): ParamClass { return this.eInForceArray; }
  override SetInForceArray(c: ParamClass): void { this.eInForceArray = c; }
  override equals(r: FormulaToken): boolean {
    return super.equals(r) && this.nByte === r.GetByte() && this.eInForceArray === r.GetInForceArray();
  }
}

export class FormulaDoubleToken extends FormulaToken {
  private fDouble: number;
  constructor(f: number) {
    super(svDouble);
    this.fDouble = f;
  }
  override Clone(): FormulaToken { return new FormulaDoubleToken(this.fDouble); }
  override GetDouble(): number { return this.fDouble; }
  override SetDouble(fValue: number): void { this.fDouble = fValue; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.fDouble === r.GetDouble(); }
}

/** FormulaTypedDoubleToken: a double with a number format type (a date, a percent) as hint. */
export class FormulaTypedDoubleToken extends FormulaDoubleToken {
  private mnType: number;
  constructor(f: number, nType: number) {
    super(f);
    this.mnType = nType;
  }
  override Clone(): FormulaToken { return new FormulaTypedDoubleToken(this.GetDouble(), this.mnType); }
  override GetDoubleType(): number { return this.mnType; }
  override SetDoubleType(nType: number): void { this.mnType = nType; }
}

export class FormulaStringToken extends FormulaToken {
  private maString: string;
  constructor(r: string) {
    super(svString);
    this.maString = r;
  }
  override Clone(): FormulaToken { return new FormulaStringToken(this.maString); }
  override GetString(): string { return this.maString; }
  override SetString(rStr: string): void { this.maString = rStr; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.maString === r.GetString(); }
}

/** Identical to FormulaStringToken, but with explicit OpCode instead of implicit
    ocPush, and an optional sal_uInt8 for ocBad tokens. */
export class FormulaStringOpToken extends FormulaByteToken {
  private maString: string;
  constructor(e: OpCode, r: string) {
    super(e, 0, ParamClass.Unknown, svString);
    this.maString = r;
  }
  override Clone(): FormulaToken { return new FormulaStringOpToken(this.eOp, this.maString); }
  override GetString(): string { return this.maString; }
  override SetString(rStr: string): void { this.maString = rStr; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.maString === r.GetString(); }
}

/** FormulaIndexToken: a named expression (ocName) by index, with its sheet (-1 global). */
export class FormulaIndexToken extends FormulaToken {
  private nIndex: number;
  private mnSheet: number;
  constructor(e: OpCode, n: number, nSheet = -1) {
    super(svIndex, e);
    this.nIndex = n;
    this.mnSheet = nSheet;
  }
  override Clone(): FormulaToken { return new FormulaIndexToken(this.eOp, this.nIndex, this.mnSheet); }
  override GetIndex(): number { return this.nIndex; }
  override SetIndex(n: number): void { this.nIndex = n; }
  override GetSheet(): number { return this.mnSheet; }
  override SetSheet(n: number): void { this.mnSheet = n; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.nIndex === r.GetIndex() && this.mnSheet === r.GetSheet(); }
}

export class FormulaExternalToken extends FormulaByteToken {
  private aExternal: string;
  constructor(e: OpCode, r: string, n = 0) {
    super(e, n, ParamClass.Unknown, svExternal);
    this.aExternal = r;
  }
  override Clone(): FormulaToken { return new FormulaExternalToken(this.eOp, this.aExternal, this.GetByte()); }
  override GetExternal(): string { return this.aExternal; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.aExternal === r.GetExternal(); }
}

export class FormulaMissingToken extends FormulaToken {
  constructor() { super(svMissing, ocMissing); }
  override Clone(): FormulaToken { return new FormulaMissingToken(); }
  override GetDouble(): number { return 0.0; }
  override GetString(): string { return ''; }
  override equals(r: FormulaToken): boolean { return super.equals(r); }
}

export class FormulaJumpToken extends FormulaToken {
  private pJump: number[];
  private eInForceArray: ParamClass;
  constructor(e: OpCode, pJumpP?: number[]) {
    super(svJump, e);
    // Upstream allocates nJump[0]+1 shorts; an ocChoose needs FORMULA_MAXJUMPCOUNT+1 slots.
    this.pJump = pJumpP ? [...pJumpP] : [0];
    this.eInForceArray = ParamClass.Unknown;
  }
  override Clone(): FormulaToken { const t = new FormulaJumpToken(this.eOp, this.pJump); t.eInForceArray = this.eInForceArray; return t; }
  override GetJump(): number[] { return this.pJump; }
  override GetInForceArray(): ParamClass { return this.eInForceArray; }
  override SetInForceArray(c: ParamClass): void { this.eInForceArray = c; }
  override equals(r: FormulaToken): boolean {
    if (!super.equals(r)) return false;
    const a = this.pJump, b = r.GetJump();
    if (a[0] !== b[0]) return false;
    for (let i = 1; i <= a[0]!; i++) if (a[i] !== b[i]) return false;
    return this.eInForceArray === r.GetInForceArray();
  }
}

export class FormulaUnknownToken extends FormulaToken {
  constructor(e: OpCode) { super(svUnknown, e); }
  override Clone(): FormulaToken { return new FormulaUnknownToken(this.eOp); }
}

export class FormulaErrorToken extends FormulaToken {
  private nError: FormulaError;
  constructor(nErr: FormulaError) {
    super(svError);
    this.nError = nErr;
  }
  override Clone(): FormulaToken { return new FormulaErrorToken(this.nError); }
  override GetError(): FormulaError { return this.nError; }
  override SetError(nErr: FormulaError): void { this.nError = nErr; }
  override equals(r: FormulaToken): boolean { return super.equals(r) && this.nError === r.GetError(); }
}

// --- FormulaTokenArray --------------------------------------------------------------------------

export class FormulaTokenArray {
  /** The tokens as entered (pCode). */
  protected pCode: FormulaToken[] = [];
  /** The RPN code (pRPN). */
  protected pRPN: FormulaToken[] = [];
  protected nError: FormulaError = FormulaError.NONE;
  protected nMode: ScRecalcMode = ScRecalcMode.NORMAL;
  protected bHyperLink = false;
  protected mbFromRangeName = false;
  protected mbShareable = true;
  protected mbFinalized = false;

  /** Copy the tokens and the RPN (sharing token objects between both as upstream). */
  Assign(r: FormulaTokenArray): void {
    const map = new Map<FormulaToken, FormulaToken>();
    const cl = (t: FormulaToken) => { let c = map.get(t); if (!c) { c = t.Clone(); map.set(t, c); } return c; };
    this.pCode = r.pCode.map(cl);
    this.pRPN = r.pRPN.map(cl);
    this.nError = r.nError;
    this.nMode = r.nMode;
    this.bHyperLink = r.bHyperLink;
    this.mbFromRangeName = r.mbFromRangeName;
    this.mbShareable = r.mbShareable;
  }

  Clear(): void {
    this.pCode = [];
    this.pRPN = [];
    this.nError = FormulaError.NONE;
    this.nMode = ScRecalcMode.NORMAL;
    this.bHyperLink = false;
  }

  DelRPN(): void { this.pRPN = []; }

  FirstToken(): FormulaToken | null { return this.pCode[0] ?? null; }
  FirstRPNToken(): FormulaToken | null { return this.pRPN[0] ?? null; }

  HasReferences(): boolean {
    for (const t of this.pCode) if (t.IsRef()) return true;
    for (const t of this.pRPN) if (t.IsRef()) return true;
    return false;
  }

  HasExternalRef(): boolean {
    for (const t of this.pCode) if (t.IsExternalRef()) return true;
    return false;
  }

  HasOpCode(eOp: OpCode): boolean {
    for (const t of this.pCode) if (t.GetOpCode() === eOp) return true;
    return false;
  }
  HasOpCodeRPN(eOp: OpCode): boolean {
    for (const t of this.pRPN) if (t.GetOpCode() === eOp) return true;
    return false;
  }
  /** Token of type svIndex or opcode ocColRowName */
  HasNameOrColRowName(): boolean {
    for (const t of this.pCode) if (t.GetType() === svIndex || t.GetOpCode() === ocColRowName) return true;
    return false;
  }

  /** The tokens as entered. */
  GetArray(): FormulaToken[] { return this.pCode; }
  GetLen(): number { return this.pCode.length; }
  /** The RPN code. */
  GetCode(): FormulaToken[] { return this.pRPN; }
  GetCodeLen(): number { return this.pRPN.length; }
  TokenAt(n: number): FormulaToken | null { return this.pCode[n] ?? null; }

  GetCodeError(): FormulaError { return this.nError; }
  SetCodeError(n: FormulaError): void { this.nError = n; }
  SetHyperLink(bVal: boolean): void { this.bHyperLink = bVal; }
  IsHyperLink(): boolean { return this.bHyperLink; }

  GetRecalcMode(): ScRecalcMode { return this.nMode; }
  /** Bits aren't set directly but validated and handled according to priority if more than one exclusive bit is set. */
  AddRecalcMode(nBits: ScRecalcMode): void {
    const nExclusive = nBits & ScRecalcMode.EMask;
    if (nExclusive) {
      let nExBit: number;
      if (nExclusive & (nExclusive - 1)) {
        // More than one bit set, use highest priority.
        for (nExBit = 1; (nExBit & ScRecalcMode.EMask) !== 0; nExBit <<= 1) {
          if (nExclusive & nExBit) break;
        }
      } else nExBit = nExclusive;
      // Set exclusive bit if priority is higher than existing.
      if (nExBit < (this.nMode & ScRecalcMode.EMask)) this.SetMaskedRecalcMode(nExBit);
    }
    this.SetCombinedBitsRecalcMode(nBits);
  }
  ClearRecalcMode(): void { this.nMode = ScRecalcMode.NORMAL; }
  SetExclusiveRecalcModeNormal(): void { this.SetMaskedRecalcMode(ScRecalcMode.NORMAL); }
  SetExclusiveRecalcModeAlways(): void { this.SetMaskedRecalcMode(ScRecalcMode.ALWAYS); }
  SetMaskedRecalcMode(nBits: ScRecalcMode): void { this.nMode = (this.nMode & ~ScRecalcMode.EMask) | nBits; }
  SetCombinedBitsRecalcMode(nBits: ScRecalcMode): void { this.nMode |= nBits & ~ScRecalcMode.EMask; }
  IsRecalcModeNormal(): boolean { return (this.nMode & ScRecalcMode.NORMAL) !== 0; }
  IsRecalcModeAlways(): boolean { return (this.nMode & ScRecalcMode.ALWAYS) !== 0; }
  IsRecalcModeOnLoad(): boolean { return (this.nMode & ScRecalcMode.ONLOAD_MUST) !== 0; }
  IsRecalcModeForced(): boolean { return (this.nMode & ScRecalcMode.FORCED) !== 0; }
  SetRecalcModeForced(): void { this.nMode |= ScRecalcMode.FORCED; }
  IsRecalcModeOnRefMove(): boolean { return (this.nMode & ScRecalcMode.ONREFMOVE) !== 0; }
  SetRecalcModeOnRefMove(): void { this.nMode |= ScRecalcMode.ONREFMOVE; }

  IsFromRangeName(): boolean { return this.mbFromRangeName; }
  SetFromRangeName(b: boolean): void { this.mbFromRangeName = b; }
  IsShareable(): boolean { return this.mbShareable; }

  /** Get OpCode of the most outer function. */
  GetOuterFuncOpCode(): OpCode {
    if (this.pRPN.length) return this.pRPN[this.pRPN.length - 1]!.GetOpCode();
    return OC.ocNone;
  }

  /** Operators +,-,*,/,^,&,=,<>,<,>,<=,>= with DoubleRef in Formula? */
  HasMatrixDoubleRefOps(): boolean { return false; }

  /** Returns the opcode of the token before the index, ocNone when there is none. */
  OpCodeBefore(nIdx: number): OpCode {
    if (nIdx > 0 && nIdx <= this.pCode.length) return this.pCode[nIdx - 1]!.GetOpCode();
    return OC.ocNone;
  }

  /** Adds the token at the end of pCode; an ocArrayClose merges the inline array (MergeArray),
      null when that fails or on overflow. */
  Add(t: FormulaToken): FormulaToken | null {
    if (this.pCode.length >= FORMULA_MAXTOKENS - 1) {
      if (this.pCode.length === FORMULA_MAXTOKENS - 1) {
        this.pCode.push(new FormulaByteToken(ocStop));
      }
      this.SetCodeError(FormulaError.CodeOverflow);
      return null;
    }
    this.pCode.push(t);
    if (t.GetOpCode() === ocArrayClose) return this.MergeArray();
    return t;
  }

  /** Merges an inline array; implemented by ScTokenArray. */
  MergeArray(): FormulaToken | null { return null; }

  AddString(rStr: string): FormulaToken | null { return this.Add(new FormulaStringToken(rStr)); }
  AddDouble(fVal: number): FormulaToken | null { return this.Add(new FormulaDoubleToken(fVal)); }
  AddExternal(rStr: string, eOp: OpCode = ocExternal): FormulaToken | null { return this.Add(new FormulaExternalToken(eOp, rStr)); }
  AddBad(rStr: string): FormulaToken | null { return this.Add(new FormulaStringOpToken(ocBad, rStr)); }
  AddStringXML(rStr: string): FormulaToken | null { return this.Add(new FormulaStringOpToken(OC.ocStringXML, rStr)); }
  AddOpCode(eOp: OpCode): FormulaToken | null {
    let pRet: FormulaToken;
    switch (eOp) {
      case ocOpen:
      case ocClose:
      case ocSep:
      case ocArrayOpen:
      case ocArrayClose:
      case ocArrayRowSep:
      case ocArrayColSep:
        pRet = new FormulaToken(svSep, eOp);
        break;
      case ocIf:
      case ocIfError:
      case ocIfNA:
      case ocChoose:
      case ocLet: {
        const nJump = new Array<number>(eOp === ocChoose ? FORMULA_MAXJUMPCOUNT + 1 : eOp === ocLet ? FORMULA_MAXPARAMS + 1 : 4).fill(0);
        nJump[0] = eOp === ocIf ? 3 : eOp === ocChoose ? FORMULA_MAXJUMPCOUNT + 1 : eOp === ocLet ? FORMULA_MAXPARAMS + 1 : 2;
        pRet = new FormulaJumpToken(eOp, nJump);
        break;
      }
      default:
        pRet = new FormulaByteToken(eOp, 0, ParamClass.Unknown);
        break;
    }
    return this.Add(pRet);
  }
  AddSpaces(n: number): FormulaToken | null { return this.Add(new FormulaByteToken(ocSpaces, n)); }
  AddWhitespace(n: number, c: string): FormulaToken | null { return this.Add(new FormulaSpaceToken(n, c)); }

  /** Replace the token at the position; CODE_ONLY leaves the RPN alone. */
  ReplaceToken(nOffset: number, t: FormulaToken): FormulaToken | null {
    if (nOffset < this.pCode.length) {
      const p = this.pCode[nOffset]!;
      this.pCode[nOffset] = t;
      for (let i = 0; i < this.pRPN.length; i++) if (this.pRPN[i] === p) this.pRPN[i] = t;
      return t;
    }
    return null;
  }

  /** Remove a sequence of tokens from pCode array, and pRPN array if the tokens are referenced there. */
  RemoveToken(nOffset: number, nCount: number): number {
    if (nOffset < this.pCode.length) {
      const nStop = Math.min(nOffset + nCount, this.pCode.length);
      nCount = nStop - nOffset;
      const removed = this.pCode.splice(nOffset, nCount);
      this.pRPN = this.pRPN.filter((t) => !removed.includes(t));
      return nCount;
    }
    return 0;
  }

  CreateNewRPNArrayFromData(pData: FormulaToken[]): void { this.pRPN = [...pData]; }

  /** Sets the code (as loaded by a filter); the RPN is created by compiling. */
  SetCode(pCode: FormulaToken[]): void { this.pCode = pCode; this.pRPN = []; }

  NeedsPodfRewrite(): boolean { return false; }
  NeedsOoxmlRewrite(): boolean { return false; }

  /** Whether the array would be the same if it was recompiled; true when there are no named
      expressions or column/row labels in it. */
  Finalize(): void { this.mbFinalized = true; }
}


export class FormulaTokenArrayPlainIterator {
  private mpFTA: FormulaTokenArray;
  private mnIndex = 0; // Current step index

  constructor(rFTA: FormulaTokenArray) { this.mpFTA = rFTA; }

  Reset(): void { this.mnIndex = 0; }
  GetIndex(): number { return this.mnIndex; }

  First(): FormulaToken | null {
    this.mnIndex = 0;
    return this.Next();
  }

  Jump(nIndex: number): void { this.mnIndex = nIndex; }

  Next(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    if (this.mnIndex < a.length) return a[this.mnIndex++]!;
    return null;
  }

  NextNoSpaces(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    while (this.mnIndex < a.length && (a[this.mnIndex]!.GetOpCode() === ocSpaces || a[this.mnIndex]!.GetOpCode() === ocWhitespace)) ++this.mnIndex;
    if (this.mnIndex < a.length) return a[this.mnIndex++]!;
    return null;
  }

  GetNextName(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    while (this.mnIndex < a.length) {
      const t = a[this.mnIndex++]!;
      if (t.GetType() === svIndex) return t;
    }
    return null;
  }

  GetNextReference(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    while (this.mnIndex < a.length) {
      const t = a[this.mnIndex++]!;
      switch (t.GetType()) {
        case svSingleRef:
        case svDoubleRef:
        case svExternalSingleRef:
        case svExternalDoubleRef:
          return t;
        default:
      }
    }
    return null;
  }

  GetNextReferenceRPN(): FormulaToken | null {
    const a = this.mpFTA.GetCode();
    while (this.mnIndex < a.length) {
      const t = a[this.mnIndex++]!;
      switch (t.GetType()) {
        case svSingleRef:
        case svDoubleRef:
        case svExternalSingleRef:
        case svExternalDoubleRef:
          return t;
        default:
      }
    }
    return null;
  }

  GetNextColRowName(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    while (this.mnIndex < a.length) {
      const t = a[this.mnIndex++]!;
      if (t.GetOpCode() === ocColRowName) return t;
    }
    return null;
  }

  FirstRPN(): FormulaToken | null {
    this.mnIndex = 0;
    return this.NextRPN();
  }

  NextRPN(): FormulaToken | null {
    const a = this.mpFTA.GetCode();
    if (this.mnIndex < a.length) return a[this.mnIndex++]!;
    return null;
  }

  PrevRPN(): FormulaToken | null {
    const a = this.mpFTA.GetCode();
    if (this.mnIndex) return a[--this.mnIndex]!;
    return null;
  }

  PeekNext(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    if (this.mnIndex < a.length) return a[this.mnIndex]!;
    return null;
  }

  PeekNextNoSpaces(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    if (this.mnIndex < a.length) {
      let j = this.mnIndex;
      while (j < a.length && (a[j]!.GetOpCode() === ocSpaces || a[j]!.GetOpCode() === ocWhitespace)) j++;
      if (j < a.length) return a[j]!;
      return null;
    }
    return null;
  }

  PeekPrevNoSpaces(): FormulaToken | null {
    const a = this.mpFTA.GetArray();
    if (this.mnIndex > 1) {
      let j = this.mnIndex - 2;
      while (j > 0 && (a[j]!.GetOpCode() === ocSpaces || a[j]!.GetOpCode() === ocWhitespace)) j--;
      if (j > 0 || (a[j]!.GetOpCode() !== ocSpaces && a[j]!.GetOpCode() !== ocWhitespace)) return a[j]!;
      return null;
    }
    return null;
  }

  StepBack(): void {
    if (this.mnIndex) this.mnIndex--;
  }

  AfterRemoveToken(nOffset: number, nCount: number): void {
    if (nOffset < this.mnIndex) {
      const nStop = Math.min(nOffset + nCount, this.mpFTA.GetLen() + nCount);
      if (this.mnIndex >= nStop) this.mnIndex -= nCount;
      else this.mnIndex = nOffset;
    }
  }
}

interface FormulaTokenIteratorItem { pArr: FormulaTokenArray; nPC: number; nStop: number; bLambda: boolean }

/** The interpreter's iterator over the RPN code, following IF/CHOOSE jumps with a stack. */
export class FormulaTokenIterator {
  private maStack: FormulaTokenIteratorItem[];

  constructor(rArr: FormulaTokenArray) {
    this.maStack = [{ pArr: rArr, nPC: -1, nStop: 0x7fff, bLambda: false }];
  }

  Push(pArr: FormulaTokenArray): void { this.maStack.push({ pArr, nPC: -1, nStop: 0x7fff, bLambda: false }); }
  Pop(): void { this.maStack.pop(); }
  FrontPop(): void { this.maStack.shift(); }
  Lambda(bOpt: boolean): void { this.maStack[this.maStack.length - 1]!.bLambda = bOpt; }

  Reset(): void {
    while (this.maStack.length > 1) this.maStack.pop();
    const b = this.maStack[this.maStack.length - 1]!;
    if (!b.bLambda) b.nPC = -1;
  }

  Next(): FormulaToken | null {
    const t = this.GetNonEndOfPathToken(++this.maStack[this.maStack.length - 1]!.nPC);
    if (!t && this.maStack.length > 1) {
      this.Pop();
      return this.Next();
    }
    return t;
  }

  PeekNextOperator(): FormulaToken | null {
    let t: FormulaToken | null = null;
    let nIdx = this.maStack[this.maStack.length - 1]!.nPC;
    for (;;) {
      t = this.GetNonEndOfPathToken(++nIdx);
      if (t === null || t.GetOpCode() !== ocPush) break; // ignore operands
    }
    if (!t && this.maStack.length > 1) {
      const aHere = this.maStack.pop()!;
      t = this.PeekNextOperator();
      this.maStack.push(aHere);
    }
    return t;
  }

  //! The nPC counts after a Push() are -1
  Jump(nStart: number, nNext: number, nStop = 0x7fff): void {
    const b = this.maStack[this.maStack.length - 1]!;
    b.nPC = nNext;
    if (nStart !== nNext) {
      this.Push(b.pArr);
      const c = this.maStack[this.maStack.length - 1]!;
      c.nPC = nStart;
      c.nStop = nStop;
    }
  }

  ReInit(rArr: FormulaTokenArray): void {
    this.maStack = [];
    this.Push(rArr);
  }

  GetPC(): number { return this.maStack[this.maStack.length - 1]!.nPC; }

  GetNonEndOfPathToken(nIdx: number): FormulaToken | null {
    const cur = this.maStack[this.maStack.length - 1]!;
    if (nIdx < cur.pArr.GetCodeLen() && nIdx < cur.nStop) {
      const t = cur.pArr.GetCode()[nIdx]!;
      // such an OpCode ends an IF() or CHOOSE() path
      return t.GetOpCode() === ocSep || t.GetOpCode() === ocClose ? null : t;
    }
    return null;
  }

  IsEndOfPath(): boolean {
    return this.GetNonEndOfPathToken(this.maStack[this.maStack.length - 1]!.nPC + 1) === null;
  }
}

