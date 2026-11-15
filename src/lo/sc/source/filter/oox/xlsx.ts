// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/oox/excelfilter.cxx reduced
// @upstream sc/source/filter/oox/workbookfragment.cxx reduced
// @upstream sc/source/filter/oox/workbookhelper.cxx reduced
// @upstream sc/source/filter/oox/workbooksettings.cxx reduced
// @upstream sc/source/filter/oox/worksheetbuffer.cxx reduced
// ExcelFilter::importDocument for the OOXML formats (XLSX, XLSM, XLTX, XLTM): the package, the
// document properties, workbook.xml (workbookPr, calcPr, sheets, definedNames, bookViews), the
// theme, styles and shared strings, every worksheet, and finally the formulas, defined names and
// view settings, as WorkbookFragment::finalizeImport does. ExportXLSX (sc/source/filter/excel) is
// re-exported here. Reduced: the import runs on parsed XML trees instead of SAX contexts; BIFF12
// (XLSB) parts are not read; chart sheets, dialog sheets and macro sheets become empty sheets;
// external links, pivot caches, connections, query tables, revisions, VBA projects and the
// other unsupported parts are reported through `lost`; the OOXML recalculation option is
// "never recalculate" (cached results are kept, cells without one are calculated) unless the
// workbook asks for a full calculation on load; optimal row heights are not recalculated after
// loading (UpdateAllRowHeights).
import { BrokenPackageError, readZip } from '../../../../package/source/zipapi/zip.ts';
import { childElements, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { ReadAppProperties, ReadCoreProperties, ReadCustomProperties } from '../../../../oox/source/docprop/docprophandler.ts';
import { SC_TAB_APPEND } from '../../../inc/address.ts';
import { ScDocument } from '../../core/data/document.ts';
import { ScDocumentImport } from '../../core/data/documentimport.ts';
import { ScDocShell } from '../../ui/docshell/docsh.ts';
import { SfxDocumentMetaData } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';
import type { ScViewSettings } from '../xml/ods.ts';
import { AddressConverter } from './addressconverter.ts';
import { DefinedNamesBuffer } from './defnamesbuffer.ts';
import { SharedStringsBuffer } from './richstring.ts';
import { attrs, kid, kids, ln, StylesBuffer, ThemeBuffer } from './stylesbuffer.ts';
import { UnitConverter } from './unitconverter.ts';
import { ViewSettings } from './viewsettings.ts';
import { WorksheetFragment, type WorkbookContext } from './worksheetfragment.ts';

export { ExportXLSX } from '../excel/xestream.ts';

export interface ImportXLSXResult { doc: ScDocShell; lost: string[]; storage?: Map<string, Uint8Array>; template?: boolean; viewSettings?: ScViewSettings }

/** The content types of the main part (filter/source/config/fragments/types). */
const MAIN_TEMPLATE = ['application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml', 'application/vnd.ms-excel.template.macroEnabled.main+xml'];
const MAIN_MACRO = ['application/vnd.ms-excel.sheet.macroEnabled.main+xml', 'application/vnd.ms-excel.template.macroEnabled.main+xml'];
const MAIN_BINARY = 'application/vnd.ms-excel.sheet.binary.macroEnabled.main';

const textOf = (e: XmlElement | undefined): string => (e ? e.children.map((c) => (typeof c === 'string' ? c : '')).join('') : '');

/** The sheet types (WorksheetType). */
type WorksheetType = 'Work' | 'Chart' | 'Macro' | 'Dialog';

/** bRepairPackage: the MediaDescriptor's RepairPackage, which reads a broken package's entries
    from their local headers. */
export async function ImportXLSX(bytes: Uint8Array, bRepairPackage = false): Promise<ImportXLSXResult> {
  // An encrypted document is an OLE compound file, not a zip.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('This spreadsheet is password-protected or in the old binary Excel format. Encrypted documents cannot be opened yet.');
  let files = await readZip(bytes, bRepairPackage);
  // Part names with backslashes are not valid in a package (ZipPackage refuses them); repairing
  // reads them with slashes, and part names are compared without case as OPC requires.
  if ([...files.keys()].some((n) => n.includes('\\'))) {
    if (!bRepairPackage) throw new BrokenPackageError('Invalid part names in the package');
    files = new Map([...files].map(([k, v]) => [k.replace(/\\/g, '/'), v]));
  }
  const lower = new Map([...files.keys()].map((k) => [k.toLowerCase(), k]));
  const dec = new TextDecoder();
  const part = (path: string) => { const p = path.replace(/^\//, ''); return files.get(p) ?? files.get(lower.get(p.toLowerCase()) ?? ''); };
  const text = (path: string) => { const b = part(path); return b ? dec.decode(b) : undefined; };
  const xmlCache = new Map<string, XmlElement | undefined>();
  const xml = (path: string): XmlElement | undefined => {
    const p = path.replace(/^\//, '');
    if (!xmlCache.has(p)) { const t = text(p); xmlCache.set(p, t ? parseXml(t) : undefined); }
    return xmlCache.get(p);
  };
  const rootOf = (e: XmlElement | undefined) => (e ? childElements(e)[0] : undefined);
  /** Relations::getFragmentPathFromRelId: the relations of a part, targets made absolute. */
  const rels = (part: string): Map<string, { type: string; target: string; external: boolean }> => {
    const p = part.replace(/^\//, '');
    const dir = p.slice(0, p.lastIndexOf('/') + 1);
    const out = new Map<string, { type: string; target: string; external: boolean }>();
    const r = rootOf(xml(`${dir}_rels/${p.slice(dir.length)}.rels`));
    for (const e of r ? childElements(r).filter((x) => /(^|:)Relationship$/.test(x.name)) : []) {
      const target = e.attrs.get('Target') ?? '';
      const external = e.attrs.get('TargetMode') === 'External';
      let t = external ? target : target.startsWith('/') ? target.slice(1) : dir + target;
      if (!external) {
        // resolve '..'
        const parts: string[] = [];
        for (const s of t.split('/')) { if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); }
        t = parts.join('/');
      }
      out.set(e.attrs.get('Id') ?? '', { type: e.attrs.get('Type') ?? '', target: t, external });
    }
    return out;
  };

  // The main part is the package's officeDocument relationship, usually xl/workbook.xml.
  const pkgRels = rels('');
  const mainRel = [...pkgRels.values()].find((r) => /\/officeDocument$/.test(r.type));
  const aWorkbookPath = mainRel?.target ?? 'xl/workbook.xml';
  const contentTypes = rootOf(xml('[Content_Types].xml'));
  const ctOverride = (path: string) => contentTypes && childElements(contentTypes).find((e) => /(^|:)Override$/.test(e.name) && (e.attrs.get('PartName') ?? '').replace(/^\//, '') === path)?.attrs.get('ContentType');
  const aMainType = ctOverride(aWorkbookPath) ?? '';
  if (aMainType.startsWith(MAIN_BINARY) || /\.bin$/.test(aWorkbookPath)) throw new Error('This is an Excel binary workbook (XLSB), which cannot be opened yet.');
  const workbook = rootOf(xml(aWorkbookPath));
  if (!workbook || ln(workbook) !== 'workbook') throw new Error('This file has no workbook part, so it is not an Excel spreadsheet.');

  const lost = new Set<string>();
  const rDoc = new ScDocument();
  const aDocProps = new SfxDocumentMetaData();

  // OOXMLDocumentPropertiesImporter: the package's core, extended and custom properties.
  const propsPart = (type: RegExp) => { const r = [...pkgRels.values()].find((x) => type.test(x.type)); return r ? rootOf(xml(r.target)) : undefined; };
  const core = propsPart(/\/metadata\/core-properties$/), app = propsPart(/\/extended-properties$/), custom = propsPart(/\/custom-properties$/);
  if (core) ReadCoreProperties(aDocProps, core);
  if (app) ReadAppProperties(aDocProps, app);
  if (custom) ReadCustomProperties(aDocProps, custom);
  // FilterBase::isMSODocument: written by Microsoft Office
  const bMSODocument = /^Microsoft/i.test(textOf(app && childElements(app).find((e) => e.name.replace(/^.*:/, '') === 'Application')));

  // workbook relations: styles, shared strings, theme, and the unsupported parts
  const wbRels = rels(aWorkbookPath);
  const relOf = (type: RegExp) => [...wbRels.values()].find((r) => type.test(r.type));
  if (MAIN_MACRO.includes(aMainType) || relOf(/\/vbaProject$/) || !!part('xl/vbaProject.bin')) lost.add('Macros');
  if (relOf(/\/externalLink$/)) lost.add('External links');
  if (relOf(/\/connections$/)) lost.add('Data connections');
  for (const r of wbRels.values()) if (/\/revisionHeaders$/.test(r.type)) lost.add('Tracked changes');

  const aUnitConverter = new UnitConverter();
  const aTheme = new ThemeBuffer();
  const themeRel = relOf(/\/theme$/);
  if (themeRel) aTheme.importTheme(xml(themeRel.target));
  const aStyles = new StylesBuffer(rDoc, aUnitConverter, aTheme);
  const stylesRel = relOf(/\/styles$/);
  if (stylesRel) aStyles.importStyles(rootOf(xml(stylesRel.target)));
  aStyles.finalizeImport();
  const aStrings = new SharedStringsBuffer();
  const sstRel = relOf(/\/sharedStrings$/);
  if (sstRel) aStrings.importSharedStrings(rootOf(xml(sstRel.target)), aStyles);
  aStrings.finalizeImport();
  if (aStrings.hasPhonetic()) lost.add('Phonetic guides (furigana)');

  // WorkbookFragment: the workbook's elements
  const aOptions = rDoc.GetDocOptions().clone();
  aOptions.SetLookUpColRowNames(false);
  let bFullCalcOnLoad = false, bAutoCalc = true;
  const aViewSettings = new ViewSettings();
  const aDefNames = new DefinedNamesBuffer();
  const aSheets: { name: string; state: string; rid: string }[] = [];
  for (const e of childElements(workbook)) {
    const a = attrs(e);
    switch (ln(e)) {
      case 'workbookPr':
        // setDateMode
        if (a.getBool('date1904', false)) {
          aOptions.SetDate(1, 1, 1904);
          aUnitConverter.finalizeNullDate({ Day: 1, Month: 1, Year: 1904 });
        }
        break;
      case 'calcPr':
        aOptions.SetIter(a.getBool('iterate', false));
        aOptions.SetIterCount(a.getInteger('iterateCount', 100));
        aOptions.SetIterEps(a.getDouble('iterateDelta', 0.0001));
        aOptions.SetCalcAsShown(!a.getBool('fullPrecision', true));
        bAutoCalc = ['auto', 'autoNoTable'].includes(a.getToken('calcMode', 'auto'));
        bFullCalcOnLoad = a.getBool('fullCalcOnLoad', false);
        break;
      case 'bookViews': for (const v of kids(e, 'workbookView')) aViewSettings.importWorkbookView(attrs(v)); break;
      case 'sheets':
        for (const s of kids(e, 'sheet')) aSheets.push({ name: attrs(s).getXString('name', '')!, state: attrs(s).getToken('state', 'visible'), rid: s.attrs.get('r:id') ?? '' });
        break;
      case 'definedNames':
        for (const d of kids(e, 'definedName')) aDefNames.importDefinedName(attrs(d), textOf(d));
        break;
      case 'externalReferences': if (kids(e).length) lost.add('External links'); break;
      case 'pivotCaches': break; // the pivot tables are reported with their sheets
      case 'workbookProtection':
        if (a.getBool('lockStructure', false) || a.getBool('lockWindows', false)) lost.add('Workbook structure protection');
        break;
      case 'fileSharing': if (a.hasAttribute('reservationPassword') || a.hasAttribute('hashValue')) lost.add('Password to modify'); break;
      case 'customWorkbookViews': lost.add('Custom views'); break;
      case 'functionGroups': case 'fileVersion': case 'oleSize': case 'fileRecoveryPr': case 'webPublishing': case 'extLst': case 'AlternateContent': case 'mc:AlternateContent': break;
    }
  }
  rDoc.SetDocOptions(aOptions);

  // WorksheetBuffer: insert the sheets
  const aSheetParts: { nTab: number; part: string | undefined; type: WorksheetType }[] = [];
  for (const s of aSheets) {
    const rel = wbRels.get(s.rid);
    const type: WorksheetType = !rel ? 'Work' : /\/chartsheet$/.test(rel.type) ? 'Chart' : /\/xlMacrosheet$/.test(rel.type) ? 'Macro' : /\/dialogsheet$/.test(rel.type) ? 'Dialog' : 'Work';
    const nTab = rDoc.GetTableCount();
    const aName = rDoc.ValidNewTabName(s.name) ? s.name : rDoc.CreateValidTabName(s.name);
    if (!rDoc.InsertTab(SC_TAB_APPEND, aName)) continue;
    // hidden and very hidden sheets are hidden in Calc
    if (s.state === 'hidden' || s.state === 'veryHidden') rDoc.SetVisible(nTab, false);
    aSheetParts.push({ nTab, part: rel?.target, type });
    if (type === 'Chart') lost.add('Chart sheets (imported as empty sheets)');
    else if (type === 'Macro') lost.add('Excel 4 macro sheets (imported as empty sheets)');
    else if (type === 'Dialog') lost.add('Dialog sheets (imported as empty sheets)');
  }
  if (!rDoc.GetTableCount()) { rDoc.MakeTable(0); }

  // defined names (all sheets exist now)
  if (aDefNames.hasExternalNames()) lost.add('External links');
  aDefNames.finalizeImport(rDoc);

  const docImport = new ScDocumentImport(rDoc);
  const aSheetNames = rDoc.GetAllTableNames();
  const ctx: WorkbookContext = {
    doc: rDoc, docImport, styles: aStyles, strings: aStrings, unitConverter: aUnitConverter,
    addressConverter: new AddressConverter(rDoc.GetSheetLimits()), viewSettings: aViewSettings, lost, bMSODocument,
    xml, text, rels, sheetNames: aSheetNames,
  };
  const nActive = aViewSettings.getActiveCalcSheet(rDoc.GetTableCount());
  for (const { nTab, part, type } of aSheetParts) {
    const root = part && type === 'Work' ? rootOf(xml(part)) : undefined;
    const aFragment = new WorksheetFragment(ctx, nTab, part ?? '');
    aFragment.initializeImport();
    if (root) aFragment.importFragment(root);
    aFragment.finalizeImport(nTab === nActive);
  }
  for (const s of aStyles.maLost) lost.add(s);

  // FormulaBuffer / ScDocumentImport::finalize: listening, and the calculation of cells without
  // a cached result (all with fullCalcOnLoad)
  docImport.finalize(bFullCalcOnLoad);
  if (!bAutoCalc) rDoc.SetAutoCalc(false);

  const viewSettings = aViewSettings.finalizeImport(aSheetNames, aStyles);
  const sh = new ScDocShell(rDoc);
  sh.m_xDocProps = aDocProps;
  return { doc: sh, lost: [...lost], template: MAIN_TEMPLATE.includes(aMainType), viewSettings };
}
