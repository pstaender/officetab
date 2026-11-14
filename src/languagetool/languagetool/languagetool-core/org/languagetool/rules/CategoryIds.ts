// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/CategoryIds.java faithful
import { CategoryId } from './CategoryId.ts';

/**
 * Category ids.
 * @since 3.3
 */
export class CategoryIds {

  static readonly TYPOGRAPHY = new CategoryId('TYPOGRAPHY');
  /** Rules about detecting uppercase words where lowercase is required and vice versa. */
  static readonly CASING = new CategoryId('CASING');
  static readonly GRAMMAR = new CategoryId('GRAMMAR');
  static readonly TYPOS = new CategoryId('TYPOS');
  static readonly PUNCTUATION = new CategoryId('PUNCTUATION');
  /** Words that are easily confused, like 'there' and 'their' in English. */
  static readonly CONFUSED_WORDS = new CategoryId('CONFUSED_WORDS');
  static readonly REDUNDANCY = new CategoryId('REDUNDANCY');
  static readonly STYLE = new CategoryId('STYLE');
  static readonly GENDER_NEUTRALITY = new CategoryId('GENDER_NEUTRALITY');
  static readonly SEMANTICS = new CategoryId('SEMANTICS');
  /** Colloquial style. */
  static readonly COLLOQUIALISMS = new CategoryId('COLLOQUIALISMS');
  /** Rules that only make sense when editing Wikipedia (typically turned off by default in LanguageTool). */
  static readonly WIKIPEDIA = new CategoryId('WIKIPEDIA');
  /** A words or expressions that are badly formed according to traditional philological rules,
   * for example a word formed from elements of different languages */
  static readonly BARBARISM = new CategoryId('BARBARISM');
  /** Miscellaneous rules that don't fit elsewhere. */
  static readonly MISC = new CategoryId('MISC');

  private constructor() {
  }
}
