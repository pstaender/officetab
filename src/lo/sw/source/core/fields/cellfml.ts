// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/fields/cellfml.cxx reduced
// Table formulas (SwTableBoxFormula, SwTableFormula): references to boxes by name, <A1>, ranges
// <A1:B3> and other tables' boxes <Table2.A1>, replaced by the boxes' values before SwCalc
// evaluates the formula (MakeFormula_). Formulas are kept in this external notation (box names)
// rather than upstream's internal one of box pointers, so moving boxes does not update them.
// A box's value (SwTableBox::GetValue): its formula's result, its value, or its text read as a
// number; fields in the box are not evaluated. Ranges take the rectangle of their boxes in the
// model (SwTable::CreateSelection) instead of the layout's.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTableNode } from '../../../inc/node.ts';
import { SearchType, type SwTable, type SwTableBox } from '../../../inc/swtable.ts';
import { SwCalc } from '../bastyp/calc.ts';
import { GetLocaleNotation } from '../../../../svl/source/numbers/zformat.ts';
import { GetType, IsNumberFormat, SvNumFormatType } from '../../../../svl/source/numbers/zforlist.ts';
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';

/** sw_GetTableBoxColStr: A … Z, a … z, then AA … */
export function sw_GetTableBoxColStr(nCol: number): string {
  const coDiff = 52; // 'A'-'Z' 'a' - 'z'
  let rNm = '';
  for (;;) {
    const nCalc = nCol % coDiff;
    rNm = (nCalc >= 26 ? String.fromCharCode(97 - 26 + nCalc) : String.fromCharCode(65 + nCalc)) + rNm;
    nCol -= nCalc;
    if (nCol === 0) break;
    nCol = nCol / coDiff - 1;
  }
  return rNm;
}

/** SwTableBox::GetName: the column (its index in its line) and the row. */
export function GetBoxName(table: SwTable, box: SwTableBox): string {
  return sw_GetTableBoxColStr(box.m_pUpper.m_aBoxes.indexOf(box)) + String(table.m_aLines.indexOf(box.m_pUpper) + 1);
}

/** SwTable::GetTableBox(name) with SwTable::GetBoxNum */
export function GetTableBoxByName(table: SwTable, rName: string): SwTableBox | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(rName.trim());
  if (!m) return null;
  let num = 0, bFirst = true;
  for (const ch of m[1]!) {
    let c = ch.charCodeAt(0) - 65;
    if (c >= 26) c -= 97 - 91; // 'a' - '['
    if (bFirst) bFirst = false; else ++num;
    num = num * 52 + c;
  }
  const nLine = Number(m[2]);
  if (!nLine || nLine > table.m_aLines.length) return null;
  return table.m_aLines[nLine - 1]!.m_aBoxes[num] ?? null;
}

/** The table nodes of a document by name. */
function tableByName(doc: SwDoc, name: string): SwTableNode | null {
  const nodes = doc.GetNodes();
  for (let i = 0; i < nodes.Count(); i++) { const n = nodes.node(i); if (n.IsTableNode() && (n as SwTableNode).m_pTable.m_aAttrs.name === name) return n as SwTableNode; }
  return null;
}

/** The language of a box: its first paragraph's. */
export function BoxLanguage(doc: SwDoc, box: SwTableBox): string {
  const n = doc.GetNodes().GoNext(box.m_pStartNode!.GetIndex());
  return n?.GetAttr('RES_CHRATR_LANGUAGE') || 'en-US';
}

/** The text of a box's first paragraph without leading and trailing blanks and tabs (IsValidNumTextNd, lcl_TabToBlankAtSttEnd). */
export function BoxText(doc: SwDoc, box: SwTableBox): string | null {
  const sn = box.m_pStartNode!, nodes = doc.GetNodes();
  const n = nodes.node(sn.GetIndex() + 1);
  if (!n.IsTextNode() || sn.EndOfSectionNode().GetIndex() !== sn.GetIndex() + 2) return null;
  return n.GetText().replace(/^[\t ]+|[\t ]+$/g, '');
}

/** SwTableCalcPara */
interface SwTableCalcPara { m_rCalc: SwCalc; m_pBoxStack: Set<SwTableBox>; nStackCnt: number; bNaN: boolean; doc: SwDoc; lang: string }

/** SwTableBox::GetValue */
export function GetBoxValue(box: SwTableBox, table: SwTable, p: SwTableCalcPara): number {
  let nRet = 0;
  if (p.m_rCalc.IsCalcError() || !box.m_pStartNode) return nRet;
  // Does it create a recursion?
  if (p.m_pBoxStack.has(box) || ++p.nStackCnt > 100) { p.m_rCalc.SetCalcError(); return nRet; }
  p.m_pBoxStack.add(box);
  p.bNaN = false;
  const a = box.m_aAttrs;
  if (a.formula !== undefined) {
    nRet = CalcFormula(p.doc, table, a.formula, p);
  } else if (a.value !== undefined && !(a.numFormat && GetType(a.numFormat, p.lang) === SvNumFormatType.TEXT)) {
    nRet = a.value;
  } else {
    let sText = BoxText(p.doc, box) ?? p.doc.GetNodes().GoNext(box.m_pStartNode.GetIndex())?.GetText().trim() ?? '';
    sText = sText.split(CH_TXTATR_BREAKWORD).join('');
    // JP 22.04.98: Bug 49659 - special treatment for percentages
    const fmt = a.numFormat && GetType(a.numFormat, p.lang) !== SvNumFormatType.TEXT ? a.numFormat : undefined;
    const r = sText ? IsNumberFormat(sText, p.lang, fmt) : null;
    if (r) nRet = r.value;
    else p.bNaN = true; // set for interoperability functions
  }
  p.m_pBoxStack.delete(box);
  p.nStackCnt--;
  return nRet;
}

/** SwCalc::GetStrResult: a value in the notation the formula is read in. */
const StrResult = (f: number, dec: string) => String(Number(f.toPrecision(15))).replace('.', dec);

/**
 * SwTableFormula::Calc with MakeFormula_ and ScanString: the formula's references replaced by
 * values, then calculated; NaN for an error.
 */
export function CalcFormula(doc: SwDoc, table: SwTable, formula: string, p?: SwTableCalcPara, lang = 'en-US'): number {
  const dec = GetLocaleNotation(p?.lang ?? lang).decimal;
  const para: SwTableCalcPara = p ?? { m_rCalc: new SwCalc(dec), m_pBoxStack: new Set(), nStackCnt: 0, bNaN: false, doc, lang };
  const calc = new SwCalc(dec);
  let err = false;
  const upper = formula.toUpperCase();
  const s = formula.replace(/<([^<>]*)>/g, (_m, ref: string) => {
    if (err) return '';
    let t = table, name = ref;
    // A box of another table: <Table2.A1>
    const dot = ref.lastIndexOf('.');
    if (dot > 0) { const tn = tableByName(doc, ref.slice(0, dot)); if (!tn) { err = true; return ''; } t = tn.m_pTable; name = ref.slice(dot + 1); }
    const [a, b] = name.split(':');
    const sttBox = GetTableBoxByName(t, a!), endBox = b ? GetTableBoxByName(t, b) : null;
    if (!sttBox || (b && !endBox)) { err = true; return ''; }
    if (endBox) {
      // get all selected boxes and calculate their values
      const boxes = t.CreateSelection(sttBox.m_pStartNode!, endBox.m_pStartNode!, SearchType.SEARCH_NONE).filter((x) => x.getRowSpan() >= 1);
      // don't use empty cells or cells with text content as zeroes in interoperability functions
      const nUseOnlyNumber = upper.includes('AVERAGE') || upper.includes('COUNT') || upper.includes('PRODUCT');
      const vals: string[] = [];
      for (const box of boxes) {
        const v = GetBoxValue(box, t, para);
        if (para.m_rCalc.IsCalcError()) { err = true; break; }
        if (para.bNaN && nUseOnlyNumber) continue;
        vals.push(StrResult(v, dec));
      }
      return ` (${vals.join('|')}) `;
    }
    if (sttBox.getRowSpan() < 1) return ' () ';
    const v = GetBoxValue(sttBox, t, para);
    if (para.m_rCalc.IsCalcError()) { err = true; return ''; }
    // don't use empty cell or a cell with text content as zero in interoperability functions (except PRODUCT)
    if (para.bNaN && (upper.includes('AVERAGE') || upper.includes('COUNT'))) return ' () ';
    return ` (${StrResult(v, dec)}) `;
  });
  if (err) return NaN;
  const r = calc.Calculate(s);
  return calc.IsCalcError() ? NaN : r;
}

/** SwTableBox::IsFormulaOrValueBox: 'formula', 'value', 'empty' or null (text). */
export function IsFormulaOrValueBox(doc: SwDoc, box: SwTableBox): 'formula' | 'value' | 'empty' | null {
  if (box.m_aAttrs.formula !== undefined) return 'formula';
  if (box.m_aAttrs.value !== undefined) return 'value';
  const t = BoxText(doc, box);
  if (t === '') return 'empty';
  return t && IsNumberFormat(t, BoxLanguage(doc, box)) ? 'value' : null;
}

/**
 * SwFEShell::GetAutoSum with GetAutoSumSel, reduced: the boxes with values (or formulas) above the
 * cursor's box, or else left of it, up to the first box without; blanks next to the cursor are
 * skipped.
 */
export function GetAutoSum(doc: SwDoc, table: SwTable, box: SwTableBox): string {
  const line = table.m_aLines.indexOf(box.m_pUpper);
  const col = box.m_pUpper.m_aBoxes.indexOf(box);
  const collect = (cells: SwTableBox[]): string[] => {
    const out: string[] = [];
    let started = false;
    for (const c of cells) {
      const w = IsFormulaOrValueBox(doc, c);
      if (!started && w === 'empty') continue; // skip space at beginning
      if (w !== 'value' && w !== 'formula') break;
      started = true;
      out.unshift(`<${GetBoxName(table, c)}>`);
    }
    return out;
  };
  // 1. the boxes above, nearest first
  const above: SwTableBox[] = [];
  for (let l = line - 1; l >= 0; l--) { const b = table.m_aLines[l]!.m_aBoxes[col]; if (b) above.push(b); }
  let fields = collect(above);
  // 2. the boxes on the left
  if (!fields.length) fields = collect(box.m_pUpper.m_aBoxes.slice(0, col).reverse());
  return fields.length ? `sum(${fields.join('|')})` : 'sum';
}
