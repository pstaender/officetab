// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/core/xmlfilterbase.cxx partial
// writeCoreProperties and writeAppProperties: docProps/core.xml and docProps/app.xml of an OOXML
// package. Not ported: the security option that removes personal information, the
// OOXMLCoreProperty* user-defined properties, the custom properties part, and app.xml's
// template, manager, company and hyperlink base.
import { escapeXml } from '../../../xmloff/source/core/xmlparse.ts';
import type { DateTime, SfxDocumentMetaData } from '../../../sfx2/source/doc/SfxDocumentMetaData.ts';

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
