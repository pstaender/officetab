// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/fldui/fldmgr.cxx partial
// SwFieldMgr for the Variables page of the Fields dialog: the types of the group (GetSubTypes)
// and InsertField for variables, formulas, input fields, number ranges, page variables and user
// fields. DDE fields are not ported (a browser has no DDE), nor is a formula inserted in a table
// (FN_NUMBER_FORMAT and the box formula; Table > Formula does that). The input field's dialog
// (StartInputFieldDlg) is the caller's. A user field type made by inserting its first field takes
// the kind (text or expression) of the field's format, as the page's New button would set it.
import type { SwField } from '../../../inc/hintids.ts';
import { CAPTION_CATEGORIES } from '../../../inc/doc.ts';
import { GetSeqCategories } from '../../core/fields/reffld.ts';
import { SwGetSetExpType, SwInputFieldSubType, SwSetExpFieldType } from '../../core/fields/expfld.ts';
import { SwUserFieldType, SwUserType } from '../../core/fields/usrfld.ts';
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';

/** SwFieldTypesEnum, the members of the Variables group (GRP_VAR) in the order of aSwFields. */
export const SwFieldTypesEnum = { Set: 'Set', Get: 'Get', DDE: 'DDE', Formel: 'Formel', Input: 'Input', Sequence: 'Sequence', SetRefPage: 'SetRefPage', GetRefPage: 'GetRefPage', User: 'User' } as const;
export type SwFieldTypesEnum = (typeof SwFieldTypesEnum)[keyof typeof SwFieldTypesEnum];

/** SwInsertField_Data, reduced: the format is a number format's code or a numbering type. */
export interface SwInsertField_Data {
  m_nTypeId: SwFieldTypesEnum;
  m_nSubType: number;
  m_sPar1: string;
  m_sPar2: string;
  /** A number format's code (for variables, formulas and user fields), undefined for General. */
  m_sNumFormat?: string;
  /** A numbering type (number ranges and page variables), undefined for the page's. */
  m_nNumType?: number;
}

/**
 * SwFieldMgr::GetSubTypes for the Variables group: the names of the variables (Set, Get), the
 * number ranges (Sequence), the user fields (User), or both variables and user fields (Input,
 * Formel); the static ones of the page variable (Off, On).
 */
export function GetSubTypes(sh: SwWrtShell, nTypeId: SwFieldTypesEnum, aPageRefNames: [string, string] = ['Off', 'On']): string[] {
  const doc = sh.m_pDoc;
  switch (nTypeId) {
    case SwFieldTypesEnum.User: return [...doc.m_aUserFieldTypes.keys()];
    case SwFieldTypesEnum.Get: case SwFieldTypesEnum.Set: return [...doc.m_aSetExpFieldTypes.keys()];
    case SwFieldTypesEnum.Sequence: return [...new Set([...CAPTION_CATEGORIES, ...GetSeqCategories(doc)])];
    case SwFieldTypesEnum.Input: case SwFieldTypesEnum.Formel: return [...doc.m_aUserFieldTypes.keys(), ...doc.m_aSetExpFieldTypes.keys()];
    case SwFieldTypesEnum.SetRefPage: return [...aPageRefNames];
    default: return [];
  }
}

/**
 * SwFieldMgr::InsertField for the Variables group: makes the field (and the type it needs) and
 * inserts it at the cursor. Returns the field, or null when it cannot be made (an empty variable,
 * a variable to show or ask for that does not exist).
 */
export function InsertField(sh: SwWrtShell, rData: SwInsertField_Data): SwField | null {
  const doc = sh.m_pDoc;
  let pField: SwField;
  switch (rData.m_nTypeId) {
    case SwFieldTypesEnum.User: {
      const nSubType = rData.m_nSubType;
      // only if existing
      const bNew = !doc.m_aUserFieldTypes.has(rData.m_sPar1);
      const pTyp = doc.InsertFieldType(new SwUserFieldType(rData.m_sPar1));
      if (bNew && (nSubType & SwUserType.LowerMask)) pTyp.SetType(nSubType & SwUserType.LowerMask);
      if (pTyp.GetContent() !== rData.m_sPar2) { pTyp.SetContent(rData.m_sPar2, rData.m_sNumFormat); doc.UpdateFields(); }
      pField = { type: 'User', name: rData.m_sPar1, subType: nSubType & SwUserType.UpperMask };
      if (rData.m_sNumFormat) pField.numFormat = rData.m_sNumFormat;
      break;
    }
    case SwFieldTypesEnum.Input: {
      const nInputSubType = rData.m_nSubType;
      if ((nInputSubType & SwInputFieldSubType.LowerMask) === SwInputFieldSubType.Var) {
        const pTyp = doc.m_aSetExpFieldTypes.get(rData.m_sPar1);
        // no Expression Type with this name existing -> create
        if (!pTyp) return null;
        pField = { type: 'SetExp', name: rData.m_sPar1, formula: '', input: true, prompt: rData.m_sPar2 };
        // Don't change type of SwSetExpFieldType:
        if (nInputSubType & SwInputFieldSubType.Invisible) pField.subType = SwGetSetExpType.Invisible;
        if (rData.m_sNumFormat) pField.numFormat = rData.m_sNumFormat;
      } else {
        pField = { type: 'Input', subType: nInputSubType | SwInputFieldSubType.Invisible, content: rData.m_sPar1, prompt: rData.m_sPar2 };
      }
      break;
    }
    case SwFieldTypesEnum.Set: {
      const nSubType = rData.m_nSubType;
      if (!rData.m_sPar2) return null; // empty variables are not allowed
      const pTyp = doc.InsertFieldType(new SwSetExpFieldType(rData.m_sPar1));
      // SwSetExpField::SetSubType: the type keeps whether it is a string or an expression.
      pTyp.SetType(nSubType & SwGetSetExpType.LowerMask);
      pField = { type: 'SetExp', name: rData.m_sPar1, formula: rData.m_sPar2, subType: nSubType & 0xff00 };
      if (rData.m_sNumFormat) pField.numFormat = rData.m_sNumFormat;
      break;
    }
    case SwFieldTypesEnum.Sequence: {
      // SwSetExpFieldType of GST_SEQ; the chapter level (nSubType) is not ported.
      pField = { type: 'Sequence', name: rData.m_sPar1 };
      if (rData.m_sPar2 && rData.m_sPar2 !== `${rData.m_sPar1}+1`) pField.formula = rData.m_sPar2;
      if (rData.m_nNumType !== undefined) pField.numType = rData.m_nNumType;
      break;
    }
    case SwFieldTypesEnum.Get: {
      // is there a corresponding SetField
      const pSetTyp = doc.m_aSetExpFieldTypes.get(rData.m_sPar1);
      if (!pSetTyp) return null;
      pField = { type: 'GetExp', formula: rData.m_sPar1, subType: rData.m_nSubType | pSetTyp.GetType() };
      if (rData.m_sNumFormat) pField.numFormat = rData.m_sNumFormat;
      break;
    }
    case SwFieldTypesEnum.Formel: {
      pField = { type: 'GetExp', formula: rData.m_sPar2, subType: rData.m_nSubType };
      if (rData.m_sNumFormat) pField.numFormat = rData.m_sNumFormat;
      break;
    }
    case SwFieldTypesEnum.SetRefPage:
      pField = { type: 'RefPageSet', subType: rData.m_nSubType ? 1 : 0, offset: Number.parseInt(rData.m_sPar2, 10) || 0 };
      break;
    case SwFieldTypesEnum.GetRefPage:
      pField = { type: 'RefPageGet' };
      if (rData.m_nNumType !== undefined) pField.numType = rData.m_nNumType;
      break;
    default: return null;
  }
  sh.InsertFormatField(pField);
  return pField;
}

/**
 * SwFieldMgr::RemoveFieldType: removes a user field or variable type no field uses (the dialog
 * offers Delete only then).
 */
export function RemoveFieldType(sh: SwWrtShell, nWhich: 'SetExp' | 'User', rName: string): void {
  sh.m_pDoc.RemoveFieldType(nWhich, rName);
}
