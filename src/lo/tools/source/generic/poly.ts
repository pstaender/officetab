// SPDX-License-Identifier: MPL-2.0
// @upstream tools/source/generic/poly.cxx partial
// tools::Polygon (points with optional Bézier control flags) and its constructors for rectangles,
// rounded rectangles, ellipses and arcs, as the metafile readers build them, and tools::PolyPolygon
// as a list of polygons. Coordinates are rounded to integers as upstream's tools::Long points are.

import { Point, Rectangle } from './gen.ts';

export const PolyFlags = { Normal: 0, Smooth: 1, Control: 2, Symmetric: 3 } as const;
export const PolyStyle = { Arc: 1, Pie: 2, Chord: 3 } as const;

const fKappa = (4.0 / 3.0) * (Math.SQRT2 - 1);
const fround = (f: number): number => Math.round(f);

function ImplGetParameter(rCenter: Point, rPt: Point, fWR: number, fHR: number): number {
  const nDX = rPt.X() - rCenter.X();
  const nDY = rCenter.Y() - rPt.Y();
  const fAngle = Math.atan2(nDY, nDX);
  return Math.atan2(fWR * Math.sin(fAngle), fHR * Math.cos(fAngle));
}

export class Polygon {
  mxPointAry: Point[];
  /** PolyFlags per point, or null when every point is a normal one. */
  mxFlagAry: number[] | null;

  constructor(aPoints: Point[] = [], aFlags: number[] | null = null) {
    this.mxPointAry = aPoints;
    this.mxFlagAry = aFlags;
  }

  /** Polygon( const tools::Rectangle& ): the closed outline of a rectangle. */
  static FromRect(rRect: Rectangle): Polygon {
    if (rRect.IsEmpty()) return new Polygon();
    return new Polygon([rRect.TopLeft(), rRect.TopRight(), rRect.BottomRight(), rRect.BottomLeft(), rRect.TopLeft()]);
  }

  /** Polygon( const tools::Rectangle&, nHorzRound, nVertRound ): a rounded rectangle of Bézier corners. */
  static FromRoundRect(rRect: Rectangle, nHorzRound: number, nVertRound: number): Polygon {
    if (rRect.IsEmpty()) return new Polygon();
    const aRect = rRect.clone();
    aRect.Normalize(); // SJ: i9140
    nHorzRound = Math.min(nHorzRound, Math.abs(aRect.GetWidth() >> 1));
    nVertRound = Math.min(nVertRound, Math.abs(aRect.GetHeight() >> 1));
    if (!nHorzRound || !nVertRound) return Polygon.FromRect(aRect);
    const L = aRect.Left(), T = aRect.Top(), R = aRect.Right(), B = aRect.Bottom();
    const P = (x: number, y: number) => new Point(Math.trunc(x), Math.trunc(y));
    const C = PolyFlags.Control, N = PolyFlags.Normal;
    const pts = [
      P(L, T + nVertRound), P(L, T + fKappa * nVertRound), P(L + fKappa * nHorzRound, T), P(L + nHorzRound, T),
      P(R - nHorzRound, T), P(R - fKappa * nHorzRound, T), P(R, T + fKappa * nVertRound), P(R, T + nVertRound),
      P(R, B - nVertRound), P(R, B - fKappa * nVertRound), P(R - fKappa * nHorzRound, B), P(R - nHorzRound, B),
      P(L + nHorzRound, B), P(L + fKappa * nHorzRound, B), P(L, B - fKappa * nVertRound), P(L, B - nVertRound),
    ];
    pts.push(pts[0]!.clone());
    return new Polygon(pts, [N, C, C, N, N, C, C, N, N, C, C, N, N, C, C, N, N]);
  }

  /** Polygon( const Point& rCenter, nRadX, nRadY ): an ellipse of four Bézier segments. */
  static FromEllipse(rCenter: Point, nRadX: number, nRadY: number): Polygon {
    if (!nRadX || !nRadY) return new Polygon();
    const X = rCenter.X(), Y = rCenter.Y();
    const P = (x: number, y: number) => new Point(Math.trunc(x), Math.trunc(y));
    const C = PolyFlags.Control, N = PolyFlags.Normal;
    const pts = [
      P(X - nRadX, Y), P(X - nRadX, Y + fKappa * nRadY), P(X - fKappa * nRadX, Y + nRadY), P(X, Y + nRadY),
      P(X + fKappa * nRadX, Y + nRadY), P(X + nRadX, Y + fKappa * nRadY), P(X + nRadX, Y),
      P(X + nRadX, Y - fKappa * nRadY), P(X + fKappa * nRadX, Y - nRadY), P(X, Y - nRadY),
      P(X - fKappa * nRadX, Y - nRadY), P(X - nRadX, Y - fKappa * nRadY),
    ];
    pts.push(pts[0]!.clone());
    return new Polygon(pts, [N, C, C, N, C, C, N, C, C, N, C, C, N]);
  }

  /** Polygon( rBound, rStart, rEnd, eStyle, bClockWiseArcDirection ): an arc, pie or chord of the bound's ellipse. */
  static FromArc(rBound: Rectangle, rStart: Point, rEnd: Point, eStyle: number, bClockWiseArcDirection = false): Polygon {
    const nWidth = rBound.GetWidth(), nHeight = rBound.GetHeight();
    if (nWidth === 0 || nHeight === 0) return new Polygon();
    const aCenter = rBound.Center();
    // tdf#142268 Get Top Left corner of rectangle (the rectangle is not always correctly created)
    const aBoundLeft = rBound.Left() < aCenter.X() ? rBound.Left() : rBound.Right();
    const aBoundTop = rBound.Top() < aCenter.Y() ? rBound.Top() : rBound.Bottom();
    const nRadX = aCenter.X() - aBoundLeft;
    const nRadY = aCenter.Y() - aBoundTop;
    let nPoints = Math.trunc(Math.min(Math.max(Math.PI * (1.5 * (nRadX + nRadY) - Math.sqrt(Math.abs(nRadX * nRadY))), 32.0), 256.0));
    if (nRadX > 32 && nRadY > 32 && nRadX + nRadY < 8192) nPoints >>= 1;

    // compute threshold
    const fRadX = nRadX, fRadY = nRadY, fCenterX = aCenter.X(), fCenterY = aCenter.Y();
    let fStart = ImplGetParameter(aCenter, rStart, fRadX, fRadY);
    const fEnd = ImplGetParameter(aCenter, rEnd, fRadX, fRadY);
    let fDiff = fEnd - fStart;
    if (bClockWiseArcDirection === false) {
      // #i73608# If startPoint is equal to endPoint, then draw full circle instead of nothing (as Metafiles spec)
      if (fDiff <= 0) fDiff += 2 * Math.PI;
    } else {
      fDiff = 2 * Math.PI - fDiff;
      if (fDiff > 2 * Math.PI) fDiff -= 2 * Math.PI;
    }
    // Proportionally shrink number of points( fDiff / (2PI) );
    nPoints = Math.max(Math.trunc((fDiff / (2 * Math.PI)) * nPoints), 16);
    let fStep = fDiff / (nPoints - 1);
    if (bClockWiseArcDirection === true) fStep = -fStep;

    const pts: Point[] = [];
    let nStart: number, nEnd: number;
    if (eStyle === PolyStyle.Pie) {
      const aCenter2 = new Point(fround(fCenterX), fround(fCenterY));
      nStart = 1; nEnd = nPoints + 1;
      pts[0] = aCenter2; pts[nEnd] = aCenter2.clone();
    } else {
      nStart = 0; nEnd = nPoints;
    }
    for (; nStart < nEnd; nStart++, fStart += fStep) pts[nStart] = new Point(fround(fCenterX + fRadX * Math.cos(fStart)), fround(fCenterY - fRadY * Math.sin(fStart)));
    if (eStyle === PolyStyle.Chord) pts[nPoints] = pts[0]!.clone();
    return new Polygon(pts);
  }

  /** Polygon( aCenter, nRadius, fStartAngle, fSweepAngle, bClockWise ): EMR_ANGLEARC's arc. */
  static FromAngleArc(aCenter: Point, nRadius: number, fStartAngle: number, fSweepAngle: number, bClockWiseArcDirection: boolean): Polygon {
    let fStart = fStartAngle, fEnd = fStartAngle + fSweepAngle;
    if (bClockWiseArcDirection) [fStart, fEnd] = [fEnd, fStart];
    const fDiff = fEnd - fStart;
    let fStep = Math.PI / 128.0;
    if (fSweepAngle < 0.0 || bClockWiseArcDirection) fStep = -fStep;
    const nPoints = (Math.trunc(fDiff / fStep) + 1) & 0xffff;
    const pts: Point[] = [];
    if (!nPoints) return new Polygon();
    for (let i = 0; i < nPoints; i++, fStart += fStep) pts.push(new Point(fround(aCenter.X() + nRadius * Math.cos(fStart)), fround(aCenter.Y() - nRadius * Math.sin(fStart))));
    pts[nPoints - 1] = new Point(fround(aCenter.X() + nRadius * Math.cos(fEnd)), fround(aCenter.Y() - nRadius * Math.sin(fEnd)));
    return new Polygon(pts);
  }

  GetSize(): number { return this.mxPointAry.length; }
  GetPoint(i: number): Point { return this.mxPointAry[i]!; }
  SetPoint(i: number, p: Point): void { this.mxPointAry[i] = p; }
  GetFlags(i: number): number { return this.mxFlagAry?.[i] ?? PolyFlags.Normal; }
  SetFlags(i: number, f: number): void {
    this.mxFlagAry ??= this.mxPointAry.map(() => PolyFlags.Normal);
    this.mxFlagAry[i] = f;
  }
  /** Inserts a point at nPos. */
  Insert(nPos: number, rPt: Point): void {
    this.mxPointAry.splice(nPos, 0, rPt);
    this.mxFlagAry?.splice(nPos, 0, PolyFlags.Normal);
  }
  SetSize(n: number): void {
    this.mxPointAry.length = n;
    if (this.mxFlagAry) this.mxFlagAry.length = n;
  }
  HasFlags(): boolean { return !!this.mxFlagAry?.some((f) => f !== PolyFlags.Normal); }
  clone(): Polygon { return new Polygon(this.mxPointAry.map((p) => p.clone()), this.mxFlagAry ? [...this.mxFlagAry] : null); }
  equals(o: Polygon): boolean {
    return this.mxPointAry.length === o.mxPointAry.length && this.mxPointAry.every((p, i) => p.equals(o.mxPointAry[i]!) && this.GetFlags(i) === o.GetFlags(i));
  }
  /** The bound rectangle of the points. */
  GetBoundRect(): Rectangle {
    if (!this.mxPointAry.length) return new Rectangle();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const p of this.mxPointAry) { l = Math.min(l, p.X()); t = Math.min(t, p.Y()); r = Math.max(r, p.X()); b = Math.max(b, p.Y()); }
    return new Rectangle(l, t, r, b);
  }
  /** Polygon::Optimize( PolyOptimizeFlags::CLOSE ): closes the polygon. */
  OptimizeClose(): void {
    const n = this.GetSize();
    if (n > 1 && !this.mxPointAry[0]!.equals(this.mxPointAry[n - 1]!)) this.Insert(n, this.mxPointAry[0]!.clone());
  }
}

/** tools::PolyPolygon: several polygons. */
export class PolyPolygon {
  mpPolyAry: Polygon[];
  constructor(aPolys: Polygon[] = []) { this.mpPolyAry = aPolys; }
  Count(): number { return this.mpPolyAry.length; }
  GetObject(i: number): Polygon { return this.mpPolyAry[i]!; }
  Insert(rPoly: Polygon): void { this.mpPolyAry.push(rPoly); }
  Clear(): void { this.mpPolyAry = []; }
  clone(): PolyPolygon { return new PolyPolygon(this.mpPolyAry.map((p) => p.clone())); }
  GetBoundRect(): Rectangle {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const poly of this.mpPolyAry) for (const p of poly.mxPointAry) { l = Math.min(l, p.X()); t = Math.min(t, p.Y()); r = Math.max(r, p.X()); b = Math.max(b, p.Y()); }
    return l === Infinity ? new Rectangle() : new Rectangle(l, t, r, b);
  }
}
