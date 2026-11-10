// SPDX-License-Identifier: MPL-2.0
// @upstream xmloff/source/draw/ximpshap.cxx partial
// SdXMLPolygonShapeContext and SdXMLPathShapeContext: draw:polygon, draw:polyline and draw:path,
// with their points in the coordinates of svg:viewBox. Writer keeps a drawing shape's outline as
// custom shape geometry, so the polygon becomes the segments of an enhanced path; a polyline or a
// path with an open sub-polygon is not filled (PolyLineShape, OpenBezierShape).
import type { XmlElement } from '../core/xmlparse.ts';
import { EnhancedCustomShapeSegmentCommand as C, type B2DPolygon, type CustomShapeGeometry, type EnhancedCustomShapeParameterPair } from '../../../svx/source/customshapes/EnhancedCustomShape2d.ts';
import { importFromSvgD, importFromSvgPoints } from '../../../basegfx/source/polygon/b2dsvgpolypolygon.ts';

/** SdXMLImExViewBox: "x y w h". */
function viewBox(el: XmlElement, polys: B2DPolygon[]): [number, number, number, number] {
  const v = (el.attrs.get('svg:viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (v.length === 4 && v.every(Number.isFinite) && v[2]! > 0 && v[3]! > 0) return v as [number, number, number, number];
  // Without a view box the points' own range.
  const pts = polys.flatMap((p) => p.pts);
  const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y));
  return [minX, minY, Math.max(1, Math.max(...pts.map((p) => p.x)) - minX), Math.max(1, Math.max(...pts.map((p) => p.y)) - minY)];
}

/** The polygons as an enhanced path: moveto, runs of lineto and curveto, close. */
export function PolygonsToGeometry(polys: B2DPolygon[], aViewBox: [number, number, number, number], bFill: boolean): CustomShapeGeometry {
  const coords: EnhancedCustomShapeParameterPair[] = [];
  const segments: [number, number][] = [];
  const add = (cmd: number) => {
    const l = segments[segments.length - 1];
    if (l && l[0] === cmd) l[1]++;
    else segments.push([cmd, 1]);
  };
  for (const p of polys) {
    if (!p.pts.length) continue;
    segments.push([C.MOVETO, 1]);
    coords.push([p.pts[0]!.x, p.pts[0]!.y]);
    const edges = p.pts.length - 1 + (p.closed ? 1 : 0);
    for (let k = 0; k < edges; k++) {
      const a = p.pts[k]!, b = p.pts[(k + 1) % p.pts.length]!;
      if (a.next || b.prev) {
        add(C.CURVETO);
        coords.push(a.next ?? [a.x, a.y], b.prev ?? [b.x, b.y], [b.x, b.y]);
      } else if (!(p.closed && k === edges - 1)) {
        // the straight closing edge is the close itself
        add(C.LINETO);
        coords.push([b.x, b.y]);
      }
    }
    if (p.closed) segments.push([C.CLOSESUBPATH, 0]);
  }
  if (!bFill) segments.push([C.NOFILL, 0]);
  segments.push([C.ENDSUBPATH, 0]);
  return { viewBox: aViewBox, coords, segments };
}

/** The outline of a draw:polygon, draw:polyline or draw:path, or null when it has no points. */
export function ImportPolyShape(el: XmlElement): CustomShapeGeometry | null {
  let polys: B2DPolygon[];
  try {
    if (el.name === 'draw:path') polys = importFromSvgD(el.attrs.get('svg:d') ?? '');
    else {
      const p = importFromSvgPoints(el.attrs.get('draw:points') ?? '');
      p.closed = el.name === 'draw:polygon';
      polys = [p];
    }
  } catch {
    return null;
  }
  polys = polys.filter((p) => p.pts.length > 1);
  if (!polys.length) return null;
  // aPolyPolygon.isClosed(): only a closed outline is filled.
  const bFill = polys.every((p) => p.closed);
  return PolygonsToGeometry(polys, viewBox(el, polys), bFill);
}
