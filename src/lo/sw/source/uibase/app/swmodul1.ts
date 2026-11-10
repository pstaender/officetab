// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/uibase/app/swmodul1.cxx partial
// @upstream svtools/source/config/colorcfg.cxx partial
// The redline authors of the session and their colours. As in upstream's SwModule, the list is
// global: an author keeps their colour across documents for as long as the page is open.

/** ColorConfig defaults for svtools::AUTHOR1 to AUTHOR9 (light scheme). */
const AUTHOR_COLORS = ['#c69200', '#0646a2', '#579d1c', '#692b9d', '#c5000b', '#008080', '#8c8400', '#35556b', '#d17600'];

const m_pAuthorNames: string[] = [];

/** SwModule::InsertRedlineAuthor */
export function InsertRedlineAuthor(rAuthor: string): number {
  let nPos = 0;
  while (nPos < m_pAuthorNames.length && m_pAuthorNames[nPos] !== rAuthor) ++nPos;
  if (nPos === m_pAuthorNames.length) m_pAuthorNames.push(rAuthor);
  return nPos;
}

/** lcl_GetAuthorColor: same as SwPostItMgr::GetColorAnchor() */
export function lcl_GetAuthorColor(nPos: number): string { return AUTHOR_COLORS[nPos % 9]!; }

/** The colour an author's changes are shown in. */
export const GetAuthorColor = (rAuthor: string): string => lcl_GetAuthorColor(InsertRedlineAuthor(rAuthor));
