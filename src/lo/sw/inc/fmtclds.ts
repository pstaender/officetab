// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/fmtclds.hxx reduced
// SwFormatCol with columns of equal width only (SwFormatCol::IsOrtho): a count, the gutter between
// columns and an optional separator line. Column widths are computed as SwFormatCol::Calc does.

/** DEF_GUTTER_WIDTH: 3 mm. */
export const DEF_GUTTER_WIDTH = 170;

export interface SwFormatCol {
  m_nCount: number;
  m_nGutterWidth: number;
  /** SwColLineAdj: a separator line between the columns. */
  m_bLine: boolean;
  /** Sections only: !SwFormatNoBalancedColumns, the columns share the content evenly. */
  m_bBalanced: boolean;
}

export const NoCols = (): SwFormatCol => ({ m_nCount: 1, m_nGutterWidth: DEF_GUTTER_WIDTH, m_bLine: false, m_bBalanced: true });

/** SwFormatCol::Calc for orthogonal columns: the left edge and width of each column in an area. */
export function CalcColumns(col: SwFormatCol | null | undefined, left: number, width: number): { left: number; width: number }[] {
  const n = Math.max(1, col?.m_nCount ?? 1);
  if (n === 1) return [{ left, width }];
  const gap = col!.m_nGutterWidth;
  const w = Math.max(1, Math.floor((width - (n - 1) * gap) / n));
  return Array.from({ length: n }, (_, i) => ({ left: left + i * (w + gap), width: w }));
}
