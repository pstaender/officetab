// SPDX-License-Identifier: MPL-2.0
// @upstream sfx2/source/doc/SfxDocumentMetaData.cxx reduced
// @upstream sax/source/tools/converter.cxx partial
// The document properties (XDocumentProperties) and their meta.xml form. As upstream, the
// standard elements are kept as text by their qualified name (m_meta) and the list elements as
// lists (m_metaList). Left out: the template, auto-reload and hyperlink-behaviour elements, the
// document statistics, and the types of user-defined properties beyond their text (they are kept
// as read, so a document does not lose them).
import { child, childElements, escapeXml, type XmlElement } from '../../../xmloff/source/core/xmlparse.ts';

/** css::util::DateTime; Year 0 is the invalid date. */
export interface DateTime { NanoSeconds: number; Seconds: number; Minutes: number; Hours: number; Day: number; Month: number; Year: number }

export const InvalidDateTime = (): DateTime => ({ NanoSeconds: 0, Seconds: 0, Minutes: 0, Hours: 0, Day: 0, Month: 0, Year: 0 });

/** DateTime(DateTime::SYSTEM).GetUNODateTime(): the local time now. */
export function DateTimeNow(d: Date = new Date()): DateTime {
  return { NanoSeconds: d.getMilliseconds() * 1_000_000, Seconds: d.getSeconds(), Minutes: d.getMinutes(), Hours: d.getHours(), Day: d.getDate(), Month: d.getMonth() + 1, Year: d.getFullYear() };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Converter::convertDateTime, without a time zone. */
export function convertDateTime(dt: DateTime): string {
  let s = `${dt.Year < 0 ? '-' : ''}${pad(Math.abs(dt.Year), 4)}-${pad(dt.Month)}-${pad(dt.Day)}T${pad(dt.Hours)}:${pad(dt.Minutes)}:${pad(dt.Seconds)}`;
  if (dt.NanoSeconds > 0) s += `.${pad(dt.NanoSeconds, 9)}`;
  return s;
}

/** Converter::parseDateTime: a date or date and time; a time zone is dropped. */
export function parseDateTime(s: string): DateTime | null {
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const frac = m[7] ? Number(m[7].slice(0, 9).padEnd(9, '0')) : 0;
  return { Year: Number(m[1]), Month: Number(m[2]), Day: Number(m[3]), Hours: Number(m[4] ?? 0), Minutes: Number(m[5] ?? 0), Seconds: Number(m[6] ?? 0), NanoSeconds: frac };
}

/** dateTimeToText: the invalid date is the empty text. */
export const dateTimeToText = (dt: DateTime): string => (dt.Year === 0 ? '' : convertDateTime(dt));
export const textToDateTime = (s: string): DateTime => parseDateTime(s) ?? InvalidDateTime();

/** Converter::convertDuration (util::Duration) for durationToText(sal_Int32). */
export function durationToText(i_value: number): string {
  const Days = Math.trunc(i_value / (24 * 3600)), Hours = Math.trunc((i_value % (24 * 3600)) / 3600);
  const Minutes = Math.trunc((i_value % 3600) / 60), Seconds = i_value % 60;
  let s = 'P';
  if (Days) s += `${Days}D`;
  if (Hours || Minutes || Seconds) {
    s += 'T'; // time separator
    if (Hours) s += `${Hours}H`;
    if (Minutes) s += `${Minutes}M`;
    if (Seconds) s += `${Seconds}S`;
  } else if (!Days) s += '0D'; // zero duration: XMLSchema-2 says there must be at least one component
  return s;
}

/** textToDuration: seconds, approximating years and months (#i107372#). */
export function textToDuration(s: string): number {
  const m = /^-?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:[.,]\d+)?S)?)?$/.exec(s.trim());
  if (!m) return 0; // default
  const n = (i: number) => Number(m[i] ?? 0);
  const days = n(1) * 365 + n(2) * 30 + n(3);
  return days * (24 * 3600) + n(4) * 3600 + n(5) * 60 + n(6);
}

/** s_stdMeta: the single-valued standard elements, in the order they are written. */
export const s_stdMeta = [
  'meta:generator', 'dc:title', 'dc:description', 'dc:subject', 'meta:initial-creator', 'dc:creator', 'meta:printed-by',
  'meta:creation-date', 'dc:date', 'meta:print-date', 'dc:language', 'meta:editing-cycles', 'meta:editing-duration',
  'dc:coverage', 'dc:identifier', 'dc:rights', 'dc:source', 'dc:type',
] as const;
/** s_stdMetaList: the elements that may occur more than once (meta:user-defined apart). */
export const s_stdMetaList = ['meta:keyword', 'dc:contributor', 'dc:publisher', 'dc:relation'] as const;

type StdMeta = (typeof s_stdMeta)[number];
type StdMetaList = (typeof s_stdMetaList)[number];

/** A meta:user-defined property as read: its name, value type and text. */
export interface UserDefinedProperty { name: string; type: string; value: string }

const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

export class SfxDocumentMetaData {
  m_meta = new Map<StdMeta, string>();
  m_metaList = new Map<StdMetaList, string[]>();
  m_aUserDefined: UserDefinedProperty[] = [];

  getMetaText(name: StdMeta): string { return this.m_meta.get(name) ?? ''; }
  /** setMetaText: whether the value changed. */
  setMetaText(name: StdMeta, value: string): boolean {
    if (this.getMetaText(name) === value) return false;
    if (value) this.m_meta.set(name, value); else this.m_meta.delete(name);
    return true;
  }
  getMetaList(name: StdMetaList): string[] { return [...(this.m_metaList.get(name) ?? [])]; }
  setMetaList(name: StdMetaList, value: readonly string[]): boolean {
    const v = value.filter((s) => s !== '');
    if (this.getMetaList(name).join('\n') === v.join('\n')) return false;
    if (v.length) this.m_metaList.set(name, v); else this.m_metaList.delete(name);
    return true;
  }

  getGenerator(): string { return this.getMetaText('meta:generator'); }
  setGenerator(v: string): void { this.setMetaText('meta:generator', v); }
  getTitle(): string { return this.getMetaText('dc:title'); }
  setTitle(v: string): void { this.setMetaText('dc:title', v); }
  getSubject(): string { return this.getMetaText('dc:subject'); }
  setSubject(v: string): void { this.setMetaText('dc:subject', v); }
  getDescription(): string { return this.getMetaText('dc:description'); }
  setDescription(v: string): void { this.setMetaText('dc:description', v); }
  getAuthor(): string { return this.getMetaText('meta:initial-creator'); }
  setAuthor(v: string): void { this.setMetaText('meta:initial-creator', v); }
  getModifiedBy(): string { return this.getMetaText('dc:creator'); }
  setModifiedBy(v: string): void { this.setMetaText('dc:creator', v); }
  getPrintedBy(): string { return this.getMetaText('meta:printed-by'); }
  setPrintedBy(v: string): void { this.setMetaText('meta:printed-by', v); }
  getCreationDate(): DateTime { return textToDateTime(this.getMetaText('meta:creation-date')); }
  setCreationDate(v: DateTime): void { this.setMetaText('meta:creation-date', dateTimeToText(v)); }
  getModificationDate(): DateTime { return textToDateTime(this.getMetaText('dc:date')); }
  setModificationDate(v: DateTime): void { this.setMetaText('dc:date', dateTimeToText(v)); }
  getPrintDate(): DateTime { return textToDateTime(this.getMetaText('meta:print-date')); }
  setPrintDate(v: DateTime): void { this.setMetaText('meta:print-date', dateTimeToText(v)); }
  getLanguage(): string { return this.getMetaText('dc:language'); }
  setLanguage(v: string): void { this.setMetaText('dc:language', v); }
  getEditingCycles(): number { return Number(this.getMetaText('meta:editing-cycles')) || 0; }
  setEditingCycles(v: number): void {
    if (v < 0) throw new RangeError('SfxDocumentMetaData::setEditingCycles: argument is negative');
    this.setMetaText('meta:editing-cycles', String(v));
  }
  getEditingDuration(): number { return textToDuration(this.getMetaText('meta:editing-duration')); }
  setEditingDuration(v: number): void {
    if (v < 0) throw new RangeError('SfxDocumentMetaData::setEditingDuration: argument is negative');
    this.setMetaText('meta:editing-duration', durationToText(v));
  }
  getCoverage(): string { return this.getMetaText('dc:coverage'); }
  setCoverage(v: string): void { this.setMetaText('dc:coverage', v); }
  getIdentifier(): string { return this.getMetaText('dc:identifier'); }
  setIdentifier(v: string): void { this.setMetaText('dc:identifier', v); }
  getRights(): string { return this.getMetaText('dc:rights'); }
  setRights(v: string): void { this.setMetaText('dc:rights', v); }
  getSource(): string { return this.getMetaText('dc:source'); }
  setSource(v: string): void { this.setMetaText('dc:source', v); }
  getType(): string { return this.getMetaText('dc:type'); }
  setType(v: string): void { this.setMetaText('dc:type', v); }
  getKeywords(): string[] { return this.getMetaList('meta:keyword'); }
  setKeywords(v: readonly string[]): void { this.setMetaList('meta:keyword', v); }
  getContributor(): string[] { return this.getMetaList('dc:contributor'); }
  setContributor(v: readonly string[]): void { this.setMetaList('dc:contributor', v); }
  getPublisher(): string[] { return this.getMetaList('dc:publisher'); }
  setPublisher(v: readonly string[]): void { this.setMetaList('dc:publisher', v); }
  getRelation(): string[] { return this.getMetaList('dc:relation'); }
  setRelation(v: readonly string[]): void { this.setMetaList('dc:relation', v); }

  /** createClone */
  Clone(): SfxDocumentMetaData {
    const p = new SfxDocumentMetaData();
    p.m_meta = new Map(this.m_meta);
    p.m_metaList = new Map([...this.m_metaList].map(([k, v]) => [k, [...v]]));
    p.m_aUserDefined = this.m_aUserDefined.map((u) => ({ ...u }));
    return p;
  }

  /** resetUserData: a new author and creation date, no modification, printing or editing time. */
  resetUserData(the_value: string, now: DateTime = DateTimeNow()): void {
    this.setMetaText('meta:initial-creator', the_value);
    this.setMetaText('meta:creation-date', dateTimeToText(now));
    this.setMetaText('dc:creator', '');
    this.setMetaText('meta:printed-by', '');
    this.setMetaText('dc:date', dateTimeToText(InvalidDateTime()));
    this.setMetaText('meta:print-date', dateTimeToText(InvalidDateTime()));
    this.setMetaText('meta:editing-duration', durationToText(0));
    this.setMetaText('meta:editing-cycles', '1');
  }

  /** init: reads the children of office:meta. */
  static Read(meta: XmlElement | undefined): SfxDocumentMetaData {
    const p = new SfxDocumentMetaData();
    for (const e of meta ? childElements(meta) : []) {
      const name = e.name;
      if ((s_stdMeta as readonly string[]).includes(name)) p.m_meta.set(name as StdMeta, textOf(e));
      else if ((s_stdMetaList as readonly string[]).includes(name)) p.m_metaList.set(name as StdMetaList, [...(p.m_metaList.get(name as StdMetaList) ?? []), textOf(e)]);
      else if (name === 'meta:user-defined') p.m_aUserDefined.push({ name: e.attrs.get('meta:name') ?? '', type: e.attrs.get('meta:value-type') ?? 'string', value: textOf(e) });
    }
    return p;
  }

  /** The office:meta element of meta.xml. */
  Write(): string {
    let s = '';
    for (const name of s_stdMeta) {
      const v = this.m_meta.get(name);
      if (v) s += `<${name}>${escapeXml(v)}</${name}>`;
    }
    for (const name of s_stdMetaList) for (const v of this.m_metaList.get(name) ?? []) s += `<${name}>${escapeXml(v)}</${name}>`;
    for (const u of this.m_aUserDefined) s += `<meta:user-defined meta:name="${escapeXml(u.name)}"${u.type !== 'string' ? ` meta:value-type="${escapeXml(u.type)}"` : ''}>${escapeXml(u.value)}</meta:user-defined>`;
    return `<office:meta>${s}</office:meta>`;
  }
}

/** The office:meta element of a meta.xml document. */
export const MetaOf = (root: XmlElement): XmlElement | undefined => child(child(root, 'office:document-meta'), 'office:meta');
