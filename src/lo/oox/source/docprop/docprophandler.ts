// SPDX-License-Identifier: MPL-2.0
// @upstream oox/source/docprop/docprophandler.cxx reduced
// OOXMLDocPropHandler for docProps/core.xml and docProps/app.xml's TotalTime and Application.
// The statistics, the other app.xml elements and the custom properties are not read.
import { childElements, type XmlElement } from '../../../xmloff/source/core/xmlparse.ts';
import type { DateTime, SfxDocumentMetaData } from '../../../sfx2/source/doc/SfxDocumentMetaData.ts';

/** GetDateTimeFromW3CDTF: a W3CDTF date, in UTC. */
export function GetDateTimeFromW3CDTF(aChars: string): DateTime {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?)?)?/.exec(aChars);
  if (!m) return { NanoSeconds: 0, Seconds: 0, Minutes: 0, Hours: 0, Day: 0, Month: 0, Year: 0 };
  const n = (i: number) => Number(m[i] ?? 0);
  const dt = { Year: n(1), Month: n(2), Day: n(3), Hours: n(4), Minutes: n(5), Seconds: n(6), NanoSeconds: m[7] ? Number(m[7].slice(0, 9).padEnd(9, '0')) : 0 };
  const tz = m[8];
  if (tz && tz !== 'Z') {
    // convert to UTC time
    const nModif = (Number(tz.slice(1, 3)) * 3600 + Number(tz.slice(4, 6)) * 60) * (tz[0] === '-' ? -1 : 1);
    if (nModif) {
      const d = new Date(Date.UTC(dt.Year, dt.Month - 1, dt.Day, dt.Hours, dt.Minutes, dt.Seconds) - nModif * 1000);
      return { ...dt, Year: d.getUTCFullYear(), Month: d.getUTCMonth() + 1, Day: d.getUTCDate(), Hours: d.getUTCHours(), Minutes: d.getUTCMinutes(), Seconds: d.getUTCSeconds() };
    }
  }
  return dt;
}

/** GetKeywordsSet */
export const GetKeywordsSet = (aChars: string): string[] => (aChars ? aChars.split(/[ ,;:\t]+/) : []);

const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

/** characters() of the core properties' elements. */
export function ReadCoreProperties(m_xDocProp: SfxDocumentMetaData, root: XmlElement): void {
  for (const e of childElements(root)) {
    const aChars = textOf(e), local = e.name.replace(/^.*:/, '');
    switch (local) {
      case 'created': if (aChars) m_xDocProp.setCreationDate(GetDateTimeFromW3CDTF(aChars)); break;
      case 'creator': m_xDocProp.setAuthor(aChars); break;
      case 'description': m_xDocProp.setDescription(aChars); break;
      case 'keywords': m_xDocProp.setKeywords(GetKeywordsSet(aChars)); break;
      case 'language': if (aChars) m_xDocProp.setLanguage(aChars); break;
      case 'lastModifiedBy': m_xDocProp.setModifiedBy(aChars); break;
      case 'lastPrinted': if (aChars) m_xDocProp.setPrintDate(GetDateTimeFromW3CDTF(aChars)); break;
      case 'modified': if (aChars) m_xDocProp.setModificationDate(GetDateTimeFromW3CDTF(aChars)); break;
      case 'revision': { const n = parseInt(aChars, 10); if (n >= 0 && n < 0x8000) m_xDocProp.setEditingCycles(n); break; }
      case 'subject': m_xDocProp.setSubject(m_xDocProp.getSubject() + aChars); break;
      case 'title': m_xDocProp.setTitle(m_xDocProp.getTitle() + aChars); break;
    }
  }
}

export function ReadAppProperties(m_xDocProp: SfxDocumentMetaData, root: XmlElement): void {
  for (const e of childElements(root)) {
    const aChars = textOf(e), local = e.name.replace(/^.*:/, '');
    if (local === 'Application') m_xDocProp.setGenerator(aChars);
    else if (local === 'TotalTime') {
      // The TotalTime is in mins as per ECMA specification.
      const n = parseInt(aChars, 10);
      if (n >= 0 && n * 60 <= 0x7fffffff) m_xDocProp.setEditingDuration(n * 60);
    }
  }
}
