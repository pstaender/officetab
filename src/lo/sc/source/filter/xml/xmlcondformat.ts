// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/xml/xmlcondformat.cxx reduced
// Conditional formats in ODF (calcext:conditional-formats, a child of table:table): the
// calcext:condition entries read into ScCondFormatEntry (ScXMLConditionalFormatContext,
// ScXMLCondContext, GetConditionData) and written from them (ScXMLExport::ExportConditionalFormat).
// Reduced: colour scales, data bars, icon sets and date conditions (calcext:color-scale,
// calcext:data-bar, calcext:icon-set, calcext:date-is) are not supported and reported as lost;
// the base cell address is resolved at once (not through SetSrcString); the cached formats and
// the merging of equal formats into one (ScXMLConditionalFormatsContext's cache) are left out.
import { childElements, escapeXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScAddress, type SCTAB } from '../../../inc/address.ts';
import { ScRangeList } from '../../../inc/rangelst.ts';
import { ScCondFormatEntry, ScConditionMode, ScConditionalFormat } from '../../core/data/conditio.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { ScRangeStringConverter } from '../../core/tool/rangeutl.ts';

/** The expression up to cEndChar outside quotes and parentheses (ScXMLConditionHelper::getExpression). */
function getExpression(s: string, nStart: number, cEndChar: string): { aExp: string; nEnd: number } {
  let nDepth = 0;
  let i = nStart;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"' || ch === '\'') {
      const q = ch;
      i++;
      while (i < s.length && !(s[i] === q && s[i + 1] !== q)) i += s[i] === q ? 2 : 1;
    } else if (ch === '(' || ch === '[') nDepth++;
    else if (ch === ')' || ch === ']') {
      if (nDepth === 0 && ch === cEndChar) break;
      nDepth--;
    } else if (nDepth === 0 && ch === cEndChar) break;
    i++;
  }
  if (i >= s.length) return { aExp: '', nEnd: i };
  return { aExp: s.slice(nStart, i).trim(), nEnd: i + 1 };
}

/** The condition of a calcext:value (GetConditionData). */
export function GetConditionData(rValue: string): { eMode: ScConditionMode; rExpr1: string; rExpr2: string } {
  let eMode: ScConditionMode = ScConditionMode.NONE;
  let rExpr1 = '';
  let rExpr2 = '';
  const two = (n: number) => {
    const a = getExpression(rValue, n, ',');
    rExpr1 = a.aExp;
    rExpr2 = getExpression(rValue, a.nEnd, ')').aExp;
  };
  const one = (n: number) => { rExpr1 = getExpression(rValue, n, ')').aExp; };
  if (rValue.startsWith('unique')) eMode = ScConditionMode.NotDuplicate;
  else if (rValue.startsWith('duplicate')) eMode = ScConditionMode.Duplicate;
  else if (rValue.startsWith('between')) { two(8); eMode = ScConditionMode.Between; }
  else if (rValue.startsWith('not-between')) { two(12); eMode = ScConditionMode.NotBetween; }
  else if (rValue.startsWith('<=')) { rExpr1 = rValue.slice(2); eMode = ScConditionMode.EqLess; }
  else if (rValue.startsWith('>=')) { rExpr1 = rValue.slice(2); eMode = ScConditionMode.EqGreater; }
  else if (rValue.startsWith('!=')) { rExpr1 = rValue.slice(2); eMode = ScConditionMode.NotEqual; }
  else if (rValue.startsWith('<')) { rExpr1 = rValue.slice(1); eMode = ScConditionMode.Less; }
  else if (rValue.startsWith('=')) { rExpr1 = rValue.slice(1); eMode = ScConditionMode.Equal; }
  else if (rValue.startsWith('>')) { rExpr1 = rValue.slice(1); eMode = ScConditionMode.Greater; }
  else if (rValue.startsWith('formula-is')) { one(11); eMode = ScConditionMode.Direct; }
  else if (rValue.startsWith('top-elements')) { one(13); eMode = ScConditionMode.Top10; }
  else if (rValue.startsWith('bottom-elements')) { one(16); eMode = ScConditionMode.Bottom10; }
  else if (rValue.startsWith('top-percent')) { one(12); eMode = ScConditionMode.TopPercent; }
  else if (rValue.startsWith('bottom-percent')) { one(15); eMode = ScConditionMode.BottomPercent; }
  else if (rValue.startsWith('above-average')) eMode = ScConditionMode.AboveAverage;
  else if (rValue.startsWith('below-average')) eMode = ScConditionMode.BelowAverage;
  else if (rValue.startsWith('above-equal-average')) eMode = ScConditionMode.AboveEqualAverage;
  else if (rValue.startsWith('below-equal-average')) eMode = ScConditionMode.BelowEqualAverage;
  else if (rValue.startsWith('is-error')) eMode = ScConditionMode.Error;
  else if (rValue.startsWith('is-no-error')) eMode = ScConditionMode.NoError;
  else if (rValue.startsWith('begins-with')) { eMode = ScConditionMode.BeginsWith; one(12); }
  else if (rValue.startsWith('ends-with')) { eMode = ScConditionMode.EndsWith; one(10); }
  else if (rValue.startsWith('contains-text')) { eMode = ScConditionMode.ContainsText; one(14); }
  else if (rValue.startsWith('not-contains-text')) { eMode = ScConditionMode.NotContainsText; one(18); }
  else eMode = ScConditionMode.NONE;
  return { eMode, rExpr1, rExpr2 };
}

/** Read the calcext:conditional-formats of a sheet into its list, with the keys on the cells
    (ScXMLConditionalFormatsContext). Call once the sheets and the styles exist. */
export function ImportConditionalFormats(rDoc: ScDocument, e: XmlElement, nTab: SCTAB, lost: Set<string>, ProgrammaticToDisplayName: (s: string) => string): void {
  for (const f of childElements(e)) {
    if (f.name !== 'calcext:conditional-format') continue;
    const aRanges = new ScRangeList();
    for (const r of ScRangeStringConverter.GetRangeListFromString(f.attrs.get('calcext:target-range-address') ?? '', rDoc)) aRanges.push_back(r);
    if (aRanges.empty()) continue;
    const pFormat = new ScConditionalFormat(0, rDoc);
    for (const k of childElements(f)) {
      if (k.name !== 'calcext:condition') {
        // calcext:color-scale, calcext:data-bar, calcext:icon-set, calcext:date-is
        lost.add('Colour scales, data bars, icon sets and date conditions');
        continue;
      }
      const sExpression = k.attrs.get('calcext:value') ?? '';
      const sStyle = ProgrammaticToDisplayName(k.attrs.get('calcext:apply-style-name') ?? '');
      const sAddress = k.attrs.get('calcext:base-cell-address') ?? '';
      const { eMode, rExpr1, rExpr2 } = GetConditionData(sExpression);
      if (eMode === ScConditionMode.NONE) { lost.add('Conditional formatting'); continue; }
      const aSrcPos = ScRangeStringConverter.GetAddressFromString(sAddress, rDoc) ?? aRanges.front().aStart.clone();
      pFormat.AddEntry(new ScCondFormatEntry(eMode, rExpr1, rExpr2, rDoc, aSrcPos, sStyle, FormulaGrammar.GRAM_ODFF, FormulaGrammar.GRAM_ODFF));
    }
    if (pFormat.IsEmpty()) continue;
    pFormat.SetRange(aRanges);
    const nIndex = rDoc.AddCondFormat(pFormat, nTab);
    rDoc.AddCondFormatData(aRanges, nTab, nIndex);
  }
}

/** The calcext:conditional-formats of a sheet (ScXMLExport::ExportConditionalFormat), '' without. */
export function ExportConditionalFormat(rDoc: ScDocument, nTab: SCTAB, EncodeStyleName: (s: string) => string): string {
  const pCondFormatList = rDoc.GetCondFormList(nTab);
  if (!pCondFormatList || !pCondFormatList.size()) return '';
  let s = '<calcext:conditional-formats>';
  for (const rxCondFormat of pCondFormatList) {
    const sRanges = ScRangeStringConverter.GetStringFromRangeList([...rxCondFormat.GetRange()], rDoc);
    s += `<calcext:conditional-format calcext:target-range-address="${escapeXml(sRanges)}">`;
    for (let i = 0; i < rxCondFormat.size(); ++i) {
      const pEntry = rxCondFormat.GetEntry(i)!;
      const aPos = pEntry.GetSrcPos();
      const x = (n: 0 | 1) => pEntry.GetExpression(aPos, n, FormulaGrammar.GRAM_ODFF);
      let aCond = '';
      switch (pEntry.GetOperation()) {
        case ScConditionMode.Equal: aCond = '=' + x(0); break;
        case ScConditionMode.Less: aCond = '<' + x(0); break;
        case ScConditionMode.Greater: aCond = '>' + x(0); break;
        case ScConditionMode.EqLess: aCond = '<=' + x(0); break;
        case ScConditionMode.EqGreater: aCond = '>=' + x(0); break;
        case ScConditionMode.NotEqual: aCond = '!=' + x(0); break;
        case ScConditionMode.Between: aCond = `between(${x(0)},${x(1)})`; break;
        case ScConditionMode.NotBetween: aCond = `not-between(${x(0)},${x(1)})`; break;
        case ScConditionMode.Duplicate: aCond = 'duplicate'; break;
        case ScConditionMode.NotDuplicate: aCond = 'unique'; break;
        case ScConditionMode.Direct: aCond = `formula-is(${x(0)})`; break;
        case ScConditionMode.Top10: aCond = `top-elements(${x(0)})`; break;
        case ScConditionMode.Bottom10: aCond = `bottom-elements(${x(0)})`; break;
        case ScConditionMode.TopPercent: aCond = `top-percent(${x(0)})`; break;
        case ScConditionMode.BottomPercent: aCond = `bottom-percent(${x(0)})`; break;
        case ScConditionMode.AboveAverage: aCond = 'above-average'; break;
        case ScConditionMode.BelowAverage: aCond = 'below-average'; break;
        case ScConditionMode.AboveEqualAverage: aCond = 'above-equal-average'; break;
        case ScConditionMode.BelowEqualAverage: aCond = 'below-equal-average'; break;
        case ScConditionMode.Error: aCond = 'is-error'; break;
        case ScConditionMode.NoError: aCond = 'is-no-error'; break;
        case ScConditionMode.BeginsWith: aCond = `begins-with(${x(0)})`; break;
        case ScConditionMode.EndsWith: aCond = `ends-with(${x(0)})`; break;
        case ScConditionMode.ContainsText: aCond = `contains-text(${x(0)})`; break;
        case ScConditionMode.NotContainsText: aCond = `not-contains-text(${x(0)})`; break;
        default: continue; // unimplemented conditional format export
      }
      s += `<calcext:condition calcext:apply-style-name="${escapeXml(EncodeStyleName(pEntry.GetStyle()))}" calcext:value="${escapeXml(aCond)}" calcext:base-cell-address="${escapeXml(ScRangeStringConverter.GetStringFromAddress(aPos, rDoc))}"/>`;
    }
    s += '</calcext:conditional-format>';
  }
  return s + '</calcext:conditional-formats>';
}
