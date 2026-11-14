// SPDX-License-Identifier: MPL-2.0
// @upstream xmloff/source/meta/xmlversion.cxx reduced
// The version list of a package (VersionList.xml): written and read as upstream, with the SAX
// export and fast-parser contexts replaced by a string and the DOM of `parseXml`. A storage is the
// package's streams by name (as `readZip` returns them). Left out: the chaff of encrypted storages.
import { childElements, escapeXml, parseXml } from '../core/xmlparse.ts';
import { convertDateTime, type DateTime } from '../../../sfx2/source/doc/SfxDocumentMetaData.ts';

/** css::util::RevisionTag. */
export interface RevisionTag { Identifier: string; Comment: string; Author: string; TimeStamp: DateTime }

/** The streams of a package, by their path. */
export type Storage = Map<string, Uint8Array>;

const XMLN_VERSIONSLIST = 'VersionList.xml';
/** XML_N_VERSIONS_LIST, with its prefix XML_NP_VERSIONS_LIST; XML_N_DC. */
const XML_N_VERSIONS_LIST = 'http://openoffice.org/2001/versions-list';
const XML_N_DC = 'http://purl.org/dc/elements/1.1/';
/** XML_NAMESPACE_FRAMEWORK: the namespace StarOffice wrote before it. */
const XML_N_FRAMEWORK = 'http://openoffice.org/2001/framework';

/** XMLVersionListExport::exportDoc. */
export function XMLVersionListExport(maVersions: readonly RevisionTag[]): string {
  // SvXMLAttributeList escapes line breaks and tabs in attribute values, as character references.
  const attr = (s: string) => escapeXml(s).replace(/\n/g, '&#x0a;').replace(/\t/g, '&#x09;').replace(/\r/g, '&#x0d;');
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += `<VL:version-list xmlns:dc="${XML_N_DC}" xmlns:VL="${XML_N_VERSIONS_LIST}">`;
  for (const rInfo of maVersions) {
    // SvXMLMetaExport::GetISODateTimeString: without the fraction of a second.
    const aDateStr = convertDateTime({ ...rInfo.TimeStamp, NanoSeconds: 0 });
    out += `<VL:version-entry VL:title="${attr(rInfo.Identifier)}" VL:comment="${attr(rInfo.Comment)}" VL:creator="${attr(rInfo.Author)}" dc:date-time="${aDateStr}"/>`;
  }
  out += '</VL:version-list>';
  return out;
}

/**
 * XMLVersionListImport with XMLVersionListContext and XMLVersionContext: the entries of the
 * version list, in either of its namespaces.
 */
export function XMLVersionListImport(xml: string): RevisionTag[] {
  const maVersions: RevisionTag[] = [];
  const root = parseXml(xml);
  const list = childElements(root)[0];
  if (!list) return maVersions;
  // The namespace of each prefix declared on the root element.
  const ns = new Map<string, string>();
  for (const [k, v] of list.attrs) if (k.startsWith('xmlns:')) ns.set(k.slice(6), v);
  // parseXml names Dublin Core attributes with their usual prefix, whatever the document's.
  ns.set('dc', XML_N_DC);
  const nsOf = (qname: string) => (qname.includes(':') ? ns.get(qname.slice(0, qname.indexOf(':'))) : undefined);
  const local = (qname: string) => qname.slice(qname.indexOf(':') + 1);
  const isList = (n: string | undefined) => n === XML_N_VERSIONS_LIST || n === XML_N_FRAMEWORK;
  if (!isList(nsOf(list.name)) || local(list.name) !== 'version-list') return maVersions;
  for (const entry of childElements(list)) {
    if (!isList(nsOf(entry.name)) || local(entry.name) !== 'version-entry') continue;
    if (entry.attrs.size === 0) continue;
    const aInfo: RevisionTag = { Identifier: '', Comment: '', Author: '', TimeStamp: { NanoSeconds: 0, Seconds: 0, Minutes: 0, Hours: 0, Day: 0, Month: 0, Year: 0 } };
    for (const [name, value] of entry.attrs) {
      const n = nsOf(name);
      if (isList(n)) {
        switch (local(name)) {
          case 'title': aInfo.Identifier = value; break;
          case 'comment': aInfo.Comment = value; break;
          case 'creator': aInfo.Author = value; break;
        }
      } else if (n === XML_N_DC && local(name) === 'date-time') {
        const aTime = ParseISODateTimeString(value);
        if (aTime) aInfo.TimeStamp = aTime;
      }
    }
    maVersions.push(aInfo);
  }
  return maVersions;
}

/** XMLVersionContext::ParseISODateTimeString: the date, and optionally the time; null if invalid. */
export function ParseISODateTimeString(rString: string): DateTime | null {
  let bSuccess = true;

  let aDateStr: string, aTimeStr = '';
  const nPos = rString.indexOf('T');
  if (nPos !== -1) {
    aDateStr = rString.slice(0, nPos);
    aTimeStr = rString.slice(nPos + 1);
  } else aDateStr = rString; // no separator: only date part

  let nYear = 0;
  let nMonth = 1;
  let nDay = 1;
  let nHour = 0;
  let nMin = 0;
  let nSec = 0;

  // o3tl::toInt32: the leading digits (with a sign), 0 without any.
  const toInt32 = (s: string) => { const m = /^\s*([+-]?\d+)/.exec(s); return m ? parseInt(m[1]!, 10) : 0; };

  const nDateTokens = aDateStr.split('-').length;
  if (nDateTokens > 3 || aDateStr.length === 0) bSuccess = false;
  else {
    const t = aDateStr.split('-');
    nYear = toInt32(t[0]!);
    if (nYear > 9999) bSuccess = false;
    else if (nDateTokens >= 2) {
      nMonth = toInt32(t[1]!);
      if (nMonth > 12) bSuccess = false;
      else if (nDateTokens >= 3) {
        nDay = toInt32(t[2]!);
        if (nDay > 31) bSuccess = false;
      }
    }
  }

  if (bSuccess && aTimeStr.length) { // time is optional
    const nTimeTokens = aTimeStr.split(':').length;
    if (nTimeTokens > 3) bSuccess = false;
    else {
      const t = aTimeStr.split(':');
      nHour = toInt32(t[0]!);
      if (nHour > 23) bSuccess = false;
      else if (nTimeTokens >= 2) {
        nMin = toInt32(t[1]!);
        if (nMin > 59) bSuccess = false;
        else if (nTimeTokens >= 3) {
          nSec = toInt32(t[2]!);
          if (nSec > 59) bSuccess = false;
        }
      }
    }
  }

  if (!bSuccess) return null;
  return { NanoSeconds: 0, Seconds: nSec, Minutes: nMin, Hours: nHour, Day: nDay, Month: nMonth, Year: nYear };
}

/** XMLVersionListPersistence (css::document::DocumentRevisionListPersistence). */
export const XMLVersionListPersistence = {
  /** Writes the version list into the storage, replacing the one there. */
  store(xRoot: Storage | null, rVersions: readonly RevisionTag[]): void {
    // no storage, no version list!
    if (!xRoot) return;
    xRoot.set(XMLN_VERSIONSLIST, new TextEncoder().encode(XMLVersionListExport(rVersions)));
  },

  /** The version list of the storage; empty when it has none or it cannot be read. */
  load(xRoot: Storage | null): RevisionTag[] {
    const sDocName = XMLN_VERSIONSLIST;
    const bytes = xRoot?.get(sDocName);
    if (!bytes) return [];
    try {
      return XMLVersionListImport(new TextDecoder().decode(bytes));
    } catch {
      return [];
    }
  },
};
