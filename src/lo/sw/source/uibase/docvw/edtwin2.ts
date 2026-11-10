// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/docvw/edtwin2.cxx reduced
// PSCSDFPropsQuickHelp: what the tooltip says over text the styles spotlight marks. Only that
// part of the quick help is here; it returns what to say, and the web shell words it.
import { Point } from '../../../../tools/source/generic/gen.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { CharStyleAt, HasCharDirectFormatting } from '../../core/text/inftxt.ts';
import type { SwWrtShell } from '../wrtsh/wrtsh.ts';

export type SpotlightQuickHelp =
  | { kind: 'charStyle'; name: string }
  | { kind: 'charDF' }
  | { kind: 'paraStyle'; name: string; df: boolean };

export function PSCSDFPropsQuickHelp(rSh: SwWrtShell, aPt: Point): SpotlightQuickHelp | null {
  const rView = rSh.m_aSpotlight;
  if (!rView.charDF && !rView.paraStyles && !rView.charStyles) return null;

  const aPos = rSh.m_pRoot.GetModelPositionForViewPoint(aPt);
  const node = aPos.node;
  const frames = rSh.m_pRoot.pages.flatMap((p) => p.frames).filter((f) => f.node === node);

  const bContainsPt = frames.some((f) => aPt.X() >= f.nLeft && aPt.X() <= f.nLeft + f.nWidth && aPt.Y() >= f.nTop && aPt.Y() <= f.nTop + f.nHeight);
  if (bContainsPt) {
    if (rView.charStyles) {
      // check if in CS formatting highlighted area
      const sCharStyle = CharStyleAt(node, aPos.content);
      if (sCharStyle) return { kind: 'charStyle', name: sCharStyle };
    }
    // check if in direct formatting highlighted area
    if (rView.charDF && !CharStyleAt(node, aPos.content) && HasCharDirectFormatting(node, aPos.content)) return { kind: 'charDF' };
  } else if (rView.paraStyles) {
    // check if in paragraph style formatting highlighted area
    for (const f of frames) {
      const rtl = node.GetAttr('RES_FRAMEDIR') === 'rl-tb';
      const left = rtl ? f.nLeft + f.nWidth + 75 : f.nLeft - 375;
      if (aPt.X() >= left && aPt.X() <= left + 300 && aPt.Y() >= f.nTop && aPt.Y() <= f.nTop + f.nHeight)
        // check for paragraph direct formatting
        return { kind: 'paraStyle', name: node.GetTextColl().GetName(), df: SwDoc.HasParagraphDirectFormatting(node) };
    }
  }
  return null;
}
