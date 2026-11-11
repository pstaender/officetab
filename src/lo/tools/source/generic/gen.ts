// SPDX-License-Identifier: MPL-2.0
// @upstream include/tools/gen.hxx partial
// @upstream tools/source/generic/gen.cxx partial
// Coordinates are integral twips in Writer; JS numbers hold them exactly.

export class Point {
  x: number;
  y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  X(): number { return this.x; }
  Y(): number { return this.y; }
  getX(): number { return this.x; }
  getY(): number { return this.y; }
  setX(n: number): void { this.x = n; }
  setY(n: number): void { this.y = n; }
  AdjustX(n: number): number { return (this.x += n); }
  AdjustY(n: number): number { return (this.y += n); }
  clone(): Point { return new Point(this.x, this.y); }
  equals(o: Point): boolean { return this.x === o.x && this.y === o.y; }
}

export class Size {
  width: number;
  height: number;
  constructor(width = 0, height = 0) { this.width = width; this.height = height; }
  Width(): number { return this.width; }
  Height(): number { return this.height; }
  getWidth(): number { return this.width; }
  getHeight(): number { return this.height; }
  setWidth(n: number): void { this.width = n; }
  setHeight(n: number): void { this.height = n; }
  AdjustWidth(n: number): number { return (this.width += n); }
  AdjustHeight(n: number): number { return (this.height += n); }
  clone(): Size { return new Size(this.width, this.height); }
  equals(o: Size): boolean { return this.width === o.width && this.height === o.height; }
}

/**
 * tools::Rectangle: a closed interval (Right() is the last column inside), with RECT_EMPTY for an
 * empty width or height. Only what the metafile readers use.
 */
export class Rectangle {
  static readonly RECT_EMPTY = -32767;
  mnLeft: number;
  mnTop: number;
  mnRight: number;
  mnBottom: number;
  constructor(nLeft = 0, nTop = 0, nRight = Rectangle.RECT_EMPTY, nBottom = Rectangle.RECT_EMPTY) {
    this.mnLeft = nLeft; this.mnTop = nTop; this.mnRight = nRight; this.mnBottom = nBottom;
  }
  /** Constructs a closed interval rectangle from its top left and size. */
  static FromPointSize(rLT: Point, rSize: Size): Rectangle {
    const w = rSize.Width(), h = rSize.Height();
    return new Rectangle(rLT.X(), rLT.Y(), w ? rLT.X() + (w + (w > 0 ? -1 : 1)) : Rectangle.RECT_EMPTY, h ? rLT.Y() + (h + (h > 0 ? -1 : 1)) : Rectangle.RECT_EMPTY);
  }
  /** Rectangle::Normalize(Point, Point): the rectangle spanned by two corners. */
  static Normalize(a: Point, b: Point): Rectangle {
    return new Rectangle(Math.min(a.X(), b.X()), Math.min(a.Y(), b.Y()), Math.max(a.X(), b.X()), Math.max(a.Y(), b.Y()));
  }
  Left(): number { return this.mnLeft; }
  Right(): number { return this.IsWidthEmpty() ? this.mnLeft : this.mnRight; }
  Top(): number { return this.mnTop; }
  Bottom(): number { return this.IsHeightEmpty() ? this.mnTop : this.mnBottom; }
  IsEmpty(): boolean { return this.IsWidthEmpty() || this.IsHeightEmpty(); }
  IsWidthEmpty(): boolean { return this.mnRight === Rectangle.RECT_EMPTY; }
  IsHeightEmpty(): boolean { return this.mnBottom === Rectangle.RECT_EMPTY; }
  GetWidth(): number {
    if (this.IsWidthEmpty()) return 0;
    const n = this.mnRight - this.mnLeft;
    return n < 0 ? n - 1 : n + 1;
  }
  GetHeight(): number {
    if (this.IsHeightEmpty()) return 0;
    const n = this.mnBottom - this.mnTop;
    return n < 0 ? n - 1 : n + 1;
  }
  GetSize(): Size { return new Size(this.GetWidth(), this.GetHeight()); }
  TopLeft(): Point { return new Point(this.mnLeft, this.mnTop); }
  TopRight(): Point { return new Point(this.Right(), this.mnTop); }
  BottomLeft(): Point { return new Point(this.mnLeft, this.Bottom()); }
  BottomRight(): Point { return new Point(this.Right(), this.Bottom()); }
  Center(): Point { return new Point(Math.trunc((this.Left() + this.Right()) / 2), Math.trunc((this.Top() + this.Bottom()) / 2)); }
  SetPos(rPoint: Point): void {
    const w = this.mnRight - this.mnLeft, h = this.mnBottom - this.mnTop;
    if (!this.IsWidthEmpty()) this.mnRight = rPoint.X() + w;
    if (!this.IsHeightEmpty()) this.mnBottom = rPoint.Y() + h;
    this.mnLeft = rPoint.X(); this.mnTop = rPoint.Y();
  }
  SaturatingSetSize(rSize: Size): void {
    const w = rSize.Width(), h = rSize.Height();
    this.mnRight = w ? this.mnLeft + (w + (w > 0 ? -1 : 1)) : Rectangle.RECT_EMPTY;
    this.mnBottom = h ? this.mnTop + (h + (h > 0 ? -1 : 1)) : Rectangle.RECT_EMPTY;
  }
  Normalize(): void {
    if (this.mnRight < this.mnLeft && !this.IsWidthEmpty()) [this.mnLeft, this.mnRight] = [this.mnRight, this.mnLeft];
    if (this.mnBottom < this.mnTop && !this.IsHeightEmpty()) [this.mnTop, this.mnBottom] = [this.mnBottom, this.mnTop];
  }
  clone(): Rectangle { return new Rectangle(this.mnLeft, this.mnTop, this.mnRight, this.mnBottom); }
  equals(o: Rectangle): boolean { return this.mnLeft === o.mnLeft && this.mnTop === o.mnTop && this.mnRight === o.mnRight && this.mnBottom === o.mnBottom; }
}
