// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/core/xmlfilterbase.cxx partial
// writeCoreProperties, writeAppProperties and writeCustomProperties: docProps/core.xml,
// docProps/app.xml and docProps/custom.xml of an OOXML package. Not ported: the security option
// that removes personal information and marks a document final, the OOXMLCoreProperty*
// user-defined properties, and app.xml's template, manager, company and hyperlink base. Custom
// properties are written by their ODF value type (a number as i4 when whole, else r8).
import { escapeXml } from '../../../xmloff/source/core/xmlparse.ts';
import { parseDateTime, type DateTime, type SfxDocumentMetaData } from '../../../sfx2/source/doc/SfxDocumentMetaData.ts';

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const lcl_isValidDate = (rTime: DateTime): boolean => {
  if (rTime.Year === 0) return false;
  // MS Office reports document as corrupt if core.xml contains any Year <= 1600 or > 9999
  return rTime.Year > 1600 && rTime.Year < 10000;
};

const p2 = (n: number) => String(n).padStart(2, '0');
const writeString = (el: string, s: string) => `<${el}>${escapeXml(s)}</${el}>`;
function writeDate(el: string, t: DateTime): string {
  if (t.Year === 0) return '';
  const attr = el.startsWith('dcterms:') ? ' xsi:type="dcterms:W3CDTF"' : '';
  return `<${el}${attr}>${t.Year}-${p2(t.Month)}-${p2(t.Day)}T${p2(t.Hours)}:${p2(t.Minutes)}:${p2(t.Seconds)}Z</${el}>`;
}
// tdf#143175 - join elements including a delimiter
const writeList = (el: string, items: string[]) => (items.length ? writeString(el, items.join(' ')) : '');

export interface OoxPart { name: string; data: string; contentType: string; relType: string }

export function writeCoreProperties(xProperties: SfxDocumentMetaData): OoxPart {
  let s = '';
  const aCreateDate = xProperties.getCreationDate();
  if (lcl_isValidDate(aCreateDate)) s += writeDate('dcterms:created', aCreateDate);
  s += writeString('dc:creator', xProperties.getAuthor());
  s += writeString('dc:description', xProperties.getDescription());
  s += writeList('cp:keywords', xProperties.getKeywords());
  if (xProperties.getLanguage()) s += writeString('dc:language', xProperties.getLanguage());
  s += writeString('cp:lastModifiedBy', xProperties.getModifiedBy());
  const aPrintDate = xProperties.getPrintDate();
  if (lcl_isValidDate(aPrintDate)) s += writeDate('cp:lastPrinted', aPrintDate);
  const aModifyDate = xProperties.getModificationDate();
  if (lcl_isValidDate(aModifyDate)) s += writeDate('dcterms:modified', aModifyDate);
  s += `<cp:revision>${xProperties.getEditingCycles()}</cp:revision>`;
  s += writeString('dc:subject', xProperties.getSubject());
  s += writeString('dc:title', xProperties.getTitle());
  // Although the spec says that ISOIEC_29500_2008 must use the "officedocument" URI for core.xml,
  // MS errata admits that MS Office just uses the old "package" URI from ECMA_376_1ST_EDITION.
  return {
    name: 'docProps/core.xml', contentType: 'application/vnd.openxmlformats-package.core-properties+xml',
    relType: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
    data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${s}</cp:coreProperties>`,
  };
}

export function writeAppProperties(xProperties: SfxDocumentMetaData, sGenerator: string): OoxPart {
  // EditingDuration is in seconds, TotalTime is in minutes.
  const s = `<TotalTime>${Math.trunc(xProperties.getEditingDuration() / 60)}</TotalTime>${writeString('Application', sGenerator)}`;
  return {
    name: 'docProps/app.xml', contentType: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
    data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${s}</Properties>`,
  };
}

/** Properties written in the core and extended properties instead of the custom ones. */
const STORED_ELSEWHERE = ['OOXMLCorePropertyCategory', 'OOXMLCorePropertyContentStatus', 'OOXMLCorePropertyContentType', 'OOXMLCorePropertyIdentifier', 'OOXMLCorePropertyVersion', 'HyperlinkBase', 'AppVersion', 'DocSecurity', 'Manager', 'Company'];

/** writeCustomProperties: none without custom properties (tdf#89791). */
export function writeCustomProperties(xProperties: SfxDocumentMetaData): OoxPart | null {
  const aprop = xProperties.m_aUserDefined;
  if (!aprop.length) return null;
  let s = '';
  const aUniqueProps = new Set<string>();
  aprop.forEach((rProp, nIndex) => {
    // Property names must be unique, and are case insensitive unlike in some formats (eg. ODF, DOC)
    if (!rProp.name || aUniqueProps.has(rProp.name.toUpperCase())) return;
    aUniqueProps.add(rProp.name.toUpperCase());
    // Skip storing these values in Custom Properties as it will be stored in Core/Extended Properties
    if (STORED_ELSEWHERE.includes(rProp.name)) return;
    let v: string;
    if (rProp.type === 'boolean') v = writeString('vt:bool', rProp.value === 'true' ? '1' : '0');
    else if (rProp.type === 'float') { const num = Number(rProp.value); v = Number.isInteger(num) ? writeString('vt:i4', String(num)) : writeString('vt:r8', String(num)); }
    else if (rProp.type === 'date' && parseDateTime(rProp.value)) {
      const t = parseDateTime(rProp.value)!;
      v = `<vt:filetime>${t.Year}-${p2(t.Month)}-${p2(t.Day)}T${p2(t.Hours)}:${p2(t.Minutes)}:${p2(t.Seconds)}Z</vt:filetime>`;
    } else v = writeString('vt:lpwstr', rProp.value);
    // pid starts from 2 not from 1 as MS supports pid from 2
    s += `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${nIndex + 2}" name="${escapeXml(rProp.name)}">${v}</property>`;
  });
  return {
    name: 'docProps/custom.xml', contentType: 'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    relType: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
    data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${s}</Properties>`,
  };
}
