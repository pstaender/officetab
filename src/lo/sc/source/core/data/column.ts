// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/column.hxx reduced
// @upstream sc/source/core/data/column.cxx reduced
// @upstream sc/source/core/data/column2.cxx reduced
// @upstream sc/source/core/data/column3.cxx reduced
// @upstream sc/source/core/data/column4.cxx reduced
// ScColumn: the cells of one column and its attributes. Instead of mdds' multi_type_vector of
// cell blocks the cells are two sorted arrays, rows and cells (a number, a string, an
// EditTextObject or an ScFormulaCell), so lookups are a binary search, appending is cheap and a
// row range is a slice. Cell notes are a map by row. The broadcasters of the cells live in the
// document's ScBroadcastAreaSlotMachine. Left out: shared formula groups, sparklines, the cell
// text attributes cache (script type, text width) and the draw objects.
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { IsNumberFormat, GetType as NFGetType, GetStandardFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScAddress, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE, GetCellType, ScRefCellValue, type CellType, type ScCellData } from '../../../inc/cellvalue.ts';
import { InsertDeleteFlags, type HasAttrFlags } from '../../../inc/global.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import type { ScItemId, ScItems, ScItemSet } from '../../../inc/scitems.ts';
import type { ScStyleSheet } from '../../../inc/stlsheet.ts';
import { ScSetStringParam, ScStringUtil, TextFormatPolicy } from '../../../inc/stringutil.ts';
import { ScCellFormat } from '../tool/cellform.ts';
import { ScAttrArray } from './attarray.ts';
import { ScFormulaCell, ScMatrixMode } from './formulacell.ts';
import type { ScDocument } from './document.ts';

/** ScPostIt, reduced: a cell note's text, author and date. */
export interface ScPostIt { maText: string; maAuthor: string; maDate: string; mbShown: boolean }

export class ScColumn {
  private nCol: SCCOL;
  private nTab: SCTAB;
  private readonly rDoc: ScDocument;
  /** The rows that have cells, ascending. */
  private maRows: number[] = [];
  /** The cells, parallel to maRows. */
  private maCells: ScCellData[] = [];
  private maNotes = new Map<number, ScPostIt>();
  pAttrArray: ScAttrArray;

  constructor(rDoc: ScDocument, nColP: SCCOL, nTabP: SCTAB) {
    this.rDoc = rDoc;
    this.nCol = nColP;
    this.nTab = nTabP;
    this.pAttrArray = new ScAttrArray(rDoc.MaxRow(), rDoc.getCellAttributeHelper());
  }

  GetCol(): SCCOL { return this.nCol; }
  GetTab(): SCTAB { return this.nTab; }
  SetTab(nTabP: SCTAB): void { this.nTab = nTabP; }
  SetCol(nColP: SCCOL): void { this.nCol = nColP; }
  GetDoc(): ScDocument { return this.rDoc; }

  /** The index of the first entry with a row >= nRow. */
  private LowerBound(nRow: SCROW): number {
    const a = this.maRows;
    // fast path: appending
    const n = a.length;
    if (!n || a[n - 1]! < nRow) return n;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid]! < nRow) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private FindIndex(nRow: SCROW): number {
    const i = this.LowerBound(nRow);
    return i < this.maRows.length && this.maRows[i] === nRow ? i : -1;
  }

  // --- raw cell access ---------------------------------------------------------------------------

  GetCellData(nRow: SCROW): ScCellData | undefined {
    const i = this.FindIndex(nRow);
    return i >= 0 ? this.maCells[i] : undefined;
  }

  GetCellValue(nRow: SCROW): ScRefCellValue { return new ScRefCellValue(this.GetCellData(nRow)); }

  GetCellType(nRow: SCROW): CellType { return GetCellType(this.GetCellData(nRow)); }

  /** Store a cell (or remove it with undefined); returns the replaced cell. */
  private PutCell(nRow: SCROW, p: ScCellData | undefined): ScCellData | undefined {
    const i = this.LowerBound(nRow);
    const bExists = i < this.maRows.length && this.maRows[i] === nRow;
    const pOld = bExists ? this.maCells[i] : undefined;
    if (p === undefined) {
      if (bExists) {
        this.maRows.splice(i, 1);
        this.maCells.splice(i, 1);
      }
    } else if (bExists) this.maCells[i] = p;
    else if (i === this.maRows.length) {
      this.maRows.push(nRow);
      this.maCells.push(p);
    } else {
      this.maRows.splice(i, 0, nRow);
      this.maCells.splice(i, 0, p);
    }
    return pOld;
  }

  /** Remove the old cell's listening and put the new cell, without broadcasting. */
  private ReplaceCell(nRow: SCROW, p: ScCellData | undefined, bStartListening = true): void {
    const pOld = this.PutCell(nRow, p);
    if (pOld instanceof ScFormulaCell) {
      pOld.EndListeningTo(this.rDoc);
      this.rDoc.RemoveFromFormulaTree(pOld);
    }
    if (p instanceof ScFormulaCell) {
      p.aPos.Set(this.nCol, nRow, this.nTab);
      if (bStartListening) this.AttachNewFormulaCell(nRow, p);
    }
  }

  /** Set up a new formula cell: listening, and dirty (AttachNewFormulaCell). */
  private AttachNewFormulaCell(nRow: SCROW, pCell: ScFormulaCell): void {
    // A new formula cell takes the number format its result implies when the cell's format is
    // the standard format of its type.
    const aFormat = this.GetNumberFormat(nRow);
    if (/^General$/i.test(aFormat)) pCell.SetNeedNumberFormat(true);
    if (!this.rDoc.IsClipOrUndo()) {
      pCell.StartListeningTo(this.rDoc);
      if (!this.rDoc.IsCalcingAfterLoad()) pCell.SetDirty();
      else pCell.SetDirtyVar();
    }
  }

  /** Broadcast a changed cell to its listeners (BroadcastNewCell). */
  private BroadcastNewCell(nRow: SCROW): void {
    this.rDoc.Broadcast(new ScAddress(this.nCol, nRow, this.nTab));
  }

  SetValue(nRow: SCROW, fVal: number, bBroadcast = true): void {
    if (!this.rDoc.ValidRow(nRow)) return;
    this.ReplaceCell(nRow, fVal);
    if (bBroadcast) this.BroadcastNewCell(nRow);
  }

  /** Set a string without parsing it. */
  SetRawString(nRow: SCROW, rStr: string, bBroadcast = true): void {
    if (!this.rDoc.ValidRow(nRow)) return;
    this.ReplaceCell(nRow, rStr);
    if (bBroadcast) this.BroadcastNewCell(nRow);
  }

  SetEditText(nRow: SCROW, pEditText: EditTextObject, bBroadcast = true): void {
    if (!this.rDoc.ValidRow(nRow)) return;
    this.ReplaceCell(nRow, pEditText);
    if (bBroadcast) this.BroadcastNewCell(nRow);
  }

  /** Takes ownership of pCell. */
  SetFormulaCell(nRow: SCROW, pCell: ScFormulaCell, bBroadcast = true): ScFormulaCell | null {
    if (!this.rDoc.ValidRow(nRow)) return null;
    this.ReplaceCell(nRow, pCell);
    if (bBroadcast) this.BroadcastNewCell(nRow);
    return pCell;
  }

  /** Put a cell as an import does: no listening, no broadcast (ScDocumentImport). */
  SetCellRaw(nRow: SCROW, p: ScCellData): void {
    this.PutCell(nRow, p);
    if (p instanceof ScFormulaCell) p.aPos.Set(this.nCol, nRow, this.nTab);
  }

  /** Remove a cell without listening changes or broadcasting (moving cells). */
  RemoveCellRaw(nRow: SCROW): void { this.PutCell(nRow, undefined); }

  /** Put a cell of any type as a copy of rCell (SetCellValue / ScCellValue::release). */
  SetCell(nRow: SCROW, p: ScCellData | undefined, bBroadcast = true): void {
    if (p === undefined) { this.Delete(nRow, bBroadcast); return; }
    this.ReplaceCell(nRow, p);
    if (bBroadcast) this.BroadcastNewCell(nRow);
  }

  /** Delete the cell of a row (content only). */
  Delete(nRow: SCROW, bBroadcast = true): void {
    if (this.FindIndex(nRow) < 0) return;
    this.ReplaceCell(nRow, undefined);
    if (bBroadcast) this.BroadcastNewCell(nRow);
  }

  /**
   * Parse a string as typed into a cell (ScColumn::ParseString): a formula after '=', text after
   * an apostrophe, a number, percentage, currency, date, time or boolean in the cell's language
   * (applying the detected number format when the old one was a type's standard format), else
   * text. Returns the new cell content and whether the number format was set.
   */
  ParseString(nRow: SCROW, nTabP: SCTAB, rString: string, eConv: FormulaGrammar.AddressConvention, pParam?: ScSetStringParam | null): { aCell: ScCellData | undefined; bNumFmtSet: boolean } {
    if (!rString) return { aCell: undefined, bNumFmtSet: false };

    let bNumFmtSet = false;
    const aParam = pParam ?? new ScSetStringParam();
    const lang = this.GetLanguage(nRow);

    let cFirstChar = '\0'; // Text
    const nOldIndex = this.GetNumberFormat(nRow);
    let nIndex = nOldIndex;
    let eNumFormatType: SvNumFormatType | null = null;
    if (rString.length > 1) {
      eNumFormatType = NFGetType(nIndex, lang);
      if (eNumFormatType !== SvNumFormatType.TEXT) cFirstChar = rString[0]!;
    }

    let aCell: ScCellData | undefined;
    if (cFirstChar === '=') {
      if (rString.length === 1) aCell = rString; // = Text
      else if (aParam.meSetTextNumFormat === TextFormatPolicy.Always) {
        // Set the cell format type to Text.
        this.ApplyAttr(nRow, { ATTR_VALUE_FORMAT: '@' });
        aCell = rString;
      } else {
        // = Formula
        aCell = new ScFormulaCell(this.rDoc, new ScAddress(this.nCol, nRow, nTabP), rString, FormulaGrammar.mergeToGrammar(FormulaGrammar.GRAM_DEFAULT, eConv), ScMatrixMode.NONE);
      }
    } else if (cFirstChar === '\'') {
      // 'Text
      if (aParam.mbHandleApostrophe) {
        // Cell format is not 'Text', and the first char is an apostrophe.
        // Strip it and set text content.
        aCell = rString.slice(1);
      } else aCell = rString; // This is normal text. Take it as-is.
    } else {
      do {
        if (aParam.mbDetectNumberFormat) {
          if (eNumFormatType === null) eNumFormatType = NFGetType(nIndex, lang);
          const r = IsNumberFormat(rString, lang, nIndex);
          if (!r) break;
          nIndex = r.code;
          const bForceFormatDate = (eNumFormatType === SvNumFormatType.DATE || eNumFormatType === SvNumFormatType.DATETIME) && this.GetCellType(nRow) === CELLTYPE_VALUE;
          // If we have bForceFormatDate, the old format was/is of date(+time) type
          // already, if detected type is compatible keep the original format.
          if (bForceFormatDate && IsCompatible(eNumFormatType, NFGetType(nIndex, lang))) nIndex = nOldIndex;

          aCell = r.value;
          if (nIndex !== nOldIndex) {
            // #i22345# New behavior: Apply the detected number format only if
            // the old one was the default number, date, time or boolean format.
            // Exception: If the new format is boolean, always apply it.
            let bOverwrite = false;
            const nOldType = NFGetType(nOldIndex, lang);
            if (nOldType === SvNumFormatType.NUMBER || nOldType === SvNumFormatType.DATE || nOldType === SvNumFormatType.TIME || nOldType === SvNumFormatType.LOGICAL) {
              if (nOldIndex === GetStandardFormat(nOldType, lang)) bOverwrite = true; // default of these types can be overwritten
            }
            if (!bOverwrite && NFGetType(nIndex, lang) === SvNumFormatType.LOGICAL) bOverwrite = true; // overwrite anything if boolean was detected
            if (bOverwrite) {
              this.ApplyAttr(nRow, { ATTR_VALUE_FORMAT: nIndex });
              bNumFmtSet = true;
            }
          }
        } else if (aParam.meSetTextNumFormat === TextFormatPolicy.Never || aParam.meSetTextNumFormat === TextFormatPolicy.SpecialNumberOnly) {
          // Only check if the string is a regular number.
          const v = ScStringUtil.parseSimpleNumber(rString, '.', ',', '\0', aParam.mbDetectScientificNumberFormat);
          if (v === null) break;
          aCell = v;
        }
      } while (false);

      if (aCell === undefined) {
        // If we reach here with ScSetStringParam::SpecialNumberOnly it
        // means a simple number was not detected above, so test for
        // special numbers. In any case ScSetStringParam::Always does not
        // mean always, but only always for content that could be any
        // numeric.
        if ((aParam.meSetTextNumFormat === TextFormatPolicy.Always || aParam.meSetTextNumFormat === TextFormatPolicy.SpecialNumberOnly) && IsNumberFormat(rString, lang, nIndex)) {
          // Set the cell format type to Text.
          this.ApplyAttr(nRow, { ATTR_VALUE_FORMAT: '@' });
        }
        aCell = rString;
      }
    }
    return { aCell, bNumFmtSet };
  }

  /** Returns true if the cell format was set as well. */
  SetString(nRow: SCROW, nTabP: SCTAB, rString: string, eConv: FormulaGrammar.AddressConvention = FormulaGrammar.CONV_OOO, pParam?: ScSetStringParam | null): boolean {
    if (!this.rDoc.ValidRow(nRow)) return false;
    const { aCell, bNumFmtSet } = this.ParseString(nRow, nTabP, rString, eConv, pParam);
    if (aCell === undefined) this.Delete(nRow);
    else this.SetCell(nRow, aCell);
    // Do not set Formats and Formulas here anymore!
    // These are queried during output
    return bNumFmtSet;
  }

  // --- values and strings ------------------------------------------------------------------------

  GetValue(nRow: SCROW): number {
    const p = this.GetCellData(nRow);
    if (typeof p === 'number') return p;
    if (p instanceof ScFormulaCell) return p.IsValue() ? p.GetValue() : 0.0;
    return 0.0;
  }

  /** The string the cell shows (with its number format). */
  GetString(nRow: SCROW): string {
    return this.GetStringAndColor(nRow).aString;
  }

  /** The string and colour the cell shows. */
  GetStringAndColor(nRow: SCROW): { aString: string; pColor: string | null } {
    const aCell = this.GetCellValue(nRow);
    // Interpret first: a new formula cell sets the number format its result implies.
    if (aCell.getType() === CELLTYPE_FORMULA) aCell.getFormula()!.MaybeInterpret();
    return ScCellFormat.GetString(aCell, this.GetNumberFormat(nRow), this.GetLanguage(nRow));
  }

  /** The string the input line edits: the formula of a formula cell, a number in its edit format. */
  GetInputString(nRow: SCROW): string {
    const aCell = this.GetCellValue(nRow);
    if (aCell.getType() === CELLTYPE_FORMULA) return aCell.getFormula()!.GetFormula();
    let s = ScCellFormat.GetInputString(aCell, this.GetNumberFormat(nRow), this.GetLanguage(nRow));
    // A string that would be read as a number (or formula) gets an apostrophe in the input line
    // (ScTabViewShell::UpdateInputHandler).
    if (aCell.getType() === CELLTYPE_STRING && NFGetType(this.GetNumberFormat(nRow), this.GetLanguage(nRow)) !== SvNumFormatType.TEXT) {
      if (s.startsWith('=') || s.startsWith('\'') || (IsNumberFormat(s, this.GetLanguage(nRow), this.GetNumberFormat(nRow)) && s.trim() === s && s.length > 0)) s = `'${s}`;
    }
    return s;
  }

  GetFormula(nRow: SCROW): string {
    const p = this.GetCellData(nRow);
    return p instanceof ScFormulaCell ? p.GetFormula() : '';
  }

  GetFormulaCell(nRow: SCROW): ScFormulaCell | null {
    const p = this.GetCellData(nRow);
    return p instanceof ScFormulaCell ? p : null;
  }

  GetEditText(nRow: SCROW): EditTextObject | null {
    const p = this.GetCellData(nRow);
    return p instanceof EditTextObject ? p : null;
  }

  /** The string content of a text or edit cell (without formatting). */
  GetStringContent(nRow: SCROW): string { return this.GetCellValue(nRow).getString(); }

  HasDataAt(nRow: SCROW): boolean { return this.FindIndex(nRow) >= 0; }
  HasStringData(nRow: SCROW): boolean { return this.GetCellValue(nRow).hasString(); }
  HasValueData(nRow: SCROW): boolean {
    const t = this.GetCellType(nRow);
    return t === CELLTYPE_VALUE || (t === CELLTYPE_FORMULA && this.GetFormulaCell(nRow)!.IsValue());
  }

  IsEmptyData(): boolean { return this.maRows.length === 0; }
  /** Whether the rows nStartRow..nEndRow have no cells (IsEmptyData). */
  IsEmptyBlock(nStartRow: SCROW, nEndRow: SCROW): boolean {
    const i = this.LowerBound(nStartRow);
    return i >= this.maRows.length || this.maRows[i]! > nEndRow;
  }
  IsEmpty(): boolean { return this.IsEmptyData() && this.pAttrArray.IsDefault() && !this.maNotes.size; }
  GetCellCount(): number { return this.maRows.length; }

  /** The first row with data, or -1 (GetFirstDataPos). */
  GetFirstDataPos(): SCROW { return this.maRows.length ? this.maRows[0]! : -1; }
  /** The last row with data, or -1 (GetLastDataPos). */
  GetLastDataPos(nLastRow?: SCROW): SCROW {
    if (nLastRow === undefined) return this.maRows.length ? this.maRows[this.maRows.length - 1]! : -1;
    const i = this.LowerBound(nLastRow + 1) - 1;
    return i >= 0 ? this.maRows[i]! : -1;
  }

  /** The next row with data after nRow (or before with bForward false), -1 if none. */
  GetNextDataPos(nRow: SCROW, bForward = true): SCROW {
    if (bForward) {
      const i = this.LowerBound(nRow + 1);
      return i < this.maRows.length ? this.maRows[i]! : -1;
    }
    const i = this.LowerBound(nRow) - 1;
    return i >= 0 ? this.maRows[i]! : -1;
  }

  /** HasVisibleDataAt: whether the row has a cell (notes are not data). */
  HasVisibleDataAt(nRow: SCROW): boolean { return this.FindIndex(nRow) >= 0; }

  /** FindNextVisibleRow: the next row that is not hidden, in a direction. */
  FindNextVisibleRow(nRow: SCROW, bForward: boolean): SCROW {
    const rDoc = this.GetDoc();
    if (bForward) {
      nRow++;
      const pTab = rDoc.FetchTable(this.nTab);
      const r = pTab?.RowHiddenRange(Math.min(nRow, rDoc.MaxRow()));
      if (r?.bHidden) return Math.min(rDoc.MaxRow(), r.nLastRow + 1);
      return nRow;
    }
    nRow--;
    const pTab = rDoc.FetchTable(this.nTab);
    const r = pTab?.RowHiddenRange(Math.max(nRow, 0));
    if (r?.bHidden) return Math.max(0, r.nFirstRow - 1);
    return nRow;
  }

  /**
   * FindNextVisibleRowWithContent: from nRow (exclusive), the next row in a direction that is not
   * hidden and has a cell; MaxRow (or 0) when there is none.
   */
  FindNextVisibleRowWithContent(nRow: SCROW, bForward: boolean): SCROW {
    const rDocument = this.GetDoc();
    const pTab = rDocument.FetchTable(this.nTab);
    if (bForward) {
      do {
        // The next row with a cell: the empty block is skipped at once.
        const nNext = this.GetNextDataPos(nRow, true);
        if (nNext < 0) return rDocument.MaxRow();
        nRow = nNext;
        const r = pTab?.RowHiddenRange(nRow);
        if (r?.bHidden) {
          nRow = r.nLastRow;
          if (nRow >= rDocument.MaxRow()) return rDocument.MaxRow();
          continue;
        }
        return nRow;
      } while (nRow < rDocument.MaxRow());
      return rDocument.MaxRow();
    }
    do {
      const nPrev = this.GetNextDataPos(nRow, false);
      if (nPrev < 0) return 0;
      nRow = nPrev;
      const r = pTab?.RowHiddenRange(nRow);
      if (r?.bHidden) {
        nRow = r.nFirstRow;
        if (nRow <= 0) return 0;
        continue;
      }
      return nRow;
    } while (nRow > 0);
    return 0;
  }

  /**
   * FindDataAreaPos: if the cell is empty, find the next non-empty cell position. If the cell is
   * not empty, find the last non-empty cell position in the current contiguous cell block.
   */
  FindDataAreaPos(rRow: SCROW, bDown: boolean): SCROW {
    if (!this.HasVisibleDataAt(rRow)) {
      // Current cell is empty. Find the next non-empty cell.
      return this.FindNextVisibleRowWithContent(rRow, bDown);
    }

    // Current cell is not empty.
    let nNextRow = this.FindNextVisibleRow(rRow, bDown);
    if (!this.HasVisibleDataAt(nNextRow)) {
      // Next visible cell is empty. Find the next non-empty cell.
      return this.FindNextVisibleRowWithContent(nNextRow, bDown);
    }

    // Next visible cell is non-empty. Find the edge that's still visible.
    let nLastRow = nNextRow;
    do {
      nNextRow = this.FindNextVisibleRow(nLastRow, bDown);
      if (nNextRow === nLastRow) break;
      if (this.HasVisibleDataAt(nNextRow)) nLastRow = nNextRow;
      else break;
    } while (nNextRow < this.GetDoc().MaxRow() && nNextRow > 0);

    return nLastRow;
  }

  /** Call f for every cell of rows nRow1..nRow2 (ascending). */
  ForEachCell(nRow1: SCROW, nRow2: SCROW, f: (nRow: SCROW, p: ScCellData) => void): void {
    const a = this.maRows;
    for (let i = this.LowerBound(nRow1); i < a.length && a[i]! <= nRow2; i++) f(a[i]!, this.maCells[i]!);
  }

  /** The cells of rows nRow1..nRow2 as row and cell arrays (for fast iteration). */
  GetCellsInRange(nRow1: SCROW, nRow2: SCROW): { aRows: number[]; aCells: ScCellData[] } {
    const i = this.LowerBound(nRow1);
    let j = i;
    while (j < this.maRows.length && this.maRows[j]! <= nRow2) j++;
    return { aRows: this.maRows.slice(i, j), aCells: this.maCells.slice(i, j) };
  }

  /** All formula cells of the column. */
  *FormulaCells(): Generator<ScFormulaCell> {
    for (const p of this.maCells) if (p instanceof ScFormulaCell) yield p;
  }

  /** Delete the content of rows nStartRow..nEndRow by flags (DeleteArea). */
  DeleteArea(nStartRow: SCROW, nEndRow: SCROW, nDelFlag: InsertDeleteFlags, bBroadcast = true): void {
    const nContMask = InsertDeleteFlags.CONTENTS & ~(InsertDeleteFlags.NOTE | InsertDeleteFlags.OUTLINE | InsertDeleteFlags.SPARKLINES);
    if (nDelFlag & nContMask) {
      const { aRows, aCells } = this.GetCellsInRange(nStartRow, nEndRow);
      for (let i = 0; i < aRows.length; i++) {
        const p = aCells[i]!;
        const t = GetCellType(p);
        let bDel = false;
        switch (t) {
          case CELLTYPE_VALUE: {
            // Value and date are distinguished by the number format.
            const nType = NFGetType(this.GetNumberFormat(aRows[i]!), this.GetLanguage(aRows[i]!));
            const bDate = nType === SvNumFormatType.DATE || nType === SvNumFormatType.TIME || nType === SvNumFormatType.DATETIME;
            bDel = bDate ? (nDelFlag & InsertDeleteFlags.DATETIME) !== 0 : (nDelFlag & InsertDeleteFlags.VALUE) !== 0;
            break;
          }
          case CELLTYPE_STRING:
          case CELLTYPE_EDIT:
            bDel = (nDelFlag & InsertDeleteFlags.STRING) !== 0;
            break;
          case CELLTYPE_FORMULA:
            bDel = (nDelFlag & InsertDeleteFlags.FORMULA) !== 0;
            break;
          default:
        }
        if (bDel) this.ReplaceCell(aRows[i]!, undefined);
      }
      if (bBroadcast) this.rDoc.BroadcastRange(this.nTab, this.nCol, nStartRow, this.nCol, nEndRow);
    }
    if (nDelFlag & InsertDeleteFlags.NOTE) {
      for (const nRow of [...this.maNotes.keys()]) if (nRow >= nStartRow && nRow <= nEndRow) this.maNotes.delete(nRow);
    }
    // Delete attributes just now
    if ((nDelFlag & InsertDeleteFlags.ATTRIB) === InsertDeleteFlags.ATTRIB) this.pAttrArray.DeleteArea(nStartRow, nEndRow);
    else if (nDelFlag & InsertDeleteFlags.HARDATTR) this.pAttrArray.DeleteHardAttr(nStartRow, nEndRow);
  }

  /** Shift the cells at and below nStartRow down by nSize rows (InsertRow). */
  InsertRow(nStartRow: SCROW, nSize: number): void {
    this.pAttrArray.InsertRow(nStartRow, nSize);
    const nMaxRow = this.rDoc.MaxRow();
    const i = this.LowerBound(nStartRow);
    for (let j = i; j < this.maRows.length; j++) this.maRows[j]! += nSize;
    // Cells shifted beyond the last row are lost (the caller checked they are empty).
    while (this.maRows.length && this.maRows[this.maRows.length - 1]! > nMaxRow) {
      this.maRows.pop();
      const p = this.maCells.pop();
      if (p instanceof ScFormulaCell) p.EndListeningTo(this.rDoc);
    }
    for (let j = i; j < this.maRows.length; j++) {
      const p = this.maCells[j];
      if (p instanceof ScFormulaCell) p.aPos.SetRow(this.maRows[j]!);
    }
    this.ShiftNotes(nStartRow, nSize);
  }

  /** Remove rows nStartRow..nStartRow+nSize-1 and shift the cells below up (DeleteRow). */
  DeleteRow(nStartRow: SCROW, nSize: number): void {
    this.pAttrArray.DeleteRow(nStartRow, nSize);
    const nEndRow = nStartRow + nSize - 1;
    const i = this.LowerBound(nStartRow);
    let j = i;
    while (j < this.maRows.length && this.maRows[j]! <= nEndRow) {
      const p = this.maCells[j];
      if (p instanceof ScFormulaCell) {
        p.EndListeningTo(this.rDoc);
        this.rDoc.RemoveFromFormulaTree(p);
      }
      j++;
    }
    this.maRows.splice(i, j - i);
    this.maCells.splice(i, j - i);
    for (let k = i; k < this.maRows.length; k++) {
      this.maRows[k]! -= nSize;
      const p = this.maCells[k];
      if (p instanceof ScFormulaCell) p.aPos.SetRow(this.maRows[k]!);
    }
    for (const nRow of [...this.maNotes.keys()]) if (nRow >= nStartRow && nRow <= nEndRow) this.maNotes.delete(nRow);
    this.ShiftNotes(nEndRow + 1, -nSize);
  }

  private ShiftNotes(nStartRow: SCROW, nDelta: number): void {
    if (!this.maNotes.size) return;
    const n = new Map<number, ScPostIt>();
    for (const [r, p] of this.maNotes) {
      const nNew = r >= nStartRow ? r + nDelta : r;
      if (nNew >= 0 && nNew <= this.rDoc.MaxRow()) n.set(nNew, p);
    }
    this.maNotes = n;
  }

  /** Swap all cells and attributes with another column (for moving columns). */
  SwapCol(rCol: ScColumn): void {
    [this.maRows, rCol.maRows] = [rCol.maRows, this.maRows];
    [this.maCells, rCol.maCells] = [rCol.maCells, this.maCells];
    [this.maNotes, rCol.maNotes] = [rCol.maNotes, this.maNotes];
    [this.pAttrArray, rCol.pAttrArray] = [rCol.pAttrArray, this.pAttrArray];
    for (const c of [this, rCol]) for (let k = 0; k < c.maRows.length; k++) {
      const p = c.maCells[k];
      if (p instanceof ScFormulaCell) p.aPos.Set(c.nCol, c.maRows[k]!, c.nTab);
    }
  }

  /** Move the formula cell positions after the column or sheet index changed. */
  UpdatePositions(): void {
    for (let k = 0; k < this.maRows.length; k++) {
      const p = this.maCells[k];
      if (p instanceof ScFormulaCell) p.aPos.Set(this.nCol, this.maRows[k]!, this.nTab);
    }
  }

  // --- notes -------------------------------------------------------------------------------------

  GetCellNote(nRow: SCROW): ScPostIt | null { return this.maNotes.get(nRow) ?? null; }
  SetCellNote(nRow: SCROW, pNote: ScPostIt | null): void {
    if (pNote) this.maNotes.set(nRow, pNote);
    else this.maNotes.delete(nRow);
  }
  HasCellNotes(): boolean { return this.maNotes.size > 0; }
  GetNoteRows(): number[] { return [...this.maNotes.keys()].sort((a, b) => a - b); }

  // --- attributes --------------------------------------------------------------------------------

  GetPattern(nRow: SCROW): ScPatternAttr { return this.pAttrArray.GetPattern(nRow); }

  GetAttr<K extends ScItemId>(nRow: SCROW, nWhich: K): ScItems[K] { return this.pAttrArray.GetPattern(nRow).GetItem(nWhich); }

  /** The number format code of a cell. */
  GetNumberFormat(nRow: SCROW): string { return this.pAttrArray.GetPattern(nRow).GetNumberFormat(); }

  /** The language of a cell's number format. */
  GetLanguage(nRow: SCROW): string { return this.pAttrArray.GetPattern(nRow).GetItem('ATTR_LANGUAGE_FORMAT') || 'en-US'; }

  ApplyAttr(nRow: SCROW, rItems: ScItemSet): void { this.pAttrArray.ApplyCacheArea(nRow, nRow, rItems); }

  ApplyPatternArea(nStartRow: SCROW, nEndRow: SCROW, rItems: ScItemSet): void { this.pAttrArray.ApplyCacheArea(nStartRow, nEndRow, rItems); }

  SetPatternArea(nStartRow: SCROW, nEndRow: SCROW, pPattern: ScPatternAttr): void { this.pAttrArray.SetPatternArea(nStartRow, nEndRow, pPattern); }

  ApplyStyleArea(nStartRow: SCROW, nEndRow: SCROW, rStyle: ScStyleSheet): void { this.pAttrArray.ApplyStyleArea(nStartRow, nEndRow, rStyle); }

  ClearItems(nStartRow: SCROW, nEndRow: SCROW, aWhich: readonly ScItemId[]): void { this.pAttrArray.ClearItems(nStartRow, nEndRow, aWhich); }

  HasAttrib(nRow1: SCROW, nRow2: SCROW, nMask: HasAttrFlags): boolean { return this.pAttrArray.HasAttrib(nRow1, nRow2, nMask); }

  ApplyFlags(nStartRow: SCROW, nEndRow: SCROW, nFlags: number): boolean { return this.pAttrArray.ApplyFlags(nStartRow, nEndRow, nFlags); }
  RemoveFlags(nStartRow: SCROW, nEndRow: SCROW, nFlags: number): boolean { return this.pAttrArray.RemoveFlags(nStartRow, nEndRow, nFlags); }

  /** The last row with a cell or a non-default attribute. */
  GetLastUsedRow(): SCROW { return Math.max(this.GetLastDataPos(), this.pAttrArray.GetLastAttrRow() === this.rDoc.MaxRow() ? -1 : this.pAttrArray.GetLastAttrRow(), ...(this.maNotes.size ? [Math.max(...this.maNotes.keys())] : [])); }

  // --- copying -----------------------------------------------------------------------------------

  /**
   * Copy rows nRow1..nRow2 by flags into a column of another document at the same rows plus
   * nRowOffset (CopyToColumn). Formula cells are cloned for their new position.
   */
  CopyToColumn(nRow1: SCROW, nRow2: SCROW, nFlags: InsertDeleteFlags, rColumn: ScColumn, nRowOffset = 0, bAsLink = false): void {
    void bAsLink;
    if (nFlags & InsertDeleteFlags.ATTRIB) {
      for (const r of this.pAttrArray.CopyArea(nRow1, nRow2)) {
        const pPattern = rColumn.rDoc === this.rDoc ? r.pPattern : rColumn.rDoc.ImportPattern(r.pPattern);
        if ((nFlags & InsertDeleteFlags.ATTRIB) === InsertDeleteFlags.ATTRIB) rColumn.pAttrArray.SetPatternArea(nRow1 + r.nStart + nRowOffset, nRow1 + r.nEnd + nRowOffset, pPattern);
        else if (nFlags & InsertDeleteFlags.STYLES && pPattern.GetStyleSheet()) rColumn.pAttrArray.ApplyStyleArea(nRow1 + r.nStart + nRowOffset, nRow1 + r.nEnd + nRowOffset, pPattern.GetStyleSheet()!);
      }
    }
    if (nFlags & InsertDeleteFlags.CONTENTS) {
      this.ForEachCell(nRow1, nRow2, (nRow, p) => {
        const nDestRow = nRow + nRowOffset;
        const t = GetCellType(p);
        let bCopy = false;
        switch (t) {
          case CELLTYPE_VALUE: {
            const nType = NFGetType(this.GetNumberFormat(nRow), this.GetLanguage(nRow));
            const bDate = nType === SvNumFormatType.DATE || nType === SvNumFormatType.TIME || nType === SvNumFormatType.DATETIME;
            bCopy = bDate ? (nFlags & InsertDeleteFlags.DATETIME) !== 0 : (nFlags & InsertDeleteFlags.VALUE) !== 0;
            break;
          }
          case CELLTYPE_STRING:
          case CELLTYPE_EDIT:
            bCopy = (nFlags & InsertDeleteFlags.STRING) !== 0;
            break;
          case CELLTYPE_FORMULA:
            bCopy = (nFlags & InsertDeleteFlags.FORMULA) !== 0;
            break;
          default:
        }
        if (!bCopy) {
          // An undo document gets no results of formulas instead of the formulas (CopyByCloneHandler).
          if (t === CELLTYPE_FORMULA && nFlags & (InsertDeleteFlags.VALUE | InsertDeleteFlags.STRING) && !rColumn.rDoc.IsUndo()) {
            // Copy the result as value or string (not the formula).
            const pF = p as ScFormulaCell;
            if (pF.IsValue()) {
              if (nFlags & InsertDeleteFlags.VALUE) rColumn.SetCell(nDestRow, pF.GetErrCode() ? pF.Clone(new ScAddress(rColumn.nCol, nDestRow, rColumn.nTab), rColumn.rDoc) : pF.GetValue(), false);
            } else if (nFlags & InsertDeleteFlags.STRING) rColumn.SetCell(nDestRow, pF.GetString(), false);
          }
          return;
        }
        let pNew: ScCellData;
        if (p instanceof ScFormulaCell) pNew = p.Clone(new ScAddress(rColumn.nCol, nDestRow, rColumn.nTab), rColumn.rDoc);
        else if (p instanceof EditTextObject) pNew = p.Clone();
        else pNew = p;
        if (rColumn.rDoc.IsClipOrUndo()) rColumn.SetCellRaw(nDestRow, pNew);
        else rColumn.SetCell(nDestRow, pNew, false);
      });
    }
    if (nFlags & InsertDeleteFlags.NOTE) {
      for (const [nRow, n] of this.maNotes) if (nRow >= nRow1 && nRow <= nRow2) rColumn.maNotes.set(nRow + nRowOffset, { ...n });
    }
  }
}

/** SvNumberFormatter::IsCompatible */
export function IsCompatible(eOldType: SvNumFormatType, eNewType: SvNumFormatType): boolean {
  if (eOldType === eNewType) return true;
  if (eOldType === SvNumFormatType.DATE || eOldType === SvNumFormatType.TIME || eOldType === SvNumFormatType.DATETIME)
    return eNewType === SvNumFormatType.DATE || eNewType === SvNumFormatType.TIME || eNewType === SvNumFormatType.DATETIME;
  return false;
}

export { CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_EDIT };
