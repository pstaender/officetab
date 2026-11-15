// F4 in the cell input: the reference at the caret toggled (ScInputHandler::ToggleRel's use of
// ScRefFinder), and the caret after it.
import { ToggleRel } from '@lo/sc/source/core/tool/reffind.ts';
import type { Controller } from './controller.ts';
import { ScAddress } from '@lo/sc/inc/address.ts';

export function ToggleRelative(c: Controller, text: string, caret: number): { text: string; caret: number } | null {
  const e = c.edit;
  const r = ToggleRel(text, caret, caret, c.sh.GetDocument(), new ScAddress(e?.nCol ?? 0, e?.nRow ?? 0, e?.nTab ?? 0));
  return r ? { text: r.text, caret: r.nSelEnd } : null;
}
