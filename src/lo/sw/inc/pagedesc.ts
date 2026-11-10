// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/pagedesc.hxx reduced
// @upstream sw/source/core/doc/DocumentStylePoolManager.cxx partial
// One frame format per page style: left and right pages share their geometry and columns (the
// header and footer may still differ on left and first pages). UseOnPage (left or right only) and
// mirrored margins are not ported.
import type { SwFormatCol } from './fmtclds.ts';

export const DEFAULT_PAGE_DESC = 'Default Page Style';

/** Page geometry in twips; defaults are A4 with 2 cm margins, as in Writer's Default Page Style. */
export class SwPageDesc {
  m_aName = DEFAULT_PAGE_DESC;
  /** The style of the page after one of this style (SwPageDesc::m_pFollow, by name). */
  m_sFollow = DEFAULT_PAGE_DESC;
  nWidth = 11906;
  nHeight = 16838;
  nLeft = 1134;
  nRight = 1134;
  nTop = 1134;
  nBottom = 1134;

  /** Header and footer frame formats: minimum height and spacing to the body (5 mm by default). */
  nHeaderMinHeight = 0;
  nHeaderSpacing = 283;
  nFooterMinHeight = 0;
  nFooterSpacing = 283;
  /** The page's text columns (SwFormatCol of the page format); null for one column. */
  m_aCol: SwFormatCol | null = null;

  constructor(name = DEFAULT_PAGE_DESC, follow = name) {
    this.m_aName = name;
    this.m_sFollow = follow;
  }

  PrintWidth(): number { return this.nWidth - this.nLeft - this.nRight; }
  PrintHeight(): number { return this.nHeight - this.nTop - this.nBottom; }

  /** A copy under another name (SwDoc::CopyPageDesc). */
  Clone(name: string, follow = name): SwPageDesc {
    const d = Object.assign(new SwPageDesc(name, follow), structuredClone({ ...this }));
    d.m_aName = name; d.m_sFollow = follow;
    return d;
  }
}

/** DocumentStylePoolManager::GetPageDescFromPool, for the styles offered in the UI. */
export const POOL_PAGE_DESCS = [DEFAULT_PAGE_DESC, 'First Page', 'Left Page', 'Right Page', 'Landscape', 'Endnote'] as const;

export function MakePoolPageDesc(name: string, standard: SwPageDesc): SwPageDesc | null {
  switch (name) {
    case 'First Page': return standard.Clone(name, DEFAULT_PAGE_DESC);
    // RES_POOLPAGE_ENDNOTE: the pages that collect the endnotes at the end of the document.
    case 'Endnote': return standard.Clone(name);
    case 'Left Page': return standard.Clone(name, 'Right Page');
    case 'Right Page': return standard.Clone(name, 'Left Page');
    case 'Landscape': {
      const d = standard.Clone(name);
      if (d.nWidth < d.nHeight) [d.nWidth, d.nHeight] = [d.nHeight, d.nWidth];
      return d;
    }
    default: return null;
  }
}
