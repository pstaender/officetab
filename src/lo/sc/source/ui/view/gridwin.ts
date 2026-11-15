// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/view/gridwin.cxx partial
// @upstream sc/source/ui/view/gridwin2.cxx partial
// @upstream sc/source/ui/cctrl/checklistmenu.cxx partial
// The AutoFilter popup of ScGridWindow without its window: DoAutoFilterButton's hit test,
// LaunchAutoFilterMenu (the members of the check list with their check states, from the column's
// filter entries and the current filter) and UpdateAutoFilterFromMenu (the filter, sort or clear
// the menu chose). ScCheckListMenuControl's getResult is the members' state the web shell's popup
// hands back; the validity list's entries (LaunchDataSelectMenu). Left out: filtering and sorting by colour, the date members' year/month/day tree
// (dates are plain members with their ISO date), the LibreOfficeKit messages.
import { ScAddress, type SCCOL, type SCROW } from '../../../inc/address.ts';
import { ScQueryConnect, ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry, ScQueryEntryItem } from '../../../inc/queryentry.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { ScColorSortMode, ScSortNumberBehavior } from '../../../inc/sortparam.ts';
import { ScFilterEntries, ScTypedStrData, ScTypedStrDataType } from '../../../inc/filterentries.ts';
import { TableValidationVisibility, type ScValidationData } from '../../core/data/validat.ts';
import { SearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import { ScDBDataPortion, type ScDBData } from '../../core/tool/dbdata.ts';
import type { ScTabViewShell } from './tabvwsh.ts';
import { GetAutoFilterButtonRect } from './gridwin4.ts';
import type { ScSplitPos, ScViewData } from './viewdata.ts';

export const AutoFilterMode = {
  Normal: 0, Top10: 1, Bottom10: 2, Custom: 3, Empty: 4, NonEmpty: 5, TextColor: 6, BackgroundColor: 7, SortAscending: 8, SortDescending: 9, Clear: 10,
} as const;
export type AutoFilterMode = (typeof AutoFilterMode)[keyof typeof AutoFilterMode];

/** A member of the check list (ScCheckListMenuControl::Member). */
export interface ScCheckListMember {
  /** The shown name ('' for the empty cells, shown as "(empty)"). */
  maName: string;
  maRealName: string;
  mnValue: number;
  mbDate: boolean;
  mbValue: boolean;
  /** Checked. */
  mbVisible: boolean;
  /** In rows another column's filter hides (shown greyed). */
  mbHiddenByOtherFilter: boolean;
}

/** ScCheckListMenuControl::ResultEntry. */
export interface ResultEntry { aName: string; nValue: number; bValid: boolean; bDate: boolean; bValue: boolean }

/** What the popup shows (AutoFilterData and the menu's members and items). */
export interface AutoFilterData {
  maPos: ScAddress;
  mpData: ScDBData;
  maMembers: ScCheckListMember[];
  mbHasDates: boolean;
  /** The column has a filter: "Clear Filter" is offered. */
  mbHasFilter: boolean;
  /** The members' state when the popup opened (aSaveAutoFilterResult). */
  maSaveResult: ResultEntry[];
}

/** Whether a point (pixels from the pane's origin) is on the AutoFilter button of the cell
    (DoAutoFilterButton's test). */
export function DoAutoFilterButton(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW, eWhich: ScSplitPos, x: number, y: number): boolean {
  const rDoc = rViewData.GetDocument();
  const nTab = rViewData.CurrentTabForData();
  if (!(rDoc.GetAttr(nCol, nRow, nTab, 'ATTR_MERGE_FLAG') & ScMF.Auto)) return false;
  const r = GetAutoFilterButtonRect(rViewData, nCol, nRow, eWhich);
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** Whether a column has a filter (IsAutoFilterActive). */
export function IsAutoFilterActive(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW): boolean {
  const pDBData = rViewData.GetDocument().GetDBAtCursor(nCol, nRow, rViewData.CurrentTabForData(), ScDBDataPortion.AREA);
  if (!pDBData) return false;
  const aParam = pDBData.GetQueryParam();
  return aParam.FindAllEntriesByField(nCol).some((e) => e.bDoQuery);
}

/** ScCheckListMenuControl::getResult: the members' check states. */
export function GetResult(maMembers: readonly ScCheckListMember[]): ResultEntry[] {
  return maMembers.map((m) => ({ aName: m.maRealName, nValue: m.mnValue, bValid: m.mbVisible && !m.mbHiddenByOtherFilter, bDate: m.mbDate, bValue: m.mbValue }));
}

/** ScCheckListMenuControl::isAllSelected: every member that is not hidden by another filter is checked. */
export function IsAllSelected(maMembers: readonly ScCheckListMember[]): boolean {
  return maMembers.every((m) => m.mbVisible || m.mbHiddenByOtherFilter);
}

function sameResult(a: readonly ResultEntry[], b: readonly ResultEntry[]): boolean {
  const key = (r: ResultEntry) => `${r.aName}\u0001${r.nValue}\u0001${r.bValid}\u0001${r.bDate}\u0001${r.bValue}`;
  const sa = a.map(key).sort(), sb = b.map(key).sort();
  return sa.length === sb.length && sa.every((x, i) => x === sb[i]);
}

/** The data of the popup for the AutoFilter button of a cell (LaunchAutoFilterMenu). */
export function LaunchAutoFilterMenu(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW): AutoFilterData | null {
  const nTab = rViewData.CurrentTabForData();
  const rDoc = rViewData.GetDocument();

  const aFilterEntries = new ScFilterEntries();
  rDoc.GetFilterEntries(nCol, nRow, nTab, aFilterEntries);

  const pDBData = rDoc.GetDBAtCursor(nCol, nRow, nTab, ScDBDataPortion.AREA);
  if (!pDBData) return null;

  const aParam = pDBData.GetQueryParam();
  const aEntries = aParam.FindAllEntriesByField(nCol);
  const aSelectedString = new Set<string>();
  const aSelectedValue = new Set<number>();
  const bQueryByNonEmpty = aEntries.length === 1 && aEntries[0]!.IsQueryByNonEmpty();

  if (!bQueryByNonEmpty) {
    for (const pEntry of aEntries) {
      if (pEntry && pEntry.eOp === ScQueryOp.SC_EQUAL) {
        for (const rItem of pEntry.GetQueryItems()) {
          // AddSelectedItemString
          if (rItem.meType === ScQueryEntry.ByValue) aSelectedValue.add(rItem.mfVal);
          else aSelectedString.add(rItem.maString);
        }
      }
    }
  }

  const maMembers: ScCheckListMember[] = [];
  const aStrData = [...aFilterEntries.maStrData];
  // Populate the check box list.
  for (let i = 0; i < aStrData.length; i++) {
    const it = aStrData[i]!;
    // tdf#140745 show (empty) entry on top of the checkbox list if not hidden by filter
    if (it.GetString() === '' && !it.IsHiddenByFilter()) {
      const aStringVal = it.GetString();
      const aDoubleVal = it.GetValue();
      let bSelected = true;
      if (aSelectedValue.size || aSelectedString.size) bSelected = aSelectedString.has(aStringVal);
      else if (bQueryByNonEmpty) bSelected = false;
      // it->IsHiddenByFilter() is always false here so no need to evaluate it
      maMembers.push({ maName: aStringVal, maRealName: aStringVal, mnValue: aDoubleVal, mbDate: false, mbValue: false, mbVisible: bSelected, mbHiddenByOtherFilter: false });
      aStrData.splice(i, 1);
      break;
    }
  }
  for (const rEntry of aStrData) {
    const aStringVal = rEntry.GetString();
    const aDoubleVal = rEntry.GetValue();
    const aRDoubleVal = rEntry.GetRoundedValue();
    let bSelected = !rEntry.IsHiddenByFilter();

    if (aSelectedValue.size || aSelectedString.size) {
      if (rEntry.GetStringType() === ScTypedStrDataType.Value) {
        if (aDoubleVal === aRDoubleVal) bSelected = aSelectedValue.has(aDoubleVal) || aSelectedString.has(aStringVal);
        else bSelected = aSelectedValue.has(aDoubleVal) || aSelectedValue.has(aRDoubleVal) || aSelectedString.has(aStringVal);
      } else bSelected = aSelectedString.has(aStringVal);
    }

    if (rEntry.IsDate()) maMembers.push({ maName: aStringVal, maRealName: aStringVal, mnValue: rEntry.GetValue(), mbDate: true, mbValue: false, mbVisible: bSelected, mbHiddenByOtherFilter: rEntry.IsHiddenByFilter() });
    else maMembers.push({ maName: aStringVal, maRealName: aStringVal, mnValue: aRDoubleVal, mbDate: false, mbValue: rEntry.GetStringType() === ScTypedStrDataType.Value, mbVisible: bSelected, mbHiddenByOtherFilter: rEntry.IsHiddenByFilter() });
  }

  return {
    maPos: new ScAddress(nCol, nRow, nTab),
    mpData: pDBData,
    maMembers,
    mbHasDates: aFilterEntries.mbHasDates,
    mbHasFilter: aEntries.length > 0,
    // remember filter rules before modification
    maSaveResult: GetResult(maMembers),
  };
}

/**
 * Apply what the popup chose (UpdateAutoFilterFromMenu): eMode, and for Normal the members'
 * states. @returns 'custom' when the standard filter dialog is to be opened (the range is
 * selected and the cursor put on the column first).
 */
export function UpdateAutoFilterFromMenu(rView: ScTabViewShell, pData: AutoFilterData, eMode: AutoFilterMode, maMembers: readonly ScCheckListMember[] = pData.maMembers): 'custom' | void {
  const bColorMode = eMode === AutoFilterMode.TextColor || eMode === AutoFilterMode.BackgroundColor;
  const rPos = pData.maPos;
  const pDBData = pData.mpData;
  if (!pDBData) return;

  switch (eMode) {
    case AutoFilterMode.SortAscending:
    case AutoFilterMode.SortDescending: {
      const nCol = rPos.Col();
      const aSortParam = pDBData.GetSortParam();
      if (nCol < aSortParam.nCol1 || nCol > aSortParam.nCol2)
        // out of bound
        return;

      const bHasHeader = pDBData.HasHeader();

      aSortParam.bHasHeader = bHasHeader;
      aSortParam.bByRow = true;
      aSortParam.bCaseSens = false;
      aSortParam.eSortNumberBehavior = ScSortNumberBehavior.ALPHA_NUMERIC;
      aSortParam.aDataAreaExtras.mbCellNotes = false;
      aSortParam.aDataAreaExtras.mbCellDrawObjects = true;
      aSortParam.aDataAreaExtras.mbCellFormats = true;
      aSortParam.bInplace = true;
      aSortParam.maKeyState[0]!.bDoSort = true;
      aSortParam.maKeyState[0]!.nField = nCol;
      aSortParam.maKeyState[0]!.bAscending = eMode === AutoFilterMode.SortAscending;
      aSortParam.maKeyState[0]!.aColorSortMode = ScColorSortMode.None;

      for (let i = 1; i < aSortParam.GetSortKeyCount(); ++i) aSortParam.maKeyState[i]!.bDoSort = false;

      // (UISort: subtotals are not repeated)
      rView.Sort(aSortParam);
      return;
    }
    case AutoFilterMode.Custom: {
      const aRange = pDBData.GetArea();
      rView.MarkRange(aRange);
      rView.SetCursor(rPos.Col(), rPos.Row());
      return 'custom';
    }
    default:
  }

  const aParam = pDBData.GetQueryParam();

  if (eMode === AutoFilterMode.Normal) {
    // Do not recreate autofilter rules if there are no changes from the user
    const aResult = GetResult(maMembers);

    if (sameResult(aResult, pData.maSaveResult)) {
      if (!IsAllSelected(maMembers)) {
        // Apply autofilter to data
        const pEntry = aParam.FindEntryByField(rPos.Col(), true)!;
        pEntry.bDoQuery = true;
        pEntry.nField = rPos.Col();
        pEntry.eConnect = ScQueryConnect.SC_AND;
        pEntry.eOp = ScQueryOp.SC_EQUAL;
        rView.Query(aParam, null, true);
      }
      return;
    }
  }

  // Remove old entries in auto-filter rules
  if (!bColorMode) {
    aParam.RemoveAllEntriesByField(rPos.Col());

    // tdf#46184 reset filter options to default values
    aParam.eSearchType = SearchType.Normal;
    aParam.bCaseSens = false;
    aParam.bDuplicate = true;
    aParam.bInplace = true;
  }

  if (eMode !== AutoFilterMode.Clear && !(eMode === AutoFilterMode.Normal && IsAllSelected(maMembers))) {
    // Try to use the existing entry for the column (if one exists).
    const pEntry = aParam.FindEntryByField(rPos.Col(), true);

    if (!pEntry)
      // Something went terribly wrong!
      return;

    pEntry.bDoQuery = true;
    pEntry.nField = rPos.Col();
    pEntry.eConnect = ScQueryConnect.SC_AND;

    switch (eMode) {
      case AutoFilterMode.Normal: {
        pEntry.eOp = ScQueryOp.SC_EQUAL;

        const aResult = GetResult(maMembers);

        const rItems = pEntry.GetQueryItems();
        rItems.length = 0;
        for (const rEntry of aResult) {
          // AddItemToEntry
          if (rEntry.bValid) {
            const aNew = new ScQueryEntryItem();
            aNew.maString = rEntry.aName;
            // set the filter type to ByValue, if the filter condition is value
            aNew.meType = rEntry.bDate ? ScQueryEntry.ByDate : rEntry.bValue ? ScQueryEntry.ByValue : ScQueryEntry.ByString;
            aNew.mfVal = rEntry.nValue;
            rItems.push(aNew);
          }
        }
        break;
      }
      case AutoFilterMode.Top10:
        pEntry.eOp = ScQueryOp.SC_TOPVAL;
        pEntry.GetQueryItem().meType = ScQueryEntry.ByString;
        pEntry.GetQueryItem().maString = '10';
        break;
      case AutoFilterMode.Bottom10:
        pEntry.eOp = ScQueryOp.SC_BOTVAL;
        pEntry.GetQueryItem().meType = ScQueryEntry.ByString;
        pEntry.GetQueryItem().maString = '10';
        break;
      case AutoFilterMode.Empty:
        pEntry.SetQueryByEmpty();
        break;
      case AutoFilterMode.NonEmpty:
        pEntry.SetQueryByNonEmpty();
        break;
      default:
        // We don't know how to handle this!
        return;
    }
  }

  rView.Query(aParam, null, true);
  pDBData.SetQueryParam(aParam);
}

// --- the validity list (LaunchDataSelectMenu, the list button of UpdateListValPos) ---

/** The validity of a cell with a selection list, or null (bListValButton's test). */
export function GetListValidation(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW): ScValidationData | null {
  const rDoc = rViewData.GetDocument();
  const nTab = rViewData.CurrentTabForData();
  const nIndex = rDoc.GetAttr(nCol, nRow, nTab, 'ATTR_VALIDDATA');
  const pData = nIndex ? rDoc.GetValidationEntry(nIndex) : null;
  return pData && pData.HasSelectionList() ? pData : null;
}

/** The entries of a cell's validity list and the one the cell shows (LaunchDataSelectMenu with
    ScDocument::GetDataEntries' validation branch). */
export function LaunchDataSelectMenu(rViewData: ScViewData, nCol: SCCOL, nRow: SCROW): { aStrings: string[]; nSelPos: number } | null {
  const rDoc = rViewData.GetDocument();
  const nTab = rViewData.CurrentTabForData();
  const pData = GetListValidation(rViewData, nCol, nRow);
  if (!pData) return null;
  const aPos = new ScAddress(nCol, nRow, nTab);
  // Fill List
  let aStrings: ScTypedStrData[] = [];
  pData.FillSelectionList(aStrings, aPos);
  if (pData.GetListType() === TableValidationVisibility.SORTEDASCENDING) aStrings.sort((a, b) => ScTypedStrData.Compare(a, b, true));

  // IsIgnoreBlank allows blank values. Don't add empty string unless "Allow Empty Cells"
  if (!pData.IsIgnoreBlank()) aStrings = aStrings.filter((r) => r.GetString() !== '');
  if (!aStrings.length) return null;

  const aDocStr = rDoc.GetString(aPos);
  const nSelPos = aStrings.findIndex((r) => r.GetString() === aDocStr);
  return { aStrings: aStrings.map((r) => r.GetString()), nSelPos };
}
