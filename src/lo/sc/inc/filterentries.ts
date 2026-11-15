// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/filterentries.hxx partial
// @upstream sc/inc/typedstrdata.hxx partial
// @upstream sc/source/core/tool/typedstrdata.cxx partial
// ScFilterEntries: the distinct entries of a column the AutoFilter offers (texts, values with
// their shown string, dates as ISO dates, empty cells), each marked whether it is in a row
// another column's filter hides; ScTypedStrData is one entry. Left out: the text and background
// colours (filtering by colour is not ported).
export const ScTypedStrDataType = { Value: 0, MRU: 1, Standard: 2, Name: 3, DbName: 4, Header: 5 } as const;
export type ScTypedStrDataType = (typeof ScTypedStrDataType)[keyof typeof ScTypedStrDataType];

export class ScTypedStrData {
  private maStrValue: string;
  private mfValue: number;
  private mfRoundedValue: number; // rounded value by format code
  private meStrType: ScTypedStrDataType;
  private mbIsDate: boolean;
  private mbIsHiddenByFilter: boolean;

  constructor(rStr: string, fVal = 0.0, fRVal = 0.0, nType: ScTypedStrDataType = ScTypedStrDataType.Standard, bDate = false, bIsHiddenByFilter = false) {
    this.maStrValue = rStr;
    this.mfValue = fVal;
    this.mfRoundedValue = fRVal;
    this.meStrType = nType;
    this.mbIsDate = bDate;
    this.mbIsHiddenByFilter = bIsHiddenByFilter;
  }

  IsDate(): boolean { return this.mbIsDate; }
  IsHiddenByFilter(): boolean { return this.mbIsHiddenByFilter; }
  GetString(): string { return this.maStrValue; }
  GetStringType(): ScTypedStrDataType { return this.meStrType; }
  GetValue(): number { return this.mfValue; }
  GetRoundedValue(): number { return this.mfRoundedValue; }

  /** LessCaseInsensitive / LessCaseSensitive: values before strings, values by value, strings by
      their (case-insensitive) collation. */
  static Compare(left: ScTypedStrData, right: ScTypedStrData, bCaseSens: boolean): number {
    const hidden = Number(left.mbIsHiddenByFilter) - Number(right.mbIsHiddenByFilter);
    if (left.meStrType !== right.meStrType) return left.meStrType - right.meStrType;
    if (left.meStrType === ScTypedStrDataType.Value) {
      if (left.mfRoundedValue === right.mfRoundedValue) return hidden;
      return left.mfValue < right.mfValue ? -1 : 1;
    }
    if (left.mbIsDate !== right.mbIsDate) return left.mbIsDate ? 1 : -1;
    const nEqual = bCaseSens ? collatorCase.compare(left.maStrValue, right.maStrValue) : collator.compare(left.maStrValue, right.maStrValue);
    if (!nEqual) return hidden;
    return nEqual;
  }

  /** LessHiddenRows. */
  static CompareHidden(left: ScTypedStrData, right: ScTypedStrData): number { return Number(left.mbIsHiddenByFilter) - Number(right.mbIsHiddenByFilter); }

  /** EqualCaseInsensitive / EqualCaseSensitive. */
  static Equal(left: ScTypedStrData, right: ScTypedStrData, bCaseSens: boolean): boolean {
    if (left.meStrType !== right.meStrType) return false;
    if (left.meStrType === ScTypedStrDataType.Value && left.mfRoundedValue !== right.mfRoundedValue) return false;
    if (left.mbIsDate !== right.mbIsDate) return false;
    return bCaseSens ? left.maStrValue === right.maStrValue : left.maStrValue.toUpperCase() === right.maStrValue.toUpperCase();
  }
}

const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: false });
const collatorCase = new Intl.Collator('en-US', { sensitivity: 'case', caseFirst: 'lower' });

export class ScFilterEntries {
  maStrData: ScTypedStrData[] = [];
  mbHasDates = false;
  mbHasHiddenEmpties = false;
  mbHasUnHiddenEmpties = false;

  [Symbol.iterator](): Iterator<ScTypedStrData> { return this.maStrData[Symbol.iterator](); }
  size(): number { return this.maStrData.length; }
  empty(): boolean { return this.maStrData.length === 0; }
  push_back(r: ScTypedStrData): void { this.maStrData.push(r); }
}
