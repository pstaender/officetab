// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xetable.cxx reduced
// @upstream sc/source/filter/excel/xltools.cxx partial
// XclExpCellTable: a worksheet part. sheetFormatPr (the default row height and the most used
// column width, XclExpDefcolwidth), cols (XclExpColinfo: widths in digits of the default font as
// XclExpColinfo::SaveXml computes them, hidden, the column's default XF), sheetData (XclExpRow
// with number, string, rich string and formula cells, cached formula results as
// XclXmlUtils::GetFormulaTypeAndValue gives them, array formulas, blank cells with formats),
// mergeCells, hyperlinks and the notes' legacyDrawing. Reduced: outlines are not modelled; there
// are no row default formats (every formatted cell gets its own c element); shared formulas are
// written as single formulas; cells hidden by a filter and the dimension's used area as upstream
// computes it are simplified; a cached result in a cell with the BOOLEAN format is written as a
// boolean also when the formula was not calculated (its format type is not known then).
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { ScFormulaCell, ScMatrixMode } from '../../core/data/formulacell.ts';
import type { ScDocument } from '../../core/data/document.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { CRFlags } from '../../../inc/global.ts';
import { SvNumFormatType } from '../../../../svl/source/numbers/zformat.ts';
import { FormatOoxAddress } from '../oox/addressconverter.ts';
import { SaveHyperlinksXml, XclExpSst, type XclExpHyperlink } from './xecontent.ts';
import type { XclExpNote } from './xeescher.ts';
import { ToARGB, type XclExpXFBuffer } from './xestyle.ts';

const ToPsz = (b: boolean) => (b ? 'true' : 'false');
const convertTwipToMm100 = (n: number) => Math.round((n * 127) / 72);

/** XclTools::GetXclColumnWidth: 1/256 of the character width. */
export const GetXclColumnWidth = (nScWidth: number, nScCharWidth: number) => Math.max(0, Math.min(0xffff, Math.trunc(((nScWidth + 0.5) * 256.0) / nScCharWidth)));

/** lcl_GetErrorString (xestream.cxx) with XclTools::GetXclErrorCode */
export function lcl_GetErrorString(nScErrCode: FormulaError): string {
  switch (nScErrCode) {
    case FormulaError.IllegalArgument: case FormulaError.IllegalParameter: case FormulaError.PairExpected: case FormulaError.OperatorExpected:
    case FormulaError.VariableExpected: case FormulaError.ParameterExpected: case FormulaError.NoValue: case FormulaError.CircularReference: return '#VALUE!';
    case FormulaError.IllegalFPOperation: return '#NUM!';
    case FormulaError.DivisionByZero: return '#DIV/0!';
    case FormulaError.NoCode: return '#NULL!';
    case FormulaError.NoRef: return '#REF!';
    case FormulaError.NoName: case FormulaError.NoAddin: case FormulaError.NoMacro: return '#NAME?';
    case FormulaError.NotAvailable:
    default: return '#N/A';
  }
}

/** XclXmlUtils::GetFormulaTypeAndValue */
function GetFormulaTypeAndValue(rCell: ScFormulaCell, bBooleanFormat: boolean): { sType: string | null; sValue: string } {
  const aResValue = rCell.GetResult();
  switch (aResValue.meType) {
    case 'Error': return { sType: 'e', sValue: lcl_GetErrorString(aResValue.mnError) };
    case 'Value': {
      const b = (rCell.GetFormatType() === SvNumFormatType.LOGICAL || bBooleanFormat) && (aResValue.mfValue === 0.0 || aResValue.mfValue === 1.0);
      return { sType: b ? 'b' : null, sValue: Number.isFinite(aResValue.mfValue) ? String(aResValue.mfValue) : '0' };
    }
    case 'String': return { sType: 'str', sValue: rCell.GetString() };
    default: return { sType: 'str', sValue: rCell.GetString() };
  }
}

const isUrl = (p: EditTextObject) => p.GetParagraphs().some((para) => para.maCharAttribs.some((r) => r.aAttribs.URL !== undefined));
const urlOf = (p: EditTextObject) => { for (const para of p.GetParagraphs()) for (const r of para.maCharAttribs) if (r.aAttribs.URL) return r.aAttribs.URL; return ''; };

export interface XclExpSheetResult { xml: string; hyperlinkRels: string[]; notes: XclExpNote[] }

/** The worksheet part (without the closing legacyDrawing, which the caller inserts). */
export function SaveCellTableXml(rDoc: ScDocument, nTab: number, rXF: XclExpXFBuffer, rSst: XclExpSst,
  aHeadXml: { sheetPr: string; sheetViews: string; afterData: string; page: string }, nNotesRel: string | null): XclExpSheetResult {
  const pTab = rDoc.FetchTable(nTab)!;
  const nMaxCol = rDoc.MaxCol(), nMaxRow = rDoc.MaxRow();
  const pDefPattern = rDoc.GetDefPattern();
  const nCharWidth = rXF.mnCharWidth;

  // *** columns *** (XclExpColinfoBuffer)
  const aCols = pTab.GetColumns();
  interface ColInfo { nWidth: number; nScWidth: number; bHidden: boolean; nXF: number; pDefault: ScPatternAttr }
  const colInfo = (nCol: number): ColInfo => {
    const pCol = aCols[nCol];
    const pDefault = pCol ? pCol.GetPattern(nMaxRow) : pDefPattern;
    // column width. If column is hidden then we should return real value (not zero)
    const nScWidth = rDoc.GetColWidth(nCol, nTab, false);
    return { nWidth: GetXclColumnWidth(nScWidth, nCharWidth), nScWidth: convertTwipToMm100(nScWidth), bHidden: rDoc.ColHidden(nCol, nTab), nXF: pCol ? rXF.Insert(pDefault) : 0, pDefault };
  };
  const aColInfos: ColInfo[] = [];
  // collect use count of column width
  const aWidthMap = new Map<number, number>();
  let nMaxColCount = 0, nMaxUsedWidth = 0;
  for (let nCol = 0; nCol <= nMaxCol; nCol++) {
    const c = colInfo(nCol);
    aColInfos.push(c);
    const n = (aWidthMap.get(c.nWidth) ?? 0) + 1;
    aWidthMap.set(c.nWidth, n);
    if (n > nMaxColCount) { nMaxColCount = n; nMaxUsedWidth = c.nWidth; }
  }
  // XclExpDefcolwidth::SetDefWidth / IsDefWidth
  const fDefColWidth = nMaxUsedWidth / 256.0;
  const IsDefWidth = (nXclColWidth: number) => Math.abs(256.0 * fDefColWidth - nXclColWidth) < 256.0 / 16.0;
  let colsXml = '';
  for (let nCol = 0; nCol <= nMaxCol;) {
    const c = aColInfos[nCol]!;
    let nLast = nCol;
    while (nLast + 1 <= nMaxCol && aColInfos[nLast + 1]!.nScWidth === c.nScWidth && aColInfos[nLast + 1]!.bHidden === c.bHidden && aColInfos[nLast + 1]!.nXF === c.nXF) nLast++;
    const bCustomWidth = !IsDefWidth(c.nWidth);
    if (c.nXF !== 0 || c.bHidden || bCustomWidth) {
      // tdf#101363 In MS specification the output value is set with double precision after delimiter
      const nExcelColumnWidth = c.nScWidth / ((nCharWidth * 127) / 72);
      const nTruncatedExcelColumnWidth = Math.trunc(nExcelColumnWidth * 100.0 + 0.5) / 100.0;
      colsXml += `<col collapsed="false" customWidth="${ToPsz(bCustomWidth)}" hidden="${ToPsz(c.bHidden)}" outlineLevel="0" max="${nLast + 1}" min="${nCol + 1}" style="${c.nXF}" width="${nTruncatedExcelColumnWidth}"/>`;
    }
    nCol = nLast + 1;
  }

  // *** rows and cells ***
  const aRows = new Map<number, Set<number>>();
  const addCell = (nRow: number, nCol: number) => { let s = aRows.get(nRow); if (!s) aRows.set(nRow, s = new Set()); s.add(nCol); };
  aCols.forEach((pCol, nCol) => {
    pCol.ForEachCell(0, nMaxRow, (nRow) => addCell(nRow, nCol));
    const pColDefault = aColInfos[nCol]!.pDefault;
    let nStart = 0;
    for (const e of pCol.pAttrArray.GetEntries()) {
      if (e.pPattern !== pColDefault && !e.pPattern.equals(pColDefault)) for (let r = nStart; r <= e.nEndRow; r++) addCell(r, nCol);
      nStart = e.nEndRow + 1;
    }
  });
  // row heights and flags
  const rState = pTab.GetRowHeightsState();
  const nDefHeight = rState.heights.getValue(nMaxRow);
  const bDefHidden = rState.hidden.getValue(nMaxRow);
  const bDefManual = (rState.flags.getValue(nMaxRow) & CRFlags.ManualSize) !== 0;
  for (const r of rState.heights.runs(0, nMaxRow)) if (r.mnValue !== nDefHeight) for (let n = r.mnPos1; n <= r.mnPos2; n++) if (!aRows.has(n)) aRows.set(n, new Set());
  for (const r of rState.hidden.runs(0, nMaxRow)) if (r.mnValue !== bDefHidden) for (let n = r.mnPos1; n <= r.mnPos2; n++) if (!aRows.has(n)) aRows.set(n, new Set());
  for (const r of rState.flags.runs(0, nMaxRow)) if (((r.mnValue & CRFlags.ManualSize) !== 0) !== bDefManual) for (let n = r.mnPos1; n <= r.mnPos2; n++) if (!aRows.has(n)) aRows.set(n, new Set());

  const aMerged: string[] = [];
  const aLinks: XclExpHyperlink[] = [];
  let nMinRow = -1, nMaxUsedRow = -1, nMinCol = nMaxCol + 1, nMaxUsedCol = -1;
  let dataXml = '';
  for (const nRow of [...aRows.keys()].sort((a, b) => a - b)) {
    const nHeight = rState.heights.getValue(nRow);
    const bHidden = rState.hidden.getValue(nRow);
    const bManual = (rState.flags.getValue(nRow) & CRFlags.ManualSize) !== 0;
    let rowXml = '';
    const aRowCols = [...aRows.get(nRow)!].sort((a, b) => a - b);
    for (const nCol of aRowCols) {
      const pCol = aCols[nCol]!;
      const pPattern = pCol.GetPattern(nRow);
      const nXF = rXF.Insert(pPattern);
      const aRef = FormatOoxAddress(nCol, nRow);
      const s = ` s="${nXF}"`;
      if (pPattern.IsMerged()) {
        const m = pPattern.GetItem('ATTR_MERGE');
        aMerged.push(`${aRef}:${FormatOoxAddress(nCol + Math.max(1, m.nColMerge) - 1, nRow + Math.max(1, m.nRowMerge) - 1)}`);
      }
      const aHyper = pPattern.GetItem('ATTR_HYPERLINK');
      if (aHyper) aLinks.push({ ref: aRef, url: aHyper });
      const p = pCol.GetCellData(nRow);
      if (p === undefined) rowXml += `<c r="${aRef}"${s}/>`;
      else if (typeof p === 'number') rowXml += `<c r="${aRef}"${s} t="n"><v>${Number.isFinite(p) ? p : 0}</v></c>`;
      else if (typeof p === 'string') rowXml += `<c r="${aRef}"${s} t="s"><v>${rSst.Insert(p)}</v></c>`;
      else if (p instanceof EditTextObject) {
        if (isUrl(p)) aLinks.push({ ref: aRef, url: urlOf(p) });
        rowXml += `<c r="${aRef}"${s} t="s"><v>${rSst.InsertRich(p, pPattern)}</v></c>`;
      } else if (p instanceof ScFormulaCell) {
        // XclExpFormulaCell::SaveXml
        const { sType, sValue } = GetFormulaTypeAndValue(p, pPattern.GetNumberFormat().toUpperCase() === 'BOOLEAN');
        let f = '';
        if (p.GetMatrixFlag() === ScMatrixMode.Formula) {
          const { nCols, nRows } = p.GetMatColsRows();
          const aEnd = FormatOoxAddress(Math.min(nMaxCol, nCol + Math.max(1, nCols) - 1), Math.min(nMaxRow, nRow + Math.max(1, nRows) - 1));
          f = `<f t="array" ref="${aRef}:${aEnd}" aca="false">${escapeXml(p.GetFormula(FormulaGrammar.GRAM_OOXML).replace(/^\{=|\}$/g, ''))}</f>`;
        } else if (p.GetMatrixFlag() === ScMatrixMode.NONE) {
          f = `<f aca="false">${escapeXml(p.GetFormula(FormulaGrammar.GRAM_OOXML).replace(/^=/, ''))}</f>`;
        }
        rowXml += `<c r="${aRef}"${s}${sType ? ` t="${sType}"` : ''}>${f}<v>${escapeXml(sValue)}</v></c>`;
      }
      nMinCol = Math.min(nMinCol, nCol); nMaxUsedCol = Math.max(nMaxUsedCol, nCol);
    }
    if (rowXml) { if (nMinRow < 0) nMinRow = nRow; nMaxUsedRow = nRow; }
    dataXml += `<row r="${nRow + 1}"${aRowCols.length ? ` spans="${aRowCols[0]! + 1}:${aRowCols[aRowCols.length - 1]! + 1}"` : ''} ht="${nHeight / 20}" hidden="${ToPsz(bHidden)}" customHeight="${ToPsz(bManual)}" outlineLevel="0" collapsed="false">${rowXml}</row>`;
  }

  // notes
  const aNotes: XclExpNote[] = [];
  aCols.forEach((pCol, nCol) => { for (const nRow of pCol.GetNoteRows()) aNotes.push({ nCol, nRow, pNote: pCol.GetCellNote(nRow)! }); });
  aNotes.sort((a, b) => a.nRow - b.nRow || a.nCol - b.nCol);

  const aDim = nMinRow < 0 ? 'A1' : `${FormatOoxAddress(nMinCol, nMinRow)}:${FormatOoxAddress(nMaxUsedCol, nMaxUsedRow)}`;
  const hyperlinkRels: string[] = [];
  const hyperlinks = SaveHyperlinksXml(aLinks, (t) => { hyperlinkRels.push(t); return `rIdLink${hyperlinkRels.length}`; });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + aHeadXml.sheetPr
    + `<dimension ref="${aDim}"/>`
    + aHeadXml.sheetViews
    + `<sheetFormatPr defaultColWidth="${fDefColWidth}" defaultRowHeight="${nDefHeight / 20}" customHeight="${ToPsz(bDefManual)}" zeroHeight="${ToPsz(bDefHidden)}" outlineLevelRow="0" outlineLevelCol="0"/>`
    + (colsXml ? `<cols>${colsXml}</cols>` : '')
    + `<sheetData>${dataXml}</sheetData>`
    + aHeadXml.afterData
    + (aMerged.length ? `<mergeCells count="${aMerged.length}">${aMerged.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '')
    + hyperlinks
    + aHeadXml.page
    + (nNotesRel && aNotes.length ? `<legacyDrawing r:id="${nNotesRel}"/>` : '')
    + '</worksheet>';
  return { xml, hyperlinkRels, notes: aNotes };
}

/** The sheetPr element: the tab colour and fitToPage. */
export function SaveSheetPrXml(rTabColor: string | null, bFitToPages: boolean): string {
  return `<sheetPr filterMode="false">${rTabColor ? `<tabColor rgb="${ToARGB(rTabColor)}"/>` : ''}<pageSetUpPr fitToPage="${ToPsz(bFitToPages)}"/></sheetPr>`;
}
