// UnitConversionRuleTest, UnitConversionRuleUSTest, UnitConversionRuleImperialTest (en) with
// UnitConversionRuleTestHelper (core). The rules read only the sentence text, so the English test
// language analyzes the sentences for all three (upstream uses en, en-US and en-GB).
import { describe, expect, it } from 'vitest';
import { english } from './testEnglish.ts';
import type { AbstractUnitConversionRule } from '../../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/AbstractUnitConversionRule.ts';
import { UnitConversionRule } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/UnitConversionRule.ts';
import { UnitConversionRuleUS } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/UnitConversionRuleUS.ts';
import { UnitConversionRuleImperial } from '../../../../src/languagetool/languagetool/languagetool-language-modules/en/org/languagetool/rules/en/UnitConversionRuleImperial.ts';
import { NumberFormat } from '../../../../src/languagetool/jdk/java/text/NumberFormat.ts';
import { RoundingMode } from '../../../../src/languagetool/jdk/java/math/RoundingMode.ts';
import { Locale } from '../../../../src/languagetool/jdk/java/util/Locale.ts';
import { URLEncoder } from '../../../../src/languagetool/jdk/java/net/URLEncoder.ts';

/** UnitConversionRuleTestHelper.assertMatches */
function assertMatches(input: string, expectedMatches: number, converted: string | null, rule: AbstractUnitConversionRule): void {
  const matches = rule.match(english().lt.getAnalyzedSentence(input));
  expect(matches.length, 'Got matches: ' + matches.map(String).join(', ')).toBe(expectedMatches);
  if (expectedMatches > 0 && converted != null) {
    const match = matches[0]!;
    const suggestion = match.getSuggestedReplacements().find((s) => s.includes(converted)) ?? null;
    expect(suggestion != null, 'Suggestion is correct: ' + match.getSuggestedReplacements().join(' | ') + ' / expected: ' + converted).toBe(true);
  }
}

describe('UnitConversionRuleTest', () => {
  it('match', () => {
    const rule = new UnitConversionRule(english().messages);
    assertMatches('I am 6 feet tall.', 1, '1.83 m', rule);
    assertMatches('I am 6 feet (2.02 m) tall.', 1, '1.83 m', rule);
    assertMatches('I am 6 feet (1.82 m) tall.', 0, null, rule);
    assertMatches('Heat up to 18 °C (64.4 °F).', 0, null, rule);
    assertMatches('Heat up to 18 °C (64.4 °F).', 0, null, rule);
    assertMatches('Heat up to 18 °C (64.4 °F).', 0, null, rule);
    assertMatches('The path is 100 miles long.', 1, '160.93 km', rule);
    assertMatches('The path is 100 miles (160.93 km) long.', 0, null, rule);
    assertMatches('The shipment weighs 10,000.75 pounds.', 1, '4.54 t', rule);
    assertMatches('She is 5\'6".', 1, '1.68 m', rule);
    assertMatches('My new apartment is 500 sq ft.', 1, '46.45 m²', rule);
    assertMatches('It is 100 degrees Fahrenheit outside.', 1, '37.78 °C', rule);
    assertMatches('It is 100 °F outside.', 1, '37.78 °C', rule);
    assertMatches('It is -22 °F outside.', 1, '-30 °C', rule);
    assertMatches('It is -22 degrees Fahrenheit outside.', 1, '-30 °C', rule);

    // https://github.com/languagetool-org/languagetool/issues/2357
    assertMatches("Millions watched the 1989's Superbowl.", 0, null, rule);

    // https://github.com/languagetool-org/languagetool/issues/2255
    assertMatches('Coordinates: 34°09′22″N 118°7′55″W', 0, null, rule);
  });
});

describe('UnitConversionRuleUSTest', () => {
  it('match', () => {
    const rule = new UnitConversionRuleUS(english().messages);
    assertMatches('I just drank 3 pints.', 1, '1.42 l', rule);
    assertMatches('I am 6 feet (2.02 m) tall.', 1, '1.83 meters', rule);
    assertMatches('16 kilometers (10 miles)', 1, null, rule);
    assertMatches('16 kilometers (ca. 10 miles)', 0, null, rule);
    assertMatches('16 kilometers (9.94 mi)', 0, null, rule);
    // matched by antipattern;
    assertMatches('Use 3-5 pounds of butter.', 0, null, rule);
    assertMatches("It's 1/4 mile away", 0, null, rule);
    assertMatches('A 2:1 cup', 0, null, rule);
    assertMatches('1⁄4 cup', 0, null, rule);
    // matched by special case in the case as long as "x ft y inch" is not parsed properly:
    assertMatches('It is 0.76 metres (2 ft 6 inch)', 0, null, rule);
  });
});

describe('UnitConversionRuleImperialTest', () => {
  it('match', () => {
    const rule = new UnitConversionRuleImperial(english().messages);
    assertMatches('I just drank 3 pints.', 1, '1.7 l', rule);
    assertMatches('I am 6 feet (2.02 m) tall.', 1, '1.83 metres', rule);
  });
});

// Not upstream: the JDK stand-ins the rules use.
describe('NumberFormat, URLEncoder (jdk stand-ins)', () => {
  it('formats and parses like Java\'s English number instance', () => {
    const f = NumberFormat.getNumberInstance(Locale.US);
    f.setMaximumFractionDigits(2);
    f.setRoundingMode(RoundingMode.HALF_UP);
    expect(f.format(1234567.891)).toBe('1,234,567.89');
    expect(f.format(0.125)).toBe('0.13');   // exactly representable: a tie, rounded up
    expect(f.format(1.005)).toBe('1');      // 1.00499999999999989...
    expect(f.format(-0.001)).toBe('-0');    // Java keeps the sign
    expect(f.format(160.9344)).toBe('160.93');
    expect(f.format(37)).toBe('37');
    expect(f.parse('10,000.75')).toBe(10000.75);
    expect(f.parse('5.5.')).toBe(5.5);
    expect(f.parse('-22')).toBe(-22);
    expect(f.parse('12,')).toBe(12);
    expect(() => f.parse('-')).toThrow(/ParseException/);
    const even = NumberFormat.getNumberInstance(Locale.US);
    expect(even.format(0.0625)).toBe('0.062'); // HALF_EVEN, three digits
  });

  it('encodes like java.net.URLEncoder', () => {
    expect(URLEncoder.encode("convert 5'6\" (x) to metric!*~", 'utf-8')).toBe('convert+5%276%22+%28x%29+to+metric%21*%7E');
    expect(URLEncoder.encode('100 °F', 'utf-8')).toBe('100+%C2%B0F');
  });
});
