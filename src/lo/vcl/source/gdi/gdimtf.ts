// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/gdi/gdimtf.cxx reduced
// @upstream vcl/source/gdi/metaact.cxx reduced
// GDIMetaFile: a recorded list of drawing actions with a preferred size in 1/100 mm, as the WMF and
// EMF readers (emfio) produce it. Only the actions those readers record are modelled, as plain
// objects named after their MetaAction classes; playing a metafile is SVGActionWriter's job
// (filter/source/svg/svgwriter.ts). Colours are '#rrggbb' strings.

import type { Point, Rectangle, Size } from '../../../tools/source/generic/gen.ts';
import type { Polygon, PolyPolygon } from '../../../tools/source/generic/poly.ts';

/** RasterOp: how drawing combines with what is below. */
export const RasterOp = { OverPaint: 0, Xor: 1, N0: 2, N1: 3, Invert: 4 } as const;

/** LineInfo: a stroke's style, width (0 is a hairline), dashes, join and cap. */
export interface LineInfo {
  meStyle: 'NONE' | 'SOLID' | 'DASH';
  mnWidth: number;
  mnDashCount: number; mnDashLen: number;
  mnDotCount: number; mnDotLen: number;
  mnDistance: number;
  meLineJoin: 'miter' | 'round' | 'bevel';
  meLineCap: 'butt' | 'round' | 'square';
}

export function LineInfoDefault(): LineInfo {
  return { meStyle: 'SOLID', mnWidth: 0, mnDashCount: 1, mnDashLen: 0, mnDotCount: 0, mnDotLen: 0, mnDistance: 0, meLineJoin: 'round', meLineCap: 'butt' };
}

/** vcl::Font, as far as metafiles use it: size in the metafile's units, orientation in 1/10 degree. */
export interface VclFont {
  maFamilyName: string;
  maFontSize: Size;
  /** CSS font weight (FontWeight), 0 when unknown. */
  meWeight: number;
  mbItalic: boolean;
  mbUnderline: boolean;
  mbStrikeout: boolean;
  mnOrientation: number;
  meAlign: 'TOP' | 'BASELINE' | 'BOTTOM';
  maColor: string;
  maFillColor: string;
  mbTransparent: boolean;
  /** FontFamily hint (FAMILY_ROMAN, FAMILY_SWISS, FAMILY_MODERN ...), for a generic CSS fallback. */
  meFamily: 'roman' | 'swiss' | 'modern' | 'script' | 'decorative' | 'dontknow';
  /** The font draws the symbol character set (Symbol, Wingdings ...). */
  mbSymbol: boolean;
}

/** A bitmap of a metafile: its data as a URL a browser shows (a DIB as BMP), and its pixel size. */
export interface MtfBitmap {
  width: number;
  height: number;
  href: string;
  /** The part of the bitmap shown (Bitmap::Crop), in pixels from the top left. */
  crop?: { x: number; y: number; width: number; height: number };
}

/** A clip region: polygons intersected in turn, each filled by its own rule (null: no clip). */
export interface ClipPart { aPolyPoly: PolyPolygon; bEvenOdd: boolean }

export type MetaAction =
  | { mnType: 'LINECOLOR'; maColor: string; mbSet: boolean }
  | { mnType: 'FILLCOLOR'; maColor: string; mbSet: boolean }
  | { mnType: 'RASTEROP'; meRasterOp: number }
  | { mnType: 'CLIPREGION'; maRegion: ClipPart[] | null }
  | { mnType: 'PIXEL'; maPt: Point; maColor: string }
  | { mnType: 'LINE'; maStartPt: Point; maEndPt: Point; maLineInfo: LineInfo }
  | { mnType: 'RECT'; maRect: Rectangle }
  | { mnType: 'ROUNDRECT'; maRect: Rectangle; mnHorzRound: number; mnVertRound: number }
  | { mnType: 'ELLIPSE'; maRect: Rectangle }
  | { mnType: 'ARC' | 'PIE' | 'CHORD'; maPoly: Polygon }
  | { mnType: 'POLYLINE'; maPoly: Polygon; maLineInfo: LineInfo }
  | { mnType: 'POLYGON'; maPoly: Polygon }
  | { mnType: 'POLYPOLYGON'; maPolyPoly: PolyPolygon }
  | { mnType: 'TEXTARRAY'; maStartPt: Point; maStr: string; maDXAry: number[] | null; /** Where the position is when the text width is not known. */ meAnchor?: 'start' | 'middle' | 'end' }
  | { mnType: 'FONT'; maFont: VclFont }
  | { mnType: 'BMPSCALE'; maPt: Point; maSz: Size; maBmp: MtfBitmap };

export class GDIMetaFile {
  m_aList: MetaAction[] = [];
  /** The preferred size, in 1/100 mm (MapUnit::Map100thMM). */
  m_aPrefSize: { width: number; height: number } = { width: 0, height: 0 };

  AddAction(pAction: MetaAction): void { this.m_aList.push(pAction); }
  GetActionSize(): number { return this.m_aList.length; }
  SetPrefSize(rSize: { width: number; height: number }): void { this.m_aPrefSize = { width: rSize.width, height: rSize.height }; }
  GetPrefSize(): { width: number; height: number } { return this.m_aPrefSize; }
}
