// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/ui/inc/inputhdl.hxx reduced
// @upstream sc/source/ui/app/inputhdl.cxx partial
// @upstream sc/source/ui/inc/rfindlst.hxx reduced
// @upstream sc/source/ui/app/rfindlst.cxx partial
// The model side of ScInputHandler, the cell input's logic: whether the text is a formula, the
// references in a formula with their colours (InitRangeFinder, ScRangeFindList), where a
// reference may be inserted by pointing at cells and the text of that reference (the
// reference input of SetReference), function name completion (UseFormulaData, the function
// list of the input line), the function's argument tip with the current argument
// (ShowArgumentsTip), the column's texts offered while typing (UseColData, AutoInput), and the
// AutoSum range (ScViewFunc::GetAutoSumArea). The edit engine, the input window and the tip
// windows are the web shell's (a DOM editor over the cell and the formula bar); this port works
// on plain text and caret positions.
import { ScAddress, ScAddressDetails, ScRange, ScRefFlags, type SCCOL, type SCROW, type SCTAB } from '../../../inc/address.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { ScFunctionMgr, type ScFuncDesc } from '../../core/data/funcdesc.ts';

/** SC_RANGECOLORS: the colours of the range finder (aColNames, and aDarkColNames on a dark background). */
const aColNames = ['#0000ff', '#ff0000', '#ff00ff', '#008000', '#000080', '#800000', '#800080', '#808000'];
const aDarkColNames = ['#0000ff', '#ff0000', '#ff00ff', '#008000', '#b4c7dc', '#ffa6a6', '#ffb66c', '#afd095'];

export interface ScRangeFindData {
  aRef: ScRange;
  nFlags: ScRefFlags;
  /** The reference's text in the formula: its start and end (exclusive). */
  nSelStart: number;
  nSelEnd: number;
  nColor: string;
}

export class ScRangeFindList {
  readonly maEntries: ScRangeFindData[] = [];
  private nIndexColor = 0;
  static bIsDark = false;

  static GetColorName(nIndex: number): string {
    return ScRangeFindList.bIsDark ? aDarkColNames[nIndex % aDarkColNames.length]! : aColNames[nIndex % aColNames.length]!;
  }

  Insert(rNew: Omit<ScRangeFindData, 'nColor'>): string {
    const it = this.maEntries.find((rEntry) => rEntry.aRef.equals(rNew.aRef));
    const nColor = it ? it.nColor : ScRangeFindList.GetColorName(this.maEntries.length);
    this.maEntries.push({ ...rNew, nColor });
    this.nIndexColor = this.maEntries.length - 1;
    return nColor;
  }

  Count(): number { return this.maEntries.length; }
  GetIndexColor(): number { return this.nIndexColor; }
}

/** ScEditUtil::ModifyDelimiters(" !~%\"\t\n") without ':' and the sheet separator '.' */
const DELIMITERS = ' !~%"\t\n=()+-*/^&<>;,';

/** Whether an input text is a formula: "=…", or "+"/"-" followed by more (ScInputHandler's bFormulaMode). */
export function IsFormulaText(rText: string): boolean {
  return rText.startsWith('=') || ((rText.startsWith('+') || rText.startsWith('-')) && rText.length > 1 && !/^[+-][\d.,\s]*$/.test(rText));
}

/** InitRangeFinder: the references of a formula, each with its text position and colour. */
export function InitRangeFinder(rFormula: string, rDoc: ScDocument, aCursorPos: ScAddress): ScRangeFindList | null {
  if (!IsFormulaText(rFormula)) return null;
  const pChar = rFormula;
  const nLen = rFormula.length;
  let nPos = 0;
  let nStart = 0;
  let nCount = 0;
  // Maximum Ranges in RangeFinder
  const RANGEFIND_MAX = 128;
  const aList = new ScRangeFindList();
  while (nPos < nLen && nCount < RANGEFIND_MAX) {
    // Skip separator
    while (nPos < nLen && DELIMITERS.includes(pChar[nPos]!)) {
      if (pChar[nPos] === '"') {
        // String
        ++nPos;
        while (nPos < nLen && pChar[nPos] !== '"') ++nPos; // Skip until end
      }
      ++nPos; // Separator or closing quote
    }

    // Text between separators.
    nStart = nPos;
    let bSingleQuoted = false;
    while (nPos < nLen) {
      // tdf#114113: handle addresses with quoted sheet names like "'Sheet 1'.A1"
      if (pChar[nPos] === "'") bSingleQuoted = !bSingleQuoted;
      else if (!bSingleQuoted && DELIMITERS.includes(pChar[nPos]!)) break;
      ++nPos;
    }

    if (nPos > nStart) {
      const aTest = rFormula.slice(nStart, nPos);
      const aRange = new ScRange();
      const nFlags = aRange.ParseAny(aTest, rDoc, ScAddressDetails(FormulaGrammar.CONV_OOO, aCursorPos.Row(), aCursorPos.Col()));
      if (nFlags & ScRefFlags.VALID) {
        //  Set tables if not specified
        if ((nFlags & ScRefFlags.TAB_3D) === 0) aRange.aStart.SetTab(aCursorPos.Tab());
        if ((nFlags & ScRefFlags.TAB2_3D) === 0) aRange.aEnd.SetTab(aRange.aStart.Tab());
        aList.Insert({ aRef: aRange, nFlags, nSelStart: nStart, nSelEnd: nPos });
        ++nCount;
      }
    }
  }
  return nCount ? aList : null;
}

/**
 * Whether a reference can be inserted at a caret position of a formula by pointing at cells
 * (ScModule::IsFormulaMode with the cursor after an operator, an opening parenthesis or a
 * separator: the "reference input" the edit engine's selection allows). Also true when the
 * caret is at the end of a reference, which pointing replaces.
 */
export function IsRefInputPosition(rText: string, nCaret: number): boolean {
  if (!IsFormulaText(rText)) return false;
  const before = rText.slice(0, nCaret).replace(/\s+$/, '');
  if (!before.length) return false;
  const c = before[before.length - 1]!;
  if ('=+-*/^&<>(;,:!~%'.includes(c)) return true;
  // the end of a reference just inserted (or typed)
  return GetReferenceAt(rText, nCaret) !== null;
}

/** The reference ending at the caret ("A1", "B2:C3", "Sheet2.A1"), its start and end. */
export function GetReferenceAt(rText: string, nCaret: number): { nStart: number; nEnd: number } | null {
  const m = /(?:(?:'[^']*'|\$?[A-Za-z_][\w ]*?)[.!])?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/.exec(rText.slice(0, nCaret));
  if (!m) return null;
  const nStart = nCaret - m[0].length;
  // not the end of a longer name (a function or a named range)
  if (nStart > 0 && /[\w$]/.test(rText[nStart - 1]!)) return null;
  if (nCaret < rText.length && /[\w$(]/.test(rText[nCaret]!)) return null;
  return { nStart, nEnd: nCaret };
}

/** The text of a reference picked with the mouse (relative, with the sheet when it is another sheet's). */
export function GetRefString(rDoc: ScDocument, rRange: ScRange, nCurTab: SCTAB): string {
  const nFlags = ScRefFlags.VALID | (rRange.aStart.Tab() !== nCurTab ? ScRefFlags.TAB_3D : 0);
  const aStart = rRange.aStart.Format(nFlags, rDoc);
  if (rRange.aStart.equals(rRange.aEnd)) return aStart;
  // An entire column or row is written as A1:A1048576 as Calc does in its native syntax.
  return `${aStart}:${rRange.aEnd.Format(ScRefFlags.VALID, rDoc)}`;
}

/**
 * The identifier before the caret that is the start of a function name (UseFormulaData's
 * aText), and the functions it may stand for: their names, sorted (the function list of the
 * autocompletion, only functions this port implements).
 */
export function UseFormulaData(rText: string, nCaret: number): { aStart: string; nStart: number; aNames: string[] } | null {
  if (!IsFormulaText(rText)) return null;
  const before = rText.slice(0, nCaret);
  // inside a string constant: no completion
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const m = /[A-Za-z][A-Za-z0-9._]*$/.exec(before);
  if (!m) return null;
  const nStart = nCaret - m[0].length;
  if (nStart > 0 && /[\w$.:]/.test(before[nStart - 1]!)) return null;
  const aStart = m[0].toUpperCase();
  const aNames = ScFunctionMgr.Get(true).GetFunctions(0).map((f) => f.getFunctionName()).filter((n) => n.toUpperCase().startsWith(aStart) && n.toUpperCase() !== aStart);
  if (!aNames.length) return null;
  return { aStart: m[0], nStart, aNames };
}

/**
 * ShowArgumentsTip: the function whose arguments the caret is in, and the index of the argument
 * (separators ";" and "," at the function's own parenthesis level).
 */
export function GetFunctionAtCaret(rText: string, nCaret: number): { pDesc: ScFuncDesc; nArg: number } | null {
  if (!IsFormulaText(rText)) return null;
  const s = rText.slice(0, nCaret);
  const stack: { name: string; arg: number }[] = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '(') {
      const m = /([A-Za-z][A-Za-z0-9._]*)\s*$/.exec(s.slice(0, i));
      stack.push({ name: m ? m[1]! : '', arg: 0 });
    } else if (ch === ')') stack.pop();
    else if ((ch === ';' || ch === ',') && stack.length) stack[stack.length - 1]!.arg++;
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const e = stack[k]!;
    if (!e.name) continue;
    const pDesc = ScFunctionMgr.Get().GetByName(e.name);
    if (pDesc) return { pDesc, nArg: e.arg };
    return null;
  }
  return null;
}

/** The argument tip: the signature with the current argument's name (ShowArgumentsTip). */
export function GetArgumentsTip(pDesc: ScFuncDesc, nArg: number): { aSig: string; aParam: string; nParam: number } {
  let nParam = nArg;
  const nCount = pDesc.getParameterCount();
  const nVarStart = pDesc.getVarArgsStart();
  if (nCount > 0 && nParam >= nCount) {
    // repeated arguments (VAR_ARGS): the last ones repeat
    nParam = nVarStart < nCount ? nVarStart + ((nParam - nVarStart) % Math.max(1, nCount - nVarStart)) : nCount - 1;
  }
  return { aSig: pDesc.getSignature().replace(/ /g, ' '), aParam: pDesc.getParameterName(nParam), nParam };
}

/**
 * UseColData (AutoInput): the column's texts that start with what was typed, the closest first
 * (ScDocument::GetDataEntries over the contiguous data of the column), for completing the input.
 */
export function GetAutoInputCompletion(rDoc: ScDocument, nCol: SCCOL, nRow: SCROW, nTab: SCTAB, rText: string): string | null {
  if (!rText || IsFormulaText(rText) || /^[\d.,\-+\s]+$/.test(rText)) return null;
  const pTab = rDoc.FetchTable(nTab);
  const pCol = pTab?.FetchColumn(nCol);
  if (!pCol) return null;
  const lower = rText.toLowerCase();
  // the contiguous data block of the column around the row (GetDataEntries' bLimit)
  let nTop = nRow, nBottom = nRow;
  while (nTop > 0 && rDoc.HasData(nCol, nTop - 1, nTab)) nTop--;
  while (nBottom < rDoc.MaxRow() && rDoc.HasData(nCol, nBottom + 1, nTab)) nBottom++;
  const aEntries = new Set<string>();
  pCol.ForEachCell(nTop, nBottom, (r) => {
    if (r === nRow) return;
    if (!rDoc.HasStringData(nCol, r, nTab)) return;
    aEntries.add(rDoc.GetString(new ScAddress(nCol, r, nTab)));
  });
  const aSorted = [...aEntries].filter((e) => e.length > rText.length && e.toLowerCase().startsWith(lower)).sort((a, b) => a.localeCompare(b));
  return aSorted[0] ?? null;
}

/**
 * ScViewFunc::GetAutoSumArea: the range AutoSum sums for the cursor: the numbers right above
 * it, else those to its left (up to the first gap after numbers).
 */
export function GetAutoSumArea(rDoc: ScDocument, nCol: SCCOL, nRow: SCROW, nTab: SCTAB): ScRange | null {
  const isNum = (c: SCCOL, r: SCROW) => rDoc.HasValueData(c, r, nTab);
  // above
  if (nRow > 0 && isNum(nCol, nRow - 1)) {
    let r = nRow - 1;
    while (r > 0 && isNum(nCol, r - 1)) r--;
    return new ScRange(nCol, r, nTab, nCol, nRow - 1, nTab);
  }
  if (nCol > 0 && isNum(nCol - 1, nRow)) {
    let c = nCol - 1;
    while (c > 0 && isNum(c - 1, nRow)) c--;
    return new ScRange(c, nRow, nTab, nCol - 1, nRow, nTab);
  }
  // above, past empty cells right above (a header row is not summed)
  let r = nRow - 1;
  while (r >= 0 && !rDoc.HasData(nCol, r, nTab)) r--;
  if (r >= 0 && isNum(nCol, r)) {
    const nEnd = r;
    while (r > 0 && isNum(nCol, r - 1)) r--;
    return new ScRange(nCol, r, nTab, nCol, nEnd, nTab);
  }
  return null;
}
