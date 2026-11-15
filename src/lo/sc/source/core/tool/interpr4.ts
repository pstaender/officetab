// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/core/inc/interpre.hxx reduced
// @upstream sc/source/core/tool/interpr4.cxx reduced
// ScInterpreter: the stack machine that runs a formula's RPN code. This file holds the class,
// the stack (Push*, Pop*, Get*), cell access, the main loop Interpret() and the result. The
// functions are added to the class by the other interpr*.ts files (as upstream splits them over
// interpr1.cxx to interpr8.cxx): each assigns its methods to ScInterpreter.prototype under the
// upstream names and registers the opcodes it implements with ScInterpreter.Register. An opcode
// without an implementation yields Err:517 (UnknownOpCode). Left out: table operations, external
// references and macros; add-in calls (ScExternal) are in sc/source/core/tool/addincol.ts.
import { CreateDoubleError, FormulaError, GetDoubleErrorValue } from '../../../../include/formula/errorcodes.ts';
import type { OpCode } from '../../../../include/formula/opcode.ts';
import * as OC from '../../../../include/formula/opcode.ts';
import {
  FormulaDoubleToken, FormulaErrorToken, ParamClass, FormulaMissingToken, FormulaStringToken, FormulaTokenIterator, FormulaTypedDoubleToken, IsOpCodeJumpCommand,
  StackVar, svDouble, svDoubleRef, svEmptyCell, svError, svJumpMatrix, svMatrix, svMissing, svRefList, svSingleRef, svString, svStringName, svUnknown,
  type FormulaToken,
} from '../../../../formula/source/core/api/token.ts';
import { approxCeil, approxFloor, doubleToUString, rtl_math_DecimalPlaces_Max, rtl_math_StringFormat } from '../../../../sal/rtl/math.ts';
import { GetType as NFGetType, IsNumberFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, ScRange, ValidTab, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue } from '../../../inc/cellvalue.ts';
import { SubtotalFlags } from '../../../inc/global.ts';
import { ScComplexRefData, ScSingleRefData } from '../../../inc/refdata.ts';
import type { ScDocument } from '../data/document.ts';
import type { ScFormulaCell } from '../data/formulacell.ts';
import { ScMatrix } from './scmatrix.ts';
import { ScJumpMatrix } from './jumpmatrix.ts';
import { GetAddInCollection, ScUnoAddInCall } from './addincol.ts';
import { ScRangeToSequence } from './rangeseq.ts';
import { ScAddInArgumentType, type UnoAny } from '../../../inc/addincol.ts';
import { ScParameterClassification } from './parclass.ts';
import { ScDoubleRefToken, ScEmptyCellToken, ScJumpMatrixToken, ScMatrixToken, ScSingleRefToken, type ScRefList, type ScTokenArray } from './token.ts';

export const MAXSTACK = 512;

/** An opcode implementation: a method of the interpreter. */
export type ScOpCodeFunc = (this: ScInterpreter) => void;

export class ScInterpreter {
  /** The opcode table filled by the interpr*.ts files. */
  static readonly maOpCodeFuncs = new Map<OpCode, ScOpCodeFunc>();

  /** Register the implementation of an opcode. */
  static Register(eOp: OpCode, f: ScOpCodeFunc): void { ScInterpreter.maOpCodeFuncs.set(eOp, f); }

  mrDoc: ScDocument;
  aPos: ScAddress;
  pArr: ScTokenArray;
  aCode: FormulaTokenIterator;
  pMyFormulaCell: ScFormulaCell | null;
  pCur!: FormulaToken;
  pStack: FormulaToken[] = [];
  sp = 0;
  maxsp = 0;
  nGlobalError: FormulaError = FormulaError.NONE;
  /** The parameter count of the current function (cPar). */
  cPar = 0;
  bCalcAsShown = false;
  bMatrixFormula = false;
  /** The error a string that is no number gives in a numeric context. */
  mnStringNoValueError: FormulaError = FormulaError.NoValue;
  mnSubTotalFlags: SubtotalFlags = SubtotalFlags.NONE;
  nRetFmtType: SvNumFormatType = SvNumFormatType.NUMBER;
  /** The format code of the result ('' for the type's standard format; upstream's index). */
  nRetFmtIndex = '';
  nFuncFmtType: SvNumFormatType = SvNumFormatType.NUMBER;
  nFuncFmtIndex = '';
  nCurFmtType: SvNumFormatType = SvNumFormatType.NUMBER;
  nCurFmtIndex = '';
  xResult: FormulaToken | null = null;
  /** The jump matrix in effect while a path is run per element (pJumpMatrix). */
  pJumpMatrix: ScJumpMatrix | null = null;
  /** Results of array paths and jump matrices by the token that created them (maTokenMatrixMap). */
  maTokenMatrixMap = new Map<FormulaToken, FormulaToken>();

  constructor(pCell: ScFormulaCell | null, rDoc: ScDocument, rPos: ScAddress, rTokArray: ScTokenArray) {
    this.mrDoc = rDoc;
    this.aPos = rPos.clone();
    this.pArr = rTokArray;
    this.aCode = new FormulaTokenIterator(rTokArray);
    this.pMyFormulaCell = pCell;
    this.bCalcAsShown = rDoc.GetDocOptions().IsCalcAsShown();
    if (pCell) {
      const cMatFlag = pCell.GetMatrixFlag();
      this.bMatrixFormula = cMatFlag === 1 /* ScMatrixMode::Formula */;
    }
  }

  Init(pCell: ScFormulaCell | null, rPos: ScAddress, rTokArray: ScTokenArray): void {
    this.aCode.ReInit(rTokArray);
    this.aPos = rPos.clone();
    this.pArr = rTokArray;
    this.xResult = null;
    this.pJumpMatrix = null;
    this.maTokenMatrixMap.clear();
    this.pMyFormulaCell = pCell;
    this.pStack = [];
    this.sp = 0;
    this.maxsp = 0;
    this.nGlobalError = FormulaError.NONE;
  }

  // --- errors -------------------------------------------------------------------------------------

  SetError(nError: FormulaError): void {
    if (nError !== FormulaError.NONE && this.nGlobalError === FormulaError.NONE) this.nGlobalError = nError;
  }
  GetError(): FormulaError { return this.nGlobalError; }

  /** If nGlobalError is set push it and return true. */
  IfErrorPushError(): boolean {
    if (this.nGlobalError !== FormulaError.NONE) {
      this.PushTempTokenWithoutError(new FormulaErrorToken(this.nGlobalError));
      return true;
    }
    return false;
  }

  /** A non-finite value sets the error it codes (or #VALUE!) and becomes 0 (TreatDoubleError). */
  TreatDoubleError(rVal: number): number {
    if (!Number.isFinite(rVal)) {
      const nErr = GetDoubleErrorValue(rVal);
      if (nErr !== FormulaError.NONE) this.SetError(nErr);
      else this.SetError(FormulaError.NoValue);
      return 0.0;
    }
    return rVal;
  }

  // --- the stack ----------------------------------------------------------------------------------

  PushWithoutError(r: FormulaToken): void {
    if (this.sp >= MAXSTACK) this.SetError(FormulaError.StackOverflow);
    else {
      if (this.sp >= this.maxsp) this.maxsp = this.sp + 1;
      this.pStack[this.sp] = r;
      ++this.sp;
    }
  }

  Push(r: FormulaToken): void {
    if (this.sp >= MAXSTACK) this.SetError(FormulaError.StackOverflow);
    else if (this.nGlobalError !== FormulaError.NONE) {
      if (r.GetType() === svError) this.PushWithoutError(r);
      else this.PushTempTokenWithoutError(new FormulaErrorToken(this.nGlobalError));
    } else this.PushWithoutError(r);
  }

  PushTempToken(p: FormulaToken): void {
    if (this.sp >= MAXSTACK) {
      this.SetError(FormulaError.StackOverflow);
      return;
    }
    if (this.nGlobalError !== FormulaError.NONE) {
      if (p.GetType() === svError) {
        p.SetError(this.nGlobalError);
        this.PushTempTokenWithoutError(p);
      } else this.PushTempTokenWithoutError(new FormulaErrorToken(this.nGlobalError));
    } else this.PushTempTokenWithoutError(p);
  }

  PushTempTokenWithoutError(p: FormulaToken): void {
    if (this.sp >= MAXSTACK) this.SetError(FormulaError.StackOverflow);
    else {
      if (this.sp >= this.maxsp) this.maxsp = this.sp + 1;
      this.pStack[this.sp] = p;
      ++this.sp;
    }
  }

  PushTokenRef(x: FormulaToken): void {
    if (this.sp >= MAXSTACK) this.SetError(FormulaError.StackOverflow);
    else if (this.nGlobalError !== FormulaError.NONE) {
      if (x.GetType() === svError && x.GetError() === this.nGlobalError) this.PushTempTokenWithoutError(x);
      else this.PushTempTokenWithoutError(new FormulaErrorToken(this.nGlobalError));
    } else this.PushTempTokenWithoutError(x);
  }

  /** Obtain cell result / content from address and push as temp token (PushCellResultToken). */
  PushCellResultToken(bDisplayEmptyAsString: boolean, rAddress: ScAddress, bFinalResult = false): { nRetType: SvNumFormatType; nRetIndex: string } {
    const aCell = this.mrDoc.GetRefCellValue(rAddress);
    if (aCell.hasEmptyValue()) {
      const bInherited = aCell.getType() === CELLTYPE_FORMULA;
      const r = { nRetType: NFGetType(this.mrDoc.GetNumberFormat(rAddress), 'en-US'), nRetIndex: this.mrDoc.GetNumberFormat(rAddress) };
      this.PushTempToken(new ScEmptyCellToken(bInherited, bDisplayEmptyAsString));
      return r;
    }
    let nErr: FormulaError = FormulaError.NONE;
    if (aCell.getType() === CELLTYPE_FORMULA) nErr = aCell.getFormula()!.GetErrCode();
    if (nErr !== FormulaError.NONE) {
      this.PushError(nErr);
      return { nRetType: SvNumFormatType.NUMBER, nRetIndex: '' };
    }
    if (aCell.hasString()) {
      this.PushString(this.GetCellString(aCell));
      return { nRetType: SvNumFormatType.TEXT, nRetIndex: '' };
    }
    let fVal = this.GetCellValue(rAddress, aCell);
    if (bFinalResult) {
      fVal = this.TreatDoubleError(fVal);
      if (!this.IfErrorPushError()) this.PushTempTokenWithoutError(this.CreateFormulaDoubleToken(fVal));
    } else this.PushDouble(fVal);
    return { nRetType: this.nCurFmtType, nRetIndex: this.nCurFmtIndex };
  }

  // Simply throw away TOS.
  Pop(): void {
    if (this.sp) this.sp--;
    else this.SetError(FormulaError.UnknownStackVariable);
  }

  // Simply throw away TOS and set error code, used with ocIsError et al.
  PopError(): void {
    if (this.sp) {
      this.sp--;
      if (this.pStack[this.sp]!.GetType() === svError) this.nGlobalError = this.pStack[this.sp]!.GetError();
    } else this.SetError(FormulaError.UnknownStackVariable);
  }

  PopToken(): FormulaToken | null {
    if (this.sp) {
      this.sp--;
      const p = this.pStack[this.sp]!;
      if (p.GetType() === svError) this.nGlobalError = p.GetError();
      return p;
    }
    this.SetError(FormulaError.UnknownStackVariable);
    return null;
  }

  PopDouble(): number {
    this.nCurFmtType = SvNumFormatType.NUMBER;
    this.nCurFmtIndex = '';
    if (this.sp) {
      --this.sp;
      const p = this.pStack[this.sp]!;
      switch (p.GetType()) {
        case svError:
          this.nGlobalError = p.GetError();
          break;
        case svDouble: {
          const nType = p.GetDoubleType();
          if (nType) this.nCurFmtType = nType as SvNumFormatType;
          return p.GetDouble();
        }
        case svEmptyCell:
        case svMissing:
          return 0.0;
        default:
          this.SetError(FormulaError.IllegalArgument);
      }
    } else this.SetError(FormulaError.UnknownStackVariable);
    return 0.0;
  }

  PopString(): string {
    this.nCurFmtType = SvNumFormatType.TEXT;
    this.nCurFmtIndex = '';
    if (this.sp) {
      --this.sp;
      const p = this.pStack[this.sp]!;
      switch (p.GetType()) {
        case svError:
          this.nGlobalError = p.GetError();
          break;
        case svString:
        case svStringName:
          return p.GetString();
        case svEmptyCell:
        case svMissing:
          return '';
        default:
          this.SetError(FormulaError.IllegalArgument);
      }
    } else this.SetError(FormulaError.UnknownStackVariable);
    return '';
  }

  /** The absolute address of a reference, setting #REF! for invalid parts (SingleRefToVars). */
  SingleRefToVars(rRef: ScSingleRefData): { nCol: SCCOL; nRow: SCROW; nTab: SCTAB } {
    let nCol = rRef.IsColRel() ? this.aPos.Col() + rRef.Col() : rRef.Col();
    let nRow = rRef.IsRowRel() ? this.aPos.Row() + rRef.Row() : rRef.Row();
    let nTab = rRef.IsTabRel() ? this.aPos.Tab() + rRef.Tab() : rRef.Tab();
    if (!this.mrDoc.ValidCol(nCol) || rRef.IsColDeleted()) {
      this.SetError(FormulaError.NoRef);
      nCol = 0;
    }
    if (!this.mrDoc.ValidRow(nRow) || rRef.IsRowDeleted()) {
      this.SetError(FormulaError.NoRef);
      nRow = 0;
    }
    if (!ValidTab(nTab, this.mrDoc.GetTableCount() - 1) || rRef.IsTabDeleted()) {
      this.SetError(FormulaError.NoRef);
      nTab = 0;
    }
    return { nCol, nRow, nTab };
  }

  PopSingleRef(): ScAddress {
    const rAdr = new ScAddress();
    if (this.sp) {
      --this.sp;
      const p = this.pStack[this.sp]!;
      switch (p.GetType()) {
        case svError:
          this.nGlobalError = p.GetError();
          break;
        case svSingleRef: {
          const pRefData = p.GetSingleRef() as ScSingleRefData;
          if (pRefData.IsDeleted()) {
            this.SetError(FormulaError.NoRef);
            break;
          }
          const v = this.SingleRefToVars(pRefData);
          rAdr.Set(v.nCol, v.nRow, v.nTab);
          break;
        }
        default:
          this.SetError(FormulaError.IllegalParameter);
      }
    } else this.SetError(FormulaError.UnknownStackVariable);
    return rAdr;
  }

  DoubleRefToRange(rCRef: ScComplexRefData): ScRange {
    const a = this.SingleRefToVars(rCRef.Ref1);
    const b = this.SingleRefToVars(rCRef.Ref2);
    return new ScRange(Math.min(a.nCol, b.nCol), Math.min(a.nRow, b.nRow), Math.min(a.nTab, b.nTab), Math.max(a.nCol, b.nCol), Math.max(a.nRow, b.nRow), Math.max(a.nTab, b.nTab));
  }

  /** Pop a range; a reference list yields its ranges one by one (rRefInList counts, rParam is
      incremented while ranges remain). */
  PopDoubleRef(rState?: { nParam: number; nRefInList: number }): ScRange {
    let rRange = new ScRange();
    if (this.sp) {
      const pToken = this.pStack[this.sp - 1]!;
      switch (pToken.GetType()) {
        case svError:
          --this.sp;
          this.nGlobalError = pToken.GetError();
          break;
        case svDoubleRef: {
          --this.sp;
          const pRefData = pToken.GetDoubleRef() as ScComplexRefData;
          if (pRefData.IsDeleted()) {
            this.SetError(FormulaError.NoRef);
            break;
          }
          rRange = this.DoubleRefToRange(pRefData);
          break;
        }
        case svRefList: {
          const pList = pToken.GetRefList() as ScRefList;
          const st = rState ?? { nParam: 0, nRefInList: 0 };
          if (st.nRefInList < pList.length) {
            rRange = this.DoubleRefToRange(pList[st.nRefInList]!);
            if (++st.nRefInList < pList.length) ++st.nParam;
            else {
              --this.sp;
              st.nRefInList = 0;
            }
          } else {
            --this.sp;
            st.nRefInList = 0;
            this.SetError(FormulaError.IllegalParameter);
          }
          break;
        }
        default:
          --this.sp;
          this.SetError(FormulaError.IllegalParameter);
      }
    } else this.SetError(FormulaError.UnknownStackVariable);
    return rRange;
  }

  /** The implicit intersection of a range with the formula's row or column, or the reference;
      null with an error set when there is none. */
  PopDoubleRefOrSingleRef(): ScAddress | null {
    switch (this.GetStackType()) {
      case svDoubleRef: {
        const aRange = this.PopDoubleRef();
        return this.DoubleRefToPosSingleRef(aRange);
      }
      case svSingleRef:
        return this.PopSingleRef();
      default:
        this.PopError();
        this.SetError(FormulaError.NoRef);
    }
    return null;
  }

  PopDoubleRefPushMatrix(): void {
    if (this.GetStackType() === svDoubleRef) {
      const pMat = this.GetMatrix();
      if (pMat) this.PushMatrix(pMat);
      else this.PushIllegalParameter();
    } else this.SetError(FormulaError.NoRef);
  }

  /** If MatrixFormula: ConvertMatrixJumpConditionToMatrix() (MatrixJumpConditionToMatrix). */
  MatrixJumpConditionToMatrix(): void {
    if (this.IsInArrayContext()) this.ConvertMatrixJumpConditionToMatrix();
  }

  /** For MatrixFormula (preconditions already checked by MatrixJumpConditionToMatrix()): convert
      svDoubleRef to svMatrix, or if JumpMatrix currently in effect convert also other types to
      svMatrix so another JumpMatrix will be created by jump commands. */
  ConvertMatrixJumpConditionToMatrix(): void {
    const eStackType = this.GetStackType();
    if (eStackType === svUnknown) return; // can't do anything, some caller will catch that
    if (eStackType === svMatrix) return; // already matrix, nothing to do

    if (eStackType !== svDoubleRef && this.GetStackType(2) !== svJumpMatrix) return; // always convert svDoubleRef, others only in JumpMatrix context

    const pMat = this.GetMatrix();
    if (pMat) this.PushMatrix(pMat);
    else this.PushIllegalParameter();
  }

  /** If MatrixFormula or ForceArray: ConvertMatrixParameters() (MatrixParameterConversion). */
  MatrixParameterConversion(): boolean {
    if ((this.IsInArrayContext() || ScParameterClassification.HasForceArray(this.pCur.GetOpCode())) && !this.pJumpMatrix && this.sp > 0) return this.ConvertMatrixParameters();
    return false;
  }

  ConvertMatrixParameters(): boolean {
    const nParams = this.pCur.GetParamCount();
    let nJumpCols = 0, nJumpRows = 0;
    for (let i = 1; i <= nParams && i <= this.sp; ++i) {
      const p = this.pStack[this.sp - i]!;
      if (p.GetOpCode() !== OC.ocPush && p.GetOpCode() !== OC.ocMissing) {
        // ConvertMatrixParameters: not a push
        continue;
      }
      switch (p.GetType()) {
        case svDouble:
        case svString:
        case svStringName:
        case svSingleRef:
        case svMissing:
        case svError:
        case svEmptyCell:
          // nothing to do
          break;
        case svMatrix: {
          if (ScParameterClassification.GetParameterType(this.pCur, nParams - i) === ParamClass.Value) {
            // only if single value expected
            const pMat = p.GetMatrix() as ScMatrix | null;
            if (!pMat) this.SetError(FormulaError.UnknownVariable);
            else {
              const { nC: nCols, nR: nRows } = pMat.GetDimensions();
              if (nJumpCols < nCols) nJumpCols = nCols;
              if (nJumpRows < nRows) nJumpRows = nRows;
            }
          }
          break;
        }
        case svDoubleRef: {
          const eType = ScParameterClassification.GetParameterType(this.pCur, nParams - i);
          if (eType !== ParamClass.Reference && eType !== ParamClass.ReferenceOrRefArray && eType !== ParamClass.ReferenceOrForceArray &&
            // For scalar Value: convert to Array/JumpMatrix
            // only if in array formula context, else (function
            // has ForceArray or ReferenceOrForceArray
            // parameter *somewhere else*) pick a normal
            // position dependent implicit intersection later.
            (eType !== ParamClass.Value || this.IsInArrayContext())) {
            const r = this.DoubleRefToRange(p.GetDoubleRef());
            const nCol1 = r.aStart.Col(), nRow1 = r.aStart.Row(), nTab1 = r.aStart.Tab();
            const nCol2 = r.aEnd.Col(), nRow2 = r.aEnd.Row(), nTab2 = r.aEnd.Tab();
            const pMat = this.CreateMatrixFromDoubleRef(nCol1, nRow1, nTab1, nCol2, nRow2, nTab2);
            if (pMat) {
              if (eType === ParamClass.Value) {
                // only if single value expected
                if (nJumpCols < nCol2 - nCol1 + 1) nJumpCols = nCol2 - nCol1 + 1;
                if (nJumpRows < nRow2 - nRow1 + 1) nJumpRows = nRow2 - nRow1 + 1;
              }
              pMat.SetErrorInterpreter(null);
              this.pStack[this.sp - i] = new ScMatrixToken(pMat);
            }
          }
          break;
        }
        case svRefList: {
          const eType = ScParameterClassification.GetParameterType(this.pCur, nParams - i);
          if (eType !== ParamClass.Reference && eType !== ParamClass.ReferenceOrRefArray && eType !== ParamClass.ReferenceOrForceArray && eType !== ParamClass.ForceArray) {
            // can't convert to matrix
            this.SetError(FormulaError.NoRef);
          }
          // else: the consuming function has to decide if and how to
          // handle a reference list argument in array context.
          break;
        }
        default:
        // ConvertMatrixParameters: unknown parameter type
      }
    }
    if (nJumpCols && nJumpRows) {
      const nPC = this.aCode.GetPC();
      const nStart = nPC - 1; // restart on current code (-1)
      const nNext = nPC; // next instruction after subroutine
      const nStop = nPC + 1; // stop subroutine before reaching that
      let xNew = this.maTokenMatrixMap.get(this.pCur);
      if (!xNew) {
        const pJumpMat = new ScJumpMatrix(this.pCur.GetOpCode(), nJumpCols, nJumpRows);
        pJumpMat.SetAllJumps(1.0, nStart, nNext, nStop);
        // pop parameters and store in ScJumpMatrix, push in JumpMatrix()
        const aParams: FormulaToken[] = new Array(nParams);
        for (let i = 1; i <= nParams && this.sp > 0; ++i) {
          const p = this.pStack[--this.sp]!;
          // store in reverse order such that a push may simply iterate
          aParams[nParams - i] = p;
        }
        pJumpMat.SetJumpParameters(aParams);
        xNew = new ScJumpMatrixToken(pJumpMat);
        this.maTokenMatrixMap.set(this.pCur, xNew);
      }
      this.PushTempTokenWithoutError(xNew);
      // set continuation point of path for main code line
      this.aCode.Jump(nNext, nNext);
      return true;
    }
    return false;
  }

  PopMatrix(): ScMatrix | null {
    if (this.sp) {
      --this.sp;
      const p = this.pStack[this.sp]!;
      switch (p.GetType()) {
        case svError:
          this.nGlobalError = p.GetError();
          break;
        case svMatrix: {
          const pMat = p.GetMatrix() as ScMatrix | null;
          if (pMat) pMat.SetErrorInterpreter(this);
          else this.SetError(FormulaError.UnknownVariable);
          return pMat;
        }
        default:
          this.SetError(FormulaError.IllegalParameter);
      }
    } else this.SetError(FormulaError.UnknownStackVariable);
    return null;
  }

  CreateFormulaDoubleToken(fVal: number, nFmt: SvNumFormatType | 0 = 0): FormulaToken {
    return nFmt ? new FormulaTypedDoubleToken(fVal, nFmt) : new FormulaDoubleToken(fVal);
  }

  CreateDoubleOrTypedToken(fVal: number): FormulaToken {
    // NumberFormat::NUMBER is the default untyped double.
    if (this.nFuncFmtType !== SvNumFormatType.NUMBER) return this.CreateFormulaDoubleToken(fVal, this.nFuncFmtType);
    return this.CreateFormulaDoubleToken(fVal);
  }

  PushDouble(nVal: number): void {
    nVal = this.TreatDoubleError(nVal);
    if (!this.IfErrorPushError()) this.PushTempTokenWithoutError(this.CreateDoubleOrTypedToken(nVal));
  }

  PushInt(nVal: number): void {
    if (!this.IfErrorPushError()) this.PushTempTokenWithoutError(this.CreateDoubleOrTypedToken(nVal));
  }

  PushString(rString: string): void {
    if (!this.IfErrorPushError()) this.PushTempTokenWithoutError(new FormulaStringToken(rString));
  }

  PushSingleRef(nCol: SCCOL | ScAddress, nRow?: SCROW, nTab?: SCTAB): void {
    if (!this.IfErrorPushError()) {
      const aRef = new ScSingleRefData();
      aRef.InitAddress(nCol instanceof ScAddress ? nCol : new ScAddress(nCol, nRow!, nTab!));
      this.PushTempTokenWithoutError(new ScSingleRefToken(this.mrDoc.GetSheetLimits(), aRef));
    }
  }

  PushDoubleRef(nCol1: SCCOL | ScRange, nRow1?: SCROW, nTab1?: SCTAB, nCol2?: SCCOL, nRow2?: SCROW, nTab2?: SCTAB): void {
    if (!this.IfErrorPushError()) {
      const aRef = new ScComplexRefData();
      aRef.InitRange(nCol1 instanceof ScRange ? nCol1 : new ScRange(nCol1, nRow1!, nTab1!, nCol2!, nRow2!, nTab2!));
      this.PushTempTokenWithoutError(new ScDoubleRefToken(this.mrDoc.GetSheetLimits(), aRef));
    }
  }

  PushMatrix(pMat: ScMatrix): void {
    pMat.SetErrorInterpreter(null);
    // No   if (!IfErrorPushError())   because ScMatrix stores errors itself,
    // but with notifying ScInterpreter via nGlobalError, substituting it would
    // mean to inherit the error on all array elements in all following
    // operations.
    this.nGlobalError = FormulaError.NONE;
    this.PushTempTokenWithoutError(new ScMatrixToken(pMat));
  }

  PushError(nError: FormulaError): void {
    this.SetError(nError); // only sets error if not already set
    this.PushTempTokenWithoutError(new FormulaErrorToken(this.nGlobalError));
  }

  PushParameterExpected(): void { this.PushError(FormulaError.ParameterExpected); }
  PushIllegalParameter(): void { this.PushError(FormulaError.IllegalParameter); }
  PushIllegalArgument(): void { this.PushError(FormulaError.IllegalArgument); }
  PushNA(): void { this.PushError(FormulaError.NotAvailable); }
  PushNoValue(): void { this.PushError(FormulaError.NoValue); }

  IsMissing(): boolean { return this.sp > 0 && this.pStack[this.sp - 1]!.GetType() === svMissing; }

  GetRawStackType(): StackVar {
    if (this.sp) return this.pStack[this.sp - 1]!.GetType();
    this.SetError(FormulaError.UnknownStackVariable);
    return svUnknown;
  }

  GetStackType(nParam?: number): StackVar {
    if (nParam !== undefined) {
      let eRes: StackVar;
      if (this.sp > nParam - 1) {
        eRes = this.pStack[this.sp - nParam]!.GetType();
        if (eRes === svMissing || eRes === svEmptyCell) eRes = svDouble; // default!
      } else eRes = svUnknown;
      return eRes;
    }
    const eRes = this.GetRawStackType();
    switch (eRes) {
      case svMissing:
      case svEmptyCell:
        return svDouble; // default!
      default:
        return eRes;
    }
  }

  ReverseStack(nParamCount: number): void {
    const nStackParams = Math.min(this.sp, nParamCount);
    const a = this.pStack.slice(this.sp - nStackParams, this.sp).reverse();
    for (let i = 0; i < nStackParams; i++) this.pStack[this.sp - nStackParams + i] = a[i]!;
  }

  /** The parameter count of the current function (GetByte()). */
  GetByte(): number { return this.cPar; }

  MustHaveParamCount(nAct: number, nMust: number, nMax?: number): boolean {
    if (nMax !== undefined) {
      if (nMust <= nAct && nAct <= nMax) return true;
      if (nAct < nMust) this.PushParameterExpected();
      else this.PushIllegalParameter();
      return false;
    }
    if (nAct === nMust) return true;
    if (nAct < nMust) this.PushParameterExpected();
    else this.PushIllegalParameter();
    return false;
  }

  MustHaveParamCountMin(nAct: number, nMin: number): boolean {
    if (nAct >= nMin) return true;
    this.PushParameterExpected();
    return false;
  }

  /** The array (matrix) context: in an array formula or a ForceArray parameter. */
  IsInArrayContext(): boolean { return this.bMatrixFormula || this.pCur.IsInForceArray(); }

  // --- cell access --------------------------------------------------------------------------------

  ConvertStringToValue(rStr: string): number {
    // ScGlobal::ConvertStringToValue with StringConversion::LOCALE (the default)
    if (this.mnStringNoValueError === FormulaError.CellNoValue) {
      // Requested that all strings result in 0, error handled by caller.
      this.SetError(this.mnStringNoValueError);
      return 0.0;
    }
    const r = IsNumberFormat(rStr, 'en-US');
    if (!r) {
      this.SetError(this.mnStringNoValueError);
      return 0.0;
    }
    this.nCurFmtType = NFGetType(r.code, 'en-US');
    return r.value;
  }

  GetCellErrCode(rCell: ScRefCellValue): FormulaError {
    return rCell.getType() === CELLTYPE_FORMULA ? rCell.getFormula()!.GetErrCode() : FormulaError.NONE;
  }

  GetCellValue(rPos: ScAddress, rCell: ScRefCellValue): number {
    const nErr = this.nGlobalError;
    this.nGlobalError = FormulaError.NONE;
    const nVal = this.GetCellValueOrZero(rPos, rCell);
    // Propagate previous error, if any; nGlobalError==CellNoValue is not an
    // error here, preserve previous error or non-error.
    if (nErr !== FormulaError.NONE || (this.nGlobalError as FormulaError) === FormulaError.CellNoValue) this.nGlobalError = nErr;
    return nVal;
  }

  GetCellValueOrZero(rPos: ScAddress, rCell: ScRefCellValue): number {
    let fValue = 0.0;
    switch (rCell.getType()) {
      case CELLTYPE_FORMULA: {
        const pFCell = rCell.getFormula()!;
        const nErr = pFCell.GetErrCode();
        if (nErr === FormulaError.NONE) {
          if (pFCell.IsValue()) {
            fValue = pFCell.GetValue();
            this.GetNumberFormatInfo(rPos);
          } else fValue = this.ConvertStringToValue(pFCell.GetString());
        } else {
          fValue = 0.0;
          this.SetError(nErr);
        }
        break;
      }
      case CELLTYPE_VALUE: {
        fValue = rCell.getDouble();
        this.nCurFmtIndex = this.mrDoc.GetNumberFormat(rPos);
        this.nCurFmtType = NFGetType(this.nCurFmtIndex, 'en-US');
        break;
      }
      case CELLTYPE_STRING:
      case CELLTYPE_EDIT: {
        // SUM(A1:A2) differs from A1+A2. No good. But people insist on
        // it ... #i5658#
        fValue = this.ConvertStringToValue(rCell.getString());
        break;
      }
      case CELLTYPE_NONE:
        fValue = 0.0; // empty or broadcaster cell
        break;
    }
    return fValue;
  }

  /** The number format type and code of a cell, the format a formula result implies when its
      format is General (ScDocument::GetNumberFormatInfo). */
  GetNumberFormatInfo(rPos: ScAddress): void {
    const aCode = this.mrDoc.GetNumberFormat(rPos);
    this.nCurFmtIndex = aCode;
    this.nCurFmtType = NFGetType(aCode, 'en-US');
    if (this.nCurFmtType === SvNumFormatType.NUMBER && /^General$/i.test(aCode)) {
      const pF = this.mrDoc.GetFormulaCell(rPos);
      if (pF) {
        this.nCurFmtType = pF.GetFormatType();
        if (pF.maFormatCode) this.nCurFmtIndex = pF.maFormatCode;
      }
    }
  }

  GetCellString(rCell: ScRefCellValue): string {
    let nErr: FormulaError = FormulaError.NONE;
    let rStr = '';
    switch (rCell.getType()) {
      case CELLTYPE_STRING:
      case CELLTYPE_EDIT:
        rStr = rCell.getString();
        break;
      case CELLTYPE_FORMULA: {
        const pFCell = rCell.getFormula()!;
        nErr = pFCell.GetErrCode();
        if (pFCell.IsValue()) rStr = this.GetStringFromDouble(pFCell.GetValue());
        else rStr = pFCell.GetString();
        break;
      }
      case CELLTYPE_VALUE:
        rStr = this.GetStringFromDouble(rCell.getDouble());
        break;
      default:
        rStr = '';
    }
    this.SetError(nErr);
    return rStr;
  }

  GetStringFromDouble(fVal: number): string {
    // NFGetInputLineString of the standard number format: up to 15 significant digits.
    return doubleToUString(fVal, rtl_math_StringFormat.Automatic, rtl_math_DecimalPlaces_Max, '.', true);
  }

  /** The implicit intersection of a range with the formula position (DoubleRefToPosSingleRef). */
  DoubleRefToPosSingleRef(rRange: ScRange): ScAddress | null {
    // Check for a singleton first - no implicit intersection for them.
    if (rRange.aStart.equals(rRange.aEnd)) return rRange.aStart.clone();

    if (this.pJumpMatrix) {
      let bOk = rRange.aStart.Tab() === rRange.aEnd.Tab();
      if (!bOk) {
        this.SetError(FormulaError.IllegalArgument);
        return null;
      }
      const { nC, nR } = this.pJumpMatrix.GetPos();
      const rAdr = new ScAddress(rRange.aStart.Col() + nC, rRange.aStart.Row() + nR, rRange.aStart.Tab());
      bOk = rRange.aStart.Col() <= rAdr.Col() && rAdr.Col() <= rRange.aEnd.Col() && rRange.aStart.Row() <= rAdr.Row() && rAdr.Row() <= rRange.aEnd.Row();
      if (!bOk) this.SetError(FormulaError.NoValue);
      return bOk ? rAdr : null;
    }

    const r = DoubleRefToPosSingleRefScalarCase(rRange, this.aPos);
    if (!r) this.SetError(FormulaError.NoValue);
    return r;
  }

  // --- values of parameters ------------------------------------------------------------------------

  GetDoubleFromMatrix(pMat: ScMatrix | null): number {
    if (!pMat) return 0.0;
    let nC = 0, nR = 0;
    if (this.pJumpMatrix) {
      const { nC: nCols, nR: nRows } = pMat.GetDimensions();
      ({ nC, nR } = this.pJumpMatrix.GetPos());
      // Use vector replication for single row/column arrays.
      if ((nC < nCols || nCols === 1) && (nR < nRows || nRows === 1)) {
        if (nCols === 1) nC = 0;
        if (nRows === 1) nR = 0;
      } else {
        this.SetError(FormulaError.NoValue);
        return 0.0;
      }
    }
    let fVal: number;
    if (pMat.IsValue(nC, nR)) fVal = pMat.GetDouble(nC, nR);
    else if (pMat.IsStringOrEmpty(nC, nR) && !pMat.IsEmpty(nC, nR)) fVal = this.ConvertStringToValue(pMat.GetString(nC, nR));
    else fVal = 0.0;
    const nErr = GetDoubleErrorValue(fVal);
    if (nErr !== FormulaError.NONE) {
      // Do not propagate the coded double error, but set nGlobalError in
      // case the matrix did not have an error interpreter set.
      this.SetError(nErr);
      fVal = 0.0;
    }
    return fVal;
  }

  /** The element of the matrix at the jump matrix position (vector replication for single
      row/column arrays), or 0,0 without a jump matrix; null if out of range. */
  private JumpMatrixElementPos(pMat: ScMatrix): { nC: number; nR: number } | null {
    if (!this.pJumpMatrix) return { nC: 0, nR: 0 };
    const { nC: nCols, nR: nRows } = pMat.GetDimensions();
    const { nC, nR } = this.pJumpMatrix.GetPos();
    // Use vector replication for single row/column arrays.
    if ((nC < nCols || nCols === 1) && (nR < nRows || nRows === 1)) return { nC: nCols === 1 ? 0 : nC, nR: nRows === 1 ? 0 : nR };
    return null;
  }

  GetDouble(): number {
    let nVal: number;
    switch (this.GetRawStackType()) {
      case svDouble:
        nVal = this.PopDouble();
        break;
      case svString:
        nVal = this.ConvertStringToValue(this.PopString());
        break;
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        nVal = this.GetCellValue(aAdr, aCell);
        break;
      }
      case svDoubleRef: {
        // generate position dependent SingleRef
        const aRange = this.PopDoubleRef();
        let aAdr: ScAddress | null;
        if (this.nGlobalError === FormulaError.NONE && (aAdr = this.DoubleRefToPosSingleRef(aRange))) {
          const aCell = this.mrDoc.GetRefCellValue(aAdr);
          nVal = this.GetCellValue(aAdr, aCell);
        } else nVal = 0.0;
        break;
      }
      case svMatrix: {
        const pMat = this.PopMatrix();
        nVal = this.GetDoubleFromMatrix(pMat);
        break;
      }
      case svError:
        this.PopError();
        nVal = 0.0;
        break;
      case svEmptyCell:
      case svMissing:
        this.Pop();
        nVal = 0.0;
        break;
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
        nVal = 0.0;
    }
    if (this.nFuncFmtType === this.nCurFmtType) this.nFuncFmtIndex = this.nCurFmtIndex;
    return nVal;
  }

  GetDoubleWithDefault(nDefault: number): number {
    if (!this.IsMissing()) return this.GetDouble();
    this.Pop();
    return nDefault;
  }

  GetBool(): boolean { return this.GetDouble() !== 0.0; }
  GetBoolWithDefault(bDefault: boolean): boolean { return this.GetDoubleWithDefault(bDefault ? 1.0 : 0.0) !== 0.0; }

  /** A double as an integer of the given range, truncated towards zero (double_to). */
  double_to_int(fVal: number, nMin = -2147483648, nMax = 2147483647): number {
    if (!Number.isFinite(fVal)) {
      this.SetError(GetDoubleErrorValue(fVal));
      return nMax;
    }
    if (fVal > 0.0) {
      fVal = approxFloor(fVal);
      if (fVal > nMax) {
        this.SetError(FormulaError.IllegalArgument);
        return nMax;
      }
    } else if (fVal < 0.0) {
      fVal = approxCeil(fVal);
      if (fVal < nMin) {
        this.SetError(FormulaError.IllegalArgument);
        return nMax;
      }
    }
    return fVal === 0 ? 0 : fVal;
  }

  GetInt32(): number { return this.double_to_int(this.GetDouble()); }
  GetInt32WithDefault(nDefault: number): number { return this.double_to_int(this.GetDoubleWithDefault(nDefault)); }
  GetInt16(): number { return this.double_to_int(this.GetDouble(), -32768, 32767); }
  GetInt16WithDefault(nDefault: number): number { return this.double_to_int(this.GetDoubleWithDefault(nDefault), -32768, 32767); }
  GetUInt32(): number { return this.double_to_int(this.GetDouble(), 0, 4294967295); }
  GetFloor32(): number {
    let fVal = this.GetDouble();
    if (!Number.isFinite(fVal)) {
      this.SetError(GetDoubleErrorValue(fVal));
      return 2147483647;
    }
    fVal = approxFloor(fVal);
    if (fVal < -2147483648 || 2147483647 < fVal) {
      this.SetError(FormulaError.IllegalArgument);
      return 2147483647;
    }
    return fVal;
  }

  /** A double or a string of the parameter: returns {bDouble, fVal, aStr}. */
  GetDoubleOrString(): { bDouble: boolean; fVal: number; aStr: string } {
    let bDouble = true;
    let rDouble = 0.0;
    let rString = '';
    switch (this.GetRawStackType()) {
      case svDouble:
        rDouble = this.PopDouble();
        break;
      case svString:
        rString = this.PopString();
        bDouble = false;
        break;
      case svDoubleRef:
      case svSingleRef: {
        const aAdr = this.PopDoubleRefOrSingleRef();
        if (!aAdr) return { bDouble: true, fVal: 0.0, aStr: '' }; // caller needs to check nGlobalError
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasNumeric()) rDouble = this.GetCellValue(aAdr, aCell);
        else {
          rString = this.GetCellString(aCell);
          bDouble = false;
        }
        break;
      }
      case svMatrix: {
        const r = this.GetDoubleOrStringFromMatrix();
        rDouble = r.fVal;
        rString = r.aStr;
        bDouble = ScMatrix.IsValueType(r.nType);
        break;
      }
      case svError:
        this.PopError();
        rDouble = 0.0;
        break;
      case svEmptyCell:
      case svMissing:
        this.Pop();
        rDouble = 0.0;
        break;
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalParameter);
        rDouble = 0.0;
    }
    if (this.nFuncFmtType === this.nCurFmtType) this.nFuncFmtIndex = this.nCurFmtIndex;
    return { bDouble, fVal: rDouble, aStr: rString };
  }

  GetString(): string {
    switch (this.GetRawStackType()) {
      case svError:
        this.PopError();
        return '';
      case svMissing:
      case svEmptyCell:
        this.Pop();
        return '';
      case svDouble:
        return this.GetStringFromDouble(this.PopDouble());
      case svString:
      case svStringName:
        return this.PopString();
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        if (this.nGlobalError === FormulaError.NONE) return this.GetCellString(this.mrDoc.GetRefCellValue(aAdr));
        return '';
      }
      case svDoubleRef: {
        // generate position dependent SingleRef
        const aRange = this.PopDoubleRef();
        let aAdr: ScAddress | null;
        if (this.nGlobalError === FormulaError.NONE && (aAdr = this.DoubleRefToPosSingleRef(aRange))) return this.GetCellString(this.mrDoc.GetRefCellValue(aAdr));
        return '';
      }
      case svMatrix: {
        const pMat = this.PopMatrix();
        return this.GetStringFromMatrix(pMat);
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalArgument);
    }
    return '';
  }

  GetStringFromMatrix(pMat: ScMatrix | null): string {
    if (!pMat) return '';
    const p = this.JumpMatrixElementPos(pMat);
    if (!p) {
      this.SetError(FormulaError.NoValue);
      return '';
    }
    const { nC, nR } = p;
    if (pMat.IsValue(nC, nR)) {
      const nErr = pMat.GetError(nC, nR);
      if (nErr !== FormulaError.NONE) { this.SetError(nErr); return ''; }
      if (pMat.IsBoolean(nC, nR)) return pMat.GetDouble(nC, nR) ? 'TRUE' : 'FALSE';
      return this.GetStringFromDouble(pMat.GetDouble(nC, nR));
    }
    return pMat.GetString(nC, nR);
  }

  GetDoubleOrStringFromMatrix(): { nType: number; fVal: number; aStr: string } {
    let fVal = 0.0, aStr = '', nType: number = 0x06; // Empty
    const eType = this.GetStackType();
    if (eType !== svMatrix) {
      this.PopError();
      this.SetError(FormulaError.IllegalParameter);
      return { nType, fVal, aStr };
    }
    const pMat = this.GetMatrix();
    const p = pMat ? this.JumpMatrixElementPos(pMat) : null;
    if (pMat && !p) this.SetError(FormulaError.NoValue);
    else if (pMat && p) {
      const v = pMat.Get(p.nC, p.nR);
      nType = v.nType;
      if (ScMatrix.IsValueType(nType)) {
        fVal = v.fVal;
        const nError = v.GetError();
        if (nError !== FormulaError.NONE) this.SetError(nError);
      } else aStr = v.GetString();
    }
    return { nType, fVal, aStr };
  }

  // --- matrices -----------------------------------------------------------------------------------

  /** A new matrix (GetNewMat): empty elements if bEmpty, else zeros. */
  GetNewMat(nC: number, nR: number, bEmpty = false): ScMatrix {
    const pMat = bEmpty ? new ScMatrix(nC, nR) : new ScMatrix(nC, nR, 0.0);
    pMat.SetErrorInterpreter(this);
    // A temporary matrix is mutable and ScMatrix::CloneIfConst() returns the
    // very matrix.
    return pMat;
  }

  /** The cells of a range as a matrix (CreateMatrixFromDoubleRef): values, strings, errors and
      empty cells. */
  CreateMatrixFromDoubleRef(nCol1: SCCOL, nRow1: SCROW, nTab1: SCTAB, nCol2: SCCOL, nRow2: SCROW, nTab2: SCTAB): ScMatrix | null {
    if (nTab1 !== nTab2 || this.nGlobalError !== FormulaError.NONE) {
      // Not a 2D matrix.
      this.SetError(FormulaError.IllegalParameter);
      return null;
    }
    const nMatCols = nCol2 - nCol1 + 1;
    const nMatRows = nRow2 - nRow1 + 1;
    if (nMatCols * nMatRows > 64 * 1024 * 1024) {
      this.SetError(FormulaError.MatrixSize);
      return null;
    }
    const pMat = this.GetNewMat(nMatCols, nMatRows, true);
    const pTab = this.mrDoc.FetchTable(nTab1);
    if (!pTab) return pMat;
    for (let nCol = nCol1; nCol <= Math.min(nCol2, pTab.GetAllocatedColumnsCount() - 1); nCol++) {
      const pCol = pTab.FetchColumn(nCol);
      if (!pCol) continue;
      pCol.ForEachCell(nRow1, nRow2, (nRow, p) => {
        const c = nCol - nCol1, r = nRow - nRow1;
        if (typeof p === 'number') pMat.PutDouble(p, c, r);
        else if (typeof p === 'string') pMat.PutString(p, c, r);
        else {
          const aCell = new ScRefCellValue(p);
          if (aCell.getType() === CELLTYPE_EDIT) pMat.PutString(aCell.getString(), c, r);
          else {
            const pF = aCell.getFormula()!;
            const nErr = pF.GetErrCode();
            if (nErr !== FormulaError.NONE) pMat.PutError(nErr, c, r);
            else if (pF.IsEmptyDisplayedAsString() || pF.IsEmpty()) pMat.PutEmpty(c, r);
            else if (pF.IsValue()) pMat.PutDouble(pF.GetValue(), c, r);
            else pMat.PutString(pF.GetString(), c, r);
          }
        }
      });
    }
    return pMat;
  }

  /** The parameter as a matrix (GetMatrix): a range, a reference, a value or a matrix. */
  GetMatrix(): ScMatrix | null {
    let pMat: ScMatrix | null = null;
    switch (this.GetRawStackType()) {
      case svSingleRef: {
        const aAdr = this.PopSingleRef();
        pMat = this.GetNewMat(1, 1);
        const aCell = this.mrDoc.GetRefCellValue(aAdr);
        if (aCell.hasEmptyValue()) pMat.PutEmpty(0, 0);
        else if (aCell.hasNumeric()) {
          const fVal = this.GetCellValue(aAdr, aCell);
          if (this.nGlobalError !== FormulaError.NONE) {
            pMat.PutError(this.nGlobalError, 0, 0);
            this.nGlobalError = FormulaError.NONE;
          } else pMat.PutDouble(fVal, 0, 0);
        } else {
          const aStr = this.GetCellString(aCell);
          if (this.nGlobalError !== FormulaError.NONE) {
            pMat.PutError(this.nGlobalError, 0, 0);
            this.nGlobalError = FormulaError.NONE;
          } else pMat.PutString(aStr, 0, 0);
        }
        break;
      }
      case svDoubleRef: {
        const r = this.PopDoubleRef();
        pMat = this.CreateMatrixFromDoubleRef(r.aStart.Col(), r.aStart.Row(), r.aStart.Tab(), r.aEnd.Col(), r.aEnd.Row(), r.aEnd.Tab());
        break;
      }
      case svMatrix:
        pMat = this.PopMatrix();
        break;
      case svError:
      case svMissing:
      case svDouble: {
        const fVal = this.GetDouble();
        pMat = this.GetNewMat(1, 1);
        if (this.nGlobalError !== FormulaError.NONE) {
          pMat.PutError(this.nGlobalError, 0, 0);
          this.nGlobalError = FormulaError.NONE;
        } else pMat.PutDouble(fVal, 0, 0);
        break;
      }
      case svString: {
        const aStr = this.GetString();
        pMat = this.GetNewMat(1, 1);
        if (this.nGlobalError !== FormulaError.NONE) {
          pMat.PutError(this.nGlobalError, 0, 0);
          this.nGlobalError = FormulaError.NONE;
        } else pMat.PutString(aStr, 0, 0);
        break;
      }
      case svRefList: {
        // a single reference list entry as matrix
        const p = this.pStack[this.sp - 1]!.GetRefList() as ScRefList;
        if (p.length === 1) {
          --this.sp;
          const r = this.DoubleRefToRange(p[0]!);
          pMat = this.CreateMatrixFromDoubleRef(r.aStart.Col(), r.aStart.Row(), r.aStart.Tab(), r.aEnd.Col(), r.aEnd.Row(), r.aEnd.Tab());
        } else {
          this.PopError();
          this.SetError(FormulaError.IllegalParameter);
        }
        break;
      }
      default:
        this.PopError();
        this.SetError(FormulaError.IllegalArgument);
        break;
    }
    return pMat;
  }

  /** The current format type into the function's format (CurFmtToFuncFmt). */
  CurFmtToFuncFmt(): void {
    this.nFuncFmtType = this.nCurFmtType;
    this.nFuncFmtIndex = this.nCurFmtIndex;
  }

  // --- the main loop ------------------------------------------------------------------------------

  Interpret(): StackVar {
    let nRetTypeExpr: SvNumFormatType | null = null;
    let nRetIndexExpr = '';
    let nErrorFunction = 0;
    let nErrorFunctionCount = 0;
    let nStackBase: number;

    this.nGlobalError = FormulaError.NONE;
    nStackBase = this.sp = this.maxsp = 0;
    this.nRetFmtType = SvNumFormatType.NUMBER;
    this.nFuncFmtType = SvNumFormatType.NUMBER;
    this.nFuncFmtIndex = this.nCurFmtIndex = this.nRetFmtIndex = '';
    this.xResult = null;
    this.pJumpMatrix = null;
    this.mnSubTotalFlags = SubtotalFlags.NONE;
    const aErrorFunctionStack: number[] = [];

    let eOp: OpCode = OC.ocNone;
    this.aCode.Reset();
    for (;;) {
      const pCur = this.aCode.Next();
      if (!pCur || (this.nGlobalError !== FormulaError.NONE && nErrorFunction > nErrorFunctionCount)) break;
      this.pCur = pCur;
      eOp = pCur.GetOpCode();
      this.cPar = pCur.GetByte();
      if (eOp === OC.ocPush) {
        // RPN code push without error
        this.PushWithoutError(pCur);
        this.nCurFmtType = SvNumFormatType.NUMBER;
      } else {
        const bIsOpCodeJumpCommand = IsOpCodeJumpCommand(eOp);
        let xMapped: FormulaToken | undefined;
        if (!bIsOpCodeJumpCommand && (xMapped = this.maTokenMatrixMap.get(pCur)) && xMapped.GetType() !== svJumpMatrix) {
          // Path already calculated, reuse result.
          const nParamCount = pCur.GetParamCount();
          if (this.sp >= nParamCount) nStackBase = this.sp - nParamCount;
          else nStackBase = this.sp;
          this.sp = nStackBase;
          this.PushTokenRef(xMapped);
        } else {
        // previous expression determines the current number format
        this.nCurFmtType = nRetTypeExpr ?? SvNumFormatType.NUMBER;
        this.nCurFmtIndex = nRetIndexExpr;
        // default function's format, others are set if needed
        this.nFuncFmtType = SvNumFormatType.NUMBER;
        this.nFuncFmtIndex = '';

        if (bIsOpCodeJumpCommand) nStackBase = this.sp; // don't mess around with the jumps
        else if (this.MatrixParameterConversion()) {
          // Convert parameters to matrix if in array/matrix formula and
          // parameters of function indicate doing so. Create JumpMatrix
          // if necessary.
          eOp = OC.ocNone; // JumpMatrix created
          nStackBase = this.sp;
        } else {
          const nParamCount = pCur.GetParamCount();
          if (this.sp >= nParamCount) nStackBase = this.sp - nParamCount;
          else nStackBase = this.sp;
        }

        if (eOp !== OC.ocNone) {
        const f = ScInterpreter.maOpCodeFuncs.get(eOp);
        if (f) f.call(this);
        else if (eOp === OC.ocBad || eOp === OC.ocNoName) {
          this.nGlobalError = FormulaError.NONE;
          this.PushError(FormulaError.NoName);
        } else this.PushError(FormulaError.UnknownOpCode);
        }

        // outer function determines format of an expression
        nRetTypeExpr = this.nFuncFmtType as SvNumFormatType;
        // Inherit the format index for currency, date or time formats.
        switch (nRetTypeExpr) {
          case SvNumFormatType.CURRENCY:
          case SvNumFormatType.DATE:
          case SvNumFormatType.TIME:
          case SvNumFormatType.DATETIME:
            nRetIndexExpr = this.nFuncFmtIndex;
            break;
          default:
            nRetIndexExpr = '';
        }
        }
      }

      // Need a clean stack environment for the JumpMatrix to work.
      if (this.nGlobalError !== FormulaError.NONE && eOp !== OC.ocPush && this.sp > nStackBase + 1) {
        // Not all functions pop all parameters in case an error is
        // generated. Clean up stack. Assumes that every function pushes a
        // result, may be arbitrary in case of error.
        const xLocalResult = this.pStack[this.sp - 1]!;
        while (this.sp > nStackBase) this.Pop();
        this.PushTokenRef(xLocalResult);
      }

      let bGotResult: boolean;
      do {
        bGotResult = false;
        let nLevel = 0;
        if (this.GetStackType(++nLevel) === svJumpMatrix) {
          // nothing
        } else if (this.GetStackType(++nLevel) === svJumpMatrix) {
          // nothing
        } else nLevel = 0;
        if (nLevel === 1 || (nLevel === 2 && this.aCode.IsEndOfPath())) {
          if (nLevel === 1) aErrorFunctionStack.push(nErrorFunction);
          bGotResult = this.JumpMatrix(nLevel);
          if (aErrorFunctionStack.length) {
            nErrorFunction = aErrorFunctionStack[aErrorFunctionStack.length - 1]!;
            if (bGotResult) aErrorFunctionStack.pop();
          }
        } else this.pJumpMatrix = null;
      } while (bGotResult);

      if (IsErrFunc(eOp)) ++nErrorFunction;

      if (this.nGlobalError !== FormulaError.NONE) {
        if (!nErrorFunctionCount) {
          // count of errorcode functions in formula
          for (const t of this.pArr.GetCode()) if (IsErrFunc(t.GetOpCode())) ++nErrorFunctionCount;
        }
        if (nErrorFunction >= nErrorFunctionCount) ++nErrorFunction; // that's it, error => terminate
        else if (nErrorFunctionCount && this.sp && this.GetStackType() === svError) {
          // Clear global error if we have an individual error result, so
          // an error evaluating function can receive multiple arguments
          // and not all evaluated arguments inheriting the error.
          this.nGlobalError = FormulaError.NONE;
        }
      }
    }

    // End: obtain result

    let bForcedResultType: boolean;
    switch (eOp) {
      case OC.ocGetDateValue:
      case OC.ocGetTimeValue:
        // Force final result of DATEVALUE and TIMEVALUE to number type,
        // which so far was date or time for calculations.
        nRetTypeExpr = this.nFuncFmtType = SvNumFormatType.NUMBER;
        nRetIndexExpr = this.nFuncFmtIndex = '';
        bForcedResultType = true;
        break;
      default:
        bForcedResultType = false;
    }

    if (this.sp === 1) {
      let pCur = this.pStack[this.sp - 1]!;
      if (pCur.GetOpCode() === OC.ocPush) {
        // An svRefList can be resolved if it a) contains just one
        // reference.
        if (pCur.GetType() === svRefList) {
          const pv = pCur.GetRefList() as ScRefList;
          if (pv.length === 1) {
            --this.sp;
            this.PushTempTokenWithoutError(new ScDoubleRefToken(this.mrDoc.GetSheetLimits(), pv[0]!));
            pCur = this.pStack[this.sp - 1]!;
          }
        }
        switch (pCur.GetType()) {
          case svEmptyCell:
            // nothing
            break;
          case svError:
            this.nGlobalError = pCur.GetError();
            break;
          case svDouble: {
            // If typed, pop token to obtain type information and
            // push a plain untyped double so the result token to
            // be transferred to the formula cell result does not
            // unnecessarily duplicate the information.
            if (pCur.GetDoubleType() !== 0) {
              const fVal = this.PopDouble();
              if (!bForcedResultType) {
                if (this.nCurFmtType !== this.nFuncFmtType) nRetIndexExpr = ''; // carry format index only for matching type
                nRetTypeExpr = this.nFuncFmtType = this.nCurFmtType;
              }
              this.PushTempToken(this.CreateFormulaDoubleToken(fVal));
            }
            break;
          }
          case svString:
            nRetTypeExpr = SvNumFormatType.TEXT;
            nRetIndexExpr = '';
            break;
          case svSingleRef: {
            const aAdr = this.PopSingleRef();
            if (this.nGlobalError === FormulaError.NONE) {
              const r = this.PushCellResultToken(false, aAdr, true);
              nRetTypeExpr = r.nRetType;
              nRetIndexExpr = r.nRetIndex;
            }
            break;
          }
          case svRefList:
            this.PopError(); // maybe #REF! takes precedence over #VALUE!
            this.PushError(FormulaError.NoValue);
            break;
          case svDoubleRef: {
            if (this.bMatrixFormula) {
              // create matrix for {=A1:A5}
              this.PopDoubleRefPushMatrix();
              const xMat = this.PopMatrix();
              if (xMat) this.PushMatrix(xMat);
            } else {
              const aRange = this.PopDoubleRef();
              let aAdr: ScAddress | null;
              if (this.nGlobalError === FormulaError.NONE && (aAdr = this.DoubleRefToPosSingleRef(aRange))) {
                const r = this.PushCellResultToken(false, aAdr, true);
                nRetTypeExpr = r.nRetType;
                nRetIndexExpr = r.nRetIndex;
              }
            }
            break;
          }
          case svMatrix:
            // A matrix result.
            break;
          default:
            this.SetError(FormulaError.UnknownStackVariable);
        }
      } else this.SetError(FormulaError.UnknownStackVariable);
    } else if (this.sp > 1) this.SetError(FormulaError.OperatorExpected);
    else this.SetError(FormulaError.NoCode);

    if (bForcedResultType || nRetTypeExpr !== null) {
      this.nRetFmtType = nRetTypeExpr ?? SvNumFormatType.NUMBER;
      this.nRetFmtIndex = nRetIndexExpr;
    } else {
      this.nRetFmtType = this.nFuncFmtType;
      this.nRetFmtIndex = this.nFuncFmtIndex;
    }

    if (this.nGlobalError !== FormulaError.NONE && (!this.sp || this.GetStackType() !== svError)) this.PushError(this.nGlobalError);

    // THE final result.
    this.xResult = this.PopToken();
    if (!this.xResult) this.xResult = new FormulaErrorToken(FormulaError.UnknownStackVariable);

    const eType = this.xResult.GetType();
    if (eType === svMatrix) {
      // Results are immutable in case they would be reused as input for new
      // interpreters.
      (this.xResult.GetMatrix() as ScMatrix | null)?.SetImmutable();
    }
    return eType;
  }

  GetResultToken(): FormulaToken | null { return this.xResult; }
  GetResultType(): StackVar { return this.xResult ? this.xResult.GetType() : svUnknown; }
  GetStringResult(): string { return this.xResult ? this.xResult.GetString() : ''; }
  GetNumResult(): number { return this.xResult ? this.xResult.GetDouble() : 0; }
  GetRetFormatType(): SvNumFormatType { return this.nRetFmtType; }
  GetRetFormatIndex(): string { return this.nRetFmtIndex; }

  // --- add-in functions (ScExternal) ---------------------------------------------------------------

  /** Call an add-in function (the UNO add-in branch of ScExternal; the legacy binary add-ins
      are not supported). */
  ScExternal(): void {
    let nParamCount = this.GetByte();
    const aFuncName = this.pCur.GetExternal().toUpperCase(); // programmatic name
    let aUnoName: string;
    const rColl = GetAddInCollection();
    if ((aUnoName = rColl.FindFunction(aFuncName, false))) {
      //  bLocalFirst=false in FindFunction, cFunc should be the stored
      //  internal name

      const aCall = new ScUnoAddInCall(rColl, aUnoName, nParamCount);

      if (!aCall.ValidParamCount()) this.SetError(FormulaError.IllegalParameter);

      if (aCall.NeedsCaller() && this.GetError() === FormulaError.NONE) {
        // the document model's options (ScDocOptionsObj)
        const rOpt = this.mrDoc.GetDocOptions();
        aCall.SetCaller({
          getPropertyValue: (aName: string): unknown => {
            if (aName === 'NullDate') {
              const { nDay, nMonth, nYear } = rOpt.GetDate();
              return { Day: nDay, Month: nMonth, Year: nYear };
            }
            if (aName === 'IsIgnoreCase') return rOpt.IsIgnoreCase();
            return undefined;
          },
        });
      }

      let nPar = nParamCount;
      while (nPar > 0 && this.GetError() === FormulaError.NONE) {
        --nPar; // 0 .. (nParamCount-1)

        let aParam: UnoAny = undefined;
        if (this.IsMissing()) {
          // Add-In has to explicitly handle an omitted empty missing
          // argument, do not default to anything like GetDouble() would
          // do (e.g. 0).
          this.Pop();
          aCall.SetParam(nPar, aParam);
          continue; // while
        }

        const nStackType = this.GetStackType();
        const eType = aCall.GetArgType(nPar);
        /** A sequence parameter from a range, a matrix or a single value. */
        const fillArray = (fill: (src: ScDocument | ScMatrix | null, rRange?: ScRange) => { aRowSeq: unknown[][]; bOk: boolean } | null, single: () => UnoAny): void => {
          switch (nStackType) {
            case svDouble:
            case svString:
            case svSingleRef: {
              const v = single();
              if (this.nGlobalError === FormulaError.NONE) aParam = [[v]] as UnoAny;
              break;
            }
            case svDoubleRef: {
              const aRange = this.PopDoubleRef();
              const r = fill(this.mrDoc, aRange);
              if (!r || !r.bOk) this.SetError(FormulaError.IllegalParameter);
              else aParam = r.aRowSeq as UnoAny;
              break;
            }
            case svMatrix: {
              const r = fill(this.PopMatrix());
              if (!r || !r.bOk) this.SetError(FormulaError.IllegalParameter);
              else aParam = r.aRowSeq as UnoAny;
              break;
            }
            default:
              this.PopError();
              this.SetError(FormulaError.IllegalParameter);
          }
        };
        /** A cell's value or string (ScRefCellValue in a mixed or any argument). */
        const cellAny = (): UnoAny => {
          const aAdr = this.PopDoubleRefOrSingleRef();
          if (!aAdr) return undefined;
          const aCell = this.mrDoc.GetRefCellValue(aAdr);
          if (aCell.hasString()) return this.GetCellString(aCell);
          return this.GetCellValue(aAdr, aCell);
        };
        switch (eType) {
          case ScAddInArgumentType.SC_ADDINARG_INTEGER: {
            const nVal = this.GetInt32();
            if (this.nGlobalError === FormulaError.NONE) aParam = nVal;
            break;
          }

          case ScAddInArgumentType.SC_ADDINARG_DOUBLE:
            aParam = this.GetDouble();
            break;

          case ScAddInArgumentType.SC_ADDINARG_STRING:
            aParam = this.GetString();
            break;

          case ScAddInArgumentType.SC_ADDINARG_INTEGER_ARRAY:
            fillArray((src, rRange) => ScRangeToSequence.FillLongArray(src, rRange), () => this.GetInt32());
            break;

          case ScAddInArgumentType.SC_ADDINARG_DOUBLE_ARRAY:
            fillArray((src, rRange) => ScRangeToSequence.FillDoubleArray(src, rRange), () => this.GetDouble());
            break;

          case ScAddInArgumentType.SC_ADDINARG_STRING_ARRAY:
            fillArray((src, rRange) => ScRangeToSequence.FillStringArray(src, rRange, (fVal) => this.GetStringFromDouble(fVal)), () => this.GetString());
            break;

          case ScAddInArgumentType.SC_ADDINARG_MIXED_ARRAY:
            fillArray((src, rRange) => ScRangeToSequence.FillMixedArray(src, rRange), () => {
              if (nStackType === svDouble) return this.GetDouble();
              else if (nStackType === svString) return this.GetString();
              return cellAny();
            });
            break;

          case ScAddInArgumentType.SC_ADDINARG_VALUE_OR_ARRAY:
            switch (nStackType) {
              case svDouble:
                aParam = this.GetDouble();
                break;
              case svString:
                aParam = this.GetString();
                break;
              case svSingleRef:
                aParam = cellAny();
                break;
              case svDoubleRef: {
                const aRange = this.PopDoubleRef();
                const r = ScRangeToSequence.FillMixedArray(this.mrDoc, aRange);
                if (!r || !r.bOk) this.SetError(FormulaError.IllegalParameter);
                else aParam = r.aRowSeq as UnoAny;
                break;
              }
              case svMatrix: {
                const r = ScRangeToSequence.FillMixedArray(this.PopMatrix());
                if (!r || !r.bOk) this.SetError(FormulaError.IllegalParameter);
                else aParam = r.aRowSeq as UnoAny;
                break;
              }
              default:
                this.PopError();
                this.SetError(FormulaError.IllegalParameter);
            }
            break;

          case ScAddInArgumentType.SC_ADDINARG_CELLRANGE:
          // XCellRange arguments are not supported
          // fall through
          default:
            this.PopError();
            this.SetError(FormulaError.IllegalParameter);
        }
        aCall.SetParam(nPar, aParam);
      }

      while (nPar-- > 0) {
        this.Pop(); // in case of error, remove remaining args
      }
      if (this.GetError() === FormulaError.NONE) {
        aCall.ExecuteCall();

        if (aCall.GetErrCode() !== FormulaError.NONE) this.PushError(aCall.GetErrCode());
        else if (aCall.HasMatrix()) this.PushMatrix(aCall.GetMatrix()!);
        else if (aCall.HasString()) this.PushString(aCall.GetString());
        else this.PushDouble(aCall.GetValue());
      } else {
        // error...
        this.PushError(this.GetError());
      }
    } else {
      while (nParamCount-- > 0) this.PopError();
      this.PushError(FormulaError.NoAddin);
    }
  }

  // --- missing parameters (ScMissing) --------------------------------------------------------------

  ScMissing(): void {
    // ocMissing is always pushed as a parameter.
    this.PushTempToken(new FormulaMissingToken());
  }
}

ScInterpreter.Register(OC.ocExternal, ScInterpreter.prototype.ScExternal);

/** Functions that evaluate errors themselves (IsErrFunc in interpr4.cxx). */
export function IsErrFunc(eOp: OpCode): boolean {
  switch (eOp) {
    case OC.ocCount:
    case OC.ocCount2:
    case OC.ocErrorType:
    case OC.ocIsEmpty:
    case OC.ocIsErr:
    case OC.ocIsError:
    case OC.ocIsFormula:
    case OC.ocIsLogical:
    case OC.ocIsNA:
    case OC.ocIsNonString:
    case OC.ocIsRef:
    case OC.ocIsString:
    case OC.ocIsValue:
    case OC.ocN:
    case OC.ocType:
    case OC.ocIfError:
    case OC.ocIfNA:
    case OC.ocErrorType_ODF:
    case OC.ocAggregate: // may ignore errors depending on option
    case OC.ocIfs_MS:
    case OC.ocSwitch_MS:
    case OC.ocXLookup:
      return true;
    default:
      return false;
  }
}

/** ScCompiler::DoubleRefToPosSingleRefScalarCase: the implicit intersection of a range with a
    formula position. */
export function DoubleRefToPosSingleRefScalarCase(rRange: ScRange, rFormulaPos: ScAddress): ScAddress | null {
  let bOk = false;
  const nMyCol = rFormulaPos.Col();
  const nMyRow = rFormulaPos.Row();
  const nMyTab = rFormulaPos.Tab();
  let nCol = 0;
  let nRow = 0;
  let nTab = rRange.aStart.Tab();
  if (rRange.aStart.Col() <= nMyCol && nMyCol <= rRange.aEnd.Col()) {
    nRow = rRange.aStart.Row();
    if (nRow === rRange.aEnd.Row()) {
      bOk = true;
      nCol = nMyCol;
    } else if (nTab !== nMyTab && nTab === rRange.aEnd.Tab() && rRange.aStart.Row() <= nMyRow && nMyRow <= rRange.aEnd.Row()) {
      bOk = true;
      nCol = nMyCol;
      nRow = nMyRow;
    }
  } else if (rRange.aStart.Row() <= nMyRow && nMyRow <= rRange.aEnd.Row()) {
    nCol = rRange.aStart.Col();
    if (nCol === rRange.aEnd.Col()) {
      bOk = true;
      nRow = nMyRow;
    } else if (nTab !== nMyTab && nTab === rRange.aEnd.Tab() && rRange.aStart.Col() <= nMyCol && nMyCol <= rRange.aEnd.Col()) {
      bOk = true;
      nCol = nMyCol;
      nRow = nMyRow;
    }
  }
  if (bOk) {
    if (nTab === rRange.aEnd.Tab()) {
      // all done
    } else if (nTab <= nMyTab && nMyTab <= rRange.aEnd.Tab()) nTab = nMyTab;
    else bOk = false;
    if (bOk) return new ScAddress(nCol, nRow, nTab);
  }
  return null;
}

export { CreateDoubleError, StackVar };
