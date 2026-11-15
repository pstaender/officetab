// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/validat.hxx reduced
// @upstream sc/source/core/data/validat.cxx reduced
// Validity (Data - Validity): ScValidationData, a condition on what a cell may contain (whole
// numbers, decimals, dates, times, text length, a list, or a formula), with the input help shown
// at the cell and the error alert for invalid input; ScValidationDataList, the document's
// validations by key (the cells refer to one through ATTR_VALIDDATA). Reduced: the error alert is
// handed to the caller instead of a message box (DoError returns what to show), the macro action
// (SC_VALERR_MACRO, DoMacro/DoScript) is not supported, formula input (rTest starting with '=')
// is checked by its result like isFormulaResultsValidatable without its dialog states.
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { ocDBArea, ocName, ocSep, ocTableRef } from '../../../../include/formula/opcode.ts';
import { svIndex, svString } from '../../../../formula/source/core/api/token.ts';
import { approxEqual } from '../../../../sal/rtl/math.ts';
import { GetInputLineString, IsNumberFormat } from '../../../../svl/source/numbers/zforlist.ts';
import { ScAddress, type ScRange } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue } from '../../../inc/cellvalue.ts';
import { ScTypedStrData, ScTypedStrDataType } from '../../../inc/filterentries.ts';
import { ScGlobal } from '../../../inc/global.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ScMatrix } from '../tool/scmatrix.ts';
import type { RefUpdateContext } from '../../../inc/refupdatecontext.ts';
import { ScTokenArray } from '../tool/token.ts';
import { ScConditionEntry, ScConditionMode } from './conditio.ts';
import type { ScDocument } from './document.ts';
import { ScFormulaCell, ScMatrixMode } from './formulacell.ts';

export const ScValidationMode = {
  SC_VALID_ANY: 0, SC_VALID_WHOLE: 1, SC_VALID_DECIMAL: 2, SC_VALID_DATE: 3, SC_VALID_TIME: 4, SC_VALID_TEXTLEN: 5, SC_VALID_LIST: 6, SC_VALID_CUSTOM: 7,
} as const;
export type ScValidationMode = (typeof ScValidationMode)[keyof typeof ScValidationMode];

export const ScValidErrorStyle = { SC_VALERR_STOP: 0, SC_VALERR_WARNING: 1, SC_VALERR_INFO: 2, SC_VALERR_MACRO: 3 } as const;
export type ScValidErrorStyle = (typeof ScValidErrorStyle)[keyof typeof ScValidErrorStyle];

/** css::sheet::TableValidationVisibility. */
export const TableValidationVisibility = { INVISIBLE: 0, UNSORTED: 1, SORTEDASCENDING: 2 } as const;

const STR_VALID_DEFERROR = 'Invalid value.';
const STR_APP_TITLE = 'OfficeTab Calc';

/** What the error alert shows (DoError's message box). */
export interface ScValidationError { aTitle: string; aMessage: string; eStyle: ScValidErrorStyle }

/** lclGetCellFormat: the number format of the cell. */
function lclGetCellFormat(rDoc: ScDocument, rPos: ScAddress): string {
  return rDoc.GetPattern(rPos.Col(), rPos.Row(), rPos.Tab()).GetNumberFormat();
}

/** ScStringTokenIterator: the strings of a token array of separated strings; null (and !Ok) on
    any other token. */
function StringTokens(rTokArr: ScTokenArray): { strings: string[]; bOk: boolean } {
  const strings: string[] = [];
  for (const pToken of rTokArr.GetArray()) {
    if (pToken.GetOpCode() === ocSep) continue;
    if (pToken.GetType() !== svString) return { strings, bOk: false };
    const s = pToken.GetString();
    // string found but empty -> get next token
    if (s !== '') strings.push(s);
  }
  return { strings, bOk: true };
}

export class ScValidationData extends ScConditionEntry {
  private nKey = 0; // index in attributes
  private eDataMode: ScValidationMode;
  private bShowInput = false;
  private bShowError = false;
  private eErrorStyle: ScValidErrorStyle = ScValidErrorStyle.SC_VALERR_STOP;
  private mnListType: number = TableValidationVisibility.UNSORTED; // selection list type: none, unsorted, sorted.
  private aInputTitle = '';
  private aInputMessage = '';
  private aErrorTitle = '';
  private aErrorMessage = '';

  /** A validation (eMode, eOper, expressions as strings or token arrays, document, position),
      or a copy of r. */
  constructor(eMode: ScValidationMode | ScValidationData, eOper?: ScConditionMode, rExpr1?: string | ScTokenArray | null, rExpr2?: string | ScTokenArray | null, rDocument?: ScDocument, rPos?: ScAddress, eGrammar1: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT, eGrammar2: FormulaGrammar.Grammar = FormulaGrammar.GRAM_DEFAULT) {
    if (eMode instanceof ScValidationData) {
      const r = eMode;
      super(r, undefined, undefined, rDocument);
      this.nKey = r.nKey;
      this.eDataMode = r.eDataMode;
      this.bShowInput = r.bShowInput;
      this.bShowError = r.bShowError;
      this.eErrorStyle = r.eErrorStyle;
      this.mnListType = r.mnListType;
      this.aInputTitle = r.aInputTitle;
      this.aInputMessage = r.aInputMessage;
      this.aErrorTitle = r.aErrorTitle;
      this.aErrorMessage = r.aErrorMessage;
      return;
    }
    super(eOper!, rExpr1, rExpr2, rDocument, rPos, eGrammar1, eGrammar2);
    this.eDataMode = eMode;
  }

  Clone(rNew?: ScDocument): ScValidationData { return new ScValidationData(this, undefined, undefined, undefined, rNew); }

  ResetInput(): void { this.bShowInput = false; }
  ResetError(): void { this.bShowError = false; }

  SetInput(rTitle: string, rMsg: string): void {
    this.bShowInput = true;
    this.aInputTitle = rTitle;
    this.aInputMessage = rMsg;
  }

  SetError(rTitle: string, rMsg: string, eStyle: ScValidErrorStyle): void {
    this.bShowError = true;
    this.eErrorStyle = eStyle;
    this.aErrorTitle = rTitle;
    this.aErrorMessage = rMsg;
  }

  /** The input help: { bShow, title, message } (GetInput). */
  GetInput(): { bShow: boolean; aTitle: string; aMsg: string } { return { bShow: this.bShowInput, aTitle: this.aInputTitle, aMsg: this.aInputMessage }; }

  /** The error alert: { bShow, title, message, style } (GetErrMsg). */
  GetErrMsg(): { bShow: boolean; aTitle: string; aMsg: string; eStyle: ScValidErrorStyle } {
    return { bShow: this.bShowError, aTitle: this.aErrorTitle, aMsg: this.aErrorMessage, eStyle: this.eErrorStyle };
  }

  GetDataMode(): ScValidationMode { return this.eDataMode; }
  GetListType(): number { return this.mnListType; }
  SetListType(nListType: number): void { this.mnListType = nListType; }
  GetKey(): number { return this.nKey; }
  SetKey(nNew: number): void { this.nKey = nNew; } // only if not inserted!

  IsEmpty(): boolean {
    const aEmpty = new ScValidationData(ScValidationMode.SC_VALID_ANY, ScConditionMode.Equal, '', '', this.GetDocument(), new ScAddress());
    return this.EqualEntries(aEmpty);
  }

  /** for undo */
  EqualEntries(r: ScValidationData): boolean {
    //  test same parameters (excluding Key)
    return this.IsEqual(r, true) && this.eDataMode === r.eDataMode && this.bShowInput === r.bShowInput && this.bShowError === r.bShowError
      && this.eErrorStyle === r.eErrorStyle && this.mnListType === r.mnListType && this.aInputTitle === r.aInputTitle && this.aInputMessage === r.aInputMessage
      && this.aErrorTitle === r.aErrorTitle && this.aErrorMessage === r.aErrorMessage;
  }

  /**
   * What happens to invalid input (DoError): null when the input is simply dropped (no alert),
   * else the alert to show; with SC_VALERR_STOP the input is dropped after the alert, with
   * SC_VALERR_WARNING and SC_VALERR_INFO it is kept if the alert is confirmed (OK) and dropped on
   * Cancel.
   */
  DoError(): ScValidationError | null {
    if (this.eErrorStyle === ScValidErrorStyle.SC_VALERR_MACRO) return null;
    if (!this.bShowError) return null;

    //  Output error message
    let aTitle = this.aErrorTitle;
    if (!aTitle) aTitle = STR_APP_TITLE; // application title
    let aMessage = this.aErrorMessage;
    if (!aMessage) aMessage = STR_VALID_DEFERROR;
    return { aTitle, aMessage, eStyle: this.eErrorStyle };
  }

  /** Whether the result of a formula is valid input (isFormulaResultsValidatable, reduced). */
  private FormulaResult(rTest: string, rPos: ScAddress): { bOk: boolean; rStrResult: string; nVal: number; bIsVal: boolean } {
    const pFCell = new ScFormulaCell(this.GetDocument(), rPos, rTest);
    const nErr = pFCell.GetErrCode();
    if (nErr !== FormulaError.NONE) return { bOk: false, rStrResult: '', nVal: 0, bIsVal: false };
    if (pFCell.IsValue()) {
      const nVal = pFCell.GetValue();
      return { bOk: true, rStrResult: GetInputLineString(nVal, 'General', 'en-US'), nVal, bIsVal: true };
    }
    return { bOk: true, rStrResult: pFCell.GetString(), nVal: 0, bIsVal: false };
  }

  /** Whether input text is valid for the cell (IsDataValid with the input string). */
  IsDataValid(rTest: string | ScRefCellValue, rPattern?: ScPatternAttr | null, rPos?: ScAddress): boolean {
    if (rTest instanceof ScRefCellValue) return this.IsDataValidCell(rTest, rPos!);

    if (this.eDataMode === ScValidationMode.SC_VALID_ANY)
      // check if any cell content is allowed
      return true;

    if (rTest === '')
      // check whether empty cells are allowed
      return this.IsIgnoreBlank();

    let nVal = 0.0;
    let rStrResult = '';
    let bIsVal = false;
    let nFormat = 'General';

    if (rTest[0] === '=') {
      const r = this.FormulaResult(rTest, rPos!);
      if (!r.bOk) return false;
      ({ rStrResult, nVal, bIsVal } = r);

      // check whether empty cells are allowed
      if (rStrResult === '') return this.IsIgnoreBlank();
    } else {
      // get the value if any
      nFormat = rPattern ? rPattern.GetNumberFormat() : 'General';
      const r = IsNumberFormat(rTest, 'en-US', nFormat);
      bIsVal = r !== null;
      if (r) nVal = r.value;
      rStrResult = rTest;
    }

    if (this.eDataMode === ScValidationMode.SC_VALID_CUSTOM) {
      // IsDataValidCustom: the condition evaluated with the input in the cell
      return this.IsDataValidCustom(bIsVal, nVal, rStrResult, rPos!);
    }

    let bRet: boolean;
    if (ScValidationMode.SC_VALID_TEXTLEN === this.eDataMode) {
      if (!bIsVal) bRet = this.IsDataValidTextLen(rStrResult, rPos!, null);
      else bRet = this.IsDataValidTextLen(rStrResult, rPos!, { mfVal: nVal, mnFormat: nFormat });
    } else {
      if (bIsVal) bRet = this.IsDataValidCell(new ScRefCellValue(nVal), rPos!);
      else bRet = this.IsDataValidCell(new ScRefCellValue(rStrResult), rPos!);
    }

    return bRet;
  }

  /** The custom condition with the input put into the cell for the evaluation (IsDataValidCustom). */
  private IsDataValidCustom(bIsVal: boolean, nVal: number, rStrResult: string, rPos: ScAddress): boolean {
    const rDoc = this.GetDocument();
    const aTmpCell = bIsVal ? nVal : rStrResult;
    const aOriginal = rDoc.FetchTable(rPos.Tab())?.FetchColumn(rPos.Col())?.GetCellData(rPos.Row());
    const bOldUndo = rDoc.IsUndoEnabled();
    rDoc.EnableUndo(false);
    rDoc.SetCellData(rPos, aTmpCell);
    const bRet = this.IsCellValid(rDoc.GetRefCellValue(rPos), rPos);
    rDoc.SetCellData(rPos, aOriginal);
    rDoc.EnableUndo(bOldUndo);
    return bRet;
  }

  /** The length of text, or of a number's input line string (IsDataValidTextLen). */
  private IsDataValidTextLen(rTest: string, rPos: ScAddress, pDataNumeric: { mfVal: number; mnFormat: string | null } | null): boolean {
    let nLen: number;
    if (!pDataNumeric) nLen = rTest.length;
    else {
      // For numeric values use the resulting input line string to
      // determine length, otherwise an once accepted value maybe could
      // not be edited again, for example abbreviated dates or leading
      // zeros or trailing zeros after decimal separator change length.
      const nFormat = pDataNumeric.mnFormat ?? lclGetCellFormat(this.GetDocument(), rPos);
      const aStr = GetInputLineString(pDataNumeric.mfVal, nFormat, 'en-US');
      nLen = aStr.length;
    }
    const aTmpCell = new ScRefCellValue(nLen);
    return this.IsCellValid(aTmpCell, rPos);
  }

  /** Whether a cell's content is valid (IsDataValid with a cell). */
  private IsDataValidCell(rCell: ScRefCellValue, rPos: ScAddress): boolean {
    if (this.eDataMode === ScValidationMode.SC_VALID_LIST) return this.IsListValid(rCell, rPos);

    if (this.eDataMode === ScValidationMode.SC_VALID_CUSTOM) return this.IsCellValid(rCell, rPos);

    let nVal = 0.0;
    let aString = '';
    let bIsVal = true;

    switch (rCell.getType()) {
      case CELLTYPE_VALUE:
        nVal = rCell.getDouble();
        break;
      case CELLTYPE_STRING:
      case CELLTYPE_EDIT:
        aString = rCell.getString();
        bIsVal = false;
        break;
      case CELLTYPE_FORMULA: {
        const pFCell = rCell.getFormula()!;
        bIsVal = pFCell.IsValue();
        if (bIsVal) nVal = pFCell.GetValue();
        else aString = pFCell.GetString();
        break;
      }
      default:
        // Notes, Broadcaster
        return this.IsIgnoreBlank(); // as set
    }

    let bOk = true;
    switch (this.eDataMode) {
      // SC_VALID_ANY already above

      case ScValidationMode.SC_VALID_WHOLE:
      case ScValidationMode.SC_VALID_DECIMAL:
      case ScValidationMode.SC_VALID_DATE: // Date/Time is only formatting
      case ScValidationMode.SC_VALID_TIME:
        bOk = bIsVal;
        if (bOk && this.eDataMode === ScValidationMode.SC_VALID_WHOLE) bOk = approxEqual(nVal, Math.floor(nVal + 0.5)); // integers
        if (bOk) bOk = this.IsCellValid(rCell, rPos);
        break;

      case ScValidationMode.SC_VALID_TEXTLEN:
        if (!bIsVal) bOk = this.IsDataValidTextLen(aString, rPos, null);
        else bOk = this.IsDataValidTextLen(aString, rPos, { mfVal: nVal, mnFormat: null });
        break;

      default:
      // not yet done
    }

    return bOk;
  }

  /** Whether the cell will show a selection list (HasSelectionList). */
  HasSelectionList(): boolean {
    return this.eDataMode === ScValidationMode.SC_VALID_LIST && this.mnListType !== TableValidationVisibility.INVISIBLE;
  }

  /** The entries of a list from a cell range, a name or a formula (GetSelectionFromFormula). */
  private GetSelectionFromFormula(pStrings: ScTypedStrData[] | null, rCell: ScRefCellValue, rPos: ScAddress, rTokArr: ScTokenArray): { bOk: boolean; rMatch: number } {
    let bOk = true;
    const rDocument = this.GetDocument();

    const aValidationSrc = new ScFormulaCell(rDocument, rPos, rTokArr, FormulaGrammar.GRAM_DEFAULT, ScMatrixMode.Formula);

    // Make sure the formula gets interpreted and a result is delivered,
    // regardless of the AutoCalc setting.
    aValidationSrc.Interpret();

    let pValues = aValidationSrc.GetMatrix();
    if (!pValues) {
      // The somewhat nasty case of either an error occurred, or the
      // dereferenced value of a single cell reference or an immediate result
      // is stored as a single value.

      // Use an interim matrix to create the TypedStrData below.
      const xMatRef = new ScMatrix(1, 1, 0.0);

      const nErrCode = aValidationSrc.GetErrCode();
      if (nErrCode !== FormulaError.NONE) {
        xMatRef.PutError(nErrCode, 0, 0);
        bOk = false;
      } else if (aValidationSrc.IsValue()) xMatRef.PutDouble(aValidationSrc.GetValue(), 0, 0);
      else xMatRef.PutString(aValidationSrc.GetString(), 0, 0);

      pValues = xMatRef;
    }

    // which index matched.  We will want it eventually to pre-select that item.
    let rMatch = -1;

    const nDestFormat = rDocument.GetNumberFormat(rPos);

    const { nC: nCols, nR: nRows } = pValues.GetDimensions();
    let n = 0;

    let bRef = false;
    let aRange: ScRange | null = null;

    if (rTokArr.GetLen() === 1) {
      const t = rTokArr.FirstToken();
      if (t) {
        const eOpCode = t.GetOpCode();
        if (eOpCode === ocDBArea || eOpCode === ocTableRef) {
          const pDBData = rDocument.GetDBCollection().getNamedDBs().findByIndex(t.GetIndex());
          if (pDBData) {
            aRange = pDBData.GetArea();
            bRef = true;
          }
        } else if (eOpCode === ocName) {
          const nSheet = t.GetSheet();
          const pName = (nSheet >= 0 ? rDocument.GetRangeName(nSheet) : rDocument.GetRangeName())?.findByIndex(t.GetIndex());
          const r = pName?.IsReference();
          if (r) {
            aRange = r;
            bRef = true;
          }
        } else if (t.GetType() !== svIndex) {
          const r = rTokArr.IsValidReference(rPos);
          if (r) {
            aRange = r;
            bRef = true;
          }
        }
      }
    }

    let bHaveEmpty = false;

    /* XL artificially limits things to a single col or row in the UI but does
     * not list the constraint in MOOXml. If a defined name or INDIRECT
     * resulting in 1D is entered in the UI and the definition later modified
     * to 2D, it is evaluated fine and also stored and loaded. Let's get ahead
     * of the curve and support 2d. In XL, values are listed row-wise, do the
     * same. */
    for (let nRow = 0; nRow < nRows; nRow++) {
      for (let nCol = 0; nCol < nCols; nCol++) {
        const aCondTokArr = new ScTokenArray(rDocument.GetSheetLimits());
        let pEntry: ScTypedStrData | null = null;
        let aValStr: string;
        const nMatVal = pValues.Get(nCol, nRow);

        // strings and empties
        if (ScMatrix.IsNonValueType(nMatVal.nType)) {
          aValStr = nMatVal.GetString();

          // Do not add multiple empty strings to the validation list,
          // especially not if they'd bloat the tail with a million empty
          // entries for a column range, fdo#61520
          if (aValStr === '') {
            if (bHaveEmpty) continue;
            bHaveEmpty = true;
          }

          if (pStrings) pEntry = new ScTypedStrData(aValStr, 0.0, 0.0, ScTypedStrDataType.Standard);

          if (!rCell.isEmpty() && rMatch < 0) aCondTokArr.AddString(aValStr);
        } else {
          const nErr = nMatVal.GetError();

          if (nErr !== FormulaError.NONE) aValStr = ScGlobal.GetErrorString(nErr);
          else {
            // FIXME FIXME FIXME
            // Feature regression.  Date formats are lost passing through the matrix
            //For external reference and a formula that results in an area or array, date formats are still lost.
            if (bRef && aRange) aValStr = rDocument.GetInputString(new ScAddress(nCol + aRange.aStart.Col(), nRow + aRange.aStart.Row(), aRange.aStart.Tab()));
            else aValStr = GetInputLineString(nMatVal.fVal, nDestFormat, 'en-US');
          }

          if (!rCell.isEmpty() && rMatch < 0) {
            // I am not sure errors will work here, but a user can no
            // manually enter an error yet so the point is somewhat moot.
            aCondTokArr.AddDouble(nMatVal.fVal);
          }
          if (pStrings) pEntry = new ScTypedStrData(aValStr, nMatVal.fVal, nMatVal.fVal, ScTypedStrDataType.Value);
        }

        if (rMatch < 0 && !rCell.isEmpty() && this.IsEqualToTokenArray(rCell, rPos, aCondTokArr)) {
          rMatch = n;
          // short circuit on the first match if not filling the list
          if (!pStrings) return { bOk: true, rMatch };
        }

        if (pEntry) {
          pStrings!.push(pEntry);
          n++;
        }
      }
    }

    // In case of no match needed and an error occurred, return that error
    // entry as valid instead of silently failing.
    return { bOk: bOk || rCell.isEmpty(), rMatch };
  }

  /** The entries of the selection list (FillSelectionList). */
  FillSelectionList(rStrColl: ScTypedStrData[], rPos: ScAddress): boolean {
    let bOk = false;

    if (this.HasSelectionList()) {
      const pTokArr = this.CreateFlatCopiedTokenArray0();

      // *** try if formula is a string list ***

      const nFormat = lclGetCellFormat(this.GetDocument(), rPos);
      const aIt = StringTokens(pTokArr);
      if (aIt.bOk) {
        for (const aStr of aIt.strings) {
          const r = IsNumberFormat(aStr, 'en-US', nFormat);
          const fValue = r ? r.value : 0;
          rStrColl.push(new ScTypedStrData(aStr, fValue, fValue, r ? ScTypedStrDataType.Value : ScTypedStrDataType.Standard));
        }
      }
      bOk = aIt.bOk;

      // *** if not a string list, try if formula results in a cell range or
      // anything else we recognize as valid ***

      if (!bOk) {
        const aEmptyCell = new ScRefCellValue();
        bOk = this.GetSelectionFromFormula(rStrColl, aEmptyCell, rPos, pTokArr).bOk;
      }
    }

    return bOk;
  }

  /** The first expression as a token array (CreateFlatCopiedTokenArray(0)): the formula, or the
      constant. */
  private CreateFlatCopiedTokenArray0(): ScTokenArray {
    if (this.pFormula1) return this.pFormula1.Clone();
    const pRet = new ScTokenArray(this.GetDocument().GetSheetLimits());
    if (this.bIsStr1) pRet.AddString(this.aStrVal1);
    else pRet.AddDouble(this.nVal1);
    return pRet;
  }

  /** Tests, if pCell is equal to what the passed token array represents. */
  private IsEqualToTokenArray(rCell: ScRefCellValue, rPos: ScAddress, rTokArr: ScTokenArray): boolean {
    // create a condition entry that tests on equality and set the passed token array
    const aCondEntry = new ScConditionEntry(ScConditionMode.Equal, rTokArr, null, this.GetDocument(), rPos);
    aCondEntry.SetCaseSensitive(this.IsCaseSensitive());

    return aCondEntry.IsCellValid(rCell, rPos);
  }

  /** Tests, if contents of pCell occur in cell range referenced by own formula, or in a string list. */
  private IsListValid(rCell: ScRefCellValue, rPos: ScAddress): boolean {
    let bIsValid = false;

    /*  Compare input cell with all supported tokens from the formula.
        Currently a formula may contain:
        1)  A list of strings (at least one string).
        2)  A single cell or range reference.
        3)  A single defined name (must contain a cell/range reference, another
            name, or DB range, or a formula resulting in a cell/range reference
            or matrix/array).
        4)  A single database range.
        5)  A formula resulting in a cell/range reference or matrix/array.
    */

    const pTokArr = this.CreateFlatCopiedTokenArray0();

    // *** try if formula is a string list ***

    const nFormat = lclGetCellFormat(this.GetDocument(), rPos);
    const aIt = StringTokens(pTokArr);
    for (const aStr of aIt.strings) {
      /*  Do not break the loop, if a valid string has been found.
          This is to find invalid tokens following in the formula. */
      if (!bIsValid) {
        // create a formula containing a single string or number
        const aCondTokArr = new ScTokenArray(this.GetDocument().GetSheetLimits());
        const r = IsNumberFormat(aStr, 'en-US', nFormat);
        if (r) aCondTokArr.AddDouble(r.value);
        else aCondTokArr.AddString(aStr);

        bIsValid = this.IsEqualToTokenArray(rCell, rPos, aCondTokArr);
      }
    }

    if (!aIt.bOk) bIsValid = false;

    // *** if not a string list, try if formula results in a cell range or
    // anything else we recognize as valid ***

    if (!bIsValid) {
      const r = this.GetSelectionFromFormula(null, rCell, rPos, pTokArr);
      bIsValid = r.bOk && r.rMatch >= 0;
    }

    return bIsValid;
  }
}

/** The validations of the document by key (ScValidationDataList). */
export class ScValidationDataList {
  private maData: ScValidationData[] = [];

  constructor(r?: ScValidationDataList, rNewDoc?: ScDocument) {
    //  for Ref-Undo - real copy with new tokens!
    if (r) for (const rxItem of r.maData) this.InsertNew(rxItem.Clone(rNewDoc));
  }

  Clone(rNewDoc?: ScDocument): ScValidationDataList { return new ScValidationDataList(this, rNewDoc); }

  InsertNew(pNew: ScValidationData): void {
    this.maData.push(pNew);
    this.maData.sort((a, b) => a.GetKey() - b.GetKey());
  }

  GetData(nKey: number): ScValidationData | null {
    //  ScValidationData can be used both for validity and conditional formatting
    return this.maData.find((p) => p.GetKey() === nKey) ?? null;
  }

  UpdateReference(rCxt: RefUpdateContext): void {
    for (const rxItem of this.maData) rxItem.UpdateReference(rCxt);
  }

  [Symbol.iterator](): Iterator<ScValidationData> { return this.maData[Symbol.iterator](); }
  size(): number { return this.maData.length; }
  empty(): boolean { return this.maData.length === 0; }
}
