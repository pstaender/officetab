// SPDX-License-Identifier: MPL-2.0
// tech.units.indriya.unit.Units: not a port, the units of Indriya's SI system that the LanguageTool
// ports use, with Indriya's definitions (see ../../../../javax/measure/Unit.ts).
import { BaseUnit, ProductUnit, TransformConverter, TransformedUnit, type Unit } from '../../../../javax/measure/Unit.ts';

export const METRE: Unit = new BaseUnit('m', { L: 1 });
export const KILOGRAM: Unit = new BaseUnit('kg', { M: 1 });
export const SECOND: Unit = new BaseUnit('s', { T: 1 });
export const KELVIN: Unit = new BaseUnit('K', { Θ: 1 });

/** SECOND.multiply(3600) */
export const HOUR: Unit = new TransformedUnit(SECOND, new TransformConverter('rational', 3600, 1), 'h');
/** KELVIN.shift(273.15) */
export const CELSIUS: Unit = new TransformedUnit(KELVIN, new TransformConverter('add', 273.15), '℃');

export const SQUARE_METRE: Unit = new ProductUnit([{ unit: METRE, pow: 2 }]);
export const CUBIC_METRE: Unit = new ProductUnit([{ unit: METRE, pow: 3 }]);
/** CUBIC_METRE.divide(1000) */
export const LITRE: Unit = new TransformedUnit(CUBIC_METRE, new TransformConverter('rational', 1, 1000), 'l');

export const METRE_PER_SECOND: Unit = new ProductUnit([{ unit: METRE, pow: 1 }, { unit: SECOND, pow: -1 }]);
/** METRE_PER_SECOND.multiply(RationalNumber.of(5, 18)) */
export const KILOMETRE_PER_HOUR: Unit = new TransformedUnit(METRE_PER_SECOND, new TransformConverter('rational', 5, 18), 'km/h');
