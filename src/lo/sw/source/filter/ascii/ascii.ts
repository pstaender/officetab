// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ascii/parasc.cxx reduced
// @upstream sw/source/filter/ascii/wrtasc.cxx reduced
import { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';

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
  for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) out.push(n.GetText());
  return `${out.join('\n')}\n`;
}
