// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/UnitConversionRule.java faithful
import { Tag } from '../../../../../../languagetool-core/org/languagetool/Tag.ts';
import { AbstractUnitConversionRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractUnitConversionRule.ts';
import { RoundingMode } from '../../../../../../../jdk/java/math/RoundingMode.ts';
import { NumberFormat } from '../../../../../../../jdk/java/text/NumberFormat.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { CELSIUS, HOUR, KILOGRAM } from '../../../../../../../jdk/tech/units/indriya/unit/Units.ts';

/**
 * @since 4.3
 */
export class UnitConversionRule extends AbstractUnitConversionRule {

  protected format: NumberFormat;

  constructor(messages: ResourceBundle) {
    super(messages);
    const { MILE, POUND, OUNCE, FEET, YARD, INCH, FAHRENHEIT } = AbstractUnitConversionRule;
    this.setTags([Tag.picky]);
    this.format = NumberFormat.getNumberInstance(Locale.ENGLISH);
    this.format.setMaximumFractionDigits(2);
    this.format.setRoundingMode(RoundingMode.HALF_UP);
    this.addUnit('miles per hour', MILE.divide(HOUR), 'miles per hour', 1, false);

    this.addUnit('kilograms?', KILOGRAM, 'kilogram', 1e0, true);
    this.addUnit('grams?', KILOGRAM, 'gram', 1e-3, true);
    this.addUnit('tons?', KILOGRAM, 'ton', 1e3, true);

    this.addUnit('pounds?', POUND, 'pounds', 1, false);
    this.addUnit('ounces?', OUNCE, 'ounces', 1, false);

    this.addUnit('feet', FEET, 'feet', 1, false);
    this.addUnit('miles?', MILE, 'miles', 1, false);
    this.addUnit('yards?', YARD, 'yards', 1, false);
    this.addUnit('inch(es)?', INCH, 'inches', 1, false);

    this.addUnit('(?:degrees?)? Fahrenheit', FAHRENHEIT, 'degree Fahrenheit', 1, false);
    this.addUnit('(?:degrees?)? Celsius', CELSIUS, 'degree Celsius', 1, true);
  }

  override getId(): string {
    return 'METRIC_UNITS_EN_GENERAL';
  }

  override getDescription(): string {
    return 'Suggests or checks conversion of units to their metric equivalents.';
  }

  protected override getNumberFormat(): NumberFormat {
    return this.format;
  }
}
