// SPDX-License-Identifier: MPL-2.0
// @upstream svx/source/dialog/_contdlg.cxx partial
// SvxContourDlg::CreateAutoContour: the contour of a bitmap graphic, from its alpha mask when it
// has one and from its edges otherwise. The contour is returned as fractions of the graphic's size
// (upstream scales it to the graphic's preferred size). Animated and vector graphics are not
// ported: they are rasterised by the caller.
import type { BitmapBuffer } from '../../../vcl/source/bitmap/bitmapfilter.ts';
import { GetContour, HasAlpha } from '../../../vcl/source/bitmap/bitmap.ts';

export type ContourPolygon = [number, number][];

export function CreateAutoContour(rBmp: BitmapBuffer): ContourPolygon[] {
  const bContourEdgeDetect = !HasAlpha(rBmp);
  const aPoly = GetContour(rBmp, bContourEdgeDetect);
  if (!aPoly.length) return [];
  return [aPoly.map(([x, y]) => [x / rBmp.width, y / rBmp.height] as [number, number])];
}
