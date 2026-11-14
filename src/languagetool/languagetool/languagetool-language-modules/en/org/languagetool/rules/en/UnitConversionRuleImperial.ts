// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/UnitConversionRuleImperial.java faithful
import { AbstractUnitConversionRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractUnitConversionRule.ts';
import { RoundingMode } from '../../../../../../../jdk/java/math/RoundingMode.ts';
import { NumberFormat } from '../../../../../../../jdk/java/text/NumberFormat.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { CUBIC_METRE, KILOMETRE_PER_HOUR, LITRE, METRE, SQUARE_METRE } from '../../../../../../../jdk/tech/units/indriya/unit/Units.ts';
import { UnitConversionRule } from './UnitConversionRule.ts';

/**
 * @since 4.3
 */
export class UnitConversionRuleImperial extends UnitConversionRule {

  constructor(messages: ResourceBundle) {
    super(messages);
    const { IMP_QUART, IMP_GALLON, IMP_PINT, IMP_FL_OUNCE } = AbstractUnitConversionRule;
    this.format = NumberFormat.getNumberInstance(Locale.UK);
    this.format.setMaximumFractionDigits(2);
    this.format.setRoundingMode(RoundingMode.HALF_UP);

    this.addUnit('(kilometre|kilometer)s? per hour', KILOMETRE_PER_HOUR, 'kilometres per hour', 1, true);

    this.addUnit('kilomet(re|er)s?', METRE, 'kilometres', 1e3, true);
    this.addUnit('met(re|er)s?', METRE, 'metres', 1e0, true);
    this.addUnit('decimet(re|er)s?', METRE, 'decimetres', 1e-1, false/*true*/); // Metric, but not commonly used
    this.addUnit('centimet(re|er)s?', METRE, 'centimetres', 1e-2, true);
    this.addUnit('millimet(re|er)s?', METRE, 'micrometres', 1e-3, true);
    this.addUnit('micromet(re|er)s?', METRE, 'micrometres', 1e-6, true);
    this.addUnit('nanomet(re|er)s?', METRE, 'nanometres', 1e-9, true);


    this.addUnit('square met(re|er)s?', SQUARE_METRE, 'square metres', 1, true);
    this.addUnit('square kilomet(re|er)s?', SQUARE_METRE, 'square kilometres', 1e6, true);
    this.addUnit('square decimet(re|er)s?', SQUARE_METRE, 'square decimetres', 1e-2, false/*true*/); // Metric, but not commonly used
    this.addUnit('square centimet(re|er)s?', SQUARE_METRE, 'square centimetres', 1e-4, true);
    this.addUnit('square millimet(re|er)s?', SQUARE_METRE, 'square millimetres', 1e-6, true);
    this.addUnit('square micromet(re|er)s?', SQUARE_METRE, 'square micrometres', 1e-12, true);
    this.addUnit('square nanomet(re|er)s?', SQUARE_METRE, 'square nanometres', 1e-18, true);

    this.addUnit('cubic met(re|er)s?', CUBIC_METRE, 'cubic metres', 1, true);
    this.addUnit('cubic kilomet(re|er)s?', CUBIC_METRE, 'cubic kilometres', 1e9, true);
    this.addUnit('cubic decimet(re|er)s?', CUBIC_METRE, 'cubic decimetres', 1e-3, false/*true*/); // Metric, but not commonly used
    this.addUnit('cubic centimet(re|er)s?', CUBIC_METRE, 'cubic centimetres', 1e-6, true);
    this.addUnit('cubic millimet(re|er)s?', CUBIC_METRE, 'cubic millimetres', 1e-9, true);
    this.addUnit('cubic micromet(re|er)s?', CUBIC_METRE, 'cubic micrometres', 1e-18, true);
    this.addUnit('cubic nanomet(re|er)s?', CUBIC_METRE, 'cubic nanometres', 1e-27, true);

    this.addUnit('lit(re|er)s?', LITRE, 'litres', 1, true);
    this.addUnit('millilit(re|er)s?', LITRE, 'millilitres', 1e-3, true);

    this.addUnit('qt\\.', IMP_QUART, 'qt.', 1, false);
    this.addUnit('gal', IMP_GALLON, 'gal', 1, false);
    this.addUnit('pt', IMP_PINT, 'pt', 1, false);
    this.addUnit('(?:fl.? oz.?|oz. fl.)', IMP_FL_OUNCE, 'fl oz', 1, false);

    this.addUnit('quarts?', IMP_QUART, 'quarts', 1, false);
    this.addUnit('gallons?', IMP_GALLON, 'gallons', 1, false);
    this.addUnit('pints?', IMP_PINT, 'pints', 1, false);
    this.addUnit('(fluid )?ounces?', IMP_FL_OUNCE, 'fluid ounces', 1, false);
  }

  override getId(): string {
    return 'METRIC_UNITS_EN_IMPERIAL';
  }
}
