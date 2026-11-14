// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ascii/parasc.cxx reduced
// @upstream sw/source/filter/ascii/wrtasc.cxx reduced
import { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import { CH_TXTATR_BREAKWORD } from '../../../inc/hintids.ts';
import { DefaultExpand } from '../../core/text/itrform2.ts';

export function ImportText(text: string): SwDoc {
  const doc = new SwDoc();
  const nodes = doc.GetNodes();
  const coll = doc.FindTextFormatCollByName('Standard')!;
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  lines.forEach((l, i) => {
    if (i === 0) nodes.FirstTextNode().m_Text = l;
    else nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), coll, l);
  });
  return doc;
}

export function ExportText(doc: SwDoc): string {
  const nodes = doc.GetNodes();
  const out: string[] = [];
  // OutASC_SwTextNode: the expanded text; a field shows its text, other placeholders (index
  // entries, comment and footnote anchors, objects) nothing.
  const expanded = (n: SwTextNode) => n.GetText().replace(new RegExp(CH_TXTATR_BREAKWORD, 'g'), (_c, i: number) => {
    const f = n.GetCharAttrAt('RES_TXTATR_FIELD', i);
    return f ? DefaultExpand(f) : '';
  });
  for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) out.push(expanded(n));
  return `${out.join('\n')}\n`;
}
