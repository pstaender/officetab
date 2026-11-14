// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/fields/docufld.cxx partial
// @upstream sw/inc/docufld.hxx partial
// The document statistics field (SwDocStatField) and the document information field
// (SwDocInfoField). The field types read the document's statistics and properties when a field
// is expanded. Reduced: a date or time shows in the locale's short form (no number formats), a
// custom property shows the text it is stored as, and the field's expansion (m_aContent) is kept
// beside the field, which stays immutable. The page count of the document is the 'PageCount'
// field, as the Insert > Field menu made it before this port; the other statistics are
// 'DocStat' fields with their SwDocStatSubType.
import { parseDateTime, type SfxDocumentMetaData, type DateTime } from '../../../../sfx2/source/doc/SfxDocumentMetaData.ts';
import { makeNumberingString, type NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { SwField } from '../../../inc/hintids.ts';
import type { SwDocStat } from '../doc/DocumentStatisticsManager.ts';

/** SwDocStatSubType */
export const SwDocStatSubType = {
  Page: 0,
  // page count in current section
  PageRange: 1,
  Paragraph: 2,
  Word: 3,
  Character: 4,
  Table: 5,
  Graphic: 6,
  OLE: 7,
} as const;
export type SwDocStatSubType = (typeof SwDocStatSubType)[keyof typeof SwDocStatSubType];

/** SwDocInfoSubType: the property in the low byte, what of it in the high one. */
export const SwDocInfoSubType = {
  SubtypeBegin: 0,
  Title: 0,
  Subject: 1,
  Keys: 2,
  Comment: 3,
  Create: 4,
  Change: 5,
  Print: 6,
  DocNo: 7,
  Edit: 8,
  Custom: 9,
  SubtypeEnd: 10,
  LowerMask: 0x00ff,
  UpperMask: 0xff00,

  SubAuthor: 0x0100,
  SubTime: 0x0200,
  SubDate: 0x0300,
  SubFixed: 0x1000,
  SubMask: 0x0f00,
} as const;

const SHRT_MAX = 32767;

/** SwFieldType::FormatNumber: unset is SVX_NUM_PAGEDESC, the numbering of the page's style. */
const FormatNumber = (nNum: number, nFormat: number): string => makeNumberingString(nFormat as NumberingType, nNum);

/**
 * SwDocStatFieldType: the statistics come from `rDStat` (DocumentStatisticsManager::GetDocStat),
 * computed when a field first needs them; m_nNumberingType is the numbering of the page's style.
 */
export class SwDocStatFieldType {
  private m_rDStat: () => SwDocStat;
  m_nNumberingType: number;

  constructor(rDStat: () => SwDocStat, nNumberingType: number) {
    this.m_rDStat = rDStat;
    this.m_nNumberingType = nNumberingType;
  }

  /** SwDocStatFieldType::Expand; `nFormat` undefined is SVX_NUM_PAGEDESC. */
  Expand(nSubType: SwDocStatSubType, nFormat: number | undefined, nVirtPageCount: number): string {
    let nVal = 0;
    switch (nSubType) {
      case SwDocStatSubType.Table: nVal = this.m_rDStat().nTable; break;
      case SwDocStatSubType.Graphic: nVal = this.m_rDStat().nGrf; break;
      case SwDocStatSubType.OLE: nVal = this.m_rDStat().nOLE; break;
      case SwDocStatSubType.Paragraph: nVal = this.m_rDStat().nPara; break;
      case SwDocStatSubType.Word: nVal = this.m_rDStat().nWord; break;
      case SwDocStatSubType.Character: nVal = this.m_rDStat().nChar; break;
      case SwDocStatSubType.Page:
        nVal = this.m_rDStat().nPage;
        if (nFormat === undefined) nFormat = this.m_nNumberingType;
        break;
      case SwDocStatSubType.PageRange:
        nVal = nVirtPageCount;
        if (nFormat === undefined) nFormat = this.m_nNumberingType;
        break;
    }

    if (nVal <= SHRT_MAX) return FormatNumber(nVal, nFormat ?? this.m_nNumberingType);

    return String(nVal);
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** LocaleDataWrapper::getDate */
const getDate = (d: DateTime): string => new Date(d.Year, d.Month - 1, d.Day).toLocaleDateString();
/** LocaleDataWrapper::getTime without seconds */
const getTime = (d: DateTime): string => new Date(d.Year, d.Month - 1, d.Day, d.Hours, d.Minutes).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A custom property's text: a date in the locale's short form (ExpandValue), others as stored. */
const lcl_CustomValue = (p: { type: string; value: string }): string => {
  const d = p.type === 'date' ? parseDateTime(p.value) : null;
  return d ? getDate(d) : p.value;
};

/** SwDocInfoFieldType: the document properties (XDocumentProperties) the fields show. */
export class SwDocInfoFieldType {
  private m_xDocProps: SfxDocumentMetaData;

  constructor(xDocProps: SfxDocumentMetaData) { this.m_xDocProps = xDocProps; }

  /** SwDocInfoFieldType::Expand */
  Expand(nSub: number, rName: string): string {
    const xDocProps = this.m_xDocProps;

    const nExtSub = nSub & SwDocInfoSubType.UpperMask;
    nSub &= SwDocInfoSubType.LowerMask; // do not consider extended SubTypes

    let aStr = '';
    switch (nSub) {
      case SwDocInfoSubType.Title: aStr = xDocProps.getTitle(); break;
      case SwDocInfoSubType.Subject: aStr = xDocProps.getSubject(); break;
      case SwDocInfoSubType.Keys: aStr = xDocProps.getKeywords().join(', '); break;
      case SwDocInfoSubType.Comment: aStr = xDocProps.getDescription(); break;
      case SwDocInfoSubType.DocNo: aStr = String(xDocProps.getEditingCycles()); break;
      case SwDocInfoSubType.Edit: {
        const dur = xDocProps.getEditingDuration();
        // If Seconds > 0 then bSec should be TRUE otherwise Seconds
        // information will be lost if file has EditTime in Seconds format.
        aStr = `${Math.trunc(dur / 3600)}:${pad2(Math.trunc((dur % 3600) / 60))}${dur % 60 > 0 ? `:${pad2(dur % 60)}` : ''}`;
        break;
      }
      case SwDocInfoSubType.Custom: {
        const aAny = xDocProps.m_aUserDefined.find((p) => p.name === rName);
        return aAny ? lcl_CustomValue(aAny) : '';
      }

      default: {
        let aName = xDocProps.getAuthor();
        let aDate = xDocProps.getCreationDate();
        if (nSub === SwDocInfoSubType.Create) {
          // that's it !!
        } else if (nSub === SwDocInfoSubType.Change) {
          aName = xDocProps.getModifiedBy();
          aDate = xDocProps.getModificationDate();
        } else if (nSub === SwDocInfoSubType.Print) {
          aName = xDocProps.getPrintedBy();
          aDate = xDocProps.getPrintDate();
        } else break;

        // IsValidAndGregorian; the author of an invalid date is shown all the same here.
        switch (nExtSub & ~SwDocInfoSubType.SubFixed) {
          case SwDocInfoSubType.SubAuthor: aStr = aName; break;
          case SwDocInfoSubType.SubTime: if (aDate.Year !== 0) aStr = getTime(aDate); break;
          case SwDocInfoSubType.SubDate: if (aDate.Year !== 0) aStr = getDate(aDate); break;
          default: break;
        }
      }
    }
    return aStr;
  }
}

/** SwDocInfoField::m_aContent and the last expansion of a statistics field, by field. */
const m_aContent = new WeakMap<SwField, string>();
export function SetContent(f: SwField, s: string): void { m_aContent.set(f, s); }
/** The field's last expansion, if it was expanded. */
export function GetContent(f: SwField): string | undefined { return m_aContent.get(f); }

/** SwDocInfoField::IsFixed */
export const IsFixed = (f: SwField): boolean => f.fixed !== undefined;

/**
 * SwDocInfoField::ExpandImpl: a fixed field keeps its text; the others show the property now. A
 * custom property the document does not have (yet) leaves the field's text as it was: what it
 * last showed, else what it showed when imported (`content`).
 */
export function DocInfoExpandImpl(f: SwField, xDocProps: SfxDocumentMetaData): string {
  // if the field is "fixed" we don't update it from the property
  if (IsFixed(f)) { SetContent(f, f.fixed!); return f.fixed!; }
  if (((f.subType ?? 0) & SwDocInfoSubType.LowerMask) === SwDocInfoSubType.Custom) {
    // custom properties currently need special treatment
    const aAny = xDocProps.m_aUserDefined.find((p) => p.name === f.name);
    if (aAny) SetContent(f, lcl_CustomValue(aAny));
    return GetContent(f) ?? f.content ?? '';
  }
  const s = new SwDocInfoFieldType(xDocProps).Expand(f.subType ?? 0, f.name ?? '');
  SetContent(f, s);
  return s;
}

/**
 * SwDocInfoField's constructor (as SwFieldMgr::InsertField makes it): a fixed field takes the
 * property's text now (SwDocInfoSubType::SubFixed).
 */
export function MakeDocInfoField(xDocProps: SfxDocumentMetaData, nSub: number, rName = '', bFixed = false): SwField {
  const f: SwField = { type: 'DocInfo', subType: nSub & ~SwDocInfoSubType.SubFixed };
  if (rName) f.name = rName;
  if (bFixed) f.fixed = new SwDocInfoFieldType(xDocProps).Expand(nSub, rName);
  return f;
}
