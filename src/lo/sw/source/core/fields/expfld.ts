// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/core/fields/expfld.cxx reduced
// Number range fields (SwSetExpField with nsSwGetSetExpType::GST_SEQ), reduced: a field counts the
// fields of its type before it in document order (the body first, then the other areas), as
// SwSetExpFieldType::SetSeqRefNo and SwDocUpdateField number them; a formula (Table+1) and chapter
// numbering (SetOutlineLvl) are not ported, so every field adds one.
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwField } from '../../../inc/hintids.ts';
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
      const k = (counts.get(f.name ?? '') ?? 0) + 1;
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
