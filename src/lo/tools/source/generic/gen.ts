// SPDX-License-Identifier: MPL-2.0
// @upstream include/tools/gen.hxx partial
// Coordinates are integral twips in Writer; JS numbers hold them exactly.

export class Point {
  constructor(public x = 0, public y = 0) {}
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
  constructor(public width = 0, public height = 0) {}
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
