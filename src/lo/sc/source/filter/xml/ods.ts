// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/xml/xmlwrap.cxx reduced
// @upstream sc/source/filter/xml/xmlimprt.cxx reduced
// @upstream sc/source/filter/xml/xmlexprt.cxx reduced
// @upstream sc/source/filter/xml/xmltabi.cxx reduced
// @upstream sc/source/filter/xml/xmlrowi.cxx reduced
// @upstream sc/source/filter/xml/xmlcoli.cxx reduced
// @upstream sc/source/filter/xml/xmlcelli.cxx reduced
// @upstream sc/source/filter/xml/xmlnexpi.cxx reduced
// @upstream sc/source/filter/xml/xmlbodyi.cxx reduced
// @upstream sc/source/filter/xml/xmlstyli.cxx reduced
// @upstream sc/source/filter/xml/XMLStylesImportHelper.cxx reduced
// @upstream sc/source/ui/view/viewdata.cxx partial
// OpenDocument spreadsheets (ODS, OTS templates, flat FODS): ScXMLImportWrapper's streams
// (content.xml, styles.xml, meta.xml, settings.xml) read into an ScDocShell and written from one.
// Read and written: sheets (name, visibility, tab colour, page style, protection flag, print
// ranges, header rows and columns as repeat ranges), cells (numbers, percentages, currencies,
// dates, times, booleans, strings, rich text with spans, links and header fields, formulas in
// ODFF (and the old oooc: and Excel msoxl: grammars on import) with their cached results, array
// formulas, error results), merged cells, notes, column widths, row heights, hidden columns and
// rows, cell styles and automatic cell styles with their number formats (xmloff's data styles),
// page styles (page layouts and master pages with header and footer contents), named ranges and
// expressions (global and sheet-local), table:calculation-settings, the document properties
// (meta.xml), the view settings (settings.xml, ScViewData's names) and the database ranges with
// their AutoFilter and filter (xmldrani.ts), validity (xmlcvali.ts), conditional formats of cell
// value and formula conditions (xmlcondformat.ts). Not supported and reported
// in `lost`: charts, images, drawing objects, form controls, colour scales, data bars and icon sets,
// pivot tables, scenarios, outlines, manual page breaks, tracked
// changes, linked sheets and DDE links, label ranges, sparklines, macros and document protection.
// The column default cell styles are applied to the cells, the export writes each cell's style
// (no column default styles); the configuration settings beyond the view are not read.
import { child, childElements, escapeXml, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { ExportDatabaseRanges, ImportDatabaseRanges } from './xmldrani.ts';
import { ExportValidations, ImportValidations, ValidationName } from './xmlcvali.ts';
import { ExportConditionalFormat, ImportConditionalFormats } from './xmlcondformat.ts';
import { readZip, writeZip, type ZipEntry } from '../../../../package/source/zipapi/zip.ts';
import { ExportNumberStyle, ImportNumberStyles } from '../../../../xmloff/source/style/xmlnumfe.ts';
import { convertMeasureFromTwips, convertMeasureToTwips } from '../../../../xmloff/source/style/bordrhdl.ts';
import { SfxDocumentMetaData } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';
import { GetGeneratorString } from '../../../../unotools/source/config/docinfohelper.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { FormulaError } from '../../../../include/formula/errorcodes.ts';
import { SvNumFormatType, SvNumberformat } from '../../../../svl/source/numbers/zformat.ts';
import { GetStandardFormat } from '../../../../svl/source/numbers/zforlist.ts';
import { EditTextObject, type EditCharAttribs } from '../../../../editeng/source/editeng/editobj.ts';
import { ScAddress, ScRange, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_NONE, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../../inc/cellvalue.ts';
import { ScPatternAttr } from '../../../inc/patattr.ts';
import { SC_ITEM_IDS, SC_PAGE_ITEM_IDS, ScMF, type ScItemId, type ScItems, type ScItemSet } from '../../../inc/scitems.ts';
import { STR_STYLENAME_STANDARD } from '../../../inc/stlpool.ts';
import { SfxStyleFamily, type ScStyleSheet } from '../../../inc/stlsheet.ts';
import { ScDocument } from '../../core/data/document.ts';
import { ScDocumentImport } from '../../core/data/documentimport.ts';
import { ScMatrixMode, type ScFormulaCell } from '../../core/data/formulacell.ts';
import { ScRangeData, ScRangeDataType, ScRangeName } from '../../core/tool/rangenam.ts';
import { ScRangeStringConverter } from '../../core/tool/rangeutl.ts';
import { ScDocShell } from '../../ui/docshell/docsh.ts';
import { ExportCellProperties, ExportHeaderFooter, ExportPageLayout, ExportTextProperties, ImportCellProperties, ImportFontDecls, ImportHeaderFooter, ImportPageLayout, ImportParagraphs, ImportTextProperties, ExportParagraphs, ScXMLFontCollector } from './xmlstyle.ts';

/** ScSplitMode */
export const ScSplitMode = { SC_SPLIT_NONE: 0, SC_SPLIT_NORMAL: 1, SC_SPLIT_FIX: 2 } as const;
export type ScSplitMode = (typeof ScSplitMode)[keyof typeof ScSplitMode];
/** ScSplitPos */
export const ScSplitPos = { SC_SPLIT_TOPLEFT: 0, SC_SPLIT_TOPRIGHT: 1, SC_SPLIT_BOTTOMLEFT: 2, SC_SPLIT_BOTTOMRIGHT: 3 } as const;
export type ScSplitPos = (typeof ScSplitPos)[keyof typeof ScSplitPos];

/**
 * ScViewDataTable's settings of one sheet (by the names it writes). The split positions are a
 * column and row for SC_SPLIT_FIX (freeze panes), pixels for SC_SPLIT_NORMAL.
 */
export interface ScViewSettingsTable {
  CursorPositionX: number;
  CursorPositionY: number;
  HorizontalSplitMode: ScSplitMode;
  VerticalSplitMode: ScSplitMode;
  HorizontalSplitPosition: number;
  VerticalSplitPosition: number;
  ActiveSplitRange: ScSplitPos;
  PositionLeft: number;
  PositionRight: number;
  PositionTop: number;
  PositionBottom: number;
  /** SvxZoomType: 0 percent, 1 optimal, 2 whole page, 3 page width */
  ZoomType: number;
  /** percent */
  ZoomValue: number;
  PageViewZoomValue: number;
  ShowGrid: boolean;
}

/** ScViewData's settings (ooo:view-settings, the first view): the active sheet, zoom and view options, and each sheet's settings by name. */
export interface ScViewSettings {
  ActiveTable: string;
  HorizontalScrollbarWidth: number;
  ZoomType: number;
  ZoomValue: number;
  PageViewZoomValue: number;
  ShowPageBreakPreview: boolean;
  ShowZeroValues: boolean;
  ShowNotes: boolean;
  ShowFormulasMarks: boolean;
  ShowGrid: boolean;
  /** #rrggbb */
  GridColor: string;
  ShowPageBreaks: boolean;
  HasColumnRowHeaders: boolean;
  HasSheetTabs: boolean;
  IsOutlineSymbolsSet: boolean;
  IsValueHighlightingEnabled: boolean;
  /** per sheet, by sheet name */
  Tables: Record<string, ScViewSettingsTable>;
}

/** The settings of a sheet in a new view (ScViewDataTable's constructor). */
export function DefaultViewSettingsTable(): ScViewSettingsTable {
  return {
    CursorPositionX: 0, CursorPositionY: 0, HorizontalSplitMode: ScSplitMode.SC_SPLIT_NONE, VerticalSplitMode: ScSplitMode.SC_SPLIT_NONE,
    HorizontalSplitPosition: 0, VerticalSplitPosition: 0, ActiveSplitRange: ScSplitPos.SC_SPLIT_BOTTOMLEFT,
    PositionLeft: 0, PositionRight: 0, PositionTop: 0, PositionBottom: 0, ZoomType: 0, ZoomValue: 100, PageViewZoomValue: 60, ShowGrid: true,
  };
}

/** The settings of a new view (ScViewData's constructor and the default view options). */
export function DefaultViewSettings(): ScViewSettings {
  return {
    ActiveTable: '', HorizontalScrollbarWidth: 1270, ZoomType: 0, ZoomValue: 100, PageViewZoomValue: 60, ShowPageBreakPreview: false,
    ShowZeroValues: true, ShowNotes: true, ShowFormulasMarks: false, ShowGrid: true, GridColor: '#c0c0c0', ShowPageBreaks: true,
    HasColumnRowHeaders: true, HasSheetTabs: true, IsOutlineSymbolsSet: true, IsValueHighlightingEnabled: false, Tables: {},
  };
}

// ---- settings.xml ----

type ConfigValue = string | number | boolean;
const CONFIG_TYPES: Record<string, string> = {
  CursorPositionX: 'int', CursorPositionY: 'int', HorizontalSplitMode: 'short', VerticalSplitMode: 'short', HorizontalSplitPosition: 'int',
  VerticalSplitPosition: 'int', ActiveSplitRange: 'short', PositionLeft: 'int', PositionRight: 'int', PositionTop: 'int', PositionBottom: 'int',
  ZoomType: 'short', ZoomValue: 'int', PageViewZoomValue: 'int', ShowGrid: 'boolean', ActiveTable: 'string', HorizontalScrollbarWidth: 'int',
  ShowPageBreakPreview: 'boolean', ShowZeroValues: 'boolean', ShowNotes: 'boolean', ShowFormulasMarks: 'boolean', GridColor: 'long',
  ShowPageBreaks: 'boolean', HasColumnRowHeaders: 'boolean', HasSheetTabs: 'boolean', IsOutlineSymbolsSet: 'boolean', IsValueHighlightingEnabled: 'boolean',
};

function configItem(name: string, v: ConfigValue): string {
  const type = CONFIG_TYPES[name] ?? (typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'int' : 'string');
  const text = name === 'GridColor' ? String(parseInt(String(v).slice(1), 16)) : String(v);
  return `<config:config-item config:name="${name}" config:type="${type}">${escapeXml(text)}</config:config-item>`;
}

function readItems(el: XmlElement): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of childElements(el)) if (c.name === 'config:config-item') m.set(c.attrs.get('config:name') ?? '', c.children.filter((x): x is string => typeof x === 'string').join(''));
  return m;
}

/** ScViewData::ReadUserDataSequence and ScViewDataTable's: the first view of ooo:view-settings. */
export function ReadViewSettings(settings: XmlElement | undefined): ScViewSettings | undefined {
  const set = childElements(child(settings, 'office:settings') ?? { name: '', attrs: new Map(), children: [] }).find((e) => e.name === 'config:config-item-set' && e.attrs.get('config:name') === 'ooo:view-settings');
  const views = set && childElements(set).find((e) => e.name === 'config:config-item-map-indexed' && e.attrs.get('config:name') === 'Views');
  const view = views && childElements(views).find((e) => e.name === 'config:config-item-map-entry');
  if (!view) return undefined;
  const out = DefaultViewSettings();
  const assign = (target: Record<string, unknown>, items: Map<string, string>) => {
    for (const [k, v] of items) {
      if (!(k in target)) continue;
      const cur = target[k];
      if (k === 'GridColor') target[k] = `#${(Number(v) >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
      else if (typeof cur === 'boolean') target[k] = v === 'true';
      else if (typeof cur === 'number') { const n = Number(v); if (Number.isFinite(n)) target[k] = n; }
      else target[k] = v;
    }
  };
  assign(out as unknown as Record<string, unknown>, readItems(view));
  const tables = childElements(view).find((e) => e.name === 'config:config-item-map-named' && e.attrs.get('config:name') === 'Tables');
  for (const t of tables ? childElements(tables) : []) {
    const name = t.attrs.get('config:name');
    if (!name) continue;
    const ts = DefaultViewSettingsTable();
    assign(ts as unknown as Record<string, unknown>, readItems(t));
    out.Tables[name] = ts;
  }
  return out;
}

/** ScViewData::WriteUserDataSequence as the config:config-item-set of settings.xml. */
export function WriteViewSettings(v: ScViewSettings): string {
  const { Tables, ...rest } = v;
  let tables = '';
  for (const [name, t] of Object.entries(Tables)) {
    let items = '';
    for (const [k, val] of Object.entries(t)) {
      // Write freezepan data only when freeze pans are set
      if (/SplitMode|SplitPosition/.test(k) && !(t.HorizontalSplitPosition || t.VerticalSplitPosition || t.HorizontalSplitMode || t.VerticalSplitMode)) continue;
      items += configItem(k, val as ConfigValue);
    }
    tables += `<config:config-item-map-entry config:name="${escapeXml(name)}">${items}</config:config-item-map-entry>`;
  }
  const items = Object.entries(rest).map(([k, val]) => configItem(k, val as ConfigValue)).join('');
  return `<config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>${configItem('ViewId', 'view1')}<config:config-item-map-named config:name="Tables">${tables}</config:config-item-map-named>${items}</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set>`;
}

// ---- import ----

export interface ImportODSResult { doc: ScDocShell; lost: string[]; storage?: Map<string, Uint8Array>; template?: boolean; viewSettings?: ScViewSettings }

const MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const MIME_TEMPLATE = 'application/vnd.oasis.opendocument.spreadsheet-template';
const EMPTY_EL: XmlElement = { name: '', attrs: new Map(), children: [] };
const decodeXml = (b: Uint8Array) => new TextDecoder().decode(b);
const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
/** ODF style names encode characters outside NCNames (XMLStyleExport's EncodeStyleName). */
const styleId = (name: string) => name.replace(/ /g, '_20_').replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

/** The serial number of an ISO date or date and time (the document's null date as day 0). */
function DateToSerial(s: string, rDoc: ScDocument): number | undefined {
  const m = /^(-?\d+)-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?)?/.exec(s.trim());
  if (!m) return undefined;
  const { nDay, nMonth, nYear } = rDoc.GetDocOptions().GetDate();
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(nYear, nMonth - 1, nDay);
  const secs = Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0) + Number(`0.${m[7] ?? 0}`);
  return Math.round(day / 86400000) + secs / 86400;
}

/** An ISO duration (PT12H30M00S) in days. */
function DurationToDays(s: string): number | undefined {
  const m = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(s.trim());
  if (!m) return undefined;
  const v = Number(m[2] ?? 0) * 365 + Number(m[3] ?? 0) * 30 + Number(m[4] ?? 0) + Number(m[5] ?? 0) / 24 + Number(m[6] ?? 0) / 1440 + Number(m[7] ?? 0) / 86400;
  return m[1] ? -v : v;
}

/** The ODF value type of a number format code. */
function FormatType(code: string): number {
  return new SvNumberformat(code, 'en-US').GetType() as number;
}

/** ScXMLImport::GetRangeType: table:range-usable-as. */
function RangeTypeOf(s: string | undefined): number {
  let n: number = ScRangeDataType.Name;
  for (const t of (s ?? '').split(/\s+/)) {
    if (t === 'repeat-column') n |= ScRangeDataType.ColHeader;
    else if (t === 'repeat-row') n |= ScRangeDataType.RowHeader;
    else if (t === 'filter') n |= ScRangeDataType.Criteria;
    else if (t === 'print-range') n |= ScRangeDataType.PrintArea;
    else if (t === 'hidden') n |= ScRangeDataType.Hidden;
  }
  return n;
}

/** The grammar of a formula by its namespace prefix (ScXMLImport::ExtractFormulaNamespaceGrammar). */
function FormulaOf(f: string): { formula: string; eGrammar: FormulaGrammar.Grammar } {
  const m = /^(of|oooc|msoxl):/.exec(f);
  const body = m ? f.slice(m[0].length) : f;
  const eGrammar = m?.[1] === 'oooc' ? FormulaGrammar.GRAM_PODF : m?.[1] === 'msoxl' ? FormulaGrammar.GRAM_ENGLISH_XL_A1 : FormulaGrammar.GRAM_ODFF;
  return { formula: body.startsWith('=') ? body : `=${body}`, eGrammar };
}

/** The error of a result text ("#DIV/0!", "Err:502"), as ScXMLTableRowCellContext::GetFormulaErrorConstant. */
function ErrorOf(s: string): FormulaError | undefined {
  const named: Record<string, FormulaError> = {
    '#NULL!': FormulaError.NoCode, '#DIV/0!': FormulaError.DivisionByZero, '#VALUE!': FormulaError.NoValue, '#REF!': FormulaError.NoRef,
    '#NAME?': FormulaError.NoName, '#NUM!': FormulaError.IllegalFPOperation, '#N/A': FormulaError.NotAvailable,
  };
  if (named[s] !== undefined) return named[s];
  // "Err:502", also as a localized text ("Chyba:502").
  const m = /^[^\s:]+:(5\d\d)$/.exec(s.trim());
  return m ? (Number(m[1]) as FormulaError) : undefined;
}

interface AutoStyle { items: ScItemSet; parent: string | undefined; dataStyle: string | undefined }
interface CellXml { el: XmlElement; nCol: SCCOL; nRow: SCROW; nColRep: number; nRowRep: number }

/** The children of an element, groups (table:table-row-group, header rows, …) flattened. */
function flattenRows(e: XmlElement, out: { el: XmlElement; header: boolean; group: boolean }[], header = false, group = false): void {
  for (const c of childElements(e)) {
    if (c.name === 'table:table-row') out.push({ el: c, header, group });
    else if (c.name === 'table:table-rows') flattenRows(c, out, header, group);
    else if (c.name === 'table:table-header-rows') flattenRows(c, out, true, group);
    else if (c.name === 'table:table-row-group') flattenRows(c, out, header, true);
  }
}
function flattenCols(e: XmlElement, out: { el: XmlElement; header: boolean; group: boolean }[], header = false, group = false): void {
  for (const c of childElements(e)) {
    if (c.name === 'table:table-column') out.push({ el: c, header, group });
    else if (c.name === 'table:table-columns') flattenCols(c, out, header, group);
    else if (c.name === 'table:table-header-columns') flattenCols(c, out, true, group);
    else if (c.name === 'table:table-column-group') flattenCols(c, out, header, true);
  }
}

/** Whether the package or document holds macros (Basic libraries or office:script content). */
function hasScripts(root: XmlElement | undefined): boolean {
  const s = child(root, 'office:scripts');
  return !!s && childElements(s).some((c) => c.name === 'office:script' || c.name === 'office:event-listeners');
}

/**
 * ScXMLImport over the parsed streams: `styles` and `content` are office:document-styles and
 * office:document-content (or both the office:document of a flat file).
 */
function ImportDocument(styles: XmlElement | undefined, content: XmlElement | undefined, meta: XmlElement | undefined, settings: XmlElement | undefined, lost: Set<string>): { sh: ScDocShell; viewSettings?: ScViewSettings } {
  const doc = new ScDocument();
  const sh = new ScDocShell(doc);
  // ScDocShell's constructor makes "Sheet1" for a new document; a loaded one has the file's sheets.
  while (doc.GetTableCount()) doc.DeleteTab(0);
  doc.EnableUndo(false);
  if (meta) { try { sh.m_xDocProps = SfxDocumentMetaData.Read(meta); } catch { /* a broken meta.xml leaves the properties empty */ } }
  const pool = doc.GetStyleSheetPool();
  const fonts = ImportFontDecls([styles, content]);
  // SvXMLNumFormatContext: the data styles of both streams by name, as format codes.
  const numberStyles = ImportNumberStyles([child(styles, 'office:styles'), child(styles, 'office:automatic-styles'), child(content, 'office:automatic-styles')]);
  const dataCode = (name: string | undefined) => (name ? numberStyles.get(name) : undefined);
  /** A style:map seen (old conditional formats), and the cell styles' display names by style:name. */
  let bStyleMaps = false;
  const cellStyleDisplayName = new Map<string, string>();

  // XMLTableStylesContext: style:default-style of the table-cell family: the "Default" cell style.
  const officeStyles = child(styles, 'office:styles');
  const dflt = childElements(officeStyles ?? EMPTY_EL).find((e) => e.name === 'style:default-style' && e.attrs.get('style:family') === 'table-cell');
  const pStandard = pool.GetStandardStyle();
  const aDefaultItems: ScItemSet = dflt ? ImportCellProperties(dflt, fonts) : {};
  // The named cell styles; the styles a new document gets (sc/res/xml/styles.xml) are only kept
  // when the file has them.
  const named = childElements(officeStyles ?? EMPTY_EL).filter((e) => e.name === 'style:style' && e.attrs.get('style:family') === 'table-cell');
  const cellStyles = new Map<string, ScStyleSheet>(); // style:name -> style
  const display = (e: XmlElement) => e.attrs.get('style:display-name') ?? e.attrs.get('style:name')!.replace(/_20_/g, ' ');
  const fileNames = new Set(named.map(display));
  for (const s of pool.GetStyles(SfxStyleFamily.Para)) if (s !== pStandard && !fileNames.has(s.GetName()) && !s.IsUserDefined()) pool.Remove(s);
  for (const e of named) {
    const name = display(e);
    cellStyleDisplayName.set(e.attrs.get('style:name')!, name);
    const items = ImportCellProperties(e, fonts);
    if (e.name === 'style:style' && childElements(e).some((c) => c.name === 'style:map')) bStyleMaps = true;
    const code = dataCode(e.attrs.get('style:data-style-name'));
    if (code) items.ATTR_VALUE_FORMAT = code;
    let p = pool.Find(name, SfxStyleFamily.Para);
    if (p) p.SetItemSet(name === STR_STYLENAME_STANDARD ? { ...aDefaultItems, ...items } : items);
    else p = pool.Make(name, SfxStyleFamily.Para, items);
    cellStyles.set(e.attrs.get('style:name')!, p);
  }
  if (!named.some((e) => display(e) === STR_STYLENAME_STANDARD) && Object.keys(aDefaultItems).length) pStandard.SetItemSet({ ...aDefaultItems, ...pStandard.GetItemSet() });
  for (const e of named) {
    const parent = e.attrs.get('style:parent-style-name');
    const p = cellStyles.get(e.attrs.get('style:name')!)!;
    if (p !== pStandard) p.SetParent(parent ? (cellStyles.get(parent)?.GetName() ?? STR_STYLENAME_STANDARD) : STR_STYLENAME_STANDARD);
  }
  cellStyles.set('Default', pStandard);
  doc.StyleSheetChanged();

  // The automatic styles of content.xml by family.
  const autoCell = new Map<string, AutoStyle>();
  const colWidth = new Map<string, { width?: number; breakBefore?: boolean }>();
  const rowStyle = new Map<string, { height?: number; optimal?: boolean; breakBefore?: boolean }>();
  const tableStyle = new Map<string, { display?: boolean; master?: string; tabColor?: string | null; rtl?: boolean }>();
  const textStyles = new Map<string, EditCharAttribs>();
  for (const root of [child(styles, 'office:automatic-styles'), child(content, 'office:automatic-styles')]) {
    for (const e of childElements(root ?? EMPTY_EL)) {
      if (e.name !== 'style:style') continue;
      const name = e.attrs.get('style:name')!;
      switch (e.attrs.get('style:family')) {
        case 'table-cell': {
          if (childElements(e).some((c) => c.name === 'style:map')) bStyleMaps = true;
          autoCell.set(name, { items: ImportCellProperties(e, fonts), parent: e.attrs.get('style:parent-style-name'), dataStyle: e.attrs.get('style:data-style-name') });
          break;
        }
        case 'table-column': {
          const p = child(e, 'style:table-column-properties');
          colWidth.set(name, { width: convertMeasureToTwips(p?.attrs.get('style:column-width')), breakBefore: p?.attrs.get('fo:break-before') === 'page' });
          break;
        }
        case 'table-row': {
          const p = child(e, 'style:table-row-properties');
          rowStyle.set(name, { height: convertMeasureToTwips(p?.attrs.get('style:row-height')), optimal: p?.attrs.get('style:use-optimal-row-height') !== 'false', breakBefore: p?.attrs.get('fo:break-before') === 'page' });
          break;
        }
        case 'table': {
          const p = child(e, 'style:table-properties');
          const tab = p?.attrs.get('table:tab-color') ?? p?.attrs.get('tableooo:tab-color');
          tableStyle.set(name, { display: p?.attrs.get('table:display') !== 'false', master: e.attrs.get('style:master-page-name'), tabColor: tab ? tab.toLowerCase() : undefined, rtl: p?.attrs.get('style:writing-mode') === 'rl-tb' });
          break;
        }
        case 'text':
          textStyles.set(name, ImportTextProperties(child(e, 'style:text-properties'), fonts));
          break;
        default: break;
      }
    }
  }

  // Page styles: style:master-page with its style:page-layout (XMLTableMasterPageImport).
  const layouts = new Map<string, XmlElement>();
  for (const e of childElements(child(styles, 'office:automatic-styles') ?? EMPTY_EL)) if (e.name === 'style:page-layout') layouts.set(e.attrs.get('style:name')!, e);
  const masterStyles = new Map<string, string>(); // style:name -> page style name
  for (const mp of childElements(child(styles, 'office:master-styles') ?? EMPTY_EL)) {
    if (mp.name !== 'style:master-page') continue;
    const name = display(mp);
    const items: ScItemSet = {};
    const pl = layouts.get(mp.attrs.get('style:page-layout-name') ?? '');
    if (pl) Object.assign(items, ImportPageLayout(pl));
    const hfItems = (n: string): [ScItemId, string][] => n === 'header'
      ? [['ATTR_PAGE_HEADERRIGHT', 'style:header'], ['ATTR_PAGE_HEADERLEFT', 'style:header-left'], ['ATTR_PAGE_HEADERFIRST', 'style:header-first']]
      : [['ATTR_PAGE_FOOTERRIGHT', 'style:footer'], ['ATTR_PAGE_FOOTERLEFT', 'style:footer-left'], ['ATTR_PAGE_FOOTERFIRST', 'style:footer-first']];
    for (const kind of ['header', 'footer'] as const) {
      const setId = kind === 'header' ? 'ATTR_PAGE_HEADERSET' : 'ATTR_PAGE_FOOTERSET';
      const set = { ...(items[setId] ?? doc.GetStyleSheetPool().Find(STR_STYLENAME_STANDARD, SfxStyleFamily.Page)!.GetItem(setId)) };
      let bOn = false;
      for (const [id, elName] of hfItems(kind)) {
        const el = childElements(mp).find((c) => c.name === elName || c.name === elName.replace('style:', 'loext:'));
        if (!el) continue;
        (items as Record<string, unknown>)[id] = ImportHeaderFooter(el, textStyles);
        const shown = el.attrs.get('style:display') !== 'false';
        if (elName === `style:${kind}`) bOn = shown;
        else if (elName === `style:${kind}-left`) set.bShared = !shown;
        else set.bSharedFirst = !shown;
      }
      set.bOn = bOn && set.bOn;
      items[setId] = set;
    }
    const p = pool.Find(name, SfxStyleFamily.Page);
    if (p) p.SetItemSet(items);
    else pool.Make(name, SfxStyleFamily.Page, items);
    masterStyles.set(mp.attrs.get('style:name')!, name);
  }

  const imp = new ScDocumentImport(doc);
  const spreadsheet = child(child(content, 'office:body'), 'office:spreadsheet');
  if (hasScripts(content)) lost.add('Macros');
  // table:calculation-settings (ScXMLCalculationSettingsContext)
  const calc = child(spreadsheet, 'table:calculation-settings');
  const aOpt = doc.GetDocOptions().clone();
  if (calc) {
    const attr = (n: string, d: boolean): boolean => (calc.attrs.has(n) ? calc.attrs.get(n) === 'true' : d);
    aOpt.SetIgnoreCase(!attr('table:case-sensitive', true));
    aOpt.SetCalcAsShown(attr('table:precision-as-shown', false));
    aOpt.SetMatchWholeCell(attr('table:search-criteria-must-apply-to-whole-cell', true));
    aOpt.SetLookUpColRowNames(attr('table:automatic-find-labels', true));
    if (attr('table:use-wildcards', false)) aOpt.SetFormulaWildcardsEnabled(true);
    else if (attr('table:use-regular-expressions', true)) aOpt.SetFormulaRegexEnabled(true);
    else { aOpt.SetFormulaWildcardsEnabled(false); aOpt.SetFormulaRegexEnabled(false); }
    const year = calc.attrs.get('table:null-year');
    if (year) aOpt.SetYear2000(Number(year));
    const nd = child(calc, 'table:null-date')?.attrs.get('table:date-value');
    const ndm = nd && /^(\d+)-(\d\d)-(\d\d)/.exec(nd);
    if (ndm) aOpt.SetDate(Number(ndm[3]), Number(ndm[2]), Number(ndm[1]));
    const it = child(calc, 'table:iteration');
    if (it) {
      aOpt.SetIter(it.attrs.get('table:status') === 'enable');
      if (it.attrs.has('table:steps')) aOpt.SetIterCount(Number(it.attrs.get('table:steps')));
      if (it.attrs.has('table:maximum-difference')) aOpt.SetIterEps(Number(it.attrs.get('table:maximum-difference')));
    }
  } else {
    // ODF's defaults where the element is missing.
    aOpt.SetFormulaRegexEnabled(true);
  }
  doc.SetDocOptions(aOpt);

  let databaseRanges: XmlElement | undefined;
  let contentValidations: XmlElement | undefined;
  /** The cells naming a validation (table:content-validation-name), applied after the sheets. */
  const validationCells: { name: string; nCol: SCCOL; nRow: SCROW; nColRep: number; nRowRep: number; nTab: SCTAB }[] = [];
  for (const e of childElements(spreadsheet ?? EMPTY_EL)) {
    switch (e.name) {
      case 'table:content-validations': contentValidations = e; break;
      case 'table:label-ranges': if (childElements(e).length) lost.add('Label ranges'); break;
      case 'table:database-ranges': databaseRanges = e; break;
      case 'table:data-pilot-tables': lost.add('Pivot tables'); break;
      case 'table:consolidation': lost.add('Consolidation settings'); break;
      case 'table:dde-links': lost.add('DDE links'); break;
      case 'table:tracked-changes': if (childElements(e).length) lost.add('Tracked changes'); break;
      case 'calcext:data-streams': case 'table:data-streams': lost.add('Data streams'); break;
      default: break;
    }
  }
  if (spreadsheet?.attrs.get('table:structure-protected') === 'true') lost.add('Document protection');

  // Patterns of the automatic and named styles, with the number format of a cell type.
  const patterns = new Map<string, ScPatternAttr>();
  const patternOf = (name: string | undefined): ScPatternAttr | null => {
    if (!name) return null;
    const hit = patterns.get(name);
    if (hit) return hit;
    let p: ScPatternAttr;
    const a = autoCell.get(name);
    if (a) {
      const items = { ...a.items };
      const code = dataCode(a.dataStyle);
      if (code) items.ATTR_VALUE_FORMAT = code;
      p = new ScPatternAttr(cellStyles.get(a.parent ?? 'Default') ?? pStandard, items);
    } else {
      const st = cellStyles.get(name);
      if (!st) return null;
      p = new ScPatternAttr(st);
    }
    p = doc.getCellAttributeHelper().registerAndCheck(p);
    patterns.set(name, p);
    return p;
  };

  const tables = childElements(spreadsheet ?? EMPTY_EL).filter((e) => e.name === 'table:table');
  // Sheets first (formulas refer to all of them, ScXMLTableContext inserts them in order).
  tables.forEach((t, nTab) => {
    let name = t.attrs.get('table:name') ?? `Sheet${nTab + 1}`;
    if (!doc.ValidNewTabName(name)) name = doc.CreateValidTabName(name);
    doc.InsertTab(nTab, name);
  });
  const pendingFormulas: { aPos: ScAddress; f: string; result: number | string | null; err?: FormulaError; nMatCols: number; nMatRows: number; cellEl: XmlElement }[] = [];
  const merges: ScRange[] = [];
  const localNames: { nTab: SCTAB; el: XmlElement }[] = [];
  const condFormats: { nTab: SCTAB; el: XmlElement }[] = [];
  const nMaxCol = doc.MaxCol(), nMaxRow = doc.MaxRow();

  tables.forEach((t, nTab) => {
    const ts = tableStyle.get(t.attrs.get('table:style-name') ?? '');
    if (ts) {
      if (ts.display === false) doc.SetVisible(nTab, false);
      if (ts.tabColor && ts.tabColor !== 'auto') doc.SetTabBgColor(nTab, ts.tabColor);
      if (ts.master) doc.SetPageStyle(nTab, masterStyles.get(ts.master) ?? ts.master.replace(/_20_/g, ' '));
      if (ts.rtl) doc.SetLayoutRTL(nTab, true);
    }
    if (t.attrs.get('table:protected') === 'true') {
      doc.SetTabProtection(nTab, true);
      if (t.attrs.get('table:protection-key')) lost.add('Sheet protection passwords');
    }
    if (t.attrs.get('table:print') === 'false') doc.ClearPrintRanges(nTab);
    const pr = t.attrs.get('table:print-ranges');
    if (pr) {
      doc.ClearPrintRanges(nTab);
      for (const r of ScRangeStringConverter.GetRangeListFromString(pr, doc)) doc.AddPrintRange(nTab, r);
    }
    // Columns (ScXMLTableColContext): widths, visibility, default cell styles.
    const cols: { el: XmlElement; header: boolean; group: boolean }[] = [];
    flattenCols(t, cols);
    let nCol = 0, nHeaderStart = -1, nHeaderEnd = -1;
    for (const c of cols) {
      const nRep = Math.max(1, Number(c.el.attrs.get('table:number-columns-repeated') ?? 1));
      const nLast = Math.min(nMaxCol, nCol + nRep - 1);
      if (nCol > nMaxCol) break;
      if (c.group) lost.add('Outlines (grouped rows and columns)');
      const cs = colWidth.get(c.el.attrs.get('table:style-name') ?? '');
      if (cs?.breakBefore) lost.add('Manual page breaks');
      if (cs?.width !== undefined && nLast - nCol < 1024) for (let i = nCol; i <= nLast; i++) doc.SetColWidth(i, nTab, cs.width);
      else if (cs?.width !== undefined) for (let i = nCol; i <= nLast; i++) doc.FetchTable(nTab)!.SetColWidth(i, cs.width);
      const vis = c.el.attrs.get('table:visibility');
      if (vis === 'collapse' || vis === 'filter') doc.SetColHidden(nCol, nLast, nTab, true);
      const dcs = c.el.attrs.get('table:default-cell-style-name');
      const pat = dcs && dcs !== 'Default' ? patternOf(dcs) : null;
      if (pat) for (let i = nCol; i <= nLast; i++) doc.FetchTable(nTab)!.CreateColumnIfNotExists(i).SetPatternArea(0, nMaxRow, pat);
      if (c.header) { if (nHeaderStart < 0) nHeaderStart = nCol; nHeaderEnd = nLast; }
      nCol += nRep;
    }
    if (nHeaderStart >= 0) doc.SetRepeatColRange(nTab, new ScRange(nHeaderStart, 0, nTab, nHeaderEnd, nMaxRow, nTab));
    // Rows and cells (ScXMLTableRowContext, ScXMLTableRowCellContext).
    const rows: { el: XmlElement; header: boolean; group: boolean }[] = [];
    flattenRows(t, rows);
    let nRow = 0;
    let nRowHeaderStart = -1, nRowHeaderEnd = -1;
    const pTable = doc.FetchTable(nTab)!;
    for (const r of rows) {
      if (nRow > nMaxRow) break;
      const nRowRep = Math.max(1, Number(r.el.attrs.get('table:number-rows-repeated') ?? 1));
      const nRowLast = Math.min(nMaxRow, nRow + nRowRep - 1);
      if (r.group) lost.add('Outlines (grouped rows and columns)');
      const rs = rowStyle.get(r.el.attrs.get('table:style-name') ?? '');
      if (rs?.breakBefore) lost.add('Manual page breaks');
      if (rs?.height !== undefined) {
        pTable.SetRowHeightOnly(nRow, nRowLast, rs.height);
        if (!rs.optimal) pTable.SetManualHeight(nRow, nRowLast, true);
      }
      const vis = r.el.attrs.get('table:visibility');
      if (vis === 'collapse' || vis === 'filter') pTable.SetRowHidden(nRow, nRowLast, true);
      if (vis === 'filter') pTable.SetRowFiltered(nRow, nRowLast, true);
      if (r.header) { if (nRowHeaderStart < 0) nRowHeaderStart = nRow; nRowHeaderEnd = nRowLast; }
      const rowDefault = r.el.attrs.get('table:default-cell-style-name');
      let nC = 0;
      for (const c of childElements(r.el)) {
        if (c.name !== 'table:table-cell' && c.name !== 'table:covered-table-cell') continue;
        const nColRep = Math.max(1, Number(c.attrs.get('table:number-columns-repeated') ?? 1));
        if (nC > nMaxCol) break;
        const nColLast = Math.min(nMaxCol, nC + nColRep - 1);
        const sn = c.attrs.get('table:style-name') ?? (rowDefault && rowDefault !== 'Default' ? rowDefault : undefined);
        const pat = patternOf(sn);
        if (pat) for (let i = nC; i <= nColLast; i++) pTable.CreateColumnIfNotExists(i).SetPatternArea(nRow, nRowLast, pat);
        else if (c.attrs.get('table:style-name') === undefined && sn === undefined) { /* the column's default */ }
        ImportCell({ el: c, nCol: nC, nRow, nColRep: nColLast - nC + 1, nRowRep: nRowLast - nRow + 1 }, nTab);
        nC += nColRep;
      }
      nRow += nRowRep;
    }
    if (nRowHeaderStart >= 0) doc.SetRepeatRowRange(nTab, new ScRange(0, nRowHeaderStart, nTab, nMaxCol, nRowHeaderEnd, nTab));
    for (const e of childElements(t)) {
      switch (e.name) {
        case 'table:shapes': ReportShapes(e, lost); break;
        case 'table:named-expressions': localNames.push({ nTab, el: e }); break;
        case 'calcext:conditional-formats': condFormats.push({ nTab, el: e }); break;
        case 'table:scenario': lost.add('Scenarios'); break;
        case 'table:table-source': lost.add('Linked sheets'); break;
        case 'office:forms': if (childElements(e).length) lost.add('Form controls'); break;
        case 'calcext:sparkline-groups': lost.add('Sparklines'); break;
        case 'table:dde-source': lost.add('DDE links'); break;
        default: break;
      }
    }
  });

  function ReportShapes(e: XmlElement, out: Set<string>): void {
    for (const s of childElements(e)) {
      if (s.name === 'draw:frame') {
        const kids = childElements(s);
        if (kids.some((k) => k.name === 'draw:object' || k.name === 'draw:object-ole')) out.add('Charts and embedded objects');
        else if (kids.some((k) => k.name === 'draw:image')) out.add('Images');
        else out.add('Drawing objects');
      } else if (s.name.startsWith('draw:')) out.add(s.name === 'draw:control' ? 'Form controls' : 'Drawing objects');
    }
  }

  function ImportCell(c: CellXml, nTab: SCTAB): void {
    const el = c.el;
    const a = (k: string) => el.attrs.get(k);
    // Merged areas.
    const nSpanCols = Number(a('table:number-columns-spanned') ?? 1), nSpanRows = Number(a('table:number-rows-spanned') ?? 1);
    if (el.name === 'table:table-cell' && (nSpanCols > 1 || nSpanRows > 1)) {
      for (let i = 0; i < c.nColRep; i++) for (let j = 0; j < c.nRowRep; j++) {
        merges.push(new ScRange(c.nCol + i, c.nRow + j, nTab, Math.min(nMaxCol, c.nCol + i + nSpanCols - 1), Math.min(nMaxRow, c.nRow + j + nSpanRows - 1), nTab));
      }
    }
    const kids = childElements(el);
    for (const k of kids) {
      if (k.name.startsWith('draw:')) ReportShapes({ name: '', attrs: new Map(), children: [k] }, lost);
      else if (k.name === 'table:detective') lost.add('Detective marks');
      else if (k.name === 'table:cell-range-source') lost.add('Linked sheets');
    }
    const sValidation = a('table:content-validation-name');
    if (sValidation) validationCells.push({ name: sValidation, nCol: c.nCol, nRow: c.nRow, nColRep: c.nColRep, nRowRep: c.nRowRep, nTab });
    const annotation = kids.find((k) => k.name === 'office:annotation');
    const paras = kids.filter((k) => k.name === 'text:p' || k.name === 'text:h');
    const valueType = a('office:value-type') ?? a('calcext:value-type');
    const formula = a('table:formula');
    if (!valueType && !formula && !paras.length && !annotation) return;
    // The cell's content, once for the first cell of a repetition (the rest are copies).
    let content: number | string | EditTextObject | null = null;
    let typeForFormat: number | null = null;
    let result: number | string | null = null;
    let err: FormulaError | undefined;
    const textContent = (): string | EditTextObject | null => {
      if (!paras.length) return null;
      const t = ImportParagraphs(paras, textStyles);
      return t.GetParagraphCount() === 1 && !t.HasCharAttribs() ? t.GetText(0) : t;
    };
    switch (valueType) {
      case 'float': result = Number(a('office:value') ?? 0); break;
      case 'percentage': result = Number(a('office:value') ?? 0); typeForFormat = SvNumFormatType.PERCENT; break;
      case 'currency': result = Number(a('office:value') ?? 0); typeForFormat = SvNumFormatType.CURRENCY; break;
      case 'date': result = DateToSerial(a('office:date-value') ?? '', doc) ?? 0; typeForFormat = /T/.test(a('office:date-value') ?? '') ? SvNumFormatType.DATETIME : SvNumFormatType.DATE; break;
      case 'time': result = DurationToDays(a('office:time-value') ?? '') ?? 0; typeForFormat = SvNumFormatType.TIME; break;
      case 'boolean': {
        const b = a('office:boolean-value') ?? 'false';
        // (a value other than true or false is read as a number, OUString::toDouble)
        result = b === 'true' ? 1 : b === 'false' ? 0 : Number(b) || 0;
        typeForFormat = SvNumFormatType.LOGICAL;
        break;
      }
      case 'string': {
        const sv = a('office:string-value');
        if (a('calcext:value-type') === 'error') { const s = textOf(paras[0] ?? EMPTY_EL) || (sv ?? ''); err = ErrorOf(s); result = err === undefined ? null : s; }
        else if (formula) result = sv ?? (paras.map(textOf).join('\n'));
        else { const tc = textContent(); result = sv ?? (typeof tc === 'string' ? tc : null); if (sv === undefined) content = tc; }
        break;
      }
      default:
        if (!formula && paras.length) content = textContent();
        break;
    }
    // An error result (calcext:value-type), or of an older file a float result whose text is an
    // error constant (mbPossibleErrorCell). An unknown error text leaves the cell to be calculated.
    if (formula && valueType !== 'string' && (a('calcext:value-type') === 'error' || (valueType === 'float' && paras.length === 1 && /^(#|[^\s:]+:5\d\d$)/.test(textOf(paras[0]!))))) {
      const s = textOf(paras[0] ?? EMPTY_EL);
      err = ErrorOf(s);
      result = err === undefined && a('calcext:value-type') === 'error' ? null : result;
    }
    if (content === null && typeof result === 'number' && !formula) content = result;
    if (content === null && typeof result === 'string' && !formula) content = result;
    for (let j = 0; j < c.nRowRep; j++) {
      for (let i = 0; i < c.nColRep; i++) {
        const aPos = new ScAddress(c.nCol + i, c.nRow + j, nTab);
        if (formula) {
          if (el.name === 'table:table-cell' || !doc.GetFormulaCell(aPos)) {
            pendingFormulas.push({ aPos, f: formula, result, err, nMatCols: Number(a('table:number-matrix-columns-spanned') ?? 0), nMatRows: Number(a('table:number-matrix-rows-spanned') ?? 0), cellEl: el });
          }
        } else if (typeof content === 'number') imp.setNumericCell(aPos, content);
        else if (typeof content === 'string') imp.setStringCell(aPos, content);
        else if (content instanceof EditTextObject) imp.setEditCell(aPos, content.Clone());
        // ScMyStylesImportHelper: a value of a type its format does not show gets the type's standard format.
        if (typeForFormat !== null) {
          const code = doc.GetNumberFormat(aPos);
          const t = FormatType(code);
          const ok = t === typeForFormat || (typeForFormat === SvNumFormatType.DATE && t === SvNumFormatType.DATETIME) || (typeForFormat === SvNumFormatType.DATETIME && (t === SvNumFormatType.DATE || t === SvNumFormatType.TIME)) || (typeForFormat === SvNumFormatType.TIME && t === SvNumFormatType.DATETIME);
          if (!ok) pTableOf(nTab).CreateColumnIfNotExists(aPos.Col()).ApplyPatternArea(aPos.Row(), aPos.Row(), { ATTR_VALUE_FORMAT: GetStandardFormat(typeForFormat as SvNumFormatType, 'en-US') });
        }
        if (annotation) {
          const creator = child(annotation, 'dc:creator'), date = child(annotation, 'dc:date');
          const text = childElements(annotation).filter((k) => k.name === 'text:p').map(textOf).join('\n');
          doc.SetNote(aPos, { maText: text, maAuthor: creator ? textOf(creator) : '', maDate: date ? textOf(date) : '', mbShown: annotation.attrs.get('office:display') === 'true' });
        }
      }
    }
  }
  function pTableOf(nTab: SCTAB) { return doc.FetchTable(nTab)!; }

  // Named ranges and expressions (ScXMLNamedExpressionsContext), before the formulas that use them.
  const insertNames = (el: XmlElement, pNames: ScRangeName) => {
    for (const n of childElements(el)) {
      const name = n.attrs.get('table:name');
      if (!name) continue;
      const aBase = ScRangeStringConverter.GetAddressFromString(n.attrs.get('table:base-cell-address') ?? '', doc) ?? new ScAddress();
      let sym: string | undefined;
      let nType: number = ScRangeDataType.Name;
      if (n.name === 'table:named-range') {
        sym = `[${n.attrs.get('table:cell-range-address') ?? ''}]`;
        nType = RangeTypeOf(n.attrs.get('table:range-usable-as'));
      } else if (n.name === 'table:named-expression') {
        const { formula } = FormulaOf(n.attrs.get('table:expression') ?? '');
        sym = formula.slice(1);
        if (n.attrs.get('loext:hidden') === 'true') nType |= ScRangeDataType.Hidden;
      }
      if (sym === undefined) continue;
      pNames.insert(new ScRangeData(doc, name, sym, aBase, nType, FormulaGrammar.GRAM_ODFF));
    }
  };
  const globalNames = child(spreadsheet, 'table:named-expressions');
  if (globalNames) {
    const pNames = doc.GetRangeName() ?? new ScRangeName();
    insertNames(globalNames, pNames);
    doc.SetRangeName(pNames);
  }
  for (const { nTab, el } of localNames) {
    const pNames = doc.GetRangeName(nTab) ?? new ScRangeName();
    insertNames(el, pNames);
    doc.SetRangeName(pNames, nTab);
  }

  // Validity (ScXMLContentValidationsContext): compiled once the sheets exist
  if (contentValidations) {
    const aKeys = ImportValidations(doc, contentValidations, lost);
    for (const v of validationCells) {
      const nKey = aKeys.get(v.name);
      if (nKey) doc.ApplyPatternAreaTab(v.nCol, v.nRow, Math.min(nMaxCol, v.nCol + v.nColRep - 1), Math.min(nMaxRow, v.nRow + v.nRowRep - 1), v.nTab, { ATTR_VALIDDATA: nKey });
    }
  }

  // Conditional formats (ScXMLConditionalFormatsContext); the old style:map conditions are only
  // read from the calcext elements LibreOffice writes beside them
  for (const { nTab, el } of condFormats) ImportConditionalFormats(doc, el, nTab, lost, (n) => cellStyleDisplayName.get(n) ?? n.replace(/_20_/g, ' '));
  if (bStyleMaps && !condFormats.length) lost.add('Conditional formatting');

  // Database ranges and their filters (ScXMLDatabaseRangesContext): after the cells, before the
  // formulas, which may name them
  if (databaseRanges) ImportDatabaseRanges(doc, databaseRanges, lost);

  // Formulas, with their results (ScXMLTableRowCellContext::PutFormulaCell).
  for (const p of pendingFormulas) {
    const { formula, eGrammar } = FormulaOf(p.f);
    if (/'file:\/\/|'[a-z]+:\/\/[^']*'#/.test(formula)) lost.add('Links to external files');
    if (p.nMatCols > 0 || p.nMatRows > 0) {
      imp.setMatrixCells(new ScRange(p.aPos.Col(), p.aPos.Row(), p.aPos.Tab(), Math.min(nMaxCol, p.aPos.Col() + Math.max(1, p.nMatCols) - 1), Math.min(nMaxRow, p.aPos.Row() + Math.max(1, p.nMatRows) - 1), p.aPos.Tab()), formula, eGrammar);
      continue;
    }
    // Cells inside an array formula's area are written with the formula too: they belong to the array.
    const pOld = doc.GetFormulaCell(p.aPos);
    if (pOld && pOld.GetMatrixFlag() === ScMatrixMode.Reference) continue;
    const pCell = imp.setFormulaCell(p.aPos, formula, eGrammar, p.err !== undefined ? null : p.result);
    if (pCell && p.err !== undefined) { pCell.SetResultError(p.err); pCell.ResetDirty(); }
  }
  for (const r of merges) doc.DoMerge(r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row(), r.aStart.Tab());
  // The loaded results are kept: "Recalculation on File Load" defaults to "Never recalculate".
  imp.finalize(false);
  doc.EnableUndo(true);
  const viewSettings = ReadViewSettings(settings);
  return { sh, viewSettings };
}

/**
 * ScDocShell::ConvertFrom / ScXMLImportWrapper::Import for an ODF package (.ods, .ots).
 * Throws BrokenPackageError for a package whose directory cannot be read (load it again with
 * bRepairPackage).
 */
export async function ImportODS(bytes: Uint8Array, bRepairPackage = false): Promise<ImportODSResult> {
  const files = await readZip(bytes, bRepairPackage);
  if (files.has('META-INF/manifest.xml') && decodeXml(files.get('META-INF/manifest.xml')!).includes('encryption-data')) {
    throw new Error('This document is password-protected. Encrypted documents cannot be opened yet.');
  }
  const contentBytes = files.get('content.xml');
  if (!contentBytes && !files.has('styles.xml')) throw new Error('This file has no content.xml, so it is not an OpenDocument spreadsheet.');
  const content = contentBytes ? child(parseXml(decodeXml(contentBytes)), 'office:document-content') : undefined;
  const styles = files.has('styles.xml') ? child(parseXml(decodeXml(files.get('styles.xml')!)), 'office:document-styles') : undefined;
  let meta: XmlElement | undefined;
  try { meta = files.has('meta.xml') ? child(child(parseXml(decodeXml(files.get('meta.xml')!)), 'office:document-meta'), 'office:meta') : undefined; } catch { meta = undefined; }
  let settings: XmlElement | undefined;
  try { settings = files.has('settings.xml') ? child(parseXml(decodeXml(files.get('settings.xml')!)), 'office:document-settings') : undefined; } catch { settings = undefined; }
  const lost = new Set<string>();
  if ([...files.keys()].some((k) => k.startsWith('Basic/') && k.endsWith('.xml') && !k.endsWith('script-lc.xml') && !k.endsWith('dialog-lc.xml'))) lost.add('Macros');
  const { sh, viewSettings } = ImportDocument(styles, content, meta, settings, lost);
  const template = decodeXml(files.get('mimetype') ?? new Uint8Array()).trim() === MIME_TEMPLATE;
  sh.SetUnmodified();
  return { doc: sh, lost: [...lost], storage: files, template, viewSettings };
}

/** A flat OpenDocument spreadsheet (.fods): all streams in one office:document. */
export function ImportFODS(text: string): ImportODSResult {
  const root = child(parseXml(text), 'office:document');
  if (!root) throw new Error('This file is not a flat OpenDocument spreadsheet.');
  const lost = new Set<string>();
  const { sh, viewSettings } = ImportDocument(root, root, child(root, 'office:meta'), root, lost);
  sh.SetUnmodified();
  return { doc: sh, lost: [...lost], template: root.attrs.get('office:mimetype') === MIME_TEMPLATE, viewSettings };
}

// ---- export ----

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:ooo="http://openoffice.org/2004/office" xmlns:tableooo="http://openoffice.org/2009/table" xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" xmlns:css3t="http://www.w3.org/TR/css3-text/" office:version="1.3"';
const measure = convertMeasureFromTwips;
const ERROR_TEXT: Partial<Record<number, string>> = {
  [FormulaError.NoCode]: '#NULL!', [FormulaError.DivisionByZero]: '#DIV/0!', [FormulaError.NoValue]: '#VALUE!', [FormulaError.NoRef]: '#REF!',
  [FormulaError.NoName]: '#NAME?', [FormulaError.IllegalFPOperation]: '#NUM!', [FormulaError.NotAvailable]: '#N/A',
};

/** A serial date as an ISO date (with the time when it has one). */
function SerialToDate(f: number, rDoc: ScDocument): string {
  const { nDay, nMonth, nYear } = rDoc.GetDocOptions().GetDate();
  const nDays = Math.floor(f);
  let ms = Math.round((f - nDays) * 86400000);
  const d = new Date(Date.UTC(nYear, nMonth - 1, nDay) + nDays * 86400000);
  const y = d.getUTCFullYear();
  const date = `${y < 0 ? '-' : ''}${String(Math.abs(y)).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (!ms) return date;
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${ms ? `.${String(ms).padStart(3, '0')}` : ''}`;
}

/** Days as an ISO duration (PT36H00M00S), as ::sax::Converter::convertDuration writes cell times. */
function DaysToDuration(f: number): string {
  const neg = f < 0;
  let ms = Math.round(Math.abs(f) * 86400000);
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${neg ? '-' : ''}PT${String(h).padStart(2, '0')}H${String(m).padStart(2, '0')}M${String(s).padStart(2, '0')}${ms ? `.${String(ms).padStart(3, '0')}` : ''}S`;
}

/** A number as ODF writes it (rtl::math::doubleToUString with the maximum precision). */
const NumberText = (f: number): string => (Number.isInteger(f) ? String(f) : String(Number(f.toPrecision(17)) === f ? f : f));

interface ExportParts { content: string; styles: string; meta: string; settings: string; mime: string; fontDecls: string; stylesBody: string; autoStylesStyles: string; masterStyles: string; contentAuto: string; body: string; settingsBody: string }

/** ScXMLExport: the parts of the document's streams. */
function ExportDocument(sh: ScDocShell, bTemplate: boolean, viewSettings: ScViewSettings | undefined): ExportParts {
  const doc = sh.GetDocument();
  const pool = doc.GetStyleSheetPool();
  const fonts = new ScXMLFontCollector();
  const pDefault = doc.GetDefPattern();
  let nNumber = 0;
  // Data styles: those of named styles go to styles.xml, those of automatic styles to content.xml.
  const namedData = new Map<string, string>(), autoData = new Map<string, string>();
  const dataStyleName = (code: string, bNamed: boolean): string | null => {
    if (!code || /^General$/i.test(code)) return null;
    const m = bNamed ? namedData : autoData;
    let n = m.get(code);
    if (!n) { n = `N${++nNumber}`; m.set(code, n); }
    return n;
  };
  // Named cell styles (XMLStyleExport for the cell style family).
  let namedStyles = '';
  for (const st of pool.GetStyles(SfxStyleFamily.Para)) {
    const items = st.GetItemSet();
    const code = items.ATTR_VALUE_FORMAT;
    const ds = code ? dataStyleName(code, true) : null;
    const name = st.GetName();
    const parent = st.GetParent();
    namedStyles += `<style:style style:name="${styleId(name)}"${styleId(name) !== name ? ` style:display-name="${escapeXml(name)}"` : ''} style:family="table-cell"${parent && name !== STR_STYLENAME_STANDARD ? ` style:parent-style-name="${styleId(parent)}"` : ''}${ds ? ` style:data-style-name="${ds}"` : ''}>${ExportCellProperties(cellOnly(items), fonts)}</style:style>`;
  }
  // The pool defaults (XMLTableStylesContext's default style).
  const defaultStyle = `<style:default-style style:family="table-cell"><style:paragraph-properties style:tab-stop-distance="0.5in"/>${ExportTextProperties({ ATTR_FONT: fonts.Add('Liberation Sans'), ATTR_FONT_HEIGHT: 200, ATTR_FONT_LANGUAGE: 'en-US' }, fonts)}</style:default-style>`;

  // Automatic cell styles of the patterns used ("ce1", …), keyed by the pattern.
  const cellAuto = new Map<ScPatternAttr, string>();
  const cellAutoByKey = new Map<string, string>();
  let contentAuto = '';
  const patternStyle = (p: ScPatternAttr): string | null => {
    if (p === pDefault) return null;
    const hit = cellAuto.get(p);
    if (hit !== undefined) return hit;
    const items = cellOnly(p.GetItemSet());
    const st = p.GetStyleSheet();
    let name: string | null;
    if (!Object.keys(items).length) name = st && st.GetName() !== STR_STYLENAME_STANDARD ? styleId(st.GetName()) : null;
    else {
      const key = p.GetKey();
      name = cellAutoByKey.get(key) ?? null;
      if (!name) {
        name = `ce${cellAutoByKey.size + 1}`;
        cellAutoByKey.set(key, name);
        const ds = items.ATTR_VALUE_FORMAT !== undefined ? dataStyleName(items.ATTR_VALUE_FORMAT, false) : null;
        contentAuto += `<style:style style:name="${name}" style:family="table-cell" style:parent-style-name="${styleId(st?.GetName() ?? STR_STYLENAME_STANDARD)}"${ds ? ` style:data-style-name="${ds}"` : items.ATTR_VALUE_FORMAT !== undefined ? ' style:data-style-name="N0"' : ''}>${ExportCellProperties(items, fonts)}</style:style>`;
        if (ds === null && items.ATTR_VALUE_FORMAT !== undefined) autoData.set('General', 'N0');
      }
    }
    cellAuto.set(p, name ?? '');
    return name;
  };
  // Text styles of rich text portions ("T1", …) and of header and footer portions ("MT1", …).
  const textAuto = new Map<string, string>();
  const textStyle = (a: EditCharAttribs): string | null => {
    const props = ExportTextProperties(a, fonts);
    if (!props) return null;
    let n = textAuto.get(props);
    if (!n) { n = `T${textAuto.size + 1}`; textAuto.set(props, n); contentAuto += `<style:style style:name="${n}" style:family="text">${props}</style:style>`; }
    return n;
  };
  let stylesAuto = '';
  const masterText = new Map<string, string>();
  const masterTextStyle = (a: EditCharAttribs): string | null => {
    const props = ExportTextProperties(a, fonts);
    if (!props) return null;
    let n = masterText.get(props);
    if (!n) { n = `MT${masterText.size + 1}`; masterText.set(props, n); stylesAuto += `<style:style style:name="${n}" style:family="text">${props}</style:style>`; }
    return n;
  };
  // Page styles: page layouts ("Mpm1", …) and master pages (XMLTableMasterPageExport).
  let masterPages = '';
  pool.GetStyles(SfxStyleFamily.Page).forEach((st, i) => {
    const get = <K extends ScItemId>(k: K): ScItems[K] => st.GetItem(k);
    stylesAuto += ExportPageLayout(`Mpm${i + 1}`, get);
    const hs = get('ATTR_PAGE_HEADERSET'), fs = get('ATTR_PAGE_FOOTERSET');
    const name = st.GetName();
    masterPages += `<style:master-page style:name="${styleId(name)}"${styleId(name) !== name ? ` style:display-name="${escapeXml(name)}"` : ''} style:page-layout-name="Mpm${i + 1}">`
      + ExportHeaderFooter(get('ATTR_PAGE_HEADERRIGHT'), 'style:header', hs.bOn, masterTextStyle)
      + ExportHeaderFooter(get('ATTR_PAGE_HEADERLEFT'), 'style:header-left', !hs.bShared && hs.bOn, masterTextStyle)
      + ExportHeaderFooter(get('ATTR_PAGE_HEADERFIRST'), 'style:header-first', !hs.bSharedFirst && hs.bOn, masterTextStyle)
      + ExportHeaderFooter(get('ATTR_PAGE_FOOTERRIGHT'), 'style:footer', fs.bOn, masterTextStyle)
      + ExportHeaderFooter(get('ATTR_PAGE_FOOTERLEFT'), 'style:footer-left', !fs.bShared && fs.bOn, masterTextStyle)
      + ExportHeaderFooter(get('ATTR_PAGE_FOOTERFIRST'), 'style:footer-first', !fs.bSharedFirst && fs.bOn, masterTextStyle)
      + '</style:master-page>';
  });

  const colStyles = new Map<number, string>();
  const colStyle = (w: number): string => {
    let n = colStyles.get(w);
    if (!n) { n = `co${colStyles.size + 1}`; colStyles.set(w, n); contentAuto += `<style:style style:name="${n}" style:family="table-column"><style:table-column-properties fo:break-before="auto" style:column-width="${measure(w)}"/></style:style>`; }
    return n;
  };
  const rowStyles = new Map<string, string>();
  const rowStyle = (h: number, bOptimal: boolean): string => {
    const k = `${h}|${bOptimal}`;
    let n = rowStyles.get(k);
    if (!n) { n = `ro${rowStyles.size + 1}`; rowStyles.set(k, n); contentAuto += `<style:style style:name="${n}" style:family="table-row"><style:table-row-properties style:row-height="${measure(h)}" fo:break-before="auto" style:use-optimal-row-height="${bOptimal}"/></style:style>`; }
    return n;
  };
  const tableStyles = new Map<string, string>();
  const tableStyle = (nTab: SCTAB): string => {
    const color = doc.GetTabBgColor(nTab);
    const props = `table:display="${doc.IsVisible(nTab)}" style:writing-mode="${doc.IsLayoutRTL(nTab) ? 'rl-tb' : 'lr-tb'}"${color ? ` tableooo:tab-color="${color}"` : ''}`;
    const k = `${doc.GetPageStyle(nTab)}|${props}`;
    let n = tableStyles.get(k);
    if (!n) { n = `ta${tableStyles.size + 1}`; tableStyles.set(k, n); contentAuto += `<style:style style:name="${n}" style:family="table" style:master-page-name="${styleId(doc.GetPageStyle(nTab) || STR_STYLENAME_STANDARD)}"><style:table-properties ${props}/></style:style>`; }
    return n;
  };

  let body = '';
  for (let nTab = 0; nTab < doc.GetTableCount(); nTab++) body += ExportTable(nTab);
  const globalNames = doc.GetRangeName();
  const namesXml = globalNames && !globalNames.empty() ? WriteNamedRange(globalNames) : '';
  // table:calculation-settings, where they differ from ODF's defaults.
  const aOpt = doc.GetDocOptions();
  const { nDay, nMonth, nYear } = aOpt.GetDate();
  let calcAttrs = '';
  if (aOpt.IsIgnoreCase()) calcAttrs += ' table:case-sensitive="false"';
  if (aOpt.IsCalcAsShown()) calcAttrs += ' table:precision-as-shown="true"';
  if (!aOpt.IsMatchWholeCell()) calcAttrs += ' table:search-criteria-must-apply-to-whole-cell="false"';
  if (!aOpt.IsLookUpColRowNames()) calcAttrs += ' table:automatic-find-labels="false"';
  if (aOpt.IsFormulaWildcardsEnabled()) calcAttrs += ' table:use-wildcards="true"';
  else if (!aOpt.IsFormulaRegexEnabled()) calcAttrs += ' table:use-regular-expressions="false"';
  if (aOpt.GetYear2000() !== 1930) calcAttrs += ` table:null-year="${aOpt.GetYear2000()}"`;
  let calcKids = '';
  if (nDay !== 30 || nMonth !== 12 || nYear !== 1899) calcKids += `<table:null-date table:date-value="${String(nYear).padStart(4, '0')}-${String(nMonth).padStart(2, '0')}-${String(nDay).padStart(2, '0')}"/>`;
  if (aOpt.IsIter() || aOpt.GetIterCount() !== 100 || aOpt.GetIterEps() !== 0.001) calcKids += `<table:iteration table:status="${aOpt.IsIter() ? 'enable' : 'disable'}" table:steps="${aOpt.GetIterCount()}" table:maximum-difference="${aOpt.GetIterEps()}"/>`;
  const calcSettings = calcAttrs || calcKids ? `<table:calculation-settings${calcAttrs}>${calcKids}</table:calculation-settings>` : '';

  // Data styles written after the styles that name them are known.
  const numberStylesOf = (m: Map<string, string>) => [...m].map(([code, name]) => (code === 'General' ? `<number:number-style style:name="${name}"><number:number number:min-integer-digits="1"/></number:number-style>` : ExportNumberStyle(name, code, 'en-US'))).join('');
  const contentAutoAll = numberStylesOf(autoData) + contentAuto;
  const stylesBody = defaultStyle + numberStylesOf(namedData) + namedStyles;
  const fontDecls = fonts.Export();
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const mime = bTemplate ? MIME_TEMPLATE : MIME;
  const bodyXml = `<office:body><office:spreadsheet>${calcSettings}${ExportValidations(doc)}${body}${namesXml}${ExportDatabaseRanges(doc)}</office:spreadsheet></office:body>`;
  const content = `${head}<office:document-content ${NS}>${fontDecls}<office:automatic-styles>${contentAutoAll}</office:automatic-styles>${bodyXml}</office:document-content>`;
  const styles = `${head}<office:document-styles ${NS}>${fontDecls}<office:styles>${stylesBody}</office:styles><office:automatic-styles>${stylesAuto}</office:automatic-styles><office:master-styles>${masterPages}</office:master-styles></office:document-styles>`;
  sh.m_xDocProps.setGenerator(GetGeneratorString());
  const metaBody = sh.m_xDocProps.Write();
  const meta = `${head}<office:document-meta ${NS}>${metaBody}</office:document-meta>`;
  const settingsBody = `<office:settings>${viewSettings ? WriteViewSettings(viewSettings) : ''}<config:config-item-set config:name="ooo:configuration-settings">${configItem('ApplyUserData', sh.m_bUseUserData)}${configItem('SaveVersionOnClose', sh.m_bSaveVersionOnClose)}</config:config-item-set></office:settings>`;
  const settings = `${head}<office:document-settings ${NS}>${settingsBody}</office:document-settings>`;
  return { content, styles, meta, settings, mime, fontDecls, stylesBody, autoStylesStyles: stylesAuto, masterStyles: masterPages, contentAuto: contentAutoAll, body: bodyXml, settingsBody };

  /** ScXMLExport::WriteNamedRange */
  function WriteNamedRange(pRangeName: ScRangeName): string {
    let s = '';
    for (const rd of pRangeName) {
      const base = ScRangeStringConverter.GetStringFromAddress(rd.GetPos(), doc, true);
      const sym = rd.GetSymbol(FormulaGrammar.GRAM_ODFF);
      if (rd.IsReference() && sym.startsWith('[') && sym.endsWith(']')) {
        const types: string[] = [];
        if (rd.HasType(ScRangeDataType.ColHeader)) types.push('repeat-column');
        if (rd.HasType(ScRangeDataType.RowHeader)) types.push('repeat-row');
        if (rd.HasType(ScRangeDataType.Criteria)) types.push('filter');
        if (rd.HasType(ScRangeDataType.PrintArea)) types.push('print-range');
        if (rd.HasType(ScRangeDataType.Hidden)) types.push('hidden');
        s += `<table:named-range table:name="${escapeXml(rd.GetName())}" table:base-cell-address="${escapeXml(base)}" table:cell-range-address="${escapeXml(sym.slice(1, -1))}"${types.length ? ` table:range-usable-as="${types.join(' ')}"` : ''}/>`;
      } else {
        s += `<table:named-expression table:name="${escapeXml(rd.GetName())}" table:base-cell-address="${escapeXml(base)}" table:expression="of:=${escapeXml(sym)}"${rd.HasType(ScRangeDataType.Hidden) ? ' loext:hidden="true"' : ''}/>`;
      }
    }
    return `<table:named-expressions>${s}</table:named-expressions>`;
  }

  /** ScXMLExport::WriteTable */
  function ExportTable(nTab: SCTAB): string {
    const pTable = doc.FetchTable(nTab)!;
    const nMaxCol = doc.MaxCol(), nMaxRow = doc.MaxRow();
    const cols = pTable.GetColumns();
    // The used area: cells, notes, attributes (not those of whole columns), merges.
    let nLastCol = -1, nLastRow = -1;
    cols.forEach((c, i) => {
      const nUsed = c.GetLastUsedRow();
      const entries = c.pAttrArray.GetEntries();
      const bAttr = entries.length > 1 || entries[0]!.pPattern !== pDefault;
      if (nUsed >= 0 || bAttr) nLastCol = i;
      if (nUsed >= 0) nLastRow = Math.max(nLastRow, nUsed);
      if (nUsed >= 0 && nUsed < nMaxRow) {
        // A merge's covered rows belong to the area too.
        const m = c.GetPattern(nUsed).GetItem('ATTR_MERGE');
        if (m.nRowMerge > 1) nLastRow = Math.max(nLastRow, nUsed + m.nRowMerge - 1);
      }
    });
    for (let i = 0; i <= nMaxCol; i++) {
      if (pTable.GetOriginalWidth(i) !== pTable.GetOriginalWidth(nMaxCol) || pTable.ColHidden(i)) nLastCol = Math.max(nLastCol, i);
    }
    // Rows whose height, flags or visibility differ from the last row's are part of the area.
    {
      const rh = { nStartRow: 0, nEndRow: 0 }, rf = { nStartRow: 0, nEndRow: 0 };
      const hLast = pTable.GetRowHeight(nMaxRow, false), fLast = pTable.GetRowFlags(nMaxRow), hidLast = pTable.RowHidden(nMaxRow);
      for (let r = 0; r <= nMaxRow;) {
        const h = pTable.GetRowHeight(r, false, rh), fl = pTable.GetRowFlags(r, rf), hid = pTable.RowHiddenRange(r);
        const end = Math.min(rh.nEndRow, rf.nEndRow, hid.nLastRow);
        if (h !== hLast || fl !== fLast || hid.bHidden !== hidLast) nLastRow = Math.max(nLastRow, end === nMaxRow ? r : end);
        r = end + 1;
      }
    }
    let s = `<table:table table:name="${escapeXml(doc.GetName(nTab) ?? '')}" table:style-name="${tableStyle(nTab)}"`;
    if (doc.IsTabProtected(nTab)) s += ' table:protected="true"';
    if (!doc.IsPrintEntireSheet(nTab)) {
      const ranges: ScRange[] = [];
      for (let i = 0; i < doc.GetPrintRangeCount(nTab); i++) ranges.push(doc.GetPrintRange(nTab, i)!);
      s += ranges.length ? ` table:print-ranges="${escapeXml(ScRangeStringConverter.GetStringFromRangeList(ranges, doc))}"` : ' table:print="false"';
    }
    s += '>';
    // Columns (ScXMLExport::ExportColumns): runs of equal width and visibility.
    const repCols = doc.GetRepeatColRange(nTab);
    const colXml = (c1: SCCOL, c2: SCCOL): string => {
      let out = '';
      for (let c = c1; c <= c2;) {
        const w = pTable.GetOriginalWidth(c), hid = pTable.ColHidden(c);
        let e = c;
        while (e < c2 && pTable.GetOriginalWidth(e + 1) === w && pTable.ColHidden(e + 1) === hid) e++;
        out += `<table:table-column table:style-name="${colStyle(w)}"${e > c ? ` table:number-columns-repeated="${e - c + 1}"` : ''}${hid ? ' table:visibility="collapse"' : ''} table:default-cell-style-name="Default"/>`;
        c = e + 1;
      }
      return out;
    };
    const nColEnd = nMaxCol;
    if (repCols) {
      const h1 = repCols.aStart.Col(), h2 = repCols.aEnd.Col();
      s += (h1 > 0 ? colXml(0, h1 - 1) : '') + `<table:table-header-columns>${colXml(h1, h2)}</table:table-header-columns>` + (h2 < nColEnd ? colXml(h2 + 1, nColEnd) : '');
    } else s += colXml(0, nColEnd);
    // Rows (ScXMLExport::WriteRowStartTag and the cells, ScXMLExport::WriteCell).
    const nCellCols = Math.max(nLastCol, -1);
    const rowXml = (r1: SCROW, r2: SCROW): string => {
      let out = '';
      let prev = '', prevCount = 0;
      const flush = () => {
        if (!prevCount) return;
        out += prevCount > 1 ? prev.replace('<table:table-row ', `<table:table-row table:number-rows-repeated="${prevCount}" `) : prev;
        prevCount = 0;
      };
      const rh = { nStartRow: 0, nEndRow: 0 }, rf = { nStartRow: 0, nEndRow: 0 };
      for (let r = r1; r <= r2;) {
        // The rows up to the next change of any column's content or attributes, height or flags.
        const h = pTable.GetRowHeight(r, false, rh);
        const bManual = (pTable.GetRowFlags(r, rf) & 1 /* CRFlags.ManualSize */) !== 0;
        const hid = pTable.RowHiddenRange(r);
        let end = Math.min(rh.nEndRow, rf.nEndRow, hid.nLastRow, r2);
        let bData = false;
        for (let c = 0; c <= nCellCols && c < cols.length; c++) {
          const col = cols[c]!;
          if (col.HasDataAt(r) || col.GetCellNote(r) || col.GetPattern(r).IsMerged() || col.GetPattern(r).IsOverlapped()) { bData = true; break; }
          const pr = col.pAttrArray.GetPatternRange(r);
          end = Math.min(end, pr.nEndRow);
          const nNext = col.GetNextDataPos(r);
          if (nNext >= 0 && nNext > r) end = Math.min(end, nNext - 1);
          const notes = col.GetNoteRows().find((n) => n > r);
          if (notes !== undefined) end = Math.min(end, notes - 1);
        }
        if (bData) end = r;
        const style = rowStyle(h, !bManual);
        const cellsXml = CellsXml(r, nCellCols);
        const rowOpen = `<table:table-row table:style-name="${style}"${hid.bHidden ? (pTable.RowFiltered(r) ? ' table:visibility="filter"' : ' table:visibility="collapse"') : ''}>`;
        const xml = `${rowOpen}${cellsXml}</table:table-row>`;
        const n = end - r + 1;
        if (xml === prev && !bData) prevCount += n;
        else { flush(); prev = xml; prevCount = n; }
        r = end + 1;
      }
      flush();
      return out;
    };
    const repRows = doc.GetRepeatRowRange(nTab);
    if (repRows) {
      const h1 = repRows.aStart.Row(), h2 = repRows.aEnd.Row();
      s += (h1 > 0 ? rowXml(0, h1 - 1) : '') + `<table:table-header-rows>${rowXml(h1, h2)}</table:table-header-rows>` + (h2 < nMaxRow ? rowXml(h2 + 1, nMaxRow) : '');
    } else s += rowXml(0, nMaxRow);
    const local = doc.GetRangeName(nTab);
    if (local && !local.empty()) s += WriteNamedRange(local);
    s += ExportConditionalFormat(doc, nTab, styleId);
    return `${s}</table:table>`;

    /** The cells of a row: those with content one by one, equal empty ones repeated. */
    function CellsXml(nRow: SCROW, nLast: SCCOL): string {
      let out = '';
      let prev = '', prevCount = 0;
      const flush = () => { if (prevCount) out += prevCount > 1 ? prev.replace(/^<table:(table|covered-table)-cell/, (m) => `${m} table:number-columns-repeated="${prevCount}"`) : prev; prevCount = 0; };
      for (let c = 0; c <= nLast; c++) {
        const col = c < cols.length ? cols[c]! : null;
        const xml = col ? CellXml(new ScAddress(c, nRow, nTab), col.GetPattern(nRow)) : '<table:table-cell/>';
        if (xml === prev && !/office:value-type|table:formula|office:annotation|spanned/.test(xml)) prevCount++;
        else { flush(); prev = xml; prevCount = 1; }
      }
      flush();
      // The rest of the row up to the last column: the default cell (or the last column's pattern).
      const nRest = nMaxCol - nLast;
      if (nRest > 0) {
        const p = nLast + 1 < cols.length ? cols[nLast + 1]!.GetPattern(nRow) : pDefault;
        const st = patternStyle(p);
        const nValid = p.GetItem('ATTR_VALIDDATA');
        const sValid = nValid && doc.GetValidationEntry(nValid) ? ` table:content-validation-name="${ValidationName(nValid)}"` : '';
        out += `<table:table-cell${nRest > 1 ? ` table:number-columns-repeated="${nRest}"` : ''}${st ? ` table:style-name="${st}"` : ''}${sValid}/>`;
      }
      return out;
    }

    function CellXml(aPos: ScAddress, pPattern: ScPatternAttr): string {
      const st = patternStyle(pPattern);
      const bCovered = pPattern.IsOverlapped();
      const tag = bCovered ? 'table:covered-table-cell' : 'table:table-cell';
      let attrs = st ? ` table:style-name="${st}"` : '';
      const nValid = pPattern.GetItem('ATTR_VALIDDATA');
      if (nValid && doc.GetValidationEntry(nValid)) attrs += ` table:content-validation-name="${ValidationName(nValid)}"`;
      const m = pPattern.GetItem('ATTR_MERGE');
      if (!bCovered && (m.nColMerge > 1 || m.nRowMerge > 1)) attrs += ` table:number-columns-spanned="${Math.max(1, m.nColMerge)}" table:number-rows-spanned="${Math.max(1, m.nRowMerge)}"`;
      let inner = '';
      const note = doc.GetNote(aPos);
      if (note) {
        inner += `<office:annotation${note.mbShown ? ' office:display="true"' : ''}>${note.maAuthor ? `<dc:creator>${escapeXml(note.maAuthor)}</dc:creator>` : ''}${note.maDate ? `<dc:date>${escapeXml(note.maDate)}</dc:date>` : ''}${note.maText.split('\n').map((l) => `<text:p>${escapeXml(l)}</text:p>`).join('')}</office:annotation>`;
      }
      const eType = doc.GetCellType(aPos);
      if (eType === CELLTYPE_NONE) return `<${tag}${attrs}>${inner}</${tag}>`.replace(`<${tag}${attrs}></${tag}>`, `<${tag}${attrs}/>`);
      const display = () => ParagraphsOf(doc.GetString(aPos));
      const valueAttrs = (f: number, code: string): string => {
        switch (FormatType(code)) {
          case SvNumFormatType.PERCENT: return ` office:value-type="percentage" office:value="${NumberText(f)}" calcext:value-type="percentage"`;
          case SvNumFormatType.CURRENCY: return ` office:value-type="currency" office:value="${NumberText(f)}" calcext:value-type="currency"`;
          case SvNumFormatType.DATE: case SvNumFormatType.DATETIME: return ` office:value-type="date" office:date-value="${SerialToDate(f, doc)}" calcext:value-type="date"`;
          case SvNumFormatType.TIME: return ` office:value-type="time" office:time-value="${DaysToDuration(f)}" calcext:value-type="time"`;
          case SvNumFormatType.LOGICAL: return ` office:value-type="boolean" office:boolean-value="${f !== 0}" calcext:value-type="boolean"`;
          default: return ` office:value-type="float" office:value="${NumberText(f)}" calcext:value-type="float"`;
        }
      };
      const code = pPattern.GetNumberFormat();
      switch (eType) {
        case CELLTYPE_VALUE:
          attrs += valueAttrs(doc.GetValue(aPos), code);
          inner += display();
          break;
        case CELLTYPE_STRING:
          attrs += ' office:value-type="string" calcext:value-type="string"';
          inner += ParagraphsOf(doc.GetCellData(aPos) as string);
          break;
        case CELLTYPE_EDIT: {
          attrs += ' office:value-type="string" calcext:value-type="string"';
          inner += ExportParagraphs(doc.GetEditText(aPos)!, textStyle);
          break;
        }
        case CELLTYPE_FORMULA: {
          const f = doc.GetFormulaCell(aPos)!;
          if (f.GetMatrixFlag() === ScMatrixMode.Reference) {
            // A cell of an array formula's area: its result only.
            attrs += FormulaResultAttrs(f, code);
            inner += display();
            break;
          }
          // An array formula's text is written without its braces.
          let sFormula = f.GetFormula(FormulaGrammar.GRAM_ODFF);
          if (sFormula.startsWith('{') && sFormula.endsWith('}')) sFormula = sFormula.slice(1, -1);
          attrs += ` table:formula="${escapeXml(`of:${sFormula}`)}"`;
          if (f.GetMatrixFlag() === ScMatrixMode.Formula) {
            const { nCols, nRows } = f.GetMatColsRows();
            attrs += ` table:number-matrix-columns-spanned="${nCols}" table:number-matrix-rows-spanned="${nRows}"`;
          }
          attrs += FormulaResultAttrs(f, code);
          inner += display();
          break;
        }
        default: break;
      }
      return `<${tag}${attrs}>${inner}</${tag}>`;

      function FormulaResultAttrs(f: ScFormulaCell, code: string): string {
        const nErr = f.GetErrCode();
        if (nErr !== FormulaError.NONE) return ` office:value-type="string" office:string-value="" calcext:value-type="error"`;
        if (f.IsValue()) return valueAttrs(f.GetValue(), code);
        return ` office:value-type="string" office:string-value="${escapeXml(f.GetString())}" calcext:value-type="string"`;
      }
    }
  }
}

/** The text:p elements of a plain string (lines as paragraphs, spaces as text:s). */
function ParagraphsOf(s: string): string {
  return s.split('\n').map((l) => `<text:p>${l.split(/( {2,}|\t)/).map((part, i) => (part === '\t' ? '<text:tab/>' : i % 2 ? ` <text:s${part.length > 2 ? ` text:c="${part.length - 1}"` : ''}/>` : escapeXml(part))).join('')}</text:p>`).join('');
}

/** The cell attribute items of an item set (the page items and the merge items apart). */
function cellOnly(s: ScItemSet): ScItemSet {
  const out: ScItemSet = {};
  for (const k of SC_ITEM_IDS) {
    if (k === 'ATTR_MERGE' || k === 'ATTR_MERGE_FLAG') continue;
    if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

/**
 * ScXMLExport through ScXMLImportWrapper::Export: the document as an ODF package. `extra` are
 * further streams of the package the filter does not write (the versions of SfxMedium).
 */
export async function ExportODS(sh: ScDocShell, extra: readonly ZipEntry[] = [], bTemplate = false, viewSettings?: ScViewSettings): Promise<Uint8Array> {
  const p = ExportDocument(sh, bTemplate, viewSettings);
  const enc = new TextEncoder();
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const manifest = `${head}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${p.mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>${extra.map((e) => `<manifest:file-entry manifest:full-path="${escapeXml(e.name)}" manifest:media-type="${e.name.endsWith('.png') ? 'image/png' : e.name.endsWith('.xml') ? 'text/xml' : ''}"/>`).join('')}</manifest:manifest>`;
  return writeZip([
    { name: 'mimetype', data: enc.encode(p.mime), store: true }, // ODF requires it first and uncompressed
    { name: 'content.xml', data: enc.encode(p.content) },
    { name: 'styles.xml', data: enc.encode(p.styles) },
    { name: 'meta.xml', data: enc.encode(p.meta) },
    { name: 'settings.xml', data: enc.encode(p.settings) },
    ...extra,
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
  ]);
}

/** The document as a flat OpenDocument spreadsheet (.fods). */
export function ExportFODS(sh: ScDocShell, viewSettings?: ScViewSettings): string {
  const p = ExportDocument(sh, false, viewSettings);
  const meta = sh.m_xDocProps.Write();
  return `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:mimetype="${p.mime}">${meta}${p.settingsBody}${p.fontDecls}<office:styles>${p.stylesBody}</office:styles><office:automatic-styles>${p.autoStylesStyles}${p.contentAuto}</office:automatic-styles><office:master-styles>${p.masterStyles}</office:master-styles>${p.body}</office:document>`;
}
