// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/rangenam.hxx reduced
// @upstream sc/source/core/tool/rangenam.cxx reduced
// ScRangeData (a named expression: a name, its token array and base position) and ScRangeName
// (the names of the document or of one sheet, by upper case name and by index). Kept: compiling
// the symbol, GetSymbol in a grammar, the reference updates on cell shifts and sheet changes,
// IsReference/IsValidReference, name validation. Left out: CompileUnresolvedXML, transpose and
// grow updates, CopyUsedNames, the UNO type and the "possible address conflict" check of jumbo
// sheets.
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { svDoubleRef, svSingleRef, FormulaTokenArrayPlainIterator } from '../../../../formula/source/core/api/token.ts';
import { ScAddress, ScRange, ScRefFlags, type SCTAB } from '../../../inc/address.ts';
import type { ScComplexRefData, ScSingleRefData } from '../../../inc/refdata.ts';
import type { RefUpdateContext, RefUpdateDeleteTabContext, RefUpdateInsertTabContext, RefUpdateMoveTabContext } from '../../../inc/refupdatecontext.ts';
import { ScCompiler, type ScCompilerDocument } from './compiler.ts';
import { ScTokenArray } from './token.ts';

export const ScRangeDataType = {
  Name: 0x0000,
  Database: 0x0001,
  Criteria: 0x0002,
  PrintArea: 0x0004,
  ColHeader: 0x0008,
  RowHeader: 0x0010,
  AbsArea: 0x0020,
  RefArea: 0x0040,
  AbsPos: 0x0080,
  Hidden: 0x0100,
} as const;
export type ScRangeDataType = number;

export const IsNameValidType = { NAME_VALID: 0, NAME_INVALID_CELL_REF: 1, NAME_INVALID_BAD_STRING: 2 } as const;
export type IsNameValidType = (typeof IsNameValidType)[keyof typeof IsNameValidType];

export class ScRangeData {
  private aName: string;
  private aUpperName: string; // #i62977# for faster searching (aName is never modified after ctor)
  private maNewName = ''; ///< used for formulas after changing names in the dialog
  private pCode: ScTokenArray;
  private aPos: ScAddress;
  private eType: ScRangeDataType;
  private rDoc: ScCompilerDocument;
  private eTempGrammar: FormulaGrammar.Grammar;
  private nIndex = 0;
  private bModified = false; // is set/cleared by UpdateReference

  /** ScRangeData(rDoc, rName, rSymbol | rArr, rAddress, nType, eGrammar) */
  constructor(rDoc: ScCompilerDocument, rName: string, rSymbol: string | ScTokenArray, rAddress: ScAddress = new ScAddress(), nType: ScRangeDataType = ScRangeDataType.Name, eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT) {
    this.aName = rName;
    this.aUpperName = rName.toUpperCase();
    this.aPos = rAddress.clone();
    this.eType = nType;
    this.rDoc = rDoc;
    this.eTempGrammar = eGrammar;
    if (rSymbol instanceof ScTokenArray) {
      this.pCode = rSymbol.Clone();
      this.pCode.SetFromRangeName(true);
      this.InitCode();
    } else if (rSymbol) {
      this.pCode = new ScTokenArray(rDoc.GetSheetLimits());
      this.CompileRangeData(rSymbol, false);
    } else {
      // #i63513#/#i65690# don't leave pCode as NULL.
      this.pCode = new ScTokenArray(rDoc.GetSheetLimits());
      this.pCode.SetFromRangeName(true);
    }
  }

  /** Exact copy, not recompiled, no other index (!), nothing... except if
      pDocument or pPos are passed, those values are assigned instead of the
      copies. */
  clone(pDocument?: ScCompilerDocument, pPos?: ScAddress): ScRangeData {
    const r = new ScRangeData(pDocument ?? this.rDoc, this.aName, '', pPos ?? this.aPos, this.eType, this.eTempGrammar);
    r.pCode = this.pCode.Clone();
    r.pCode.SetFromRangeName(true);
    r.nIndex = this.nIndex;
    r.bModified = this.bModified;
    return r;
  }

  private CompileRangeData(rSymbol: string, bSetError: boolean): void {
    if (this.eTempGrammar === FormulaGrammar.GRAM_UNSPECIFIED) this.eTempGrammar = FormulaGrammar.GRAM_NATIVE;
    const aComp = new ScCompiler(this.rDoc, this.aPos, null, this.eTempGrammar);
    if (bSetError) aComp.SetExtendedErrorDetection(2);
    this.pCode = aComp.CompileString(rSymbol);
    this.pCode.SetFromRangeName(true);
    if (this.pCode.GetCodeError() !== FormulaError.NONE) return;

    const aIter = new FormulaTokenArrayPlainIterator(this.pCode);
    const p = aIter.GetNextReference();
    if (p) {
      // first token is a reference
      /* FIXME: wouldn't that need a check if it's exactly one reference? */
      if (p.GetType() === svSingleRef) this.eType = this.eType | ScRangeDataType.AbsPos;
      else this.eType = this.eType | ScRangeDataType.AbsArea;
    }
    // For manual input set an error for an incomplete formula.
    if (!this.rDoc.IsImportingXML?.()) {
      aComp.SetTokenArray(this.pCode);
      aComp.CompileTokenArray();
      this.pCode.DelRPN();
    }
  }

  private InitCode(): void {
    if (this.pCode.GetCodeError() === FormulaError.NONE) {
      const aIter = new FormulaTokenArrayPlainIterator(this.pCode);
      const p = this.pCode.FirstToken();
      if (p) { // exact one reference at first
        if (p.GetType() === svSingleRef) this.eType = this.eType | ScRangeDataType.AbsPos;
        else if (p.GetType() === svDoubleRef) this.eType = this.eType | ScRangeDataType.AbsArea;
      }
      void aIter;
    }
  }

  GetName(): string { return this.maNewName ? this.maNewName : this.aName; }
  GetUpperName(): string { return this.aUpperName; }
  GetPos(): ScAddress { return this.aPos; }
  SetIndex(nInd: number): void { this.nIndex = nInd; }
  GetIndex(): number { return this.nIndex; }
  SetNewName(rNewName: string): void { this.maNewName = rNewName; }
  GetCode(): ScTokenArray { return this.pCode; }
  SetCode(rArr: ScTokenArray): void {
    this.pCode = rArr.Clone();
    this.pCode.SetFromRangeName(true);
    this.InitCode();
  }
  GetErrCode(): FormulaError { return this.pCode ? this.pCode.GetCodeError() : FormulaError.NONE; }
  HasReferences(): boolean { return this.pCode.HasReferences(); }
  AddType(nType: ScRangeDataType): void { this.eType = this.eType | nType; }
  GetType(): ScRangeDataType { return this.eType; }
  HasType(nType: ScRangeDataType): boolean { return (this.eType & nType) === nType; }
  IsModified(): boolean { return this.bModified; }

  /** The expression in a grammar, relative to the name's own position or rPos. */
  GetSymbol(eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, rPos?: ScAddress): string {
    const aComp = new ScCompiler(this.rDoc, rPos ?? this.aPos, this.pCode, eGrammar);
    return aComp.CreateStringFromTokenArray();
  }

  /**
   * @param nLocalTab sheet index where this name belongs, or -1 for global
   *                  name.
   */
  UpdateReference(rCxt: RefUpdateContext, nLocalTab: SCTAB): void {
    void nLocalTab;
    const aRes = this.pCode.AdjustReferenceOnShift(rCxt, this.aPos);
    this.bModified = aRes.mbReferenceModified;
  }

  UpdateInsertTab(rCxt: RefUpdateInsertTabContext, nLocalTab: SCTAB): void {
    this.pCode.AdjustReferenceOnInsertedTab(rCxt, this.aPos);
    if (rCxt.mnInsertPos <= this.aPos.Tab()) this.aPos.IncTab(rCxt.mnSheets);
    void nLocalTab;
  }

  UpdateDeleteTab(rCxt: RefUpdateDeleteTabContext, nLocalTab: SCTAB): void {
    this.pCode.AdjustReferenceOnDeletedTab(rCxt, this.aPos);
    // ScRangeUpdater::UpdateDeleteTab( aPos, rCxt);
    if (rCxt.mnDeletePos <= this.aPos.Tab()) this.aPos.SetTab(Math.max(0, this.aPos.Tab() - rCxt.mnSheets));
    void nLocalTab;
  }

  UpdateMoveTab(rCxt: RefUpdateMoveTabContext, nLocalTab: SCTAB): void {
    const aRes = this.pCode.AdjustReferenceOnMovedTab(rCxt, this.aPos);
    if (aRes.mbReferenceModified) this.bModified = true;
    this.aPos.SetTab(rCxt.getNewTab(this.aPos.Tab()));
    void nLocalTab;
  }

  /** The range of a name consisting of only one reference. */
  IsReference(rPos?: ScAddress): ScRange | null {
    if (this.eType & (ScRangeDataType.AbsArea | ScRangeDataType.RefArea | ScRangeDataType.AbsPos) && this.pCode) return this.pCode.IsReference(rPos ?? this.aPos);
    return null;
  }

  IsValidReference(): ScRange | null {
    if (this.eType & (ScRangeDataType.AbsArea | ScRangeDataType.RefArea | ScRangeDataType.AbsPos) && this.pCode) return this.pCode.IsValidReference(this.aPos);
    return null;
  }

  /** Whether the name is the given range (findByRange). */
  IsRangeAtBlock(rBlock: ScRange): boolean {
    const r = this.IsReference();
    return !!r && r.equals(rBlock);
  }

  /** ScRangeData::IsNameValid: names are letters, digits, '_' and '.' (not starting with a digit
      or '.'), and must not look like a cell reference in A1 or R1C1. */
  static IsNameValid(rName: string, rDoc: ScCompilerDocument): IsNameValidType {
    /* XXX If changed, sc/source/filter/ftools/ftools.cxx
     * ScfTools::ConvertToScDefinedName needs to be changed too. */
    const a = '.';
    if (rName.indexOf(a) !== -1) {
      // ok
    }
    let nPos = 0;
    const nLen = rName.length;
    if (!nLen || !(/[\p{L}_\\]/u.test(rName[nPos++]!))) return IsNameValidType.NAME_INVALID_BAD_STRING;
    while (nPos < nLen) {
      if (!/[\p{L}\p{N}_.\\?]/u.test(rName[nPos++]!)) return IsNameValidType.NAME_INVALID_BAD_STRING;
    }
    const aAddr = new ScAddress();
    const aRange = new ScRange();
    for (const eConv of [FormulaGrammar.CONV_OOO, FormulaGrammar.CONV_XL_A1, FormulaGrammar.CONV_XL_R1C1]) {
      const details = { eConv, nRow: 0, nCol: 0 };
      // Don't check Parse on VALID, any partial only VALID may result in
      // #REF! during compile later!
      if (aRange.Parse(rName, rDoc, details) !== ScRefFlags.ZERO || aAddr.Parse(rName, rDoc, details) !== ScRefFlags.ZERO)
        return IsNameValidType.NAME_INVALID_CELL_REF;
    }
    return IsNameValidType.NAME_VALID;
  }

  /** The references of the expression, absolute for the name's position. */
  GetReferences(): ScRange[] {
    const out: ScRange[] = [];
    const it = new FormulaTokenArrayPlainIterator(this.pCode);
    for (let t = it.GetNextReference(); t; t = it.GetNextReference()) {
      if (t.GetType() === svSingleRef) out.push(new ScRange((t.GetSingleRef() as ScSingleRefData).toAbs(this.rDoc.GetSheetLimits(), this.aPos)));
      else out.push((t.GetDoubleRef() as ScComplexRefData).toAbs(this.rDoc.GetSheetLimits(), this.aPos));
    }
    return out;
  }
}

export class ScRangeName {
  private m_Data = new Map<string, ScRangeData>();
  private maIndexToData: (ScRangeData | null)[] = [];

  clone(pDocument?: ScCompilerDocument): ScRangeName {
    const r = new ScRangeName();
    for (const [k, v] of this.m_Data) {
      const p = v.clone(pDocument);
      r.m_Data.set(k, p);
      const nPos = p.GetIndex() - 1;
      if (nPos >= r.maIndexToData.length) r.maIndexToData.length = nPos + 1;
      r.maIndexToData[nPos] = p;
    }
    for (let i = 0; i < r.maIndexToData.length; i++) if (r.maIndexToData[i] === undefined) r.maIndexToData[i] = null;
    return r;
  }

  findByRange(rRange: ScRange): ScRangeData | null {
    for (const p of this.m_Data.values()) if (p.IsRangeAtBlock(rRange)) return p;
    return null;
  }

  findByUpperName(rName: string): ScRangeData | null { return this.m_Data.get(rName) ?? null; }

  findByIndex(i: number): ScRangeData | null {
    if (!i) return null; // index should never be zero.
    const nPos = i - 1;
    return nPos < this.maIndexToData.length ? (this.maIndexToData[nPos] ?? null) : null;
  }

  UpdateReference(rCxt: RefUpdateContext, nLocalTab: SCTAB = -1): void {
    if (rCxt.meMode === 0 /* URM_INSDEL */ && rCxt.mnColDelta === 0 && rCxt.mnRowDelta === 0 && rCxt.mnTabDelta === 0) return;
    for (const p of this.m_Data.values()) p.UpdateReference(rCxt, nLocalTab);
  }

  UpdateInsertTab(rCxt: RefUpdateInsertTabContext, nLocalTab: SCTAB = -1): void {
    for (const p of this.m_Data.values()) p.UpdateInsertTab(rCxt, nLocalTab);
  }

  UpdateDeleteTab(rCxt: RefUpdateDeleteTabContext, nLocalTab: SCTAB = -1): void {
    for (const p of this.m_Data.values()) p.UpdateDeleteTab(rCxt, nLocalTab);
  }

  UpdateMoveTab(rCxt: RefUpdateMoveTabContext, nLocalTab: SCTAB = -1): void {
    for (const p of this.m_Data.values()) p.UpdateMoveTab(rCxt, nLocalTab);
  }

  begin(): IterableIterator<ScRangeData> { return this.m_Data.values(); }
  [Symbol.iterator](): IterableIterator<ScRangeData> { return this.m_Data.values(); }
  size(): number { return this.m_Data.size; }
  index_size(): number { return this.maIndexToData.length; }
  empty(): boolean { return this.m_Data.size === 0; }

  /** Insert object into set.
      @param  bReuseFreeIndex
              If the ScRangeData p points to has an index value of 0:
              If `TRUE` then reuse a free index slot if available.
              If `FALSE` then assign a new index slot. */
  insert(p: ScRangeData, bReuseFreeIndex = true): boolean {
    if (!p.GetIndex()) {
      // Assign a new index.  An index must be unique and is never 0.
      if (bReuseFreeIndex) {
        const itr = this.maIndexToData.indexOf(null);
        if (itr !== -1) {
          // Empty slot exists.  Re-use it.
          p.SetIndex(itr + 1);
        } else {
          // No empty slot.  Append it to the end.
          this.maIndexToData.push(null);
          p.SetIndex(this.maIndexToData.length);
        }
      } else {
        this.maIndexToData.push(null);
        p.SetIndex(this.maIndexToData.length);
      }
    }

    const aName = p.GetUpperName();
    if (this.m_Data.has(aName)) return false;
    this.m_Data.set(aName, p);
    // Data inserted.  Store its index for mapping.
    const nPos = p.GetIndex() - 1;
    if (nPos >= this.maIndexToData.length) {
      while (this.maIndexToData.length <= nPos) this.maIndexToData.push(null);
    }
    this.maIndexToData[nPos] = p;
    return true;
  }

  erase(r: ScRangeData | string): void {
    const aName = typeof r === 'string' ? r.toUpperCase() : r.GetUpperName();
    const p = this.m_Data.get(aName);
    if (!p) return;
    this.m_Data.delete(aName);
    const nPos = p.GetIndex() - 1;
    if (nPos < this.maIndexToData.length) this.maIndexToData[nPos] = null;
  }

  clear(): void {
    this.m_Data.clear();
    this.maIndexToData = [];
  }
}

export { ScTokenArray };
