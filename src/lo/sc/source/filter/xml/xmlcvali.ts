// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/xml/xmlcvali.cxx reduced
// @upstream sc/source/filter/xml/XMLConverter.cxx partial
// @upstream sc/source/filter/xml/XMLStylesExportHelper.cxx partial
// Validity in ODF (table:content-validations): the conditions ("of:cell-content-is-whole-number()
// and cell-content-is-between(1,10)", parsed as ScXMLConditionHelper::parseCondition does), the
// help and error messages, read into ScValidationData (ScXMLContentValidationContext) and written
// from them (ScMyValidationsContainer::GetCondition and WriteValidations). Reduced: the error
// macro (table:error-macro) is not supported and reported as lost.
import { childElements, escapeXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { FormulaGrammar } from '../../../../include/formula/grammar.ts';
import { ScAddress } from '../../../inc/address.ts';
import { ScConditionMode } from '../../core/data/conditio.ts';
import type { ScDocument } from '../../core/data/document.ts';
import { ScValidationData, ScValidationMode, ScValidErrorStyle, TableValidationVisibility } from '../../core/data/validat.ts';
import { ScRangeStringConverter } from '../../core/tool/rangeutl.ts';

/** The tokens of a condition (ScXMLConditionToken). */
export const ScXMLConditionToken = {
  XML_COND_INVALID: 0, XML_COND_AND: 1, XML_COND_CELLCONTENT: 2, XML_COND_ISBETWEEN: 3, XML_COND_ISNOTBETWEEN: 4, XML_COND_ISWHOLENUMBER: 5, XML_COND_ISDECIMALNUMBER: 6,
  XML_COND_ISDATE: 7, XML_COND_ISTIME: 8, XML_COND_ISINLIST: 9, XML_COND_TEXTLENGTH: 10, XML_COND_TEXTLENGTH_ISBETWEEN: 11, XML_COND_TEXTLENGTH_ISNOTBETWEEN: 12,
  XML_COND_ISTRUEFORMULA: 13,
} as const;
const T = ScXMLConditionToken;

/** ScXMLConditionParseResult: the token, the validation type and operator it means, the operands. */
export interface ScXMLConditionParseResult {
  meToken: number;
  meValidation: ScValidationMode;
  meOperator: ScConditionMode | null;
  maOperand1: string;
  maOperand2: string;
  mnEndIndex: number;
}

const FUNCS: [string, number, ScValidationMode, number][] = [
  // name, token, validation, number of parameters (-1: none and an operator follows)
  ['cell-content-text-length-is-not-between', T.XML_COND_TEXTLENGTH_ISNOTBETWEEN, ScValidationMode.SC_VALID_TEXTLEN, 2],
  ['cell-content-text-length-is-between', T.XML_COND_TEXTLENGTH_ISBETWEEN, ScValidationMode.SC_VALID_TEXTLEN, 2],
  ['cell-content-text-length', T.XML_COND_TEXTLENGTH, ScValidationMode.SC_VALID_TEXTLEN, -1],
  ['cell-content-is-whole-number', T.XML_COND_ISWHOLENUMBER, ScValidationMode.SC_VALID_WHOLE, 0],
  ['cell-content-is-decimal-number', T.XML_COND_ISDECIMALNUMBER, ScValidationMode.SC_VALID_DECIMAL, 0],
  ['cell-content-is-date', T.XML_COND_ISDATE, ScValidationMode.SC_VALID_DATE, 0],
  ['cell-content-is-time', T.XML_COND_ISTIME, ScValidationMode.SC_VALID_TIME, 0],
  ['cell-content-is-in-list', T.XML_COND_ISINLIST, ScValidationMode.SC_VALID_LIST, 1],
  ['cell-content-is-not-between', T.XML_COND_ISNOTBETWEEN, ScValidationMode.SC_VALID_ANY, 2],
  ['cell-content-is-between', T.XML_COND_ISBETWEEN, ScValidationMode.SC_VALID_ANY, 2],
  ['is-true-formula', T.XML_COND_ISTRUEFORMULA, ScValidationMode.SC_VALID_CUSTOM, 1],
  ['cell-content', T.XML_COND_CELLCONTENT, ScValidationMode.SC_VALID_ANY, -1],
];

const OPERATORS: [string, ScConditionMode][] = [
  ['!=', ScConditionMode.NotEqual], ['<=', ScConditionMode.EqLess], ['>=', ScConditionMode.EqGreater], ['=', ScConditionMode.Equal], ['<', ScConditionMode.Less], ['>', ScConditionMode.Greater],
];

/** The end of a function's parameter list (the index of the closing parenthesis): strings, sheet
    names and nested parentheses skipped; the top-level commas split the parameters. */
function lclSkipExpression(s: string, nStart: number): { nEnd: number; aParams: string[] } {
  let nDepth = 0;
  let i = nStart;
  let nParamStart = nStart;
  const aParams: string[] = [];
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"' || ch === '\'') {
      const q = ch;
      i++;
      while (i < s.length && !(s[i] === q && s[i + 1] !== q)) i += s[i] === q ? 2 : 1;
    } else if (ch === '(' || ch === '[') nDepth++;
    else if (ch === ')' || ch === ']') {
      if (nDepth === 0) {
        aParams.push(s.slice(nParamStart, i).trim());
        return { nEnd: i, aParams };
      }
      nDepth--;
    } else if (ch === ',' && nDepth === 0) {
      aParams.push(s.slice(nParamStart, i).trim());
      nParamStart = i + 1;
    }
    i++;
  }
  aParams.push(s.slice(nParamStart).trim());
  return { nEnd: s.length, aParams };
}

/** The next token of a condition from nStartIndex (ScXMLConditionHelper::parseCondition). */
export function parseCondition(rParseResult: ScXMLConditionParseResult, rAttribute: string, nStartIndex: number): void {
  rParseResult.meToken = T.XML_COND_INVALID;
  let i = nStartIndex;
  while (i < rAttribute.length && rAttribute[i] === ' ') i++;
  if (i >= rAttribute.length) return;

  if (rAttribute.startsWith('and', i) && /[\s(]/.test(rAttribute[i + 3] ?? ' ')) {
    rParseResult.meToken = T.XML_COND_AND;
    rParseResult.mnEndIndex = i + 3;
    return;
  }

  for (const [name, eToken, eValidation, nParams] of FUNCS) {
    if (!rAttribute.startsWith(name, i)) continue;
    let j = i + name.length;
    while (rAttribute[j] === ' ') j++;
    if (rAttribute[j] !== '(') continue;
    const r = lclSkipExpression(rAttribute, j + 1);
    rParseResult.meToken = eToken;
    rParseResult.meValidation = eValidation;
    j = r.nEnd + 1;
    if (nParams === -1) {
      // an operator and an expression follow
      while (rAttribute[j] === ' ') j++;
      const op = OPERATORS.find(([o]) => rAttribute.startsWith(o, j));
      if (!op) {
        rParseResult.meToken = T.XML_COND_INVALID;
        return;
      }
      rParseResult.meOperator = op[1];
      j += op[0].length;
      // the expression: up to a top-level ' and ' or the end
      const rest = rAttribute.slice(j);
      const m = /\s+and\s+/.exec(rest);
      rParseResult.maOperand1 = (m ? rest.slice(0, m.index) : rest).trim();
      rParseResult.maOperand2 = '';
      rParseResult.mnEndIndex = m ? j + m.index : rAttribute.length;
      return;
    }
    if (nParams === 2) {
      rParseResult.meOperator = eToken === T.XML_COND_ISNOTBETWEEN || eToken === T.XML_COND_TEXTLENGTH_ISNOTBETWEEN ? ScConditionMode.NotBetween : ScConditionMode.Between;
      rParseResult.maOperand1 = r.aParams[0] ?? '';
      rParseResult.maOperand2 = r.aParams[1] ?? '';
    } else if (nParams === 1) {
      rParseResult.meOperator = eToken === T.XML_COND_ISTRUEFORMULA ? ScConditionMode.Direct : ScConditionMode.Equal;
      rParseResult.maOperand1 = r.aParams.join(',');
      rParseResult.maOperand2 = '';
    }
    rParseResult.mnEndIndex = j;
    return;
  }
}

/** The grammar of a namespace prefix (ExtractFormulaNamespaceGrammar, reduced to of: and oooc:). */
function ExtractNamespace(s: string): { aCondition: string; eGrammar: FormulaGrammar.Grammar } {
  if (s.startsWith('of:')) return { aCondition: s.slice(3), eGrammar: FormulaGrammar.GRAM_ODFF };
  if (s.startsWith('oooc:')) return { aCondition: s.slice(5), eGrammar: FormulaGrammar.GRAM_PODF };
  return { aCondition: s, eGrammar: FormulaGrammar.GRAM_ODFF };
}

/** The validation of a table:content-validation (ScXMLContentValidationContext). */
function ImportValidation(rDoc: ScDocument, e: XmlElement, lost: Set<string>): ScValidationData {
  const sCondition = e.attrs.get('table:condition') ?? '';
  const aBase = ScRangeStringConverter.GetAddressFromString(e.attrs.get('table:base-cell-address') ?? '', rDoc) ?? new ScAddress();

  // GetCondition
  let eValidationType: ScValidationMode = ScValidationMode.SC_VALID_ANY; // default if no condition is given
  let eOperator: ScConditionMode | null = null;
  const aParseResult: ScXMLConditionParseResult = { meToken: T.XML_COND_INVALID, meValidation: ScValidationMode.SC_VALID_ANY, meOperator: null, maOperand1: '', maOperand2: '', mnEndIndex: 0 };
  let eGrammar: FormulaGrammar.Grammar = FormulaGrammar.GRAM_ODFF;
  if (sCondition) {
    // extract leading namespace from condition string
    const r = ExtractNamespace(sCondition);
    const aCondition = r.aCondition;
    eGrammar = r.eGrammar;
    parseCondition(aParseResult, aCondition, 0);
    let bSecondaryPart = false;
    switch (aParseResult.meToken) {
      case T.XML_COND_TEXTLENGTH: // condition is 'cell-content-text-length()<operator><expression>'
      case T.XML_COND_TEXTLENGTH_ISBETWEEN: // condition is 'cell-content-text-length-is-between(<expression1>,<expression2>)'
      case T.XML_COND_TEXTLENGTH_ISNOTBETWEEN: // condition is 'cell-content-text-length-is-not-between(<expression1>,<expression2>)'
      case T.XML_COND_ISINLIST: // condition is 'cell-content-is-in-list(<expression>)'
      case T.XML_COND_ISTRUEFORMULA: // condition is 'is-true-formula(<expression>)'
        eValidationType = aParseResult.meValidation;
        eOperator = aParseResult.meOperator;
        break;
      case T.XML_COND_ISWHOLENUMBER: // condition is 'cell-content-is-whole-number() and <condition>'
      case T.XML_COND_ISDECIMALNUMBER: // condition is 'cell-content-is-decimal-number() and <condition>'
      case T.XML_COND_ISDATE: // condition is 'cell-content-is-date() and <condition>'
      case T.XML_COND_ISTIME: // condition is 'cell-content-is-time() and <condition>'
        eValidationType = aParseResult.meValidation;
        bSecondaryPart = true;
        break;
      default: // unacceptable or unknown condition
    }

    /*  Parse the following 'and <condition>' part of some conditions. This
        updates the members of aParseResult that will contain the operands
        and comparison operator then. */
    if (bSecondaryPart) {
      parseCondition(aParseResult, aCondition, aParseResult.mnEndIndex);
      if (aParseResult.meToken === T.XML_COND_AND) {
        parseCondition(aParseResult, aCondition, aParseResult.mnEndIndex);
        switch (aParseResult.meToken as number) {
          case T.XML_COND_CELLCONTENT: // condition is 'and cell-content()<operator><expression>'
          case T.XML_COND_ISBETWEEN: // condition is 'and cell-content-is-between(<expression1>,<expression2>)'
          case T.XML_COND_ISNOTBETWEEN: // condition is 'and cell-content-is-not-between(<expression1>,<expression2>)'
            eOperator = aParseResult.meOperator;
            break;
          default: // unacceptable or unknown condition
        }
      }
    }

    // a validation type (date, integer) without a condition isn't possible
    if (eOperator === null) eValidationType = ScValidationMode.SC_VALID_ANY;
  }

  const bAny = eValidationType === ScValidationMode.SC_VALID_ANY;
  const pData = new ScValidationData(eValidationType, eOperator ?? ScConditionMode.Equal, bAny ? '' : aParseResult.maOperand1, bAny ? '' : aParseResult.maOperand2, rDoc, aBase, eGrammar, eGrammar);
  pData.SetIgnoreBlank(e.attrs.get('table:allow-empty-cell') !== 'false');
  pData.SetCaseSensitive(e.attrs.get('table:case-sensitive') === 'true');
  const sList = e.attrs.get('table:display-list');
  pData.SetListType(sList === 'no' || sList === 'none' ? TableValidationVisibility.INVISIBLE : sList === 'sort-ascending' ? TableValidationVisibility.SORTEDASCENDING : TableValidationVisibility.UNSORTED);

  const text = (m: XmlElement) => childElements(m).filter((p) => p.name === 'text:p').map((p) => textOf(p)).join('\n');
  for (const k of childElements(e)) {
    if (k.name === 'table:help-message') {
      const sTitle = k.attrs.get('table:title') ?? '';
      if (k.attrs.get('table:display') !== 'false') pData.SetInput(sTitle, text(k));
      else {
        pData.SetInput(sTitle, text(k));
        pData.ResetInput();
      }
    } else if (k.name === 'table:error-message') {
      const sType = k.attrs.get('table:message-type') ?? 'stop';
      const eStyle = sType === 'warning' ? ScValidErrorStyle.SC_VALERR_WARNING : sType === 'information' ? ScValidErrorStyle.SC_VALERR_INFO : ScValidErrorStyle.SC_VALERR_STOP;
      pData.SetError(k.attrs.get('table:title') ?? '', text(k), eStyle);
      if (k.attrs.get('table:display') === 'false') pData.ResetError();
    } else if (k.name === 'table:error-macro') lost.add('Validity error macros');
  }
  return pData;
}

function textOf(e: XmlElement): string {
  let s = '';
  for (const c of e.children) {
    if (typeof c === 'string') s += c;
    else if (c.name === 'text:s') s += ' '.repeat(Number(c.attrs.get('text:c') ?? 1));
    else if (c.name === 'text:tab') s += '\t';
    else if (c.name === 'text:line-break') s += '\n';
    else s += textOf(c);
  }
  return s;
}

/** The validations of table:content-validations by name; each added to the document's list,
    giving the key the cells get. */
export function ImportValidations(rDoc: ScDocument, e: XmlElement, lost: Set<string>): Map<string, number> {
  const aKeys = new Map<string, number>();
  for (const k of childElements(e)) {
    if (k.name !== 'table:content-validation') continue;
    const sName = k.attrs.get('table:name');
    if (!sName) continue;
    const pData = ImportValidation(rDoc, k, lost);
    aKeys.set(sName, rDoc.AddValidationEntry(pData));
  }
  return aKeys;
}

// --- export (ScMyValidationsContainer) ---

/** The name a validation is written with. */
export function ValidationName(nKey: number): string { return `val${nKey}`; }

/** The table:condition of a validation (GetCondition). */
function GetCondition(rDoc: ScDocument, pData: ScValidationData): string {
  const eType = pData.GetDataMode();
  const eOp = pData.GetOperation();
  const aBase = pData.GetSrcPos();
  const f1 = pData.GetExpression(aBase, 0, FormulaGrammar.GRAM_ODFF);
  const f2 = pData.HasSecondExpression() ? pData.GetExpression(aBase, 1, FormulaGrammar.GRAM_ODFF) : '';
  const bBetween = eOp === ScConditionMode.Between || eOp === ScConditionMode.NotBetween;
  let sCondition = '';
  if (eType !== ScValidationMode.SC_VALID_ANY) {
    switch (eType) {
      case ScValidationMode.SC_VALID_DATE: sCondition += 'cell-content-is-date()'; break;
      case ScValidationMode.SC_VALID_DECIMAL: sCondition += 'cell-content-is-decimal-number()'; break;
      case ScValidationMode.SC_VALID_LIST: sCondition += `cell-content-is-in-list(${f1})`; break;
      case ScValidationMode.SC_VALID_TEXTLEN: if (!bBetween) sCondition += 'cell-content-text-length()'; break;
      case ScValidationMode.SC_VALID_TIME: sCondition += 'cell-content-is-time()'; break;
      case ScValidationMode.SC_VALID_WHOLE: sCondition += 'cell-content-is-whole-number()'; break;
      case ScValidationMode.SC_VALID_CUSTOM: sCondition += `is-true-formula(${f1})`; break;
      default:
    }
    if (eType !== ScValidationMode.SC_VALID_LIST && eType !== ScValidationMode.SC_VALID_CUSTOM && (f1 || (bBetween && f2))) {
      if (eType !== ScValidationMode.SC_VALID_TEXTLEN) sCondition += ' and ';
      if (!bBetween) {
        if (eType !== ScValidationMode.SC_VALID_TEXTLEN) sCondition += 'cell-content()';
        switch (eOp) {
          case ScConditionMode.Equal: sCondition += '='; break;
          case ScConditionMode.Greater: sCondition += '>'; break;
          case ScConditionMode.EqGreater: sCondition += '>='; break;
          case ScConditionMode.Less: sCondition += '<'; break;
          case ScConditionMode.EqLess: sCondition += '<='; break;
          case ScConditionMode.NotEqual: sCondition += '!='; break;
          default:
        }
        sCondition += f1;
      } else {
        if (eType === ScValidationMode.SC_VALID_TEXTLEN) sCondition += eOp === ScConditionMode.Between ? 'cell-content-text-length-is-between(' : 'cell-content-text-length-is-not-between(';
        else sCondition += eOp === ScConditionMode.Between ? 'cell-content-is-between(' : 'cell-content-is-not-between(';
        sCondition += `${f1},${f2})`;
      }
    } else if (eType === ScValidationMode.SC_VALID_TEXTLEN) sCondition = '';
  }
  return sCondition ? `of:${sCondition}` : '';
}

/** A help or error message (WriteMessage). */
function WriteMessage(sElement: string, sTitle: string, sOUMessage: string, bShowMessage: boolean, sExtraAttrs = ''): string {
  let attrs = sExtraAttrs;
  if (sTitle) attrs += ` table:title="${escapeXml(sTitle)}"`;
  attrs += ` table:display="${bShowMessage}"`;
  const paras = sOUMessage ? sOUMessage.replace(/\r\n?/g, '\n').split('\n').map((l) => `<text:p>${escapeXml(l)}</text:p>`).join('') : '';
  return `<${sElement}${attrs}>${paras}</${sElement}>`;
}

/** The table:content-validations element (WriteValidations), '' without validations. */
export function ExportValidations(rDoc: ScDocument): string {
  const pList = rDoc.GetValidationList();
  if (!pList || pList.empty()) return '';
  let s = '';
  for (const pData of pList) {
    let attrs = ` table:name="${ValidationName(pData.GetKey())}"`;
    const sCondition = GetCondition(rDoc, pData);
    if (sCondition) {
      attrs += ` table:condition="${escapeXml(sCondition)}" table:allow-empty-cell="${pData.IsIgnoreBlank()}"`;
      // Validation Case Sensitive
      if (pData.IsCaseSensitive()) attrs += ' table:case-sensitive="true"';
      if (pData.GetDataMode() === ScValidationMode.SC_VALID_LIST) {
        switch (pData.GetListType()) {
          case TableValidationVisibility.INVISIBLE: attrs += ' table:display-list="no"'; break;
          case TableValidationVisibility.UNSORTED: attrs += ' table:display-list="unsorted"'; break;
          case TableValidationVisibility.SORTEDASCENDING: attrs += ' table:display-list="sort-ascending"'; break;
          default:
        }
      }
    }
    attrs += ` table:base-cell-address="${escapeXml(ScRangeStringConverter.GetStringFromAddress(pData.GetSrcPos(), rDoc))}"`;
    let inner = '';
    const inp = pData.GetInput();
    if (inp.bShow || inp.aMsg || inp.aTitle) inner += WriteMessage('table:help-message', inp.aTitle, inp.aMsg, inp.bShow);
    const err = pData.GetErrMsg();
    if (err.bShow || err.aMsg || err.aTitle) {
      const sType = err.eStyle === ScValidErrorStyle.SC_VALERR_INFO ? 'information' : err.eStyle === ScValidErrorStyle.SC_VALERR_WARNING ? 'warning' : 'stop';
      inner += WriteMessage('table:error-message', err.aTitle, err.aMsg, err.bShow, ` table:message-type="${sType}"`);
    }
    s += `<table:content-validation${attrs}>${inner}</table:content-validation>`;
  }
  return `<table:content-validations>${s}</table:content-validations>`;
}
