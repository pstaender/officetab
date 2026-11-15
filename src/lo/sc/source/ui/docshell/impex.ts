// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/impex.hxx partial
// @upstream sc/source/ui/docshell/impex.cxx partial
// @upstream sc/source/ui/docshell/docsh.cxx partial
// ScImportExport, the text (CSV) part: ExtText2Doc (the CSV import with ScAsciiOptions, with
// lcl_PutString's number, date and text handling), Text2Doc (tab separated text), Doc2Text
// (the clipboard text), ScanNextFieldFromString and ReadCsvLine (quotes, doubled quotes,
// embedded line breaks, broken quoting). From docsh.cxx ScDocShell::AsciiSave (the CSV export)
// and the CSV branches of ConvertFrom / ConvertTo, as ImportCSV and ExportCSV.
//
// Left out: SYLK, DIF, RTF and HTML, DDE links, ExportData and the byte string variants;
// undo (StartPaste / EndPaste only adjust row heights and repaint: the import into a range is
// not recorded), the editable check and the replace warning box; the progress bar. Streams are
// UTF-16 strings (ScImportStringStream, ScExportStringStream): decoding and encoding bytes is
// the caller's, so AsciiSave writes the text without the byte encoding passes and a BOM as
// U+FEFF. ScDocumentImport is the document itself. Dates in lcl_PutString use the month names
// of Intl.DateTimeFormat instead of the locale data's calendar, and the Gregorian calendar;
// CountVisualWidth uses a table of the wide East Asian ranges instead of ICU's property. The
// strict ISO 8601 check (sax::Converter::parseDateTime) is a regular expression; the number
// formatter reads only ISO dates without time, so date+time strings stay text.
import { ScAddress, ScRange, MAXCOLCOUNT, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE, ScRefCellValue, type CellType } from '../../../inc/cellvalue.ts';
import { ScSetStringParam, ScStringUtil, TextFormatPolicy } from '../../../inc/stringutil.ts';
import { ScGlobal } from '../../../inc/global.ts';
import type { SvxCellHorJustify } from '../../../inc/scitems.ts';
import { ScCellFormat } from '../../core/tool/cellform.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { ScDocShell } from './docsh.ts';
import { PaintPartFlags } from './docsh.ts';
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { DateToSerial, GetStandardFormat, GetType, IsNumberFormat, IsTextFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import type { SvTextStream } from '../../../../sfx2/source/doc/objstor.ts';
import { LanguageTypeToTag, LANGUAGE_ENGLISH_US, ScAsciiOptions, SC_COL_DMY, SC_COL_ENGLISH, SC_COL_MDY, SC_COL_SKIP, SC_COL_STANDARD, SC_COL_TEXT, SC_COL_YMD, TextEncodingToLabel, RTL_TEXTENCODING_UTF8 } from '../dbgui/asciiopt.ts';
import { ScImportOptions } from '../dbgui/imoptdlg.ts';

/** An out parameter (a C++ reference). */
interface Ref<T> { v: T }

// We don't want to end up with 2GB read in one line just because of malformed
// multiline fields, so chop it _somewhere_, which is twice supported columns
// times arbitrary maximum cell content length, 2*1024*64K=128M, and because
// it's sal_Unicode that's 256MB. If it's 2GB of data without LF we're out of
// luck anyway.
const nArbitraryCellLengthLimit = 0xFFFF; // SAL_MAX_UINT16
const nArbitraryLineLengthLimit = 2 * MAXCOLCOUNT * nArbitraryCellLengthLimit;

/** The character at an index of a 0-terminated string: '\0' at and past the end. */
const at = (s: string, i: number): string => (i < s.length ? s[i]! : '\0');

/** SotClipboardFormatId, the text formats. */
export const SotClipboardFormatId = { STRING: 1, STRING_TSVC: 2 } as const;
export type SotClipboardFormatId = (typeof SotClipboardFormatId)[keyof typeof SotClipboardFormatId];

/**
 * These options control how multi-line cells are converted during export in
 * certain lossy formats (such as csv).
 */
export const NewlineConversion = { ToSystem: 0, ToSpace: 1, None: 2 } as const;
export type NewlineConversion = (typeof NewlineConversion)[keyof typeof NewlineConversion];
export class ScExportTextOptions {
  meNewlineConversion: NewlineConversion;
  mcSeparatorConvertTo: string; // Convert separator to this character
  mbAddQuotes: boolean;
  constructor(eNewlineConversion: NewlineConversion = NewlineConversion.ToSystem, cSeparatorConvertTo = '', bAddQuotes = false) {
    this.meNewlineConversion = eNewlineConversion;
    this.mcSeparatorConvertTo = cSeparatorConvertTo;
    this.mbAddQuotes = bAddQuotes;
  }
}

// --- streams ------------------------------------------------------------------------------------

/**
 * Helper class for importing clipboard strings as streams: an SvMemoryStream of UTF-16 text,
 * reduced to what the text import reads (SvStream::ReadUniStringLine, StartReadingUnicodeText).
 * Positions are UTF-16 code units.
 */
export class ScImportStringStream implements SvTextStream {
  private readonly maStr: string;
  private mnPos = 0;
  private mbEof = false;

  constructor(rStr: string) {
    this.maStr = rStr;
  }

  Tell(): number { return this.mnPos; }
  Seek(nPos: number): number {
    this.mnPos = Math.max(0, Math.min(nPos, this.maStr.length));
    this.mbEof = false;
    return this.mnPos;
  }
  eof(): boolean { return this.mbEof; }
  remainingSize(): number { return this.maStr.length - this.mnPos; }

  /** Skip a byte order mark at the current position. */
  StartReadingUnicodeText(): void {
    if (this.maStr.charCodeAt(this.mnPos) === 0xFEFF) this.mnPos++;
  }

  /**
   * SvStream::ReadUniStringLine: a line up to CR, LF, CR LF or LF CR (NUL characters dropped);
   * null (and eof) when nothing was left to read.
   */
  ReadUniOrByteStringLine(nMaxCodepointsToRead = 0x7FFFFFFF): string | null {
    const s = this.maStr;
    const n = s.length;
    const nOldFilePos = this.mnPos;
    if (nOldFilePos >= n) {
      // exit on first BlockRead error
      this.mbEof = true;
      return null;
    }
    let i = nOldFilePos;
    let c = '';
    let bEnd = false;
    while (i < n) {
      if (i - nOldFilePos >= nMaxCodepointsToRead) {
        bEnd = true;
        break;
      }
      c = s[i]!;
      if (c === '\n' || c === '\r') {
        bEnd = true;
        break;
      }
      i++;
    }
    let aBuf = s.slice(nOldFilePos, i);
    if (aBuf.includes('\0')) aBuf = aBuf.split('\0').join('');

    if (!bEnd && aBuf.length > 0) bEnd = true;
    if (!bEnd) {
      this.mnPos = i;
      this.mbEof = true;
      return null;
    }

    let nPos = i;
    if (c === '\r' || c === '\n') {
      nPos++; // the line end
      // special treatment for DOS files
      if (nPos < n) {
        const cTemp = s[nPos]!;
        if (!(cTemp === c || (cTemp !== '\n' && cTemp !== '\r'))) nPos++;
      }
    }
    this.mnPos = nPos;
    this.mbEof = false;
    return aBuf;
  }
}

/** Not upstream: the SvMemoryStream text is exported to, as a string. */
export class ScExportStringStream {
  private maParts: string[] = [];
  private mnLen = 0;

  WriteUnicodeOrByteText(rStr: string): this {
    this.maParts.push(rStr);
    this.mnLen += rStr.length;
    return this;
  }
  WriteUniOrByteChar(c: string): this { return this.WriteUnicodeOrByteText(c); }
  /** endlub: the system line end (LF). */
  endlub(): this { return this.WriteUnicodeOrByteText('\n'); }
  Tell(): number { return this.mnLen; }
  GetError(): number { return 0; }
  GetString(): string { return this.maParts.join(''); }
}

// --- ScImportExport -----------------------------------------------------------------------------

export class ScImportExport {
  private pDocSh: ScDocShell | null;
  private rDoc: ScDocument;
  private aRange: ScRange;
  private nSizeLimit = 0;
  private nMaxImportRow: SCROW;
  private cSep = '\t'; // Separator
  private cStr = '"'; // String Delimiter
  private bFormulas = false; // Formula in Text?
  private bIncludeFiltered = true; // include filtered rows? (default true)
  private bAll: boolean; // no selection
  private bSingle: boolean; // Single selection
  private bUndo: boolean; // with Undo?
  private bOverflowRow = false; // too many rows
  private bOverflowCol = false; // too many columns
  private bOverflowCell = false; // too much data for a cell
  private mbApi = true;
  private mbImportBroadcast = false; // whether or not to broadcast after data import.
  private mbOverwriting = false; // Whether we could be overwriting existing values (paste).
  // In this case we cannot use the insert optimization, but we
  // do not need to broadcast after the import.
  private mbIncludeBOM = false; // Whether to include a byte-order-mark in the output.
  private mExportTextOptions = new ScExportTextOptions();

  private pExtOptions: ScAsciiOptions | null = null; // extended options

  /**
   * ScImportExport(rDoc): the whole document without Undo; ScImportExport(rDoc, rPt): insert at
   * the current cell; ScImportExport(rDoc, rRange): a range (only used for export). Not upstream:
   * the document shell is passed, as the document does not know it.
   */
  constructor(r: ScDocument, rPos?: ScAddress | ScRange, pDocSh: ScDocShell | null = null) {
    this.pDocSh = pDocSh;
    this.rDoc = r;
    this.nMaxImportRow = this.rDoc.MaxRow();
    if (rPos === undefined) {
      // Whole document without Undo
      this.aRange = new ScRange();
      this.bAll = true;
      this.bSingle = true;
      this.bUndo = false;
    } else if (rPos instanceof ScAddress) {
      // Insert am current cell without range(es)
      this.aRange = new ScRange(rPos);
      this.bAll = false;
      this.bSingle = true;
      this.bUndo = this.pDocSh !== null;
    } else {
      //  ctor with a range is only used for export
      this.aRange = rPos.clone();
      this.bAll = false;
      this.bSingle = false;
      this.bUndo = this.pDocSh !== null;
      // Only one sheet (table) supported
      this.aRange.aEnd.SetTab(this.aRange.aStart.Tab());
    }
  }

  SetExtOptions(rOpt: ScAsciiOptions): void {
    this.pExtOptions = rOpt.Clone();

    //  "normal" Options

    this.cSep = ScAsciiOptions.GetWeightedFieldSep(rOpt.GetFieldSeps(), false);
    this.cStr = rOpt.GetTextSep();
  }

  IsRef(): boolean { return !this.bAll; }
  GetRange(): ScRange { return this.aRange; }

  static IsFormatSupported(nFormat: number): boolean {
    return nFormat === SotClipboardFormatId.STRING || nFormat === SotClipboardFormatId.STRING_TSVC;
  }

  SetSeparator(c: string): void { this.cSep = c; }
  SetDelimiter(c: string): void { this.cStr = c; }
  SetFormulas(b: boolean): void { this.bFormulas = b; }
  SetIncludeFiltered(b: boolean): void { this.bIncludeFiltered = b; }
  SetSizeLimit(nNew: number): void { this.nSizeLimit = nNew; }

  // after import
  IsOverflowRow(): boolean { return this.bOverflowRow; }
  IsOverflowCol(): boolean { return this.bOverflowCol; }
  IsOverflowCell(): boolean { return this.bOverflowCell; }
  IsOverflow(): boolean { return this.bOverflowRow || this.bOverflowCol || this.bOverflowCell; }

  SetApi(bApi: boolean): void { this.mbApi = bApi; }
  SetImportBroadcast(b: boolean): void { this.mbImportBroadcast = b; }
  SetOverwriting(bOverwriting: boolean): void { this.mbOverwriting = bOverwriting; }
  SetExportTextOptions(options: ScExportTextOptions): void { this.mExportTextOptions = options; }
  GetIncludeBOM(): boolean { return this.mbIncludeBOM; }

  // Prepare for Undo (reduced: there is no undo of the import, see the header)
  private StartPaste(): boolean {
    return true;
  }

  // Create Undo/Redo actions, Invalidate/Repaint
  private EndPaste(bAutoRowHeight = true): void {
    const bHeight = bAutoRowHeight && this.pDocSh !== null && this.pDocSh.AdjustRowHeight(this.aRange.aStart.Row(), this.aRange.aEnd.Row(), this.aRange.aStart.Tab());

    if (this.pDocSh) {
      if (!bHeight) this.pDocSh.PostPaint(this.aRange, PaintPartFlags.Grid);
      this.pDocSh.SetDocumentModified();
    }
  }

  ImportString(rText: string, nFmt: SotClipboardFormatId): boolean {
    // formats supporting unicode
    const aStrm = new ScImportStringStream(rText);
    return this.ImportStream(aStrm, '', nFmt);
    // ImportStream must handle RTL_TEXTENCODING_UNICODE
  }

  ExportString(nFmt: SotClipboardFormatId): string | null {
    //  nSizeLimit not needed for OUString

    const aStrm = new ScExportStringStream();
    // mba: no BaseURL for data exc
    if (this.ExportStream(aStrm, '', nFmt)) {
      return aStrm.GetString();
    }
    return null;

    // ExportStream must handle RTL_TEXTENCODING_UNICODE
  }

  ImportStream(rStrm: ScImportStringStream, rBaseURL: string, nFmt: SotClipboardFormatId): boolean {
    void rBaseURL;
    if (nFmt === SotClipboardFormatId.STRING || nFmt === SotClipboardFormatId.STRING_TSVC) {
      if (this.ExtText2Doc(rStrm)) // evaluate pExtOptions
        return true;
    }
    return false;
  }

  ExportStream(rStrm: ScExportStringStream, rBaseURL: string, nFmt: SotClipboardFormatId): boolean {
    void rBaseURL;
    if (nFmt === SotClipboardFormatId.STRING || nFmt === SotClipboardFormatId.STRING_TSVC) {
      if (this.Doc2Text(rStrm)) return true;
    }
    return false;
  }

  // tdf#104927
  // http://www.unicode.org/reports/tr11/
  /** CountVisualWidth(rStr, nIdx, nMaxWidth): the width of the string from nIdx (advanced) up to
      nMaxWidth, CJK ideographs and symbols counting twice; CountVisualWidth(rStr) the whole width. */
  static CountVisualWidth(rStr: string, nIdx: Ref<number> = { v: 0 }, nMaxWidth = 0x7FFFFFFF): number {
    let nWidth = 0;
    while (nIdx.v < rStr.length && nWidth < nMaxWidth) {
      const nCode = rStr.codePointAt(nIdx.v)!;
      nIdx.v += nCode > 0xFFFF ? 2 : 1;

      if (lcl_isWide(nCode)) nWidth += 2;
      else if (!lcl_isDefaultIgnorable(nCode)) nWidth += 1;
    }

    if (nIdx.v < rStr.length) {
      const nCode = rStr.codePointAt(nIdx.v)!;
      if (lcl_isDefaultIgnorable(nCode)) nIdx.v += nCode > 0xFFFF ? 2 : 1;
    }
    return nWidth;
  }

  Text2Doc(rStrm: ScImportStringStream): boolean {
    let bOk = true;

    const pSeps = this.cSep;

    const aSetStringParam = new ScSetStringParam();
    aSetStringParam.mbCheckLinkFormula = true;

    const nStartCol = this.aRange.aStart.Col();
    const nStartRow = this.aRange.aStart.Row();
    let nEndCol = this.aRange.aEnd.Col();
    let nEndRow = this.aRange.aEnd.Row();
    const nOldPos = rStrm.Tell();
    rStrm.StartReadingUnicodeText();
    let bData = !this.bSingle;
    if (!this.bSingle) bOk = this.StartPaste();

    while (bOk) {
      let aLine: string;
      const aCell: Ref<string> = { v: '' };
      let nRow = nStartRow;
      const rbOverflowCell: Ref<boolean> = { v: this.bOverflowCell };
      rStrm.Seek(nOldPos);
      for (;;) {
        aLine = rStrm.ReadUniOrByteStringLine(nArbitraryLineLengthLimit) ?? '';
        // tdf#125440 When inserting tab separated string, consider quotes as field markers
        const mode = aLine.includes('\t') ? DoubledQuoteMode.ESCAPE : DoubledQuoteMode.KEEP_ALL;
        if (rStrm.eof()) break;
        let nCol = nStartCol;
        let p = 0;
        while (at(aLine, p) !== '\0') {
          aCell.v = '';
          let q = p;
          if (at(aLine, p) === this.cStr) {
            // Look for a pairing quote.
            q = p = lcl_ScanString(aLine, p, aCell, pSeps, this.cStr, mode, rbOverflowCell);
          }
          // All until next separator.
          while (at(aLine, p) !== '\0' && at(aLine, p) !== this.cSep) ++p;
          if (!lcl_appendLineData(aCell, aLine, q, p)) this.bOverflowCell = true; // display warning on import
          if (at(aLine, p) !== '\0') ++p;
          if (this.rDoc.ValidCol(nCol) && this.rDoc.ValidRow(nRow)) {
            if (this.bSingle) {
              if (nCol > nEndCol) nEndCol = nCol;
              if (nRow > nEndRow) nEndRow = nRow;
            }
            if (bData && nCol <= nEndCol && nRow <= nEndRow) this.rDoc.SetString(nCol, nRow, this.aRange.aStart.Tab(), aCell.v, aSetStringParam);
          } else {
            // too many columns/rows
            if (!this.rDoc.ValidRow(nRow)) this.bOverflowRow = true; // display warning on import
            if (!this.rDoc.ValidCol(nCol)) this.bOverflowCol = true; // display warning on import
          }
          ++nCol;
        }
        ++nRow;
      }
      this.bOverflowCell = rbOverflowCell.v;

      if (!bData) {
        this.aRange.aEnd.SetCol(nEndCol);
        this.aRange.aEnd.SetRow(nEndRow);
        bOk = this.StartPaste();
        bData = true;
      } else break;
    }

    this.EndPaste();
    if (bOk && this.mbImportBroadcast) {
      this.pDocSh?.PostDataChanged();
    }

    return bOk;
  }

  ExtText2Doc(rStrm: ScImportStringStream): boolean {
    if (!this.pExtOptions) return this.Text2Doc(rStrm);
    const pExtOptions = this.pExtOptions;

    const nOldPos = rStrm.Tell();
    rStrm.StartReadingUnicodeText();
    // tdf#82254 - check whether to include a byte-order-mark in the output
    if (nOldPos !== rStrm.Tell()) this.mbIncludeBOM = true;

    const nStartCol = this.aRange.aStart.Col();
    let nEndCol = this.aRange.aEnd.Col();
    const nStartRow = this.aRange.aStart.Row();
    const nTab = this.aRange.aStart.Tab();

    const bFixed = pExtOptions.IsFixedLen();
    const aSeps: Ref<string> = { v: pExtOptions.GetFieldSeps() }; // Need non-const for ReadCsvLine(),
    const pSeps = aSeps.v; // but it will be const anyway (asserted below).
    const bMerge = pExtOptions.IsMergeSeps();
    const bRemoveSpace = pExtOptions.IsRemoveSpace();
    const nInfoCount = pExtOptions.GetInfoCount();
    const pColStart = pExtOptions.GetColStart();
    const pColFormat = pExtOptions.GetColFormat();
    let nSkipLines = pExtOptions.GetStartRow();

    const eDocLang = pExtOptions.GetLanguage();
    const aNumFormatter = LanguageTypeToTag(eDocLang);
    const bDetectNumFormat = pExtOptions.IsDetectSpecialNumber();
    const bDetectSciNumFormat = pExtOptions.IsDetectScientificNumber();
    const bEvaluateFormulas = pExtOptions.IsEvaluateFormulas();
    const bSkipEmptyCells = pExtOptions.IsSkipEmptyCells();

    // For date recognition
    const aCalendar = new lcl_Calendar(aNumFormatter);
    let pEnglishCalendar: lcl_Calendar | null = null;
    if (eDocLang !== LANGUAGE_ENGLISH_US) {
      pEnglishCalendar = new lcl_Calendar('en-US');
    }

    let aLine: string;
    const aCell: Ref<string> = { v: '' };
    let i: number;
    let nRow = nStartRow;
    const cDetectSep: Ref<string> = { v: '￿' }; // No separator detection here.

    while (--nSkipLines > 0) {
      aLine = ReadCsvLine(rStrm, !bFixed, aSeps, this.cStr, cDetectSep); // content is ignored
      if (rStrm.eof()) break;
    }

    // Determine range for Undo.
    // We don't need this during import of a file to a new sheet or document...
    let bDetermineRange = this.bUndo;
    let bColumnsAreDetermined = false;

    // Row heights don't need to be adjusted on the fly if EndPaste() is called
    // afterwards, which happens only if bDetermineRange. This variable also
    // survives the toggle of bDetermineRange down at the end of the do{} loop.
    const bRangeIsDetermined = bDetermineRange;

    const bQuotedAsText = pExtOptions.IsQuotedAsText();

    const nOriginalStreamPos = rStrm.Tell();

    let nFirstUpdateRowHeight = Number.MAX_SAFE_INTEGER;
    let nLastUpdateRowHeight = -1;

    const rDoc = this.rDoc;
    const bOverflowCell: Ref<boolean> = { v: this.bOverflowCell };
    do {
      const nLastCol = nEndCol; // tdf#129701 preserve value of nEndCol
      for (;;) {
        aLine = ReadCsvLine(rStrm, !bFixed, aSeps, this.cStr, cDetectSep);
        if (rStrm.eof() && aLine.length === 0) break;

        if (pSeps !== aSeps.v) throw new Error('ScImportExport::ExtText2Doc: separators changed');

        if (nRow > rDoc.MaxRow()) {
          this.bOverflowRow = true; // display warning on import
          break; // for
        }

        if (!bDetermineRange) aLine = ScImportExport.EmbeddedNullTreatment(aLine);

        const nLineLen = aLine.length;
        let nCol = nStartCol;
        let bMultiLine = false;
        if (bFixed) {
          //  Fixed line length
          if (bDetermineRange) {
            if (!bColumnsAreDetermined) {
              // Yes, the check is nCol<=rDoc.MaxCol()+1, +1 because it
              // is only an overflow if there is really data following to
              // be put behind the last column, which doesn't happen if
              // info is SC_COL_SKIP.
              for (i = 0; i < nInfoCount && nCol <= rDoc.MaxCol() + 1; ++i) {
                const nFmt = pColFormat[i]!;
                if (nFmt !== SC_COL_SKIP) {
                  // otherwise don't increment nCol either
                  if (nCol > rDoc.MaxCol()) this.bOverflowCol = true; // display warning on import
                  ++nCol;
                }
              }
              bColumnsAreDetermined = true;
            }
          } else {
            let nStartIdx = 0;
            // Same maxcol+1 check reason as above.
            for (i = 0; i < nInfoCount && nCol <= rDoc.MaxCol() + 1; ++i) {
              const nNextIdx: Ref<number> = { v: nStartIdx };
              if (i + 1 < nInfoCount) ScImportExport.CountVisualWidth(aLine, nNextIdx, pColStart[i + 1]! - pColStart[i]!);
              else nNextIdx.v = nLineLen;
              let nFmt = pColFormat[i]!;
              if (nFmt !== SC_COL_SKIP) {
                // otherwise don't increment nCol either
                if (nCol > rDoc.MaxCol()) this.bOverflowCol = true; // display warning on import
                else {
                  const bIsQuoted: Ref<boolean> = { v: false };
                  aCell.v = lcl_GetFixed(aLine, nStartIdx, nNextIdx.v, bIsQuoted, bOverflowCell);
                  if (bIsQuoted.v && bQuotedAsText) nFmt = SC_COL_TEXT;

                  bMultiLine = lcl_PutString(rDoc, !this.mbOverwriting, nCol, nRow, nTab, aCell.v, nFmt, aNumFormatter, bDetectNumFormat, bDetectSciNumFormat, bEvaluateFormulas, bSkipEmptyCells, aCalendar, pEnglishCalendar) || bMultiLine;
                }
                ++nCol;
              }
              nStartIdx = nNextIdx.v;
            }
          }
        } else {
          // Search for the separator
          let nSourceCol = 0;
          let nInfoStart = 0;
          let p = 0;
          // tdf#129701 if there is only one column, and user wants to treat empty cells,
          // we need to detect *p = null
          let bIsLastColEmpty = at(aLine, p) === '\0' && !bSkipEmptyCells && !bDetermineRange;
          // Yes, the check is nCol<=rDoc.MaxCol()+1, +1 because it is only an
          // overflow if there is really data following to be put behind
          // the last column, which doesn't happen if info is
          // SC_COL_SKIP.
          while ((at(aLine, p) !== '\0' || bIsLastColEmpty) && nCol <= rDoc.MaxCol() + 1) {
            const bIsQuoted: Ref<boolean> = { v: false };
            p = ScImportExport.ScanNextFieldFromString(aLine, p, aCell, this.cStr, pSeps, bMerge, bIsQuoted, bOverflowCell, bRemoveSpace);
            // some dodgy CSVs have a trailing linefeed in each token, which will
            // make the code think that we have a multi-line field, which will slow things down a lot.
            if (aCell.v.endsWith('\n')) aCell.v = aCell.v.slice(0, aCell.v.length - 1);

            let nFmt = SC_COL_STANDARD;
            for (i = nInfoStart; i < nInfoCount; i++) {
              if (pColStart[i] === nSourceCol + 1) {
                // pColStart is 1-based
                nFmt = pColFormat[i]!;
                nInfoStart = i + 1; // ColInfos are in succession
                break; // for
              }
            }
            if (nFmt !== SC_COL_SKIP) {
              if (nCol > rDoc.MaxCol()) this.bOverflowCol = true; // display warning on import
              else if (!bDetermineRange) {
                if (bIsQuoted.v && bQuotedAsText) nFmt = SC_COL_TEXT;

                bMultiLine = lcl_PutString(rDoc, !this.mbOverwriting, nCol, nRow, nTab, aCell.v, nFmt, aNumFormatter, bDetectNumFormat, bDetectSciNumFormat, bEvaluateFormulas, bSkipEmptyCells, aCalendar, pEnglishCalendar) || bMultiLine;
              }
              ++nCol;
              if (bIsLastColEmpty) {
                bIsLastColEmpty = false; // toggle to stop
              } else {
                // tdf#129701 detect if there is a last empty column when we need it
                bIsLastColEmpty = nCol === nLastCol && at(aLine, p) === '\0' && !bSkipEmptyCells && !bDetermineRange;
              }
            }
            ++nSourceCol;
          }
        }
        if (nEndCol < nCol) nEndCol = nCol; //! points to the next free or even rDoc.MaxCol()+2

        if (!bDetermineRange) {
          if (bMultiLine && !bRangeIsDetermined && this.pDocSh) {
            // Adjust just once at the end for a whole range.
            nFirstUpdateRowHeight = Math.min(nFirstUpdateRowHeight, nRow);
            nLastUpdateRowHeight = Math.max(nLastUpdateRowHeight, nRow);
          }
        }
        ++nRow;
      }
      // so far nRow/nEndCol pointed to the next free
      if (nRow > nStartRow) --nRow;
      if (nEndCol > nStartCol) nEndCol = Math.min(nEndCol - 1, rDoc.MaxCol());

      if (bDetermineRange) {
        this.aRange.aEnd.SetCol(nEndCol);
        this.aRange.aEnd.SetRow(nRow);

        // (the replace warning box of !mbApi is left out)

        rStrm.Seek(nOriginalStreamPos);
        nRow = nStartRow;
        if (!this.StartPaste()) {
          this.EndPaste(false);
          return false;
        }
      }

      bDetermineRange = !bDetermineRange; // toggle
    } while (!bDetermineRange);
    this.bOverflowCell = bOverflowCell.v;

    if (nFirstUpdateRowHeight < nLastUpdateRowHeight && this.pDocSh) this.pDocSh.AdjustRowHeight(nFirstUpdateRowHeight, nLastUpdateRowHeight, nTab);

    if (bRangeIsDetermined) this.EndPaste(false);

    if (this.mbImportBroadcast && !this.mbOverwriting) {
      this.pDocSh?.PostDataChanged();
    }
    return true;
  }

  /** Strip NUL characters (returns the string instead of changing it in place). */
  static EmbeddedNullTreatment(rStr: string): string {
    // A nasty workaround for data with embedded NULL characters. As long as we
    // can't handle them properly as cell content (things assume 0-terminated
    // strings at too many places) simply strip all NULL characters from raw
    // data. Excel does the same. See fdo#57841 for sample data.

    // The normal case is no embedded NULL, check first before de-/allocating
    // ustring stuff.
    if (rStr.includes('\0')) {
      return rStr.split('\0').join('');
    }
    return rStr;
  }

  /**
   * The next field of a line from index p: its content in rField, whether it was quoted, and
   * the index after it (and its separator). cStr '' is no quote character.
   */
  static ScanNextFieldFromString(s: string, p: number, rField: Ref<string>, cStr: string, pSeps: string, bMergeSeps: boolean, rbIsQuoted: Ref<boolean>, rbOverflowCell: Ref<boolean>, bRemoveSpace: boolean): number {
    rbIsQuoted.v = false;
    rField.v = '';
    const cBlank = ' ';
    if (cStr && !UnicodeStrChr(pSeps, cBlank)) {
      // Cope with broken generators that put leading blanks before a quoted
      // field, like "field1", "field2", "..."
      // NOTE: this is not in conformance with http://tools.ietf.org/html/rfc4180
      let pb = p;
      while (at(s, pb) === cBlank) ++pb;
      if (at(s, pb) === cStr) p = pb;
    }
    if (cStr && at(s, p) === cStr) {
      // String in quotes
      rbIsQuoted.v = true;
      let p1: number;
      p1 = p = lcl_ScanString(s, p, rField, pSeps, cStr, DoubledQuoteMode.ESCAPE, rbOverflowCell);
      while (!lcl_isFieldEnd(at(s, p), pSeps)) p++;
      // Append remaining unquoted and undelimited data (dirty, dirty) to
      // this field.
      if (p > p1) {
        let ptrim_f = p;
        if (bRemoveSpace) {
          while (ptrim_f > p1 && at(s, ptrim_f - 1) === cBlank) --ptrim_f;
        }
        if (!lcl_appendLineData(rField, s, p1, ptrim_f)) rbOverflowCell.v = true;
      }
      if (at(s, p) !== '\0') p++;
    } else {
      // up to delimiter
      const p0 = p;
      while (!lcl_isFieldEnd(at(s, p), pSeps)) p++;
      let ptrim_i = p0;
      let ptrim_f = p; // [ptrim_i,ptrim_f) is cell data after trimming
      if (bRemoveSpace) {
        while (ptrim_i < ptrim_f && at(s, ptrim_i) === cBlank) ++ptrim_i;
        while (ptrim_f > ptrim_i && at(s, ptrim_f - 1) === cBlank) --ptrim_f;
      }
      if (!lcl_appendLineData(rField, s, ptrim_i, ptrim_f)) rbOverflowCell.v = true;
      if (at(s, p) !== '\0') p++;
    }
    if (bMergeSeps) {
      // skip following delimiters
      while (at(s, p) !== '\0' && UnicodeStrChr(pSeps, at(s, p))) p++;
    }
    return p;
  }

  Doc2Text(rStrm: ScExportStringStream): boolean {
    let nCol: SCCOL;
    let nRow: SCROW;
    let nStartCol = this.aRange.aStart.Col();
    let nStartRow = this.aRange.aStart.Row();
    const nStartTab = this.aRange.aStart.Tab();
    let nEndCol = this.aRange.aEnd.Col();
    let nEndRow = this.aRange.aEnd.Row();
    const nEndTab = this.aRange.aEnd.Tab();

    if (nStartTab === nEndTab) {
      const r = lcl_ShrinkToDataArea(this.rDoc, nStartTab, nStartCol, nStartRow, nEndCol, nEndRow);
      if (!r) return false;
      ({ nStartCol, nStartRow, nEndCol, nEndRow } = r);
    }

    let aCellStr: string;

    const bConvertLF = false; // (GetSystemLineEnd() != LINEEND_LF)

    for (nRow = nStartRow; nRow <= nEndRow; nRow++) {
      if (this.bIncludeFiltered || !this.rDoc.RowFiltered(nRow, nStartTab)) {
        for (nCol = nStartCol; nCol <= nEndCol; nCol++) {
          const aPos = new ScAddress(nCol, nRow, nStartTab);
          const nNumFmt = this.rDoc.GetNumberFormat(aPos);
          const eLang = this.rDoc.GetAttr(nCol, nRow, nStartTab, 'ATTR_LANGUAGE_FORMAT') || 'en-US';

          const aCell = this.rDoc.GetRefCellValue(aPos);
          switch (aCell.getType()) {
            case CELLTYPE_FORMULA: {
              if (this.bFormulas) {
                aCellStr = aCell.getFormula()!.GetFormula();
                if (this.cSep && aCellStr.includes(this.cSep)) rStrm.WriteUnicodeOrByteText(lcl_WriteString(aCellStr, this.cStr, this.cStr));
                else rStrm.WriteUnicodeOrByteText(aCellStr);
              } else {
                aCellStr = ScCellFormat.GetString(aCell, nNumFmt, eLang).aString;

                const bMultiLineText = aCellStr.includes('\n');
                if (bMultiLineText) {
                  if (this.mExportTextOptions.meNewlineConversion === NewlineConversion.ToSpace) aCellStr = aCellStr.replaceAll('\n', ' ');
                  else if (this.mExportTextOptions.meNewlineConversion === NewlineConversion.ToSystem && bConvertLF) aCellStr = aCellStr.replaceAll('\n', '\r\n');
                }

                if (this.mExportTextOptions.mcSeparatorConvertTo && this.cSep) aCellStr = aCellStr.replaceAll(this.cSep, this.mExportTextOptions.mcSeparatorConvertTo);

                if (this.mExportTextOptions.mbAddQuotes && this.cSep && aCellStr.includes(this.cSep)) rStrm.WriteUnicodeOrByteText(lcl_WriteString(aCellStr, this.cStr, this.cStr));
                else rStrm.WriteUnicodeOrByteText(aCellStr);
              }
              break;
            }
            case CELLTYPE_VALUE: {
              aCellStr = ScCellFormat.GetString(aCell, nNumFmt, eLang).aString;
              rStrm.WriteUnicodeOrByteText(aCellStr);
              break;
            }
            case CELLTYPE_NONE:
              break;
            default: {
              aCellStr = ScCellFormat.GetString(aCell, nNumFmt, eLang).aString;

              const bMultiLineText = aCellStr.includes('\n');
              if (bMultiLineText) {
                if (this.mExportTextOptions.meNewlineConversion === NewlineConversion.ToSpace) aCellStr = aCellStr.replaceAll('\n', ' ');
                else if (this.mExportTextOptions.meNewlineConversion === NewlineConversion.ToSystem && bConvertLF) aCellStr = aCellStr.replaceAll('\n', '\r\n');
              }

              if (this.mExportTextOptions.mcSeparatorConvertTo && this.cSep) aCellStr = aCellStr.replaceAll(this.cSep, this.mExportTextOptions.mcSeparatorConvertTo);

              if (this.mExportTextOptions.mbAddQuotes && hasLineBreaksOrSeps(aCellStr, this.cSep)) rStrm.WriteUnicodeOrByteText(lcl_WriteString(aCellStr, this.cStr, this.cStr));
              else rStrm.WriteUnicodeOrByteText(aCellStr);
            }
          }
          if (nCol < nEndCol) rStrm.WriteUnicodeOrByteText(this.cSep);
        }
        // Do not append a line feed for one single cell.
        // NOTE: this Doc2Text() is only called for clipboard via
        // ScImportExport::ExportStream().
        if (nStartRow !== nEndRow || nStartCol !== nEndCol) rStrm.endlub();
        if (rStrm.GetError() !== 0) break;
        if (this.nSizeLimit && rStrm.Tell() > this.nSizeLimit) break;
      }
    }

    return rStrm.GetError() === 0;
  }
}

/** ScDocument::ShrinkToDataArea, reduced: the part of the range within the sheet's data area. */
function lcl_ShrinkToDataArea(rDoc: ScDocument, nTab: SCTAB, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): { nStartCol: SCCOL; nStartRow: SCROW; nEndCol: SCCOL; nEndRow: SCROW } | null {
  const aEnd = rDoc.GetCellArea(nTab);
  const aStart = rDoc.GetDataStart(nTab);
  if (!aEnd.bFound || !aStart.bFound) return null;
  if (nStartCol > aEnd.nEndCol || nStartRow > aEnd.nEndRow || nEndCol < aStart.nStartCol || nEndRow < aStart.nStartRow) return null;
  return {
    nStartCol: Math.max(nStartCol, aStart.nStartCol),
    nStartRow: Math.max(nStartRow, aStart.nStartRow),
    nEndCol: Math.min(nEndCol, aEnd.nEndCol),
    nEndRow: Math.min(nEndRow, aEnd.nEndRow),
  };
}

/** The wide and fullwidth ranges of UAX #11 (u_getIntPropertyValue(UCHAR_EAST_ASIAN_WIDTH)). */
function lcl_isWide(c: number): boolean {
  return (c >= 0x1100 && c <= 0x115F) || (c >= 0x231A && c <= 0x231B) || (c >= 0x2329 && c <= 0x232A) ||
    (c >= 0x2E80 && c <= 0x303E) || (c >= 0x3041 && c <= 0x33FF) || (c >= 0x3400 && c <= 0x4DBF) ||
    (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xA000 && c <= 0xA4CF) || (c >= 0xA960 && c <= 0xA97F) ||
    (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE10 && c <= 0xFE19) ||
    (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6) ||
    (c >= 0x1F300 && c <= 0x1F64F) || (c >= 0x1F900 && c <= 0x1F9FF) || (c >= 0x20000 && c <= 0x3FFFD);
}
const rDefaultIgnorable = /^\p{Default_Ignorable_Code_Point}$/u;
function lcl_isDefaultIgnorable(c: number): boolean {
  return rDefaultIgnorable.test(String.fromCodePoint(c));
}

/** ScGlobal::UnicodeStrChr: whether c (not NUL) is one of the characters. */
function UnicodeStrChr(pStr: string, c: string): boolean {
  return c !== '\0' && pStr.includes(c);
}

function lcl_isFieldEnd(c: string, pSeps: string): boolean {
  return c === '\0' || UnicodeStrChr(pSeps, c);
}

const QuoteType = {
  FIELDSTART_QUOTE: 0,
  FIRST_QUOTE: 1,
  SECOND_QUOTE: 2,
  FIELDEND_QUOTE: 3,
  DONTKNOW_QUOTE: 4,
} as const;
type QuoteType = (typeof QuoteType)[keyof typeof QuoteType];

/** Determine if *p is a quote that ends a quoted field.

    Precondition: we are parsing a quoted field already and *p is a quote.

    rcDetectSep '\0' detects a separator, '￿' does not.

    @return
        FIELDEND_QUOTE if end of field quote
        DONTKNOW_QUOTE anything else
 */
function lcl_isFieldEndQuote(s: string, p: number, pSeps: string, rcDetectSep: Ref<string>): QuoteType {
  // Due to broken CSV generators that don't double embedded quotes check if
  // a field separator immediately or with trailing spaces follows the quote,
  // only then end the field, or at end of string.
  const cBlank = ' ';
  if (at(s, p + 1) === cBlank && UnicodeStrChr(pSeps, cBlank)) return QuoteType.FIELDEND_QUOTE;
  // Detect a possible blank separator if it's not already in the list (which
  // was checked right above for p[1]==cBlank).
  const bBlankSep = at(s, p + 1) === cBlank && rcDetectSep.v === '\0' && at(s, p + 2) !== '\0' && at(s, p + 2) !== cBlank;
  while (at(s, p + 1) === cBlank) ++p;
  if (lcl_isFieldEnd(at(s, p + 1), pSeps)) return QuoteType.FIELDEND_QUOTE;
  // Extended separator detection after a closing quote (with or without
  // blanks). Note that nQuotes is incremented *after* the call so is not yet
  // even here, and that with separator detection we reach here only if
  // lcl_isEscapedOrFieldEndQuote() did not already detect FIRST_QUOTE or
  // SECOND_QUOTE for an escaped embedded quote, thus nQuotes does not have
  // to be checked.
  if (rcDetectSep.v === '\0') {
    const vSep = [',', '\t', ';'];
    for (const c of vSep) {
      if (at(s, p + 1) === c) {
        rcDetectSep.v = c;
        return QuoteType.FIELDEND_QUOTE;
      }
    }
  }
  // Blank separator is least significant, after others.
  if (bBlankSep) {
    rcDetectSep.v = cBlank;
    return QuoteType.FIELDEND_QUOTE;
  }
  return QuoteType.DONTKNOW_QUOTE;
}

/** Determine if *p is a quote that is escaped by being doubled or ends a
    quoted field.

    Precondition: *p is a quote.

    @param nQuotes
        Quote characters encountered so far.
        Odd (after opening quote) means either no embedded quotes or only quote
        pairs so far.
        Even means either not in a quoted field or already one quote
        encountered, the first of a pair.

    @return
        FIELDSTART_QUOTE if first quote in a field, either starting content or
                            embedded so caller should check beforehand.
        FIRST_QUOTE      if first of a doubled quote
        SECOND_QUOTE     if second of a doubled quote
        FIELDEND_QUOTE   if end of field quote
        DONTKNOW_QUOTE   if an unescaped quote we don't consider as end of field,
                            do not increment nQuotes in caller then!
 */
function lcl_isEscapedOrFieldEndQuote(nQuotes: number, s: string, p: number, pSeps: string, cStr: string, rcDetectSep: Ref<string>): QuoteType {
  if ((nQuotes & 1) === 0) {
    if (at(s, p - 1) === cStr) return QuoteType.SECOND_QUOTE;
    else {
      // lcl_isEscapedOrFieldEndQuote: really want a FIELDSTART_QUOTE?
      return QuoteType.FIELDSTART_QUOTE;
    }
  }
  if (at(s, p + 1) === cStr) return QuoteType.FIRST_QUOTE;
  return lcl_isFieldEndQuote(s, p, pSeps, rcDetectSep);
}

/** Append characters of [p1,p2) to rField.

    @returns TRUE if ok; FALSE if data overflow, truncated
 */
function lcl_appendLineData(rField: Ref<string>, s: string, p1: number, p2: number): boolean {
  if (rField.v.length + (p2 - p1) <= nArbitraryCellLengthLimit) {
    rField.v += s.slice(p1, p2);
    return true;
  } else {
    // lcl_appendLineData: data overflow
    rField.v += s.slice(p1, p1 + nArbitraryCellLengthLimit - rField.v.length);
    return false;
  }
}

const DoubledQuoteMode = {
  KEEP_ALL: 0, // both are taken, additionally start and end quote are included in string
  ESCAPE: 1, // escaped quote, one is taken, one ignored
} as const;
type DoubledQuoteMode = (typeof DoubledQuoteMode)[keyof typeof DoubledQuoteMode];

/** Scan for a quoted string.

    Precondition: initial current position *p is a cStr quote.

    For DoubledQuoteMode::ESCAPE, if after the closing quote there is a field
    end (with or without trailing blanks and as determined by
    lcl_isFieldEndQuote()), then the content is appended to rField with quotes
    processed and removed. Else if no field end after the quoted string was
    detected, nothing is appended and processing continues and is repeated
    until the next quote. If no closing quote at a field end was found at all,
    nothing is appended and the initial position is returned and caller has to
    decide, usually just taking all as literal data.

    For DoubledQuoteMode::KEEP_ALL, the string up to and including the closing
    quote is appended to rField and the next position returned, regardless
    whether there is a field separator following or not.

 */
function lcl_ScanString(s: string, p: number, rField: Ref<string>, pSeps: string, cStr: string, eMode: DoubledQuoteMode, rbOverflowCell: Ref<boolean>): number {
  const aString: Ref<string> = { v: '' };
  let bClosingQuote = eMode === DoubledQuoteMode.KEEP_ALL;
  const pStart = p;
  if (eMode !== DoubledQuoteMode.KEEP_ALL) p++; //! jump over opening quote
  let bCont: boolean;
  do {
    bCont = false;
    const p0 = p;
    for (;;) {
      if (at(s, p) === '\0') {
        // Encountering end of data after an opening quote is not a
        // quoted string, ReadCsvLine() concatenated lines with '\n'
        // for a properly quoted embedded linefeed.
        if (eMode === DoubledQuoteMode.KEEP_ALL)
          // Caller would append that data anyway, so we can do it
          // already here.
          break;

        return pStart;
      }

      if (at(s, p) === cStr) {
        if (at(s, ++p) !== cStr) {
          // break or continue for loop
          if (eMode === DoubledQuoteMode.ESCAPE) {
            const cDetectSep: Ref<string> = { v: '￿' }; // No separator detection here.
            if (lcl_isFieldEndQuote(s, p - 1, pSeps, cDetectSep) === QuoteType.FIELDEND_QUOTE) {
              bClosingQuote = true;
              break;
            } else continue;
          } else break;
        }
        // doubled quote char
        switch (eMode) {
          case DoubledQuoteMode.KEEP_ALL:
            p++; // both for us (not breaking for-loop)
            break;
          case DoubledQuoteMode.ESCAPE:
            p++; // one for us (breaking for-loop)
            bCont = true; // and more
            break;
        }
        if (eMode === DoubledQuoteMode.ESCAPE) break;
      } else p++;
    }
    if (p0 < p) {
      if (!lcl_appendLineData(aString, s, p0, (eMode !== DoubledQuoteMode.KEEP_ALL && (at(s, p) !== '\0' || at(s, p - 1) === cStr)) ? p - 1 : p)) rbOverflowCell.v = true;
    }
  } while (bCont);

  if (!bClosingQuote) return pStart;

  if (aString.v.length) rField.v += aString.v;

  return p;
}

/** The string quoted with cQuote, cEsc doubled (written by the caller). */
function lcl_WriteString(rString: string, cQuote: string, cEsc: string): string {
  if (cEsc) {
    // the goal is to replace cStr by cStr+cStr
    const strFrom = cEsc;
    const strTo = strFrom + strFrom;
    rString = rString.replaceAll(strFrom, strTo);
  }

  if (cQuote) {
    rString = cQuote + rString + cQuote;
  }

  return rString;
}

/**
 * Check if a given string has any line break characters or separators.
 *
 * @param rStr string to inspect.
 * @param cSep separator character.
 */
function hasLineBreaksOrSeps(rStr: string, cSep: string): boolean {
  for (let i = 0, n = rStr.length; i < n; ++i) {
    const c = rStr[i]!;
    if (c === cSep)
      // separator found.
      return true;

    switch (c) {
      case '\n':
      case '\r':
        // line break found.
        return true;
      default:
    }
  }
  return false;
}

//  Extended Ascii-Import

/** CalendarWrapper, reduced to the Gregorian month names of a language (from Intl). */
class lcl_Calendar {
  private readonly maMonths: { FullName: string; AbbrevName: string }[];
  constructor(aLang: string) {
    let loc = aLang;
    try { new Intl.DateTimeFormat(loc); } catch { loc = 'en-US'; }
    const full = new Intl.DateTimeFormat(loc, { month: 'long', timeZone: 'UTC' });
    const abbrev = new Intl.DateTimeFormat(loc, { month: 'short', timeZone: 'UTC' });
    this.maMonths = [];
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2001, m, 15));
      this.maMonths.push({ FullName: full.format(d), AbbrevName: abbrev.format(d) });
    }
  }
  getMonths(): readonly { FullName: string; AbbrevName: string }[] { return this.maMonths; }
  getNumberOfMonthsInYear(): number { return 12; }
}

/** TransliterationWrapper(IGNORE_CASE)::isEqual */
const isEqual = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();
/** CharClass::isLetterNumeric(rStr, nPos) */
const isLetterNumeric = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);

/** ScDocumentImport::setAutoInput etc. go to the document (see the header). The document's language. */
function lcl_DocLanguage(rDoc: ScDocument): string {
  return rDoc.GetDefPattern().GetItem('ATTR_LANGUAGE_FORMAT') || 'en-US';
}

/**
 * Put one field of the CSV into a cell by its column type: SC_COL_TEXT as text, SC_COL_ENGLISH
 * as an en-US number, the date types as dates (with time), else as the user would type it.
 * Returns whether the cell is multi-line. pFormatter is the language (tag) of the CSV.
 */
function lcl_PutString(
  rDoc: ScDocument, bUseDocImport: boolean,
  nCol: SCCOL, nRow: SCROW, nTab: SCTAB, rStr: string, nColFormat: number,
  pFormatter: string, bDetectNumFormat: boolean, bDetectSciNumFormat: boolean, bEvaluateFormulas: boolean, bSkipEmptyCells: boolean,
  rCalendar: lcl_Calendar, pSecondCalendar: lcl_Calendar | null,
): boolean {
  let bMultiLine = false;
  if (nColFormat === SC_COL_SKIP || !rDoc.ValidCol(nCol) || !rDoc.ValidRow(nRow)) return bMultiLine;
  if (rStr.length === 0) {
    if (!bSkipEmptyCells) {
      // delete destination cell
      rDoc.SetString(nCol, nRow, nTab, rStr);
    }
    return false;
  }

  const eDocLang = lcl_DocLanguage(rDoc);
  const bForceFormulaText = !bEvaluateFormulas && rStr[0] === '=';
  if (nColFormat === SC_COL_TEXT || bForceFormulaText) {
    if (bUseDocImport) {
      if (bForceFormulaText || IsNumberFormat(rStr, eDocLang)) {
        // Set the format of this cell to Text.
        // This is only necessary for ScDocumentImport,
        // ScDocument::SetTextCell() forces it by ScSetStringParam.
        rDoc.SetNumberFormat(new ScAddress(nCol, nRow, nTab), GetStandardFormat(SvNumFormatType.TEXT, eDocLang));
      }
      if (ScStringUtil.isMultiline(rStr)) {
        rDoc.SetEditText(new ScAddress(nCol, nRow, nTab), EditTextObject.FromText(rStr));
        return true;
      } else {
        rDoc.SetRawString(new ScAddress(nCol, nRow, nTab), rStr);
        return false;
      }
    } else {
      rDoc.SetTextCell(new ScAddress(nCol, nRow, nTab), rStr);
      return bMultiLine;
    }
  }

  if (nColFormat === SC_COL_ENGLISH) {
    //! SetString with Extra-Flag ???

    const r = IsNumberFormat(rStr, 'en-US');
    if (r) {
      // Numberformat will not be set to English
      rDoc.SetValue(nCol, nRow, nTab, r.value);
      return bMultiLine;
    }
    // else, continue with SetString
  } else if (nColFormat !== SC_COL_STANDARD) {
    // Datumformats
    const nMaxNumberParts = 7; // Y-M-D h:m:s.t
    const nLen = rStr.length;
    const nStart: number[] = new Array<number>(nMaxNumberParts).fill(0);
    const nEnd: number[] = new Array<number>(nMaxNumberParts).fill(0);

    let bIso: boolean;
    let nDP: number, nMP: number, nYP: number;
    switch (nColFormat) {
      case SC_COL_YMD: nDP = 2; nMP = 1; nYP = 0; bIso = true; break;
      case SC_COL_MDY: nDP = 1; nMP = 0; nYP = 2; bIso = false; break;
      case SC_COL_DMY:
      default: nDP = 0; nMP = 1; nYP = 2; bIso = false; break;
    }

    let nFound = 0;
    let bInNum = false;
    for (let nPos = 0; nPos < nLen && (bInNum || nFound < nMaxNumberParts); ++nPos) {
      let bLetter = false;
      if (/[0-9]/.test(rStr[nPos]!) ||
        (((!bInNum && nFound === nMP) || (bInNum && nFound === nMP + 1)) &&
          (bLetter = isLetterNumeric(rStr[nPos]!)))) {
        if (!bInNum) {
          bInNum = true;
          nStart[nFound] = nPos;
          ++nFound;
        }
        nEnd[nFound - 1] = nPos;
        if (bIso && (bLetter || (2 <= nFound && nFound <= 6 && nPos > nStart[nFound - 1]! + 1)))
          // Each M,D,h,m,s at most 2 digits.
          bIso = false;
      } else {
        bInNum = false;
        if (bIso) {
          // ([+-])YYYY-MM-DD([T ]hh:mm(:ss(.fff)))(([+-])TZ)
          // XXX NOTE: timezone is accepted here, but number
          // formatter parser will not, so the end result will be
          // type Text to preserve timezone information.
          switch (rStr[nPos]) {
            case '+':
              if (nFound >= 5 && nPos === nEnd[nFound - 1]! + 1) {
                // Accept timezone offset.
              } else if (nPos > 0)
                // Accept one leading sign.
                bIso = false;
              break;
            case '-':
              if (nFound >= 5 && nPos === nEnd[nFound - 1]! + 1) {
                // Accept timezone offset.
              } else if (nFound === 0 && nPos > 0)
                // Accept one leading sign.
                bIso = false;
              else if (nFound < 1 || 2 < nFound || nPos !== nEnd[nFound - 1]! + 1)
                // Not immediately after 1 or 1-2
                bIso = false;
              break;
            case 'T':
            case ' ':
              if (nFound !== 3 || nPos !== nEnd[nFound - 1]! + 1)
                // Not immediately after 1-2-3
                bIso = false;
              break;
            case ':':
              if (nFound < 4 || 5 < nFound || nPos !== nEnd[nFound - 1]! + 1)
                // Not at 1-2-3T4:5:
                bIso = false;
              break;
            case '.':
            case ',':
              if (nFound !== 6 || nPos !== nEnd[nFound - 1]! + 1)
                // Not at 1-2-3T4:5:6.
                bIso = false;
              break;
            case 'Z':
              if (nFound >= 5 && nPos === nEnd[nFound - 1]! + 1) {
                // Accept Zero timezone.
              } else bIso = false;
              break;
            default:
              bIso = false;
          }
        }
      }
    }

    if (nFound < 3) bIso = false;

    if (bIso) {
      // Leave conversion and detection of various possible number
      // formats to the number formatter. ISO is recognized in any locale
      // so we can directly use the document's formatter.
      const r = IsNumberFormat(rStr, eDocLang);
      if (r) {
        const eType = GetType(r.code, eDocLang);
        if (eType === SvNumFormatType.DATE || eType === SvNumFormatType.DATETIME) {
          const aPos = new ScAddress(nCol, nRow, nTab);
          rDoc.SetValue(aPos, r.value);
          rDoc.SetNumberFormat(aPos, r.code);

          return bMultiLine; // success
        }
      }
      // If we reach here it is type Text (e.g. timezone or trailing
      // characters). Handled below.
    }

    if (nFound === 1) {
      //  try to break one number (without separators) into date fields

      const nDateStart = nStart[0]!;
      const nDateLen = nEnd[0]! + 1 - nDateStart;

      if (nDateLen >= 5 && nDateLen <= 8 && /^[0-9]+$/.test(rStr.substr(nDateStart, nDateLen))) {
        //  6 digits: 2 each for day, month, year
        //  8 digits: 4 for year, 2 each for day and month
        //  5 or 7 digits: first field is shortened by 1

        const bLongYear = nDateLen >= 7;
        const bShortFirst = nDateLen === 5 || nDateLen === 7;

        let nFieldStart = nDateStart;
        for (let nPos = 0; nPos < 3; nPos++) {
          let nFieldEnd = nFieldStart + 1; // default: 2 digits
          if (bLongYear && nPos === nYP) nFieldEnd += 2; // 2 extra digits for long year
          if (bShortFirst && nPos === 0) --nFieldEnd; // first field shortened?

          nStart[nPos] = nFieldStart;
          nEnd[nPos] = nFieldEnd;
          nFieldStart = nFieldEnd + 1;
        }
        nFound = 3;
      }
    }

    if (!bIso && nFound >= 3) {
      let bSecondCal = false;
      const nDay = toUInt16(rStr.substring(nStart[nDP]!, nEnd[nDP]! + 1));
      let nYear = toUInt16(rStr.substring(nStart[nYP]!, nEnd[nYP]! + 1));
      const aMStr = rStr.substring(nStart[nMP]!, nEnd[nMP]! + 1);
      let nMonth = toUInt16(aMStr);
      if (!nMonth) {
        const aSepShortened = 'SEP';
        let xMonths;
        let i: number, nMonthCount: number;
        //  first test all month names from local international
        xMonths = rCalendar.getMonths();
        nMonthCount = xMonths.length;
        for (i = 0; i < nMonthCount && !nMonth; i++) {
          if (isEqual(aMStr, xMonths[i]!.FullName) || isEqual(aMStr, xMonths[i]!.AbbrevName)) nMonth = i + 1;
          else if (i === 8 && isEqual('SEPT', xMonths[i]!.AbbrevName) && isEqual(aMStr, aSepShortened)) {
            // correct English abbreviation is SEPT,
            // but data mostly contains SEP only
            nMonth = i + 1;
          }
        }
        //  if none found, then test english month names
        if (!nMonth && pSecondCalendar) {
          xMonths = pSecondCalendar.getMonths();
          nMonthCount = xMonths.length;
          for (i = 0; i < nMonthCount && !nMonth; i++) {
            if (isEqual(aMStr, xMonths[i]!.FullName) || isEqual(aMStr, xMonths[i]!.AbbrevName)) {
              nMonth = i + 1;
              bSecondCal = true;
            } else if (i === 8 && isEqual(aMStr, aSepShortened)) {
              // correct English abbreviation is SEPT,
              // but data mostly contains SEP only
              nMonth = i + 1;
              bSecondCal = true;
            }
          }
        }
      }

      if (nYear < 100) nYear = ExpandTwoDigitYear(nYear);

      const pCalendar = bSecondCal ? pSecondCalendar! : rCalendar;
      const nNumMonths = pCalendar.getNumberOfMonthsInYear();
      if (nDay && nMonth && nDay <= 31 && nMonth <= nNumMonths) {
        --nMonth;
        let nHour: number, nMinute: number, nSecond: number;
        // #i14974# The imported value should have no fractional value, so set the
        // time fields to zero (ICU calendar instance defaults to current date/time)
        nHour = nMinute = nSecond = 0;
        if (nFound > 3) nHour = toInt16(rStr.substring(nStart[3]!, nEnd[3]! + 1));
        if (nFound > 4) nMinute = toInt16(rStr.substring(nStart[4]!, nEnd[4]! + 1));
        if (nFound > 5) nSecond = toInt16(rStr.substring(nStart[5]!, nEnd[5]! + 1));
        // do not use calendar's milliseconds, to avoid fractional part truncation
        let fFrac = 0.0;
        if (nFound > 6) {
          const cDec = '.';
          const aT = cDec + rStr.substring(nStart[6]!, nEnd[6]! + 1);
          const fV = Number(aT);
          if (Number.isFinite(fV)) fFrac = fV / 86400.0;
        }
        let nPos: number;
        if (nFound > 3 && 1 <= nHour && nHour <= 12 && // nHour 0 and >=13 can't be AM/PM
          (nPos = nEnd[nFound - 1]! + 1) < nLen) {
          // Dreaded AM/PM may be following.
          while (nPos < nLen && rStr[nPos] === ' ') ++nPos;
          if (nPos < nLen) {
            let nStop = nPos;
            while (nStop < nLen && rStr[nStop] !== ' ') ++nStop;
            const aAmPm = rStr.substring(nPos, nStop);
            // For AM only 12 needs to be treated, whereas for PM
            // it must not. Check both, locale and second/English
            // strings.
            if (nHour === 12 && (isEqual(aAmPm, 'AM') || (pSecondCalendar && isEqual(aAmPm, 'AM')))) {
              nHour = 0;
            } else if (nHour < 12 && (isEqual(aAmPm, 'PM') || (pSecondCalendar && isEqual(aAmPm, 'PM')))) {
              nHour += 12;
            }
          }
        }
        // pCalendar->isValid(): no field changed by normalization.
        const nDaysInMonth = new Date(Date.UTC(nYear, nMonth + 1, 0)).getUTCDate();
        if (nDay <= nDaysInMonth && nHour < 24 && nMinute < 60 && nSecond < 60) {
          // Whole days diff to the null date, and the time.
          const fDays = DateToSerial(nYear, nMonth + 1, nDay) + (nHour * 3600 + nMinute * 60 + nSecond) / 86400.0 + fFrac;

          const nType = nFound > 3 ? SvNumFormatType.DATETIME : SvNumFormatType.DATE;
          const nFormat = GetStandardFormat(nType, eDocLang);
          // maybe there is a special format including seconds or milliseconds
          // (GetStandardFormat(fDays, nFormat, nType, eDocLang) is the standard format for DATETIME)

          const aPos = new ScAddress(nCol, nRow, nTab);
          rDoc.SetValue(aPos, fDays);
          rDoc.SetNumberFormat(aPos, nFormat);

          return bMultiLine; // success
        }
      }
    }
  }

  // Standard or date not determined -> SetString / EditCell
  if (!rStr.includes('\n')) {
    if (!bDetectNumFormat && nColFormat === SC_COL_STANDARD) {
      // Import a strict ISO 8601 date(+time) string even without
      // "Detect special numbers" or "Date (YMD)".
      do {
        // Simple pre-check before calling more expensive parser.
        // ([+-])(Y)YYYY-MM-DD
        if (rStr.length < 10) break;
        const n1 = rStr.indexOf('-', 1);
        if (n1 < 4) break;
        const n2 = rStr.indexOf('-', n1 + 1);
        if (n2 < 7 || n1 + 3 < n2) break;

        if (!parseDateTime(rStr)) break;

        const r = IsNumberFormat(rStr, eDocLang);
        if (r) {
          const eType = GetType(r.code, eDocLang);
          if (eType === SvNumFormatType.DATE || eType === SvNumFormatType.DATETIME) {
            const aPos = new ScAddress(nCol, nRow, nTab);
            rDoc.SetValue(aPos, r.value);
            rDoc.SetNumberFormat(aPos, r.code);

            return bMultiLine; // success
          }
        }
      } while (false);
    }

    const aParam = new ScSetStringParam();
    aParam.mpNumFormatter = pFormatter;
    aParam.mbDetectNumberFormat = bDetectNumFormat;
    aParam.mbDetectScientificNumberFormat = bDetectSciNumFormat;
    aParam.meSetTextNumFormat = TextFormatPolicy.SpecialNumberOnly;
    aParam.mbHandleApostrophe = false;
    aParam.mbCheckLinkFormula = true;
    rDoc.SetString(nCol, nRow, nTab, rStr, aParam);
  } else {
    bMultiLine = true;
    rDoc.SetEditText(new ScAddress(nCol, nRow, nTab), EditTextObject.FromText(rStr));
  }
  return bMultiLine;
}

/** static_cast<sal_uInt16>(o3tl::toInt32(...)) */
const toUInt16 = (s: string): number => (parseInt(s, 10) || 0) & 0xFFFF;
/** static_cast<sal_Int16>(o3tl::toInt32(...)) */
const toInt16 = (s: string): number => ((parseInt(s, 10) || 0) << 16) >> 16;

/** SvNumberFormatter::ExpandTwoDigitYear with the default two-digit year start 1930. */
function ExpandTwoDigitYear(nYear: number): number {
  return nYear < 30 ? nYear + 2000 : nYear + 1900;
}

/** sax::Converter::parseDateTime: an ISO 8601 date or date and time (with seconds). */
function parseDateTime(rStr: string): boolean {
  const m = /^-?(\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(rStr);
  if (!m) return false;
  const nMonth = Number(m[2]), nDay = Number(m[3]);
  if (nMonth < 1 || nMonth > 12 || nDay < 1 || nDay > 31) return false;
  if (m[4] !== undefined && (Number(m[4]) > 24 || Number(m[5]) > 59 || Number(m[6]) > 60)) return false;
  return true;
}

function lcl_GetFixed(rLine: string, nStart: number, nNext: number, rbIsQuoted: Ref<boolean>, rbOverflowCell: Ref<boolean>): string {
  const nLen = rLine.length;
  if (nNext > nLen) nNext = nLen;
  if (nNext <= nStart) return '';

  const pStr = rLine;

  let nSpace = nNext;
  while (nSpace > nStart && pStr[nSpace - 1] === ' ') --nSpace;

  rbIsQuoted.v = pStr[nStart] === '"' && pStr[nSpace - 1] === '"';
  if (rbIsQuoted.v) {
    const bFits = nSpace - nStart - 3 <= nArbitraryCellLengthLimit;
    if (bFits) return rLine.substr(nStart + 1, Math.max(0, nSpace - nStart - 2));
    else {
      // lcl_GetFixed: line doesn't fit into data
      rbOverflowCell.v = true;
      return rLine.substr(nStart + 1, nArbitraryCellLengthLimit);
    }
  } else {
    const bFits = nSpace - nStart <= nArbitraryCellLengthLimit;
    if (bFits) return rLine.substr(nStart, nSpace - nStart);
    else {
      // lcl_GetFixed: line doesn't fit into data
      rbOverflowCell.v = true;
      return rLine.substr(nStart, nArbitraryCellLengthLimit);
    }
  }
}

// Precondition: pStr is guaranteed to be non-NULL and points to a 0-terminated
// array.
function lcl_UnicodeStrChr(pStr: string, c: string): boolean {
  return pStr.includes(c);
}

/** Read a CSV (comma separated values) data line using
    ReadUniOrByteStringLine().

    @param bEmbeddedLineBreak
    If TRUE and a line-break occurs inside a field of data,
    a line feed LF '\n' and the next line are appended. Repeats
    until a line-break is not in a field. A field is determined
    by delimiting rFieldSeparators and optionally surrounded by
    a pair of cFieldQuote characters. For a line-break to be
    within a field, the field content MUST be surrounded by
    cFieldQuote characters, and the opening cFieldQuote MUST be
    at the very start of a line or follow right behind a field
    separator with no extra characters in between, with the
    exception of blanks contradictory to RFC 4180. Anything,
    including field separators and escaped quotes (by doubling
    them) may appear in a quoted field.

    If bEmbeddedLineBreak==FALSE, nothing is parsed and the
    string returned is simply one ReadUniOrByteStringLine().

    @param rFieldSeparators
    A list of characters that each may act as a field separator.
    If rcDetectSep was 0 and a separator is detected then it is appended to
    rFieldSeparators.

    @param cFieldQuote
    The quote character used ('' for none).

    @param rcDetectSep
    If '\0' then attempt to detect a possible separator if
    rFieldSeparators doesn't include it already ('￿': no detection). This
    can be necessary because of the "accept broken misquoted CSV fields"
    feature that tries to ignore trailing blanks after a quoted field and if no
    separator follows continues to add content to the field assuming the single
    double quote was in error. It is also necessary if the only possible
    separator was not selected and not included in rFieldSeparators and a line
    starts with a quoted field, in which case appending lines is tried until end
    of file. If a separator is detected it is added to rFieldSeparators and the
    line is reread with the new separators

    @param nMaxSourceLines
    Maximum source lines to read and combine into one logical line for embedded
    new line purpose. Should be limited for the preview dialog because only
    non-matching separators selected otherwise would lead to trying to
    concatenate lines until file end.
    If 0 no limit other than the internal arbitrary resulting line length
    limit.
  */
export function ReadCsvLine(rStream: ScImportStringStream, bEmbeddedLineBreak: boolean, rFieldSeparators: Ref<string>, cFieldQuote: string, rcDetectSep: Ref<string>, nMaxSourceLines = 0): string {
  const RetryState = { FORBID: 0, ALLOW: 1, RETRY: 2, RETRIED: 3 } as const;
  let eRetryState: number = bEmbeddedLineBreak && rcDetectSep.v === '\0' ? RetryState.ALLOW : RetryState.FORBID;

  const nStreamPos = eRetryState === RetryState.ALLOW ? rStream.Tell() : 0;

  Label_RetryWithNewSep: for (;;) {
    if (eRetryState === RetryState.RETRY) {
      eRetryState = RetryState.RETRIED;
      rStream.Seek(nStreamPos);
    }

    let aStr = rStream.ReadUniOrByteStringLine(nArbitraryLineLengthLimit) ?? '';

    if (bEmbeddedLineBreak) {
      let nFirstLineLength = aStr.length;
      let nFirstLineStreamPos = rStream.Tell();
      let nLine = 0;

      let pSeps = rFieldSeparators.v;

      let eQuoteState: QuoteType = QuoteType.FIELDEND_QUOTE;
      let bFieldStart = true;

      let nLastOffset = 0;
      let nQuotes = 0;
      while (!rStream.eof() && aStr.length < nArbitraryLineLengthLimit) {
        let p = nLastOffset;
        const pStop = aStr.length;
        while (p < pStop) {
          const c = aStr[p]!;
          if (c === '\0') {
            // Skip embedded null-characters. They don't change
            // anything and are handled at a higher level.
            ++p;
            continue;
          }

          if (nQuotes) {
            if (c === cFieldQuote) {
              if (bFieldStart) {
                ++nQuotes;
                bFieldStart = false;
                eQuoteState = QuoteType.FIELDSTART_QUOTE;
                nFirstLineLength = aStr.length;
                nFirstLineStreamPos = rStream.Tell();
              }
              // Do not detect a FIELDSTART_QUOTE if not in
              // bFieldStart mode, in which case for unquoted content
              // we are in FIELDEND_QUOTE state.
              else if (eQuoteState !== QuoteType.FIELDEND_QUOTE) {
                eQuoteState = lcl_isEscapedOrFieldEndQuote(nQuotes, aStr, p, pSeps, cFieldQuote, rcDetectSep);

                if (eRetryState === RetryState.ALLOW && rcDetectSep.v !== '\0') {
                  eRetryState = RetryState.RETRY;
                  rFieldSeparators.v += rcDetectSep.v;
                  pSeps = rFieldSeparators.v;
                  continue Label_RetryWithNewSep;
                }

                // DONTKNOW_QUOTE is an embedded unescaped quote we
                // don't count for pairing.
                if (eQuoteState !== QuoteType.DONTKNOW_QUOTE) ++nQuotes;
              }
            } else if (eQuoteState === QuoteType.FIELDEND_QUOTE) {
              if (bFieldStart)
                // If blank is a separator it starts a field, if it
                // is not and thus maybe leading before quote we
                // are still at start of field regarding quotes.
                bFieldStart = c === ' ' || lcl_UnicodeStrChr(pSeps, c);
              else bFieldStart = lcl_UnicodeStrChr(pSeps, c);
            }
          } else {
            if (c === cFieldQuote && bFieldStart) {
              nQuotes = 1;
              eQuoteState = QuoteType.FIELDSTART_QUOTE;
              bFieldStart = false;
              nFirstLineLength = aStr.length;
              nFirstLineStreamPos = rStream.Tell();
            } else if (eQuoteState === QuoteType.FIELDEND_QUOTE) {
              // This also skips leading blanks at beginning of line
              // if followed by a quote. It's debatable whether we
              // actually want that or not, but congruent with what
              // ScanNextFieldFromString() does.
              if (bFieldStart) bFieldStart = c === ' ' || lcl_UnicodeStrChr(pSeps, c);
              else bFieldStart = lcl_UnicodeStrChr(pSeps, c);
            }
          }
          // A quote character inside a field content does not start
          // a quote.
          ++p;
        }

        if ((nQuotes & 1) === 0)
          // We still have a (theoretical?) problem here if due to
          // nArbitraryLineLengthLimit (or nMaxSourceLines below) we
          // split a string right between a doubled quote pair.
          break;
        else if (eQuoteState === QuoteType.DONTKNOW_QUOTE)
          // A single unescaped quote somewhere in a quote started
          // field, most likely that was not meant to have embedded
          // linefeeds either.
          break;
        else if (++nLine >= nMaxSourceLines && nMaxSourceLines > 0)
          // Unconditionally increment nLine even if nMaxSourceLines==0
          // so it can be observed in debugger.
          break;
        else {
          nLastOffset = aStr.length;
          const aNext = rStream.ReadUniOrByteStringLine(nArbitraryLineLengthLimit) ?? '';
          if (!rStream.eof()) aStr += '\n' + aNext;
        }
      }
      if (nQuotes & 1) {
        // No closing quote at all. A single quote at field start => no
        // embedded linefeeds for that field, take only first logical line.
        aStr = aStr.slice(0, nFirstLineLength);
        rStream.Seek(nFirstLineStreamPos);
      }
    }
    return aStr;
  }
}

// --- docsh.cxx: ScDocShell::AsciiSave ------------------------------------------------------------

// Xcl-like column width measured in characters of standard font.
function lcl_ScDocShell_GetColWidthInChars(nWidth: number): number {
  let f = nWidth;
  f *= 1328.0 / 25.0;
  f += 90.0;
  f *= 1.0 / 23.0;
  f /= 256.0;

  return Math.trunc(f);
}

function lcl_ScDocShell_GetFixedWidthString(rStr: string, rDoc: ScDocument, nTab: SCTAB, nCol: SCCOL, bValue: boolean, eHorJust: SvxCellHorJustify): string {
  let aString = rStr;
  const nLen = lcl_ScDocShell_GetColWidthInChars(rDoc.GetColWidth(nCol, nTab));
  //If the text won't fit in the column
  if (nLen < aString.length) {
    let aReplacement: string;
    if (bValue) aReplacement = '###';
    else aReplacement = aString;
    //truncate to the number of characters that should fit, even in the
    //bValue case nLen might be < len ###
    aString = aReplacement.slice(0, Math.max(0, nLen));
  }
  if (nLen > aString.length) {
    if (bValue && eHorJust === 'Standard') eHorJust = 'Right';
    let aTmp = '';
    switch (eHorJust) {
      case 'Right':
        aTmp = ' '.repeat(nLen - aString.length);
        aString = aTmp + aString;
        break;
      case 'Center':
        aTmp = ' '.repeat(Math.trunc((nLen - aString.length) / 2));
        // [[fallthrough]];
        aTmp += aString;
        aTmp = aTmp.padEnd(nLen, ' ');
        aString = aTmp;
        break;
      default:
        aTmp += aString;
        aTmp = aTmp.padEnd(nLen, ' ');
        aString = aTmp;
    }
  }
  return aString;
}

function lcl_ScDocShell_WriteEmptyFixedWidthString(rStream: ScExportStringStream, rDoc: ScDocument, nTab: SCTAB, nCol: SCCOL): void {
  const aString = lcl_ScDocShell_GetFixedWidthString('', rDoc, nTab, nCol, false, 'Standard');
  rStream.WriteUnicodeOrByteText(aString);
}

function getTextSepPos(rStr: string, rAsciiOpt: ScImportOptions, rTextSep: string, rFieldSep: string, rNeedQuotes: Ref<boolean>): number {
  // #i116636# quotes are needed if text delimiter (quote), field delimiter,
  // or LF or CR is in the cell text.
  const nPos = rStr.indexOf(rTextSep);
  rNeedQuotes.v = rAsciiOpt.bQuoteAllText || nPos >= 0 ||
    (rFieldSep !== '' && rStr.indexOf(rFieldSep) >= 0) ||
    rStr.indexOf('\n') >= 0 ||
    rStr.indexOf('\r') >= 0;
  return nPos;
}

/** ScHorizontalCellIterator, reduced: the non-empty cells of a range row by row. */
function* lcl_HorizontalCells(rDoc: ScDocument, nTab: SCTAB, nStartCol: SCCOL, nStartRow: SCROW, nEndCol: SCCOL, nEndRow: SCROW): Generator<{ nCol: SCCOL; nRow: SCROW; pCell: ScRefCellValue }> {
  for (let nRow = nStartRow; nRow <= nEndRow; nRow++) {
    for (let nCol = nStartCol; nCol <= nEndCol; nCol++) {
      const aPos = new ScAddress(nCol, nRow, nTab);
      if (rDoc.GetCellType(aPos) === CELLTYPE_NONE) continue;
      yield { nCol, nRow, pCell: rDoc.GetRefCellValue(aPos) };
    }
  }
}

/**
 * ScDocShell::AsciiSave: write a sheet as CSV (or fixed width text). The text encoding is the
 * caller's (see the header); a BOM is written as U+FEFF when bIncludeBOM is set for UTF-8.
 */
export function AsciiSave(rDocSh: ScDocShell, rStream: ScExportStringStream, rAsciiOpt: ScImportOptions, nTab: SCTAB): void {
  const m_pDocument = rDocSh.GetDocument();
  const cDelim = rAsciiOpt.nFieldSepCode;
  const cStrDelim = rAsciiOpt.nTextSepCode;
  const eCharSet = rAsciiOpt.eCharSet;
  const bFixedWidth = rAsciiOpt.bFixedWidth;
  const bSaveNumberAsSuch = rAsciiOpt.bSaveNumberAsSuch;
  const bSaveAsShown = rAsciiOpt.bSaveAsShown;
  const bShowFormulas = rAsciiOpt.bSaveFormulas;
  const bIncludeBOM = rAsciiOpt.bIncludeBOM;

  // tdf#82254 - check whether to include a byte-order-mark in the output
  if (bIncludeBOM && eCharSet === TextEncodingToLabel(RTL_TEXTENCODING_UTF8)) rStream.WriteUnicodeOrByteText('﻿');

  const nStartCol = 0;
  let nStartRow = 0;
  const aArea = m_pDocument.GetCellArea(nTab);
  const nEndCol = aArea.nEndCol;
  const nEndRow = aArea.nEndRow;

  let aString: string;

  const bTabProtect = m_pDocument.IsTabProtected(nTab);

  // Treat the top left cell separator "sep=" special.
  // Here nStartRow == 0 && nStartCol == 0
  if (!bFixedWidth && cDelim !== '') {
    // First row iterator.
    const aIter = lcl_HorizontalCells(m_pDocument, nTab, nStartCol, nStartRow, nEndCol, nStartRow);
    // Must be first column and all following cells on this row must be
    // empty to fiddle with "sep=".
    const r1 = aIter.next();
    if (!r1.done && r1.value.nCol === nStartCol && aIter.next().done) {
      const pCell = r1.value.pCell;
      if (pCell.getType() === CELLTYPE_STRING) {
        aString = pCell.getSharedString()!;
        if (aString.length <= 5 && aString.toLowerCase().startsWith('sep=')) {
          // Cell content is /^sep=.?$/ so write current separator.
          // Force the quote character to '"' regardless what is set
          // for export because that is the only one recognized on
          // import.
          aString = 'sep=' + cDelim;
          if (cStrDelim !== '') rStream.WriteUniOrByteChar('"');
          rStream.WriteUnicodeOrByteText(aString);
          if (cStrDelim !== '') rStream.WriteUniOrByteChar('"');
          rStream.endlub();
          ++nStartRow;
        }
      }
    }
  }

  let nNextCol = nStartCol;
  let nNextRow = nStartRow;
  let nEmptyCol: SCCOL;
  let nEmptyRow: SCROW;

  if (aArea.bFound) {
    for (const { nCol, nRow, pCell } of lcl_HorizontalCells(m_pDocument, nTab, nStartCol, nStartRow, nEndCol, nEndRow)) {
      if (nNextRow < nRow) {
        // empty rows or/and empty columns up to end of row
        for (nEmptyCol = nNextCol; nEmptyCol < nEndCol; nEmptyCol++) {
          // remaining columns of last row
          if (bFixedWidth) lcl_ScDocShell_WriteEmptyFixedWidthString(rStream, m_pDocument, nTab, nEmptyCol);
          else if (cDelim !== '') rStream.WriteUniOrByteChar(cDelim);
        }
        rStream.endlub();
        nNextRow++;
        for (nEmptyRow = nNextRow; nEmptyRow < nRow; nEmptyRow++) {
          // completely empty rows
          for (nEmptyCol = nStartCol; nEmptyCol < nEndCol; nEmptyCol++) {
            if (bFixedWidth) lcl_ScDocShell_WriteEmptyFixedWidthString(rStream, m_pDocument, nTab, nEmptyCol);
            else if (cDelim !== '') rStream.WriteUniOrByteChar(cDelim);
          }
          rStream.endlub();
        }
        for (nEmptyCol = nStartCol; nEmptyCol < nCol; nEmptyCol++) {
          // empty columns at beginning of row
          if (bFixedWidth) lcl_ScDocShell_WriteEmptyFixedWidthString(rStream, m_pDocument, nTab, nEmptyCol);
          else if (cDelim !== '') rStream.WriteUniOrByteChar(cDelim);
        }
        nNextRow = nRow;
      } else if (nNextCol < nCol) {
        // empty columns in same row
        for (nEmptyCol = nNextCol; nEmptyCol < nCol; nEmptyCol++) {
          // columns in between
          if (bFixedWidth) lcl_ScDocShell_WriteEmptyFixedWidthString(rStream, m_pDocument, nTab, nEmptyCol);
          else if (cDelim !== '') rStream.WriteUniOrByteChar(cDelim);
        }
      }
      if (nCol === nEndCol) {
        nNextCol = nStartCol;
        nNextRow = nRow + 1;
      } else nNextCol = nCol + 1;

      let eType: CellType = pCell.getType();
      const aPos = new ScAddress(nCol, nRow, nTab);
      const eLang = m_pDocument.GetAttr(nCol, nRow, nTab, 'ATTR_LANGUAGE_FORMAT') || 'en-US';
      if (bTabProtect) {
        const rProtAttr = m_pDocument.GetAttr(nCol, nRow, nTab, 'ATTR_PROTECTION');
        if (rProtAttr.bHideCell || (eType === CELLTYPE_FORMULA && bShowFormulas && rProtAttr.bHideFormula)) eType = CELLTYPE_NONE; // hide
      }
      let bForceQuotes = false;
      let bString: boolean;
      switch (eType) {
        case CELLTYPE_NONE:
          aString = '';
          bString = false;
          break;
        case CELLTYPE_FORMULA: {
          let nErrCode: FormulaError;
          const pFCell = pCell.getFormula()!;
          if (bShowFormulas) {
            aString = pFCell.GetFormula();
            bString = true;
          } else if ((nErrCode = pFCell.GetErrCode()) !== FormulaError.NONE) {
            aString = ScGlobal.GetErrorString(nErrCode);
            bString = true;
          } else if (pFCell.IsValue()) {
            const nFormat = m_pDocument.GetNumberFormat(aPos);
            if (bFixedWidth || bSaveAsShown) {
              aString = ScCellFormat.GetString(pCell, nFormat, eLang).aString;
              bString = bSaveAsShown && IsTextFormat(nFormat, eLang);
            } else {
              aString = ScCellFormat.GetInputString(pCell, nFormat, eLang);
              bString = bForceQuotes = !bSaveNumberAsSuch;
            }
          } else {
            if (bSaveAsShown) {
              const nFormat = m_pDocument.GetNumberFormat(aPos);
              aString = ScCellFormat.GetString(pCell, nFormat, eLang).aString;
            } else aString = pFCell.GetString();
            bString = true;
          }
          break;
        }
        case CELLTYPE_STRING:
          if (bSaveAsShown) {
            const nFormat = m_pDocument.GetNumberFormat(aPos);
            aString = ScCellFormat.GetString(pCell, nFormat, eLang).aString;
          } else aString = pCell.getSharedString()!;
          bString = true;
          break;
        case CELLTYPE_EDIT: {
          const pObj = pCell.getEditText()!;
          aString = pObj.GetString(); // including LF
          bString = true;
          break;
        }
        case CELLTYPE_VALUE: {
          const nFormat = m_pDocument.GetNumberFormat(nCol, nRow, nTab);
          if (bFixedWidth || bSaveAsShown) {
            aString = ScCellFormat.GetString(pCell, nFormat, eLang).aString;
            bString = bSaveAsShown && IsTextFormat(nFormat, eLang);
          } else {
            aString = ScCellFormat.GetInputString(pCell, nFormat, eLang);
            bString = bForceQuotes = !bSaveNumberAsSuch;
          }
          break;
        }
        default:
          // ScDocShell::AsciiSave: unknown CellType
          aString = '';
          bString = false;
      }

      if (bFixedWidth) {
        const eHorJust = m_pDocument.GetAttr(nCol, nRow, nTab, 'ATTR_HOR_JUSTIFY');
        aString = lcl_ScDocShell_GetFixedWidthString(aString, m_pDocument, nTab, nCol, !bString, eHorJust);
        rStream.WriteUnicodeOrByteText(aString);
      } else {
        let aUniString = aString; // TODO: remove that later
        if (!bString && cStrDelim !== '' && aUniString.length) {
          const c = aUniString[0];
          bString = c === cStrDelim || c === ' ' || aUniString.endsWith(' ') || aUniString.indexOf(cStrDelim) >= 0;
          if (!bString && cDelim !== '') bString = aUniString.indexOf(cDelim) >= 0;
        }
        if (bString) {
          if (cStrDelim !== '') {
            //@ BugId 55355
            // (the text is Unicode: the byte encoding passes are the caller's)
            const bNeedQuotes: Ref<boolean> = { v: false };
            const nPos = getTextSepPos(aUniString, rAsciiOpt, cStrDelim, cDelim, bNeedQuotes);
            if (nPos >= 0) {
              const strFrom = cStrDelim;
              const strTo = strFrom + strFrom;
              aUniString = aUniString.replaceAll(strFrom, strTo);
            }

            if (bNeedQuotes.v || bForceQuotes) rStream.WriteUniOrByteChar(cStrDelim);
            rStream.WriteUnicodeOrByteText(aUniString);
            if (bNeedQuotes.v || bForceQuotes) rStream.WriteUniOrByteChar(cStrDelim);
          } else rStream.WriteUnicodeOrByteText(aUniString);
        } else rStream.WriteUnicodeOrByteText(aUniString);
      }

      if (nCol < nEndCol) {
        if (cDelim !== '') //@ BugId 55355
          rStream.WriteUniOrByteChar(cDelim);
      } else rStream.endlub();
    }
  }

  // write out empty if requested
  if (nNextRow <= nEndRow) {
    for (nEmptyCol = nNextCol; nEmptyCol < nEndCol; nEmptyCol++) {
      // remaining empty columns of last row
      if (bFixedWidth) lcl_ScDocShell_WriteEmptyFixedWidthString(rStream, m_pDocument, nTab, nEmptyCol);
      else if (cDelim !== '') rStream.WriteUniOrByteChar(cDelim);
    }
    rStream.endlub();
    nNextRow++;
  }
  for (nEmptyRow = nNextRow; nEmptyRow <= nEndRow; nEmptyRow++) {
    // entire empty rows
    for (nEmptyCol = nStartCol; nEmptyCol < nEndCol; nEmptyCol++) {
      if (bFixedWidth) lcl_ScDocShell_WriteEmptyFixedWidthString(rStream, m_pDocument, nTab, nEmptyCol);
      else if (cDelim !== '') rStream.WriteUniOrByteChar(cDelim);
    }
    rStream.endlub();
  }
}

// --- docsh.cxx: the CSV branches of ConvertFrom and ConvertTo ------------------------------------

/**
 * The CSV branch of ScDocShell::ConvertFrom: a new document with the text imported into its
 * first sheet by ScImportExport::ImportStream (ExtText2Doc).
 *
 * Without options, upstream's defaults for an import from the API without filter options
 * (ScAsciiOptions(), UTF-8, comma, double quotes), except that the field separators are
 * detected as for a "DETECT" field separator token (SfxObjectShell::DetectCsvSeparators, as the
 * import dialog does by default), falling back to the comma when none are found. Given options
 * are not changed, except that the BOM flag is set when the text starts with one (upstream
 * stores the options with it in the medium).
 */
export function ImportCSV(text: string, options?: ScAsciiOptions): ScDocShell {
  const pDocSh = new ScDocShell();
  const m_pDocument = pDocSh.GetDocument();

  let aOptions: ScAsciiOptions;
  if (options) aOptions = options.Clone();
  else {
    //  default for ascii import (from API without options):
    //  UTF-8 encoding, comma, double quotes

    aOptions = new ScAsciiOptions();
    aOptions.SetCharSet(TextEncodingToLabel(RTL_TEXTENCODING_UTF8));
    aOptions.SetTextSep('"');
    aOptions.ReadFromString(`DETECT,34,${RTL_TEXTENCODING_UTF8},1,,0,false,false,true,false,false,0,true,false,true`, new ScImportStringStream(text));
    if (!aOptions.GetFieldSeps()) aOptions.SetFieldSeps(',');
  }

  const aImpEx = new ScImportExport(m_pDocument, undefined, null);
  aImpEx.SetExtOptions(aOptions);

  const pInStream = new ScImportStringStream(text);
  pInStream.Seek(0);
  aImpEx.ImportStream(pInStream, '', SotClipboardFormatId.STRING);
  m_pDocument.StartAllListeners();
  m_pDocument.SetAllFormulasDirty();

  // tdf#82254 - check whether to include a byte-order-mark in the output
  if (aImpEx.GetIncludeBOM() && options) options.SetIncludeBOM(true);

  pDocSh.SetUnmodified();
  return pDocSh;
}

/**
 * The CSV branch of ScDocShell::ConvertTo: the text of one sheet by AsciiSave. The options are
 * read from the ScAsciiOptions' filter options string as upstream reads them when a loaded CSV
 * is saved again (ScImportOptions: "quoted field as text" becomes "quote all text cells",
 * "detect special numbers" becomes "save numbers as such"), or given as ScImportOptions (what
 * the export dialog sets). Without options: comma, double quotes and UTF-8, with the export
 * dialog's "save cell contents as shown" (upstream's export from the API without options does
 * not save as shown).
 */
export function ExportCSV(sh: ScDocShell, nTab: SCTAB, options?: ScAsciiOptions | ScImportOptions): string {
  let aOptions: ScImportOptions;
  if (options instanceof ScImportOptions) aOptions = options;
  else if (options) aOptions = new ScImportOptions(options.WriteToString());
  else {
    //  default for ascii export (from API without options):
    //  UTF-8 encoding, comma, double quotes

    const aDefOptions = new ScImportOptions(',', '"', TextEncodingToLabel(RTL_TEXTENCODING_UTF8));
    aDefOptions.bSaveAsShown = true;
    aOptions = new ScImportOptions(aDefOptions.BuildString());
  }

  const aStream = new ScExportStringStream();
  AsciiSave(sh, aStream, aOptions, nTab);
  return aStream.GetString();
}
