// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/authfld.hxx partial
// @upstream sw/source/core/fields/authfld.cxx reduced
// @upstream sw/source/uibase/utlui/initui.cxx partial
// Bibliography entries (citations): SwAuthEntry, SwAuthorityFieldType and SwAuthorityField.
// Reduced: upstream's field type owns the entries (m_DataArr), shared by reference-counted fields
// and changed in place. Here each field (an SwField of type 'TableOfAuthorities') carries its own,
// immutable SwAuthEntry, and the type's entries are gathered from the document's fields in
// document order, so undo, which snapshots paragraphs, also covers the entries. Changing an
// entry (ChangeEntryContent) replaces the entries of the fields with its identifier. The sequence
// numbers (numbered entries) count the fields of the whole node array, without the layout's
// distinction of headers, footers and hidden redlines; equivalent entries share their number.
import { ToxAuthorityField, ToxAuthorityType } from './toxe.ts';
import type { SwField } from './hintids.ts';
import type { SwNodes } from './ndarr.ts';

export class SwAuthEntry {
  m_aAuthFields: string[];
  constructor(rCopy?: SwAuthEntry | readonly string[]) {
    const a = rCopy instanceof SwAuthEntry ? rCopy.m_aAuthFields : rCopy;
    this.m_aAuthFields = Array.from({ length: ToxAuthorityField.AUTH_FIELD_END }, (_, i) => a?.[i] ?? '');
  }
  equals(rComp: SwAuthEntry): boolean {
    for (let i = 0; i < ToxAuthorityField.AUTH_FIELD_END; ++i) if (this.m_aAuthFields[i] !== rComp.m_aAuthFields[i]) return false;
    return true;
  }
  GetAuthorField(ePos: ToxAuthorityField): string { return this.m_aAuthFields[ePos] ?? ''; }
  /** Entries are shared by undo snapshots: only a new entry may be changed. */
  SetAuthorField(ePos: ToxAuthorityField, rField: string): void {
    if (ToxAuthorityField.AUTH_FIELD_END > ePos) this.m_aAuthFields[ePos] = rField;
  }
}

/** TOX_STYLE_DELIMITER (tox.hxx): separates the fields of an entry in SwAuthorityField::SetPar1. */
export const TOX_STYLE_DELIMITER = '\u0001';

export interface SwTOXSortKey { eField: ToxAuthorityField; bSortAscending: boolean }

/** SwAuthorityField::TargetType: what a click on the citation opens. */
export const TargetType = {
  UseDisplayURL: 0,
  UseTargetURL: 1,
  None: 2,
  BibliographyTableRow: 3,
} as const;
export type TargetType = (typeof TargetType)[keyof typeof TargetType];

/** The bibliography fields in the document, in node order (SwFieldType::GatherFields). */
export function GatherAuthorityFields(rNodes: SwNodes): SwField[] {
  const out: SwField[] = [];
  for (let i = 0; i < rNodes.Count(); i++) {
    const n = rNodes.node(i);
    if (!n.IsTextNode()) continue;
    for (const h of n.m_aHints) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (f?.type === 'TableOfAuthorities' && f.m_xAuthEntry) out.push(f);
    }
  }
  return out;
}

/** GetSourceURL (txmsrt.cxx): the URL without its page fragment, which still names the same source. */
function GetSourceURL(rText: string): string {
  const i = rText.indexOf('#page=');
  return i < 0 ? rText : rText.slice(0, i);
}

/**
 * SwTOXAuthority::equivalent: the same entry, but the URL is considered equivalent, as long as it
 * only differs in a page number, as that's still the same source.
 */
export function AuthEntryEquivalent(pThis: SwAuthEntry, pOther: SwAuthEntry): boolean {
  if (pThis === pOther) return true;
  for (let i = 0; i < ToxAuthorityField.AUTH_FIELD_END; ++i) {
    const eField = i as ToxAuthorityField;
    if (eField === ToxAuthorityField.AUTH_FIELD_URL) {
      if (GetSourceURL(pThis.GetAuthorField(ToxAuthorityField.AUTH_FIELD_URL)) !== GetSourceURL(pOther.GetAuthorField(ToxAuthorityField.AUTH_FIELD_URL))) return false;
      continue;
    }
    if (pThis.GetAuthorField(eField) !== pOther.GetAuthorField(eField)) return false;
  }
  return true;
}

export class SwAuthorityFieldType {
  m_pNodes: SwNodes;
  /** The entries in sequence order (DelSequenceArray empties it, GetSequencePos fills it). */
  m_SequArr: SwAuthEntry[] = [];
  m_SortKeyArr: SwTOXSortKey[] = [];
  m_cPrefix = '[';
  m_cSuffix = ']';
  m_bIsSequence = false;
  m_bSortByDocument = true;
  m_eLanguage = '';
  m_sSortAlgorithm = '';

  constructor(rNodes: SwNodes) { this.m_pNodes = rNodes; }

  DelSequenceArray(): void { this.m_SequArr = []; }

  /**
   * m_DataArr: the distinct entries of the document's fields (SwAuthorityFieldType::AddField
   * merges equal ones), in document order.
   */
  GetEntries(): SwAuthEntry[] {
    const out: SwAuthEntry[] = [];
    for (const f of GatherAuthorityFields(this.m_pNodes)) if (!out.some((e) => e.equals(f.m_xAuthEntry!))) out.push(f.m_xAuthEntry!);
    return out;
  }

  GetAllEntryIdentifiers(rToFill: string[]): void {
    for (const rpTemp of this.GetEntries()) rToFill.push(rpTemp.GetAuthorField(ToxAuthorityField.AUTH_FIELD_IDENTIFIER));
  }

  GetEntryByIdentifier(rIdentifier: string): SwAuthEntry | null {
    for (const rpTemp of this.GetEntries()) if (rIdentifier === rpTemp.GetAuthorField(ToxAuthorityField.AUTH_FIELD_IDENTIFIER)) return rpTemp;
    return null;
  }

  /**
   * The position of the entry among the cited sources, from 1, in the order of the document or of
   * the sort keys; 0 when it is not cited. Only the first occurrence of equivalent entries counts.
   */
  GetSequencePos(pAuthEntry: SwAuthEntry): number {
    //find the field in a sorted array of handles,
    if (!this.m_SequArr.length) {
      const aSortArr: SwAuthEntry[] = [];
      for (const pFormatField of GatherAuthorityFields(this.m_pNodes)) {
        const pNew = pFormatField.m_xAuthEntry!;
        //only the first occurrence in the document has to be in the array
        if (aSortArr.some((pOld) => AuthEntryEquivalent(pOld, pNew))) continue;
        aSortArr.push(pNew);
      }
      if (!this.m_bSortByDocument) {
        const coll = new Intl.Collator(this.m_eLanguage || undefined);
        aSortArr.sort((a, b) => {
          for (const pKey of this.m_SortKeyArr) {
            const nComp = coll.compare(a.GetAuthorField(pKey.eField), b.GetAuthorField(pKey.eField));
            if (nComp) return pKey.bSortAscending ? nComp : -nComp;
          }
          return 0;
        });
      }
      this.m_SequArr = aSortArr;
    }
    //find nHandle
    for (let i = 0; i < this.m_SequArr.length; ++i) if (AuthEntryEquivalent(this.m_SequArr[i]!, pAuthEntry)) return i + 1;
    return 0;
  }

  IsSequence(): boolean { return this.m_bIsSequence; }
  SetSequence(bSet: boolean): void { this.DelSequenceArray(); this.m_bIsSequence = bSet; }
  SetPreSuffix(cPre: string, cSuf: string): void { this.m_cPrefix = cPre; this.m_cSuffix = cSuf; }
  GetPrefix(): string { return this.m_cPrefix; }
  GetSuffix(): string { return this.m_cSuffix; }
  IsSortByDocument(): boolean { return this.m_bSortByDocument; }
  SetSortByDocument(bSet: boolean): void { this.DelSequenceArray(); this.m_bSortByDocument = bSet; }
  GetSortKeyCount(): number { return this.m_SortKeyArr.length; }
  GetSortKey(nIdx: number): SwTOXSortKey | null { return this.m_SortKeyArr[nIdx] ?? null; }
  SetSortKeys(nKeys: SwTOXSortKey[]): void { this.DelSequenceArray(); this.m_SortKeyArr = nKeys.map((k) => ({ ...k })); }

  //initui.cxx
  static GetAuthFieldName(eType: ToxAuthorityField): string { return STR_AUTH_FIELD_ARY[eType] ?? ''; }
  static GetAuthTypeName(eType: ToxAuthorityType): string { return STR_AUTH_TYPE_ARY[eType] ?? ''; }
}

/** SwAuthorityField::SetPar1 and the SwAuthorityField(pType, rFieldContents) constructor: an entry from TOX_STYLE_DELIMITER separated fields. */
export function AuthEntryFromContents(rFieldContents: string): SwAuthEntry {
  return new SwAuthEntry(rFieldContents.split(TOX_STYLE_DELIMITER));
}

/** SwAuthorityField::ExpandImpl and ConditionalExpandAuthIdentifier. */
export function ConditionalExpandAuthIdentifier(f: SwField, pAuthType: SwAuthorityFieldType): string {
  let sRet = '';
  if (pAuthType.GetPrefix()) sRet = pAuthType.GetPrefix();
  if (pAuthType.IsSequence()) {
    if (f.m_xAuthEntry) sRet += String(pAuthType.GetSequencePos(f.m_xAuthEntry));
  } else {
    //TODO: Expand to: identifier, number sequence, ...
    if (f.m_xAuthEntry) {
      const sIdentifier = f.m_xAuthEntry.GetAuthorField(ToxAuthorityField.AUTH_FIELD_IDENTIFIER);
      // tdf#107784 Use title if it's a ooxml citation
      if (sIdentifier.trim().startsWith('CITATION')) return f.m_xAuthEntry.GetAuthorField(ToxAuthorityField.AUTH_FIELD_TITLE);
      else sRet += sIdentifier;
    }
  }
  if (pAuthType.GetSuffix()) sRet += pAuthType.GetSuffix();
  return sRet;
}

/** SwAuthorityField::GetTargetType: which target is used when the citation is clicked. */
export function GetTargetType(f: SwField): TargetType {
  return (parseInt(f.m_xAuthEntry?.GetAuthorField(ToxAuthorityField.AUTH_FIELD_TARGET_TYPE) ?? '', 10) || 0) as TargetType;
}

/** STR_AUTH_FIELD_ARY (initui.cxx), in ToxAuthorityField order. */
const STR_AUTH_FIELD_ARY = [
  'Short name', 'Type', 'Address', 'Annotation', 'Author(s)', 'Book title', 'Chapter', 'Edition', 'Editor',
  'Publication type', 'Institution', 'Journal', 'Month', 'Note', 'Number', 'Organization', 'Page(s)', 'Publisher',
  'University', 'Series', 'Title', 'Type of report', 'Volume', 'Year', 'URL', 'User-defined1', 'User-defined2',
  'User-defined3', 'User-defined4', 'User-defined5', 'ISBN', 'Local copy', 'Mark link target', 'Target URL',
];

/** STR_AUTH_TYPE_ARY (initui.cxx), in ToxAuthorityType order. */
const STR_AUTH_TYPE_ARY = [
  'Article', 'Book', 'Brochures', 'Conference proceedings', 'Book excerpt', 'Book excerpt with title',
  'Conference proceedings', 'Journal', 'Techn. documentation', 'Thesis', 'Miscellaneous', 'Dissertation',
  'Conference proceedings', 'Research report', 'Unpublished', 'Email', 'WWW document', 'User-defined1',
  'User-defined2', 'User-defined3', 'User-defined4', 'User-defined5',
];
