// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/TokenizerFactory.java partial
// Left out: the programmatic constructor and create(subclassName, ...) (used to train a model).
// The class registers itself with ExtensionLoader under its Java name (see there).
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import type { Dictionary } from '../dictionary/Dictionary.ts';
import { BaseToolFactory } from '../util/BaseToolFactory.ts';
import { ExtensionLoader } from '../util/ext/ExtensionLoader.ts';
import { InvalidFormatException } from '../util/InvalidFormatException.ts';
import { Factory } from './lang/Factory.ts';
import type { TokenContextGenerator } from './TokenContextGenerator.ts';

/**
 * The factory that provides Tokenizer default implementations and
 * resources. Users can extend this class if their application requires
 * overriding the TokenContextGenerator, Dictionary etc.
 */
export class TokenizerFactory extends BaseToolFactory {
  private languageCode: string | null = null;
  private abbreviationDictionary: Dictionary | null = null;
  private useAlphaNumericOptimization = false;
  private alphaNumericPattern: Pattern | null = null;

  private static readonly ABBREVIATIONS_ENTRY_NAME = 'abbreviations.dictionary';
  private static readonly USE_ALPHA_NUMERIC_OPTIMIZATION = 'useAlphaNumericOptimization';
  private static readonly ALPHA_NUMERIC_PATTERN = 'alphaNumericPattern';

  validateArtifactMap(): void {
    const provider = this.artifactProvider!;
    if (provider.getManifestProperty(TokenizerFactory.USE_ALPHA_NUMERIC_OPTIMIZATION) == null)
      throw new InvalidFormatException(TokenizerFactory.USE_ALPHA_NUMERIC_OPTIMIZATION
          + ' is a mandatory property!');

    const abbreviationsEntry = provider.getArtifact<unknown>(TokenizerFactory.ABBREVIATIONS_ENTRY_NAME);

    if (abbreviationsEntry != null && !(typeof abbreviationsEntry === 'object' && 'asStringSet' in abbreviationsEntry)) {
      throw new InvalidFormatException("Abbreviations dictionary '" + abbreviationsEntry +
              "' has wrong type, needs to be of type Dictionary!");
    }
  }

  /**
   * Gets the alpha numeric pattern.
   *
   * @return the user specified alpha numeric pattern or a default.
   */
  getAlphaNumericPattern(): Pattern {
    if (this.alphaNumericPattern == null) {
      if (this.artifactProvider != null) {
        const prop = this.artifactProvider.getManifestProperty(TokenizerFactory.ALPHA_NUMERIC_PATTERN);
        if (prop != null) {
          this.alphaNumericPattern = Pattern.compile(prop);
        }
      }
      // could not load from manifest, will get from language dependent factory
      if (this.alphaNumericPattern == null) {
        const f = new Factory();
        this.alphaNumericPattern = f.getAlphanumeric(this.languageCode);
      }
    }
    return this.alphaNumericPattern;
  }

  /**
   * Gets whether to use alphanumeric optimization.
   *
   * @return true if the alpha numeric optimization is enabled, otherwise false
   */
  isUseAlphaNumericOptmization(): boolean {
    if (this.artifactProvider != null) {
      // Boolean.valueOf
      this.useAlphaNumericOptimization = (this.artifactProvider
          .getManifestProperty(TokenizerFactory.USE_ALPHA_NUMERIC_OPTIMIZATION) ?? '').toLowerCase() === 'true';
    }
    return this.useAlphaNumericOptimization;
  }

  /**
   * Gets the abbreviation dictionary
   *
   * @return null or the abbreviation dictionary
   */
  getAbbreviationDictionary(): Dictionary | null {
    if (this.abbreviationDictionary == null && this.artifactProvider != null) {
      this.abbreviationDictionary = this.artifactProvider.getArtifact<Dictionary>(TokenizerFactory.ABBREVIATIONS_ENTRY_NAME);
    }
    return this.abbreviationDictionary;
  }

  /**
   * Retrieves the language code.
   */
  getLanguageCode(): string | null {
    if (this.languageCode == null && this.artifactProvider != null) {
      this.languageCode = this.artifactProvider.getLanguage();
    }
    return this.languageCode;
  }

  /**
   * Gets the context generator
   *
   * @return a new instance of the context generator
   */
  getContextGenerator(): TokenContextGenerator {
    const f = new Factory();
    let abbs: ReadonlySet<string>;
    const abbDict = this.getAbbreviationDictionary();
    if (abbDict != null) {
      abbs = abbDict.asStringSet();
    } else {
      abbs = new Set();
    }
    return f.createTokenContextGenerator(this.getLanguageCode(), abbs);
  }
}

ExtensionLoader.registerExtension('opennlp.tools.tokenize.TokenizerFactory', TokenizerFactory);
