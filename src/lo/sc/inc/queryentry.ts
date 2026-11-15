// SPDX-License-Identifier: MPL-2.0
// @upstream sc/inc/queryentry.hxx faithful
// @upstream sc/source/core/tool/queryentry.cxx faithful
// ScQueryEntry: a single filtering criterion of a query (the field, the operator and the items to
// compare with). Shared strings are plain strings; colours are CSS colour strings.
import { SearchParam, TextSearch, type SearchType } from '../../unotools/source/i18n/textsearch.ts';
import type { SCCOLROW } from './address.ts';
import { ScQueryConnect, ScQueryOp } from './global.ts';

/*
 * dialog returns the special field values "empty"/"not empty"
 * as constants SC_EMPTYFIELDS and SC_NONEMPTYFIELDS respectively in nVal in
 * conjunctions with the flag bQueryByString = FALSE.
 */

const SC_EMPTYFIELDS = 0x0042;
const SC_NONEMPTYFIELDS = 0x0043;
const SC_TEXTCOLOR = 0x0044;
const SC_BACKGROUNDCOLOR = 0x0045;

export const QueryType = { ByValue: 0, ByString: 1, ByDate: 2, ByEmpty: 3, ByTextColor: 4, ByBackgroundColor: 5 } as const;
export type QueryType = (typeof QueryType)[keyof typeof QueryType];

export class ScQueryEntryItem {
  meType: QueryType = QueryType.ByValue;
  mfVal = 0.0;
  maString = '';
  maColor = '';
  mbMatchEmpty = false;
  mbRoundForFilter = false;

  clone(): ScQueryEntryItem {
    const r = new ScQueryEntryItem();
    r.meType = this.meType;
    r.mfVal = this.mfVal;
    r.maString = this.maString;
    r.maColor = this.maColor;
    r.mbMatchEmpty = this.mbMatchEmpty;
    r.mbRoundForFilter = this.mbRoundForFilter;
    return r;
  }

  equals(r: ScQueryEntryItem): boolean {
    return this.meType === r.meType && this.mfVal === r.mfVal && this.maString === r.maString && this.mbMatchEmpty === r.mbMatchEmpty
      && this.mbRoundForFilter === r.mbRoundForFilter;
  }
}

/**
 * Each instance of this struct represents a single filtering criteria.
 */
export class ScQueryEntry {
  static readonly ByValue = QueryType.ByValue;
  static readonly ByString = QueryType.ByString;
  static readonly ByDate = QueryType.ByDate;
  static readonly ByEmpty = QueryType.ByEmpty;
  static readonly ByTextColor = QueryType.ByTextColor;
  static readonly ByBackgroundColor = QueryType.ByBackgroundColor;

  bDoQuery = false;
  nField: SCCOLROW = 0;
  eOp: ScQueryOp = ScQueryOp.SC_EQUAL;
  eConnect: number = ScQueryConnect.SC_AND;
  pSearchParam: SearchParam | null = null; ///< if Wildcard or RegExp, not saved
  pSearchText: TextSearch | null = null; ///< if Wildcard or RegExp, not saved

  /**
   * Stores all query items.  It must contain at least one item at all times
   * (for single equality match queries or comparative queries).  It may
   * contain multiple items for multi-equality match queries.
   */
  private maQueryItems: ScQueryEntryItem[] = [new ScQueryEntryItem()];

  clone(): ScQueryEntry {
    const r = new ScQueryEntry();
    r.assign(this);
    return r;
  }

  assign(r: ScQueryEntry): this {
    this.bDoQuery = r.bDoQuery;
    this.eOp = r.eOp;
    this.eConnect = r.eConnect;
    this.nField = r.nField;
    this.maQueryItems = r.maQueryItems.map((x) => x.clone());

    this.pSearchParam = null;
    this.pSearchText = null;

    return this;
  }

  GetQueryItems(): ScQueryEntryItem[] { return this.maQueryItems; }

  SetQueryByEmpty(): void {
    this.eOp = ScQueryOp.SC_EQUAL;
    this.maQueryItems.length = 1;
    const rItem = this.maQueryItems[0]!;
    rItem.meType = QueryType.ByEmpty;
    rItem.maString = '';
    rItem.mfVal = SC_EMPTYFIELDS;
  }

  IsQueryByEmpty(): boolean {
    if (this.maQueryItems.length !== 1) return false;

    const rItem = this.maQueryItems[0]!;
    return this.eOp === ScQueryOp.SC_EQUAL && rItem.meType === QueryType.ByEmpty && !rItem.maString && rItem.mfVal === SC_EMPTYFIELDS;
  }

  SetQueryByNonEmpty(): void {
    this.eOp = ScQueryOp.SC_EQUAL;
    this.maQueryItems.length = 1;
    const rItem = this.maQueryItems[0]!;
    rItem.meType = QueryType.ByEmpty;
    rItem.maString = '';
    rItem.mfVal = SC_NONEMPTYFIELDS;
  }

  IsQueryByNonEmpty(): boolean {
    if (this.maQueryItems.length !== 1) return false;

    const rItem = this.maQueryItems[0]!;
    return this.eOp === ScQueryOp.SC_EQUAL && rItem.meType === QueryType.ByEmpty && !rItem.maString && rItem.mfVal === SC_NONEMPTYFIELDS;
  }

  SetQueryByTextColor(color: string): void {
    this.eOp = ScQueryOp.SC_EQUAL;
    this.maQueryItems.length = 1;
    const rItem = this.maQueryItems[0]!;
    rItem.meType = QueryType.ByTextColor;
    rItem.maString = '';
    rItem.mfVal = SC_TEXTCOLOR;
    rItem.maColor = color;
  }

  IsQueryByTextColor(): boolean {
    if (this.maQueryItems.length !== 1) return false;

    const rItem = this.maQueryItems[0]!;
    return this.eOp === ScQueryOp.SC_EQUAL && rItem.meType === QueryType.ByTextColor;
  }

  SetQueryByBackgroundColor(color: string): void {
    this.eOp = ScQueryOp.SC_EQUAL;
    this.maQueryItems.length = 1;
    const rItem = this.maQueryItems[0]!;
    rItem.meType = QueryType.ByBackgroundColor;
    rItem.maString = '';
    rItem.mfVal = SC_BACKGROUNDCOLOR;
    rItem.maColor = color;
  }

  IsQueryByBackgroundColor(): boolean {
    if (this.maQueryItems.length !== 1) return false;

    const rItem = this.maQueryItems[0]!;
    return this.eOp === ScQueryOp.SC_EQUAL && rItem.meType === QueryType.ByBackgroundColor;
  }

  GetQueryItem(): ScQueryEntryItem { return this.GetQueryItemImpl(); }

  private GetQueryItemImpl(): ScQueryEntryItem {
    if (this.maQueryItems.length !== 1)
      // Reset to a single query mode.
      this.maQueryItems.length = 1;
    if (!this.maQueryItems[0]) this.maQueryItems[0] = new ScQueryEntryItem();
    return this.maQueryItems[0];
  }

  Clear(): void {
    this.bDoQuery = false;
    this.eOp = ScQueryOp.SC_EQUAL;
    this.eConnect = ScQueryConnect.SC_AND;
    this.nField = 0;
    this.maQueryItems = [new ScQueryEntryItem()];

    this.pSearchParam = null;
    this.pSearchText = null;
  }

  equals(r: ScQueryEntry): boolean {
    return this.bDoQuery === r.bDoQuery && this.eOp === r.eOp && this.eConnect === r.eConnect && this.nField === r.nField
      && this.maQueryItems.length === r.maQueryItems.length && this.maQueryItems.every((x, i) => x.equals(r.maQueryItems[i]!));
    // do not compare pSearchParam and pSearchText!
  }

  /// creates pSearchParam and pSearchText if necessary
  GetSearchTextPtr(eSearchType: SearchType, bCaseSens: boolean, bWildMatchSel: boolean): TextSearch {
    if (!this.pSearchParam) {
      const aStr = this.maQueryItems[0]!.maString;
      this.pSearchParam = new SearchParam(aStr, eSearchType, bCaseSens, '~', bWildMatchSel);
      this.pSearchText = new TextSearch(this.pSearchParam);
    }
    return this.pSearchText!;
  }
}
