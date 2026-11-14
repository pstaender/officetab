// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/RuleOption.java partial
// The constructor and getters; the string encoding of option values (objectToString,
// objectsToString, stringToObject, stringToObjects), which tells Java's boxed number types apart,
// is left out. The two constructors are one; "defaultValue instanceof Integer, Character, Float or
// Double" is "a number or a one-character string".

/**
 * Class to configure rule option by option panel
 * @author Fred Kruse
 * @since 6.5
 */
export class RuleOption {

  static readonly DEFAULT_VALUE = 'defaultValue';
  static readonly DEFAULT_TYPE = 'defaultType';
  static readonly MIN_CONF_VALUE = 'minConfigurableValue';
  static readonly MAX_CONF_VALUE = 'maxConfigurableValue';
  static readonly CONF_TEXT = 'configureText';

  private readonly defaultValue: unknown;
  private readonly configureText: string;
  private readonly minConfigurableValue: unknown;
  private readonly maxConfigurableValue: unknown;

  constructor(defaultValue: unknown, configureText: string, minConfigurableValue: unknown = 0, maxConfigurableValue: unknown = 100) {
    this.defaultValue = defaultValue;
    this.configureText = configureText;
    if (minConfigurableValue != null && maxConfigurableValue != null &&
        (typeof defaultValue === 'number' || (typeof defaultValue === 'string' && defaultValue.length === 1))) {
      this.minConfigurableValue = minConfigurableValue;
      this.maxConfigurableValue = maxConfigurableValue;
    } else {
      this.minConfigurableValue = 0;
      this.maxConfigurableValue = 100;
    }
  }

  /**
   * Get a default Value by option panel
   */
  getDefaultValue(): unknown {
    return this.defaultValue;
  }

  /**
   * Get the Configuration Text by option panel
   */
  getConfigureText(): string {
    return this.configureText;
  }

  /**
   * Get the minimum of a configurable value
   */
  getMinConfigurableValue(): unknown {
    return this.minConfigurableValue;
  }

  /**
   * Get the maximum of a configurable value
   */
  getMaxConfigurableValue(): unknown {
    return this.maxConfigurableValue;
  }
}
