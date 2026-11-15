// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xestream.cxx reduced
// @upstream sc/source/filter/excel/excdoc.cxx reduced
// XclExpXmlStream::exportDocument: the XLSX package. ExcDocument::WriteXml writes the workbook
// (workbookPr, bookViews, sheets, definedNames, calcPr), the styles and shared strings, and for
// every sheet ExcTable::WriteXml's worksheet part with its relations (hyperlinks, comments and
// their VML drawing); the document properties go through oox's XmlFilterBase. Reduced: no theme,
// drawings, charts, pivot tables, external links, autofilters, conditional formatting or data
// validation (none of them is in the model); the template and macro-enabled variants are not
// written.
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import { encodeXString } from '../../../../oox/source/helper/attributelist.ts';
import { writeZip, type ZipEntry } from '../../../../package/source/zipapi/zip.ts';
import { writeAppProperties, writeCoreProperties, writeCustomProperties } from '../../../../oox/source/core/xmlfilterbase.ts';
import { GetGeneratorString } from '../../../../unotools/source/config/docinfohelper.ts';
import type { ScDocShell } from '../../ui/docshell/docsh.ts';
import type { ScViewSettings } from '../xml/ods.ts';
import { SaveDefinedNamesXml } from './xename.ts';
import { SaveCommentsVml, SaveCommentsXml } from './xeescher.ts';
import { XclExpSst } from './xecontent.ts';
import { SavePageSettingsXml } from './xepage.ts';
import { XclExpXFBuffer } from './xestyle.ts';
import { SaveCellTableXml, SaveSheetPrXml } from './xetable.ts';
import { SaveBookViewsXml, SaveSheetViewXml } from './xeview.ts';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

function relsXml(rels: { id: string; type: string; target: string; external?: boolean }[]): string {
  return `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')
    + '</Relationships>';
}

/** Export a Calc document as an XLSX package. */
export async function ExportXLSX(sh: ScDocShell, viewSettings?: ScViewSettings): Promise<Uint8Array> {
  const rDoc = sh.GetDocument();
  const enc = new TextEncoder();
  const files: ZipEntry[] = [];
  const overrides: [string, string][] = [];
  const add = (name: string, data: string, contentType?: string) => {
    files.push({ name, data: enc.encode(data) });
    if (contentType) overrides.push([`/${name}`, contentType]);
  };

  const rXF = new XclExpXFBuffer(rDoc);
  const rSst = new XclExpSst();
  const nTabs = rDoc.GetTableCount();
  const aNames = rDoc.GetAllTableNames();
  let nActive = viewSettings ? Math.max(0, aNames.indexOf(viewSettings.ActiveTable)) : 0;
  // the active sheet must be visible
  if (!rDoc.IsVisible(nActive)) { const v = aNames.findIndex((_, i) => rDoc.IsVisible(i)); nActive = v >= 0 ? v : 0; }

  const wbRels: { id: string; type: string; target: string }[] = [];
  let sheetsXml = '';
  let nDrawing = 0;
  for (let nTab = 0; nTab < nTabs; nTab++) {
    const aName = aNames[nTab]!;
    const sheetRels: { id: string; type: string; target: string; external?: boolean }[] = [];
    const page = SavePageSettingsXml(rDoc, nTab, rXF.maDefFontName, rXF.mnDefFontHeight);
    const head = {
      sheetPr: SaveSheetPrXml(rDoc.GetTabBgColor(nTab), page.bFitToPages),
      sheetViews: SaveSheetViewXml(viewSettings, aName, nTab === nActive, rDoc.IsLayoutRTL(nTab)),
      afterData: rDoc.IsTabProtected(nTab) ? '<sheetProtection sheet="true" objects="true" scenarios="true"/>' : '',
      page: page.xml,
    };
    const res = SaveCellTableXml(rDoc, nTab, rXF, rSst, head, 'rIdVml');
    res.hyperlinkRels.forEach((t, i) => sheetRels.push({ id: `rIdLink${i + 1}`, type: `${NS_REL}/hyperlink`, target: t, external: true }));
    if (res.notes.length) {
      ++nDrawing;
      add(`xl/comments${nTab + 1}.xml`, SaveCommentsXml(res.notes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml');
      add(`xl/drawings/vmlDrawing${nTab + 1}.vml`, SaveCommentsVml(res.notes, nDrawing));
      sheetRels.push({ id: 'rIdComments', type: `${NS_REL}/comments`, target: `../comments${nTab + 1}.xml` });
      sheetRels.push({ id: 'rIdVml', type: `${NS_REL}/vmlDrawing`, target: `../drawings/vmlDrawing${nTab + 1}.vml` });
    }
    add(`xl/worksheets/sheet${nTab + 1}.xml`, res.xml, CT_SHEET);
    if (sheetRels.length) add(`xl/worksheets/_rels/sheet${nTab + 1}.xml.rels`, relsXml(sheetRels));
    wbRels.push({ id: `rId${nTab + 1}`, type: `${NS_REL}/worksheet`, target: `worksheets/sheet${nTab + 1}.xml` });
    const state = rDoc.IsVisible(nTab) ? '' : ' state="hidden"';
    sheetsXml += `<sheet name="${escapeXml(encodeXString(aName))}" sheetId="${nTab + 1}"${state} r:id="rId${nTab + 1}"/>`;
  }

  // workbook settings
  const rOpt = rDoc.GetDocOptions();
  const d = rOpt.GetDate();
  const b1904 = d.nYear === 1904 && d.nMonth === 1 && d.nDay === 1;
  const workbook = `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">`
    + '<fileVersion appName="Calc"/>'
    + `<workbookPr backupFile="false" showObjects="all"${b1904 ? ' date1904="true"' : ''}/>`
    + SaveBookViewsXml(viewSettings, nActive)
    + `<sheets>${sheetsXml}</sheets>`
    + SaveDefinedNamesXml(rDoc)
    + `<calcPr iterateCount="${rOpt.GetIterCount()}" refMode="A1" iterate="${rOpt.IsIter() ? 'true' : 'false'}" iterateDelta="${rOpt.GetIterEps()}"${rOpt.IsCalcAsShown() ? ' fullPrecision="false"' : ''}/>`
    + '</workbook>';
  add('xl/workbook.xml', workbook, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
  add('xl/styles.xml', rXF.SaveXml(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml');
  wbRels.push({ id: 'rIdStyles', type: `${NS_REL}/styles`, target: 'styles.xml' });
  if (!rSst.IsEmpty()) {
    add('xl/sharedStrings.xml', rSst.SaveXml(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml');
    wbRels.push({ id: 'rIdSst', type: `${NS_REL}/sharedStrings`, target: 'sharedStrings.xml' });
  }
  add('xl/_rels/workbook.xml.rels', relsXml(wbRels));

  // document properties
  const pkgRels: { id: string; type: string; target: string }[] = [{ id: 'rId1', type: `${NS_REL}/officeDocument`, target: 'xl/workbook.xml' }];
  let n = 1;
  for (const part of [writeCoreProperties(sh.m_xDocProps), writeAppProperties(sh.m_xDocProps, GetGeneratorString()), writeCustomProperties(sh.m_xDocProps)]) {
    if (!part) continue;
    add(part.name, part.data, part.contentType);
    pkgRels.push({ id: `rId${++n}`, type: part.relType, target: part.name });
  }
  add('_rels/.rels', relsXml(pkgRels));

  const contentTypes = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>'
    + overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')
    + '</Types>';
  return writeZip([{ name: '[Content_Types].xml', data: enc.encode(contentTypes) }, ...files]);
}
