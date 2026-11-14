// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractUnitConversionRule.java faithful
// javax.measure and Indriya's units are a stand-in in jdk/javax/measure and jdk/tech/units/indriya
// (units equal by structure, as Indriya's). The maps keyed by Unit (unitSymbols) look units up by
// equals; Map.Entry<Integer, Integer> ranges are [start, end] pairs; the URL is a string; a
// MatchResult is the Matcher. Java iterates the HashMap specialPatterns in hash order (of identity
// hash codes, so in no fixed order); here in insertion order. matchesByStart is a HashMap with
// Integer keys, whose values() order is emulated (javaHashMapValues).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';
import { UnconvertibleException, type Unit } from '../../../../../jdk/javax/measure/Unit.ts';
import { CELSIUS, CUBIC_METRE, HOUR, KILOGRAM, KILOMETRE_PER_HOUR, LITRE, METRE, SQUARE_METRE } from '../../../../../jdk/tech/units/indriya/unit/Units.ts';
import { RoundingMode } from '../../../../../jdk/java/math/RoundingMode.ts';
import { URLEncoder } from '../../../../../jdk/java/net/URLEncoder.ts';
import { DecimalFormat, type NumberFormat, ParseException } from '../../../../../jdk/java/text/NumberFormat.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringMatches, type Matcher } from '../../../../../jdk/java/util/regex/Pattern.ts';

export const Message = {
  SUGGESTION: 'SUGGESTION',
  CHECK: 'CHECK',
  CHECK_UNKNOWN_UNIT: 'CHECK_UNKNOWN_UNIT',
  UNIT_MISMATCH: 'UNIT_MISMATCH',
} as const;
export type Message = typeof Message[keyof typeof Message];

type Range = [number, number];

/** HashMap<Unit, List<String>>, with keys compared by equals. */
class UnitMap<V> {
  private readonly entries: Array<[Unit, V]> = [];
  get(key: Unit): V | null {
    const e = this.entries.find(([k]) => k.equals(key));
    return e ? e[1] : null;
  }
  getOrDefault(key: Unit, defaultValue: V): V {
    return this.get(key) ?? defaultValue;
  }
  putIfAbsent(key: Unit, value: V): void {
    if (this.get(key) == null) this.entries.push([key, value]);
  }
}

/** The values of a java.util.HashMap<Integer, V> in its iteration order (bucket order, then insertion). */
function javaHashMapValues<V>(map: Map<number, V>, insertedKeys: number): V[] {
  let capacity = 16;
  while (insertedKeys > capacity * 0.75) capacity *= 2;
  const bucket = (key: number) => (key ^ (key >>> 16)) & (capacity - 1);
  return [...map.entries()]
    .map(([key, value], i) => ({ b: bucket(key), i, value }))
    .sort((a, b) => a.b - b.b || a.i - b.i)
    .map((e) => e.value);
}

/**
 * Base class providing support for detecting, parsing and converting between measurements in different units
 * @since 4.3
 */
export abstract class AbstractUnitConversionRule extends Rule {

  protected static readonly POUND: Unit = KILOGRAM.multiply(0.45359237);
  protected static readonly OUNCE: Unit = AbstractUnitConversionRule.POUND.divide(12);

  protected static readonly FEET: Unit = METRE.multiply(0.3048);
  protected static readonly YARD: Unit = AbstractUnitConversionRule.FEET.multiply(3);
  protected static readonly INCH: Unit = AbstractUnitConversionRule.FEET.divide(12);
  protected static readonly MILE: Unit = AbstractUnitConversionRule.FEET.multiply(5280);

  protected static readonly US_QUART: Unit = LITRE.multiply(0.946352946);
  protected static readonly US_GALLON: Unit = AbstractUnitConversionRule.US_QUART.multiply(4);
  protected static readonly US_PINT: Unit = AbstractUnitConversionRule.US_QUART.divide(2);
  protected static readonly US_CUP: Unit = AbstractUnitConversionRule.US_QUART.divide(4);
  protected static readonly US_FL_OUNCE: Unit = AbstractUnitConversionRule.US_QUART.divide(32);

  protected static readonly IMP_PINT: Unit = LITRE.multiply(0.5682612532);
  protected static readonly IMP_QUART: Unit = AbstractUnitConversionRule.IMP_PINT.multiply(2);
  protected static readonly IMP_GALLON: Unit = AbstractUnitConversionRule.IMP_QUART.multiply(4);
  protected static readonly IMP_FL_OUNCE: Unit = AbstractUnitConversionRule.IMP_PINT.divide(20);

  protected static readonly FAHRENHEIT: Unit = CELSIUS.multiply(5.0 / 9.0).shift(-32);
  // limit size of matched number to (possibly) avoid hangups
  // we need a different regex for including a word boundary (\b), instead of just prepending that
  // because otherwise negative numbers aren't correctly recognized
  protected static readonly NUMBER_REGEX = '(-?[0-9]{1,32}[0-9,.]{0,32})';
  protected static readonly NUMBER_REGEX_WITH_BOUNDARY = '(-?\\b[0-9]{1,32}[0-9,.]{0,32})';

  protected readonly numberRangePart = Pattern.compile(AbstractUnitConversionRule.NUMBER_REGEX_WITH_BOUNDARY + '$');

  private static readonly DELTA = 1e-2;
  private static readonly ROUNDING_DELTA = 0.05;
  private static readonly MAX_SUGGESTIONS = 5;
  private static readonly WHITESPACE_LIMIT = 5;

  protected unitPatterns = new Map<Pattern, Unit>();  // use LinkedHashMap for stable iteration order

  // for patterns that require a custom number parsing function
  protected specialPatterns = new Map<Pattern, [Unit, (match: Matcher) => number | null]>();
  protected unitSymbols = new UnitMap<string[]>();
  // for recognizing conversions made by this rule or the user
  protected convertedPatterns: Pattern[] = [];
  // units to use for conversions
  protected readonly metricUnits: Unit[] = [];

  private static antiPatternsValue: Pattern[] | null = null;
  private static get antiPatterns(): Pattern[] {
    return (AbstractUnitConversionRule.antiPatternsValue ??= [
          Pattern.compile("\\s?\\d+'\\d\\d\\d\\s?"),   // "100'000", thousands separator in de-CH
          Pattern.compile('\\d+[-‐–]\\d+'),   // "3-5 pounds"
          Pattern.compile('\\d+/\\d+'),   // "1/4 mile"
          Pattern.compile('\\d+:\\d+'),   // "A 2:1 cup"
          Pattern.compile('Pfund Sterling'),   // "1.800 Pfund Sterling" (German)
          Pattern.compile('\\d+⁄\\d+'),    // "1⁄4 cup" (it's not the standard slash)
    ]);
  }

  private buildURLForExplanation(original: string): string | null {
    try {
      const query = URLEncoder.encode('convert ' + original + ' to metric', 'utf-8');
      return 'http://www.wolframalpha.com/input/?i=' + query;
    } catch {
      return null;
    }
  }

  /**
   * Override in subclasses
   * @return locale-specific number format
   */
  protected getNumberFormat(): NumberFormat {
    const df = new DecimalFormat();
    df.setMaximumFractionDigits(2);
    df.setRoundingMode(RoundingMode.HALF_UP);
    return df;
  }

  /**
   * Override in subclasses
   */
  protected getMessage(message: Message): string {
    switch (message) {
      case Message.CHECK:
        return "This unit conversion doesn't seem right. Do you want to correct it automatically?";
      case Message.SUGGESTION:
        return 'Writing for an international audience? Consider adding the metric equivalent.';
      case Message.CHECK_UNKNOWN_UNIT:
        return "This unit conversion doesn't seem right, unable to recognize the used unit.";
      case Message.UNIT_MISMATCH:
        return "These units don't seem to be compatible.";
      default:
        throw new Error('RuntimeException: Unknown message type: ' + message);
    }
  }

  /**
   * Override in subclasses
   */
  protected getShortMessage(message: Message): string {
    switch (message) {
      case Message.CHECK:
        return 'Incorrect unit conversion. Correct it?';
      case Message.SUGGESTION:
        return 'Add metric equivalent?';
      case Message.CHECK_UNKNOWN_UNIT:
        return 'Unknown unit used in conversion.';
      case Message.UNIT_MISMATCH:
        return 'Units incompatible.';
      default:
        throw new Error('RuntimeException: Unknown message type: ' + message);
    }
  }

  /**
   * Format suggestion.
   * @param original matched in the text
   * @param converted computed by this rule
   */
  protected getSuggestion(original: string, converted: string): string {
    return original + ' (' + converted + ')';
  }

  /**
   * Override in subclasses.
   * @return formatting of rounded numbers according to locale
   */
  protected formatRounded(s: string): string {
    return 'ca. ' + s;
  }

  /**
   * Associate a notation with a given unit.
   * @param pattern Regex for recognizing the unit. Word boundaries and numbers are added to this pattern by addUnit itself.
   * @param base Unit to associate with the pattern
   * @param symbol Suffix used for suggestion.
   * @param factor Convenience parameter for prefixes for metric units, unit is multiplied with this. Defaults to 1 if not used.
   * @param metric Register this notation for suggestion.
   */
  protected addUnit(pattern: string, base: Unit, symbol: string, factor: number, metric: boolean): void {
    const unit = base.multiply(factor);
    this.unitPatterns.set(Pattern.compile(AbstractUnitConversionRule.NUMBER_REGEX_WITH_BOUNDARY + '[\\s ]{0,' + AbstractUnitConversionRule.WHITESPACE_LIMIT + '}' + pattern + '\\b'), unit);
    this.unitSymbols.putIfAbsent(unit, []);
    this.unitSymbols.get(unit)!.push(symbol);
    if (metric && !this.metricUnits.some((u) => u.equals(unit))) {
      this.metricUnits.push(unit);
    }
  }

  protected constructor(messages: ResourceBundle) {
    super();
    this.setCategory(Categories.STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Style);

    const { POUND, MILE, YARD, FEET, INCH, FAHRENHEIT } = AbstractUnitConversionRule;
    this.addUnit('kg', KILOGRAM, 'kg', 1e0, true);
    this.addUnit('g', KILOGRAM, 'g', 1e-3, true);
    this.addUnit('t', KILOGRAM, 't', 1e3, true);

    this.addUnit('lb', POUND, 'lb', 1, false);
    //addUnit("oz", OUNCE, "oz", 1, false); -- probably not useful, see https://github.com/languagetooler-gmbh/languagetool-premium/issues/4560

    this.addUnit('mi', MILE, 'mi', 1, false);
    this.addUnit('yd', YARD, 'yd', 1, false);
    // negative lookahead here to avoid matching "'s" and so on
    this.addUnit("(?:ft|′|')(?!(\\w|\\d))", FEET, 'ft', 1, false);
    // removed 'in', " because of many false positives
    this.addUnit('(?:inch|″)(?!(\\w|\\d))', INCH, 'inch', 1, false);

    this.addUnit('(?:km/h|kmh)', KILOMETRE_PER_HOUR, 'km/h', 1, true);
    this.addUnit('(?:mph)', MILE.divide(HOUR), 'mph', 1, false);

    this.addUnit('km', METRE, 'km', 1e3, true);
    this.addUnit('m', METRE, 'm',   1e0, true);
    //addUnit("dm", METRE, "dm", 1e-1,  /*true*/); // Metric, but not commonly used
    this.addUnit('cm', METRE, 'cm', 1e-2, true);
    this.addUnit('mm', METRE, 'mm', 1e-3, true);
    this.addUnit('µm', METRE, 'µm', 1e-6, true);
    this.addUnit('nm', METRE, 'nm', 1e-9, true);

    this.addUnit('m(?:\\^2|2|²)', SQUARE_METRE, 'm²', 1, true);
    this.addUnit('ha', SQUARE_METRE, 'ha', 1e4, true);
    this.addUnit('a', SQUARE_METRE, 'a', 1e2, true);
    this.addUnit('km(?:\\^2|2|²)', SQUARE_METRE, 'km²', 1e6, true);
    //addUnit("dm(?:\\^2|2|²)", SQUARE_METRE, "dm²", 1e-2,  false/*true*/); // Metric, but not commonly used
    this.addUnit('cm(?:\\^2|2|²)', SQUARE_METRE, 'cm²', 1e-4, true);
    this.addUnit('mm(?:\\^2|2|²)', SQUARE_METRE, 'mm²', 1e-6, true);
    this.addUnit('µm(?:\\^2|2|²)', SQUARE_METRE, 'µm²', 1e-12, true);
    this.addUnit('nm(?:\\^2|2|²)', SQUARE_METRE, 'nm²', 1e-18, true);

    this.addUnit('(?:sq|square) (?:in(?:ch)?|inches)', INCH.multiply(INCH), 'sq in', 1, false);
    this.addUnit('(?:inches|in|inch) (?:\\^2|2|²)', INCH.multiply(INCH), 'in²', 1, false);

    this.addUnit('(?:sq|square) (?:ft|feet|foot)', FEET.multiply(FEET), 'sq ft', 1, false);
    this.addUnit('sf', FEET.multiply(FEET), 'sf', 1, false);
    this.addUnit('ft(?:\\^2|2|²)', FEET.multiply(FEET), 'ft²', 1, false);

    this.addUnit('(?:sq|square) (?:yds?|yards?)', YARD.multiply(YARD), 'sq yd', 1, false);
    this.addUnit('(?:yards?|yds?)(?:\\^2|2|²)', YARD.multiply(YARD), 'yd²', 1, false);

    this.addUnit('m(?:\\^3|3|³)', CUBIC_METRE, 'm³', 1, true);
    this.addUnit('km(?:\\^3|3|³)', CUBIC_METRE, 'km³', 1e9, true);
    //addUnit("dm(?:\\^3|3|³)", CUBIC_METRE, "dm³", 1e-3,  false/*true*/); // Metric, but not commonly used
    this.addUnit('cm(?:\\^3|3|³)', CUBIC_METRE, 'cm³', 1e-6, true);
    this.addUnit('mm(?:\\^3|3|³)', CUBIC_METRE, 'mm³', 1e-9, true);
    this.addUnit('µm(?:\\^3|3|³)', CUBIC_METRE, 'µm³', 1e-18, true);
    this.addUnit('nm(?:\\^3|3|³)', CUBIC_METRE, 'nm³', 1e-27, true);

    this.addUnit('(?:cubic|cu) (?:feet|ft|foot)', FEET.multiply(FEET).multiply(FEET), 'cubic feet', 1, false);
    this.addUnit('(?:feet|ft|foot)(?:\\^3|3|³)', FEET.multiply(FEET).multiply(FEET), 'ft³', 1, false);

    this.addUnit('(?:cubic|cu) (?:inch|in|inches)', INCH.multiply(INCH).multiply(INCH), 'cubic inch', 1, false);
    this.addUnit('(?:inch|in)(?:\\^3|3|³)', INCH.multiply(INCH).multiply(INCH), 'inch³', 1, false);

    this.addUnit('(?:cubic|cu) (?:yards?|yds?)', YARD.multiply(YARD).multiply(YARD), 'cubic yard', 1, false);
    this.addUnit('(?:yard|yd)(?:\\^3|3|³)', YARD.multiply(YARD).multiply(YARD), 'yard³', 1, false);

    this.addUnit('l', LITRE, 'l', 1, true);
    this.addUnit('ml', LITRE, 'ml', 1e-3, true);

    this.addUnit('°F', FAHRENHEIT, '°F', 1, false);
    this.addUnit('°C', CELSIUS, '°C', 1, true);

    this.convertedPatterns.push(Pattern.compile('\\s*\\((?:ca. )?' + AbstractUnitConversionRule.NUMBER_REGEX + '\\s*([^)]+)\\s*\\)'));

    // recognizes 5'6" = 5 feet + 6 inches = 5.5 feet
    const parseFeetAndInch = (match: Matcher): number | null => {
      let feet: number, inch: number;
      try {
        feet = this.getNumberFormat().parse(match.group(1)!);
      } catch (e) {
        if (e instanceof ParseException) return null;
        throw e;
      }
      try {
        inch = this.getNumberFormat().parse(match.group(2)!);
      } catch (e) {
        if (!(e instanceof ParseException)) throw e;
        inch = 0.0;
      }
      return feet + inch / 12.0;
    };
    const feetAndInchEntry: [Unit, (match: Matcher) => number | null] = [FEET, parseFeetAndInch];
    this.specialPatterns.set(Pattern.compile("(?:(?<=[^º°\\d]))\\s(\\d+)(?:ft|′|')\\s*(\\d+)\\s*(?:in|\"|″)?"), feetAndInchEntry);
    this.specialPatterns.set(Pattern.compile("(?:(?<=[^º°\\d\\s]))(\\d+)(?:ft|′|')\\s*(\\d+)\\s*(?:in|\"|″)?"), feetAndInchEntry);
  }

  /**
   * @param value number to convert
   * @param unit unit used in text
   * @return suggestions of the given number converted into metric units, sorted by naturalness
   *         or null if conversion is not necessary / was not possible
   */
  protected getMetricEquivalent(value: number, unit: Unit): Array<[Unit, number]> | null {
    const conversions: Array<[Unit, number]> = [];
    for (const metric of this.metricUnits) {
      if (unit.equals(metric)) { // don't convert to itself
        return null;
      }
      if (unit.isCompatible(metric)) {
        const converted = unit.getConverterTo(metric).convert(value);
        conversions.push([metric, converted]);
      }
    }
    this.sortByNaturalness(conversions);
    if (conversions.length === 0) {
      return null;
    } else {
      return conversions;
    }
  }

  protected formatMeasurement(value: number, unit: Unit): string[] | null {
    const equivalents = this.getMetricEquivalent(value, unit);
    if (equivalents == null) {
      return null;
    }
    const formatted = this.getFormattedConversions(equivalents);
    if (formatted.length === 0) {
      return null;
    }
    return formatted;
  }

  /**
   * Adds different formatted variants of the given conversions up to MAX_SUGGESTIONS.
   * @param conversions as computed by getMetricEquivalent
   * @return formatted numbers, with various units and unit symbols, rounded to integers or according to getNumberFormat
   */
  private getFormattedConversions(conversions: Array<[Unit, number]>): string[] {
    const formatted: string[] = [];
    for (const equivalent of conversions) {
      const metric = equivalent[0];
      const converted = equivalent[1];
      const rounded = javaMathRound(converted);
      for (const symbol of this.unitSymbols.getOrDefault(metric, [])) {
        if (formatted.length > AbstractUnitConversionRule.MAX_SUGGESTIONS) {
          break;
        }
        if (Math.abs(converted - rounded) / Math.abs(converted) < AbstractUnitConversionRule.ROUNDING_DELTA && rounded !== 0) {
          const formattedStr = this.formatRounded(this.getNumberFormat().format(rounded) + ' ' + symbol);
          if (!formatted.includes(formattedStr)) {
            formatted.push(formattedStr);
          }
        }
        const formattedNumber = this.getNumberFormat().format(converted);
        const formattedStr = formattedNumber + ' ' + symbol;
        // TODO: be cleverer than !equals("0"), can prevent valid conversions
        if (!formatted.includes(formattedStr) && formattedNumber !== '0') {
          formatted.push(formattedStr);
        }
      }
    }
    return formatted;
  }

  private sortByNaturalness(conversions: Array<[Unit, number]>): void {
    conversions.sort((a, b) => { // sort according to "naturalness" of this unit, i.e. numbers not being too small/large
      const naturalness = (number: number): number => { // smaller score -> better
        const abs = Math.abs(number);
        if (abs < 1.0) {
          return 1.0 / (abs * abs * 2);
        } else if (abs < 100) {
          return abs - 50;
        } else {
          return abs * abs;
        }
      };
      const scoreA = naturalness(a[1]);
      const scoreB = naturalness(b[1]);
      return javaDoubleCompare(scoreA, scoreB);
    });
  }

  private matchUnits(sentence: AnalyzedSentence, matches: RuleMatch[], ignoreRanges: Range[], isMetric: boolean): void {
    for (const unitPattern of this.unitPatterns.keys()) { // find specific unit through lookup of pattern
      const patternUnit = this.unitPatterns.get(unitPattern)!;
      if (this.metricUnits.some((u) => u.equals(patternUnit)) !== isMetric) {
        continue;
      }
      const unitMatcher = unitPattern.matcher(sentence.getText());
      while (unitMatcher.find()) {
        let ignore = false;
        for (const range of ignoreRanges) {
          if (unitMatcher.start() >= range[0] && unitMatcher.end() <= range[1]) {
            ignore = true;
            break;
          }
        }
        if (!ignore) {
          this.tryConversion(sentence, matches, unitPattern, null, null, unitMatcher, ignoreRanges);
        }
      }
    }
  }


  protected detectNumberRange(sentence: AnalyzedSentence, matcher: Matcher): boolean {
    const hyphenInNumber = matcher.group(1)!.startsWith('-');
    if (!hyphenInNumber) {
      return false;
    }
    const textBefore = sentence.getText().substring(0, matcher.start());
    return this.numberRangePart.matcher(textBefore).find();
  }

  private tryConversion(sentence: AnalyzedSentence, matches: RuleMatch[], unitPattern: Pattern, customValue: number | null,
                        customUnit: Unit | null, unitMatcher: Matcher, ignoreRanges: Range[]): void {
    const range: Range = [unitMatcher.start(), unitMatcher.end()];
    ignoreRanges.push(range);
    // search for an existing conversion, e.g. "5 miles (8km)"
    let convertedInText: string | null = null;
    const convertedOffset = unitMatcher.end();
    let convertedMatcher: Matcher | null = null;
    for (const convertedPattern of this.convertedPatterns) {
      convertedMatcher = convertedPattern.matcher(sentence.getText().substring(convertedOffset));
      if (convertedMatcher.find() && convertedMatcher.start() === 0) {
        convertedInText = convertedMatcher.group(0);
        break;
      }
    }
    // customValue/unit are used with patterns in specialPatterns, where unit and value are already extracted
    const unit = (this.unitPatterns.get(unitPattern) ?? customUnit)!;
    let value: number;
    if (customValue == null) {
      try {
        let valueAsString = unitMatcher.group(1)!;
        // remove hyphen at start if it belongs to a range (e.g 1-5 miles)
        // see https://github.com/languagetool-org/languagetool/issues/2170
        // TODO convert whole range, not only end
        if (this.detectNumberRange(sentence, unitMatcher)) {
          valueAsString = valueAsString.substring(1);
        }
        value = this.getNumberFormat().parse(valueAsString);
      } catch (e) {
        if (e instanceof ParseException) return;
        throw e;
      }
    } else {
      value = customValue;
    }
    const converted = this.formatMeasurement(value, unit);
    if (converted == null && convertedInText == null) {
      // no conversion necessary, e.g. already metric
    } else if (convertedInText == null) { // no conversion found -> suggest one
      const match = new RuleMatch(this, sentence, unitMatcher.start(), unitMatcher.end(),
        this.getMessage(Message.SUGGESTION), this.getShortMessage(Message.SUGGESTION));
      const group0 = unitMatcher.group(0)!;
      const suggestions = converted!
        .map((formatted) => this.getSuggestion(group0, formatted));
      match.setSuggestedReplacements(suggestions);
      match.setUrl(this.buildURLForExplanation(group0));
      matches.push(match);
    } else { // check given conversion for accuracy
      const cm = convertedMatcher!;
      const convertedRange: Range = [cm.start(0) + convertedOffset, cm.end(0) + convertedOffset];
      ignoreRanges.push(convertedRange);

      // already using one of our conversions?
      const finalConvertedInText = StringTrim(convertedInText);
      const convertedTrimmed = finalConvertedInText.substring(1, finalConvertedInText.length - 1);
      if (converted != null && converted.some((s) => s === convertedTrimmed)) {
        return;
      }
      const convertedUnitPattern = [...this.unitPatterns.keys()]
        .find((pattern) => pattern.matcher(finalConvertedInText).find()) ?? null;
      if (convertedUnitPattern != null) { // known unit used for conversion
        const convertedUnit = this.unitPatterns.get(convertedUnitPattern)!;
        // If the unit before and after conversion is the same, e.g. "22.3 cm (20.4 cm)", assume users either:
        // 1. know what they're doing; or
        // 2. there's a more complex expression at play here, which we can't parse
        if (unit.equals(convertedUnit)) {
          return;
        }
        let convertedValueInText: number;
        try {
          convertedValueInText = this.getNumberFormat().parse(cm.group(1)!);
          if (StringMatches(StringTrim(cm.group()!), '\\(\\d+ (feet|ft) \\d+ inch\\)')) {
            // e.g. "(2 ft 6 inch)" would be interpreted as just "2 ft", given a wrong suggestion
            return;
          }
        } catch (e) {
          if (e instanceof ParseException) return;
          throw e;
        }
        if (converted == null) { // already metric, check conversion in convertedUnit / convertedValueInText (order may be reversed)
          let reverseConverted: string[] | null = null;
          try {
            const unitConverted = unit.getConverterTo(convertedUnit).convert(value);
            const diff = Math.abs(unitConverted - convertedValueInText);
            if (diff > AbstractUnitConversionRule.DELTA) {
              const match = new RuleMatch(this, sentence,
                cm.start(1) + convertedOffset, cm.end(1) + convertedOffset,
                this.getMessage(Message.CHECK), this.getShortMessage(Message.CHECK));
              match.setUrl(this.buildURLForExplanation(convertedTrimmed));
              const numbers: Array<[Unit, number]> = [];
              numbers.push([convertedUnit, unitConverted]);
              reverseConverted = this.getFormattedConversions(numbers);
              if (reverseConverted.some((s) => s === convertedTrimmed)) {
                return;
              }
              match.setSuggestedReplacements(reverseConverted);
              matches.push(match);
            }
          } catch (e) {
            if (!(e instanceof UnconvertibleException)) throw e;
            const match = new RuleMatch(this, sentence, unitMatcher.start(), cm.end() + convertedOffset,
              this.getMessage(Message.UNIT_MISMATCH), this.getShortMessage(Message.UNIT_MISMATCH));
            if (reverseConverted != null) {
              match.setSuggestedReplacements(reverseConverted);
            }
            match.setUrl(this.buildURLForExplanation(convertedTrimmed));
            matches.push(match);
          }
        } else { // found conversion to metric, check for accuracy
          const metricEquivalents = this.getMetricEquivalent(value, unit);
          if (metricEquivalents == null || metricEquivalents.length === 0) {
            return;
          }
          const metricEquivalent = metricEquivalents[0]!;
          const metricUnit = metricEquivalent[0];
          const convertedValueComputed = metricEquivalent[1];
          const original = unitMatcher.group(0)!;
          const corrected = converted
            .map((suggestion) => this.getSuggestion(original, suggestion));
          if (!(convertedUnit.equals(metricUnit) && Math.abs(convertedValueInText - convertedValueComputed) < AbstractUnitConversionRule.DELTA)) {
            const match = new RuleMatch(this, sentence,
              unitMatcher.start(), cm.end(0) + convertedOffset,
              this.getMessage(Message.CHECK), this.getShortMessage(Message.CHECK));
            match.setSuggestedReplacements(corrected);
            match.setUrl(this.buildURLForExplanation(unitMatcher.group(0)!));
            matches.push(match);
          }
        }
      } else if (converted != null) { // unknown unit used for conversion
        const match = new RuleMatch(this, sentence,
          cm.start(1) + convertedOffset, cm.end(2) + convertedOffset,
          this.getMessage(Message.CHECK_UNKNOWN_UNIT), this.getShortMessage(Message.CHECK_UNKNOWN_UNIT));
        match.setSuggestedReplacements(converted);
        matches.push(match);
      }
    }
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches: RuleMatch[] = [];
    const ignoreRanges: Range[] = [];

    // handle special patterns where simple number parsing is not enough, e.g. 5'6"
    for (const specialPattern of this.specialPatterns.keys()) {
      const matcher = specialPattern.matcher(sentence.getText());
      while (matcher.find()) {
        const result = matcher;
        const value = this.specialPatterns.get(specialPattern)![1](result);
        const unit = this.specialPatterns.get(specialPattern)![0];
        if (value == null) {
          continue;
        }
        let ignore = false;
        for (const range of ignoreRanges) {
          if (matcher.start() >= range[0] && matcher.end() <= range[1]) {
            ignore = true;
            break;
          }
        }
        if (!ignore) {
          this.tryConversion(sentence, matches, specialPattern, value, unit, matcher, ignoreRanges);
        }
      }
    }

    // check for numbers with a given set of units (e.g. imperial)

    // two runs: first metric units, so that ignore ranges are set up properly
    // then match other units
    // should fix sentences like 10 km (5 miles), where 5 miles matches first and matching 10 km first would have prevented that
    // there should be no influence on other results
    this.matchUnits(sentence, matches, ignoreRanges, true);
    this.matchUnits(sentence, matches, ignoreRanges, false);
    const matchesByStart = new Map<number, RuleMatch>();
    // deduplicate matches with equal start, longer match should win, e.g. miles per hour over just miles
    for (const match of matches) {
      const other = matchesByStart.get(match.getFromPos());
      matchesByStart.set(match.getFromPos(),
        other == null ? match :
        match.getToPos() > other.getToPos() ? match : other);
    }
    const insertedKeys = matchesByStart.size;
    if (matches.length > 0) {
      this.removeAntiPatternMatches(sentence, matchesByStart);
    }
    return javaHashMapValues(matchesByStart, insertedKeys);
  }

  private removeAntiPatternMatches(sentence: AnalyzedSentence, matchesByStart: Map<number, RuleMatch>): void {
    for (const antiPattern of AbstractUnitConversionRule.antiPatterns) {
      const text = sentence.getText();
      const matcher = antiPattern.matcher(text);
      let pos = 0;
      while (pos < text.length && matcher.find(pos)) {
        for (const [key, value] of [...matchesByStart.entries()]) {
          if (matcher.start() <= value.getFromPos() && matcher.end() >= value.getFromPos() ||
                matcher.start() <= value.getToPos() && matcher.end() >= value.getToPos()) {
            matchesByStart.delete(key);
          }
        }
        pos = matcher.end() + 1;
      }
    }
  }

}

/** Math.round(double): floor(x + 0.5), as a long. */
function javaMathRound(x: number): number {
  return Math.floor(x + 0.5);
}

/** Double.compare */
function javaDoubleCompare(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  return 0;
}
