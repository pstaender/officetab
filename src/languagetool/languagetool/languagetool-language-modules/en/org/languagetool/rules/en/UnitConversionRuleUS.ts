// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/UnitConversionRuleUS.java faithful
import { AbstractUnitConversionRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractUnitConversionRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { RoundingMode } from '../../../../../../../jdk/java/math/RoundingMode.ts';
import { NumberFormat } from '../../../../../../../jdk/java/text/NumberFormat.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { CUBIC_METRE, KILOMETRE_PER_HOUR, LITRE, METRE, SQUARE_METRE } from '../../../../../../../jdk/tech/units/indriya/unit/Units.ts';
import { UnitConversionRule } from './UnitConversionRule.ts';

/**
 * @since 4.3
 */
export class UnitConversionRuleUS extends UnitConversionRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    const { US_QUART, US_GALLON, US_PINT, US_CUP, US_FL_OUNCE } = AbstractUnitConversionRule;
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/imperial-metric-system/'));

    this.format = NumberFormat.getNumberInstance(Locale.US);
    this.format.setMaximumFractionDigits(2);
    this.format.setRoundingMode(RoundingMode.HALF_UP);

    this.addUnit('(kilometre|kilometer)s? per hour', KILOMETRE_PER_HOUR, 'kilometers per hour', 1, true);

    this.addUnit('kilomet(re|er)s?', METRE, 'kilometers', 1e3, true);
    this.addUnit('met(re|er)s?', METRE, 'meters', 1e0, true);
    this.addUnit('decimet(re|er)s?', METRE, 'decimeters', 1e-1, false/*true*/); // Metric, but not commonly used
    this.addUnit('centimet(re|er)s?', METRE, 'centimeters', 1e-2, true);
    this.addUnit('millimet(re|er)s?', METRE, 'micrometers', 1e-3, true);
    this.addUnit('micromet(re|er)s?', METRE, 'micrometers', 1e-6, true);
    this.addUnit('nanomet(re|er)s?', METRE, 'nanometers', 1e-9, true);

    this.addUnit('square met(re|er)s?', SQUARE_METRE, 'square meters', 1, true);
    this.addUnit('square kilomet(re|er)s?', SQUARE_METRE, 'square kilometers', 1e6, true);
    this.addUnit('square decimet(re|er)s?', SQUARE_METRE, 'square decimeters', 1e-2, false/*true*/); // Metric, but not commonly used
    this.addUnit('square centimet(re|er)s?', SQUARE_METRE, 'square centimeters', 1e-4, true);
    this.addUnit('square millimet(re|er)s?', SQUARE_METRE, 'square millimeters', 1e-6, true);
    this.addUnit('square micromet(re|er)s?', SQUARE_METRE, 'square micrometers', 1e-12, true);
    this.addUnit('square nanomet(re|er)s?', SQUARE_METRE, 'square nanometers', 1e-18, true);

    this.addUnit('cubic met(re|er)s?', CUBIC_METRE, 'cubic meters', 1, true);
    this.addUnit('cubic kilomet(re|er)s?', CUBIC_METRE, 'cubic kilometers', 1e9, true);
    this.addUnit('cubic decimet(re|er)s?', CUBIC_METRE, 'cubic decimeters', 1e-3, false/*true*/); // Metric, but not commonly used
    this.addUnit('cubic centimet(re|er)s?', CUBIC_METRE, 'cubic centimeters', 1e-6, true);
    this.addUnit('cubic millimet(re|er)s?', CUBIC_METRE, 'cubic millimeters', 1e-9, true);
    this.addUnit('cubic micromet(re|er)s?', CUBIC_METRE, 'cubic micrometers', 1e-18, true);
    this.addUnit('cubic nanomet(re|er)s?', CUBIC_METRE, 'cubic nanometers', 1e-27, true);

    this.addUnit('lit(re|er)s?', LITRE, 'liters', 1, true);
    this.addUnit('millilit(re|er)s?', LITRE, 'milliliters', 1e-3, true);

    this.addUnit('qt\\.', US_QUART, 'qt.', 1, false);
    this.addUnit('gal', US_GALLON, 'gal', 1, false);
    this.addUnit('pt', US_PINT, 'pt', 1, false);
    this.addUnit('cup', US_CUP, 'cups', 1, false);
    this.addUnit('(?:fl.? oz.?|oz. fl.)', US_FL_OUNCE, 'fl oz', 1, false);

    this.addUnit('quarts?', US_QUART, 'quarts', 1, false);
    this.addUnit('gallons?', US_GALLON, 'gallons', 1, false);
    this.addUnit('pints?', US_PINT, 'pints', 1, false);
    this.addUnit('cups?', US_CUP, 'cups', 1, false);
    this.addUnit('(fluid )?ounces?', US_FL_OUNCE, 'fluid ounces', 1, false);
  }

  override getId(): string {
    return 'METRIC_UNITS_EN_US';
  }
}
