// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/worksheetfragment.cxx reduced
// @upstream sc/source/filter/oox/worksheethelper.cxx reduced
// @upstream sc/source/filter/oox/sheetdatacontext.cxx reduced
// @upstream sc/source/filter/oox/sheetdatabuffer.cxx reduced
// @upstream sc/source/filter/oox/formulabuffer.cxx reduced
// @upstream sc/source/filter/oox/worksheetsettings.cxx reduced
// @upstream sc/source/filter/oox/commentsbuffer.cxx reduced
// WorksheetFragment: one worksheet part. The sheet properties (tab colour, fit to pages), the
// sheet views, the default and the explicit column and row settings (WorksheetGlobals'
// convertColumns/convertRows: widths in digits of the default font, heights in points, hidden,
// custom heights), the cells of sheetData (numbers, shared and inline strings, rich text,
// booleans and errors as formulas as upstream, ISO dates, formulas with their cached results,
// shared formulas, array formulas), the cell, row and column formats (XFs), merged cells,
// hyperlinks, cell notes (comments part, shown state from the VML drawing), sheet protection
// without its password and the page settings. Reduced: the formula buffer keeps formula strings
// (compiled in the OOXML grammar) instead of token sequences; cached error results are
// recalculated; boolean cells and boolean formula results without a number format get the
// BOOLEAN format (the port shows a formula's result type through the cell format only); a row
// format is applied to the used columns only (beyond them it is reported); outline groups,
// conditional formatting, data validation, autofilters, tables, drawings, charts, controls,
// sparklines and other unsupported parts are reported through `lost`; the BIFF12 records are not
// read.
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScAddress, ScRange } from '../../../inc/address.ts';
import { ScPatternAttr } from '../../../inc/patattr.ts';
import { CELLTYPE_EDIT, CELLTYPE_STRING } from '../../../inc/cellvalue.ts';
import { EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import { ScFormulaCell } from '../../core/data/formulacell.ts';
import type { ScDocumentImport } from '../../core/data/documentimport.ts';
import type { ScDocument } from '../../core/data/document.ts';
import type { ScPostIt } from '../../core/data/column.ts';
import { childElements, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import type { AttributeList } from '../../../../oox/source/helper/attributelist.ts';
import { AddressConverter, parseOoxAddress2d } from './addressconverter.ts';
import { PageSettings } from './pagesettings.ts';
import { RichString, type SharedStringsBuffer } from './richstring.ts';
import { attrs, kid, kids, ln, XlsColor, type StylesBuffer } from './stylesbuffer.ts';
import { Unit, type UnitConverter } from './unitconverter.ts';
import { SheetViewSettings, type ViewSettings } from './viewsettings.ts';

/** The services a worksheet import uses (WorkbookHelper's getters). */
export interface WorkbookContext {
  doc: ScDocument;
  docImport: ScDocumentImport;
  styles: StylesBuffer;
  strings: SharedStringsBuffer;
  unitConverter: UnitConverter;
  addressConverter: AddressConverter;
  viewSettings: ViewSettings;
  lost: Set<string>;
  /** isMSODocument: written by Microsoft Excel (row heights are rounded down to 0.75 pt). */
  bMSODocument: boolean;
  /** The package's parts, an XML part parser and the relations of a part. */
  xml(path: string): XmlElement | undefined;
  text(path: string): string | undefined;
  rels(part: string): Map<string, { type: string; target: string; external: boolean }>;
  /** Calc sheet names by the names in the file (for hyperlink locations). */
  sheetNames: string[];
}

interface ColumnModel { mnFirst: number; mnLast: number; mfWidth: number; mnXfId: number; mnLevel: number; mbHidden: boolean; mbCollapsed: boolean }
interface RowModel { mnRow: number; mfHeight: number; mnXfId: number; mnLevel: number; mbCustomHeight: boolean; mbCustomFormat: boolean; mbHidden: boolean }

/** A buffered cell format: rows of a column with one XF. */
interface XfRun { nRow1: number; nRow2: number; nXfId: number }

interface SharedFormula { aBase: ScAddress; aFormula: string }
interface SharedFormulaRef { aPos: ScAddress; nSharedId: number; aValue: string; aType: string }

const textOf = (e: XmlElement | undefined): string => (e ? e.children.map((c) => (typeof c === 'string' ? c : '')).join('') : '');

/** The cached result of a formula cell (setCellFormulaValue): a number or a string; null for an
    error or no result (the cell is calculated after loading). */
function cachedResult(aValue: string | null, aType: string): number | string | null {
  if (aValue === null) return null;
  switch (aType) {
    case 'n': { const f = Number(aValue); return aValue !== '' && Number.isFinite(f) ? f : null; }
    case 'b': { const f = Number(aValue); return (Number.isFinite(f) && f !== 0) || aValue.toLowerCase() === 'true' ? 1 : 0; }
    case 'str': case 'inlineStr': case 's': return aValue;
    default: return null;
  }
}

export class WorksheetFragment {
  private readonly mrCtx: WorkbookContext;
  private readonly mnTab: number;
  private readonly maPart: string;
  private maDefColModel: ColumnModel = { mnFirst: 0, mnLast: 0, mfWidth: 8.5, mnXfId: -1, mnLevel: 0, mbHidden: false, mbCollapsed: false };
  private mbHasDefWidth = false;
  private maDefRowModel: RowModel = { mnRow: 0, mfHeight: 0, mnXfId: -1, mnLevel: 0, mbCustomHeight: false, mbCustomFormat: false, mbHidden: false };
  private maColModels: ColumnModel[] = [];
  private maRowModels: RowModel[] = [];
  private maXfRuns = new Map<number, XfRun[]>();
  private maColXfs: { nCol1: number; nCol2: number; nXfId: number }[] = [];
  private maRowXfs: { nRow: number; nXfId: number }[] = [];
  private maMerged: ScRange[] = [];
  private maSharedFormulas = new Map<number, SharedFormula>();
  private maSharedRefs: SharedFormulaRef[] = [];
  private maArrayFormulas: { aRange: ScRange; aFormula: string }[] = [];
  private maBoolCells: ScAddress[] = [];
  private maHyperlinks: { aRange: ScRange; aTarget: string; aLocation: string }[] = [];
  private mnMaxUsedCol = -1;
  readonly maPageSett = new PageSettings();
  readonly maSheetViewSett = new SheetViewSettings();
  private mnRow = -1;
  private mnCol = -1;

  constructor(rCtx: WorkbookContext, nTab: number, aPart: string) {
    this.mrCtx = rCtx;
    this.mnTab = nTab;
    this.maPart = aPart;
  }

  private lose(s: string): void { this.mrCtx.lost.add(s); }

  /** initializeWorksheetImport: the default cell style for unused cells (created with the
      attributes of Excel's Normal style; Calc's default pattern uses "Default" already). */
  initializeImport(): void {
    this.mrCtx.styles.getDefaultStyleName();
  }

  importFragment(rRoot: XmlElement): void {
    const rRels = this.mrCtx.rels(this.maPart);
    for (const e of childElements(rRoot)) {
      const a = attrs(e);
      switch (ln(e)) {
        case 'sheetPr': this.importSheetPr(e); break;
        case 'dimension': break;
        case 'sheetViews':
          for (const v of kids(e, 'sheetView')) {
            this.maSheetViewSett.importSheetView(attrs(v));
            for (const c of kids(v)) {
              if (ln(c) === 'pane') this.maSheetViewSett.importPane(attrs(c));
              else if (ln(c) === 'selection') this.maSheetViewSett.importSelection(attrs(c));
            }
          }
          break;
        case 'sheetFormatPr': this.importSheetFormatPr(a); break;
        case 'cols': for (const c of kids(e, 'col')) this.importCol(attrs(c)); break;
        case 'sheetData': this.importSheetData(e); break;
        case 'sheetCalcPr': break;
        case 'sheetProtection':
          // worksheetsettings.cxx: the protection flags; the password hash is not kept
          if (a.getBool('sheet', false)) {
            this.mrCtx.doc.SetTabProtection(this.mnTab, true);
            if (a.hasAttribute('password') || a.hasAttribute('hashValue')) this.lose('Sheet protection passwords (the sheets stay protected without a password)');
          }
          break;
        case 'protectedRanges': this.lose('Protected ranges'); break;
        case 'scenarios': this.lose('Scenarios'); break;
        case 'autoFilter': this.lose('AutoFilter'); break;
        case 'sortState': break;
        case 'dataConsolidate': this.lose('Data consolidation settings'); break;
        case 'customSheetViews': this.lose('Custom views'); break;
        case 'mergeCells':
          for (const c of kids(e, 'mergeCell')) {
            const r = this.mrCtx.addressConverter.convertToCellRange(attrs(c).getString('ref', '')!, this.mnTab);
            if (r) this.maMerged.push(r);
          }
          break;
        case 'phoneticPr': break;
        case 'conditionalFormatting': this.lose('Conditional formatting'); break;
        case 'dataValidations': this.lose('Data validation'); break;
        case 'hyperlinks':
          for (const h of kids(e, 'hyperlink')) {
            const ha = attrs(h);
            const r = this.mrCtx.addressConverter.convertToCellRange(ha.getString('ref', '')!, this.mnTab);
            if (!r) continue;
            const rel = rRels.get(h.attrs.get('r:id') ?? '');
            this.maHyperlinks.push({ aRange: r, aTarget: rel ? rel.target : '', aLocation: ha.getXString('location', '')! });
          }
          break;
        case 'printOptions': this.maPageSett.importPrintOptions(a); break;
        case 'pageMargins': this.maPageSett.importPageMargins(a); break;
        case 'pageSetup': this.maPageSett.importPageSetup(a); break;
        case 'headerFooter':
          this.maPageSett.importHeaderFooter(a);
          for (const c of kids(e)) this.maPageSett.importHeaderFooterCharacters(textOf(c), ln(c));
          break;
        case 'rowBreaks': case 'colBreaks': if (kids(e, 'brk').length) this.lose('Manual page breaks'); break;
        case 'ignoredErrors': break;
        case 'cellWatches': this.lose('Cell watches'); break;
        case 'smartTags': break;
        case 'drawing': this.importDrawing(rRels.get(e.attrs.get('r:id') ?? '')?.target); break;
        case 'legacyDrawing': break; // the comments' VML drawing (form controls are reported below)
        case 'legacyDrawingHF': this.lose('Header and footer pictures'); break;
        case 'drawingHF': this.lose('Header and footer pictures'); break;
        case 'picture': this.lose('Sheet background pictures'); break;
        case 'oleObjects': this.lose('OLE objects'); break;
        case 'controls': this.lose('Form controls'); break;
        case 'webPublishItems': break;
        case 'tableParts': if (kids(e, 'tablePart').length) this.lose('Tables (database ranges)'); break;
        case 'extLst': this.importExtLst(e); break;
        case 'AlternateContent': case 'mc:AlternateContent': {
          const c = kid(e, 'mc:Choice') ?? childElements(e)[0];
          const t = c && childElements(c)[0];
          if (t && ln(t) === 'controls') this.lose('Form controls');
          else if (t && ln(t) === 'oleObjects') this.lose('OLE objects');
          break;
        }
      }
    }
    // comments and pivot tables are related parts
    for (const [, rel] of rRels) {
      if (/\/comments$/.test(rel.type)) this.importComments(rel.target);
      else if (/\/pivotTable$/.test(rel.type)) this.lose('Pivot tables');
      else if (/\/(ctrlProp|control)$/.test(rel.type)) this.lose('Form controls');
      else if (/\/threadedComment$/.test(rel.type)) { /* threaded comments have their plain comments too */ }
    }
  }

  private importSheetPr(e: XmlElement): void {
    for (const c of kids(e)) {
      switch (ln(c)) {
        case 'tabColor': {
          // worksheetsettings.cxx: importTabColor
          const col = new XlsColor();
          col.importColor(attrs(c));
          const s = this.mrCtx.styles.getColor(col, null);
          if (s) this.mrCtx.doc.SetTabBgColor(this.mnTab, s);
          break;
        }
        case 'pageSetUpPr':
          this.maPageSett.setFitToPagesMode(attrs(c).getBool('fitToPage', false));
          break;
        case 'outlinePr': break;
      }
    }
  }

  private importExtLst(e: XmlElement): void {
    for (const ext of kids(e)) {
      for (const c of childElements(ext)) {
        const n = c.name.replace(/^.*:/, '');
        if (n === 'conditionalFormattings') this.lose('Conditional formatting');
        else if (n === 'dataValidations') this.lose('Data validation');
        else if (n === 'sparklineGroups') this.lose('Sparklines');
        else if (n === 'slicerList') this.lose('Slicers');
        else if (n === 'protectedRanges') this.lose('Protected ranges');
      }
    }
  }

  private importDrawing(aTarget: string | undefined): void {
    if (!aTarget) return;
    let bChart = false, bOther = false;
    for (const [, rel] of this.mrCtx.rels(aTarget)) {
      if (/\/chart$/.test(rel.type)) bChart = true;
      else bOther = true;
    }
    const x = this.mrCtx.text(aTarget) ?? '';
    if (bChart) this.lose('Charts');
    if (bOther || /<xdr:sp\b|<xdr:cxnSp\b|<xdr:pic\b|<xdr:grpSp\b/.test(x.replace(/<xdr:graphicFrame[\s\S]*?<\/xdr:graphicFrame>/g, ''))) this.lose('Images and drawing objects');
  }

  private importSheetFormatPr(rAttribs: AttributeList): void {
    // default column settings
    this.setBaseColumnWidth(rAttribs.getInteger('baseColWidth', 8));
    this.setDefaultColumnWidth(rAttribs.getDouble('defaultColWidth', 0.0));
    // default row settings
    let fDefaultRowHeight = rAttribs.getDouble('defaultRowHeight', 0.0);
    if (this.mrCtx.bMSODocument) fDefaultRowHeight -= fDefaultRowHeight % 0.75; //round down to 0.75pt
    this.maDefRowModel.mfHeight = fDefaultRowHeight;
    this.maDefRowModel.mbCustomHeight = rAttribs.getBool('customHeight', false);
    this.maDefRowModel.mbHidden = rAttribs.getBool('zeroHeight', false);
  }

  private setBaseColumnWidth(nWidth: number): void {
    // do not modify width, if setDefaultColumnWidth() has been used
    if (!this.mbHasDefWidth && (nWidth > 0)) {
      // #i3006# add 5 pixels padding to the width
      this.maDefColModel.mfWidth = nWidth + this.mrCtx.unitConverter.scaleValue(5, Unit.ScreenX, Unit.Digit);
    }
  }

  private setDefaultColumnWidth(fWidth: number): void {
    // overrides a width set with setBaseColumnWidth()
    if (fWidth > 0.0) {
      this.maDefColModel.mfWidth = fWidth;
      this.mbHasDefWidth = true;
    }
  }

  private importCol(rAttribs: AttributeList): void {
    const aModel: ColumnModel = {
      mnFirst: rAttribs.getInteger('min', -1), mnLast: rAttribs.getInteger('max', -1), mfWidth: rAttribs.getDouble('width', 0.0),
      mnXfId: rAttribs.getInteger('style', -1), mnLevel: rAttribs.getInteger('outlineLevel', 0), mbHidden: rAttribs.getBool('hidden', false),
      mbCollapsed: rAttribs.getBool('collapsed', false),
    };
    // setColumnModel: convert 1-based OOXML column indexes to 0-based API column indexes
    const nFirstCol = aModel.mnFirst - 1;
    let nLastCol = aModel.mnLast - 1;
    const nMaxCol = this.mrCtx.doc.MaxCol();
    if (!(nFirstCol >= 0 && nFirstCol <= nMaxCol && nFirstCol <= nLastCol)) return;
    // Validate last column index.
    // If last column is equal to last possible column, Excel adds one
    // more. We do that also in XclExpColinfo::SaveXml() and for 1024 end
    // up with 1025 instead, which would lead to excess columns in
    // checkCol(). Cater for this oddity.
    if (nLastCol === nMaxCol + 1) --nLastCol;
    nLastCol = Math.min(nLastCol, nMaxCol);
    this.maColModels.push({ ...aModel, mnFirst: nFirstCol, mnLast: nLastCol });
    // set column formatting
    if (aModel.mnXfId >= 0) this.maColXfs.push({ nCol1: nFirstCol, nCol2: nLastCol, nXfId: aModel.mnXfId });
    if (aModel.mnLevel > 0) this.lose('Outline (grouped rows and columns)');
  }

  // --- sheetData ---------------------------------------------------------------------------

  private importSheetData(rSheetData: XmlElement): void {
    const rDoc = this.mrCtx.doc;
    for (const row of kids(rSheetData, 'row')) {
      const a = attrs(row);
      const nRow = a.getInteger('r', -1); // 1-based row index
      if (nRow !== -1) this.mnRow = nRow - 1; // to 0-based row index.
      else ++this.mnRow; // increment 0-based row index
      if (this.mnRow > rDoc.MaxRow()) continue;
      this.mnCol = -1;
      const aModel: RowModel = {
        mnRow: this.mnRow, mfHeight: a.getDouble('ht', -1.0), mnXfId: a.getInteger('s', 0), mnLevel: a.getInteger('outlineLevel', 0),
        mbCustomHeight: a.getBool('customHeight', false), mbCustomFormat: a.getBool('customFormat', false), mbHidden: a.getBool('hidden', false),
      };
      if (aModel.mfHeight > 0 && this.mrCtx.bMSODocument) aModel.mfHeight -= aModel.mfHeight % 0.75; //round down to 0.75pt
      if (aModel.mnLevel > 0) this.lose('Outline (grouped rows and columns)');
      this.maRowModels.push(aModel);
      // set row formatting
      if (aModel.mbCustomFormat) this.maRowXfs.push({ nRow: this.mnRow, nXfId: aModel.mnXfId });
      for (const c of kids(row, 'c')) this.importCell(c);
    }
  }

  private importCell(rCell: XmlElement): void {
    const a = attrs(rCell);
    const r = a.getString('r');
    const p = r ? parseOoxAddress2d(r) : null;
    // an invalid address continues after the previous cell of the row
    if (p) this.mnCol = p.nCol;
    else ++this.mnCol;
    const rDoc = this.mrCtx.doc;
    if (this.mnCol > rDoc.MaxCol() || this.mnRow > rDoc.MaxRow() || this.mnCol < 0) return;
    const aPos = new ScAddress(this.mnCol, this.mnRow, this.mnTab);
    const nXfId = a.getInteger('s', -1);
    const aType = a.getToken('t', 'n');
    this.mnMaxUsedCol = Math.max(this.mnMaxUsedCol, this.mnCol);

    const vEl = kid(rCell, 'v');
    const aValue = vEl ? textOf(vEl) : null;
    const fEl = kid(rCell, 'f');
    const rImp = this.mrCtx.docImport;
    let bHasFormula = false;

    if (fEl) {
      const fa = attrs(fEl);
      const nType = fa.getToken('t', 'normal');
      const aFormula = textOf(fEl);
      bHasFormula = true;
      switch (nType) {
        case 'normal': {
          // setCellFormula, with the preloaded value
          rImp.setFormulaCell(aPos, aFormula, FormulaGrammar.GRAM_OOXML, cachedResult(aValue, aType));
          // a boolean result gets the boolean format if the cell has none (applyCellFormulaValues)
          if (aType === 'b' && aValue !== null) this.maBoolCells.push(aPos);
          break;
        }
        case 'shared': {
          const nSharedId = fa.getInteger('si', -1);
          if (nSharedId >= 0) {
            const aRef = fa.getString('ref');
            if (aRef && aFormula) this.maSharedFormulas.set(nSharedId, { aBase: aPos.clone(), aFormula });
            this.maSharedRefs.push({ aPos, nSharedId, aValue: aValue ?? '', aType: aValue === null ? '' : aType });
            if (aType === 'b' && aValue !== null) this.maBoolCells.push(aPos);
          } else bHasFormula = false;
          break;
        }
        case 'array': {
          const aRange = this.mrCtx.addressConverter.convertToCellRange(fa.getString('ref', '')!, this.mnTab);
          if (aRange && aRange.aStart.equals(aPos)) this.maArrayFormulas.push({ aRange, aFormula });
          // set cell formatting, but do not set result as cell value
          break;
        }
        case 'dataTable':
          this.lose('Multiple operations (data tables; their results are kept as values)');
          bHasFormula = false;
          break;
        default:
          bHasFormula = false;
      }
    }

    if (!bHasFormula) {
      // no formula created: try to set the cell value
      if (aValue !== null && aValue !== '') {
        switch (aType) {
          case 'n': { const f = Number(aValue); if (Number.isFinite(f)) rImp.setNumericCell(aPos, f); break; }
          case 'b': {
            // Some generators may write true or false instead of 1 or 0.
            const fValue = Number(aValue);
            let bValue = Number.isFinite(fValue) && fValue !== 0;
            if (!bValue && aValue.toLowerCase() === 'true') bValue = true;
            // setBooleanCell: a formula (calculated after loading), with the 'Standard' number format
            rImp.setFormulaCell(aPos, bValue ? 'TRUE()' : 'FALSE()', FormulaGrammar.GRAM_OOXML);
            // the port's formula cells show a boolean result by the cell's format only
            this.maBoolCells.push(aPos);
            break;
          }
          case 'e': rImp.setFormulaCell(aPos, aValue, FormulaGrammar.GRAM_OOXML); break;
          case 'str': this.setStringCell(aPos, aValue); break;
          case 's': {
            const xString = this.mrCtx.strings.getString(parseInt(aValue, 10));
            if (xString) this.setRichStringCell(aPos, xString, nXfId);
            break;
          }
          case 'd': this.setDateCell(aPos, aValue); break;
        }
      } else if (aType === 'inlineStr') {
        const isEl = kid(rCell, 'is');
        if (isEl) {
          const xInlineStr = new RichString();
          xInlineStr.importString(isEl, this.mrCtx.styles);
          xInlineStr.finalizeImport();
          if (xInlineStr.mbHasPhonetic) this.lose('Phonetic guides (furigana)');
          this.setRichStringCell(aPos, xInlineStr, nXfId);
        }
      }
    }
    // setCellFormat
    if (nXfId >= 0) this.setCellFormat(this.mnCol, this.mnRow, nXfId);
  }

  private setStringCell(aPos: ScAddress, rText: string): void {
    if (!rText) return;
    if (rText.includes('\n')) this.mrCtx.docImport.setEditCell(aPos, EditTextObject.FromText(rText));
    else this.mrCtx.docImport.setStringCell(aPos, rText);
  }

  private setRichStringCell(aPos: ScAddress, rxString: RichString, nXfId: number): void {
    const pFirstPortionFont = this.mrCtx.styles.getFontFromCellXf(nXfId);
    const aText = rxString.extractPlainString(pFirstPortionFont);
    if (aText !== null) this.setStringCell(aPos, aText);
    else this.mrCtx.docImport.setEditCell(aPos, rxString.convert(pFirstPortionFont));
  }

  private setDateCell(aPos: ScAddress, rDateString: string): void {
    const m = /^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/.exec(rDateString.trim());
    const m2 = !m && /^T?(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/.exec(rDateString.trim());
    if (!m && !m2) {
      // At least don't lose data.
      this.setStringCell(aPos, rDateString);
      return;
    }
    const n = (s: string | undefined) => Number(s ?? 0);
    const fSerial = m
      ? this.mrCtx.unitConverter.calcSerialFromDateTime({ Year: n(m[1]), Month: n(m[2]), Day: n(m[3]), Hours: n(m[4]), Minutes: n(m[5]), Seconds: n(m[6]), NanoSeconds: 0 })
      : n(m2 ? m2[1] : '0') / 24 + n(m2 ? m2[2] : '0') / 1440 + n(m2 ? m2[3] : '0') / 86400;
    this.mrCtx.docImport.setNumericCell(aPos, fSerial);
  }

  private setCellFormat(nCol: number, nRow: number, nXfId: number): void {
    let v = this.maXfRuns.get(nCol);
    if (!v) this.maXfRuns.set(nCol, v = []);
    const last = v[v.length - 1];
    if (last && last.nXfId === nXfId && last.nRow2 + 1 === nRow) last.nRow2 = nRow;
    else v.push({ nRow1: nRow, nRow2: nRow, nXfId });
  }

  // --- comments ----------------------------------------------------------------------------

  /** CommentsFragment and CommentsBuffer: the notes of the sheet, with the shown state of the
      VML shapes (x:Visible). */
  private importComments(aTarget: string): void {
    const root = this.mrCtx.xml(aTarget);
    const comments = root && childElements(root).find((e) => ln(e) === 'comments');
    if (!comments) return;
    const aAuthors = kids(kid(comments, 'authors'), 'author').map((e) => textOf(e));
    const aVisible = new Set<string>();
    for (const [, rel] of this.mrCtx.rels(this.maPart)) {
      if (!/\/vmlDrawing$/.test(rel.type)) continue;
      const vml = this.mrCtx.text(rel.target) ?? '';
      for (const shape of vml.match(/<x:ClientData\b[\s\S]*?<\/x:ClientData>/g) ?? []) {
        if (!/<x:Visible\s*\/?>/.test(shape)) continue;
        const r = /<x:Row>\s*(\d+)\s*<\/x:Row>/.exec(shape), c = /<x:Column>\s*(\d+)\s*<\/x:Column>/.exec(shape);
        if (r && c) aVisible.add(`${c[1]}:${r[1]}`);
      }
    }
    for (const c of kids(kid(comments, 'commentList'), 'comment')) {
      const a = attrs(c);
      const p = parseOoxAddress2d(a.getString('ref', '')!);
      if (!p) continue;
      const t = kid(c, 'text');
      const s = new RichString();
      if (t) { s.importString(t, this.mrCtx.styles); s.finalizeImport(); }
      if (s.maTextPortions.some((x) => x.hasFont())) this.lose('Formatting of note text');
      const pNote: ScPostIt = { maText: s.getStringContent(), maAuthor: aAuthors[a.getInteger('authorId', -1)] ?? '', maDate: '', mbShown: aVisible.has(`${p.nCol}:${p.nRow}`) };
      this.mrCtx.doc.SetNote(new ScAddress(p.nCol, p.nRow, this.mnTab), pNote);
    }
  }

  // --- finalize ----------------------------------------------------------------------------

  /** finalizeWorksheetImport: formulas, formats, merges, hyperlinks, columns and rows, page and
      view settings. */
  finalizeImport(bActiveSheet: boolean): void {
    const rDoc = this.mrCtx.doc;
    const nTab = this.mnTab;
    this.finalizeFormulas();

    // formats: columns, then rows, then cells
    const nMaxCol = rDoc.MaxCol(), nMaxRow = rDoc.MaxRow();
    for (const m of this.maColModels) if (m.mfWidth > 0 || m.mbHidden) this.mnMaxUsedCol = Math.max(this.mnMaxUsedCol, Math.min(m.mnLast, nMaxCol));
    for (const r of this.maMerged) this.mnMaxUsedCol = Math.max(this.mnMaxUsedCol, r.aEnd.Col());
    for (const { nCol1, nCol2, nXfId } of this.maColXfs) {
      const p = this.getPattern(nXfId);
      if (p) rDoc.SetPatternAreaTab(nCol1, 0, nCol2, nMaxRow, nTab, p);
    }
    for (const { nRow, nXfId } of this.maRowXfs) {
      const p = this.getPattern(nXfId);
      if (!p) continue;
      const nLastCol = Math.max(0, this.mnMaxUsedCol);
      rDoc.SetPatternAreaTab(0, nRow, nLastCol, nRow, nTab, p);
      if (nLastCol < nMaxCol && !p.equals(rDoc.GetDefPattern()) && nXfId !== 0) this.lose('Row formatting beyond the last used column');
    }
    for (const [nCol, v] of this.maXfRuns) {
      for (const run of v) {
        const p = this.getPattern(run.nXfId);
        if (p) rDoc.SetPatternAreaTab(nCol, run.nRow1, nCol, run.nRow2, nTab, p);
      }
    }
    // boolean formula results in cells without a number format show as booleans
    for (const aPos of this.maBoolCells) if (rDoc.GetNumberFormat(aPos) === 'General') rDoc.SetNumberFormat(aPos, 'BOOLEAN');
    // merged ranges
    for (const r of this.maMerged) if (r.aStart.Col() !== r.aEnd.Col() || r.aStart.Row() !== r.aEnd.Row()) rDoc.DoMerge(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), nTab);
    this.finalizeHyperlinkRanges();

    // page settings, view settings
    this.maPageSett.finalizeImport(rDoc, nTab, this.mrCtx.styles);
    const { aTable, xModel, bSelected } = this.maSheetViewSett.finalizeImport(bActiveSheet, nMaxCol, nMaxRow);
    // active tab/sheet cannot be hidden: always force it to be displayed
    if (bSelected && bActiveSheet) rDoc.SetVisible(nTab, true);
    if (this.maSheetViewSett.isSheetRightToLeft()) rDoc.SetLayoutRTL(nTab, true);
    this.mrCtx.viewSettings.setSheetViewSettings(nTab, aTable, xModel);

    this.convertColumns();
    this.convertRows();
  }

  private getPattern(nXfId: number): ScPatternAttr | null {
    const pXf = this.mrCtx.styles.getCellXf(nXfId);
    if (!pXf) return null;
    return this.mrCtx.styles.getCellPattern(nXfId, () => {
      const p = new ScPatternAttr(pXf.getStyleSheet(), pXf.createPattern());
      return this.mrCtx.doc.getCellAttributeHelper().registerAndCheck(p);
    });
  }

  /** FormulaBuffer::finalizeImport for this sheet: shared and array formulas. */
  private finalizeFormulas(): void {
    const rDoc = this.mrCtx.doc;
    const aMasters = new Map<number, ScFormulaCell>();
    for (const ref of this.maSharedRefs) {
      const sf = this.maSharedFormulas.get(ref.nSharedId);
      if (!sf) continue;
      let pMaster = aMasters.get(ref.nSharedId);
      if (!pMaster) aMasters.set(ref.nSharedId, pMaster = new ScFormulaCell(rDoc, sf.aBase, sf.aFormula, FormulaGrammar.GRAM_OOXML));
      const pCell = ref.aPos.equals(sf.aBase) ? new ScFormulaCell(rDoc, sf.aBase, sf.aFormula, FormulaGrammar.GRAM_OOXML) : pMaster.Clone(ref.aPos);
      const res = cachedResult(ref.aType ? ref.aValue : null, ref.aType);
      if (typeof res === 'number') { pCell.SetHybridDouble(res); pCell.ResetDirty(); } else if (typeof res === 'string') { pCell.SetHybridString(res); pCell.ResetDirty(); } else pCell.SetDirtyVar();
      rDoc.FetchTable(this.mnTab)?.CreateColumnIfNotExists(ref.aPos.Col()).SetCellRaw(ref.aPos.Row(), pCell);
    }
    for (const { aRange, aFormula } of this.maArrayFormulas) this.mrCtx.docImport.setMatrixCells(aRange, aFormula, FormulaGrammar.GRAM_OOXML);
  }

  private finalizeHyperlinkRanges(): void {
    const rDoc = this.mrCtx.doc;
    for (const link of this.maHyperlinks) {
      let aUrl = link.aTarget + (link.aLocation ? `#${link.aLocation}` : '');
      if (!aUrl) continue;
      if (aUrl.startsWith('#')) {
        const nSepPos = aUrl.lastIndexOf('!');
        // prefer '#SheetName.A1' (an A1 reference after the separator)
        if (nSepPos > 0 && nSepPos < aUrl.length - 1 && /^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?$/.test(aUrl.slice(nSepPos + 1))) aUrl = `${aUrl.slice(0, nSepPos)}.${aUrl.slice(nSepPos + 1)}`;
      }
      const r = link.aRange;
      for (let nRow = r.aStart.Row(); nRow <= r.aEnd.Row(); nRow++) {
        for (let nCol = r.aStart.Col(); nCol <= r.aEnd.Col(); nCol++) {
          const aAddress = new ScAddress(nCol, nRow, this.mnTab);
          const t = rDoc.GetCellType(aAddress);
          if (t === CELLTYPE_STRING || t === CELLTYPE_EDIT) {
            const aStr = rDoc.GetString(aAddress).replace(/\n/g, ' ');
            this.mrCtx.docImport.setEditCell(aAddress, new EditTextObject([{ aText: aStr, maCharAttribs: [{ nStart: 0, nEnd: aStr.length, aAttribs: { URL: aUrl } }] }]));
          } else rDoc.ApplyAttr(nCol, nRow, this.mnTab, { ATTR_HYPERLINK: aUrl });
        }
      }
    }
  }

  private convertColumns(): void {
    const nMaxCol = this.mrCtx.doc.MaxCol();
    const sorted = [...this.maColModels].sort((a, b) => a.mnFirst - b.mnFirst);
    let nNextCol = 0;
    for (const colModel of sorted) {
      // column indexes are stored 0-based in maColModels
      const nFirst = Math.max(colModel.mnFirst, nNextCol), nLast = Math.min(colModel.mnLast, nMaxCol);
      if (nFirst > nLast) continue;
      // process gap between two column models, use default column model
      if (nNextCol < nFirst) this.convertColumnRange(nNextCol, nFirst - 1, this.maDefColModel);
      // process the column model
      this.convertColumnRange(nFirst, nLast, colModel);
      // cache next column to be processed
      nNextCol = nLast + 1;
    }
    // remaining default columns to end of sheet
    if (nNextCol <= nMaxCol) this.convertColumnRange(nNextCol, nMaxCol, this.maDefColModel);
  }

  private convertColumnRange(nStartCol: number, nEndCol: number, rModel: ColumnModel): void {
    // column width: convert 'number of characters' to column width in twips
    const nWidth = Math.round(this.mrCtx.unitConverter.scaleValue(rModel.mfWidth, Unit.Digit, Unit.Twip));
    const rDoc = this.mrCtx.doc;
    const pTab = rDoc.FetchTable(this.mnTab);
    if (nWidth > 0 && pTab) for (let nCol = nStartCol; nCol <= nEndCol; ++nCol) pTab.SetColWidthOnly(nCol, nWidth);
    // hidden columns: TODO: #108683# hide columns later?
    if (rModel.mbHidden) rDoc.SetColHidden(nStartCol, nEndCol, this.mnTab, true);
  }

  private convertRows(): void {
    const nMaxRow = this.mrCtx.doc.MaxRow();
    let nNextRow = 0;
    for (const rowModel of this.maRowModels.sort((a, b) => a.mnRow - b.mnRow)) {
      const nRow = rowModel.mnRow;
      if (nRow < nNextRow) continue;
      // process gap between two row models, use default row model
      if (nNextRow < nRow) this.convertRowRange(nNextRow, nRow - 1, this.maDefRowModel, -1);
      // process the row model
      this.convertRowRange(nRow, nRow, rowModel, this.maDefRowModel.mfHeight);
      nNextRow = nRow + 1;
    }
    // remaining default rows to end of sheet
    if (nNextRow <= nMaxRow) this.convertRowRange(nNextRow, nMaxRow, this.maDefRowModel, -1);
  }

  private convertRowRange(nStartRow: number, nEndRow: number, rModel: RowModel, fDefHeight: number): void {
    // row height: convert points to row height in twips
    const fHeight = (rModel.mfHeight >= 0.0) ? rModel.mfHeight : fDefHeight;
    const nHeight = Math.round(fHeight * 20);
    const rDoc = this.mrCtx.doc;
    if (nHeight > 0) {
      /* always import the row height, ensures better layout */
      rDoc.SetRowHeightOnly(nStartRow, nEndRow, this.mnTab, nHeight);
      if (rModel.mbCustomHeight) rDoc.SetManualHeight(nStartRow, nEndRow, this.mnTab, true);
    }
    // hidden rows: TODO: #108683# hide rows later?
    if (rModel.mbHidden) rDoc.SetRowHidden(nStartRow, nEndRow, this.mnTab, true);
  }
}
