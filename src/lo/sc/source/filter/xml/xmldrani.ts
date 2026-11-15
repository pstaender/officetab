// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/xml/xmldrani.cxx reduced
// @upstream sc/source/filter/xml/xmlfilti.cxx reduced
// @upstream sc/source/filter/xml/XMLExportDatabaseRanges.cxx reduced
// Database ranges in ODF (table:database-ranges): their area, header, AutoFilter buttons and the
// filter (table:filter with table:filter-and / table:filter-or, table:filter-condition and
// table:filter-set-item), read into ScDBData (ScXMLDatabaseRangeContext, ScXMLFilterContext,
// ScXMLConditionContext) and written from them (ScXMLExportDatabaseRanges). Reduced: the sort
// (table:sort) and subtotal rules (table:subtotal-rules) and the database import
// (table:database-source-*) are neither read nor written but reported as lost on import;
// filtering by colour is not kept either. The filtered rows themselves are the rows' visibility.
import { childElements, escapeXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { ScAddress, type ScRange, type SCTAB } from '../../../inc/address.ts';
import { ScQueryConnect, ScQueryOp } from '../../../inc/global.ts';
import { ScQueryEntry, ScQueryEntryItem } from '../../../inc/queryentry.ts';
import { ScQueryParam } from '../../../inc/queryparam.ts';
import { ScMF } from '../../../inc/scitems.ts';
import { SearchType } from '../../../../unotools/source/i18n/textsearch.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { ScDBData, STR_DB_GLOBAL_NONAME, STR_DB_LOCAL_NONAME } from '../../core/tool/dbdata.ts';
import { ScRangeStringConverter } from '../../core/tool/rangeutl.ts';

/** ScXMLConditionContext::GetOperator. */
function GetOperator(aOpStr: string, rParam: ScQueryParam, rEntry: ScQueryEntry): void {
  rParam.eSearchType = SearchType.Normal;
  if (aOpStr === 'match') {
    rParam.eSearchType = SearchType.Regexp;
    rEntry.eOp = ScQueryOp.SC_EQUAL;
  } else if (aOpStr === '!match') {
    rParam.eSearchType = SearchType.Regexp;
    rEntry.eOp = ScQueryOp.SC_NOT_EQUAL;
  } else if (aOpStr === '=') rEntry.eOp = ScQueryOp.SC_EQUAL;
  else if (aOpStr === '!=') rEntry.eOp = ScQueryOp.SC_NOT_EQUAL;
  else if (aOpStr === 'bottom percent') rEntry.eOp = ScQueryOp.SC_BOTPERC;
  else if (aOpStr === 'bottom values') rEntry.eOp = ScQueryOp.SC_BOTVAL;
  else if (aOpStr === 'empty') rEntry.SetQueryByEmpty();
  else if (aOpStr === '>') rEntry.eOp = ScQueryOp.SC_GREATER;
  else if (aOpStr === '>=') rEntry.eOp = ScQueryOp.SC_GREATER_EQUAL;
  else if (aOpStr === '<') rEntry.eOp = ScQueryOp.SC_LESS;
  else if (aOpStr === '<=') rEntry.eOp = ScQueryOp.SC_LESS_EQUAL;
  else if (aOpStr === '!empty') rEntry.SetQueryByNonEmpty();
  else if (aOpStr === 'top percent') rEntry.eOp = ScQueryOp.SC_TOPPERC;
  else if (aOpStr === 'top values') rEntry.eOp = ScQueryOp.SC_TOPVAL;
  else if (aOpStr === 'contains') rEntry.eOp = ScQueryOp.SC_CONTAINS;
  else if (aOpStr === '!contains') rEntry.eOp = ScQueryOp.SC_DOES_NOT_CONTAIN;
  else if (aOpStr === 'begins') rEntry.eOp = ScQueryOp.SC_BEGINS_WITH;
  else if (aOpStr === '!begins') rEntry.eOp = ScQueryOp.SC_DOES_NOT_BEGIN_WITH;
  else if (aOpStr === 'ends') rEntry.eOp = ScQueryOp.SC_ENDS_WITH;
  else if (aOpStr === '!ends') rEntry.eOp = ScQueryOp.SC_DOES_NOT_END_WITH;
}

/** ScXMLFilterContext's connection stack: the and/or elements the conditions are in. */
class ConnStack {
  private maConnStack: { mbOr: boolean; mnCondCount: number }[] = [];
  OpenConnection(b: boolean): void { this.maConnStack.push({ mbOr: b, mnCondCount: 0 }); }
  CloseConnection(): void { this.maConnStack.pop(); }
  GetConnection(): boolean {
    // For condition items in each stack, the first one gets the connection of
    // the last stack, while the rest of them get that of the current stack.

    if (!this.maConnStack.length)
      // This should never happen.
      return true;

    const rItem = this.maConnStack[this.maConnStack.length - 1]!;
    if (rItem.mnCondCount)
      // secondary item gets the current connection.
      return rItem.mbOr;

    // The next condition of this stack will get the current connection.
    ++rItem.mnCondCount;

    if (this.maConnStack.length < 2)
      // There is no last stack.  Likely the first condition in the first
      // stack whose connection is not used.  Default in
      // ScQueryEntry::eConnect is SC_AND, so return false (AND instead of
      // OR) here.
      return false;

    return this.maConnStack[this.maConnStack.length - 2]!.mbOr; // connection of the last stack.
  }
}

/** The children of table:filter, table:filter-and and table:filter-or into the param
    (ScXMLAndContext, ScXMLOrContext, ScXMLConditionContext). */
function ReadConditions(e: XmlElement, rParam: ScQueryParam, pFilterContext: ConnStack, lost: Set<string>): void {
  for (const k of childElements(e)) {
    if (k.name === 'table:filter-and' || k.name === 'table:filter-or') {
      pFilterContext.OpenConnection(k.name === 'table:filter-or');
      ReadConditions(k, rParam, pFilterContext, lost);
      pFilterContext.CloseConnection();
    } else if (k.name === 'table:filter-condition') {
      // ScXMLConditionContext::endFastElement
      const rEntry = rParam.AppendEntry();
      // We currently don't support per-condition case sensitivity.
      rParam.bCaseSens = k.attrs.get('table:case-sensitive') === 'true';
      rEntry.bDoQuery = true;
      rEntry.eConnect = pFilterContext.GetConnection() ? ScQueryConnect.SC_OR : ScQueryConnect.SC_AND;
      const sOperator = k.attrs.get('table:operator') ?? '=';
      GetOperator(sOperator, rParam, rEntry);
      const nStartPos = rParam.bByRow ? rParam.nCol1 : rParam.nRow1;
      rEntry.nField = Number(k.attrs.get('table:field-number') ?? 0) + nStartPos;

      const maQueryItems: ScQueryEntryItem[] = [];
      for (const s of childElements(k)) {
        if (s.name !== 'table:filter-set-item') continue;
        // ScXMLSetItemContext
        const aItem = new ScQueryEntryItem();
        aItem.maString = s.attrs.get('table:value') ?? '';
        aItem.meType = ScQueryEntry.ByString;
        aItem.mfVal = 0.0;
        maQueryItems.push(aItem);
      }
      if (maQueryItems.length === 0) {
        const rItem = rEntry.GetQueryItem();
        if (sOperator === 'empty') continue;
        const sDataType = k.attrs.get('table:data-type') ?? k.attrs.get('loext:data-type') ?? '';
        const sConditionValue = k.attrs.get('table:value') ?? '';
        if (sDataType === 'number') {
          rItem.mfVal = Number(sConditionValue);
          rItem.meType = ScQueryEntry.ByValue;
        } else if (sDataType === 'text-color' || sDataType === 'background-color') {
          lost.add('Filtering by colour');
          rEntry.Clear();
        } else {
          rItem.maString = sConditionValue;
          rItem.meType = ScQueryEntry.ByString;
        }
      } else {
        const rItems = rEntry.GetQueryItems();
        rItems.length = 0;
        rItems.push(...maQueryItems);
      }
    }
  }
}

/** Read table:database-ranges (ScXMLDatabaseRangesContext and ScXMLDatabaseRangeContext). */
export function ImportDatabaseRanges(rDoc: ScDocument, e: XmlElement, lost: Set<string>): void {
  const pColl = rDoc.GetDBCollection();
  for (const d of childElements(e)) {
    if (d.name !== 'table:database-range') continue;
    const sDatabaseRangeName = d.attrs.get('table:name') ?? '';
    const aRange = ScRangeStringConverter.GetRangeFromString(d.attrs.get('table:target-range-address') ?? '', rDoc);
    if (!aRange) continue;
    const bByRow = d.attrs.get('table:orientation') !== 'column';
    const bHasHeader = d.attrs.get('table:contains-header') !== 'false';
    const bAutoFilter = d.attrs.get('table:display-filter-buttons') === 'true';

    const pData = new ScDBData(STR_DB_LOCAL_NONAME, aRange.aStart.Tab(), aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aEnd.Row(), bByRow, bHasHeader, d.attrs.get('calcext:contains-footer') === 'true');
    pData.SetAutoFilter(bAutoFilter);
    pData.SetKeepFmt(d.attrs.get('table:on-update-keep-styles') === 'true');
    pData.SetDoSize(d.attrs.get('table:on-update-keep-size') === 'false');
    pData.SetStripData(d.attrs.get('table:has-persistent-data') === 'false');
    pData.SetImportSelection(d.attrs.get('table:is-selection') === 'true');

    for (const k of childElements(d)) {
      switch (k.name) {
        case 'table:filter': {
          // ScXMLFilterContext
          const aParam = pData.GetQueryParam();
          for (let i = 0; i < aParam.GetEntryCount(); i++) aParam.GetEntry(i).Clear();
          aParam.Resize(0);
          aParam.bByRow = bByRow;
          aParam.bHasHeader = bHasHeader;
          aParam.bDuplicate = k.attrs.get('table:display-duplicates') !== 'false';
          const sDest = k.attrs.get('table:target-range-address');
          if (sDest) {
            const aDest = ScRangeStringConverter.GetRangeFromString(sDest, rDoc) ?? (() => { const a = ScRangeStringConverter.GetAddressFromString(sDest, rDoc); return a ? { aStart: a } : null; })();
            if (aDest) {
              aParam.bInplace = false;
              aParam.nDestTab = aDest.aStart.Tab();
              aParam.nDestCol = aDest.aStart.Col();
              aParam.nDestRow = aDest.aStart.Row();
            }
          }
          const sCond = k.attrs.get('table:condition-source-range-address');
          ReadConditions(k, aParam, new ConnStack(), lost);
          // keep MAXQUERY entries at least, as the dialogs expect
          if (aParam.GetEntryCount() < 8) aParam.Resize(8);
          pData.SetQueryParam(aParam);
          if (sCond) pData.SetAdvancedQuerySource(ScRangeStringConverter.GetRangeFromString(sCond, rDoc));
          break;
        }
        case 'table:sort': lost.add('Sort settings of database ranges'); break;
        case 'table:subtotal-rules': lost.add('Subtotal settings of database ranges'); break;
        case 'table:database-source-sql': case 'table:database-source-table': case 'table:database-source-query': lost.add('Database import ranges'); break;
        default: break;
      }
    }

    // ScXMLDatabaseRangeContext::endFastElement
    if (sDatabaseRangeName.startsWith(STR_DB_LOCAL_NONAME)) {
      // The appended number is the sheet index on export; the range's own sheet decides.
      const nTab: SCTAB = aRange.aStart.Tab();
      rDoc.SetAnonymousDBData(nTab, pData);
    } else if (sDatabaseRangeName.startsWith(STR_DB_GLOBAL_NONAME)) {
      pColl.getAnonDBs().insert(new ScDBData(STR_DB_GLOBAL_NONAME, pData));
      continue;
    } else {
      const pNamed = new ScDBData(sDatabaseRangeName, pData);
      if (!pColl.getNamedDBs().insert(pNamed)) continue;
    }
    if (bAutoFilter) rDoc.ApplyFlagsTab(aRange.aStart.Col(), aRange.aStart.Row(), aRange.aEnd.Col(), aRange.aStart.Row(), aRange.aStart.Tab(), ScMF.Auto);
  }
}

// --- export (ScXMLExportDatabaseRanges) ---

function getOperatorXML(rEntry: ScQueryEntry, eSearchType: SearchType): string {
  switch (rEntry.eOp) {
    case ScQueryOp.SC_BEGINS_WITH: return 'begins';
    case ScQueryOp.SC_BOTPERC: return 'bottom percent';
    case ScQueryOp.SC_BOTVAL: return 'bottom values';
    case ScQueryOp.SC_CONTAINS: return 'contains';
    case ScQueryOp.SC_DOES_NOT_BEGIN_WITH: return '!begins';
    case ScQueryOp.SC_DOES_NOT_CONTAIN: return '!contains';
    case ScQueryOp.SC_DOES_NOT_END_WITH: return '!ends';
    case ScQueryOp.SC_ENDS_WITH: return 'ends';
    case ScQueryOp.SC_EQUAL:
      if (rEntry.IsQueryByEmpty()) return 'empty';
      else if (rEntry.IsQueryByNonEmpty()) return '!empty';
      if (eSearchType === SearchType.Regexp) return 'match';
      return '=';
    case ScQueryOp.SC_GREATER: return '>';
    case ScQueryOp.SC_GREATER_EQUAL: return '>=';
    case ScQueryOp.SC_LESS: return '<';
    case ScQueryOp.SC_LESS_EQUAL: return '<=';
    case ScQueryOp.SC_NOT_EQUAL:
      if (eSearchType === SearchType.Regexp) return '!match';
      return '!=';
    case ScQueryOp.SC_TOPPERC: return 'top percent';
    case ScQueryOp.SC_TOPVAL: return 'top values';
    default:
  }
  return '=';
}

function writeCondition(rEntry: ScQueryEntry, nFieldStart: number, bCaseSens: boolean, eSearchType: SearchType): string {
  const rItems = rEntry.GetQueryItems();
  if (rItems.length === 0) return ''; // Query entry has no items at all!
  const field = ` table:field-number="${rEntry.nField - nFieldStart}"${bCaseSens ? ' table:case-sensitive="true"' : ''}`;
  if (rItems.length === 1) {
    // Single item condition.
    const rItem = rItems[0]!;
    let attrs: string;
    if (rItem.meType === ScQueryEntry.ByString || rItem.meType === ScQueryEntry.ByDate) attrs = ` table:value="${escapeXml(rItem.maString)}"`;
    else if (rItem.meType === ScQueryEntry.ByTextColor || rItem.meType === ScQueryEntry.ByBackgroundColor) return '';
    else attrs = ` table:data-type="number" table:value="${rItem.mfVal}"`;
    return `<table:filter-condition${attrs} table:operator="${escapeXml(getOperatorXML(rEntry, eSearchType))}"${field}/>`;
  }
  // Multi-item condition.
  // Store the 1st value for backward compatibility.
  const items = rItems.map((r) => `<table:filter-set-item table:value="${escapeXml(r.maString)}"/>`).join('');
  return `<table:filter-condition table:value="${escapeXml(rItems[0]!.maString)}" table:operator="="${field}>${items}</table:filter-condition>`;
}

function writeFilter(rDoc: ScDocument, rData: ScDBData): string {
  const aParam = rData.GetQueryParam();
  let nCount = 0;
  for (const n = aParam.GetEntryCount(); nCount < n; ++nCount) if (!aParam.GetEntry(nCount).bDoQuery) break;

  if (!nCount)
    // No filter criteria to save. Bail out.
    return '';

  let attrs = '';
  if (!aParam.bInplace) attrs += ` table:target-range-address="${escapeXml(ScRangeStringConverter.GetStringFromAddress(new ScAddress(aParam.nDestCol, aParam.nDestRow, aParam.nDestTab), rDoc))}"`;
  const aAdvSource = rData.GetAdvancedQuerySource();
  if (aAdvSource) attrs += ` table:condition-source-range-address="${escapeXml(ScRangeStringConverter.GetStringFromRange(aAdvSource, rDoc))}"`;
  if (!aParam.bDuplicate) attrs += ' table:display-duplicates="false"';

  let bAnd = false;
  let bOr = false;
  for (let i = 0; i < nCount; ++i) {
    if (aParam.GetEntry(i).eConnect === ScQueryConnect.SC_AND) bAnd = true;
    else bOr = true;
  }

  // Note that export field index values are relative to the first field.
  const aRange = rData.GetArea();
  const nFieldStart = aParam.bByRow ? aRange.aStart.Col() : aRange.aStart.Row();
  const cond = (i: number) => writeCondition(aParam.GetEntry(i), nFieldStart, aParam.bCaseSens, aParam.eSearchType);

  let s = '';
  if (bOr && !bAnd) {
    s += '<table:filter-or>';
    for (let i = 0; i < nCount; ++i) s += cond(i);
    s += '</table:filter-or>';
  } else if (bAnd && !bOr) {
    s += '<table:filter-and>';
    for (let i = 0; i < nCount; ++i) s += cond(i);
    s += '</table:filter-and>';
  } else if (nCount === 1) s += cond(0);
  else {
    // mixed: an or of the and groups
    s += '<table:filter-or>';
    let nPrev = 0;
    let eConnect = aParam.GetEntry(1).eConnect;
    let bOpenAndElement = false;
    if (eConnect === ScQueryConnect.SC_AND) {
      s += '<table:filter-and>';
      bOpenAndElement = true;
    }
    for (let i = 1; i < nCount; ++i) {
      const rEntry = aParam.GetEntry(i);
      if (eConnect !== rEntry.eConnect) {
        eConnect = rEntry.eConnect;
        if (rEntry.eConnect === ScQueryConnect.SC_AND) {
          s += '<table:filter-and>';
          bOpenAndElement = true;
          s += cond(nPrev);
          nPrev = i;
          if (i === nCount - 1) {
            s += cond(nPrev);
            s += '</table:filter-and>';
            bOpenAndElement = false;
          }
        } else {
          s += cond(nPrev);
          nPrev = i;
          if (bOpenAndElement) {
            s += '</table:filter-and>';
            bOpenAndElement = false;
          }
          if (i === nCount - 1) s += cond(nPrev);
        }
      } else {
        s += cond(nPrev);
        nPrev = i;
        if (i === nCount - 1) s += cond(nPrev);
      }
    }
    if (bOpenAndElement) s += '</table:filter-and>';
    s += '</table:filter-or>';
  }
  return `<table:filter${attrs}>${s}</table:filter>`;
}

function write(rDoc: ScDocument, rName: string, rData: ScDBData): string {
  const aRange: ScRange = rData.GetArea();
  let attrs = ` table:name="${escapeXml(rName)}" table:target-range-address="${escapeXml(ScRangeStringConverter.GetStringFromRange(aRange, rDoc))}"`;
  // various boolean flags.
  if (rData.HasImportSelection()) attrs += ' table:is-selection="true"';
  if (rData.HasAutoFilter()) attrs += ' table:display-filter-buttons="true"';
  if (rData.IsKeepFmt()) attrs += ' table:on-update-keep-styles="true"';
  if (rData.IsDoSize()) attrs += ' table:on-update-keep-size="false"';
  if (rData.IsStripData()) attrs += ' table:has-persistent-data="false"';
  const aQueryParam = rData.GetQueryParam();
  if (!aQueryParam.bHasHeader) attrs += ' table:contains-header="false"';
  if (aQueryParam.bHasTotals) attrs += ' calcext:contains-footer="true"';
  if (!rData.GetSortParam().bByRow) attrs += ' table:orientation="column"';
  return `<table:database-range${attrs}>${writeFilter(rDoc, rData)}</table:database-range>`;
}

/** The table:database-ranges element of the document, '' without database ranges. */
export function ExportDatabaseRanges(rDoc: ScDocument): string {
  let s = '';
  // Get sheet-local anonymous ranges.
  for (let i = 0; i < rDoc.GetTableCount(); ++i) {
    const p = rDoc.GetAnonymousDBData(i);
    if (p) s += write(rDoc, STR_DB_LOCAL_NONAME + i, p); // appended number equals sheet index on import.
  }
  const pDBCollection = rDoc.GetDBCollection();
  for (const p of pDBCollection.getNamedDBs()) s += write(rDoc, p.GetName(), p);
  // Add global anonymous DB ranges.
  let mnCounter = 0;
  for (const p of pDBCollection.getAnonDBs()) s += write(rDoc, STR_DB_GLOBAL_NONAME + ++mnCounter, p);
  return s ? `<table:database-ranges>${s}</table:database-ranges>` : '';
}
