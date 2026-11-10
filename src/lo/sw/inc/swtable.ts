// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/swtable.hxx reduced
// @upstream sw/source/core/table/swtable.cxx reduced
// Upstream keeps table, line and box properties in shared frame formats; here each object carries
// its own attribute record. Boxes hold no nested lines: only the "new table model" (simple rows of
// boxes with row spans) is ported. Box widths are relative; the layout scales them to the table width.
import type { SwStartNode } from './node.ts';

import type { SvxBorderLine } from './hintids.ts';
export type { SvxBorderLine };
export interface SvxBoxItem { left: SvxBorderLine | null; top: SvxBorderLine | null; right: SvxBorderLine | null; bottom: SvxBorderLine | null }

/** text::HoriOrientation for tables. */
export type SwTableAdjust = 'full' | 'left' | 'center' | 'right' | 'none';

export interface SwTableFormatAttrs {
  name: string;
  adjust: SwTableAdjust;
  /** Table width in twips; ignored for 'full'. */
  width: number;
  /** Left indent for 'none' and 'left'. */
  leftSpace: number;
  upper: number;
  lower: number;
}

export interface SwTableBoxAttrs {
  /** Relative width (SwFormatFrameSize of the box format). */
  width: number;
  box: SvxBoxItem;
  /** Spacing to contents, twips (SvxBoxItem's left and right distance, and top and bottom unless `dist` says otherwise). */
  padding: number;
  /** SvxBoxItem's top and bottom distance where they differ from the left and right one. */
  dist?: { top: number; bottom: number };
  background: string | null;
}

export interface SwTableLineAttrs { minHeight: number }

/** Writer's default table border: 0.5 pt, black (SwInsertTableFlags::DefaultBorder). */
export const DEF_BORDER: SvxBorderLine = { color: '#000000', width: 10 };
/** Default spacing to contents, 0.10 cm. */
export const DEF_BOX_PADDING = 55;

export const defaultBoxAttrs = (width: number, borders = true): SwTableBoxAttrs => ({
  width,
  box: borders ? { left: { ...DEF_BORDER }, top: { ...DEF_BORDER }, right: { ...DEF_BORDER }, bottom: { ...DEF_BORDER } } : { left: null, top: null, right: null, bottom: null },
  padding: DEF_BOX_PADDING,
  background: null,
});

export class SwTableBox {
  m_pStartNode: SwStartNode | null = null;
  m_pUpper: SwTableLine;
  /** 1 for a normal box, > 1 for the top box of a vertical merge, < 0 for boxes it covers. */
  mnRowSpan = 1;
  m_aAttrs: SwTableBoxAttrs;

  constructor(upper: SwTableLine, attrs: SwTableBoxAttrs) {
    this.m_pUpper = upper;
    this.m_aAttrs = attrs;
  }

  GetSttNd(): SwStartNode | null { return this.m_pStartNode; }
  GetUpper(): SwTableLine { return this.m_pUpper; }
  getRowSpan(): number { return this.mnRowSpan; }
  setRowSpan(n: number): void { this.mnRowSpan = n; }
}

export class SwTableLine {
  m_aBoxes: SwTableBox[] = [];
  m_aAttrs: SwTableLineAttrs = { minHeight: 0 };
  GetTabBoxes(): SwTableBox[] { return this.m_aBoxes; }
}

export class SwTable {
  m_aLines: SwTableLine[] = [];
  m_aAttrs: SwTableFormatAttrs;
  m_nRowsToRepeat = 0;

  constructor(attrs: SwTableFormatAttrs) { this.m_aAttrs = attrs; }

  GetTabLines(): SwTableLine[] { return this.m_aLines; }
  GetRowsToRepeat(): number { return Math.min(this.m_aLines.length, this.m_nRowsToRepeat); }
  GetFrameFormat(): SwTableFormatAttrs { return this.m_aAttrs; }

  /** Boxes in document (row-major) order, matching the order of their start nodes. */
  GetTabSortBoxes(): SwTableBox[] { return this.m_aLines.flatMap((l) => l.m_aBoxes); }

  GetTableBox(startNode: SwStartNode): SwTableBox | undefined {
    return this.GetTabSortBoxes().find((b) => b.m_pStartNode === startNode);
  }
}

/** A copy of the table structure without node references, for undo snapshots. */
export interface SwTableSnap {
  attrs: SwTableFormatAttrs;
  rowsToRepeat: number;
  lines: { attrs: SwTableLineAttrs; boxes: { attrs: SwTableBoxAttrs; rowSpan: number }[] }[];
}

export function SnapTable(t: SwTable): SwTableSnap {
  return structuredClone({
    attrs: t.m_aAttrs,
    rowsToRepeat: t.m_nRowsToRepeat,
    lines: t.m_aLines.map((l) => ({ attrs: l.m_aAttrs, boxes: l.m_aBoxes.map((b) => ({ attrs: b.m_aAttrs, rowSpan: b.mnRowSpan })) })),
  });
}

export function TableFromSnap(s: SwTableSnap): SwTable {
  const c = structuredClone(s);
  const t = new SwTable(c.attrs);
  t.m_nRowsToRepeat = c.rowsToRepeat;
  for (const ls of c.lines) {
    const line = new SwTableLine();
    line.m_aAttrs = ls.attrs;
    for (const bs of ls.boxes) {
      const box = new SwTableBox(line, bs.attrs);
      box.mnRowSpan = bs.rowSpan;
      line.m_aBoxes.push(box);
    }
    t.m_aLines.push(line);
  }
  return t;
}
