// SPDX-License-Identifier: MPL-2.0
// @upstream xmloff/source/style/bordrhdl.cxx reduced
// @upstream xmloff/source/style/xmlbahdl.cxx partial
// The measure (XMLMeasurePropHdl, through sax's Converter::convertMeasure) and border
// (XMLBorderHdl, XMLBorderWidthHdl) property handlers, on twips. A border is read as its width,
// style and colour; style:border-line-width's inner/distance/outer widths are only used to tell
// the double line styles apart. Shared by the Calc filter; Writer's ODT filter keeps its own
// border reading.

/** Converter::convertMeasureToCore: an ODF length in twips (undefined when it is not one). */
export function convertMeasureToTwips(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)(cm|mm|in|inch|pt|pc|px|twip)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const f: Record<string, number> = { cm: 1440 / 2.54, mm: 144 / 2.54, in: 1440, inch: 1440, pt: 20, pc: 240, px: 15, twip: 1 };
  return Math.round(n * (f[m[2] ?? 'pt'] ?? 20));
}

/** Converter::convertMeasure: twips as an ODF length (inches, as LibreOffice writes them). */
export const convertMeasureFromTwips = (t: number): string => `${Number((t / 1440).toFixed(4))}in`;

/** The border line styles of fo:border (XMLBorderHdl's pXML_BorderStyles). */
export type XMLBorderStyle = 'solid' | 'dotted' | 'dashed' | 'double' | 'fine-dashed' | 'dash-dot' | 'dash-dot-dot' | 'double-thin' | 'thin-thick' | 'thick-thin';

/** One border line: colour, width in twips, style. */
export interface XMLBorderLine { color: string; width: number; style?: XMLBorderStyle }

const BORDER_STYLES = new Set(['solid', 'dotted', 'dashed', 'double', 'fine-dashed', 'dash-dot', 'dash-dot-dot', 'double-thin', 'groove', 'ridge', 'inset', 'outset']);
const NAMED_WIDTHS: Record<string, number> = { thin: 15, middle: 30, thick: 45 };

/**
 * XMLBorderHdl::importXML: "0.74pt solid #000000". Undefined when there is no value, null for
 * no line. The style:border-line-width value (inner distance outer) tells a thin-thick double line.
 */
export function ImportBorder(v: string | undefined, sLineWidth?: string): XMLBorderLine | null | undefined {
  if (v === undefined) return undefined;
  const parts = v.trim().split(/\s+/);
  if (!v.trim() || parts.includes('none') || parts.includes('hidden')) return null;
  let width: number | undefined;
  let style: XMLBorderStyle = 'solid';
  let color = '#000000';
  for (const p of parts) {
    if (p.startsWith('#')) color = p.toLowerCase();
    else if (BORDER_STYLES.has(p)) style = (['groove', 'ridge', 'inset', 'outset'].includes(p) ? 'solid' : p) as XMLBorderStyle;
    else if (NAMED_WIDTHS[p] !== undefined) width = NAMED_WIDTHS[p];
    else width = convertMeasureToTwips(p) ?? width;
  }
  if (width === undefined) width = 15;
  if (width <= 0) return null;
  if (style === 'double' && sLineWidth) {
    // XMLBorderWidthHdl: inner, distance, outer.
    const w = sLineWidth.trim().split(/\s+/).map((x) => convertMeasureToTwips(x) ?? 0);
    if (w.length === 3) {
      if (w[0]! > w[2]!) style = 'thick-thin';
      else if (w[0]! < w[2]!) style = 'thin-thick';
    }
  }
  return { color, width: Math.max(1, width), style };
}

/** XMLBorderHdl::exportXML: the width in points, the style, the colour. */
export function ExportBorder(b: XMLBorderLine | null | undefined): string {
  if (!b) return 'none';
  const style = b.style === 'thin-thick' || b.style === 'thick-thin' ? 'double' : (b.style ?? 'solid');
  return `${Number((b.width / 20).toFixed(2))}pt ${style} ${b.color}`;
}

/** XMLBorderWidthHdl::exportXML for double lines (inner, distance, outer); '' for single lines. */
export function ExportBorderLineWidth(b: XMLBorderLine | null | undefined): string {
  if (!b || !b.style || !['double', 'double-thin', 'thin-thick', 'thick-thin'].includes(b.style)) return '';
  const pt = (t: number) => `${Number((t / 20).toFixed(2))}pt`;
  const third = Math.max(1, Math.round(b.width / 3));
  if (b.style === 'thin-thick') return `${pt(third / 2)} ${pt(third)} ${pt(third * 1.5)}`;
  if (b.style === 'thick-thin') return `${pt(third * 1.5)} ${pt(third)} ${pt(third / 2)}`;
  return `${pt(third)} ${pt(third)} ${pt(third)}`;
}
