// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/fields/expfld.cxx reduced
// @upstream sw/source/core/doc/DocumentFieldsManager.cxx reduced
// Number range fields (SwSetExpField with nsSwGetSetExpType::GST_SEQ), reduced: a field counts the
// fields of its type before it in document order (the body first, then the other areas), as
// SwSetExpFieldType::SetSeqRefNo and SwDocUpdateField number them: by its formula (name+1 when it
// has none), calculated with the number ranges' current numbers; chapter numbering (SetOutlineLvl)
// is not ported.
// Variables (SwSetExpField of strings and expressions, SwGetExpField, formulas, user fields and
// input fields), reduced: the values are calculated in one pass over the body in document order
// (UpdateExpFieldsImpl) instead of being kept in the fields; fields in headers and footers show
// the values at their page's first (header) or last (footer) body paragraph, those in footnotes
// and frames the values at the end of the document. A variable's number format is a format code.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwField } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { SwCalc } from '../bastyp/calc.ts';
import { GetLocaleNotation } from '../../../../svl/source/numbers/zformat.ts';
import { ExpandUserField, ExpandValue, SwUserType, type SwUserFieldType } from './usrfld.ts';
import { NumberingType, makeNumberingString } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';

/** The number of each sequence field of the document. */
export function GetSeqNumbers(doc: SwDoc): Map<SwField, number> {
  const out = new Map<SwField, number>();
  const counts = new Map<string, number>();
  const nodes = doc.GetNodes();
  const body = nodes.BodyStart();
  const visit = (i: number) => {
    const n = nodes.node(i);
    if (!n.IsTextNode()) return;
    for (const h of n.m_aHints) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (f?.type !== 'Sequence') continue;
      let k = (counts.get(f.name ?? '') ?? 0) + 1;
      if (f.formula) {
        // UpdateExpFieldsImpl: name=formula with the number ranges' values.
        const aCalc = new SwCalc();
        for (const [name, v] of counts) aCalc.VarChange(name, v);
        const v = aCalc.Calculate(`${f.name ?? ''}=${f.formula}`);
        if (!aCalc.IsCalcError()) k = Math.trunc(v);
      }
      counts.set(f.name ?? '', k);
      out.set(f, k);
    }
  };
  for (let i = body; i < nodes.Count(); i++) visit(i);
  for (let i = 0; i < body; i++) visit(i);
  return out;
}

/** SwSetExpField::ExpandImpl for a number range: the number in the field's numbering type. */
export function ExpandSeq(f: SwField, n: number): string {
  return makeNumberingString((f.numType ?? NumberingType.ARABIC) as NumberingType, n);
}

// --- Variables: SwSetExpField, SwGetExpField (and DocumentFieldsManager::UpdateExpFieldsImpl) ---

/** SwGetSetExpType (fldbas.hxx) */
export const SwGetSetExpType = {
  None: 0x0000, String: 0x0001, Expr: 0x0002, Sequence: 0x0008, Formula: 0x0010, LowerMask: 0x001f, UpperMask: 0x0300, Command: 0x0100, Invisible: 0x0200,
} as const;

/** SwInputFieldSubType (fldbas.hxx) */
export const SwInputFieldSubType = { None: 0x0000, Text: 0x0001, User: 0x0002, Var: 0x0003, LowerMask: 0x0003, UpperMask: 0x0200, Invisible: 0x0200 } as const;

/** SwSetExpFieldType of a variable: its name and whether it holds a string or an expression. */
export class SwSetExpFieldType {
  m_sName: string;
  /** SwGetSetExpType String or Expr. */
  m_nType: number;
  constructor(sName: string, nType: number = SwGetSetExpType.Expr) { this.m_sName = sName; this.m_nType = nType; }
  GetName(): string { return this.m_sName; }
  GetType(): number { return this.m_nType; }
  SetType(nTyp: number): void { this.m_nType = nTyp; }
}

/** The language of a paragraph's text, which its fields are formatted in (SwField::GetLanguage). */
export function GetFieldLanguage(node: SwTextNode): string {
  return (node.GetAttr('RES_CHRATR_LANGUAGE') as string | undefined) || 'en-US';
}

/** SwSbxValue::GetDouble of a string: its number, else 0. */
function StringToDouble(s: string): number {
  const v = Number.parseFloat(s.trim());
  return Number.isFinite(v) ? v : 0;
}

/** LookString: the text of a name in the table of strings (ignoring case as the calculator does). */
function LookString(rTable: Map<string, string>, rName: string): string {
  return rTable.get(rName.trim().toLowerCase()) ?? '';
}

/** What the variables are at a position: the strings and the calculator's values. */
export interface SwExpFieldState { aHashStrTable: Map<string, string>; aCalc: SwCalc }

/** One value set in document order: by a variable field or a number range field. */
interface SwSetStep { nNode: number; nPos: number; name: string; str: string | null; value: number }

/**
 * The variables of a document after DocumentFieldsManager::UpdateExpFieldsImpl: each body field's
 * text, and the values set in document order, to expand fields outside the body at a position.
 */
export class SwExpFields {
  m_aTexts = new Map<SwField, string>();
  /** The value of each field of an expression (SwValueField::GetValue), for the file formats. */
  m_aValues = new Map<SwField, number>();
  m_aSteps: SwSetStep[] = [];
  private m_rDoc: SwDoc;
  constructor(rDoc: SwDoc) { this.m_rDoc = rDoc; }

  /** A calculator with the document's user fields and statistics names, and the table of strings with the user fields. */
  NewState(): SwExpFieldState {
    const doc = this.m_rDoc;
    const n = GetLocaleNotation(GetDocLanguage(doc));
    const aCalc = new SwCalc(n.decimal, n.group);
    const aHashStrTable = new Map<string, string>();
    const lang = GetDocLanguage(doc);
    aCalc.m_fnVarLook = (rName) => {
      const pType = FindUserFieldType(doc, rName);
      if (!pType) return undefined;
      if (pType.GetType() & SwUserType.String) return StringToDouble(pType.GetContent());
      return pType.GetValue(aCalc);
    };
    for (const pType of doc.m_aUserFieldTypes.values()) aHashStrTable.set(pType.GetName().toLowerCase(), pType.Expand(undefined, SwUserType.None, lang));
    return { aHashStrTable, aCalc };
  }

  /** Applies one value set to a state. */
  private static Apply(st: SwExpFieldState, s: SwSetStep): void {
    if (s.str !== null) st.aHashStrTable.set(s.name.toLowerCase(), s.str);
    st.aCalc.VarChange(s.name, s.value);
  }

  /** DocumentFieldsManager::FieldsToExpand: the variables as they are before a body position. */
  StateAt(nNode: number, nPos: number): SwExpFieldState {
    const st = this.NewState();
    for (const s of this.m_aSteps) {
      if (s.nNode > nNode || (s.nNode === nNode && s.nPos >= nPos)) break;
      SwExpFields.Apply(st, s);
    }
    return st;
  }

  /** The variables at the end of the document. */
  StateAtEnd(): SwExpFieldState { return this.StateAt(Infinity, 0); }

  /**
   * SwGetExpField::ChangeExpansion and the expansion of the other fields of variables outside the
   * body, in the state of a body position.
   */
  ExpandIn(f: SwField, st: SwExpFieldState, nLng: string): string {
    const doc = this.m_rDoc;
    switch (f.type) {
      case 'GetExp': {
        if ((f.subType ?? 0) & SwGetSetExpType.Command) return f.formula ?? '';
        if ((f.subType ?? 0) & SwGetSetExpType.String) return LookString(st.aHashStrTable, f.formula ?? '');
        const v = st.aCalc.Calculate(f.formula ?? '');
        return ExpandValue(st.aCalc.IsCalcError() ? NaN : v, f.numFormat, nLng);
      }
      case 'SetExp': {
        const pType = doc.m_aSetExpFieldTypes.get(f.name ?? '');
        let s: string;
        if (pType && pType.GetType() & SwGetSetExpType.String) s = LookString(st.aHashStrTable, f.formula ?? '') || (f.formula ?? '');
        else {
          const v = st.aCalc.Calculate(`${f.name ?? ''}=${f.formula ?? ''}`);
          s = ExpandValue(st.aCalc.IsCalcError() ? NaN : v, f.numFormat, nLng);
        }
        return ExpandSetExp(f, s);
      }
      default: return this.m_aTexts.get(f) ?? '';
    }
  }
}

/** The document's language: the default character language (SwCalc::GetDocAppScriptLang). */
export function GetDocLanguage(doc: SwDoc): string {
  return (doc.m_aDefaults.RES_CHRATR_LANGUAGE as string | undefined) || 'en-US';
}

/** SwDoc's user field type of a name, ignoring case as the calculator's names do. */
export function FindUserFieldType(doc: SwDoc, rName: string): SwUserFieldType | undefined {
  const exact = doc.m_aUserFieldTypes.get(rName);
  if (exact) return exact;
  const lower = rName.toLowerCase();
  for (const t of doc.m_aUserFieldTypes.values()) if (t.GetName().toLowerCase() === lower) return t;
  return undefined;
}

/** SwSetExpField::ExpandImpl: the command (name = formula), nothing when invisible, else the value's text. */
export function ExpandSetExp(f: SwField, sExpand: string): string {
  const nSub = f.subType ?? 0;
  if (nSub & SwGetSetExpType.Command) return `${f.name ?? ''} = ${f.formula ?? ''}`;
  if (!(nSub & SwGetSetExpType.Invisible)) return sExpand;
  return '';
}

/**
 * DocumentFieldsManager::UpdateExpFieldsImpl, reduced to the fields of variables: the user fields,
 * then the body's fields in document order, setting (SwSetExpField, an input field of a variable,
 * a number range) and showing (SwGetExpField, a formula) variables. Fields outside the body show
 * the values at the end of the document unless the layout expands them at their page
 * (SwExpFields.ExpandIn); conditions of sections, hidden texts and paragraphs and database fields
 * are not ported.
 */
export function UpdateExpFields(doc: SwDoc, seqNums?: Map<SwField, number>): SwExpFields {
  const out = new SwExpFields(doc);
  // UpdateUsrFields: the user fields are calculated again.
  for (const t of doc.m_aUserFieldTypes.values()) t.m_bValidValue = false;
  const st = out.NewState();
  const nums = seqNums ?? GetSeqNumbers(doc);
  const nodes = doc.GetNodes();
  for (const t of doc.m_aUserFieldTypes.values()) if (t.GetType() & SwUserType.Expr) t.GetValue(st.aCalc);
  const body = nodes.BodyStart();
  for (let i = body; i < nodes.Count(); i++) {
    const n = nodes.node(i);
    if (!n.IsTextNode() || nodes.AreaOf(n) !== nodes.m_pStartOfContent) continue;
    const nLng = GetFieldLanguage(n);
    for (const h of [...n.m_aHints].sort((a, b) => a.nStart - b.nStart)) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (!f) continue;
      const step = (name: string, str: string | null, value: number) => {
        const s = { nNode: i, nPos: h.nStart, name, str, value };
        out.m_aSteps.push(s);
        if (str !== null) st.aHashStrTable.set(name.toLowerCase(), str);
        st.aCalc.VarChange(name, value);
      };
      switch (f.type) {
        case 'GetExp': {
          out.m_aTexts.set(f, out.ExpandIn(f, st, nLng));
          if (!((f.subType ?? 0) & SwGetSetExpType.String)) { const v = st.aCalc.Calculate(f.formula ?? ''); if (!st.aCalc.IsCalcError()) out.m_aValues.set(f, v); }
          break;
        }
        case 'SetExp': {
          const pType = doc.m_aSetExpFieldTypes.get(f.name ?? '');
          if (pType && pType.GetType() & SwGetSetExpType.String) {
            // is the "formula" a field?
            let aNew = LookString(st.aHashStrTable, f.formula ?? '');
            if (!aNew) aNew = f.formula ?? ''; // nothing found then the formula is the new value
            out.m_aTexts.set(f, ExpandSetExp(f, aNew));
            // Extension for calculation with Strings
            step(f.name ?? '', aNew, StringToDouble(aNew));
          } else {
            const v = st.aCalc.Calculate(`${f.name ?? ''}=${f.formula ?? ''}`);
            if (!st.aCalc.IsCalcError()) {
              out.m_aTexts.set(f, ExpandSetExp(f, ExpandValue(v, f.numFormat, nLng)));
              out.m_aValues.set(f, v);
              out.m_aSteps.push({ nNode: i, nPos: h.nStart, name: f.name ?? '', str: null, value: v });
            } else out.m_aTexts.set(f, ExpandSetExp(f, ''));
          }
          break;
        }
        case 'Sequence': step(f.name ?? '', null, nums.get(f) ?? 1); break;
        default: break;
      }
    }
  }
  // The fields outside the body, and the user and input fields: at the end of the document.
  const end = out.StateAtEnd();
  for (let i = 0; i < nodes.Count(); i++) {
    const n = nodes.node(i);
    if (!n.IsTextNode()) continue;
    const bBody = i >= body && nodes.AreaOf(n) === nodes.m_pStartOfContent;
    for (const h of n.m_aHints) {
      const f = h.aAttrs.RES_TXTATR_FIELD;
      if (!f) continue;
      if (!bBody && (f.type === 'GetExp' || f.type === 'SetExp')) out.m_aTexts.set(f, out.ExpandIn(f, end, GetFieldLanguage(n)));
      else if (f.type === 'User') out.m_aTexts.set(f, ExpandUserField(FindUserFieldType(doc, f.name ?? ''), f.subType ?? 0, f.numFormat, GetFieldLanguage(n)));
      else if (f.type === 'Input') out.m_aTexts.set(f, ExpandInput(doc, f));
    }
  }
  return out;
}

/**
 * SwInputField::ExpandImpl: a user field's input field shows the user field's content, a text
 * input field its own.
 */
export function ExpandInput(doc: SwDoc, f: SwField): string {
  if (((f.subType ?? 0) & 0x00ff) === SwInputFieldSubType.User) {
    const pUserTyp = FindUserFieldType(doc, f.content ?? '');
    if (pUserTyp) return pUserTyp.GetContent();
    return '';
  }
  return f.content ?? '';
}
