// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/swrect.hxx partial
// @upstream sw/source/core/bastyp/swrect.cxx partial
import { Point, Size } from '../../tools/source/generic/gen.ts';

/** Half-open rectangle: m_Point.X() + m_Size.getWidth() is *not* included. */
export class SwRect {
  m_Point: Point;
  m_Size: Size;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.m_Point = new Point(x, y);
    this.m_Size = new Size(width, height);
  }

  static fromPoints(lt: Point, rb: Point): SwRect {
    return new SwRect(lt.X(), lt.Y(), rb.X() - lt.X() + 1, rb.Y() - lt.Y() + 1);
  }

  clone(): SwRect { return new SwRect(this.Left(), this.Top(), this.Width(), this.Height()); }

  Pos(): Point { return this.m_Point; }
  SSize(): Size { return this.m_Size; }

  Width(): number; Width(n: number): void;
  Width(n?: number): number | void { if (n === undefined) return this.m_Size.getWidth(); this.m_Size.setWidth(n); }
  Height(): number; Height(n: number): void;
  Height(n?: number): number | void { if (n === undefined) return this.m_Size.getHeight(); this.m_Size.setHeight(n); }

  Left(): number; Left(n: number): void;
  Left(n?: number): number | void {
    if (n === undefined) return this.m_Point.getX();
    this.m_Size.AdjustWidth(this.m_Point.getX() - n); this.m_Point.setX(n);
  }
  Top(): number; Top(n: number): void;
  Top(n?: number): number | void {
    if (n === undefined) return this.m_Point.getY();
    this.m_Size.AdjustHeight(this.m_Point.getY() - n); this.m_Point.setY(n);
  }
  // The inline getters report the last *contained* coordinate: X + W - 1 for a non-empty extent.
  Right(): number; Right(n: number): void;
  Right(n?: number): number | void {
    if (n === undefined) return this.m_Point.getX() + this.m_Size.getWidth() - (this.m_Size.getWidth() ? 1 : 0);
    this.m_Size.setWidth(n - this.m_Point.getX() + 1);
  }
  Bottom(): number; Bottom(n: number): void;
  Bottom(n?: number): number | void {
    if (n === undefined) return this.m_Point.getY() + this.m_Size.getHeight() - (this.m_Size.getHeight() ? 1 : 0);
    this.m_Size.setHeight(n - this.m_Point.getY() + 1);
  }

  HasArea(): boolean { return !this.IsEmpty(); }
  IsEmpty(): boolean { return !(this.m_Size.getHeight() && this.m_Size.getWidth()); }

  Overlaps(r: SwRect): boolean {
    return this.Top() <= r.Bottom() && r.Top() <= this.Bottom() && this.Left() <= r.Right() && r.Left() <= this.Right();
  }

  Contains(p: Point): boolean {
    return p.X() >= this.Left() && p.X() <= this.Right() && p.Y() >= this.Top() && p.Y() <= this.Bottom();
  }

  Union(r: SwRect): this {
    if (r.IsEmpty()) return this;
    if (this.IsEmpty()) { this.assign(r); return this; }
    if (this.Top() > r.Top()) this.Top(r.Top());
    if (this.Left() > r.Left()) this.Left(r.Left());
    if (this.Right() < r.Right()) this.Right(r.Right());
    if (this.Bottom() < r.Bottom()) this.Bottom(r.Bottom());
    return this;
  }

  Intersection(r: SwRect): this {
    if (this.Overlaps(r)) {
      if (this.Left() < r.Left()) this.Left(r.Left());
      if (this.Top() < r.Top()) this.Top(r.Top());
      if (this.Right() > r.Right()) this.Right(r.Right());
      if (this.Bottom() > r.Bottom()) this.Bottom(r.Bottom());
    } else {
      this.m_Size.setWidth(0); this.m_Size.setHeight(0); // Def.: if empty, set only SSize to 0
    }
    return this;
  }

  private assign(r: SwRect): void {
    this.m_Point = r.m_Point.clone();
    this.m_Size = r.m_Size.clone();
  }
}
