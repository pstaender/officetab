// SPDX-License-Identifier: MPL-2.0
// javax.measure (JSR 385) with the parts of Indriya's implementation that AbstractUnitConversionRule
// uses: not a port, a stand-in for the library. A unit is a system (base) unit, a unit transformed
// from a parent unit by a converter (multiply, divide, rational factor, shift), or a product of
// units with exponents. As in Indriya, units are equal by structure (the same parent and an equal
// converter, or the same product), not by value; multiply(1) returns the unit itself. Values are
// converted through the system units in doubles (Indriya concatenates the converters exactly where
// it can, so the last digit may differ; the rules round to two decimals).

/** The dimension of a unit: exponents of the base quantities (L, M, T, Θ). */
type Dimension = Readonly<Record<string, number>>;

function dimensionKey(d: Dimension): string {
  return Object.keys(d).filter((k) => d[k] !== 0).sort().map((k) => k + d[k]).join(' ');
}

/** javax.measure.UnconvertibleException */
export class UnconvertibleException extends Error {
  constructor(message: string) {
    super('UnconvertibleException: ' + message);
  }
}

/** javax.measure.UnitConverter */
export interface UnitConverter {
  convert(value: number): number;
}

/** The converter of a transformed unit, from its value to its parent's. */
export class TransformConverter {
  readonly kind: 'multiply' | 'divide' | 'rational' | 'add';
  readonly value: number;
  readonly divisor: number;

  constructor(kind: 'multiply' | 'divide' | 'rational' | 'add', value: number, divisor = 1) {
    this.kind = kind;
    this.value = value;
    this.divisor = divisor;
  }

  toParent(x: number): number {
    switch (this.kind) {
      case 'multiply': return x * this.value;
      case 'divide': return x / this.value;
      case 'rational': return x * this.value / this.divisor;
      case 'add': return x + this.value;
    }
  }

  fromParent(y: number): number {
    switch (this.kind) {
      case 'multiply': return y / this.value;
      case 'divide': return y * this.value;
      case 'rational': return y * this.divisor / this.value;
      case 'add': return y - this.value;
    }
  }

  isLinear(): boolean {
    return this.kind !== 'add';
  }

  equals(o: unknown): boolean {
    return o instanceof TransformConverter && o.kind === this.kind && o.value === this.value && o.divisor === this.divisor;
  }
}

/** javax.measure.Unit (Q, the quantity type, is not modelled). */
export abstract class Unit {
  /** The dimension of the unit. */
  abstract getDimensionKey(): string;
  /** @internal */
  abstract dimension(): Dimension;
  /** @internal The value in the system unit. */
  abstract toSystem(x: number): number;
  /** @internal The value in this unit of a value in the system unit. */
  abstract fromSystem(y: number): number;
  abstract equals(o: unknown): boolean;
  abstract toString(): string;

  /** @internal The factor of the linear part, for products. */
  linearFactor(): number {
    return this.toSystem(1) - this.toSystem(0);
  }

  isCompatible(that: Unit): boolean {
    return this.getDimensionKey() === that.getDimensionKey();
  }

  getConverterTo(that: Unit): UnitConverter {
    if (!this.isCompatible(that)) {
      throw new UnconvertibleException(this + ' is not compatible with ' + that);
    }
    return { convert: (value: number) => that.fromSystem(this.toSystem(value)) };
  }

  /** multiply(Number) or multiply(Unit) */
  multiply(factor: number | Unit): Unit {
    if (typeof factor === 'number') {
      return factor === 1 ? this : new TransformedUnit(this, new TransformConverter('multiply', factor));
    }
    return ProductUnit.ofProduct(this, factor, 1);
  }

  /** divide(Number) or divide(Unit) */
  divide(divisor: number | Unit): Unit {
    if (typeof divisor === 'number') {
      return divisor === 1 ? this : new TransformedUnit(this, new TransformConverter('divide', divisor));
    }
    return ProductUnit.ofProduct(this, divisor, -1);
  }

  shift(offset: number): Unit {
    return offset === 0 ? this : new TransformedUnit(this, new TransformConverter('add', offset));
  }
}

/** A system unit (Indriya's BaseUnit and the named derived units). */
export class BaseUnit extends Unit {
  private readonly symbol: string;
  private readonly dim: Dimension;

  constructor(symbol: string, dim: Dimension) {
    super();
    this.symbol = symbol;
    this.dim = dim;
  }

  override getDimensionKey(): string { return dimensionKey(this.dim); }
  override dimension(): Dimension { return this.dim; }
  override toSystem(x: number): number { return x; }
  override fromSystem(y: number): number { return y; }
  override equals(o: unknown): boolean { return o === this; }
  override toString(): string { return this.symbol; }
}

/** A unit derived from a parent unit by a converter (Indriya's TransformedUnit). */
export class TransformedUnit extends Unit {
  private readonly parentUnit: Unit;
  private readonly converter: TransformConverter;
  private readonly symbol: string | null;

  constructor(parentUnit: Unit, converter: TransformConverter, symbol: string | null = null) {
    super();
    this.parentUnit = parentUnit;
    this.converter = converter;
    this.symbol = symbol;
  }

  override getDimensionKey(): string { return this.parentUnit.getDimensionKey(); }
  override dimension(): Dimension { return this.parentUnit.dimension(); }
  override toSystem(x: number): number { return this.parentUnit.toSystem(this.converter.toParent(x)); }
  override fromSystem(y: number): number { return this.converter.fromParent(this.parentUnit.fromSystem(y)); }
  override equals(o: unknown): boolean {
    return o === this || o instanceof TransformedUnit && this.parentUnit.equals(o.parentUnit) && this.converter.equals(o.converter)
      && this.symbol === o.symbol;
  }
  override toString(): string {
    if (this.symbol != null) return this.symbol;
    const c = this.converter;
    const op = c.kind === 'add' ? '+' + c.value : c.kind === 'divide' ? '/' + c.value : c.kind === 'rational' ? '*' + c.value + '/' + c.divisor : '*' + c.value;
    return this.parentUnit + op;
  }
}

/** A product of units with exponents (Indriya's ProductUnit). */
export class ProductUnit extends Unit {
  private readonly elements: ReadonlyArray<{ unit: Unit; pow: number }>;
  private readonly symbol: string | null;

  constructor(elements: ReadonlyArray<{ unit: Unit; pow: number }>, symbol: string | null = null) {
    super();
    this.elements = elements;
    this.symbol = symbol;
  }

  private static elementsOf(u: Unit): Array<{ unit: Unit; pow: number }> {
    return u instanceof ProductUnit && u.symbol == null ? u.elements.map((e) => ({ ...e })) : [{ unit: u, pow: 1 }];
  }

  /** left * right^sign, with the powers of equal units added. */
  static ofProduct(left: Unit, right: Unit, sign: 1 | -1): Unit {
    const result = ProductUnit.elementsOf(left);
    for (const e of ProductUnit.elementsOf(right)) {
      const same = result.find((r) => r.unit.equals(e.unit));
      if (same) {
        same.pow += sign * e.pow;
      } else {
        result.push({ unit: e.unit, pow: sign * e.pow });
      }
    }
    const elements = result.filter((e) => e.pow !== 0);
    if (elements.length === 1 && elements[0]!.pow === 1) {
      return elements[0]!.unit;
    }
    return new ProductUnit(elements);
  }

  override dimension(): Dimension {
    const d: Record<string, number> = {};
    for (const e of this.elements) {
      const ed = e.unit.dimension();
      for (const k of Object.keys(ed)) d[k] = (d[k] ?? 0) + ed[k]! * e.pow;
    }
    return d;
  }
  override getDimensionKey(): string { return dimensionKey(this.dimension()); }
  private factor(): number {
    let f = 1;
    for (const e of this.elements) f *= Math.pow(e.unit.linearFactor(), e.pow);
    return f;
  }
  override toSystem(x: number): number { return x * this.factor(); }
  override fromSystem(y: number): number { return y / this.factor(); }
  override equals(o: unknown): boolean {
    if (o === this) return true;
    if (!(o instanceof ProductUnit) || o.elements.length !== this.elements.length || o.symbol !== this.symbol) return false;
    return this.elements.every((e) => o.elements.some((f) => f.pow === e.pow && f.unit.equals(e.unit)));
  }
  override toString(): string {
    if (this.symbol != null) return this.symbol;
    return this.elements.map((e) => e.pow === 1 ? String(e.unit) : e.unit + '^' + e.pow).join('·');
  }
}
