// Writer's part of the colour window: the colours its document uses. The rest is the shell's
// (src/shell/colors.ts).
import type { SwDoc } from '@lo/sw/inc/doc.ts';
import { norm } from '@shell/colors.ts';

export * from '@shell/colors.ts';

/** The font and highlighting colours set in the document's text, headers, footers and notes. */
export function documentColors(doc: SwDoc, max = 20): string[] {
  const seen = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) seen.add(norm(v)); };
  const nodes = doc.GetNodes();
  for (let i = 0; i < nodes.Count() && seen.size < max; i++) {
    const n = nodes.node(i);
    if (!n.IsTextNode()) continue;
    add(n.m_aSet.RES_CHRATR_COLOR);
    add(n.m_aSet.RES_CHRATR_BACKGROUND);
    for (const h of n.m_aHints) { add(h.aAttrs.RES_CHRATR_COLOR); add(h.aAttrs.RES_CHRATR_BACKGROUND); }
  }
  return [...seen].slice(0, max);
}
